using System;
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
    /// Git #2059 — Floating Chat Window, Phase 1 of the #2035 Global Chat Drawer epic.
    ///
    /// A real WPF window OWNED/launched by BuildConsole (via
    /// <see cref="MainWindow.OpenFloatingChatWindow"/>), floating and always-on-top so it
    /// stays usable while Design / the M365 admin center / anything else has focus. It opens
    /// ONE chat at a time. Send/receive go through the EXISTING WebView2 → DOM-injection
    /// bridge already used for chat bridging in this app — this window does NOT invent a new
    /// mechanism: it hosts a real claude.ai <see cref="Controls.ChatSafeWebView2"/> (the same
    /// control every chat tab uses, sharing the same WebView2 environment/login via
    /// <see cref="MainWindow.EnsureWebViewInitializedAsync"/>) and drives it with
    /// <see cref="FloatingChatBridgeScript"/> — the composer-insert technique from
    /// StickyNotesComposerInsertScript (#937/#940) to SEND, and the context-meter's own
    /// selectors to RECEIVE the latest assistant reply, rendered as RichText via
    /// <see cref="MarkdownRenderer"/>.
    ///
    /// Explicitly OUT of scope for Phase 1 (deferred to later phases on #2035): tabs,
    /// side dock, progress/checklist extraction, screenshot paste, OCR, self-purging gallery.
    /// </summary>
    public partial class FloatingChatWindow : Window
    {
        private const string LogChannel = "chat.floating";

        private readonly BoardChat _chat;
        private readonly MainWindow? _owner;
        private readonly DispatcherTimer _saveDebounce;
        private Controls.ChatSafeWebView2? _wv;
        private bool _loaded;
        private bool _bridgeExpanded = true;
        private double _bridgeHeight = 170;
        private string? _lastMarkdown;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002;
        private const uint SwpNoSize = 0x0001;
        private const uint SwpNoActivate = 0x0010;

        public FloatingChatWindow(BoardChat chat, MainWindow? owner)
        {
            _chat = chat ?? throw new ArgumentNullException(nameof(chat));
            _owner = owner;
            InitializeComponent();

            HeaderTitle.Text = string.IsNullOrWhiteSpace(chat.Title) ? "Chat" : chat.Title;
            Title = HeaderTitle.Text;

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

            Loaded += async (s, e) =>
            {
                _loaded = true;
                ForceTopmost();
                await InitBridgeAsync();
            };
            Deactivated += (s, e) => ForceTopmost();
            LocationChanged += (s, e) => ScheduleSave();
            SizeChanged += (s, e) => ScheduleSave();
            Closed += (s, e) =>
            {
                try { _wv?.Dispose(); } catch { }
            };
        }

        // ── Bridge (WebView2 engine) ────────────────────────────────────────────
        private async System.Threading.Tasks.Task InitBridgeAsync()
        {
            try
            {
                _wv = new Controls.ChatSafeWebView2
                {
                    DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37)
                };
                BridgeHost.Child = _wv;

                bool ready = await MainWindow.EnsureWebViewInitializedAsync(_wv);
                if (!ready || _wv.CoreWebView2 == null)
                {
                    ShowInlineMessage("Couldn't start the chat bridge (WebView2 unavailable).", isError: true);
                    ActivityLog.Log(LogChannel, $"bridge-init-failed for chat {_chat.ConversationId}");
                    return;
                }

                // AddScriptToExecuteOnDocumentCreatedAsync MUST run before navigation
                // (Git #816) — a script added after nav starts only applies to the NEXT one.
                await _wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(FloatingChatBridgeScript.CaptureScript);
                _wv.WebMessageReceived -= Bridge_WebMessageReceived;
                _wv.WebMessageReceived += Bridge_WebMessageReceived;

                if (!string.IsNullOrWhiteSpace(_chat.ClaudeUrl))
                    _wv.CoreWebView2.Navigate(_chat.ClaudeUrl);
                else
                    ShowInlineMessage("This chat has no URL to open.", isError: true);

                ActivityLog.Log(LogChannel, $"opened floating chat window for {_chat.Title} ({_chat.ClaudeUrl})");
            }
            catch (Exception ex)
            {
                ShowInlineMessage("Chat bridge failed to start.", isError: true);
                ActivityLog.Log(LogChannel, $"bridge-init-error for chat {_chat.ConversationId}: {ex.Message}");
            }
        }

        private void Bridge_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
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
                if (typeEl.GetString() != "BT_FLOATY_RESPONSE") return;

                string md = root.TryGetProperty("markdown", out var mdEl) ? (mdEl.GetString() ?? "") : "";
                if (string.IsNullOrWhiteSpace(md) || md == _lastMarkdown) return;
                _lastMarkdown = md;
                RenderResponse(md);
            }
            catch { /* a malformed frame is not fatal — the next poll re-posts */ }
        }

        private void RenderResponse(string markdown)
        {
            var opts = new MarkdownRenderer.RenderOptions
            {
                GetBrush = key => (Brush)FindResource(key),
                OnUrlClick = url => { try { _owner?.OpenWebTab(url, "Web", ""); } catch { } },
                OnFileClick = _ => { /* Phase 1: no in-floaty file open */ },
            };
            try
            {
                ResponseHost.Content = MarkdownRenderer.Render(markdown, opts);
                EmptyHint.Visibility = Visibility.Collapsed;
                // Keep the freshest text in view as a reply streams in.
                ResponseScroll.ScrollToBottom();
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
            var text = InputBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                ShowInlineMessage("Nothing to send.", isError: true);
                return;
            }
            if (_wv?.CoreWebView2 == null)
            {
                ShowInlineMessage("Chat bridge isn't ready yet.", isError: true);
                return;
            }

            BtnSend.IsEnabled = false;
            try
            {
                string insert = await ExecScriptString(FloatingChatBridgeScript.BuildInsertScript(text));
                if (insert == "no-composer")
                {
                    ShowInlineMessage("Couldn't find the chat composer — is the conversation still loading?", isError: true);
                    ActivityLog.Log(LogChannel, $"send-failed: no-composer ({_chat.ConversationId})");
                    return;
                }
                if (insert != "inserted")
                {
                    ShowInlineMessage("Send failed while inserting the message.", isError: true);
                    ActivityLog.Log(LogChannel, $"send-failed: insert status '{insert}' ({_chat.ConversationId})");
                    return;
                }

                // Give claude.ai's Send button a tick to enable off the input event it
                // batches asynchronously, then submit as a separate call (ExecuteScriptAsync
                // does not await a Promise, so this can't be one round-trip).
                await System.Threading.Tasks.Task.Delay(220);
                string submit = await ExecScriptString(FloatingChatBridgeScript.SubmitScript);

                if (submit == "sent")
                {
                    InputBox.Clear();
                    ShowInlineMessage("Sent.", isError: false);
                    ActivityLog.Log(LogChannel, $"sent message to chat {_chat.ConversationId}");
                }
                else if (submit == "inserted-no-send")
                {
                    // The text is in the composer but the submit didn't take — leave the
                    // input so nothing is lost; Shane can press Send again or submit in-page.
                    ShowInlineMessage("Message inserted but couldn't auto-send — try Send again, or press Enter in the page below.", isError: true);
                    ActivityLog.Log(LogChannel, $"send-partial: inserted-no-send ({_chat.ConversationId})");
                }
                else
                {
                    ShowInlineMessage("Send failed while submitting.", isError: true);
                    ActivityLog.Log(LogChannel, $"send-failed: submit status '{submit}' ({_chat.ConversationId})");
                }
            }
            catch (Exception ex)
            {
                ShowInlineMessage("Send failed.", isError: true);
                ActivityLog.Log(LogChannel, $"send-error ({_chat.ConversationId}): {ex.Message}");
            }
            finally
            {
                BtnSend.IsEnabled = true;
            }
        }

        private async System.Threading.Tasks.Task<string> ExecScriptString(string js)
        {
            if (_wv?.CoreWebView2 == null) return "error: no-webview";
            string raw = await _wv.CoreWebView2.ExecuteScriptAsync(js) ?? "";
            try { return JsonSerializer.Deserialize<string>(raw) ?? ""; }
            catch { return raw; }
        }

        // ── Chrome / window plumbing ─────────────────────────────────────────────
        public void ShowInlineMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "RedBrush" : "GreenBrush");
            InlineMessage.Visibility = Visibility.Visible;
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
