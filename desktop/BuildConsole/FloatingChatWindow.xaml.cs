using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2059 (Phase 1) / #2065 (Phase 2) — Floating Chat Window, part of the #2035
    /// Global Chat Drawer epic.
    ///
    /// A real WPF window OWNED/launched by BuildConsole (via
    /// <see cref="MainWindow.OpenFloatingChatWindow"/>), floating and always-on-top so it
    /// stays usable while Design / the M365 admin center / anything else has focus.
    ///
    /// Phase 2 adds TABS: more than one chat can be open in the same window at once. Each
    /// tab is its own chat session that reuses the SAME bridge Phase 1 built — this window
    /// does NOT invent a new mechanism. Every tab hosts its own real claude.ai
    /// <see cref="Controls.ChatSafeWebView2"/> (the same control every chat tab uses, sharing
    /// the same WebView2 environment/login via <see cref="MainWindow.EnsureWebViewInitializedAsync"/>)
    /// driven by <see cref="FloatingChatBridgeScript"/> — the composer-insert technique from
    /// StickyNotesComposerInsertScript (#937/#940) to SEND, and the context-meter's own
    /// selectors to RECEIVE the latest assistant reply, rendered as RichText via
    /// <see cref="MarkdownRenderer"/>.
    ///
    /// WebView2 throttle constraint (measured, carried from Phase 1): a hidden WebView2 is
    /// throttled, so its scraper pauses. This window keeps EVERY tab's WebView2 alive in the
    /// shared BridgeHost grid but makes only the ACTIVE tab's WebView2 Visible; all inactive
    /// tabs' WebView2s are Collapsed, which throttles them and pauses their capture until the
    /// tab is reactivated. That is the exact per-tab equivalent of Phase 1's "collapsing the
    /// bridge strip pauses live capture" — an inactive tab does not update its rendered reply
    /// until you switch back to it, at which point its 1.2s poll resumes and catches up. Each
    /// WebView2 initialises its CoreWebView2 while it is the visible/active tab (a newly opened
    /// chat becomes active immediately), so nothing has to initialise while Collapsed.
    ///
    /// Explicitly OUT of scope for Phase 2 (deferred to later phases on #2035): side dock /
    /// progress extraction, screenshot paste, OCR, self-purging gallery, Shelf park/restore.
    /// </summary>
    public partial class FloatingChatWindow : Window
    {
        private const string LogChannel = "chat.floating";

        // The default empty-pane hint (mirrors FloatingChatWindow.xaml's EmptyHint text). Kept
        // here so the send flow can swap in a "waiting for the reply" hint and restore this one
        // per tab (Git #2072).
        private const string DefaultEmptyHint =
            "Waiting for the chat to load… send a message below and the reply will appear here.";
        private const string WaitingForReplyHint = "Sent. Waiting for the reply…";

        /// <summary>
        /// Per-tab state. Each open chat gets one of these — its own bridge WebView2, its own
        /// last-captured reply, its own draft input and inline status — so switching tabs
        /// restores exactly what that chat looked like without re-scraping or losing an unsent
        /// draft. The WebView2 is created lazily the first time the tab is activated (always
        /// while visible), then kept alive for the life of the tab.
        /// </summary>
        private sealed class FloatingChatTab
        {
            public FloatingChatTab(BoardChat chat) { Chat = chat; }

            public BoardChat Chat { get; }
            public Controls.ChatSafeWebView2? Wv;
            public bool Initialized;
            public string? LastMarkdown;
            /// <summary>The rendered MarkdownRenderer output, cached so re-activating the tab
            /// restores the reply instantly. Null until the first reply is captured.</summary>
            public FrameworkElement? RenderedResponse;
            /// <summary>Unsent composer text, preserved across tab switches.</summary>
            public string InputDraft = "";
            public string? InlineText;
            public bool InlineIsError;
            /// <summary>True between a CONFIRMED send and the arrival of the genuinely new
            /// reply (Git #2072). While set, the pane shows an honest "waiting for the reply"
            /// hint rather than the stale pre-send turn — the capture gate refuses to surface
            /// anything until a real new assistant turn appears.</summary>
            public bool AwaitingReply;

            // The tab chip (built in RebuildTabStrip) — kept so activation can restyle it
            // without a full rebuild of the strip.
            public Border? Chip;
        }

        private readonly MainWindow? _owner;
        private readonly DispatcherTimer _saveDebounce;
        private readonly List<FloatingChatTab> _tabs = new();
        private FloatingChatTab? _active;
        private bool _loaded;
        private bool _bridgeExpanded = true;
        private double _bridgeHeight = 170;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        public FloatingChatWindow(BoardChat chat, MainWindow? owner)
        {
            if (chat == null) throw new ArgumentNullException(nameof(chat));
            _owner = owner;
            InitializeComponent();

            _saveDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            _saveDebounce.Tick += (s, e) => { _saveDebounce.Stop(); PersistBounds(); };

            var settings = BuildConsoleSettings.Load();
            if (settings.FloatingChatWidth > 0) Width = settings.FloatingChatWidth;
            if (settings.FloatingChatHeight > 0) Height = settings.FloatingChatHeight;
            if (settings.FloatingChatLeft >= 0 && settings.FloatingChatTop >= 0)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = settings.FloatingChatLeft;
                Top = settings.FloatingChatTop;
            }
            else
            {
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }
            _bridgeExpanded = settings.FloatingChatBridgeExpanded;
            ApplyBridgeState();

            // Seed the first tab (activated once the window loads and the shared WebView2
            // environment is ready).
            _tabs.Add(new FloatingChatTab(chat));

            Loaded += async (s, e) =>
            {
                _loaded = true;
                ForceTopmost();
                RebuildTabStrip();
                await ActivateTabAsync(_tabs[0]);
            };
            Deactivated += (s, e) => ForceTopmost();
            LocationChanged += (s, e) => ScheduleSave();
            SizeChanged += (s, e) => ScheduleSave();
            Closed += (s, e) =>
            {
                foreach (var t in _tabs)
                {
                    try { t.Wv?.Dispose(); } catch { }
                }
            };
        }

        /// <summary>True if this window already has a tab for <paramref name="conversationId"/>.</summary>
        public bool HasChat(string conversationId) =>
            _tabs.Any(t => string.Equals(t.Chat.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase));

        /// <summary>
        /// Add a chat as a new tab (or, if it's already open, just bring it forward). Called by
        /// <see cref="MainWindow.OpenFloatingChatWindow"/> when the floaty is already up, so a
        /// second "Open as Floating Window" stacks a tab instead of replacing the window.
        /// </summary>
        public async void AddOrActivateChat(BoardChat chat)
        {
            if (chat == null || string.IsNullOrWhiteSpace(chat.ClaudeUrl)) return;
            var existing = _tabs.FirstOrDefault(t =>
                string.Equals(t.Chat.ConversationId, chat.ConversationId, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                await ActivateTabAsync(existing);
                Activate();
                return;
            }

            var tab = new FloatingChatTab(chat);
            _tabs.Add(tab);
            RebuildTabStrip();
            ActivityLog.Log(LogChannel, $"added tab for {chat.Title} ({chat.ConversationId}); {_tabs.Count} tab(s) open");
            await ActivateTabAsync(tab);
            Activate();
        }

        // ── Tab activation / switching ───────────────────────────────────────────
        private async System.Threading.Tasks.Task ActivateTabAsync(FloatingChatTab tab)
        {
            if (tab == null) return;

            // Stash the outgoing tab's live UI state, then throttle its bridge by collapsing it.
            if (_active != null && !ReferenceEquals(_active, tab))
            {
                _active.InputDraft = InputBox.Text;
                if (_active.Wv != null) _active.Wv.Visibility = Visibility.Collapsed;
            }

            _active = tab;

            // Restore this tab's rendered reply (or the waiting hint), draft, and inline status.
            if (tab.RenderedResponse != null)
            {
                ResponseHost.Content = tab.RenderedResponse;
                EmptyHint.Visibility = Visibility.Collapsed;
            }
            else
            {
                ResponseHost.Content = null;
                EmptyHint.Text = tab.AwaitingReply ? WaitingForReplyHint : DefaultEmptyHint;
                EmptyHint.Visibility = Visibility.Visible;
            }
            InputBox.Text = tab.InputDraft;
            InputBox.CaretIndex = InputBox.Text.Length;
            if (!string.IsNullOrEmpty(tab.InlineText))
                ShowInlineMessage(tab.InlineText!, tab.InlineIsError);
            else
                ClearInlineMessage();

            HeaderTitle.Text = string.IsNullOrWhiteSpace(tab.Chat.Title) ? "Chat" : tab.Chat.Title;
            Title = HeaderTitle.Text;
            RestyleChips();

            // Lazily create/init this tab's bridge (always while it is the visible tab, so
            // CoreWebView2 initialisation has a realised HWND), then make it visible so its
            // scraper resumes. An already-initialised tab just flips back to Visible.
            await EnsureTabBridgeAsync(tab);
            if (tab.Wv != null) tab.Wv.Visibility = Visibility.Visible;
        }

        // ── Bridge (WebView2 engine) — one per tab ───────────────────────────────
        private async System.Threading.Tasks.Task EnsureTabBridgeAsync(FloatingChatTab tab)
        {
            if (tab.Initialized) return;
            tab.Initialized = true; // guard against re-entrancy while the async init is in flight
            try
            {
                var wv = new Controls.ChatSafeWebView2
                {
                    DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37),
                    Visibility = Visibility.Visible
                };
                tab.Wv = wv;
                BridgeHost.Children.Add(wv);

                bool ready = await MainWindow.EnsureWebViewInitializedAsync(wv);
                if (!ready || wv.CoreWebView2 == null)
                {
                    SetTabInline(tab, "Couldn't start the chat bridge (WebView2 unavailable).", isError: true);
                    ActivityLog.Log(LogChannel, $"bridge-init-failed for chat {tab.Chat.ConversationId}");
                    return;
                }

                // AddScriptToExecuteOnDocumentCreatedAsync MUST run before navigation
                // (Git #816) — a script added after nav starts only applies to the NEXT one.
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(FloatingChatBridgeScript.CaptureScript);
                // Git #2071 — also inject the issue-mention highlighter (Git #1253) that
                // underlines #NNN tokens in Claude's responses and lets Shane hover/click
                // them, same as MainWindow's InjectBuilderButtonsAsync.
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildConsole.Services.IssueMentionInjector.Script);
                // Route each tab's frames to that tab regardless of which tab is active — an
                // inactive (throttled) tab may still post a frame, and it should update its own
                // cached reply, never the active tab's.
                wv.WebMessageReceived += (s, e) => OnBridgeMessage(tab, e);

                if (!string.IsNullOrWhiteSpace(tab.Chat.ClaudeUrl))
                    wv.CoreWebView2.Navigate(tab.Chat.ClaudeUrl);
                else
                    SetTabInline(tab, "This chat has no URL to open.", isError: true);

                ActivityLog.Log(LogChannel, $"opened floating chat tab for {tab.Chat.Title} ({tab.Chat.ClaudeUrl})");
            }
            catch (Exception ex)
            {
                tab.Initialized = false; // allow a retry on the next activation
                SetTabInline(tab, "Chat bridge failed to start.", isError: true);
                ActivityLog.Log(LogChannel, $"bridge-init-error for chat {tab.Chat.ConversationId}: {ex.Message}");
            }
        }

        private void OnBridgeMessage(FloatingChatTab tab, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { try { raw = e.WebMessageAsJson; } catch { return; } }
            if (string.IsNullOrWhiteSpace(raw)) return;

            try
            {
                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeEl)) return;
                var type = typeEl.GetString();

                if (type == "BT_FLOATY_RESPONSE")
                {
                    string md = root.TryGetProperty("markdown", out var mdEl) ? (mdEl.GetString() ?? "") : "";
                    if (string.IsNullOrWhiteSpace(md) || md == tab.LastMarkdown) return;
                    tab.LastMarkdown = md;
                    RenderResponse(tab, md);
                }
                // Git #2071 — the two callbacks IssueMentionInjector.Script needs from its host
                // to actually resolve/open a mention, mirroring MainWindow's ChatWv_WebMessageReceived
                // handling of the same message types (Git #1253).
                else if (type == "BT_HOVER_ISSUE")
                {
                    if (root.TryGetProperty("number", out var numEl) && numEl.TryGetInt32(out var n) && n > 0)
                        _ = ResolveAndShowIssueTipAsync(tab, n);
                }
                else if (type == "BT_OPEN_ISSUE")
                {
                    if (root.TryGetProperty("number", out var numEl) && numEl.TryGetInt32(out var n) && n > 0)
                    {
                        ActivityLog.Log(LogChannel, $"BT_OPEN_ISSUE #{n} (floating chat)");
                        _ = _owner?.OpenGitDetailByNumberAsync(n);
                    }
                }
            }
            catch { /* a malformed frame is not fatal — the next poll re-posts */ }
        }

        private async System.Threading.Tasks.Task ResolveAndShowIssueTipAsync(FloatingChatTab tab, int n)
        {
            if (tab.Wv?.CoreWebView2 == null) return;

            string tipTitle = "Unknown";
            string tipStatus = "OPEN";
            bool tipEpic = false;

            var cached = _owner?.LeftSidebar?.BuildDetailIssue(n);
            if (cached != null)
            {
                tipTitle = cached.RawTitle;
                tipStatus = cached.Status;
                tipEpic = cached.IsEpic;
            }
            else
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (settings.HasGitHubPat)
                {
                    try
                    {
                        var ghClient = new BuildConsole.Services.GitHubApiClient(settings.GitHubPat);
                        var detail = await ghClient.GetIssueAsync(n);
                        if (detail != null)
                        {
                            tipTitle = detail.Title;
                            tipStatus = string.Equals(detail.State, "closed", StringComparison.OrdinalIgnoreCase) ? "CLOSED" : "OPEN";
                        }
                    }
                    catch { /* best-effort; keep defaults */ }
                }
            }

            try
            {
                string js = "window.__btShowIssueTip && window.__btShowIssueTip(" +
                            $"{n}," +
                            $"{JsonSerializer.Serialize(tipTitle)}," +
                            $"{JsonSerializer.Serialize(tipStatus)}," +
                            $"{(tipEpic ? "true" : "false")});";
                await tab.Wv.CoreWebView2.ExecuteScriptAsync(js);
                ActivityLog.Log(LogChannel, $"BT_HOVER_ISSUE #{n}: '{tipTitle}' ({tipStatus}{(tipEpic ? ", epic" : "")}) (floating chat)");
            }
            catch { }
        }

        private void RenderResponse(FloatingChatTab tab, string markdown)
        {
            var opts = new MarkdownRenderer.RenderOptions
            {
                GetBrush = key => (Brush)FindResource(key),
                OnUrlClick = url => { try { _owner?.OpenWebTab(url, "Web", ""); } catch { } },
                OnFileClick = _ => { /* no in-floaty file open (deferred on #2035) */ },
            };
            try
            {
                var rendered = MarkdownRenderer.Render(markdown, opts);
                tab.RenderedResponse = rendered;
                // A real reply has arrived and been surfaced by the capture gate — we're no
                // longer waiting (Git #2072).
                tab.AwaitingReply = false;
                // Only touch the shared response pane when this is the tab on screen — an
                // inactive tab's reply is cached and shown when it's next activated.
                if (ReferenceEquals(tab, _active))
                {
                    ResponseHost.Content = rendered;
                    EmptyHint.Visibility = Visibility.Collapsed;
                    ResponseScroll.ScrollToBottom();
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"render-error: {ex.Message}");
            }
        }

        // ── Send ────────────────────────────────────────────────────────────────
        private async void BtnSend_Click(object sender, RoutedEventArgs e) => await SendAsync();

        private void InputBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // Enter sends; Shift+Enter inserts a newline (standard chat-composer feel).
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
            {
                e.Handled = true;
                _ = SendAsync();
            }
        }

        private async System.Threading.Tasks.Task SendAsync()
        {
            var tab = _active;
            if (tab == null) return;

            var text = InputBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                SetTabInline(tab, "Nothing to send.", isError: true);
                return;
            }
            if (tab.Wv?.CoreWebView2 == null)
            {
                SetTabInline(tab, "Chat bridge isn't ready yet.", isError: true);
                return;
            }

            BtnSend.IsEnabled = false;
            try
            {
                string status = await InsertAndSubmitAsync(tab, text);
                if (status == "sent")
                {
                    // Clear only if the user hasn't switched tabs mid-send.
                    if (ReferenceEquals(tab, _active)) InputBox.Clear();
                    tab.InputDraft = "";
                    // Drop the stale pre-send reply from the pane and show an honest waiting
                    // state — the capture gate (armed at submit) fills it only when the
                    // genuinely new reply arrives, so a silently-failed reply shows "waiting",
                    // never a stale answer (Git #2072).
                    tab.AwaitingReply = true;
                    tab.LastMarkdown = null;
                    tab.RenderedResponse = null;
                    if (ReferenceEquals(tab, _active))
                    {
                        ResponseHost.Content = null;
                        EmptyHint.Text = WaitingForReplyHint;
                        EmptyHint.Visibility = Visibility.Visible;
                    }
                    SetTabInline(tab, "Sent.", isError: false);
                }
                else if (status == "inserted-no-send")
                {
                    // The text is in the composer but the submit didn't confirm — leave the
                    // input so nothing is lost; Shane can press Send again or submit in-page.
                    SetTabInline(tab, "Message inserted but couldn't auto-send — try Send again, or press Enter in the page below.", isError: true);
                }
                else if (status == "no-composer")
                {
                    SetTabInline(tab, "Couldn't find the chat composer — is the conversation still loading?", isError: true);
                }
                else
                {
                    SetTabInline(tab, "Send failed while inserting/submitting the message.", isError: true);
                }
            }
            finally
            {
                BtnSend.IsEnabled = true;
            }
        }

        /// <summary>
        /// Git #2063 — programmatic send+submit into the CURRENTLY ACTIVE tab, for an automated
        /// caller (e.g. DispatchPanel asking this chat to write and post a `BUILD:` comment when
        /// none exists yet) rather than a user-typed message. Same insert+submit path <see
        /// cref="SendAsync"/> uses, so it carries the identical send-side confirmation guarantee
        /// (and identical send-side risk) as the manual Send button — see <see
        /// cref="InsertAndSubmitAsync"/>. Returns 'sent' | 'inserted-no-send' | 'no-composer' |
        /// 'no-active-tab' | 'error: …' so the caller can show an honest result instead of
        /// assuming success.
        /// </summary>
        public async System.Threading.Tasks.Task<string> SendToActiveTabAsync(string text)
        {
            var tab = _active;
            if (tab == null) return "no-active-tab";
            if (tab.Wv?.CoreWebView2 == null) return "no-composer";

            string status = await InsertAndSubmitAsync(tab, text);
            if (status == "sent")
            {
                SetTabInline(tab, "Sent.", isError: false);
                ActivityLog.Log(LogChannel, $"sent programmatic request to chat {tab.Chat.ConversationId}");
            }
            return status;
        }

        /// <summary>
        /// The real insert-then-submit mechanic shared by the manual Send button (<see
        /// cref="SendAsync"/>) and the programmatic <see cref="SendToActiveTabAsync"/>: insert
        /// via <see cref="FloatingChatBridgeScript.BuildInsertScript"/>, give claude.ai's Send
        /// button a tick to enable off the input event it batches asynchronously, then submit via
        /// <see cref="FloatingChatBridgeScript.SubmitScript"/> as a separate call (ExecuteScriptAsync
        /// does not await a returned Promise, so this can't be one round-trip). Every outcome is
        /// logged here so both callers get the same audit trail.
        /// </summary>
        private async System.Threading.Tasks.Task<string> InsertAndSubmitAsync(FloatingChatTab tab, string text)
        {
            try
            {
                string insert = await ExecScriptString(tab, FloatingChatBridgeScript.BuildInsertScript(text));
                if (insert != "inserted")
                {
                    ActivityLog.Log(LogChannel, $"send-failed: insert status '{insert}' ({tab.Chat.ConversationId})");
                    return insert;
                }

                // Submit arms the receive-side correlation gate at the instant of submit
                // (SubmitScript -> __bcFloatyBeginWait) so a stale pre-send turn can never be
                // surfaced as the reply (Git #2072). It returns 'submitted' provisionally.
                await System.Threading.Tasks.Task.Delay(220);
                string submit = await ExecScriptString(tab, FloatingChatBridgeScript.SubmitScript);
                if (submit == "no-composer")
                {
                    ActivityLog.Log(LogChannel, $"send-failed: submit no-composer ({tab.Chat.ConversationId})");
                    return "no-composer";
                }
                if (submit != "submitted")
                {
                    ActivityLog.Log(LogChannel, $"send-failed: submit status '{submit}' ({tab.Chat.ConversationId})");
                    return submit; // 'error: …'
                }

                // Don't trust the button click — CONFIRM the send actually landed by checking the
                // composer cleared (Git #2072). This replaces the old false-'sent' path that
                // reported success the instant it clicked Send.
                await System.Threading.Tasks.Task.Delay(600);
                string verify = await ExecScriptString(tab, FloatingChatBridgeScript.VerifySubmitScript);
                if (verify == "confirmed")
                {
                    ActivityLog.Log(LogChannel, $"sent message to chat {tab.Chat.ConversationId}");
                    return "sent";
                }

                // Couldn't confirm — cancel the wait gate so the pane doesn't sit waiting for a
                // reply that will never come, and report the honest partial state.
                await ExecScriptString(tab, FloatingChatBridgeScript.CancelWaitScript);
                ActivityLog.Log(LogChannel, $"send-partial: submit not confirmed (verify='{verify}') ({tab.Chat.ConversationId})");
                return "inserted-no-send";
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"send-error ({tab.Chat.ConversationId}): {ex.Message}");
                return "error: " + ex.Message;
            }
        }

        // Git #2078 — CoreWebView2.ExecuteScriptAsync carries no timeout of its own. If the
        // renderer stalls or its process dies mid-script, the returned Task can hang
        // indefinitely; since InsertAndSubmitAsync is awaited directly inside SendAsync's
        // try/finally, an unbounded hang here means the finally that re-enables BtnSend is
        // never reached — the button reads as permanently stuck disabled even though the
        // C# disable/enable logic itself is correct. Bound every script execution so a
        // WebView2-side stall always surfaces as a timed-out "error: …" status instead of
        // hanging SendAsync forever.
        private static readonly TimeSpan ScriptTimeout = TimeSpan.FromSeconds(8);

        private async System.Threading.Tasks.Task<string> ExecScriptString(FloatingChatTab tab, string js)
        {
            if (tab.Wv?.CoreWebView2 == null) return "error: no-webview";
            var execTask = tab.Wv.CoreWebView2.ExecuteScriptAsync(js);
            var completed = await System.Threading.Tasks.Task.WhenAny(execTask, System.Threading.Tasks.Task.Delay(ScriptTimeout));
            if (completed != execTask) return "error: timeout";
            string raw = await execTask ?? "";
            try { return JsonSerializer.Deserialize<string>(raw) ?? ""; }
            catch { return raw; }
        }

        // ── Tab strip UI ─────────────────────────────────────────────────────────
        private void RebuildTabStrip()
        {
            TabStripPanel.Children.Clear();
            // A single-chat floaty stays the lightweight Phase-1 window — no strip.
            TabStripBorder.Visibility = _tabs.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
            if (_tabs.Count <= 1) return;

            foreach (var tab in _tabs)
            {
                var chip = BuildChip(tab);
                tab.Chip = chip;
                TabStripPanel.Children.Add(chip);
            }
            RestyleChips();
        }

        private Border BuildChip(FloatingChatTab tab)
        {
            var label = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(tab.Chat.Title) ? "Chat" : tab.Chat.Title,
                FontSize = 11,
                MaxWidth = 130,
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            };
            Grid.SetColumn(label, 0);

            var close = new Button
            {
                Content = "✕",
                FontSize = 9,
                Padding = new Thickness(3, 0, 3, 0),
                Margin = new Thickness(5, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Style = (Style)FindResource("IconButton"),
                ToolTip = "Close this tab"
            };
            close.Click += (s, e) => { e.Handled = true; CloseTab(tab); };
            Grid.SetColumn(close, 1);

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.Children.Add(label);
            grid.Children.Add(close);

            var chip = new Border
            {
                CornerRadius = new CornerRadius(5, 5, 0, 0),
                Padding = new Thickness(9, 4, 6, 4),
                Margin = new Thickness(0, 0, 3, 0),
                Cursor = Cursors.Hand,
                Child = grid
            };
            chip.MouseLeftButtonUp += async (s, e) => { await ActivateTabAsync(tab); };
            return chip;
        }

        private void RestyleChips()
        {
            foreach (var tab in _tabs)
            {
                if (tab.Chip == null) continue;
                bool isActive = ReferenceEquals(tab, _active);
                tab.Chip.Background = (Brush)FindResource(isActive ? "BaseBrush" : "MantleBrush");
                tab.Chip.BorderBrush = (Brush)FindResource(isActive ? "BlueBrush" : "Surface0Brush");
                tab.Chip.BorderThickness = new Thickness(1, 1, 1, isActive ? 0 : 1);
                if (tab.Chip.Child is Grid g && g.Children.Count > 0 && g.Children[0] is TextBlock tb)
                {
                    tb.FontWeight = isActive ? FontWeights.SemiBold : FontWeights.Normal;
                    tb.Foreground = (Brush)FindResource(isActive ? "TextBrush" : "Subtext1Brush");
                }
            }
        }

        private async void CloseTab(FloatingChatTab tab)
        {
            if (!_tabs.Contains(tab)) return;

            // Closing the last tab closes the window.
            if (_tabs.Count == 1)
            {
                Close();
                return;
            }

            int idx = _tabs.IndexOf(tab);
            _tabs.Remove(tab);
            try
            {
                if (tab.Wv != null)
                {
                    BridgeHost.Children.Remove(tab.Wv);
                    tab.Wv.Dispose();
                }
            }
            catch { }
            ActivityLog.Log(LogChannel, $"closed tab {tab.Chat.ConversationId}; {_tabs.Count} tab(s) left");

            RebuildTabStrip();

            if (ReferenceEquals(_active, tab))
            {
                _active = null;
                var next = _tabs[Math.Min(idx, _tabs.Count - 1)];
                await ActivateTabAsync(next);
            }
        }

        // ── Chrome / window plumbing ─────────────────────────────────────────────
        private void SetTabInline(FloatingChatTab tab, string message, bool isError)
        {
            tab.InlineText = message;
            tab.InlineIsError = isError;
            if (ReferenceEquals(tab, _active)) ShowInlineMessage(message, isError);
        }

        public void ShowInlineMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "RedBrush" : "GreenBrush");
            InlineMessage.Visibility = Visibility.Visible;
        }

        private void ClearInlineMessage()
        {
            InlineMessage.Text = "";
            InlineMessage.Visibility = Visibility.Collapsed;
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void BtnToggleBridge_Click(object sender, RoutedEventArgs e)
        {
            _bridgeExpanded = !_bridgeExpanded;
            ApplyBridgeState();
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.FloatingChatBridgeExpanded = _bridgeExpanded;
                settings.Save();
            }
            catch { }
        }

        private void ApplyBridgeState()
        {
            // Collapsed hides the live page to reclaim space; capture pauses while hidden
            // (WebView2 throttles a non-visible control), which the tooltip states plainly.
            BridgeRow.Height = _bridgeExpanded ? new GridLength(_bridgeHeight) : new GridLength(0);
            BtnToggleBridge.ToolTip = _bridgeExpanded
                ? "Hide the live chat page (pauses live capture)"
                : "Show the live chat page (resumes live capture)";
        }

        private void ScheduleSave()
        {
            if (!_loaded) return;
            _saveDebounce.Stop();
            _saveDebounce.Start();
        }

        private void PersistBounds()
        {
            if (!_loaded) return;
            if (WindowState != WindowState.Normal) return;
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.FloatingChatLeft = Left;
                settings.FloatingChatTop = Top;
                settings.FloatingChatWidth = Width;
                settings.FloatingChatHeight = Height;
                settings.Save();
            }
            catch { /* best-effort */ }
        }

        private void ForceTopmost()
        {
            // XAML Topmost="True" alone doesn't reliably stick against another top-level
            // window (e.g. a maximized app) that activates over it — re-assert HWND_TOPMOST
            // via Win32 on every deactivation without stealing focus. Same as DeviceCodeWindow.
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd != IntPtr.Zero)
                    SetWindowPos(hwnd, HwndTopmost, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
            }
            catch { /* best-effort */ }
        }
    }
}
