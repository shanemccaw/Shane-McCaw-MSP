using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// #1277 — agent-callable Docker build + ACR push + revision deploy of the
    /// ps-execution container to the DEV Container App (ca-ps-execution-dev), plus a
    /// read-only "which revision is serving?" query. Both ride the same
    /// <c>shaneapp://</c> local protocol every other agent action uses, so a
    /// BuildConsole-launched build agent (#1482/#1483) can redeploy and verify without
    /// a human clicking anything and without ever being able to reach production
    /// (<see cref="PsExecutionDeployService"/> is DEV-only by construction — #1385).
    /// </summary>
    public partial class MainWindow
    {
        /// <summary>
        /// <c>shaneapp://deployPsExecution?path=&lt;services/ps-execution&gt;&amp;suffix=&lt;optional&gt;</c>
        /// — build the image, push to ACR, deploy a fresh revision to ca-ps-execution-dev,
        /// then confirm the now-active revision. Refuses (blocked, not worked-around) if the
        /// az CLI has no valid non-interactive context.
        /// </summary>
        private async Task HandleShaneAppDeployPsExecutionAsync(ShaneAppRequest req, string src, string ch)
        {
            var stream = ShaneAppStreamService.Instance;
            stream.BeginRun("ps-execution DEV deploy", $"Source: {src}");
            try
            {
                var svc = new PsExecutionDeployService((line, level) => stream.AppendLine(line, level));

                // Precondition (#1277): az must hold a valid non-interactive context.
                var ctx = await svc.CheckAzContextAsync();
                if (!ctx.Ok)
                {
                    string blockedMsg =
                        "az CLI has no valid non-interactive context (az account show failed). " +
                        "Deploy is BLOCKED — run `az login` on the build machine; do not work around the interactive prompt.";
                    ActivityLog.Log(ch, $"deployPsExecution blocked: {blockedMsg}");
                    WriteShaneAppDeployResult(req, ok: false, blocked: true, error: blockedMsg, revision: null);
                    stream.EndRun(false, "blocked — no az context");
                    return;
                }

                string sourceDir = ResolvePsExecutionSourceDir(GetShaneAppQueryParam(req.Raw, "path"));
                if (!Directory.Exists(sourceDir) || !File.Exists(Path.Combine(sourceDir, "Dockerfile")))
                {
                    string msg = $"ps-execution source dir not found or has no Dockerfile: '{sourceDir}'. " +
                                 "Pass ?path=<abs path to services/ps-execution> from your checkout.";
                    ActivityLog.Log(ch, $"deployPsExecution: {msg}");
                    stream.AppendLine($"[DEPLOY ERROR] {msg}", ShaneAppLogLevel.Error);
                    WriteShaneAppDeployResult(req, ok: false, blocked: false, error: msg, revision: null);
                    stream.EndRun(false, "source dir missing");
                    return;
                }

                string? suffix = GetShaneAppQueryParam(req.Raw, "suffix");
                var active = await svc.DeployDevAsync(sourceDir, suffix);
                if (active == null)
                {
                    WriteShaneAppDeployResult(req, ok: false, blocked: false,
                        error: "Deploy failed or the active revision could not be confirmed — see the log for the failing az step.",
                        revision: null);
                    stream.EndRun(false, "deploy failed / unconfirmed");
                    return;
                }

                ActivityLog.Log(ch, $"deployPsExecution DONE — active revision {active.Name} (traffic {active.TrafficWeight}%).");
                WriteShaneAppDeployResult(req, ok: true, blocked: false, error: null, revision: active);
                stream.EndRun(true, $"Active: {active.Name}");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ch, $"deployPsExecution threw: {ex.Message}");
                stream.AppendLine($"[DEPLOY ERROR] {ex.Message}", ShaneAppLogLevel.Error);
                WriteShaneAppDeployResult(req, ok: false, blocked: false, error: ex.Message, revision: null);
                stream.EndRun(false, ex.Message);
            }
        }

        /// <summary>
        /// <c>shaneapp://psExecutionRevision</c> — read-only: report the DEV Container App's
        /// current ACTIVE serving revision from the Azure control plane, so a #1482 fix can be
        /// verified against the revision that is genuinely live (not a stale one — #1434).
        /// </summary>
        private async Task HandleShaneAppPsExecutionRevisionAsync(ShaneAppRequest req, string src, string ch)
        {
            var stream = ShaneAppStreamService.Instance;
            stream.BeginRun("ps-execution serving revision", $"Source: {src}");
            try
            {
                var svc = new PsExecutionDeployService((line, level) => stream.AppendLine(line, level));

                var ctx = await svc.CheckAzContextAsync();
                if (!ctx.Ok)
                {
                    string blockedMsg = "az CLI has no valid non-interactive context — cannot read the serving revision.";
                    WriteShaneAppDeployResult(req, ok: false, blocked: true, error: blockedMsg, revision: null);
                    stream.EndRun(false, "blocked — no az context");
                    return;
                }

                var active = await svc.GetServingRevisionAsync();
                if (active == null)
                {
                    WriteShaneAppDeployResult(req, ok: false, blocked: false,
                        error: "Could not read the active revision from Azure — see the log.", revision: null);
                    stream.EndRun(false, "read failed");
                    return;
                }

                ActivityLog.Log(ch, $"psExecutionRevision — active revision {active.Name} (traffic {active.TrafficWeight}%).");
                stream.AppendLine($"Active revision: {active.Name} (image {active.Image}, traffic {active.TrafficWeight}%, created {active.CreatedTime}).", ShaneAppLogLevel.Success);
                WriteShaneAppDeployResult(req, ok: true, blocked: false, error: null, revision: active);
                stream.EndRun(true, $"Active: {active.Name}");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(ch, $"psExecutionRevision threw: {ex.Message}");
                WriteShaneAppDeployResult(req, ok: false, blocked: false, error: ex.Message, revision: null);
                stream.EndRun(false, ex.Message);
            }
        }

        /// <summary>
        /// Resolves the ps-execution source dir: the caller's <c>?path=</c> if given, else a
        /// best-effort upward search for <c>services/ps-execution</c> from the current working
        /// dir and the app base dir (covers a build agent whose cwd is its own worktree).
        /// </summary>
        private static string ResolvePsExecutionSourceDir(string? pathParam)
        {
            if (!string.IsNullOrWhiteSpace(pathParam))
                return Path.GetFullPath(pathParam!);

            foreach (var start in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
            {
                var dir = new DirectoryInfo(start);
                for (int depth = 0; dir != null && depth < 12; depth++, dir = dir.Parent)
                {
                    var candidate = Path.Combine(dir.FullName, "services", "ps-execution");
                    if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "Dockerfile")))
                        return candidate;
                }
            }
            // Fall through to a clearly-wrong path so the caller gets the "pass ?path=" error.
            return Path.Combine(Environment.CurrentDirectory, "services", "ps-execution");
        }

        /// <summary>
        /// Writes the deploy/revision JSON result envelope to
        /// <see cref="ShaneAppProtocol.ResolveResultPath"/> (best-effort — a failed write is
        /// logged, never thrown), so the calling agent can read the real outcome including the
        /// confirmed serving revision.
        /// </summary>
        private void WriteShaneAppDeployResult(ShaneAppRequest req, bool ok, bool blocked, string? error, PsExecutionRevisionInfo? revision)
        {
            string path = ShaneAppProtocol.ResolveResultPath(req);
            try
            {
                var envelope = new
                {
                    ok,
                    blocked,
                    error,
                    action = req.Action,
                    source = req.Source,
                    ranAtUtc = DateTime.UtcNow.ToString("o"),
                    target = new
                    {
                        registry = PsExecutionDeployService.Registry,
                        containerApp = PsExecutionDeployService.DevContainerApp,
                        resourceGroup = PsExecutionDeployService.ResourceGroup,
                        image = PsExecutionDeployService.DevImageRef,
                    },
                    revision = revision == null ? null : new
                    {
                        name = revision.Name,
                        image = revision.Image,
                        active = revision.Active,
                        trafficWeight = revision.TrafficWeight,
                        createdTime = revision.CreatedTime,
                    },
                };
                File.WriteAllText(path, JsonSerializer.Serialize(envelope, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex)
            {
                ActivityLog.Log(PsExecutionDeployService.LogChannel, $"couldn't write deploy result file {path}: {ex.Message}");
            }
        }
    }
}
