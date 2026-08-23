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
