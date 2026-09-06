using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Summary of a worktree sweep or single cleanup action.
    /// </summary>
    public class WorktreeCleanupResult
    {
        public bool Ok { get; set; }
        public int InspectedCount { get; set; }
        public int RemovedCount { get; set; }
        public int RetainedCount { get; set; }
        public string? Error { get; set; }
        public string RawOutput { get; set; } = string.Empty;
    }

    /// <summary>
    /// Service for managing and cleaning up isolated agent git worktrees (#92 follow-up).
    /// Dispatches to scripts/dev-server/cleanup-worktree.mjs with durable ActivityLog wiring.
    /// </summary>
    public static class WorktreeCleanupService
    {
        private const string LogChannel = "worktree.cleanup";

        /// <summary>
        /// Sweep all orphaned, inactive, or expired agent worktrees.
        /// </summary>
        /// <param name="force">If true, sweeps stale debug worktrees as well.</param>
        /// <param name="dryRun">If true, performs a dry-run check without deleting files.</param>
        public static async Task<WorktreeCleanupResult> SweepWorktreesAsync(bool force = false, bool dryRun = false)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, "Cannot sweep worktrees: repo root not found.");
                return new WorktreeCleanupResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "cleanup-worktree.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"Cleanup script missing at {scriptPath}");
                return new WorktreeCleanupResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" --sweep --json";
            if (force) args += " --force";
            if (dryRun) args += " --dry-run";

            return await RunScriptAsync(repoRoot, args, "Worktree sweep");
        }

        /// <summary>
        /// Explicitly clean up a specific worktree by name or path.
        /// </summary>
        public static async Task<WorktreeCleanupResult> CleanupWorktreeAsync(string pathOrName, string reason = "build complete", bool force = true)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, $"Cannot cleanup worktree {pathOrName}: repo root not found.");
                return new WorktreeCleanupResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "cleanup-worktree.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"Cleanup script missing at {scriptPath}");
                return new WorktreeCleanupResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" \"{pathOrName}\" --reason \"{reason}\" --json";
            if (force) args += " --force";

            return await RunScriptAsync(repoRoot, args, $"Cleanup worktree '{pathOrName}'");
        }

        /// <summary>
        /// Mark a worktree as stale for debugging.
        /// </summary>
        public static async Task<WorktreeCleanupResult> MarkWorktreeStaleAsync(string pathOrName, string reason)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                return new WorktreeCleanupResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "cleanup-worktree.mjs");
            if (!File.Exists(scriptPath))
            {
                return new WorktreeCleanupResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" --mark-stale \"{pathOrName}\" --reason \"{reason}\" --json";
            return await RunScriptAsync(repoRoot, args, $"Mark stale worktree '{pathOrName}'");
        }

        /// <summary>
        /// Git #2796 — real, ongoing repo housekeeping: prune `agent/*` branches verified as real
        /// ancestors of main, run `git gc` once loose objects cross a threshold, and reconcile
        /// `C:\wt\*` against `git worktree list` to reclaim stray leftover dirs. Dispatches to
        /// scripts/dev-server/git-maintenance.mjs — see that script's own header for the full
        /// safety model of each of its three independent sweeps.
        /// </summary>
        public static async Task<WorktreeCleanupResult> RunGitMaintenanceAsync(bool dryRun = false)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, "Cannot run git-maintenance: repo root not found.");
                return new WorktreeCleanupResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "git-maintenance.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"git-maintenance script missing at {scriptPath}");
                return new WorktreeCleanupResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" --json";
            if (dryRun) args += " --dry-run";

            var result = await RunScriptAsync(repoRoot, args, "Git maintenance sweep");

            // The script's top-level JSON shape (branches/gc/strays sub-objects) differs from the
            // flat inspected/removed/retained shape SweepWorktreesAsync parses, so re-parse counts
            // from the real fields for a meaningful log line rather than leaving them at 0.
            try
            {
                using var doc = JsonDocument.Parse(result.RawOutput);
                var root = doc.RootElement;
                int deletedBranches = root.TryGetProperty("branches", out var b) && b.TryGetProperty("deletedCount", out var dc) ? dc.GetInt32() : 0;
                int removedStrays = root.TryGetProperty("strays", out var s) && s.TryGetProperty("removedCount", out var rc) ? rc.GetInt32() : 0;
                bool gcRan = root.TryGetProperty("gc", out var g) && g.TryGetProperty("ran", out var gr) && gr.GetBoolean();
                if (result.Ok)
                {
                    ActivityLog.Log(LogChannel, $"Git maintenance sweep succeeded: {deletedBranches} agent/* branch(es) pruned (verified ancestors of main), gc ran={gcRan}, {removedStrays} stray C:\\wt dir(s) reclaimed.");
                }
            }
            catch
            {
                // RunScriptAsync already logged success/failure; a parse miss here is cosmetic only.
            }

            return result;
        }

        private static async Task<WorktreeCleanupResult> RunScriptAsync(string repoRoot, string scriptAndArgs, string actionDescription)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = scriptAndArgs,
                    WorkingDirectory = repoRoot,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                using var process = Process.Start(psi);
                if (process == null)
                {
                    ActivityLog.Log(LogChannel, $"Failed to launch node for {actionDescription}");
                    return new WorktreeCleanupResult { Ok = false, Error = "Failed to launch process" };
                }

                string stdout = await process.StandardOutput.ReadToEndAsync();
                string stderr = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode == 0)
                {
                    var res = new WorktreeCleanupResult
                    {
                        Ok = true,
                        RawOutput = stdout,
                    };
                    try
                    {
                        using var doc = JsonDocument.Parse(stdout);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("inspectedCount", out var ic)) res.InspectedCount = ic.GetInt32();
                        if (root.TryGetProperty("removedCount", out var rc)) res.RemovedCount = rc.GetInt32();
                        if (root.TryGetProperty("retainedCount", out var tc)) res.RetainedCount = tc.GetInt32();
                    }
                    catch {}

                    ActivityLog.Log(LogChannel, $"{actionDescription} succeeded: removed={res.RemovedCount}, retained={res.RetainedCount}.");
                    return res;
                }
                else
                {
                    string err = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                    ActivityLog.Log(LogChannel, $"{actionDescription} failed (exit {process.ExitCode}): {err}");
                    return new WorktreeCleanupResult
                    {
                        Ok = false,
                        Error = err,
                        RawOutput = stdout,
                    };
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"{actionDescription} exception: {ex.Message}");
                return new WorktreeCleanupResult { Ok = false, Error = ex.Message };
            }
        }
    }
}
