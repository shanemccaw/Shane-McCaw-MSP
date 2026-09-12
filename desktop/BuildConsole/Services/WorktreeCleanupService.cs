using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
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

            var result = await RunScriptAsync(repoRoot, args, "Worktree sweep");

            // Git #3823 — real, confirmed follow-up to the manual cleanup of 243 accumulated
            // agent/* branches: cleanup-worktree.mjs's sweep above already deletes the LOCAL
            // agent/* branch for anything it genuinely removes, but never touched the matching
            // REMOTE branch on GitHub — the exact reason those 243 branches accumulated while
            // local cleanup worked the entire time. Mirror each local deletion to the remote,
            // but ONLY once the same real safety check the manual pass used by hand passes.
            // Same event-driven trigger as the sweep itself (this method), no new timer.
            if (result.Ok && !dryRun)
            {
                await DeleteRemoteBranchesForSweepAsync(result.RawOutput);
            }

            return result;
        }

        // Git #3823 — matches the leading numeric issue id off an `agent/<id>-qNNNN` (or bare
        // `agent/<id>`) branch name. A --notGit local build's id is base-26 letters (see the
        // notGit-ids memory) and simply won't match — those have no GitHub issue to check, so
        // they're left alone rather than guessed at.
        private static readonly Regex AgentBranchIssueRx = new(@"^agent/(\d+)", RegexOptions.Compiled);

        /// <summary>
        /// Git #3823 — parses cleanup-worktree.mjs --sweep's real JSON `removed` array for every
        /// local `agent/*` branch it just deleted (`branchDeleted`), then checks each one against
        /// the real safety gate before deleting the matching remote ref. Never touches anything
        /// that isn't already a local branch this exact sweep just removed — in particular this
        /// never runs for the <see cref="MarkWorktreeStaleAsync"/> (failed-build) path, which
        /// never deletes a local branch at all.
        /// </summary>
        private static async Task DeleteRemoteBranchesForSweepAsync(string rawJson)
        {
            var locallyDeletedBranches = new List<string>();
            try
            {
                using var doc = JsonDocument.Parse(rawJson);
                if (doc.RootElement.TryGetProperty("removed", out var removedArr) && removedArr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in removedArr.EnumerateArray())
                    {
                        if (item.TryGetProperty("branchDeleted", out var bd) && bd.ValueKind == JsonValueKind.String)
                        {
                            var branch = bd.GetString();
                            if (!string.IsNullOrWhiteSpace(branch)) locallyDeletedBranches.Add(branch!);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: couldn't parse sweep output for remote-branch cleanup ({ex.Message}) — no remote branches touched this pass.");
                return;
            }

            foreach (var branch in locallyDeletedBranches)
            {
                await MaybeDeleteRemoteBranchAsync(branch);
            }
        }

        /// <summary>
        /// Git #3823 — real safety check, in order: (a) the branch's issue is closed with
        /// state_reason completed/not_planned, delete; (b) else <see cref="DoneBookendVerifier"/>
        /// confirms a real, git-verified DONE bookend for that issue, delete; (c) otherwise leave
        /// the remote branch alone. Fails CLOSED on every uncertainty (no PAT, API error, no
        /// numeric issue id) — a remote branch surviving one extra sweep is the safe direction,
        /// deleting one that shouldn't have been is not.
        /// </summary>
        private static async Task MaybeDeleteRemoteBranchAsync(string branch)
        {
            if (string.IsNullOrWhiteSpace(branch) || !branch.StartsWith("agent/", StringComparison.Ordinal))
                return; // only ever the ephemeral per-build branch this sweep itself just deleted locally

            var m = AgentBranchIssueRx.Match(branch);
            if (!m.Success)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: '{branch}' has no leading numeric issue id (a --notGit local build) — no GitHub issue to verify, leaving the remote branch alone.");
                return;
            }
            int issueNumber = int.Parse(m.Groups[1].Value);

            BuildConsoleSettings settings;
            try { settings = BuildConsoleSettings.Load(); }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: couldn't load settings to verify #{issueNumber} is safe — leaving remote branch '{branch}' alone: {ex.Message}");
                return;
            }
            if (!settings.HasGitHubPat)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: no GitHub PAT configured — cannot verify #{issueNumber} is safe. Leaving remote branch '{branch}' alone.");
                return;
            }

            string? safetyReason = null;
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var issue = await client.GetIssueAsync(issueNumber);
                if (issue != null && string.Equals(issue.State, "closed", StringComparison.OrdinalIgnoreCase) &&
                    (string.Equals(issue.StateReason, "completed", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(issue.StateReason, "not_planned", StringComparison.OrdinalIgnoreCase)))
                {
                    safetyReason = $"issue #{issueNumber} closed ({issue.StateReason})";
                }
                else if (await DoneBookendVerifier.IsSatisfiedAsync(issueNumber))
                {
                    safetyReason = $"build-journal/{issueNumber}.md carries a real, git-verified DONE bookend";
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: safety check for #{issueNumber} failed ({ex.Message}) — leaving remote branch '{branch}' alone (fail closed).");
                return;
            }

            if (safetyReason == null)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: #{issueNumber} is neither closed (completed/not_planned) nor has a verified DONE bookend — leaving remote branch '{branch}' alone.");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                bool deleted = await client.DeleteBranchRefAsync(branch);
                ActivityLog.Log(LogChannel, deleted
                    ? $"Deleted remote branch '{branch}' — safe per {safetyReason}."
                    : $"Attempted to delete remote branch '{branch}' ({safetyReason}) but GitHub did not confirm success.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"Git #3823: failed to delete remote branch '{branch}' ({safetyReason}): {ex.Message}");
            }
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
        /// Git #3630 (Feature #3578, Multi-Repo Support) — real cleanup of a secondary/Tinker
        /// repo's persistent local clone (`C:\repos\&lt;owner&gt;__&lt;repo&gt;`, created once by
        /// repo-clone.mjs's resolveRepoCheckout and reused forever) once that repo is removed
        /// from Settings > Repos (#3581's registry). #3581's own issue body flagged this exact
        /// gap as a stated follow-up; this is that follow-up.
        ///
        /// Dispatches to scripts/dev-server/evict-repo-clones.mjs, which reads the registry
        /// straight back out of THIS settings.json (no duplicate registry, no risk of the two
        /// disagreeing) and only removes a clone once it confirms no live worktree tracking
        /// record still points at it — a build genuinely in progress against a repo Shane just
        /// removed is never deleted out from under it.
        ///
        /// Called fire-and-forget right after <see cref="BuildConsoleSettings.Save"/> removes
        /// the entry from <see cref="BuildConsoleSettings.ConfiguredRepos"/> in
        /// <c>SettingsTabView.BtnRemoveRepo_Click</c> — this is real disk cleanup, not something
        /// that blocks the UI while it runs.
        /// </summary>
        public static async Task<WorktreeCleanupResult> EvictRemovedRepoCloneAsync()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                ActivityLog.Log(LogChannel, "Cannot evict removed-repo clones: repo root not found.");
                return new WorktreeCleanupResult { Ok = false, Error = "Repo root not found" };
            }

            string scriptPath = Path.Combine(repoRoot, "scripts", "dev-server", "evict-repo-clones.mjs");
            if (!File.Exists(scriptPath))
            {
                ActivityLog.Log(LogChannel, $"evict-repo-clones script missing at {scriptPath}");
                return new WorktreeCleanupResult { Ok = false, Error = "Script not found" };
            }

            string args = $"\"{scriptPath}\" --json";
            if (!string.IsNullOrEmpty(InstanceMode.InstanceName))
            {
                args += $" --instance \"{InstanceMode.InstanceName}\"";
            }

            var result = await RunScriptAsync(repoRoot, args, "Evict removed-repo clones");
            try
            {
                using var doc = JsonDocument.Parse(result.RawOutput);
                var root = doc.RootElement;
                int evictedCount = root.TryGetProperty("evicted", out var ev) && ev.ValueKind == JsonValueKind.Array ? ev.GetArrayLength() : 0;
                int retainedCount = root.TryGetProperty("retained", out var rt) && rt.ValueKind == JsonValueKind.Array ? rt.GetArrayLength() : 0;
                if (result.Ok)
                {
                    ActivityLog.Log(LogChannel, $"Repo-clone eviction: evicted {evictedCount}, retained {retainedCount}.");
                }
            }
            catch
            {
                // Best-effort log enrichment only — RunScriptAsync's own Ok/Error already
                // reflects the real outcome regardless of whether this parse succeeds.
            }

            return result;
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
