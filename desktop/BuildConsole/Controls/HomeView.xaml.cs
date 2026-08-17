using System;
using System.Collections.Generic;
using System.Linq;
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
        public event EventHandler<HomeQueueClick>? RunningItemClicked;
        public event EventHandler<HomeQueueClick>? DoneItemClicked;
        public event EventHandler<HomeStuckItemClear>? ClearStuckItemRequested;
        public event EventHandler? NewIssueRequested;
        public event EventHandler? BuildWatchRequested;
        public event EventHandler? TestRunnerRequested;
        public event EventHandler? ReplitRequested;
        public event EventHandler? ImmersiveFocusRequested;
        public event EventHandler? DeployRequested;
        public event EventHandler? GitBoardRequested;
        public event EventHandler? SettingsRequested;
        public event EventHandler<GitBoardIssue>? IssueDetailRequested;
        public event EventHandler<int>? MilestoneDetailRequested;

        private const int StaleRunningMinutes = 60;
        private readonly Random _rng = new();
        private DispatcherTimer? _mascotTimer;
        private GitBoardIssue? _recommendedTask;

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

            Unloaded += (_, _) =>
            {
                try { FocusModeService.Instance.StateChanged -= UpdateFocusState; } catch { }
                _mascotTimer?.Stop();
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
            if (issues == null) return;

            // Update stats
            int totalEpics = issues.Count(i => i.IsEpic);
            int openIssues = issues.Count(i => !i.IsClosed);
            int totalMilestones = milestones?.Count ?? 0;

            BoardEpicsCount.Text = $"{totalEpics}";
            BoardIssuesCount.Text = $"{openIssues}";
            BoardMilestonesCount.Text = $"{totalMilestones}";

            // Find top Shane To-Do items & recommended next task
            var todos = issues
                .Where(i => !i.IsClosed && (i.IsTodo || i.Labels.Any(l => string.Equals(l.Name, "Shane To-Do", StringComparison.OrdinalIgnoreCase))))
                .OrderByDescending(i => i.Number)
                .ToList();

            TodoList.Children.Clear();
            TodoCountText.Text = $"({todos.Count})";
            TodoEmpty.Visibility = todos.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var item in todos.Take(6))
            {
                var captured = item;
                TodoList.Children.Add(BuildRow(
                    "🔥", "#FAB387",
                    captured.Title,
                    $"#{captured.Number}  ·  Shane To-Do  ·  click to open",
                    $"Open issue #{captured.Number}",
                    (_, _) => IssueDetailRequested?.Invoke(this, captured)));
            }

            // ── Top Priority "WHAT TO DO NEXT (NO OVERWHELM)" — Current Milestone Quick Win ──
            var focus = FocusModeService.Instance;
            int? activeMilestoneNumber = focus.IsActive ? focus.ActiveMilestoneNumber : null;
            string activeMilestoneTitle = focus.IsActive ? focus.ActiveMilestoneTitle : "";

            // Non-epic, open issues
            var candidates = issues.Where(i => !i.IsClosed && !i.IsEpic).ToList();

            // Filter to current milestone if active
            List<GitBoardIssue> milestoneCandidates;
            if (activeMilestoneNumber.HasValue)
            {
                milestoneCandidates = candidates.Where(i =>
                    i.MilestoneNumber == activeMilestoneNumber.Value ||
                    i.ParentMilestoneNumber == activeMilestoneNumber.Value ||
                    focus.IsIssueInFocus(i.Number)).ToList();
            }
            else
            {
                milestoneCandidates = candidates;
            }

            // Pick fastest Quick Win (lowest estimated completion time, Shane To-Do prioritized)
            _recommendedTask = milestoneCandidates
                .OrderBy(i => EstimateIssueMinutes(i))
                .ThenByDescending(i => i.IsTodo)
                .ThenBy(i => i.Number)
                .FirstOrDefault() ?? candidates.OrderBy(i => EstimateIssueMinutes(i)).FirstOrDefault();

            if (_recommendedTask != null)
            {
                int estMins = EstimateIssueMinutes(_recommendedTask);
                string estFormatted = FormatEstimate(estMins);

                NextTaskBadgeText.Text = $"⚡ Quick Win ({estFormatted})";
                NextTaskTitle.Text = $"#{_recommendedTask.Number} — {_recommendedTask.Title}";

                string milestoneTag = !string.IsNullOrWhiteSpace(_recommendedTask.MilestoneTitle)
                    ? _recommendedTask.MilestoneTitle
                    : (!string.IsNullOrWhiteSpace(activeMilestoneTitle) ? activeMilestoneTitle : "Current Backlog");

                NextTaskSubtitle.Text = $"🎯 Milestone: {milestoneTag}  ·  Est. {estFormatted}  ·  Fastest unblocked win";
                BtnStartNextTask.Content = $"🚀 Jump into This Quick Win ({estFormatted})";
                BtnStartNextTask.Visibility = Visibility.Visible;
            }
            else
            {
                NextTaskBadgeText.Text = "🎉 Complete";
                NextTaskTitle.Text = "All caught up on this milestone! 🚀";
                NextTaskSubtitle.Text = "No open quick tasks remaining in the active milestone.";
                BtnStartNextTask.Visibility = Visibility.Collapsed;
            }
        }

        private static int EstimateIssueMinutes(GitBoardIssue issue)
        {
            string text = $"{issue.Title} {issue.Body}";

            // 1. Explicit minute indicator e.g. "15m", "20 min", "est: 30 mins"
            var mMin = System.Text.RegularExpressions.Regex.Match(text, @"(?i)(?:est\.?|estimate|time|takes|duration)?\s*[:~-]?\s*(\d+)\s*(?:m|min|mins|minutes)\b");
            if (mMin.Success && int.TryParse(mMin.Groups[1].Value, out var mins) && mins > 0)
                return mins;

            // 2. Explicit hour indicator e.g. "1h", "2 hrs"
            var mHr = System.Text.RegularExpressions.Regex.Match(text, @"(?i)(?:est\.?|estimate|time)?\s*[:~-]?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b");
            if (mHr.Success && double.TryParse(mHr.Groups[1].Value, out var hrs) && hrs > 0)
                return (int)(hrs * 60);

            // 3. Label heuristics
            if (issue.Labels.Any(l => l.Name.Contains("quick", StringComparison.OrdinalIgnoreCase) || l.Name.Contains("easy", StringComparison.OrdinalIgnoreCase)))
                return 10;
            if (issue.Labels.Any(l => l.Name.Contains("15m", StringComparison.OrdinalIgnoreCase)))
                return 15;
            if (issue.Labels.Any(l => l.Name.Contains("30m", StringComparison.OrdinalIgnoreCase)))
                return 30;
            if (issue.Labels.Any(l => l.Name.Contains("1h", StringComparison.OrdinalIgnoreCase)))
                return 60;
            if (issue.IsTodo)
                return 15;
            if (issue.Labels.Any(l => l.Name.Contains("bug", StringComparison.OrdinalIgnoreCase)))
                return 20;

            // 4. Text length heuristic
            int len = (issue.Title ?? "").Length + (issue.Body ?? "").Length;
            if (len < 100) return 15;
            if (len < 300) return 25;
            if (len < 800) return 40;
            return 60;
        }

        private static string FormatEstimate(int minutes)
        {
            if (minutes < 60) return $"~{minutes}m";
            int h = minutes / 60;
            int m = minutes % 60;
            return m > 0 ? $"~{h}h {m}m" : $"~{h}h";
        }

        private void BtnStartNextTask_Click(object sender, RoutedEventArgs e)
        {
            if (_recommendedTask != null)
                IssueDetailRequested?.Invoke(this, _recommendedTask);
        }

        // ── Section 0: What's New ───────────────────────────────────────────
        public void RenderWhatsNew(string versionLabel, IReadOnlyList<string> titles, int moreCount = 0)
        {
            WhatsNewList.Children.Clear();

            if (titles == null || titles.Count == 0)
            {
                WhatsNewSection.Visibility = Visibility.Collapsed;
                return;
            }

            WhatsNewVersionText.Text = versionLabel;

            foreach (var title in titles)
                WhatsNewList.Children.Add(BuildBullet(title));

            if (moreCount > 0)
            {
                var more = BuildBullet($"…and {moreCount} more change{(moreCount == 1 ? "" : "s")}");
                ((TextBlock)((StackPanel)((Border)more).Child).Children[1]).FontStyle = FontStyles.Italic;
                WhatsNewList.Children.Add(more);
            }

            int total = titles.Count + moreCount;
            WhatsNewSummaryText.Text = $"{total} change{(total == 1 ? "" : "s")} since you last looked";
            WhatsNewTile.IsChecked = false;
            WhatsNewContent.Visibility = Visibility.Collapsed;
            WhatsNewSection.Visibility = Visibility.Visible;
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
        public void RenderLeftOff(IReadOnlyList<PersistedChatTab> tabs)
        {
            LeftOffList.Children.Clear();
            LeftOffCountText.Text = $"({tabs.Count})";
            LeftOffEmpty.Visibility = tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var tab in tabs.Take(5))
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

                string numPrefix = item.GithubNumber.HasValue ? $"#{item.GithubNumber}  ·  " : "";
                string sub = stale
                    ? numPrefix + "⚠ " + StuckPhrase(item.UpdatedAt) + " — likely stuck"
                    : numPrefix + "running" + (item.UpdatedAt.HasValue ? $"  ·  {item.UpdatedAt.Value.ToLocalTime():MMM d, h:mm tt}" : "");

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
                    item.GithubNumber.HasValue ? $"Open chat for #{item.GithubNumber}" : null,
                    (_, _) => RunningItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title }),
                    onClear: onClear,
                    stale: stale));
            }

            RunningCountText.Text = staleCount > 0 ? $"({running.Count}  ·  {staleCount} stuck)" : $"({running.Count})";
            RunningEmpty.Visibility = running.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
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

        // ── Section 3: Done, waiting for you ────────────────────────────────
        public void RenderDoneWaiting(IReadOnlyList<QueueItem> done)
        {
            DoneList.Children.Clear();
            DoneCountText.Text = $"({done.Count})";
            DoneEmpty.Visibility = done.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var item in done)
            {
                var captured = item;
                string when = item.UpdatedAt.HasValue ? item.UpdatedAt.Value.ToLocalTime().ToString("MMM d, h:mm tt") : "recently";
                string sub = (item.GithubNumber.HasValue ? $"#{item.GithubNumber}  ·  " : "") + $"done {when}  ·  click to review";

                DoneList.Children.Add(BuildRow(
                    "✅", "#7FAE91",
                    string.IsNullOrWhiteSpace(item.Title) ? "(untitled build)" : item.Title,
                    sub,
                    item.GithubNumber.HasValue ? $"Open chat for #{item.GithubNumber}" : null,
                    (_, _) => DoneItemClicked?.Invoke(this, new HomeQueueClick { GithubNumber = captured.GithubNumber, Title = captured.Title })));
            }
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
    }
}
