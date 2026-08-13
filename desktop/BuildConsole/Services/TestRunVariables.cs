using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.RegularExpressions;

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
            if (configVars == null) return;
            int count = 0;
            foreach (var cv in configVars)
            {
                if (cv == null || string.IsNullOrWhiteSpace(cv.Name)) continue;
                _configVars[cv.Name.Trim()] = cv.Value ?? "";
                count++;
            }
            ActivityLog.Log(ConfigChannel, $"seeded {count} Test Environment Variable(s) for this run.");
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
                // Git #953 — Test Environment Variables win first, matching {{DEPLOY_URL}}/
                // {{SECRET_KEY}}'s "resolved before extracted values" precedence.
                if (_configVars.TryGetValue(name, out var cval))
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
                    ActivityLog.Log(ConfigChannel, $"MISSING {{{{{name}}}}} — not set in Settings > Test Environment Variables.");
                    ActivityLog.Log(Channel, $"MISSING {{{{{name}}}}} — no Test Environment Variable and no earlier step extracted it; refusing to send the literal placeholder.");
                }
                throw new VariableNotResolvedException(
                    "unresolved variable(s): " + string.Join(", ", missing.ConvertAll(n => "{{" + n + "}}"))
                    + " — set them in Settings > Test Environment Variables, or extract them in an earlier step.");
            }

            return result;
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
    }
}
