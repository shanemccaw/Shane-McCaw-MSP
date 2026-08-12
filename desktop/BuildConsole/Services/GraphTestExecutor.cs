using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #808 (Epic #803 Phase 4) — executes manifest.GraphTests: real HTTP calls against
    /// Microsoft Graph, authenticated via the `authProfile` each test references (per #803's
    /// issue body and artifacts/api-server/src/lib/graph.ts's three client-credentials profiles):
    ///   "MT_APP_CLIENT_ID"       -> multi-tenant READ app  (env MT_APP_CLIENT_ID/_SECRET)
    ///   "MT_APP_WRITE_CLIENT_ID" -> multi-tenant WRITE app (env MT_APP_WRITE_CLIENT_ID/_SECRET)
    ///   "ba40ca4d"               -> internal single-tenant app (env GRAPH_CLIENT_ID/_SECRET/_TENANT_ID),
    ///                               mirroring graph.ts's getAccessToken()
    ///
    /// Hard tenant guard: this is a dev/regression tool that verifies Claude's own Graph
    /// integration code, NOT product-facing assessment logic — it must never call Graph
    /// against a real customer tenant. GRAPH_TEST_TENANT_ID (env) is the single source of
    /// truth; every test's `tenant` field is resolved and checked against it before any
    /// HTTP call is made, regardless of what the manifest file itself claims. A mismatch
    /// (or an unset GRAPH_TEST_TENANT_ID) refuses the call outright.
    ///
    /// Plugs into RunManifestAsync (#806) at the same stable entry point #807 (apiTests) and
    /// #809 (uiSteps) plug into, returning TestStepResult entries for the caller to fold into
    /// the one shared ManifestRunResult -> test-results/ pipeline (see TestRunResult.cs) —
    /// never a separate output path for graphTests.
    ///
    /// Every log line goes through ActivityLog with the "testing.graph-executor" channel —
    /// this app's module-level logging binding (ActivityLog.Log(channel, message) is this
    /// app's logging spine; see Services/ActivityLog.cs and the sibling "testing.api-executor"
    /// channel HttpTestExecutor uses).
    /// </summary>
    public static class GraphTestExecutor
    {
        private const string Channel = "testing.graph-executor";
        private const string TenantPlaceholder = "{{TEST_TENANT_ID}}";

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        private static readonly Dictionary<string, (string token, DateTime expiresAtUtc)> TokenCache = new();

        public static async Task<List<TestStepResult>> RunAsync(TestManifest manifest)
        {
            var results = new List<TestStepResult>();
            if (manifest.GraphTests.Count == 0) return results;

            for (int i = 0; i < manifest.GraphTests.Count; i++)
            {
                results.Add(await RunOneAsync(manifest.GraphTests[i], i, manifest.GraphTests.Count));
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(JsonElement test, int index, int total)
        {
            var sw = Stopwatch.StartNew();
            string method = GetString(test, "method") ?? "GET";
            string path = GetString(test, "path") ?? "";
            string authProfile = GetString(test, "authProfile") ?? "";
            string manifestTenant = GetString(test, "tenant") ?? "";
            string label = $"{method} {path}";

            try
            {
                // ── Hard guard (never remove): this executor only ever targets the ONE
                // designated test tenant. The manifest's own `tenant` field is resolved
                // and cross-checked against GRAPH_TEST_TENANT_ID before any Graph call is
                // sent — a manifest can never point this dev tool at a real customer tenant,
                // even if hand-edited or generated wrong.
                string testTenantId = Environment.GetEnvironmentVariable("GRAPH_TEST_TENANT_ID") ?? "";
                if (string.IsNullOrWhiteSpace(testTenantId))
                {
                    return Finish(Channel, "graph", label, sw,
                        passed: false,
                        detail: "GRAPH_TEST_TENANT_ID not configured — refusing to run any graphTests without a designated test tenant.");
                }

                string resolvedTenant = manifestTenant == TenantPlaceholder ? testTenantId : manifestTenant;
                if (!string.Equals(resolvedTenant, testTenantId, StringComparison.OrdinalIgnoreCase))
                {
                    ActivityLog.Log(Channel, $"REFUSED [{index + 1}/{total}] {label}: tenant '{manifestTenant}' != configured test tenant — no Graph call made.");
                    return Finish(Channel, "graph", label, sw,
                        passed: false,
                        detail: $"tenant guard: manifest tenant '{manifestTenant}' does not resolve to the configured TEST tenant. Refusing to call Graph — this dev/regression tool never targets a real customer tenant.");
                }

                var (clientId, clientSecret, fixedTenantId) = ResolveAuthProfile(authProfile);
                if (clientId == null || clientSecret == null)
                {
                    return Finish(Channel, "graph", label, sw,
                        passed: false,
                        detail: $"authProfile '{authProfile}' not recognized, or its credentials are not configured in environment variables.");
                }

                // "ba40ca4d" (internal single-tenant app) has its own fixed tenant; still only
                // reachable here because it was already asserted equal to GRAPH_TEST_TENANT_ID above.
                string tokenTenant = fixedTenantId ?? resolvedTenant;
                string token = await GetTokenAsync(authProfile, tokenTenant, clientId, clientSecret);

                ActivityLog.Log(Channel, $"[{index + 1}/{total}] {method} {path} (authProfile={authProfile}, tenant={resolvedTenant})");

                using var req = new HttpRequestMessage(new HttpMethod(method), path);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                if (test.TryGetProperty("body", out var bodyEl))
                    req.Content = new StringContent(bodyEl.GetRawText(), Encoding.UTF8, "application/json");

                using var res = await Http.SendAsync(req);
                string responseBody = await res.Content.ReadAsStringAsync();

                var expect = test.TryGetProperty("expect", out var e) ? e : default;
                var (passed, detail) = HttpTestExecutor.EvaluateExpectation(expect, (int)res.StatusCode, responseBody);

                return Finish(Channel, "graph", label, sw, passed, detail);
            }
            catch (Exception ex)
            {
                return Finish(Channel, "graph", label, sw, passed: false, detail: ex.Message);
            }
        }

        // ── Auth profiles ────────────────────────────────────────────────────
        private static (string? clientId, string? clientSecret, string? fixedTenantId) ResolveAuthProfile(string authProfile) => authProfile switch
        {
            "MT_APP_CLIENT_ID" => (
                Environment.GetEnvironmentVariable("MT_APP_CLIENT_ID"),
                Environment.GetEnvironmentVariable("MT_APP_CLIENT_SECRET"),
                null),
            "MT_APP_WRITE_CLIENT_ID" => (
                Environment.GetEnvironmentVariable("MT_APP_WRITE_CLIENT_ID"),
                Environment.GetEnvironmentVariable("MT_APP_WRITE_CLIENT_SECRET"),
                null),
            "ba40ca4d" => (
                Environment.GetEnvironmentVariable("GRAPH_CLIENT_ID"),
                Environment.GetEnvironmentVariable("GRAPH_CLIENT_SECRET"),
                Environment.GetEnvironmentVariable("GRAPH_TENANT_ID")),
            _ => (null, null, null),
        };

        private static async Task<string> GetTokenAsync(string authProfile, string tenantId, string clientId, string clientSecret)
        {
            string cacheKey = $"{authProfile}|{tenantId}";
            if (TokenCache.TryGetValue(cacheKey, out var cached) && DateTime.UtcNow < cached.expiresAtUtc.AddMinutes(-1))
                return cached.token;

            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = clientId,
                ["client_secret"] = clientSecret,
                ["scope"] = "https://graph.microsoft.com/.default",
            };

            using var res = await Http.PostAsync(
                $"https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token",
                new FormUrlEncodedContent(form));
            string body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
                throw new HttpRequestException($"Graph token fetch failed for authProfile '{authProfile}': {(int)res.StatusCode} {Truncate(body)}");

            using var doc = JsonDocument.Parse(body);
            string token = doc.RootElement.TryGetProperty("access_token", out var t) ? (t.GetString() ?? "") : "";
            if (string.IsNullOrEmpty(token))
                throw new HttpRequestException("Graph token response missing access_token");
            int expiresIn = doc.RootElement.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 3600;

            TokenCache[cacheKey] = (token, DateTime.UtcNow.AddSeconds(expiresIn));
            return token;
        }

        private static string? GetString(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static string Truncate(string s) => s.Length > 300 ? s.Substring(0, 300) + "..." : s;

        private static TestStepResult Finish(string channel, string kind, string label, Stopwatch sw, bool passed, string detail)
        {
            sw.Stop();
            ActivityLog.Log(channel, (passed ? "PASS " : "FAIL ") + $"{label} ({sw.ElapsedMilliseconds}ms) - {detail}");
            return new TestStepResult { Kind = kind, Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds };
        }
    }
}
