using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
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

    /// <summary>Git #1636 — every item of a Priority build set has just reached a terminal state
    /// for the first time. Carries the build-set name and the full member list (so the subscriber
    /// can resolve "that build set's chat" itself) for the completion toast.</summary>
    public sealed class BuildSetPriorityCompletedEventArgs : EventArgs
    {
        public string BuildSetName { get; }
        public IReadOnlyList<QueueItem> Items { get; }

        public BuildSetPriorityCompletedEventArgs(string buildSetName, IReadOnlyList<QueueItem> items)
        {
            BuildSetName = buildSetName;
            Items = items;
        }
    }

    /// <summary>Git #1893 — the rollup's per-build-set send button was clicked. Carries the
    /// already-formatted "Git #NNNN — landed" list text for that set's real, current Verifying
    /// items, plus a callback to report the send outcome back on that specific row's own status
    /// text. A callback (rather than a persistent named XAML element like SqlDocumentView's
    /// ExecStatus) because rollup rows are rebuilt from scratch on every RenderBuildSetRollup
    /// call (see BuildRollupRow) rather than being long-lived controls.</summary>
    public sealed class SendBuildSetVerifyingEventArgs : EventArgs
    {
        public string BuildSetName { get; }
        public string Text { get; }
        public Action<string, bool> ShowStatus { get; }

        public SendBuildSetVerifyingEventArgs(string buildSetName, string text, Action<string, bool> showStatus)
        {
            BuildSetName = buildSetName;
            Text = text;
            ShowStatus = showStatus;
        }
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
        /// <summary>Git #1989 — fires on every RefreshAsync with the current count of rows at
        /// AccountCapPolicy.CappedStatus, so MainWindow's title-bar Drain button count stays live
        /// without a second DB poll — same "own panel refresh feeds a title-bar badge" idiom
        /// BatterUpPanel/AiBatterUpPanel's CountChanged already established (Git #1872).</summary>
        public event EventHandler<int>? CappedCountChanged;
        /// <summary>Git #851 — Opens the chat associated to an in-flight issue.</summary>
        public event EventHandler<int>? IssueChatRequested;
        /// <summary>Opens or focuses the Claude chat that created this Build Queue item.</summary>
        public event EventHandler<QueueItem>? QueueItemChatRequested;
        public event EventHandler<int>? EpicSubIssueClicked;
        /// <summary>Git #1994 — "Open Git #N" card context-menu item: reuses MainWindow's
        /// existing OpenGitDetailByNumberAsync (focus-or-fetch, no second issue-opening path).
        /// Tuple carries the real GitHub number plus whether to open it side-by-side.</summary>
        public event EventHandler<(int Number, bool SideBySide)>? OpenGitIssueRequested;
        public event EventHandler? FullGitRefreshRequested;
        /// <summary>Git #1636 — fires exactly once, the moment every build in a Priority-marked
        /// build set reaches a terminal state. See <see cref="CheckPriorityBuildSetCompletion"/>.</summary>
        public event EventHandler<BuildSetPriorityCompletedEventArgs>? BuildSetPriorityCompleted;
        /// <summary>Git #1893 — fires when a rollup row's send button is clicked; MainWindow wires
        /// this to the shared SendTextToActiveClaudeChatAsync path (#937), same pattern as
        /// WireSqlRunnerSendToChat (#940).</summary>
        public event EventHandler<SendBuildSetVerifyingEventArgs>? SendBuildSetVerifyingRequested;
        private bool _isPinned = true;

        private int _refreshGeneration;
        private BuildTrackerApiClient? _api;
        private Services.QueueWatcherService? _watcher;
        private Services.BuildQueuePostgresClient? _db;
        private Services.SessionLimitAutoRestartService? _sessionLimitAutoRestart;
        private DispatcherTimer? _pollTimer;
        private List<QueueItem> _lastItems = new();
        /// <summary>Git #1862 — the live open-issue set from the last Git Board refresh,
        /// forwarded by MainWindow (same free fetch Build Watch already consumes — no new
        /// `gh` call). Null until the first refresh arrives; a real blocker is only counted
        /// as blocking when this set reports it OPEN, and the DAG's 🔒 BLOCKED / the four
        /// header counts both read from it. On a cold start (still null) blocked-ness is
        /// UNKNOWN — the header falls back to the old declared-blocker heuristic and marks
        /// itself provisional (see <see cref="UpdateQueueStatusCounts"/>).</summary>
        private HashSet<int>? _openIssues;
        private string _filter = "Running";
        private readonly HashSet<int> _manuallyHiddenQueueIds = new();
        /// <summary>Git #1834 — set by clicking a row in the build-set rollup summary;
        /// drills the queue graph below down to just that build set. Composes (AND) with
        /// <see cref="_filter"/> and the search box rather than overriding either — see
        /// ApplyFilter. Null = no drill-down active. "Ungrouped" is a valid value here,
        /// matching <see cref="NormalizeBuildSetKey"/>'s bucket name for a null/blank
        /// QueueItem.BuildSet.</summary>
        private string? _buildSetFilter;
        /// <summary>Git #1834 — which rollup rows are showing their expanded per-category
        /// detail. RenderBuildSetRollup fully rebuilds BuildSetRollupList.Children every
        /// call (same reason _knownQueueCardKeys exists for the card list), so this is what
        /// survives across rebuilds instead of relying on the discarded UI elements.</summary>
        private readonly HashSet<string> _expandedRollupSets = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Git #1932 — per-build-set memory of which Verifying issue numbers the rollup's
        /// send (✈) button has already sent, so the same already-reported items don't keep the
        /// button visible/re-sendable forever. In-memory only, deliberately not persisted across
        /// an app restart: a restart means BuildConsole itself is fresh, and Shane re-reading a
        /// "landed" list he already saw in a still-open chat on the next send is a much smaller
        /// cost than a real one going permanently unsent because state loaded stale/wrong across
        /// a restart (e.g. a set renamed/reused between sessions). Keyed by the normalized build
        /// set key (case-insensitive, matching <see cref="_expandedRollupSets"/>).</summary>
        private readonly Dictionary<string, HashSet<int>> _sentVerifyingByBuildSet = new(StringComparer.OrdinalIgnoreCase);
        private const string UngroupedBuildSetKey = "Ungrouped";
        private int? _selectedQueueItemId;
        private static readonly Dictionary<int, string> _issueTitleCache = new();
        private static readonly HashSet<int> _pendingFetches = new();
        /// <summary>Git #1979 — issue numbers `gh` has confirmed do not resolve to any issue/PR in this repo
        /// (a permanent condition, not a transient network/auth/rate-limit blip). Checked alongside
        /// `_issueTitleCache` so a known-bad number isn't re-queried via `gh issue view` on every refresh.</summary>
        private static readonly HashSet<int> _unresolvableIssueNumbers = new();

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
        // Git #1815 — RenderQueue fully rebuilds QueueCardsHost.Children every call, so
        // without remembering which node Keys were already on screen, every card would
        // re-fade-in on every poll tick. Persist the set across renders and only animate
        // a card whose Key genuinely wasn't present last render.
        private HashSet<int> _knownQueueCardKeys = new();
        private bool _hasRenderedQueueOnce = false;
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
        public void Initialize(BuildTrackerApiClient api, Services.QueueWatcherService? watcher = null, Services.BuildQueuePostgresClient? db = null, Services.SessionLimitAutoRestartService? sessionLimitAutoRestart = null)
        {
            _api = api;
            _watcher = watcher;
            _db = db;
            _sessionLimitAutoRestart = sessionLimitAutoRestart;

            if (_watcher != null)
            {
                SyncPauseToggleVisual(_watcher.IsPaused);
                _watcher.PausedStateChanged += (paused) => Dispatcher.BeginInvoke(new Action(() => SyncPauseToggleVisual(paused)));
            }

            // Git #1862 — the QUEUE header no longer reads usage/cost (that badge is gone;
            // its persisted history moved to the title bar, #1864). UsageTrackingService is
            // deliberately left recording, untouched — this panel just no longer subscribes.

            // Sessions presence polling
            _sessionsPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _sessionsPollTimer.Tick += async (_, _) =>
            {
                await RefreshActiveSessionsAsync();
                UpdateQueueStatusCounts();
                DevServerRollbackService.CheckForRollbacks(this);
            };
            _sessionsPollTimer.Start();
            _ = RefreshActiveSessionsAsync();
            UpdateQueueStatusCounts();
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
        // Shane, 2026-08-28: "I need the Issues in Epic panel to hide... don't
        // delete it, I might want it back later." Flip this back to true to
        // restore it — the section, its filter chips, and its list are all
        // still here, just forced Collapsed below regardless of the normal
        // active-epic logic.
        private const bool ShowChatEpicIssuesSection = false;

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

            if (!ShowChatEpicIssuesSection || epicId == null)
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
                CheckPriorityBuildSetCompletion(_lastItems);
                CheckExclusiveBuildSetCompletion(_lastItems);
                ReportActiveBuildSets(_lastItems);

                string restartSignature;
                try { restartSignature = System.Text.Json.JsonSerializer.Serialize(MainWindow.GetPersistedQueueDisplayItems()); }
                catch { restartSignature = ""; }

                var signature = _queueIsStale + "|" + System.Text.Json.JsonSerializer.Serialize(_lastItems) + "|" + restartSignature;
                if (signature != _lastQueueSignature)
                {
                    _lastQueueSignature = signature;
                    if (_filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
                    // Git #1834 — independent of _filter (the rollup summarizes the whole real
                    // queue, not just whatever status the combo/DAG is currently showing).
                    RenderBuildSetRollup(_lastItems);
                }
                if (_filter == "Tests") RenderTestsTree();
                UpdateQueueStatusCounts();
                UpdateOrphanRecoveryBanner();
                CappedCountChanged?.Invoke(this, _lastItems.Count(i => i.Status == Services.AccountCapPolicy.CappedStatus));
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

        private static readonly HashSet<string> PriorityTerminalStatuses =
            new(StringComparer.OrdinalIgnoreCase) { "done", "failed", "canceled" };

        /// <summary>
        /// Git #1636 — the moment every build currently belonging to a Priority-marked build set
        /// has reached a terminal state (done/failed/canceled) for the first time, fires
        /// <see cref="BuildSetPriorityCompleted"/> exactly once and auto-clears that set's
        /// priority flag (a finished wait doesn't need to keep waiting — re-marking is required
        /// for the next wave, per the issue's own stated assumption).
        ///
        /// Deliberately walks the FULL <paramref name="items"/> list from RefreshAsync — not the
        /// filtered list RenderQueue's header loop groups into buildSetBuckets — because the
        /// default "Running" filter drops "done" items entirely; grouping off the filtered view
        /// would mean a finished priority set's bucket goes empty and this would never fire while
        /// Shane is looking at the normal Running tab.
        /// </summary>
        private void CheckPriorityBuildSetCompletion(List<QueueItem> items)
        {
            var prioritySets = Services.BuildSetPriorityStore.AllPrioritySets;
            if (prioritySets.Count == 0) return;

            foreach (var setName in prioritySets)
            {
                var members = items.Where(i => string.Equals((i.BuildSet ?? "").Trim(), setName, StringComparison.OrdinalIgnoreCase)).ToList();
                if (members.Count == 0) continue; // nothing currently known under this name — nothing to declare finished
                if (!members.All(i => PriorityTerminalStatuses.Contains(i.Status))) continue;

                // Clear BEFORE raising: AllPrioritySets is re-read on every RefreshAsync tick, so
                // clearing first guarantees a concurrent/overlapping tick can't observe this set as
                // still-priority and fire a second toast for the same completion.
                Services.BuildSetPriorityStore.SetPriority(setName, false);
                ActivityLog.Log("build-queue-panel.priority",
                    $"Priority build set \"{setName}\" — all {members.Count} member(s) reached a terminal state ({string.Join(", ", members.Select(m => m.Status).Distinct())}). Firing completion notification and auto-clearing priority.");
                BuildSetPriorityCompleted?.Invoke(this, new BuildSetPriorityCompletedEventArgs(setName, members));
            }
        }

        /// <summary>
        /// "Build Only This Set" auto-clear — the moment every build currently belonging to
        /// the exclusive build set has reached a terminal state (done/failed/canceled), lifts
        /// the hold so the queue resumes normal dispatch on its own. Mirrors
        /// <see cref="CheckPriorityBuildSetCompletion"/> exactly, including walking the FULL
        /// <paramref name="items"/> list (not the filtered/grouped view) for the same reason:
        /// the default "Running" filter drops "done" items, so grouping off the filtered view
        /// would mean a finished exclusive set's bucket goes empty and this would never fire.
        /// </summary>
        private void CheckExclusiveBuildSetCompletion(List<QueueItem> items)
        {
            var setName = Services.BuildSetExclusiveStore.ActiveSet;
            if (setName == null) return;

            var members = items.Where(i => string.Equals((i.BuildSet ?? "").Trim(), setName, StringComparison.OrdinalIgnoreCase)).ToList();
            if (members.Count == 0) return; // nothing currently known under this name — nothing to declare finished
            if (!members.All(i => PriorityTerminalStatuses.Contains(i.Status))) return;

            Services.BuildSetExclusiveStore.Clear();
            ActivityLog.Log("build-queue-panel.exclusive",
                $"Exclusive build set \"{setName}\" — all {members.Count} member(s) reached a terminal state ({string.Join(", ", members.Select(m => m.Status).Distinct())}). Auto-clearing exclusive mode; queue resumes normal dispatch.");
            RenderQueue(ApplyFilter(_lastItems));
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
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, resumeSessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
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
        /// Header button — "Recover Session-Limit Builds". Scans every build's raw
        /// stdout log touched in the last hour for the CLI's "hit your session limit ·
        /// resets …" line (or a variation of it) and requeues (resumes, not
        /// restart-from-scratch) whatever it finds, no matter what status the row
        /// actually landed in — the manual counterpart to SessionLimitAutoRestartService's
        /// own reset-timer restart, for a build that died some other way and never got
        /// flagged/parked by the live watcher path.
        /// </summary>
        // Git #2136 — opens the Board Reconcile cleanup/migration window: every local
        // Verifying/Parked/Crashed/limit-paused row against its REAL current GitHub board Status,
        // so a stale local row (the #1867 pattern) can be migrated to the matching board column or
        // dismissed. Non-modal (owned) so Shane can keep working the queue while reviewing.
        private void BtnBoardReconcile_Click(object sender, RoutedEventArgs e)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Board Reconcile", "No direct DB connection — can't read local workflow rows.");
                return;
            }
            var win = new BuildConsole.StaleStateReconcileWindow(_db)
            {
                Owner = Window.GetWindow(this),
            };
            win.Show();
        }

        private async void BtnRecoverSessionLimit_Click(object sender, RoutedEventArgs e)
        {
            if (_sessionLimitAutoRestart == null)
            {
                ToastEngine.Warning("Recover Session-Limit Builds", "Not available (no direct DB connection in this session).");
                return;
            }

            BtnRecoverSessionLimit.IsEnabled = false;
            (List<Services.QueueItem> Resumed, int Scanned) result;
            try
            {
                result = await _sessionLimitAutoRestart.ManualRecoverFromLogsAsync(TimeSpan.FromHours(1));
            }
            catch (Exception ex)
            {
                BtnRecoverSessionLimit.IsEnabled = true;
                ToastEngine.Error("Recover Session-Limit Builds", $"Scan failed: {ex.Message}");
                return;
            }
            BtnRecoverSessionLimit.IsEnabled = true;

            if (result.Resumed.Count == 0)
            {
                ToastEngine.Info("Recover Session-Limit Builds", $"Scanned {result.Scanned} recent build log(s) — none hit the session limit.");
                return;
            }

            var titles = string.Join(", ", result.Resumed.Take(4).Select(i => $"#{i.Id} {i.Title}"));
            if (result.Resumed.Count > 4) titles += $", +{result.Resumed.Count - 4} more";
            ToastEngine.Success("Recover Session-Limit Builds", $"Re-queued {result.Resumed.Count} build{(result.Resumed.Count == 1 ? "" : "s")} for resume: {titles}");
            ActivityLog.Log("build-queue", $"Recover Session-Limit Builds: re-queued {result.Resumed.Count} of {result.Scanned} scanned — {titles}.");
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

        // ── Queue status counts + next-to-run dropdown (Git #1862) ────────────────
        // Replaces the old token/cost badge (which flipped between a context-window
        // ESTIMATE and a real spend total under one label — see #1862 for why it was
        // unfixable). The persisted usage history it used to show now lives in the
        // title bar (#1864); UsageTrackingService is deliberately left untouched here.

        /// <summary>Git #1862 — the same blocker cleanup RenderQueue's node loop applies:
        /// drop the sentinel 0 and any self-reference.</summary>
        private static List<int> CleanBlockers(QueueItem item)
        {
            var raw = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue
                ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            return raw.Where(b => b != 0 && b != item.GithubNumber).ToList();
        }

        /// <summary>
        /// Git #1862 — is a queued item genuinely blocked RIGHT NOW? Blocked means it
        /// declares a blocker the live open-issue set (<see cref="_openIssues"/>) reports
        /// still OPEN — not merely that it declares one (the old heuristic, which painted
        /// 🔒 BLOCKED on items whose blocker closed days ago). Until that set arrives
        /// (_openIssues == null, cold start) blocked-ness is UNKNOWN, so we fail safe to
        /// the old declared-blocker behaviour rather than assert a confident "runnable".
        /// </summary>
        private bool IsGenuinelyBlocked(QueueItem item, List<int> cleanBlockers)
        {
            if (item.Status != "queued") return false;
            if (cleanBlockers.Count == 0) return false;
            if (_openIssues == null) return true; // cold start: provisional-blocked
            return cleanBlockers.Any(b => _openIssues.Contains(b));
        }

        /// <summary>
        /// Git #1862 — forwarded by MainWindow off every Git Board refresh (the same free
        /// open-issue fetch Build Watch already consumes; NO new `gh` call, no new poll).
        /// Stores the set so both the four header counts and the DAG's 🔒 BLOCKED read the
        /// live truth, then redraws so a blocker that just closed drops its lock immediately
        /// instead of waiting for the panel's own 15s poll.
        /// </summary>
        public void ApplyOpenIssueSet(HashSet<int> open)
        {
            if (open == null || open.Count == 0) return; // empty == "couldn't determine", not "all closed"
            _openIssues = open;
            UpdateQueueStatusCounts();
            try { if (QueueGraphContainer != null && _filter != "Tests") RenderQueue(ApplyFilter(_lastItems)); } catch { }
        }

        /// <summary>Git #1862 — the four reconciled buckets shown in the QUEUE header.</summary>
        private readonly struct QueueStatusCounts
        {
            public int InQueue { get; init; }   // queued + limit-paused
            public int Blocked { get; init; }   // non-paused queued with a blocker GitHub reports open
            public int UpNext { get; init; }    // non-paused queued, all blockers closed (real claim candidates)
            public int Verifying { get; init; } // VerifyingStatus rows
            public int ManuallyPaused { get; init; } // queued rows in PausedBuildIds
            public int LimitPaused { get; init; }    // LimitPausedStatus rows
            public bool Provisional { get; init; }   // true on a cold start (no open-issue set yet)
        }

        /// <summary>
        /// Git #1862 — computes the four counts straight off <see cref="_lastItems"/> (the
        /// real queue) + <see cref="_openIssues"/> + PausedBuildIds. Among queued rows the
        /// buckets PARTITION with manually-paused taking precedence (paused rows are set
        /// aside exactly as GetNextAsync filters them out before the blocker check), so
        /// Blocked + UpNext + ManuallyPaused + LimitPaused == InQueue by construction — the
        /// reconciliation the badge must never violate. UpNext therefore equals GetNextAsync's
        /// own candidate set (not paused, every blocker closed).
        /// </summary>
        private QueueStatusCounts ComputeQueueStatusCounts()
        {
            var paused = BuildConsoleSettings.Load().PausedBuildIds;
            int blocked = 0, upNext = 0, manuallyPaused = 0, limitPaused = 0, verifying = 0, queued = 0;
            foreach (var item in _lastItems)
            {
                if (item.Status == BuildQueuePostgresClient.VerifyingStatus) { verifying++; continue; }
                if (item.Status == Services.SessionLimitAutoRestartService.LimitPausedStatus) { limitPaused++; continue; }
                if (item.Status != "queued") continue;

                queued++;
                if (paused.Contains(item.Id)) { manuallyPaused++; continue; }
                if (IsGenuinelyBlocked(item, CleanBlockers(item))) blocked++;
                else upNext++;
            }
            return new QueueStatusCounts
            {
                InQueue = queued + limitPaused,
                Blocked = blocked,
                UpNext = upNext,
                Verifying = verifying,
                ManuallyPaused = manuallyPaused,
                LimitPaused = limitPaused,
                Provisional = _openIssues == null && blocked > 0,
            };
        }

        /// <summary>
        /// Git #1862 — refreshes the QUEUE header: the four reconciled counts on the left and
        /// the unchanged "(N active)" running readout on the right (still sourced from
        /// GetActiveUsageSummary's active-slot count). On a cold start, before the first Git
        /// Board refresh, the Blocked figure is provisional (computed from declared blockers
        /// alone) and is rendered muted with a "*" and an explanatory tooltip rather than as a
        /// confident number.
        /// </summary>
        public void UpdateQueueStatusCounts()
        {
            var c = ComputeQueueStatusCounts();
            var (_, _, active) = _watcher?.GetActiveUsageSummary() ?? (0, 0, 0);

            string blockedText = c.Provisional ? $"{c.Blocked}*" : c.Blocked.ToString();
            QueueStatusCountsText.Text =
                $"In queue: {c.InQueue}  ·  Blocked: {blockedText}  ·  Up next: {c.UpNext}  ·  Verifying: {c.Verifying}";

            if (c.Provisional)
            {
                QueueStatusCountsText.Foreground = (Brush)Application.Current.FindResource("Subtext0Brush");
                QueueStatusBorder.ToolTip = "Blocked count is provisional — waiting for the first Git Board refresh to confirm which blockers are still open. Click for the next builds to run.";
            }
            else
            {
                QueueStatusCountsText.Foreground = (Brush)Application.Current.FindResource("TextBrush");
                QueueStatusBorder.ToolTip = "Live queue status — click for the next builds to run, in real claim order.";
            }

            QueueActiveSlotsText.Text = $" ({active} active)";

            if (QueueNextPopup?.IsOpen == true) _ = RenderNextToRunAsync();
        }

        private async void QueueStatusBorder_Click(object sender, MouseButtonEventArgs e)
        {
            QueueNextPopup.IsOpen = !QueueNextPopup.IsOpen;
            if (QueueNextPopup.IsOpen) await RenderNextToRunAsync();
        }

        /// <summary>
        /// Git #1862 — fills the dropdown with the next five builds the watcher would claim,
        /// in genuine claim order, via <see cref="BuildQueuePostgresClient.PeekNextAsync"/> —
        /// a strictly READ-ONLY peek that claims/mutates nothing and reuses the panel's own
        /// <see cref="_openIssues"/> set (no `gh` call). If that set hasn't arrived yet the
        /// peek reports so and we say it honestly instead of showing an order blockers might
        /// still reorder.
        /// </summary>
        private async Task RenderNextToRunAsync()
        {
            QueueNextHost.Children.Clear();

            if (_db == null)
            {
                QueueNextHost.Children.Add(MakeNextInfoText("Not connected to the queue database."));
                return;
            }

            BuildQueuePostgresClient.PeekResult peek;
            try
            {
                peek = await _db.PeekNextAsync(5, _openIssues);
            }
            catch (Exception ex)
            {
                QueueNextHost.Children.Add(MakeNextInfoText($"Couldn't read the queue: {ex.Message}"));
                return;
            }

            if (!peek.BlockerKnowledgeAvailable)
            {
                QueueNextHost.Children.Add(MakeNextInfoText(
                    "Waiting for the first Git Board refresh to confirm issue status before showing claim order."));
                return;
            }

            if (peek.Items.Count == 0)
            {
                QueueNextHost.Children.Add(MakeNextInfoText("Nothing ready to claim — the queue is empty or fully blocked/paused."));
                return;
            }

            int n = 1;
            foreach (var item in peek.Items)
            {
                QueueNextHost.Children.Add(MakeNextRow(n++, item));
            }
        }

        private TextBlock MakeNextInfoText(string text) => new()
        {
            Text = text,
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
            Margin = new Thickness(0, 2, 0, 2),
        };

        private FrameworkElement MakeNextRow(int ordinal, QueueItem item)
        {
            var row = new DockPanel { LastChildFill = true, Margin = new Thickness(0, 3, 0, 3) };

            var ord = new TextBlock
            {
                Text = $"{ordinal}.",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                Width = 16,
                VerticalAlignment = VerticalAlignment.Top,
            };
            DockPanel.SetDock(ord, Dock.Left);
            row.Children.Add(ord);

            string refText = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : $"#{item.Id}";
            var refBlock = new TextBlock
            {
                Text = refText,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("BlueBrush"),
                Width = 52,
                VerticalAlignment = VerticalAlignment.Top,
            };
            DockPanel.SetDock(refBlock, Dock.Left);
            row.Children.Add(refBlock);

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(item.Title) ? "(untitled)" : item.Title.Trim(),
                FontSize = 11,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
            });
            if (!string.IsNullOrWhiteSpace(item.BuildSet))
            {
                stack.Children.Add(new TextBlock
                {
                    Text = $"set: {item.BuildSet.Trim()}",
                    FontSize = 9.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                });
            }
            row.Children.Add(stack);
            return row;
        }

        private List<QueueItem> ApplyFilter(List<QueueItem> items)
        {
            List<QueueItem> statusFiltered = _filter switch
            {
                // Git #1829 — split from the old combined "Active" filter. "Running" = a build
                // that's actively executing or wrapping up: real running work plus "verifying"
                // (session done, real GitHub issue not yet closed — Git #1469 — stays visible
                // here, not archived into Done, since it's still visually "in motion" work).
                "Running"  => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "running" or BuildQueuePostgresClient.VerifyingStatus)).ToList(),
                // Git #1829 — "Queued" = genuinely not executing right now: real queued rows plus
                // limit-paused (Git #1600 — same practical meaning as queued even though the DB
                // status string differs, waiting to resume later rather than in flight).
                "Queued"   => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus)).ToList(),
                // Git #1894 — combined view added back as a third option alongside the split
                // Running/Queued (Git #1829), reusing that pre-#1829 combined "Active" criteria
                // verbatim: queued + running + LimitPausedStatus + VerifyingStatus.
                "RunningAndQueued" => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or "running" or Services.SessionLimitAutoRestartService.LimitPausedStatus or BuildQueuePostgresClient.VerifyingStatus)).ToList(),
                // Git #1927 — standalone Verifying filter: exactly status == VerifyingStatus,
                // distinct from "Running" above (which folds VerifyingStatus into its broader
                // "in motion" bucket) so a build that's done executing and just waiting on
                // real GitHub-issue verification (Git #1469) is findable on its own.
                "Verifying" => items.Where(i => i.Status == BuildQueuePostgresClient.VerifyingStatus && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1877 — the orphaned-by-crash set: the exact same criteria
                // UpdateOrphanRecoveryBanner/BtnRecoverOrphans_Click already use
                // (status=="failed" && ExitCode==-2), just as a findable filtered view
                // rather than only a banner. Doesn't replace the banner/bulk-recover.
                "Crashed"  => items.Where(i => i.Status == "failed" && i.ExitCode == -2 && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1638 — the Park staging area: a "parked" row is deliberately excluded from
                // Running/Queued above (the watcher's claim query never picks it up either — that's
                // the whole point of a staging spot), so it needs its own filter to be findable at all.
                "Parked"   => items.Where(i => i.Status == "parked" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1989 — Conservation Cap: parked because it exceeded Sonnet High while the
                // toggle was on. Its own filter, distinct from "Parked" above (a different, unrelated
                // staging concept) — must stay findable, not buried.
                "Capped"   => items.Where(i => i.Status == Services.AccountCapPolicy.CappedStatus && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                // Git #1638 — "Send to Builder" tracking rows: never claimable, never in the 8-slot
                // grid, but still real rows that should be findable rather than lost.
                "External" => items.Where(i => i.Status == "external" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                "Done"     => items.Where(i => i.Status == "done" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                "Canceled" => items.Where(i => i.Status == "canceled" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
                _          => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            };

            // Git #1834 — build-set drill-down from the rollup summary. Composes with the
            // status filter above (AND, not override) and with the search box, which
            // filters this method's own result again inside RenderQueue.
            if (_buildSetFilter == null) return statusFiltered;
            return statusFiltered.Where(i => string.Equals(NormalizeBuildSetKey(i.BuildSet), _buildSetFilter, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        /// <summary>Git #1834 — the rollup's bucket key for a QueueItem.BuildSet: a null/blank
        /// value (ungrouped) buckets under the literal "Ungrouped" name rather than being
        /// silently dropped from the rollup.</summary>
        private static string NormalizeBuildSetKey(string? buildSet) =>
            string.IsNullOrWhiteSpace(buildSet) ? UngroupedBuildSetKey : buildSet.Trim();

        /// <summary>Git #1920 — declare to <see cref="Services.BuildSetColorRegistry"/> which
        /// named build sets the queue is currently showing, so it can coordinate a
        /// collision-free accent color per set and free a color once its set drops out of the
        /// queue. "Active/visible" here matches the rollup: a set with any queued / running /
        /// verifying item. The "Ungrouped" pseudo-set is excluded — it draws in Subtext0, not a
        /// palette color, so it never competes for one.</summary>
        private static void ReportActiveBuildSets(List<QueueItem> items)
        {
            var active = items
                .Where(i => i.Status is "queued" or "running"
                             or Services.SessionLimitAutoRestartService.LimitPausedStatus
                             or BuildQueuePostgresClient.VerifyingStatus)
                .Select(i => i.BuildSet)
                .Where(bs => !string.IsNullOrWhiteSpace(bs))
                .Select(bs => bs!.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase);
            Services.BuildSetColorRegistry.ReportActive("queue", active);
        }

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
                "running" or BuildQueuePostgresClient.VerifyingStatus                              => "Running",
                "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus               => "Queued",
                "failed" when item.ExitCode == -2                                                    => "Crashed",
                "parked"              => "Parked",
                Services.AccountCapPolicy.CappedStatus => "Capped",
                "external"            => "External",
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

            if (QueueGraphContainer != null && _filter != "Tests")
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
            _filter = selected.Tag as string ?? "Running";
            if (QueueGraphContainer == null) return;

            if (_filter == "Tests") RenderTestsTree();
            else RenderQueue(ApplyFilter(_lastItems));
        }

        private string _queueSearch = "";

        // Git #2028 — Shane: even the #1833 debounce still fires mid-type (just delayed
        // until a settled pause). Real requirement is genuine submit-on-Enter — typing
        // "1234" does nothing until Enter is pressed, then it searches exactly once.
        // TextChanged only tracks the raw text (for the placeholder DataTrigger binding);
        // it never itself triggers ApplyFilter/RenderQueue.
        private void QueueSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _queueSearch = QueueSearchBox.Text ?? "";
        }

        private void QueueSearchBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;
            if (QueueGraphContainer == null || _filter == "Tests") return;
            RenderQueue(ApplyFilter(_lastItems));
            // Git #2058 — a search performed while a Build Set filter is active can come back
            // empty (or short) not because no match exists, but because the real match is
            // filtered out of view — same root cause as the dispatch trigger below.
            ShowBuildSetFilterWarning("Search");
            e.Handled = true;
        }

        private DispatcherTimer? _buildSetFilterWarningTimer;

        /// <summary>Git #2058 — shared entry point for both trigger points named in the issue:
        /// a search run here (see QueueSearchBox_KeyDown above) and a build dispatched elsewhere
        /// (DispatchPanel → MainWindow → here, see <see cref="NotifyBuildDispatched"/>). No-op
        /// when no Build Set filter is active — the whole point is to explain a filter Shane may
        /// not remember is on, not to warn unconditionally. Uses the Popup declared in the XAML
        /// (BuildSetFilterWarningPopup) rather than an inline Border, since a Popup renders in
        /// its own overlay layer and genuinely cannot bump/reflow the rest of the panel — the
        /// issue's explicit requirement.</summary>
        private void ShowBuildSetFilterWarning(string reason)
        {
            if (_buildSetFilter == null || BuildSetFilterWarningPopup == null) return;

            BuildSetFilterWarningText.Text = reason == "Search"
                ? $"Filtered to \"{_buildSetFilter}\" — a real match may be hidden by this filter."
                : $"New build landed outside the current filter — Build Set: {_buildSetFilter}";
            BuildSetFilterWarningPopup.IsOpen = true;

            _buildSetFilterWarningTimer?.Stop();
            _buildSetFilterWarningTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
            _buildSetFilterWarningTimer.Tick += (s, e) =>
            {
                _buildSetFilterWarningTimer?.Stop();
                BuildSetFilterWarningPopup.IsOpen = false;
            };
            _buildSetFilterWarningTimer.Start();
        }

        /// <summary>Git #2058 — MainWindow calls this after a successful dispatch (DispatchPanel's
        /// own <c>Dispatched</c> event, which only fires on success) so the sibling queue panel can
        /// warn if the item it just queued may be hidden by an active Build Set filter. Public
        /// because DispatchPanel is a separate sibling control with no knowledge of this panel's
        /// private filter state.</summary>
        public void NotifyBuildDispatched() => ShowBuildSetFilterWarning("Dispatch");

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

            // Git #1833 — the broad "All" view (default ApplyFilter case) with an empty
            // search box matches hundreds of items nobody scrolls through; Shane always
            // searches by number directly instead. Skip the whole swimlane/DAG + card
            // build for that specific case and show a placeholder instead. The already-
            // narrow filters (Running/Queued/Parked/etc.) are untouched — they keep
            // rendering their own (small) contents normally with empty search.
            bool isBroadUnsearchedView = !searching && _filter == "All" && _buildSetFilter == null;
            if (isBroadUnsearchedView)
            {
                QueueGraphContainer.Visibility = Visibility.Collapsed;
                QueueCardsHost.Children.Clear();
                QueueGraphCanvas.Children.Clear();
                _currentGraphNodes.Clear();
                QueueEmptyText.Visibility = Visibility.Collapsed;
                QueueBroadFilterPlaceholderText.Visibility = Visibility.Visible;
                UpdateCritterLoungeVisibility();
                return;
            }
            QueueBroadFilterPlaceholderText.Visibility = Visibility.Collapsed;

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

            // Git #1815 — snapshot what was known before this rebuild, then start a fresh
            // set to populate as cards are (re)built below.
            var previousKnownQueueCardKeys = _knownQueueCardKeys;
            var thisRenderQueueCardKeys = new HashSet<int>();

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
                    // Git #1862 — blocked means a declared blocker GitHub reports OPEN, not
                    // merely one declared (the old heuristic left 🔒 BLOCKED on items whose
                    // blocker closed days ago). Cold start (no open-issue set yet) falls back
                    // to declared-blocker behaviour, matching the header's provisional count.
                    IsBlocked = IsGenuinelyBlocked(item, cleanBlockers),
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

            // Git #1825 — Shane: an entirely-blocked build set (every node blocked)
            // was rendering above a set with real active work happening, because
            // buildSetOrder above is pure first-seen order with zero awareness of
            // status. Re-sort it (stably — OrderBy preserves first-seen order as the
            // tiebreaker) so any set containing at least one non-blocked/active node
            // renders before a set where every node is blocked. This only reorders
            // which build-set SECTION comes first; OrderByDependency itself and the
            // node order/lane assignment within a single set (#1760) are untouched.
            var orderedBuildSets = buildSetOrder
                .OrderBy(setName => buildSetBuckets[setName].All(n => n.IsBlocked) ? 1 : 0);

            _currentGraphNodes.AddRange(OrderByDependency(ungroupedNodes));
            foreach (var setName in orderedBuildSets)
                _currentGraphNodes.AddRange(OrderByDependency(buildSetBuckets[setName]));

            QueueEmptyText.Visibility = _currentGraphNodes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = searching
                ? $"No queued item matches #{search}."
                : _filter switch
                {
                    "Running"  => "Nothing running.",
                    "Queued"   => "Nothing queued.",
                    "Crashed"  => "Nothing crashed.",
                    "Done"     => "Nothing done yet.",
                    "Canceled" => "Nothing canceled.",
                    _          => "Queue is empty.",
                };
            // Git #1834 — the build-set drill-down composes with the filter/search above
            // rather than replacing their own empty-state text, so name it too when it's
            // the reason the combined result is empty.
            if (_buildSetFilter != null && _currentGraphNodes.Count == 0)
                QueueEmptyText.Text += $" (build set \"{_buildSetFilter}\")";

            if (_currentGraphNodes.Count == 0)
            {
                QueueGraphCanvas.Children.Clear();
                UpdateCritterLoungeVisibility();
                return;
            }

            // ── 4. Swimlane Allocation DAG Algorithm (#860, reworked; fork lane reuse
            // added by #1760) ──
            // Nodes now arrive parent-before-child (OrderByDependency above), so by the
            // time a node is processed its blocker's column is already known — no more
            // "reserve this lane for a key I haven't seen yet" trick the old top-down
            // algorithm needed. Root/unblocked items always land in lane 0 and STAY
            // there (TrunkOwner never gets displaced), which is what makes lane 0 the
            // continuous main trunk RedrawQueueGraph draws a solid green line through.
            // A blocked node either continues straight down its (single, first) parent's
            // lane — if it's the first child to claim it — or branches into a fresh lane
            // when a sibling already has (a fork, multiple items freed by one blocker).
            //
            // #1760 — Shane: the DAG's connector lines look tangled/crossing, worse with
            // more builds and more blockers. An off-screen harness (BuildQueuePanel
            // constructed with no Window shown, real synthetic QueueItem sets fed through
            // this exact RenderQueue path) confirmed the cause, and it's worse than the
            // "first available slot may be far from the parent" theory the issue opened
            // with: `lanes[col]` was NEVER set back to null anywhere once a lane was
            // claimed, so `lanes.FindIndex(k => k == null)` could never find anything —
            // every fork (and every non-trunk-continuing child at all, since lane 0 never
            // holds a real key) permanently grabbed a brand-new lane at the far right,
            // monotonically, for the rest of that render. A synthetic queue of 14
            // independent 4-way-fork chains (70 nodes) measured 57 lanes, with forks
            // landing an average of 28.5 lanes from their own parent and only 1 of 56
            // within a single lane of it — exactly the "gets worse with scale" shape
            // Shane described. The fix: track the last row each key is ever claimed as a
            // parent (precomputed below, order-only — doesn't touch column assignment)
            // and free that key's lane the moment its last child has been placed, so a
            // later fork can reuse a nearby freed lane instead of the graph only ever
            // growing wider. Lane 0 (TrunkOwner) is never a real key here, so it can never
            // be freed by this — the trunk stays exactly as before.
            const int TrunkOwner = int.MinValue;

            var seenKeys = new HashSet<int>();
            var effectiveParentByRow = new int?[_currentGraphNodes.Count];
            var lastChildRowForKey = new Dictionary<int, int>();
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                int? pk = null;
                foreach (var b in node.BlockedBy) { if (seenKeys.Contains(b)) { pk = b; break; } }
                effectiveParentByRow[i] = pk;
                if (pk.HasValue) lastChildRowForKey[pk.Value] = i; // last write wins = last row
                seenKeys.Add(node.Key);
            }

            var lanes = new List<int?> { TrunkOwner };
            var columnByKey = new Dictionary<int, int>();
            int maxLaneCount = 1;
            for (int i = 0; i < _currentGraphNodes.Count; i++)
            {
                var node = _currentGraphNodes[i];
                node.Row = i;

                int? parentKey = effectiveParentByRow[i];
                bool continuesParentLane = false;

                int col;
                if (parentKey == null)
                {
                    col = 0;
                    lanes[0] = TrunkOwner;
                }
                else
                {
                    int parentCol = columnByKey[parentKey.Value];
                    continuesParentLane = parentCol < lanes.Count && lanes[parentCol] == parentKey.Value;
                    if (continuesParentLane)
                    {
                        col = parentCol;
                    }
                    else
                    {
                        // Nearest free lane to the parent's own column, not strictly the
                        // first free lane from the left — a fork should land visually
                        // close to where it branched rather than wherever an unrelated
                        // earlier chain happened to free up first.
                        col = -1;
                        int bestDist = int.MaxValue;
                        for (int li = 0; li < lanes.Count; li++)
                        {
                            if (lanes[li] != null) continue;
                            int dist = Math.Abs(li - parentCol);
                            if (dist < bestDist) { bestDist = dist; col = li; }
                        }
                        if (col < 0) { lanes.Add(null); col = lanes.Count - 1; }
                    }
                    lanes[col] = node.Key;
                }

                node.Column = col;
                columnByKey[node.Key] = col;

                // A lane becomes reusable the moment nothing further will ever need to
                // continue from it. Two cases:
                // (a) this node itself will never have children of its own (a fork leaf —
                //     nothing ever lists it in BlockedBy) — free its own just-claimed lane
                //     right away, so the very next fork can reuse it instead of the graph
                //     only ever growing wider;
                // (b) this node was the last child anything will ever claim from its
                //     parent's lane, AND it didn't inherit that lane by continuing straight
                //     down it (a genuine fork elsewhere) — the parent's lane then has
                //     nothing left pointing at it either, so free that one too.
                // Lane 0 (trunk) is excluded from both — TrunkOwner is never a real key, so
                // it can never appear in BlockedBy and case (b)'s guard leaves it alone.
                if (col != 0 && !lastChildRowForKey.ContainsKey(node.Key))
                {
                    lanes[col] = null;
                }
                if (parentKey.HasValue && !continuesParentLane && lastChildRowForKey[parentKey.Value] == i)
                {
                    int ownerCol = columnByKey[parentKey.Value];
                    if (ownerCol != 0) lanes[ownerCol] = null; // never free the trunk lane
                }

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
                        // Git #1636 — Shane: "waiting on his priority build set... he wants a
                        // critter + distinct border" so a set he's actually waiting on reads
                        // differently at a glance from the rest while he tinkers elsewhere.
                        bool isPriority = Services.BuildSetPriorityStore.IsPriority(node.BuildSet);
                        // "Build Only This Set" — see Services.BuildSetExclusiveStore. Exclusive
                        // styling wins over Priority's when both happen to be set on the same
                        // build set, since exclusive is the stronger, dispatch-affecting state.
                        bool isExclusive = Services.BuildSetExclusiveStore.IsExclusive(node.BuildSet);

                        var setContainer = new Border
                        {
                            BorderBrush = isExclusive
                                ? (Brush)Application.Current.FindResource("RedBrush")
                                : isPriority
                                    ? (Brush)Application.Current.FindResource("PeachBrush")
                                    : (Brush)Application.Current.FindResource("MauveBrush"),
                            BorderThickness = new Thickness(isExclusive || isPriority ? 2.5 : 1),
                            CornerRadius = new CornerRadius(6),
                            Background = isExclusive
                                ? new SolidColorBrush(Color.FromArgb(0x16, 0xF3, 0x8B, 0xA8))
                                : isPriority
                                    ? new SolidColorBrush(Color.FromArgb(0x16, 0xFA, 0xB3, 0x87))
                                    : new SolidColorBrush(Color.FromArgb(0x0A, 0xCB, 0xA6, 0xF7)),
                            Margin = new Thickness(0, 8, 0, 8),
                            Padding = new Thickness(8, 6, 8, 6),
                            HorizontalAlignment = HorizontalAlignment.Stretch,
                            ContextMenu = BuildBuildSetHeaderContextMenu(node.BuildSet, isPriority)
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
                        if (isExclusive)
                        {
                            headerLabel.Children.Add(new TextBlock
                            {
                                Text = " 🔒",
                                FontSize = 12,
                                FontWeight = FontWeights.Bold,
                                Foreground = (Brush)Application.Current.FindResource("RedBrush"),
                                VerticalAlignment = VerticalAlignment.Center,
                                ToolTip = $"Exclusive — the queue holds every other build set until every build in \"{node.BuildSet}\" finishes."
                            });
                        }
                        else if (isPriority)
                        {
                            // Reuses the same "⭐" glyph IssueChompAnimation's milestone parade
                            // already decorates a marching mascot with — not a new asset.
                            headerLabel.Children.Add(new TextBlock
                            {
                                Text = " ⭐",
                                FontSize = 12,
                                FontWeight = FontWeights.Bold,
                                Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
                                VerticalAlignment = VerticalAlignment.Center,
                                ToolTip = $"Priority — a persistent notification fires the moment every build in \"{node.BuildSet}\" finishes."
                            });
                        }
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

                // Shane: "why are there like ghosts in the empty queue" — _currentGraphNodes
                // (and its connector lines/dots, drawn later by RedrawQueueGraph) is fully built
                // BEFORE this card-building loop runs. An uncaught exception from any one card
                // used to abort this loop entirely, leaving every node after the failure with a
                // real graph line/dot but no card next to it — exactly that "ghost" look. One
                // bad card must never orphan the rest of the render.
                Border? cardElement = null;
                try
                {
                    if (node.Status == "restart" && node.RestartItem != null)
                    {
                        cardElement = BuildRestartCard(node.RestartItem);
                    }
                    else if (node.Item != null)
                    {
                        cardElement = BuildQueueCard(node);
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.critters", $"Card build failed for {node.DisplayRef} — skipping this card rather than orphaning the rest of the queue render: {ex.Message}");
                    cardElement = null;
                }

                if (cardElement != null)
                {
                    node.CardElement = cardElement;
                    thisRenderQueueCardKeys.Add(node.Key);
                    bool isNewCard = _hasRenderedQueueOnce && !previousKnownQueueCardKeys.Contains(node.Key);

                    if (currentSetPanel != null)
                    {
                        cardElement.Margin = new Thickness(0, 2, 0, 2);
                        currentSetPanel.Children.Add(cardElement);
                    }
                    else
                    {
                        QueueCardsHost.Children.Add(cardElement);
                    }

                    if (isNewCard)
                    {
                        AnimateNewQueueCardIn(cardElement);
                    }
                }
            }

            _knownQueueCardKeys = thisRenderQueueCardKeys;
            _hasRenderedQueueOnce = true;

            // ── 6. Trigger Canvas Redraw on Layout ──
            Dispatcher.InvokeAsync(RedrawQueueGraph, DispatcherPriority.Loaded);
            UpdateCritterLoungeVisibility();
        }

        /// <summary>
        /// Git #1815 — Shane: new cards "just pop in instantly and shove everything else
        /// out of the way." Reuses UiFadeHelper's opacity fade for the card itself, and
        /// grows the card's own Height from 0 up to its real measured size alongside it
        /// so WPF's normal layout pass naturally reflows the surrounding siblings — no
        /// separate per-sibling slide/position system needed to get the "make room" feel.
        /// Card starts at Height 0 / Opacity 0 before it's ever visible, so there's no
        /// flash of the fully-sized card before the animation begins.
        /// </summary>
        private void AnimateNewQueueCardIn(Border cardElement)
        {
            const double durationMs = 170;

            double measureWidth = QueueCardsHost.ActualWidth > 0 ? QueueCardsHost.ActualWidth : double.PositiveInfinity;
            cardElement.Measure(new Size(measureWidth, double.PositiveInfinity));
            double targetHeight = cardElement.DesiredSize.Height;

            cardElement.Height = 0;
            cardElement.ClipToBounds = true;
            UiFadeHelper.FadeIn(cardElement, durationMs);

            if (targetHeight > 0)
            {
                var heightAnim = new DoubleAnimation(0, targetHeight, TimeSpan.FromMilliseconds(durationMs))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                heightAnim.Completed += (s, e) =>
                {
                    cardElement.BeginAnimation(FrameworkElement.HeightProperty, null);
                    cardElement.Height = double.NaN;
                    cardElement.ClipToBounds = false;
                };
                cardElement.BeginAnimation(FrameworkElement.HeightProperty, heightAnim);
            }
            else
            {
                // Couldn't get a real measured height (e.g. host not laid out yet) —
                // don't leave the card permanently pinned at Height 0.
                cardElement.Height = double.NaN;
                cardElement.ClipToBounds = false;
            }
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
        /// <summary>Git #1636 — right-click menu on a build-set group header offering the single
        /// "Mark as Priority" / "Unmark Priority" toggle. Re-renders the queue immediately on click
        /// so the critter + border reflect the new state without waiting for the next poll tick.</summary>
        private ContextMenu BuildBuildSetHeaderContextMenu(string buildSetName, bool isPriority)
        {
            var cm = new ContextMenu();
            var mi = new MenuItem { Header = isPriority ? "☆ Unmark Priority" : "⭐ Mark as Priority" };
            mi.Click += (_, _) =>
            {
                bool newState = !isPriority;
                Services.BuildSetPriorityStore.SetPriority(buildSetName, newState);
                ActivityLog.Log("build-queue-panel.priority", $"Build set \"{buildSetName}\" {(newState ? "marked" : "unmarked")} Priority.");
                RenderQueue(ApplyFilter(_lastItems));
            };
            cm.Items.Add(mi);

            // "Build Only This Set" — puts the queue dispatcher into an exclusive hold (see
            // Services.BuildSetExclusiveStore / BuildQueuePostgresClient.SelectClaimCandidatesAsync):
            // only members of this build set are eligible to claim a free slot until every
            // member reaches a terminal state (auto-clears) or Shane clears it manually. Only
            // one set can be exclusive at a time, so marking a different one silently replaces it.
            bool isExclusive = Services.BuildSetExclusiveStore.IsExclusive(buildSetName);
            var exclusiveItem = new MenuItem
            {
                Header = isExclusive ? "🔓 Clear Exclusive Mode" : "🔒 Build Only This Set",
                ToolTip = isExclusive
                    ? $"Stop holding every other build set — let the queue resume dispatching normally."
                    : $"Hold every OTHER build set — the queue will only dispatch \"{buildSetName}\" until it finishes."
            };
            exclusiveItem.Click += (_, _) =>
            {
                if (isExclusive)
                {
                    Services.BuildSetExclusiveStore.Clear();
                    ActivityLog.Log("build-queue-panel.exclusive", $"Build set \"{buildSetName}\" — exclusive mode cleared; queue resumes normal dispatch.");
                }
                else
                {
                    Services.BuildSetExclusiveStore.SetExclusive(buildSetName);
                    ActivityLog.Log("build-queue-panel.exclusive", $"Build set \"{buildSetName}\" marked exclusive — queue will hold every other build set until it finishes.");
                }
                RenderQueue(ApplyFilter(_lastItems));
            };
            cm.Items.Add(exclusiveItem);

            return cm;
        }

        /// <summary>Git #1920 — accent brush for a build set. Delegates to
        /// <see cref="Services.BuildSetColorRegistry"/>, which coordinates a collision-free
        /// color among all currently-active build sets (see <see cref="ReportActiveBuildSets"/>)
        /// rather than the old stateless <c>hash % 10</c> that let two distinct sets collide.</summary>
        public static Brush GetBuildSetBrush(string buildSetName)
            => Services.BuildSetColorRegistry.GetBrush(buildSetName);

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

            // Git #1920 — past the 10th simultaneously-active build set the palette is
            // exhausted and this set's color may be shared with another. Layer on a secondary
            // differentiator so color isn't the only cue: a dashed accent underline and a
            // "shared color" note. In the normal (≤10 active) case this is false and the header
            // draws exactly as before.
            bool sharedColor = Services.BuildSetColorRegistry.IsColorShared(buildSetName);

            var header = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(0x22, accentColor.R, accentColor.G, accentColor.B)),
                BorderBrush = accentBrush,
                BorderThickness = new Thickness(1, 1, 1, 0),
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Padding = new Thickness(8, 4, 8, 3),
                Margin = new Thickness(0, 8, 0, 0)
            };
            var stack = new StackPanel { Orientation = Orientation.Vertical };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(new TextBlock
            {
                Text = sharedColor ? "▦ " : "▤ ",
                FontSize = 11,
                Foreground = accentBrush,
                VerticalAlignment = VerticalAlignment.Center
            });
            string tip = sharedColor
                ? $"Build Set \"{buildSetName}\" — merges + restarts together as one wave. " +
                  "More than 10 build sets are active at once, so its color is shared with " +
                  "another set — read the name, not just the color."
                : $"Build Set \"{buildSetName}\" — merges + restarts together as one wave";
            row.Children.Add(new TextBlock
            {
                Text = buildSetName,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = accentBrush,
                TextWrapping = TextWrapping.Wrap,
                ToolTip = tip
            });
            if (sharedColor)
            {
                row.Children.Add(new TextBlock
                {
                    Text = "  ⚠ shared color",
                    FontSize = 9.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = tip
                });
            }
            stack.Children.Add(row);
            if (sharedColor)
            {
                // Dashed accent underline — a shape-based cue that survives two sets sharing
                // the same solid accent color.
                stack.Children.Add(new System.Windows.Shapes.Rectangle
                {
                    Height = 2,
                    Margin = new Thickness(0, 3, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    Stroke = accentBrush,
                    StrokeThickness = 2,
                    StrokeDashArray = new DoubleCollection(new double[] { 2, 2 })
                });
            }
            header.Child = stack;
            return header;
        }

        /// <summary>Git #1834 — collapsible per-buildSet rollup summary. Rebuilds
        /// BuildSetRollupList from scratch off the real, current <paramref name="items"/> every
        /// call (cheap — a handful of build sets, not the whole DAG). Buckets are "up next"
        /// (queued + limit-paused), "running" (running only) and "verifying"
        /// (BuildQueuePostgresClient.VerifyingStatus) — a finer split than QueueFilterCombo's
        /// own Running/Queued (#1829 folds verifying into Running), because Shane's own example
        /// line names all three separately. A build set whose three counts are all zero is
        /// dropped entirely — done/canceled/parked/external members don't count as "current
        /// activity" — so a set with nothing going on right now never clutters this. Real named
        /// sets sort alphabetically; the null/blank-BuildSet bucket renders last as "Ungrouped",
        /// and only when it too has real activity. The whole section hides itself
        /// (BuildSetRollupSection) when there is nothing to show, so an idle queue doesn't grow
        /// this back into dead space.</summary>
        private void RenderBuildSetRollup(List<QueueItem> items)
        {
            if (BuildSetRollupSection == null || BuildSetRollupList == null) return;

            var buckets = new Dictionary<string, (List<int> upNext, List<int> running, List<int> verifying, List<QueueItem> members)>(StringComparer.OrdinalIgnoreCase);
            var bucketOrder = new List<string>();
            foreach (var item in items)
            {
                if (_manuallyHiddenQueueIds.Contains(item.Id)) continue;
                string key = NormalizeBuildSetKey(item.BuildSet);
                if (!buckets.TryGetValue(key, out var counts))
                {
                    counts = (new List<int>(), new List<int>(), new List<int>(), new List<QueueItem>());
                    buckets[key] = counts;
                    bucketOrder.Add(key);
                }
                int refNum = item.GithubNumber ?? item.Id;
                if (item.Status is "queued" or Services.SessionLimitAutoRestartService.LimitPausedStatus) counts.upNext.Add(refNum);
                else if (item.Status == "running") counts.running.Add(refNum);
                else if (item.Status == BuildQueuePostgresClient.VerifyingStatus) counts.verifying.Add(refNum);
                else continue;
                counts.members.Add(item);
            }

            var orderedKeys = bucketOrder
                .Where(k => buckets[k].upNext.Count + buckets[k].running.Count + buckets[k].verifying.Count > 0)
                .OrderBy(k => string.Equals(k, UngroupedBuildSetKey, StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

            BuildSetRollupList.Children.Clear();
            BuildSetRollupSection.Visibility = orderedKeys.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
            BuildSetRollupClearText.Visibility = _buildSetFilter != null ? Visibility.Visible : Visibility.Collapsed;
            BuildSetRollupClearText.Text = _buildSetFilter != null ? $"Showing: {_buildSetFilter} ✕" : "";

            foreach (var key in orderedKeys)
            {
                var counts = buckets[key];
                BuildSetRollupList.Children.Add(BuildRollupRow(key, counts.upNext, counts.running, counts.verifying, counts.members));
            }
        }

        /// <summary>One collapsed summary line per build set (Shane's own example format:
        /// "&lt;set&gt; — N up next, M running, K verifying (#1234, #1235)"), with issue numbers
        /// shown next to "verifying" specifically — his stated example, and the most actionable
        /// of the three (session done, waiting on a real GitHub issue close). The chevron on the
        /// right is a SEPARATE click target from the row body: clicking it only expands/collapses
        /// this row's own full per-category breakdown (with numbers for all three counts);
        /// clicking the row body drills the queue graph below down to this build set via
        /// ToggleBuildSetFilter. The two never fight over one click because WPF's ButtonBase
        /// marks its own MouseLeftButtonUp handled before it bubbles to the row's
        /// MouseLeftButtonDown handler (same nested-click pattern the queue cards below already
        /// rely on for their own context-menu buttons).</summary>
        private UIElement BuildRollupRow(string buildSetKey, List<int> upNext, List<int> running, List<int> verifying, List<QueueItem> members)
        {
            bool isUngrouped = string.Equals(buildSetKey, UngroupedBuildSetKey, StringComparison.OrdinalIgnoreCase);
            var accentBrush = isUngrouped ? (Brush)Application.Current.FindResource("Subtext0Brush") : GetBuildSetBrush(buildSetKey);
            var accentColor = accentBrush is SolidColorBrush scb ? scb.Color : Color.FromRgb(0x6C, 0x70, 0x86);
            bool isSelected = string.Equals(_buildSetFilter, buildSetKey, StringComparison.OrdinalIgnoreCase);
            bool isExpanded = _expandedRollupSets.Contains(buildSetKey);

            var wrapper = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };

            var headerBorder = new Border
            {
                Background = isSelected
                    ? new SolidColorBrush(Color.FromArgb(0x33, accentColor.R, accentColor.G, accentColor.B))
                    : (Brush)Application.Current.FindResource("Surface0Brush"),
                BorderBrush = isSelected ? accentBrush : (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 5, 6, 5),
                Cursor = Cursors.Hand,
                ToolTip = isSelected
                    ? $"Click to clear the \"{buildSetKey}\" filter on the queue below"
                    : $"Click to filter the queue below down to \"{buildSetKey}\" (combines with the status filter + search box above)"
            };

            var headerGrid = new Grid();
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var summaryText = new TextBlock { TextWrapping = TextWrapping.Wrap, FontSize = 11, VerticalAlignment = VerticalAlignment.Center };
            summaryText.Inlines.Add(new System.Windows.Documents.Run($"{buildSetKey} — ") { FontWeight = FontWeights.SemiBold, Foreground = accentBrush });
            summaryText.Inlines.Add(new System.Windows.Documents.Run($"{upNext.Count} up next, {running.Count} running, {verifying.Count} verifying")
            {
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush")
            });
            if (verifying.Count > 0)
            {
                summaryText.Inlines.Add(new System.Windows.Documents.Run($" ({string.Join(", ", verifying.Select(FormatIssueRef))})")
                {
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    FontSize = 10.5
                });
            }
            Grid.SetColumn(summaryText, 0);
            headerGrid.Children.Add(summaryText);

            // Git #1932 — only the Verifying items this build set hasn't already sent count
            // toward whether the send button shows/what it sends. _sentVerifyingByBuildSet is
            // never mutated here — TryGetValue + Except gives the unsent subset without side
            // effects, so re-rendering this row (RenderBuildSetRollup runs on every refresh) never
            // itself marks anything as sent.
            var alreadySent = _sentVerifyingByBuildSet.TryGetValue(buildSetKey, out var sentSet) ? sentSet : null;
            var unsentVerifying = alreadySent == null ? verifying : verifying.Where(n => !alreadySent.Contains(n)).ToList();

            // Git #1893/#1932 — "send this set's not-yet-sent Verifying items as a landed-list to
            // the active chat" button. Only rendered when there's something real and NEW to send
            // (#1893 requirement 3, extended by #1932: a build set with zero unsent Verifying
            // items doesn't offer a broken/empty/re-send) — rather than rendering a disabled
            // button, it's simply absent.
            Button? sendButton = null;
            if (unsentVerifying.Count > 0)
            {
                sendButton = new Button
                {
                    Content = "✈",
                    FontSize = 12,
                    Padding = new Thickness(5, 1, 5, 2),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Cursor = Cursors.Hand,
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    ToolTip = $"Send {buildSetKey}'s {unsentVerifying.Count} not-yet-sent verifying item(s) as a landed-list to the active chat"
                };
                Grid.SetColumn(sendButton, 1);
                headerGrid.Children.Add(sendButton);
            }

            var chevron = new ToggleButton
            {
                Style = (Style)Application.Current.FindResource("ExpandCollapseToggleStyle"),
                IsChecked = isExpanded,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
                ToolTip = "Expand for the full per-category breakdown"
            };
            Grid.SetColumn(chevron, 2);
            headerGrid.Children.Add(chevron);

            headerBorder.Child = headerGrid;
            wrapper.Children.Add(headerBorder);

            // Git #1893 — brief send-outcome status, same purpose as SqlDocumentView's ExecStatus
            // strip (#940) but scoped to this one row (rows are rebuilt from scratch every
            // RenderBuildSetRollup call, so there's no persistent named element to reuse). Hidden
            // until a send is attempted, then auto-hides itself after a few seconds.
            var statusText = new TextBlock
            {
                FontSize = 10,
                Margin = new Thickness(2, 2, 2, 0),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed
            };
            wrapper.Children.Add(statusText);

            if (sendButton != null)
            {
                sendButton.Click += (s, e) =>
                {
                    // Git #1932 — snapshot the not-yet-sent set at click time; the closure below
                    // marks exactly these as sent on success, never the row's full `verifying`
                    // list (which may include items an earlier send already reported).
                    var toSend = unsentVerifying;
                    string text = string.Join("\n", toSend.Select(n => $"Git {FormatIssueRef(n)} — landed"));
                    ActivityLog.Log("build-queue.rollup-send-to-chat", $"send-clicked: {buildSetKey}, {toSend.Count} not-yet-sent verifying item(s)");
                    SendBuildSetVerifyingRequested?.Invoke(this, new SendBuildSetVerifyingEventArgs(buildSetKey, text, (msg, isError) =>
                    {
                        bool justSent = false;
                        if (!isError)
                        {
                            // Git #1932 — mark sent immediately on a real successful send (not
                            // deferred to the re-render below), so the button's visibility on the
                            // NEXT render is already correct even if something else triggers a
                            // rebuild before this row's own timer fires. A failed send marks
                            // nothing, leaving the button visible/re-sendable.
                            if (!_sentVerifyingByBuildSet.TryGetValue(buildSetKey, out var sent))
                            {
                                sent = new HashSet<int>();
                                _sentVerifyingByBuildSet[buildSetKey] = sent;
                            }
                            foreach (var n in toSend) sent.Add(n);
                            justSent = true;
                        }
                        statusText.Text = msg;
                        statusText.Foreground = isError
                            ? (Brush)Application.Current.FindResource("RedBrush")
                            : (Brush)Application.Current.FindResource("GreenBrush");
                        statusText.Visibility = Visibility.Visible;
                        // Rebuilding this row right now (RenderBuildSetRollup clears and recreates
                        // every row) would destroy statusText before Shane ever sees the outcome
                        // message, since the button's own success/fail feedback is the point.
                        // Defer the rebuild — which is what actually makes the button disappear —
                        // to the same timer that hides the status text, so he sees "Sent" first.
                        var hideTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
                        hideTimer.Tick += (ts, te) =>
                        {
                            hideTimer.Stop();
                            if (justSent) RenderBuildSetRollup(_lastItems);
                            else { statusText.Visibility = Visibility.Collapsed; }
                        };
                        hideTimer.Start();
                    }));
                };
            }

            var detail = new StackPanel
            {
                Margin = new Thickness(10, 4, 4, 0),
                Visibility = isExpanded ? Visibility.Visible : Visibility.Collapsed
            };
            void AddDetailLine(string label, List<int> nums)
            {
                if (nums.Count == 0) return;
                detail.Children.Add(new TextBlock
                {
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 0, 0, 2),
                    Text = $"{label} ({nums.Count}): {string.Join(", ", nums.Select(FormatIssueRef))}"
                });
            }
            AddDetailLine("Up next", upNext);
            AddDetailLine("Running", running);
            AddDetailLine("Verifying", verifying);
            if (detail.Children.Count == 0)
            {
                // Nothing here isn't reachable in practice — a row only renders when at least
                // one bucket is non-empty — but guard anyway rather than show an empty expand.
                detail.Children.Add(new TextBlock
                {
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    Text = "Nothing further to show."
                });
            }
            wrapper.Children.Add(detail);

            headerBorder.MouseLeftButtonDown += (s, e) => ToggleBuildSetFilter(buildSetKey);
            chevron.Click += (s, e) =>
            {
                bool expanded = chevron.IsChecked == true;
                if (expanded) _expandedRollupSets.Add(buildSetKey);
                else _expandedRollupSets.Remove(buildSetKey);
                detail.Visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
            };

            headerBorder.ContextMenu = BuildRollupRowContextMenu(buildSetKey, members, isSelected, isExpanded);

            return wrapper;
        }

        /// <summary>Git #1999 — right-click menu for a BUILD SETS rollup row. Reuses the exact
        /// same chat-resolution path individual cards use (<see cref="QueueItemChatRequested"/> →
        /// MainWindow's OpenChatForQueueItem) rather than a second one — a build set just has
        /// potentially several distinct originating chats among its members instead of one, so
        /// this only adds the "which chat(s)" step on top, then hands a representative
        /// <see cref="QueueItem"/> to the same event the card menu already raises.</summary>
        private ContextMenu BuildRollupRowContextMenu(string buildSetKey, List<QueueItem> members, bool isSelected, bool isExpanded)
        {
            var cm = new ContextMenu();

            // Distinct originating chats across this set's current members, deduped on
            // OriginatingChatId first (falls back to ChatUrl only when no chat id is set) —
            // same precedence OpenChatForQueueItem itself resolves in. Members with neither
            // are simply not a chat and don't contribute an entry (no invented "Unknown chat" row).
            var chatGroups = new List<(string Key, QueueItem Representative, int Count)>();
            var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in members)
            {
                string? chatKey = !string.IsNullOrWhiteSpace(m.OriginatingChatId) ? m.OriginatingChatId : m.ChatUrl;
                if (string.IsNullOrWhiteSpace(chatKey)) continue;
                if (seen.TryGetValue(chatKey, out var idx))
                {
                    var existing = chatGroups[idx];
                    chatGroups[idx] = (existing.Key, existing.Representative, existing.Count + 1);
                }
                else
                {
                    seen[chatKey] = chatGroups.Count;
                    chatGroups.Add((chatKey, m, 1));
                }
            }

            if (chatGroups.Count == 1)
            {
                var miOpenChat = new MenuItem { Header = "💬 Open Originating Chat" };
                var rep = chatGroups[0].Representative;
                miOpenChat.Click += (_, _) => QueueItemChatRequested?.Invoke(this, rep);
                cm.Items.Add(miOpenChat);
                cm.Items.Add(new Separator());
            }
            else if (chatGroups.Count > 1)
            {
                var chatSubmenu = new MenuItem { Header = "💬 Open Originating Chat" };
                foreach (var (key, rep, count) in chatGroups)
                {
                    // No chat title is resolvable from here (BuildQueuePanel has no chat-list
                    // lookup by conversation id) — label with the real id/url plus how many of
                    // this set's items came from it, per the issue's fallback wording.
                    var miChat = new MenuItem { Header = $"{key} ({count} item{(count == 1 ? "" : "s")})" };
                    var capturedRep = rep;
                    miChat.Click += (_, _) => QueueItemChatRequested?.Invoke(this, capturedRep);
                    chatSubmenu.Items.Add(miChat);
                }
                cm.Items.Add(chatSubmenu);
                cm.Items.Add(new Separator());
            }
            // chatGroups.Count == 0 → omit the entry entirely, matching the card menu's own
            // guard at the OriginatingChatId/ChatUrl check.

            var miFilter = new MenuItem
            {
                Header = isSelected ? $"✕ Clear filter (\"{buildSetKey}\")" : $"Filter queue to \"{buildSetKey}\""
            };
            miFilter.Click += (_, _) => ToggleBuildSetFilter(buildSetKey);
            cm.Items.Add(miFilter);

            var miExpand = new MenuItem { Header = isExpanded ? "▲ Collapse" : "▼ Expand" };
            miExpand.Click += (_, _) =>
            {
                if (isExpanded) _expandedRollupSets.Remove(buildSetKey);
                else _expandedRollupSets.Add(buildSetKey);
                RenderBuildSetRollup(_lastItems);
            };
            cm.Items.Add(miExpand);

            cm.Items.Add(new Separator());

            var miRemoveSet = new MenuItem { Header = "🗑 Remove Entire Set (→ Backlog)" };
            miRemoveSet.Click += async (_, _) => await RemoveBuildSetAsync(buildSetKey, members);
            cm.Items.Add(miRemoveSet);

            return cm;
        }

        /// <summary>Right-click "Remove Entire Set" on a BUILD SETS rollup row — cancels every
        /// member still eligible (queued / limit-paused / parked / capped, same states
        /// <see cref="Services.BuildQueuePostgresClient.CancelAsync"/> already guards on) so the
        /// whole set drops out of the queue at once, then mirrors each canceled member's linked
        /// GitHub issue back to the real board's Backlog column via the same fire-and-forget
        /// <see cref="Services.BoardStatusSync.Mirror"/> primitive Park/Un-park already use — "Git
        /// IS the database" applies here too. A member already running or verifying can't be
        /// safely killed from here (same guard CancelAsync itself enforces) and is deliberately
        /// left alone, not force-canceled and not moved to Backlog out from under an active
        /// build.</summary>
        private async System.Threading.Tasks.Task RemoveBuildSetAsync(string buildSetKey, List<QueueItem> members)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Remove Set", "No direct DB connection — can't remove.");
                return;
            }

            var confirm = MessageBox.Show(
                $"Remove all of build set \"{buildSetKey}\" from the queue?\n\n" +
                $"{members.Count} item(s) will be canceled (anything already running/verifying is left alone), " +
                "and their linked GitHub issues moved back to Backlog.",
                "Remove Entire Set", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            int canceled = 0, skipped = 0;
            foreach (var m in members)
            {
                try
                {
                    if (await _db.CancelAsync(m.Id))
                    {
                        canceled++;
                        Services.BoardStatusSync.Mirror(m.GithubNumber, GitHubApiClient.BacklogOptionId,
                            "Removed from queue (build set)", "build-queue");
                    }
                    else
                    {
                        skipped++; // already running/verifying/terminal — left alone
                    }
                }
                catch (Exception ex)
                {
                    skipped++;
                    ActivityLog.Log("build-queue", $"Remove set \"{buildSetKey}\": couldn't cancel #{m.Id} ({m.Title}): {ex.Message}");
                }
            }

            ActivityLog.Log("build-queue", $"Removed build set \"{buildSetKey}\": {canceled} canceled → Backlog, {skipped} left alone (running/verifying/already terminal).");
            if (canceled > 0)
                ToastEngine.Success("Set Removed", $"\"{buildSetKey}\": {canceled} canceled" + (skipped > 0 ? $", {skipped} left running" : ""));
            else
                ToastEngine.Warning("Remove Set", $"\"{buildSetKey}\": nothing to cancel — all {skipped} item(s) already running/verifying/terminal.");

            await RefreshAsync();
        }

        /// <summary>Git #1834 addendum — click a rollup row to filter the queue graph below
        /// down to that build set; click the same row again (or the header's "Showing: X ✕"
        /// clear affordance) to return to the unfiltered view. Deliberately doesn't touch
        /// _filter or _queueSearch — see ApplyFilter for how the three compose.</summary>
        private void ToggleBuildSetFilter(string buildSetKey)
        {
            _buildSetFilter = string.Equals(_buildSetFilter, buildSetKey, StringComparison.OrdinalIgnoreCase) ? null : buildSetKey;
            if (QueueGraphContainer != null && _filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
            RenderBuildSetRollup(_lastItems);
        }

        private void BuildSetRollupClear_Click(object sender, MouseButtonEventArgs e)
        {
            _buildSetFilter = null;
            if (QueueGraphContainer != null && _filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
            RenderBuildSetRollup(_lastItems);
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

            // ── Git #1640 — critter + 💤 badge, same 2-column layout BuildQueueCard uses.
            // RestartItem (PersistedQueueDisplayItem) carries no Id, only Title + optional
            // GithubNumber, so the stable variant seed is GithubNumber when present, else a
            // stable hash of Title — either way the same restart item always draws the same
            // critter across repaints, never re-randomized.
            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(sp, 0);
            cardGrid.Children.Add(sp);

            int restartSeed = p.GithubNumber ?? p.Title.GetHashCode();
            var mascot = (Canvas)CreateGenericCardMascot(restartSeed, CritterMood.Normal, isBlocked: false);
            var sleepBadge = new Border
            {
                Background = HexBrush("#89B4FA"), // calm sapphire/lavender — distinct from the red 🔒 blocked badge
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(3, 1, 3, 1),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0x89, 0xB4, 0xFA), BlurRadius = 4, ShadowDepth = 0 },
                ToolTip = "Queued for restart — waiting for its build set to finish, not blocked on a dependency"
            };
            sleepBadge.Child = new TextBlock { Text = "💤", FontSize = 9 };
            Canvas.SetLeft(sleepBadge, 22);
            Canvas.SetTop(sleepBadge, -3);
            mascot.Children.Add(sleepBadge);

            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;
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
                // Git #1638 — "parked" and "external" get their own neutral/informational
                // border so they read as distinct from the plain "up next" default below.
                (item.Status == "parked" ? Color.FromRgb(0x6C, 0x70, 0x86) :
                // Git #1989 — Conservation Cap: peach, the same "flagged, needs a look"
                // accent isPaused already uses above — distinct from the neutral gray
                // "parked" (#1638) gets, since being capped is a decision Shane may want
                // to revisit (override/drain), not just a passive staging spot.
                (item.Status == Services.AccountCapPolicy.CappedStatus ? Color.FromRgb(0xFA, 0xB3, 0x87) :
                (item.Status == "external" ? Color.FromRgb(0x89, 0xB4, 0xFA) :
                Color.FromRgb(0x31, 0x32, 0x44)))))))))));

            Color cardBgColor = isSelected ? Color.FromRgb(0x1B, 0x22, 0x34) :
                (isWaitingForInput ? Color.FromRgb(0x23, 0x1E, 0x18) :
                (item.Status == "running" ? Color.FromRgb(0x15, 0x19, 0x26) :
                (isPaused ? Color.FromRgb(0x2A, 0x20, 0x1A) :
                (isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) :
                (item.Status == BuildQueuePostgresClient.VerifyingStatus ? Color.FromRgb(0x14, 0x22, 0x28) :
                (item.Status == "done" ? Color.FromRgb(0x14, 0x20, 0x1A) :
                (item.Status == "parked" ? Color.FromRgb(0x1E, 0x1F, 0x2A) :
                (item.Status == Services.AccountCapPolicy.CappedStatus ? Color.FromRgb(0x2A, 0x20, 0x1A) :
                (item.Status == "external" ? Color.FromRgb(0x15, 0x19, 0x26) :
                Color.FromRgb(0x18, 0x18, 0x25))))))))));

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
            else if (item.Status == "parked")
            {
                // Git #1638 — the Park staging area: deliberately never picked up by
                // GetNextAsync's WHERE status = 'queued' claim query. Neutral gray, not
                // any of the "in the pipeline" colors above, so it reads as staged rather
                // than waiting its turn.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x21, 0x22, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "📥 PARKED",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Staged, not queued — use Un-park to send it into the real build queue."
                };
            }
            else if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                // Git #1989 — Conservation Cap: the toggle was on and this build's
                // model/effort exceeded Sonnet High, so it was parked instead of
                // launched. Peach, not the neutral gray "parked" (#1638) above — a
                // deliberately different, more attention-getting color, since this is
                // real headroom Shane may want to spend via Run at Full Model or Drain,
                // not a passive staging spot he chose himself.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x20, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "CAPPED — ABOVE SONNET HIGH",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Conservation Cap is on and this build's model/effort exceeds Sonnet High — right-click for Run at Full Model, or Drain from the title bar to release everything capped."
                };
            }
            else if (item.Status == "external")
            {
                // Git #1638 — a "Send to Builder" launch: outside the 8-slot cap, never
                // claimed by the watcher. Its real status column (done/failed once
                // scripts/run-claude.ps1 writes the exit code back) still drives the
                // pills above, so this only fires while it's genuinely still running.
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x20, 0x30)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = "🚀 EXTERNAL",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Launched via Send to Builder — outside the 8-slot cap, not watcher-claimable."
                };
            }
            else if (item.Status == BuildQueuePostgresClient.SupersededStatus)
            {
                // Git #2119 — this row was resolved by a Reply/resume: its session was taken over by
                // a fresh "Reply → …" row (SupersededById). Neutral violet, distinct from the active
                // pipeline colors, so it reads as "handed off, see #N" rather than still-in-flight.
                string replyRef = item.SupersededById.HasValue ? $" → #{item.SupersededById.Value}" : "";
                statusPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x24, 0x20, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xCB, 0xA6, 0xF7)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5)
                };
                statusPill.Child = new TextBlock
                {
                    Text = $"↩ REPLIED{replyRef}",
                    FontSize = 9.5,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xA6, 0xF7)),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Replied to — its session was resumed under a new build" +
                              (item.SupersededById.HasValue ? $" (queue #{item.SupersededById.Value})." : ".") +
                              " This original row is closed out so it no longer sits in the active queue."
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

            // Git #1998 — model/effort badge, always visible in every card state (not gated
            // on Conservation Cap / #1989's toggle): the two values that decide whether a
            // build launches or gets parked shouldn't be hidden the rest of the time, and a
            // card that changes shape when the toggle flips is harder to read than one that
            // doesn't. Short form only ("Sonnet · High") — never the full model id.
            string? shortModel = ShortModelName(item.Model);
            string? shortEffort = ShortEffortName(item.Effort);
            if (shortModel != null || shortEffort != null)
            {
                string modelEffortText = shortModel != null && shortEffort != null
                    ? $"{shortModel} · {shortEffort}"
                    : (shortModel ?? shortEffort)!;
                var modelBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    ToolTip = "Model · effort this build launches (or launched) with"
                };
                modelBadge.Child = new TextBlock
                {
                    Text = modelEffortText,
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xB4, 0xCD))
                };
                topRow.Children.Add(modelBadge);
            }

            // Git #1998 — on a capped card, spell out which half of
            // AccountCapPolicy.ExceedsSonnetHigh actually tripped the gate (Opus, Fable, or
            // xhigh effort) instead of leaving Shane to reconstruct it from a bare status pill.
            // Reuses AccountCapPolicy's own IsOpusModel/IsFableModel/IsAboveHighEffort rather
            // than re-deriving the test. Peach to match the existing capped colour language
            // (#1989) — no new accent.
            if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                var reasons = new List<string>();
                if (Services.AccountCapPolicy.IsOpusModel(item.Model)) reasons.Add("Opus");
                if (Services.AccountCapPolicy.IsFableModel(item.Model)) reasons.Add("Fable");
                if (Services.AccountCapPolicy.IsAboveHighEffort(item.Effort)) reasons.Add("xhigh effort");
                string reasonText = reasons.Count > 0 ? string.Join(" + ", reasons) : "unknown";
                var reasonBadge = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x20, 0x1A)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(5, 1.5, 5, 1.5),
                    Margin = new Thickness(6, 0, 0, 0),
                    ToolTip = $"Capped because: {reasonText}"
                };
                reasonBadge.Child = new TextBlock
                {
                    Text = $"⚠ {reasonText}",
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87))
                };
                topRow.Children.Add(reasonBadge);
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

            // ── Third Row: Extra info (blocker ghost cards, exit code) ──
            // Git #2070: gate on the same live-filtered set BuildWaitingOnText renders,
            // not the raw declared list — otherwise this row can render with an empty
            // "waiting on" string once every declared blocker has closed.
            // Git #2062: a bare "waiting on #N" text line left Shane to leave the card and
            // go find #N himself. Each genuinely-open blocker now gets its own real ghost
            // card (BuildBlockerGhostCard) inline instead — the blocker's real title/state,
            // not just its number.
            if (LiveBlockedBy(node).Count > 0 && item.Status == "queued")
            {
                foreach (var blockerNumber in LiveBlockedBy(node))
                {
                    mainStack.Children.Add(BuildBlockerGhostCard(blockerNumber));
                }
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

            // Git #1876 — quiet "a real log file exists for this queue id" dot, top-right
            // corner of the card. Cached/batched via BuildLogExistenceCache so hundreds of
            // cards rendering every poll tick cost one directory listing, not one
            // File.Exists per card. Deliberately unobtrusive — this is a diagnostic signal
            // ("did this genuinely start running"), not a status indicator; the status
            // pill above already owns that job.
            Grid cardOverlay;
            if (Services.BuildLogExistenceCache.HasLog(item.Id))
            {
                cardOverlay = new Grid();
                cardOverlay.Children.Add(cardGrid);
                cardOverlay.Children.Add(new Ellipse
                {
                    Width = 6,
                    Height = 6,
                    Fill = (Brush)Application.Current.FindResource("TealBrush"),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(0, -4, -4, 0),
                    ToolTip = $"Log file exists — this build genuinely started running.\n{Services.BuildLogExistenceCache.PathFor(item.Id)}"
                });
                card.Child = cardOverlay;
            }
            else
            {
                card.Child = cardGrid;
            }

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
                StatusDetails = LiveBlockedBy(node).Count > 0
                    ? CapitalizeFirst(BuildWaitingOnText(node, node.Item))
                    : "",
            });
        }

        /// <summary>
        /// Git #1600 — "Surface the hold reason in the queue UI: 'waiting on #NNNN
        /// (open)'. A held build must not look Ready or sit silently." Prefers the
        /// watcher's own real, current live-GitHub reason (set by
        /// BuildQueuePostgresClient.GetNextAsync's Step 2 every tick) so the badge
        /// reflects what the dispatch gate actually just decided, not a guess. Falls
        /// back to the plain declared-blocker list (no "(open)"/reachability detail)
        /// when the watcher hasn't evaluated this item yet this pass (e.g. no free
        /// slot that tick) or is running the HTTP-fallback path, which doesn't surface
        /// a reason back to this client.
        /// </summary>
        private string BuildWaitingOnText(QueueGraphNode node, QueueItem? item)
        {
            if (item != null && (_watcher?.HeldBlockerReasons.TryGetValue(item.Id, out var reason) ?? false))
                return reason;
            return $"waiting on {string.Join(", ", LiveBlockedBy(node).Select(FormatIssueRef))}";
        }

        /// <summary>
        /// Git #2070 — <see cref="IsGenuinelyBlocked"/> already filters a node's declared
        /// blockers against the live <see cref="_openIssues"/> set before deciding the
        /// 🔒 BLOCKED badge; <see cref="BuildWaitingOnText"/> was reading <c>node.BlockedBy</c>
        /// (raw declared blockers) directly, so once a blocker closed the badge correctly
        /// cleared but the "waiting on #N" text kept naming the closed issue. Applies the
        /// exact same live filter here so badge and text can never disagree. Cold start
        /// (_openIssues == null) falls back to the raw declared list, matching
        /// IsGenuinelyBlocked's own fail-safe.
        /// </summary>
        private List<int> LiveBlockedBy(QueueGraphNode node)
        {
            if (_openIssues == null) return node.BlockedBy;
            return node.BlockedBy.Where(b => _openIssues.Contains(b)).ToList();
        }

        /// <summary>Git #2062 — typed marker on a ghost blocker card's Tag: the real DOM anchor
        /// #2030's future click-to-highlight dependency chain system attaches to. That system is
        /// NOT built here — this only makes sure every blocked card has a stable, discoverable
        /// element to attach it to later, at every link in the chain, not just the two ends that
        /// happen to already be rendered near each other. IsLiveQueueNode tells that future work
        /// whether this ghost has a real sibling card in the same render to draw a line to.</summary>
        private readonly record struct BlockerGhostTag(int IssueNumber, bool IsLiveQueueNode);

        /// <summary>Git #2062 — a blocked build's declared blocker rendered as a real, dimmed
        /// ghost/placeholder card (not plain "waiting on #N" text). Always built from real data:
        /// if the blocker is itself another node in this same queue render (<see cref="_currentGraphNodes"/>),
        /// its real title + current status (<see cref="GhostStatusLabel"/>, the same vocabulary
        /// <see cref="CreateGraphNodeDot"/> already uses); otherwise the blocker's real GitHub
        /// title via the existing <see cref="_issueTitleCache"/> background-fetch machinery
        /// (<see cref="TriggerBackgroundIssueTitleQueries"/>, extended to also warm blocker
        /// numbers) with an "OPEN" state — LiveBlockedBy already filtered this number down to a
        /// blocker <see cref="_openIssues"/> reports genuinely still open. Never invents a title:
        /// while the background fetch hasn't landed yet, this shows the bare issue ref only.
        /// Minimally interactive per the #2062 scope note — clickable to jump to the blocker's
        /// own card when it has one, but not the full chain-highlight interaction (#2030).</summary>
        private Border BuildBlockerGhostCard(int blockerNumber)
        {
            var liveNode = _currentGraphNodes.FirstOrDefault(n => n.Key == blockerNumber && (n.Item != null || n.RestartItem != null));
            bool clickable = liveNode != null;

            string title;
            string statusText;
            Color statusColor;
            if (liveNode != null)
            {
                title = liveNode.Title;
                (statusText, statusColor) = GhostStatusLabel(liveNode);
            }
            else
            {
                string? cachedTitle;
                lock (_issueTitleCache) { _issueTitleCache.TryGetValue(blockerNumber, out cachedTitle); }
                title = cachedTitle ?? "";
                statusText = "○ OPEN";
                statusColor = Color.FromRgb(0xF3, 0x8B, 0xA8);
            }

            var card = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x1A, 0x14, 0x18)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(0x80, 0xF3, 0x8B, 0xA8)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(6, 3, 6, 3),
                Margin = new Thickness(1, 3, 0, 0),
                Opacity = 0.68,
                Cursor = clickable ? Cursors.Hand : Cursors.Arrow,
                Tag = new BlockerGhostTag(blockerNumber, clickable),
                ToolTip = clickable
                    ? $"🔒 Blocked by {FormatIssueRef(blockerNumber)} — {title}\nClick to jump to its own build card."
                    : $"🔒 Blocked by {FormatIssueRef(blockerNumber)}" + (string.IsNullOrEmpty(title) ? "" : $" — {title}") +
                      "\nOpen on GitHub — not itself a build in this queue."
            };

            var stack = new StackPanel();
            var topRow = new StackPanel { Orientation = Orientation.Horizontal };
            topRow.Children.Add(new TextBlock
            {
                Text = statusText,
                FontSize = 8.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(statusColor),
                VerticalAlignment = VerticalAlignment.Center
            });
            topRow.Children.Add(new TextBlock
            {
                Text = " " + FormatIssueRef(blockerNumber),
                FontSize = 8.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                Margin = new Thickness(4, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            });
            stack.Children.Add(topRow);
            stack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrEmpty(title) ? "(fetching title…)" : title,
                FontSize = 9.5,
                FontStyle = string.IsNullOrEmpty(title) ? FontStyles.Italic : FontStyles.Normal,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 1, 0, 0)
            });
            card.Child = stack;

            if (clickable)
            {
                card.MouseLeftButtonDown += (s, e) =>
                {
                    e.Handled = true;
                    SelectNode(liveNode!);
                };
            }

            return card;
        }

        /// <summary>Git #2062 — short status label + color for a blocker that is itself a live
        /// node in this queue render, mirroring the exact vocabulary <see cref="CreateGraphNodeDot"/>
        /// already uses for these same states (RUNNING/BLOCKED/DONE/etc.) — the ghost card is
        /// showing the same real build, just inline on the blocked card instead of on the
        /// mini-map dot.</summary>
        private (string text, Color color) GhostStatusLabel(QueueGraphNode node)
        {
            if (node.IsWaitingForInput) return ("❓ ASK QUESTION", Color.FromRgb(0xF9, 0xE2, 0xAF));
            if (node.Status == "running") return ("▶ RUNNING", Color.FromRgb(0x89, 0xB4, 0xFA));
            if (node.Item != null && BuildConsoleSettings.Load().PausedBuildIds.Contains(node.Item.Id))
                return ("⏸ PAUSED", Color.FromRgb(0xFA, 0xB3, 0x87));
            if (node.IsBlocked) return ("🔒 BLOCKED", Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (node.Status == BuildQueuePostgresClient.VerifyingStatus) return ("🔎 VERIFYING", Color.FromRgb(0x74, 0xC7, 0xEC));
            if (node.Status == "done") return ("✨ DONE", Color.FromRgb(0xA6, 0xE3, 0xA1));
            if (node.Status == "failed") return ("✕ FAILED", Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (node.Status == "restart") return ("🔄 RESTART", Color.FromRgb(0xCB, 0xA6, 0xF7));
            return ("⏳ UP NEXT", Color.FromRgb(0xBA, 0xB4, 0xCD));
        }

        private static string CapitalizeFirst(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s.Substring(1);

        /// <summary>Git #1998 — short display name for a model id ("claude-sonnet-5" → "Sonnet"),
        /// used on the compact queue card badge. Reuses AccountCapPolicy's own Opus/Fable
        /// detection rather than re-deriving it. Null in, null out — a missing model renders as
        /// nothing on the card, never an invented default. An id this doesn't recognize is
        /// returned as-is rather than guessed at.</summary>
        private static string? ShortModelName(string? model)
        {
            if (string.IsNullOrWhiteSpace(model)) return null;
            if (Services.AccountCapPolicy.IsOpusModel(model)) return "Opus";
            if (Services.AccountCapPolicy.IsFableModel(model)) return "Fable";
            if (model.Contains("sonnet", StringComparison.OrdinalIgnoreCase)) return "Sonnet";
            if (model.Contains("haiku", StringComparison.OrdinalIgnoreCase)) return "Haiku";
            return model;
        }

        /// <summary>Git #1998 — short display form for an effort value. "xhigh" stays lowercase
        /// (matches Shane's own "Opus · xhigh" example on #1998); everything else is
        /// capitalized ("high" → "High"). Null in, null out.</summary>
        private static string? ShortEffortName(string? effort)
        {
            if (string.IsNullOrWhiteSpace(effort)) return null;
            return effort.Equals("xhigh", StringComparison.OrdinalIgnoreCase)
                ? "xhigh"
                : char.ToUpperInvariant(effort[0]) + effort.Substring(1).ToLowerInvariant();
        }

        /// <summary>
        /// Shane, 2026-08-30 — mirrors a local Park/Un-park onto the real GitHub Project
        /// board: "Create a new Bucket in Git like the 'Batter Up' called 'Park' and
        /// move the Git issue there... then it pulls it out of the Batter Up queue,
        /// puts it in its own queue away from the build." Fire-and-forget by design
        /// (same shape as UnparkAsync's in-flight/complete label sync) — a slow or
        /// failed GitHub call should never block the local park/un-park it's paired
        /// with, since the local 'parked' status is already the source of truth for
        /// BuildConsole itself. No-op when the item has no linked GitHub issue or no
        /// PAT is configured.
        /// </summary>
        private static void SyncGitHubParkStatus(int? githubNumber, string optionId, string actionLabel)
            // Git #2136 — now delegates to the shared BoardStatusSync.Mirror primitive so Park,
            // Verifying and Crashed all move the board through one code path (no divergent copy of
            // the fire-and-forget/settings/log shape). Behaviour is unchanged for Park.
            => Services.BoardStatusSync.Mirror(githubNumber, optionId, actionLabel, "build-queue");

        /// <summary>
        /// Shane: "All builds no matter their status should be able to be parked" —
        /// the Park item offered on every status that isn't 'running' (which stops a
        /// live process first, see the dedicated running-branch Park above),
        /// 'queued'/'limit-paused' (which have their own Park with slightly different
        /// wording) or 'parked' itself (Un-park is the inverse there). Covers
        /// 'verifying', 'done', 'failed', 'canceled', and 'external' — a build in any
        /// of those states can still be genuinely blocked on something else and worth
        /// staging out of sight until that clears, via <see cref="BuildQueuePostgresClient.ParkAnyAsync"/>.
        /// </summary>
        private MenuItem BuildParkAnyMenuItem(QueueItem item)
        {
            var mi = new MenuItem { Header = "🅿️ Park" };
            mi.Click += async (_, _) =>
            {
                if (_db == null)
                {
                    ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                    return;
                }
                try
                {
                    if (await _db.ParkAnyAsync(item.Id, item.SessionId))
                    {
                        ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                        ActivityLog.Log("build-queue", $"Parked queue item #{item.Id} ({item.Title}), was {item.Status}.");
                        SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                    }
                    else
                        ToastEngine.Warning("Park", $"Already parked: {item.Title}");
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                }
                await RefreshAsync();
            };
            return mi;
        }

        #region Git #2061 — quick-action wrappers for the Git Board issue-hover popover
        // Thin public wrappers around the exact same _watcher/_db/_api calls the right-click
        // menu items below use (#2030's confirmed inventory) — LeftSidebar's new issue-hover
        // popover (Controls/LeftSidebar.xaml.cs) calls these via delegate properties MainWindow
        // wires up, rather than duplicating the menu's logic. Kept alongside BuildCardContextMenu
        // so the two stay obviously in sync if either changes.

        /// <summary>Same body as the "⚡ Start Now" menu item below (queued -> dispatch now,
        /// respects the concurrency cap unlike "Run Now").</summary>
        public async System.Threading.Tasks.Task QuickDispatchAsync(QueueItem item)
        {
            if (_watcher == null)
            {
                ToastEngine.Info("Start Now", "The in-app watcher isn't active, so Start Now can't launch locally. The background service will pick it up.");
                return;
            }
            try
            {
                var result = await _watcher.StartNowAsync(item.Id, item.Title);
                if (result.Outcome == Services.QueueWatcherService.StartNowOutcome.Launched)
                    ToastEngine.Success("Start Now", result.Message);
                else
                    ToastEngine.Warning("Start Now", result.Message);
            }
            catch (Exception ex)
            {
                ToastEngine.Warning("Start Now", $"Couldn't launch immediately: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Same body as "⏹ Stop" (running) / "✕ Cancel" (queued) below, branched the
        /// same way on item.Status.</summary>
        public async System.Threading.Tasks.Task QuickCancelOrStopAsync(QueueItem item)
        {
            if (item.Status == "running")
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
            }
            else
            {
                if (_db == null && _api == null)
                {
                    ToastEngine.Warning("Cancel", "Not connected — can't cancel.");
                    return;
                }
                try
                {
                    bool canceled = _db != null
                        ? await _db.CancelAsync(item.Id)
                        : (await _api!.CancelQueueItemAsync(item.Id)).IsSuccessStatusCode;
                    if (canceled)
                        ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                    else
                        ToastEngine.Warning("Cancel", $"Couldn't cancel — it already started running: {item.Title}");
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Cancel Failed", $"Couldn't cancel: {ex.Message}");
                }
            }
            await RefreshAsync();
        }

        /// <summary>Same body as "🔄 Retry (start over)" below (fresh queue row, resumeSessionId:
        /// null — the crash-recovery "▶ Resume Session" variant stays right-click-menu-only since
        /// it's a narrower case than this card's general Failed -> Retry action).</summary>
        public async System.Threading.Tasks.Task QuickRetryAsync(QueueItem item)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Retry", "No direct DB connection — can't retry.");
                return;
            }
            try
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : null);
                await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, null, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                ToastEngine.Success("Re-queued", $"Re-queued: {item.Title}");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Retry Failed", $"Couldn't re-queue build: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Same body as "💬 Reply…" below, minus the modal prompt dialog — the
        /// popover's own inline text box supplies the message directly.</summary>
        public async System.Threading.Tasks.Task QuickReplyAsync(QueueItem item, string message)
        {
            if (_db == null)
            {
                ToastEngine.Warning("Reply", "Not connected (no direct DB) — can't queue a reply.");
                return;
            }
            string? sid = !string.IsNullOrWhiteSpace(item.SessionId) ? item.SessionId : _watcher?.GetSessionId(item.Id);
            if (string.IsNullOrWhiteSpace(sid))
            {
                ToastEngine.Warning("Reply", "No session id captured for this build yet — nothing to resume.");
                return;
            }
            try
            {
                var replyRow = await _db.QueueBuildAsync(
                    $"Reply → {item.Title}", message, item.Model, item.Effort, item.Cwd,
                    githubNumber: null, blockedByNumbers: null,
                    resumeSessionId: sid, chatUrl: item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                // Git #2119 — resolve the ORIGINAL row so its card doesn't sit stuck showing stale
                // active status forever while the resumed work runs under this new "Reply → …" entry.
                int superseded = await _db.MarkSupersededByReplyAsync(item.Id, replyRow.Id);
                ActivityLog.Log("interactive-build",
                    $"Reply queued for queue #{item.Id} ({item.Title}) — resuming session {sid} with a {message.Length}-char message (via Git Board hover popover). New row #{replyRow.Id}" +
                    (superseded > 0 ? $"; original #{item.Id} marked superseded → #{replyRow.Id}." : $"; original #{item.Id} left as-is (running or already terminal)."));
                ToastEngine.Success("Reply queued", $"Resuming the session for “{item.Title}” with your message.");
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Reply Failed", $"Couldn't queue the reply: {ex.Message}");
            }
            await RefreshAsync();
        }

        /// <summary>Same effect as the "💬 Open Originating Chat" menu item / chat badge below.</summary>
        public void QuickOpenChat(QueueItem item) => QueueItemChatRequested?.Invoke(this, item);

        #endregion

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
                        var replyRow = await _db.QueueBuildAsync(
                            $"Reply → {item.Title}", message, item.Model, item.Effort, item.Cwd,
                            githubNumber: null, blockedByNumbers: null,
                            resumeSessionId: sid, chatUrl: item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                        // Git #2119 — resolve the ORIGINAL row so its card doesn't sit stuck showing
                        // stale active status forever while the resumed work runs under the new row.
                        int superseded = await _db.MarkSupersededByReplyAsync(item.Id, replyRow.Id);
                        ActivityLog.Log("interactive-build",
                            $"Reply queued for queue #{item.Id} ({item.Title}) — resuming session {sid} with a {message.Length}-char message. New row #{replyRow.Id}" +
                            (superseded > 0 ? $"; original #{item.Id} marked superseded → #{replyRow.Id}." : $"; original #{item.Id} left as-is (running or already terminal)."));
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

                // Shane: "sometimes a build agent decides it cannot continue until
                // something is unblocked" — a real mid-session state, distinct from
                // Stop (marks it failed/canceled, abandons the conversation). Park
                // stops the process but preserves resume_session_id and stages the
                // row in the same 'parked' lot as queued/limit-paused Park, so it's
                // out of the active queue until the blocker clears and Un-park (or
                // "I tell it to build again") resumes the exact session.
                var miParkRunning = new MenuItem { Header = "🅿️ Park (blocked on something else)" };
                miParkRunning.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    string? sid = !string.IsNullOrWhiteSpace(item.SessionId)
                        ? item.SessionId
                        : _watcher?.GetSessionId(item.Id);
                    _watcher?.TryStop(item.Id);
                    _watcher?.ReleaseInteractive(item.Id);
                    try
                    {
                        if (await _db.ParkRunningAsync(item.Id, sid))
                        {
                            ToastEngine.Success("Parked", $"Stopped and staged for later: {item.Title}");
                            ActivityLog.Log("build-queue", $"Parked running queue item #{item.Id} ({item.Title}) — stopped and staged" +
                                (string.IsNullOrWhiteSpace(sid) ? ", no session id captured so Un-park will start it over." : "; Un-park will resume its session."));
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer running: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miParkRunning);
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

                // Git #1805 — "Start Now": Shane's own click is the explicit override for whatever
                // is holding this ONE row (a real blocked_by dependency, or just poll timing) — but
                // unlike Run Now above, it respects a genuinely full concurrency cap rather than
                // ever exceeding it. See QueueWatcherService.StartNowAsync for the full contract and
                // the watcher-channel logging of exactly what was overridden.
                var miStartNow = new MenuItem { Header = "⚡ Start Now" };
                miStartNow.Click += async (_, _) =>
                {
                    if (_watcher == null)
                    {
                        ToastEngine.Info("Start Now", "The in-app watcher isn't active, so Start Now can't launch locally. The background service will pick it up.");
                        return;
                    }
                    try
                    {
                        var result = await _watcher.StartNowAsync(item.Id, item.Title);
                        if (result.Outcome == Services.QueueWatcherService.StartNowOutcome.Launched)
                            ToastEngine.Success("Start Now", result.Message);
                        else
                            ToastEngine.Warning("Start Now", result.Message);
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Warning("Start Now", $"Couldn't launch immediately: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miStartNow);

                // Git #1832 — the reverse of Un-park: pulls a still-queued item out of
                // the active queue into the parked staging area, only from 'queued'.
                var miPark = new MenuItem { Header = "🅿️ Park" };
                miPark.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    try
                    {
                        if (await _db.ParkAsync(item.Id))
                        {
                            ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                            ActivityLog.Log("build-queue", $"Parked queue item #{item.Id} ({item.Title}) — no longer queued.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer queued: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miPark);

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

                // Git #1832 — a limit-paused build is genuinely not running either;
                // parking it instead of waiting out the session-limit timer is a
                // reasonable thing to want. See ParkAsync's own doc for the full
                // judgment call.
                var miParkLp = new MenuItem { Header = "🅿️ Park" };
                miParkLp.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Park", "No direct DB connection — can't park.");
                        return;
                    }
                    try
                    {
                        if (await _db.ParkAsync(item.Id))
                        {
                            ToastEngine.Success("Parked", $"Staged, not queued: {item.Title}");
                            ActivityLog.Log("session-limit", $"Parked limit-paused queue item #{item.Id} ({item.Title}) — will NOT auto-restart.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.ParkOptionId, "Park");
                        }
                        else
                            ToastEngine.Warning("Park", $"No longer limit-paused: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Park Failed", $"Couldn't park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miParkLp);

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
            else if (item.Status == "parked")
            {
                // Git #1638 — the required un-park action: flips this ONE row from
                // 'parked' back to 'queued', making it immediately eligible for the
                // normal auto-run pipeline (GetNextAsync's claim query).
                var miUnpark = new MenuItem { Header = "▶ Un-park (send to queue)" };
                miUnpark.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Un-park", "No direct DB connection — can't un-park.");
                        return;
                    }
                    try
                    {
                        if (await _db.UnparkAsync(item.Id))
                        {
                            ToastEngine.Success("Un-parked", $"Back in the queue: {item.Title}");
                            ActivityLog.Log("build-queue", $"Un-parked queue item #{item.Id} ({item.Title}) — now queued.");
                            SyncGitHubParkStatus(item.GithubNumber, GitHubApiClient.BatterUpPromoteOptionId, "Un-park");
                        }
                        else
                            ToastEngine.Warning("Un-park", $"No longer parked: {item.Title}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Un-park Failed", $"Couldn't un-park: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miUnpark);

                var miCancelParked = new MenuItem { Header = "✕ Cancel" };
                miCancelParked.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Cancel", "No direct DB connection — can't cancel.");
                        return;
                    }
                    try
                    {
                        if (await _db.CancelAsync(item.Id))
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled parked queue item #{item.Id} ({item.Title}) without ever queuing it.");
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
                cm.Items.Add(miCancelParked);
            }
            else if (item.Status == Services.AccountCapPolicy.CappedStatus)
            {
                // Git #1989 — the override that makes parking acceptable: launches this
                // ONE build at its originally specified model/effort (never substituted —
                // the BUILD: header was never touched by parking). One-shot: the
                // Conservation toggle itself is left exactly as it was, same idiom as the
                // existing right-click overrides (#1805 Start Now, #1641 Build Now).
                var miRunFullModel = new MenuItem { Header = "Run at Full Model" };
                miRunFullModel.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Run at Full Model", "No direct DB connection — can't override.");
                        return;
                    }
                    try
                    {
                        if (!await _db.UncapAsync(item.Id))
                        {
                            ToastEngine.Warning("Run at Full Model", $"No longer capped: {item.Title}");
                            await RefreshAsync();
                            return;
                        }
                        if (_watcher == null)
                        {
                            ToastEngine.Info("Run at Full Model", "The in-app watcher isn't active, so it's back in the queue but won't launch locally. The background service will pick it up.");
                            await RefreshAsync();
                            return;
                        }
                        var claimed = await _db.ForceClaimAsync(item.Id);
                        _watcher.ForceLaunch(claimed);
                        ToastEngine.Success("Run at Full Model", $"Launched at {item.Model ?? "default"}/{item.Effort ?? "default"}: {item.Title}");
                        ActivityLog.Log("build-queue", $"Conservation Cap override: queue #{item.Id} ({item.Title}) launched at its full original model/effort ({item.Model ?? "default"}/{item.Effort ?? "default"}) — one-shot, toggle left unchanged.");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Run at Full Model Failed", $"Couldn't launch: {ex.Message}");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miRunFullModel);

                var miCancelCapped = new MenuItem { Header = "Cancel" };
                miCancelCapped.Click += async (_, _) =>
                {
                    if (_db == null)
                    {
                        ToastEngine.Warning("Cancel", "No direct DB connection — can't cancel.");
                        return;
                    }
                    try
                    {
                        if (await _db.CancelAsync(item.Id))
                        {
                            ToastEngine.Success("Canceled", $"Canceled: {item.Title}");
                            ActivityLog.Log("build-queue", $"Canceled capped queue item #{item.Id} ({item.Title}) without ever launching it.");
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
                cm.Items.Add(miCancelCapped);
            }
            else if (item.Status == "external")
            {
                // Git #1638 — the log-tail viewer promised by the locked "Send to
                // Builder" decision: reuses the same BuildLogPaths.ForQueueItem
                // convention scripts/run-claude.ps1 now redirects real stdout/stderr
                // into, as an ad-hoc standalone viewer (not admitted into the 8-slot
                // Build Watch grid — this build was never a candidate for a slot).
                var miTailLog = new MenuItem { Header = "📜 Tail Log" };
                miTailLog.Click += (_, _) => ExternalLogWindow.ShowFor(item.Id, item.Title);
                cm.Items.Add(miTailLog);

                cm.Items.Add(BuildParkAnyMenuItem(item));
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
                            await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, item.SessionId, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
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
                        await _db.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, blockers, null, item.ChatUrl, buildSet: item.BuildSet, cli: item.Cli, account: item.Account);
                        ToastEngine.Success("Re-queued", $"Re-queued: {item.Title}");
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Retry Failed", $"Couldn't re-queue build: {ex.Message}");
                    }
                };
                cm.Items.Add(miRetry);

                cm.Items.Add(BuildParkAnyMenuItem(item));
            }

            // Git #1994 — every state falls through to here, so this appears on queued,
            // running, verifying, parked, limit-paused, capped, failed and done cards alike.
            // Hidden (not disabled) for a --notGit local build, whose GithubNumber is either
            // null (never set) or a negative local sentinel (see FormatRef) — neither is a
            // real GitHub issue to open. Reuses MainWindow.OpenGitDetailByNumberAsync, which
            // already focuses an existing tab instead of duplicating it.
            if (item.GithubNumber is int ghNum && ghNum > 0)
            {
                cm.Items.Add(new Separator());
                var miOpenGit = new MenuItem { Header = $"🔗 Open Git #{ghNum}" };
                miOpenGit.Click += (_, _) => OpenGitIssueRequested?.Invoke(this, (ghNum, false));
                cm.Items.Add(miOpenGit);

                var miOpenGitSide = new MenuItem { Header = $"🔗 Open Git #{ghNum} (side-by-side)" };
                miOpenGitSide.Click += (_, _) => OpenGitIssueRequested?.Invoke(this, (ghNum, true));
                cm.Items.Add(miOpenGitSide);
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

            // Git #2062 — also warm the cache for declared blocker numbers, not just
            // AssociatedIssueNumbers (own issue + linked chat/epic numbers). A blocker that
            // isn't itself a live queue node still needs its real title fetched once so its
            // ghost card (BuildBlockerGhostCard) can show it instead of "(fetching title…)".
            var issueNumbers = _lastItems
                .SelectMany(i => i.AssociatedIssueNumbers.Concat(CleanBlockers(i)))
                .Where(n => n > 0) // Git #1645 — never background-query a non-positive number (a --notGit local build's negative sentinel); it can only fail against `gh`.
                .Distinct()
                .ToList();

            foreach (var num in issueNumbers)
            {
                bool alreadyCached;
                bool alreadyPending;
                bool knownUnresolvable;
                lock (_issueTitleCache)
                {
                    alreadyCached = _issueTitleCache.ContainsKey(num);
                }
                lock (_pendingFetches)
                {
                    alreadyPending = _pendingFetches.Contains(num);
                }
                lock (_unresolvableIssueNumbers)
                {
                    knownUnresolvable = _unresolvableIssueNumbers.Contains(num);
                }

                if (!alreadyCached && !alreadyPending && !knownUnresolvable)
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
                var result = await Services.GitHubIssuesService.GetIssueTitleAsync(issueNumber);
                if (result.Title != null)
                {
                    lock (_issueTitleCache)
                    {
                        _issueTitleCache[issueNumber] = result.Title;
                    }
                    _ = Dispatcher.BeginInvoke(new Action(() =>
                    {
                        UpdateTooltipForIssue(issueNumber);
                        // Git #2062 — a blocker ghost card shows "(fetching title…)" until its
                        // real title lands in _issueTitleCache; if this fetch was for a declared
                        // blocker, redraw the queue now so the card picks it up immediately
                        // instead of waiting for the next poll tick.
                        if (_lastItems != null && _lastItems.Any(i => CleanBlockers(i).Contains(issueNumber)))
                        {
                            try { RenderQueue(ApplyFilter(_lastItems)); } catch { }
                        }
                    }));
                }
                else if (result.NotFound)
                {
                    // Git #1979 — `gh` confirmed this number doesn't resolve to anything in this repo.
                    // Cache it hard so it isn't re-spawned as a `gh issue view` process on every refresh.
                    lock (_unresolvableIssueNumbers)
                    {
                        _unresolvableIssueNumbers.Add(issueNumber);
                    }
                }
                // else: transient failure (couldn't start gh, non-zero exit for another reason, bad
                // output) — deliberately NOT cached, so it's retried on the next refresh rather than
                // permanently blanking a real title on a network/auth/rate-limit blip.
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

        // Shane, 2026-08-28: "Yesterday I had Copilot add Critters... they don't work well,
        // I don't see them much and the ones I do see are not cute... 10 good critters that
        // are cute and happy, they close bugs and kill builds." 10 new hand-built Build Queue
        // card mascots at the exact same quality bar/convention as the 5 above (36x30 canvas,
        // mood-aware eyes via the shared helpers below, blush cheeks, one signature
        // accessory) — extends CreateQueueCardMascot's variant pool from 5 to 15 so the same
        // handful of faces don't keep repeating across every card.
        internal static void AddQueueEye(Canvas c, double cx, double cy, Brush color, double w = 3.5, double h = 4.5)
        {
            var eye = new Ellipse { Width = w, Height = h, Fill = color };
            Canvas.SetLeft(eye, cx - w / 2); Canvas.SetTop(eye, cy - h / 2);
            c.Children.Add(eye);
            var hi = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
            Canvas.SetLeft(hi, cx - w / 2 + 1); Canvas.SetTop(hi, cy - h / 2 + 0.6);
            c.Children.Add(hi);
        }

        internal static void AddQueueEyePairMood(Canvas c, CritterMood mood, double lx, double rx, double cy, Brush color)
        {
            if (mood == CritterMood.Blocked)
            {
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{lx - 2},{cy - 1} Q{lx + 0.2},{cy + 2} {lx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{rx - 2},{cy - 1} Q{rx + 0.2},{cy + 2} {rx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{lx - 2},{cy + 1} Q{lx + 0.2},{cy - 2} {lx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
                c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse($"M{rx - 2},{cy + 1} Q{rx + 0.2},{cy - 2} {rx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
            }
            else
            {
                AddQueueEye(c, lx, cy, color);
                AddQueueEye(c, rx, cy, color);
            }
        }

        internal static void AddQueueBlush(Canvas c, double lx, double rx, double cy, Brush color)
        {
            var bL = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
            Canvas.SetLeft(bL, lx); Canvas.SetTop(bL, cy);
            c.Children.Add(bL);
            var bR = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
            Canvas.SetLeft(bR, rx); Canvas.SetTop(bR, cy);
            c.Children.Add(bR);
        }

        internal static Canvas CreateCutePandaVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(earL, 3); Canvas.SetTop(earL, 2); c.Children.Add(earL);
            var earR = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 2); c.Children.Add(earR);
            var head = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#F8FAFC") };
            Canvas.SetLeft(head, 5); Canvas.SetTop(head, 7); c.Children.Add(head);
            var patchL = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(patchL, 7.5); Canvas.SetTop(patchL, 11); c.Children.Add(patchL);
            var patchR = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(patchR, 19.5); Canvas.SetTop(patchR, 11); c.Children.Add(patchR);
            AddQueueEyePairMood(c, mood, 12, 24, 16, Brushes.White);
            var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
            var bamboo = new System.Windows.Shapes.Rectangle { Width = 3, Height = 12, Fill = HexBrush("#A3E635"), RadiusX = 1.5, RadiusY = 1.5 };
            Canvas.SetLeft(bamboo, 30); Canvas.SetTop(bamboo, 12); c.Children.Add(bamboo);
            AddQueueBlush(c, 6.5, 25.5, 18, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteOtterVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
            Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, 5); c.Children.Add(earL);
            var earR = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
            Canvas.SetLeft(earR, 26); Canvas.SetTop(earR, 5); c.Children.Add(earR);
            var head = new Ellipse { Width = 27, Height = 21, Fill = HexBrush("#C79A63") };
            Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 8); c.Children.Add(head);
            var muzzle = new Ellipse { Width = 15, Height = 11, Fill = HexBrush("#F2E2C8") };
            Canvas.SetLeft(muzzle, 10.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 13, 25, 17, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            var shell = new Ellipse { Width = 9, Height = 7, Fill = HexBrush("#94E2D5") };
            Canvas.SetLeft(shell, 14); Canvas.SetTop(shell, 24); c.Children.Add(shell);
            AddQueueBlush(c, 7, 25, 20, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteHedgehogVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            for (int i = 0; i < 5; i++)
                c.Children.Add(new Polygon { Points = new PointCollection { new Point(4 + i * 5.5, 12), new Point(6.5 + i * 5.5, 1), new Point(9 + i * 5.5, 12) }, Fill = HexBrush("#C77B4D") });
            var head = new Ellipse { Width = 24, Height = 19, Fill = HexBrush("#E8A876") };
            Canvas.SetLeft(head, 6); Canvas.SetTop(head, 9); c.Children.Add(head);
            var muzzle = new Ellipse { Width = 12, Height = 8, Fill = HexBrush("#FCEEDD") };
            Canvas.SetLeft(muzzle, 12); Canvas.SetTop(muzzle, 17); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 16, 26, 17, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3, Height = 2.4, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20.5); c.Children.Add(nose);
            AddQueueBlush(c, 8, 26, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteOwlVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(9, 8), new Point(6, 0), new Point(13, 6) }, Fill = HexBrush("#5EAA8C") });
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(27, 8), new Point(30, 0), new Point(23, 6) }, Fill = HexBrush("#5EAA8C") });
            var body = new Ellipse { Width = 26, Height = 24, Fill = HexBrush("#7FC4A6") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 5); c.Children.Add(body);
            var faceL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
            Canvas.SetLeft(faceL, 7); Canvas.SetTop(faceL, 10); c.Children.Add(faceL);
            var faceR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
            Canvas.SetLeft(faceR, 18); Canvas.SetTop(faceR, 10); c.Children.Add(faceR);
            AddQueueEyePairMood(c, mood, 12.5, 23.5, 16, HexBrush("#1E1E2E"));
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(15.5, 19), new Point(20.5, 19), new Point(18, 23) }, Fill = HexBrush("#F59E0B") });
            return c;
        }

        internal static Canvas CreateCuteSealVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#B8C6DB") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 8); c.Children.Add(body);
            var muzzle = new Ellipse { Width = 13, Height = 9, Fill = HexBrush("#E8EEF6") };
            Canvas.SetLeft(muzzle, 11.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
            AddQueueEyePairMood(c, mood, 14, 24, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19); c.Children.Add(nose);
            c.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M12,21 L4,19 M12,23 L4,24 M22,21 L30,19 M22,23 L30,24"), Stroke = HexBrush("#8FA3C2"), StrokeThickness = 0.8 });
            var flipper = new Ellipse { Width = 8, Height = 5, Fill = HexBrush("#9FB0CC") };
            Canvas.SetLeft(flipper, 2); Canvas.SetTop(flipper, 22); c.Children.Add(flipper);
            AddQueueBlush(c, 7, 25, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteRaccoonVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
            Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
            var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
            var head = new Ellipse { Width = 25, Height = 19, Fill = HexBrush("#8E8E9E") };
            Canvas.SetLeft(head, 5.5); Canvas.SetTop(head, 8); c.Children.Add(head);
            var mask = new System.Windows.Shapes.Path { Fill = HexBrush("#33333F"), Data = Geometry.Parse("M8,13 Q18,20 28,13 Q18,18 8,13 Z") };
            c.Children.Add(mask);
            AddQueueEyePairMood(c, mood, 13, 23, 15, Brushes.White);
            var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            c.Children.Add(new System.Windows.Shapes.Rectangle { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") });
            Canvas.SetLeft(c.Children[c.Children.Count - 1], 15); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
            c.Children.Add(new System.Windows.Shapes.Rectangle { Width = 4, Height = 3, Fill = HexBrush("#E8E8EE") });
            Canvas.SetLeft(c.Children[c.Children.Count - 1], 19); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
            return c;
        }

        internal static Canvas CreateCuteHamsterVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
            Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
            var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
            Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
            var head = new Ellipse { Width = 27, Height = 22, Fill = HexBrush("#F2C77E") };
            Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 7); c.Children.Add(head);
            var cheekL = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
            Canvas.SetLeft(cheekL, 2); Canvas.SetTop(cheekL, 16); c.Children.Add(cheekL);
            var cheekR = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
            Canvas.SetLeft(cheekR, 23); Canvas.SetTop(cheekR, 16); c.Children.Add(cheekR);
            AddQueueEyePairMood(c, mood, 13, 23, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
            AddQueueBlush(c, 4, 27, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteFrogVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 26, Height = 16, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(body, 5); Canvas.SetTop(body, 13); c.Children.Add(body);
            var bumpL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(bumpL, 6); Canvas.SetTop(bumpL, 4); c.Children.Add(bumpL);
            var bumpR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
            Canvas.SetLeft(bumpR, 19); Canvas.SetTop(bumpR, 4); c.Children.Add(bumpR);
            AddQueueEyePairMood(c, mood, 11.5, 24.5, 9, HexBrush("#1E1E2E"));
            var mouth = new System.Windows.Shapes.Path { Stroke = HexBrush("#2B6B1F"), StrokeThickness = 1.3, Data = Geometry.Parse("M12,20 Q18,24 24,20") };
            c.Children.Add(mouth);
            var throatPatch = new Ellipse { Width = 12, Height = 5, Fill = HexBrush("#D9F2CE") };
            Canvas.SetLeft(throatPatch, 12); Canvas.SetTop(throatPatch, 21); c.Children.Add(throatPatch);
            return c;
        }

        internal static Canvas CreateCuteKoalaVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var earL = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
            Canvas.SetLeft(earL, 1); Canvas.SetTop(earL, 4); c.Children.Add(earL);
            var earLin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
            Canvas.SetLeft(earLin, 4); Canvas.SetTop(earLin, 7); c.Children.Add(earLin);
            var earR = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
            Canvas.SetLeft(earR, 22); Canvas.SetTop(earR, 4); c.Children.Add(earR);
            var earRin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
            Canvas.SetLeft(earRin, 25); Canvas.SetTop(earRin, 7); c.Children.Add(earRin);
            var head = new Ellipse { Width = 24, Height = 20, Fill = HexBrush("#AEB4BF") };
            Canvas.SetLeft(head, 6); Canvas.SetTop(head, 8); c.Children.Add(head);
            AddQueueEyePairMood(c, mood, 14, 22, 16, HexBrush("#1E1E2E"));
            var nose = new Ellipse { Width = 6, Height = 4.5, Fill = HexBrush("#1E1E2E") };
            Canvas.SetLeft(nose, 15); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
            AddQueueBlush(c, 7.5, 23, 19, HexBrush("#F472B6"));
            return c;
        }

        internal static Canvas CreateCuteChickVector(CritterMood mood)
        {
            var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
            var body = new Ellipse { Width = 24, Height = 21, Fill = HexBrush("#FDE047") };
            Canvas.SetLeft(body, 6); Canvas.SetTop(body, 7); c.Children.Add(body);
            var tuft = new System.Windows.Shapes.Path { Fill = HexBrush("#FDE047"), Data = Geometry.Parse("M16,7 Q14,1 18,3 Q20,-1 21,4 Z") };
            c.Children.Add(tuft);
            AddQueueEyePairMood(c, mood, 14, 24, 15, HexBrush("#1E1E2E"));
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(18, 18), new Point(24, 20), new Point(18, 23) }, Fill = HexBrush("#F97316") });
            var wing = new Ellipse { Width = 9, Height = 12, Fill = HexBrush("#FACC15") };
            Canvas.SetLeft(wing, 6); Canvas.SetTop(wing, 13); c.Children.Add(wing);
            AddQueueBlush(c, 8, 24, 18, HexBrush("#F472B6"));
            return c;
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

            int variant = Math.Abs((item.GithubNumber ?? item.Id) % 15);
            FrameworkElement critter = isBlocked
                ? IssueChompAnimation.BuildRandomBlockedElement(scale: 0.5)
                : (FrameworkElement)(variant switch
                {
                    0 => CreateCuteFoxVector(mood),
                    1 => CreateCuteBearVector(mood),
                    2 => CreateCuteCatVector(mood),
                    3 => CreateCuteDuckVector(mood),
                    4 => CreateCuteBirdVector(mood),
                    5 => CreateCutePandaVector(mood),
                    6 => CreateCuteOtterVector(mood),
                    7 => CreateCuteHedgehogVector(mood),
                    8 => CreateCuteOwlVector(mood),
                    9 => CreateCuteSealVector(mood),
                    10 => CreateCuteRaccoonVector(mood),
                    11 => CreateCuteHamsterVector(mood),
                    12 => CreateCuteFrogVector(mood),
                    13 => CreateCuteKoalaVector(mood),
                    _ => CreateCuteChickVector(mood)
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

        /// <summary>
        /// Git #1803 — a lighter-weight sibling of <see cref="CreateQueueCardMascot"/> for
        /// surfaces that don't have a real <see cref="QueueItem"/> to key off (Batter Up /
        /// AI Batter Up read straight off the GitHub project board, not the build queue).
        /// Reuses the exact same critter-vector pool + stable per-item variant selection +
        /// float/glow treatment so those cards carry the identical mascot language as a real
        /// queue card, just driven by a caller-supplied seed (e.g. the issue number) and mood
        /// instead of item.Status/interactiveState.
        /// </summary>
        internal static UIElement CreateGenericCardMascot(int seed, CritterMood mood, bool isBlocked = false)
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

            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;

            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            floatTrans.BeginAnimation(TranslateTransform.YProperty, floatAnim);

            int variant = Math.Abs(seed % 15);
            FrameworkElement critter = isBlocked
                ? IssueChompAnimation.BuildRandomBlockedElement(scale: 0.5)
                : (FrameworkElement)(variant switch
                {
                    0 => CreateCuteFoxVector(mood),
                    1 => CreateCuteBearVector(mood),
                    2 => CreateCuteCatVector(mood),
                    3 => CreateCuteDuckVector(mood),
                    4 => CreateCuteBirdVector(mood),
                    5 => CreateCutePandaVector(mood),
                    6 => CreateCuteOtterVector(mood),
                    7 => CreateCuteHedgehogVector(mood),
                    8 => CreateCuteOwlVector(mood),
                    9 => CreateCuteSealVector(mood),
                    10 => CreateCuteRaccoonVector(mood),
                    11 => CreateCuteHamsterVector(mood),
                    12 => CreateCuteFrogVector(mood),
                    13 => CreateCuteKoalaVector(mood),
                    _ => CreateCuteChickVector(mood)
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
                BlurRadius = isBlocked ? 7 : 6,
                ShadowDepth = 0,
                Opacity = 0.38
            };
            critter.Effect = glow;

            if (isBlocked)
            {
                var shimmer = new DoubleAnimation(0.30, 0.65, TimeSpan.FromSeconds(2.8))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                };
                glow.BeginAnimation(DropShadowEffect.OpacityProperty, shimmer);

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

            return container;
        }

        /// <summary>
        /// Git #1803 — the same status-pill visual (colored border/background badge,
        /// bold 9.5pt text) <see cref="BuildQueueCard"/> uses for its RUNNING/DONE/BLOCKED/etc.
        /// pills, factored out so Batter Up / AI Batter Up can build pills in the identical
        /// shape for their own statuses without duplicating the Border/TextBlock boilerplate.
        /// </summary>
        internal static Border BuildStatusPill(string text, Color bg, Color border, Color fg, string? tooltip = null)
        {
            var pill = new Border
            {
                Background = new SolidColorBrush(bg),
                BorderBrush = new SolidColorBrush(border),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 1.5, 6, 1.5)
            };
            pill.Child = new TextBlock
            {
                Text = text,
                FontSize = 9.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(fg),
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = tooltip
            };
            return pill;
        }

        /// <summary>
        /// Git #1803 — the same card shell (border/background treatment, corner radius,
        /// padding, spacing) <see cref="BuildQueueCard"/> uses for its default/blocked
        /// states, factored out so Batter Up / AI Batter Up render the identical card
        /// shape instead of a bare text row.
        /// </summary>
        internal static Border BuildGenericCardShell(bool isBlocked)
        {
            Color borderColor = isBlocked ? Color.FromRgb(0x5A, 0x2A, 0x34) : Color.FromRgb(0x31, 0x32, 0x44);
            Color bgColor = isBlocked ? Color.FromRgb(0x1E, 0x18, 0x22) : Color.FromRgb(0x18, 0x18, 0x25);
            return new Border
            {
                Background = new SolidColorBrush(bgColor),
                BorderBrush = new SolidColorBrush(borderColor),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
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

        // Git #1816 — the single shared refresh control for Git Board + Batter Up + AI
        // Batter Up. FullGitRefreshRequested drives LeftSidebar.PopulateGitTrackerBoard
        // (forceFresh: true), whose completion fires BoardRefreshCompleted — #1813 already
        // wired that event to also await BatterUpPanel.RefreshAsync() and
        // AiBatterUpPanel.RefreshAsync(), so clicking this one icon cascades into both
        // panels for free. Both are fire-and-forget from here (same as the Git Board fetch
        // itself), so the toast below fires once THIS panel's own refresh work is done, not
        // once every cascaded panel has repainted.
        private async void BtnRefreshGitHubTiles_Click(object sender, RoutedEventArgs e)
        {
            ActivityLog.Log("github.manual-refresh",
                "Build Queue panel [manual Refresh click]: re-fetching GitHub components (Board + Batter Up + AI Batter Up + Issues in Epic + In-Flight + Focus Progress).");

            FullGitRefreshRequested?.Invoke(this, EventArgs.Empty);

            await System.Threading.Tasks.Task.WhenAll(
                RefreshActiveChatEpicIssuesAsync(),
                RefreshInFlightIssuesAsync("manual Refresh click"),
                RefreshAsync());

            ToastEngine.Success("Git Sync", "Refreshed Git Board, Batter Up, AI Batter Up, epic issues, and queue!");
        }

        /// <summary>
        /// Git #1836 — Shane: this button triggers the exact same GitHub fetch as Git
        /// Board's own refresh button, but showed no disabled-state feedback of its own
        /// while that fetch (and its critter loading strip, on the Git Board panel) was
        /// in flight. MainWindow — which already owns both this panel and LeftSidebar —
        /// calls this around its awaited LeftSidebar.RefreshGitBoardWithLoadingFeedbackAsync()
        /// so BtnRefreshGitHubTiles is disabled for the same real span Git Board's own
        /// button is.
        /// </summary>
        public void SetGitHubTilesRefreshInProgress(bool inProgress) => BtnRefreshGitHubTiles.IsEnabled = !inProgress;

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
