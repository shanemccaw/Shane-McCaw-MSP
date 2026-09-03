using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class HomeQueueClick : EventArgs
    {
        public int? GithubNumber { get; init; }
        public string Title { get; init; } = "";
        public int QueueItemId { get; init; }
    }

    public class HomeStuckItemClear : EventArgs
    {
        public int QueueItemId { get; init; }
        public int? GithubNumber { get; init; }
        public string Title { get; init; } = "";
    }

    /// <summary>
    /// ADHD-Friendly Multi-Column Home Dashboard.
    /// Provides zero-overwhelm glanceability, quick jump-in workflows,
    /// live focus tracking, and a playful animal companion (Microsoft Clarity style).
    /// </summary>
    public partial class HomeView : UserControl
    {
        public event EventHandler<PersistedChatTab>? ResumeChatRequested;

        /// <summary>Git #2707 — "Reopen All" in the RECENT CHATS card header: raised with
        /// the FULL remembered tab list (real saved order, no cap, no reshuffling). MainWindow
        /// reuses the same per-tab <c>Home_ResumeChatRequested</c> handling ResumeChatRequested
        /// already uses, once per tab.</summary>
        public event EventHandler<IReadOnlyList<PersistedChatTab>>? ReopenAllRequested;
        public event EventHandler<HomeQueueClick>? RunningItemClicked;
        public event EventHandler<HomeStuckItemClear>? ClearStuckItemRequested;
        public event EventHandler? NewIssueRequested;
        public event EventHandler? BuildWatchRequested;
        public event EventHandler? TestRunnerRequested;
        public event EventHandler? ReplitRequested;
        public event EventHandler? ImmersiveFocusRequested;
        public event EventHandler? DeployRequested;
        public event EventHandler? GitBoardRequested;
        public event EventHandler? SettingsRequested;
        public event EventHandler<int>? MilestoneDetailRequested;

        /// <summary>
        /// Raised when a pending-migration row is clicked, carrying the full local
        /// path of the <c>lib/db/migrations/manual/*.sql</c> file. MainWindow owns
        /// the SQL Runner tab (#939 AvalonEdit <see cref="SqlDocumentView"/>), so it
        /// opens/focuses it and loads the file's real contents for manual review.
        /// </summary>
        public event EventHandler<string>? OpenMigrationInSqlRunnerRequested;

        private const int StaleRunningMinutes = 60;
        private readonly Random _rng = new();
        private DispatcherTimer? _mascotTimer;

        private static readonly string[] MascotQuotes =
        {
            "\"Take a deep breath. You're doing amazing! ✨\"",
            "\"One small step is all it takes to get in the groove! 🎯\"",
            "\"Hydration check! Grab a quick sip of water ☕\"",
            "\"You're crushing it! Let's conquer this next build 🚀\"",
            "\"Zero rush. Work at your own rhythm today 🌿\"",
            "\"Got a thought? Pop a quick issue on the board! 📝\"",
            "\"Focus on just one card — everything else can wait 🐾\""
        };

        public HomeView()
        {
            InitializeComponent();
            SetDynamicGreeting();
            StartMascotAnimation();

            // Hook up Focus Mode service state updates
            try
            {
                FocusModeService.Instance.StateChanged += UpdateFocusState;
                UpdateFocusState();
            }
            catch { }

            InitializeHealthMonitor(null);

            Unloaded += (_, _) =>
            {
                try { FocusModeService.Instance.StateChanged -= UpdateFocusState; } catch { }
                _mascotTimer?.Stop();
                _healthTimer?.Stop();
            };
        }

        private void SetDynamicGreeting()
        {
            int hour = DateTime.Now.Hour;
            string timeOfDay = hour switch
            {
                < 12 => "Good morning",
                < 17 => "Good afternoon",
                _ => "Good evening"
            };
            GreetingText.Text = $"{timeOfDay}, Shane!";
        }

        private void StartMascotAnimation()
        {
            _mascotTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(16) };
            _mascotTimer.Tick += (_, _) =>
            {
                // Occasional subtle message roll
                if (_rng.NextDouble() < 0.4)
                {
                    MascotQuoteText.Text = MascotQuotes[_rng.Next(MascotQuotes.Length)];
                }
            };
            _mascotTimer.Start();
        }

        private void MascotCard_Click(object sender, MouseButtonEventArgs e)
        {
            // Cheerful mascot bounce + quote roll
            var bounceAnim = new DoubleAnimation(-10, 0, TimeSpan.FromSeconds(0.4))
            {
                EasingFunction = new BounceEase { Bounces = 2, Bounciness = 4 }
            };
            FoxTranslate.BeginAnimation(TranslateTransform.YProperty, bounceAnim);

            var wiggleAnim = new DoubleAnimation(-8, 8, TimeSpan.FromSeconds(0.12))
            {
                AutoReverse = true,
                RepeatBehavior = new RepeatBehavior(2),
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            FoxRotate.BeginAnimation(RotateTransform.AngleProperty, wiggleAnim);

            MascotQuoteText.Text = MascotQuotes[_rng.Next(MascotQuotes.Length)];
        }

        // ── Focus State Tracking ─────────────────────────────────────────────
        public void UpdateFocusState()
        {
            var focus = FocusModeService.Instance;
            if (focus.IsActive)
            {
                FocusMilestoneTitle.Text = focus.ActiveMilestoneTitle;
                FocusHeroCard.BorderBrush = (Brush)FindResource("BlueBrush");
                FocusPointsText.Text = $"{focus.Points} pts";
                StatPointsValue.Text = $"{focus.Points}";

                int total = focus.Progress.Total;
                int closed = focus.Progress.Closed;
                int pct = focus.Progress.Percent;

                FocusProgressText.Text = $"{pct}% completed ({closed}/{total} issues)";
                StatMilestonePercent.Text = $"{pct}%";

                // Animate progress bar width smoothly
                double targetWidth = Math.Max(0, Math.Min(260, (260.0 * pct) / 100.0));
                FocusProgressBar.Width = targetWidth;

                BtnImmersiveResume.Visibility = Visibility.Visible;
                BtnMilestoneDetail.Visibility = Visibility.Visible;
            }
            else
            {
                FocusMilestoneTitle.Text = "No milestone in active focus";
                FocusProgressText.Text = "Pick a milestone in Git Board to engage focus";
                FocusHeroCard.BorderBrush = (Brush)FindResource("Surface1Brush");
                FocusProgressBar.Width = 0;
                FocusPointsText.Text = "0 pts";
                StatPointsValue.Text = "0";
                StatMilestonePercent.Text = "--";

                BtnImmersiveResume.Visibility = Visibility.Collapsed;
            }
        }

        // ── Board State & Smart ADHD Suggestions ────────────────────────────
        public void RenderDashboardState(IReadOnlyList<GitBoardIssue>? issues, IReadOnlyList<GitMilestone>? milestones)
        {
            // Auto-refresh the pending-migrations glance alongside the board rollup, so
            // the list re-scans on tab open and on every periodic rollup — never left
            // stale after a migration is executed.
            RefreshPendingMigrations();

            // Git #2712 / #2713 — same cadence: the underlying #2711 series is cache-backed
            // (5-min TTL) so these passive calls are cheap; they just re-render from cache
            // except on the rare tick the TTL actually expires.
            RefreshBurndown();
            RefreshOpenCloseRateChart();

            if (issues == null) return;

            // Update stats
            int totalEpics = issues.Count(i => i.IsEpic);
            int openIssues = issues.Count(i => !i.IsClosed);
            int totalMilestones = milestones?.Count ?? 0;

            BoardEpicsCount.Text = $"{totalEpics}";
            BoardIssuesCount.Text = $"{openIssues}";
            BoardMilestonesCount.Text = $"{totalMilestones}";
        }

        // ── Section 0: What's New ───────────────────────────────────────────
        private int _lastSeenBuild = -1;
        private int _currentBuild = -1;
        private int _currentPage = 0;

        public void RenderWhatsNew(string versionLabel, IReadOnlyList<string> titles, int moreCount, int lastSeen, int current)
        {
            _lastSeenBuild = lastSeen;
            _currentBuild = current;
            _currentPage = 0;

            WhatsNewList.Children.Clear();
            WhatsNewVersionText.Text = $"Build {VersionInfo.Format(_currentBuild)}";

            bool hasSinceLastLook = _currentBuild > _lastSeenBuild;
            WhatsNewPageIndicatorText.Text = hasSinceLastLook ? "Since Last Look" : "Page 1";

            if (titles == null || titles.Count == 0)
            {
                WhatsNewList.Children.Add(BuildBullet("No changes found."));
            }
            else
            {
                foreach (var title in titles)
                    WhatsNewList.Children.Add(BuildBullet(title));
            }

            int total = titles?.Count ?? 0;
            if (hasSinceLastLook)
            {
                WhatsNewSummaryText.Text = $"{total} change{(total == 1 ? "" : "s")} since you last looked";
            }
            else
            {
                WhatsNewSummaryText.Text = "No new changes";
            }

            BtnWhatsNewNext.IsEnabled = false;
            BtnWhatsNewPrev.IsEnabled = total > 0;

            WhatsNewTile.IsChecked = false;
            WhatsNewContent.Visibility = Visibility.Collapsed;
            WhatsNewSection.Visibility = Visibility.Visible;
        }

        private void BtnWhatsNewPrev_Click(object sender, RoutedEventArgs e)
        {
            _currentPage++;
            _ = LoadWhatsNewPageAsync();
        }

        private void BtnWhatsNewNext_Click(object sender, RoutedEventArgs e)
        {
            if (_currentPage > 0)
            {
                _currentPage--;
                _ = LoadWhatsNewPageAsync();
            }
        }

        private async System.Threading.Tasks.Task LoadWhatsNewPageAsync()
        {
            if (_currentBuild < 0) return;

            bool hasSinceLastLook = _currentBuild > _lastSeenBuild;

            int skip = 0;
            int take = 15;
            string pageLabel = "";

            int liveBuild = VersionInfo.GetCurrentBuild() ?? _currentBuild;
            int liveOffset = Math.Max(0, liveBuild - _currentBuild);

            if (_currentPage == 0)
            {
                if (hasSinceLastLook)
                {
                    skip = liveOffset;
                    take = _currentBuild - _lastSeenBuild;
                    pageLabel = "Since Last Look";
                }
                else
                {
                    skip = liveOffset;
                    take = 15;
                    pageLabel = "Page 1";
                }
            }
            else
            {
                if (hasSinceLastLook)
                {
                    skip = liveOffset + (_currentBuild - _lastSeenBuild) + (_currentPage - 1) * 15;
                    take = 15;
                    pageLabel = $"Page {_currentPage + 1}";
                }
                else
                {
                    skip = liveOffset + _currentPage * 15;
                    take = 15;
                    pageLabel = $"Page {_currentPage + 1}";
                }
            }

            Dispatcher.Invoke(() =>
            {
                BtnWhatsNewPrev.IsEnabled = false;
                BtnWhatsNewNext.IsEnabled = false;
            });

            var titles = await System.Threading.Tasks.Task.Run(() => VersionInfo.GetCommitsRange(skip, take));

            Dispatcher.Invoke(() =>
            {
                WhatsNewList.Children.Clear();
                WhatsNewPageIndicatorText.Text = pageLabel;

                if (titles.Count == 0)
                {
                    WhatsNewList.Children.Add(BuildBullet("No changes found in this range."));
                }
                else
                {
                    foreach (var title in titles)
                        WhatsNewList.Children.Add(BuildBullet(title));
                }

                BtnWhatsNewNext.IsEnabled = _currentPage > 0;
                BtnWhatsNewPrev.IsEnabled = titles.Count > 0;

                if (_currentPage == 0 && hasSinceLastLook)
                {
                    int total = titles.Count;
                    WhatsNewSummaryText.Text = $"{total} change{(total == 1 ? "" : "s")} since you last looked";
                }
                else if (_currentPage == 0 && !hasSinceLastLook)
                {
                    WhatsNewSummaryText.Text = "No new changes";
                }
                else
                {
                    WhatsNewSummaryText.Text = $"Browsing older changes ({pageLabel})";
                }
            });
        }

        private void WhatsNewTile_Click(object sender, RoutedEventArgs e)
        {
            bool expand = WhatsNewTile.IsChecked == true;
            WhatsNewContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
        }

        private Border BuildBullet(string text)
        {
            var dot = new TextBlock
            {
                Text = "•",
                FontSize = 13,
                Margin = new Thickness(2, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#C6A0F6")),
            };
            var body = new TextBlock
            {
                Text = text,
                FontSize = 11.5,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(dot);
            panel.Children.Add(body);
            return new Border { Padding = new Thickness(0, 2, 0, 2), Child = panel };
        }

        // ── Section 1: Where you left off ───────────────────────────────────
        // Git #2707: full remembered list, no hard cap — LeftOffList now sits inside its
        // own ScrollViewer (see HomeView.xaml) so a big session scrolls instead of truncating.
        private IReadOnlyList<PersistedChatTab> _leftOffTabs = Array.Empty<PersistedChatTab>();

        public void RenderLeftOff(IReadOnlyList<PersistedChatTab> tabs)
        {
            _leftOffTabs = tabs;
            LeftOffList.Children.Clear();
            LeftOffCountText.Text = $"({tabs.Count})";
            LeftOffEmpty.Visibility = tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            BtnReopenAllLeftOff.Visibility = tabs.Count > 1 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var tab in tabs)
            {
                var captured = tab;
                string sub =
                    (tab.IssueGithubNumber.HasValue ? $"#{tab.IssueGithubNumber}  ·  " : "") +
                    $"pane {tab.PaneIndex + 1}  ·  {tab.SavedAt.ToLocalTime():MMM d, h:mm tt}";

                LeftOffList.Children.Add(BuildRow(
                    "🕘", "#8FA6C4",
                    string.IsNullOrWhiteSpace(tab.Title) ? "(untitled chat)" : tab.Title,
                    sub,
                    string.IsNullOrWhiteSpace(tab.ClaudeUrl) ? null : tab.ClaudeUrl,
                    (_, _) => ResumeChatRequested?.Invoke(this, captured)));
            }
        }

        /// <summary>Git #2707 — "Reopen All": reopens every remembered tab, in saved order.
        /// MainWindow handles this the same way it handles a single ResumeChatRequested (same
        /// OpenChatTab path, same honest skip/toast for entries with no ClaudeUrl).</summary>
        private void BtnReopenAllLeftOff_Click(object sender, RoutedEventArgs e)
        {
            if (_leftOffTabs.Count == 0) return;
            ReopenAllRequested?.Invoke(this, _leftOffTabs);
        }

        // ── Section 2: Running now ──────────────────────────────────────────
        public void RenderRunning(IReadOnlyList<QueueItem> running)
        {
            RunningList.Children.Clear();

            int staleCount = 0;
            foreach (var item in running)
            {
                var captured = item;
                bool stale = IsRunningStale(item.UpdatedAt);
                if (stale) staleCount++;

                string refStr = item.GithubNumber.HasValue ? BuildConsole.Services.LocalBuildId.FormatRef(item.GithubNumber.Value) : "";
                string numPrefix = item.GithubNumber.HasValue ? $"{refStr}  ·  " : "";
                string ageStr = StuckPhrase(item.UpdatedAt);
                string sub = numPrefix + (stale ? $"stuck ({ageStr})  ·  click to clear" : $"running ({ageStr})  ·  click to watch");

                Action? onClear = stale ? () => ClearStuckItemRequested?.Invoke(this, new HomeStuckItemClear
                {
                    QueueItemId = captured.Id,
                    GithubNumber = captured.GithubNumber,
                    Title = captured.Title
                }) : null;

                RunningList.Children.Add(BuildRow(
                    stale ? "⚠" : "▶",
                    stale ? "#EE99A0" : "#F2CA63",
                    string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                    sub,
                    item.GithubNumber.HasValue ? $"Open chat for {refStr}" : null,
                    (_, _) => RunningItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title, QueueItemId = captured.Id }),
                    onClear: onClear,
                    stale: stale));
            }

            RunningCountText.Text = staleCount > 0 ? $"({running.Count}  ·  {staleCount} stuck)" : $"({running.Count})";
            RunningEmpty.Visibility = running.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── Projected Completion (#2714) ────────────────────────────────────
        //
        // One honest projected completion date per open Epic in the active Milestone, plus one
        // Milestone-level projected release date. Every date is fit — from real GitHub
        // closed-timestamp history (#2711) — with the SAME IssueEtaProjection discipline the
        // Focus bar uses; a scope with too little real history shows an honest reason, never a
        // fabricated date. Loaded on Home tab open (cache-reuse) and on the manual ⟳ (force).
        private bool _etaLoadInFlight;

        public async System.Threading.Tasks.Task RefreshEtaProjectionsAsync(bool force = false)
        {
            if (_etaLoadInFlight) return; // single in-flight compute — the ⟳ can't stack on tab-open
            _etaLoadInFlight = true;
            try
            {
                BtnRefreshEta.IsEnabled = false;
                var proj = await HomeEtaProjectionService.ComputeAsync(force);
                RenderEtaProjection(proj);
            }
            catch (Exception ex)
            {
                // Fail closed to an honest error state — never a fabricated projection.
                EtaMilestoneCard.Visibility = Visibility.Collapsed;
                EtaEpicsHeader.Visibility = Visibility.Collapsed;
                EtaEpicList.Children.Clear();
                EtaEpicCountText.Text = "";
                EtaGeneratedText.Text = "";
                EtaEmpty.Visibility = Visibility.Visible;
                EtaEmpty.Text = $"Couldn't load projections: {ex.Message}";
                ActivityLog.Log("git-board.data", $"home ETA projection refresh failed (fail-closed): {ex.Message}");
            }
            finally
            {
                BtnRefreshEta.IsEnabled = true;
                _etaLoadInFlight = false;
            }
        }

        private void BtnRefreshEta_Click(object sender, RoutedEventArgs e) => _ = RefreshEtaProjectionsAsync(force: true);

        public void RenderEtaProjection(HomeEtaProjection proj)
        {
            EtaEpicList.Children.Clear();

            if (!proj.Available)
            {
                EtaMilestoneCard.Visibility = Visibility.Collapsed;
                EtaEpicsHeader.Visibility = Visibility.Collapsed;
                EtaEpicCountText.Text = "";
                EtaGeneratedText.Text = "";
                EtaEmpty.Visibility = Visibility.Visible;
                EtaEmpty.Text = proj.UnavailableReason ?? "No active milestone to project.";
                return;
            }

            // Milestone-level projected release date.
            if (proj.Milestone is EtaProjectionRow ms)
            {
                EtaMilestoneCard.Visibility = Visibility.Visible;
                EtaMilestoneTitle.Text = $"{proj.MilestoneTitle}";
                if (ms.HasEta && ms.ProjectedUtc.HasValue)
                {
                    EtaMilestoneDate.Text = FormatProjectedDate(ms.ProjectedUtc.Value);
                    EtaMilestoneDate.Foreground = (Brush)FindResource("GreenBrush");
                    EtaMilestoneSub.Text = $"{ms.ClosedIssues}/{ms.TotalIssues} closed · {ms.IssuesPerDay:0.0}/day · {FormatEtaSpan(ms.ProjectedUtc.Value)}";
                }
                else
                {
                    EtaMilestoneDate.Text = ms.AllClosed ? "✓ done" : "—";
                    EtaMilestoneDate.Foreground = ms.AllClosed
                        ? (Brush)FindResource("GreenBrush")
                        : (Brush)FindResource("Subtext0Brush");
                    EtaMilestoneSub.Text = $"{ms.ClosedIssues}/{ms.TotalIssues} closed · {ms.Reason}";
                }
            }
            else
            {
                EtaMilestoneCard.Visibility = Visibility.Collapsed;
            }

            // Per-Epic rows.
            int projectedCount = proj.Epics.Count(r => r.HasEta);
            EtaEpicCountText.Text = proj.Epics.Count == 0
                ? "(no open epics)"
                : $"({proj.Epics.Count} epic{(proj.Epics.Count == 1 ? "" : "s")} · {projectedCount} dated)";
            EtaEpicsHeader.Visibility = proj.Epics.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var epic in proj.Epics)
                EtaEpicList.Children.Add(BuildEtaEpicRow(epic));

            EtaEmpty.Visibility = (proj.Milestone == null && proj.Epics.Count == 0) ? Visibility.Visible : Visibility.Collapsed;
            if (EtaEmpty.Visibility == Visibility.Visible)
                EtaEmpty.Text = "No open epics or milestone data to project yet.";

            EtaGeneratedText.Text = $"Fit from real GitHub close history · updated {proj.GeneratedUtc.ToLocalTime():h:mm tt}";
        }

        private Border BuildEtaEpicRow(EtaProjectionRow epic)
        {
            var titleBlock = new TextBlock
            {
                Text = $"#{epic.Number}  {epic.Title}",
                FontSize = 11.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var dateBlock = new TextBlock
            {
                FontSize = 11.5,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(8, 0, 0, 0),
            };
            string sub;
            if (epic.HasEta && epic.ProjectedUtc.HasValue)
            {
                dateBlock.Text = FormatProjectedDate(epic.ProjectedUtc.Value);
                dateBlock.Foreground = (Brush)FindResource("GreenBrush");
                sub = $"{epic.ClosedIssues}/{epic.TotalIssues} closed · {epic.IssuesPerDay:0.0}/day · {FormatEtaSpan(epic.ProjectedUtc.Value)}";
            }
            else if (epic.AllClosed)
            {
                dateBlock.Text = "✓ done";
                dateBlock.Foreground = (Brush)FindResource("GreenBrush");
                sub = epic.Reason ?? "all issues closed";
            }
            else
            {
                dateBlock.Text = "—";
                dateBlock.Foreground = (Brush)FindResource("Subtext0Brush");
                sub = $"{epic.ClosedIssues}/{epic.TotalIssues} closed · {epic.Reason}";
            }

            var subBlock = new TextBlock
            {
                Text = sub,
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext0Brush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                Margin = new Thickness(0, 2, 0, 0),
            };

            var topRow = new Grid();
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(titleBlock, 0);
            Grid.SetColumn(dateBlock, 1);
            topRow.Children.Add(titleBlock);
            topRow.Children.Add(dateBlock);

            var stack = new StackPanel();
            stack.Children.Add(topRow);
            stack.Children.Add(subBlock);

            return new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 6),
                Child = stack,
                ToolTip = epic.HasEta
                    ? $"Projected completion for epic #{epic.Number} at the current close pace ({epic.IssuesPerDay:0.0} issues/day)."
                    : $"No honest projection for epic #{epic.Number}: {epic.Reason}",
            };
        }

        /// <summary>Local-time projected date. Includes the year only when it isn't the current
        /// year, so a near-term date stays compact.</summary>
        private static string FormatProjectedDate(DateTime utc)
        {
            var local = utc.ToLocalTime();
            return local.Year == DateTime.Now.Year ? local.ToString("MMM d") : local.ToString("MMM d, yyyy");
        }

        /// <summary>Honest relative span to the projected date (e.g. "in ~18 days", "in ~3 months").</summary>
        private static string FormatEtaSpan(DateTime utc)
        {
            var remaining = utc - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero) return "due now";
            double days = remaining.TotalDays;
            if (days < 1) return $"in ~{Math.Max(1, (int)remaining.TotalHours)}h";
            if (days < 60) return $"in ~{(int)Math.Round(days)} days";
            return $"in ~{Math.Round(days / 30.0, 1):0.#} months";
        }

        private static bool IsRunningStale(DateTimeOffset? updatedAt)
        {
            if (!updatedAt.HasValue) return true;
            return (DateTimeOffset.Now - updatedAt.Value).TotalMinutes >= StaleRunningMinutes;
        }

        private static string StuckPhrase(DateTimeOffset? updatedAt)
        {
            if (!updatedAt.HasValue) return "no recent activity";
            var age = DateTimeOffset.Now - updatedAt.Value;
            if (age.TotalHours >= 24) { int d = (int)age.TotalDays; return $"{d}d ago"; }
            if (age.TotalHours >= 1) { int h = (int)age.TotalHours; return $"{h}h ago"; }
            return $"{Math.Max(1, (int)age.TotalMinutes)}m ago";
        }

        public void UpdateClaudeStatus(string statusText, bool isOperational)
        {
            ClaudeStatusLabel.Text = statusText;
            ClaudeStatusDot.Fill = isOperational
                ? (Brush)FindResource("GreenBrush")
                : (Brush)FindResource("RedBrush");
        }

        // ── Fast Button Click Handlers ──────────────────────────────────────
        private void BtnQuickNewIssue_Click(object sender, RoutedEventArgs e) => NewIssueRequested?.Invoke(this, EventArgs.Empty);
        private void BtnQuickBuildWatch_Click(object sender, RoutedEventArgs e) => BuildWatchRequested?.Invoke(this, EventArgs.Empty);
        private void BtnQuickTestRunner_Click(object sender, RoutedEventArgs e) => TestRunnerRequested?.Invoke(this, EventArgs.Empty);
        private void BtnQuickReplit_Click(object sender, RoutedEventArgs e) => ReplitRequested?.Invoke(this, EventArgs.Empty);
        private void BtnImmersiveResume_Click(object sender, RoutedEventArgs e) => ImmersiveFocusRequested?.Invoke(this, EventArgs.Empty);
        private void BtnMilestoneDetail_Click(object sender, RoutedEventArgs e)
        {
            if (FocusModeService.Instance.ActiveMilestoneNumber is int num)
                MilestoneDetailRequested?.Invoke(this, num);
        }
        private void BtnNewEpicChat_Click(object sender, RoutedEventArgs e) => NewIssueRequested?.Invoke(this, EventArgs.Empty);
        private void BtnDeployNow_Click(object sender, RoutedEventArgs e) => DeployRequested?.Invoke(this, EventArgs.Empty);
        private void BtnOpenGitBoard_Click(object sender, RoutedEventArgs e) => GitBoardRequested?.Invoke(this, EventArgs.Empty);
        private void BtnOpenSettings_Click(object sender, RoutedEventArgs e) => SettingsRequested?.Invoke(this, EventArgs.Empty);

        // ── Helper: Build Roll-up Row ────────────────────────────────────────
        private Border BuildRow(string icon, string iconHex, string title, string subtitle, string? tooltip, MouseButtonEventHandler onClick, Action? onClear = null, bool stale = false)
        {
            var iconBlock = new TextBlock
            {
                Text = icon,
                FontSize = 13,
                Margin = new Thickness(0, 0, 9, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconHex)),
            };
            DockPanel.SetDock(iconBlock, Dock.Left);

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            textStack.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            textStack.Children.Add(new TextBlock
            {
                Text = subtitle,
                FontSize = 10,
                Foreground = stale
                    ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EE99A0"))
                    : (Brush)FindResource("Subtext0Brush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });

            var panel = new DockPanel { LastChildFill = true };
            panel.Children.Add(iconBlock);

            if (onClear != null)
            {
                var clearBtn = new Button
                {
                    Content = "✕",
                    FontSize = 10,
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    ToolTip = "Clear stuck build",
                };
                if (TryFindResource("IconButton") is Style ib) clearBtn.Style = ib;
                clearBtn.Click += (_, _) => onClear();
                DockPanel.SetDock(clearBtn, Dock.Right);
                panel.Children.Add(clearBtn);
            }

            panel.Children.Add(textStack);

            var row = new Border { Style = (Style)FindResource("HomeRow"), Child = panel };
            if (stale)
                row.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EE99A0"));
            if (tooltip != null) row.ToolTip = tooltip;
            row.MouseLeftButtonUp += onClick;
            return row;
        }

        #region Pending Migrations

        // Prevents overlapping re-scans (RenderDashboardState fires on every rollup,
        // and the manual ⟳ button can land mid-scan) — a single in-flight query at a time.
        private bool _migrationsScanInFlight;

        private void BtnRefreshMigrations_Click(object sender, RoutedEventArgs e) => RefreshPendingMigrations();

        /// <summary>
        /// Enumerates every <c>lib/db/migrations/manual/*.sql</c> file, queries the real
        /// <c>simulator_migration_runs</c> table (through the app's own DB pipe — direct
        /// hosted Postgres in Dev via <see cref="LocalSqlExecutor"/>), and lists any file
        /// whose filename isn't recorded there. Best-effort and self-contained: any
        /// failure just shows a short reason in place of the list rather than throwing.
        /// </summary>
        public async void RefreshPendingMigrations()
        {
            if (_migrationsScanInFlight) return;
            _migrationsScanInFlight = true;
            try
            {
                var repoRoot = BuildTrackerConfig.FindRepoRoot();
                if (string.IsNullOrWhiteSpace(repoRoot))
                {
                    ShowMigrationsMessage("Couldn't locate the repo root to scan migrations.");
                    return;
                }

                var dir = Path.Combine(repoRoot, "lib", "db", "migrations", "manual");
                if (!Directory.Exists(dir))
                {
                    ShowMigrationsMessage("No lib/db/migrations/manual directory found.");
                    return;
                }

                // Every real .sql file on disk (filename only — the self-marking INSERT
                // in each migration records the bare filename, so that's the join key).
                var files = Directory.GetFiles(dir, "*.sql")
                    .Select(Path.GetFileName)
                    .Where(f => !string.IsNullOrWhiteSpace(f))
                    .Select(f => f!)
                    .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                HashSet<string> ran;
                try
                {
                    var statements = await LocalSqlExecutor.ExecuteAsync(
                        _apiClient!, "SELECT filename FROM simulator_migration_runs;");
                    ran = ExtractRanFilenames(statements);
                }
                catch (Exception ex)
                {
                    ShowMigrationsMessage($"Couldn't read simulator_migration_runs: {ex.Message}");
                    return;
                }

                var pending = files.Where(f => !ran.Contains(f)).ToList();
                RenderPendingMigrations(dir, pending);
            }
            catch (Exception ex)
            {
                ShowMigrationsMessage($"Migration scan failed: {ex.Message}");
            }
            finally
            {
                _migrationsScanInFlight = false;
            }
        }

        /// <summary>Pulls the <c>filename</c> column out of the SELECT result, case-insensitively.</summary>
        private static HashSet<string> ExtractRanFilenames(List<SqlStatementResult> statements)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var s in statements)
            {
                if (!s.Success) continue;
                foreach (var row in s.Rows)
                {
                    if (!row.TryGetValue("filename", out var el)) continue;
                    var name = el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
                    if (!string.IsNullOrWhiteSpace(name)) set.Add(name.Trim());
                }
            }
            return set;
        }

        private void RenderPendingMigrations(string dir, List<string> pending)
        {
            PendingMigrationsList.Children.Clear();
            PendingMigrationsCountText.Text = $"({pending.Count})";

            if (pending.Count == 0)
            {
                MigrationsHintText.Visibility = Visibility.Collapsed;
                PendingMigrationsEmpty.Text = "🎉 All manual migrations are recorded — nothing pending.";
                PendingMigrationsEmpty.Foreground = (Brush)FindResource("Subtext1Brush");
                PendingMigrationsEmpty.Visibility = Visibility.Visible;
                return;
            }

            MigrationsHintText.Visibility = Visibility.Visible;
            PendingMigrationsEmpty.Visibility = Visibility.Collapsed;

            foreach (var name in pending)
            {
                var fullPath = Path.Combine(dir, name);
                PendingMigrationsList.Children.Add(BuildRow(
                    "🧩", "#F9E2AF",
                    name,
                    "not recorded  ·  click to load into SQL Runner",
                    $"Load {name} into the SQL Runner for review & manual execution",
                    (_, _) => OpenMigrationInSqlRunnerRequested?.Invoke(this, fullPath)));
            }
        }

        private void ShowMigrationsMessage(string message)
        {
            PendingMigrationsList.Children.Clear();
            PendingMigrationsCountText.Text = "(?)";
            MigrationsHintText.Visibility = Visibility.Collapsed;
            PendingMigrationsEmpty.Text = message;
            PendingMigrationsEmpty.Foreground = (Brush)FindResource("PeachBrush");
            PendingMigrationsEmpty.Visibility = Visibility.Visible;
        }

        #endregion

        #region System Health & Tier Diagnostics

        private DispatcherTimer? _healthTimer;
        private BuildTrackerApiClient? _apiClient;
        private SystemHealthReport? _lastHealthReport;

        public void InitializeHealthMonitor(BuildTrackerApiClient? api)
        {
            if (api != null) _apiClient = api;
            _healthTimer?.Stop();
            _healthTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            _healthTimer.Tick += async (_, _) => await RefreshHealthAsync();
            _healthTimer.Start();
            _ = RefreshHealthAsync();
        }

        public async System.Threading.Tasks.Task RefreshHealthAsync()
        {
            OverallHealthPillText.Text = "Checking…";
            OverallHealthPillText.Foreground = (Brush)FindResource("YellowBrush");

            try
            {
                var report = await SystemHealthService.RunFullHealthCheckAsync(_apiClient);
                _lastHealthReport = report;
                RenderHealthReport(report);
            }
            catch (Exception ex)
            {
                OverallHealthPillText.Text = "Check Failed";
                OverallHealthPillText.Foreground = (Brush)FindResource("RedBrush");
                ActivityLog.Log("system.health", $"Error during health refresh: {ex.Message}");
            }
        }

        private void RenderHealthReport(SystemHealthReport report)
        {
            // Overall Status Pill
            if (report.AllHealthy)
            {
                OverallHealthPill.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E3A2F"));
                OverallHealthPillText.Text = "🟢 ALL HEALTHY";
                OverallHealthPillText.Foreground = (Brush)FindResource("GreenBrush");
            }
            else
            {
                OverallHealthPill.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3E2723"));
                OverallHealthPillText.Text = "⚠️ ATTENTION NEEDED";
                OverallHealthPillText.Foreground = (Brush)FindResource("PeachBrush");
            }

            // 1. Dev Server
            DevServerSummaryText.Text = report.DevServer.Summary;
            SetStatusBadge(DevServerStatusBadge, DevServerBadgeText, report.DevServer.Status,
                report.DevServer.Status == HealthStatus.Healthy ? $"{report.DevServer.LatencyMs}ms" : "");

            // 2. Database Pipe
            DatabaseSummaryText.Text = report.Database.Summary;
            SetStatusBadge(DatabaseStatusBadge, DatabaseBadgeText, report.Database.Status,
                report.Database.Status == HealthStatus.Healthy ? $"{report.Database.LatencyMs}ms" : "");

            // 3. Mutex
            MutexSummaryText.Text = report.Mutex.Summary;
            if (!report.Mutex.IsHeld)
            {
                SetStatusBadge(MutexStatusBadge, MutexBadgeText, HealthStatus.Healthy, "IDLE");
            }
            else if (report.Mutex.IsSuspicious)
            {
                SetStatusBadge(MutexStatusBadge, MutexBadgeText, HealthStatus.Unhealthy, "STUCK");
            }
            else
            {
                MutexStatusBadge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E2A3A"));
                MutexBadgeText.Text = "ACTIVE";
                MutexBadgeText.Foreground = (Brush)FindResource("BlueBrush");
            }

            // 4. Worktrees
            WorktreesSummaryText.Text = report.OrphanedWorktrees.Summary;
            if (report.OrphanedWorktrees.OrphanedCount > 0)
            {
                SetStatusBadge(WorktreesStatusBadge, WorktreesBadgeText, HealthStatus.Degraded, $"{report.OrphanedWorktrees.OrphanedCount} ORPHANED");
                BtnCleanWorktrees.Visibility = Visibility.Visible;
            }
            else
            {
                SetStatusBadge(WorktreesStatusBadge, WorktreesBadgeText, HealthStatus.Healthy, "CLEAN");
                BtnCleanWorktrees.Visibility = Visibility.Collapsed;
            }

            // 5. Stranded Branches (Git #1447 — distinct from Worktrees above)
            StrandedBranchesSummaryText.Text = report.StrandedBranches.Summary;
            if (report.StrandedBranches.StrandedCount > 0)
            {
                SetStatusBadge(StrandedBranchesStatusBadge, StrandedBranchesBadgeText, HealthStatus.Degraded, $"{report.StrandedBranches.StrandedCount} STRANDED");
                BtnRecheckStranded.Visibility = Visibility.Visible;
            }
            else
            {
                SetStatusBadge(StrandedBranchesStatusBadge, StrandedBranchesBadgeText, HealthStatus.Healthy, "CLEAN");
                BtnRecheckStranded.Visibility = Visibility.Collapsed;
            }

            // 6. Staging SSH
            SshSummaryText.Text = report.SshStaging.Summary;
            SetStatusBadge(SshStatusBadge, SshBadgeText, report.SshStaging.Status,
                report.SshStaging.Status == HealthStatus.Healthy ? $"{report.SshStaging.LatencyMs}ms" : "");
        }

        private void SetStatusBadge(Border badge, TextBlock badgeText, HealthStatus status, string customText = "")
        {
            switch (status)
            {
                case HealthStatus.Healthy:
                    badge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E3A2F"));
                    badgeText.Text = string.IsNullOrEmpty(customText) ? "OK" : customText;
                    badgeText.Foreground = (Brush)FindResource("GreenBrush");
                    break;
                case HealthStatus.Degraded:
                    badge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3E2E1E"));
                    badgeText.Text = string.IsNullOrEmpty(customText) ? "WARN" : customText;
                    badgeText.Foreground = (Brush)FindResource("YellowBrush");
                    break;
                case HealthStatus.Unhealthy:
                    badge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3E1E1E"));
                    badgeText.Text = string.IsNullOrEmpty(customText) ? "ERROR" : customText;
                    badgeText.Foreground = (Brush)FindResource("RedBrush");
                    break;
                case HealthStatus.NotConfigured:
                    badge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#2A2B3D"));
                    badgeText.Text = string.IsNullOrEmpty(customText) ? "NOT SET" : customText;
                    badgeText.Foreground = (Brush)FindResource("Subtext0Brush");
                    break;
                default:
                    badge.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#2A2B3D"));
                    badgeText.Text = "UNKNOWN";
                    badgeText.Foreground = (Brush)FindResource("Subtext1Brush");
                    break;
            }
        }

        private async void BtnRefreshHealth_Click(object sender, RoutedEventArgs e)
        {
            await RefreshHealthAsync();
        }

        private async void BtnCleanWorktrees_Click(object sender, RoutedEventArgs e)
        {
            BtnCleanWorktrees.IsEnabled = false;
            BtnCleanWorktrees.Content = "Sweeping…";
            try
            {
                var res = await WorktreeCleanupService.SweepWorktreesAsync(force: true);
                if (res.Ok)
                {
                    ToastEngine.Show("Worktree Cleanup", $"Swept {res.RemovedCount} orphaned worktree(s).", ToastKind.Success);
                }
                else
                {
                    ToastEngine.Show("Worktree Cleanup Failed", res.Error ?? "Unknown error", ToastKind.Error);
                }
                await RefreshHealthAsync();
            }
            finally
            {
                BtnCleanWorktrees.IsEnabled = true;
                BtnCleanWorktrees.Content = "🧹 Clean";
            }
        }

        private async void BtnRecheckStranded_Click(object sender, RoutedEventArgs e)
        {
            // Read-only re-sweep only (Git #1466) -- StrandedBranchService/
            // check-stranded-branches.mjs deliberately never deletes or merges a
            // branch (a stranded branch by definition has commits main does not
            // have, so auto-cleanup would risk real data loss). This button just
            // re-runs the detection sweep on demand so the badge/diagnostics log
            // reflect the latest state without waiting for the next auto-refresh;
            // actually resolving a stranded branch (merge or intentional delete)
            // stays a manual decision made from the diagnostics log below.
            BtnRecheckStranded.IsEnabled = false;
            BtnRecheckStranded.Content = "Rechecking…";
            try
            {
                await RefreshHealthAsync();
                ToastEngine.Show("Stranded Branches", "Re-ran the sweep — see the badge/diagnostics log for current results.", ToastKind.Info);
            }
            finally
            {
                BtnRecheckStranded.IsEnabled = true;
                BtnRecheckStranded.Content = "🔀 Recheck";
            }
        }

        private void RowHealth_Click(object sender, MouseButtonEventArgs e)
        {
            if (sender is not FrameworkElement fe || _lastHealthReport == null) return;
            string tag = fe.Tag as string ?? "";

            string title = "";
            string details = "";

            switch (tag)
            {
                case "DevServer":
                    title = "LOCAL DEV SERVER DIAGNOSTICS";
                    details = $"Target Status: {_lastHealthReport.DevServer.Status}\n" +
                              $"Latency: {_lastHealthReport.DevServer.LatencyMs}ms\n" +
                              $"{_lastHealthReport.DevServer.Details}";
                    break;
                case "Database":
                    title = "DATABASE (SQL RUNNER PIPE) DIAGNOSTICS";
                    details = $"Target Status: {_lastHealthReport.Database.Status}\n" +
                              $"Latency: {_lastHealthReport.Database.LatencyMs}ms\n" +
                              $"{_lastHealthReport.Database.Details}";
                    break;
                case "Mutex":
                    title = "#92 COORDINATION MUTEX DIAGNOSTICS";
                    details = $"Is Held: {_lastHealthReport.Mutex.IsHeld}\n" +
                              $"Owner PID: {_lastHealthReport.Mutex.OwnerPid}\n" +
                              $"Owner Alive: {_lastHealthReport.Mutex.OwnerAlive}\n" +
                              $"Suspicious / Stuck: {_lastHealthReport.Mutex.IsSuspicious}\n" +
                              $"Duration Held: {_lastHealthReport.Mutex.HeldDuration.TotalSeconds:F1}s\n" +
                              $"{_lastHealthReport.Mutex.Details}";
                    break;
                case "Worktrees":
                    title = "AGENT WORKTREES DIAGNOSTICS";
                    details = $"Inspected: {_lastHealthReport.OrphanedWorktrees.InspectedCount}\n" +
                              $"Active / Retained: {_lastHealthReport.OrphanedWorktrees.ActiveCount}\n" +
                              $"Orphaned: {_lastHealthReport.OrphanedWorktrees.OrphanedCount}\n" +
                              $"{_lastHealthReport.OrphanedWorktrees.Details}";
                    break;
                case "StrandedBranches":
                    title = "STRANDED BRANCHES (VS MAIN) DIAGNOSTICS";
                    details = $"Inspected: {_lastHealthReport.StrandedBranches.InspectedCount}\n" +
                              $"Clean / Merged: {_lastHealthReport.StrandedBranches.CleanCount}\n" +
                              $"Stranded: {_lastHealthReport.StrandedBranches.StrandedCount}\n" +
                              $"{_lastHealthReport.StrandedBranches.Details}";
                    break;
                case "Ssh":
                    title = "STAGING (REPLIT SSH) DIAGNOSTICS";
                    details = $"Configured: {_lastHealthReport.SshStaging.IsConfigured}\n" +
                              $"Status: {_lastHealthReport.SshStaging.Status}\n" +
                              $"Latency: {_lastHealthReport.SshStaging.LatencyMs}ms\n" +
                              $"{_lastHealthReport.SshStaging.Details}";
                    break;
            }

            if (!string.IsNullOrEmpty(title))
            {
                DiagnosticsHeader.Text = title;
                DiagnosticsDetailText.Text = details;
                HealthDiagnosticsBox.Visibility = Visibility.Visible;
            }
        }

        private void BtnCloseDiagnostics_Click(object sender, RoutedEventArgs e)
        {
            HealthDiagnosticsBox.Visibility = Visibility.Collapsed;
        }

        #endregion

        #region Burndown Chart (Git #2712)

        // Prevents overlapping fetches the same way the migrations scan does — the 10s
        // home rollup tick can land mid-fetch of the (cached) #2711 time series.
        private bool _burndownFetchInFlight;
        private IssueTimeSeries? _lastBurndownSeries;

        private void BtnRefreshBurndown_Click(object sender, RoutedEventArgs e) => RefreshBurndown(forceRefresh: true);

        private void BurndownCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            // A resize (column reflow, window resize) needs a full redraw — the polyline's
            // points are computed against the canvas's actual pixel size.
            if (_lastBurndownSeries is { HasEnoughData: true } series) DrawBurndownCanvas(series);
        }

        /// <summary>
        /// Real burndown data for the Home dashboard (Git #2712) — the active Milestone's
        /// real daily open-issue count from <see cref="GitHubIssueTimeSeriesService"/> (#2711).
        /// <paramref name="forceRefresh"/> bypasses that service's 5-minute cache (the manual
        /// ⟳ button); the passive 10s rollup tick always reads the cache.
        /// </summary>
        public async void RefreshBurndown(bool forceRefresh = false)
        {
            if (_burndownFetchInFlight) return;
            _burndownFetchInFlight = true;
            try
            {
                var series = await GitHubIssueTimeSeriesService.GetActiveMilestoneSeriesAsync(forceRefresh);
                _lastBurndownSeries = series;
                RenderBurndown(series);
            }
            catch (Exception ex)
            {
                _lastBurndownSeries = null;
                ShowBurndownMessage($"Burndown chart failed to load: {ex.Message}");
            }
            finally
            {
                _burndownFetchInFlight = false;
            }
        }

        private void RenderBurndown(IssueTimeSeries series)
        {
            BurndownScopeText.Text = series.ScopeLabel;

            // Fail-closed (#2711's HasEnoughData contract): an honest "not enough history"
            // state, never a fabricated/interpolated curve.
            if (!series.HasEnoughData)
            {
                ShowBurndownMessage(series.Reason ?? "Not enough real history yet to chart a trend.");
                return;
            }

            BurndownEmptyText.Visibility = Visibility.Collapsed;
            BurndownCanvas.Visibility = Visibility.Visible;
            BurndownSummaryText.Visibility = Visibility.Visible;

            DrawBurndownCanvas(series);

            var first = series.Points[0];
            var last = series.Points[series.Points.Count - 1];
            BurndownSummaryText.Text =
                $"{first.OpenCount} open on {series.FirstDate:MMM d} → {last.OpenCount} open today  ·  " +
                $"{series.CurrentClosed}/{series.TotalIssues} closed";
        }

        private void ShowBurndownMessage(string message)
        {
            BurndownCanvas.Children.Clear();
            BurndownCanvas.Visibility = Visibility.Collapsed;
            BurndownSummaryText.Visibility = Visibility.Collapsed;
            BurndownEmptyText.Text = message;
            BurndownEmptyText.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// Hand-drawn line+area chart on <c>BurndownCanvas</c> — this codebase's own convention
        /// for custom visuals (Build Queue's graph, #839) rather than a new charting dependency
        /// (see #2710's technical-judgement note). Plots the real running <see cref="IssueTimeSeriesPoint.OpenCount"/>
        /// per day, oldest to newest, scaled to the canvas's actual real estate.
        /// </summary>
        private void DrawBurndownCanvas(IssueTimeSeries series)
        {
            BurndownCanvas.Children.Clear();

            double width = BurndownCanvas.ActualWidth;
            double height = BurndownCanvas.ActualHeight;
            var points = series.Points;
            if (points.Count < 2 || width <= 1 || height <= 1) return;

            int maxOpen = Math.Max(1, points.Max(p => p.OpenCount));
            const double topPad = 6, bottomPad = 2;
            double plotHeight = Math.Max(1, height - topPad - bottomPad);

            double StepX(int i) => width * i / (points.Count - 1);
            double StepY(int openCount) => topPad + plotHeight - (plotHeight * openCount / maxOpen);

            var lineBrush = (Brush)FindResource("PeachBrush");
            var fillColor = ((SolidColorBrush)lineBrush).Color;
            var fillBrush = new SolidColorBrush(fillColor) { Opacity = 0.14 };

            // Filled area under the curve, then the real line on top.
            var polyPoints = new PointCollection(points.Count);
            for (int i = 0; i < points.Count; i++)
                polyPoints.Add(new Point(StepX(i), StepY(points[i].OpenCount)));

            var areaFigure = new PathFigure { StartPoint = new Point(0, height), IsClosed = true };
            foreach (var pt in polyPoints) areaFigure.Segments.Add(new LineSegment(pt, true));
            areaFigure.Segments.Add(new LineSegment(new Point(width, height), true));
            var areaGeo = new PathGeometry();
            areaGeo.Figures.Add(areaFigure);
            BurndownCanvas.Children.Add(new System.Windows.Shapes.Path { Data = areaGeo, Fill = fillBrush });

            BurndownCanvas.Children.Add(new System.Windows.Shapes.Polyline
            {
                Points = polyPoints,
                Stroke = lineBrush,
                StrokeThickness = 2,
                StrokeLineJoin = PenLineJoin.Round,
            });

            // Highlight the real current value at the last point.
            var lastPt = polyPoints[polyPoints.Count - 1];
            var dot = new System.Windows.Shapes.Ellipse { Width = 7, Height = 7, Fill = lineBrush };
            Canvas.SetLeft(dot, lastPt.X - 3.5);
            Canvas.SetTop(dot, lastPt.Y - 3.5);
            BurndownCanvas.Children.Add(dot);
        }

        #endregion

        #region Open/Close Rate Crossing Chart (Git #2713)

        // Prevents overlapping fetches the same way the migrations scan / burndown chart
        // do — the passive rollup tick can land mid-fetch of the (cached) #2711 time series.
        private bool _rateChartFetchInFlight;
        private IssueTimeSeries? _lastRateChartSeries;

        private void BtnRefreshOpenCloseRate_Click(object sender, RoutedEventArgs e) => RefreshOpenCloseRateChart(forceRefresh: true);

        private void OpenCloseRateCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            // A resize (column reflow, window resize) needs a full redraw — the polylines'
            // points are computed against the canvas's actual pixel size.
            if (_lastRateChartSeries is { HasEnoughData: true } series) DrawOpenCloseRateCanvas(series);
        }

        /// <summary>
        /// Real open/close-rate data for the Home dashboard (Git #2713) — the active
        /// Milestone's real per-day opened/closed counts from
        /// <see cref="GitHubIssueTimeSeriesService"/> (#2711), the exact same shared source
        /// the burndown chart (#2712) reads. <paramref name="forceRefresh"/> bypasses that
        /// service's 5-minute cache (the manual ⟳ button); the passive rollup tick always
        /// reads the cache.
        /// </summary>
        public async void RefreshOpenCloseRateChart(bool forceRefresh = false)
        {
            if (_rateChartFetchInFlight) return;
            _rateChartFetchInFlight = true;
            try
            {
                var series = await GitHubIssueTimeSeriesService.GetActiveMilestoneSeriesAsync(forceRefresh);
                _lastRateChartSeries = series;
                RenderOpenCloseRateChart(series);
            }
            catch (Exception ex)
            {
                _lastRateChartSeries = null;
                ShowOpenCloseRateMessage($"Open/close rate chart failed to load: {ex.Message}");
            }
            finally
            {
                _rateChartFetchInFlight = false;
            }
        }

        private void RenderOpenCloseRateChart(IssueTimeSeries series)
        {
            OpenCloseRateScopeText.Text = series.ScopeLabel;

            // Fail-closed (#2711's HasEnoughData contract): an honest "not enough history"
            // state, never a fabricated/interpolated line.
            if (!series.HasEnoughData)
            {
                ShowOpenCloseRateMessage(series.Reason ?? "Not enough real history yet to chart a trend.");
                return;
            }

            OpenCloseRateEmptyText.Visibility = Visibility.Collapsed;
            OpenCloseRateCanvas.Visibility = Visibility.Visible;
            OpenCloseRateSummaryText.Visibility = Visibility.Visible;

            DrawOpenCloseRateCanvas(series);

            // Real trailing-week totals (real per-day counts summed over a real window — an
            // honest aggregation, not a smoothed/interpolated curve) so the summary line
            // reads sensibly even when the very last real day is noisy/quiet.
            int windowDays = Math.Min(7, series.Points.Count);
            var window = series.Points.Skip(series.Points.Count - windowDays).ToList();
            int openedWindow = window.Sum(p => p.Opened);
            int closedWindow = window.Sum(p => p.Closed);
            string trend = closedWindow > openedWindow
                ? $"closing faster than opening (last {windowDays}d: {closedWindow} closed vs {openedWindow} opened) 📉"
                : closedWindow < openedWindow
                    ? $"opening faster than closing (last {windowDays}d: {openedWindow} opened vs {closedWindow} closed) 📈"
                    : $"opening and closing at the same real pace (last {windowDays}d: {openedWindow} each)";
            OpenCloseRateSummaryText.Text = $"{series.CurrentOpen} open now — {trend}.";
        }

        private void ShowOpenCloseRateMessage(string message)
        {
            OpenCloseRateCanvas.Children.Clear();
            OpenCloseRateCanvas.Visibility = Visibility.Collapsed;
            OpenCloseRateSummaryText.Visibility = Visibility.Collapsed;
            OpenCloseRateEmptyText.Text = message;
            OpenCloseRateEmptyText.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// Hand-drawn two-line chart on <c>OpenCloseRateCanvas</c> — same Canvas/Polyline
        /// convention the burndown chart (#2712) uses (this codebase's own convention for
        /// custom visuals, #839) rather than a new charting dependency. Plots the real
        /// per-day <see cref="IssueTimeSeriesPoint.Opened"/> and
        /// <see cref="IssueTimeSeriesPoint.Closed"/> counts, oldest to newest, scaled to the
        /// canvas's actual real estate, and marks the most recent real day the closed line
        /// crosses to at-or-above the opened line — the exact "close rate overtaking open
        /// rate" signal #2713 asks to make visually obvious.
        /// </summary>
        private void DrawOpenCloseRateCanvas(IssueTimeSeries series)
        {
            OpenCloseRateCanvas.Children.Clear();

            double width = OpenCloseRateCanvas.ActualWidth;
            double height = OpenCloseRateCanvas.ActualHeight;
            var points = series.Points;
            if (points.Count < 2 || width <= 1 || height <= 1) return;

            int maxDaily = Math.Max(1, points.Max(p => Math.Max(p.Opened, p.Closed)));
            const double topPad = 6, bottomPad = 2;
            double plotHeight = Math.Max(1, height - topPad - bottomPad);

            double StepX(int i) => width * i / (points.Count - 1);
            double StepY(int count) => topPad + plotHeight - (plotHeight * count / maxDaily);

            var openedBrush = (Brush)FindResource("PeachBrush");
            var closedBrush = (Brush)FindResource("GreenBrush");

            var openedPoints = new PointCollection(points.Count);
            var closedPoints = new PointCollection(points.Count);
            for (int i = 0; i < points.Count; i++)
            {
                openedPoints.Add(new Point(StepX(i), StepY(points[i].Opened)));
                closedPoints.Add(new Point(StepX(i), StepY(points[i].Closed)));
            }

            OpenCloseRateCanvas.Children.Add(new System.Windows.Shapes.Polyline
            {
                Points = openedPoints,
                Stroke = openedBrush,
                StrokeThickness = 1.75,
                StrokeLineJoin = PenLineJoin.Round,
            });
            OpenCloseRateCanvas.Children.Add(new System.Windows.Shapes.Polyline
            {
                Points = closedPoints,
                Stroke = closedBrush,
                StrokeThickness = 1.75,
                StrokeLineJoin = PenLineJoin.Round,
            });

            // Real crossover marker: the most recent real day Closed caught up to or passed
            // Opened while the immediately preceding real day still had Closed behind —
            // an actual sign change between the two real series, never a guessed one.
            for (int i = points.Count - 1; i >= 1; i--)
            {
                bool nowClosedAhead = points[i].Closed >= points[i].Opened;
                bool prevClosedBehind = points[i - 1].Closed < points[i - 1].Opened;
                if (!nowClosedAhead || !prevClosedBehind) continue;

                var marker = new System.Windows.Shapes.Ellipse
                {
                    Width = 8,
                    Height = 8,
                    Fill = closedBrush,
                    Stroke = (Brush)FindResource("TextBrush"),
                    StrokeThickness = 1,
                };
                Canvas.SetLeft(marker, closedPoints[i].X - 4);
                Canvas.SetTop(marker, closedPoints[i].Y - 4);
                OpenCloseRateCanvas.Children.Add(marker);
                break;
            }

            // Highlight the real current values at the last point for both lines.
            var lastOpened = new System.Windows.Shapes.Ellipse { Width = 6, Height = 6, Fill = openedBrush };
            Canvas.SetLeft(lastOpened, openedPoints[openedPoints.Count - 1].X - 3);
            Canvas.SetTop(lastOpened, openedPoints[openedPoints.Count - 1].Y - 3);
            OpenCloseRateCanvas.Children.Add(lastOpened);

            var lastClosed = new System.Windows.Shapes.Ellipse { Width = 6, Height = 6, Fill = closedBrush };
            Canvas.SetLeft(lastClosed, closedPoints[closedPoints.Count - 1].X - 3);
            Canvas.SetTop(lastClosed, closedPoints[closedPoints.Count - 1].Y - 3);
            OpenCloseRateCanvas.Children.Add(lastClosed);
        }

        #endregion
    }
}
