using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using ShaneBuilder.Services;

namespace ShaneBuilder;

/// <summary>
/// Git #2325 (Feature #2318 item 9) — real content for the CHATS rail panel (was a static "No
/// chats yet" placeholder that never rendered anything, per the real audit in
/// <c>build-journal/2325.md</c>): one row per open chat tab with a real DOM-derived context-size
/// badge, plus Dismiss (Git #2471) for the tab and Reopen/Delete for the chat archive.
///
/// Context-size reading: <see cref="ChatContextMeterScript"/> is injected into each keep-alive
/// tab's own WebView2 (Git #2470 replaced the single shared <c>ClaudeWebView</c> with one live view
/// per chat tab — see MainWindow.KeepAliveTabs.cs) and reports real per-conversation transcript
/// stats via <c>window.chrome.webview.postMessage</c>. Each reading is attributed to the tab that
/// actually posted it (<see cref="OnKeepAliveChatStats"/>), so <see cref="_chatContextByTabId"/> is
/// genuinely per-tab. A tab that has never finished loading its view still shows "not read yet"
/// rather than a stale or fabricated number.
///
/// Git #2471 replaced the old ArchiveChatTab (which conflated "record this chat's identity into
/// <see cref="ChatArchiveStore"/>" with "reset THIS tab's own view to a fresh chat," never
/// actually leaving the tab strip — a correct no-op only under the old one-persistent-chat-tab
/// model) with two real, distinct actions: this row's Dismiss button parks the tab (and its live
/// keep-alive WebView2) alive, out of the strip, restorable from the workspace box
/// (MainWindow.DismissedTabs.cs); Close (the tab's own ×/context menu) is the real kill, and is
/// now what records the chat's identity into ChatArchiveStore — see
/// <c>RecordChatArchiveIfNeeded</c> — at the point its session actually ends, so the old
/// #2323-exposed gap (an archived secondary tab left dangling in <c>_tabs</c>, #2465) can't
/// reproduce: a dismissed tab never left <c>_tabs</c> to begin with, and a closed tab is removed
/// for real.
/// </summary>
public partial class MainWindow
{
    /// <summary>One tab's last-known real context reading, keyed by <c>TabDef.Id</c>. Written by
    /// <see cref="OnKeepAliveChatStats"/> for the tab that actually posted the reading — Git #2470
    /// gave each keep-alive tab its own WebView2, so this is now genuinely per-tab, not "whichever
    /// tab is currently active in the one shared WebView."</summary>
    private sealed class ChatContextStat
    {
        public double EstCharCount;
        public int TurnCount;
        public bool SelectorsLikelyStale;
    }

    private readonly Dictionary<string, ChatContextStat> _chatContextByTabId = new();

    // ── DOM-derived transcript stats (real, off Services.ChatContextMeterScript) ────────────────

    /// <summary>Git #2470 — the #2325 context-meter pump, now keyed to the SENDING tab, not
    /// <c>_activeChatTab</c>. Each keep-alive tab owns its own live WebView2 (parked off-screen when
    /// inactive but still running the injected meter script), so a parked tab can post
    /// SB_CHAT_STATS at any time — attributing that to whatever tab happens to be active would
    /// cross-contaminate the badges. The per-view wiring in WireKeepAliveViewAsync captures each
    /// tab's own id and passes it here, so every reading lands under the tab it actually came
    /// from.</summary>
    private void OnKeepAliveChatStats(string tabId, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            string? json = e.TryGetWebMessageAsString();
            if (string.IsNullOrEmpty(json)) return;
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var root = doc.RootElement;
            string type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";
            if (type != "SB_CHAT_STATS") return;

            string? Str(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
            int Int(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt32() : 0;
            bool Bool(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.True;

            var activeTab = _tabs.Find(t2 => t2.Id == tabId && t2.IsChat);
            if (activeTab == null) return; // the tab was closed out from under this in-flight message

            double charCount = Int("charCount");
            int turnCount = Int("turnCount");
            string? conversationId = Str("conversationId");

            // Git #1628 (ported) — clamp/persist to the per-conversation high-water so a
            // mid-render/streaming poll can never drag a row's badge back down, and so reopening
            // the same conversation later restores its last-known reading.
            if (!string.IsNullOrEmpty(conversationId))
            {
                var hw = ChatContextMeterStore.Merge(conversationId, charCount, turnCount);
                charCount = hw.EstCharCount;
                turnCount = hw.TurnCount;
            }

            _chatContextByTabId[activeTab.Id] = new ChatContextStat
            {
                EstCharCount = charCount,
                TurnCount = turnCount,
                SelectorsLikelyStale = Bool("selectorsLikelyStale")
            };

            // The composer gauge reflects the ACTIVE tab only; a parked tab's reading updates its
            // row badge (RenderChatsPanel below) but must not repaint the active gauge with data
            // from a different conversation.
            if (_activeChatTab?.Id == activeTab.Id) UpdateContextGauge();
            if (_leftPanelSource == "Chat") RenderChatsPanel();
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.context] message handling failed: {ex.Message}");
        }
    }

    private enum ContextTier { Unread, Normal, Warning, Critical, Stale }

    /// <summary>Same 300k window <see cref="ContextWindowTokens"/> already uses; tiers are fractions
    /// of it (60% / 85%) rather than new invented numbers.</summary>
    private ContextTier TierFor(ChatContextStat? stat)
    {
        if (stat == null) return ContextTier.Unread;
        if (stat.SelectorsLikelyStale) return ContextTier.Stale;
        double estTokens = FixedOverheadTokens + stat.EstCharCount * TokensPerChar;
        double frac = estTokens / ContextWindowTokens;
        if (frac >= 0.85) return ContextTier.Critical;
        if (frac >= 0.60) return ContextTier.Warning;
        return ContextTier.Normal;
    }

    private (Brush Fg, string Label) TierVisual(ContextTier tier, ChatContextStat? stat) => tier switch
    {
        ContextTier.Critical => ((Brush)FindResource("Brush.Toast.Error"), $"≈{EstTokensK(stat)}k — very long, consider archiving"),
        ContextTier.Warning => ((Brush)FindResource("Brush.Toast.Warning"), $"≈{EstTokensK(stat)}k — getting long"),
        ContextTier.Normal => ((Brush)FindResource("Brush.Toast.Success"), $"≈{EstTokensK(stat)}k"),
        ContextTier.Stale => ((Brush)FindResource("Brush.Text.Dim"), "size unreadable (DOM selectors stale)"),
        _ => ((Brush)FindResource("Brush.Text.Dim"), "not read yet"),
    };

    private int EstTokensK(ChatContextStat? stat) =>
        stat == null ? 0 : (int)Math.Round((FixedOverheadTokens + stat.EstCharCount * TokensPerChar) / 1000.0);

    // ── Panel rendering ──────────────────────────────────────────────────────────────────────

    private void RenderChatsPanel()
    {
        // Git #2471 — a dismissed chat tab stays in _tabs (parked alive, not removed) but no
        // longer counts as "open"; it shows up under DISMISSED TABS in the workspace box
        // instead (MainWindow.DismissedTabs.cs), not here.
        var openChats = _tabs.Where(t => t.IsChat && !_dismissedTabIds.Contains(t.Id)).ToList();
        ChatsPanelStatus.Text = openChats.Count == 0
            ? "No chats yet. Chats you open will show up here."
            : $"{openChats.Count} open chat{(openChats.Count == 1 ? "" : "s")}.";

        ChatsPanelOpenRows.Children.Clear();
        foreach (var tab in openChats)
            ChatsPanelOpenRows.Children.Add(BuildChatRow(tab));

        var archived = ChatArchiveStore.GetAll();
        ChatsPanelArchivedHeader.Visibility = archived.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        ChatsPanelArchivedRows.Children.Clear();
        foreach (var chat in archived)
            ChatsPanelArchivedRows.Children.Add(BuildArchivedChatRow(chat));
    }

    private Border BuildChatRow(TabDef tab)
    {
        bool active = tab.Id == _activeTabId;
        _chatContextByTabId.TryGetValue(tab.Id, out var stat);
        var tier = TierFor(stat);
        var (fg, label) = TierVisual(tier, stat);

        var row = new Border
        {
            Margin = new Thickness(0, 0, 0, 4),
            Padding = new Thickness(8, 6, 8, 6),
            CornerRadius = new CornerRadius(6),
            Background = active ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
            Cursor = Cursors.Hand
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        if (tab.Dot != null)
        {
            titleStack.Children.Add(new Ellipse
            {
                Width = 7, Height = 7, Fill = tab.Dot, Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            });
        }
        titleStack.Children.Add(new TextBlock
        {
            Text = tab.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            FontWeight = active ? (FontWeight)FindResource("FontWeight.SemiBold") : (FontWeight)FindResource("FontWeight.Regular"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"),
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        var left = new StackPanel();
        left.Children.Add(titleStack);

        // Git #2323 — the real anchor picked in OpenNewChatFlow's disclosure (or the honest
        // "decide later" unanchored state), carried on TabDef.Subtitle. Null for the seed tab and
        // any chat that predates the anchor flow — no line at all rather than a fabricated one.
        if (tab.Subtitle != null)
        {
            left.Children.Add(new TextBlock
            {
                Text = tab.Subtitle,
                Margin = new Thickness(13, 2, 0, 0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
                FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = tab.Subtitle
            });
        }

        left.Children.Add(new TextBlock
        {
            Text = label,
            Margin = new Thickness(13, 2, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = fg,
            ToolTip = stat == null
                ? "This chat hasn't been open in this session — its size hasn't been read yet."
                : $"~{stat.TurnCount} turn(s), ~{EstTokensK(stat)}k tokens / {ContextWindowTokens / 1000}k window"
        });
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        // Git #2471 — "Archive" used to conflate recording this chat's identity with resetting
        // THIS tab's own view in place, never actually leaving the strip. Dismiss now does the
        // real thing: park the tab (and its live keep-alive WebView2) alive, out of the strip,
        // restorable from the workspace box. Close (still reachable off the tab's own ×/context
        // menu) is what now records the ChatArchiveStore identity, at the point the session
        // actually ends.
        var dismissBtn = new TextBlock
        {
            Text = "Dismiss",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            Cursor = Cursors.Hand
        };
        dismissBtn.MouseLeftButtonDown += (s, e) => { e.Handled = true; DismissTab(tab.Id); };
        dismissBtn.MouseEnter += (s, e) => dismissBtn.Foreground = (Brush)FindResource("Brush.Text.Heading");
        dismissBtn.MouseLeave += (s, e) => dismissBtn.Foreground = (Brush)FindResource("Brush.Text.Dim");
        Grid.SetColumn(dismissBtn, 1);
        grid.Children.Add(dismissBtn);

        row.Child = grid;
        row.MouseLeftButtonDown += (s, e) => SelectTab(tab.Id);
        return row;
    }

    private Border BuildArchivedChatRow(ArchivedChat chat)
    {
        var row = new Border
        {
            Margin = new Thickness(0, 0, 0, 4),
            Padding = new Thickness(8, 6, 8, 6),
            CornerRadius = new CornerRadius(6),
            Background = Brushes.Transparent
        };

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        string sizeLabel = chat.LastEstCharCount.HasValue
            ? $"≈{(int)Math.Round((FixedOverheadTokens + chat.LastEstCharCount.Value * TokensPerChar) / 1000.0)}k"
            : "size unknown";

        var left = new StackPanel();
        left.Children.Add(new TextBlock
        {
            Text = chat.EpicNumber.HasValue ? $"#{chat.EpicNumber} {chat.Title}" : chat.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.11"),
            Foreground = (Brush)FindResource("Brush.Text.Muted"),
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        left.Children.Add(new TextBlock
        {
            Text = $"Archived {chat.ArchivedAtUtc.ToLocalTime():MMM d, h:mm tt} — {sizeLabel}",
            Margin = new Thickness(0, 2, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var reopenBtn = new TextBlock
        {
            Text = "Reopen",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Accent.IssueNum"),
            Cursor = Cursors.Hand
        };
        reopenBtn.MouseLeftButtonDown += (s, e) => { e.Handled = true; ReopenArchivedChat(chat); };
        Grid.SetColumn(reopenBtn, 1);
        grid.Children.Add(reopenBtn);

        var deleteBtn = new TextBlock
        {
            Text = "Delete",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Alert.Danger.Border"),
            Cursor = Cursors.Hand
        };
        deleteBtn.MouseLeftButtonDown += (s, e) => { e.Handled = true; DeleteArchivedChat(chat.Id); };
        Grid.SetColumn(deleteBtn, 2);
        grid.Children.Add(deleteBtn);

        row.Child = grid;
        return row;
    }

    // ── Actions ──────────────────────────────────────────────────────────────────────────────
    //
    // Git #2471 — Dismiss and Close (the real, distinct replacements for the old ArchiveChatTab)
    // live in MainWindow.DismissedTabs.cs / MainWindow.xaml.cs's CloseTab, since both are generic
    // tab-lifecycle actions, not chat-specific ones. What's left here is chat-specific: browsing
    // and reopening what CloseTab has recorded into ChatArchiveStore.

    private void ReopenArchivedChat(ArchivedChat chat)
    {
        // Git #2470 — reopen into the active chat tab's own live keep-alive view.
        var wv = ActiveChatWebView;
        if (wv == null)
        {
            ToastEngine.Show("Reopen chat", "Open a chat tab first, then reopen the archived conversation into it.", ToastKind.Info);
            return;
        }
        try
        {
            wv.Source = new Uri(chat.ConversationUrl);
        }
        catch (Exception ex)
        {
            ToastEngine.Show("Reopen chat", $"Couldn't navigate there: {ex.Message}", ToastKind.Error);
            return;
        }

        // The reopened conversation's real reading (re-read off the DOM) will replace this the
        // moment the script's next poll tick reports it — this is only an honest interim label.
        if (_activeChatTab != null && chat.LastEstCharCount.HasValue)
        {
            _chatContextByTabId[_activeChatTab.Id] = new ChatContextStat
            {
                EstCharCount = chat.LastEstCharCount.Value,
                TurnCount = chat.LastTurnCount ?? 0
            };
            UpdateContextGauge();
        }

        ChatArchiveStore.Remove(chat.Id);
        if (_leftPanelSource == "Chat") RenderChatsPanel();
    }

    private void DeleteArchivedChat(string id)
    {
        ChatArchiveStore.Remove(id);
        if (_leftPanelSource == "Chat") RenderChatsPanel();
    }
}
