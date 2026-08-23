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
        /// <summary>Opens or focuses the Claude chat that created this Build Queue item.</summary>
        public event EventHandler<QueueItem>? QueueItemChatRequested;
        public event EventHandler<int>? EpicSubIssueClicked;
        public event EventHandler? FullGitRefreshRequested;
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
        private readonly HashSet<int> _manuallyHiddenQueueIds = new();

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
        private readonly List<TextBlock> _attentionTitleBlocks = new();

        // ── Needs Attention (durable #54-toast fallback) ─────────────────────────
        // A test run that fails, or trips #975's screenshot-review-needed state, surfaces the
        // #54 "needs attention" toast — which auto-dismisses after a few seconds and can be
        // missed. MainWindow.ApplyRunOutcomeToRunnerWindow ALSO records the same result here via
        // AddNeedsAttention; it STAYS in this collapsible section until Shane actually addresses
        // it (clicking the toast, or the row here — both open the Test Runner / review dialog and
        // clear the item). Purely in-memory + local — no GitHub, no DB. Keyed so re-running the
        // same manifest updates its existing row rather than piling duplicates.
        private const string AttentionChannel = "testing.needs-attention";

        /// <summary>One recorded needs-attention test result. <see cref="OnOpen"/> is the real
        /// address action (restore the Test Runner window + pop the deferred #975 review dialog),
        /// shared with the toast so either entry point does the same thing and clears the row.</summary>
        private sealed class NeedsAttentionItem
        {
            public string Key = "";
            public string Title = "";
            public string Body = "";
            public string Details = "";
            public bool IsFailure;
            public DateTime AtLocal;
            public Action? OnOpen;
        }

        private readonly List<NeedsAttentionItem> _attentionItems = new();

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

        private void AttentionList_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyTitleMaxWidths(AttentionList, _attentionTitleBlocks);
        }

        public BuildQueuePanel() => InitializeComponent();

        /// <summary>Called once from MainWindow with the shared API client — starts polling immediately. `watcher` (Git #820) may be null (e.g. claude.exe not found) - Stop/Run Now degrade gracefully when it is, since those need a real local process handle/launcher.</summary>
        public void Initialize(BuildTrackerApiClient api, Services.QueueWatcherService? watcher = null)
        {
            _api = api;
            _watcher = watcher;

            // Git #831 — purely local machine state (claude agents --json),
            // not a bt_build_queue thing at all, so it polls regardless of
            // whether the API itself is configured/reachable.
            _sessionsPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
            _sessionsPollTimer.Tick += async (_, _) =>
            {
                await RefreshActiveSessionsAsync();
                DevServerRollbackService.CheckForRollbacks(this);
            };
            _sessionsPollTimer.Start();
            _ = RefreshActiveSessionsAsync();
            DevServerRollbackService.CheckForRollbacks(this);

            // Manual-only GitHub (Shane, 2026-08-14): these three tiles each read
            // GitHub via the `gh` CLI — In-Flight (issues labelled in-flight),
            // To-Do ("Shane To-Do" label), Completed (the open-issue-number set).
            // They USED to poll on their own 60s DispatcherTimers, all day, every
            // time the app was open — real, continuous GitHub traffic sharing the
            // account's 5,000/hr limit. Shane: "this app is killing my git
            // connections... turn git into a manual refresh. I hit it when I know
            // things have changed instead of this automatic stuff." Those three
            // background timers are GONE. Each tile loads ONCE here (so the panel
            // isn't blank at startup) and otherwise refreshes ONLY when Shane
            // clicks the panel header's ⟳ Refresh button (BtnRefreshGitHubTiles_
            // Click). Every fetch — initial or manual — is logged on the
            // github.manual-refresh channel so all GitHub traffic is attributable.
            _ = RefreshInFlightIssuesAsync("initial load");
            _ = RefreshWaitingOnMeAsync("initial load");
            _ = RefreshCompletedAsync("initial load");

            // Live Test Watch subscription
            Services.TestQueueService.Instance.QueueChanged += () => Dispatcher.InvokeAsync(RefreshTestWatch);
            RefreshTestWatch();

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
                ToastEngine.Error("Close Session", $"Couldn't close session: {ex.Message}");
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
        private string? _lastInFlightSignature;
        /// <summary>Focus Mode — the last In-Flight issues fetched from `gh`, cached so a focus
        /// toggle can re-filter/re-render this list from memory with no new GitHub call.</summary>
        private List<Services.GitHubIssueSummary> _lastInFlightIssues = new();

        /// <summary>Manual-only GitHub (Shane, 2026-08-14): no longer polled on a
        /// timer — called once on Initialize ("initial load") and thereafter only
        /// from the panel's ⟳ Refresh button ("manual Refresh click"). Logs the
        /// real `gh` fetch + outcome on github.manual-refresh so this tile's GitHub
        /// traffic is fully attributable.</summary>
        private async System.Threading.Tasks.Task RefreshInFlightIssuesAsync(string trigger)
        {
            List<Services.GitHubIssueSummary> issues;
            try { issues = await Services.GitHubIssuesService.ListOpenByLabelAsync("in-flight"); }
            catch { ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: gh CLI fetch FAILED"); return; } // best-effort - a gh CLI hiccup shouldn't blank out what's already shown
            ActivityLog.Log("github.manual-refresh", $"In-Flight tile [{trigger}]: {issues.Count} open in-flight issue(s) via gh CLI");

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastInFlightSignature) return;
            _lastInFlightSignature = signature;

            _lastInFlightIssues = issues;
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
            // Focus Mode — hard-hide in-flight issues that don't belong to the active milestone
            // (each resolved by its own GitHub number against the open-board milestone map).
            // Applied here (the single render path) so both the gh refresh and the cache-only focus
            // reapply stay filtered; the count text below then reflects only what's actually shown.
            issues = ApplyIssueFocusFilter(issues);

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
        private string? _lastWaitingOnMeSignature;
        /// <summary>Focus Mode — the last To-Do (Shane To-Do) issues fetched from `gh`, cached so a
        /// focus toggle can re-filter/re-render this list from memory with no new GitHub call.</summary>
        private List<Services.GitHubIssueSummary> _lastWaitingOnMeIssues = new();

        /// <summary>Manual-only GitHub (Shane, 2026-08-14): no longer polled on a
        /// timer — "initial load" on Initialize, then only the ⟳ Refresh button.
        /// Logs the real `gh` fetch + outcome on github.manual-refresh.</summary>
        private async System.Threading.Tasks.Task RefreshWaitingOnMeAsync(string trigger)
        {
            List<Services.GitHubIssueSummary> issues;
            try { issues = await Services.GitHubIssuesService.ListOpenByLabelAsync("Shane To-Do"); }
            catch { ActivityLog.Log("github.manual-refresh", $"To-Do tile [{trigger}]: gh CLI fetch FAILED"); return; }
            ActivityLog.Log("github.manual-refresh", $"To-Do tile [{trigger}]: {issues.Count} open 'Shane To-Do' issue(s) via gh CLI");

            var signature = System.Text.Json.JsonSerializer.Serialize(issues);
            if (signature == _lastWaitingOnMeSignature) return;
            _lastWaitingOnMeSignature = signature;

            _lastWaitingOnMeIssues = issues;
            RenderWaitingOnMe(issues);
        }

        /// <summary>Renders the "Waiting on you" (Shane To-Do) list, applying Focus Mode's
        /// active-milestone hard filter. Shared by the gh-CLI refresh and the cache-only focus
        /// reapply, so a focus toggle re-filters this list with no GitHub call. The tile's count and
        /// its PeachBrush announce-appearance both reflect the post-filter, on-milestone count.</summary>
        private void RenderWaitingOnMe(List<Services.GitHubIssueSummary> issues)
        {
            // Focus Mode — hard-hide To-Do issues not in the active milestone (see ApplyIssueFocusFilter).
            issues = ApplyIssueFocusFilter(issues);

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

        /// <summary>Focus Mode — filters a GitHub-issue list to the active milestone (each issue's
        /// own number against the open-board milestone map). Off-focus it's a pass-through, so the
        /// unfiltered view stays byte-identical to before Focus Mode existed. No logging here (this
        /// runs on every render); the shown/hidden split is logged once per focus toggle in
        /// <see cref="ReapplyFocusFilter"/>.</summary>
        private static List<Services.GitHubIssueSummary> ApplyIssueFocusFilter(List<Services.GitHubIssueSummary> issues)
        {
            var focus = BuildConsole.Services.FocusModeService.Instance;
            return focus.IsActive
                ? issues.Where(i => focus.IsIssueInFocus(i.Number)).ToList()
                : issues;
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
        private HashSet<int> _lastOpenIssueNumbers = new();
        private string? _lastCompletedSignature;

        /// <summary>Manual-only GitHub (Shane, 2026-08-14): no longer polled on a
        /// timer — "initial load" on Initialize, then only the ⟳ Refresh button.
        /// (RenderCompletedFromCache is still called cheaply from the 15s queue
        /// poll, but that's local dev-server data — no `gh`/GitHub call.) Logs the
        /// real `gh` open-issue-number fetch + outcome on github.manual-refresh.</summary>
        private async System.Threading.Tasks.Task RefreshCompletedAsync(string trigger)
        {
            try { _lastOpenIssueNumbers = await Services.GitHubIssuesService.GetOpenIssueNumbersAsync(); }
            catch { ActivityLog.Log("github.manual-refresh", $"Completed tile [{trigger}]: gh CLI fetch FAILED"); return; } // best-effort - a gh CLI hiccup shouldn't blank out what's already shown
            ActivityLog.Log("github.manual-refresh", $"Completed tile [{trigger}]: {_lastOpenIssueNumbers.Count} open issue number(s) via gh CLI");

            RenderCompletedFromCache();
        }

        private void RenderCompletedFromCache()
        {
            var completed = _lastItems
                .Where(i => i.Status == "done" && i.GithubNumber.HasValue && _lastOpenIssueNumbers.Contains(i.GithubNumber.Value))
                // Focus Mode — hard-hide completed items whose issue isn't in the active milestone.
                .Where(i => BuildConsole.Services.FocusModeService.Instance.IsIssueInFocus(i.GithubNumber))
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

            // The tab may have changed again while that fetch was in flight.
            if (_activeChatEpicId != epicId) return;

            // Check if any sub-issues were closed since the last load
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

        /// <summary>Forces a fresh fetch of the current chat's epic issues from GitHub.</summary>
        public async System.Threading.Tasks.Task RefreshActiveChatEpicIssuesAsync()
        {
            if (_activeChatEpicId.HasValue && _activeChatEpicGithubNumber.HasValue)
            {
                SetActiveChatEpic(_activeChatEpicId, _activeChatEpicGithubNumber, _activeChatEpicTitle, force: true);
            }
            await System.Threading.Tasks.Task.CompletedTask;
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

        // Git #821 — Shane: "stop all the flashing... every refresh the
        // left panel clears and rebuilds." Same fix as LeftSidebar: skip
        // the rebuild entirely on a poll whose data is identical to what's
        // already rendered.
        private string? _lastQueueSignature;

        /// <summary>Queued-for-Restart lag fix — last rendered signature of the pending-update
        /// spillover group (title + github number per item), so RenderQueuedForRestartGroup logs a
        /// durable UI-refresh timestamp only when the group's contents actually change, not on every
        /// unrelated queue re-render.</summary>
        private string? _lastRestartGroupSignature;

        /// <summary>Git #931 — true whenever the last successful RefreshAsync served the local cache instead of a live fetch (dev server unreachable); RenderQueue reads this to prepend an offline banner regardless of which filter chip is active.</summary>
        private bool _queueIsStale;
        private DateTime? _queueCachedAtUtc;

        /// <summary>
        /// Queue critical-path visibility — computed once per <see cref="RenderQueue"/> over the
        /// exact set being rendered: QueueItem.Id → the number of OTHER queue items that
        /// transitively depend on it via the blocked-by graph (an item X depends on B when B is in
        /// X.BlockedByNumbers — the very same relationship RenderQueue already nests on). With Shane
        /// regularly stacking 10-20 queued builds in real blocked-by chains, a flat/nested list
        /// doesn't reveal which items are actually gating the most downstream work; this drives a
        /// "⛓ blocks N" badge per card (see <see cref="BuildQueueTreeItem"/>) so the real bottlenecks
        /// worth prioritizing stand out at a glance. Pure display — derived entirely from blocked-by
        /// data already tracked on each item; no new data source, no logging.
        /// </summary>
        private Dictionary<int, int> _downstreamBlockCounts = new();
        /// <summary>The largest value in <see cref="_downstreamBlockCounts"/> (0 if none) — the
        /// current worst bottleneck's downstream count, used to give the top offender a louder badge.</summary>
        private int _maxDownstreamBlockCount;

        /// <summary>
        /// Queue critical-path visibility — for each item, counts how many OTHER items in
        /// <paramref name="items"/> transitively depend on it through the blocked-by graph (X
        /// depends on B when B ∈ X.BlockedByNumbers, matching exactly what RenderQueue nests on).
        /// Transitive so a chain A→B→C credits A with 2 downstream, surfacing the real head-of-chain
        /// bottleneck rather than only its immediate child. Keyed by QueueItem.Id (rows can share a
        /// GithubNumber, and un-numbered rows exist and block nothing). Cycle-guarded per start via a
        /// visited-Id set plus an expanded-number set.
        /// </summary>
        private static Dictionary<int, int> ComputeDownstreamBlockCounts(List<QueueItem> items)
        {
            // blockerNumber -> the items that directly list it as one of their blockers
            var directDependents = new Dictionary<int, List<QueueItem>>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                foreach (var b in blockers)
                {
                    if (b == 0 || b == item.GithubNumber) continue; // ignore self / unset references
                    if (!directDependents.TryGetValue(b, out var list)) { list = new List<QueueItem>(); directDependents[b] = list; }
                    list.Add(item);
                }
            }

            var counts = new Dictionary<int, int>();
            foreach (var item in items)
            {
                if (!item.GithubNumber.HasValue) { counts[item.Id] = 0; continue; } // nothing can reference a numberless row

                var seenIds = new HashSet<int> { item.Id };      // never count self; guards cycles at item level
                var expandedNumbers = new HashSet<int>();          // guards cycles at blocker-number level
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
                        if (!seenIds.Add(dep.Id)) continue; // already counted downstream
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
                // Keep the notGit registry in sync with whatever is already in the DB
                // (handles numbers assigned by earlier sessions or other machines).
                BuildConsole.Services.NotGitNumberRegistry.SyncFromQueue(_lastItems);

                // Queued-for-Restart lag fix — fold the pending-update spillover
                // file's current contents into the poll signature. RenderQueue() is
                // what draws the "🔄 Queued for Restart" group (via
                // RenderQueuedForRestartGroup, read fresh off disk), but the #821
                // anti-flicker guard SKIPS RenderQueue whenever the LIVE queue is
                // unchanged — and an intercepted Queue click during a pending update
                // changes ONLY the spillover file, never _lastItems. Without the
                // spillover state in the signature the group wouldn't repaint until
                // some unrelated live-queue change happened to trip the guard, which
                // is exactly the "takes a really long time to update" lag Shane
                // reported (same class as the #40/#41 Focus-Mode signature-guard bug).
                // The file is tiny and only changes on a rare intercept/replay, so
                // reading it every poll is cheap.
                string restartSignature;
                try { restartSignature = System.Text.Json.JsonSerializer.Serialize(MainWindow.GetPersistedQueueDisplayItems()); }
                catch { restartSignature = ""; }

                var signature = _queueIsStale + "|" + System.Text.Json.JsonSerializer.Serialize(_lastItems) + "|" + restartSignature;
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

        /// <summary>Git #814 - Active filter shows only currently queued and running builds (done items automatically fall off). Done/Canceled/All dropdown options show historical items.</summary>
        private List<QueueItem> ApplyFilter(List<QueueItem> items) => _filter switch
        {
            "Active"   => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id) && (i.Status is "queued" or "running")).ToList(),
            "Done"     => items.Where(i => i.Status == "done" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            "Canceled" => items.Where(i => i.Status == "canceled" && !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
            _          => items.Where(i => !_manuallyHiddenQueueIds.Contains(i.Id)).ToList(),
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

        /// <summary>Focus Mode — force every queue sub-list (Queue, In-Flight, To-Do, Completed) to
        /// re-render from its already-fetched cache so the active-milestone hard filter applies the
        /// instant focus is toggled, with NO API or `gh`/GitHub call (Shane's manual-refresh-only
        /// rule). Necessary because each list's anti-flicker signature guard keys off the underlying
        /// DATA, which a focus toggle doesn't change — so the normal refresh paths would skip the
        /// re-render and leave the panel showing off-milestone items. That was the live bug: the
        /// Focus Mode header counted "N hidden" correctly while these lists stayed unfiltered. Wired
        /// into MainWindow's focus filter fan-out. Sessions are intentionally NOT filtered — a
        /// running claude.exe process carries no issue/milestone linkage to filter on; that's logged
        /// honestly rather than faked.</summary>
        public void ReapplyFocusFilter()
        {
            var focus = BuildConsole.Services.FocusModeService.Instance;

            // Completed keeps an internal signature guard; clear it so this forced re-render happens.
            _lastCompletedSignature = null;

            try { if (QueueTree != null && _filter != "Tests") RenderQueue(ApplyFilter(_lastItems)); } catch { }
            try { RenderInFlightGrouped(_lastInFlightIssues); } catch { }
            try { RenderWaitingOnMe(_lastWaitingOnMeIssues); } catch { }
            try { RenderCompletedFromCache(); } catch { }

            // Per-list shown/hidden diagnostics on the focus-mode channel (both transitions), so a
            // regression is instantly diagnosable by comparing these counts against what rendered.
            try
            {
                var qBase = ApplyFilter(_lastItems);
                int ifShown = _lastInFlightIssues.Count(i => focus.IsIssueInFocus(i.Number));
                int tdShown = _lastWaitingOnMeIssues.Count(i => focus.IsIssueInFocus(i.Number));
                var cBase = _lastItems
                    .Where(i => i.Status == "done" && i.GithubNumber.HasValue && _lastOpenIssueNumbers.Contains(i.GithubNumber.Value))
                    .ToList();
                int cShown = cBase.Count(i => focus.IsIssueInFocus(i.GithubNumber));
                ActivityLog.Log("focus-mode", focus.IsActive
                    ? $"Build Queue re-filtered — In-Flight {ifShown}/{_lastInFlightIssues.Count}, To-Do {tdShown}/{_lastWaitingOnMeIssues.Count}, Completed {cShown}/{cBase.Count} shown; Queue ({qBase.Count}) & Sessions left completely unfiltered"
                    : $"Build Queue unfiltered — Queue {qBase.Count}, In-Flight {_lastInFlightIssues.Count}, To-Do {_lastWaitingOnMeIssues.Count}, Completed {cBase.Count} all shown");
            }
            catch { }
        }

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

            // Focus Mode — builds in the queue are NEVER filtered in focus mode (Shane request).
            // All active and queued builds remain fully visible regardless of focus milestone.
            var focus = BuildConsole.Services.FocusModeService.Instance;

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

            // Queue critical-path visibility — compute the transitive downstream block
            // count per item up front (over the exact set being rendered) so each card can
            // show a "⛓ blocks N" badge, making the queue's real bottlenecks obvious at a
            // glance. Reads the same blocked-by relationships the nesting below already uses;
            // pure display (see ComputeDownstreamBlockCounts / BuildQueueTreeItem).
            _downstreamBlockCounts = ComputeDownstreamBlockCounts(items);
            _maxDownstreamBlockCount = _downstreamBlockCounts.Count > 0 ? _downstreamBlockCounts.Values.Max() : 0;

            // Git #799/#813 — a queued item nests under its blocker.
            // Original behavior: only nested when blocker was ALSO in the queue.
            // Extended: when the blocker is not in the active queue (done, or not
            // yet queued) we create a lightweight ghost stub so blocked items still
            // group visually rather than falling to a flat list.  An item with
            // several blockers nests under the first one found (either real or ghost).
            var byGithubNumber = items.Where(i => i.GithubNumber.HasValue)
                                       .GroupBy(i => i.GithubNumber!.Value)
                                       .ToDictionary(g => g.Key, g => g.First());
            // childrenOf: keyed by the blocker's GithubNumber (real or ghost).
            var childrenOf = new Dictionary<int, List<QueueItem>>();
            // ghostBlockers: numbers that appear as blockers but aren't in byGithubNumber.
            var ghostBlockers = new Dictionary<int, List<QueueItem>>();
            var topLevel = new List<QueueItem>();
            foreach (var item in items)
            {
                var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                // First try to nest under a blocker that IS in the queue (real parent).
                var nestUnder = blockers.FirstOrDefault(n => n != item.GithubNumber && byGithubNumber.ContainsKey(n), 0);
                if (nestUnder != 0)
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
                    // No live blocker found — try to ghost-nest under any blocker reference.
                    var ghostNestUnder = blockers.FirstOrDefault(n => n != 0 && n != item.GithubNumber, 0);
                    if (ghostNestUnder != 0)
                    {
                        if (!ghostBlockers.TryGetValue(ghostNestUnder, out var ghostList))
                        {
                            ghostList = new List<QueueItem>();
                            ghostBlockers[ghostNestUnder] = ghostList;
                        }
                        ghostList.Add(item);
                    }
                    else
                    {
                        topLevel.Add(item);
                    }
                }
            }

            // Git #818 — visited-by-id guard prevents duplicate subtree rendering
            // when two rows share a githubNumber, and guards against blocker cycles.
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

            // Render ghost-blocker stubs for blockers not currently in the queue.
            // Each stub is a compact non-selectable header row so Shane can see
            // what the blocked items are waiting on without a full queue card.
            var ghostBlockerBrush = new SolidColorBrush(Color.FromRgb(0x89, 0x8A, 0xB4));
            foreach (var kvp in ghostBlockers.OrderByDescending(k => k.Key))
            {
                int blockerNum = kvp.Key;
                var blockedKids = kvp.Value;

                var stubRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 2, 0, 1) };
                stubRow.Children.Add(new TextBlock
                {
                    Text = "🔒 ",
                    FontSize = 11,
                    Foreground = ghostBlockerBrush,
                    VerticalAlignment = VerticalAlignment.Center
                });
                stubRow.Children.Add(new TextBlock
                {
                    Text = $"Waiting on {FormatIssueRef(blockerNum)}",
                    FontSize = 11,
                    FontStyle = FontStyles.Italic,
                    Foreground = ghostBlockerBrush,
                    VerticalAlignment = VerticalAlignment.Center
                });
                stubRow.Children.Add(new TextBlock
                {
                    Text = $"  ({blockedKids.Count} blocked)",
                    FontSize = 10,
                    Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                    VerticalAlignment = VerticalAlignment.Center
                });

                var ghostTvi = new TreeViewItem
                {
                    Header = stubRow,
                    IsExpanded = true,
                    // NOTE: do NOT set IsHitTestVisible=false here — it would propagate
                    // down the visual tree and make all child BuildQueueTreeItem cards
                    // unclickable and un-right-clickable.  The stub header row has no
                    // click handlers so clicking it just no-ops in SelectedItemChanged.
                    Padding = new Thickness(0),
                    Margin = new Thickness(0, 1, 0, 1)
                };
                // Blocked children still use real cards and are selectable.
                foreach (var kid in SortForDisplay(blockedKids))
                {
                    if (!renderedIds.Add(kid.Id)) continue;
                    var kidTvi = BuildQueueTreeItem(kid);
                    ghostTvi.Items.Add(kidTvi);
                    // If this kid also has its own children (it IS a blocker too), render those.
                    if (kid.GithubNumber.HasValue && childrenOf.TryGetValue(kid.GithubNumber.Value, out var grandkids))
                        foreach (var gk in SortForDisplay(grandkids)) RenderOne(gk, kidTvi);
                }
                QueueTree.Items.Add(ghostTvi);
            }

            // Git #950 — biggest GithubNumber first (see SortForDisplay).
            foreach (var item in SortForDisplay(topLevel)) RenderOne(item, QueueTree);

            UpdateCritterLoungeVisibility();
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

            // Queued-for-Restart lag fix — write a real UI-refresh timestamp to the
            // durable pending-update-queue.log whenever the rendered set actually
            // changes (an item added, replayed away, or the group emptied). Paired
            // with the file-write timestamps PersistQueueRequestDuringPendingUpdate
            // already writes to the SAME durable file, this makes the write→display
            // lag computable straight from the log with no live repro — the whole
            // point of the fix (ActivityLog is in-memory only and useless across the
            // restart this feature spans). Guarded by a signature so a normal 15s
            // poll that re-renders the queue for an unrelated reason doesn't spam it.
            var restartRenderSignature = System.Text.Json.JsonSerializer.Serialize(
                pending.Select(p => new { p.Title, p.GithubNumber }));
            if (restartRenderSignature != _lastRestartGroupSignature)
            {
                _lastRestartGroupSignature = restartRenderSignature;
                MainWindow.LogQueuedForRestartRender(pending.Count);
            }

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

        /// <summary>Trim a queue title to a single short segment for the per-item focus-filter log line
        /// (the full title can be a whole prompt's first 80 chars), so the diagnostic feed stays legible.</summary>
        private static string TrimForLog(string? title)
        {
            var t = (title ?? "").Trim();
            return t.Length > 48 ? t.Substring(0, 46) + "…" : t;
        }

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

            UpdateCritterLoungeVisibility();
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
            var interactiveState = _watcher?.GetInteractiveState(item.Id);
            bool isWaitingForInput = interactiveState == InteractiveInputState.WaitingForInput;

            // Card box styling:
            // - If asking a question / waiting for input: Yellow/Amber box & warm background!
            // - If running: subtle blue-tinted border
            // - If done: subtle green-tinted border
            // - If failed: subtle red-tinted border
            Color cardBorderColor = isWaitingForInput ? Color.FromRgb(0xF9, 0xE2, 0xAF) :
                (item.Status == "running" ? Color.FromRgb(0x45, 0x5A, 0x82) :
                (item.Status == "done" ? Color.FromRgb(0x2E, 0x52, 0x3E) :
                (item.Status == "failed" ? Color.FromRgb(0x5A, 0x2A, 0x34) :
                Color.FromRgb(0x31, 0x32, 0x44))));

            Color cardBgColor = isWaitingForInput ? Color.FromRgb(0x23, 0x1E, 0x18) :
                (item.Status == "running" ? Color.FromRgb(0x15, 0x19, 0x26) :
                (item.Status == "done" ? Color.FromRgb(0x14, 0x20, 0x1A) :
                Color.FromRgb(0x18, 0x18, 0x25)));

            var card = new Border
            {
                Background = new SolidColorBrush(cardBgColor),
                BorderBrush = new SolidColorBrush(cardBorderColor),
                BorderThickness = new Thickness(isWaitingForInput ? 1.5 : 1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 1, 0, 2),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };

            var mainStack = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center
            };

            // ── Top Row: Status Badge + Issue # Badge ──
            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };

            // Determine status pill appearance
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
                var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
                bool isBlocked = blockerList.Count > 0;

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
                    Text = isBlocked ? "🔒 BLOCKED" : "⏳ QUEUED",
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

            // Queue critical-path visibility — "⛓ blocks N" badge whenever this build gates
            // downstream work (transitive count from _downstreamBlockCounts, computed once per
            // RenderQueue). The queue's single worst bottleneck gets a louder (filled peach/red,
            // bold) badge so the highest-leverage item to prioritize jumps out; lesser blockers
            // get the quiet neutral outline. Items that block nothing get no badge at all, so the
            // badge itself is the "this is on the critical path" signal.
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
                        ? $"Critical path — {blockCount} downstream build(s) are waiting on this, directly or via a chain. Prioritizing it unblocks the most work in the queue."
                        : $"Blocks {blockCount} downstream build(s) in the queue, directly or via a chain."
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
            var blockers = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            if (blockers.Count > 0 && item.Status == "queued")
            {
                mainStack.Children.Add(new TextBlock
                {
                    Text = $"waiting on {string.Join(", ", blockers.Select(FormatIssueRef))}",
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
            var cardGrid = new Grid
            {
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            // Right-spanning large animated critter mascot
            var mascot = CreateQueueCardMascot(item, interactiveState);
            if (mascot != null)
            {
                Grid.SetColumn(mascot, 1);
                cardGrid.Children.Add(mascot);
            }

            card.Child = cardGrid;

            var tvi = new TreeViewItem
            {
                Header = card,
                IsExpanded = false,
                Tag = item,
                Padding = new Thickness(0),
                Margin = new Thickness(0),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch
            };

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

            // 💬 Open Chat — opens/focuses the Claude chat that created this build request
            var miOpenChat = new MenuItem { Header = "💬 Open Chat" };
            miOpenChat.Click += (_, _) =>
            {
                QueueItemChatRequested?.Invoke(this, item);
            };
            cm.Items.Add(miOpenChat);

            // ✓ Mark Complete (Hide) — available for any build (running, done, queued, failed, canceled) so Shane can mark it complete and hide it
            var miMarkComplete = new MenuItem { Header = "✓ Mark Complete (Hide)" };
            miMarkComplete.Click += async (_, _) =>
            {
                _manuallyHiddenQueueIds.Add(item.Id);
                if (_api != null)
                {
                    try { await _api.MarkQueueItemCompleteAsync(item.Id, 0); }
                    catch { }
                }
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
                        ToastEngine.Warning("Stop",
                            "Marked stopped in the queue, but couldn't confirm the real process was killed — it may have been launched by a different watcher (the standalone script, or another machine) that this app can't reach directly.");
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
                        ToastEngine.Warning("Run Now", "No local watcher available in this app instance (claude.exe not found, or config not set) — can't launch directly.");
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
                        ToastEngine.Error("Run Now", $"Couldn't run now: {ex.Message}");
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
                        ToastEngine.Error("Retry", $"Couldn't retry: {body}");
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
                            ToastEngine.Error("Reply", $"Couldn't send reply: {body}");
                        }
                        await RefreshAsync();
                    };
                    cm.Items.Add(miReply);
                }
            }
            if (cm.Items.Count > 0) tvi.ContextMenu = cm;

            return tvi;
        }

        private enum CritterMood
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
                // Sweet peaceful closed sleepy eyes (˘ ˘)
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,15 Q11.2,18 13.5,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,15 Q24.8,18 27,15"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                // Happy curved eyes (^ ^)
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9,16 Q11.2,13 13.5,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22.5,16 Q24.8,13 27,16"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                // Big bright sparkling eyes
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
                // Sleepy curved eyes
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M10,14.5 Q12.5,17.5 15,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M21,14.5 Q23.5,17.5 26,14.5"), Stroke = HexBrush("#312E81"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Running || mood == CritterMood.WaitingForInput)
            {
                // Open alert bear eyes
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
                // Peaceful calm curved eyes
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
                // Sweet snoozing cat closed eyes (˘ ˘)
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,14 Q11.5,17 13.5,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,14 Q24,17 26,14"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else if (mood == CritterMood.Done)
            {
                // Happy cat curved eyes (^ ^)
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M9.5,15.5 Q11.5,12.5 13.5,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
                canvas.Children.Add(new System.Windows.Shapes.Path { Data = Geometry.Parse("M22,15.5 Q24,12.5 26,15.5"), Stroke = HexBrush("#1E1E2E"), StrokeThickness = 1.4 });
            }
            else
            {
                // Big round sparkling cat eyes
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
                // Sleepy closed duck eyes (˘ ˘)
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
                // Sleepy closed curved eye
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

            // Detect blocked state
            var blockerList = item.BlockedByNumbers ?? (item.BlockedByNumber.HasValue ? new List<int> { item.BlockedByNumber.Value } : new List<int>());
            bool isBlocked = blockerList.Count > 0 || string.Equals(item.Status, "blocked", StringComparison.OrdinalIgnoreCase);

            CritterMood mood = isBlocked ? CritterMood.Blocked :
                (interactiveState == InteractiveInputState.WaitingForInput) ? CritterMood.WaitingForInput :
                (item.Status == "running") ? CritterMood.Running :
                (item.Status == "done") ? CritterMood.Done :
                (item.Status == "failed") ? CritterMood.Failed :
                CritterMood.Normal;

            // Subtle gentle ambient float transform (NO bouncing or shaking!)
            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;

            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            floatTrans.BeginAnimation(TranslateTransform.YProperty, floatAnim);

            // Select cute vector critter based on issue id/number (matching Home tab mascots)
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

            // Subtle glowing halo with gentle breathing shimmer
            Color glowColor = mood switch
            {
                CritterMood.Blocked => Color.FromRgb(0xF3, 0x8B, 0xA8), // Soft Rose Red for blocked
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

            // Gentle shimmer pulse on the glow (calm and peaceful)
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

            // Status badges (clean, smart, and subtle)
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

        /// <summary>
        /// Manual-only GitHub (Shane, 2026-08-14): the single, explicit trigger
        /// for this panel's three GitHub-backed tiles (In-Flight / To-Do /
        /// Completed) now that their background timers are gone — Shane clicks it
        /// when he knows something changed on GitHub. Mirrors the Git Board's own
        /// #863 header refresh-icon pattern. Each tile logs its real `gh` fetch +
        /// outcome on github.manual-refresh, so the whole click is attributable.
        /// The live Queue/Sessions data below hits the local dev server / local
        /// machine (not GitHub) and keeps its own cadence, unaffected by this.
        /// </summary>
        private async void BtnRefreshGitHubTiles_Click(object sender, RoutedEventArgs e)
        {
            ActivityLog.Log("github.manual-refresh",
                "Build Queue panel [manual Refresh click]: re-fetching ALL GitHub components (Board + Issues in Epic + In-Flight + To-Do + Completed + Focus Progress).");
            
            FullGitRefreshRequested?.Invoke(this, EventArgs.Empty);

            await System.Threading.Tasks.Task.WhenAll(
                RefreshActiveChatEpicIssuesAsync(),
                RefreshInFlightIssuesAsync("manual Refresh click"),
                RefreshWaitingOnMeAsync("manual Refresh click"),
                RefreshCompletedAsync("manual Refresh click"),
                RefreshAsync());

            ToastEngine.Success("Git Sync", "Refreshed Git Board, epic issues, focus progress, and queue tiles!");
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
        private void TileTestWatch_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileTestWatch.IsChecked == true;
            TileTestWatchContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileInFlight.IsChecked = false;
                TileInFlightContent.Visibility = Visibility.Collapsed;
                TileSessions.IsChecked = false;
                TileSessionsContent.Visibility = Visibility.Collapsed;
                TileToDo.IsChecked = false;
                TileToDoContent.Visibility = Visibility.Collapsed;
                TileCompleted.IsChecked = false;
                TileCompletedContent.Visibility = Visibility.Collapsed;
                TileAttention.IsChecked = false;
                TileAttentionContent.Visibility = Visibility.Collapsed;
                RefreshTestWatch();
            }
            UpdateCritterLoungeVisibility();
        }

        public void RefreshTestWatch()
        {
            var svc = Services.TestQueueService.Instance;
            var snapshot = svc.GetSnapshot();
            bool isBusy = svc.IsBusy;
            string status = svc.CurrentStatus;

            int count = snapshot.Count + (isBusy ? 1 : 0);
            TestWatchCountText.Text = $"({count})";

            if (isBusy)
            {
                TestWatchIcon.Text = "🧪";
                TestWatchLabel.Foreground = (Brush)FindResource("BlueBrush");
                TestWatchPulse.Visibility = Visibility.Visible;
                TestWatchActiveBadge.Text = status.StartsWith("Deploying", StringComparison.OrdinalIgnoreCase) ? "DEPLOYING" : "RUNNING";
                TestWatchActiveBadge.Foreground = (Brush)FindResource("BlueBrush");
                TestWatchActiveText.Text = status;
            }
            else
            {
                TestWatchIcon.Text = "🧪";
                TestWatchLabel.Foreground = (Brush)FindResource("Subtext0Brush");
                TestWatchPulse.Visibility = Visibility.Collapsed;
                TestWatchActiveBadge.Text = "IDLE";
                TestWatchActiveBadge.Foreground = (Brush)FindResource("Subtext0Brush");
                TestWatchActiveText.Text = "Idle — no active tests or deploys";
            }

            TestWatchQueueList.Items.Clear();
            if (snapshot.Count > 0)
            {
                TestWatchEmptyText.Visibility = Visibility.Collapsed;
                int pos = 1;
                foreach (var item in snapshot)
                {
                    var border = new Border
                    {
                        Background = (Brush)FindResource("BaseBrush"),
                        BorderBrush = (Brush)FindResource("Surface0Brush"),
                        BorderThickness = new Thickness(1),
                        CornerRadius = new CornerRadius(4),
                        Padding = new Thickness(8, 6, 8, 6),
                        Margin = new Thickness(0, 0, 0, 4)
                    };

                    var sp = new StackPanel();
                    var topRow = new DockPanel();

                    var posBlock = new TextBlock
                    {
                        Text = $"#{pos} • {item.Status}",
                        FontSize = 10,
                        FontWeight = FontWeights.Bold,
                        Foreground = (Brush)FindResource("PeachBrush"),
                        VerticalAlignment = VerticalAlignment.Center
                    };
                    DockPanel.SetDock(posBlock, Dock.Left);
                    topRow.Children.Add(posBlock);

                    var timeBlock = new TextBlock
                    {
                        Text = item.EnqueuedAt.ToString("HH:mm:ss"),
                        FontSize = 9,
                        Foreground = (Brush)FindResource("Subtext0Brush"),
                        HorizontalAlignment = HorizontalAlignment.Right,
                        VerticalAlignment = VerticalAlignment.Center
                    };
                    topRow.Children.Add(timeBlock);
                    sp.Children.Add(topRow);

                    var nameBlock = new TextBlock
                    {
                        Text = item.ManifestFile,
                        FontSize = 11,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = (Brush)FindResource("TextBrush"),
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 2, 0, 2)
                    };
                    sp.Children.Add(nameBlock);

                    if (!string.IsNullOrEmpty(item.Source))
                    {
                        var srcBlock = new TextBlock
                        {
                            Text = $"Source: {item.Source}",
                            FontSize = 9,
                            Foreground = (Brush)FindResource("Subtext0Brush")
                        };
                        sp.Children.Add(srcBlock);
                    }

                    border.Child = sp;
                    TestWatchQueueList.Items.Add(border);
                    pos++;
                }
            }
            else
            {
                TestWatchEmptyText.Visibility = isBusy ? Visibility.Collapsed : Visibility.Visible;
            }
        }

        private void TileInFlight_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileInFlight.IsChecked == true;
            TileInFlightContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileTestWatch.IsChecked = false;
                TileTestWatchContent.Visibility = Visibility.Collapsed;
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
                TileTestWatch.IsChecked = false;
                TileTestWatchContent.Visibility = Visibility.Collapsed;
                TileInFlight.IsChecked = false;
                TileInFlightContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(ActiveSessionsList, _sessionsTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        private void TileToDo_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileToDo.IsChecked == true;
            TileToDoContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileTestWatch.IsChecked = false;
                TileTestWatchContent.Visibility = Visibility.Collapsed;
                TileCompleted.IsChecked = false;
                TileCompletedContent.Visibility = Visibility.Collapsed;
                TileAttention.IsChecked = false;
                TileAttentionContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(WaitingOnMeList, _toDoTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        private void TileCompleted_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileCompleted.IsChecked == true;
            TileCompletedContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileTestWatch.IsChecked = false;
                TileTestWatchContent.Visibility = Visibility.Collapsed;
                TileToDo.IsChecked = false;
                TileToDoContent.Visibility = Visibility.Collapsed;
                TileAttention.IsChecked = false;
                TileAttentionContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(CompletedIssuesList, _completedTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        // ── Needs Attention section (durable #54-toast fallback) ─────────────────

        private void TileAttention_Click(object sender, RoutedEventArgs e)
        {
            bool expand = TileAttention.IsChecked == true;
            TileAttentionContent.Visibility = expand ? Visibility.Visible : Visibility.Collapsed;
            if (expand)
            {
                TileTestWatch.IsChecked = false;
                TileTestWatchContent.Visibility = Visibility.Collapsed;
                TileToDo.IsChecked = false;
                TileToDoContent.Visibility = Visibility.Collapsed;
                TileCompleted.IsChecked = false;
                TileCompletedContent.Visibility = Visibility.Collapsed;
                ApplyTitleMaxWidths(AttentionList, _attentionTitleBlocks);
            }
            UpdateCritterLoungeVisibility();
        }

        /// <summary>
        /// Automatically hides the bottom Critter Lounge animation when the Build Queue is full
        /// (>= 3 items rendered, or any of the collapsible accordion sections are open) so it
        /// never crowds the queue or causes unnecessary vertical scroll crunch.
        /// </summary>
        public void UpdateCritterLoungeVisibility()
        {
            if (CritterLounge == null) return;

            int queueItemCount = QueueTree != null ? QueueTree.Items.Count : 0;
            bool anyAccordionOpen = (TileTestWatch?.IsChecked == true) ||
                                    (TileInFlight?.IsChecked == true) ||
                                    (TileSessions?.IsChecked == true) ||
                                    (TileToDo?.IsChecked == true) ||
                                    (TileCompleted?.IsChecked == true) ||
                                    (TileAttention?.IsChecked == true);

            bool isFull = queueItemCount >= 3 || anyAccordionOpen;
            CritterLounge.Visibility = isFull ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>
        /// Records a needs-attention test result so it survives the #54 toast's auto-dismiss. Called from
        /// MainWindow.ApplyRunOutcomeToRunnerWindow at the same moment it fires the toast. Dispatcher-safe
        /// (RunManifestAsync can complete off the UI thread). Keyed: re-running the same manifest updates its
        /// existing row (most-recent first) rather than stacking duplicates. <paramref name="onOpen"/> is the
        /// real address action (restore the Test Runner + pop the #975 review dialog); the row invokes it and
        /// then clears itself when Shane clicks it — the same thing the toast's own click does.
        /// </summary>
        public void AddNeedsAttention(string key, string title, string body, bool isFailure, Action? onOpen, string? details = null)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => AddNeedsAttention(key, title, body, isFailure, onOpen, details)));
                return;
            }

            var existing = _attentionItems.FirstOrDefault(i => i.Key == key);
            if (existing != null) _attentionItems.Remove(existing);
            _attentionItems.Insert(0, new NeedsAttentionItem
            {
                Key = key,
                Title = title,
                Body = body,
                Details = string.IsNullOrWhiteSpace(details) ? body : details,
                IsFailure = isFailure,
                AtLocal = DateTime.Now,
                OnOpen = onOpen,
            });

            ActivityLog.Log(AttentionChannel,
                $"Recorded needs-attention result [{key}] ({(isFailure ? "failure" : "screenshot-review")}) — '{title}'. {_attentionItems.Count} item(s) now pending Shane's review{(existing != null ? " (updated existing row)" : "")}.");

            RenderAttentionList();
        }

        /// <summary>Clears a recorded needs-attention item once it's been addressed (Shane opened it — from
        /// the toast click or the row here). Dispatcher-safe. A no-op if the key isn't present. Public so the
        /// #54 toast's own onClick can clear the matching row after restoring the window.</summary>
        public void ClearNeedsAttention(string key)
        {
            if (!Dispatcher.CheckAccess())
            {
                Dispatcher.BeginInvoke(new Action(() => ClearNeedsAttention(key)));
                return;
            }

            var existing = _attentionItems.FirstOrDefault(i => i.Key == key);
            if (existing == null) return;
            _attentionItems.Remove(existing);
            ActivityLog.Log(AttentionChannel,
                $"Cleared needs-attention result [{key}] ('{existing.Title}') — addressed. {_attentionItems.Count} item(s) still pending.");
            RenderAttentionList();
        }

        /// <summary>A row click pops the full diagnostic review window so Shane can see the exact failure details,
        /// logs, and action buttons without prematurely clearing the item from the list.</summary>
        private void AttentionList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (AttentionList.SelectedItem is not ListBoxItem { Tag: NeedsAttentionItem item }) return;
            AttentionList.SelectedIndex = -1; // reset so the same/next row can be re-selected later

            var parentWin = Window.GetWindow(this);
            var dlg = new NeedsAttentionDetailDialog(item.Title, item.Body, item.Details, item.IsFailure, item.AtLocal, item.OnOpen);
            if (parentWin != null) dlg.Owner = parentWin;
            dlg.ShowDialog();

            if (dlg.DismissRequested)
            {
                ClearNeedsAttention(item.Key);
            }
        }

        /// <summary>Rebuilds the Needs Attention list + tile badge/accent from <see cref="_attentionItems"/>.</summary>
        private void RenderAttentionList()
        {
            UpdateAttentionTileAppearance(_attentionItems.Count);

            _attentionTitleBlocks.Clear();
            AttentionList.Items.Clear();

            if (_attentionItems.Count == 0)
            {
                AttentionList.Items.Add(new ListBoxItem { Content = "Nothing needs your attention.", Foreground = (Brush)Application.Current.FindResource("Subtext1Brush") });
                // Nothing to address — collapse the section so it doesn't sit open-and-empty.
                if (TileAttention.IsChecked == true)
                {
                    TileAttention.IsChecked = false;
                    TileAttentionContent.Visibility = Visibility.Collapsed;
                }
                return;
            }

            foreach (var item in _attentionItems)
                AttentionList.Items.Add(BuildAttentionRow(item));
            ApplyTitleMaxWidths(AttentionList, _attentionTitleBlocks);
        }

        /// <summary>One Needs Attention row — a failure (🔴) or screenshot-review (📷) glyph, the run title,
        /// body + local time, and a quick dismiss button. Clicking opens full diagnostics dialog.</summary>
        private ListBoxItem BuildAttentionRow(NeedsAttentionItem item)
        {
            var dock = new DockPanel { LastChildFill = true, Margin = new Thickness(0, 2, 0, 2) };

            var dismissBtn = new Button
            {
                Content = "✕",
                FontSize = 10,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(6, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = "Dismiss from Needs Attention"
            };
            DockPanel.SetDock(dismissBtn, Dock.Right);
            dismissBtn.Click += (s, e) =>
            {
                e.Handled = true;
                ClearNeedsAttention(item.Key);
            };
            dock.Children.Add(dismissBtn);

            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock
            {
                Text = (item.IsFailure ? "🔴" : "📷") + " ",
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
            });
            var textStack = new StackPanel();
            var titleBlock = new TextBlock
            {
                Text = item.Title,
                FontSize = 12,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            _attentionTitleBlocks.Add(titleBlock);
            textStack.Children.Add(titleBlock);
            textStack.Children.Add(new TextBlock
            {
                Text = $"{item.Body}  ·  {item.AtLocal:MMM d, h:mm tt}",
                FontSize = 10,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
            });
            panel.Children.Add(textStack);

            dock.Children.Add(panel);
            return new ListBoxItem { Content = dock, Tag = item, ToolTip = "Click to inspect failure diagnostics, logs, and options." };
        }

        /// <summary>Same "announce itself" pattern as UpdateToDoTileAppearance — a pending needs-attention
        /// result is an action item, so the tile swaps to PeachBrush once count > 0, neutral at 0.</summary>
        private void UpdateAttentionTileAppearance(int count)
        {
            AttentionCountText.Text = $"({count})";
            if (count > 0)
            {
                var peach = (Brush)Application.Current.FindResource("PeachBrush");
                TileAttention.BorderBrush = peach;
                TileAttention.Foreground = peach;
                AttentionIcon.Foreground = peach;
                AttentionLabel.Foreground = peach;
                AttentionCountText.Foreground = peach;
            }
            else
            {
                TileAttention.ClearValue(BorderBrushProperty);
                TileAttention.ClearValue(ForegroundProperty);
                AttentionIcon.ClearValue(ForegroundProperty);
                AttentionLabel.ClearValue(ForegroundProperty);
                AttentionCountText.ClearValue(TextBlock.ForegroundProperty);
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
