using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #900 (Epic #803) — executes manifest.PowerShellVerify: independent, out-of-band
    /// verification of what a write/read endpoint CLAIMED against ground truth read straight
    /// from Microsoft Graph by a REAL PowerShell (pwsh 7) cmdlet, signed in as Shane HIMSELF
    /// (delegated device-code identity), NOT as the app's own service principal.
    ///
    /// Shane's ask: "if a write action happens, we should use PowerShell execute locally as Me
    /// and run the proper get command to ensure our write actions worked properly. We should do
    /// the exact same thing with all our read endpoints too." The whole point of using his own
    /// delegated identity (rather than the app-only client-credentials the GraphTestExecutor uses)
    /// is that the verification is genuinely INDEPENDENT of whatever identity performed the
    /// original action — if the app wrote a value using its write app registration, we confirm it
    /// with a completely separate identity and code path, so a bug that makes the app misreport
    /// success can't also make the verification lie.
    ///
    /// Shape of one powerShellVerify entry (raw JSON, like graphTests/zohoTests):
    ///   {
    ///     "afterStep":   "userAccountEnabled",   // #877 variable name an earlier apiTests/graphTests
    ///                                             //   step captured (its extract `as`). THIS is the
    ///                                             //   "app-reported value" we diff against — resolved
    ///                                             //   via #877 interpolation, same as any other step.
    ///     "cmdlet":      "Get-MgUser -UserId {{userId}} | Select-Object -ExpandProperty AccountEnabled",
    ///     "compareField": { "matchType": "exact" | "contains" },   // default: exact
    ///     "timeoutMs":   60000                    // optional; hard ceiling so a run can NEVER hang
    ///   }
    ///
    /// The cmdlet's output is wrapped in `ConvertTo-Json` and PARSED as real JSON (the #872 lesson:
    /// parse structured JSON, never substring-match raw console text), reduced to a comparable value,
    /// and diffed against the app-captured value per matchType.
    ///
    /// AUTH — the hard part. `Connect-MgGraph` reuses Shane's locally cached delegated token silently
    /// when it's still valid (returns in a second or two, no prompt). When the cached token is missing
    /// or fully expired, the SDK would normally drop into an INTERACTIVE device-code flow that blocks
    /// forever waiting for a human to open a browser — fatal for an automated / #898-remote-triggered
    /// run. We force `-UseDeviceCode` (so the "needs auth" fallback prints a detectable device-code
    /// message to the console instead of silently popping a browser), watch the child's output for that
    /// message, and abort the moment it appears — plus a hard `timeoutMs` ceiling as a backstop — then
    /// fail THAT step clearly telling Shane to run `Connect-MgGraph` interactively once. It never hangs.
    ///
    /// Plugs into RunManifestAsync (#806) as the FINAL phase, after every HTTP/Graph/Zoho/UI step has
    /// run and populated the shared #877 variable store — so any value those steps captured is available
    /// to diff against. Returns TestStepResult entries folded into the ONE shared ManifestRunResult ->
    /// test-results/ pipeline (#807/#812) and streamed live via StepCompleted (#810), exactly like every
    /// other executor — never a separate output path. Because the #898 remote-trigger poll runs the SAME
    /// RunManifestAsync, a Claude-Code-triggered run includes and reports powerShellVerify with no special
    /// casing.
    ///
    /// Logs on the "testing.powershell-verify" channel via ActivityLog (this app's logging spine).
    /// </summary>
    public static class PowerShellTestExecutor
    {
        private const string Channel = "testing.powershell-verify";

        // Sentinels the generated pwsh script emits so the C# host can reliably locate the cmdlet's
        // JSON output and distinguish auth/setup/cmdlet failures from the actual result — never
        // substring-guessing against arbitrary console noise.
        private const string ResultBegin = "__PSVERIFY_RESULT_BEGIN__";
        private const string ResultEnd = "__PSVERIFY_RESULT_END__";
        private const string AuthRequiredMarker = "__PSVERIFY_AUTH_REQUIRED__";
        private const string SetupErrorMarker = "__PSVERIFY_SETUP_ERROR__";
        private const string CmdletErrorMarker = "__PSVERIFY_CMDLET_ERROR__";
        // Git #965 — the pwsh script emits the connected Get-MgContext TenantId, and (if that tenant
        // isn't in the injected isTestbed allowlist) a refusal marker BEFORE the verification cmdlet
        // ever runs. So the testbed gate is enforced in-process against the identity actually signed in.
        private const string TenantMarker = "__PSVERIFY_TENANT__";
        private const string TestbedRefusedMarker = "__PSVERIFY_TESTBED_REFUSED__";
        // Diagnostic line the script emits (pre- and post-connect) carrying the resolved
        // token-cache-relevant paths/state — loaded module version, USERPROFILE/LOCALAPPDATA, the
        // %USERPROFILE%\.mg AuthenticationRecord path + whether it exists, and the on-disk MSAL cache
        // files. Logged verbatim by the host so a delegated device-code token that fails to persist
        // across BuildConsole-spawned pwsh runs is diagnosable from ActivityLog alone, without redoing
        // the investigation. See RunPwshAsync's launch log for why the AuthenticationRecord matters.
        private const string DiagMarker = "__PSVERIFY_DIAG__";

        private const int DefaultTimeoutMs = 60000;

        // Interactive device-code sign-in window. When a Play Test / manual run hits a device-code
        // prompt (no valid cached delegated token), we do NOT abort like the headless path does —
        // we surface the real code + URL to Shane and keep the pwsh process alive this long so he can
        // actually complete sign-in in a browser. Connect-MgGraph is polling the whole time; the
        // instant sign-in succeeds it proceeds to the verification cmdlet and exits on its own, so no
        // manual re-run is needed. Deliberately generous (5 min) to cover opening a browser + MFA.
        private const int InteractiveDeviceCodeWaitMs = 300000;

        /// <summary>Git #810 — raised after each powerShellVerify step completes so the Test Runner window renders a telemetry card live during the run, same as every other executor.</summary>
        public static event Action<TestStepResult>? StepCompleted;

        /// <summary>The parsed contents of a Connect-MgGraph device-code prompt — the real code and
        /// verification URL pulled out of the child pwsh's output so the host can show them.</summary>
        public sealed class DeviceCodePrompt
        {
            public string UserCode = "";
            public string VerificationUrl = "";
            /// <summary>The raw device-code instruction line, for display fallback.</summary>
            public string Message = "";
        }

        /// <summary>How a surfaced device-code prompt ended, so the host can update/close its floaty.</summary>
        public sealed class DeviceCodeResolution
        {
            public bool SignedIn;
            public bool TimedOut;
            public string Message = "";
        }

        /// <summary>
        /// Interactive device-code bridge. Supplied by the host ONLY for an interactive run (Play Test /
        /// manual trigger). When present, a device-code prompt is parsed and surfaced non-blockingly
        /// (via <see cref="OnPrompt"/>) and the pwsh process is given real time to complete sign-in
        /// instead of being aborted; <see cref="OnResolved"/> fires once that process finishes.
        /// When null (the default — the #967 scheduled sweep and the #898 headless remote trigger both
        /// pass null), a device-code prompt keeps its original fast-abort behaviour with no UI.
        /// </summary>
        public sealed class DeviceCodeInteraction
        {
            /// <summary>Invoked (off the UI thread) the first time a device-code prompt is parsed from
            /// the child's output. The host marshals to the UI and shows a non-blocking floaty.</summary>
            public Action<DeviceCodePrompt>? OnPrompt;

            /// <summary>Invoked once the waiting pwsh process finishes after a prompt was shown — either
            /// signed in (connection established, cmdlet proceeding) or timed out waiting.</summary>
            public Action<DeviceCodeResolution>? OnResolved;
        }

        public static async Task<List<TestStepResult>> RunAsync(TestManifest manifest, TestRunVariables vars,
            DeviceCodeInteraction? deviceCode = null)
        {
            var results = new List<TestStepResult>();
            if (manifest.PowerShellVerify.Count == 0) return results;

            for (int i = 0; i < manifest.PowerShellVerify.Count; i++)
            {
                TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                var result = await RunOneAsync(vars, manifest.PowerShellVerify[i], i, manifest.PowerShellVerify.Count, deviceCode);
                results.Add(result);
                StepCompleted?.Invoke(result);
            }
            return results;
        }

        private static async Task<TestStepResult> RunOneAsync(TestRunVariables vars, JsonElement step, int index, int total,
            DeviceCodeInteraction? deviceCode)
        {
            var sw = Stopwatch.StartNew();

            string afterStep = GetString(step, "afterStep") ?? "";
            string cmdlet = GetString(step, "cmdlet") ?? "";
            string matchType = "exact";
            if (step.TryGetProperty("compareField", out var cf) && cf.ValueKind == JsonValueKind.Object)
            {
                string mt = GetString(cf, "matchType") ?? "";
                if (string.Equals(mt, "contains", StringComparison.OrdinalIgnoreCase)) matchType = "contains";
                else if (string.Equals(mt, "exact", StringComparison.OrdinalIgnoreCase)) matchType = "exact";
                // any other/absent value falls back to exact (recorded in Expected below).
            }
            int timeoutMs = GetInt(step, "timeoutMs") ?? DefaultTimeoutMs;
            if (timeoutMs < 5000) timeoutMs = 5000; // never let a too-small timeout make auth look "needed"

            string label = $"PS verify {(string.IsNullOrEmpty(afterStep) ? "?" : afterStep)} <- {Truncate(cmdlet, 60)}";

            if (string.IsNullOrWhiteSpace(cmdlet))
                return Finish(label, sw, false, "powerShellVerify step is missing a non-empty 'cmdlet'.",
                    "a real Get-* PowerShell cmdlet", "empty", "");
            if (string.IsNullOrWhiteSpace(afterStep))
                return Finish(label, sw, false, "powerShellVerify step is missing a non-empty 'afterStep' (the #877 variable an earlier step captured).",
                    "an earlier step's captured variable name", "empty", $"cmdlet: {cmdlet}");

            // Pause-on-unset (Epic #803, extends #953/#961) — a config var can be referenced here via the
            // cmdlet text OR via a bare afterStep (this executor wraps a brace-less afterStep as
            // {{afterStep}} before resolving, e.g. GRAPH_TEST_TENANT_ID). Prompt for any still-<unset>/
            // needsReview one before resolving, so a verification never runs against a "<unset>" ground
            // truth. No-op when nothing is unset; a dismissal falls through to the clear failures below.
            string afterStepToken = afterStep.Contains("{{", StringComparison.Ordinal) ? afterStep : "{{" + afterStep + "}}";
            await vars.PrepareAsync(afterStepToken, cmdlet);

            // The app-reported value: resolve the earlier step's captured value through #877
            // interpolation. `afterStep` names the variable that step stored via its extract `as`.
            string appValue;
            try
            {
                appValue = vars.Resolve(afterStepToken);
            }
            catch (VariableNotResolvedException)
            {
                return Finish(label, sw, false,
                    $"afterStep '{afterStep}' references a value no earlier step captured — add an extract {{ \"as\": \"{afterStep}\" }} to the apiTests/graphTests step whose write/read you're verifying.",
                    $"{{{{{afterStep}}}}} captured by an earlier step", "not captured", $"cmdlet: {cmdlet}");
            }

            // Resolve any {{...}} placeholders inside the cmdlet itself (e.g. {{userId}}).
            string resolvedCmdlet;
            try { resolvedCmdlet = vars.Resolve(cmdlet); }
            catch (VariableNotResolvedException ex)
            {
                return Finish(label, sw, false, $"cmdlet has unresolved variable(s): {ex.Message}",
                    "all {{...}} in the cmdlet captured by earlier steps", "unresolved", $"cmdlet: {cmdlet}");
            }

            ActivityLog.Log(Channel,
                $"[{index + 1}/{total}] verifying app value \"{Truncate(appValue, 80)}\" (from {{{{{afterStep}}}}}) against ground truth of: {resolvedCmdlet}");

            // Git #965 — hard testbed gate. Fetch the server's authoritative isTestbed=true tenant list
            // FIRST (fail-closed: if we can't fetch it, we refuse rather than run) and inject it into the
            // pwsh script as an allowlist. The script checks the connected Get-MgContext TenantId against
            // that allowlist AFTER Connect-MgGraph succeeds but BEFORE the verification cmdlet runs, so a
            // cmdlet can never read a non-testbed tenant. This is the deeper check #964 alone can't make:
            // not just "TenantId matches GRAPH_TEST_TENANT_ID", but "that tenant is genuinely testbed".
            List<string> allowedTestbedTenants;
            try
            {
                allowedTestbedTenants = await TestbedGate.GetTestbedTenantIdsAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(TestbedGate.Channel,
                    $"REFUSED [powerShellVerify {label}] — could not fetch the server's testbed list ({ex.Message}); fail-closed, no cmdlet run.");
                return Finish(label, sw, false,
                    $"testbed gate: could not verify the connected tenant against the server's testbed list ({ex.Message}) — refusing (fail-closed).",
                    "server testbed-customers list reachable", "unreachable",
                    $"cmdlet: {resolvedCmdlet}");
            }
            if (allowedTestbedTenants.Count == 0)
            {
                ActivityLog.Log(TestbedGate.Channel,
                    $"REFUSED [powerShellVerify {label}] — the server reports NO isTestbed=true customers; fail-closed, no cmdlet run.");
                return Finish(label, sw, false,
                    "testbed gate: the server's isTestbed=true customer list is empty — refusing to run any verification cmdlet (fail-closed).",
                    "at least one isTestbed=true customer", "none",
                    $"cmdlet: {resolvedCmdlet}");
            }

            // Git #995 — logged before the connect attempt so the log shows this step has an
            // out-of-band pwsh auth/connection phase in flight, same principle as UiTestExecutor's
            // captureResponse-armed logging: a hang here (e.g. a device-code prompt) should be
            // immediately visible as "still connecting" rather than a silent gap in the log.
            bool interactive = deviceCode != null;
            ActivityLog.Log(Channel,
                interactive
                    ? $"[{index + 1}/{total}] {label}: connecting via delegated Connect-MgGraph (silent if a valid cached token exists; on a device-code prompt the real code is surfaced and sign-in is awaited up to {InteractiveDeviceCodeWaitMs}ms; pre-prompt ceiling {timeoutMs}ms)..."
                    : $"[{index + 1}/{total}] {label}: connecting via delegated Connect-MgGraph (silent if a valid cached token exists; aborts on a device-code prompt; hard ceiling {timeoutMs}ms)...");

            var connectSw = Stopwatch.StartNew();
            PsRunOutcome outcome;
            try
            {
                outcome = await RunPwshAsync(resolvedCmdlet, timeoutMs, allowedTestbedTenants, deviceCode);
            }
            catch (Exception ex)
            {
                connectSw.Stop();
                ActivityLog.Log(Channel, $"[{index + 1}/{total}] {label}: pwsh launch failed after {connectSw.ElapsedMilliseconds}ms — {ex.Message}");
                return Finish(label, sw, false, $"failed to launch pwsh: {ex.Message}",
                    "pwsh (PowerShell 7) available", $"{ex.GetType().Name}: {ex.Message}",
                    "set POWERSHELL_VERIFY_PWSH_PATH to the pwsh.exe path if it isn't on PATH");
            }
            connectSw.Stop();
            ActivityLog.Log(Channel,
                $"[{index + 1}/{total}] {label}: auth/connection resolved as {outcome.Kind} in {connectSw.ElapsedMilliseconds}ms"
                + (string.IsNullOrEmpty(outcome.ConnectedTenant) ? "" : $" (connected tenant {outcome.ConnectedTenant})") + ".");

            switch (outcome.Kind)
            {
                case PsOutcomeKind.TestbedRefused:
                    ActivityLog.Log(TestbedGate.Channel,
                        $"REFUSED [powerShellVerify {label}] — connected tenant '{outcome.ConnectedTenant}' is NOT in the server's isTestbed=true list; cmdlet did NOT run.");
                    return Finish(label, sw, false,
                        $"testbed gate: the signed-in Graph tenant '{outcome.ConnectedTenant}' is NOT a confirmed isTestbed=true customer — refusing to run the verification cmdlet against a non-testbed tenant.",
                        "connected tenant flagged isTestbed=true on the server", $"connected tenant {outcome.ConnectedTenant} not testbed",
                        $"cmdlet: {resolvedCmdlet}; connectedTenant: {outcome.ConnectedTenant}");

                case PsOutcomeKind.PwshNotFound:
                    return Finish(label, sw, false,
                        "pwsh (PowerShell 7) was not found. Install PowerShell 7 or set POWERSHELL_VERIFY_PWSH_PATH to its full path.",
                        "pwsh on PATH", "not found", outcome.Detail);

                case PsOutcomeKind.SetupError:
                    return Finish(label, sw, false,
                        $"Microsoft.Graph PowerShell module not available: {outcome.Detail}. Install it once with: Install-Module Microsoft.Graph -Scope CurrentUser.",
                        "Microsoft.Graph.Authentication installed", "module missing", outcome.RawPreview);

                case PsOutcomeKind.AuthRequired:
                    return Finish(label, sw, false,
                        "delegated Graph auth needed — no valid cached token. Run `Connect-MgGraph` interactively once in a pwsh window signed in as yourself, then re-run this test. (Auto-triggered runs never block on the device-code prompt.)",
                        "a valid locally cached delegated token", "interactive sign-in required",
                        string.IsNullOrEmpty(outcome.Detail) ? outcome.RawPreview : outcome.Detail);

                case PsOutcomeKind.Timeout:
                    return Finish(label, sw, false,
                        $"pwsh did not finish within {timeoutMs}ms — most likely delegated auth is required (device-code prompt). Run `Connect-MgGraph` interactively once as yourself, then re-run.",
                        $"cmdlet result within {timeoutMs}ms", "timed out", outcome.RawPreview);

                case PsOutcomeKind.CmdletError:
                    return Finish(label, sw, false, $"the verification cmdlet errored: {outcome.Detail}",
                        "cmdlet returns a value", "cmdlet threw",
                        $"cmdlet: {resolvedCmdlet}; output: {outcome.RawPreview}");

                case PsOutcomeKind.NoResult:
                    return Finish(label, sw, false,
                        "pwsh exited without emitting a result block — the cmdlet may have produced no output.",
                        "cmdlet result", "no result emitted",
                        $"cmdlet: {resolvedCmdlet}; output: {outcome.RawPreview}");
            }

            // Git #965 — reaching here means Connect-MgGraph succeeded AND the connected tenant passed
            // the in-script isTestbed allowlist. Log the gate pass loudly on the same channel as refusals.
            ActivityLog.Log(TestbedGate.Channel,
                $"PASS [powerShellVerify {label}] — connected tenant '{outcome.ConnectedTenant}' is a confirmed isTestbed=true customer; proceeding.");

            // Ok — reduce the parsed JSON ground truth to a comparable value and diff it.
            string groundTruth = ReducePsResult(outcome.ResultJson, out string reduceNote);
            bool passed = Matches(groundTruth, appValue, matchType);

            string expected = $"PowerShell ground truth {matchType} app value \"{Truncate(appValue, 120)}\" (from {{{{{afterStep}}}}})";
            string actual = $"PowerShell returned \"{Truncate(groundTruth, 120)}\"{(string.IsNullOrEmpty(reduceNote) ? "" : $" ({reduceNote})")}";
            string detail = passed
                ? $"ground truth \"{Truncate(groundTruth, 60)}\" {matchType}-matches app value \"{Truncate(appValue, 60)}\""
                : $"MISMATCH: PowerShell (as you) says \"{Truncate(groundTruth, 60)}\" but the app reported \"{Truncate(appValue, 60)}\" ({matchType})";
            string context = $"cmdlet: {resolvedCmdlet}; raw PS JSON: {Truncate(outcome.ResultJson, 300)}";

            string? durationError = HttpTestExecutor.CheckMaxDuration(step, sw.ElapsedMilliseconds);
            if (durationError != null)
            {
                passed = false;
                detail = $"{detail}; {durationError}";
            }

            return Finish(label, sw, passed, detail, expected, actual, context);
        }

        // ── pwsh process orchestration ───────────────────────────────────────
        private enum PsOutcomeKind { Ok, PwshNotFound, SetupError, AuthRequired, Timeout, CmdletError, NoResult, TestbedRefused }

        private sealed class PsRunOutcome
        {
            public PsOutcomeKind Kind;
            public string ResultJson = "";
            public string Detail = "";
            public string RawPreview = "";
            // Git #965 — the tenant Connect-MgGraph actually signed into (Get-MgContext.TenantId), for
            // testbed-gate logging; empty when the run never reached a connected context.
            public string ConnectedTenant = "";
        }

        /// <summary>
        /// Runs the delegated Connect-MgGraph + verification cmdlet in a pwsh 7 child process, capturing
        /// its output as structured JSON.
        ///
        /// Two device-code behaviours, selected by whether the host supplied a <paramref name="deviceCode"/>:
        ///  • Headless (deviceCode == null — the #967 scheduled sweep, the #898 remote trigger): aborts the
        ///    instant a device-code prompt is detected on the child's output, with a hard
        ///    <paramref name="timeoutMs"/> ceiling as a backstop. Never blocks. Unchanged from before.
        ///  • Interactive (deviceCode != null — Play Test / manual trigger): on a device-code prompt it
        ///    parses the real code + URL, surfaces them non-blockingly via <c>deviceCode.OnPrompt</c>, and
        ///    keeps the process alive up to <see cref="InteractiveDeviceCodeWaitMs"/> so Shane can complete
        ///    sign-in — after which Connect-MgGraph proceeds to the verification cmdlet automatically. The
        ///    <paramref name="timeoutMs"/> ceiling still bounds the PRE-prompt phase, so a connect that
        ///    hangs without ever printing a code is still cut off.
        /// </summary>
        private static async Task<PsRunOutcome> RunPwshAsync(string resolvedCmdlet, int timeoutMs,
            IReadOnlyList<string> allowedTestbedTenants, DeviceCodeInteraction? deviceCode)
        {
            bool interactive = deviceCode != null;
            string script = BuildScript(resolvedCmdlet, allowedTestbedTenants);
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));

            var psi = new ProcessStartInfo
            {
                FileName = ResolvePwshPath(),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-EncodedCommand");
            psi.ArgumentList.Add(encoded);

            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            // Headless: signals "abort now". Interactive: signals "a device-code prompt appeared, surface it
            // and wait" (carrying the parsed code/URL). Only one is ever armed, per `interactive`.
            var authNeeded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var deviceCodeSeen = new TaskCompletionSource<DeviceCodePrompt>(TaskCreationOptions.RunContinuationsAsynchronously);
            int devicePromptFired = 0;

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };

            void OnLine(StringBuilder sink, string? data)
            {
                if (data == null) return;
                lock (sink) sink.AppendLine(data);
                // Surface the script's cache-diagnostic lines to the log as they arrive (live, even if
                // the run later aborts on a device-code prompt), so the resolved cache paths/record
                // state are always captured.
                if (data.IndexOf(DiagMarker, StringComparison.Ordinal) >= 0)
                    ActivityLog.Log(Channel, "pwsh cache diag: " + AfterMarker(data, DiagMarker));
                if (!LooksLikeAuthPrompt(data)) return;

                if (interactive)
                {
                    // We have no usable cached token, but this is an interactive run — DON'T abort.
                    // Parse the real code/URL (from the full snapshot so the whole instruction line is
                    // available) and signal the wait loop to surface it and give the flow real time.
                    if (Interlocked.Exchange(ref devicePromptFired, 1) == 0)
                        deviceCodeSeen.TrySetResult(ParseDeviceCode(Snapshot(stdout, stderr)));
                }
                else
                {
                    // Headless run — abort immediately rather than let the SDK block polling for a human.
                    authNeeded.TrySetResult(true);
                }
            }

            proc.OutputDataReceived += (_, e) => OnLine(stdout, e.Data);
            proc.ErrorDataReceived += (_, e) => OnLine(stderr, e.Data);

            // Log the resolved cache-relevant environment the child will inherit, at launch. The child
            // is spawned with UseShellExecute=false and no EnvironmentVariables edits, so it inherits
            // BuildConsole's (Shane's interactive) environment verbatim — USERPROFILE/LOCALAPPDATA here
            // ARE what the child sees. The delegated device-code flow can only SILENTLY reuse a cached
            // token when the Azure.Identity AuthenticationRecord (%USERPROFILE%\.mg\mg.authrecord.json)
            // exists: the Graph SDK's device-code path gates silent reuse on File.Exists(that record),
            // so if it's absent, Connect-MgGraph -UseDeviceCode re-prompts every run even though the
            // DPAPI MSAL token cache itself persists. Logging this makes a recurrence self-explanatory.
            string userProfile = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
            string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
            string mgDir = string.IsNullOrEmpty(userProfile) ? "" : System.IO.Path.Combine(userProfile, ".mg");
            string authRecordPath = string.IsNullOrEmpty(mgDir) ? "" : System.IO.Path.Combine(mgDir, "mg.authrecord.json");
            bool authRecordExists = !string.IsNullOrEmpty(authRecordPath) && System.IO.File.Exists(authRecordPath);
            ActivityLog.Log(Channel,
                $"pwsh launch: exe={psi.FileName} USERPROFILE={userProfile} LOCALAPPDATA={localAppData} .mg={mgDir} "
                + $"authRecordExists={authRecordExists} — delegated device-code silent reuse REQUIRES mg.authrecord.json; "
                + (authRecordExists
                    ? "present, so a valid cached token should reconnect silently."
                    : "ABSENT, so a fresh device-code sign-in prompt is expected until one completes and the record is written."));

            try
            {
                proc.Start();
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                return new PsRunOutcome { Kind = PsOutcomeKind.PwshNotFound, Detail = ex.Message };
            }

            // Close stdin so any accidental Read-Host in the child hits EOF instantly instead of hanging.
            try { proc.StandardInput.Close(); } catch { /* best effort */ }
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            var exitTask = proc.WaitForExitAsync();
            var cancelTask = Task.Delay(Timeout.Infinite, TestQueueService.Instance.ActiveRunToken);
            var completed = await Task.WhenAny(exitTask, authNeeded.Task, deviceCodeSeen.Task, Task.Delay(timeoutMs), cancelTask);

            if (completed == cancelTask)
            {
                TryKill(proc);
                TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
            }

            if (completed == deviceCodeSeen.Task)
            {
                // Interactive-only branch. Surface the real code/URL and keep the process alive while Shane
                // signs in — the process proceeds to the cmdlet and exits on its own once auth completes.
                var prompt = deviceCodeSeen.Task.Result;
                ActivityLog.Log(Channel,
                    $"device-code sign-in prompt detected (code {(string.IsNullOrEmpty(prompt.UserCode) ? "?" : prompt.UserCode)}, url {prompt.VerificationUrl}) — surfacing to Shane and waiting up to {InteractiveDeviceCodeWaitMs}ms for interactive sign-in (not aborting).");
                try { deviceCode!.OnPrompt?.Invoke(prompt); } catch { /* host UI is best-effort */ }

                var afterPrompt = await Task.WhenAny(exitTask, Task.Delay(InteractiveDeviceCodeWaitMs), cancelTask);
                if (afterPrompt == cancelTask)
                {
                    TryKill(proc);
                    TestQueueService.Instance.ActiveRunToken.ThrowIfCancellationRequested();
                }
                if (afterPrompt != exitTask)
                {
                    // Shane never completed sign-in in time. Now abort (with the extended window spent).
                    TryKill(proc);
                    string rawTimeout = Snapshot(stdout, stderr);
                    ActivityLog.Log(Channel,
                        $"device-code sign-in NOT completed within {InteractiveDeviceCodeWaitMs}ms — timed out waiting; aborted.");
                    try { deviceCode!.OnResolved?.Invoke(new DeviceCodeResolution { TimedOut = true, Message = $"Timed out waiting for sign-in ({InteractiveDeviceCodeWaitMs / 1000}s)." }); }
                    catch { /* best-effort */ }
                    return new PsRunOutcome
                    {
                        Kind = PsOutcomeKind.Timeout,
                        Detail = $"device-code sign-in was surfaced but not completed within {InteractiveDeviceCodeWaitMs / 1000}s — sign in via the code/link, then re-run.",
                        RawPreview = Truncate(rawTimeout, 400),
                        ConnectedTenant = Contains(rawTimeout, TenantMarker) ? AfterMarker(rawTimeout, TenantMarker) : "",
                    };
                }

                // Signed in — the process ran to completion. Classify and tell the floaty it succeeded.
                try { proc.WaitForExit(); } catch { /* already exited */ }
                string signedInText = Snapshot(stdout, stderr);
                var signedInOutcome = Classify(signedInText);
                bool connected = signedInOutcome.Kind != PsOutcomeKind.AuthRequired;
                ActivityLog.Log(Channel,
                    $"device-code sign-in completed — connection {(connected ? "succeeded" : "still not established")}; outcome {signedInOutcome.Kind}"
                    + (string.IsNullOrEmpty(signedInOutcome.ConnectedTenant) ? "" : $" (tenant {signedInOutcome.ConnectedTenant})") + ".");
                try
                {
                    deviceCode!.OnResolved?.Invoke(new DeviceCodeResolution
                    {
                        SignedIn = connected,
                        Message = connected ? "Signed in — continuing verification." : "Sign-in didn't establish a Graph connection.",
                    });
                }
                catch { /* best-effort */ }
                return signedInOutcome;
            }

            if (completed != exitTask)
            {
                // Headless device-code abort (authNeeded), OR the hard ceiling elapsed before any
                // device-code prompt appeared (in either mode). Kill and classify.
                TryKill(proc);
                string raw = Snapshot(stdout, stderr);
                bool sawPrompt = completed == authNeeded.Task || LooksLikeAuthPrompt(raw);
                return new PsRunOutcome
                {
                    Kind = sawPrompt ? PsOutcomeKind.AuthRequired : PsOutcomeKind.Timeout,
                    Detail = sawPrompt ? "device-code sign-in prompt detected — aborted before it could block." : "",
                    RawPreview = Truncate(raw, 400),
                    ConnectedTenant = Contains(raw, TenantMarker) ? AfterMarker(raw, TenantMarker) : "",
                };
            }

            // Process exited on its own — flush any buffered async output, then classify by sentinel.
            try { proc.WaitForExit(); } catch { /* already exited */ }
            string outText = Snapshot(stdout, stderr);
            return Classify(outText);
        }

        /// <summary>Pulls the real device code and verification URL out of the Graph SDK's device-code
        /// instruction text (e.g. "To sign in, use a web browser to open the page
        /// https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate."). Falls back
        /// to the well-known devicelogin URL and an empty code if the exact shape isn't matched, so the
        /// floaty still shows a usable link.</summary>
        private static DeviceCodePrompt ParseDeviceCode(string text)
        {
            string s = text ?? "";
            // Prefer the single line that actually carries the prompt, so a URL/token elsewhere in the
            // accumulated output can't be mistaken for the code.
            string line = "";
            foreach (var l in s.Split('\n'))
            {
                if (LooksLikeAuthPrompt(l)) { line = l.Trim(); break; }
            }
            string src = line.Length > 0 ? line : s;

            // URL — prefer one pointing at devicelogin / microsoft.com, else the first http(s) URL.
            string url = "";
            var urlMatches = Regex.Matches(src, @"https?://[^\s""']+", RegexOptions.IgnoreCase);
            foreach (Match m in urlMatches)
            {
                if (m.Value.IndexOf("devicelogin", StringComparison.OrdinalIgnoreCase) >= 0
                    || m.Value.IndexOf("microsoft.com", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    url = m.Value;
                    break;
                }
            }
            if (url.Length == 0 && urlMatches.Count > 0) url = urlMatches[0].Value;
            if (url.Length == 0) url = "https://microsoft.com/devicelogin";
            url = url.TrimEnd('.', ',', ')', ']', '"', '\'');

            // Code — "enter the code XXXX to authenticate". Codes are alphanumeric, sometimes hyphenated.
            string code = "";
            var codeMatch = Regex.Match(src, @"enter the code\s+([A-Za-z0-9][A-Za-z0-9-]{3,})", RegexOptions.IgnoreCase);
            if (codeMatch.Success) code = codeMatch.Groups[1].Value;

            return new DeviceCodePrompt { UserCode = code, VerificationUrl = url, Message = Truncate(src.Trim(), 400) };
        }

        /// <summary>Classifies fully-flushed pwsh output by the sentinels the script emits.</summary>
        private static PsRunOutcome Classify(string outText)
        {
            string preview = Truncate(outText, 400);
            // Git #965 — the connected tenant is emitted right after Connect-MgGraph, before any gate
            // decision, so surface it on every outcome for logging/diagnostics.
            string connectedTenant = Contains(outText, TenantMarker) ? AfterMarker(outText, TenantMarker) : "";

            if (Contains(outText, AuthRequiredMarker))
                return new PsRunOutcome { Kind = PsOutcomeKind.AuthRequired, Detail = AfterMarker(outText, AuthRequiredMarker), RawPreview = preview, ConnectedTenant = connectedTenant };
            if (Contains(outText, SetupErrorMarker))
                return new PsRunOutcome { Kind = PsOutcomeKind.SetupError, Detail = AfterMarker(outText, SetupErrorMarker), RawPreview = preview, ConnectedTenant = connectedTenant };
            // Git #965 — the in-script testbed gate refused: connected tenant isn't isTestbed-flagged.
            if (Contains(outText, TestbedRefusedMarker))
                return new PsRunOutcome { Kind = PsOutcomeKind.TestbedRefused, Detail = AfterMarker(outText, TestbedRefusedMarker), RawPreview = preview, ConnectedTenant = connectedTenant };

            int begin = outText.IndexOf(ResultBegin, StringComparison.Ordinal);
            int end = outText.IndexOf(ResultEnd, StringComparison.Ordinal);
            if (begin >= 0 && end > begin)
            {
                string inner = outText.Substring(begin + ResultBegin.Length, end - (begin + ResultBegin.Length)).Trim();
                if (Contains(inner, CmdletErrorMarker))
                    return new PsRunOutcome { Kind = PsOutcomeKind.CmdletError, Detail = AfterMarker(inner, CmdletErrorMarker), RawPreview = preview, ConnectedTenant = connectedTenant };
                if (string.IsNullOrWhiteSpace(inner) || inner == "null")
                    return new PsRunOutcome { Kind = PsOutcomeKind.NoResult, RawPreview = preview, ConnectedTenant = connectedTenant };
                return new PsRunOutcome { Kind = PsOutcomeKind.Ok, ResultJson = inner, RawPreview = preview, ConnectedTenant = connectedTenant };
            }

            // No result block and no known marker — could be a device-code prompt with no clean exit,
            // or some other failure. Treat a visible auth prompt as auth-required, else no-result.
            if (LooksLikeAuthPrompt(outText))
                return new PsRunOutcome { Kind = PsOutcomeKind.AuthRequired, RawPreview = preview, ConnectedTenant = connectedTenant };
            return new PsRunOutcome { Kind = PsOutcomeKind.NoResult, RawPreview = preview, ConnectedTenant = connectedTenant };
        }

        /// <summary>The pwsh script: delegated Connect-MgGraph (NOT app-only), then the cmdlet as JSON,
        /// all fenced by sentinels. Built as a here-doc-free interpolated string; passed via
        /// -EncodedCommand so no shell quoting of the cmdlet is ever needed.</summary>
        private static string BuildScript(string resolvedCmdlet, IReadOnlyList<string> allowedTestbedTenants)
        {
            // Git #965 — the isTestbed=true tenant allowlist, embedded as a pwsh string-array literal.
            // Values are GUID-sanitized by TestbedGate before we get here; single-quotes are still
            // doubled defensively. `-notcontains` is case-insensitive, which suits tenant GUIDs.
            string allowlist = allowedTestbedTenants.Count == 0
                ? "@()"
                : "@(" + string.Join(",", allowedTestbedTenants.Select(t => "'" + t.Replace("'", "''") + "'")) + ")";

            return
                "$ErrorActionPreference = 'Stop'\n" +
                "$ProgressPreference = 'SilentlyContinue'\n" +
                "$WarningPreference = 'SilentlyContinue'\n" +
                // Import the NEWEST installed Microsoft.Graph.Authentication, not whatever a bare
                // Import-Module resolves to. PowerShell resolves a bare `Import-Module Name` against the
                // FIRST PSModulePath entry that contains the module — which on Shane's box is a stale
                // 2.29.1 under D:\Shane\Documents shadowing the newer 2.38.0 in Program Files. Newer SDK
                // builds have materially more robust delegated-token / AuthenticationRecord resolution
                // (keyed + legacy record fallback, login-hint matching). All versions share the SAME
                // on-disk cache (%USERPROFILE%\.mg\mg.authrecord.json + the .IdentityService MSAL cache),
                // so this reuses Shane's existing cache rather than orphaning it.
                "try {\n" +
                "  $__mgMod = Get-Module Microsoft.Graph.Authentication -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1\n" +
                "  if ($__mgMod) { Import-Module $__mgMod.Path -ErrorAction Stop } else { Import-Module Microsoft.Graph.Authentication -ErrorAction Stop }\n" +
                "}\n" +
                "catch { Write-Output ('" + SetupErrorMarker + " ' + $_.Exception.Message); exit 4 }\n" +
                // Diagnostic BEFORE connecting: the resolved cache-relevant paths/state. Delegated
                // device-code silent reuse needs BOTH the persistent MSAL token cache AND the
                // AuthenticationRecord (%USERPROFILE%\.mg\mg.authrecord.json); a missing record is
                // exactly what forces Connect-MgGraph -UseDeviceCode to re-prompt despite a valid cache.
                "$__loaded = Get-Module Microsoft.Graph.Authentication\n" +
                "$__mgDir = Join-Path $env:USERPROFILE '.mg'\n" +
                "$__authRec = Join-Path $__mgDir 'mg.authrecord.json'\n" +
                "$__idsvc = Join-Path $env:LOCALAPPDATA '.IdentityService'\n" +
                "$__cacheFiles = (Get-ChildItem -Path $__idsvc -Filter 'mg.msal.cache*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ','\n" +
                "Write-Output ('" + DiagMarker + " pre-connect module=' + $__loaded.Version + ' base=' + $__loaded.ModuleBase + ' user=' + $env:USERNAME + ' USERPROFILE=' + $env:USERPROFILE + ' LOCALAPPDATA=' + $env:LOCALAPPDATA + ' authRecord=' + $__authRec + ' authRecordExists=' + (Test-Path $__authRec) + ' msalCache=[' + $__cacheFiles + ']')\n" +
                // Silent when a valid cached delegated token + AuthenticationRecord exist; -UseDeviceCode
                // makes the "needs auth" fallback a detectable device-code prompt (no silent browser pop).
                // -ContextScope CurrentUser is the documented default for this delegated path on Windows,
                // but we set it explicitly so the on-disk (not in-process) cache is used unambiguously,
                // independent of any host/interactivity heuristic.
                "try { Connect-MgGraph -UseDeviceCode -NoWelcome -ContextScope CurrentUser -ErrorAction Stop }\n" +
                "catch { Write-Output ('" + AuthRequiredMarker + " ' + $_.Exception.Message); exit 3 }\n" +
                "$ctx = Get-MgContext\n" +
                "if (-not $ctx) { Write-Output '" + AuthRequiredMarker + " no Graph context after connect'; exit 3 }\n" +
                // Diagnostic AFTER connecting: whether the record now exists on disk (proves this run
                // actually persisted a reusable record) plus the resolved context identity/scope.
                "Write-Output ('" + DiagMarker + " post-connect AuthType=' + $ctx.AuthType + ' ContextScope=' + $ctx.ContextScope + ' TokenCredentialType=' + $ctx.TokenCredentialType + ' authRecordExistsNow=' + (Test-Path $__authRec))\n" +
                // Enforce that verification uses a DELEGATED identity, never app-only — the whole point.
                "if ($ctx.AuthType -and $ctx.AuthType -ne 'Delegated') { Write-Output ('" + AuthRequiredMarker + " context AuthType=' + $ctx.AuthType + ' (expected Delegated; run Connect-MgGraph interactively as yourself)'); exit 3 }\n" +
                // Git #965 — hard testbed gate, enforced AFTER Connect-MgGraph succeeds but BEFORE the
                // verification cmdlet runs. Emit the connected tenant (for the C# host to log), then
                // refuse outright if it isn't in the server's isTestbed=true allowlist — the cmdlet
                // never executes against a non-testbed tenant.
                "$connectedTenant = [string]$ctx.TenantId\n" +
                "Write-Output ('" + TenantMarker + " ' + $connectedTenant)\n" +
                "$allowedTestbed = " + allowlist + "\n" +
                "if ($allowedTestbed -notcontains $connectedTenant) { Write-Output ('" + TestbedRefusedMarker + " ' + $connectedTenant); exit 5 }\n" +
                "Write-Output '" + ResultBegin + "'\n" +
                "try {\n" +
                "  $__json = " + resolvedCmdlet + " | ConvertTo-Json -Depth 8 -Compress\n" +
                "  if ($null -eq $__json) { $__json = 'null' }\n" +
                "  Write-Output $__json\n" +
                "} catch { Write-Output ('" + CmdletErrorMarker + " ' + $_.Exception.Message) }\n" +
                "Write-Output '" + ResultEnd + "'\n";
        }

        private static string ResolvePwshPath()
        {
            string? overridePath = Environment.GetEnvironmentVariable("POWERSHELL_VERIFY_PWSH_PATH");
            return string.IsNullOrWhiteSpace(overridePath) ? "pwsh" : overridePath;
        }

        /// <summary>True for the console text the Graph SDK prints when it needs an interactive
        /// device-code sign-in — the signal that no usable cached token exists.</summary>
        private static bool LooksLikeAuthPrompt(string? s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            return s.IndexOf("devicelogin", StringComparison.OrdinalIgnoreCase) >= 0
                || s.IndexOf("to sign in", StringComparison.OrdinalIgnoreCase) >= 0
                || s.IndexOf("enter the code", StringComparison.OrdinalIgnoreCase) >= 0
                || s.IndexOf(AuthRequiredMarker, StringComparison.Ordinal) >= 0;
        }

        /// <summary>Reduce ConvertTo-Json output to a single comparable string: a scalar becomes its
        /// plain value (string text, number, true/false), anything structural stays as compact JSON.
        /// Parses real JSON per the #872 lesson — never substring-matches raw console text.</summary>
        private static string ReducePsResult(string rawJson, out string note)
        {
            note = "";
            string trimmed = (rawJson ?? "").Trim();
            if (trimmed.Length == 0) { note = "empty"; return ""; }
            try
            {
                using var doc = JsonDocument.Parse(trimmed);
                var el = doc.RootElement;
                switch (el.ValueKind)
                {
                    case JsonValueKind.String: return el.GetString() ?? "";
                    case JsonValueKind.Number: return el.GetRawText();
                    case JsonValueKind.True: return "true";
                    case JsonValueKind.False: return "false";
                    case JsonValueKind.Null: note = "null"; return "";
                    default: return el.GetRawText(); // object / array — compact JSON text
                }
            }
            catch (JsonException)
            {
                note = "non-json";
                return trimmed;
            }
        }

        private static bool Matches(string groundTruth, string appValue, string matchType)
        {
            string g = (groundTruth ?? "").Trim();
            string a = (appValue ?? "").Trim();
            return string.Equals(matchType, "contains", StringComparison.OrdinalIgnoreCase)
                ? g.IndexOf(a, StringComparison.OrdinalIgnoreCase) >= 0
                : string.Equals(g, a, StringComparison.OrdinalIgnoreCase);
        }

        private static void TryKill(Process proc)
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
        }

        private static string Snapshot(StringBuilder stdout, StringBuilder stderr)
        {
            string o, e;
            lock (stdout) o = stdout.ToString();
            lock (stderr) e = stderr.ToString();
            return string.IsNullOrEmpty(e) ? o : o + "\n" + e;
        }

        private static bool Contains(string haystack, string needle) => haystack.IndexOf(needle, StringComparison.Ordinal) >= 0;

        private static string AfterMarker(string text, string marker)
        {
            int i = text.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return "";
            string rest = text.Substring(i + marker.Length);
            int nl = rest.IndexOf('\n');
            return (nl >= 0 ? rest.Substring(0, nl) : rest).Trim();
        }

        private static string? GetString(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static int? GetInt(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : (int?)null;

        private static string Truncate(string s, int max) => string.IsNullOrEmpty(s) ? "" : (s.Length > max ? s.Substring(0, max) + "..." : s);

        private static TestStepResult Finish(string label, Stopwatch sw, bool passed, string detail,
            string expected = "", string actual = "", string context = "")
        {
            sw.Stop();
            ActivityLog.Log(Channel, (passed ? "PASS " : "FAIL ") + $"{label} ({sw.ElapsedMilliseconds}ms) - {detail}");
            return new TestStepResult
            {
                Kind = "powershell", Label = label, Passed = passed, Detail = detail, DurationMs = sw.ElapsedMilliseconds,
                Expected = expected, Actual = actual, Context = context,
            };
        }
    }
}
