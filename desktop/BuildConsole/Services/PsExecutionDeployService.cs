using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Result of one <c>az</c> CLI invocation.
    /// </summary>
    public sealed class AzCliResult
    {
        public bool Ok => ExitCode == 0;
        public int ExitCode { get; init; }
        public string Stdout { get; init; } = "";
        public string Stderr { get; init; } = "";
    }

    /// <summary>
    /// The current serving revision of a ps-execution Container App, read from the
    /// Azure control plane (<c>az containerapp revision list</c>).
    /// </summary>
    public sealed class PsExecutionRevisionInfo
    {
        public string Name { get; init; } = "";
        public string Image { get; init; } = "";
        public bool Active { get; init; }
        public int TrafficWeight { get; init; }
        public string CreatedTime { get; init; } = "";
    }

    /// <summary>
    /// #1277 — automates the Docker build + ACR push + revision deploy of the
    /// <c>ps-execution</c> container to the ISOLATED DEV Container App
    /// (<c>ca-ps-execution-dev</c>), removing Shane from the redeploy loop so a
    /// build agent (#1482/#1483) can iterate on its own.
    ///
    /// DEV-ONLY BY CONSTRUCTION (#1385): every target here is a hardcoded const
    /// pointing at the dev Container App. This service exposes NO parameter for the
    /// Container App name, so there is structurally no way for an agent-triggered
    /// deploy to reach production <c>ca-ps-execution</c> — the exact isolation #1385
    /// established and #1277's brief calls non-negotiable. <see cref="ProdContainerApp"/>
    /// exists only so a guard can assert we never accidentally name it.
    ///
    /// Uses <c>az acr build</c> (server-side image build in ACR — no local Docker
    /// daemon needed) and <c>az containerapp update --revision-suffix</c> (forces a
    /// fresh revision that pulls the just-built mutable <c>:dev</c> tag). Every
    /// invocation logs on <see cref="LogChannel"/> via <see cref="ActivityLog"/>.
    /// </summary>
    public sealed class PsExecutionDeployService
    {
        public const string LogChannel = "integration.azure";

        // --- DEV target (the only thing this service can touch) -------------------
        public const string Registry = "acrsmccaw2184";
        public const string ResourceGroup = "rg-smccaw-2184";
        public const string DevContainerApp = "ca-ps-execution-dev";
        public const string DevImageTag = "ps-execution:dev";
        public const string DevImageRef = "acrsmccaw2184.azurecr.io/ps-execution:dev";

        /// <summary>The production app — named ONLY so the guard can refuse it. Never deployed to from here.</summary>
        public const string ProdContainerApp = "ca-ps-execution";

        // #1617 — bounded polling window for confirming which revision is actually serving.
        public static readonly TimeSpan DefaultServingRevisionTimeout = TimeSpan.FromSeconds(90);
        public static readonly TimeSpan DefaultServingRevisionPollInterval = TimeSpan.FromSeconds(3);

        private readonly Action<string, ShaneAppLogLevel>? _onLine;

        /// <param name="onLine">Optional live line sink (e.g. the shaneapp:// stream). Null for a headless call.</param>
        public PsExecutionDeployService(Action<string, ShaneAppLogLevel>? onLine = null)
        {
            _onLine = onLine;
        }

        private void Emit(string line, ShaneAppLogLevel level = ShaneAppLogLevel.Info)
        {
            try { _onLine?.Invoke(line, level); } catch { }
        }

        /// <summary>
        /// Confirms the build machine's <c>az</c> CLI holds a valid NON-INTERACTIVE
        /// context — <c>az account show</c> must succeed without prompting. This is
        /// #1277's stated precondition: if it fails, the caller must render an honest
        /// blocked state rather than let a deploy stall on an interactive login.
        /// </summary>
        public async Task<AzCliResult> CheckAzContextAsync(CancellationToken ct = default)
        {
            Emit("Checking az CLI context (az account show)…", ShaneAppLogLevel.Info);
            var r = await RunAzAsync("account show -o json", streamLines: false, ct);
            if (r.Ok) Emit("az context OK — non-interactive session is valid.", ShaneAppLogLevel.Success);
            else Emit("az context check FAILED — no valid non-interactive session. Deploy is blocked until `az login` is done on the build machine.", ShaneAppLogLevel.Error);
            return r;
        }

        /// <summary>
        /// Reads the DEV Container App's current ACTIVE (serving) revision(s) from the
        /// Azure control plane. This is the authoritative "which revision did Azure
        /// switch traffic to" answer; the container's own <c>/healthz</c> self-report
        /// is the complementary "which code is genuinely running" answer.
        /// </summary>
        public async Task<AzCliResult> GetServingRevisionRawAsync(CancellationToken ct = default)
        {
            const string query = "[?properties.active].{name:name,image:properties.template.containers[0].image,active:properties.active,traffic:properties.trafficWeight,created:properties.createdTime}";
            return await RunAzAsync(
                $"containerapp revision list -n {DevContainerApp} -g {ResourceGroup} --query \"{query}\" -o json",
                streamLines: false, ct);
        }

        /// <summary>
        /// Parsed convenience wrapper over <see cref="GetServingRevisionRawAsync"/> — a single,
        /// unconfirmed read. Prefer <see cref="WaitForServingRevisionAsync"/> after a deploy,
        /// which polls until the answer is actually trustworthy (#1617).
        /// </summary>
        public async Task<PsExecutionRevisionInfo?> GetServingRevisionAsync(CancellationToken ct = default)
        {
            var r = await GetServingRevisionRawAsync(ct);
            if (!r.Ok) return null;
            var (selected, _) = SelectServingRevision(ParseActiveRevisions(r.Stdout), expectedSuffix: null);
            return selected;
        }

        /// <summary>
        /// #1617 — polls <see cref="GetServingRevisionRawAsync"/> until the answer can be
        /// trusted, instead of the old single-shot read that could (and did) report a stale
        /// revision. During a Container Apps traffic switch, Azure can report MORE THAN ONE
        /// revision as <c>active: true</c> at once (the old one fading out, the new one ramping
        /// up) — taking "the first active entry" is not deterministic. This resolves the
        /// ambiguity by preferring, in order:
        /// <list type="number">
        /// <item>an active revision whose name matches <paramref name="expectedSuffix"/> — the
        /// revision suffix just deployed. Deterministic; doesn't depend on how long Azure takes
        /// to settle traffic.</item>
        /// <item>the sole active revision carrying 100% traffic, when no suffix was given (or
        /// none of the active revisions match it yet).</item>
        /// </list>
        /// If neither condition is met, retries until <paramref name="timeout"/> elapses, then
        /// returns null — the caller must render an honest "could not confirm which revision is
        /// serving" failure rather than report a stale/ambiguous guess.
        /// </summary>
        /// <param name="expectedSuffix">
        /// The revision suffix just requested via <c>--revision-suffix</c>, if this poll follows
        /// a deploy. Pass null for a plain read-only "what's serving right now" query.
        /// </param>
        public async Task<PsExecutionRevisionInfo?> WaitForServingRevisionAsync(
            string? expectedSuffix,
            TimeSpan? timeout = null,
            TimeSpan? pollInterval = null,
            CancellationToken ct = default)
        {
            var effectiveTimeout = timeout ?? DefaultServingRevisionTimeout;
            var effectiveInterval = pollInterval ?? DefaultServingRevisionPollInterval;
            var deadline = DateTime.UtcNow + effectiveTimeout;
            string reason = "no attempt made yet";

            while (true)
            {
                var r = await GetServingRevisionRawAsync(ct);
                if (r.Ok)
                {
                    var candidates = ParseActiveRevisions(r.Stdout);
                    var (selected, note) = SelectServingRevision(candidates, expectedSuffix);
                    reason = note;
                    if (selected != null)
                    {
                        Emit($"Serving revision confirmed: {selected.Name} ({note}).", ShaneAppLogLevel.Success);
                        return selected;
                    }
                    Emit($"Serving revision not yet confirmed — {note}. Retrying…", ShaneAppLogLevel.Info);
                }
                else
                {
                    reason = $"az containerapp revision list failed (exit {r.ExitCode})";
                    Emit($"{reason} while polling for the serving revision. Retrying…", ShaneAppLogLevel.Warning);
                }

                if (ct.IsCancellationRequested || DateTime.UtcNow >= deadline)
                {
                    Emit(
                        $"Timed out after {effectiveTimeout.TotalSeconds:0}s waiting to confirm the serving revision " +
                        $"({reason}) — could not confirm which revision is serving.",
                        ShaneAppLogLevel.Error);
                    return null;
                }

                try { await Task.Delay(effectiveInterval, ct); }
                catch (OperationCanceledException) { return null; }
            }
        }

        /// <summary>
        /// Full DEV deploy: <c>az acr build</c> the image from <paramref name="sourceDir"/>,
        /// then point <c>ca-ps-execution-dev</c> at it with a fresh revision suffix, then
        /// read back the now-active revision. Returns the active revision, or null if any
        /// step failed (each failure is streamed + logged).
        /// </summary>
        /// <param name="sourceDir">Absolute path to <c>services/ps-execution</c> in the current checkout.</param>
        /// <param name="revisionSuffix">
        /// Optional revision suffix (lowercase alphanumeric/hyphen). Auto-generated as
        /// <c>dev{yyyyMMddHHmmss}</c> when omitted so every deploy is a distinct, traceable revision.
        /// </param>
        public async Task<PsExecutionRevisionInfo?> DeployDevAsync(string sourceDir, string? revisionSuffix, CancellationToken ct = default)
        {
            AssertDevOnly(DevContainerApp);

            string suffix = NormalizeSuffix(revisionSuffix);

            Emit($"=== ps-execution DEV deploy ===", ShaneAppLogLevel.Info);
            Emit($"Registry: {Registry}   App: {DevContainerApp}   RG: {ResourceGroup}", ShaneAppLogLevel.Info);
            Emit($"Source:   {sourceDir}", ShaneAppLogLevel.Info);
            Emit($"Revision suffix: {suffix}", ShaneAppLogLevel.Info);

            // 1. Server-side image build + push to ACR (no local Docker).
            Emit($"[1/3] az acr build → {DevImageRef} …", ShaneAppLogLevel.Info);
            var build = await RunAzAsync(
                $"acr build --registry {Registry} --image {DevImageTag} \"{sourceDir}\"",
                streamLines: true, ct);
            if (!build.Ok)
            {
                Emit($"[1/3] acr build FAILED (exit {build.ExitCode}).", ShaneAppLogLevel.Error);
                return null;
            }
            Emit("[1/3] acr build OK — image pushed.", ShaneAppLogLevel.Success);

            // 2. Point the DEV Container App at the freshly built image on a new revision.
            //    --set-env-vars merges (does not replace) — stamps the image ref so the
            //    container's own /healthz can report it back to the api-side reader.
            Emit($"[2/3] az containerapp update -n {DevContainerApp} --revision-suffix {suffix} …", ShaneAppLogLevel.Info);
            var update = await RunAzAsync(
                $"containerapp update -n {DevContainerApp} -g {ResourceGroup} " +
                $"--image {DevImageRef} --revision-suffix {suffix} " +
                $"--set-env-vars PS_EXECUTION_IMAGE={DevImageRef}",
                streamLines: true, ct);
            if (!update.Ok)
            {
                Emit($"[2/3] containerapp update FAILED (exit {update.ExitCode}).", ShaneAppLogLevel.Error);
                return null;
            }
            Emit("[2/3] containerapp update OK — new revision requested.", ShaneAppLogLevel.Success);

            // 3. Confirm which revision is now actually serving (never assume success, and
            //    never trust the first "active"-flagged entry — #1617: Azure can report more
            //    than one revision as active mid-switch, and the just-deployed suffix is the
            //    deterministic way to tell them apart).
            Emit($"[3/3] Confirming '{suffix}' is the serving revision (polling up to {DefaultServingRevisionTimeout.TotalSeconds:0}s)…", ShaneAppLogLevel.Info);
            var active = await WaitForServingRevisionAsync(suffix, ct: ct);
            if (active == null)
            {
                Emit("[3/3] Could not confirm which revision is serving — deploy result UNCONFIRMED.", ShaneAppLogLevel.Error);
                return null;
            }
            Emit($"[3/3] Active revision now: {active.Name} (image {active.Image}, traffic {active.TrafficWeight}%).", ShaneAppLogLevel.Success);
            return active;
        }

        // --- Guards / parsing ----------------------------------------------------

        /// <summary>Hard stop if anything ever tries to name the production app. Belt-and-braces over the no-param design.</summary>
        private static void AssertDevOnly(string containerApp)
        {
            if (string.Equals(containerApp, ProdContainerApp, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Refusing to deploy to production Container App '{ProdContainerApp}'. This agent path is DEV-ONLY (#1385).");
            if (!string.Equals(containerApp, DevContainerApp, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Unexpected Container App target '{containerApp}'. Only '{DevContainerApp}' is permitted here (#1385).");
        }

        private static string NormalizeSuffix(string? requested)
        {
            string s = string.IsNullOrWhiteSpace(requested)
                ? $"dev{DateTime.UtcNow:yyyyMMddHHmmss}"
                : requested!.Trim().ToLowerInvariant();
            // Container Apps revision suffixes: lowercase alphanumeric + hyphen only.
            var sb = new StringBuilder();
            foreach (char c in s)
                sb.Append((char.IsLetterOrDigit(c) && c < 128) || c == '-' ? c : '-');
            string cleaned = sb.ToString().Trim('-');
            return string.IsNullOrEmpty(cleaned) ? $"dev{DateTime.UtcNow:yyyyMMddHHmmss}" : cleaned;
        }

        /// <summary>
        /// Parses every <c>active</c>-flagged revision out of the raw
        /// <c>az containerapp revision list</c> JSON. #1617: this used to return only the
        /// first entry, silently assuming the array was ordered new-first and that exactly one
        /// revision could ever be active at a time — neither holds during a traffic switch.
        /// </summary>
        public static List<PsExecutionRevisionInfo> ParseActiveRevisions(string json)
        {
            var result = new List<PsExecutionRevisionInfo>();
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    result.Add(new PsExecutionRevisionInfo
                    {
                        Name = el.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "",
                        Image = el.TryGetProperty("image", out var i) ? (i.GetString() ?? "") : "",
                        Active = el.TryGetProperty("active", out var a) && a.ValueKind == JsonValueKind.True,
                        TrafficWeight = el.TryGetProperty("traffic", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : 0,
                        CreatedTime = el.TryGetProperty("created", out var c) ? (c.GetString() ?? "") : "",
                    });
                }
            }
            catch
            {
                // Malformed JSON — return whatever was parsed so far (empty on a parse failure
                // before any element), never throw. The caller treats "no confident match" as
                // "keep polling / eventually time out", so an empty list here is handled safely.
            }
            return result;
        }

        /// <summary>
        /// #1617 — picks the one revision out of <paramref name="candidates"/> (all
        /// <c>active: true</c>) that can actually be trusted as "what's serving now", or null
        /// if the answer is still ambiguous. Order of preference:
        /// <list type="number">
        /// <item>a revision whose name matches <paramref name="expectedSuffix"/> (the suffix
        /// just requested via <c>--revision-suffix</c>) — deterministic, doesn't depend on
        /// Azure's traffic-settling time.</item>
        /// <item>the sole candidate carrying 100% traffic, when no suffix was given or none of
        /// the candidates match it (yet).</item>
        /// </list>
        /// </summary>
        internal static (PsExecutionRevisionInfo? Revision, string Reason) SelectServingRevision(
            List<PsExecutionRevisionInfo> candidates, string? expectedSuffix)
        {
            if (!string.IsNullOrWhiteSpace(expectedSuffix))
            {
                var bySuffix = candidates.FirstOrDefault(c =>
                    c.Name.EndsWith("--" + expectedSuffix, StringComparison.OrdinalIgnoreCase) ||
                    c.Name.EndsWith(expectedSuffix, StringComparison.OrdinalIgnoreCase));
                if (bySuffix != null)
                    return (bySuffix, $"matched deployed suffix '{expectedSuffix}'");
            }

            var fullTraffic = candidates.Where(c => c.TrafficWeight == 100).ToList();
            if (fullTraffic.Count == 1)
                return (fullTraffic[0], "sole active revision carrying 100% traffic");

            string reason = !string.IsNullOrWhiteSpace(expectedSuffix)
                ? $"no active revision named '*{expectedSuffix}' and no single revision at 100% traffic ({candidates.Count} active, {fullTraffic.Count} at 100%)"
                : $"no single active revision at 100% traffic ({candidates.Count} active, {fullTraffic.Count} at 100%)";
            return (null, reason);
        }

        // --- az process runner ---------------------------------------------------

        /// <summary>
        /// Runs <c>az &lt;args&gt;</c> via <c>cmd.exe /c</c> (so the Windows <c>az.cmd</c>
        /// shim resolves off PATH), capturing stdout/stderr and optionally streaming each
        /// line to the live sink. Never throws for a non-zero exit — that's reported in the result.
        /// </summary>
        public async Task<AzCliResult> RunAzAsync(string args, bool streamLines, CancellationToken ct = default)
        {
            ActivityLog.Log(LogChannel, $"az {args}");

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c az {args}",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            var stdout = new StringBuilder();
            var stderr = new StringBuilder();

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data == null) return;
                stdout.AppendLine(e.Data);
                if (streamLines) Emit(e.Data, ShaneAppLogLevel.Info);
            };
            proc.ErrorDataReceived += (_, e) =>
            {
                if (e.Data == null) return;
                stderr.AppendLine(e.Data);
                // az writes progress/warnings to stderr even on success — surface as warnings, not errors.
                if (streamLines) Emit(e.Data, ShaneAppLogLevel.Warning);
            };

            try
            {
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                await proc.WaitForExitAsync(ct);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"az invocation threw: {ex.Message}");
                return new AzCliResult { ExitCode = -1, Stdout = stdout.ToString(), Stderr = stderr.ToString() + Environment.NewLine + ex.Message };
            }

            var result = new AzCliResult { ExitCode = proc.ExitCode, Stdout = stdout.ToString(), Stderr = stderr.ToString() };
            ActivityLog.Log(LogChannel, $"az exited {result.ExitCode} ({result.Stdout.Length} stdout, {result.Stderr.Length} stderr chars)");
            return result;
        }
    }
}
