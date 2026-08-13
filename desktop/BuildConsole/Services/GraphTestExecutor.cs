using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
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
    /// Git #878 (Epic #803) — a graphTests entry that carries a `mailbox` field is a MAIL POLL
    /// step instead of a one-shot Graph HTTP call: it polls GET /users/{mailbox}/messages against
    /// a designated TEST mailbox (env GRAPH_TEST_MAILBOX_ID, referenced as {{TEST_MAILBOX_ID}}),
    /// waiting up to `timeoutMs` for a NEW email (received since the poll started) whose subject
    /// (`matchSubject`) and optional sender (`matchFrom`) match, then hands that message's body to
    /// the step's own #877 `extract` block — this is what makes the #437 "send code -> read the
    /// real delivered email -> extract the 6-digit code -> feed verify-code" flow, and any future
    /// email-delivery regression test, possible. The mailbox always lives inside the one designated
    /// test tenant: the app-only token is minted for GRAPH_TEST_TENANT_ID (same hard guard as every
    /// other graphTest), so this can never read a real customer inbox. Mail-poll steps log on the
    /// dedicated "testing.graph-mail" channel; ordinary graph HTTP steps stay on
    /// "testing.graph-executor".
    ///
    /// Plugs into RunManifestAsync (#806) at the same stable entry point #807 (apiTests) and
    /// #809 (uiSteps) plug into, returning TestStepResult entries for the caller to fold into
    /// the one shared ManifestRunResult -> test-results/ pipeline (see TestRunResult.cs) —
    /// never a separate output path for graphTests.
    ///
    /// Every log line goes through ActivityLog with this app's module-level logging binding
    /// (ActivityLog.Log(channel, message) is this app's logging spine; see Services/ActivityLog.cs
    /// and the sibling "testing.api-executor" channel HttpTestExecutor uses).
    /// </summary>
    public static class GraphTestExecutor
    {
        private const string Channel = "testing.graph-executor";
        private const string MailChannel = "testing.graph-mail";
        private const string TenantPlaceholder = "{{TEST_TENANT_ID}}";
        private const string MailboxPlaceholder = "{{TEST_MAILBOX_ID}}";

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        private static readonly Dictionary<string, (string token, DateTime expiresAtUtc)> TokenCache = new();

        /// <summary>Git #810 — raised after each graphTest completes so the Test Results tab can render a telemetry card live, during the run, instead of waiting for the whole manifest to finish.</summary>
        public static event Action<TestStepResult>? StepCompleted;

        public static async Task<List<TestStepResult>> RunAsync(TestManifest manifest, TestRunVariables vars)
        {
            var results = new List<TestStepResult>();
            if (manifest.GraphTests.Count == 0) return results;

            for (int i = 0; i < manifest.GraphTests.Count; i++)
            {
                var result = await RunOneAsync(vars, manifest.GraphTests[i], i, manifest.GraphTests.Count);
                results.Add(result);
                StepCompleted?.Invoke(result);
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(TestRunVariables vars, JsonElement test, int index, int total)
        {
            // Git #878 — a `mailbox` field routes this step to the mail-delivery poller instead of
            // a one-shot Graph HTTP call. Everything else about the entry (authProfile, tenant,
            // extract) works the same way.
            if (test.TryGetProperty("mailbox", out _))
                return await RunMailPollAsync(vars, test, index, total);

            var sw = Stopwatch.StartNew();
            string method = GetString(test, "method") ?? "GET";
            string path = GetString(test, "path") ?? "";
            string authProfile = GetString(test, "authProfile") ?? "";
            string manifestTenant = GetString(test, "tenant") ?? "";
            string label = $"{method} {path}";

            try
            {
                // Shared preflight: hard test-tenant guard + authProfile credential resolution +
                // token fetch. Returns a ready-made failure TestStepResult (already logged) on any
                // refusal/misconfig, so nothing here can point this dev tool at a real customer tenant.
                var auth = await AuthorizeAsync(Channel, authProfile, manifestTenant, label, index, total, sw);
                if (!auth.ok) return auth.fail!;
                string token = auth.token;
                string resolvedTenant = auth.resolvedTenant;

                // #877 — cross-step {{variable}} interpolation against values earlier steps
                // extracted. An unresolved {{name}} throws (caught below) rather than sending the
                // literal placeholder. The tenant guard above already ran against the manifest's
                // own `tenant` field, so interpolation here only touches the request url/body.
                string resolvedPath = vars.Resolve(path);
                ActivityLog.Log(Channel, $"[{index + 1}/{total}] {method} {resolvedPath} (authProfile={authProfile}, tenant={resolvedTenant})");

                using var req = new HttpRequestMessage(new HttpMethod(method), resolvedPath);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                if (test.TryGetProperty("body", out var bodyEl))
                    req.Content = new StringContent(vars.Resolve(bodyEl.GetRawText()), Encoding.UTF8, "application/json");

                using var res = await Http.SendAsync(req);
                string responseBody = await res.Content.ReadAsStringAsync();

                var expect = test.TryGetProperty("expect", out var e) ? e : default;
                var (passed, detail, expected, actual) = HttpTestExecutor.EvaluateExpectation(expect, (int)res.StatusCode, responseBody);

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

                string context = $"{method} {resolvedPath} (authProfile={authProfile}, tenant={resolvedTenant}) -> {(int)res.StatusCode}; response body: {Truncate(responseBody)}";

                sw.Stop();
                string? durationError = HttpTestExecutor.CheckMaxDuration(test, sw.ElapsedMilliseconds);
                if (durationError != null)
                {
                    passed = false;
                    detail = string.IsNullOrEmpty(detail) || detail == "ok" ? durationError : $"{detail}; {durationError}";
                }

                return Finish(Channel, "graph", label, sw, passed, detail, expected, actual, context);
            }
            catch (Exception ex)
            {
                return Finish(Channel, "graph", label, sw, passed: false, detail: ex.Message,
                    actual: $"{ex.GetType().Name}: {ex.Message}", context: $"{method} {path} (authProfile={authProfile}, tenant={manifestTenant})");
            }
        }

        // ── Git #878: Mail.Read delivery poll ────────────────────────────────
        /// <summary>
        /// Polls GET /users/{mailbox}/messages for a designated TEST mailbox until a NEW email
        /// (received since this step started) matches `matchSubject` (case-insensitive substring)
        /// and, if given, `matchFrom` (case-insensitive substring against the sender address),
        /// within `timeoutMs`. On match, the matched message's body is passed to the step's own
        /// #877 `extract` block (so a regex like \d{6} pulls the delivered verification code out).
        ///
        /// Auth is the SAME authProfile + hard test-tenant guard every other graphTest uses (app-only
        /// client-credentials for GRAPH_TEST_TENANT_ID), so the polled mailbox can only ever be one
        /// inside the designated test tenant — never a real customer inbox. `{{TEST_MAILBOX_ID}}`
        /// resolves from the GRAPH_TEST_MAILBOX_ID env var; a literal mailbox (UPN or object id) is
        /// also accepted. Delegated /me/messages is not used — none of the three authProfiles is a
        /// delegated flow.
        /// </summary>
        private static async Task<TestStepResult> RunMailPollAsync(TestRunVariables vars, JsonElement test, int index, int total)
        {
            var sw = Stopwatch.StartNew();
            string authProfile = GetString(test, "authProfile") ?? "";
            // Mail-poll steps default to the designated test tenant when none is named (the hard
            // guard below still enforces it), since a mailbox is always inside that one tenant.
            string manifestTenant = GetString(test, "tenant") ?? TenantPlaceholder;
            string rawMailbox = GetString(test, "mailbox") ?? "";
            string matchSubject = GetString(test, "matchSubject") ?? "";
            string matchFrom = GetString(test, "matchFrom") ?? "";
            int timeoutMs = GetInt(test, "timeoutMs") ?? 60000;
            int pollIntervalMs = Math.Max(1000, GetInt(test, "pollIntervalMs") ?? 3000);
            string label = "MAIL poll " + rawMailbox + (string.IsNullOrEmpty(matchSubject) ? "" : $" subject~\"{matchSubject}\"");

            try
            {
                // Resolve the mailbox: {{TEST_MAILBOX_ID}} -> GRAPH_TEST_MAILBOX_ID (single source of
                // truth for the one designated test mailbox), then #877 {{variable}} interpolation in
                // case it references a value an earlier step extracted.
                string mailbox = rawMailbox == MailboxPlaceholder
                    ? (Environment.GetEnvironmentVariable("GRAPH_TEST_MAILBOX_ID") ?? "")
                    : rawMailbox;
                if (rawMailbox == MailboxPlaceholder && string.IsNullOrWhiteSpace(mailbox))
                    return Finish(MailChannel, "graph", label, sw, false,
                        "GRAPH_TEST_MAILBOX_ID not configured — {{TEST_MAILBOX_ID}} has no designated test mailbox to poll.",
                        "GRAPH_TEST_MAILBOX_ID env var set", "unset", $"authProfile={authProfile}");
                mailbox = vars.Resolve(mailbox);
                if (string.IsNullOrWhiteSpace(mailbox))
                    return Finish(MailChannel, "graph", label, sw, false,
                        "no mailbox specified for the mail poll.", "mailbox set", "empty", $"authProfile={authProfile}");

                // Match criteria may also reference earlier-extracted values.
                matchSubject = vars.Resolve(matchSubject);
                matchFrom = vars.Resolve(matchFrom);

                // matchSince: "now"/absent -> the instant this step began polling (so only genuinely
                // NEW mail matches, never a stale prior code email); otherwise an ISO-8601 timestamp.
                DateTimeOffset since = ParseSince(GetString(test, "matchSince") ?? "now", out string sinceNote);

                // Same hard test-tenant guard + auth as every other graphTest.
                var auth = await AuthorizeAsync(MailChannel, authProfile, manifestTenant, label, index, total, sw);
                if (!auth.ok) return auth.fail!;

                string url = $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(mailbox)}/messages"
                    + "?$select=id,subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime%20desc&$top=25";

                ActivityLog.Log(MailChannel,
                    $"[{index + 1}/{total}] polling {mailbox} for subject~\"{matchSubject}\""
                    + (string.IsNullOrEmpty(matchFrom) ? "" : $", from~\"{matchFrom}\"")
                    + $" received since {since:o}{sinceNote} — timeout {timeoutMs}ms, every {pollIntervalMs}ms.");

                int attempt = 0;
                while (true)
                {
                    attempt++;
                    using var req = new HttpRequestMessage(HttpMethod.Get, url);
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth.token);
                    // Ask Graph for the plain-text body so a code regex isn't split by HTML markup.
                    req.Headers.TryAddWithoutValidation("Prefer", "outlook.body-content-type=\"text\"");

                    using var res = await Http.SendAsync(req);
                    string responseBody = await res.Content.ReadAsStringAsync();

                    if (!res.IsSuccessStatusCode)
                    {
                        int code = (int)res.StatusCode;
                        string hint = code == 403 || code == 401
                            ? " — the app registration behind this authProfile most likely lacks the Mail.Read APPLICATION permission (admin-consented) for the test tenant."
                            : code == 404 ? " — mailbox not found in the test tenant." : "";
                        return Finish(MailChannel, "graph", label, sw, false,
                            $"Graph returned {code} polling {mailbox}'s messages{hint}",
                            "200 with a messages list", $"{code}",
                            $"GET {url} -> {Truncate(responseBody)}");
                    }

                    if (TryMatchMessage(responseBody, matchSubject, matchFrom, since,
                            out string matchedBody, out string matchedSubject, out string matchedFrom, out string matchedReceived))
                    {
                        ActivityLog.Log(MailChannel,
                            $"MATCH after {attempt} poll(s): \"{matchedSubject}\" from {matchedFrom} received {matchedReceived} — {matchedBody.Length}-char body now available to extract.");

                        string detail = $"matched email \"{matchedSubject}\" from {matchedFrom} received {matchedReceived}";
                        bool passed = true;

                        // #877 — the matched message BODY is what this step's extract runs against,
                        // so { "as": "code", "regex": "\\d{6}" } pulls the value straight out of the
                        // real delivered email for a later verify-code step to interpolate.
                        if (test.TryGetProperty("extract", out var extractEl) && extractEl.ValueKind == JsonValueKind.Object)
                        {
                            string? extractError = vars.Extract(extractEl, matchedBody);
                            if (extractError != null) { passed = false; detail = $"{detail}; {extractError}"; }
                        }

                        string? durationError = HttpTestExecutor.CheckMaxDuration(test, sw.ElapsedMilliseconds);
                        if (durationError != null)
                        {
                            passed = false;
                            detail = $"{detail}; {durationError}";
                        }

                        return Finish(MailChannel, "graph", label, sw, passed, detail,
                            $"email matching subject~\"{matchSubject}\"", $"matched \"{matchedSubject}\"",
                            $"mailbox={mailbox}, from={matchedFrom}, received={matchedReceived}, body: {Truncate(matchedBody)}");
                    }

                    // Stop before sleeping past the deadline — one final poll counts, then give up.
                    if (sw.ElapsedMilliseconds + pollIntervalMs >= timeoutMs)
                    {
                        return Finish(MailChannel, "graph", label, sw, false,
                            $"no email matching subject~\"{matchSubject}\""
                            + (string.IsNullOrEmpty(matchFrom) ? "" : $" / from~\"{matchFrom}\"")
                            + $" arrived in {mailbox} within {timeoutMs}ms ({attempt} poll(s)).",
                            $"an email matching subject~\"{matchSubject}\" within {timeoutMs}ms", "none arrived",
                            $"mailbox={mailbox}, since={since:o}");
                    }

                    await Task.Delay(pollIntervalMs);
                }
            }
            catch (Exception ex)
            {
                return Finish(MailChannel, "graph", label, sw, passed: false, detail: ex.Message,
                    actual: $"{ex.GetType().Name}: {ex.Message}",
                    context: $"MAIL poll {rawMailbox} (authProfile={authProfile}, tenant={manifestTenant})");
            }
        }

        /// <summary>
        /// Scans a Graph /messages response (newest-first) for the first message whose subject and
        /// optional sender match and which was received at/after <paramref name="since"/>. On a hit,
        /// returns its plain-text body (falling back to bodyPreview) plus subject/from/received for
        /// logging. Returns false on non-JSON/empty responses or no match.
        /// </summary>
        private static bool TryMatchMessage(string responseBody, string matchSubject, string matchFrom, DateTimeOffset since,
            out string body, out string subject, out string from, out string received)
        {
            body = subject = from = received = "";
            JsonDocument doc;
            try { doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(responseBody) ? "{}" : responseBody); }
            catch (JsonException) { return false; }
            using (doc)
            {
                if (!doc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
                    return false;

                foreach (var msg in value.EnumerateArray())
                {
                    string s = msg.TryGetProperty("subject", out var se) && se.ValueKind == JsonValueKind.String ? (se.GetString() ?? "") : "";
                    string f = "";
                    if (msg.TryGetProperty("from", out var fe) && fe.ValueKind == JsonValueKind.Object
                        && fe.TryGetProperty("emailAddress", out var ea) && ea.ValueKind == JsonValueKind.Object
                        && ea.TryGetProperty("address", out var addr) && addr.ValueKind == JsonValueKind.String)
                        f = addr.GetString() ?? "";
                    string r = msg.TryGetProperty("receivedDateTime", out var re) && re.ValueKind == JsonValueKind.String ? (re.GetString() ?? "") : "";

                    if (!string.IsNullOrEmpty(matchSubject) && s.IndexOf(matchSubject, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (!string.IsNullOrEmpty(matchFrom) && f.IndexOf(matchFrom, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    if (!string.IsNullOrEmpty(r)
                        && DateTimeOffset.TryParse(r, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var rdt)
                        && rdt < since) continue;

                    string b = "";
                    if (msg.TryGetProperty("body", out var be) && be.ValueKind == JsonValueKind.Object
                        && be.TryGetProperty("content", out var bc) && bc.ValueKind == JsonValueKind.String)
                        b = bc.GetString() ?? "";
                    if (string.IsNullOrEmpty(b) && msg.TryGetProperty("bodyPreview", out var bp) && bp.ValueKind == JsonValueKind.String)
                        b = bp.GetString() ?? "";

                    body = b; subject = s; from = f; received = r;
                    return true;
                }
            }
            return false;
        }

        /// <summary>"now"/empty -> the current instant (only mail newer than this matches); otherwise
        /// an ISO-8601 timestamp. An unparseable value falls back to now, noted for the log line.</summary>
        private static DateTimeOffset ParseSince(string raw, out string note)
        {
            note = "";
            if (string.IsNullOrWhiteSpace(raw) || string.Equals(raw, "now", StringComparison.OrdinalIgnoreCase))
                return DateTimeOffset.UtcNow;
            if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
                return parsed;
            note = $" (unparseable matchSince \"{raw}\", using now)";
            return DateTimeOffset.UtcNow;
        }

        // ── Auth (shared by HTTP graph calls and mail polls) ─────────────────
        /// <summary>
        /// Shared preflight for every graphTest: enforces the hard test-tenant guard, resolves the
        /// authProfile's client-credentials, and fetches (cached) an app-only token. On any refusal
        /// or misconfiguration returns <c>ok:false</c> with a ready-made, already-logged failure
        /// TestStepResult the caller returns directly; on success returns the bearer token and the
        /// resolved tenant. Nothing downstream can ever point this dev tool at a real customer tenant.
        /// </summary>
        private static async Task<(bool ok, TestStepResult? fail, string token, string resolvedTenant)> AuthorizeAsync(
            string channel, string authProfile, string manifestTenant, string label, int index, int total, Stopwatch sw)
        {
            string testTenantId = Environment.GetEnvironmentVariable("GRAPH_TEST_TENANT_ID") ?? "";
            if (string.IsNullOrWhiteSpace(testTenantId))
                return (false, Finish(channel, "graph", label, sw, false,
                    "GRAPH_TEST_TENANT_ID not configured — refusing to run any graphTests without a designated test tenant.",
                    "GRAPH_TEST_TENANT_ID env var set", "unset",
                    $"authProfile={authProfile}, manifest tenant={manifestTenant}"), "", "");

            string resolvedTenant = manifestTenant == TenantPlaceholder ? testTenantId : manifestTenant;
            if (!string.Equals(resolvedTenant, testTenantId, StringComparison.OrdinalIgnoreCase))
            {
                ActivityLog.Log(channel, $"REFUSED [{index + 1}/{total}] {label}: tenant '{manifestTenant}' != configured test tenant — no Graph call made.");
                return (false, Finish(channel, "graph", label, sw, false,
                    $"tenant guard: manifest tenant '{manifestTenant}' does not resolve to the configured TEST tenant. Refusing to call Graph — this dev/regression tool never targets a real customer tenant.",
                    $"tenant == {testTenantId}", $"tenant == {resolvedTenant}", $"authProfile={authProfile}"), "", "");
            }

            // Git #965 — hard testbed gate. The GRAPH_TEST_TENANT_ID equality check above is only as
            // trustworthy as whoever set that env var; this verifies the resolved tenant is a REAL
            // isTestbed=true customer per the server's authoritative list before any Graph call is made.
            // Fail-closed and loud (see TestbedGate) — a non-testbed tenant is refused outright, never
            // read from. This matches the enforcement strength of the server-side write-action gate.
            var gate = await TestbedGate.VerifyTenantIsTestbedAsync(resolvedTenant, $"graphTests {label}");
            if (!gate.Allowed)
            {
                ActivityLog.Log(channel, $"REFUSED [{index + 1}/{total}] {label}: {gate.Reason} — no Graph call made.");
                return (false, Finish(channel, "graph", label, sw, false,
                    $"testbed gate: {gate.Reason} This dev/regression tool never targets a non-testbed tenant.",
                    "tenant flagged isTestbed=true on the server", "not confirmed testbed",
                    $"authProfile={authProfile}, tenant={resolvedTenant}"), "", "");
            }

            var (clientId, clientSecret, fixedTenantId) = ResolveAuthProfile(authProfile);
            if (clientId == null || clientSecret == null)
                return (false, Finish(channel, "graph", label, sw, false,
                    $"authProfile '{authProfile}' not recognized, or its credentials are not configured in environment variables.",
                    "clientId/clientSecret resolved for authProfile", "null", $"authProfile={authProfile}"), "", "");

            // "ba40ca4d" (internal single-tenant app) has its own fixed tenant; still only reachable
            // here because it was already asserted equal to GRAPH_TEST_TENANT_ID above.
            string tokenTenant = fixedTenantId ?? resolvedTenant;
            string token = await GetTokenAsync(authProfile, tokenTenant, clientId, clientSecret);
            return (true, null, token, resolvedTenant);
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

        private static int? GetInt(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : (int?)null;

        private static string Truncate(string s) => s.Length > 300 ? s.Substring(0, 300) + "..." : s;

        private static TestStepResult Finish(string channel, string kind, string label, Stopwatch sw, bool passed, string detail,
            string expected = "", string actual = "", string context = "")
        {
            sw.Stop();
            ActivityLog.Log(channel, (passed ? "PASS " : "FAIL ") + $"{label} ({sw.ElapsedMilliseconds}ms) - {detail}");
            return new TestStepResult
            {
                Kind = kind, Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds,
                Expected = expected, Actual = actual, Context = context,
            };
        }
    }
}
