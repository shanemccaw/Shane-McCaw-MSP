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
        public static async Task<DispatchAttemptResult> DispatchAsync(BuildQueuePostgresClient? db, int issueNumber)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
                return new DispatchAttemptResult
                {
                    Outcome = DispatchOutcome.NoPat,
                    Message = "No GitHub PAT configured — set one in Settings.",
                };

            var gh = new GitHubApiClient(settings.GitHubPat);

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
