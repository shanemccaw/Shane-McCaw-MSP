using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>Git #2548 §7 — a cross-epic question's return trip. <see cref="FromConversationId"/>
    /// is the required return address: the answer must land back in the tab that asked, never
    /// wherever happens to be active.</summary>
    public enum CrossEpicState { Asked, AnswerReady }

    public sealed class CrossEpicQuestion
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public int ToEpic { get; init; }
        public string ToEpicName { get; init; } = "";
        public string ToConversationId { get; init; } = "";
        public int FromEpic { get; init; }
        public string FromEpicName { get; init; } = "";
        public string FromConversationId { get; init; } = "";   // return address — required
        public string Question { get; init; } = "";
        public CrossEpicState State { get; set; } = CrossEpicState.Asked;
        public string? Answer { get; set; }
    }

    /// <summary>
    /// Git #2548 — the Chat Document Container: the 5-band native WPF chrome that wraps the live
    /// claude.ai WebView2 for one chat tab (README-ClaudeChat.md, ShaneBuilder #2209 port). The
    /// message thread + composer inside the chat are the real site via WebView2; every band drawn
    /// here (context bar, breadcrumb/share, tool rail, app-owned composer, Inspector states) is
    /// native chrome around it. One container per chat tab, so per-tab composer drafts (§8) are
    /// structural — each tab owns its own composer.
    /// </summary>
    public partial class ChatDocumentContainer : UserControl
    {
        // README §2 budget + estimate constants (kept as an honest two-part shape until a real
        // tokeniser is wired: 40k fixed overhead + conversation estimate).
        private const double ContextBudget = 300_000;
        private const double FixedOverhead = 40_000;
        private const double CharsPerTokenFactor = 0.28;

        private readonly BoardChat _chat;
        private readonly MainWindow _owner;
        private readonly Microsoft.Web.WebView2.Wpf.WebView2? _chatWebView;
        private readonly DateTime _sessionStart = DateTime.Now;
        private readonly DispatcherTimer _activeTimer;

        // README §11 state model. ChatToolOpen / DomReaderOpen are mutually exclusive — the rail
        // holds exactly one thing.
        private string? _chatToolOpen;          // one of the wrench tool ids, or null
        private bool _detectedOpen;             // the ⌸ panel (DomReaderOpen)
        private readonly HashSet<string> _dismissed = new();
        private readonly List<CrossEpicQuestion> _questions = new();
        private ChatDockPanel? _dockPanel;
        private bool _detectedLoadedOnce;
        private bool _hasUndismissed;
        /// <summary>Git #2769 — the real Terminal tool's persistent instance for THIS chat tab.
        /// Created lazily on first "terminal" OpenTool and reused after — one container per chat
        /// tab means this field is the whole cache; closing/reopening the rail must not touch it,
        /// so a live shell session (a running `npm install`, a long `git` op) survives rail
        /// open/close instead of restarting on every reopen.</summary>
        private TerminalView? _terminalView;
        /// <summary>Git #2682 — the last fetched dock snapshot, kept so a Dismiss click can
        /// re-render instantly against the same data (filtered by <see cref="_dismissed"/>)
        /// instead of forcing a fresh GitHub round-trip.</summary>
        private ChatDockData? _lastDockData;

        // README §5 — tool identity table (id, label, Segoe MDL2 glyph, colour). Internals are each a
        // sibling Feature under #1202; here they open an honest stub panel body.
        private static readonly (string Id, string Label, string Glyph, string Colour)[] Tools =
        {
            ("logs",       "Log Peek",             "", "#7fb08a"),
            ("api-local",  "API Runner",           "", "#c084fc"),
            ("api-read",   "Graph Read",           "", "#00b4d8"),
            ("api-write",  "Graph Write",          "", "#e2593f"),
            ("gitdoctor",  "Git Doctor",           "", "#e2593f"),
            ("gitmap",     "Git Map",              "", "#6a8fb5"),
            ("health",     "Repo Health",          "", "#e0a879"),
            ("sql",        "SQL Runner",           "", "#38bdf8"),
            ("ps",         "PowerShell",           "", "#4f8ff0"),
            ("terminal",   "Terminal",             "", "#6ee7b7"),
            ("json",       "JSON Viewer",          "", "#c084fc"),
            ("files",      "Windows File Browser", "", "#7dc4f5"),
        };

        public ChatDocumentContainer(BoardChat chat, MainWindow owner,
                                     Microsoft.Web.WebView2.Wpf.WebView2? chatWebView)
        {
            InitializeComponent();
            _chat = chat;
            _owner = owner;
            _chatWebView = chatWebView;

            BuildWrenchMenu();

            CrumbChat.Text = string.IsNullOrWhiteSpace(_chat.Title) ? "New Chat" : _chat.Title;

            _activeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            _activeTimer.Tick += (_, _) => UpdateActiveTime();
            Loaded += (_, _) => _activeTimer.Start();
            Unloaded += (_, _) => _activeTimer.Stop();

            RefreshContext();
        }

        /// <summary>The stable per-tab key (the chat's conversation id) — the §8 draft key.</summary>
        public string TabId => _chat.ConversationId ?? "";
        public BoardChat Chat => _chat;
        public int? EpicNumber { get; private set; }

        /// <summary>OpenChatTab injects the real claude.ai WebView2 split grid into the transcript
        /// slot. The centre body is the live site; the bands are chrome around it.</summary>
        public void SetBody(FrameworkElement body)
        {
            ChatBodyHost.Children.Clear();
            ChatBodyHost.Children.Add(body);
        }

        /// <summary>The live claude.ai WebView2 currently hosted in the body (survives reopen-swaps),
        /// falling back to the one handed in at construction.</summary>
        private Microsoft.Web.WebView2.Wpf.WebView2? ResolveWebView()
            => FindWebView2(ChatBodyHost) ?? _chatWebView;

        private static Microsoft.Web.WebView2.Wpf.WebView2? FindWebView2(DependencyObject parent)
        {
            if (parent is Microsoft.Web.WebView2.Wpf.WebView2 wv) return wv;
            int n = VisualTreeHelper.GetChildrenCount(parent);
            for (int i = 0; i < n; i++)
            {
                var found = FindWebView2(VisualTreeHelper.GetChild(parent, i));
                if (found != null) return found;
            }
            return null;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Band 1 — Context bar
        // ─────────────────────────────────────────────────────────────────────────

        /// <summary>Recomputes the epic label, the epic-scoped status counts, and the context gauge
        /// from real live data (LeftSidebar board issues + BuildQueuePanel live queue + the context
        /// meter store). Safe to call repeatedly (e.g. on tab select / queue refresh).</summary>
        public void RefreshContext()
        {
            try
            {
                var epic = _owner.LeftSidebar?.GetEpicForChat(_chat);
                EpicNumber = epic?.GithubNumber;
                CtxEpicNum.Text = EpicNumber.HasValue ? $"#{EpicNumber.Value}" : "#—";

                if (epic?.GithubNumber != null && !string.IsNullOrWhiteSpace(epic.Title))
                {
                    CrumbEpic.Text = $"#{epic.GithubNumber.Value} — {epic.Title}";
                    CrumbEpic.Visibility = Visibility.Visible;
                    CrumbEpicSep.Visibility = Visibility.Visible;
                }
                else
                {
                    // No real epic resolved for this chat — honest empty state, don't fabricate one.
                    CrumbEpic.Text = "";
                    CrumbEpic.Visibility = Visibility.Collapsed;
                    CrumbEpicSep.Visibility = Visibility.Collapsed;
                }

                ComputeAndRenderCounts(epic);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.container", $"RefreshContext failed for {_chat.ConversationId}: {ex.Message}");
            }
            UpdateActiveTime();
            UpdateGauge();
        }

        private void ComputeAndRenderCounts(BoardEpic? epic)
        {
            int verifying = 0, inflight = 0, queued = 0, blocked = 0, complete = 0, total = 0;

            int? epicNum = epic?.GithubNumber;
            if (epicNum.HasValue)
            {
                // Direct children of this epic, from the live OPEN-only board fetch.
                var board = _owner.LeftSidebar?.CurrentBoardIssues;
                var childNumbers = new HashSet<int>();
                if (board != null)
                {
                    foreach (var i in board)
                        if (i.ParentNumber == epicNum.Value) childNumbers.Add(i.Number);

                    // Blocked is the GitHub board's own label signal on the open children.
                    // verifying/in-flight/queued come from the live build queue below (the precise
                    // "actively building" source) so the two don't double-count the same issue.
                    foreach (var i in board.Where(b => childNumbers.Contains(b.Number)))
                        if (i.IsBlocked) blocked++;
                }

                // Real build-queue statuses, scoped to this epic's children.
                var queue = _owner.BuildQueuePanel?.CurrentQueueItems;
                if (queue != null)
                {
                    foreach (var q in queue)
                    {
                        bool inEpic =
                            (q.GithubNumber.HasValue && childNumbers.Contains(q.GithubNumber.Value)) ||
                            q.AssociatedIssueNumbers.Any(childNumbers.Contains) ||
                            (q.GithubNumber == epicNum.Value);
                        if (!inEpic) continue;
                        switch (q.Status)
                        {
                            case BuildQueuePostgresClient.VerifyingStatus: verifying++; break;
                            case "running": inflight++; break;
                            case "queued": queued++; break;
                        }
                    }
                }

                // GitHub's own real sub-issue completion rollup on the epic node.
                var epicNode = board?.FirstOrDefault(b => b.Number == epicNum.Value);
                if (epicNode != null && epicNode.SubIssueCount > 0)
                {
                    complete = epicNode.SubIssueCompleted;
                    total = epicNode.SubIssueCount;
                }
                else if (childNumbers.Count > 0)
                {
                    total = childNumbers.Count;
                }
            }

            CtxStatVerifying.Text = $"{verifying} verifying";
            CtxStatInFlight.Text = $"{inflight} in-flight";
            CtxStatQueued.Text = $"{queued} queued";
            CtxStatBlocked.Text = $"{blocked} blocked";
            CtxStatComplete.Text = total > 0 ? $"{complete}/{total} complete" : $"{complete} complete";
        }

        private void UpdateActiveTime()
        {
            var span = DateTime.Now - _sessionStart;
            CtxActive.Text = $"Active: {(int)span.TotalDays}d {span.Hours}h {span.Minutes}m";

            var meter = ChatContextMeterStore.Get(_chat.ConversationId);
            CtxMessages.Text = meter != null ? $"Messages: {meter.TurnCount}" : "Messages: —";
        }

        /// <summary>README §2 context maths. used = 40k overhead + conversation estimate + draft; the
        /// conversation estimate uses the real meter store when it has one, else the 0.28/char shape.
        /// The gauge fill + "≈Xk / 300k" text stay on this overhead-inclusive scale (Shane confirmed
        /// this half is correct as-is — Git #2727).
        ///
        /// Git #2727 — colour + Start-New-Chat now use the RAW conversation token count against the
        /// retired `meterState` banner's own real absolute-token tiers (60k/85k/100k/130k), ported
        /// here rather than dropped, per #2727's "don't silently lose real functionality" call. This
        /// is now the ONE real chat-context indicator — the old separate banner in MainWindow is
        /// retired.</summary>
        private void UpdateGauge()
        {
            double conversationTokens;
            var meter = ChatContextMeterStore.Get(_chat.ConversationId);
            if (meter != null && meter.EstTokens > 0)
                conversationTokens = meter.EstTokens;
            else
                conversationTokens = 0;

            double draftTokens = (ChatComposer?.Text?.Length ?? 0) * CharsPerTokenFactor;
            double used = FixedOverhead + conversationTokens + draftTokens;
            double pct = Math.Min(1.0, used / ContextBudget);

            CtxGauge.Text = $"{FormatK(used)} / 300k ctx";

            // Ported tiers (were meterState's 60k/85k/100k/130k, MainWindow.xaml.cs — Git #2727).
            // Hex values match the app's own GreenBrush/YellowBrush/PeachBrush/RedBrush
            // (Themes/DarkTheme.xaml) so this reads as the same real palette, not a new one.
            Color c;
            string tierLabel;
            if (conversationTokens >= 100_000) { c = (Color)ColorConverter.ConvertFromString("#F38BA8"); tierLabel = "Critical"; }
            else if (conversationTokens >= 85_000) { c = (Color)ColorConverter.ConvertFromString("#FAB387"); tierLabel = "Very long"; }
            else if (conversationTokens >= 60_000) { c = (Color)ColorConverter.ConvertFromString("#F9E2AF"); tierLabel = "Getting long"; }
            else { c = (Color)ColorConverter.ConvertFromString("#A6E3A1"); tierLabel = "Normal"; }
            CtxGauge.Foreground = new SolidColorBrush(c);

            // Start New Chat now fires at the same 60k tier the retired banner first offered
            // "Start handoff chat" at (Git #1885), not System B's old flat 75%-of-300k cutoff.
            BtnStartNewChat.Visibility = conversationTokens >= 60_000 ? Visibility.Visible : Visibility.Collapsed;

            double cost = conversationTokens * (3.00 / 1_000_000.0);
            double remainingToCritical = Math.Max(0, 100_000.0 - conversationTokens);
            BtnStartNewChat.ToolTip = conversationTokens > 0
                ? $"{tierLabel} — {conversationTokens:N0} conversation tokens (~${cost:F3} est. cost)\n" +
                  $"Remaining to critical (100k): {remainingToCritical:N0} tokens\n" +
                  "Context is getting full — start a fresh chat on this epic"
                : "Context is getting full — start a fresh chat on this epic";

            if (CtxBarBorder.ActualWidth > 0)
                CtxBarFill.Width = pct * CtxBarBorder.ActualWidth;
        }

        private static string FormatK(double v)
        {
            if (v >= 1000) return $"{v / 1000:0.#}k";
            return $"{v:0}";
        }

        private void CtxBarBorder_SizeChanged(object sender, SizeChangedEventArgs e) => UpdateGauge();

        private void CtxEpic_Click(object sender, MouseButtonEventArgs e)
        {
            if (!EpicNumber.HasValue) return;
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = $"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{EpicNumber.Value}",
                    UseShellExecute = true
                });
            }
            catch (Exception ex) { ActivityLog.Log("chat.container", $"epic click failed: {ex.Message}"); }
        }

        private void BtnStartNewChat_Click(object sender, RoutedEventArgs e)
        {
            if (EpicNumber.HasValue) _owner.OpenOrCreateEpicChat(EpicNumber.Value);
            else ToastEngine.Show("Chat", "This chat has no epic to start a fresh chat on.", ToastKind.Info);
        }

        private void BtnFloaty_Click(object sender, RoutedEventArgs e) => _owner.OpenFloatingChatWindow(_chat);

        private void BtnShare_Click(object sender, RoutedEventArgs e)
        {
            // README §3 / open-question #1 — the real claude.ai conversation URL is the shareable
            // link BuildConsole can expose cleanly; copy it rather than shipping a fake inert pill.
            if (string.IsNullOrWhiteSpace(_chat.ClaudeUrl))
            {
                BtnShare.Visibility = Visibility.Collapsed; // hide, don't fake (README §3)
                return;
            }
            try
            {
                Clipboard.SetText(_chat.ClaudeUrl);
                ToastEngine.Show("Share", "Conversation link copied to clipboard.", ToastKind.Success);
            }
            catch (Exception ex) { ActivityLog.Log("chat.container", $"share copy failed: {ex.Message}"); }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Wrench menu + tool rail (§5, §6). Shell only — internals are sibling Features.
        // ─────────────────────────────────────────────────────────────────────────

        private void BuildWrenchMenu()
        {
            WrenchMenuItems.Children.Clear();
            foreach (var (id, label, glyph, colour) in Tools)
            {
                var row = new Border
                {
                    Padding = new Thickness(8, 7, 8, 7),
                    CornerRadius = new CornerRadius(5),
                    Cursor = Cursors.Hand,
                    Background = Brushes.Transparent
                };
                var dp = new StackPanel { Orientation = Orientation.Horizontal };
                dp.Children.Add(new TextBlock
                {
                    Text = glyph,
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 13,
                    Margin = new Thickness(0, 0, 9, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(colour))
                });
                dp.Children.Add(new TextBlock
                {
                    Text = label,
                    FontSize = 11.5,
                    FontWeight = FontWeights.SemiBold,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#ece9e4"))
                });
                row.Child = dp;
                string toolId = id, toolLabel = label, toolGlyph = glyph, toolColour = colour;
                row.MouseEnter += (_, _) => row.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#2f2f2b"));
                row.MouseLeave += (_, _) => row.Background = Brushes.Transparent;
                row.MouseLeftButtonUp += (_, _) => { WrenchPopup.IsOpen = false; OpenTool(toolId, toolLabel, toolGlyph, toolColour); };
                WrenchMenuItems.Children.Add(row);
            }

            // Cross-epic round trip lives here as a real container capability (§7). The Git Map tool
            // that normally triggers it is a sibling Feature; this keeps the round trip reachable.
            var sep = new Border { Height = 1, Margin = new Thickness(4, 5, 4, 5), Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#35342f")) };
            WrenchMenuItems.Children.Add(sep);
            var ask = new Border { Padding = new Thickness(8, 7, 8, 7), CornerRadius = new CornerRadius(5), Cursor = Cursors.Hand, Background = Brushes.Transparent };
            var askDp = new StackPanel { Orientation = Orientation.Horizontal };
            askDp.Children.Add(new TextBlock { Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 13, Margin = new Thickness(0, 0, 9, 0), VerticalAlignment = VerticalAlignment.Center, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#d97757")) });
            askDp.Children.Add(new TextBlock { Text = "Ask another epic's chat…", FontSize = 11.5, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#ece9e4")) });
            ask.Child = askDp;
            ask.MouseEnter += (_, _) => ask.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#2f2f2b"));
            ask.MouseLeave += (_, _) => ask.Background = Brushes.Transparent;
            ask.MouseLeftButtonUp += (_, _) => { WrenchPopup.IsOpen = false; StartCrossEpicQuestion(); };
            WrenchMenuItems.Children.Add(ask);
        }

        private void BtnWrench_Click(object sender, RoutedEventArgs e) => WrenchPopup.IsOpen = !WrenchPopup.IsOpen;

        private void OpenTool(string id, string label, string glyph, string colour)
        {
            _detectedOpen = false;
            _chatToolOpen = id;
            RailGlyph.Text = glyph;
            RailGlyph.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(colour));
            RailTitle.Text = label;
            RailRefresh.Visibility = Visibility.Collapsed;
            RailMaximize.Visibility = Visibility.Visible;
            DetectedScroller.Visibility = Visibility.Collapsed;

            // Git #2769 — Terminal is the first real tool internal; every other id still gets the
            // honest ToolStubBody. _terminalView is created once per chat tab and reused on every
            // later open, so the shell (cwd, running command, output history) persists across
            // rail close/reopen instead of a fresh terminal each time.
            if (id == "terminal")
            {
                ToolStubBody.Visibility = Visibility.Collapsed;
                _terminalView ??= new TerminalView();
                ToolHost.Content = _terminalView;
                ToolHost.Visibility = Visibility.Visible;
            }
            else
            {
                ToolHost.Visibility = Visibility.Collapsed;
                ToolStubBody.Visibility = Visibility.Visible;
                ToolStubTitle.Text = label;
            }

            SetRailOpen(true);
            UpdateDetectedGlyph();
        }

        /// <summary>Git #2774 — public entry for MainWindow's <c>BT_SEND_TO_TOOL</c> handler (the shell-block
        /// tool-picker dropdown): open/focus THIS chat tab's tool rail with <paramref name="toolId"/> active
        /// and hand it the block's real text for execution. Reuses the same cached-per-tab tool instance
        /// (#2769's <see cref="_terminalView"/>), so a sent command lands in the tab's live session rather
        /// than a fresh one. Terminal runs a multi-line block as a real queued sequence
        /// (<see cref="TerminalView.RunQueue"/>). Currently the only wired tool is "terminal"; the tuple
        /// lookup means adding a row to <see cref="Tools"/> is all a future tool needs on this side.</summary>
        public void SendToTool(string toolId, string text)
        {
            if (string.IsNullOrWhiteSpace(toolId)) return;
            var tool = Tools.FirstOrDefault(t => t.Id == toolId);
            if (tool.Id == null)
            {
                ToastEngine.Warning("Send to Tool", $"Unknown tool '{toolId}'.");
                return;
            }
            OpenTool(tool.Id, tool.Label, tool.Glyph, tool.Colour);
            if (toolId == "terminal")
                _terminalView?.RunQueue(text);
        }

        private void BtnDetected_Click(object sender, RoutedEventArgs e)
        {
            if (_detectedOpen) { CloseRail(); return; }
            OpenDetected();
        }

        private async void OpenDetected()
        {
            _chatToolOpen = null;
            _detectedOpen = true;
            RailGlyph.Text = "";
            RailGlyph.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#c2c0bc"));
            RailTitle.Text = "Detected in this chat";
            RailMaximize.Visibility = Visibility.Collapsed;
            RailRefresh.Visibility = Visibility.Visible;
            ToolStubBody.Visibility = Visibility.Collapsed;
            ToolHost.Visibility = Visibility.Collapsed;
            DetectedScroller.Visibility = Visibility.Visible;
            SetRailOpen(true);
            RenderCrossEpicCards();
            UpdateDetectedGlyph();
            if (!_detectedLoadedOnce) { _detectedLoadedOnce = true; await RefreshDetectedAsync(); }
        }

        private void RailClose_Click(object sender, MouseButtonEventArgs e) => CloseRail();

        private void CloseRail()
        {
            _chatToolOpen = null;
            _detectedOpen = false;
            SetRailOpen(false);
            UpdateDetectedGlyph();
        }

        private void SetRailOpen(bool open)
        {
            RailColumn.Width = open ? new GridLength(280) : new GridLength(0);
        }

        private void RailRefresh_Click(object sender, MouseButtonEventArgs e) => _ = RefreshDetectedAsync();

        /// <summary>README §6.1 — the Detected panel wires to the real, already-landed
        /// ChatDockService/ChatDockPanel (mentioned issues + pinned questions), no new backend.</summary>
        public async Task RefreshDetectedAsync()
        {
            var db = _owner.QueueDb;
            if (db == null) return;

            _dockPanel ??= new ChatDockPanel();
            if (!ReferenceEquals(DetectedDockHost.Content, _dockPanel))
                DetectedDockHost.Content = _dockPanel;

            try
            {
                string chatUrl = !string.IsNullOrWhiteSpace(_chat.ClaudeUrl)
                    ? _chat.ClaudeUrl
                    : (string.IsNullOrWhiteSpace(_chat.ConversationId) ? "" : $"https://claude.ai/chat/{_chat.ConversationId}");
                var data = await ChatDockService.BuildAsync(db, chatUrl, _chat.Id, _owner.BuildQueuePanel?.CurrentQueueItems);
                _lastDockData = data;
                RenderDock();

                _hasUndismissed = data.Items.Any(i => !_dismissed.Contains(i.Number.ToString()))
                                  || data.PinnedQuestions.Count > 0
                                  || _questions.Count > 0;
                UpdateDetectedGlyph();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.container", $"RefreshDetected failed for {_chat.ConversationId}: {ex.Message}");
            }
        }

        /// <summary>Git #2682 — re-renders the dock against <see cref="_lastDockData"/> with the
        /// real per-item actions wired: in-app open, Dispatch (real queue path), Dismiss (the
        /// existing-but-previously-unwired <see cref="_dismissed"/> set), and Send-to-discuss.</summary>
        private void RenderDock()
        {
            if (_dockPanel == null || _lastDockData == null) return;

            _dockPanel.Render(
                _lastDockData,
                _dismissed,
                onOpenIssue: n =>
                {
                    // Git #2682 — real in-app Git detail tab, not a browser (was Process.Start
                    // against a hardcoded github.com URL). Same object _owner.SendToChatAsync
                    // already comes from in this file.
                    _ = OpenIssueInAppAsync(n);
                },
                onResolvePin: async (pin, reply) =>
                {
                    var status = await _owner.SendToChatAsync(_chat, reply);
                    return status == "sent" || status == "inserted-no-send";
                },
                onDispatch: async item =>
                {
                    var result = await IssueDispatchService.DispatchAsync(_owner.QueueDb, item.Number);
                    return result.Message;
                },
                onDismiss: item =>
                {
                    _dismissed.Add(item.Number.ToString());
                    RenderDock();
                    _hasUndismissed = _lastDockData.Items.Any(i => !_dismissed.Contains(i.Number.ToString()))
                                      || _lastDockData.PinnedQuestions.Count > 0
                                      || _questions.Count > 0;
                    UpdateDetectedGlyph();
                },
                onSendToDiscuss: item =>
                {
                    _ = _owner.SendToChatAsync(_chat, $"Let's discuss #{item.Number} — {item.Title}");
                });
        }

        private async Task OpenIssueInAppAsync(int number)
        {
            try { await _owner.OpenGitDetailByNumberAsync(number); }
            catch (Exception ex) { ActivityLog.Log("chat.container", $"open issue #{number} failed: {ex.Message}"); }
        }

        private void UpdateDetectedGlyph()
        {
            // README §2 — the ⌸ dot lights only when undismissed items exist AND the panel is closed.
            DetectedDot.Visibility = (_hasUndismissed && !_detectedOpen) ? Visibility.Visible : Visibility.Collapsed;
            BtnDetectedGlyph.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(_detectedOpen ? "#e6edf3" : "#c2c0bc"));
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Band 5 — composer (§8) + tool "send to chat" invariant (§5)
        // ─────────────────────────────────────────────────────────────────────────

        /// <summary>This tab's draft text. One container per tab makes the §8 per-tab draft
        /// dictionary structural — switching tabs switches the whole container.</summary>
        public string DraftText => ChatComposer.Text ?? "";

        /// <summary>README §5/§8 — every tool + the cross-epic flow writes HERE (never auto-sends),
        /// appended after a blank line. <paramref name="returnAddress"/>, when set, raises the
        /// cross-epic return bar so the trip home isn't lost.</summary>
        public void AppendToComposer(string text, string? returnAddress = null)
        {
            if (string.IsNullOrEmpty(text)) return;
            if (string.IsNullOrWhiteSpace(ChatComposer.Text))
                ChatComposer.Text = text;
            else
                ChatComposer.Text = ChatComposer.Text.TrimEnd() + "\n\n" + text;
            ChatComposer.CaretIndex = ChatComposer.Text.Length;
            ChatComposer.Focus();

            if (!string.IsNullOrWhiteSpace(returnAddress))
            {
                ComposerReturnText.Text = returnAddress;
                ComposerReturnBar.Visibility = Visibility.Visible;
            }

            UpdateComposerBandVisibility();
        }

        /// <summary>Git #2678 — the whole band (pill + disclaimer row) has nothing to do, and stays
        /// collapsed, until either a real draft exists or a cross-epic return address is pending.
        /// claude.ai's own composer on the live page above already handles ordinary typing/sending;
        /// this band's only real job is staging a tool's "send to chat" write (§8/§5) or a cross-epic
        /// answer, so it only needs to appear on demand for those, not sit as permanent chrome.</summary>
        private void UpdateComposerBandVisibility()
        {
            bool hasDraft = !string.IsNullOrEmpty(ChatComposer.Text);
            bool hasReturnAddress = ComposerReturnBar.Visibility == Visibility.Visible;
            ComposerBand.Visibility = (hasDraft || hasReturnAddress) ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ComposerReturnClear_Click(object sender, MouseButtonEventArgs e)
        {
            ComposerReturnBar.Visibility = Visibility.Collapsed;
            UpdateComposerBandVisibility();
        }

        private void ChatComposer_TextChanged(object sender, TextChangedEventArgs e)
        {
            UpdateGauge();
            UpdateComposerBandVisibility();
        }

        private void ChatComposer_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // Enter sends; Shift+Enter newlines (§8).
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
            {
                e.Handled = true;
                _ = SendComposerAsync();
            }
        }

        private void BtnComposerSend_Click(object sender, RoutedEventArgs e) => _ = SendComposerAsync();

        /// <summary>Sends the draft into THIS tab's live claude.ai composer via the real DOM bridge
        /// (insert + submit), then clears only this tab's draft (§8). Targets this container's own
        /// WebView2 directly — not the floaty/active-chat router — so it always lands in this tab.</summary>
        private async Task SendComposerAsync()
        {
            string text = ChatComposer.Text?.Trim() ?? "";
            if (text.Length == 0) return;
            // Resolve the LIVE WebView2 from the hosted body subtree at send time: a background-reopen
            // swap (SwapInReopenPreload) can replace and dispose the original one, so a captured
            // reference would go stale — the live tree always holds the current view.
            var wv = ResolveWebView();
            if (wv?.CoreWebView2 == null)
            {
                ToastEngine.Show("Chat", "The live chat view isn't ready yet.", ToastKind.Info);
                return;
            }

            try
            {
                string rawInsert = await wv.ExecuteScriptAsync(FloatingChatBridgeScript.BuildInsertScript(text)) ?? "";
                string insert = System.Text.Json.JsonSerializer.Deserialize<string>(rawInsert) ?? "";
                if (insert != "inserted")
                {
                    ActivityLog.Log("chat.container", $"composer insert failed '{insert}' ({_chat.ConversationId})");
                    ToastEngine.Show("Chat", "Couldn't reach the claude.ai composer to send.", ToastKind.Error);
                    return;
                }
                await Task.Delay(220);
                string rawSubmit = await wv.ExecuteScriptAsync(FloatingChatBridgeScript.SubmitScript) ?? "";
                string submit = System.Text.Json.JsonSerializer.Deserialize<string>(rawSubmit) ?? "";
                ActivityLog.Log("chat.container", $"composer send status '{submit}' ({_chat.ConversationId})");

                // Clear only this tab's draft on a successful hand-off.
                ChatComposer.Text = "";
                ComposerReturnBar.Visibility = Visibility.Collapsed;
                UpdateGauge();
                UpdateComposerBandVisibility();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.container", $"composer send error: {ex.Message}");
                ToastEngine.Show("Chat", $"Send failed: {ex.Message}", ToastKind.Error);
            }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Cross-epic question round trip (§7)
        // ─────────────────────────────────────────────────────────────────────────

        private void StartCrossEpicQuestion()
        {
            var targets = _owner.GetOtherOpenChatEpics(_chat.ConversationId ?? "");
            if (targets.Count == 0)
            {
                ToastEngine.Show("Cross-epic", "Open another epic's chat tab first, then ask it a question.", ToastKind.Info);
                return;
            }

            var dlg = new CrossEpicAskDialog(targets) { Owner = Window.GetWindow(this) };
            if (dlg.ShowDialog() != true || dlg.SelectedTarget == null || string.IsNullOrWhiteSpace(dlg.QuestionText))
                return;

            var target = dlg.SelectedTarget.Value;
            string fromLabel = EpicNumber.HasValue ? $"#{EpicNumber.Value} {StripName(_chat.Title)}" : _chat.Title;
            string stamped =
                $"**Question from {fromLabel}**\n\n{dlg.QuestionText.Trim()}\n\n_Answer here, then take it back to {(EpicNumber.HasValue ? "#" + EpicNumber.Value : "the asking chat")}._";

            // Write into the DESTINATION tab's composer (never auto-send), with a return bar there.
            bool wrote = _owner.AppendToChatComposer(target.ConversationId, stamped,
                returnAddress: $"Question from {fromLabel} — answer here, then take it back.");
            if (!wrote)
            {
                ToastEngine.Show("Cross-epic", "Couldn't reach that chat's composer.", ToastKind.Error);
                return;
            }

            _questions.Add(new CrossEpicQuestion
            {
                ToEpic = target.EpicNumber ?? 0,
                ToEpicName = target.EpicName,
                ToConversationId = target.ConversationId,
                FromEpic = EpicNumber ?? 0,
                FromEpicName = StripName(_chat.Title),
                FromConversationId = _chat.ConversationId ?? "",
                Question = dlg.QuestionText.Trim(),
            });
            _hasUndismissed = true;
            if (!_detectedOpen) OpenDetected(); else RenderCrossEpicCards();
            UpdateDetectedGlyph();
            ToastEngine.Show("Cross-epic", $"Question sent to {(target.EpicNumber.HasValue ? "#" + target.EpicNumber : target.EpicName)}'s composer.", ToastKind.Success);
        }

        private void RenderCrossEpicCards()
        {
            CrossEpicCards.Children.Clear();
            foreach (var q in _questions)
                CrossEpicCards.Children.Add(BuildCrossEpicCard(q));
        }

        private FrameworkElement BuildCrossEpicCard(CrossEpicQuestion q)
        {
            bool ready = q.State == CrossEpicState.AnswerReady;
            var accent = ready ? "#7fb08a" : "#e2b039";
            var card = new Border
            {
                Margin = new Thickness(0, 0, 0, 10),
                Padding = new Thickness(10),
                CornerRadius = new CornerRadius(7),
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#232320")),
                BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(accent)),
                BorderThickness = new Thickness(1)
            };
            var sp = new StackPanel();
            sp.Children.Add(new TextBlock
            {
                Text = ready ? "ANSWER READY" : "WAITING ON THAT CHAT",
                FontSize = 9, FontWeight = FontWeights.ExtraBold,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(accent))
            });
            sp.Children.Add(new TextBlock
            {
                Text = q.ToEpic > 0 ? $"#{q.ToEpic} {q.ToEpicName}" : q.ToEpicName,
                Margin = new Thickness(0, 3, 0, 0), FontSize = 11, FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#ece9e4"))
            });
            sp.Children.Add(new TextBlock
            {
                Text = q.Question, Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap,
                FontSize = 10.5, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#dedbd5"))
            });

            if (ready)
            {
                sp.Children.Add(new TextBlock
                {
                    Text = q.Answer, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap,
                    FontSize = 10.5, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#9fd0a9"))
                });
                var paste = MakeCardButton("Paste answer into this chat", "#d97757");
                paste.Click += (_, _) =>
                {
                    string ans = $"**Answer from {(q.ToEpic > 0 ? "#" + q.ToEpic + " " : "")}{q.ToEpicName}**\n\n> {q.Question}\n\n{q.Answer}";
                    AppendToComposer(ans);
                    _questions.Remove(q);
                    RenderCrossEpicCards();
                    _hasUndismissed = _questions.Count > 0;
                    UpdateDetectedGlyph();
                };
                sp.Children.Add(paste);
            }
            else
            {
                // README §7 note — the DOM one-shot read of another tab's last assistant turn is not
                // wired in this Container issue; the sanctioned fallback is the manual paste path, so
                // the card holds the return address and lets the answer be pasted in.
                var bring = MakeCardButton("Bring the answer back", "#d97757");
                var pasteBox = new TextBox
                {
                    Margin = new Thickness(0, 6, 0, 0), MinHeight = 44, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
                    Visibility = Visibility.Collapsed,
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#0d0f10")),
                    Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#ece9e4")),
                    BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#302f2d")),
                    FontSize = 10.5
                };
                var confirm = MakeCardButton("Answer captured", "#302f2d");
                confirm.Visibility = Visibility.Collapsed;
                bring.Click += (_, _) => { pasteBox.Visibility = Visibility.Visible; confirm.Visibility = Visibility.Visible; pasteBox.Focus(); };
                confirm.Click += (_, _) =>
                {
                    if (string.IsNullOrWhiteSpace(pasteBox.Text)) return;
                    q.Answer = pasteBox.Text.Trim();
                    q.State = CrossEpicState.AnswerReady;
                    RenderCrossEpicCards();
                };
                sp.Children.Add(bring);
                sp.Children.Add(pasteBox);
                sp.Children.Add(confirm);
            }

            card.Child = sp;
            return card;
        }

        private static Button MakeCardButton(string text, string colour)
        {
            var b = new Button { Margin = new Thickness(0, 7, 0, 0), Cursor = Cursors.Hand, BorderThickness = new Thickness(0), Height = 26, HorizontalAlignment = HorizontalAlignment.Stretch };
            bool light = colour == "#d97757";
            b.Content = new TextBlock { Text = text, FontSize = 10.5, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(light ? (Color)ColorConverter.ConvertFromString("#1a0f0a") : (Color)ColorConverter.ConvertFromString("#c2c0bc")) };
            var tpl = new ControlTemplate(typeof(Button));
            var border = new System.Windows.FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.BackgroundProperty, new SolidColorBrush((Color)ColorConverter.ConvertFromString(colour)));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(5));
            var cp = new System.Windows.FrameworkElementFactory(typeof(ContentPresenter));
            cp.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            cp.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(cp);
            tpl.VisualTree = border;
            b.Template = tpl;
            return b;
        }

        private static string StripName(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return "";
            // Trim a leading "[#N] " / "#N " if present so the stamp reads cleanly.
            var t = title.Trim();
            if (t.StartsWith("[#"))
            {
                int close = t.IndexOf(']');
                if (close > 0 && close + 1 < t.Length) return t[(close + 1)..].Trim();
            }
            return t;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // Inspector states (§9) — public hooks; two visual states only (no inspector engine here).
        // ─────────────────────────────────────────────────────────────────────────

        public void ShowInspectorWarning(string message)
        {
            InspectorWarningText.Text = message;
            InspectorWarningNotice.Visibility = Visibility.Visible;
        }

        public void ShowInspectorBlocking()
        {
            InspectorWarningNotice.Visibility = Visibility.Collapsed;
            // Git #2678 — InspectorBlockingOverlay lives inside ComposerBand (Grid.Row="4") so it
            // paints over that band specifically (§9); ComposerBand must be forced visible here or
            // the overlay would be hidden along with it whenever the band was otherwise collapsed.
            ComposerBand.Visibility = Visibility.Visible;
            InspectorBlockingOverlay.Visibility = Visibility.Visible;
        }

        public void ClearInspector()
        {
            InspectorWarningNotice.Visibility = Visibility.Collapsed;
            InspectorBlockingOverlay.Visibility = Visibility.Collapsed;
            UpdateComposerBandVisibility();
        }
    }
}
