using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;
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
    /// The real Build Queue panel — Shane: "Feel free to change anything to patch how
    /// I actually work based on the Add-In." Was 100% hardcoded demo XAML before this;
    /// now reads the same live queue the browser extension's left panel and
    /// scripts/build-queue-watcher.ps1 both already talk to (GET
    /// /extension/queue), nesting a blocked item under its blocker the same way
    /// content.js's renderQueueSection() does (Git #798/#799).
    /// </summary>
    public partial class BuildQueuePanel : UserControl
    {
        public event EventHandler<TaskSelectedEventArgs>? TaskSelected;
        public event EventHandler<bool>? PinToggled;
        /// <summary>Git #815 — mirrors LeftSidebar's SyncError: null on a successful poll, a message on a failed one.</summary>
        public event EventHandler<string?>? SyncError;
        /// <summary>Git #851 — Shane: "When clicking on an In-Flight Still Open issue, it should open the chat that is associated to that issue." MainWindow resolves the actual chat (via LeftSidebar.FindChatForIssue) and opens/focuses its tab, same as clicking a chat in the Chats tree.</summary>
        public event EventHandler<int>? IssueChatRequested;
        private bool _isPinned = true;

        /// <summary>
        /// Git #956 — Shane: "when I click on Queue in the chat... it shows
        /// the item in the queue in the right Build Queue panel. Then it
        /// disappears. Then about 20 or so seconds later it reappears."
        /// Root cause: RefreshAsync() had no protection against overlapping
        /// calls. Clicking the chat's injected "Queue" button (see #942 in
        /// MainWindow's BT_QUEUE_BUILD handler) triggers an immediate manual
        /// RefreshAsync() right after the POST, completely independent of
        /// the panel's own 15s _pollTimer — so if a regularly-scheduled poll
        /// happened to already be in flight (started slightly before the
        /// click, fetching the OLD list without the new item), the two live
        /// fetches could complete OUT OF ORDER: the click's own fetch (newer
        /// request, but a faster round trip) finishes first and correctly
        /// shows the new item, then the earlier-started poll finishes
        /// second with its stale pre-click snapshot and overwrites it —
        /// last-writer-wins with no ordering guarantee, not last-REQUESTED-
        /// wins. The item then reappears on the NEXT poll tick (~15s later),
        /// matching Shane's "~20 or so seconds" exactly. Fixed with a
        /// monotonic generation token: bumped synchronously the instant a
        /// call STARTS (before the await), so a call's result only gets
        /// applied if it's still the most-recently-STARTED call by the time
        /// its own fetch completes — whichever call was requested last
        /// always wins, regardless of which one's network round trip
        /// happens to finish first.
        /// </summary>
        private int _refreshGeneration;

        private BuildTrackerApiClient? _api;
        private Services.QueueWatcherService? _watcher;
        private DispatcherTimer? _pollTimer;
        private List<QueueItem> _lastItems = new();
        /// <summary>Git #933 — Shane: "make Queued &amp; Running first and Default." Matches QueueFilterCombo's own SelectedIndex="0" in XAML; kept in sync here too so the very first RefreshAsync (which can render before the ComboBox's own SelectionChanged has necessarily fired) filters correctly from the start.</summary>
        private string _filter = "Active";

        // Git #941 — Shane: "do the same '...' thing to the Completed and
        // To-Do fields." Same #932 lesson: CharacterEllipsis never engages
        // without an explicit numeric MaxWidth, so each title block built for
        // these two lists is registered here and given one computed from its
        // own ListBox's ActualWidth. Reserve = ListBoxItem's own 8,5 padding
        // (16px) + the row's leading icon column (~20px for a 12px emoji +
        // trailing space) + the tile content Border's own 4px padding (8px) +
        // a small safety buffer — over-reserving only trims a few px early
        // (safe), under-reserving re-introduces the overflow.
        private const double IssueRowTitleReserve = 50;
        private const double MinIssueRowTitleWidth = 24;
        private readonly List<TextBlock> _completedTitleBlocks = new();
        private readonly List<TextBlock> _toDoTitleBlocks = new();
        /// <summary>Git #971 — In-Flight/Sessions now get the same ellipsis treatment as Completed/To-Do, now that they're full-width single-column tiles too.</summary>
        private readonly List<TextBlock> _inFlightTitleBlocks = new();
        private readonly List<TextBlock> _sessionsTitleBlocks = new();

        private void ApplyTitleMaxWidths(ListBox listBox, List<TextBlock> registry)
        {
            var available = listBox.ActualWidth;
            foreach (var block in registry)
            {
                block.MaxWidth = Math.Max(MinIssueRowTitleWidth, available - IssueRowTitleReserve);
            }
        }

        private void CompletedIssuesList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(CompletedIssuesList, _completedTitleBlocks);
        }

        private void WaitingOnMeList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(WaitingOnMeList, _toDoTitleBlocks);
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

        /// <summary>Git #876 (reopened) — true only when the BuildConsole window hosting this panel is genuinely on screen (present, visible, not minimized). The background `gh` CLI GitHub polls are suppressed entirely otherwise, so a minimized/hidden app stops burning the shared 5,000/hr rate limit for no reason.</summary>
        private bool IsHostWindowVisible()
        {
            var w = Window.GetWindow(this);
            return w != null && w.IsVisible && w.WindowState != WindowState.Minimized;
        }

        /// <summary>Called once from MainWindow with the shared API client — starts polling immediately. `watcher` (Git #820) may be null (e.g. claude.exe not found) - Stop/Run Now degrade gracefully when it is, since those need a real local process handle/launcher.</summary>
        public void Initialize(BuildTrackerApiClient api, Services.QueueWatcherService? watcher = null)
        {
            _api = api;
            _watcher = watcher;

            // Git #831 — purely local machine state (claude agents --json),
            // not a bt_build_queue thing at all, so it polls regardless of
            // whether the API itself is configured/reachable.
            _sessionsPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _sessionsPollTimer.Tick += async (_, _) => await RefreshActiveSessionsAsync();
            _sessionsPollTimer.Start();
            _ = RefreshActiveSessionsAsync();

            // Git #848 — same reasoning: real GitHub state via the local
            // `gh` CLI directly, not bt_build_queue/the server at all, so it
            // polls unconditionally too.
            // Git #876 (reopened) — Shane: still crossing GitHub's 5,000/hour
            // rate limit. This timer and _waitingOnMePollTimer below both ran
            // unconditionally at 20s regardless of which tab/view is focused
            // or whether the panel is even visible — two real `gh` CLI calls
            // every 20s, all day, every time the app is open (~360 calls/hour
            // combined, on top of the Git Board's own traffic). Neither
            // fetch's own content changes anywhere near that fast (labels
            // don't flip in-flight/Shane-To-Do multiple times a minute), so
            // both moved to 60s — a real 3x cut to this panel's steady-state
            // GitHub traffic with no loss of correctness (the content-
            // signature guard already in RenderIssueList/RenderInFlightGrouped
            // still skips a no-op re-render either way).
            // Git #876 (reopened) — Shane: "heavy GitHub API traffic for no
            // reason." These three `gh` CLI reads each hit GitHub's REST API
            // (gh uses it under the hood, sharing the same 5,000/hr account
            // limit as the Git Board), and #876's earlier pass only slowed them
            // 20s -> 60s: they still fired unconditionally, all day, even while
            // BuildConsole was minimized/hidden. Now every background tick is
            // gated on the window actually being on screen (initial immediate
            // paint on Initialize is kept). No visible window = no reason to be
            // polling GitHub.
            _inFlightPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            _inFlightPollTimer.Tick += async (_, _) => { if (IsHostWindowVisible()) await RefreshInFlightIssuesAsync(); };
            _inFlightPollTimer.Start();
            _ = RefreshInFlightIssuesAsync();

            // Git #850 — same direct-gh-CLI reasoning, "Shane To-Do" label.
            _waitingOnMePollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            _waitingOnMePollTimer.Tick += async (_, _) => { if (IsHostWindowVisible()) await RefreshWaitingOnMeAsync(); };
            _waitingOnMePollTimer.Start();
            _ = RefreshWaitingOnMeAsync();

            // Git #905 — same direct-gh-CLI reasoning as In-Flight/To-Do above,
            // just "which issue numbers are open" instead of a label filter.
            _completedPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
            _completedPollTimer.Tick += async (_, _) => { if (IsHostWindowVisible()) await RefreshCompletedAsync(); };
            _completedPollTimer.Start();
            _ = RefreshCompletedAsync();

            if (!api.IsConfigured)
            {
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "Not connected — set apiBaseUrl/ingestToken in scripts\\build-queue-watcher.config.json (Settings tab has the path).";
                QueueEmptyText.Visibility = Visibility.Visible;
                return;
            }

            _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            _pollTimer.Tick += async (_, _) => await RefreshAsync();
            _pollTimer.Start();
            _ = RefreshAsync();
        }

        // Git #831 — Shane: "the right panel needs to have an All In
        // session... I should see the things you are working on but I
        // cannot." Real presence data (name/cwd/kind/elapsed) via `claude
        // agents --json` - not activity DETAIL (no live transcript tail),
        // but a real improvement over zero visibility into a session that
        // never touches the queue at all.
        private DispatcherTimer? _sessionsPollTimer;
        private string? _lastSessionsSignature;

        // Git #1001 — the WMI-based ancestor-window walk (#995) is slow enough
        // (a real COM round trip per level, per session) that it can still be
        // in flight when the next 10s _sessionsPollTimer tick fires, stacking
        // up overlapping ListActiveSessionsWithFallbackAsync calls. Besides
        // wasting real WMI work, this is exactly the same class of bug #956
        // fixed for the Queue panel - discovered here because DebugLog's own
        // overwrite-not-append writes made the race directly visible (an
        // older, still-in-flight call's early-stage write landing AFTER a
        // newer call's later-stage one). A simple in-flight guard is enough:
        // unlike #956's RefreshAsync, nothing here needs the LATEST call's
        // result specifically to win — Sessions data doesn't go stale in a
        // way that matters between two polls 10s apart, so simply skipping a
        // tick that finds one already running is sufficient and avoids the
        // duplicate WMI cost entirely instead of just discarding it after the
        // fact.
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
                // Git #991 — Shane: "fall back using Get-Process," after
                // proving side-by-side that `claude agents --json` doesn't
                // discover every real running claude.exe (Send-to-Builder
                // launches specifically went missing from it). Merges the
                // CLI's own list with a raw OS process scan for anything it
                // missed - see ClaudeAgentsService's own doc comment.
                sessions = await Services.ClaudeAgentsService.ListActiveSessionsWithFallbackAsync();
            }
            catch
            {
                return; // best-effort - a shell-out hiccup shouldn't blank out what's already shown
            }

            var signature = System.Text.Json.JsonSerializer.Serialize(sessions);
            if (signature == _lastSessionsSignature) return;
            _lastSessionsSignature = signature;

            // Git #874 — replaces #866's tab-header count with the quiet
            // count-badge tile's own count text (TileSessions is collapsed
            // by default, so this is the at-a-glance value while collapsed).
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
                // Git #991 — "untracked" (Get-Process fallback, no name/cwd/session
                // available without WMI) gets its own quiet ❔ marker so it visually
                // reads as "we can see it's real, just not what it is."
                var icon = s.Kind switch { "background" => "⚙", "untracked" => "❔", _ => "▶" };
                var iconColor = s.Kind switch { "background" => "#8F8C88", "untracked" => "#8F8C88", _ => "#F2CA63" };

                var panel = new StackPanel { Orientation = Orientation.Horizontal };
                panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColor)), VerticalAlignment = VerticalAlignment.Center });
                var textStack = new StackPanel();
                // Git #971 — same #932/#941 ellipsis lesson: single-line + CharacterEllipsis, MaxWidth applied by ApplyTitleMaxWidths.
                string title = !string.IsNullOrWhiteSpace(s.Name) ? s.Name
                    : !string.IsNullOrWhiteSpace(s.SessionId) ? s.SessionId[..Math.Min(8, s.SessionId.Length)]
                    : $"claude.exe (untracked)";
                var titleBlock = new TextBlock { Text = title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush"), TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis };
                _sessionsTitleBlocks.Add(titleBlock);
                textStack.Children.Add(titleBlock);
                string subtitle = s.Kind == "untracked" ? $"PID {s.Pid}  ·  {elapsedStr} ago" : $"{s.Cwd}  ·  {elapsedStr} ago";
                textStack.Children.Add(new TextBlock { Text = subtitle, FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
                panel.Children.Add(textStack);
                // Git #1001 — Shane: "if I clicked on them they brought that
                // window into focus." Tag carries the session so the click
                // handler can bring its resolved ancestor window forward;
                // no handle resolved (window already closed/inaccessible)
                // just means the click quietly no-ops, same tooltip either way.
                string tooltip = s.Kind == "untracked"
                    ? $"PID {s.Pid} · seen via Get-Process, not reported by claude agents --json"
                    : $"PID {s.Pid} · {s.Kind} · session {s.SessionId}";
                if (s.WindowHandle != IntPtr.Zero) tooltip += " · click to bring its window forward";

                // Git #1001 — Shane: "Give me a right click context menu to
                // close them." Same immediate-kill-no-confirmation shape as
                // the Queue tree's own "⏹ Stop" (see BuildTreeItemContextMenu
                // below) — this app's established convention for a real
                // running process, not a queued-but-not-started item.
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

        /// <summary>Git #1001 — kills the real claude.exe process (and its tree, e.g. any tool subprocess it spawned) for a Sessions row. No confirmation dialog, matching this app's existing "⏹ Stop" convention for a real running process.</summary>
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
                MessageBox.Show($"Couldn't close session: {ex.Message}", "Close Session");
            }
            _ = RefreshActiveSessionsAsync();
        }

        /// <summary>Git #1001 — Shane: "if I clicked on them they brought that window into focus." Clears selection right after so re-clicking the same session still fires SelectionChanged, same pattern as InFlightIssuesList_SelectionChanged/CompletedIssuesList_SelectionChanged elsewhere in this file.</summary>
        private void ActiveSessionsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (ActiveSessionsList.SelectedItem is ListBoxItem { Tag: Services.ClaudeAgentSession session })
            {
                Services.ClaudeAgentsService.BringToForeground(session.WindowHandle);
                ActiveSessionsList.SelectedItem = null;
            }
        }

        /// <summary>
        /// Git #848 — Shane: "In Git there 10 In Flight, Still open. And
        /// none are showing in the right panel... why can't the WPF just
        /// connect directly to Git to get this stuff... no real reason for
        /// it to go through my server anymore." Replaces #835's chat-tab-
        /// scoped version entirely: real open GitHub issues carrying the
        /// in-flight label, fetched directly via the local `gh` CLI
        /// (GitHubIssuesService) - no bt_build_queue involvement, no server
        /// round-trip, same self-contained polling shape as
        /// RefreshActiveSessionsAsync above.
        /// </summary>
        private DispatcherTimer? _inFlightPollTimer;
        private string? _lastInFlightSignature;

        private async System.Threading.Tasks.Task RefreshInFlightIssuesAsync()
        {
            List<Services.GitHubIssueSummary> issues;
            try { issues = await Services.GitHubIssuesService.ListOpenByLabelAsync("in-flight"); }
            catch { return; } // best-effort - a gh CLI hiccup shouldn't blank out what's already shown

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastInFlightSignature) return;
            _lastInFlightSignature = signature;

            RenderInFlightGrouped(issues);
        }

        /// <summary>
        /// Git #854 — Shane: "these can be grouped by their Epic?" Uses the
        /// real `parent` field `gh issue list --json` exposes (confirmed
        /// live) rather than any local guess - issues sharing a parent
        /// group under that epic's own title; issues with no parent (either
        /// truly unlinked, or an epic itself) land in an "No Epic" bucket at
        /// the end. Group headers carry no Tag, so InFlightIssuesList_
        /// SelectionChanged's Tag-match naturally ignores clicks on them.
        /// </summary>
        private void RenderInFlightGrouped(List<Services.GitHubIssueSummary> issues)
        {
            // Git #874 — see RefreshActiveSessionsAsync's identical comment.
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
                    // Git #971 — registered now that In-Flight is a full-width tile getting the same ellipsis treatment as Completed/To-Do.
                    InFlightIssuesList.Items.Add(BuildIssueRow(issue, "⏳", "#F2CA63", _inFlightTitleBlocks));
                }
            }
            ApplyTitleMaxWidths(InFlightIssuesList, _inFlightTitleBlocks);
        }

        /// <summary>
        /// Git #850 — Shane: "Why I need in the right panel another section
        /// that says... Waiting on me... to run SQL, Test, Etc." Exactly
        /// what CLAUDE.md's own "Shane To-Do" GitHub label already tracks -
        /// an action only Shane can take himself (run SQL, restart server,
        /// etc), applied by Claude at the DONE bookend and cleared only by
        /// Shane once actually done. Same direct-gh-CLI shape as In-Flight.
        /// </summary>
        private DispatcherTimer? _waitingOnMePollTimer;
        private string? _lastWaitingOnMeSignature;

        private async System.Threading.Tasks.Task RefreshWaitingOnMeAsync()
        {
            List<Services.GitHubIssueSummary> issues;
            try { issues = await Services.GitHubIssuesService.ListOpenByLabelAsync("Shane To-Do"); }
            catch { return; }

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastWaitingOnMeSignature) return;
            _lastWaitingOnMeSignature = signature;

            // Git #874 — the To-Do tile is the one section that should visually
            // announce itself once there's something in it (Shane: "To-Do I
            // reference only after a build tells me there is something for me
            // to do"), swapping to the app's existing PeachBrush accent; at 0
            // it stays identical to the neutral In-Flight/Sessions tiles.
            UpdateToDoTileAppearance(issues.Count);

            _toDoTitleBlocks.Clear();
            RenderIssueList(WaitingOnMeList, issues, "Nothing waiting on you.", "🔴", "#E5A3A3", _toDoTitleBlocks);
            ApplyTitleMaxWidths(WaitingOnMeList, _toDoTitleBlocks);
        }

        /// <summary>Shared by RefreshWaitingOnMeAsync (flat) and RenderInFlightGrouped (grouped, via BuildIssueRow) — same GitHubIssueSummary shape, just a different label/empty-text/icon. `titleRegistry` (Git #941) is only passed by the To-Do caller — In-Flight keeps its original wrapping titles, untouched.</summary>
        private static void RenderIssueList(ListBox listBox, List<Services.GitHubIssueSummary> issues, string emptyText, string icon, string iconColorHex, List<TextBlock>? titleRegistry = null)
        {
            listBox.Items.Clear();
            if (issues.Count == 0)
            {
                listBox.Items.Add(new ListBoxItem { Content = emptyText, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }
            foreach (var issue in issues.OrderByDescending(i => i.UpdatedAt))
            {
                listBox.Items.Add(BuildIssueRow(issue, icon, iconColorHex, titleRegistry));
            }
        }

        /// <summary>
        /// Git #854 — Shane: "updated -234m ago... can you convert that to
        /// real time for me?" GitHub returns UpdatedAt in UTC; the old code
        /// subtracted it straight from DateTime.Now (LOCAL), skewing the
        /// result by the local UTC offset - explains the negative minutes.
        /// Shows a real local timestamp instead of a relative "Xm/h ago"
        /// calculation, sidestepping that class of bug entirely rather than
        /// just patching the arithmetic.
        /// </summary>
        private static ListBoxItem BuildIssueRow(Services.GitHubIssueSummary issue, string icon, string iconColorHex, List<TextBlock>? titleRegistry = null)
        {
            string localTime = issue.UpdatedAt.ToLocalTime().ToString("MMM d, h:mm tt");

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(iconColorHex)), VerticalAlignment = VerticalAlignment.Center });
            var textStack = new StackPanel();
            var titleBlock = new TextBlock { Text = issue.Title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush") };
            if (titleRegistry != null)
            {
                // Git #941 — single-line + CharacterEllipsis (needs a real MaxWidth
                // to actually engage; see ApplyTitleMaxWidths) instead of wrapping.
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

        /// <summary>
        /// Git #905 — Shane: "I ran a fix on an item in the 400s, it went to
        /// done... I don't know what it was... Maybe I need like a last
        /// complete list that stays there until the actual issue is closed
        /// in Git." Two independently-cadenced inputs: `_lastItems` (the
        /// real queue, refreshed every 15s by RefreshAsync) and
        /// `_lastOpenIssueNumbers` (which GitHub issue numbers are
        /// currently OPEN, refreshed every 60s here via `gh` CLI, same
        /// reasoning as In-Flight/To-Do's own 60s cadence per #876). The
        /// render itself (RenderCompletedFromCache) is pure and cheap, so
        /// it's called from BOTH refresh paths - RefreshAsync's own success
        /// path calls it too, so a newly-done queue item shows up promptly
        /// against whatever open-numbers snapshot is currently cached,
        /// without needing its own `gh` call every 15s.
        /// </summary>
        private DispatcherTimer? _completedPollTimer;
        private HashSet<int> _lastOpenIssueNumbers = new();
        private string? _lastCompletedSignature;

        private async System.Threading.Tasks.Task RefreshCompletedAsync()
        {
            try { _lastOpenIssueNumbers = await Services.GitHubIssuesService.GetOpenIssueNumbersAsync(); }
            catch { return; } // best-effort - a gh CLI hiccup shouldn't blank out what's already shown

            RenderCompletedFromCache();
        }

        private void RenderCompletedFromCache()
        {
            var completed = _lastItems
                .Where(i => i.Status == "done" && i.GithubNumber.HasValue && _lastOpenIssueNumbers.Contains(i.GithubNumber.Value))
                .OrderByDescending(i => i.UpdatedAt)
                .ToList();

            var signature = System.Text.Json.JsonSerializer.Serialize(completed.Select(i => new { i.Id, i.GithubNumber, i.UpdatedAt }));
            if (signature == _lastCompletedSignature) return;
            _lastCompletedSignature = signature;

            UpdateCompletedTileAppearance(completed.Count);

            _completedTitleBlocks.Clear();
            CompletedIssuesList.Items.Clear();
            if (completed.Count == 0)
            {
                CompletedIssuesList.Items.Add(new ListBoxItem { Content = "Nothing done with an open issue.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }
            foreach (var item in completed)
            {
                CompletedIssuesList.Items.Add(BuildCompletedRow(item, _completedTitleBlocks));
            }
            ApplyTitleMaxWidths(CompletedIssuesList, _completedTitleBlocks);
        }

        /// <summary>Git #905 — Tag carries the real GitHub issue number so CompletedIssuesList_SelectionChanged can open it directly (the queue row itself has no Url field to reuse, unlike GitHubIssueSummary's rows elsewhere in this panel).</summary>
        private static ListBoxItem BuildCompletedRow(QueueItem item, List<TextBlock> titleRegistry)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = "✅ ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#7FAE91")), VerticalAlignment = VerticalAlignment.Center });
            var textStack = new StackPanel();
            // Git #941 — single-line + CharacterEllipsis, same as BuildIssueRow's
            // registered path; see ApplyTitleMaxWidths for why MaxWidth is required.
            var titleBlock = new TextBlock { Text = item.Title, FontSize = 12, Foreground = (Brush)Application.Current.FindResource("TextBrush"), TextWrapping = TextWrapping.NoWrap, TextTrimming = TextTrimming.CharacterEllipsis };
            titleRegistry.Add(titleBlock);
            textStack.Children.Add(titleBlock);
            string doneWhen = item.UpdatedAt.HasValue ? item.UpdatedAt.Value.ToLocalTime().ToString("MMM d, h:mm tt") : "unknown time";
            textStack.Children.Add(new TextBlock { Text = $"#{item.GithubNumber}  ·  done {doneWhen}  ·  click to close on GitHub", FontSize = 10, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"), TextWrapping = TextWrapping.Wrap });
            panel.Children.Add(textStack);
            return new ListBoxItem { Content = panel, Tag = item.GithubNumber };
        }

        /// <summary>Git #905 — clicking a row opens the real GitHub issue directly (the whole point: close it there to make the row disappear from this list on the next 60s refresh).</summary>
        private void CompletedIssuesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CompletedIssuesList.SelectedItem is ListBoxItem { Tag: int githubNumber })
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo($"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{githubNumber}") { UseShellExecute = true }); }
                catch { /* best-effort - worst case Shane just navigates there himself */ }
                CompletedIssuesList.SelectedItem = null; // so re-clicking the same row still fires SelectionChanged
            }
        }

        // Git #829 — Shane: "I need the right panel to have another section
        // that shows me all the issues assigned to the chat I'm on."
        // MainWindow calls this from EditorTabs_SelectionChanged whenever
        // the active tab changes; null/null/null clears it (not a chat tab,
        // or a chat with no linked epic).
        private int? _activeChatEpicId;

        /// <summary>
        /// Git #910 — Shane: "how long does it take now when I assign an
        /// issue to a parent for it to show up in my right side panel under
        /// it's parent?... 906, 908, 909 should be showing." It never would
        /// have: this used to read the internal bt_issues.epic_id table
        /// (server-side), a completely separate system from GitHub's real
        /// sub-issue graph that "Assign to Epic..." (#844) actually writes
        /// to - no sync connects the two, so it wasn't a timing issue, it
        /// would never show up. Now fetches the epic's REAL sub-issues
        /// directly (GitHubApiClient.GetSubIssuesAsync), same real-GitHub-
        /// state principle #839/#874 established elsewhere in this app -
        /// each GitHubSubIssue already carries its own real State, so the
        /// old separate FetchRealIssueStatesAsync per-issue lookup this
        /// used to need is gone entirely, not just redirected.
        /// </summary>
        private List<GitHubSubIssue> _lastEpicIssues = new();
        private string _epicFilter = "Open";

        public async void SetActiveChatEpic(int? epicId, int? epicGithubNumber, string? epicTitle)
        {
            if (epicId == _activeChatEpicId) return;
            _activeChatEpicId = epicId;

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

            // The tab may have changed again while that fetch was in flight.
            if (_activeChatEpicId != epicId) return;

            _lastEpicIssues = issues;
            RenderChatEpicIssues();
        }

        private static bool IsRealClosed(string state) => string.Equals(state, "closed", StringComparison.OrdinalIgnoreCase);

        /// <summary>Git #874 — re-filters the already-fetched _lastEpicIssues in place (All/Open/Closed); called both after a fresh SetActiveChatEpic load and from EpicFilterChip_Click.</summary>
        private void RenderChatEpicIssues()
        {
            ChatEpicIssuesList.Items.Clear();
            if (_lastEpicIssues.Count == 0)
            {
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = "No sub-issues under this epic yet.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            var filtered = _epicFilter switch
            {
                "Open"   => _lastEpicIssues.Where(i => !IsRealClosed(i.State)).ToList(),
                "Closed" => _lastEpicIssues.Where(i => IsRealClosed(i.State)).ToList(),
                _        => _lastEpicIssues,
            };

            if (filtered.Count == 0)
            {
                string emptyText = _epicFilter switch
                {
                    "Open"   => "No open issues under this epic.",
                    "Closed" => "No closed issues under this epic.",
                    _        => "No issues under this epic yet.",
                };
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = emptyText, Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                return;
            }

            foreach (var issue in filtered)
            {
                var (icon, hex) = IsRealClosed(issue.State) ? ("✅", "#7FAE91") : ("⏳", "#8F8C88");
                var panel = new Grid();
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                panel.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var iconBlock = new TextBlock { Text = icon + " ", FontSize = 12, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)), VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(iconBlock, 0);
                panel.Children.Add(iconBlock);
                var titleBlock = new TextBlock
                {
                    Text = $"#{issue.Number} — {issue.Title}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                Grid.SetColumn(titleBlock, 1);
                panel.Children.Add(titleBlock);
                ChatEpicIssuesList.Items.Add(new ListBoxItem { Content = panel, ToolTip = issue.HtmlUrl });
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

        // Git #821 — Shane: "stop all the flashing... every refresh the
        // left panel clears and rebuilds." Same fix as LeftSidebar: skip
        // the rebuild entirely on a poll whose data is identical to what's
        // already rendered.
        private string? _lastQueueSignature;

        /// <summary>Git #931 — true whenever the last successful RefreshAsync served the local cache instead of a live fetch (dev server unreachable); RenderQueue reads this to prepend an offline banner regardless of which filter chip is active.</summary>
        private bool _queueIsStale;
        private DateTime? _queueCachedAtUtc;

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_api == null || !_api.IsConfigured) return;
            // Git #956 — claim the latest generation BEFORE the await, so any
            // call already in flight (older generation) knows, the instant it
            // completes, that it's been superseded and must not overwrite
            // what a more-recently-requested call applies (see the field's
            // own doc comment for the full race).
            int myGeneration = ++_refreshGeneration;
            try
            {
                // Git #931 — Shane: "even the build queue does the same
                // thing [as Chats]... but that one I want to keep on the
                // server, but maybe also have a synced local JSON file so I
                // can keep going even when the Replit dev servers shut
                // down." Falls back to the local cache instead of throwing
                // when the live fetch fails; QueueWatcherService's own
                // claim/launch path deliberately does NOT go through this
                // cached method (see GetQueueCachedAsync's doc comment) -
                // this is the visible panel only.
                var result = await _api.GetQueueCachedAsync();
                if (myGeneration != _refreshGeneration) return; // superseded by a newer refresh - discard this stale result
                _lastItems = result.Data;
                _queueIsStale = result.IsStale;
                _queueCachedAtUtc = result.CachedAtUtc;

                var signature = _queueIsStale + "|" + System.Text.Json.JsonSerializer.Serialize(_lastItems);
                if (signature != _lastQueueSignature)
                {
                    _lastQueueSignature = signature;
                    if (_filter != "Tests") RenderQueue(ApplyFilter(_lastItems));
                }
                // Git #812 — the Tests tree reads test-results/*.json off disk, not the queue
                // API, so a poll refreshes it regardless of whether the queue signature changed
                // (a new test run can land results without the queue itself changing at all).
                if (_filter == "Tests") RenderTestsTree();
                // Git #905 — a freshly-done item should show up on the Completed tile
                // promptly, not wait for that tile's own slower 60s gh CLI poll.
                RenderCompletedFromCache();
                SyncError?.Invoke(this, _queueIsStale
                    ? $"Build Queue: showing cached data from {_queueCachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
            }
            catch (Exception ex)
            {
                if (myGeneration != _refreshGeneration) return; // superseded - a newer refresh is already in flight or has already rendered
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = $"Couldn't reach the API: {ex.Message}";
                QueueEmptyText.Visibility = Visibility.Visible;
                SyncError?.Invoke(this, $"Build Queue: {ex.Message}");
            }
        }

        /// <summary>Git #814 - Shane: "can you make the filters in the build queue work." Chips were Shane's own hardcoded demo XAML, never wired to anything.</summary>
        private List<QueueItem> ApplyFilter(List<QueueItem> items) => _filter switch
        {
            "Active"   => items.Where(i => i.Status is "queued" or "running").ToList(),
            "Done"     => items.Where(i => i.Status == "done").ToList(),
            "Canceled" => items.Where(i => i.Status == "canceled").ToList(),
            _          => items,
        };

        /// <summary>
        /// Version-update / deploy gating — true when at least one queue item is
        /// currently <c>queued</c> or <c>running</c> (the exact "Active" set
        /// ApplyFilter uses). MainWindow's Update button reads this to decide
        /// whether it's safe to kick off a ShanesBuild deploy right now, or must
        /// defer until the queue drains. Reflects the last polled snapshot
        /// (_lastItems, refreshed every 15s by RefreshAsync); callers that need
        /// it guaranteed-fresh should <c>await RefreshAsync()</c> first.
        /// </summary>
        public bool HasActiveQueueItems =>
            _lastItems.Any(i => i.Status is "queued" or "running");

        /// <summary>Universal title-bar search — read-only view of the last polled queue snapshot (Title/Prompt/GithubNumber/Id/Status). Lets MainWindow's search match queue rows against the SAME in-memory list the tree renders, without a re-fetch or a parallel index. Mutation stays inside RefreshAsync.</summary>
        public IReadOnlyList<QueueItem> CurrentQueueItems => _lastItems;

        /// <summary>Universal title-bar search — reveal + select a specific queue row by its Id.
        /// Switches to the filter chip that actually renders that row, clears the GithubNumber
        /// search box (so nothing filters it back out), re-renders, then selects and scrolls the
        /// matching <see cref="TreeViewItem"/> (whose Tag is the <see cref="QueueItem"/>). Selecting
        /// it drives the existing TaskSelected path exactly as a manual click would.</summary>
        public void RevealQueueItem(int id)
        {
            var item = _lastItems.FirstOrDefault(i => i.Id == id);
            if (item == null) return;

            string targetFilter = item.Status switch
            {
                "queued" or "running" => "Active",
                "done"                => "Done",
                "canceled"            => "Canceled",
                _                     => "All",   // "failed" (and any other) only render under the unfiltered view
            };

            // Prefer syncing the real filter ComboBox (its SelectionChanged re-renders);
            // fall back to setting _filter + rendering directly when there's no matching item.
            ComboBoxItem? match = null;
            if (QueueFilterCombo != null)
            {
                foreach (var obj in QueueFilterCombo.Items)
                    if (obj is ComboBoxItem ci && (ci.Tag as string) == targetFilter) { match = ci; break; }
            }
            if (match != null && !ReferenceEquals(QueueFilterCombo!.SelectedItem, match))
                QueueFilterCombo.SelectedItem = match;   // fires QueueFilterCombo_SelectionChanged -> re-render
            else
                _filter = targetFilter;

            // Clear the number-search so the row isn't filtered out, then guarantee a render.
            if (QueueSearchBox != null && !string.IsNullOrEmpty(QueueSearchBox.Text))
                QueueSearchBox.Text = "";                // fires QueueSearchBox_TextChanged -> re-render
            else if (QueueTree != null && _filter != "Tests")
                RenderQueue(ApplyFilter(_lastItems));

            // Select + scroll the matching row (rows can nest under a group header, so recurse).
            var tvi = FindQueueTreeItem(QueueTree?.Items, id);
            if (tvi != null)
            {
                tvi.IsSelected = true;
                tvi.BringIntoView();
            }
        }

        private static TreeViewItem? FindQueueTreeItem(ItemCollection? items, int id)
        {
            if (items == null) return null;
            foreach (var obj in items)
            {
                if (obj is not TreeViewItem tvi) continue;
                if (tvi.Tag is QueueItem qi && qi.Id == id) return tvi;
                var nested = FindQueueTreeItem(tvi.Items, id);
                if (nested != null) { tvi.IsExpanded = true; return nested; }
            }
            return null;
        }

        /// <summary>Git #933 — replaces the old ToggleButton pill row (FilterChip_Click) that ran off the edge of a narrow panel; same ApplyFilter/RenderTestsTree logic, just driven by the ComboBox's selection instead of "which pill is checked."</summary>
        private void QueueFilterCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (QueueFilterCombo.SelectedItem is not ComboBoxItem selected) return;
            _filter = selected.Tag as string ?? "Active";

            // Git #935 — SelectedIndex="0" in XAML fires this SelectionChanged
            // synchronously during InitializeComponent() itself, before QueueTree
            // (declared later in the same BuildQueuePanel.xaml) has been assigned
            // yet. RenderQueue/RenderTestsTree null-ref on it at that point, which
            // — because this all happens mid-BAML-parse — crashed the entire app
            // at startup rather than just this panel. Nothing to render yet.
            if (QueueTree == null) return;

            if (_filter == "Tests") RenderTestsTree();
            else RenderQueue(ApplyFilter(_lastItems));
        }

        /// <summary>
        /// Git #950 — Shane: "Add a search box so I can search direct Git
        /// numbers." Live substring filter on GithubNumber, re-rendering as he
        /// types and clearing back to the full sorted list when empty. It
        /// layers on top of the current filter chip (RenderQueue reads
        /// ApplyFilter(_lastItems)) rather than bypassing it. The box is a
        /// queue-number filter only — under the Tests chip QueueTree shows the
        /// disk-based manifest tree (RenderTestsTree), which has no queue rows
        /// or GithubNumbers to match, so search is a no-op there.
        /// </summary>
        private string _queueSearch = "";

        private void QueueSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            _queueSearch = QueueSearchBox.Text ?? "";
            if (QueueTree == null || _filter == "Tests") return;
            RenderQueue(ApplyFilter(_lastItems));
        }

        /// <summary>
        /// Git #950 — Shane: "The Build Queue needs to sort biggest number to
        /// smallest number." Numbered rows come first, biggest GithubNumber
        /// first; un-numbered rows (a raw prompt queued with no --title/issue
        /// reference) sort after all numbered ones. QueueItem carries no
        /// CreatedAt, so Id descending is the reasonable "newest first"
        /// fallback for those (Id is the autoincrement PK — monotonic with
        /// creation order) rather than leaving them in raw API order; Id desc
        /// also tiebreaks duplicate rows that happen to share a GithubNumber.
        /// </summary>
        private static List<QueueItem> SortForDisplay(IEnumerable<QueueItem> items) =>
            items
                .OrderByDescending(i => i.GithubNumber.HasValue)
                .ThenByDescending(i => i.GithubNumber ?? 0)
                .ThenByDescending(i => i.Id)
                .ToList();

        private void RenderQueue(List<QueueItem> items)
        {
            // Git #950 — the number-search box (above QueueTree) filters the
            // already-chip-filtered list to rows whose GithubNumber contains
            // what's typed (substring on the number, e.g. "94" -> #940/#946/
            // #947); empty box = no filter. Applied here (not only in the
            // TextChanged handler) so a live 15s RefreshAsync poll or a chip
            // change re-applies the active search automatically too.
            var search = _queueSearch.Trim();
            bool searching = search.Length > 0;
            if (searching)
            {
                items = items
                    .Where(i => i.GithubNumber.HasValue &&
                                i.GithubNumber.Value.ToString().Contains(search))
                    .ToList();
            }

            QueueTree.Visibility = Visibility.Visible;
            QueueEmptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = searching
                ? $"No queued item matches #{search}."
                : _filter switch
                {
                    "Active"   => "Nothing queued or running.",
                    "Done"     => "Nothing done yet.",
                    "Canceled" => "Nothing canceled.",
                    _          => "Queue is empty.",
                };
            QueueTree.Items.Clear();

            // Git #931 — offline banner, shown regardless of which filter chip
            // is active, whenever this data came from the local cache instead
            // of a live fetch (see RefreshAsync's GetQueueCachedAsync call).
            if (_queueIsStale)
            {
                QueueTree.Items.Add(new TreeViewItem
                {
                    Header = $"⚠ Offline — showing cached queue from {_queueCachedAtUtc?.ToLocalTime():MMM d, h:mm tt}",
                    Foreground = (Brush)Application.Current.FindResource("PeachBrush"),
                    IsHitTestVisible = false,
                    Focusable = false,
                });
            }

            // Queued-for-restart group — items MainWindow.PendingUpdateQueue
            // intercepted-and-persisted to the local spillover file while a
            // version update sat waiting (see that file's own doc comment).
            // These are NOT in the real live queue yet (bt_build_queue never
            // saw them; a restart is what actually re-queues them), so they're
            // rendered as their own distinct, non-selectable group — visually
            // separate from the real active/pending/running rows below rather
            // than indistinguishable from them.
            RenderQueuedForRestartGroup();

            // Git #799/#813 — a queued item nests under its blocker only when
            // the blocker is ALSO currently in the queue (same scoping choice
            // content.js's renderQueueSection() made) - otherwise it just
            // shows its own "waiting on #N, #M" line, not nested. An item can
            // have several blockers (#813 - Shane tried "--blocked-by
            // 807,808,809"); it nests once, under the first one found in the
            // queue.
            var byGithubNumber = items.Where(i => i.GithubNumber.HasValue)
                                       .GroupBy(i => i.GithubNumber!.Value)
                                       .ToDictionary(g => g.Key, g => g.First());
            var childrenOf = new Dictionary<int, List<QueueItem>>();
            var topLevel = new List<QueueItem>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                var nestUnder = blockers.FirstOrDefault(n => n != item.GithubNumber && byGithubNumber.ContainsKey(n), -1);
                if (nestUnder != -1)
                {
                    if (!childrenOf.TryGetValue(nestUnder, out var list))
                    {
                        list = new List<QueueItem>();
                        childrenOf[nestUnder] = list;
                    }
                    list.Add(item);
                }
                else
                {
                    topLevel.Add(item);
                }
            }

            // Git #818 — Shane: "whoa" (screenshot: the same #806-#812 chain
            // rendered 2-4x over, nested inside itself). Root cause:
            // childrenOf is keyed by githubNumber, not by a specific row's
            // id — if two SEPARATE queue rows share a githubNumber (Shane
            // queued the same issue more than once while testing today),
            // EVERY row with that number independently pulls and renders
            // the FULL childrenOf[number] list again, so the whole subtree
            // fans out once per duplicate. A visited-by-id guard renders
            // each real row at most once regardless of how many other rows
            // share its githubNumber — also a real latent safety net
            // against a genuine blocker cycle (A blocked by B blocked by A)
            // causing infinite recursion, which nothing here guarded
            // against before.
            var renderedIds = new HashSet<int>();

            void RenderOne(QueueItem item, ItemsControl parent)
            {
                if (!renderedIds.Add(item.Id)) return;
                var tvi = BuildQueueTreeItem(item);
                parent.Items.Add(tvi);
                if (item.GithubNumber.HasValue && childrenOf.TryGetValue(item.GithubNumber.Value, out var kids))
                {
                    // Git #950 — same descending-by-number ordering within a
                    // nested blocked-by group as at the top level.
                    foreach (var kid in SortForDisplay(kids)) RenderOne(kid, tvi);
                }
            }

            // Git #950 — biggest GithubNumber first (see SortForDisplay).
            foreach (var item in SortForDisplay(topLevel)) RenderOne(item, QueueTree);
        }

        /// <summary>
        /// Reads MainWindow's pending-update spillover file (see
        /// MainWindow.PendingUpdateQueue.cs) and, if anything's currently
        /// waiting there, adds a distinct "🔄 Queued for Restart" group at
        /// the top of QueueTree — a non-selectable header row plus one
        /// non-selectable child row per persisted item, styled in MauveBrush
        /// so it reads as its own category rather than blending into the
        /// real queued/running rows StatusStyle colors below it. Read
        /// directly off disk (not cached), same as MainWindow's own
        /// LoadPersistedQueueRequests — this file only ever changes on a
        /// Queue click during a pending update or on the post-restart
        /// replay, both rare, so a fresh read each RenderQueue call is cheap
        /// and always current.
        /// </summary>
        private void RenderQueuedForRestartGroup()
        {
            List<MainWindow.PersistedQueueDisplayItem> pending;
            try { pending = MainWindow.GetPersistedQueueDisplayItems(); }
            catch { return; } // best-effort — a read hiccup shouldn't block the real queue from rendering
            if (pending.Count == 0) return;

            var restartBrush = (Brush)Application.Current.FindResource("MauveBrush");
            var header = new StackPanel { Orientation = Orientation.Horizontal };
            header.Children.Add(new TextBlock { Text = "🔄 ", FontSize = 12, Foreground = restartBrush, VerticalAlignment = VerticalAlignment.Center });
            header.Children.Add(new TextBlock
            {
                Text = $"Queued for Restart ({pending.Count})",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = restartBrush,
                VerticalAlignment = VerticalAlignment.Center,
            });
            var groupItem = new TreeViewItem { Header = header, IsExpanded = true, IsHitTestVisible = false, Focusable = false };

            foreach (var item in pending)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal };
                row.Children.Add(new TextBlock { Text = "⏸ ", FontSize = 12, Foreground = restartBrush, VerticalAlignment = VerticalAlignment.Center });
                row.Children.Add(new TextBlock
                {
                    Text = item.GithubNumber.HasValue ? $"{FormatIssueRef(item.GithubNumber.Value)} — {item.Title}" : item.Title,
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });
                groupItem.Items.Add(new TreeViewItem
                {
                    Header = row,
                    IsHitTestVisible = false,
                    Focusable = false,
                });
            }

            QueueTree.Items.Add(groupItem);
        }

        /// <summary>Git #1034 — a negative number is one of Shane's own local
        /// --notGit pseudo-issue numbers (never a real GitHub issue, which are
        /// always positive), so it's displayed as "local #N" instead of the raw
        /// "#-N" to read clearly as not-a-real-issue at a glance.</summary>
        private static string FormatIssueRef(int n) => n < 0 ? $"local #{-n}" : $"#{n}";

        private static readonly Dictionary<string, (string Icon, string Hex)> StatusStyle = new()
        {
            ["queued"]   = ("⏳", "#8F8C88"),
            ["running"]  = ("▶", "#F2CA63"),
            ["done"]     = ("✅", "#7FAE91"),
            ["failed"]   = ("✕", "#E57A7A"),
            ["canceled"] = ("—", "#5A5856"),
        };

        /// <summary>Git #812 (Phase 7 of Epic #803) — Tests chip's status-dot palette, matching StatusStyle's shape/naming above (icon + hex pair keyed by state).</summary>
        private static readonly Dictionary<string, (string Icon, string Hex)> TestStatusStyle = new()
        {
            ["passed"] = ("✅", "#7FAE91"),
            ["failed"] = ("✕", "#E57A7A"),
            ["none"]   = ("•", "#8F8C88"),
        };

        /// <summary>
        /// Git #812 (Phase 7 of Epic #803) — Tests filter chip: reuses this same panel/TreeView
        /// but populates it from the local test-manifests/test-results file tree instead of the
        /// live queue API, since test results are written straight to disk by RunManifestAsync ->
        /// ManifestRunResult.WriteToFile (test-results/{issue}-{timestamp}.json per #803's Repo
        /// Structure section) rather than tracked by the build-tracker DB. Shows the most recent
        /// run's pass/fail per manifest using the same status-dot pattern BuildQueueTreeItem uses.
        /// </summary>
        private void RenderTestsTree()
        {
            QueueTree.Items.Clear();

            string? repoRoot = BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                QueueTree.Visibility = Visibility.Collapsed;
                QueueEmptyText.Text = "No repo root found — can't locate test-manifests/test-results (Settings tab has the config path).";
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

            QueueTree.Visibility = Visibility.Visible;
            QueueEmptyText.Visibility = manifestFiles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            QueueEmptyText.Text = "No test manifests found in test-manifests/.";

            // Latest test-results/{issue}-{timestamp}.json per issue — filenames sort
            // chronologically since the timestamp segment is yyyyMMddHHmmss.
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

                var panel = new StackPanel { Orientation = Orientation.Horizontal };
                panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
                panel.Children.Add(new TextBlock
                {
                    Text = $"#{manifest.Issue} — {manifest.Feature}",
                    FontSize = 12,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });
                panel.Children.Add(new TextBlock
                {
                    Text = "  " + subtitle,
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });

                QueueTree.Items.Add(new TreeViewItem { Header = panel, Tag = manifestPath });
            }
        }

        /// <summary>
        /// Git #947 — attaches the custom dark bubble tooltip (BubbleToolTip
        /// style in DarkTheme.xaml) to a queue row's number/title block, showing
        /// a short description trimmed to ~80 chars. No tooltip is attached for a
        /// blank title (older/"Untitled" rows), since an empty bubble is noise.
        /// </summary>
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
                    MaxWidth = 296, // inside the bubble's own 320 MaxWidth minus its 12px side padding
                    Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                    FontSize = 12,
                },
            };
            // Show promptly on hover rather than the ~1s WPF default.
            ToolTipService.SetInitialShowDelay(target, 250);
            ToolTipService.SetShowDuration(target, 20000);
        }

        private TreeViewItem BuildQueueTreeItem(QueueItem item)
        {
            var (icon, hex) = StatusStyle.TryGetValue(item.Status, out var s) ? s : ("•", "#CDD6F4");
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = icon + " ", FontSize = 12, Foreground = brush, VerticalAlignment = VerticalAlignment.Center });
            var titleBlock = new TextBlock
            {
                Text = item.Title,
                FontSize = 12,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            // Git #947 — Shane: "when I hover over the build number in the Queue
            // ... a pretty custom bubble tooltip appears and gives me a very
            // short description of what its building." The queue Title itself IS
            // that description (e.g. "#946 — BuildLogView line wrapping", or the
            // first line of the prompt when no --title was given), but it can run
            // long (queueBuildFromBlock slices a prompt's first line to 80 chars,
            // and a --title can be arbitrary), so it's trimmed to a single concise
            // bubble line rather than dumping a wall of text on hover. Attached to
            // the number/title block only (not the whole row), using the custom
            // BubbleToolTip style from DarkTheme.xaml.
            AttachBubbleTooltip(titleBlock, item.Title);
            panel.Children.Add(titleBlock);
            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            if (blockerList.Count > 0 && item.Status == "queued")
            {
                panel.Children.Add(new TextBlock
                {
                    Text = $"  waiting on {string.Join(", ", blockerList.Select(FormatIssueRef))}",
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E5A3A3")),
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }
            if (item.Status == "failed" && item.ExitCode.HasValue)
            {
                panel.Children.Add(new TextBlock
                {
                    Text = item.ExitCode == -2 ? "  orphaned by app restart — nothing was tracking it, use Retry" : $"  exit {item.ExitCode}",
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            // Git #950 — Shane: "Everything should be collapsed by default."
            // Nested blocked-by children (#799/#813) start hidden; Shane
            // expands a row to see what's nested under it.
            var tvi = new TreeViewItem { Header = panel, IsExpanded = false, Tag = item };

            // Git #801/#820 — Shane: "I need right click like. Stop. Retry.
            // Run Now." Mark Done was the original manual escape hatch (a
            // watcher restart orphans its in-memory tracking of anything
            // already running); Stop tries an actual kill first (only works
            // if THIS app's own in-process watcher launched it - it holds
            // the real Process handle, a different watcher's launches can't
            // be reached this way) then falls back to the same DB-only
            // unstick Mark Done already did. Run Now force-claims a queued
            // item (bypassing its blocker/free-slot wait) and launches it
            // immediately via the local watcher. Retry re-queues a
            // finished/failed/canceled item as a brand new row with the
            // same fields - queue rows aren't reset in place.
            var cm = new ContextMenu();
            if (item.Status == "running")
            {
                // Git — "Resume": unstick a BuildConsole-owned interactive build
                // that stalled on a dropped network connection (Shane lost WiFi;
                // the process is blocked mid-turn on a hung in-flight API call
                // and isn't reading stdin, so the Send box alone can't reach it).
                // Only offered when THIS app instance owns the live interactive
                // stdin — it works by aborting the hung call + sending a continue
                // message, which needs that owned stdin; a foreign/legacy watcher's
                // process can't be reached this way, so there's nothing to offer.
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
                    if (_api == null) return;
                    bool killed = _watcher?.TryStop(item.Id) ?? false;
                    await _api.MarkQueueItemCompleteAsync(item.Id, -1);
                    if (!killed)
                    {
                        MessageBox.Show(
                            "Marked stopped in the queue, but couldn't confirm the real process was killed — it may have been launched by a different watcher (the standalone script, or another machine) that this app can't reach directly.",
                            "Stop");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miStop);

                var miDone = new MenuItem { Header = "✓ Mark Done" };
                miDone.Click += async (_, _) => { if (_api != null) { await _api.MarkQueueItemCompleteAsync(item.Id, 0); await RefreshAsync(); } };
                cm.Items.Add(miDone);
            }
            if (item.Status == "queued")
            {
                var miRunNow = new MenuItem { Header = "▶ Run Now" };
                miRunNow.Click += async (_, _) =>
                {
                    if (_api == null) return;
                    if (_watcher == null)
                    {
                        MessageBox.Show("No local watcher available in this app instance (claude.exe not found, or config not set) — can't launch directly.", "Run Now");
                        return;
                    }
                    try
                    {
                        var claimed = await _api.ForceClaimQueueItemAsync(item.Id);
                        _watcher.ForceLaunch(claimed);
                        await RefreshAsync();
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show($"Couldn't run now: {ex.Message}", "Run Now");
                    }
                };
                cm.Items.Add(miRunNow);

                var miCancel = new MenuItem { Header = "✕ Cancel" };
                miCancel.Click += async (_, _) => { if (_api != null) { await _api.CancelQueueItemAsync(item.Id); await RefreshAsync(); } };
                cm.Items.Add(miCancel);
            }
            if (item.Status is "failed" or "canceled" or "done")
            {
                var miRetry = new MenuItem { Header = "🔁 Retry" };
                miRetry.Click += async (_, _) =>
                {
                    if (_api == null) return;
                    var res = await _api.QueueBuildAsync(item.Title, item.Prompt, item.Model, item.Effort, item.Cwd, item.GithubNumber, item.BlockedByNumbers);
                    if (!res.IsSuccessStatusCode)
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        MessageBox.Show($"Couldn't retry: {body}", "Retry");
                    }
                    await RefreshAsync();
                };
                cm.Items.Add(miRetry);

                // Git #826 — Shane: "how do I respond when Code has a
                // question... I need to be able to answer." claude.exe
                // --print is one-shot; by the time a question shows up in
                // the finished log, that process is gone. Only offered when
                // a real session_id was captured (older rows from before
                // this feature, or a run that crashed before its first
                // output line, won't have one) - resumes that EXACT
                // conversation via --resume instead of starting fresh.
                if (!string.IsNullOrWhiteSpace(item.SessionId))
                {
                    var miReply = new MenuItem { Header = "💬 Reply" };
                    miReply.Click += async (_, _) =>
                    {
                        if (_api == null) return;
                        var dialog = new ReplyDialog(item.Title);
                        if (dialog.ShowDialog() != true || string.IsNullOrWhiteSpace(dialog.ReplyText)) return;
                        var res = await _api.QueueBuildAsync(
                            $"Reply: {item.Title}", dialog.ReplyText, item.Model, item.Effort, item.Cwd,
                            item.GithubNumber, item.BlockedByNumbers, resumeSessionId: item.SessionId);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            MessageBox.Show($"Couldn't send reply: {body}", "Reply");
                        }
                        await RefreshAsync();
                    };
                    cm.Items.Add(miReply);
                }
            }
            if (cm.Items.Count > 0) tvi.ContextMenu = cm;

            return tvi;
        }

        private void QueueTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is QueueItem item)
            {
                TaskSelected?.Invoke(this, new TaskSelectedEventArgs
                {
                    QueueItemId = item.Id,
                    ExitCode = item.ExitCode,
                    Epic = item.GithubNumber.HasValue ? FormatIssueRef(item.GithubNumber.Value) : "",
                    Task = item.Title,
                    Status = item.Status,
                    StatusDetails = (item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>())) is { Count: > 0 } blockers
                        ? $"Waiting on {string.Join(", ", blockers.Select(FormatIssueRef))}"
                        : "",
                });
            }
        }

        /// <summary>Git #851 — "When clicking on an In-Flight Still Open issue, it should open the chat that is associated to that issue."</summary>
        private void InFlightIssuesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (InFlightIssuesList.SelectedItem is ListBoxItem { Tag: int githubNumber })
            {
                IssueChatRequested?.Invoke(this, githubNumber);
                InFlightIssuesList.SelectedItem = null; // so re-clicking the same row still fires SelectionChanged
            }
        }

        private void BtnPinQueue_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            PinQueueIcon.Text = _isPinned ? "📌" : "📍";
            PinToggled?.Invoke(this, _isPinned);
        }

        // Git #874 — In-Flight/Sessions/To-Do quiet tiles: collapsed by
        // default, each ToggleButton's own IsChecked (set by the click that
        // fired this handler) IS the expanded state, just mirrored onto its
        // content Border's Visibility.
        // Git #971 — Shane: "In-Flight and Sessions should not be a 2 column
        // layout, they should work the same as Completed & To-Do." Same
        // mutual-exclusion reasoning as #941's Completed/To-Do below: now
        // that these are full-width tiles with no MaxHeight cap, an open
        // list uses up real vertical room, so two open at once would just
        // push each other around instead of saving any scrolling.
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
        }

        // Git #941 — Shane: "collapse To-Do if I click To-Do collapse
        // Completed and expand To-Do the rest of the length" — Completed and
        // To-Do are mutually exclusive: expanding one force-collapses the
        // other rather than letting both sit open at once, since removing
        // their old MaxHeight="220" cap (see the XAML) means an open list
        // now grows to its full natural height, using up "the rest of the
        // length" of the panel — two open at once would just push each
        // other off-screen instead of actually saving Shane any scrolling.
        // Re-applying MaxWidths after expanding covers the case where the
        // list's SizeChanged fires before the registered title blocks exist
        // yet (first-ever expand of a freshly-rendered list).
        private void TileToDo_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileToDo.IsChecked == true;
            TileToDoContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileCompleted.IsChecked = false;
                TileCompletedContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(WaitingOnMeList, _toDoTitleBlocks);
            }
        }

        private void TileCompleted_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileCompleted.IsChecked == true;
            TileCompletedContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileToDo.IsChecked = false;
                TileToDoContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(CompletedIssuesList, _completedTitleBlocks);
            }
        }

        /// <summary>Git #874 — the To-Do tile is the one section that announces itself: PeachBrush (the app's existing warning/accent brush) once count > 0, cleared back to the QuietTile style's own neutral brushes at 0.</summary>
        private void UpdateToDoTileAppearance(int count)
        {
            ToDoCountText.Text = $"({count})";
            if (count > 0)
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                TileToDo.BorderBrush = peach;
                TileToDo.Foreground = peach;
                ToDoIcon.Foreground = peach;
                ToDoLabel.Foreground = peach;
                ToDoCountText.Foreground = peach;
            }
            else
            {
                TileToDo.ClearValue(BorderBrushProperty);
                TileToDo.ClearValue(ForegroundProperty);
                ToDoIcon.ClearValue(ForegroundProperty);
                ToDoLabel.ClearValue(ForegroundProperty);
                ToDoCountText.ClearValue(TextBlock.ForegroundProperty);
            }
        }

        /// <summary>Git #905 — same "announce itself" pattern as UpdateToDoTileAppearance above; a done build with its issue still open is just as much an action item as a Shane To-Do label.</summary>
        private void UpdateCompletedTileAppearance(int count)
        {
            CompletedCountText.Text = $"({count})";
            if (count > 0)
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                TileCompleted.BorderBrush = peach;
                TileCompleted.Foreground = peach;
                CompletedIcon.Foreground = peach;
                CompletedLabel.Foreground = peach;
                CompletedCountText.Foreground = peach;
            }
            else
            {
                TileCompleted.ClearValue(BorderBrushProperty);
                TileCompleted.ClearValue(ForegroundProperty);
                CompletedIcon.ClearValue(ForegroundProperty);
                CompletedLabel.ClearValue(ForegroundProperty);
                CompletedCountText.ClearValue(TextBlock.ForegroundProperty);
            }
        }
    }
}
