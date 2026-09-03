using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    /// <summary>Git #2714 — the honest outcome of fitting a completion ETA over a real
    /// closed-count series. Either an ETA cleared every confidence gate
    /// (<see cref="HasEta"/> == true, <see cref="Eta"/> is the real remaining time), or it
    /// didn't and <see cref="EtaReason"/> carries the honest reason it was withheld — never a
    /// fabricated date.</summary>
    public sealed class IssueEtaResult
    {
        /// <summary>True only when the projection cleared its confidence gates.</summary>
        public bool HasEta { get; init; }
        /// <summary>Remaining time to completion, when <see cref="HasEta"/> is true.</summary>
        public TimeSpan Eta { get; init; }
        /// <summary>Why no ETA was produced (too little history, flat pace, already complete),
        /// when <see cref="HasEta"/> is false. Never null in that case.</summary>
        public string? EtaReason { get; init; }
        /// <summary>Fitted pace, issues closed per day (for the honest "at this rate" line).
        /// Populated once the pace gate is cleared, even on a complete scope.</summary>
        public double IssuesPerDay { get; init; }
    }

    /// <summary>
    /// Git #2714 — the ONE shared, honest ETA-projection core, extracted verbatim from
    /// <see cref="FocusModeService"/>'s existing milestone-ETA logic so the Home dashboard's
    /// per-Epic and Milestone projections use the exact same sampling/gating discipline the
    /// Focus bar already demonstrates — not a parallel approximation of it.
    ///
    /// The math is the same least-squares growth-rate fit the Claude usage-meter uses
    /// (<see cref="UsageProjection.LeastSquaresSlopePerHour"/>): feed a (time, cumulative
    /// closed-count) series, get "issues closed per hour," project the remaining count over
    /// that pace. The gates are identical too, and each fail-closed reason string is the same
    /// wording the Focus bar has always shown:
    ///
    ///   1. fewer than <see cref="MinEtaSamples"/> readings   → "not enough closed-count history yet …"
    ///   2. history spanning less than <see cref="MinEtaSpan"/> → "history only spans … — too short …"
    ///   3. a flat fitted pace                                 → "pace is flat in the current history — no honest ETA"
    ///   4. nothing left to close                              → "<scope> complete"
    ///
    /// <see cref="FocusModeService.BuildProgress"/> and
    /// <see cref="HomeEtaProjectionService"/> both call <see cref="Project"/>; there is no
    /// second copy of this discipline anywhere.
    /// </summary>
    public static class IssueEtaProjection
    {
        /// <summary>Fewest closed-count readings before a pace is trusted — one or two points
        /// can't show a real trend. (Mirrors <c>FocusModeService.MinEtaSamples</c> exactly.)</summary>
        public const int MinEtaSamples = 3;

        /// <summary>Shortest history span a pace is fit over — closes are rarer than usage ticks,
        /// so the span gate is loose but never trusts a single instant.
        /// (Mirrors <c>FocusModeService.MinEtaSpan</c> exactly.)</summary>
        public static readonly TimeSpan MinEtaSpan = TimeSpan.FromHours(1);

        /// <summary>
        /// Fit a completion ETA over <paramref name="window"/> — a series of
        /// (<see cref="UsageSample.At"/>, <see cref="UsageSample.Percent"/>) points where
        /// <c>Percent</c> carries the real cumulative closed-count at that time — projecting the
        /// <paramref name="remaining"/> still-open issues over the fitted pace. Withholds the ETA
        /// with an honest reason rather than guessing when the confidence gates aren't met.
        /// <paramref name="scopeNoun"/> only tailors the "&lt;scope&gt; complete" reason wording
        /// (e.g. "milestone" / "epic"); it never changes the math or the gates.
        /// </summary>
        public static IssueEtaResult Project(IReadOnlyList<UsageSample> window, int remaining, string scopeNoun = "milestone")
        {
            if (window.Count < MinEtaSamples)
                return new IssueEtaResult { EtaReason = $"not enough closed-count history yet ({window.Count}/{MinEtaSamples} readings)" };

            var span = window[^1].At - window[0].At;
            if (span < MinEtaSpan)
                return new IssueEtaResult { EtaReason = $"history only spans {span.TotalMinutes:0}m (< {MinEtaSpan.TotalMinutes:0}m) — too short to trust a pace" };

            // Reuse the usage-meter's least-squares slope: feed (time, closed-count) so the fitted
            // slope is "issues closed per hour" (UsageSample.Percent is just the y value here).
            double perHour = UsageProjection.LeastSquaresSlopePerHour(window);
            if (perHour <= 0.0001)
                return new IssueEtaResult { EtaReason = "pace is flat in the current history — no honest ETA" };

            double perDay = perHour * 24.0;
            if (remaining <= 0)
                return new IssueEtaResult { EtaReason = $"{scopeNoun} complete", IssuesPerDay = perDay };

            return new IssueEtaResult
            {
                HasEta = true,
                Eta = TimeSpan.FromHours(remaining / perHour),
                IssuesPerDay = perDay,
            };
        }
    }
}
