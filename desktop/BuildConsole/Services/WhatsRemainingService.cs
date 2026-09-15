using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #4149 — Shane: "I can see 73 items remaining but no real clear view into what they
    /// are." One real, read-only row: an open issue currently counted in Home's own "remaining"
    /// figure, with its resolved top Epic and real board Status.
    /// </summary>
    public sealed class WhatsRemainingRow
    {
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public string HtmlUrl { get; init; } = "";
        /// <summary>Real project-board Status name (e.g. "Backlog", "Batter Up", "AI Batter Up",
        /// "Ask Shane") from the local mirror's own <c>board_status_name</c> column. Null when the
        /// mirror hasn't captured a Status for this issue yet — rendered as an honest "—", never a
        /// guessed default.</summary>
        public string? BoardStatus { get; init; }
        /// <summary>Git #3336 — this row's resolved top-level Epic ancestor (see
        /// <see cref="EpicResolver"/>). Null when the chain resolves to nothing — the panel groups
        /// these under a real "No Epic" section, never silently.</summary>
        public int? EpicNumber { get; init; }
        public string? EpicTitle { get; init; }
    }

    /// <summary>The real result of one <see cref="WhatsRemainingService.GetRemainingAsync"/> read —
    /// either the real rows for the resolved active milestone, or an honest failure reason (no
    /// fabricated/partial list either way).</summary>
    public sealed class WhatsRemainingResult
    {
        public bool Success { get; init; }
        public string? Reason { get; init; }
        public string MilestoneLabel { get; init; } = "";
        public IReadOnlyList<WhatsRemainingRow> Rows { get; init; } = Array.Empty<WhatsRemainingRow>();

        public static WhatsRemainingResult Failure(string reason) => new() { Success = false, Reason = reason };
        public static WhatsRemainingResult Ok(string milestoneLabel, IReadOnlyList<WhatsRemainingRow> rows) =>
            new() { Success = true, MilestoneLabel = milestoneLabel, Rows = rows };
    }

    /// <summary>
    /// Git #4149 — reads ONLY the local mirror (<see cref="GitHubIssueMirror"/>), same as
    /// <see cref="GitHubIssueTimeSeriesService"/>'s own Home-dashboard-only methods: no live GitHub
    /// call for this panel under any circumstance. Reuses <see cref="GitHubIssueTimeSeriesService"/>'s
    /// own real "active milestone" resolution and <see cref="GitBoardIssueFilters.CountsAsRealWork"/>
    /// scope definition, so this panel's row count matches Home's own "remaining" figure exactly
    /// (<see cref="GitHubIssueTimeSeriesService.GetActiveMilestoneSeriesAsync"/>'s
    /// <c>CumulativeOpened - ClosedCumulative</c>) rather than a second, independently-defined
    /// "all open issues" query that could disagree with it.
    /// </summary>
    public static class WhatsRemainingService
    {
        /// <summary>
        /// Every real open issue in the resolved active milestone that counts as real work (the same
        /// scope Home's burndown card's "remaining" number already applies), grouped-ready with each
        /// row's resolved top Epic and real board Status. <paramref name="gh"/> is optional and, when
        /// provided, is passed straight through to <see cref="EpicResolver.ResolveTopEpicsAsync"/> for
        /// its own narrow, capped live fallback (a node that dead-ends purely on a sync-timing gap) —
        /// omitting it preserves a pure mirror-only read, matching every other Home-dashboard consumer
        /// of this same milestone scope.
        /// </summary>
        public static async Task<WhatsRemainingResult> GetRemainingAsync(GitHubApiClient? gh = null)
        {
            var active = await GitHubIssueTimeSeriesService.ResolveActiveMilestoneAsync();
            if (active == null)
            {
                return WhatsRemainingResult.Failure(
                    "no active milestone could be resolved from the local mirror (bt_milestone_mirror has no usable data yet).");
            }

            var mirrored = await GitHubIssueMirror.TryGetBoardIssuesAsync(openOnly: false);
            if (mirrored == null)
            {
                return WhatsRemainingResult.Failure(
                    "local issue mirror has no usable data yet (never completed a full sync).");
            }

            var byNumber = GitBoardIssueFilters.BuildByNumberLookup(mirrored);

            // Same scope GetMilestoneSeriesAsync/BuildSeries apply: this milestone's real work
            // (Epic/Feature placeholders and #1202-internal-tooling descendants excluded), still
            // genuinely open right now — the exact set whose count is Home's "remaining" number.
            var remaining = mirrored
                .Where(i => i.MilestoneNumber == active.Number)
                .Where(i => !i.IsClosed)
                .Where(i => GitBoardIssueFilters.CountsAsRealWork(i, byNumber))
                .OrderBy(i => i.Number)
                .ToList();

            var numbers = remaining.Select(i => i.Number).ToList();

            // Real board Status per row — from the mirror's own board_status_name column (MirrorIssue),
            // a different local table shape than GitBoardIssue above (which doesn't carry Status).
            var statusByNumber = await GitHubIssueMirror.GetManyAsync(numbers);

            // Git #3336/#4149 — resolve each row's real top-level Epic ancestor, same mechanism
            // AiBatterUpPanel/BatterUpPanel already use.
            var resolvedEpics = await EpicResolver.ResolveTopEpicsAsync(
                remaining.Select(i => (i.Number, i.ParentNumber)), gh);

            var rows = new List<WhatsRemainingRow>();
            foreach (var issue in remaining)
            {
                resolvedEpics.TryGetValue(issue.Number, out var epic);
                statusByNumber.TryGetValue(issue.Number, out var mirrorInfo);

                rows.Add(new WhatsRemainingRow
                {
                    Number = issue.Number,
                    Title = issue.Title,
                    HtmlUrl = issue.HtmlUrl,
                    BoardStatus = mirrorInfo?.BoardStatusName,
                    EpicNumber = epic?.Number,
                    EpicTitle = epic?.Title,
                });
            }

            return WhatsRemainingResult.Ok(active.Title, rows);
        }
    }
}
