using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Phase 8: Dialog displaying testing session history, duration metrics,
    /// bug counts, clean confirmations, and Markdown audit log export.
    ///
    /// Each session card now shows:
    ///   - A ✓ Synced (green) or ⚠ Not Synced (amber) pill based on whether
    ///     report.json exists for that session in the Bugs/ directory.
    ///   - A "Load into Composer" button that reconstructs BugCardViewModel
    ///     objects from report.json and appends them to the active session.
    /// </summary>
    public partial class SessionHistoryDialog : Window
    {
        private List<VisualTestTrackerSession> _sessions = new();

        /// <summary>
        /// Optional callback fired when the user clicks "Load" on a history card.
        /// The caller (MainWindow) is responsible for inserting the returned bugs
        /// into the composer panel.
        /// </summary>
        private readonly Action<List<BugCardViewModel>>? _onLoadRequested;

        public SessionHistoryDialog(Action<List<BugCardViewModel>>? onLoadRequested = null)
        {
            InitializeComponent();
            _onLoadRequested = onLoadRequested;
            LoadSessionHistory();
        }

        private void LoadSessionHistory()
        {
            _sessions = VisualTestTrackerSessionStore.GetHistory();
            RenderMetrics();
            RenderCards();
        }

        private void RenderMetrics()
        {
            MetricTotalSessions.Text = _sessions.Count.ToString();

            double totalSeconds = _sessions.Sum(s => s.TotalElapsed.TotalSeconds);
            var totalTime = TimeSpan.FromSeconds(totalSeconds);
            if (totalTime.TotalHours >= 1)
                MetricTotalTime.Text = $"{(int)totalTime.TotalHours}h {totalTime.Minutes}m";
            else
                MetricTotalTime.Text = $"{totalTime.Minutes}m {totalTime.Seconds:D2}s";

            int totalBugs = _sessions.Sum(s => s.BugsLoggedCount);
            MetricTotalBugs.Text = totalBugs.ToString();

            int cleanCount = _sessions.Count(s => s.IsCleanConfirmed);
            MetricTotalClean.Text = cleanCount.ToString();
        }

        private void RenderCards()
        {
            SessionCardsPanel.Children.Clear();
            if (_sessions.Count == 0)
            {
                EmptyHistoryText.Visibility = Visibility.Visible;
                return;
            }
            EmptyHistoryText.Visibility = Visibility.Collapsed;

            foreach (var session in _sessions)
            {
                SessionCardsPanel.Children.Add(BuildSessionCard(session));
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // Sync helpers
        // ─────────────────────────────────────────────────────────────────────

        /// <summary>
        /// Tries to resolve the absolute path to report.json for a given session.
        /// Returns null if the session has never been synced or the file doesn't exist.
        /// </summary>
        private static string? TryResolveReportJsonPath(VisualTestTrackerSession session)
        {
            try
            {
                string repoRoot = VisualTestTrackerExportService.ResolveRepoRoot();
                if (string.IsNullOrEmpty(repoRoot)) return null;

                // Prefer the stored SyncedSessionId (populated after a successful End & Sync)
                if (!string.IsNullOrEmpty(session.SyncedSessionId))
                {
                    foreach (string bugsRoot in new[] { "Bugs", "Bug" })
                    {
                        string dir = Path.Combine(repoRoot, bugsRoot);
                        if (!Directory.Exists(dir)) continue;

                        // Search all product sub-dirs for the matching session folder
                        foreach (string productDir in Directory.GetDirectories(dir))
                        {
                            string candidate = Path.Combine(productDir, session.SyncedSessionId, "report.json");
                            if (File.Exists(candidate)) return candidate;
                        }
                    }
                }

                // Fallback: scan for any folder matching the session GUID (unlikely to match
                // since synced folders use the yyyy-MM-dd-HHmm format, but good defence)
                foreach (string bugsRoot in new[] { "Bugs", "Bug" })
                {
                    string dir = Path.Combine(repoRoot, bugsRoot);
                    if (!Directory.Exists(dir)) continue;
                    foreach (string productDir in Directory.GetDirectories(dir))
                    {
                        foreach (string sessionDir in Directory.GetDirectories(productDir))
                        {
                            // Match by approximate start-time (yyyy-MM-dd-HHmm)
                            string folderName = Path.GetFileName(sessionDir);
                            string expectedPrefix = session.StartedAt.ToString("yyyy-MM-dd-HH");
                            if (folderName.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
                            {
                                string candidate = Path.Combine(sessionDir, "report.json");
                                if (File.Exists(candidate)) return candidate;
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Reads report.json from the given path and converts the bugs array back
        /// into BugCardViewModel objects suitable for loading into the composer.
        /// </summary>
        private static List<BugCardViewModel> LoadBugsFromReportJson(string reportJsonPath)
        {
            var result = new List<BugCardViewModel>();
            try
            {
                string json = File.ReadAllText(reportJsonPath);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (!root.TryGetProperty("bugs", out var bugsEl) ||
                    bugsEl.ValueKind != JsonValueKind.Array) return result;

                foreach (var bugEl in bugsEl.EnumerateArray())
                {
                    var vm = new BugCardViewModel();

                    if (bugEl.TryGetProperty("uuid", out var uuid) && uuid.ValueKind == JsonValueKind.String)
                        vm.Id = uuid.GetString() ?? vm.Id;

                    if (bugEl.TryGetProperty("severity", out var sev) && sev.ValueKind == JsonValueKind.String)
                        vm.Severity = sev.GetString() ?? vm.Severity;

                    if (bugEl.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String)
                        vm.IsResolved = string.Equals(status.GetString(), "Resolved", StringComparison.OrdinalIgnoreCase);

                    if (bugEl.TryGetProperty("notes", out var notes) && notes.ValueKind == JsonValueKind.String)
                        vm.Notes = notes.GetString() ?? "";

                    if (bugEl.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String)
                        vm.Route = url.GetString() ?? "";

                    if (bugEl.TryGetProperty("stepsToReproduce", out var steps) && steps.ValueKind == JsonValueKind.String)
                        vm.Steps = steps.GetString() ?? "";

                    if (bugEl.TryGetProperty("expectedBehavior", out var exp) && exp.ValueKind == JsonValueKind.String)
                        vm.Expected = exp.GetString() ?? "";

                    if (bugEl.TryGetProperty("actualBehavior", out var act) && act.ValueKind == JsonValueKind.String)
                        vm.Actual = act.GetString() ?? "";

                    if (bugEl.TryGetProperty("tags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
                        vm.Tags = tagsEl.EnumerateArray()
                                        .Where(t => t.ValueKind == JsonValueKind.String)
                                        .Select(t => t.GetString() ?? "")
                                        .Where(t => !string.IsNullOrEmpty(t))
                                        .ToList();

                    if (bugEl.TryGetProperty("screenshots", out var shotsEl) && shotsEl.ValueKind == JsonValueKind.Array)
                        vm.Screenshots = shotsEl.EnumerateArray()
                                                 .Where(t => t.ValueKind == JsonValueKind.String)
                                                 .Select(t => t.GetString() ?? "")
                                                 .Where(t => !string.IsNullOrEmpty(t))
                                                 .ToList();

                    if (bugEl.TryGetProperty("createdAt", out var createdAt) && createdAt.ValueKind == JsonValueKind.String)
                    {
                        if (DateTime.TryParse(createdAt.GetString(), out var dt))
                            vm.CreatedAt = dt;
                    }

                    // Mark as already synced so End & Sync doesn't double-count
                    vm.IsSynced = true;
                    if (root.TryGetProperty("sessionId", out var sid) && sid.ValueKind == JsonValueKind.String)
                        vm.SyncedSessionId = sid.GetString() ?? "";

                    result.Add(vm);
                }
            }
            catch { }
            return result;
        }

        // ─────────────────────────────────────────────────────────────────────
        // Card builder
        // ─────────────────────────────────────────────────────────────────────

        private UIElement BuildSessionCard(VisualTestTrackerSession session)
        {
            string? reportJsonPath = TryResolveReportJsonPath(session);
            bool isSynced = reportJsonPath != null;

            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = isSynced
                    ? new SolidColorBrush(Color.FromArgb(0x60, 0x10, 0xB9, 0x81))  // green tint when synced
                    : (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 6)
            };

            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // ── Row 0: Route + Base URL & Status Badge ────────────────────────
            var topRow = new Grid();
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var routePanel = new StackPanel { Orientation = Orientation.Horizontal };
            var routeText = new TextBlock
            {
                Text = session.DisplayRoute,
                FontSize = 11,
                FontFamily = new FontFamily("Consolas"),
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            var baseText = new TextBlock
            {
                Text = $"  ({session.BaseUrl})",
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            routePanel.Children.Add(routeText);
            routePanel.Children.Add(baseText);
            Grid.SetColumn(routePanel, 0);

            // Status badge (existing clean/bug/active indicator)
            var badgeBorder = new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 2, 6, 2),
                VerticalAlignment = VerticalAlignment.Center
            };
            var badgeText = new TextBlock { FontSize = 9, FontWeight = FontWeights.SemiBold };

            if (session.IsCleanConfirmed)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("StatusSuccessBrush");
                badgeText.Text = "✅ Confirmed Clean";
            }
            else if (session.BugsLoggedCount > 0)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("StatusWarningBrush");
                badgeText.Text = $"🐞 {session.BugsLoggedCount} bugs logged";
            }
            else if (session.IsActive)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("AccentBrush");
                badgeText.Text = "🔍 Active Session";
            }
            else
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("Subtext1Brush");
                badgeText.Text = "Tested";
            }
            badgeBorder.Child = badgeText;
            Grid.SetColumn(badgeBorder, 1);

            topRow.Children.Add(routePanel);
            topRow.Children.Add(badgeBorder);
            Grid.SetRow(topRow, 0);

            // ── Row 1: Sub metrics ─────────────────────────────────────────────
            var subRow = new Grid { Margin = new Thickness(0, 4, 0, 0) };
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var timeText = new TextBlock
            {
                Text = $"⏱ Duration: {session.FormattedDuration}",
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("AccentBrush"),
                Margin = new Thickness(0, 0, 12, 0)
            };
            Grid.SetColumn(timeText, 0);

            var startText = new TextBlock
            {
                Text = $"Started: {session.StartedAt:yyyy-MM-dd HH:mm:ss}",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                Margin = new Thickness(0, 0, 12, 0)
            };
            Grid.SetColumn(startText, 1);

            var eventsText = new TextBlock
            {
                Text = $"👣 {session.TelemetryEventsCount} interactions",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush")
            };
            Grid.SetColumn(eventsText, 2);

            subRow.Children.Add(timeText);
            subRow.Children.Add(startText);
            subRow.Children.Add(eventsText);
            Grid.SetRow(subRow, 1);

            // ── Row 2: Sync pill + Load button ────────────────────────────────
            var actionRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Margin = new Thickness(0, 6, 0, 0)
            };

            // Sync status pill
            var syncPill = new Border
            {
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            var syncPillText = new TextBlock
            {
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center
            };

            if (isSynced)
            {
                syncPill.Background = new SolidColorBrush(Color.FromArgb(0x30, 0x10, 0xB9, 0x81));
                syncPill.BorderBrush = new SolidColorBrush(Color.FromArgb(0x80, 0x10, 0xB9, 0x81));
                syncPill.BorderThickness = new Thickness(1);
                syncPillText.Foreground = new SolidColorBrush(Color.FromRgb(0x10, 0xB9, 0x81));
                syncPillText.Text = "✓ Synced";
            }
            else
            {
                syncPill.Background = new SolidColorBrush(Color.FromArgb(0x25, 0xD4, 0xA5, 0x6C));
                syncPill.BorderBrush = new SolidColorBrush(Color.FromArgb(0x70, 0xD4, 0xA5, 0x6C));
                syncPill.BorderThickness = new Thickness(1);
                syncPillText.Foreground = new SolidColorBrush(Color.FromRgb(0xD4, 0xA5, 0x6C));
                syncPillText.Text = "⚠ Not Synced";
            }
            syncPill.Child = syncPillText;
            actionRow.Children.Add(syncPill);

            // "Load into Composer" button – only show when report.json exists
            if (isSynced && _onLoadRequested != null)
            {
                var loadBtn = new Button
                {
                    Content = "↩ Load into Composer",
                    FontSize = 9,
                    FontWeight = FontWeights.SemiBold,
                    Padding = new Thickness(8, 3, 8, 3),
                    Cursor = Cursors.Hand,
                    VerticalAlignment = VerticalAlignment.Center,
                    Tag = reportJsonPath
                };

                // Try to apply SecondaryButton style; fall back to default
                try { loadBtn.Style = (Style)FindResource("SecondaryButton"); } catch { }
                loadBtn.Click += (s, e) => OnLoadButtonClicked(reportJsonPath!);
                actionRow.Children.Add(loadBtn);
            }

            Grid.SetRow(actionRow, 2);

            grid.Children.Add(topRow);
            grid.Children.Add(subRow);
            grid.Children.Add(actionRow);
            card.Child = grid;

            return card;
        }

        private void OnLoadButtonClicked(string reportJsonPath)
        {
            var bugs = LoadBugsFromReportJson(reportJsonPath);
            if (bugs.Count == 0)
            {
                MessageBox.Show("No bug entries found in the session report, or the file could not be read.",
                    "Load Session", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            _onLoadRequested?.Invoke(bugs);

            StatusMessage.Text = $"✓ Loaded {bugs.Count} bug(s) into the composer.";
            StatusMessage.Visibility = Visibility.Visible;

            // Close after a short delay so the user sees the confirmation
            var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
            t.Tick += (s, _) => { t.Stop(); Close(); };
            t.Start();
        }

        // ─────────────────────────────────────────────────────────────────────
        // Toolbar button handlers
        // ─────────────────────────────────────────────────────────────────────

        private void BtnCopyMarkdown_Click(object sender, RoutedEventArgs e)
        {
            var md = VisualTestTrackerSessionStore.ToMarkdownAuditLog(_sessions);
            Clipboard.SetText(md);

            StatusMessage.Text = "✓ Copied session audit trail to clipboard as Markdown.";
            StatusMessage.Visibility = Visibility.Visible;
        }

        private void BtnClearHistory_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Are you sure you want to clear all session history?",
                "Confirm Clear History", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                VisualTestTrackerSessionStore.ClearHistory();
                LoadSessionHistory();
                StatusMessage.Text = "✓ All session history cleared.";
                StatusMessage.Visibility = Visibility.Visible;
            }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
