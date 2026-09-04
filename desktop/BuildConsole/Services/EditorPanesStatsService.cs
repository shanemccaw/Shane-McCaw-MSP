using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #2800 — the four real, midnight-resetting numbers shown in the Editor Panes
    /// toolbar's stat strip. Reuses two already-real data sources instead of rebuilding
    /// anything:
    ///   - New/closed issues today: <see cref="GitHubIssueTimeSeriesService"/> (#2711) —
    ///     "today" is just its latest real daily bucket (already calendar-day scoped, so
    ///     "resets at midnight" needs no separate reset logic).
    ///   - Incomplete/complete Features: <see cref="GitBoardIssueFilters.ComputeTransitiveLeafRollup"/>
    ///     (#2739/#2773) applied to every real Feature-titled issue in the active milestone.
    /// </summary>
    public sealed class EditorPanesStats
    {
        public bool HasData { get; init; }
        public string? Reason { get; init; }
        public int NewToday { get; init; }
        public int ClosedToday { get; init; }
        public int FeaturesOpen { get; init; }
        public int FeaturesDone { get; init; }

        public static EditorPanesStats Empty(string reason) => new() { HasData = false, Reason = reason };
    }

    public static class EditorPanesStatsService
    {
        /// <summary>
        /// Real stats for the active GitHub Milestone. Rides the same cached
        /// <see cref="GitHubIssueTimeSeriesService.GetAllIssuesAsync"/> fetch both halves need,
        /// so this never issues its own extra GitHub call beyond that shared 5-minute-TTL cache.
        /// Fails closed (<see cref="EditorPanesStats.HasData"/> == false with a real
        /// <see cref="EditorPanesStats.Reason"/>) exactly like #2711's series — no PAT, no active
        /// milestone, or GitHub unreachable never renders a fabricated 0.
        /// </summary>
        public static async Task<EditorPanesStats> GetActiveMilestoneStatsAsync(bool forceRefresh = false)
        {
            var active = await GitHubIssueTimeSeriesService.ResolveActiveMilestoneAsync();
            if (active == null)
                return EditorPanesStats.Empty("no active GitHub milestone could be resolved (no PAT, GitHub unreachable, or no open milestone has issues).");

            var fetch = await GitHubIssueTimeSeriesService.GetAllIssuesAsync(forceRefresh);
            if (!fetch.Success)
                return EditorPanesStats.Empty($"GitHub unreachable: {fetch.Error}");

            // New/closed today — the series' own latest real bucket. #2711's BuildSeries still
            // populates Points with whatever real data exists even when HasEnoughData is false
            // (e.g. a brand-new milestone with <2 days of history), so today's real opened/closed
            // count is available independent of that laxer trend-worthiness gate.
            var series = GitHubIssueTimeSeriesService.BuildSeries(
                fetch.Issues.Where(i => i.MilestoneNumber == active.Number).ToList(),
                active.Title, DateTime.UtcNow, fetch.Issues);
            int newToday = 0, closedToday = 0;
            if (series.Points.Count > 0)
            {
                var today = series.Points[series.Points.Count - 1];
                newToday = today.Opened;
                closedToday = today.Closed;
            }

            // Features open/done — every real Feature-titled issue in this milestone, classified
            // via the same real transitive-leaf-completion logic the Git Board tree pill (#2773)
            // and hide-completed check (#2780) already use.
            var features = fetch.Issues
                .Where(i => i.MilestoneNumber == active.Number && GitBoardIssueFilters.IsPlaceholder(i)
                    && (i.Title ?? "").TrimStart().StartsWith("Feature:", StringComparison.OrdinalIgnoreCase))
                .ToList();

            int featuresOpen = 0, featuresDone = 0;
            foreach (var feature in features)
            {
                var (total, closed) = GitBoardIssueFilters.ComputeTransitiveLeafRollup(feature, fetch.Issues);
                bool fullyComplete = total > 0 && closed == total;
                if (fullyComplete) featuresDone++;
                else featuresOpen++;
            }

            return new EditorPanesStats
            {
                HasData = true,
                NewToday = newToday,
                ClosedToday = closedToday,
                FeaturesOpen = featuresOpen,
                FeaturesDone = featuresDone,
            };
        }
    }
}
