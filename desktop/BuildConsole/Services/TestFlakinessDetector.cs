using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace BuildConsole.Services
{
    /// <summary>
    /// Reliability classification for test manifests based on historical run patterns.
    /// Distinguishes between flaky tests (unreliable tests with intermittent results)
    /// and genuine regressions (code/API actually broke, failing consistently).
    /// </summary>
    public enum TestReliabilityCategory
    {
        /// <summary>Consistently passing with no failures in the recent evaluation window.</summary>
        StablePass,

        /// <summary>Intermittent pass/fail results across recent runs without a code fix (flips back and forth).</summary>
        Flaky,

        /// <summary>Previously passed, but is now consistently failing across recent consecutive runs.</summary>
        Regression,

        /// <summary>Has never passed across any recorded runs in history.</summary>
        PersistentFail,

        /// <summary>Only one run recorded; insufficient history to determine trend.</summary>
        SingleRun,
    }

    /// <summary>
    /// Calculated reliability metrics and pattern breakdown for a single test manifest.
    /// </summary>
    public class ManifestReliability
    {
        public int Issue { get; set; }
        public string Feature { get; set; } = string.Empty;
        public string ManifestKey => Issue > 0 ? $"#{Issue}" : (string.IsNullOrWhiteSpace(Feature) ? "#0" : Feature);
        public TestReliabilityCategory Category { get; set; }
        public int TotalRuns { get; set; }
        public int RecentRunsEvaluated { get; set; }
        public int RecentPassCount { get; set; }
        public int RecentFailCount { get; set; }
        public int FlipsCount { get; set; }
        public double PassRate { get; set; } // 0.0 to 1.0
        public bool LatestPassed { get; set; }
        public int CurrentStreak { get; set; }
        /// <summary>Chronological pass/fail pattern summary for recent runs (oldest to newest), e.g. "✔ ✖ ✔ ✖ ✔".</summary>
        public string PatternSummary { get; set; } = string.Empty;
        public string DetailReason { get; set; } = string.Empty;
        public DateTime LastRunAt { get; set; }

        public bool IsFlaky => Category == TestReliabilityCategory.Flaky;
        public bool IsRegression => Category == TestReliabilityCategory.Regression;
        public bool IsStablePass => Category == TestReliabilityCategory.StablePass;
    }

    /// <summary>
    /// Analyzes test history to detect flaky tests and regressions.
    /// </summary>
    public static class TestFlakinessDetector
    {
        private const string Channel = "testing.flakiness";
        public const int DefaultWindowSize = 10;

        /// <summary>
        /// Analyzes a collection of historical runs for a single manifest and returns its reliability classification.
        /// </summary>
        public static ManifestReliability Analyze(IEnumerable<TestHistoryEntry> entries, int windowSize = DefaultWindowSize)
        {
            var allRuns = entries.OrderBy(e => e.StartedAt).ToList();
            if (allRuns.Count == 0)
            {
                return new ManifestReliability
                {
                    Category = TestReliabilityCategory.SingleRun,
                    DetailReason = "No runs recorded",
                };
            }

            var first = allRuns[0];
            var last = allRuns[^1];
            int issue = last.Issue > 0 ? last.Issue : first.Issue;
            string feature = !string.IsNullOrWhiteSpace(last.Feature) ? last.Feature : first.Feature;

            if (allRuns.Count == 1)
            {
                bool pass = last.AllPassed;
                return new ManifestReliability
                {
                    Issue = issue,
                    Feature = feature,
                    Category = TestReliabilityCategory.SingleRun,
                    TotalRuns = 1,
                    RecentRunsEvaluated = 1,
                    RecentPassCount = pass ? 1 : 0,
                    RecentFailCount = pass ? 0 : 1,
                    FlipsCount = 0,
                    PassRate = pass ? 1.0 : 0.0,
                    LatestPassed = pass,
                    CurrentStreak = 1,
                    PatternSummary = pass ? "✔" : "✖",
                    DetailReason = pass ? "Single passing run" : "Single failing run",
                    LastRunAt = last.StartedAt,
                };
            }

            // Evaluate recent window (up to windowSize runs)
            var recentWindow = allRuns.TakeLast(windowSize).ToList();
            int recentCount = recentWindow.Count;
            int recentPasses = recentWindow.Count(r => r.AllPassed);
            int recentFails = recentWindow.Count(r => !r.AllPassed);
            double passRate = (double)recentPasses / recentCount;

            // Calculate flips (outcome changes between adjacent chronological runs)
            int flips = 0;
            for (int i = 1; i < recentCount; i++)
            {
                if (recentWindow[i].AllPassed != recentWindow[i - 1].AllPassed)
                {
                    flips++;
                }
            }

            // Build chronological pattern string: "✔ ✖ ✔ ✖ ✔" (oldest to newest)
            var patternBuilder = new StringBuilder();
            for (int i = 0; i < recentCount; i++)
            {
                if (i > 0) patternBuilder.Append(' ');
                patternBuilder.Append(recentWindow[i].AllPassed ? "✔" : "✖");
            }
            string pattern = patternBuilder.ToString();

            // Calculate streak backwards from newest run
            bool latestPassed = recentWindow[^1].AllPassed;
            int streak = 0;
            for (int i = recentCount - 1; i >= 0; i--)
            {
                if (recentWindow[i].AllPassed == latestPassed)
                    streak++;
                else
                    break;
            }

            bool hasEverPassedInAllHistory = allRuns.Any(r => r.AllPassed);
            bool hasEverFailedInAllHistory = allRuns.Any(r => !r.AllPassed);

            TestReliabilityCategory category;
            string detailReason;

            if (recentFails == 0)
            {
                category = TestReliabilityCategory.StablePass;
                detailReason = $"Stable pass: passed last {streak} consecutive runs";
            }
            else if (!hasEverPassedInAllHistory)
            {
                category = TestReliabilityCategory.PersistentFail;
                detailReason = $"Persistent failure: failed all {allRuns.Count} recorded runs";
            }
            else
            {
                // Both passes and fails present in history.
                // Distinguish Flaky vs Regression:
                bool isCleanRegression = !latestPassed && flips == 1 && streak == recentFails && hasEverPassedInAllHistory;

                if (isCleanRegression)
                {
                    category = TestReliabilityCategory.Regression;
                    detailReason = $"Active regression: failing last {streak} consecutive runs after previous passes";
                }
                else if (flips >= 2)
                {
                    // 2 or more flips across recent runs (e.g. ✔ ✖ ✔ or ✖ ✔ ✖) = flaky
                    category = TestReliabilityCategory.Flaky;
                    detailReason = $"Flaky test: {flips} pass/fail flips across last {recentCount} runs ({recentPasses}/{recentCount} passed)";
                }
                else if (flips >= 1 && latestPassed)
                {
                    // Flipped and passed again without sustained failure
                    category = TestReliabilityCategory.Flaky;
                    detailReason = $"Flaky test: intermittent pass/fail recovery ({pattern})";
                }
                else if (flips >= 1 && recentCount >= 2 && (recentWindow[^1].StartedAt - recentWindow[^2].StartedAt).TotalHours <= 24 && recentWindow[^1].Total == recentWindow[^2].Total)
                {
                    // Flipped in close succession with identical step structure
                    category = TestReliabilityCategory.Flaky;
                    detailReason = $"Flaky test: result flipped in close succession without code changes ({pattern})";
                }
                else if (!latestPassed)
                {
                    category = TestReliabilityCategory.Regression;
                    detailReason = $"Regression: failing last {streak} runs ({recentPasses}/{recentCount} passed in window)";
                }
                else
                {
                    category = TestReliabilityCategory.Flaky;
                    detailReason = $"Flaky test: intermittent results ({pattern})";
                }
            }

            return new ManifestReliability
            {
                Issue = issue,
                Feature = feature,
                Category = category,
                TotalRuns = allRuns.Count,
                RecentRunsEvaluated = recentCount,
                RecentPassCount = recentPasses,
                RecentFailCount = recentFails,
                FlipsCount = flips,
                PassRate = passRate,
                LatestPassed = latestPassed,
                CurrentStreak = streak,
                PatternSummary = pattern,
                DetailReason = detailReason,
                LastRunAt = last.StartedAt,
            };
        }

        /// <summary>
        /// Analyzes all history entries and groups them by manifest identity, logging any detected flaky or regression manifests.
        /// </summary>
        public static Dictionary<string, ManifestReliability> AnalyzeAll(IEnumerable<TestHistoryEntry> allEntries)
        {
            var result = new Dictionary<string, ManifestReliability>(StringComparer.OrdinalIgnoreCase);

            var groups = allEntries
                .GroupBy(e => e.Issue > 0 ? $"issue:{e.Issue}" : $"feature:{e.Feature}");

            foreach (var group in groups)
            {
                var analysis = Analyze(group);
                result[group.Key] = analysis;
                if (analysis.Issue > 0)
                {
                    result[$"issue:{analysis.Issue}"] = analysis;
                    result[analysis.Issue.ToString()] = analysis;
                }
                if (!string.IsNullOrWhiteSpace(analysis.Feature))
                {
                    result[$"feature:{analysis.Feature}"] = analysis;
                    result[analysis.Feature] = analysis;
                }

                // Wire logging for detected flaky and regression manifests
                if (analysis.Category == TestReliabilityCategory.Flaky)
                {
                    ActivityLog.Log(Channel,
                        $"Flaky manifest detected: #{analysis.Issue} '{analysis.Feature}' — pattern: [{analysis.PatternSummary}] ({analysis.RecentPassCount}/{analysis.RecentRunsEvaluated} passed, {analysis.FlipsCount} flips across {analysis.RecentRunsEvaluated} runs).");
                }
                else if (analysis.Category == TestReliabilityCategory.Regression)
                {
                    ActivityLog.Log(Channel,
                        $"Regression manifest detected: #{analysis.Issue} '{analysis.Feature}' — failing last {analysis.CurrentStreak} consecutive runs (pattern: [{analysis.PatternSummary}]).");
                }
            }

            return result;
        }
    }
}
