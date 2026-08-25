using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Thrown by <see cref="TestRunVariables.Resolve"/> when a {{name}} placeholder
    /// references a variable that no earlier step has extracted yet. Callers turn it into a clear
    /// per-step failure instead of silently sending the literal "{{name}}" text over the wire.</summary>
    public class VariableNotResolvedException : Exception
    {
        public VariableNotResolvedException(string message) : base(message) { }
    }

    /// <summary>
    /// Git #877 (Epic #803) — per-run cross-step variable store. Exactly one instance is created
    /// per <c>MainWindow.RunManifestAsync</c> and threaded through all three executors
    /// (<see cref="HttpTestExecutor"/> / <see cref="GraphTestExecutor"/> / <see cref="UiTestExecutor"/>),
    /// so a value extracted by an apiTest can be interpolated into a later graphTest or uiStep in
    /// the same run — the #437 "send code → read the real email → extract the 6-digit code → use it
    /// in verify-code's body" flow, and any future chain where one step's output feeds another's input.
    ///
    /// A step declares an <c>extract</c> block over its own response body — either
    /// <c>{ "as": "name", "regex": "\\d{6}" }</c> (regex over the raw body; capture group 1 if
    /// present, else the whole match) or <c>{ "as": "name", "jsonPath": "$.field" }</c> — and a
    /// later step references the stored value via <c>{{name}}</c> anywhere in its url/body/headers/target.
    ///
    /// Every extract/resolve/missing event logs to the "testing.interpolation" channel (this app's
    /// ActivityLog spine). Executors run sequentially within a single run and steps within each run
    /// sequentially, so no locking is needed.
    /// </summary>
    public class TestRunVariables
    {
        public const string Channel = "testing.interpolation";

        /// <summary>Git #953 — dedicated channel for the config-variable (Test Environment
        /// Variables) resolution layer, distinct from the per-run cross-step interpolation
        /// channel above, so a "the manifest referenced {{TEST_PORTAL_PASSWORD}} and it
        /// wasn't set in Settings" event is greppable on its own.</summary>
        public const string ConfigChannel = "testing.config-vars";

        private static readonly Regex PlaceholderPattern = new(@"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", RegexOptions.Compiled);
        private static readonly Regex JsonPathTokenPattern = new(@"\.([A-Za-z0-9_]+)|\[(\d+)\]", RegexOptions.Compiled);

        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

        /// <summary>Git #953 — config placeholders resolved from BuildConsole Settings'
        /// "Test Environment Variables" store (TEST_PORTAL_PASSWORD, GRAPH_TEST_TENANT_ID,
        /// …), seeded once at the start of a run via <see cref="SeedConfigVariables"/>.
        /// Checked in <see cref="Resolve"/> BEFORE the per-run extracted <see cref="_values"/>,
        /// giving stored config vars the same "resolved first" precedence
        /// {{DEPLOY_URL}}/{{SECRET_KEY}} already have (those stay resolved by the executors
        /// before this class runs).</summary>
        private readonly Dictionary<string, string> _configVars = new(StringComparer.Ordinal);

        /// <summary>
        /// Pause-on-unset (this session, Epic #803, extends #953/#961) — the names of config
        /// variables whose stored Test Environment Variable value is still the scanner's
        /// <see cref="TestManifestVariableScanner.AutoDefaultValue"/> (<c>&lt;unset&gt;</c>) or
        /// carries the <see cref="TestEnvVar.NeedsReview"/> flag, i.e. auto-added by the scanner
        /// and never given a real value. These are populated in <see cref="SeedConfigVariables"/>.
        /// <see cref="Resolve"/> REFUSES to substitute one of these (it would ship the literal
        /// "&lt;unset&gt;" downstream and cause a confusing failure), treating it as unresolved
        /// instead; <see cref="PrepareAsync"/> pauses the run and prompts for a real value before
        /// the step runs, removing the name from here once filled.
        /// </summary>
        private readonly HashSet<string> _needsRealValue = new(StringComparer.Ordinal);

        /// <summary>Names Shane declined to fill this run (dismissed the prompt or it couldn't be
        /// shown). Not re-prompted again in this run; every step referencing one still fails clearly
        /// via <see cref="Resolve"/>.</summary>
        private readonly HashSet<string> _dismissed = new(StringComparer.Ordinal);

        /// <summary>
        /// Pause-on-unset bridge (mirrors PowerShellTestExecutor's device-code
        /// <c>DeviceCodeInteraction</c> pattern): set by <c>MainWindow.RunManifestAsync</c> for
        /// interactive Play-Test runs only. Given a <see cref="MissingVariablePrompt"/> it returns
        /// the real value Shane typed into the non-blocking floaty, or <c>null</c> if he dismissed
        /// it. Left <c>null</c> on headless/regression runs — those can't prompt, so an unset
        /// variable simply fails the step clearly. Invoked on the UI thread (the delegate marshals),
        /// and awaited without blocking it, so the app stays responsive while the floaty is up.
        /// </summary>
        public Func<MissingVariablePrompt, Task<string?>>? OnMissingVariable { get; set; }

        /// <summary>Snapshot of everything extracted so far — for diagnostics/telemetry only.</summary>
        public IReadOnlyDictionary<string, string> Values => _values;

        /// <summary>
        /// Git #953 (Epic #803) — seed the config-variable layer from Settings' stored
        /// "Test Environment Variables" before a run starts. Empty/blank names are skipped;
        /// on a duplicate name the last one wins (mirrors a plain env-var override). Values
        /// are stored verbatim; secrets are never logged in full (see <see cref="Preview"/>).
        /// Idempotent-ish: calling it again replaces the whole config layer.
        /// </summary>
        public void SeedConfigVariables(IEnumerable<TestEnvVar>? configVars)
        {
            _configVars.Clear();
            _needsRealValue.Clear();

            // Seed active user account credentials so they are usable by the Test Runner
            var settings = BuildConsoleSettings.Load();
            UserAccountEntry? activeAccount = null;
            if (settings.UserAccounts != null)
            {
                foreach (var acc in settings.UserAccounts)
                {
                    if (acc.Id == settings.ActiveUserAccountId)
                    {
                        activeAccount = acc;
                        break;
                    }
                }
            }
            if (activeAccount != null)
            {
                _configVars["ACTIVE_TEST_USERNAME"] = activeAccount.Username;
                _configVars["ACTIVE_TEST_PASSWORD"] = activeAccount.Password;
                _configVars["ACTIVE_TEST_TIER"] = activeAccount.AccountTier;
            }

            if (configVars == null) return;
            int count = 0;
            int needReview = 0;
            foreach (var cv in configVars)
            {
                if (cv == null || string.IsNullOrWhiteSpace(cv.Name)) continue;
                string name = cv.Name.Trim();
                _configVars[name] = cv.Value ?? "";
                count++;

                // Pause-on-unset — a var still carrying the scanner's <unset> default, or explicitly
                // flagged needsReview, has no real value yet. Record it so Resolve refuses to ship the
                // placeholder and PrepareAsync prompts for a real value at the step that first needs it.
                // A duplicate name's LAST entry wins (mirrors the _configVars last-wins above).
                if (cv.NeedsReview
                    || string.Equals(cv.Value, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal))
                {
                    _needsRealValue.Add(name);
                    needReview++;
                }
                else
                {
                    _needsRealValue.Remove(name);
                }
            }
            ActivityLog.Log(ConfigChannel,
                $"seeded {count} Test Environment Variable(s) for this run"
                + (needReview > 0 ? $"; {needReview} still unset/needsReview (will prompt on use)." : "."));
        }

        /// <summary>
        /// Resolve every <c>{{name}}</c> placeholder in <paramref name="input"/>. Each name is
        /// tried against the Settings-stored "Test Environment Variables" (<see cref="_configVars"/>,
        /// Git #953) FIRST, then against the values extracted by earlier steps
        /// (<see cref="_values"/>). If any referenced variable is found in neither, logs each
        /// missing name and throws <see cref="VariableNotResolvedException"/> — never returns a
        /// string still containing an unresolved <c>{{name}}</c>. <c>{{DEPLOY_URL}}</c>/
        /// <c>{{SECRET_KEY}}</c> are still resolved by the executors (HttpTestExecutor) BEFORE
        /// this runs, so they never reach here as unresolved.
        /// </summary>
        public string Resolve(string? input)
        {
            if (string.IsNullOrEmpty(input) || input.IndexOf("{{", StringComparison.Ordinal) < 0)
                return input ?? string.Empty;

            var missing = new List<string>();
            string result = PlaceholderPattern.Replace(input, m =>
            {
                string name = m.Groups[1].Value;
                // Pause-on-unset — a config var whose stored value is still <unset>/needsReview has
                // no real value yet. Skip it here (do NOT ship the placeholder text downstream) and
                // fall through to an extracted value if one exists; otherwise it's genuinely missing
                // and throws below. PrepareAsync normally fills/removes it before this runs, so a name
                // still in _needsRealValue at resolution time means the prompt was dismissed or the run
                // was non-interactive — either way, fail clearly instead of sending "<unset>".
                bool configUnset = _needsRealValue.Contains(name);
                // Git #953 — Test Environment Variables win first, matching {{DEPLOY_URL}}/
                // {{SECRET_KEY}}'s "resolved before extracted values" precedence.
                if (!configUnset && _configVars.TryGetValue(name, out var cval))
                {
                    ActivityLog.Log(ConfigChannel, $"resolved {{{{{name}}}}} from Test Environment Variables -> \"{Preview(cval)}\"");
                    return cval;
                }
                if (_values.TryGetValue(name, out var val))
                {
                    ActivityLog.Log(Channel, $"resolved {{{{{name}}}}} -> \"{Preview(val)}\"");
                    return val;
                }
                missing.Add(name);
                return m.Value;
            });

            if (missing.Count > 0)
            {
                foreach (var name in missing)
                {
                    // Git #953 — a miss is logged on the config-vars channel too, so the fix
                    // ("set it in Settings > Test Environment Variables") is obvious from the log.
                    // Pause-on-unset — distinguish "exists but still <unset>/needsReview (and the
                    // prompt was dismissed or this run is non-interactive)" from "never defined at all".
                    ActivityLog.Log(ConfigChannel, _needsRealValue.Contains(name)
                        ? $"MISSING {{{{{name}}}}} — its Test Environment Variable is still unset/needsReview (no real value provided); refusing to send the placeholder."
                        : $"MISSING {{{{{name}}}}} — not set in Settings > Test Environment Variables.");
                    ActivityLog.Log(Channel, $"MISSING {{{{{name}}}}} — no Test Environment Variable and no earlier step extracted it; refusing to send the literal placeholder.");
                }
                throw new VariableNotResolvedException(
                    "unresolved variable(s): " + string.Join(", ", missing.ConvertAll(n => "{{" + n + "}}"))
                    + " — set them in Settings > Test Environment Variables, or extract them in an earlier step.");
            }

            return result;
        }

        /// <summary>
        /// Pause-on-unset gate. Called by every executor at the top of each step, BEFORE the step's
        /// synchronous <see cref="Resolve"/> calls run, with the raw text(s) that step will resolve
        /// (its JSON, selector/value, cmdlet, …). For each distinct <c>{{NAME}}</c> that references a
        /// Test Environment Variable still <c>&lt;unset&gt;</c>/needsReview — and that no earlier step
        /// has extracted a real value for, and that Shane hasn't already declined this run — the run is
        /// PAUSED here and <see cref="OnMissingVariable"/> is awaited (a non-blocking floaty). On a real
        /// value: it's stored so it wins for this step AND every later reference in this run, saved back
        /// to the Settings store with its needsReview flag cleared (exactly as if Shane had set it in
        /// Settings), and the run resumes. On dismissal (or a non-interactive run with no bridge): the
        /// name is left unresolved so the subsequent <see cref="Resolve"/> throws a
        /// <see cref="VariableNotResolvedException"/> naming it — a clear per-step failure, never a hang.
        /// Cheap no-op when nothing is unset (the common case) — returns before scanning.
        /// </summary>
        public async Task PrepareAsync(params string?[]? inputs)
        {
            if (inputs == null) return;

            // Distinct, in-order placeholder names across all inputs that still need a real value.
            var toPrompt = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var input in inputs)
            {
                if (string.IsNullOrEmpty(input) || input.IndexOf("{{", StringComparison.Ordinal) < 0) continue;
                foreach (Match m in PlaceholderPattern.Matches(input))
                {
                    string name = m.Groups[1].Value;
                    if (!seen.Add(name)) continue;

                    // Built-in system placeholders are resolved directly by executors (e.g. HttpTestExecutor)
                    if (string.Equals(name, "DEPLOY_URL", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(name, "SECRET_KEY", StringComparison.OrdinalIgnoreCase))
                        continue;

                    // An earlier step in this run already extracted a real value
                    if (_values.ContainsKey(name)) continue;

                    // Check if Settings has a valid, non-empty, non-<unset> value that does not need review
                    bool hasConfig = _configVars.TryGetValue(name, out var cfgVal)
                                     && !string.IsNullOrWhiteSpace(cfgVal)
                                     && !string.Equals(cfgVal, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal)
                                     && !_needsRealValue.Contains(name);
                    if (hasConfig) continue;

                    // User already dismissed the prompt for this name in this run
                    if (_dismissed.Contains(name)) continue;

                    toPrompt.Add(name);
                }
            }
            if (toPrompt.Count == 0) return;

            foreach (var name in toPrompt)
            {
                string current = _configVars.TryGetValue(name, out var c) ? c : "";
                ActivityLog.Log(ConfigChannel,
                    $"PAUSE run — Test Environment Variable {{{{{name}}}}} is still \"{Preview(current)}\" (unset/unextracted/needsReview); pausing this step to prompt for a real value.");

                if (OnMissingVariable == null)
                {
                    // Non-interactive run (headless remote trigger / scheduled sweep): can't prompt.
                    // Leave it flagged so Resolve fails the step clearly instead of shipping "<unset>".
                    ActivityLog.Log(ConfigChannel,
                        $"run is non-interactive — cannot prompt for {{{{{name}}}}}; the step will FAIL clearly (set it in Settings > Test Environment Variables).");
                    _dismissed.Add(name);
                    continue;
                }

                string? entered;
                try
                {
                    entered = await OnMissingVariable(new MissingVariablePrompt
                    {
                        Name = name,
                        CurrentValue = current,
                    });
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(ConfigChannel,
                        $"could not show the prompt for {{{{{name}}}}} ({ex.Message}); the step will FAIL clearly.");
                    _dismissed.Add(name);
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(entered)
                    && !string.Equals(entered, TestManifestVariableScanner.AutoDefaultValue, StringComparison.Ordinal))
                {
                    _configVars[name] = entered;
                    _needsRealValue.Remove(name);
                    PersistConfigVar(name, entered);
                    ActivityLog.Log(ConfigChannel,
                        $"RESUME run — {{{{{name}}}}} set to \"{Preview(entered)}\" and saved to Test Environment Variables (needsReview cleared); continuing this step and any later {{{{{name}}}}} in this run.");
                }
                else
                {
                    _dismissed.Add(name);
                    ActivityLog.Log(ConfigChannel,
                        $"run will FAIL for this step — {{{{{name}}}}} left unset (prompt dismissed/empty); the step depending on it fails clearly.");
                }
            }
        }

        /// <summary>Persist a freshly-entered variable back to the real Settings "Test Environment
        /// Variables" store — the SAME store/round-trip Settings and the scanner use
        /// (<see cref="BuildConsoleSettings"/>). Updates an existing row in place (value + clears
        /// <see cref="TestEnvVar.NeedsReview"/>) or adds a new reviewed row, then
        /// <see cref="BuildConsoleSettings.Save"/>s. Best-effort: a store-write failure is logged but
        /// never aborts the resumed run (the value is already live in <see cref="_configVars"/> for
        /// this run regardless).</summary>
        private static void PersistConfigVar(string name, string value)
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                TestEnvVar? existing = null;
                foreach (var v in settings.TestEnvironmentVariables)
                {
                    if (string.Equals(v.Name, name, StringComparison.Ordinal)) { existing = v; break; }
                }
                if (existing == null)
                    settings.TestEnvironmentVariables.Add(new TestEnvVar { Name = name, Value = value, NeedsReview = false });
                else { existing.Value = value; existing.NeedsReview = false; }
                settings.Save();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ConfigChannel,
                    $"could not save Test Environment Variable {name} to settings.json ({ex.Message}); it is still live for THIS run.");
            }
        }

        /// <summary>
        /// Apply a step's <c>extract</c> block to its <paramref name="responseBody"/>, storing the
        /// captured value under its <c>as</c> name for later <see cref="Resolve"/> calls. Returns
        /// <c>null</c> on success, or a human-readable error string if extraction was declared but
        /// produced no value (invalid/absent <c>as</c>, non-matching regex, unresolved jsonPath,
        /// non-JSON body, etc.) — callers surface that as a step failure so the downstream
        /// {{name}} reference fails clearly at its source rather than mysteriously later.
        /// </summary>
        public string? Extract(JsonElement extractEl, string responseBody)
        {
            if (extractEl.ValueKind != JsonValueKind.Object)
                return "extract block is not a JSON object.";

            string name = extractEl.TryGetProperty("as", out var asEl) && asEl.ValueKind == JsonValueKind.String
                ? (asEl.GetString() ?? "") : "";
            if (string.IsNullOrWhiteSpace(name))
                return "extract block missing a non-empty \"as\" variable name.";

            if (extractEl.TryGetProperty("regex", out var regexEl) && regexEl.ValueKind == JsonValueKind.String)
            {
                string pattern = regexEl.GetString() ?? "";
                Match match;
                try { match = Regex.Match(responseBody ?? "", pattern); }
                catch (ArgumentException ex) { return $"extract \"{name}\": invalid regex /{pattern}/ — {ex.Message}"; }

                if (!match.Success)
                    return $"extract \"{name}\": regex /{pattern}/ did not match the response body.";

                // Prefer capture group 1 when the pattern declares one; otherwise the whole match.
                string captured = match.Groups.Count > 1 && match.Groups[1].Success ? match.Groups[1].Value : match.Value;
                Store(name, captured, $"regex /{pattern}/");
                return null;
            }

            if (extractEl.TryGetProperty("jsonPath", out var jsonPathEl) && jsonPathEl.ValueKind == JsonValueKind.String)
            {
                string jsonPath = jsonPathEl.GetString() ?? "";
                JsonElement root;
                try
                {
                    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(responseBody) ? "null" : responseBody);
                    root = doc.RootElement.Clone();
                }
                catch (JsonException)
                {
                    return $"extract \"{name}\": response body is not JSON — cannot apply jsonPath {jsonPath}.";
                }

                // A `[*]` array wildcard (e.g. "$[*].leadText") collects EVERY match, not one node —
                // the whole real set of a response array's values (the 50 admin-authored hero leadTexts,
                // say), stored as a single SetDelimiter-joined blob under `as`. {{name}} interpolation still
                // resolves it to that blob verbatim (no braces inside to touch); a consumer that wants the
                // members back — e.g. UiTestExecutor's `textPrefixOfAny` matcher — splits it via SplitSet.
                // This keeps the whole #877 store a plain Dictionary<string,string> rather than growing a
                // parallel array store, at the cost of one reserved control char (U+001F) that never appears
                // in real copy.
                if (PathHasWildcard(jsonPath))
                {
                    var all = ResolveJsonPathAll(root, jsonPath);
                    if (all.Count == 0)
                        return $"extract \"{name}\": jsonPath {jsonPath} matched no elements in the response body.";
                    Store(name, string.Join(SetDelimiter.ToString(), all), $"jsonPath {jsonPath} (×{all.Count})");
                    return null;
                }

                if (!TryResolveJsonPath(root, jsonPath, out var found))
                    return $"extract \"{name}\": jsonPath {jsonPath} did not resolve in the response body.";

                // A string value is stored as-is (no quotes); anything else keeps its JSON text.
                string captured = found.ValueKind == JsonValueKind.String ? (found.GetString() ?? "") : found.GetRawText();
                Store(name, captured, $"jsonPath {jsonPath}");
                return null;
            }

            return $"extract \"{name}\": neither \"regex\" nor \"jsonPath\" provided.";
        }

        private void Store(string name, string value, string via)
        {
            _values[name] = value;
            ActivityLog.Log(Channel, $"extracted {{{{{name}}}}} = \"{Preview(value)}\" (via {via}).");
        }

        private static string Preview(string s) => s.Length > 80 ? s.Substring(0, 80) + "..." : s;

        /// <summary>Minimal dot/index path resolver ($.a.b[0]) — same shape HttpTestExecutor's own
        /// jsonPath assertions use; not a full JSONPath engine.</summary>
        private static bool TryResolveJsonPath(JsonElement root, string path, out JsonElement result)
        {
            result = default;
            if (string.IsNullOrWhiteSpace(path)) return false;
            var body = path.StartsWith("$", StringComparison.Ordinal) ? path.Substring(1) : path;
            var current = root;
            foreach (Match token in JsonPathTokenPattern.Matches(body))
            {
                if (token.Groups[1].Success)
                {
                    if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(token.Groups[1].Value, out current))
                        return false;
                }
                else if (token.Groups[2].Success)
                {
                    int idx = int.Parse(token.Groups[2].Value);
                    if (current.ValueKind != JsonValueKind.Array || idx >= current.GetArrayLength())
                        return false;
                    current = current[idx];
                }
            }
            result = current;
            return true;
        }

        /// <summary>The reserved separator a `[*]`-wildcard <see cref="Extract"/> joins its collected
        /// values with (ASCII Unit Separator, U+001F). Chosen because it never appears in real UI copy,
        /// so a joined set round-trips through the plain string variable store without ambiguity. Consumers
        /// recover the members via <see cref="SplitSet"/>.</summary>
        public const char SetDelimiter = '\u001F';

        /// <summary>Split a value produced by a `[*]`-wildcard extract (a <see cref="SetDelimiter"/>-joined
        /// blob) back into its member strings. A plain (non-wildcard) value with no delimiter round-trips as
        /// a single-element list, so callers can treat any resolved variable as a candidate set uniformly.
        /// Empty/blank members are dropped.</summary>
        public static List<string> SplitSet(string? value)
        {
            var list = new List<string>();
            if (string.IsNullOrEmpty(value)) return list;
            foreach (var part in value.Split(SetDelimiter))
                if (!string.IsNullOrEmpty(part)) list.Add(part);
            return list;
        }

        private static bool PathHasWildcard(string path) => path.IndexOf("[*]", StringComparison.Ordinal) >= 0;

        // Same token grammar as JsonPathTokenPattern plus the `[*]` array wildcard (group 0, no capture).
        private static readonly Regex JsonPathWildcardTokenPattern = new(@"\.([A-Za-z0-9_]+)|\[(\d+)\]|\[\*\]", RegexOptions.Compiled);

        /// <summary>Resolve a jsonPath that may contain one or more `[*]` array wildcards, collecting the
        /// stringified value of EVERY leaf the path reaches ($[*].leadText → every element's leadText).
        /// A string leaf keeps its raw value; any other kind keeps its JSON text — matching the single-node
        /// <see cref="Extract"/> path's conversion. Order is document order; non-matching branches are simply
        /// skipped (a shape mismatch yields fewer results, never an exception).</summary>
        private static List<string> ResolveJsonPathAll(JsonElement root, string path)
        {
            var tokens = new List<(string? prop, int? index, bool wildcard)>();
            var body = path.StartsWith("$", StringComparison.Ordinal) ? path.Substring(1) : path;
            foreach (Match tk in JsonPathWildcardTokenPattern.Matches(body))
            {
                if (tk.Groups[1].Success) tokens.Add((tk.Groups[1].Value, null, false));
                else if (tk.Groups[2].Success) tokens.Add((null, int.Parse(tk.Groups[2].Value), false));
                else tokens.Add((null, null, true)); // [*]
            }

            var results = new List<string>();
            WalkCollect(root, tokens, 0, results);
            return results;
        }

        private static void WalkCollect(JsonElement current, List<(string? prop, int? index, bool wildcard)> tokens, int i, List<string> results)
        {
            if (i >= tokens.Count)
            {
                results.Add(current.ValueKind == JsonValueKind.String ? (current.GetString() ?? "") : current.GetRawText());
                return;
            }

            var (prop, index, wildcard) = tokens[i];
            if (wildcard)
            {
                if (current.ValueKind != JsonValueKind.Array) return;
                foreach (var el in current.EnumerateArray())
                    WalkCollect(el, tokens, i + 1, results);
            }
            else if (prop != null)
            {
                if (current.ValueKind == JsonValueKind.Object && current.TryGetProperty(prop, out var next))
                    WalkCollect(next, tokens, i + 1, results);
            }
            else if (index.HasValue)
            {
                if (current.ValueKind == JsonValueKind.Array && index.Value < current.GetArrayLength())
                    WalkCollect(current[index.Value], tokens, i + 1, results);
            }
        }

        /// <summary>Pause-on-unset — the payload handed to <see cref="OnMissingVariable"/> describing the
        /// one Test Environment Variable that needs a real value before the current step can run. The
        /// floaty shows <see cref="Name"/> (and <see cref="CurrentValue"/>, typically the
        /// <c>&lt;unset&gt;</c> placeholder) and returns whatever Shane types.</summary>
        public sealed class MissingVariablePrompt
        {
            /// <summary>The variable name (as it appears inside <c>{{ }}</c>), e.g. <c>TEST_PORTAL_PASSWORD</c>.</summary>
            public string Name { get; init; } = "";

            /// <summary>The current stored value (usually the scanner's <c>&lt;unset&gt;</c> default) — shown as context.</summary>
            public string CurrentValue { get; init; } = "";
        }
    }
}
