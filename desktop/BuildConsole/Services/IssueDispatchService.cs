using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #2682 — how a dispatch attempt landed, so a caller can pick its own status
    /// text/brush without re-deriving the mechanics.</summary>
    public enum DispatchOutcome
    {
        NoPat,
        GitHubUnreachable,
        IssueNotFound,
        NoBuildComment,
        NoDb,
        AlreadyTracked,
        Queued,
        QueuedButBlocked,
        Failed,
    }

    /// <summary>Git #2682 — the real result of one <see cref="IssueDispatchService.DispatchAsync"/>
    /// call. <see cref="Message"/> is a genuinely usable default status string (the same wording
    /// <see cref="Controls.DispatchPanel"/> already showed before this extraction) — a caller may
    /// show it verbatim or build its own from the other fields.</summary>
    public sealed class DispatchAttemptResult
    {
        public DispatchOutcome Outcome { get; init; }
        public string Message { get; init; } = "";
        public string? IssueTitle { get; init; }
        public List<int> OpenBlockedByNumbers { get; init; } = new();
        public QueueItem? Existing { get; init; }
        public bool IsError => Outcome is DispatchOutcome.NoPat or DispatchOutcome.GitHubUnreachable
            or DispatchOutcome.IssueNotFound or DispatchOutcome.NoDb or DispatchOutcome.Failed
            or DispatchOutcome.QueuedButBlocked;
    }

    /// <summary>
    /// Git #2682 — the real "fetch one issue live, find its BUILD: comment, dedup-check, queue"
    /// mechanics extracted out of <see cref="Controls.DispatchPanel"/>'s own DispatchAsync (#1779)
    /// so a second real caller — the Detected panel's per-item Dispatch button (#2682) — reuses the
    /// SAME dispatch path instead of a second invented one. <see cref="Controls.DispatchPanel"/>
    /// itself now calls this for its own happy-path dispatch; its force-redispatch flow (#1966)
    /// stays where it is — it's UI-heavy (a confirmation dialog, live-watcher state) and has no
    /// second caller to share with.
    /// </summary>
    public static class IssueDispatchService
    {
        /// <summary>
        /// Git #3858 — starting from <paramref name="issueNumber"/>, walks BOTH real dependency
        /// directions already populated on <c>bt_issue_mirror</c> (<see
        /// cref="GitHubIssueMirror.MirrorIssue.BlockedByNumbers"/> and the inverse <see
        /// cref="GitHubIssueMirror.MirrorIssue.BlockingNumbers"/> the full sync computes) to return
        /// the WHOLE real connected component — not just <paramref name="issueNumber"/>'s immediate
        /// neighbors, so a chain of 6 resolves fully from any single member. No new GitHub calls: this
        /// is a pure local-mirror read, same fail-closed shape as every other mirror consumer
        /// (<see cref="Controls.LeftSidebar"/>'s hover-popover relationship walk, #3467) — a never-synced
        /// mirror, a miss, or any error returns just <c>[issueNumber]</c> so a caller falls back to
        /// today's single-issue behavior rather than dispatching nothing or throwing.
        ///
        /// Batched by BFS level (<see cref="GitHubIssueMirror.GetManyAsync"/> per frontier, not one
        /// <see cref="GitHubIssueMirror.TryGetAsync"/> call per node) so a real 6-member chain costs a
        /// small, bounded number of round trips rather than one per node.
        /// </summary>
        public static async Task<List<int>> ResolveChainAsync(int issueNumber)
        {
            var soloResult = new List<int> { issueNumber };
            if (issueNumber <= 0) return soloResult;

            try
            {
                // Same fail-closed gate the #3467 hover-popover mirror read uses — a never-synced
                // mirror is indistinguishable from "no chain data" here, not an empty chain.
                if (!await GitHubIssueMirror.HasUsableDataAsync()) return soloResult;

                var visited = new HashSet<int> { issueNumber };
                var frontier = new List<int> { issueNumber };

                while (frontier.Count > 0)
                {
                    var rows = await GitHubIssueMirror.GetManyAsync(frontier);
                    var next = new List<int>();
                    foreach (var current in frontier)
                    {
                        if (!rows.TryGetValue(current, out var row)) continue;
                        foreach (var related in row.BlockedByNumbers.Concat(row.BlockingNumbers))
                        {
                            if (related > 0 && visited.Add(related)) next.Add(related);
                        }
                    }
                    frontier = next;
                }

                return visited.OrderBy(n => n).ToList();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("dispatch", $"ResolveChainAsync(#{issueNumber}) failed ({ex.Message}) — dispatching just this issue.");
                return soloResult;
            }
        }

        public static async Task<DispatchAttemptResult> DispatchAsync(BuildQueuePostgresClient? db, int issueNumber)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.NoPat,
                    Message = "No GitHub PAT configured — set one in Settings.",
                };

            // Git #3511 — Dispatch is THE manual escape hatch; it must not be pre-blocked by the
            // circuit that automatic background polling trips. A manual-priority client always makes
            // the immediate real attempt regardless of the circuit's open/closed state.
            var gh = GitHubApiClient.ForManualAction(settings.GitHubPat);

            GitHubIssueDetail? issue;
            try
            {
                issue = await gh.GetIssueAsync(issueNumber);
            }
            catch (Exception ex)
            {
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.GitHubUnreachable,
                    Message = $"Couldn't reach GitHub: {ex.Message}",
                };
            }

            if (issue == null)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.IssueNotFound,
                    Message = $"#{issueNumber} not found.",
                };

            // Reuse #1709's own parser — not a second one.
            var (rawComment, parsed) = await BatterUpQueueService.FindBuildCommentAsync(gh, issueNumber);
            if (rawComment == null || parsed == null)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.NoBuildComment,
                    Message = $"No build prompt found on #{issueNumber} yet.",
                    IssueTitle = issue.Title,
                };

            var (model, effort, buildSet, _, prompt) = parsed.Value;

            // Git #3509 — a real BUILD: comment now exists (whoever posted it, via whichever flow
            // claimed it first) — release any outstanding dispatch claim for this issue so it can't
            // linger and block a legitimate future ask. Best-effort: db availability is checked
            // just below, so guard here rather than reordering the existing NoDb branch.
            if (db != null) await db.ReleaseDispatchClaimAsync(issueNumber);

            var blockers = await gh.GetBlockedByAsync(issueNumber);
            var blockedByNumbers = blockers.Select(b => b.Number).ToList();
            var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();

            if (db == null)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.NoDb,
                    Message = "Not connected to the build queue database.",
                    IssueTitle = issue.Title,
                };

            // Same dedup convention BatterUpQueueService follows — an already-tracked row for this
            // issue is reported rather than silently duplicated.
            var existing = await db.FindDedupCandidateAsync(issueNumber, prompt);
            if (existing != null)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.AlreadyTracked,
                    Message = $"#{issueNumber} is already tracked (status: {existing.Status}).",
                    IssueTitle = issue.Title,
                    Existing = existing,
                };

            await db.QueueBuildAsync(
                title: issue.Title,
                prompt: prompt,
                model: model,
                effort: effort,
                cwd: null,
                githubNumber: issueNumber,
                blockedByNumbers: blockedByNumbers,
                buildSet: buildSet);

            ActivityLog.Log("dispatch",
                $"Dispatch #{issueNumber} \"{issue.Title}\" — queued (model={model ?? "default"}, effort={effort ?? "default"}, buildSet={buildSet ?? "none"}" +
                (blockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", blockedByNumbers)}" : "") + ").");

            // Fail-closed (#1600) governs launch, same as every other path — an open real blocker
            // holds it after queueing rather than refusing to queue it at all.
            if (openBlockedByNumbers.Count > 0)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.QueuedButBlocked,
                    Message = $"#{issueNumber} queued, but held — blocked by #{string.Join(", #", openBlockedByNumbers)}.",
                    IssueTitle = issue.Title,
                    OpenBlockedByNumbers = openBlockedByNumbers,
                };

            return new DispatchAttemptResult
            {
                Outcome = DispatchOutcome.Queued,
                Message = $"#{issueNumber} \"{issue.Title}\" queued.",
                IssueTitle = issue.Title,
            };
        }
    }
}
