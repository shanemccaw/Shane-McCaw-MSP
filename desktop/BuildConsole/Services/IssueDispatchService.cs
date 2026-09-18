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
        /// <summary>Git #3829 — the real, freshly-queued row for <see cref="DispatchOutcome.Queued"/>
        /// / <see cref="DispatchOutcome.QueuedButBlocked"/> (the one <see cref="QueueBuildAsync"/>'s
        /// own return value already carried but this method used to discard). Lets a caller like
        /// the Command Center's Dispatch mode start the build for real right after dispatching it,
        /// without a second lookup — <see cref="Existing"/> covers the same real need for
        /// <see cref="DispatchOutcome.AlreadyTracked"/>.</summary>
        public QueueItem? QueuedItem { get; init; }
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

        /// <summary>
        /// Git #4766 — the typed issue is a real Feature: it has real GitHub sub-issues and its title
        /// does NOT start with <c>EPIC:</c>. <see cref="OpenSubIssues"/> are the still-open children in
        /// GitHub's own priority order; <see cref="ClosedCount"/> is how many closed ones were skipped.
        /// </summary>
        public sealed class FeatureFanOut
        {
            public int Number { get; init; }
            public string Title { get; init; } = "";
            public List<GitHubSubIssue> OpenSubIssues { get; init; } = new();
            public int ClosedCount { get; init; }
        }

        /// <summary>
        /// Git #4766 — Feature detection for Dispatch. A Feature is never dispatched itself (it has no
        /// <c>BUILD:</c> comment); typing one should dispatch every open child. Reuses the existing
        /// <see cref="GitHubApiClient.GetSubIssuesAsync"/> (the same fetch Build Chain Map and the epic
        /// panels use) and this repo's real title convention — an <c>EPIC:</c>-prefixed title is an Epic,
        /// whose sub-issues can number in the hundreds (rate-limit/dispatch-storm history: #2890, #3113),
        /// so an Epic is deliberately NOT expanded. Returns <c>null</c> for anything that is not a Feature
        /// (a leaf with no sub-issues, an Epic, no PAT, or any GitHub error), so every caller falls
        /// straight through to today's unchanged single-issue / chain path — which reports its own
        /// GitHub/PAT errors — rather than this method inventing a second failure surface.
        /// </summary>
        public static async Task<FeatureFanOut?> ResolveFeatureAsync(int issueNumber)
        {
            if (issueNumber <= 0) return null;
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return null;
                var gh = GitHubApiClient.ForManualAction(settings.GitHubPat);

                // Sub-issues first: a leaf issue (the common case) has none, and pays no title fetch.
                var subs = await gh.GetSubIssuesAsync(issueNumber, bypassCache: true);
                if (subs.Count == 0) return null;

                var issue = await gh.GetIssueAsync(issueNumber);
                if (issue == null) return null;
                if (issue.Title.StartsWith("EPIC:", StringComparison.OrdinalIgnoreCase))
                {
                    ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — EPIC-titled with {subs.Count} sub-issue(s); Feature fan-out not applied (Epics are out of scope, #4766).");
                    return null;
                }

                var open = subs.Where(s => string.Equals(s.State, "open", StringComparison.OrdinalIgnoreCase)).ToList();
                return new FeatureFanOut
                {
                    Number = issueNumber,
                    Title = issue.Title,
                    OpenSubIssues = open,
                    ClosedCount = subs.Count - open.Count,
                };
            }
            catch (Exception ex)
            {
                ActivityLog.Log("dispatch", $"ResolveFeatureAsync(#{issueNumber}) failed ({ex.Message}) — falling back to the single-issue dispatch path.");
                return null;
            }
        }

        /// <summary>
        /// Git #4766 — dispatches every open sub-issue of <paramref name="feature"/> through the
        /// existing, UNCHANGED <see cref="DispatchAsync"/> (same dedup / blocked_by / queue mechanics as
        /// a chain member — no new dispatch path) and returns one report line per member, plus a header.
        /// "Ready" is whatever <see cref="DispatchAsync"/> says: <c>Queued</c>/<c>QueuedButBlocked</c>
        /// count as dispatched; <c>AlreadyTracked</c> and <c>NoBuildComment</c> are reported honestly and
        /// never force-dispatched or auto-asked-to-chat in bulk. Closed children are skipped and counted
        /// in the header; a Feature with zero open children says so rather than doing nothing silently.
        /// <paramref name="onResult"/> lets the caller react per member (refresh the queue panel, collect
        /// Start candidates) without this method knowing either surface.
        /// </summary>
        public static async Task<(List<string> Lines, bool AnyError, bool AnyQueued)> DispatchFeatureAsync(
            BuildQueuePostgresClient? db, FeatureFanOut feature, Action<int, DispatchAttemptResult>? onResult = null)
        {
            var lines = new List<string>();
            bool anyError = false, anyQueued = false;
            var closedNote = feature.ClosedCount > 0 ? $" ({feature.ClosedCount} closed, skipped)" : "";

            if (feature.OpenSubIssues.Count == 0)
            {
                lines.Add($"Feature #{feature.Number} \"{feature.Title}\" has no open sub-issues — nothing to dispatch{closedNote}.");
                ActivityLog.Log("dispatch", $"Dispatch Feature #{feature.Number} — no open sub-issues ({feature.ClosedCount} closed); nothing to dispatch.");
                return (lines, false, false);
            }

            lines.Add($"Feature #{feature.Number} \"{feature.Title}\" — dispatching {feature.OpenSubIssues.Count} open sub-issue(s){closedNote}:");
            ActivityLog.Log("dispatch",
                $"Dispatch Feature #{feature.Number} — {feature.OpenSubIssues.Count} open sub-issue(s): #{string.Join(", #", feature.OpenSubIssues.Select(s => s.Number))} ({feature.ClosedCount} closed skipped).");

            foreach (var sub in feature.OpenSubIssues)
            {
                try
                {
                    var result = await DispatchAsync(db, sub.Number);
                    lines.Add($"#{sub.Number}: {result.Message}");
                    if (result.IsError) anyError = true;
                    if (result.Outcome is DispatchOutcome.Queued or DispatchOutcome.QueuedButBlocked) anyQueued = true;
                    ActivityLog.Log("dispatch", $"Dispatch Feature #{feature.Number} — #{sub.Number}: {result.Outcome} — {result.Message}");
                    try { onResult?.Invoke(sub.Number, result); }
                    catch { /* caller's best-effort per-member hook must never abort the fan-out */ }
                }
                catch (Exception ex)
                {
                    anyError = true;
                    lines.Add($"#{sub.Number}: dispatch failed — {ex.Message}");
                    ActivityLog.Log("dispatch", $"Dispatch Feature #{feature.Number} — #{sub.Number} FAILED: {ex.Message}");
                }
            }
            return (lines, anyError, anyQueued);
        }

        public static async Task<DispatchAttemptResult> DispatchAsync(BuildQueuePostgresClient? db, int issueNumber)
        {
            var settings = BuildConsoleSettings.Load();
            // Git #3901 — a degraded read (settings.json exists but was mid-replace / unreadable) hands
            // back a blank PAT that used to surface as "No GitHub PAT configured" with a real PAT set.
            // Give the file a moment and read again before concluding anything about the PAT.
            for (int attempt = 1; attempt <= 3 && settings.IsDegradedRead; attempt++)
            {
                await Task.Delay(250 * attempt);
                settings = BuildConsoleSettings.Load();
            }
            if (settings.IsDegradedRead)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.Failed,
                    Message = "Couldn't read settings.json right now (see ActivityLog settings.load) — your PAT is not the problem. Try the dispatch again.",
                };
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

            var queuedItem = await db.QueueBuildAsync(
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
                    QueuedItem = queuedItem,
                };

            return new DispatchAttemptResult
            {
                Outcome = DispatchOutcome.Queued,
                Message = $"#{issueNumber} \"{issue.Title}\" queued.",
                IssueTitle = issue.Title,
                QueuedItem = queuedItem,
            };
        }
    }
}
