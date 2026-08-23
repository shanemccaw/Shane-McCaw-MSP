using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole
{
    // ── shaneapp://runScan — LOCAL trigger for the REAL scan/assessment engine ────────────
    //
    // A third sibling to shaneapp://executeSql (local SQL) and shaneapp://runTest (in-process
    // manifest), dispatched from HandleShaneAppUriAsync in MainWindow.xaml.cs. Git motivation
    // (Shane's own words): "if the agent could execute a scan on their own outside the UI path,
    // they could help debug and make my scanning engine better." The platform's real Copilot
    // Readiness scan (real per-tenant Microsoft Graph reads → real findings/scores/pillars) can
    // otherwise only be exercised by walking the whole customer UI journey (quiz → consent →
    // scan trigger → verdict). This gives a build session a fast, direct way to run a REAL scan
    // against a testbed tenant and inspect the REAL result.
    //
    // WHY HTTP, NOT LOCAL LIKE executeSql/runTest:
    //   executeSql runs SQL on BuildConsole's OWN local Postgres connection; runTest runs a
    //   manifest IN-PROCESS through RunManifestAsync. Neither applies here: the scan engine is
    //   runDiagnostics() in the deployed Node/TS api-server (real Graph reads via per-tenant
    //   client-credentials), which BuildConsole can't run in-process. The ONLY way to run the
    //   REAL engine is the SAME authenticated api-server route the product itself uses — so this
    //   reuses the exact trigger over HTTP (Services/ScanRunnerClient), never a second scan impl.
    //
    // THE EXACT TRIGGER + THE #965 TESTBED GATE:
    //   ScanRunnerClient posts POST /api/portal/assessment/debug-trigger-scan — the platform's
    //   ONE scan trigger the assessment UI calls, hard-gated server-side to tenants.is_testbed
    //   = true (Git #965). BEFORE even triggering, this handler ALSO runs BuildConsole's own
    //   existing #965 gate (Services/TestbedGate.VerifyTenantIsTestbedAsync) against the server's
    //   authoritative isTestbed=true customer list — the SAME gate graphTests/powerShellVerify
    //   use — so a scan can never accidentally hit a real customer tenant, exactly as protected
    //   as every other real Graph read/write BuildConsole drives.
    //
    // AUTH (why a testbed login is required):
    //   /api/portal/assessment/* is guarded by requireRole("Assessment") → requireAuth →
    //   jwt.verify. BuildConsole's BUILD_TRACKER_INGEST_TOKEN is an opaque static string, not a
    //   JWT, so it is rejected there (401), and there is no ingest-token-reachable endpoint that
    //   scans a chosen tenant. So this does the SAME thing the test manifests do: log in as the
    //   pre-provisioned testbed Assessment account (TEST_PORTAL_EMAIL / TEST_PORTAL_PASSWORD from
    //   Settings > Test Environment Variables) to mint an Assessment-role JWT, then use THAT JWT
    //   for the trigger + the result reads. As a correctness belt, the JWT's customerId claim is
    //   confirmed to match the requested tenantId's testbed customer, so runScan can never
    //   silently scan a DIFFERENT (still-testbed) tenant than the one asked for.
    //
    // RESULT ENVELOPE:
    //   Written to ?resultRef= (or a predictable %TEMP%\shaneapp-runScan-<tenantId>.result.json
    //   default). A top-line ok / scanStatus / counts a CLI agent can branch on immediately, PLUS
    //   the full real run row, the full findings[], and the computed GET /assessment/status
    //   breakdown (radar/pillars, stats, copilotReadiness sub-indicators, copilotGate go/no-go) —
    //   genuinely usable to reason about the engine's real behaviour, not just pass/fail.
    //
    // Every branch logs on the shared shaneapp protocol channel (ShaneAppProtocol.LogChannel);
    // the testbed gate additionally logs on its own testing.testbed-gate channel.
    public partial class MainWindow
    {
        /// <summary>How often the run is polled to a terminal status.</summary>
        private const int RunScanPollIntervalSeconds = 4;

        /// <summary>Default overall wait for a scan to finish (real Graph reads are minutes-scale). Overridable per-call via ?timeoutSeconds=, clamped to [60, 1800].</summary>
        private const int RunScanDefaultTimeoutSeconds = 600;

        /// <summary>Consistent result envelope for a runScan invocation — same top-line fields as the executeSql/runTest envelopes (ok/error/action/source/ranAtUtc) plus the real scan's run/findings/pillar breakdown. Serialized camelCase to match the other two actions.</summary>
        private sealed class RunScanOutcome
        {
            public bool Ok { get; set; }
            public string? Error { get; set; }
            public string Action { get; set; } = "runScan";
            public string? Source { get; set; }
            public string RanAtUtc { get; set; } = "";
            public string? TenantId { get; set; }
            public object? TestbedCustomer { get; set; }
            public string? RunId { get; set; }
            public string? ScanStatus { get; set; }
            /// <summary>True when the login's customerId matched the requested tenant's testbed customer; false if it didn't (refused); null if it couldn't be determined (the server-side #965 gate still applied).</summary>
            public bool? TenantCorrespondenceConfirmed { get; set; }
            public long ElapsedMs { get; set; }
            public int? ChecksTotal { get; set; }
            public int? ChecksOk { get; set; }
            public int? ChecksError { get; set; }
            public int? FindingsCount { get; set; }
            public JsonElement? CopilotGate { get; set; }
            public JsonElement? Run { get; set; }
            public JsonElement? Findings { get; set; }
            public JsonElement? AssessmentStatus { get; set; }
        }

        private static readonly JsonSerializerOptions RunScanJsonOpts = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        };

        /// <summary>
        /// Handles one shaneapp://runScan invocation on the UI thread: enforces the #965 testbed gate,
        /// logs in as the testbed Assessment account, triggers the REAL scan engine against the
        /// specified tenant, polls the run to completion, reads the computed pillar/score breakdown, and
        /// writes a structured result envelope for the calling agent. Every path — including the
        /// top-level backstop — writes an envelope so an agent polling the result file can never hang.
        /// Pure HTTP; does not touch the shared TestRunnerWindow/WebView2, so (unlike runTest) it needs
        /// no _testTriggerBusy latch and can safely run alongside a manifest run.
        /// </summary>
        private async Task HandleShaneAppRunScanAsync(BuildConsole.Services.ShaneAppRequest req, string src, string ch)
        {
            string? tenantId = null;
            var sw = System.Diagnostics.Stopwatch.StartNew();

            // A fresh envelope pre-filled with the fields known at every exit, so success and failure
            // envelopes share one shape (a CLI agent parses the same keys either way).
            RunScanOutcome NewOutcome() => new RunScanOutcome
            {
                Source = req.Source,
                RanAtUtc = DateTime.UtcNow.ToString("o"),
                TenantId = tenantId,
                ElapsedMs = sw.ElapsedMilliseconds,
            };

            void Fail(string error, bool? correspondence = null)
            {
                var o = NewOutcome();
                o.Ok = false;
                o.Error = error;
                o.TenantCorrespondenceConfirmed = correspondence;
                WriteShaneAppRunScanResult(req, o);
            }

            try
            {
                tenantId = GetShaneAppQueryParam(req.Raw, "tenantId");
                if (string.IsNullOrWhiteSpace(tenantId))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, "runScan called with no tenantId= — nothing to scan.");
                    Fail("no tenantId= supplied (pass the Entra tenant GUID of a real testbed tenant)");
                    return;
                }

                // ── #965 testbed gate — the SAME enforced isTestbed=true gate graphTests/powerShellVerify
                // use. Fail-closed: any inability to positively confirm the tenant is testbed REFUSES.
                var gate = await BuildConsole.Services.TestbedGate.VerifyTenantIsTestbedAsync(tenantId!, "runScan");
                if (!gate.Allowed)
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"runScan REFUSED by testbed gate for tenant '{tenantId}': {gate.Reason}");
                    Fail($"testbed gate refused this tenant: {gate.Reason}");
                    return;
                }

                // Resolve the matched testbed customer's numeric id (for the login-correspondence belt).
                // The gate just fetched+cached the list, so this is a cache hit; a failure here is
                // non-fatal (correspondence simply can't be confirmed — the server gate still applies).
                BuildConsole.Services.TestbedGate.TestbedCustomer? tbCustomer = null;
                try { tbCustomer = await BuildConsole.Services.TestbedGate.FindTestbedCustomerAsync(tenantId!); }
                catch (Exception ex) { BuildConsole.Services.ActivityLog.Log(ch, $"runScan: couldn't resolve testbed customer id for correspondence check ({ex.Message}) — proceeding on the server gate."); }

                var testbedCustomerInfo = new { id = tbCustomer?.Id, name = gate.MatchedCustomerName ?? tbCustomer?.Name };

                // ── Testbed Assessment creds (Settings > Test Environment Variables) ──
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                string? GetVar(string name) => settings.TestEnvironmentVariables
                    .FirstOrDefault(v => string.Equals(v.Name?.Trim(), name, StringComparison.OrdinalIgnoreCase))?.Value;
                string? email = GetVar("TEST_PORTAL_EMAIL");
                string? password = GetVar("TEST_PORTAL_PASSWORD");
                if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
                {
                    Fail("testbed Assessment credentials not set — add TEST_PORTAL_EMAIL and TEST_PORTAL_PASSWORD in BuildConsole Settings > Test Environment Variables (the same creds the test manifests use to log in)");
                    return;
                }

                var cfg = BuildConsole.Services.BuildTrackerConfig.Load().ForEnvironment(BuildConsole.Services.TargetEnvironment.Dev);
                if (string.IsNullOrWhiteSpace(cfg.ApiBaseUrl))
                {
                    Fail("apiBaseUrl not configured (scripts/build-queue-watcher.config.json) — can't reach the api-server");
                    return;
                }

                int timeoutSeconds = ParseRunScanTimeout(req);

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runScan starting for tenant '{tenantId}' ('{testbedCustomerInfo.name}') as '{email}' (src='{src}', timeout {timeoutSeconds}s)…");

                // ── Login → Assessment JWT ──
                var login = await BuildConsole.Services.ScanRunnerClient.LoginAsync(cfg.ApiBaseUrl, email!, password!);
                if (!login.Ok || string.IsNullOrWhiteSpace(login.AccessToken))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"runScan login failed: {login.Error}");
                    Fail($"testbed login failed: {login.Error}");
                    return;
                }

                // ── Correspondence belt: the login must land on the tenant that was asked for ──
                bool? correspondence = null;
                if (tbCustomer != null && login.CustomerId.HasValue)
                {
                    correspondence = tbCustomer.Id == login.CustomerId.Value;
                    if (correspondence == false)
                    {
                        BuildConsole.Services.ActivityLog.Log(ch,
                            $"runScan REFUSED — tenant mismatch: tenantId '{tenantId}' is customer #{tbCustomer.Id} but the configured creds log in as customer #{login.CustomerId}.");
                        Fail($"requested tenantId '{tenantId}' maps to testbed customer #{tbCustomer.Id} ('{tbCustomer.Name}'), but the configured TEST_PORTAL_* credentials log in as customer #{login.CustomerId} — refusing to scan a different tenant than requested. Point TEST_PORTAL_EMAIL/TEST_PORTAL_PASSWORD at the requested tenant's testbed Assessment account.",
                            correspondence);
                        return;
                    }
                }

                // ── Trigger the REAL scan (server-side #965 gate is a second belt) ──
                var trig = await BuildConsole.Services.ScanRunnerClient.TriggerScanAsync(cfg.ApiBaseUrl, login.AccessToken!);
                if (!trig.Ok || string.IsNullOrWhiteSpace(trig.RunId))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"runScan trigger failed (HTTP {trig.StatusCode}): {trig.Error}");
                    var o = NewOutcome();
                    o.Ok = false;
                    o.Error = $"scan trigger failed: {trig.Error}";
                    o.TestbedCustomer = testbedCustomerInfo;
                    o.TenantCorrespondenceConfirmed = correspondence;
                    WriteShaneAppRunScanResult(req, o);
                    return;
                }

                string runId = trig.RunId!;
                BuildConsole.Services.ActivityLog.Log(ch, $"runScan triggered real scan runId={runId} for tenant '{tenantId}' — polling to completion…");

                // ── Poll the run to a terminal status ──
                var scan = await BuildConsole.Services.ScanRunnerClient.PollRunToTerminalAsync(
                    cfg.ApiBaseUrl, login.AccessToken!, runId,
                    TimeSpan.FromSeconds(timeoutSeconds), TimeSpan.FromSeconds(RunScanPollIntervalSeconds),
                    onProgress: (status, poll) =>
                    {
                        // Log poll #1 and every 5th (~every 20s) so long scans leave a trace without flooding.
                        if (poll == 1 || poll % 5 == 0)
                            BuildConsole.Services.ActivityLog.Log(ch, $"runScan poll #{poll}: status={status} (runId={runId})");
                    });

                // ── Read the computed pillar/score/gate breakdown (even on timeout it shows progress) ──
                var assessment = await BuildConsole.Services.ScanRunnerClient.GetAssessmentStatusAsync(cfg.ApiBaseUrl, login.AccessToken!);

                // ── Build the final envelope ──
                var outcome = NewOutcome();
                outcome.Ok = scan.Ok;
                outcome.Error = scan.Ok ? null : scan.Error;
                outcome.TestbedCustomer = testbedCustomerInfo;
                outcome.RunId = runId;
                outcome.ScanStatus = scan.Status;
                outcome.TenantCorrespondenceConfirmed = correspondence;

                if (scan.RunAndFindings is JsonElement raf && raf.ValueKind == JsonValueKind.Object)
                {
                    if (raf.TryGetProperty("run", out var runEl) && runEl.ValueKind == JsonValueKind.Object)
                    {
                        outcome.Run = runEl;
                        outcome.ChecksTotal = RunScanReadInt(runEl, "checksTotal") ?? RunScanReadInt(runEl, "checks_total");
                        outcome.ChecksOk = RunScanReadInt(runEl, "checksOk") ?? RunScanReadInt(runEl, "checks_ok");
                        outcome.ChecksError = RunScanReadInt(runEl, "checksError") ?? RunScanReadInt(runEl, "checks_error");
                    }
                    if (raf.TryGetProperty("findings", out var fEl) && fEl.ValueKind == JsonValueKind.Array)
                    {
                        outcome.Findings = fEl;
                        outcome.FindingsCount = fEl.GetArrayLength();
                    }
                }

                if (assessment is JsonElement asmt && asmt.ValueKind == JsonValueKind.Object)
                {
                    outcome.AssessmentStatus = asmt;
                    if (asmt.TryGetProperty("copilotGate", out var cg))
                        outcome.CopilotGate = cg;
                }

                WriteShaneAppRunScanResult(req, outcome);
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"runScan done in {sw.ElapsedMilliseconds}ms: runId={runId} status={scan.Status ?? "unknown"} " +
                    $"({outcome.FindingsCount?.ToString() ?? "?"} finding(s), checks {outcome.ChecksOk?.ToString() ?? "?"}/{outcome.ChecksTotal?.ToString() ?? "?"} ok). " +
                    $"Result -> {ResolveRunScanResultPath(req, tenantId)}");
            }
            catch (Exception ex)
            {
                // Absolute backstop: any exception outside the specific handling above still yields an
                // envelope so the caller's poll never hangs (the executeSql/runTest "never silently
                // no-op" contract).
                BuildConsole.Services.ActivityLog.Log(ch, $"runScan handler threw (backstop caught, writing failure envelope): {ex.Message}");
                Fail($"runScan handler error: {ex.Message}");
            }
        }

        /// <summary>Reads the optional ?timeoutSeconds= override (clamped to [60, 1800]); defaults to <see cref="RunScanDefaultTimeoutSeconds"/>.</summary>
        private static int ParseRunScanTimeout(BuildConsole.Services.ShaneAppRequest req)
        {
            var raw = GetShaneAppQueryParam(req.Raw, "timeoutSeconds");
            if (int.TryParse(raw, out var secs))
                return Math.Max(60, Math.Min(1800, secs));
            return RunScanDefaultTimeoutSeconds;
        }

        /// <summary>Safe int reader for a JSON object property (returns null if absent/non-numeric).</summary>
        private static int? RunScanReadInt(JsonElement obj, string prop) =>
            obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v)
                && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : (int?)null;

        /// <summary>
        /// Where the runScan result envelope is written: the caller's ?resultRef= if given; else a
        /// predictable temp-dir path keyed by tenant (%TEMP%\shaneapp-runScan-&lt;tenantId&gt;.result.json),
        /// so a caller can compute it without passing resultRef.
        /// </summary>
        private static string ResolveRunScanResultPath(BuildConsole.Services.ShaneAppRequest req, string? tenantId)
        {
            if (!string.IsNullOrWhiteSpace(req.ResultRef)) return req.ResultRef!;
            string stem = string.IsNullOrWhiteSpace(tenantId) ? "unknown" : SanitizeForFileName(tenantId!);
            return Path.Combine(Path.GetTempPath(), $"shaneapp-runScan-{stem}.result.json");
        }

        private static string SanitizeForFileName(string s)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var sb = new StringBuilder(s.Length);
            foreach (var ch in s) sb.Append(Array.IndexOf(invalid, ch) >= 0 ? '_' : ch);
            return sb.ToString();
        }

        /// <summary>Best-effort writes the runScan JSON result envelope to its resolved path (camelCase, indented). A failed write is logged, never thrown.</summary>
        private void WriteShaneAppRunScanResult(BuildConsole.Services.ShaneAppRequest req, RunScanOutcome outcome)
        {
            string path = ResolveRunScanResultPath(req, outcome.TenantId);
            try
            {
                File.WriteAllText(path, JsonSerializer.Serialize(outcome, RunScanJsonOpts));
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    $"couldn't write runScan result file {path}: {ex.Message}");
            }
        }
    }
}
