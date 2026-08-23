using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace BuildConsole
{
    // ── shaneapp://executeScan — LOCAL in-process SINGLE monitor-check trigger ────────────
    //
    // A sibling to executeSql / runTest / runScan (dispatched from HandleShaneAppUriAsync in
    // MainWindow.xaml.cs). Where runScan (local #59) triggers the FULL aggregate diagnostics
    // scan for a customer, executeScan triggers exactly ONE individual monitor check by its real
    // monitor_checks key (e.g. "appgov:stale-app-registrations") against a specified testbed
    // tenant — the same granular action Simulator Studio's "M365 Endpoints" node performs when an
    // operator picks a single check and clicks Run. It is deliberately more granular than runScan.
    //
    // REUSE, NOT REIMPLEMENTATION:
    //   The run is executed by the SAME real server endpoint the Simulator Studio canvas calls —
    //   POST /api/admin/monitor-checks/:key/run — via Services/MonitorScanClient. That endpoint's
    //   startCheckRun() merges each field as `override ?? check.<field>`, so sending only
    //   { customerId } runs the check with its OWN stored defaults (endpoint/method/$select/
    //   $filter/body), exactly as the UI does with nothing edited. The Graph request, pagination,
    //   mapping, severity classification and the tenant_monitor_profiles write all belong to the
    //   server's executeMonitorCheck — none of it is re-implemented here.
    //
    // #965 TESTBED GATE (the same hard gate every tenant-touching action requires):
    //   Before any run is started, the caller-supplied tenant is resolved against the server's live
    //   isTestbed=true customer list (Services/TestbedGate.ResolveTestbedTargetAsync), fail-closed.
    //   That single step BOTH enforces the gate (a non-testbed target is refused, never run) AND
    //   yields the numeric customerId (= tenants.id) the run endpoint needs — the caller passes a
    //   tenant GUID or the customer id, the gate maps it to the real testbed row or refuses.
    //
    // SETTLE-TO-TERMINAL (like runScan/runTest, so an agent's poll never gets a non-result):
    //   The run route is fire-and-forget (202 { runId }). executeScan polls
    //   GET /api/admin/monitor-check-runs/:runId until the run reaches a terminal status
    //   (completed | failed), with a hard timeout backstop, and ONLY THEN writes one settled
    //   result envelope. A 202 "pending" is never handed back as a result.
    //
    // RESULT ENVELOPE (dual-verification, per AGENT_PROTOCOLS §5 / local #60):
    //   Written to ?resultRef= (or a predictable %TEMP% default). It carries the check's actual
    //   OBSERVED output — most importantly run.result.extractedProperties (the engine's own mapped
    //   values), plus itemCount / pageCount / severityMatched / status, the full run object, and a
    //   best-effort copy of the raw captured Graph items — so a build session can diff the engine's
    //   finding against an independent delegated PowerShell (Get-Mg*) read of the same tenant fact,
    //   not merely confirm "the check ran".
    //
    // Every branch logs on the shared shaneapp protocol channel (ShaneAppProtocol.LogChannel,
    // "sql-runner.protocol") — real scan key, real tenant, real outcome.
    public partial class MainWindow
    {
        // Monitor checks are normally a single (possibly paginated) Graph call; a fan-out check can
        // take longer. Poll to a terminal status, but never hang an agent's file poll forever.
        private const int ExecuteScanPollTimeoutSeconds = 240;
        private const int ExecuteScanPollIntervalMs = 750;

        /// <summary>
        /// Handles one shaneapp://executeScan invocation on the UI thread: reads ?scan= (the
        /// monitor_checks key) and ?tenantId= (a testbed tenant GUID or customer id), enforces the
        /// #965 testbed gate while resolving the customerId, triggers the ONE real per-check run via
        /// the same endpoint Simulator Studio uses, settles it to a terminal status, and writes a
        /// JSON result envelope for the calling agent. Wrapped end-to-end so ANY failure still
        /// produces an envelope — an agent polling the result file must never hang.
        /// </summary>
        private async Task HandleShaneAppExecuteScanAsync(BuildConsole.Services.ShaneAppRequest req, string src, string ch)
        {
            // Declared outside the top-level try so the absolute backstop can still name them in a
            // guaranteed failure envelope even if an exception is thrown mid-resolution.
            string? scanKey = null;
            string? tenantArg = null;

            try
            {
                scanKey = GetShaneAppQueryParam(req.Raw, "scan");
                tenantArg = GetShaneAppQueryParam(req.Raw, "tenantId");

                if (string.IsNullOrWhiteSpace(scanKey))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, "executeScan called with no scan= monitor_checks key — nothing to run.");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: "no scan= monitor_checks key supplied", customerId: null, matchedCustomerName: null,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }
                if (string.IsNullOrWhiteSpace(tenantArg))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeScan '{scanKey}' called with no tenantId= — nothing to target.");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: "no tenantId= testbed tenant supplied", customerId: null, matchedCustomerName: null,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }

                // ── #965 gate + customerId resolution in one fail-closed step ──────────────────────
                var gateContext = $"executeScan {scanKey}";
                var (customer, gateReason) = await BuildConsole.Services.TestbedGate.ResolveTestbedTargetAsync(tenantArg!, gateContext);
                if (customer == null)
                {
                    // TestbedGate already logged the refusal on its own channel; mirror it here on the
                    // protocol channel and write a refusal envelope so the agent's poll returns cleanly.
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeScan REFUSED '{scanKey}' against '{tenantArg}' — {gateReason}");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: $"testbed gate refused: {gateReason}", customerId: null, matchedCustomerName: null,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }

                int customerId = customer.Id;
                string? matchedName = customer.Name;

                var cfg = BuildConsole.Services.BuildTrackerConfig.Load().ForEnvironment(BuildConsole.Services.TargetEnvironment.Dev);
                if (!cfg.IsConfigured)
                {
                    const string notConfigured =
                        "BuildConsole api config not set (scripts/build-queue-watcher.config.json apiBaseUrl/ingestToken) — cannot reach the monitor-check run routes.";
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeScan can't run — {notConfigured}");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: notConfigured, customerId: customerId, matchedCustomerName: matchedName,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }

                using var client = new BuildConsole.Services.MonitorScanClient(cfg);
                var sw = System.Diagnostics.Stopwatch.StartNew();

                // ── Trigger the ONE real per-check run (defaults preserved: only customerId is sent) ──
                BuildConsole.Services.ActivityLog.Log(ch,
                    $"executeScan starting '{scanKey}' against testbed customer #{customerId} ('{matchedName}', {tenantArg}) (src='{src}')…");

                var start = await client.StartRunAsync(scanKey!, customerId);
                if (!start.IsSuccess)
                {
                    var err = start.DescribeError();
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeScan '{scanKey}' failed to start: {err}");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: $"failed to start run: {err}", customerId: customerId, matchedCustomerName: matchedName,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }

                string? runId = start.Body?["runId"]?.ToString();
                if (string.IsNullOrWhiteSpace(runId))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeScan '{scanKey}' start returned no runId — cannot settle.");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: "run started but the server returned no runId", customerId: customerId, matchedCustomerName: matchedName,
                        runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
                    return;
                }

                // ── Settle: poll to a terminal status (completed | failed) or time out ───────────────
                JsonNode? pollBody = null;
                string runStatus = "";
                bool settled = false;
                var deadline = DateTime.UtcNow.AddSeconds(ExecuteScanPollTimeoutSeconds);
                while (DateTime.UtcNow < deadline)
                {
                    var poll = await client.GetRunAsync(runId!);
                    if (poll.IsSuccess && poll.Body != null)
                    {
                        pollBody = poll.Body;
                        runStatus = NodeString(pollBody["run"]?["status"]) ?? "";
                        if (string.Equals(runStatus, "completed", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(runStatus, "failed", StringComparison.OrdinalIgnoreCase))
                        {
                            settled = true;
                            break;
                        }
                    }
                    // A transient poll error (e.g. a napping dev server) is not fatal — keep polling
                    // until the deadline; the deadline itself is the backstop.
                    await Task.Delay(ExecuteScanPollIntervalMs);
                }

                JsonNode? run = pollBody?["run"];
                JsonNode? classification = pollBody?["classification"];

                if (!settled)
                {
                    BuildConsole.Services.ActivityLog.Log(ch,
                        $"executeScan '{scanKey}' did not settle within {ExecuteScanPollTimeoutSeconds}s (last status '{(string.IsNullOrEmpty(runStatus) ? "unknown" : runStatus)}', run {runId}).");
                    WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                        error: $"run did not settle within {ExecuteScanPollTimeoutSeconds}s (last status: {(string.IsNullOrEmpty(runStatus) ? "unknown" : runStatus)})",
                        customerId: customerId, matchedCustomerName: matchedName,
                        runId: runId, runStatus: string.IsNullOrEmpty(runStatus) ? null : runStatus,
                        run: run, classification: classification, items: null, itemsError: null);
                    return;
                }

                // ── Best-effort: pull the full captured Graph items (the fullest ground-truth surface).
                // Unavailable (409) on a failed/too-large run — noted, never fatal.
                JsonNode? items = null;
                string? itemsError = null;
                try
                {
                    var itemsRes = await client.GetItemsAsync(runId!);
                    if (itemsRes.IsSuccess) items = itemsRes.Body?["items"];
                    else itemsError = itemsRes.DescribeError();
                }
                catch (Exception ex) { itemsError = ex.Message; }

                // A run whose engine result status is "ok"/"partial" is a healthy read; anything else
                // (error/consent_revoked/license_gap/requires_script) settled but did NOT observe cleanly.
                string? checkStatus = NodeString(run?["result"]?["status"]);
                bool runFailed = string.Equals(runStatus, "failed", StringComparison.OrdinalIgnoreCase);
                bool ok = !runFailed;
                string? error = runFailed
                    ? (NodeString(run?["result"]?["errorMessage"]) ?? NodeString(run?["statusText"]) ?? "run finished with status 'failed'")
                    : null;

                WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok, error, customerId, matchedName,
                    runId, runStatus, run, classification, items, itemsError);

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"executeScan '{scanKey}' settled in {sw.ElapsedMilliseconds}ms: runStatus={runStatus}, checkStatus={checkStatus ?? "?"}. Result -> {ResolveExecuteScanResultPath(req, scanKey!)}");
            }
            catch (Exception ex)
            {
                // Absolute backstop: any exception outside the guarded branches above still yields an
                // envelope so the caller's poll never hangs (mirrors executeSql/runTest).
                BuildConsole.Services.ActivityLog.Log(ch, $"executeScan handler threw (backstop caught, writing failure envelope): {ex.Message}");
                WriteShaneAppExecuteScanResult(req, scanKey, tenantArg, ok: false,
                    error: $"executeScan handler error: {ex.Message}", customerId: null, matchedCustomerName: null,
                    runId: null, runStatus: null, run: null, classification: null, items: null, itemsError: null);
            }
        }

        /// <summary>
        /// Where the executeScan result envelope is written: the caller's ?resultRef= if given; else a
        /// predictable temp-dir path keyed by the (filename-sanitized) scan key, so a caller can
        /// compute it without passing resultRef (%TEMP%\shaneapp-executeScan-&lt;scan&gt;.result.json).
        /// </summary>
        private static string ResolveExecuteScanResultPath(BuildConsole.Services.ShaneAppRequest req, string scanKey)
        {
            if (!string.IsNullOrWhiteSpace(req.ResultRef)) return req.ResultRef!;
            var sb = new System.Text.StringBuilder(scanKey.Length);
            foreach (var c in scanKey)
                sb.Append(char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' ? c : '-');
            string stem = sb.Length == 0 ? "scan" : sb.ToString();
            return Path.Combine(Path.GetTempPath(), $"shaneapp-executeScan-{stem}.result.json");
        }

        /// <summary>
        /// Best-effort writes the executeScan JSON result envelope: a top-line ok/error summary a CLI
        /// agent can branch on immediately, the resolved testbed target, the settled run status, and
        /// the check's OWN observed output (extractedProperties is the load-bearing dual-verification
        /// field) plus the full run object and the raw captured items. A failed write is logged, never
        /// thrown.
        /// </summary>
        private void WriteShaneAppExecuteScanResult(BuildConsole.Services.ShaneAppRequest req,
            string? scanKey, string? tenantArg, bool ok, string? error, int? customerId, string? matchedCustomerName,
            string? runId, string? runStatus, JsonNode? run, JsonNode? classification, JsonNode? items, string? itemsError)
        {
            string path = ResolveExecuteScanResultPath(req, scanKey ?? "");
            try
            {
                JsonNode? result = run?["result"];
                var envelope = new
                {
                    ok,
                    error,
                    action = "executeScan",
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    scan = scanKey,
                    tenantId = tenantArg,
                    customerId,
                    matchedCustomerName,
                    runId,
                    runStatus,
                    // The engine's own per-check observation — the fields a PowerShell ground-truth read
                    // is diffed against (AGENT_PROTOCOLS §5 / local #60).
                    checkStatus = NodeString(result?["status"]),
                    severityMatched = NodeString(result?["severityMatched"]),
                    severityLabel = NodeString(result?["severityLabel"]),
                    itemCount = NodeInt(result?["itemCount"]),
                    pageCount = NodeInt(result?["pageCount"]),
                    extractedProperties = result?["extractedProperties"],
                    classification,
                    rawItemCount = (items as JsonArray)?.Count,
                    itemsError,
                    items,
                    run,
                };

                File.WriteAllText(path,
                    JsonSerializer.Serialize(envelope, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    $"couldn't write executeScan result file {path}: {ex.Message}");
            }
        }

        /// <summary>Reads a JSON node as a string, tolerating a non-string node (returns its JSON text) or null.</summary>
        private static string? NodeString(JsonNode? n)
        {
            if (n == null) return null;
            try { return n.GetValue<string>(); }
            catch { return n.ToString(); }
        }

        /// <summary>Reads a JSON node as an int, tolerating a numeric-as-double or a non-numeric node (null).</summary>
        private static int? NodeInt(JsonNode? n)
        {
            if (n == null) return null;
            try { return n.GetValue<int>(); }
            catch
            {
                try { return (int)n.GetValue<double>(); }
                catch { return null; }
            }
        }
    }
}
