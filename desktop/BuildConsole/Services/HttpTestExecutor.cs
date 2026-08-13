using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #807 (Epic #803 Phase 3) — executes manifest.ApiTests against a real HttpClient
    /// and asserts each response against its `expect` block (status, jsonPath exists/value/isArray,
    /// per #803's manifest schema). Plugs into RunManifestAsync (#806) the same stable entry
    /// point #808 (graphTests) and #809 (uiSteps) plug into; returns TestStepResult entries for
    /// the caller to fold into the one shared ManifestRunResult, not a separate output.
    /// </summary>
    public static class HttpTestExecutor
    {
        private const string Channel = "testing.api-executor";

        /// <summary>Git #810 — raised after each apiTest completes so the Test Results tab can render a telemetry card live, during the run, instead of waiting for the whole manifest to finish.</summary>
        public static event Action<TestStepResult>? StepCompleted;

        public static Task<List<TestStepResult>> RunAsync(TestManifest manifest, BuildTrackerConfig config, TestRunVariables vars) =>
            RunListAsync(manifest, manifest.ApiTests, config, vars);

        /// <summary>Git #879 — runs `manifest.PostGraphApiTests`, the same apiTest shape as
        /// `RunAsync`/`manifest.ApiTests` but called from RunManifestAsync AFTER graphTests
        /// instead of before, for calls that depend on a value graphTests' mail-poll `extract`
        /// (#877/#878) only captures once the poll matches — e.g. #437's verify-code call
        /// needing the 6-digit code pulled from the delivered email.</summary>
        public static Task<List<TestStepResult>> RunPostGraphAsync(TestManifest manifest, BuildTrackerConfig config, TestRunVariables vars) =>
            RunListAsync(manifest, manifest.PostGraphApiTests, config, vars);

        private static async Task<List<TestStepResult>> RunListAsync(TestManifest manifest, List<JsonElement> tests, BuildTrackerConfig config, TestRunVariables vars)
        {
            var results = new List<TestStepResult>();
            if (tests.Count == 0) return results;

            using var http = new HttpClient();
            for (int i = 0; i < tests.Count; i++)
            {
                var result = await RunOneAsync(http, manifest, config, vars, tests[i], i, tests.Count);
                results.Add(result);
                StepCompleted?.Invoke(result);
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(HttpClient http, TestManifest manifest, BuildTrackerConfig config, TestRunVariables vars, JsonElement test, int index, int total)
        {
            var sw = Stopwatch.StartNew();
            string method = test.TryGetProperty("method", out var m) ? (m.GetString() ?? "GET") : "GET";
            string path = test.TryGetProperty("path", out var p) ? (p.GetString() ?? "") : "";
            string label = $"{method} {path}";

            try
            {
                // Config placeholders ({{DEPLOY_URL}}/{{SECRET_KEY}}) first, then cross-step
                // {{variable}} interpolation (#877) against values earlier steps extracted — so any
                // {{...}} still present after config resolution is genuinely an extracted variable,
                // and an unresolved one throws (caught below) rather than shipping literal text.
                string baseUrl = vars.Resolve(ResolvePlaceholders(string.IsNullOrWhiteSpace(manifest.BaseUrl) ? config.ApiBaseUrl : manifest.BaseUrl, config));
                string url = BuildUrl(baseUrl, vars.Resolve(ResolvePlaceholders(path, config)));

                using var req = new HttpRequestMessage(new HttpMethod(method), url);
                if (test.TryGetProperty("headers", out var headersEl) && headersEl.ValueKind == JsonValueKind.Object)
                {
                    foreach (var h in headersEl.EnumerateObject())
                        req.Headers.TryAddWithoutValidation(h.Name, vars.Resolve(ResolvePlaceholders(h.Value.GetString() ?? "", config)));
                }
                if (test.TryGetProperty("body", out var bodyEl))
                    req.Content = new StringContent(vars.Resolve(ResolvePlaceholders(bodyEl.GetRawText(), config)), Encoding.UTF8, "application/json");

                ActivityLog.Log(Channel, $"[{index + 1}/{total}] {method} {url}");
                using var resp = await http.SendAsync(req);
                string responseBody = await resp.Content.ReadAsStringAsync();

                var expect = test.TryGetProperty("expect", out var e) ? e : default;
                var (passed, detail, expected, actual) = EvaluateExpectation(expect, (int)resp.StatusCode, responseBody);

                // #877 — extract a value out of this step's own response body for later steps to use.
                if (test.TryGetProperty("extract", out var extractEl) && extractEl.ValueKind == JsonValueKind.Object)
                {
                    string? extractError = vars.Extract(extractEl, responseBody);
                    if (extractError != null)
                    {
                        passed = false;
                        detail = string.IsNullOrEmpty(detail) || detail == "ok" ? extractError : $"{detail}; {extractError}";
                    }
                }

                string context = $"{method} {url} -> {(int)resp.StatusCode}; response body: {Truncate(responseBody, 500)}";

                sw.Stop();
                string? durationError = CheckMaxDuration(test, sw.ElapsedMilliseconds);
                if (durationError != null)
                {
                    passed = false;
                    detail = string.IsNullOrEmpty(detail) || detail == "ok" ? durationError : $"{detail}; {durationError}";
                }

                ActivityLog.Log(Channel, (passed ? "PASS " : "FAIL ") + $"{label} ({sw.ElapsedMilliseconds}ms) — {detail}");
                return new TestStepResult
                {
                    Kind = "api", Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds,
                    Expected = expected, Actual = actual, Context = context,
                };
            }
            catch (Exception ex)
            {
                sw.Stop();
                ActivityLog.Log(Channel, $"ERROR {label}: {ex.Message}");
                return new TestStepResult
                {
                    Kind = "api", Label = label, Passed = false, Detail = ex.Message, DurationMs = sw.ElapsedMilliseconds,
                    Actual = $"{ex.GetType().Name}: {ex.Message}", Context = $"{method} {path}",
                };
            }
        }

        internal static string Truncate(string s, int max) => s.Length > max ? s.Substring(0, max) + "..." : s;

        /// <summary>{{DEPLOY_URL}} -> the configured api base url (scripts/build-queue-watcher.config.json), {{SECRET_KEY}} -> its IngestToken — same "Shane's existing secret-key mechanism" #803's Auth section defers to, not a new credential store. Internal (not private) so MainWindow.RunManifestAsync can resolve manifest.BaseUrl the same way before handing it to UiTestExecutor (Git #958 — uiSteps previously got the raw unresolved "{{DEPLOY_URL}}" string, which CoreWebView2.Navigate() throws on).</summary>
        internal static string ResolvePlaceholders(string input, BuildTrackerConfig config) =>
            (input ?? "").Replace("{{DEPLOY_URL}}", config.ApiBaseUrl.TrimEnd('/')).Replace("{{SECRET_KEY}}", config.IngestToken);

        private static string BuildUrl(string baseUrl, string path)
        {
            if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return path;
            return baseUrl.TrimEnd('/') + "/" + path.TrimStart('/');
        }

        /// <summary>
        /// Git #969 — the single shared evaluator for a step's optional `maxDurationMs` field
        /// (a sibling of `expect`, not part of it — every step type accepts it: apiTests,
        /// graphTests, zohoTests, uiSteps, powerShellVerify). Compares against the SAME elapsed-
        /// time value each executor already tracks for its own logging/telemetry (Stopwatch ->
        /// TestStepResult.DurationMs) — no new timing instrumentation, just an assertion on data
        /// that already exists. Reports the real actual-vs-threshold numbers so a failure is
        /// diagnosable without re-running, per #969 ("not just too slow"). Returns null when no
        /// threshold is declared or the step ran within it.
        /// </summary>
        internal static string? CheckMaxDuration(long? maxDurationMs, long actualDurationMs)
        {
            if (!maxDurationMs.HasValue) return null;
            if (actualDurationMs <= maxDurationMs.Value) return null;
            return $"exceeded maxDurationMs: took {actualDurationMs}ms, threshold {maxDurationMs.Value}ms";
        }

        /// <summary>Overload for the raw-JSON step shape (apiTests/graphTests/zohoTests/powerShellVerify) — reads `maxDurationMs` off the step element itself, not off `expect`.</summary>
        internal static string? CheckMaxDuration(JsonElement step, long actualDurationMs)
        {
            long? maxDurationMs = step.ValueKind == JsonValueKind.Object
                && step.TryGetProperty("maxDurationMs", out var el)
                && el.ValueKind == JsonValueKind.Number
                && el.TryGetInt64(out var n) ? n : (long?)null;
            return CheckMaxDuration(maxDurationMs, actualDurationMs);
        }

        /// <summary>Git #812 — Expected/Actual are built from every declared assertion (not just the failing ones), so a passing step's JSON still records what was checked — useful context for diagnosing a DIFFERENT step's regression later without re-running.</summary>
        internal static (bool passed, string detail, string expected, string actual) EvaluateExpectation(JsonElement expect, int actualStatus, string responseBody)
        {
            if (expect.ValueKind != JsonValueKind.Object) return (true, "no expectations declared", "", "");

            var problems = new List<string>();
            var expectedParts = new List<string>();
            var actualParts = new List<string>();

            if (expect.TryGetProperty("status", out var statusEl))
            {
                int expectedStatus = statusEl.GetInt32();
                expectedParts.Add($"status={expectedStatus}");
                actualParts.Add($"status={actualStatus}");
                if (actualStatus != expectedStatus)
                    problems.Add($"status {actualStatus} != expected {expectedStatus}");
            }

            if (expect.TryGetProperty("jsonPath", out var jsonPathEl))
            {
                string jsonPath = jsonPathEl.GetString() ?? "";

                JsonElement responseRoot = default;
                bool bodyIsJson = false;
                try
                {
                    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(responseBody) ? "null" : responseBody);
                    responseRoot = doc.RootElement.Clone();
                    bodyIsJson = true;
                }
                catch (JsonException) { /* non-JSON body — resolved stays false below */ }

                JsonElement found = default;
                bool resolved = bodyIsJson && TryResolveJsonPath(responseRoot, jsonPath, out found);

                if (expect.TryGetProperty("exists", out var existsEl))
                {
                    bool expectedExists = existsEl.GetBoolean();
                    expectedParts.Add($"{jsonPath} exists={expectedExists}");
                    actualParts.Add($"{jsonPath} exists={resolved}");
                    if (resolved != expectedExists)
                        problems.Add($"jsonPath {jsonPath} exists={resolved}, expected {expectedExists}");
                }

                if (expect.TryGetProperty("isArray", out var isArrayEl))
                {
                    bool expectedIsArray = isArrayEl.GetBoolean();
                    bool actualIsArray = resolved && found.ValueKind == JsonValueKind.Array;
                    expectedParts.Add($"{jsonPath} isArray={expectedIsArray}");
                    actualParts.Add($"{jsonPath} isArray={actualIsArray}");
                    if (actualIsArray != expectedIsArray)
                        problems.Add($"jsonPath {jsonPath} isArray={actualIsArray}, expected {expectedIsArray}");
                }

                if (expect.TryGetProperty("value", out var valueEl))
                {
                    expectedParts.Add($"{jsonPath} = {valueEl.GetRawText()}");
                    actualParts.Add(resolved ? $"{jsonPath} = {found.GetRawText()}" : $"{jsonPath} did not resolve");
                    if (!resolved)
                        problems.Add($"jsonPath {jsonPath} did not resolve, expected value {valueEl.GetRawText()}");
                    else if (!JsonElementValuesEqual(found, valueEl))
                        problems.Add($"jsonPath {jsonPath} = {found.GetRawText()}, expected {valueEl.GetRawText()}");
                }
            }

            // Git #892 — content assertions (containsAny/containsNone) on what the response actually SAYS,
            // folded in alongside status/jsonPath so every declared assertion must pass for the step to pass.
            EvaluateContentAssertions(expect, responseBody, problems, expectedParts, actualParts);

            string expected = string.Join("; ", expectedParts);
            string actual = string.Join("; ", actualParts);
            return (problems.Count == 0, problems.Count == 0 ? "ok" : string.Join("; ", problems), expected, actual);
        }

        /// <summary>
        /// Git #892 — the single shared evaluator for expect.containsAny / expect.containsNone, called by
        /// every executor that asserts on a response body: HttpTestExecutor.EvaluateExpectation (apiTests +
        /// graphTests via delegation + zohoTests) and UiTestExecutor's captureResponse builder — the
        /// substring-matching semantics live in exactly one place, never copied three times.
        ///
        /// Both fields operate on the SAME field the jsonPath check targets — the resolved value as a string
        /// (a string node's value, or the raw JSON text of a non-string/array/object node) — or the raw
        /// response body when no jsonPath is declared. Matching is case-insensitive substring, not exact.
        /// containsAny fails when NONE of its phrases appear; containsNone fails when ANY appears. Each is
        /// independently optional. Appends to the caller's problems/expected/actual lists so it composes with
        /// the status/jsonPath assertions already recorded. A miss records a truncated, whitespace-collapsed
        /// preview of what the field ACTUALLY contained next to the phrase list, so the failure is
        /// diagnosable straight from the log line without re-running the test.
        /// </summary>
        internal static void EvaluateContentAssertions(JsonElement expect, string responseBody,
            List<string> problems, List<string> expectedParts, List<string> actualParts)
        {
            if (expect.ValueKind != JsonValueKind.Object) return;
            bool hasAny = expect.TryGetProperty("containsAny", out var anyEl) && anyEl.ValueKind == JsonValueKind.Array;
            bool hasNone = expect.TryGetProperty("containsNone", out var noneEl) && noneEl.ValueKind == JsonValueKind.Array;
            if (!hasAny && !hasNone) return;

            string fieldText = ResolveContentField(expect, responseBody, out string fieldLabel);
            string preview = Truncate(CollapseWhitespace(fieldText), 200);

            if (hasAny)
            {
                var phrases = ReadStringArray(anyEl);
                expectedParts.Add($"{fieldLabel} containsAny [{JoinQuoted(phrases)}]");
                string? hit = FirstContained(fieldText, phrases);
                actualParts.Add(hit != null ? $"{fieldLabel} contained \"{hit}\"" : $"{fieldLabel} contained none of them");
                if (phrases.Count > 0 && hit == null)
                    problems.Add($"containsAny: none of [{JoinQuoted(phrases)}] found in {fieldLabel} (actual: \"{preview}\")");
            }

            if (hasNone)
            {
                var phrases = ReadStringArray(noneEl);
                expectedParts.Add($"{fieldLabel} containsNone [{JoinQuoted(phrases)}]");
                var hits = AllContained(fieldText, phrases);
                actualParts.Add(hits.Count > 0 ? $"{fieldLabel} contained forbidden [{JoinQuoted(hits)}]" : $"{fieldLabel} contained none of the forbidden phrases");
                if (hits.Count > 0)
                    problems.Add($"containsNone: forbidden phrase(s) [{JoinQuoted(hits)}] found in {fieldLabel} (actual: \"{preview}\")");
            }
        }

        /// <summary>Resolve the field that containsAny/containsNone match against — the jsonPath target
        /// (a string node's value, or raw JSON for any other node), or the whole response body when no
        /// jsonPath is declared. A declared-but-unresolved jsonPath yields an empty field (so containsAny
        /// fails and containsNone passes). <paramref name="label"/> is a human name used in messages.</summary>
        private static string ResolveContentField(JsonElement expect, string responseBody, out string label)
        {
            if (expect.TryGetProperty("jsonPath", out var jpEl) && jpEl.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(jpEl.GetString()))
            {
                string jsonPath = jpEl.GetString()!;
                label = jsonPath;
                try
                {
                    using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(responseBody) ? "null" : responseBody);
                    if (TryResolveJsonPath(doc.RootElement, jsonPath, out var found))
                        return found.ValueKind == JsonValueKind.String ? (found.GetString() ?? "") : found.GetRawText();
                }
                catch (JsonException) { /* non-JSON body — a declared jsonPath can't resolve; empty field */ }
                return "";
            }
            label = "response body";
            return responseBody ?? "";
        }

        private static List<string> ReadStringArray(JsonElement arr)
        {
            var list = new List<string>();
            foreach (var el in arr.EnumerateArray())
                if (el.ValueKind == JsonValueKind.String)
                {
                    string? s = el.GetString();
                    if (!string.IsNullOrEmpty(s)) list.Add(s);
                }
            return list;
        }

        private static string? FirstContained(string haystack, List<string> phrases)
        {
            foreach (var p in phrases)
                if (haystack.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0) return p;
            return null;
        }

        private static List<string> AllContained(string haystack, List<string> phrases)
        {
            var hits = new List<string>();
            foreach (var p in phrases)
                if (haystack.IndexOf(p, StringComparison.OrdinalIgnoreCase) >= 0) hits.Add(p);
            return hits;
        }

        private static string JoinQuoted(List<string> items) => string.Join(", ", items.ConvertAll(s => $"\"{s}\""));

        private static string CollapseWhitespace(string s) => string.IsNullOrEmpty(s) ? "" : Regex.Replace(s, @"\s+", " ").Trim();

        private static readonly Regex JsonPathTokenPattern = new(@"\.([A-Za-z0-9_]+)|\[(\d+)\]", RegexOptions.Compiled);

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

        private static bool JsonElementValuesEqual(JsonElement a, JsonElement b)
        {
            if (a.ValueKind != b.ValueKind) return false;
            return a.ValueKind switch
            {
                JsonValueKind.String => a.GetString() == b.GetString(),
                JsonValueKind.Number => a.GetRawText() == b.GetRawText(),
                JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null => true,
                _ => a.GetRawText() == b.GetRawText(),
            };
        }
    }
}
