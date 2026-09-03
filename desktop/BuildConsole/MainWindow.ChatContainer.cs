using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2548 — MainWindow-side glue for the Chat Document Container: cross-epic question routing
    /// (§7) across open chat tabs, and refreshing the active tab's context bar. Each chat tab owns its
    /// own <see cref="Controls.ChatDocumentContainer"/> (stored on ChatTabState.Container), so drafts
    /// are per-tab by construction and cross-epic writes address a specific tab's composer.
    /// </summary>
    public partial class MainWindow
    {
        /// <summary>§7 — the other open chat tabs (excluding the asker), as cross-epic ask targets.</summary>
        public List<ChatEpicTarget> GetOtherOpenChatEpics(string excludeConversationId)
        {
            var result = new List<ChatEpicTarget>();
            foreach (var kvp in _chatTabs)
            {
                var state = kvp.Value;
                if (state.Container == null) continue;
                if (kvp.Key.Tag is not BoardChat chat) continue;
                if (!string.IsNullOrEmpty(excludeConversationId) &&
                    chat.ConversationId == excludeConversationId) continue;

                result.Add(new ChatEpicTarget
                {
                    ConversationId = chat.ConversationId ?? "",
                    EpicNumber = state.Container.EpicNumber,
                    EpicName = StripTabTitlePrefix(chat.Title),
                });
            }
            return result;
        }

        /// <summary>§7 step 3/6 — writes <paramref name="text"/> into the composer of the chat tab
        /// identified by <paramref name="conversationId"/> (never auto-sends), activating that tab so
        /// the write is visible. Returns false if that tab isn't open. This is how a cross-epic
        /// question lands in the DESTINATION composer and an answer lands back in the ORIGIN composer.</summary>
        public bool AppendToChatComposer(string conversationId, string text, string? returnAddress = null)
        {
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BoardChat chat && chat.ConversationId == conversationId &&
                    kvp.Value.Container != null)
                {
                    SelectTabInAnyPane(kvp.Key);
                    kvp.Value.Container.AppendToComposer(text, returnAddress);
                    return true;
                }
            }
            return false;
        }

        /// <summary>Refreshes the given chat tab's context bar (epic + counts + gauge) if it hosts a
        /// container. Called on tab selection so the bar reflects the tab you're actually on.</summary>
        private void RefreshChatContainerFor(TabItem tab)
        {
            if (_chatTabs.TryGetValue(tab, out var state))
                state.Container?.RefreshContext();
        }

        private void SelectTabInAnyPane(TabItem tab)
        {
            foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
            {
                if (pane != null && pane.Items.Contains(tab))
                {
                    pane.SelectedItem = tab;
                    return;
                }
            }
        }

        /// <summary>Strips a leading "[#N] " / "#N " issue prefix so a stamped title reads cleanly.</summary>
        private static string StripTabTitlePrefix(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return "";
            var t = title.Trim();
            if (t.StartsWith("[#"))
            {
                int close = t.IndexOf(']');
                if (close > 0 && close + 1 < t.Length) return t[(close + 1)..].Trim();
            }
            return t;
        }
    }
}
