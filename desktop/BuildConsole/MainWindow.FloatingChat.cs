using System;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2059 (Phase 1) / #2065 (Phase 2) — Floating Chat Window (#2035 Global Chat
    /// Drawer epic). MainWindow owns/launches the always-on-top floaty. Phase 2 lets it hold
    /// MORE THAN ONE chat at once: opening a chat while the floaty is already up adds a TAB
    /// (or brings that chat's existing tab forward) rather than replacing the window.
    /// </summary>
    public partial class MainWindow
    {
        private FloatingChatWindow? _floatingChatWindow;

        /// <summary>
        /// Opens the always-on-top floating chat window for <paramref name="chat"/>. If the
        /// floaty is already open, the chat is added as a new tab (or its existing tab is
        /// activated) — the Phase-2 multi-chat behavior. If it's not open yet, a fresh window
        /// is created with this chat as its first tab.
        /// </summary>
        public void OpenFloatingChatWindow(BoardChat chat)
        {
            if (chat == null || string.IsNullOrWhiteSpace(chat.ClaudeUrl))
            {
                ToastEngine.Error("Floating Chat", "This chat has no URL to open in a floating window yet.");
                return;
            }

            try
            {
                // Already open? Add this chat as a tab (or focus its existing tab).
                if (_floatingChatWindow != null && _floatingChatWindow.IsLoaded)
                {
                    _floatingChatWindow.AddOrActivateChat(chat);
                    _floatingChatWindow.Activate();
                    return;
                }

                // Git #2074 — deliberately NOT Owner = this. An owned window's
                // activation/z-order is coupled to its owner in WPF, which is why
                // interacting with the floaty was pulling MainWindow (and Build Watch,
                // also owned by MainWindow) into view — defeating the point of a
                // lightweight always-on-top window meant to stay out of the way.
                // ForceTopmost() already handles always-on-top independently via
                // SetWindowPos(HWND_TOPMOST). The only real behavior Owner provided that
                // still needs replacing is auto-close-with-app, so that's done explicitly
                // below via MainWindow's own Closed event instead.
                var win = new FloatingChatWindow(chat, this);
                win.Closed += (_, _) =>
                {
                    if (ReferenceEquals(_floatingChatWindow, win)) _floatingChatWindow = null;
                };
                this.Closed += (_, _) =>
                {
                    try { if (win.IsLoaded) win.Close(); } catch { }
                };
                _floatingChatWindow = win;
                win.Show();
                win.Activate();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.floating", $"failed to open floating chat window for {chat.ConversationId}: {ex.Message}");
                ToastEngine.Error("Floating Chat", $"Couldn't open the floating chat window: {ex.Message}");
            }
        }

        /// <summary>
        /// Git #2063 — routes <paramref name="text"/> to whatever chat is CURRENTLY ACTIVE, not
        /// necessarily the epic-linked chat: the floating chat window's active tab if one is
        /// open (both real usage patterns this exists for — the Dispatch box and the Git Board
        /// hover popover — fire right after Shane was just interacting with a chat there), else
        /// the main editor area's active Claude.ai tab via the existing #937/#940 injection.
        /// Reuses the SAME send+submit scripts #2059 already established (<see
        /// cref="FloatingChatBridgeScript.BuildInsertScript"/> / <see
        /// cref="FloatingChatBridgeScript.SubmitScript"/>) for both paths — no new bridge.
        /// Returns 'sent' | 'inserted-no-send' | 'no-composer' | 'no-active-chat' | 'error: …'
        /// so the caller can show an honest result rather than assuming success.
        /// </summary>
        public async System.Threading.Tasks.Task<string> SendToActiveChatAsync(string text)
        {
            if (_floatingChatWindow != null && _floatingChatWindow.IsLoaded)
                return await _floatingChatWindow.SendToActiveTabAsync(text);

            var (wv, tab) = GetActiveEditorTabWebView();
            if (wv?.CoreWebView2 == null) return "no-active-chat";

            string url = "";
            try { url = wv.Source?.ToString() ?? ""; } catch { }
            bool isClaudeChat = tab?.Tag is BoardChat || url.Contains("claude.ai", StringComparison.OrdinalIgnoreCase);
            if (!isClaudeChat) return "no-active-chat";

            string insert;
            try
            {
                string raw = await wv.ExecuteScriptAsync(FloatingChatBridgeScript.BuildInsertScript(text)) ?? "";
                insert = System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "";
            }
            catch (Exception ex)
            {
                ActivityLog.Log("dispatch", $"send-to-active-chat insert error: {ex.Message}");
                return "error: " + ex.Message;
            }
            if (insert != "inserted")
            {
                ActivityLog.Log("dispatch", $"send-to-active-chat insert failed: '{insert}' ({url})");
                return insert;
            }

            await System.Threading.Tasks.Task.Delay(220);
            try
            {
                string raw = await wv.ExecuteScriptAsync(FloatingChatBridgeScript.SubmitScript) ?? "";
                string submit = System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "";
                ActivityLog.Log("dispatch", submit == "sent"
                    ? $"send-to-active-chat sent ({url})"
                    : $"send-to-active-chat submit status '{submit}' ({url})");
                return submit;
            }
            catch (Exception ex)
            {
                ActivityLog.Log("dispatch", $"send-to-active-chat submit error: {ex.Message}");
                return "error: " + ex.Message;
            }
        }

        /// <summary>
        /// Git #2104 — posts <paramref name="text"/> into the SPECIFIC chat <paramref name="chat"/>
        /// identifies, opening/activating it in the floating window if it isn't already open
        /// (adding a tab rather than replacing, same as <see cref="OpenFloatingChatWindow"/>). Unlike
        /// <see cref="SendToActiveChatAsync"/> (#2063), which fires into whatever chat happens to be
        /// active, this is for a caller — the pinned-question resolve flow — that knows exactly which
        /// chat the reply belongs to and must not let it land in the wrong one. Reuses the same #2059
        /// send+submit bridge via <see cref="FloatingChatWindow.SendToChatAsync"/> — no new mechanism.
        /// </summary>
        public async System.Threading.Tasks.Task<string> SendToChatAsync(BoardChat chat, string text)
        {
            if (chat == null || string.IsNullOrWhiteSpace(chat.ClaudeUrl)) return "no-chat-url";

            if (_floatingChatWindow != null && _floatingChatWindow.IsLoaded)
                return await _floatingChatWindow.SendToChatAsync(chat, text);

            try
            {
                var win = new FloatingChatWindow(chat, this);
                var loadedTcs = new System.Threading.Tasks.TaskCompletionSource<bool>();
                RoutedEventHandler onLoaded = null!;
                onLoaded = (_, _) => { win.Loaded -= onLoaded; loadedTcs.TrySetResult(true); };
                win.Loaded += onLoaded;
                win.Closed += (_, _) =>
                {
                    if (ReferenceEquals(_floatingChatWindow, win)) _floatingChatWindow = null;
                };
                this.Closed += (_, _) =>
                {
                    try { if (win.IsLoaded) win.Close(); } catch { }
                };
                _floatingChatWindow = win;
                win.Show();
                win.Activate();
                await loadedTcs.Task;

                return await win.SendToChatAsync(chat, text);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.floating", $"pin-resolve: failed to open floating chat window for {chat.ConversationId}: {ex.Message}");
                return "error: " + ex.Message;
            }
        }
    }
}
