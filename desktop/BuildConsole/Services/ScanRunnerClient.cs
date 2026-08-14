using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Drives the platform's REAL Copilot Readiness scan/assessment engine over HTTP, exactly the way
    /// the customer UI journey does — used by the <c>shaneapp://runScan</c> local protocol handler
    /// (<see cref="BuildConsole.MainWindow"/>.HandleShaneAppRunScanAsync) so a build session can
    /// exercise the scanning engine directly, without walking the full quiz → consent → scan → verdict
    /// UI. Git motivation (Shane): "if the agent could execute a scan on their own outside the UI path,
    /// they could help debug and make my scanning engine better."
    ///
    /// WHY HTTP (and not local, like <see cref="LocalSqlExecutor"/>):
    ///   The scan engine is <c>runDiagnostics()</c> in the deployed Node/TS api-server (real per-tenant
    ///   Graph reads via client-credentials), not anything BuildConsole can run in-process — unlike
    ///   executeSql's local Npgsql path or runTest's in-process RunManifestAsync. The ONLY way to run
    ///   the REAL engine is the SAME authenticated api-server route the product itself uses. So this is
    ///   a deliberate HTTP client that reuses the exact trigger — never a second scanning implementation.
    ///
    /// THE EXACT TRIGGER THE UI CALLS:
    ///   <c>POST /api/portal/assessment/debug-trigger-scan</c> — the platform's ONE scan trigger the
    ///   assessment UI (copilot-readiness.tsx Scene 0) posts. It is hard-gated server-side to
    ///   <c>tenants.is_testbed = true</c> (Git #965), inserts a pending <c>msp_diagnostic_runs</c> row,
    ///   returns <c>202 { runId }</c>, then fires <c>runDiagnostics()</c> fire-and-forget. A real
    ///   customer's scan instead fires from the consent callback; there is no other HTTP scan trigger.
    ///
    /// AUTH:
    ///   The whole <c>/api/portal/assessment/*</c> surface is guarded by <c>requireRole("Assessment")</c>,
    ///   which runs <c>requireAuth</c> → <c>jwt.verify</c>. BuildConsole's BUILD_TRACKER_INGEST_TOKEN is
    ///   an opaque static string, not a signed JWT, so it is rejected there (401) — and there is NO
    ///   ingest-token-reachable endpoint anywhere that runs a scan against a chosen tenant. So this does
    ///   the SAME thing the test manifests do: <see cref="LoginAsync"/> against the pre-provisioned
    ///   testbed Assessment account (the TEST_PORTAL_* Settings creds) to mint an Assessment-role JWT,
    ///   then uses THAT JWT for the trigger and the result reads. The ingest token stays reserved for the
    ///   /api/admin/* surfaces (e.g. the testbed-customers list the #965 gate reads).
    ///
    /// RESULT RETRIEVAL:
    ///   The trigger is fire-and-forget (minutes-scale, real Graph reads), so this POLLS
    ///   <c>GET /api/portal/diagnostics/runs/{runId}</c> (scoped to the caller's customer) to a terminal
    ///   status (completed / partial / failed), then reads <c>GET /api/portal/assessment/status</c> once
    ///   for the computed pillar/score/gate breakdown the UI renders. Both use the same Assessment JWT.
    /// </summary>
    public static class ScanRunnerClient
    {
        /// <summary>Terminal run statuses per the msp_diagnostic_runs status enum (pending/running are non-terminal).</summary>
        private static readonly HashSet<string> TerminalStatuses =
            new(StringComparer.OrdinalIgnoreCase) { "completed", "partial", "failed" };

        public sealed class LoginResult
        {
            public bool Ok { get; set; }
            public string? AccessToken { get; set; }
            /// <summary>The <c>customerId</c> claim (numeric tenants.id) decoded from the JWT, used to confirm the login matches the requested tenant. Null if it couldn't be decoded.</summary>
            public long? CustomerId { get; set; }
            public bool MfaRequired { get; set; }
            public string? Error { get; set; }
        }

        public sealed class TriggerResult
        {
            public bool Ok { get; set; }
            public string? RunId { get; set; }
            public int StatusCode { get; set; }
            public string? Error { get; set; }
        }

        public sealed class ScanRunResult
        {
            /// <summary>True when the run reached a NON-failed terminal status (completed/partial) within the deadline.</summary>
            public bool Ok { get; set; }
            /// <summary>Terminal status if reached; otherwise the last status seen before the deadline (or null if never read).</summary>
            public string? Status { get; set; }
            public bool TimedOut { get; set; }
            /// <summary>The full <c>{ run, findings[] }</c> body from the last successful runs/:runId read (detached clone, safe to serialize).</summary>
            public JsonElement? RunAndFindings { get; set; }
            public int PollCount { get; set; }
            public string? Error { get; set; }
        }

        private static HttpClient MakeClient(string apiBaseUrl)
        {
            var baseUrl = apiBaseUrl.TrimEnd('/') + "/";
            return new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(30) };
        }

        /// <summary>
        /// Logs in as the testbed Assessment account (POST /api/auth/login) and returns the access
        /// token + the customerId claim decoded from it. Never throws — a transport/parse failure comes
        /// back as <c>Ok=false</c> with a human-readable reason.
        /// </summary>
        public static async Task<LoginResult> LoginAsync(string apiBaseUrl, string email, string password, CancellationToken ct = default)
        {
            using var http = MakeClient(apiBaseUrl);
            HttpResponseMessage resp;
            try
            {
                resp = await http.PostAsJsonAsync("api/auth/login", new { email, password }, ct);
            }
            catch (Exception ex)
            {
                return new LoginResult { Ok = false, Error = $"login request failed: {ex.Message}" };
            }

            string body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                return new LoginResult { Ok = false, Error = $"login HTTP {(int)resp.StatusCode}: {Truncate(body, 300)}" };

            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.TryGetProperty("mfaRequired", out var mfa) && mfa.ValueKind == JsonValueKind.True)
                    return new LoginResult { Ok = false, MfaRequired = true, Error = "the testbed account has MFA enrolled — runScan needs a non-MFA testbed Assessment account" };
                if (!root.TryGetProperty("accessToken", out var tokEl) || tokEl.ValueKind != JsonValueKind.String)
                    return new LoginResult { Ok = false, Error = "login response had no accessToken (unexpected shape)" };

                string token = tokEl.GetString() ?? "";
                if (string.IsNullOrWhiteSpace(token))
                    return new LoginResult { Ok = false, Error = "login returned an empty accessToken" };

                return new LoginResult { Ok = true, AccessToken = token, CustomerId = TryReadCustomerIdFromJwt(token) };
            }
            catch (Exception ex)
            {
                return new LoginResult { Ok = false, Error = $"couldn't parse login response: {ex.Message}" };
            }
        }

        /// <summary>
        /// POSTs the platform's ONE scan trigger. The route reads no request body (identity + target
        /// come from the JWT's customerId claim and the server-side isTestbed gate), so a well-formed
        /// empty JSON body is sent. Expects <c>202 { runId }</c>; a 403 here is the server-side #965
        /// isTestbed gate firing (a second belt behind BuildConsole's own <see cref="TestbedGate"/> check).
        /// </summary>
        public static async Task<TriggerResult> TriggerScanAsync(string apiBaseUrl, string accessToken, CancellationToken ct = default)
        {
            using var http = MakeClient(apiBaseUrl);
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            HttpResponseMessage resp;
            try
            {
                resp = await http.PostAsync("api/portal/assessment/debug-trigger-scan",
                    new StringContent("{}", Encoding.UTF8, "application/json"), ct);
            }
            catch (Exception ex)
            {
                return new TriggerResult { Ok = false, Error = $"trigger request failed: {ex.Message}" };
            }

            string body = await resp.Content.ReadAsStringAsync(ct);
            int code = (int)resp.StatusCode;
            if (!resp.IsSuccessStatusCode)
                return new TriggerResult { Ok = false, StatusCode = code, Error = $"trigger HTTP {code}: {Truncate(body, 300)}" };

            try
            {
                using var doc = JsonDocument.Parse(body);
                string? runId = doc.RootElement.TryGetProperty("runId", out var r) && r.ValueKind == JsonValueKind.String
                    ? r.GetString() : null;
                if (string.IsNullOrWhiteSpace(runId))
                    return new TriggerResult { Ok = false, StatusCode = code, Error = $"trigger returned no runId (body: {Truncate(body, 200)})" };
                return new TriggerResult { Ok = true, StatusCode = code, RunId = runId };
            }
            catch (Exception ex)
            {
                return new TriggerResult { Ok = false, StatusCode = code, Error = $"couldn't parse trigger response: {ex.Message}" };
            }
        }

        /// <summary>
        /// Polls <c>GET /api/portal/diagnostics/runs/{runId}</c> (scoped to the caller's customer) until
        /// the run reaches a terminal status or <paramref name="timeout"/> elapses. Returns the full
        /// <c>{ run, findings[] }</c> body from the last successful read. <paramref name="onProgress"/>
        /// (status, pollNumber) lets the caller log progress on its own channel. Never throws — a
        /// per-poll transport error is reported via onProgress and retried until the deadline.
        /// </summary>
        public static async Task<ScanRunResult> PollRunToTerminalAsync(
            string apiBaseUrl, string accessToken, string runId,
            TimeSpan timeout, TimeSpan pollInterval,
            Action<string, int>? onProgress = null, CancellationToken ct = default)
        {
            using var http = MakeClient(apiBaseUrl);
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var sw = Stopwatch.StartNew();
            int poll = 0;
            string? lastStatus = null;
            JsonElement? lastPayload = null;

            while (sw.Elapsed < timeout)
            {
                poll++;
                try
                {
                    var resp = await http.GetAsync($"api/portal/diagnostics/runs/{Uri.EscapeDataString(runId)}", ct);
                    string body = await resp.Content.ReadAsStringAsync(ct);
                    if (resp.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(body);
                        var root = doc.RootElement;
                        lastPayload = root.Clone(); // detached — safe to keep past the JsonDocument's lifetime
                        if (root.TryGetProperty("run", out var runEl) && runEl.ValueKind == JsonValueKind.Object
                            && runEl.TryGetProperty("status", out var st) && st.ValueKind == JsonValueKind.String)
                        {
                            lastStatus = st.GetString();
                            onProgress?.Invoke(lastStatus ?? "(null)", poll);
                            if (lastStatus != null && TerminalStatuses.Contains(lastStatus))
                            {
                                return new ScanRunResult
                                {
                                    Ok = !string.Equals(lastStatus, "failed", StringComparison.OrdinalIgnoreCase),
                                    Status = lastStatus,
                                    RunAndFindings = lastPayload,
                                    PollCount = poll,
                                    Error = string.Equals(lastStatus, "failed", StringComparison.OrdinalIgnoreCase)
                                        ? "the scan run reached a 'failed' terminal status" : null,
                                };
                            }
                        }
                        else
                        {
                            onProgress?.Invoke("(no run.status in response)", poll);
                        }
                    }
                    else
                    {
                        onProgress?.Invoke($"poll HTTP {(int)resp.StatusCode}", poll);
                    }
                }
                catch (Exception ex)
                {
                    onProgress?.Invoke($"poll error: {ex.Message}", poll);
                }

                await Task.Delay(pollInterval, ct);
            }

            return new ScanRunResult
            {
                Ok = false,
                TimedOut = true,
                Status = lastStatus,
                RunAndFindings = lastPayload,
                PollCount = poll,
                Error = $"scan did not reach a terminal status within {(int)timeout.TotalSeconds}s (last status: {lastStatus ?? "unknown"}). " +
                        "The run may still be executing server-side — re-check GET /api/portal/assessment/status or the runId later.",
            };
        }

        /// <summary>
        /// Reads <c>GET /api/portal/assessment/status</c> once (the computed radar/pillars, stats,
        /// copilotReadiness sub-indicators, and copilotGate go/no-go verdict the UI renders) as a
        /// detached JsonElement. Returns null on any failure — the run + findings are still the
        /// authoritative result; this is the richer computed overlay on top.
        /// </summary>
        public static async Task<JsonElement?> GetAssessmentStatusAsync(string apiBaseUrl, string accessToken, CancellationToken ct = default)
        {
            using var http = MakeClient(apiBaseUrl);
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            try
            {
                var resp = await http.GetAsync("api/portal/assessment/status", ct);
                if (!resp.IsSuccessStatusCode) return null;
                string body = await resp.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(body);
                return doc.RootElement.Clone();
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Decodes the <c>customerId</c> claim (numeric tenants.id) from a JWT's payload segment without
        /// verifying the signature (we only just received it over TLS from our own api-server; we read it
        /// solely to confirm the login lands on the tenant the caller asked to scan). Returns null if the
        /// token is malformed or has no numeric customerId.
        /// </summary>
        private static long? TryReadCustomerIdFromJwt(string jwt)
        {
            try
            {
                var parts = jwt.Split('.');
                if (parts.Length < 2) return null;
                string payload = parts[1].Replace('-', '+').Replace('_', '/');
                switch (payload.Length % 4)
                {
                    case 2: payload += "=="; break;
                    case 3: payload += "="; break;
                }
                var bytes = Convert.FromBase64String(payload);
                using var doc = JsonDocument.Parse(bytes);
                if (doc.RootElement.TryGetProperty("customerId", out var cid))
                {
                    if (cid.ValueKind == JsonValueKind.Number && cid.TryGetInt64(out var n)) return n;
                    if (cid.ValueKind == JsonValueKind.String && long.TryParse(cid.GetString(), out var s)) return s;
                }
                return null;
            }
            catch
            {
                return null;
            }
        }

        private static string Truncate(string s, int max) =>
            string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s.Substring(0, max) + "…");
    }
}
