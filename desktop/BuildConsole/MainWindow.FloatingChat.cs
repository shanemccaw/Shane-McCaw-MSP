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
    }
}
