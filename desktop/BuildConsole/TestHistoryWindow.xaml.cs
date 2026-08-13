using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>Git #968 (Epic #803) — one row in the "Runs (newest first)" list, wrapping a
    /// TestHistoryEntry read back from test-results/_history.jsonl.</summary>
    public class HistoryRunItem
    {
        private static readonly SolidColorBrush PassBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBrush = Frozen(0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        public TestHistoryEntry Entry { get; }
        public HistoryRunItem(TestHistoryEntry entry) => Entry = entry;

        public string Title => $"#{Entry.Issue} — {Entry.Feature}";
        public string ModeLabel => Entry.Mode;
        public string StartedAtDisplay => Entry.StartedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
        public string CountsLabel => $"{Entry.Passed}/{Entry.Total}";
        public string StatusGlyph => Entry.AllPassed ? "✔" : "✖";
        public Brush StatusBrush => Entry.AllPassed ? PassBrush : FailBrush;
    }

    /// <summary>One row in the "Per-Manifest Streaks" list — the most recent run's manifest, plus
    /// how many consecutive runs in a row landed the same way (e.g. "failed the last 2 runs").
    /// Streaks are computed fresh from the full history on every Refresh, not stored — cheap for
    /// the data volumes a desktop test tool accumulates, and avoids a second persisted shape that
    /// could drift from the raw entries.</summary>
    public class ManifestStreakItem
    {
        private static readonly SolidColorBrush PassBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBrush = Frozen(0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        public int Issue { get; set; }
        public string Feature { get; set; } = "";
        public bool LastAllPassed { get; set; }
        public int StreakCount { get; set; }

        public string Title => $"#{Issue} — {Feature}";
        public string StatusGlyph => LastAllPassed ? "✔" : "✖";
        public Brush StatusBrush => LastAllPassed ? PassBrush : FailBrush;

        public string StreakLabel => StreakCount <= 1
            ? (LastAllPassed ? "passed last run" : "failed last run")
            : (LastAllPassed ? $"passed the last {StreakCount} runs" : $"failed the last {StreakCount} runs");
    }

    public partial class TestHistoryWindow : Window
    {
        public TestHistoryWindow()
        {
            InitializeComponent();
            Refresh();
        }

        public void Refresh()
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            var entries = repoRoot != null ? TestHistoryStore.ReadAll(repoRoot) : new List<TestHistoryEntry>();

            var newestFirst = entries.OrderByDescending(e => e.StartedAt).ToList();
            RunsList.ItemsSource = new ObservableCollection<HistoryRunItem>(newestFirst.Select(e => new HistoryRunItem(e)));
            TxtNoRuns.Visibility = newestFirst.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            var streaks = newestFirst
                .GroupBy(e => e.Issue)
                .Select(BuildStreak)
                .OrderByDescending(s => s.Issue)
                .ToList();
            StreaksList.ItemsSource = new ObservableCollection<ManifestStreakItem>(streaks);
            TxtNoStreaks.Visibility = streaks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            ActivityLog.Log("testing.history-view", $"Test History refreshed: {newestFirst.Count} run(s), {streaks.Count} manifest(s).");
        }

        private static ManifestStreakItem BuildStreak(IGrouping<int, TestHistoryEntry> group)
        {
            var runsNewestFirst = group.OrderByDescending(e => e.StartedAt).ToList();
            bool lastResult = runsNewestFirst[0].AllPassed;
            int streak = 0;
            foreach (var run in runsNewestFirst)
            {
                if (run.AllPassed != lastResult) break;
                streak++;
            }

            return new ManifestStreakItem
            {
                Issue = group.Key,
                Feature = runsNewestFirst[0].Feature,
                LastAllPassed = lastResult,
                StreakCount = streak,
            };
        }

        private void BtnRefresh_Click(object sender, RoutedEventArgs e) => Refresh();
    }
}
