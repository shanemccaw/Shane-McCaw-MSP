using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Result of provisioning (or reusing) an isolated agent worktree.</summary>
    public class WorktreeProvisionResult
    {
        public bool Ok { get; set; }
        public string? Path { get; set; }
        public string? Branch { get; set; }
        public bool Reused { get; set; }
        public string? Error { get; set; }
        public string RawOutput { get; set; } = string.Empty;
    }

    /// <summary>
    /// Git #1371 — provisions the per-build isolated git worktree BuildConsole launches each
    /// build inside, and (on completion) merges that worktree's committed changes into the
    /// local dev-server checkout. A thin C# dispatcher to the proven dev-server scripts
    /// (scripts/dev-server/provision-worktree.mjs + request-restart.mjs) — no logic is
    /// reimplemented here. Cleanup lives in <see cref="WorktreeCleanupService"/>.
    /// </summary>
    public static class WorktreeProvisionService
    {
        private const string LogChannel = "worktree.provision";

        /// <summary>Create (or idempotently reuse) an isolated worktree off origin/main for
        /// <paramref name="name"/>, junctioning a shared node_modules when <paramref name="link"/>
        /// is set (#1372 — no per-worktree install/download). The worktree is registered to
        /// <paramref name="ownerPid"/> so the cleanup sweep never removes it while that process
        /// is alive.</summary>
        public static Task<WorktreeProvisionResult> ProvisionWorktreeAsync(string name, int ownerPid, bool link = true)
        {
            string args = $"\"{{script}}\" \"{name}\" --owner-pid {ownerPid} --json";
            if (link) args = $"\"{{script}}\" \"{name}\" --link --owner-pid {ownerPid} --json";
            return RunProvisionAsync(args, $"Provision worktree '{name}'");
        }

        /// <summary>Re-point an already-provisioned worktree's owner pid (e.g. from the launcher's
        /// pid to the freshly-started build process's pid) so the sweep tracks the real build
        /// process. Uses the provisioner's idempotent reuse path — does not re-checkout or re-link.</summary>
        public static Task<WorktreeProvisionResult> StampOwnerAsync(string name, int ownerPid)
        {
            string args = $"\"{{script}}\" \"{name}\" --owner-pid {ownerPid} --json";
            return RunProvisionAsync(args, $"Re-stamp worktree owner '{name}' -> pid {ownerPid}");
        }

        private static async Task<WorktreeProvisionResult> RunProvisionAsync(string argTemplate, string actionDescription)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: repo root not found.");
                return new WorktreeProvisionResult { Ok = false, Error = "Repo root not found" };
            }
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "provision-worktree.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: provisioner missing at {scriptPath}");
                return new WorktreeProvisionResult { Ok = false, Error = "provision-worktree.mjs not found" };
            }
            string args = argTemplate.Replace("{script}", scriptPath);

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = args,
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                // Git #2792 — time the provisioning call. A fresh `git worktree add` (reused=False)
                // silently grew from ~1s to tens-of-seconds/minutes as the repo accumulated branches
                // and loose objects, and — because launches were serialized — that turned a whole
                // batch into a multi-minute one-at-a-time stagger with no visible signal WHY. Logging
                // the elapsed time makes any future provisioning slowdown immediately diagnosable from
                // the activity log instead of manifesting only as "builds seem to hang".
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var process = Process.Start(psi);
                if (process == null)
                    return new WorktreeProvisionResult { Ok = false, Error = "Failed to launch node" };

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();
                sw.Stop();

                var res = new WorktreeProvisionResult { RawOutput = stdout };
                try
                {
                    using var doc = JsonDocument.Parse(stdout.Trim());
                    var root = doc.RootElement;
                    res.Ok = root.TryGetProperty("ok", out var okEl) && okEl.GetBoolean();
                    if (root.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String) res.Path = p.GetString();
                    if (root.TryGetProperty("branch", out var b) && b.ValueKind == JsonValueKind.String) res.Branch = b.GetString();
                    if (root.TryGetProperty("reused", out var r) && r.ValueKind != JsonValueKind.Null) res.Reused = r.ValueKind == JsonValueKind.True;
                    if (root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) res.Error = e.GetString();
                }
                catch
                {
                    // Non-JSON output (shouldn't happen with --json) — treat as failure with raw text.
                    res.Ok = process.ExitCode == 0 && string.IsNullOrEmpty(stderr);
                    if (!res.Ok) res.Error = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                }

                // Git #2792 — a slow fresh provision is the real cost the serialized launch loop used
                // to sum; flag it loudly (WARN-shaped wording) so a future regression is obvious.
                string slow = (!res.Reused && sw.ElapsedMilliseconds >= 15000) ? " ⚠ SLOW fresh worktree add" : "";
                if (res.Ok)
                    ActivityLog.Log(LogChannel, $"{actionDescription}: ok (path={res.Path}, reused={res.Reused}) in {sw.ElapsedMilliseconds}ms.{slow}");
                else
                    ActivityLog.Log(LogChannel, $"{actionDescription}: FAILED in {sw.ElapsedMilliseconds}ms — {res.Error}");
                return res;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"{actionDescription}: exception {ex.Message}");
                return new WorktreeProvisionResult { Ok = false, Error = ex.Message };
            }
        }

        /// <summary>Merge a completed build's committed worktree changes into the local dev-server
        /// checkout (and trigger its coalesced restart) via scripts/dev-server/request-restart.mjs,
        /// run from inside the worktree. Best-effort and idempotent: if the commit is already live
        /// (the session ran this itself, or nothing was committed) it is a no-op. Build-set members
        /// pass their DEV_BUILD_SET* env so the restart stays deferred until the whole set completes.</summary>
        public static async Task<bool> MergeBackAsync(string worktreePath, string agentName, IReadOnlyDictionary<string, string>? buildSetEnv = null)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) { ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': repo root not found."); return false; }
            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "request-restart.mjs");
            if (!File.Exists(scriptPath)) { ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': request-restart.mjs not found."); return false; }
            if (string.IsNullOrWhiteSpace(worktreePath) || !Directory.Exists(worktreePath))
            {
                ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': worktree path gone ({worktreePath}) — nothing to merge.");
                return false;
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = $"\"{scriptPath}\" --agent \"{agentName}\" --json",
                    WorkingDirectory = worktreePath, // request-restart merges the worktree's HEAD
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                if (buildSetEnv != null)
                    foreach (var kv in buildSetEnv) psi.Environment[kv.Key] = kv.Value;

                using var process = Process.Start(psi);
                if (process == null) return false;
                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                bool ok = process.ExitCode == 0;
                ActivityLog.Log(LogChannel, ok
                    ? $"Merge-back '{agentName}': {stdout.Trim()}"
                    : $"Merge-back '{agentName}': FAILED (exit {process.ExitCode}) — {(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr).Trim()}");
                return ok;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Merge-back '{agentName}': exception {ex.Message}");
                return false;
            }
        }
    }
}
