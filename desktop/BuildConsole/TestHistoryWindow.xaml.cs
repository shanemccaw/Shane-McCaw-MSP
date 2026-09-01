using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Item view-model for the left-hand test runs list in TestHistoryWindow.
    /// </summary>
    public class HistoryRunItem
    {
        private static readonly SolidColorBrush PassBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBrush = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush PassBgBrush = Frozen(0x20, 0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBgBrush = Frozen(0x28, 0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush FlakyBrush = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush FlakyBgBrush = Frozen(0x28, 0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush RegressionBrush = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush RegressionBgBrush = Frozen(0x28, 0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        private static SolidColorBrush Frozen(byte a, byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromArgb(a, r, g, b));
            brush.Freeze();
            return brush;
        }

        public TestHistoryEntry Entry { get; }
        public ManifestReliability? Reliability { get; }

        public HistoryRunItem(TestHistoryEntry entry, ManifestReliability? reliability = null)
        {
            Entry = entry;
            Reliability = reliability;
        }

        public int Issue => Entry.Issue;
        public string IssueDisplay => Entry.Issue > 0 ? $"#{Entry.Issue}" : (string.IsNullOrWhiteSpace(Entry.Feature) ? "#0" : Entry.Feature);
        public string Feature => Entry.Feature;
        public string ModeLabel => Entry.Mode.ToUpperInvariant();
        public string StartedAtDisplay => Entry.StartedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
        public string CountsLabel => $"{Entry.Passed}/{Entry.Total} steps";
        public string StatusLabel => Entry.AllPassed ? "PASS" : $"FAIL ({Entry.Failed})";
        public string StatusGlyph => Entry.AllPassed ? "✔" : "✖";
        public Brush StatusBrush => Entry.AllPassed ? PassBrush : FailBrush;
        public Brush StatusBgBrush => Entry.AllPassed ? PassBgBrush : FailBgBrush;

        // Reliability / Flakiness properties
        public bool IsFlaky => Reliability?.Category == TestReliabilityCategory.Flaky;
        public bool IsRegression => Reliability?.Category == TestReliabilityCategory.Regression;
        public Visibility ReliabilityBadgeVisibility => (IsFlaky || IsRegression) ? Visibility.Visible : Visibility.Collapsed;
        public string ReliabilityBadgeLabel => IsFlaky ? "⚠️ FLAKY" : (IsRegression ? "🚨 REGRESSION" : string.Empty);
        public Brush ReliabilityBadgeBgBrush => IsFlaky ? FlakyBgBrush : RegressionBgBrush;
        public Brush ReliabilityBadgeFgBrush => IsFlaky ? FlakyBrush : RegressionBrush;
        public string ReliabilityToolTip => Reliability?.DetailReason ?? string.Empty;
    }

    /// <summary>
    /// Item view-model for the manifest streaks and reliability summary list.
    /// </summary>
    public class ManifestStreakItem
    {
        private static readonly SolidColorBrush PassBrush = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FailBrush = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush PassBgBrush = Frozen(0x20, 0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush FlakyBrush = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush FlakyBgBrush = Frozen(0x28, 0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush RegressionBrush = Frozen(0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush RegressionBgBrush = Frozen(0x28, 0xF3, 0x8B, 0xA8);
        private static readonly SolidColorBrush SubtextBrush = Frozen(0xA6, 0xAD, 0xC8);
        private static readonly SolidColorBrush Surface1Brush = Frozen(0x45, 0x47, 0x5A);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
            brush.Freeze();
            return brush;
        }

        private static SolidColorBrush Frozen(byte a, byte r, byte g, byte b)
        {
            var brush = new SolidColorBrush(Color.FromArgb(a, r, g, b));
            brush.Freeze();
            return brush;
        }

        public int Issue { get; set; }
        public string Feature { get; set; } = "";
        public bool LastAllPassed { get; set; }
        public int StreakCount { get; set; }
        public ManifestReliability? Reliability { get; set; }

        public TestReliabilityCategory Category => Reliability?.Category ?? (LastAllPassed ? TestReliabilityCategory.StablePass : TestReliabilityCategory.PersistentFail);

        public string Title => Issue > 0 ? $"#{Issue} — {Feature}" : (string.IsNullOrWhiteSpace(Feature) ? "#0" : Feature);
        public string StatusGlyph => Category switch
        {
            TestReliabilityCategory.Flaky => "⚠️",
            TestReliabilityCategory.Regression => "🚨",
            TestReliabilityCategory.StablePass => "✔",
            _ => (LastAllPassed ? "✔" : "✖")
        };

        public Brush StatusBrush => Category switch
        {
            TestReliabilityCategory.Flaky => FlakyBrush,
            TestReliabilityCategory.Regression => RegressionBrush,
            TestReliabilityCategory.StablePass => PassBrush,
            _ => (LastAllPassed ? PassBrush : FailBrush)
        };

        public string CategoryBadgeLabel => Category switch
        {
            TestReliabilityCategory.Flaky => "⚠️ FLAKY",
            TestReliabilityCategory.Regression => "🚨 REGRESSION",
            TestReliabilityCategory.StablePass => "✅ STABLE",
            TestReliabilityCategory.PersistentFail => "✖ FAILING",
            _ => (LastAllPassed ? "PASS" : "FAIL")
        };

        public Brush CategoryBgBrush => Category switch
        {
            TestReliabilityCategory.Flaky => FlakyBgBrush,
            TestReliabilityCategory.Regression => RegressionBgBrush,
            TestReliabilityCategory.StablePass => PassBgBrush,
            _ => Surface1Brush
        };

        public Brush CategoryFgBrush => Category switch
        {
            TestReliabilityCategory.Flaky => FlakyBrush,
            TestReliabilityCategory.Regression => RegressionBrush,
            TestReliabilityCategory.StablePass => PassBrush,
            _ => SubtextBrush
        };

        public string StreakLabel => Reliability != null
            ? Reliability.DetailReason
            : (StreakCount <= 1
                ? (LastAllPassed ? "passed last run" : "failed last run")
                : (LastAllPassed ? $"passed last {StreakCount} runs" : $"failed last {StreakCount} runs"));

        public string PatternDisplay => Reliability != null
            ? $"Pattern: {Reliability.PatternSummary} ({Math.Round(Reliability.PassRate * 100)}% pass · {Reliability.FlipsCount} flips)"
            : string.Empty;
    }

    /// <summary>
    /// Item for the screenshot gallery view inside the TestHistoryWindow.
    /// </summary>
    public class HistoryScreenshotItem
    {
        public int StepIndex { get; set; }
        public string StepLabel { get; set; } = "";
        public string Reason { get; set; } = "";
        public string FilePath { get; set; } = "";
        public bool Passed { get; set; }
    }

    public partial class TestHistoryWindow : Window
    {
        private int? _issueFilter;
        private List<TestHistoryEntry> _allEntries = new();
        private Dictionary<string, ManifestReliability> _reliabilityByManifest = new(StringComparer.OrdinalIgnoreCase);
        private ManifestReliability? _currentReliability;
        private ManifestRunResult? _currentRunResult;
        private string? _currentResultFilePath;
        private List<HistoryScreenshotItem> _currentScreenshots = new();
        private int _currentScreenshotIndex = 0;

        public TestHistoryWindow()
        {
            InitializeComponent();
            Refresh();
        }

        public void Refresh() => Refresh(_issueFilter);

        public void Refresh(int? issueFilter)
        {
            _issueFilter = issueFilter;
            PillFilterBanner.Visibility = issueFilter.HasValue ? Visibility.Visible : Visibility.Collapsed;
            TxtFilterBanner.Text = issueFilter.HasValue ? $"Filtered to #{issueFilter.Value}" : "";

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            _allEntries = repoRoot != null ? TestHistoryStore.ReadAll(repoRoot) : new List<TestHistoryEntry>();
            _reliabilityByManifest = TestFlakinessDetector.AnalyzeAll(_allEntries);

            ApplyRunFilters();
            PopulateStreaks();

            ActivityLog.Log("testing.history-view", $"Test History refreshed: {_allEntries.Count} run(s).");
        }

        private ManifestReliability? GetReliability(TestHistoryEntry entry)
        {
            if (entry.Issue > 0 && _reliabilityByManifest.TryGetValue($"issue:{entry.Issue}", out var relIssue))
                return relIssue;
            if (!string.IsNullOrEmpty(entry.Feature) && _reliabilityByManifest.TryGetValue($"feature:{entry.Feature}", out var relFeat))
                return relFeat;
            if (entry.Issue > 0 && _reliabilityByManifest.TryGetValue(entry.Issue.ToString(), out var relNum))
                return relNum;
            return null;
        }

        private void ApplyRunFilters()
        {
            var filtered = _allEntries.AsEnumerable();

            // Issue filter
            if (_issueFilter.HasValue)
                filtered = filtered.Where(e => e.Issue == _issueFilter.Value);

            // Pass/Fail/Flaky/Regression Radio filter
            if (RadioFilterFlaky.IsChecked == true)
                filtered = filtered.Where(e => GetReliability(e)?.Category == TestReliabilityCategory.Flaky);
            else if (RadioFilterRegression.IsChecked == true)
                filtered = filtered.Where(e => GetReliability(e)?.Category == TestReliabilityCategory.Regression);
            else if (RadioFilterFailed.IsChecked == true)
                filtered = filtered.Where(e => !e.AllPassed);
            else if (RadioFilterPassed.IsChecked == true)
                filtered = filtered.Where(e => e.AllPassed);

            // Search query filter
            string query = TxtSearch.Text.Trim();
            if (!string.IsNullOrWhiteSpace(query))
            {
                filtered = filtered.Where(e =>
                    e.Issue.ToString().Contains(query, StringComparison.OrdinalIgnoreCase) ||
                    e.Feature.Contains(query, StringComparison.OrdinalIgnoreCase));
            }

            var newestFirst = filtered.OrderByDescending(e => e.StartedAt).ToList();
            RunsList.ItemsSource = new ObservableCollection<HistoryRunItem>(newestFirst.Select(e => new HistoryRunItem(e, GetReliability(e))));
            TxtNoRuns.Visibility = newestFirst.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            TxtRunCountBadge.Text = $"{newestFirst.Count} run{(newestFirst.Count == 1 ? "" : "s")}";

            // Auto-select first item if none is selected
            if (newestFirst.Count > 0 && (RunsList.SelectedItem == null || !newestFirst.Any(e => e == ((HistoryRunItem)RunsList.SelectedItem).Entry)))
            {
                RunsList.SelectedIndex = 0;
            }
            else if (newestFirst.Count == 0)
            {
                ShowNoSelection();
            }
        }

        private void PopulateStreaks()
        {
            var streaks = _allEntries
                .OrderByDescending(e => e.StartedAt)
                .GroupBy(e => e.Issue > 0 ? $"issue:{e.Issue}" : $"feature:{e.Feature}")
                .Select(BuildStreak)
                .OrderBy(s => s.Category switch
                {
                    TestReliabilityCategory.Flaky => 0,
                    TestReliabilityCategory.Regression => 1,
                    TestReliabilityCategory.PersistentFail => 2,
                    _ => 3
                })
                .ThenByDescending(s => s.Issue)
                .ToList();
            StreaksList.ItemsSource = new ObservableCollection<ManifestStreakItem>(streaks);
        }

        private static ManifestStreakItem BuildStreak(IGrouping<string, TestHistoryEntry> group)
        {
            var runsNewestFirst = group.OrderByDescending(e => e.StartedAt).ToList();
            bool lastResult = runsNewestFirst[0].AllPassed;
            int streak = 0;
            foreach (var run in runsNewestFirst)
            {
                if (run.AllPassed != lastResult) break;
                streak++;
            }

            var rel = TestFlakinessDetector.Analyze(group);

            return new ManifestStreakItem
            {
                Issue = runsNewestFirst[0].Issue,
                Feature = runsNewestFirst[0].Feature,
                LastAllPassed = lastResult,
                StreakCount = streak,
                Reliability = rel,
            };
        }

        // ── Left panel events ───────────────────────────────────────────────

        private void RunsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (RunsList.SelectedItem is HistoryRunItem item)
            {
                LoadRunDetail(item.Entry);
            }
            else
            {
                ShowNoSelection();
            }
        }

        private void StreaksList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (StreaksList.SelectedItem is ManifestStreakItem streak)
            {
                // Switch back to runs view filtered to this issue or feature
                ToggleStreaksView.IsChecked = false;
                ToggleStreaksView_Click(this, new RoutedEventArgs());
                TxtSearch.Text = streak.Issue > 0 ? streak.Issue.ToString() : streak.Feature;
            }
        }

        private void ToggleStreaksView_Click(object sender, RoutedEventArgs e)
        {
            bool showStreaks = ToggleStreaksView.IsChecked == true;
            StreaksList.Visibility = showStreaks ? Visibility.Visible : Visibility.Collapsed;
            RunsList.Visibility = showStreaks ? Visibility.Collapsed : Visibility.Visible;
            TxtListHeader.Text = showStreaks ? "Per-Manifest Reliability & Streaks" : "Test Runs (newest first)";
        }

        private void Filter_Changed(object sender, RoutedEventArgs e)
        {
            if (IsLoaded) ApplyRunFilters();
        }

        private void TxtSearch_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (IsLoaded) ApplyRunFilters();
        }

        // BtnClearSearch_Click removed (Git #2000) — TxtSearch now uses the shared
        // SearchTextBox style, whose baked-in ✕ clears it directly.

        private void BtnClearFilter_Click(object sender, RoutedEventArgs e)
        {
            Refresh(null);
        }

        private void BtnRefresh_Click(object sender, RoutedEventArgs e)
        {
            Refresh();
        }

        // ── Detail loading & rendering ──────────────────────────────────────

        private void ShowNoSelection()
        {
            PanelNoSelection.Visibility = Visibility.Visible;
            PanelRunDetail.Visibility = Visibility.Collapsed;
            _currentRunResult = null;
        }

        private void LoadRunDetail(TestHistoryEntry entry)
        {
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            _currentResultFilePath = null;
            _currentRunResult = null;

            if (repoRoot != null)
            {
                // Try finding the JSON file
                string dir = Path.Combine(repoRoot, "test-results");
                if (!string.IsNullOrEmpty(entry.ResultFile))
                {
                    string primaryPath = Path.Combine(dir, entry.ResultFile);
                    if (File.Exists(primaryPath)) _currentResultFilePath = primaryPath;
                }

                if (_currentResultFilePath == null)
                {
                    string fallbackStem = $"{entry.Issue}-{entry.StartedAt:yyyyMMddHHmmss}.json";
                    string fallbackPath = Path.Combine(dir, fallbackStem);
                    if (File.Exists(fallbackPath)) _currentResultFilePath = fallbackPath;
                }

                if (_currentResultFilePath != null)
                {
                    try
                    {
                        string json = File.ReadAllText(_currentResultFilePath);
                        _currentRunResult = JsonSerializer.Deserialize<ManifestRunResult>(json);
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("testing.history-view", $"Error reading run result JSON {_currentResultFilePath}: {ex.Message}");
                    }
                }
            }

            // If full result JSON is missing, synthesize a minimal one from the entry
            if (_currentRunResult == null)
            {
                _currentRunResult = new ManifestRunResult
                {
                    Issue = entry.Issue,
                    Feature = entry.Feature,
                    Mode = entry.Mode,
                    StartedAt = entry.StartedAt,
                };
            }

            _currentReliability = GetReliability(entry);
            RenderRunHeader(entry, _currentRunResult);
            RenderSteps(_currentRunResult);
            DiscoverAndRenderScreenshots(repoRoot, entry, _currentRunResult);
            RenderRawJson(_currentRunResult);

            PanelNoSelection.Visibility = Visibility.Collapsed;
            PanelRunDetail.Visibility = Visibility.Visible;
        }

        private void RenderRunHeader(TestHistoryEntry entry, ManifestRunResult result)
        {
            // Status Banner
            bool allPassed = entry.AllPassed;
            TxtRunStatusLarge.Text = allPassed ? "✅ ALL PASSED" : $"❌ {entry.Failed} OF {entry.Total} FAILED";
            BadgeRunStatus.Background = allPassed ? GetBrush("GreenBrush", 0x25) : GetBrush("RedBrush", 0x25);
            TxtRunStatusLarge.Foreground = allPassed ? GetBrush("GreenBrush") : GetBrush("RedBrush");

            // Title
            TxtDetailTitle.Text = entry.Issue > 0 ? $"Issue #{entry.Issue} — {entry.Feature}" : entry.Feature;

            // Metadata pills
            TxtMetaStarted.Text = $"🕒 Started: {entry.StartedAt.ToLocalTime():yyyy-MM-dd HH:mm:ss}";

            long totalMs = result.Steps.Sum(s => s.DurationMs);
            string durText = totalMs >= 1000 ? $"{totalMs / 1000.0:0.1}s" : $"{totalMs}ms";
            TxtMetaDuration.Text = $"⏱️ Duration: {durText}";

            TxtMetaStepsCount.Text = $"📊 Steps: {entry.Passed}/{entry.Total} passed";
            TxtMetaMode.Text = $"⚙️ Mode: {entry.Mode}";
            TxtMetaResultFile.Text = $"📁 {Path.GetFileName(_currentResultFilePath ?? entry.ResultFile)}";

            // Reliability & Flakiness Alert Banner
            if (_currentReliability != null)
            {
                if (_currentReliability.Category == TestReliabilityCategory.Flaky)
                {
                    BannerReliabilityAlert.Visibility = Visibility.Visible;
                    BannerReliabilityAlert.Background = GetBrush("PeachBrush", 0x25);
                    BannerReliabilityAlert.BorderBrush = GetBrush("PeachBrush", 0x80);
                    BannerReliabilityAlert.BorderThickness = new Thickness(1);
                    TxtReliabilityAlertGlyph.Text = "⚠️";
                    TxtReliabilityAlertGlyph.Foreground = GetBrush("PeachBrush");
                    TxtReliabilityAlertTitle.Text = "⚠️ FLAKY TEST MANIFEST DETECTED (INTERMITTENT RESULTS)";
                    TxtReliabilityAlertTitle.Foreground = GetBrush("PeachBrush");
                    TxtReliabilityAlertBody.Text = $"This manifest exhibits inconsistent results across recent runs ({_currentReliability.FlipsCount} flips, {_currentReliability.RecentPassCount}/{_currentReliability.RecentRunsEvaluated} passed). Recent pattern: {_currentReliability.PatternSummary}. This failure is likely test instability rather than an application break.";
                    TxtReliabilityAlertBody.Foreground = GetBrush("TextBrush");
                }
                else if (_currentReliability.Category == TestReliabilityCategory.Regression)
                {
                    BannerReliabilityAlert.Visibility = Visibility.Visible;
                    BannerReliabilityAlert.Background = GetBrush("RedBrush", 0x25);
                    BannerReliabilityAlert.BorderBrush = GetBrush("RedBrush", 0x80);
                    BannerReliabilityAlert.BorderThickness = new Thickness(1);
                    TxtReliabilityAlertGlyph.Text = "🚨";
                    TxtReliabilityAlertGlyph.Foreground = GetBrush("RedBrush");
                    TxtReliabilityAlertTitle.Text = "🚨 GENUINE REGRESSION DETECTED (APPLICATION BROKEN)";
                    TxtReliabilityAlertTitle.Foreground = GetBrush("RedBrush");
                    TxtReliabilityAlertBody.Text = $"This manifest previously passed but has consistently failed in its last {_currentReliability.CurrentStreak} consecutive runs (recent pattern: {_currentReliability.PatternSummary}). This indicates a real regression in the application or API.";
                    TxtReliabilityAlertBody.Foreground = GetBrush("TextBrush");
                }
                else if (_currentReliability.Category == TestReliabilityCategory.StablePass)
                {
                    BannerReliabilityAlert.Visibility = Visibility.Visible;
                    BannerReliabilityAlert.Background = GetBrush("GreenBrush", 0x15);
                    BannerReliabilityAlert.BorderBrush = GetBrush("GreenBrush", 0x40);
                    BannerReliabilityAlert.BorderThickness = new Thickness(1);
                    TxtReliabilityAlertGlyph.Text = "✅";
                    TxtReliabilityAlertGlyph.Foreground = GetBrush("GreenBrush");
                    TxtReliabilityAlertTitle.Text = "✅ STABLE TEST MANIFEST";
                    TxtReliabilityAlertTitle.Foreground = GetBrush("GreenBrush");
                    TxtReliabilityAlertBody.Text = $"Consistent pass streak: {_currentReliability.CurrentStreak} consecutive runs (pattern: {_currentReliability.PatternSummary}).";
                    TxtReliabilityAlertBody.Foreground = GetBrush("Subtext1Brush");
                }
                else
                {
                    BannerReliabilityAlert.Visibility = Visibility.Collapsed;
                }
            }
            else
            {
                BannerReliabilityAlert.Visibility = Visibility.Collapsed;
            }
        }

        private void RenderSteps(ManifestRunResult result)
        {
            StepsContainer.Children.Clear();

            var steps = result.Steps.AsEnumerable();

            // Filter
            if (StepFilterFailed.IsChecked == true)
                steps = steps.Where(s => !s.Passed);
            else if (StepFilterUi.IsChecked == true)
                steps = steps.Where(s => s.Kind.Equals("ui", StringComparison.OrdinalIgnoreCase));
            else if (StepFilterApi.IsChecked == true)
                steps = steps.Where(s => !s.Kind.Equals("ui", StringComparison.OrdinalIgnoreCase));

            var stepList = steps.ToList();

            if (stepList.Count == 0)
            {
                var emptyNotice = new TextBlock
                {
                    Text = result.Steps.Count == 0
                        ? "No step data available in the run result JSON."
                        : "No steps match the selected step filter.",
                    FontSize = 12,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(10),
                    HorizontalAlignment = HorizontalAlignment.Center
                };
                StepsContainer.Children.Add(emptyNotice);
                return;
            }

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            int idx = 1;
            foreach (var step in stepList)
            {
                StepsContainer.Children.Add(CreateStepCard(idx++, step, repoRoot));
            }
        }

        private UIElement CreateStepCard(int displayIndex, TestStepResult step, string? repoRoot)
        {
            var cardBorder = new Border
            {
                Background = GetBrush("Surface0Brush"),
                BorderBrush = step.Passed ? GetBrush("Surface1Brush") : GetBrush("RedBrush", 0x80),
                BorderThickness = new Thickness(step.Passed ? 1 : 1.5),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 10, 12, 10),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var stack = new StackPanel();

            // ── Top Row: Index + Kind Badge + Label + Duration + Status ──
            var headerGrid = new Grid { Margin = new Thickness(0, 0, 0, 4) };
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var leftHeader = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

            // Step number
            leftHeader.Children.Add(new TextBlock
            {
                Text = $"#{displayIndex}",
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("Subtext0Brush"),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center
            });

            // Kind Badge (API, GRAPH, UI, etc.)
            string kind = step.Kind.ToUpperInvariant();
            Brush kindBg = kind switch
            {
                "API" => GetBrush("BlueBrush", 0x25),
                "GRAPH" => GetBrush("MauveBrush", 0x25),
                "UI" => GetBrush("TealBrush", 0x25),
                "ZOHO" => GetBrush("PeachBrush", 0x25),
                _ => GetBrush("Surface1Brush")
            };
            Brush kindFg = kind switch
            {
                "API" => GetBrush("BlueBrush"),
                "GRAPH" => GetBrush("MauveBrush"),
                "UI" => GetBrush("TealBrush"),
                "ZOHO" => GetBrush("PeachBrush"),
                _ => GetBrush("TextBrush")
            };

            var kindPill = new Border
            {
                Background = kindBg,
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 1, 6, 1),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = kind,
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = kindFg
                }
            };
            leftHeader.Children.Add(kindPill);

            // Step Label
            leftHeader.Children.Add(new TextBlock
            {
                Text = step.Label,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center
            });

            Grid.SetColumn(leftHeader, 0);
            headerGrid.Children.Add(leftHeader);

            // Right: Duration + Pass/Fail Pill
            var rightHeader = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };

            if (step.DurationMs > 0)
            {
                rightHeader.Children.Add(new TextBlock
                {
                    Text = $"{step.DurationMs}ms",
                    FontSize = 10,
                    Foreground = GetBrush("OverlayBrush"),
                    Margin = new Thickness(0, 0, 8, 0),
                    VerticalAlignment = VerticalAlignment.Center
                });
            }

            var statusPill = new Border
            {
                Background = step.Passed ? GetBrush("GreenBrush", 0x25) : GetBrush("RedBrush", 0x25),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 1, 6, 1),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = step.Passed ? "✔ PASS" : "✖ FAIL",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = step.Passed ? GetBrush("GreenBrush") : GetBrush("RedBrush")
                }
            };
            rightHeader.Children.Add(statusPill);

            Grid.SetColumn(rightHeader, 1);
            headerGrid.Children.Add(rightHeader);

            stack.Children.Add(headerGrid);

            // ── Diagnostic / Failure details (if failed or has rich context) ──
            if (!step.Passed)
            {
                // Error message banner
                if (!string.IsNullOrWhiteSpace(step.Detail))
                {
                    var errBanner = new Border
                    {
                        Background = GetBrush("RedBrush", 0x18),
                        BorderBrush = GetBrush("RedBrush", 0x40),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 6, 8, 6),
                        Margin = new Thickness(0, 6, 0, 6),
                        Child = new TextBlock
                        {
                            Text = $"Error: {step.Detail}",
                            FontSize = 11,
                            FontWeight = FontWeights.SemiBold,
                            Foreground = GetBrush("RedBrush"),
                            TextWrapping = TextWrapping.Wrap
                        }
                    };
                    stack.Children.Add(errBanner);
                }

                // Expected vs Actual comparison boxes
                if (!string.IsNullOrWhiteSpace(step.Expected) || !string.IsNullOrWhiteSpace(step.Actual))
                {
                    var diffGrid = new Grid { Margin = new Thickness(0, 4, 0, 6) };
                    diffGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    diffGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8) });
                    diffGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                    // Expected Box
                    var expBox = new Border
                    {
                        Background = GetBrush("CrustBrush"),
                        BorderBrush = GetBrush("GreenBrush", 0x40),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 6, 8, 6)
                    };
                    var expStack = new StackPanel();
                    expStack.Children.Add(new TextBlock { Text = "EXPECTED", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = GetBrush("GreenBrush"), Margin = new Thickness(0, 0, 0, 2) });
                    expStack.Children.Add(new TextBox
                    {
                        Text = step.Expected,
                        FontSize = 11,
                        FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                        Foreground = GetBrush("TextBrush"),
                        Background = Brushes.Transparent,
                        BorderThickness = new Thickness(0),
                        IsReadOnly = true,
                        TextWrapping = TextWrapping.Wrap
                    });
                    expBox.Child = expStack;
                    Grid.SetColumn(expBox, 0);
                    diffGrid.Children.Add(expBox);

                    // Actual Box
                    var actBox = new Border
                    {
                        Background = GetBrush("CrustBrush"),
                        BorderBrush = GetBrush("RedBrush", 0x40),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 6, 8, 6)
                    };
                    var actStack = new StackPanel();
                    actStack.Children.Add(new TextBlock { Text = "ACTUAL", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = GetBrush("RedBrush"), Margin = new Thickness(0, 0, 0, 2) });
                    actStack.Children.Add(new TextBox
                    {
                        Text = step.Actual,
                        FontSize = 11,
                        FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                        Foreground = GetBrush("RedBrush"),
                        Background = Brushes.Transparent,
                        BorderThickness = new Thickness(0),
                        IsReadOnly = true,
                        TextWrapping = TextWrapping.Wrap
                    });
                    actBox.Child = actStack;
                    Grid.SetColumn(actBox, 2);
                    diffGrid.Children.Add(actBox);

                    stack.Children.Add(diffGrid);
                }

                // Request / Response / Context box
                if (!string.IsNullOrWhiteSpace(step.Context))
                {
                    var ctxBox = new Border
                    {
                        Background = GetBrush("CrustBrush"),
                        BorderBrush = GetBrush("Surface1Brush"),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 6, 8, 6),
                        Margin = new Thickness(0, 2, 0, 4)
                    };
                    var ctxStack = new StackPanel();
                    ctxStack.Children.Add(new TextBlock { Text = "CONTEXT / HTTP & DOM TRACE", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(0, 0, 0, 3) });
                    ctxStack.Children.Add(new TextBox
                    {
                        Text = step.Context,
                        FontSize = 10.5,
                        FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                        Foreground = GetBrush("Subtext1Brush"),
                        Background = Brushes.Transparent,
                        BorderThickness = new Thickness(0),
                        IsReadOnly = true,
                        TextWrapping = TextWrapping.Wrap,
                        MaxHeight = 120,
                        VerticalScrollBarVisibility = ScrollBarVisibility.Auto
                    });
                    ctxBox.Child = ctxStack;
                    stack.Children.Add(ctxBox);
                }
            }
            else if (!string.IsNullOrWhiteSpace(step.Detail) && step.Detail != "ok")
            {
                // Passing step detail note
                stack.Children.Add(new TextBlock
                {
                    Text = step.Detail,
                    FontSize = 11,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(0, 2, 0, 2)
                });
            }

            // ── Inline Screenshot thumbnail (if screenshot exists) ──
            if (!string.IsNullOrEmpty(step.ScreenshotPath) && repoRoot != null)
            {
                string fullShotPath = Path.Combine(repoRoot, step.ScreenshotPath.Replace("/", "\\"));
                if (File.Exists(fullShotPath))
                {
                    var shotRow = new Border
                    {
                        Background = GetBrush("CrustBrush"),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(6),
                        Margin = new Thickness(0, 4, 0, 2)
                    };
                    var shotDock = new DockPanel();

                    var img = new Image
                    {
                        Height = 60,
                        MaxWidth = 100,
                        Stretch = Stretch.Uniform,
                        Margin = new Thickness(0, 0, 10, 0),
                        Cursor = Cursors.Hand
                    };
                    try
                    {
                        var bi = new BitmapImage();
                        bi.BeginInit();
                        bi.CacheOption = BitmapCacheOption.OnLoad;
                        bi.UriSource = new Uri(fullShotPath, UriKind.Absolute);
                        bi.EndInit();
                        bi.Freeze();
                        img.Source = bi;
                    }
                    catch { }

                    img.MouseDown += (s, e) => SwitchToScreenshot(fullShotPath);
                    shotDock.Children.Add(img);

                    var shotInfo = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                    shotInfo.Children.Add(new TextBlock { Text = "📷 Captured UI Screenshot", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = GetBrush("TealBrush") });
                    shotInfo.Children.Add(new TextBlock { Text = Path.GetFileName(fullShotPath), FontSize = 10, Foreground = GetBrush("OverlayBrush") });
                    
                    var viewBtn = new Button
                    {
                        Content = "🔍 View in Gallery",
                        Padding = new Thickness(8, 2, 8, 2),
                        Margin = new Thickness(0, 4, 0, 0),
                        HorizontalAlignment = HorizontalAlignment.Left,
                        FontSize = 10,
                        Cursor = Cursors.Hand
                    };
                    viewBtn.Click += (s, e) => SwitchToScreenshot(fullShotPath);
                    shotInfo.Children.Add(viewBtn);

                    shotDock.Children.Add(shotInfo);
                    shotRow.Child = shotDock;
                    stack.Children.Add(shotRow);
                }
            }

            cardBorder.Child = stack;
            return cardBorder;
        }

        // ── Screenshots tab ─────────────────────────────────────────────────

        private void DiscoverAndRenderScreenshots(string? repoRoot, TestHistoryEntry entry, ManifestRunResult result)
        {
            _currentScreenshots.Clear();
            ScreenshotsThumbnailsPanel.Children.Clear();
            ImgGalleryPreview.Source = null;

            if (repoRoot == null)
            {
                TabBtnScreenshots.Content = "📷 Screenshots (0)";
                return;
            }

            // 1. Gather screenshots from step results
            var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int stepIdx = 1;
            foreach (var step in result.Steps)
            {
                if (!string.IsNullOrEmpty(step.ScreenshotPath))
                {
                    string fullPath = Path.Combine(repoRoot, step.ScreenshotPath.Replace("/", "\\"));
                    if (File.Exists(fullPath) && seenPaths.Add(fullPath))
                    {
                        _currentScreenshots.Add(new HistoryScreenshotItem
                        {
                            StepIndex = stepIdx,
                            StepLabel = step.Label,
                            Reason = step.Passed ? "uiStep capture" : "failure capture",
                            FilePath = fullPath,
                            Passed = step.Passed
                        });
                    }
                }
                stepIdx++;
            }

            // 2. Also check screenshots directory for this run
            string runStem = result.RunFolderName;
            string screenshotsDir = Path.Combine(repoRoot, "test-results", runStem, "screenshots");
            if (Directory.Exists(screenshotsDir))
            {
                foreach (var file in Directory.GetFiles(screenshotsDir, "*.png"))
                {
                    if (seenPaths.Add(file))
                    {
                        _currentScreenshots.Add(new HistoryScreenshotItem
                        {
                            StepIndex = _currentScreenshots.Count + 1,
                            StepLabel = Path.GetFileNameWithoutExtension(file),
                            Reason = "ui capture",
                            FilePath = file,
                            Passed = true
                        });
                    }
                }
            }

            TabBtnScreenshots.Content = $"📷 Screenshots ({_currentScreenshots.Count})";
            BtnOpenGallery.IsEnabled = _currentScreenshots.Count > 0;

            if (_currentScreenshots.Count == 0)
            {
                var noShots = new TextBlock
                {
                    Text = "No screenshots captured during this run.",
                    FontSize = 11,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(10)
                };
                ScreenshotsThumbnailsPanel.Children.Add(noShots);
                return;
            }

            // Render thumbnails in left sub-column
            int idx = 0;
            foreach (var shot in _currentScreenshots)
            {
                int currentIdx = idx++;
                var thumbCard = new Border
                {
                    Background = GetBrush("Surface0Brush"),
                    BorderBrush = GetBrush("Surface1Brush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6),
                    Margin = new Thickness(0, 0, 0, 6),
                    Cursor = Cursors.Hand
                };

                var dock = new DockPanel();
                var img = new Image { Height = 48, Width = 70, Stretch = Stretch.Uniform, Margin = new Thickness(0, 0, 8, 0) };
                try
                {
                    var bi = new BitmapImage();
                    bi.BeginInit();
                    bi.CacheOption = BitmapCacheOption.OnLoad;
                    bi.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                    bi.EndInit();
                    bi.Freeze();
                    img.Source = bi;
                }
                catch { }
                dock.Children.Add(img);

                var info = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
                info.Children.Add(new TextBlock { Text = $"#{shot.StepIndex}: {shot.StepLabel}", FontSize = 10.5, FontWeight = FontWeights.SemiBold, Foreground = GetBrush("TextBrush"), TextTrimming = TextTrimming.CharacterEllipsis });
                info.Children.Add(new TextBlock { Text = shot.Reason, FontSize = 9.5, Foreground = shot.Passed ? GetBrush("GreenBrush") : GetBrush("RedBrush") });
                dock.Children.Add(info);

                thumbCard.Child = dock;
                thumbCard.MouseDown += (s, e) => ShowScreenshotIndex(currentIdx);
                ScreenshotsThumbnailsPanel.Children.Add(thumbCard);
            }

            _currentScreenshotIndex = 0;
            ShowScreenshotIndex(0);
        }

        private void ShowScreenshotIndex(int index)
        {
            if (_currentScreenshots.Count == 0) return;
            if (index < 0 || index >= _currentScreenshots.Count) index = 0;
            _currentScreenshotIndex = index;

            var shot = _currentScreenshots[index];
            TxtGalleryCurrentCaption.Text = $"Step {shot.StepIndex}: {shot.StepLabel}  —  {shot.Reason}";
            TxtGalleryCurrentIndex.Text = $"{index + 1} / {_currentScreenshots.Count}";
            TxtGalleryCurrentPath.Text = shot.FilePath;

            try
            {
                var bi = new BitmapImage();
                bi.BeginInit();
                bi.CacheOption = BitmapCacheOption.OnLoad;
                bi.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                bi.EndInit();
                bi.Freeze();
                ImgGalleryPreview.Source = bi;
            }
            catch (Exception ex)
            {
                ImgGalleryPreview.Source = null;
                ActivityLog.Log("testing.history-view", $"Couldn't load screenshot {shot.FilePath}: {ex.Message}");
            }
        }

        private void SwitchToScreenshot(string filePath)
        {
            TabBtnScreenshots.IsChecked = true;
            DetailTab_Changed(this, new RoutedEventArgs());

            int idx = _currentScreenshots.FindIndex(s => s.FilePath.Equals(filePath, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0) ShowScreenshotIndex(idx);
        }

        private void BtnPrevScreenshot_Click(object sender, RoutedEventArgs e)
        {
            if (_currentScreenshots.Count == 0) return;
            _currentScreenshotIndex = (_currentScreenshotIndex - 1 + _currentScreenshots.Count) % _currentScreenshots.Count;
            ShowScreenshotIndex(_currentScreenshotIndex);
        }

        private void BtnNextScreenshot_Click(object sender, RoutedEventArgs e)
        {
            if (_currentScreenshots.Count == 0) return;
            _currentScreenshotIndex = (_currentScreenshotIndex + 1) % _currentScreenshots.Count;
            ShowScreenshotIndex(_currentScreenshotIndex);
        }

        // ── Raw JSON Tab ────────────────────────────────────────────────────

        private void RenderRawJson(ManifestRunResult result)
        {
            var opts = new JsonSerializerOptions { WriteIndented = true };
            EditorRawJson.Text = JsonSerializer.Serialize(result, opts);
        }

        private void BtnCopyRawJson_Click(object sender, RoutedEventArgs e)
        {
            if (!string.IsNullOrEmpty(EditorRawJson.Text))
            {
                Clipboard.SetText(EditorRawJson.Text);
            }
        }

        // ── Detail Tab Switching ────────────────────────────────────────────

        private void DetailTab_Changed(object sender, RoutedEventArgs e)
        {
            bool isSteps = TabBtnSteps.IsChecked == true;
            bool isShots = TabBtnScreenshots.IsChecked == true;
            bool isJson = TabBtnRawJson.IsChecked == true;

            TabContentSteps.Visibility = isSteps ? Visibility.Visible : Visibility.Collapsed;
            TabContentScreenshots.Visibility = isShots ? Visibility.Visible : Visibility.Collapsed;
            TabContentRawJson.Visibility = isJson ? Visibility.Visible : Visibility.Collapsed;

            StepSubFilters.Visibility = isSteps ? Visibility.Visible : Visibility.Collapsed;
        }

        private void StepFilter_Changed(object sender, RoutedEventArgs e)
        {
            if (_currentRunResult != null) RenderSteps(_currentRunResult);
        }

        // ── Header Action Buttons ───────────────────────────────────────────

        private async void BtnRerunTest_Click(object sender, RoutedEventArgs e)
        {
            if (_currentRunResult == null) return;
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return;

            string? manifestPath = FindManifestPath(repoRoot, _currentRunResult.Issue);
            if (manifestPath == null)
            {
                AppDialog.Alert(this, $"Could not find a test manifest in test-manifests/ for issue #{_currentRunResult.Issue}.", "Manifest Not Found", AppDialogIcon.Warning);
                return;
            }

            var manifest = TestManifest.LoadFromFile(manifestPath);
            if (manifest != null && Application.Current.MainWindow is MainWindow mw)
            {
                await mw.RunManifestPublicAsync(manifest);
            }
        }

        private void BtnViewManifest_Click(object sender, RoutedEventArgs e)
        {
            if (_currentRunResult == null) return;
            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null) return;

            string? manifestPath = FindManifestPath(repoRoot, _currentRunResult.Issue);
            if (manifestPath != null)
            {
                var manifest = TestManifest.LoadFromFile(manifestPath);
                if (manifest != null)
                {
                    new ManifestViewerWindow(manifest, false) { Owner = this }.Show();
                }
            }
            else
            {
                AppDialog.Alert(this, $"Could not find a test manifest in test-manifests/ for issue #{_currentRunResult.Issue}.", "Manifest Not Found", AppDialogIcon.Warning);
            }
        }

        private void BtnCopyReport_Click(object sender, RoutedEventArgs e)
        {
            if (_currentRunResult == null) return;

            var sb = new StringBuilder();
            sb.AppendLine($"# Test Run Report — Issue #{_currentRunResult.Issue}");
            sb.AppendLine($"**Feature:** {_currentRunResult.Feature}");
            sb.AppendLine($"**Started:** {_currentRunResult.StartedAt:yyyy-MM-dd HH:mm:ss} | **Mode:** {_currentRunResult.Mode}");
            sb.AppendLine($"**Overall Result:** {(_currentRunResult.AllPassed ? "✅ PASSED" : "❌ FAILED")}");
            sb.AppendLine();

            var failedSteps = _currentRunResult.Steps.Where(s => !s.Passed).ToList();
            if (failedSteps.Count > 0)
            {
                sb.AppendLine($"## Failed Steps ({failedSteps.Count})");
                sb.AppendLine();
                int idx = 1;
                foreach (var step in failedSteps)
                {
                    sb.AppendLine($"### Step {idx++}: [{step.Kind.ToUpper()}] {step.Label}");
                    sb.AppendLine($"- **Error:** {step.Detail}");
                    if (!string.IsNullOrWhiteSpace(step.Expected)) sb.AppendLine($"- **Expected:** `{step.Expected}`");
                    if (!string.IsNullOrWhiteSpace(step.Actual)) sb.AppendLine($"- **Actual:** `{step.Actual}`");
                    if (!string.IsNullOrWhiteSpace(step.Context))
                    {
                        sb.AppendLine("- **Context:**");
                        sb.AppendLine("```");
                        sb.AppendLine(step.Context);
                        sb.AppendLine("```");
                    }
                    sb.AppendLine();
                }
            }

            sb.AppendLine($"## All Steps ({_currentRunResult.Steps.Count})");
            foreach (var step in _currentRunResult.Steps)
            {
                string statusIcon = step.Passed ? "✅" : "❌";
                sb.AppendLine($"- {statusIcon} `[{step.Kind.ToUpper()}]` {step.Label} ({step.DurationMs}ms)");
            }

            Clipboard.SetText(sb.ToString().TrimEnd());
            AppDialog.Alert(this, "Copied diagnostic markdown report to clipboard.", "Report Copied", AppDialogIcon.Info);
        }

        private void BtnOpenGallery_Click(object sender, RoutedEventArgs e)
        {
            if (_currentScreenshots.Count == 0) return;
            var captures = _currentScreenshots.Select(s => new UiScreenshotCapture
            {
                StepIndex = s.StepIndex,
                StepLabel = s.StepLabel,
                Reason = s.Reason,
                FilePath = s.FilePath
            });
            new ScreenshotGalleryWindow(captures) { Owner = this }.Show();
        }

        private static string? FindManifestPath(string repoRoot, int issue)
        {
            var dir = Path.Combine(repoRoot, "test-manifests");
            if (!Directory.Exists(dir)) return null;

            foreach (var file in Directory.GetFiles(dir, "*.json", SearchOption.AllDirectories))
            {
                if (Path.GetFileName(file).StartsWith("_")) continue;
                try
                {
                    var manifest = TestManifest.LoadFromFile(file);
                    if (manifest != null && manifest.Issue == issue)
                        return file;
                }
                catch { }
            }
            return null;
        }

        private Brush GetBrush(string key, byte alpha = 0xFF)
        {
            try
            {
                if (TryFindResource(key) is SolidColorBrush scb)
                {
                    if (alpha == 0xFF) return scb;
                    var b = new SolidColorBrush(Color.FromArgb(alpha, scb.Color.R, scb.Color.G, scb.Color.B));
                    b.Freeze();
                    return b;
                }
                if (Application.Current != null && Application.Current.TryFindResource(key) is SolidColorBrush appScb)
                {
                    if (alpha == 0xFF) return appScb;
                    var b = new SolidColorBrush(Color.FromArgb(alpha, appScb.Color.R, appScb.Color.G, appScb.Color.B));
                    b.Freeze();
                    return b;
                }
            }
            catch { }
            return Brushes.Gray;
        }

        // ── Custom Title Bar (WindowChrome) ─────────────────────────────────

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "\uE923" : "\uE922";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }
    }
}
