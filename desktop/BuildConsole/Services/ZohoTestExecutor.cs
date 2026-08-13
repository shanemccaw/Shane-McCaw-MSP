using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #881 (Epic #803) — executes manifest.ZohoTests: real HTTP calls against the
    /// api-server's Zoho admin READ routes, authenticated with the "Zoho API Token" saved
    /// in BuildConsoleSettings (#880). Covers the two read endpoints zohoTests target:
    ///   GET /zoho/crm/leads/lookup/by-email?email=...            (existing, #83)
    ///   GET /zoho/books/invoices/lookup/by-reference?reference=... (new this issue, #881)
    ///
    /// Each test asserts against its `expect` block via the SAME evaluator apiTests use
    /// (HttpTestExecutor.EvaluateExpectation) — status + jsonPath exists/value/isArray — so
    /// "lead found / not-found" and "invoice found / not-found" are just
    /// { jsonPath: "$.found", value: true|false } assertions; there is no bespoke Zoho
    /// shape logic here, the manifest declares what it expects the same way apiTests do.
    ///
    /// Plugs into RunManifestAsync (#806) at the same stable entry point apiTests/graphTests/
    /// uiSteps plug into, returning TestStepResult entries the caller folds into the ONE shared
    /// ManifestRunResult -> test-results/ pipeline (TestRunResult.cs) — never a separate output
    /// path. Every log line goes through ActivityLog with the "testing.zoho" channel, this
    /// app's logging spine (sibling to "testing.api-executor"/"testing.graph-executor").
    /// </summary>
    public static class ZohoTestExecutor
    {
        private const string Channel = "testing.zoho";

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

        /// <summary>Git #810 — raised after each zohoTest completes so the Test Results tab can render a telemetry card live, during the run, instead of waiting for the whole manifest to finish.</summary>
        public static event Action<TestStepResult>? StepCompleted;

        public static async Task<List<TestStepResult>> RunAsync(TestManifest manifest, BuildTrackerConfig config)
        {
            var results = new List<TestStepResult>();
            if (manifest.ZohoTests.Count == 0) return results;

            // The Zoho API Token (#880) is what authenticates these calls. Read it from the
            // same local BuildConsoleSettings store the GitHub PAT already lives in.
            var settings = BuildConsoleSettings.Load();

            for (int i = 0; i < manifest.ZohoTests.Count; i++)
            {
                var result = await RunOneAsync(manifest, config, settings, manifest.ZohoTests[i], i);
                results.Add(result);
                StepCompleted?.Invoke(result);
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(TestManifest manifest, BuildTrackerConfig config, BuildConsoleSettings settings, JsonElement test, int index)
        {
            var sw = Stopwatch.StartNew();
            string method = test.TryGetProperty("method", out var m) ? (m.GetString() ?? "GET") : "GET";
            string path = test.TryGetProperty("path", out var p) ? (p.GetString() ?? "") : "";
            string label = $"{method} {path}";
            // Git #803 (same gap as HttpTestExecutor) — `url` holds the real resolved request URL
            // (host and all) once built below; the live PASS/FAIL/ERROR log lines use it instead of
            // the relative-path-only `label` so a failure is diagnosable straight from the log.
            string url = path;

            // No Zoho API Token configured -> refuse the call outright and say so, rather than
            // firing an unauthenticated request that 401s and reads like a product bug. Same
            // honest "not configured" contract GraphTestExecutor uses when its test tenant is unset.
            if (!settings.HasZohoApiToken)
            {
                sw.Stop();
                ActivityLog.Log(Channel, $"REFUSED {label}: no Zoho API Token configured (set it in Settings — Git #880).");
                return new TestStepResult
                {
                    Kind = "zoho", Label = label, Passed = false,
                    Detail = "No Zoho API Token configured — set it in Settings (Git #880) before running zohoTests.",
                    DurationMs = sw.ElapsedMilliseconds,
                    Expected = "Zoho API Token configured in BuildConsoleSettings", Actual = "unset",
                    Context = $"{method} {path}",
                };
            }

            try
            {
                string baseUrl = string.IsNullOrWhiteSpace(manifest.BaseUrl) ? config.ApiBaseUrl : manifest.BaseUrl;
                url = BuildUrl(baseUrl, path);

                // Git #883 — an optional { "poll": { "intervalMs", "timeoutMs" } } block on a zohoTest
                // re-runs the SAME request/expect pair until it passes or the timeout elapses, instead
                // of firing once. Real for a reason: the thing being asserted (a lead/invoice landing in
                // Zoho) only exists after the next zoho_batch_drain, which runs on a 5-minute cadence
                // (zoho-batch-drain.ts), not synchronously with whatever created it.
                int intervalMs = 15000, timeoutMs = 0;
                bool isPoll = test.TryGetProperty("poll", out var pollEl) && pollEl.ValueKind == JsonValueKind.Object;
                if (isPoll)
                {
                    if (pollEl.TryGetProperty("intervalMs", out var ivEl) && ivEl.ValueKind == JsonValueKind.Number) intervalMs = ivEl.GetInt32();
                    if (pollEl.TryGetProperty("timeoutMs", out var toEl) && toEl.ValueKind == JsonValueKind.Number) timeoutMs = toEl.GetInt32();
                    else timeoutMs = 360000; // default 6 minutes — one drain cycle plus margin
                }

                var expect = test.TryGetProperty("expect", out var e) ? e : default;
                int attempt = 0;
                bool passed; string detail, expected, actual, context; int statusCode; string responseBody;

                while (true)
                {
                    attempt++;
                    using var req = new HttpRequestMessage(new HttpMethod(method), url);
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ZohoApiToken);
                    if (test.TryGetProperty("headers", out var headersEl) && headersEl.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var h in headersEl.EnumerateObject())
                            req.Headers.TryAddWithoutValidation(h.Name, h.Value.GetString() ?? "");
                    }
                    if (test.TryGetProperty("body", out var bodyEl))
                        req.Content = new StringContent(bodyEl.GetRawText(), Encoding.UTF8, "application/json");

                    ActivityLog.Log(Channel, $"[{index + 1}/{manifest.ZohoTests.Count}]{(isPoll ? $" (poll attempt {attempt})" : "")} {method} {url}");
                    using var resp = await Http.SendAsync(req);
                    responseBody = await resp.Content.ReadAsStringAsync();
                    statusCode = (int)resp.StatusCode;

                    (passed, detail, expected, actual) = HttpTestExecutor.EvaluateExpectation(expect, statusCode, responseBody);
                    context = $"{method} {url} -> {statusCode}; response body: {HttpTestExecutor.Truncate(responseBody, 500)}";

                    if (passed || !isPoll) break;
                    if (sw.ElapsedMilliseconds + intervalMs >= timeoutMs)
                    {
                        detail = $"{detail} (poll timed out after {attempt} attempt(s), {sw.ElapsedMilliseconds}ms)";
                        break;
                    }
                    await Task.Delay(intervalMs);
                }

                sw.Stop();
                string? durationError = HttpTestExecutor.CheckMaxDuration(test, sw.ElapsedMilliseconds);
                if (durationError != null)
                {
                    passed = false;
                    detail = string.IsNullOrEmpty(detail) || detail == "ok" ? durationError : $"{detail}; {durationError}";
                }

                ActivityLog.Log(Channel, (passed ? "PASS " : "FAIL ") + $"{method} {url} ({sw.ElapsedMilliseconds}ms, {attempt} attempt(s)) — {detail}");
                return new TestStepResult
                {
                    Kind = "zoho", Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds,
                    Expected = expected, Actual = actual, Context = context,
                };
            }
            catch (Exception ex)
            {
                sw.Stop();
                ActivityLog.Log(Channel, $"ERROR {method} {url}: {ex.Message}");
                return new TestStepResult
                {
                    Kind = "zoho", Label = label, Passed = false, Detail = ex.Message, DurationMs = sw.ElapsedMilliseconds,
                    Actual = $"{ex.GetType().Name}: {ex.Message}", Context = $"{method} {url}",
                };
            }
        }

        private static string BuildUrl(string baseUrl, string path)
        {
            if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return path;
            return (baseUrl ?? "").TrimEnd('/') + "/" + (path ?? "").TrimStart('/');
        }
    }
}
