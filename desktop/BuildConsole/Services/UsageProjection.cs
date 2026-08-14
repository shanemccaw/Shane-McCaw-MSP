using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services
{
    /// <summary>The outcome of a projection attempt. Either a real time-to-100% estimate
    /// (<see cref="HasProjection"/> true) or a <see cref="Reason"/> string explaining why one
    /// couldn't be made yet, so the poll can log exactly why it's withholding an estimate.</summary>
    public class UsageProjectionResult
    {
        public bool HasProjection { get; set; }
        /// <summary>Estimated time from the latest reading until usage hits 100%, at the observed rate.</summary>
        public TimeSpan? TimeTo100 { get; set; }
        /// <summary>The fitted growth rate in percentage-points per hour (least-squares slope over the window).</summary>
        public double RatePerHour { get; set; }
        /// <summary>How many samples fell inside the current reset window (the ones the rate was fit over).</summary>
        public int WindowSampleCount { get; set; }
        /// <summary>Human-readable reason no projection was produced — for the diagnostic log.</summary>
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>
    /// Turns a persisted series of usage readings into a "time until 100%" estimate.
    ///
    /// The core constraint (task #2): usage resets to ~0% on a weekly boundary, so a rate
    /// averaged ACROSS a reset is meaningless. Everything here is therefore scoped to the
    /// CURRENT reset window — <see cref="CurrentWindow"/> walks the series and cuts at the
    /// most recent reset boundary, detected two independent ways:
    ///   • the parsed reset-target jumped forward (the "Resets Sun 9pm" moment rolled to next
    ///     week once this week's passed), or
    ///   • the percentage dropped unexpectedly (a window can only ever climb, so a real drop
    ///     of more than <see cref="ResetDropThresholdPercent"/> means it reset between samples).
    ///
    /// The rate itself (task #3) is a linear least-squares fit across ALL current-window
    /// points, not a two-point extrapolation of the last two readings — usage is bursty, and
    /// two adjacent points give a wildly unstable slope. A broad fit smooths that out.
    ///
    /// A projection is withheld (task #5) until the window holds enough data to be meaningful:
    /// at least <see cref="MinWindowSamples"/> points spanning at least <see cref="MinWindowSpan"/>,
    /// with a genuinely positive rate — so a wild estimate off one or two points right after a
    /// reset is never shown.
    /// </summary>
    public static class UsageProjection
    {
        /// <summary>A same-window series only ever climbs; a drop larger than this between two
        /// consecutive samples is read as a reset having happened between them.</summary>
        public const int ResetDropThresholdPercent = 5;

        /// <summary>Reset-target equality tolerance: a forward jump larger than this marks a new window.</summary>
        private static readonly TimeSpan ResetTargetJumpTolerance = TimeSpan.FromHours(1);

        /// <summary>Minimum points in the current window before any projection is shown.</summary>
        public const int MinWindowSamples = 3;

        /// <summary>Minimum time the current-window points must span before a projection is shown —
        /// guards against three readings clustered into a couple of minutes giving a false rate.</summary>
        public static readonly TimeSpan MinWindowSpan = TimeSpan.FromMinutes(20);

        /// <summary>Rate must be at least this many %/hour to project — below it the line is
        /// effectively flat and "time to 100%" would be absurdly far out / unstable.</summary>
        public const double MinRatePerHour = 0.02;

        /// <summary>Returns the subset of <paramref name="all"/> belonging to the current (most
        /// recent) reset window — everything after the last detected reset boundary. If no reset
        /// is detected in the series, the whole series is the current window.</summary>
        public static List<UsageSample> CurrentWindow(IReadOnlyList<UsageSample> all)
        {
            var ordered = all.OrderBy(s => s.At).ToList();
            if (ordered.Count <= 1) return ordered;

            int startIndex = 0;
            for (int i = 1; i < ordered.Count; i++)
            {
                var prev = ordered[i - 1];
                var cur = ordered[i];

                bool percentDropped = cur.Percent < prev.Percent - ResetDropThresholdPercent;

                bool resetTargetJumped =
                    prev.ResetTarget.HasValue && cur.ResetTarget.HasValue &&
                    cur.ResetTarget.Value - prev.ResetTarget.Value > ResetTargetJumpTolerance;

                if (percentDropped || resetTargetJumped)
                    startIndex = i; // window restarts AT this reset-boundary sample
            }

            return ordered.Skip(startIndex).ToList();
        }

        /// <summary>Computes a projection from the full series, scoping the rate to the current
        /// window. <paramref name="now"/> is the moment the latest reading was taken (the anchor
        /// the returned <see cref="UsageProjectionResult.TimeTo100"/> is measured from).</summary>
        public static UsageProjectionResult Compute(IReadOnlyList<UsageSample> all, DateTime now)
        {
            var window = CurrentWindow(all);
            var result = new UsageProjectionResult { WindowSampleCount = window.Count };

            if (window.Count < MinWindowSamples)
            {
                result.Reason = $"not enough data in the current window yet ({window.Count}/{MinWindowSamples} points since the last reset)";
                return result;
            }

            var first = window[0];
            var last = window[window.Count - 1];
            var span = last.At - first.At;
            if (span < MinWindowSpan)
            {
                result.Reason = $"current-window points only span {span.TotalMinutes:0}m (< {MinWindowSpan.TotalMinutes:0}m) — too short to trust a rate";
                return result;
            }

            double slope = LeastSquaresSlopePerHour(window);
            result.RatePerHour = slope;

            if (slope < MinRatePerHour)
            {
                result.Reason = $"usage is flat/declining in the current window (rate {slope:0.000}%/hr) — no meaningful climb to 100%";
                return result;
            }

            int currentPercent = last.Percent;
            double remaining = 100.0 - currentPercent;
            if (remaining <= 0)
            {
                result.Reason = "already at 100%";
                return result;
            }

            double hoursTo100 = remaining / slope;
            result.TimeTo100 = TimeSpan.FromHours(hoursTo100);
            result.HasProjection = true;
            return result;
        }

        /// <summary>Ordinary-least-squares slope of percent vs. time, in %/hour. x is hours since the
        /// first window point; y is the percentage. Returns 0 when the x-variance is zero (all points
        /// at one instant), which the span guard above already rules out in practice.</summary>
        internal static double LeastSquaresSlopePerHour(IReadOnlyList<UsageSample> window)
        {
            var t0 = window[0].At;
            int n = window.Count;
            double sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            foreach (var s in window)
            {
                double x = (s.At - t0).TotalHours;
                double y = s.Percent;
                sumX += x;
                sumY += y;
                sumXY += x * y;
                sumXX += x * x;
            }

            double denom = n * sumXX - sumX * sumX;
            if (Math.Abs(denom) < 1e-9) return 0;
            return (n * sumXY - sumX * sumY) / denom;
        }
    }
}
