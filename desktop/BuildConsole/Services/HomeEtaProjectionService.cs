using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>Git #2714 — one honest projected-completion row for a single scope (the active
    /// Milestone as a whole, or one open Epic in it). Every count is real (from #2711's daily
    /// time series over real GitHub open/close timestamps); the date, when present, is fit with
    /// the shared <see cref="IssueEtaProjection"/> core. When no date can be honestly projected,
    /// <see cref="Reason"/> carries why — never a fabricated date.</summary>
    public sealed class EtaProjectionRow
    {
        /// <summary>The Milestone or Epic GitHub issue number this row projects.</summary>
        public int Number { get; init; }
        public string Title { get; init; } = "";
        public int TotalIssues { get; init; }
        public int ClosedIssues { get; init; }
        public int OpenIssues { get; init; }
        /// <summary>True only when a real completion date cleared every confidence gate.</summary>
        public bool HasEta { get; init; }
        /// <summary>Projected completion instant (UTC), when <see cref="HasEta"/> is true.</summary>
        public DateTime? ProjectedUtc { get; init; }
        /// <summary>Remaining time to completion, when <see cref="HasEta"/> is true.</summary>
        public TimeSpan? Eta { get; init; }
        /// <summary>Fitted pace, issues closed per day (for the honest "at this rate" line).</summary>
        public double IssuesPerDay { get; init; }
        /// <summary>The honest reason no date is shown, when <see cref="HasEta"/> is false. Never null then.</summary>
        public string? Reason { get; init; }
        /// <summary>True when every real issue in scope is already closed (a terminal, not a failure).</summary>
        public bool AllClosed { get; init; }
    }

    /// <summary>Git #2714 — the full Home projected-completion panel payload: one Milestone-level
    /// projected release date plus one row per open Epic in that Milestone. Fails closed as a whole
    /// (<see cref="Available"/> == false with a real <see cref="UnavailableReason"/>) when the
    /// active Milestone can't be resolved (no PAT, GitHub unreachable, or no open Milestone has
    /// issues) — the panel then shows an honest empty state, never a guessed set.</summary>
    public sealed class HomeEtaProjection
    {
        public bool Available { get; init; }
        public string? UnavailableReason { get; init; }
        public int MilestoneNumber { get; init; }
        public string MilestoneTitle { get; init; } = "";
        public EtaProjectionRow? Milestone { get; init; }
        public IReadOnlyList<EtaProjectionRow> Epics { get; init; } = Array.Empty<EtaProjectionRow>();
        public DateTime GeneratedUtc { get; init; }
    }

    /// <summary>
    /// Git #2714 (Home dashboard: per-Epic + Milestone ETA projection panel). Composes the real
    /// projected-completion panel by:
    ///
    ///   1. resolving the real active GitHub Milestone the Home dashboard defaults to
    ///      (<see cref="GitHubIssueTimeSeriesService.ResolveActiveMilestoneAsync"/>);
    ///   2. fitting one Milestone-level ETA over that Milestone's real daily cumulative-closed
    ///      series (#2711), and one per-Epic ETA over each open Epic's own real descendant series;
    ///   3. applying the SAME honest sampling/gating discipline the Focus bar already uses
    ///      (<see cref="IssueEtaProjection"/> — extracted from <see cref="FocusModeService"/>),
    ///      so an Epic with too little real history shows the same "can't project yet" state a
    ///      too-thin Milestone always has, never a fake date.
    ///
    /// Fail-closed throughout: an unreachable GitHub or an empty scope yields an honest reason,
    /// not a fabricated curve. Nothing here is hardcoded or sampled from a fixture.
    /// </summary>
    public static class HomeEtaProjectionService
    {
        /// <summary>Build the full panel payload. <paramref name="forceRefresh"/> bypasses the
        /// #2711 5-minute issue-fetch cache (the panel's own manual refresh); the default reuses
        /// the cache so a tab open doesn't hit GitHub every time.</summary>
        public static async Task<HomeEtaProjection> ComputeAsync(bool forceRefresh = false)
        {
            var now = DateTime.UtcNow;

            var active = await GitHubIssueTimeSeriesService.ResolveActiveMilestoneAsync();
            if (active == null)
            {
                return new HomeEtaProjection
                {
                    Available = false,
                    UnavailableReason = "No active GitHub milestone could be resolved (no PAT, GitHub unreachable, or no open milestone has issues).",
                    GeneratedUtc = now,
                };
            }

            // Milestone-level projected release date, over the milestone's own real daily series.
            var msSeries = await GitHubIssueTimeSeriesService.GetMilestoneSeriesAsync(active.Number, active.Title, forceRefresh);
            var milestoneRow = BuildRow(active.Number, active.Title, msSeries, now, "milestone");

            // One projected completion date per OPEN Epic in the active milestone. The fetch is
            // already cached from the milestone call above (same 5-minute window) — no force here.
            var epics = await GitHubIssueTimeSeriesService.GetOpenEpicsInMilestoneAsync(active.Number, false);
            var epicRows = new List<EtaProjectionRow>(epics.Count);
            foreach (var epic in epics)
            {
                var epicSeries = await GitHubIssueTimeSeriesService.GetEpicSeriesAsync(epic.Number, false);
                epicRows.Add(BuildRow(epic.Number, epic.Title, epicSeries, now, "epic"));
            }

            ActivityLog.Log("git-board.data",
                $"home ETA projection: milestone #{active.Number} '{active.Title}' ({(milestoneRow.HasEta ? "date projected" : "no date: " + milestoneRow.Reason)}); "
                + $"{epicRows.Count} open epic(s), {epicRows.Count(r => r.HasEta)} with a projected date.");

            return new HomeEtaProjection
            {
                Available = true,
                MilestoneNumber = active.Number,
                MilestoneTitle = active.Title,
                Milestone = milestoneRow,
                Epics = epicRows,
                GeneratedUtc = now,
            };
        }

        /// <summary>Fit one honest projected-completion row over a single scope's real #2711 daily
        /// series, reusing <see cref="IssueEtaProjection"/> exactly. The pace is fit over the real
        /// cumulative-closed curve; the remaining count is the scope's real still-open issues.</summary>
        private static EtaProjectionRow BuildRow(int number, string title, IssueTimeSeries series, DateTime nowUtc, string scopeNoun)
        {
            int total = series.TotalIssues;
            int closed = series.CurrentClosed;
            int open = series.CurrentOpen;

            // Terminal: nothing left to close is a real state, not a projection failure.
            if (total > 0 && open == 0)
            {
                return new EtaProjectionRow
                {
                    Number = number, Title = title, TotalIssues = total, ClosedIssues = closed, OpenIssues = open,
                    AllClosed = true, Reason = $"all {total} issue(s) closed",
                };
            }

            // The source's own fail-closed gate (empty scope / too-thin real history) comes first —
            // it carries the honest reason the shared #2711 foundation already computed.
            if (!series.HasEnoughData)
            {
                return new EtaProjectionRow
                {
                    Number = number, Title = title, TotalIssues = total, ClosedIssues = closed, OpenIssues = open,
                    Reason = series.Reason ?? "not enough real history yet to project a date",
                };
            }

            // Feed the real daily cumulative-closed curve into the shared projection core: y is the
            // running closed total on each real calendar day, x is that day.
            var window = series.Points
                .Select(pt => new UsageSample { At = pt.Date.ToDateTime(TimeOnly.MinValue), Percent = pt.ClosedCumulative })
                .ToList();

            var proj = IssueEtaProjection.Project(window, open, scopeNoun);
            return new EtaProjectionRow
            {
                Number = number, Title = title, TotalIssues = total, ClosedIssues = closed, OpenIssues = open,
                HasEta = proj.HasEta,
                Eta = proj.HasEta ? proj.Eta : null,
                ProjectedUtc = proj.HasEta ? nowUtc + proj.Eta : null,
                IssuesPerDay = proj.IssuesPerDay,
                Reason = proj.HasEta ? null : proj.EtaReason,
            };
        }
    }
}
