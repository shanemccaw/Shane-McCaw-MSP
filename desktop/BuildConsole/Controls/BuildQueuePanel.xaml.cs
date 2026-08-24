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

            List<GitHubSubIssue> issues;
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                issues = await client.GetSubIssuesAsync(epicGithubNumber.Value);
            }
            catch (Exception ex)
            {
                ChatEpicIssuesList.Items.Clear();
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = $"Couldn't load issues: {ex.Message}" });
                return;
            }

            if (_activeChatEpicId != epicId) return;

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
                SyncError?.Invoke(this, _queueIsStale
                    ? $"Build Queue: showing cached data from {_queueCachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
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

        public void UpdateUsageSummary()
        {
            if (_watcher == null) return;
            var (tokens, cost, active) = _watcher.GetActiveUsageSummary();
            string tokensFormatted = tokens >= 1_000_000 ? $"{tokens / 1_000_000.0:0.1}M tokens" :
                                    tokens >= 1_000 ? $"{tokens / 1_000.0:0}k tokens" :
                                    $"{tokens} tokens";

            QueueTokensText.Text = tokensFormatted;
            QueueCostText.Text = $" · ~${cost:0.00}";
            QueueActiveSlotsText.Text = $" ({active} active)";
        }

        private List<QueueItem> ApplyFilter(List<QueueItem> items) => _filter switch
        {
            "Active"   => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or "running")).ToList(),
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
                "queued" or "running" => "Active",
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

        private static string FormatIssueRef(int n) => n < 0 ? $"local #{-n}" : $"#{n}";

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

            foreach (var item in SortForDisplay(items))
            {
                var interactiveState = _watcher?.GetInteractiveState(item.Id);
                bool isWaitingForInput = interactiveState == InteractiveInputState.WaitingForInput;
                var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                var cleanBlockers = blockerList.Where(b => b != 0 && b != item.GithubNumber).ToList();

                int key = item.GithubNumber ?? item.Id;
                _currentGraphNodes.Add(new QueueGraphNode
                {
                    Key = key,
                    DisplayRef = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : $"#{item.Id}",
                    Title = item.Title,
                    Status = item.Status,
                    IsBlocked = cleanBlockers.Count > 0 && item.Status == "queued",
                    IsWaitingForInput = isWaitingForInput,
                    BlockedBy = cleanBlockers,
                    Item = item
                });
            }

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

            // ── 4. Swimlane Allocation DAG Algorithm (#860) ──
            var lanes = new List<int?>();
            int maxLaneCount = 1;
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                node.Row = i;

                int col = lanes.FindIndex(k => k.HasValue && k.Value == node.Key);
                if (col < 0)
                {
                    col = lanes.FindIndex(k => k == null);
                    if (col < 0) { lanes.Add(null); col = lanes.Count - 1; }
                }
                node.Column = col;

                lanes[col] = node.BlockedBy.Count > 0 ? node.BlockedBy[0] : null;

                for (int j = 0; j < lanes.Count; j++)
                {
                    if (j != col && lanes[j].HasValue && lanes[j]!.Value == node.Key)
                        lanes[j] = null;
                }

                for (int bi = 1; bi < node.BlockedBy.Count; bi++)
                {
                    int bKey = node.BlockedBy[bi];
                    if (lanes.Any(k => k.HasValue && k.Value == bKey)) continue;
                    int free = lanes.FindIndex(k => k == null);
                    if (free < 0) lanes.Add(bKey); else lanes[free] = bKey;
                }

                while (lanes.Count > 0 && lanes[lanes.Count - 1] == null) lanes.RemoveAt(lanes.Count - 1);
                maxLaneCount = Math.Max(maxLaneCount, Math.Max(lanes.Count, col + 1));
            }
            _currentMaxLanes = Math.Max(maxLaneCount, 1);

            // ── 5. Build Cards for QueueCardsHost ──
            foreach (var node in _currentGraphNodes)
            {
                if (node.Status == "restart" && node.RestartItem != null)
                {
                    var restartCard = BuildRestartCard(node.RestartItem);
                    node.CardElement = restartCard;
                    QueueCardsHost.Children.Add(restartCard);
                }
                else if (node.Item != null)
                {
                    var card = BuildQueueCard(node);
                    node.CardElement = card;
                    QueueCardsHost.Children.Add(card);
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
            foreach (var node in _currentGraphNodes)
            {
                double cx = QueueLaneX(node.Column);
                double cy = node.CenterY;
                var laneBrush = QueueLaneBrush(node.Column);

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

                for (int bi = 0; bi < node.BlockedBy.Count; bi++)
                {
                    int bKey = node.BlockedBy[bi];
                    if (byKey.TryGetValue(bKey, out var parentNode))
                    {
                        double px = QueueLaneX(parentNode.Column);
                        double py = parentNode.CenterY;
                        var edgeBrush = QueueLaneBrush(bi == 0 ? node.Column : parentNode.Column);

                        if (Math.Abs(px - cx) < 0.5)
                        {
                            QueueGraphCanvas.Children.Add(new System.Windows.Shapes.Line
                            {
                                X1 = cx, Y1 = cy,
                                X2 = px, Y2 = py,
                                Stroke = edgeBrush,
                                StrokeThickness = 2.0
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
                                StrokeThickness = 2.0
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

            Color cardBorderColor = isSelected ? Color.FromRgb(0x89, 0xB4, 0xFA) :
                (isWaitingForInput ? Color.FromRgb(0xF9, 0xE2, 0xAF) :
                (item.Status == "running" ? Color.FromRgb(0x45, 0x5A, 0x82) :
                (isBlocked ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                (item.Status == "done" ? Color.FromRgb(0x2E, 0x52, 0x3E) :
                (item.Status == "failed" ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                Color.FromRgb(0x31, 0x32, 0x44))))));

            Color cardBgColor = isSelected ? Color.FromRgb(0x1B, 0x22, 0x34) :
                (isWaitingForInput ? Color.FromRgb(0x23, 0x1E, 0x18) :
                (item.Status == "running" ? Color.FromRgb(0x15, 0x19, 0x26) :
                (isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) :
                (item.Status == "done" ? Color.FromRgb(0x14, 0x20, 0x1A) :
                Color.FromRgb(0x18, 0x18, 0x25)))));

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
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            };
            AttachBubbleTooltip(titleBlock, item.Title);
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
                mainStack.Children.Add(new TextBlock
                {
                    Text = item.ExitCode == -2 ? "orphaned by app restart — use Retry" : $"exit code {item.ExitCode}",
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
            else
            {
                var miRetry = new MenuItem { Header = "🔄 Retry" };
                miRetry.Click += async (_, _) =>
                {
                    if (_db == null) return;
                    try
                    {
                        var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, null, item.ChatUrl);
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

            return cm;
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
            Failed
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
            Canvas critter = variant switch
            {
                0 => CreateCuteFoxVector(mood),
                1 => CreateCuteBearVector(mood),
                2 => CreateCuteCatVector(mood),
                3 => CreateCuteDuckVector(mood),
                _ => CreateCuteBirdVector(mood)
            };

            Canvas.SetLeft(critter, 3);
            Canvas.SetTop(critter, 3);
            container.Children.Add(critter);

            Color glowColor = mood switch
            {
                CritterMood.Blocked => Color.FromRgb(0xF3, 0x8B, 0xA8),
                CritterMood.WaitingForInput => Color.FromRgb(0xF9, 0xE2, 0xAF),
                CritterMood.Running => Color.FromRgb(0x89, 0xB4, 0xFA),
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
