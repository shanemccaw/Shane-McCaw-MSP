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

        public static async Task<List<TestStepResult>> RunAsync(TestManifest manifest, BuildTrackerConfig config)
        {
            var results = new List<TestStepResult>();
            if (manifest.ApiTests.Count == 0) return results;

            using var http = new HttpClient();
            for (int i = 0; i < manifest.ApiTests.Count; i++)
            {
                results.Add(await RunOneAsync(http, manifest, config, manifest.ApiTests[i], i));
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(HttpClient http, TestManifest manifest, BuildTrackerConfig config, JsonElement test, int index)
        {
            var sw = Stopwatch.StartNew();
            string method = test.TryGetProperty("method", out var m) ? (m.GetString() ?? "GET") : "GET";
            string path = test.TryGetProperty("path", out var p) ? (p.GetString() ?? "") : "";
            string label = $"{method} {path}";

            try
            {
                string baseUrl = ResolvePlaceholders(string.IsNullOrWhiteSpace(manifest.BaseUrl) ? config.ApiBaseUrl : manifest.BaseUrl, config);
                string url = BuildUrl(baseUrl, ResolvePlaceholders(path, config));

                using var req = new HttpRequestMessage(new HttpMethod(method), url);
                if (test.TryGetProperty("headers", out var headersEl) && headersEl.ValueKind == JsonValueKind.Object)
                {
                    foreach (var h in headersEl.EnumerateObject())
                        req.Headers.TryAddWithoutValidation(h.Name, ResolvePlaceholders(h.Value.GetString() ?? "", config));
                }
                if (test.TryGetProperty("body", out var bodyEl))
                    req.Content = new StringContent(bodyEl.GetRawText(), Encoding.UTF8, "application/json");

                ActivityLog.Log(Channel, $"[{index + 1}/{manifest.ApiTests.Count}] {method} {url}");
                using var resp = await http.SendAsync(req);
                string responseBody = await resp.Content.ReadAsStringAsync();

                var expect = test.TryGetProperty("expect", out var e) ? e : default;
                var (passed, detail) = EvaluateExpectation(expect, (int)resp.StatusCode, responseBody);

                sw.Stop();
                ActivityLog.Log(Channel, (passed ? "PASS " : "FAIL ") + $"{label} ({sw.ElapsedMilliseconds}ms) — {detail}");
                return new TestStepResult { Kind = "api", Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds };
            }
            catch (Exception ex)
            {
                sw.Stop();
                ActivityLog.Log(Channel, $"ERROR {label}: {ex.Message}");
                return new TestStepResult { Kind = "api", Label = label, Passed = false, Detail = ex.Message, DurationMs = sw.ElapsedMilliseconds };
            }
        }

        /// <summary>{{DEPLOY_URL}} -> the configured api base url (scripts/build-queue-watcher.config.json), {{SECRET_KEY}} -> its IngestToken — same "Shane's existing secret-key mechanism" #803's Auth section defers to, not a new credential store.</summary>
        private static string ResolvePlaceholders(string input, BuildTrackerConfig config) =>
            (input ?? "").Replace("{{DEPLOY_URL}}", config.ApiBaseUrl.TrimEnd('/')).Replace("{{SECRET_KEY}}", config.IngestToken);

        private static string BuildUrl(string baseUrl, string path)
        {
            if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return path;
            return baseUrl.TrimEnd('/') + "/" + path.TrimStart('/');
        }

        internal static (bool passed, string detail) EvaluateExpectation(JsonElement expect, int actualStatus, string responseBody)
        {
            if (expect.ValueKind != JsonValueKind.Object) return (true, "no expectations declared");

            var problems = new List<string>();

            if (expect.TryGetProperty("status", out var statusEl))
            {
                int expectedStatus = statusEl.GetInt32();
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
                    if (resolved != expectedExists)
                        problems.Add($"jsonPath {jsonPath} exists={resolved}, expected {expectedExists}");
                }

                if (expect.TryGetProperty("isArray", out var isArrayEl))
                {
                    bool expectedIsArray = isArrayEl.GetBoolean();
                    bool actualIsArray = resolved && found.ValueKind == JsonValueKind.Array;
                    if (actualIsArray != expectedIsArray)
                        problems.Add($"jsonPath {jsonPath} isArray={actualIsArray}, expected {expectedIsArray}");
                }

                if (expect.TryGetProperty("value", out var valueEl))
                {
                    if (!resolved)
                        problems.Add($"jsonPath {jsonPath} did not resolve, expected value {valueEl.GetRawText()}");
                    else if (!JsonElementValuesEqual(found, valueEl))
                        problems.Add($"jsonPath {jsonPath} = {found.GetRawText()}, expected {valueEl.GetRawText()}");
                }
            }

            return (problems.Count == 0, problems.Count == 0 ? "ok" : string.Join("; ", problems));
        }

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
