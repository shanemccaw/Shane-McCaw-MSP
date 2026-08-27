using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace BuildConsole
{
    // ── shaneapp://executeCmdlet — LOCAL SINGLE PowerShell-cmdlet trigger (#1404) ─────────
    //
    // A sibling to executeSql / runTest / runScan / executeScan (dispatched from
    // HandleShaneAppUriAsync in MainWindow.xaml.cs). Where executeScan triggers ONE monitor
    // check by its monitor_checks key (the MONITORING engine, executeMonitorCheck), this
    // triggers ONE raw, allowlisted PowerShell cmdlet by its ps-execution cmdlet-catalog KEY
    // (e.g. "get-connection-info", "get-cs-online-user") against a testbed tenant — the exact
    // Security & Compliance / Exchange / Teams cmdlets that back the PowerShell scan checks.
    //
    // REUSE, NOT REIMPLEMENTATION:
    //   The cmdlet is executed by the SAME real server code path a genuine scan uses — the
    //   api-server route POST /api/simulator/ps-execution/cmdlet
    //   (artifacts/api-server/src/routes/admin-engines.ts) calls
    //   lib/ps-execution-client.callPsExecution(), the identical function
    //   monitor-executor.runPowerShellCheck() calls. BuildConsole never talks to the
    //   ps-execution container itself and never holds its bearer secret: Services/
    //   CmdletExecutionClient is a thin HTTP courier to that route; the raw secret, the
    //   Dev-vs-Production container selection (#1385 → ca-ps-execution-dev for a dev
    //   api-server), and the container's cmdlet allowlist all live server-side. This is the
    //   whole point of #1404 — the exact safety pattern executeSql uses for DB creds, applied
    //   to the ps-execution bearer secret that blocked #1400/#1389's manual verification.
    //
    // #965 TESTBED GATE (belt-and-braces — enforced BOTH here and server-side):
    //   Before any call, the caller-supplied tenant is resolved against the server's live
    //   isTestbed=true customer list (Services/TestbedGate.ResolveTestbedTargetAsync,
    //   fail-closed) — a non-testbed target is refused, never run. The server route then
    //   independently re-gates and derives the real Connect-* Organization from the gated
    //   testbed tenant's own domain, so a real sign-in can never touch a non-testbed tenant.
    //
    // RESULT ENVELOPE (dual-verification, per AGENT_PROTOCOLS §5 / §9):
    //   Written to ?resultRef= (or a predictable %TEMP% default). It carries the cmdlet's
    //   actual returned items (rawResponse + items) plus itemCount and the resolved testbed
    //   target — so a build session can diff the cmdlet's ground-truth output against an
    //   engine finding, or simply confirm a connect path works (the #1400 get-connection-info
    //   → get-cs-online-user same-replica proof). Every branch logs on the shared shaneapp
    //   protocol channel (ShaneAppProtocol.LogChannel, "sql-runner.protocol").
    public partial class MainWindow
    {
        /// <summary>
        /// Handles one shaneapp://executeCmdlet invocation on the UI thread: reads ?cmdletKey=
        /// (the ps-execution catalog key), ?tenantId= (a testbed tenant GUID or customer id), and
        /// optional ?organization= (the tenant domain), enforces the #965 testbed gate, routes the
        /// cmdlet through the same server code path a real scan uses, and writes a JSON result
        /// envelope. Wrapped end-to-end so ANY failure still produces an envelope — an agent polling
        /// the result file must never hang.
        /// </summary>
        private async Task HandleShaneAppExecuteCmdletAsync(BuildConsole.Services.ShaneAppRequest req, string src, string ch)
        {
            // Declared outside the top-level try so the absolute backstop can still name them in a
            // guaranteed failure envelope even if an exception is thrown mid-resolution.
            string? cmdletKey = null;
            string? tenantArg = null;
            string? organization = null;

            try
            {
                cmdletKey = GetShaneAppQueryParam(req.Raw, "cmdletKey");
                tenantArg = GetShaneAppQueryParam(req.Raw, "tenantId");
                organization = GetShaneAppQueryParam(req.Raw, "organization");

                if (string.IsNullOrWhiteSpace(cmdletKey))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, "executeCmdlet called with no cmdletKey= — nothing to run.");
                    WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, ok: false,
                        error: "no cmdletKey= ps-execution catalog key supplied", customerId: null, matchedCustomerName: null, serverBody: null, elapsedMs: null);
                    return;
                }
                if (string.IsNullOrWhiteSpace(tenantArg))
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeCmdlet '{cmdletKey}' called with no tenantId= — nothing to target.");
                    WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, ok: false,
                        error: "no tenantId= testbed tenant supplied", customerId: null, matchedCustomerName: null, serverBody: null, elapsedMs: null);
                    return;
                }

                // ── #965 gate + customerId resolution in one fail-closed step ──────────────────────
                var gateContext = $"executeCmdlet {cmdletKey}";
                var (customer, gateReason) = await BuildConsole.Services.TestbedGate.ResolveTestbedTargetAsync(tenantArg!, gateContext);
                if (customer == null)
                {
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeCmdlet REFUSED '{cmdletKey}' against '{tenantArg}' — {gateReason}");
                    WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, ok: false,
                        error: $"testbed gate refused: {gateReason}", customerId: null, matchedCustomerName: null, serverBody: null, elapsedMs: null);
                    return;
                }

                int customerId = customer.Id;
                string? matchedName = customer.Name;

                var cfg = BuildConsole.Services.BuildTrackerConfig.Load().ForEnvironment(BuildConsole.Services.TargetEnvironment.Dev);
                if (!cfg.IsConfigured)
                {
                    const string notConfigured =
                        "BuildConsole api config not set (scripts/build-queue-watcher.config.json apiBaseUrl/ingestToken) — cannot reach the ps-execution cmdlet route.";
                    BuildConsole.Services.ActivityLog.Log(ch, $"executeCmdlet can't run — {notConfigured}");
                    WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, ok: false,
                        error: notConfigured, customerId: customerId, matchedCustomerName: matchedName, serverBody: null, elapsedMs: null);
                    return;
                }

                using var client = new BuildConsole.Services.CmdletExecutionClient(cfg);
                var sw = System.Diagnostics.Stopwatch.StartNew();

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"executeCmdlet starting '{cmdletKey}' against testbed customer #{customerId} ('{matchedName}', {tenantArg}) org='{organization ?? "(server-derived)"}' (src='{src}')…");

                // Prefer the gated testbed tenant's own GUID as the canonical tenantId handed to the
                // server (the gate already resolved it); the server re-gates and derives Organization.
                string tenantForServer = !string.IsNullOrWhiteSpace(customer.TenantId) ? customer.TenantId! : tenantArg!;

                var res = await client.ExecuteCmdletAsync(cmdletKey!, tenantForServer, organization, cmdletParams: null);
                sw.Stop();

                bool serverOk = res.IsSuccess && NodeBool(res.Body?["ok"]) == true;
                string? error = serverOk
                    ? null
                    : (NodeString(res.Body?["error"]) ?? res.DescribeError());

                WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, serverOk, error,
                    customerId, matchedName, res.Body, sw.ElapsedMilliseconds);

                BuildConsole.Services.ActivityLog.Log(ch,
                    $"executeCmdlet '{cmdletKey}' {(serverOk ? "ok" : "failed")} in {sw.ElapsedMilliseconds}ms" +
                    (serverOk ? $" (itemCount={NodeInt(res.Body?["itemCount"]) ?? 0})" : $": {error}") +
                    $". Result -> {ResolveExecuteCmdletResultPath(req, cmdletKey!)}");
            }
            catch (Exception ex)
            {
                // Absolute backstop: any exception outside the guarded branches above still yields an
                // envelope so the caller's poll never hangs (mirrors executeSql/runTest/executeScan).
                BuildConsole.Services.ActivityLog.Log(ch, $"executeCmdlet handler threw (backstop caught, writing failure envelope): {ex.Message}");
                WriteShaneAppExecuteCmdletResult(req, cmdletKey, tenantArg, organization, ok: false,
                    error: $"executeCmdlet handler error: {ex.Message}", customerId: null, matchedCustomerName: null, serverBody: null, elapsedMs: null);
            }
        }

        /// <summary>
        /// Where the executeCmdlet result envelope is written: the caller's ?resultRef= if given; else
        /// a predictable temp-dir path keyed by the (filename-sanitized) cmdlet key, so a caller can
        /// compute it without passing resultRef (%TEMP%\shaneapp-executeCmdlet-&lt;cmdletKey&gt;.result.json).
        /// </summary>
        private static string ResolveExecuteCmdletResultPath(BuildConsole.Services.ShaneAppRequest req, string cmdletKey)
        {
            if (!string.IsNullOrWhiteSpace(req.ResultRef)) return req.ResultRef!;
            var sb = new System.Text.StringBuilder(cmdletKey.Length);
            foreach (var c in cmdletKey)
                sb.Append(char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' ? c : '-');
            string stem = sb.Length == 0 ? "cmdlet" : sb.ToString();
            return Path.Combine(Path.GetTempPath(), $"shaneapp-executeCmdlet-{stem}.result.json");
        }

        /// <summary>
        /// Best-effort writes the executeCmdlet JSON result envelope: a top-line ok/error summary a CLI
        /// agent can branch on immediately, the resolved testbed target, and the cmdlet's OWN returned
        /// output (items + rawResponse are the load-bearing dual-verification fields). The server-derived
        /// organization / kind / containerErrorKind / itemCount are lifted from the server response body
        /// when present. A failed write is logged, never thrown.
        /// </summary>
        private void WriteShaneAppExecuteCmdletResult(BuildConsole.Services.ShaneAppRequest req,
            string? cmdletKey, string? tenantArg, string? organization, bool ok, string? error, int? customerId,
            string? matchedCustomerName, JsonNode? serverBody, long? elapsedMs)
        {
            string path = ResolveExecuteCmdletResultPath(req, cmdletKey ?? "");
            try
            {
                var envelope = new
                {
                    ok,
                    error,
                    action = "executeCmdlet",
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    cmdletKey,
                    // The organization the server actually connected with (derived from the gated
                    // testbed tenant); falls back to whatever the caller passed if the server didn't say.
                    organization = NodeString(serverBody?["organization"]) ?? organization,
                    tenantId = tenantArg,
                    customerId,
                    matchedCustomerName,
                    // The failure discriminators from ps-execution-client (null on success).
                    kind = NodeString(serverBody?["kind"]),
                    containerErrorKind = NodeString(serverBody?["containerErrorKind"]),
                    // The cmdlet's OWN observed output — what a PowerShell ground-truth diff reads.
                    itemCount = NodeInt(serverBody?["itemCount"]),
                    items = serverBody?["items"],
                    rawResponse = serverBody?["rawResponse"],
                    // Round-trip time measured client-side (the real per-request child pwsh cold-start
                    // — #1400's childElapsedMs — is in the ps-execution container's own logs; this is
                    // the end-to-end wall clock including the connect handshake).
                    elapsedMs,
                    serverElapsedMs = NodeInt(serverBody?["elapsedMs"]),
                };

                File.WriteAllText(path,
                    JsonSerializer.Serialize(envelope, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log(BuildConsole.Services.ShaneAppProtocol.LogChannel,
                    $"couldn't write executeCmdlet result file {path}: {ex.Message}");
            }
        }

        /// <summary>Reads a JSON node as a bool, tolerating a non-bool node (null). Used to read the
        /// server envelope's top-line `ok`.</summary>
        private static bool? NodeBool(JsonNode? n)
        {
            if (n == null) return null;
            try { return n.GetValue<bool>(); }
            catch
            {
                try { return string.Equals(n.ToString(), "true", StringComparison.OrdinalIgnoreCase); }
                catch { return null; }
            }
        }
    }
}
