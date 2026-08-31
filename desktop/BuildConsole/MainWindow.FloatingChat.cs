using System;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2059 — Floating Chat Window (Phase 1 of the #2035 Global Chat Drawer epic).
    /// MainWindow owns/launches the always-on-top single-chat floaty; Phase 1 keeps ONE
    /// open at a time (opening a different chat replaces it), matching the issue's
    /// explicit single-chat scope.
    /// </summary>
    public partial class MainWindow
    {
        private FloatingChatWindow? _floatingChatWindow;

        /// <summary>
        /// Opens (or re-points) the always-on-top floating window for <paramref name="chat"/>.
        /// Phase 1 opens ONE chat at a time — an already-open floaty is closed first so a new
        /// one takes its place, rather than accumulating windows (tabs are a later phase).
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
                // Same chat already floating? Just bring it forward.
                if (_floatingChatWindow != null && _floatingChatWindow.IsLoaded)
                {
                    _floatingChatWindow.Activate();
                    if (ReferenceEquals(_floatingChatWindow.Tag, chat.ConversationId))
                        return;
                    _floatingChatWindow.Close();
                    _floatingChatWindow = null;
                }

                var win = new FloatingChatWindow(chat, this)
                {
                    Owner = this,
                    Tag = chat.ConversationId
                };
                win.Closed += (_, _) =>
                {
                    if (ReferenceEquals(_floatingChatWindow, win)) _floatingChatWindow = null;
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
