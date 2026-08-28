using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using Ellipse = System.Windows.Shapes.Ellipse;
using Polygon = System.Windows.Shapes.Polygon;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class TaskSelectedEventArgs : EventArgs
    {
        public int QueueItemId { get; set; }
        public string Epic { get; set; } = string.Empty;
        public string Task { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string StatusDetails { get; set; } = string.Empty;
        public int? ExitCode { get; set; }
    }

    /// <summary>
    /// Build Queue panel — visual DAG redesign (#860 reference):
    /// Reads live queue state (GET /extension/queue) and renders a real Canvas-based
    /// connector-line DAG graph. When builds are blocked by others (e.g. Build 6 blocked by
    /// 1, 2, 3, 4), real parent-child visual connector lines and Bézier curves show
    /// exact dependency relationships at a glance across running, up-next, blocked, and done builds.
    /// Preserves Issues in Epic, In-Flight, Sessions, and the Critter Lounge system.
    /// </summary>
    public partial class BuildQueuePanel : UserControl
    {
        public event EventHandler<TaskSelectedEventArgs>? TaskSelected;
        public event EventHandler<bool>? PinToggled;
        /// <summary>Git #815 — mirrors LeftSidebar's SyncError: null on a successful poll, a message on a failed one.</summary>
        public event EventHandler<string?>? SyncError;
        /// <summary>Git #851 — Opens the chat associated to an in-flight issue.</summary>
        public event EventHandler<int>? IssueChatRequested;
        /// <summary>Opens or focuses the Claude chat that created this Build Queue item.</summary>
        public event EventHandler<QueueItem>? QueueItemChatRequested;
        public event EventHandler<int>? EpicSubIssueClicked;
        public event EventHandler? FullGitRefreshRequested;
        private bool _isPinned = true;

        private int _refreshGeneration;
        private BuildTrackerApiClient? _api;
        private Services.QueueWatcherService? _watcher;
        private Services.BuildQueuePostgresClient? _db;
        private DispatcherTimer? _pollTimer;
        private List<QueueItem> _lastItems = new();
        private string _filter = "Active";
        private readonly HashSet<int> _manuallyHiddenQueueIds = new();
        private int? _selectedQueueItemId;
        private static readonly Dictionary<int, string> _issueTitleCache = new();
        private static readonly HashSet<int> _pendingFetches = new();

        private const double IssueRowTitleReserve = 50;
        private const double MinIssueRowTitleWidth = 24;
        private readonly List<TextBlock> _inFlightTitleBlocks = new();
        private readonly List<TextBlock> _sessionsTitleBlocks = new();

        // ── Visual DAG Graph Layout Constants (#860 Reference) ───────────────
        private const double QueueGraphLaneWidth = 18;
        private const double QueueGraphDotRadius = 5.5;
        private const double QueueGraphLeftPad = 12;

        private static readonly string[] QueueGraphLaneColors =
        {
            "#89B4FA", // blue
            "#A6E3A1", // green
            "#FAB387", // peach
            "#CBA6F7", // mauve
            "#F5C2E7", // pink
            "#94E2D5", // teal
            "#F38BA8", // red
            "#F9E2AF", // yellow
        };

        private static SolidColorBrush QueueLaneBrush(int column) =>
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(
                QueueGraphLaneColors[((column % QueueGraphLaneColors.Length) + QueueGraphLaneColors.Length) % QueueGraphLaneColors.Length]));

        private static double QueueLaneX(int column) => QueueGraphLeftPad + column * QueueGraphLaneWidth;

        private sealed class QueueGraphNode
        {
            public int Key;
            public string DisplayRef = "";
            public string Title = "";
            public string Status = "queued";
            public bool IsBlocked;
            public bool IsWaitingForInput;
            public List<int> BlockedBy = new();
            public QueueItem? Item;
            public MainWindow.PersistedQueueDisplayItem? RestartItem;
            public Border? CardElement;
            public int Row;
            public int Column;
            public double CenterY;
            /// <summary>Git build-set nesting — the `--buildSet <name>` value this item was queued
            /// with (QueueItem.BuildSet), or null when ungrouped. Drives header insertion in
            /// RenderQueue and the trunk-line break / cross-set edge styling in RedrawQueueGraph.</summary>
            public string? BuildSet;
        }

        private readonly List<QueueGraphNode> _currentGraphNodes = new();
        private int _currentMaxLanes = 1;

        private void ApplyTitleMaxWidths(ListBox listBox, List<TextBlock> registry)
        {
            var available = listBox.ActualWidth;
            foreach (var block in registry)
            {
                block.MaxWidth = Math.Max(MinIssueRowTitleWidth, available - IssueRowTitleReserve);
            }
        }

        private void InFlightIssuesList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
        }

        private void ActiveSessionsList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
        }

        public BuildQueuePanel() => InitializeComponent();

        /// <summary>Called once from MainWindow with the shared API client and optional direct-DB client.</summary>
        public void Initialize(BuildTrackerApiClient api, Services.QueueWatcherService? watcher = null, Services.BuildQueuePostgresClient? db = null)
        {
            _api = api;
            _watcher = watcher;
            _db = db;

            if (_watcher != null)
            {
                SyncPauseToggleVisual(_watcher.IsPaused);
                _watcher.PausedStateChanged += (paused) => Dispatcher.BeginInvoke(new Action(() => SyncPauseToggleVisual(paused)));
            }

            // Real, durable usage/cost tracking — refresh the badge the moment a build
            // actually completes a turn, from any thread (UsageTrackingService.Changed
            // fires off the recording thread, not the UI thread).
            Services.UsageTrackingService.Changed += () => Dispatcher.BeginInvoke(new Action(UpdateUsageSummary));

            // Sessions presence polling
            _sessionsPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _sessionsPollTimer.Tick += async (_, _) =>
            {
                await RefreshActiveSessionsAsync();
                UpdateUsageSummary();
                DevServerRollbackService.CheckForRollbacks(this);
            };
            _sessionsPollTimer.Start();
            _ = RefreshActiveSessionsAsync();
            UpdateUsageSummary();
            DevServerRollbackService.CheckForRollbacks(this);

            _ = RefreshInFlightIssuesAsync("initial load");

            if (!api.IsConfigured)
            {
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "Not connected — set apiBaseUrl/ingestToken in scripts\\build-queue-watcher.config.json (Settings tab has the path).";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _pollTimer.Tick += async (_, _) => await RefreshAsync();
            _pollTimer.Start();
            _ = RefreshAsync();
        }

        private DispatcherTimer? _sessionsPollTimer;
        private string? _lastSessionsSignature;
        private bool _sessionsRefreshInFlight;

        private async System.Threading.Tasks.Task RefreshActiveSessionsAsync()
        {
            if (_sessionsRefreshInFlight) return;
            _sessionsRefreshInFlight = true;
            try
            {
                List<Services.ClaudeAgentSession> sessions;
                try
                {
                    sessions = await Services.ClaudeAgentsService.ListActiveSessionsWithFallbackAsync();
                }
                catch
                {
                    return;
                }

                var signature = System.Text.Json.JsonSerializer.Serialize(sessions);
                if (signature == _lastSessionsSignature) return;
                _lastSessionsSignature = signature;

                SessionsCountText.Text = $"({sessions.Count})";

                _sessionsTitleBlocks.Clear();
                ActiveSessionsList.Items.Clear();
                if (sessions.Count == 0)
                {
                    ActiveSessionsList.Items.Add(new ListBoxItem { Content = "No active sessions.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                    return;
                }
                foreach (var s in sessions.OrderByDescending(s => s.StartedAt))
                {
                    var elapsed = DateTime.Now - s.StartedAt;
                    string elapsedStr = elapsed.TotalHours >= 1 ? $"{(int)elapsed.TotalHours}h {elapsed.Minutes}m" : $"{(int)elapsed.TotalMinutes}m";
                    var icon = s.Kind switch { "background" => "⚙", "untracked" => "❔", _ => "▶" };
                    var iconColor = s.Kind switch { "background" => "#8F8C88", "untracked" => "#8F8C88", _ => "#F2CA63" };

                    var panel = new StackPanel { Orientation = Orientation.Horizontal };
                    panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColor)), VerticalAlignment = VerticalAlignment.Center });
                    var textStack = new StackPanel();
                    string title = !string.IsNullOrWhiteSpace(s.Name) ? s.Name
                        : !string.IsNullOrWhiteSpace(s.SessionId) ? s.SessionId[..Math.Min(8, s.SessionId.Length)]
                        : $"claude.exe (untracked)";
                    var titleBlock = new TextBlock { Text = title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush"), TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis };
                    _sessionsTitleBlocks.Add(titleBlock);
                    textStack.Children.Add(titleBlock);
                    string subtitle = s.Kind == "untracked" ? $"PID {s.Pid}  ·  {elapsedStr} ago" : $"{s.Cwd}  ·  {elapsedStr} ago";
                    textStack.Children.Add(new TextBlock { Text = subtitle, FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
                    panel.Children.Add(textStack);

                    string tooltip = s.Kind == "untracked"
                        ? $"PID {s.Pid} · seen via Get-Process, not reported by claude agents --json"
                        : $"PID {s.Pid} · {s.Kind} · session {s.SessionId}";
                    if (s.WindowHandle != IntPtr.Zero) tooltip += " · click to bring its window forward";

                    var cm = new ContextMenu();
                    var miClose = new MenuItem { Header = "✕ Close Session" };
                    miClose.Click += (_, _) => CloseSession(s);
                    cm.Items.Add(miClose);

                    ActiveSessionsList.Items.Add(new ListBoxItem { Content = panel, Tag = s, ToolTip = tooltip, ContextMenu = cm, Cursor = s.WindowHandle != IntPtr.Zero ? System.Windows.Input.Cursors.Hand : System.Windows.Input.Cursors.Arrow });
                }
                ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
            }
            finally
            {
                _sessionsRefreshInFlight = false;
            }
        }

        private void CloseSession(Services.ClaudeAgentSession s)
        {
            try
            {
                using var proc = System.Diagnostics.Process.GetProcessById(s.Pid);
                proc.Kill(entireProcessTree: true);
                Services.ActivityLog.Log("sessions", $"Closed session: {(string.IsNullOrWhiteSpace(s.Name) ? $"PID {s.Pid}" : s.Name)}");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Close Session", $"Couldn't close session: {ex.Message}");
            }
            _ = RefreshActiveSessionsAsync();
        }

        private void ActiveSessionsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ActiveSessionsList.SelectedItem is ListBoxItem { Tag: Services.ClaudeAgentSession session })
            {
                Services.ClaudeAgentsService.BringToForeground(session.WindowHandle);
                ActiveSessionsList.SelectedItem = null;
            }
        }

        private string? _lastInFlightSignature;
        private List<Services.GitHubIssueSummary> _lastInFlightIssues = new();

        private async System.Threading.Tasks.Task RefreshInFlightIssuesAsync(string trigger)
        {
            List<Services.GitHubIssueSummary> issues;
            try { issues = await Services.GitHubIssuesService.ListOpenByLabelAsync("in-flight"); }
            catch { ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: gh CLI fetch FAILED"); return; }
            ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: {issues.Count} open in-flight issue(s) via gh CLI");

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastInFlightSignature) return;
            _lastInFlightSignature = signature;

            _lastInFlightIssues = issues;
            RenderInFlightGrouped(issues);
        }

        private void RenderInFlightGrouped(List<Services.GitHubIssueSummary> issues)
        {
            issues = ApplyIssueFocusFilter(issues);
            InFlightCountText.Text = $"({issues.Count})";

            _inFlightTitleBlocks.Clear();
            InFlightIssuesList.Items.Clear();
            if (issues.Count == 0)
            {
                InFlightIssuesList.Items.Add(new ListBoxItem { Content = "Nothing in-flight and still open.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            var grouped = issues.GroupBy(i => i.Parent?.Number ?? -1)
                                 .OrderByDescending(g => g.Max(i => i.UpdatedAt));
            foreach (var group in grouped)
            {
                string epicTitle = group.Key == -1 ? "No Epic" : (group.First().Parent!.Title);
                var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 2) };
                header.Children.Add(new TextBlock { Text = "◆ ", FontSize = 11, Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center });
                header.Children.Add(new TextBlock { Text = epicTitle, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"), TextWrapping = TextWrapping.Wrap });
                InFlightIssuesList.Items.Add(new ListBoxItem { Content = header, IsHitTestVisible = false, Focusable = false });

                foreach (var issue in group.OrderByDescending(i => i.UpdatedAt))
                {
                    InFlightIssuesList.Items.Add(BuildIssueRow(issue, "⏳", "#F2CA63", _inFlightTitleBlocks));
                }
            }
            ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
        }

        private static List<Services.GitHubIssueSummary> ApplyIssueFocusFilter(List<Services.GitHubIssueSummary> issues)
        {
            var focus = BuildConsole.Services.FocusModeService.Instance;
            return focus.IsActive
                ? issues.Where(i => focus.IsIssueInFocus(i.Number)).ToList()
                : issues;
        }

        private static ListBoxItem BuildIssueRow(Services.GitHubIssueSummary issue, string icon, string iconColorHex, List<TextBlock>? titleRegistry = null)
        {
            string localTime = issue.UpdatedAt.ToLocalTime().ToString("MMM d, h:mm tt");

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColorHex)), VerticalAlignment = VerticalAlignment.Center });
            var textStack = new StackPanel();
            var titleBlock = new TextBlock { Text = issue.Title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush") };
            if (titleRegistry != null)
            {
                titleBlock.TextWrapping = TextWrapping.NoWrap;
                titleBlock.TextTrimming = TextTrimming.CharacterEllipsis;
                titleRegistry.Add(titleBlock);
            }
            else
            {
                titleBlock.TextWrapping = TextWrapping.Wrap;
            }
            textStack.Children.Add(titleBlock);
            textStack.Children.Add(new TextBlock { Text = $"#{issue.Number}  ·  updated {localTime}", FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
            panel.Children.Add(textStack);
            return new ListBoxItem { Content = panel, ToolTip = issue.Url, Tag = issue.Number };
        }

        // ── Epic Issues Section ──────────────────────────────────────────────
        private int? _activeChatEpicId;
        private int? _activeChatEpicGithubNumber;
        private string? _activeChatEpicTitle;
        private List<GitHubSubIssue> _lastEpicIssues = new();
        private string _epicFilter = "Open";

        public async void SetActiveChatEpic(int? epicId, int? epicGithubNumber, string? epicTitle, bool force = false)
        {
            if (!force && epicId == _activeChatEpicId) return;
            _activeChatEpicId = epicId;
            _activeChatEpicGithubNumber = epicGithubNumber;
            _activeChatEpicTitle = epicTitle;

            if (epicId == null)
            {
                ChatEpicIssuesSection.Visibility = Visibility.Collapsed;
                return;
            }

            ChatEpicIssuesHeader.Text = $"ISSUES IN {epicTitle?.ToUpperInvariant() ?? "THIS EPIC"}";
            ChatEpicIssuesSection.Visibility = Visibility.Visible;
            _lastEpicIssues = new();
            ChatEpicIssuesList.Items.Clear();

            if (epicGithubNumber == null)
            {
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "This epic has no linked GitHub issue.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "Loading…", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });

            // ── Source 1: GitHub sub-issues REST API ─────────────────────────────
            // bypassCache: true — tab-switch is user-initiated; always go fresh so a
            // stale ETag (from when the epic had 0 sub-issues) can't return empty.
            List<GitHubSubIssue> ghIssues = new();
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                ghIssues = await client.GetSubIssuesAsync(epicGithubNumber.Value, bypassCache: true);
                ActivityLog.Log("build-queue-panel.epic", $"GitHub sub-issues #{epicGithubNumber}: {ghIssues.Count} returned ({ghIssues.Count(i => !IsRealClosed(i.State))} open, {ghIssues.Count(i => IsRealClosed(i.State))} closed).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log("build-queue-panel.epic", $"GitHub sub-issues #{epicGithubNumber} FAILED: {ex.Message} — will try internal BT fallback.");
            }

            if (_activeChatEpicId != epicId) return;

            // ── Source 2: Internal Build Tracker API (bt_issues.epic_id) ─────────
            // Issues are linked here when assigned via the Build Tracker UI, GitHub
            // Projects sync, or manual DB linkage — a separate system from GitHub's
            // sub-issues graph. Also covers issues whose body mentions "Part of #N"
            // that the Git Board renders as children via text inference but that are
            // NOT formal GitHub sub-issues (so Source 1 returns empty for them).
            List<IssueSummary> btIssues = new();
            if (_api?.IsConfigured == true)
            {
                try
                {
                    btIssues = await _api.GetIssuesForEpicAsync(epicId.Value);
                    ActivityLog.Log("build-queue-panel.epic", $"BT internal epicId={epicId}: {btIssues.Count} returned ({btIssues.Count(i => i.Status != "closed" && i.Status != "done")} open).");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("build-queue-panel.epic", $"BT internal epicId={epicId} FAILED: {ex.Message}");
                }
            }
            else
            {
                ActivityLog.Log("build-queue-panel.epic", $"BT internal API not configured — skipping fallback for epicId={epicId}.");
            }

            if (_activeChatEpicId != epicId) return;

            // ── Merge: start with GitHub list, add any BT issues not already there ─
            var issues = new List<GitHubSubIssue>(ghIssues);
            var seenNumbers = new HashSet<int>(ghIssues.Select(i => i.Number));
            foreach (var bti in btIssues)
            {
                if (!bti.GithubNumber.HasValue) continue;             // no GitHub number → can't display
                if (seenNumbers.Contains(bti.GithubNumber.Value)) continue; // already in GitHub list
                seenNumbers.Add(bti.GithubNumber.Value);
                issues.Add(new GitHubSubIssue
                {
                    Number  = bti.GithubNumber.Value,
                    Title   = bti.Title,
                    State   = (bti.Status == "done" || bti.Status == "closed") ? "closed" : "open",
                    HtmlUrl = bti.GithubUrl ?? "",
                });
            }
            ActivityLog.Log("build-queue-panel.epic", $"Merged total for epic #{epicGithubNumber} (id={epicId}): {issues.Count} issues ({issues.Count(i => !IsRealClosed(i.State))} open, {issues.Count(i => IsRealClosed(i.State))} closed). Filter={_epicFilter}.");

            if (_lastEpicIssues != null && _lastEpicIssues.Count > 0)
            {
                var newlyClosed = _lastEpicIssues
                    .Where(old => !IsRealClosed(old.State))
                    .Where(old => issues.Any(cur => cur.Number == old.Number && IsRealClosed(cur.State)))
                    .ToList();

                if (newlyClosed.Count > 0)
                {
                    int delayMs = 0;
                    foreach (var closedSub in newlyClosed)
                    {
                        int currentDelay = delayMs;
                        string label = $"#{closedSub.Number} {closedSub.Title}";
                        if (currentDelay == 0)
                        {
                            IssueChompAnimation.Play(null, label);
                        }
                        else
                        {
                            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(currentDelay) };
                            timer.Tick += (_, _) =>
                            {
                                timer.Stop();
                                IssueChompAnimation.Play(null, label);
                            };
                            timer.Start();
                        }
                        delayMs += 400;
                    }
                }
            }

            _lastEpicIssues = issues;
            RenderChatEpicIssues();
        }

        public async System.Threading.Tasks.Task RefreshActiveChatEpicIssuesAsync()
        {
            if (_activeChatEpicId.HasValue && _activeChatEpicGithubNumber.HasValue)
            {
                SetActiveChatEpic(_activeChatEpicId, _activeChatEpicGithubNumber, _activeChatEpicTitle, force: true);
            }
            await System.Threading.Tasks.Task.CompletedTask;
        }

        private static bool IsRealClosed(string? state) =>
            string.Equals(state, "closed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(state, "completed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(state, "done", StringComparison.OrdinalIgnoreCase);

        private void RenderChatEpicIssues()
        {
            ChatEpicIssuesList.Items.Clear();
            var filtered = _epicFilter switch
            {
                "Open"   => _lastEpicIssues.Where(i => !IsRealClosed(i.State)).ToList(),
                "Closed" => _lastEpicIssues.Where(i => IsRealClosed(i.State)).ToList(),
                _        => _lastEpicIssues
            };

            if (filtered.Count == 0)
            {
                string emptyLabel = _epicFilter switch
                {
                    "Open"   => "No open issues in this epic.",
                    "Closed" => "No closed issues in this epic.",
                    _        => "No issues in this epic."
                };
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = emptyLabel, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            foreach (var issue in filtered)
            {
                bool closed = IsRealClosed(issue.State);
                var panel = new Grid { Margin = new Thickness(0, 2, 0, 2) };
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

                var iconBlock = new TextBlock
                {
                    Text = closed ? "✅ " : "⏳ ",
                    FontSize = 12,
                    Foreground = closed ? (Brush)Application.Current.FindResource("GreenBrush") : (Brush)Application.Current.FindResource("YellowBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, 4, 0)
                };
                Grid.SetColumn(iconBlock, 0);
                panel.Children.Add(iconBlock);

                var titleBlock = new TextBlock
                {
                    Text = $"#{issue.Number} {issue.Title}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(titleBlock, 1);
                panel.Children.Add(titleBlock);
                var lbi = new ListBoxItem
                {
                    Content = panel,
                    ToolTip = $"#{issue.Number} — Click to open details side-by-side with chat",
                    Cursor = Cursors.Hand
                };
                int capturedNum = issue.Number;
                lbi.PreviewMouseLeftButtonUp += (s, e) =>
                {
                    EpicSubIssueClicked?.Invoke(this, capturedNum);
                };
                ChatEpicIssuesList.Items.Add(lbi);
            }
        }

        private void EpicFilterChip_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not ToggleButton clicked) return;
            foreach (var chip in new[] { ChipEpicAll, ChipEpicOpen, ChipEpicClosed })
            {
                chip.IsChecked = chip == clicked;
            }
            _epicFilter = clicked.Tag as string ?? "Open";
            ActivityLog.Log("build-queue-panel.epic-filter", $"epic issues filter -> {_epicFilter}");
            RenderChatEpicIssues();
        }

        private string? _lastQueueSignature;
        private string? _lastRestartGroupSignature;
        private bool _queueIsStale;
        private DateTime? _queueCachedAtUtc;

        private Dictionary<int, int> _downstreamBlockCounts = new();
        private int _maxDownstreamBlockCount;

        private static Dictionary<int, int> ComputeDownstreamBlockCounts(List<QueueItem> items)
        {
            var directDependents = new Dictionary<int, List<QueueItem>>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                foreach (var b in blockers)
                {
                    if (b == 0 || b == item.GithubNumber) continue;
                    if (!directDependents.TryGetValue(b, out var list)) { list = new List<QueueItem>(); directDependents[b] = list; }
                    list.Add(item);
                }
            }

            var counts = new Dictionary<int, int>();
            foreach (var item in items)
            {
                if (!item.GithubNumber.HasValue) { counts[item.Id] = 0; continue; }

                var seenIds = new HashSet<int> { item.Id };
                var expandedNumbers = new HashSet<int>();
                var frontier = new Queue<int>();
                frontier.Enqueue(item.GithubNumber.Value);
                int count = 0;
                while (frontier.Count > 0)
                {
                    int num = frontier.Dequeue();
                    if (!expandedNumbers.Add(num)) continue;
                    if (!directDependents.TryGetValue(num, out var deps)) continue;
                    foreach (var dep in deps)
                    {
                        if (!seenIds.Add(dep.Id)) continue;
                        count++;
                        if (dep.GithubNumber.HasValue) frontier.Enqueue(dep.GithubNumber.Value);
                    }
                }
                counts[item.Id] = count;
            }
            return counts;
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_api == null || !_api.IsConfigured) return;
            int myGeneration = ++_refreshGeneration;
            try
            {
                if (_db != null)
                {
                    _lastItems = await _db.GetQueueAsync();
                    _queueIsStale = false;
                    _queueCachedAtUtc = null;
                }
                else
                {
                    var result = await _api.GetQueueCachedAsync();
                    _lastItems = result.Data;
                    _queueIsStale = result.IsStale;
                    _queueCachedAtUtc = result.CachedAtUtc;
                }
                if (myGeneration != _refreshGeneration) return;
                BuildConsole.Services.NotGitNumberRegistry.SyncFromQueue(_lastItems);

                string restartSignature;
                try { restartSignature = System.Text.Json.JsonSerializer.Serialize(MainWindow.GetPersistedQueueDisplayItems()); }
                catch { restartSignature = ""; }

                var signature = _queueIsStale + "|" + System.Text.Json.JsonSerializer.Serialize(_lastItems) + "|" + restartSignature;
                if (signature != _lastQueueSignature)
                {
                    _lastQueueSignature = signature;
                    if (_filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
                }
                if (_filter == "Tests") RenderTestsTree();
                UpdateUsageSummary();
                UpdateOrphanRecoveryBanner();
                SyncError?.Invoke(this, _queueIsStale
                    ? $"Build Queue: showing cached data from {_queueCachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
                TriggerBackgroundIssueTitleQueries();
            }
            catch (Exception ex)
            {
                if (myGeneration != _refreshGeneration) return;
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = $"Couldn't reach the API: {ex.Message}";
                QueueEmptyText.Visibility = Visibility.Visible;
                SyncError?.Invoke(this, $"Build Queue: {ex.Message}");
            }
        }

        /// <summary>
        /// Crash/orphan recovery — shows/hides the bulk "Recover All" banner based on
        /// how many rows the startup sweep (RecoverOrphanedRunningItemsAsync) marked
        /// failed with the orphan sentinel exit code -2. Called after every RefreshAsync.
        /// </summary>
        private void UpdateOrphanRecoveryBanner()
        {
            if (OrphanRecoveryBanner == null) return;
            int count = _lastItems.Count(i => i.Status == "failed" && i.ExitCode == -2);
            if (count == 0)
            {
                OrphanRecoveryBanner.Visibility = Visibility.Collapsed;
                return;
            }
            int resumable = _lastItems.Count(i => i.Status == "failed" && i.ExitCode == -2 && !string.IsNullOrEmpty(i.SessionId));
            OrphanRecoveryText.Text = $"{count} build{(count == 1 ? "" : "s")} orphaned by a crash/restart" +
                (resumable > 0 ? $" ({resumable} resumable)" : "");
            OrphanRecoveryBanner.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// Recovers every currently-orphaned queue item in one click: Resume Session
        /// (--resume, picks up mid-conversation) for any with a captured session id,
        /// plain Retry (restart the original prompt) for the rest. Mirrors exactly what
        /// the per-item "Resume Session"/"Retry" menu actions do, just for all of them
        /// at once — the actual ask behind this feature: Shane's video-driver hard
        /// crash left a whole batch of builds stuck, and recovering them one right-click
        /// at a time was its own separate mess.
        /// </summary>
        private async void BtnRecoverOrphans_Click(object sender, RoutedEventArgs e)
        {
            if (_db == null) return;
            var orphaned = _lastItems.Where(i => i.Status == "failed" && i.ExitCode == -2).ToList();
            if (orphaned.Count == 0) return;

            BtnRecoverOrphans.IsEnabled = false;
            int resumed = 0, retried = 0, failed = 0;
            try
            {
                foreach (var item in orphaned)
                {
                    try
                    {
                        var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                        string? resumeSessionId = string.IsNullOrEmpty(item.SessionId) ? null : item.SessionId;
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, resumeSessionId, item.ChatUrl, buildSet: item.BuildSet, account: item.Account);
                        if (resumeSessionId != null) resumed++; else retried++;
                    }
                    catch (Exception ex)
                    {
                        failed++;
                        ActivityLog.Log("build-queue", $"Recover All: couldn't re-queue orphaned item #{item.Id} ({item.Title}): {ex.Message}");
                    }
                }
            }
            finally
            {
                BtnRecoverOrphans.IsEnabled = true;
            }

            string summary = $"{resumed} resumed, {retried} restarted" + (failed > 0 ? $", {failed} failed" : "");
            if (failed > 0) ToastEngine.Warning("Recovered Builds", summary);
            else ToastEngine.Success("Recovered Builds", summary);
            ActivityLog.Log("build-queue", $"Recover All: {summary} (of {orphaned.Count} orphaned).");
            await RefreshAsync();
        }

        /// <summary>
        /// Right-click "Mark All Recovered (Dismiss)" — for when Shane doesn't want to
        /// re-queue anything for a given orphaned batch, just wants the warning gone.
        /// Marks each one done (exit 0) via the same MarkCompleteAsync the per-item
        /// "Mark Complete (Hide)" action uses, which is what actually clears the banner
        /// (UpdateOrphanRecoveryBanner counts by ExitCode == -2, not by the hidden-id
        /// set) — a genuine "yes, I've handled this" rather than only hiding it.
        /// </summary>
        private async void DismissAllOrphans_Click(object sender, RoutedEventArgs e)
        {
            if (_db == null) return;
            var orphaned = _lastItems.Where(i => i.Status == "failed" && i.ExitCode == -2).ToList();
            if (orphaned.Count == 0) return;

            int dismissed = 0, failed = 0;
            foreach (var item in orphaned)
            {
                try
                {
                    await _db.MarkCompleteAsync(item.Id, 0);
                    _manuallyHiddenQueueIds.Add(item.Id);
                    dismissed++;
                }
                catch (Exception ex)
                {
                    failed++;
                    ActivityLog.Log("build-queue", $"Dismiss All Orphans: couldn't mark #{item.Id} ({item.Title}) recovered: {ex.Message}");
                }
            }

            string summary = $"{dismissed} marked recovered" + (failed > 0 ? $", {failed} failed" : "");
            if (failed > 0) ToastEngine.Warning("Marked Recovered", summary);
            else ToastEngine.Success("Marked Recovered", summary);
            ActivityLog.Log("build-queue", $"Dismiss All Orphans: {summary} (of {orphaned.Count}).");
            await RefreshAsync();
        }

        private static string FormatTokens(long tokens) =>
            tokens >= 1_000_000 ? $"{tokens / 1_000_000.0:0.1}M tokens" :
            tokens >= 1_000 ? $"{tokens / 1_000.0:0}k tokens" :
            $"{tokens} tokens";

        /// <summary>
        /// Refreshes the header badge. Shane: "The Tokens and cost is also not
        /// updating with the 4 builds running right now" — a regression from switching
        /// the badge to ONLY the persisted "this session" totals (which only advance
        /// when a build actually finishes a turn and reports its real
        /// total_cost_usd/usage), so a build that's been actively streaming but hasn't
        /// completed a turn yet looked frozen. Fixed by showing whichever is actually
        /// live right now: while any build is running, the badge shows the real-time
        /// in-progress estimate from GetActiveUsageSummary (updates continuously as
        /// context grows, exactly like before); once nothing is running it falls back
        /// to the persisted "this session" total instead of blanking to zero — the
        /// original "should persist" ask. Either way, clicking still opens the full
        /// This-Session/All-Time breakdown popup.
        /// </summary>
        public void UpdateUsageSummary()
        {
            var snap = Services.UsageTrackingService.GetSnapshot();
            var (activeTokens, activeCost, active) = _watcher?.GetActiveUsageSummary() ?? (0, 0, 0);

            if (active > 0)
            {
                QueueTokensText.Text = FormatTokens(activeTokens);
                QueueCostText.Text = $" · ~${activeCost:0.00}";
            }
            else
            {
                QueueTokensText.Text = FormatTokens(snap.SessionTokens);
                QueueCostText.Text = $" · ~${snap.SessionCostUsd:0.00}";
            }
            QueueActiveSlotsText.Text = $" ({active} active)";

            if (UsageBreakdownPopup?.IsOpen == true) RenderUsageBreakdown(snap);
        }

        private void RenderUsageBreakdown(Services.UsageTrackingService.Snapshot snap)
        {
            UsageSessionTokensText.Text = FormatTokens(snap.SessionTokens);
            UsageSessionCostText.Text = $"${snap.SessionCostUsd:0.00}";
            UsageSessionBuildsText.Text = $"{snap.SessionBuilds} build{(snap.SessionBuilds == 1 ? "" : "s")} this session";

            UsageTotalTokensText.Text = FormatTokens(snap.TotalTokens);
            UsageTotalCostText.Text = $"${snap.TotalCostUsd:0.00}";
            UsageTotalBuildsText.Text = $"{snap.TotalBuilds} build{(snap.TotalBuilds == 1 ? "" : "s")} all-time";
        }

        private void ActiveUsageBorder_Click(object sender, MouseButtonEventArgs e)
        {
            RenderUsageBreakdown(Services.UsageTrackingService.GetSnapshot());
            UsageBreakdownPopup.IsOpen = !UsageBreakdownPopup.IsOpen;
        }

        private List<QueueItem> ApplyFilter(List<QueueItem> items) => _filter switch
        {
            // Git #1469 — "verifying" (session done, real GitHub issue not yet closed)
            // stays visible here too, not archived into Done — that's the whole point.
            "Active"   => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or "running" or Services.SessionLimitAutoRestartService.LimitPausedStatus or BuildQueuePostgresClient.VerifyingStatus)).ToList(),
            "Done"     => items.Where(i => i.Status == "done" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            "Canceled" => items.Where(i => i.Status == "canceled" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            _          => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
        };

        public bool HasActiveQueueItems =>
            _lastItems.Any(i => i.Status is "queued" or "running");

        public IReadOnlyList<QueueItem> CurrentQueueItems => _lastItems;

        public void ReapplyFocusFilter()
        {
            try { if (QueueGraphContainer != null && _filter != "Tests") RenderQueue(ApplyFilter(_lastItems)); } catch { }
            try { RenderInFlightGrouped(_lastInFlightIssues); } catch { }
        }

        public void RevealQueueItem(int id)
        {
            var item = _lastItems.FirstOrDefault(i => i.Id == id);
            if (item == null) return;

            string targetFilter = item.Status switch
            {
                "queued" or "running" or Services.SessionLimitAutoRestartService.LimitPausedStatus or BuildQueuePostgresClient.VerifyingStatus => "Active",
                "done"                => "Done",
                "canceled"            => "Canceled",
                _                     => "All",
            };

            ComboBoxItem? match = null;
            if (QueueFilterCombo != null)
            {
                foreach (var obj in QueueFilterCombo.Items)
                    if (obj is ComboBoxItem ci && (ci.Tag as string) == targetFilter) { match = ci; break; }
            }
            if (match != null && !ReferenceEquals(QueueFilterCombo!.SelectedItem, match))
                QueueFilterCombo.SelectedItem = match;
            else
                _filter = targetFilter;

            if (QueueSearchBox != null && !string.IsNullOrEmpty(QueueSearchBox.Text))
                QueueSearchBox.Text = "";
            else if (QueueGraphContainer != null && _filter != "Tests")
                RenderQueue(ApplyFilter(_lastItems));

            var node = _currentGraphNodes.FirstOrDefault(n => n.Item?.Id == id);
            if (node != null)
            {
                SelectNode(node);
                node.CardElement?.BringIntoView();
            }
        }

        private void QueueFilterCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (QueueFilterCombo.SelectedItem is not ComboBoxItem selected) return;
            _filter = selected.Tag as string ?? "Active";
            if (QueueGraphContainer == null) return;

            if (_filter == "Tests") RenderTestsTree();
            else RenderQueue(ApplyFilter(_lastItems));
        }

        private string _queueSearch = "";

        private void QueueSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _queueSearch = QueueSearchBox.Text ?? "";
            if (QueueGraphContainer == null || _filter == "Tests") return;
            RenderQueue(ApplyFilter(_lastItems));
        }

        private static List<QueueItem> SortForDisplay(IEnumerable<QueueItem> items) =>
            items
                .OrderByDescending(i => i.GithubNumber.HasValue)
                .ThenByDescending(i => i.GithubNumber ?? 0)
                .ThenByDescending(i => i.Id)
                .ToList();

        // Local (--notGit) builds are stored as a negative github_number; render them by
        // their LETTER id (local #A, local #AB) so they can never be read as a GitHub number.
        private static string FormatIssueRef(int n) => BuildConsole.Services.LocalBuildId.FormatRef(n);

        /// <summary>
        /// Reorders nodes (already in SortForDisplay's preferred order) so every
        /// blocker renders BEFORE its dependents, with each node's direct dependents
        /// placed immediately after it (a DFS, not a plain topological sort) — the
        /// "nested under whatever blocks it" shape Shane described. A node blocked by
        /// several present keys nests under the first one it lists; the rest still get
        /// real connector lines drawn to them (RedrawQueueGraph iterates ALL of
        /// BlockedBy, not just the one used for placement). Root-level items (no
        /// blocker present in this set) keep SortForDisplay's relative order, forming
        /// the trunk sequence. Guards against a blocking cycle (shouldn't happen, but
        /// two items can't be relied on to never reference each other) by tracking
        /// visited keys and appending any leftover nodes rather than recursing forever.
        /// </summary>
        private static List<QueueGraphNode> OrderByDependency(List<QueueGraphNode> nodesInPreferredOrder)
        {
            var byKey = new Dictionary<int, QueueGraphNode>();
            foreach (var n in nodesInPreferredOrder) byKey.TryAdd(n.Key, n);

            var childrenOf = new Dictionary<int, List<QueueGraphNode>>();
            var hasParent = new HashSet<int>();
            foreach (var n in nodesInPreferredOrder)
            {
                int? parentKey = null;
                foreach (var b in n.BlockedBy) { if (byKey.ContainsKey(b)) { parentKey = b; break; } }
                if (parentKey == null) continue;
                hasParent.Add(n.Key);
                if (!childrenOf.TryGetValue(parentKey.Value, out var kids)) { kids = new List<QueueGraphNode>(); childrenOf[parentKey.Value] = kids; }
                kids.Add(n);
            }

            var visited = new HashSet<int>();
            var ordered = new List<QueueGraphNode>();
            void Visit(QueueGraphNode node)
            {
                if (!visited.Add(node.Key)) return;
                ordered.Add(node);
                if (childrenOf.TryGetValue(node.Key, out var kids))
                    foreach (var kid in kids) Visit(kid);
            }

            foreach (var n in nodesInPreferredOrder)
                if (!hasParent.Contains(n.Key)) Visit(n);
            foreach (var n in nodesInPreferredOrder) // cycle safety net — shouldn't fire in practice
                if (!visited.Contains(n.Key)) Visit(n);

            return ordered;
        }

        // ══════════════════════════════════════════════════════════════════════════
        // ── Visual Queue DAG with Canvas-Based Connectors (#860 Reference) ────────
        // ══════════════════════════════════════════════════════════════════════════

        private void RenderQueue(List<QueueItem> items)
        {
            var search = _queueSearch.Trim();
            bool searching = search.Length > 0;
            if (searching)
            {
                items = items
                    .Where(i => i.GithubNumber.HasValue &&
                                i.GithubNumber.Value.ToString().Contains(search))
                    .ToList();
            }

            QueueGraphContainer.Visibility = Visibility.Visible;
            QueueCardsHost.Children.Clear();
            _currentGraphNodes.Clear();

            if (_queueIsStale)
            {
                var staleBanner = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x33, 0xFA, 0xB3, 0x87)),
                    BorderBrush = (Brush)Application.Current.FindResource("PeachBrush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(8, 4, 8, 4),
                    Margin = new Thickness(0, 0, 0, 6)
                };
                staleBanner.Child = new TextBlock
                {
                    Text = $"⚠ Offline — showing cached queue from {_queueCachedAtUtc?.ToLocalTime():MMM d, h:mm tt}",
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
                    TextWrapping = TextWrapping.Wrap
                };
                QueueCardsHost.Children.Add(staleBanner);
            }

            List<MainWindow.PersistedQueueDisplayItem> pendingRestart;
            try { pendingRestart = MainWindow.GetPersistedQueueDisplayItems(); }
            catch { pendingRestart = new(); }

            var restartRenderSignature = System.Text.Json.JsonSerializer.Serialize(
                pendingRestart.Select(p => new { p.Title, p.GithubNumber }));
            if (restartRenderSignature != _lastRestartGroupSignature)
            {
                _lastRestartGroupSignature = restartRenderSignature;
                MainWindow.LogQueuedForRestartRender(pendingRestart.Count);
            }

            foreach (var p in pendingRestart)
            {
                int key = p.GithubNumber ?? -(Math.Abs(p.Title.GetHashCode()));
                _currentGraphNodes.Add(new QueueGraphNode
                {
                    Key = key,
                    DisplayRef = p.GithubNumber.HasValue ? FormatIssueRef(p.GithubNumber.Value) : "restart",
                    Title = p.Title,
                    Status = "restart",
                    RestartItem = p
                });
            }

            _downstreamBlockCounts = ComputeDownstreamBlockCounts(items);
            _maxDownstreamBlockCount = _downstreamBlockCounts.Count > 0 ? _downstreamBlockCounts.Values.Max() : 0;

            var itemNodes = new List<QueueGraphNode>();
            foreach (var item in SortForDisplay(items))
            {
                var interactiveState = _watcher?.GetInteractiveState(item.Id);
                bool isWaitingForInput = interactiveState == InteractiveInputState.WaitingForInput;
                var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                var cleanBlockers = blockerList.Where(b => b != 0 && b != item.GithubNumber).ToList();

                int key = item.GithubNumber ?? item.Id;
                itemNodes.Add(new QueueGraphNode
                {
                    Key = key,
                    DisplayRef = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : $"#{item.Id}",
                    Title = item.Title,
                    Status = item.Status,
                    IsBlocked = cleanBlockers.Count > 0 && item.Status == "queued",
                    IsWaitingForInput = isWaitingForInput,
                    BlockedBy = cleanBlockers,
                    Item = item,
                    BuildSet = string.IsNullOrWhiteSpace(item.BuildSet) ? null : item.BuildSet.Trim()
                });
            }
            // Git-style shape fix — Shane: "Blocked ends up showing above the thing
            // it's blocked [by]... I would think this would be nested under whatever
            // blocks it." SortForDisplay's plain "newest number first" order had no
            // relationship to blocking at all, so a blocked item could land anywhere
            // relative to its blocker, including above it. OrderByDependency reorders
            // (stably, preserving SortForDisplay as the sibling/root order) so a
            // blocker always renders before — and its direct dependents immediately
            // after — it, recursively; a node blocked by several others nests under
            // whichever one it encounters first and still draws real connector lines
            // to the rest (see the BlockedBy loop in RedrawQueueGraph, unchanged).
            //
            // Build-set nesting: ungrouped items (BuildSet == null) keep exactly the
            // behavior above — one OrderByDependency pass over the whole ungrouped set,
            // rendered first. Items sharing a real --buildSet name are pulled out into
            // their own contiguous block per set (first-seen order), each ordered by
            // OrderByDependency independently so blocked-nesting still works WITHIN a
            // set. A group header card is inserted ahead of each block below (step 5).
            // A node blocked by something in a DIFFERENT set still draws a real
            // connector to it (RedrawQueueGraph iterates BlockedBy globally, not
            // per-group) — that edge is styled distinctly to flag the boundary crossing.
            var ungroupedNodes = itemNodes.Where(n => n.BuildSet == null).ToList();
            var buildSetOrder = new List<string>();
            var buildSetBuckets = new Dictionary<string, List<QueueGraphNode>>();
            foreach (var n in itemNodes)
            {
                if (n.BuildSet == null) continue;
                if (!buildSetBuckets.TryGetValue(n.BuildSet, out var bucket))
                {
                    bucket = new List<QueueGraphNode>();
                    buildSetBuckets[n.BuildSet] = bucket;
                    buildSetOrder.Add(n.BuildSet);
                }
                bucket.Add(n);
            }

            _currentGraphNodes.AddRange(OrderByDependency(ungroupedNodes));
            foreach (var setName in buildSetOrder)
                _currentGraphNodes.AddRange(OrderByDependency(buildSetBuckets[setName]));

            QueueEmptyText.Visibility = _currentGraphNodes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = searching
                ? $"No queued item matches #{search}."
                : _filter switch
                {
                    "Active"   => "Nothing queued or running.",
                    "Done"     => "Nothing done yet.",
                    "Canceled" => "Nothing canceled.",
                    _          => "Queue is empty.",
                };

            if (_currentGraphNodes.Count == 0)
            {
                QueueGraphCanvas.Children.Clear();
                UpdateCritterLoungeVisibility();
                return;
            }

            // ── 4. Swimlane Allocation DAG Algorithm (#860, reworked) ──
            // Nodes now arrive parent-before-child (OrderByDependency above), so by the
            // time a node is processed its blocker's column is already known — no more
            // "reserve this lane for a key I haven't seen yet" trick the old top-down
            // algorithm needed. Root/unblocked items always land in lane 0 and STAY
            // there (TrunkOwner never gets displaced), which is what makes lane 0 the
            // continuous main trunk RedrawQueueGraph draws a solid green line through.
            // A blocked node either continues straight down its (single, first) parent's
            // lane — if it's the first child to claim it — or branches into a fresh lane
            // when a sibling already has (a fork, multiple items freed by one blocker).
            const int TrunkOwner = int.MinValue;
            var lanes = new List<int?> { TrunkOwner };
            var columnByKey = new Dictionary<int, int>();
            int maxLaneCount = 1;
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                node.Row = i;

                int? parentKey = null;
                foreach (var b in node.BlockedBy) { if (columnByKey.ContainsKey(b)) { parentKey = b; break; } }

                int col;
                if (parentKey == null)
                {
                    col = 0;
                    lanes[0] = TrunkOwner;
                }
                else
                {
                    int parentCol = columnByKey[parentKey.Value];
                    col = (parentCol < lanes.Count && lanes[parentCol] == parentKey.Value)
                        ? parentCol
                        : lanes.FindIndex(k => k == null);
                    if (col < 0) { lanes.Add(null); col = lanes.Count - 1; }
                    lanes[col] = node.Key;
                }

                node.Column = col;
                columnByKey[node.Key] = col;

                while (lanes.Count > 1 && lanes[lanes.Count - 1] == null) lanes.RemoveAt(lanes.Count - 1);
                maxLaneCount = Math.Max(maxLaneCount, Math.Max(lanes.Count, col + 1));
            }
            _currentMaxLanes = Math.Max(maxLaneCount, 1);

            // ── 5. Build Cards for QueueCardsHost ──
            // Group headers: _currentGraphNodes is now [restart pseudo-nodes]
            // [ungrouped items][buildSet A items][buildSet B items]... (see step 4
            // above), so a header only needs to fire once per transition INTO a
            // non-null BuildSet — restart/ungrouped nodes never re-trigger it.
            string? lastRenderedSet = null;
            StackPanel? currentSetPanel = null;
            foreach (var node in _currentGraphNodes)
            {
                if (node.BuildSet != lastRenderedSet)
                {
                    if (node.BuildSet != null)
                    {
                        var setContainer = new Border
                        {
                            BorderBrush = (Brush)Application.Current.FindResource("MauveBrush"),
                            BorderThickness = new Thickness(1),
                            CornerRadius = new CornerRadius(6),
                            Background = new SolidColorBrush(Color.FromArgb(0x0A, 0xCB, 0xA6, 0xF7)),
                            Margin = new Thickness(0, 8, 0, 8),
                            Padding = new Thickness(8, 6, 8, 6),
                            HorizontalAlignment = HorizontalAlignment.Stretch
                        };
                        var setPanel = new StackPanel { Orientation = Orientation.Vertical };
                        setContainer.Child = setPanel;

                        var accentBrush = GetBuildSetBrush(node.BuildSet);
                        var headerLabel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 2, 2, 6) };
                        headerLabel.Children.Add(new TextBlock
                        {
                            Text = "▤ ",
                            FontSize = 11,
                            Foreground = accentBrush,
                            VerticalAlignment = VerticalAlignment.Center
                        });
                        headerLabel.Children.Add(new TextBlock
                        {
                            Text = node.BuildSet.ToUpper(),
                            FontSize = 11,
                            FontWeight = FontWeights.Bold,
                            Foreground = accentBrush,
                            VerticalAlignment = VerticalAlignment.Center,
                            ToolTip = $"Build Set \"{node.BuildSet}\" — merges + restarts together as one wave"
                        });
                        setPanel.Children.Add(headerLabel);

                        QueueCardsHost.Children.Add(setContainer);
                        currentSetPanel = setPanel;
                    }
                    else
                    {
                        currentSetPanel = null;
                    }
                    lastRenderedSet = node.BuildSet;
                }

                Border? cardElement = null;
                if (node.Status == "restart" && node.RestartItem != null)
                {
                    cardElement = BuildRestartCard(node.RestartItem);
                }
                else if (node.Item != null)
                {
                    cardElement = BuildQueueCard(node);
                }

                if (cardElement != null)
                {
                    node.CardElement = cardElement;
                    if (currentSetPanel != null)
                    {
                        cardElement.Margin = new Thickness(0, 2, 0, 2);
                        currentSetPanel.Children.Add(cardElement);
                    }
                    else
                    {
                        QueueCardsHost.Children.Add(cardElement);
                    }
                }
            }

            // ── 6. Trigger Canvas Redraw on Layout ──
            Dispatcher.InvokeAsync(RedrawQueueGraph, DispatcherPriority.Loaded);
            UpdateCritterLoungeVisibility();
        }

        private void QueueCardsHost_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            RedrawQueueGraph();
        }

        private void QueueGraphScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (sender is ScrollViewer scrollViewer)
            {
                bool isAtBottom = scrollViewer.VerticalOffset >= scrollViewer.ScrollableHeight;
                bool isAtTop = scrollViewer.VerticalOffset <= 0;

                if ((e.Delta < 0 && isAtBottom) || (e.Delta > 0 && isAtTop))
                {
                    e.Handled = true;
                    var eventArg = new MouseWheelEventArgs(e.MouseDevice, e.Timestamp, e.Delta)
                    {
                        RoutedEvent = UIElement.MouseWheelEvent,
                        Source = scrollViewer
                    };
                    var parent = scrollViewer.Parent as UIElement;
                    parent?.RaiseEvent(eventArg);
                }
            }
        }

        private void RedrawQueueGraph()
        {
            if (QueueGraphCanvas == null || _currentGraphNodes.Count == 0)
            {
                if (QueueGraphCanvas != null) QueueGraphCanvas.Children.Clear();
                return;
            }

            QueueGraphCanvas.Children.Clear();

            double graphWidth = QueueGraphLeftPad + _currentMaxLanes * QueueGraphLaneWidth + 4;
            QueueGraphCanvas.Width = graphWidth;
            if (GraphColumn != null) GraphColumn.Width = new GridLength(graphWidth);

            var byKey = new Dictionary<int, QueueGraphNode>();
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                byKey[node.Key] = node;

                if (node.CardElement != null && node.CardElement.IsLoaded && node.CardElement.ActualHeight > 0)
                {
                    try
                    {
                        var pt = node.CardElement.TranslatePoint(new Point(0, node.CardElement.ActualHeight / 2), QueueGraphCanvas);
                        node.CenterY = pt.Y;
                    }
                    catch
                    {
                        node.CenterY = i * 62.0 + 31.0;
                    }
                }
                else
                {
                    node.CenterY = i * 62.0 + 31.0;
                }
            }

            double totalHeight = Math.Max(QueueCardsHost.ActualHeight, _currentGraphNodes.Count * 62.0);
            QueueGraphCanvas.Height = totalHeight;

            // 1. Draw Connectors & Curves first
            // Shane: "Anything without a connection just has a trailing circle at the
            // left of it with no line to anything... I would think this would be a
            // green connection line." Unblocked/root items had no vertical connector
            // at all before (the BlockedBy loop below only fires when BlockedBy is
            // non-empty) — they just floated. Every root now connects to the PREVIOUS
            // root's dot with a solid green line, forming one continuous trunk down
            // lane 0 (git log's main-branch line), and its horizontal branch line to
            // the card is green too instead of the lane-cycled color.
            var trunkGreen = (Brush)Application.Current.FindResource("GreenBrush");
            QueueGraphNode? lastTrunkNode = null;
            foreach (var node in _currentGraphNodes)
            {
                double cx = QueueLaneX(node.Column);
                double cy = node.CenterY;
                bool isTrunk = node.BlockedBy.Count == 0;
                var laneBrush = isTrunk ? trunkGreen : QueueLaneBrush(node.Column);

                var branchLine = new System.Windows.Shapes.Line
                {
                    X1 = cx,
                    Y1 = cy,
                    X2 = graphWidth - 2,
                    Y2 = cy,
                    Stroke = laneBrush,
                    StrokeThickness = 1.5,
                    StrokeDashArray = node.IsBlocked ? new DoubleCollection { 2.5, 2 } : null
                };
                QueueGraphCanvas.Children.Add(branchLine);

                if (isTrunk)
                {
                    // Build-set nesting: don't draw the trunk connector across a group
                    // header — a header sitting between two trunk nodes means they're in
                    // different sets (or one is grouped, one isn't), which should read as
                    // separate sequences, not one continuous line running through the header.
                    if (lastTrunkNode != null && lastTrunkNode.BuildSet == node.BuildSet)
                    {
                        QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                        {
                            X1 = cx, Y1 = lastTrunkNode.CenterY,
                            X2 = cx, Y2 = cy,
                            Stroke = trunkGreen,
                            StrokeThickness = 2.0
                        });
                    }
                    lastTrunkNode = node;
                }

                for (int bi = 0; bi < node.BlockedBy.Count; bi++)
                {
                    int bKey = node.BlockedBy[bi];
                    if (byKey.TryGetValue(bKey, out var parentNode))
                    {
                        double px = QueueLaneX(parentNode.Column);
                        double py = parentNode.CenterY;
                        Brush edgeBrush = QueueLaneBrush(bi == 0 ? node.Column : parentNode.Column);
                        // A real dependency that crosses a group boundary (blocker in a
                        // different --buildSet, or one grouped/one not) still gets a real
                        // connector — just flagged distinctly (mauve + dashed) so it reads
                        // as "reaches outside its own group" rather than an ordinary
                        // same-set edge.
                        bool crossesGroup = parentNode.BuildSet != node.BuildSet;
                        if (crossesGroup) edgeBrush = (Brush)Application.Current.FindResource("MauveBrush");
                        var edgeDash = crossesGroup ? new DoubleCollection { 4, 2 } : null;

                        if (Math.Abs(px - cx) < 0.5)
                        {
                            QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                            {
                                X1 = cx, Y1 = cy,
                                X2 = px, Y2 = py,
                                Stroke = edgeBrush,
                                StrokeThickness = 2.0,
                                StrokeDashArray = edgeDash
                            });
                        }
                        else
                        {
                            double midY = (cy + py) / 2.0;
                            var fig = new PathFigure { StartPoint = new Point(cx, cy) };
                            fig.Segments.Add(new BezierSegment(new Point(cx, midY), new Point(px, midY), new Point(px, py), true));
                            var geo = new PathGeometry();
                            geo.Figures.Add(fig);
                            QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Path
                            {
                                Data = geo,
                                Stroke = edgeBrush,
                                StrokeThickness = 2.0,
                                StrokeDashArray = edgeDash
                            });
                        }
                    }
                    else
                    {
                        QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                        {
                            X1 = cx, Y1 = cy,
                            X2 = cx, Y2 = Math.Max(0, cy - 18),
                            Stroke = laneBrush,
                            StrokeThickness = 1.8,
                            StrokeDashArray = new DoubleCollection { 3, 2 }
                        });
                    }
                }
            }

            // 2. Draw Node Dots on top of lines
            foreach (var node in _currentGraphNodes)
            {
                double cx = QueueLaneX(node.Column);
                double cy = node.CenterY;
                var laneBrush = QueueLaneBrush(node.Column);

                var dot = CreateGraphNodeDot(node, cx, cy, laneBrush);
                Canvas.SetLeft(dot, cx - QueueGraphDotRadius);
                Canvas.SetTop(dot, cy - QueueGraphDotRadius);
                QueueGraphCanvas.Children.Add(dot);
            }
        }

        private UIElement CreateGraphNodeDot(QueueGraphNode node, double cx, double cy, Brush laneBrush)
        {
            var mantle = (Brush)Application.Current.FindResource("MantleBrush");
            var blue = (Brush)Application.Current.FindResource("BlueBrush");
            var green = (Brush)Application.Current.FindResource("GreenBrush");
            var red = (Brush)Application.Current.FindResource("RedBrush");
            var yellow = (Brush)Application.Current.FindResource("YellowBrush");
            var mauve = (Brush)Application.Current.FindResource("MauveBrush");

            if (node.IsWaitingForInput)
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = yellow,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"❓ Build {node.DisplayRef}\nWaiting for user input",
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF9, 0xE2, 0xAF), BlurRadius = 8, ShadowDepth = 0, Opacity = 0.8 }
                };
                return dot;
            }
            else if (node.Status == "running")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = blue,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"▶ Build {node.DisplayRef} (RUNNING)\nActively executing",
                    Effect = (Effect)Application.Current.FindResource("BlueGlowFaint")
                };
                return dot;
            }
            else if (node.Item != null && BuildConsoleSettings.Load().PausedBuildIds.Contains(node.Item.Id))
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2 + 2,
                    Height = QueueGraphDotRadius * 2 + 2,
                    Fill = peach,
                    Stroke = mantle,
                    StrokeThickness = 2,
                    ToolTip = $"⏸ Build {node.DisplayRef} (PAUSED)\nPaused by user",
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xFA, 0xB3, 0x87), BlurRadius = 8, ShadowDepth = 0, Opacity = 0.8 }
                };
                return dot;
            }
            else if (node.IsBlocked)
            {
                string blockerText = string.Join(", ", node.BlockedBy.Select(FormatIssueRef));
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = red,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔒 Build {node.DisplayRef} (BLOCKED)\nWaiting on: {blockerText}"
                };
                return dot;
            }
            else if (node.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                var sapphire = (Brush)Application.Current.FindResource("SapphireBrush");
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = sapphire,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔎 Build {node.DisplayRef} (VERIFYING)\nSession done — waiting for its GitHub issue to close"
                };
                return dot;
            }
            else if (node.Status == "done")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = green,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"✨ Build {node.DisplayRef} (DONE)"
                };
                return dot;
            }
            else if (node.Status == "failed")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = red,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"✕ Build {node.DisplayRef} (FAILED)"
                };
                return dot;
            }
            else if (node.Status == "restart")
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = mauve,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"🔄 Build {node.DisplayRef} (Queued for restart)"
                };
                return dot;
            }
            else
            {
                var dot = new Ellipse
                {
                    Width = QueueGraphDotRadius * 2,
                    Height = QueueGraphDotRadius * 2,
                    Fill = laneBrush,
                    Stroke = mantle,
                    StrokeThickness = 1.5,
                    ToolTip = $"⏳ Build {node.DisplayRef} (UP NEXT)\nReady to run when slot is free"
                };
                return dot;
            }
        }

        /// <summary>Group header card for a stack of builds sharing the same --buildSet name.
        /// Purely visual — carries no QueueGraphNode, so it plays no part in blocked-by
        /// connector math; RedrawQueueGraph positions connectors off the real cards only,
        /// via TranslatePoint, which naturally accounts for the extra height this adds.</summary>
        public static Brush GetBuildSetBrush(string buildSetName)
        {
            if (string.IsNullOrWhiteSpace(buildSetName))
                return (Brush)Application.Current.FindResource("MauveBrush");

            string[] resourceKeys = {
                "MauveBrush",
                "BlueBrush",
                "LavenderBrush",
                "SapphireBrush",
                "TealBrush",
                "SkyBrush",
                "GreenBrush",
                "PeachBrush",
                "YellowBrush",
                "MaroonBrush"
            };

            int hash = 0;
            foreach (char c in buildSetName)
            {
                hash = (hash * 31) + c;
            }
            int index = Math.Abs(hash) % resourceKeys.Length;

            return (Brush)Application.Current.FindResource(resourceKeys[index]);
        }

        /// <summary>Group header card for a stack of builds sharing the same --buildSet name.
        /// Purely visual — carries no QueueGraphNode, so it plays no part in blocked-by
        /// connector math; RedrawQueueGraph positions connectors off the real cards only,
        /// via TranslatePoint, which naturally accounts for the extra height this adds.</summary>
        private Border BuildBuildSetHeader(string buildSetName)
        {
            var accentBrush = GetBuildSetBrush(buildSetName);
            Color accentColor = Color.FromRgb(0xCB, 0xA6, 0xF7); // Mauve fallback
            if (accentBrush is SolidColorBrush scb)
            {
                accentColor = scb.Color;
            }

            var header = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(0x22, accentColor.R, accentColor.G, accentColor.B)),
                BorderBrush = accentBrush,
                BorderThickness = new Thickness(1, 1, 1, 0),
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Padding = new Thickness(8, 4, 8, 3),
                Margin = new Thickness(0, 8, 0, 0)
            };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(new TextBlock
            {
                Text = "▤ ",
                FontSize = 11,
                Foreground = accentBrush,
                VerticalAlignment = VerticalAlignment.Center
            });
            row.Children.Add(new TextBlock
            {
                Text = buildSetName,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = accentBrush,
                TextWrapping = TextWrapping.Wrap,
                ToolTip = $"Build Set \"{buildSetName}\" — merges + restarts together as one wave"
            });
            header.Child = row;
            return header;
        }

        private Border BuildRestartCard(MainWindow.PersistedQueueDisplayItem p)
        {
            var restartBrush = (Brush)Application.Current.FindResource("MauveBrush");
            var card = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x20, 0x1A, 0x2A)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x5A, 0x48, 0x75)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };

            var sp = new StackPanel();
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 2) };
            var badge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x38, 0x2C, 0x4C)),
                BorderBrush = restartBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5)
            };
            badge.Child = new TextBlock
            {
                Text = "🔄 RESTART",
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = restartBrush
            };
            topRow.Children.Add(badge);

            if (p.GithubNumber.HasValue)
            {
                var numBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                numBadge.Child = new TextBlock
                {
                    Text = FormatIssueRef(p.GithubNumber.Value),
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush")
                };
                topRow.Children.Add(numBadge);
            }
            sp.Children.Add(topRow);

            var titleBlock = new TextBlock
            {
                Text = p.Title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            };
            AttachBubbleTooltip(titleBlock, p.Title);
            sp.Children.Add(titleBlock);

            card.Child = sp;
            return card;
        }

        private Border BuildQueueCard(QueueGraphNode node)
        {
            var item = node.Item!;
            bool isWaitingForInput = node.IsWaitingForInput;
            bool isBlocked = node.IsBlocked;
            bool isSelected = _selectedQueueItemId == item.Id;
            bool isPaused = BuildConsoleSettings.Load().PausedBuildIds.Contains(item.Id);

            Color cardBorderColor = isSelected ? Color.FromRgb(0x89, 0xB4, 0xFA) :
                (isWaitingForInput ? Color.FromRgb(0xF9, 0xE2, 0xAF) :
                (item.Status == "running" ? Color.FromRgb(0x45, 0x5A, 0x82) :
                (isPaused ? Color.FromRgb(0xFA, 0xB3, 0x87) :
                (isBlocked ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus ? Color.FromRgb(0x2A, 0x4A, 0x5A) :
                (item.Status == "done" ? Color.FromRgb(0x2E, 0x52, 0x3E) :
                (item.Status == "failed" ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                Color.FromRgb(0x31, 0x32, 0x44))))))));

            Color cardBgColor = isSelected ? Color.FromRgb(0x1B, 0x22, 0x34) :
                (isWaitingForInput ? Color.FromRgb(0x23, 0x1E, 0x18) :
                (item.Status == "running" ? Color.FromRgb(0x15, 0x19, 0x26) :
                (isPaused ? Color.FromRgb(0x2A, 0x20, 0x1A) :
                (isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus ? Color.FromRgb(0x14, 0x22, 0x28) :
                (item.Status == "done" ? Color.FromRgb(0x14, 0x20, 0x1A) :
                Color.FromRgb(0x18, 0x18, 0x25)))))));

            var card = new Border
            {
                Background = new SolidColorBrush(cardBgColor),
                BorderBrush = new SolidColorBrush(cardBorderColor),
                BorderThickness = new Thickness(isSelected ? 1.8 : (isWaitingForInput ? 1.5 : 1)),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Cursor = Cursors.Hand,
                Tag = item
            };

            card.MouseLeftButtonDown += (s, e) =>
            {
                SelectNode(node);
            };

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            // ── Top Row: Status Badge + Issue # Badge + Critical Path Badge ──
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };

            Border statusPill;
            if (isWaitingForInput)
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3E, 0x2C, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "❓ ASK QUESTION",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (isPaused)
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏸ PAUSED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == "running")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1D, 0x2E, 0x45)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "▶ RUNNING",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                // Git #1469 — session genuinely finished, but its real GitHub issue
                // hasn't closed yet; distinct from DONE so it's obvious this build
                // isn't fully archived/confirmed.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1A, 0x2E, 0x38)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x74, 0xC7, 0xEC)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🔎 VERIFYING",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x74, 0xC7, 0xEC)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Session exited successfully — waiting for its real GitHub issue to be closed before this is marked Done."
                };
            }
            else if (item.Status == "done")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1C, 0x35, 0x27)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "✨ DONE",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == "failed")
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x3A, 0x1E, 0x26)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "✕ FAILED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus)
            {
                // Session-limit auto-restart — parked by a "hit your session limit"
                // message; auto re-queued 10 minutes after the parsed reset.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x2A, 0x3A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "⏸ LIMIT — AUTO-RESTARTS",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            else
            {
                statusPill = new Border
                {
                    Background = new SolidColorBrush(isBlocked ? Color.FromRgb(0x3A, 0x1E, 0x26) : Color.FromRgb(0x21, 0x22, 0x34)),
                    BorderBrush = new SolidColorBrush(isBlocked ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = isBlocked ? "🔒 BLOCKED" : "⏳ UP NEXT",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(isBlocked ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center
                };
            }
            topRow.Children.Add(statusPill);

            if (item.GithubNumber.HasValue)
            {
                var numBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0)
                };
                numBadge.Child = new TextBlock
                {
                    Text = FormatIssueRef(item.GithubNumber.Value),
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush")
                };
                topRow.Children.Add(numBadge);
            }

            if (_downstreamBlockCounts.TryGetValue(item.Id, out var blockCount) && blockCount > 0)
            {
                bool isTopBottleneck = blockCount == _maxDownstreamBlockCount && _maxDownstreamBlockCount > 1;
                var blockBadge = new Border
                {
                    Background = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0x45, 0x1A, 0x24) : Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = isTopBottleneck
                        ? $"Critical path — {blockCount} downstream build(s) are waiting on this."
                        : $"Blocks {blockCount} downstream build(s) in the queue."
                };
                blockBadge.Child = new TextBlock
                {
                    Text = $"⛓ blocks {blockCount}",
                    FontSize = 9.5,
                    FontWeight = isTopBottleneck ? FontWeights.Bold : FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(isTopBottleneck ? Color.FromRgb(0xF3, 0x8B, 0xA8) : Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center
                };
                topRow.Children.Add(blockBadge);
            }

            if (!string.IsNullOrWhiteSpace(item.OriginatingChatId) || !string.IsNullOrWhiteSpace(item.ChatUrl))
            {
                var chatBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    Cursor = Cursors.Hand,
                    ToolTip = "Click to open/focus linked chat tab"
                };
                chatBadge.Child = new TextBlock
                {
                    Text = "💬 Chat",
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA))
                };
                chatBadge.MouseLeftButtonDown += (s, e) =>
                {
                    e.Handled = true;
                    QueueItemChatRequested?.Invoke(this, item);
                };
                topRow.Children.Add(chatBadge);
            }

            mainStack.Children.Add(topRow);

            // ── Second Row: Title Block ──
            var titleBlock = new TextBlock
            {
                Text = item.Title,
                FontSize = 11.5,
                FontWeight = FontWeights.Normal,
                Foreground = isPaused ? (Brush)Application.Current.FindResource("PeachBrush") : (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            };
            SetQueueCardTooltip(card, item);
            mainStack.Children.Add(titleBlock);

            // ── Third Row: Extra info (blocker details, exit code) ──
            if (node.BlockedBy.Count > 0 && item.Status == "queued")
            {
                mainStack.Children.Add(new TextBlock
                {
                    Text = $"waiting on {string.Join(", ", node.BlockedBy.Select(FormatIssueRef))}",
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    Margin = new Thickness(1, 2, 0, 0)
                });
            }
            if (item.Status == "failed" && item.ExitCode.HasValue)
            {
                string orphanDetail = !string.IsNullOrEmpty(item.SessionId)
                    ? "orphaned by app restart/crash — Resume Session picks up where it left off"
                    : "orphaned by app restart/crash — no session captured, use Retry";
                mainStack.Children.Add(new TextBlock
                {
                    Text = item.ExitCode == -2 ? orphanDetail : $"exit code {item.ExitCode}",
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    Margin = new Thickness(1, 2, 0, 0)
                });
            }

            // ── 2-Column Card Grid (Full Width with Right-Spanning Mascot) ──
            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var interactiveState = _watcher?.GetInteractiveState(item.Id);
            var mascot = CreateQueueCardMascot(item, interactiveState);
            if (mascot != null)
            {
                Grid.SetColumn(mascot, 1);
                cardGrid.Children.Add(mascot);
            }

            card.Child = cardGrid;

            // Context Menu
            card.ContextMenu = BuildCardContextMenu(item);

            return card;
        }

        private void SelectNode(QueueGraphNode node)
        {
            if (node.Item == null) return;
            _selectedQueueItemId = node.Item.Id;

            foreach (var n in _currentGraphNodes)
            {
                if (n.CardElement != null && n.Item != null)
                {
                    bool isThis = n.Item.Id == node.Item.Id;
                    n.CardElement.BorderThickness = new Thickness(isThis ? 1.8 : (n.IsWaitingForInput ? 1.5 : 1));
                    if (isThis)
                        n.CardElement.BorderBrush = (Brush)Application.Current.FindResource("BlueBrush");
                }
            }

            TaskSelected?.Invoke(this, new TaskSelectedEventArgs
            {
                QueueItemId = node.Item.Id,
                ExitCode = node.Item.ExitCode,
                Epic = node.Item.GithubNumber.HasValue ? FormatIssueRef(node.Item.GithubNumber.Value) : "",
                Task = node.Item.Title,
                Status = node.Item.Status,
                StatusDetails = node.BlockedBy.Count > 0
                    ? $"Waiting on {string.Join(", ", node.BlockedBy.Select(FormatIssueRef))}"
                    : "",
            });
        }

        private ContextMenu BuildCardContextMenu(QueueItem item)
        {
            var cm = new ContextMenu();

            var miOpenChat = new MenuItem { Header = "💬 Open Originating Chat" };
            miOpenChat.Click += (_, _) =>
            {
                QueueItemChatRequested?.Invoke(this, item);
            };
            cm.Items.Add(miOpenChat);

            var miMarkComplete = new MenuItem { Header = "✓ Mark Complete (Hide)" };
            miMarkComplete.Click += async (_, _) =>
            {
                _manuallyHiddenQueueIds.Add(item.Id);
                try
                {
                    if (_db != null)
                        await _db.MarkCompleteAsync(item.Id, 0);
                    else if (_api != null)
                        await _api.MarkQueueItemCompleteAsync(item.Id, 0);
                }
                catch { }
                if (item.Status == "running")
                {
                    _watcher?.TryStop(item.Id);
                }
                _watcher?.ReleaseInteractive(item.Id);
                ActivityLog.Log("build-queue", $"Marked queue item #{item.Id} ({item.Title}) complete & hidden.");
                await RefreshAsync();
            };
            cm.Items.Add(miMarkComplete);
            cm.Items.Add(new Separator());

            // Reply… — send a message to THIS build and resume its exact Claude session with
            // it (claude --resume <session-id> "<your message>"). Available for any build that
            // has a captured session id, whatever its status (running/done/failed) — the escape
            // hatch for when the interactive question-detection misses (e.g. an unrecognized
            // A/B choice) and there is otherwise no way to answer. A live running build's id
            // comes from the watcher; a finished build's from its persisted session_id.
            string? replySessionId = !string.IsNullOrWhiteSpace(item.SessionId)
                ? item.SessionId
                : _watcher?.GetSessionId(item.Id);
            if (!string.IsNullOrWhiteSpace(replySessionId))
            {
                var miReply = new MenuItem { Header = "💬 Reply… (resume this session with a message)" };
                miReply.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Reply", "Not connected (no direct DB) — can't queue a reply.");
                        return;
                    }
                    // Re-resolve at click time — a still-running build may only have revealed
                    // its session id after this menu was built.
                    string? sid = !string.IsNullOrWhiteSpace(item.SessionId)
                        ? item.SessionId
                        : _watcher?.GetSessionId(item.Id);
                    if (string.IsNullOrWhiteSpace(sid))
                    {
                        ToastEngine.Warning("Reply", "No session id captured for this build yet — nothing to resume.");
                        return;
                    }

                    string? message = PromptForReplyMessage(item.Title);
                    if (string.IsNullOrWhiteSpace(message)) return;

                    try
                    {
                        // Fresh row (githubNumber: null) so we never dedupe onto — and re-queue
                        // out from under — a row that may still be running. resumeSessionId makes
                        // the watcher launch `claude --resume <sid> "<message>"`.
                        await _db.QueueBuildAsync(
                            $"Reply → {item.Title}", message, item.Model, item.Effort, item.Cwd,
                            githubNumber: null, blockedByNumbers: null,
                            resumeSessionId: sid, chatUrl: item.ChatUrl, buildSet: item.BuildSet, account: item.Account);
                        ActivityLog.Log("interactive-build",
                            $"Reply queued for queue #{item.Id} ({item.Title}) — resuming session {sid} with a {message.Length}-char message.");
                        ToastEngine.Success("Reply queued", $"Resuming the session for “{item.Title}” with your message.");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Reply Failed", $"Couldn't queue the reply: {ex.Message}");
                    }
                };
                cm.Items.Add(miReply);
                cm.Items.Add(new Separator());
            }

            if (item.Status == "running")
            {
                if (_watcher?.OwnsInteractive(item.Id) == true)
                {
                    var miResume = new MenuItem { Header = "⏵ Resume (unstick after network loss)" };
                    miResume.Click += async (_, _) =>
                    {
                        if (_watcher == null) return;
                        ActivityLog.Log("interactive-build", $"Resume invoked from Build Queue context menu: {item.Title} (queue #{item.Id})");
                        await _watcher.RequestResumeAsync(item.Id);
                        await RefreshAsync();
                    };
                    cm.Items.Add(miResume);
                }

                var miStop = new MenuItem { Header = "⏹ Stop" };
                miStop.Click += async (_, _) =>
                {
                    bool stopped = _watcher?.TryStop(item.Id) ?? false;
                    _watcher?.ReleaseInteractive(item.Id);
                    try
                    {
                        if (_db != null)
                            await _db.MarkCompleteAsync(item.Id, -1);
                        else if (_api != null)
                            await _api.MarkQueueItemCompleteAsync(item.Id, -1);
                    }
                    catch (Exception ex) { ToastEngine.Error("Stop Build", $"Couldn't update database: {ex.Message}"); }
                    if (stopped)
                        ToastEngine.Success("Build Stopped", $"Stopped: {item.Title}");
                    else
                        ToastEngine.Warning("Build Stopped", $"Marked stopped in DB (no active local process handle): {item.Title}");
                    await RefreshAsync();
                };
                cm.Items.Add(miStop);
            }
            else if (item.Status == "queued")
            {
                bool isItemPaused = BuildConsoleSettings.Load().PausedBuildIds.Contains(item.Id);
                var miPauseBuild = new MenuItem { Header = isItemPaused ? "▶ Allow Build" : "⏸ Pause Build" };
                miPauseBuild.Click += async (_, _) =>
                {
                    var settings = BuildConsoleSettings.Load();
                    if (settings.PausedBuildIds.Contains(item.Id))
                    {
                        settings.PausedBuildIds.Remove(item.Id);
                        ActivityLog.Log("build-queue", $"Allowed build queue item #{item.Id} ({item.Title}) to run");
                    }
                    else
                    {
                        settings.PausedBuildIds.Add(item.Id);
                        ActivityLog.Log("build-queue", $"Paused build queue item #{item.Id} ({item.Title})");
                    }
                    settings.Save();
                    await RefreshAsync();
                };
                cm.Items.Add(miPauseBuild);

                var miRunNow = new MenuItem { Header = "🚀 Run Now" };
                miRunNow.Click += async (_, _) =>
                {
                    if (_watcher == null || _api == null)
                    {
                        ToastEngine.Info("Run Now", "The in-app watcher isn't active, so Run Now can't launch locally. The background service will pick it up.");
                        return;
                    }
                    try
                    {
                        var settings = BuildConsoleSettings.Load();
                        if (settings.PausedBuildIds.Contains(item.Id))
                        {
                            settings.PausedBuildIds.Remove(item.Id);
                            settings.Save();
                        }

                        QueueItem claimed;
                        if (_db != null)
                            claimed = await _db.ForceClaimAsync(item.Id);
                        else
                            claimed = await _api.ForceClaimQueueItemAsync(item.Id);
                        _watcher.ForceLaunch(claimed);
                        ToastEngine.Success("Run Now", $"Launched: {item.Title}");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Warning("Run Now", $"Couldn't launch immediately: {ex.Message}");
                    }
                };
                cm.Items.Add(miRunNow);

                var miCancel = new MenuItem { Header = "✕ Cancel" };
                miCancel.Click += async (_, _) =>
                {
                    if (_db == null && _api == null)
                    {
                        ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                        return;
                    }
                    try
                    {
                        bool canceled;
                        if (_db != null)
                            canceled = await _db.CancelAsync(item.Id);
                        else
                            canceled = (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;

                        if (canceled)
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled queue item #{item.Id} ({item.Title}) before it ran.");
                        }
                        else
                        {
                            ToastEngine.Warning("Cancel", $"Couldn't cancel — it already started running: {item.Title}");
                        }
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancel);
            }
            else if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus)
            {
                // Session-limit park — normally re-queued automatically after the
                // reset; Resume Now skips the wait for just this build.
                var miResumeNow = new MenuItem { Header = "▶ Resume Now (skip the wait)" };
                miResumeNow.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Resume", "No direct DB connection — can't resume.");
                        return;
                    }
                    try
                    {
                        if (await _db.RequeueLimitPausedAsync(item.Id))
                        {
                            ToastEngine.Success("Resumed", $"Back in the queue: {item.Title}");
                            ActivityLog.Log("session-limit", $"Manually resumed limit-paused queue item #{item.Id} ({item.Title}) ahead of the auto-restart.");
                        }
                        else
                            ToastEngine.Warning("Resume", $"No longer limit-paused: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Resume Failed", $"Couldn't resume: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miResumeNow);

                var miCancelLp = new MenuItem { Header = "✕ Cancel Build" };
                miCancelLp.Click += async (_, _) =>
                {
                    if (_db == null && _api == null)
                    {
                        ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                        return;
                    }
                    try
                    {
                        bool canceled;
                        if (_db != null)
                            canceled = await _db.CancelAsync(item.Id);
                        else
                            canceled = (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;

                        if (canceled)
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("session-limit", $"Canceled limit-paused queue item #{item.Id} ({item.Title}) — it will NOT auto-restart.");
                        }
                        else
                            ToastEngine.Warning("Cancel", $"Couldn't cancel: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miCancelLp);
            }
            else
            {
                // Crash/orphan recovery (see BuildQueuePostgresClient.UpdateSessionIdAsync
                // and QueueWatcherService.HandleOutput) — a build that died before it could
                // report completion (app crash, hard reboot mid-run) may still have a real
                // session id captured, in which case the CLI can pick the conversation back
                // up with --resume instead of Retry's plain "start the original prompt over".
                // Only offered when a real session id actually got captured; a build that
                // died before its very first stream-json line has nothing to resume.
                if (!string.IsNullOrEmpty(item.SessionId))
                {
                    var miResumeSession = new MenuItem { Header = "▶ Resume Session (crash recovery)" };
                    miResumeSession.Click += async (_, _) =>
                    {
                        if (_db == null) return;
                        try
                        {
                            var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                            await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, item.SessionId, item.ChatUrl, buildSet: item.BuildSet, account: item.Account);
                            ToastEngine.Success("Resuming", $"Resuming from where it left off: {item.Title}");
                            await RefreshAsync();
                        }
                        catch (Exception ex)
                        {
                            ToastEngine.Error("Resume Failed", $"Couldn't resume: {ex.Message}");
                        }
                    };
                    cm.Items.Add(miResumeSession);
                }

                var miRetry = new MenuItem { Header = "🔄 Retry (start over)" };
                miRetry.Click += async (_, _) =>
                {
                    if (_db == null) return;
                    try
                    {
                        var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, null, item.ChatUrl, buildSet: item.BuildSet, account: item.Account);
                        ToastEngine.Success("Re-queued", $"Re-queued: {item.Title}");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Retry Failed", $"Couldn't re-queue build: {ex.Message}");
                    }
                };
                cm.Items.Add(miRetry);
            }

            // Always-available: the local (--notGit) build-id registry — every letter id
            // ever allocated, past and present (see NotGitNumberRegistry).
            cm.Items.Add(new Separator());
            var miLocalIds = new MenuItem { Header = "🔤 Local Build IDs…" };
            miLocalIds.Click += (_, _) => ShowLocalBuildIdsWindow();
            cm.Items.Add(miLocalIds);

            return cm;
        }

        /// <summary>
        /// A real, visible view of the local (--notGit) build-id registry: every letter id
        /// ever allocated, its backing github_number (−ordinal), when it was first seen, and
        /// its provenance. Backed by <see cref="NotGitNumberRegistry.Snapshot"/> so it is
        /// always in sync with what allocation/resolution actually recorded.
        /// </summary>
        private void ShowLocalBuildIdsWindow()
        {
            var entries = NotGitNumberRegistry.Snapshot();

            var win = new Window
            {
                Title = "Local Build IDs  (--notGit letter registry)",
                Width = 560,
                Height = 480,
                Owner = Window.GetWindow(this),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)) // Catppuccin base
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = entries.Count == 0
                    ? "No local (--notGit) build ids allocated yet."
                    : $"{entries.Count} local build id(s). New --notGit builds are handed the next unused letter automatically.",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var list = new ListBox
            {
                FontFamily = new FontFamily("Consolas, Cascadia Mono, monospace"),
                FontSize = 12.5,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderThickness = new Thickness(0)
            };
            foreach (var e in entries)
            {
                list.Items.Add(new ListBoxItem
                {
                    Content = $"local #{e.Letters,-6}  github_number {(-e.Ordinal),-6}  {e.Note}"
                            + (string.IsNullOrEmpty(e.FirstSeenUtc) ? "" : $"   (first seen {e.FirstSeenUtc})"),
                    Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4))
                });
            }
            root.Children.Add(list);

            win.Content = root;
            win.ShowDialog();
        }

        /// <summary>
        /// Modal input for the Reply action: collects the message to resume a build's session
        /// with. Returns the trimmed text, or null if cancelled/empty. Ctrl+Enter sends.
        /// </summary>
        private string? PromptForReplyMessage(string buildTitle)
        {
            var win = new Window
            {
                Title = "Reply — resume this build's session with a message",
                Width = 540,
                Height = 320,
                Owner = Window.GetWindow(this),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = $"Message for “{buildTitle}”. It resumes that exact Claude session — "
                     + "claude --resume <session-id> \"<your message>\" — so you can answer a "
                     + "question the build asked (e.g. an A/B choice) even if it wasn't auto-detected.",
                Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 10, 0, 0)
            };
            DockPanel.SetDock(buttons, Dock.Bottom);

            string? result = null;

            var box = new TextBox
            {
                AcceptsReturn = true,
                TextWrapping = TextWrapping.Wrap,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Background = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                CaretBrush = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8),
                FontSize = 13,
                MinHeight = 120
            };
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) != 0)
                {
                    result = box.Text?.Trim();
                    win.DialogResult = !string.IsNullOrEmpty(result);
                }
            };

            var cancel = new Button { Content = "Cancel", Padding = new Thickness(14, 6, 14, 6), IsCancel = true };
            cancel.Click += (_, _) => win.DialogResult = false;

            var send = new Button { Content = "Send Reply  (Ctrl+Enter)", Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(14, 6, 14, 6), IsDefault = true };
            send.Click += (_, _) =>
            {
                result = box.Text?.Trim();
                win.DialogResult = !string.IsNullOrEmpty(result);
            };

            buttons.Children.Add(cancel);
            buttons.Children.Add(send);
            root.Children.Add(buttons);
            root.Children.Add(box); // last child fills the remaining space

            win.Content = root;
            win.Loaded += (_, _) => box.Focus();
            return win.ShowDialog() == true ? result : null;
        }

        private static readonly Dictionary<string, (string Icon, string Hex)> TestStatusStyle = new()
        {
            ["passed"] = ("✅", "#7FAE91"),
            ["failed"] = ("✕", "#E57A7A"),
            ["none"]   = ("•", "#8F8C88"),
        };

        private void RenderTestsTree()
        {
            QueueGraphCanvas.Children.Clear();
            QueueCardsHost.Children.Clear();
            _currentGraphNodes.Clear();

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "No repo root found — can't locate test-manifests/test-results.";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            string manifestsDir = Path.Combine(repoRoot, "test-manifests");
            string resultsDir = Path.Combine(repoRoot, "test-results");

            var manifestFiles = Directory.Exists(manifestsDir)
                ? Directory.GetFiles(manifestsDir, "*.json")
                    .Where(f => !string.Equals(Path.GetFileName(f), "_regression-suite.json", StringComparison.OrdinalIgnoreCase))
                    .OrderBy(f => f)
                    .ToList()
                : new List<string>();

            QueueGraphContainer.Visibility = Visibility.Visible;
            QueueEmptyText.Visibility = manifestFiles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = "No test manifests found in test-manifests/.";

            var latestResultFileByIssue = new Dictionary<int, string>();
            if (Directory.Exists(resultsDir))
            {
                foreach (var file in Directory.GetFiles(resultsDir, "*.json"))
                {
                    string name = Path.GetFileNameWithoutExtension(file);
                    int dash = name.IndexOf('-');
                    if (dash <= 0 || !int.TryParse(name.Substring(0, dash), out int issueNum)) continue;
                    if (!latestResultFileByIssue.TryGetValue(issueNum, out var existing) || string.CompareOrdinal(file, existing) > 0)
                        latestResultFileByIssue[issueNum] = file;
                }
            }

            foreach (var manifestPath in manifestFiles)
            {
                var manifest = TestManifest.LoadFromFile(manifestPath);
                if (manifest == null) continue;

                string status = "none";
                string subtitle = "no runs yet";

                if (latestResultFileByIssue.TryGetValue(manifest.Issue, out var resultPath))
                {
                    try
                    {
                        var runResult = System.Text.Json.JsonSerializer.Deserialize<ManifestRunResult>(File.ReadAllText(resultPath));
                        if (runResult != null && runResult.Steps.Count > 0)
                        {
                            int passed = runResult.Steps.Count(s => s.Passed);
                            status = runResult.AllPassed ? "passed" : "failed";
                            subtitle = $"{passed}/{runResult.Steps.Count} passed — {runResult.StartedAt:MM/dd HH:mm} ({runResult.Mode})";
                        }
                    }
                    catch (Exception ex)
                    {
                        subtitle = $"couldn't read last result: {ex.Message}";
                    }
                }

                var (icon, hex) = TestStatusStyle[status];
                var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

                var border = new Border
                {
                    Background = (Brush)Application.Current.FindResource("BaseBrush"),
                    BorderBrush = (Brush)Application.Current.FindResource("Surface0Brush"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(8, 6, 8, 6),
                    Margin = new Thickness(0, 2, 0, 3)
                };

                var panel = new StackPanel();
                var topRow = new StackPanel { Orientation = Orientation.Horizontal };
                topRow.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
                topRow.Children.Add(new TextBlock
                {
                    Text = $"#{manifest.Issue} — {manifest.Feature}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontWeight = FontWeights.SemiBold,
                    VerticalAlignment = VerticalAlignment.Center,
                });
                panel.Children.Add(topRow);

                panel.Children.Add(new TextBlock
                {
                    Text = subtitle,
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    Margin = new Thickness(16, 2, 0, 0)
                });

                border.Child = panel;
                QueueCardsHost.Children.Add(border);
            }

            UpdateCritterLoungeVisibility();
        }

        private void TriggerBackgroundIssueTitleQueries()
        {
            if (_lastItems == null || _lastItems.Count == 0) return;

            var issueNumbers = _lastItems
                .SelectMany(i => i.AssociatedIssueNumbers)
                .Distinct()
                .ToList();

            foreach (var num in issueNumbers)
            {
                bool alreadyCached;
                bool alreadyPending;
                lock (_issueTitleCache)
                {
                    alreadyCached = _issueTitleCache.ContainsKey(num);
                }
                lock (_pendingFetches)
                {
                    alreadyPending = _pendingFetches.Contains(num);
                }

                if (!alreadyCached && !alreadyPending)
                {
                    lock (_pendingFetches)
                    {
                        _pendingFetches.Add(num);
                    }
                    _ = FetchAndCacheIssueTitleAsync(num);
                }
            }
        }

        private async System.Threading.Tasks.Task FetchAndCacheIssueTitleAsync(int issueNumber)
        {
            try
            {
                var title = await Services.GitHubIssuesService.GetIssueTitleAsync(issueNumber);
                if (title != null)
                {
                    lock (_issueTitleCache)
                    {
                        _issueTitleCache[issueNumber] = title;
                    }
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        UpdateTooltipForIssue(issueNumber);
                    }));
                }
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("github", $"Failed to fetch title for issue #{issueNumber}: {ex.Message}");
            }
            finally
            {
                lock (_pendingFetches)
                {
                    _pendingFetches.Remove(issueNumber);
                }
            }
        }

        private void UpdateTooltipForIssue(int issueNumber)
        {
            foreach (var node in _currentGraphNodes)
            {
                if (node.Item != null && node.CardElement != null && node.Item.AssociatedIssueNumbers.Contains(issueNumber))
                {
                    SetQueueCardTooltip(node.CardElement, node.Item);
                }
            }
        }

        private void SetQueueCardTooltip(Border card, QueueItem item)
        {
            var text = GetTooltipText(item);
            if (string.IsNullOrWhiteSpace(text)) return;

            card.ToolTip = new ToolTip
            {
                Style = (Style)Application.Current.FindResource("BubbleToolTip"),
                Content = new TextBlock
                {
                    Text = text,
                    TextWrapping = TextWrapping.Wrap,
                    MaxWidth = 350,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontSize = 12,
                },
            };
            ToolTipService.SetInitialShowDelay(card, 250);
            ToolTipService.SetShowDuration(card, 20000);
        }

        private string GetTooltipText(QueueItem item)
        {
            if (item.AssociatedIssueNumbers == null || item.AssociatedIssueNumbers.Count == 0)
            {
                return item.Title; // fallback to the build title
            }

            var sb = new System.Text.StringBuilder();
            
            // Primary issue is the first one
            int primaryNum = item.AssociatedIssueNumbers[0];
            string? primaryTitle = null;
            lock (_issueTitleCache)
            {
                _issueTitleCache.TryGetValue(primaryNum, out primaryTitle);
            }

            if (primaryTitle != null)
            {
                sb.Append($"#{primaryNum}: {primaryTitle}");
            }
            else
            {
                sb.Append($"#{primaryNum}: [Loading title...]");
            }

            if (item.AssociatedIssueNumbers.Count > 1)
            {
                sb.AppendLine();
                sb.AppendLine("Associated Issues:");
                for (int i = 1; i < item.AssociatedIssueNumbers.Count; i++)
                {
                    int num = item.AssociatedIssueNumbers[i];
                    string? title = null;
                    lock (_issueTitleCache)
                    {
                        _issueTitleCache.TryGetValue(num, out title);
                    }
                    if (title != null)
                    {
                        sb.Append($"- #{num}: {title}");
                    }
                    else
                    {
                        sb.Append($"- #{num}: [Loading title...]");
                    }
                    if (i < item.AssociatedIssueNumbers.Count - 1)
                    {
                        sb.AppendLine();
                    }
                }
            }

            return sb.ToString();
        }

        private const int TooltipMaxChars = 80;
        private static void AttachBubbleTooltip(FrameworkElement target, string? title)
        {
            var text = (title ?? string.Empty).Trim();
            if (text.Length == 0) return;
            if (text.Length > TooltipMaxChars)
                text = text.Substring(0, TooltipMaxChars).TrimEnd() + "…";

            target.ToolTip = new ToolTip
            {
                Style = (Style)Application.Current.FindResource("BubbleToolTip"),
                Content = new TextBlock
                {
                    Text = text,
                    TextWrapping = TextWrapping.Wrap,
                    MaxWidth = 296,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontSize = 12,
                },
            };
            ToolTipService.SetInitialShowDelay(target, 250);
            ToolTipService.SetShowDuration(target, 20000);
        }

        // ══════════════════════════════════════════════════════════════════════════
        // ── Critter System Vectors & Mascots ──────────────────────────────────────
        // ══════════════════════════════════════════════════════════════════════════

        public enum CritterMood
        {
            Normal,
            Running,
            WaitingForInput,
            Blocked,
            Done,
            Failed,
            Verifying
        }

        private static SolidColorBrush HexBrush(string hex) =>
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

        private static Canvas CreateCuteFoxVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(5, 13), new Point(10, 1), new Point(15, 13) }, Fill = HexBrush("#F59E0B") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7, 12), new Point(10, 4), new Point(13, 12) }, Fill = HexBrush("#FDE68A") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(21, 13), new Point(26, 1), new Point(31, 13) }, Fill = HexBrush("#F59E0B") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(23, 12), new Point(26, 4), new Point(29, 12) }, Fill = HexBrush("#FDE68A") });
            var head = new Ellipse { Width = 26, Height = 19, Fill = HexBrush("#F59E0B") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);
            var cheekL = new Ellipse { Width = 13, Height = 11, Fill = HexBrush("#FFFBEB") };
            Canvas.SetLeft(cheekL, 4); Canvas.SetTop(cheekL, 14);
            canvas.Children.Add(cheekL);
            var cheekR = new Ellipse { Width = 13, Height = 11, Fill = HexBrush("#FFFBEB") };
            Canvas.SetLeft(cheekR, 19); Canvas.SetTop(cheekR, 14);
            canvas.Children.Add(cheekR);
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(13, 17), new Point(23, 17), new Point(18, 24) }, Fill = HexBrush("#FFFBEB") });
            var nose = new Ellipse { Width = 3.5, Height = 2.5, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.2); Canvas.SetTop(nose, 21.5);
            canvas.Children.Add(nose);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,15 Q11.2,18 13.5,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,15 Q24.8,18 27,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,16 Q11.2,13 13.5,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,16 Q24.8,13 27,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 9.5); Canvas.SetTop(eyeL, 13);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 10.5); Canvas.SetTop(eyeLh, 13.5);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 23); Canvas.SetTop(eyeR, 13);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 24); Canvas.SetTop(eyeRh, 13.5);
                canvas.Children.Add(eyeRh);
            }

            var blushL = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.65 };
            Canvas.SetLeft(blushL, 6); Canvas.SetTop(blushL, 17);
            canvas.Children.Add(blushL);
            var blushR = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.65 };
            Canvas.SetLeft(blushR, 25.5); Canvas.SetTop(blushR, 17);
            canvas.Children.Add(blushR);
            return canvas;
        }

        private static Canvas CreateCuteBearVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 7.5, Height = 7.5, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(earL, 5); Canvas.SetTop(earL, 3);
            canvas.Children.Add(earL);
            var earLin = new Ellipse { Width = 4, Height = 4, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(earLin, 6.8); Canvas.SetTop(earLin, 4.8);
            canvas.Children.Add(earLin);
            var earR = new Ellipse { Width = 7.5, Height = 7.5, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(earR, 23.5); Canvas.SetTop(earR, 3);
            canvas.Children.Add(earR);
            var earRin = new Ellipse { Width = 4, Height = 4, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(earRin, 25.2); Canvas.SetTop(earRin, 4.8);
            canvas.Children.Add(earRin);
            var head = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#C7D2FE") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 7);
            canvas.Children.Add(head);
            var snout = new Ellipse { Width = 11, Height = 8, Fill = HexBrush("#E0E7FF") };
            Canvas.SetLeft(snout, 12.5); Canvas.SetTop(snout, 16);
            canvas.Children.Add(snout);
            var nose = new Ellipse { Width = 3.5, Height = 2.5, Fill = HexBrush("#312E81") };
            Canvas.SetLeft(nose, 16.2); Canvas.SetTop(nose, 18);
            canvas.Children.Add(nose);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10,14.5 Q12.5,17.5 15,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M21,14.5 Q23.5,17.5 26,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Running || mood == CritterMood.WaitingForInput)
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#312E81") };
                Canvas.SetLeft(eyeL, 10.5); Canvas.SetTop(eyeL, 12.5);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.2, Height = 1.2, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 11.5); Canvas.SetTop(eyeLh, 13);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#312E81") };
                Canvas.SetLeft(eyeR, 22); Canvas.SetTop(eyeR, 12.5);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.2, Height = 1.2, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 23); Canvas.SetTop(eyeRh, 13);
                canvas.Children.Add(eyeRh);
            }
            else
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10,14 Q12.5,16.5 15,14"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.3 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M21,14 Q23.5,16.5 26,14"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.3 });
            }

            var blushL = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.55 };
            Canvas.SetLeft(blushL, 6.5); Canvas.SetTop(blushL, 17);
            canvas.Children.Add(blushL);
            var blushR = new Ellipse { Width = 4.5, Height = 2.5, Fill = HexBrush("#F472B6"), Opacity = 0.55 };
            Canvas.SetLeft(blushR, 25); Canvas.SetTop(blushR, 17);
            canvas.Children.Add(blushR);
            return canvas;
        }

        private static Canvas CreateCuteCatVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(5, 13), new Point(9, 2), new Point(14, 13) }, Fill = HexBrush("#D8B4FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7, 12), new Point(9, 5), new Point(12, 12) }, Fill = HexBrush("#F5D0FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(22, 13), new Point(27, 2), new Point(31, 13) }, Fill = HexBrush("#D8B4FE") });
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(24, 12), new Point(27, 5), new Point(29, 12) }, Fill = HexBrush("#F5D0FE") });
            var head = new Ellipse { Width = 25, Height = 19, Fill = HexBrush("#D8B4FE") };
            Canvas.SetLeft(head, 5.5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,14 Q11.5,17 13.5,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,14 Q24,17 26,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,15.5 Q11.5,12.5 13.5,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,15.5 Q24,12.5 26,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 10); Canvas.SetTop(eyeL, 13);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 11); Canvas.SetTop(eyeLh, 13.5);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 4.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 22.5); Canvas.SetTop(eyeR, 13);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 23.5); Canvas.SetTop(eyeRh, 13.5);
                canvas.Children.Add(eyeRh);
            }

            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(16.5, 19.5), new Point(19.5, 19.5), new Point(18, 21.5) }, Fill = HexBrush("#F472B6") });
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M3,18 L8,19 M3,21 L8,21"), Stroke = HexBrush("#C084FC"), StrokeThickness = 0.9 });
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M28,19 L33,18 M28,21 L33,21"), Stroke = HexBrush("#C084FC"), StrokeThickness = 0.9 });
            return canvas;
        }

        private static Canvas CreateCuteDuckVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var head = new Ellipse { Width = 23, Height = 19, Fill = HexBrush("#F8FAFC") };
            Canvas.SetLeft(head, 6.5); Canvas.SetTop(head, 7);
            canvas.Children.Add(head);
            var cap = new Ellipse { Width = 15, Height = 7, Fill = HexBrush("#3B82F6") };
            Canvas.SetLeft(cap, 10.5); Canvas.SetTop(cap, 2);
            canvas.Children.Add(cap);
            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18,5 Q22,3 25,6 M18,5 Q22,6 26,9"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.2 });

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10.5,12 Q12.5,14.5 14.5,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18.5,12 Q20.5,14.5 22.5,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
            }
            else
            {
                var eyeL = new Ellipse { Width = 3.5, Height = 5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeL, 11); Canvas.SetTop(eyeL, 10);
                canvas.Children.Add(eyeL);
                var eyeLh = new Ellipse { Width = 1.3, Height = 1.6, Fill = Brushes.White };
                Canvas.SetLeft(eyeLh, 12); Canvas.SetTop(eyeLh, 11);
                canvas.Children.Add(eyeLh);
                var eyeR = new Ellipse { Width = 3.5, Height = 5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eyeR, 19); Canvas.SetTop(eyeR, 10);
                canvas.Children.Add(eyeR);
                var eyeRh = new Ellipse { Width = 1.3, Height = 1.6, Fill = Brushes.White };
                Canvas.SetLeft(eyeRh, 20); Canvas.SetTop(eyeRh, 11);
                canvas.Children.Add(eyeRh);
            }

            var beak = new Ellipse { Width = 16, Height = 8, Fill = HexBrush("#F59E0B") };
            Canvas.SetLeft(beak, 10); Canvas.SetTop(beak, 16.5);
            canvas.Children.Add(beak);
            var beakTop = new Ellipse { Width = 10, Height = 4, Fill = HexBrush("#FBBF24") };
            Canvas.SetLeft(beakTop, 13); Canvas.SetTop(beakTop, 17.5);
            canvas.Children.Add(beakTop);
            return canvas;
        }

        private static Canvas CreateCuteBirdVector(CritterMood mood)
        {
            var canvas = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 21, Height = 17, Fill = HexBrush("#60A5FA") };
            Canvas.SetLeft(body, 7.5); Canvas.SetTop(body, 7.5);
            canvas.Children.Add(body);
            var belly = new Ellipse { Width = 12, Height = 10, Fill = HexBrush("#DBEAFE") };
            Canvas.SetLeft(belly, 11); Canvas.SetTop(belly, 12);
            canvas.Children.Add(belly);
            canvas.Children.Add(new Polygon { Points = new PointCollection { new Point(7.5, 14), new Point(2, 16), new Point(7.5, 18) }, Fill = HexBrush("#F59E0B") });

            if (mood == CritterMood.Blocked)
            {
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M13,12 Q15,14.5 17,12"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.3 });
            }
            else
            {
                var eye = new Ellipse { Width = 3.5, Height = 3.5, Fill = HexBrush("#1E1E2E") };
                Canvas.SetLeft(eye, 13.5); Canvas.SetTop(eye, 10.5);
                canvas.Children.Add(eye);
                var eyeH = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
                Canvas.SetLeft(eyeH, 14.5); Canvas.SetTop(eyeH, 11.5);
                canvas.Children.Add(eyeH);
            }

            canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M18,12 Q25,14 19,20 Z"), Fill = HexBrush("#3B82F6") });
            return canvas;
        }

        private static UIElement CreateQueueCardMascot(QueueItem item, InteractiveInputState? interactiveState)
        {
            var container = new Canvas
            {
                Width = 42,
                Height = 36,
                Margin = new Thickness(4, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
                ClipToBounds = false
            };

            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            bool isBlocked = blockerList.Count > 0 || string.Equals(item.Status, "blocked", StringComparison.OrdinalIgnoreCase);

            CritterMood mood = isBlocked ? CritterMood.Blocked :
                (interactiveState == InteractiveInputState.WaitingForInput) ? CritterMood.WaitingForInput :
                (item.Status == "running") ? CritterMood.Running :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus) ? CritterMood.Verifying :
                (item.Status == "done") ? CritterMood.Done :
                (item.Status == "failed") ? CritterMood.Failed :
                CritterMood.Normal;

            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;

            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            floatTrans.BeginAnimation(TranslateTransform.YProperty, floatAnim);

            int variant = Math.Abs((item.GithubNumber ?? item.Id) % 5);
            FrameworkElement critter = isBlocked
                ? IssueChompAnimation.BuildWhammyElement(scale: 0.5)
                : (FrameworkElement)(variant switch
                {
                    0 => CreateCuteFoxVector(mood),
                    1 => CreateCuteBearVector(mood),
                    2 => CreateCuteCatVector(mood),
                    3 => CreateCuteDuckVector(mood),
                    _ => CreateCuteBirdVector(mood)
                });

            Canvas.SetLeft(critter, 3);
            Canvas.SetTop(critter, 3);
            container.Children.Add(critter);

            Color glowColor = mood switch
            {
                CritterMood.Blocked => Color.FromRgb(0xF3, 0x8B, 0xA8),
                CritterMood.WaitingForInput => Color.FromRgb(0xF9, 0xE2, 0xAF),
                CritterMood.Running => Color.FromRgb(0x89, 0xB4, 0xFA),
                CritterMood.Verifying => Color.FromRgb(0x74, 0xC7, 0xEC),
                CritterMood.Done => Color.FromRgb(0xA6, 0xE3, 0xA1),
                CritterMood.Failed => Color.FromRgb(0xEB, 0xA0, 0xAC),
                _ => Color.FromRgb(0xCB, 0xA6, 0xF7)
            };

            var glow = new DropShadowEffect
            {
                Color = glowColor,
                BlurRadius = item.Status == "running" ? 10 : (isBlocked ? 7 : 6),
                ShadowDepth = 0,
                Opacity = item.Status == "running" ? 0.65 : 0.38
            };
            critter.Effect = glow;

            if (item.Status == "running" || isBlocked)
            {
                var shimmer = new DoubleAnimation(0.30, isBlocked ? 0.65 : 0.85, TimeSpan.FromSeconds(isBlocked ? 2.8 : 2.2))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                };
                glow.BeginAnimation(DropShadowEffect.OpacityProperty, shimmer);
            }

            if (isBlocked)
            {
                var lockBadge = new Border
                {
                    Background = HexBrush("#F38BA8"),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF3, 0x8B, 0xA8), BlurRadius = 4, ShadowDepth = 0 }
                };
                lockBadge.Child = new TextBlock { Text = "🔒", FontSize = 9 };
                Canvas.SetLeft(lockBadge, 22);
                Canvas.SetTop(lockBadge, -3);
                container.Children.Add(lockBadge);
            }
            else if (interactiveState == InteractiveInputState.WaitingForInput)
            {
                var badge = new Border
                {
                    Background = HexBrush("#F9E2AF"),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 4, ShadowDepth = 0 }
                };
                badge.Child = new TextBlock { Text = "💬", FontSize = 9 };
                Canvas.SetLeft(badge, 22);
                Canvas.SetTop(badge, -3);
                container.Children.Add(badge);
            }
            else if (item.Status == BuildQueuePostgresClient.VerifyingStatus)
            {
                var magnifier = new TextBlock
                {
                    Text = "🔎",
                    FontSize = 10,
                    Foreground = HexBrush("#74C7EC"),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0x74, 0xC7, 0xEC), BlurRadius = 4, ShadowDepth = 0 }
                };
                Canvas.SetLeft(magnifier, 26);
                Canvas.SetTop(magnifier, -2);
                container.Children.Add(magnifier);
            }
            else if (item.Status == "done")
            {
                var sparkle = new TextBlock
                {
                    Text = "✨",
                    FontSize = 10,
                    Foreground = HexBrush("#A6E3A1"),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xA6, 0xE3, 0xA1), BlurRadius = 4, ShadowDepth = 0 }
                };
                Canvas.SetLeft(sparkle, 26);
                Canvas.SetTop(sparkle, -2);
                container.Children.Add(sparkle);
            }
            else if (item.Status == "failed")
            {
                var mark = new TextBlock
                {
                    Text = "🩹",
                    FontSize = 10,
                    Opacity = 0.8
                };
                Canvas.SetLeft(mark, 24);
                Canvas.SetTop(mark, -2);
                container.Children.Add(mark);
            }

            return container;
        }

        private void InFlightIssuesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (InFlightIssuesList.SelectedItem is ListBoxItem { Tag: int githubNumber })
            {
                IssueChatRequested?.Invoke(this, githubNumber);
                InFlightIssuesList.SelectedItem = null;
            }
        }

        private void BtnPinQueue_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            PinQueueIcon.Text = _isPinned ? "📌" : "📍";
            PinToggled?.Invoke(this, _isPinned);
        }

        private async void BtnRefreshGitHubTiles_Click(object sender, RoutedEventArgs e)
        {
            ActivityLog.Log("github.manual-refresh",
                "Build Queue panel [manual Refresh click]: re-fetching GitHub components (Board + Issues in Epic + In-Flight + Focus Progress).");

            FullGitRefreshRequested?.Invoke(this, EventArgs.Empty);

            await System.Threading.Tasks.Task.WhenAll(
                RefreshActiveChatEpicIssuesAsync(),
                RefreshInFlightIssuesAsync("manual Refresh click"),
                RefreshAsync());

            ToastEngine.Success("Git Sync", "Refreshed Git Board, epic issues, and queue!");
        }

        private void TileInFlight_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileInFlight.IsChecked == true;
            TileInFlightContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileSessions.IsChecked = false;
                TileSessionsContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        private void TileSessions_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileSessions.IsChecked == true;
            TileSessionsContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileInFlight.IsChecked = false;
                TileInFlightContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        /// <summary>
        /// Automatically hides the bottom Critter Lounge animation when the Build Queue is full
        /// (>= 3 items rendered, or any of the collapsible accordion sections are open).
        /// </summary>
        public void UpdateCritterLoungeVisibility()
        {
            if (CritterLounge == null) return;
            int queueItemCount = _currentGraphNodes.Count;
            bool anyAccordionOpen = (TileInFlight?.IsChecked == true) || (TileSessions?.IsChecked == true);
            bool isFull = queueItemCount >= 3 || anyAccordionOpen;
            CritterLounge.Visibility = isFull ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>Safe stub for external callers in MainWindow & DevServerRollbackService.</summary>
        public void AddNeedsAttention(string key, string title, string body, bool isFailure, Action? onOpen, string? details = null)
        {
            ActivityLog.Log("testing.needs-attention", $"Needs attention recorded [{key}] ({title}): {body}");
        }

        /// <summary>Safe stub for external callers in MainWindow.</summary>
        public void ClearNeedsAttention(string key)
        {
            ActivityLog.Log("testing.needs-attention", $"Needs attention cleared [{key}]");
        }
    }
}
