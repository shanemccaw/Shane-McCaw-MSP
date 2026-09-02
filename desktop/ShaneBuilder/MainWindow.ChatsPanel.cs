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
/// badge, plus Archive/Reopen/Delete for the chat archive.
///
/// Context-size reading: <see cref="ChatContextMeterScript"/> is injected into the shared
/// <c>ClaudeWebView</c> (single WebView2 reused across chat tabs — see <c>_activeChatTab</c> in
/// MainWindow.xaml.cs §11) and reports real per-conversation transcript stats via
/// <c>window.chrome.webview.postMessage</c>. Because only the ACTIVE tab's conversation is ever
/// actually mounted in that shared WebView, <see cref="_chatContextByTabId"/> only ever gets a
/// live update for whichever tab is currently open — that's an honest limitation of the
/// single-WebView architecture, not a bug: a tab never shown this session has genuinely never been
/// read, and its row says so rather than showing a stale or fabricated number.
///
/// Archive: "Archive" here means: record this chat's identity and last known size into
/// <see cref="ChatArchiveStore"/>, then reset the shared WebView to a fresh chat — the same
/// navigation <c>BtnStartNewChat_Click</c>/<c>OpenNewChatFlow</c> already use — so nothing is
/// silently lost and the old conversation can be found and reopened from the ARCHIVED section.
/// Git #2323 made <c>OpenNewChatFlow</c> create a genuine new <c>TabDef</c> per chat instead of
/// always reusing the one seed tab — Archive's own tab-strip cleanup for that multi-tab case (does
/// archiving a secondary tab remove it, vs. reset-in-place like the seed tab always has?) is a real
/// gap this exposed, filed separately rather than redesigned here (see build-journal/2323.md).
/// </summary>
public partial class MainWindow
{
    /// <summary>One tab's last-known real context reading, keyed by <c>TabDef.Id</c>. Only ever
    /// written by <see cref="ClaudeWebView_WebMessageReceived"/> for whichever tab is currently
    /// active in the shared WebView.</summary>
    private sealed class ChatContextStat
    {
        public double EstCharCount;
        public int TurnCount;
        public bool SelectorsLikelyStale;
    }

    private readonly Dictionary<string, ChatContextStat> _chatContextByTabId = new();

    // ── DOM-derived transcript stats (real, off Services.ChatContextMeterScript) ────────────────

    private void ClaudeWebView_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
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

            var activeTab = _activeChatTab;
            if (activeTab == null) return; // the WebView isn't behind a chat document right now

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

            UpdateContextGauge();
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
        var openChats = _tabs.Where(t => t.IsChat).ToList();
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

        var archiveBtn = new TextBlock
        {
            Text = "Archive",
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(8, 0, 0, 0),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = (double)FindResource("FontSize.10.5"),
            Foreground = (Brush)FindResource("Brush.Text.Dim"),
            Cursor = Cursors.Hand
        };
        archiveBtn.MouseLeftButtonDown += (s, e) => { e.Handled = true; ArchiveChatTab(tab.Id); };
        archiveBtn.MouseEnter += (s, e) => archiveBtn.Foreground = (Brush)FindResource("Brush.Text.Heading");
        archiveBtn.MouseLeave += (s, e) => archiveBtn.Foreground = (Brush)FindResource("Brush.Text.Dim");
        Grid.SetColumn(archiveBtn, 1);
        grid.Children.Add(archiveBtn);

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

    /// <summary>Records this tab's chat into the archive (identity + last-known size), then resets
    /// the shared WebView to a fresh chat — same navigation as <c>OpenNewChatFlow</c>. Doesn't
    /// remove the tab: with exactly one persistent chat tab in the app today, "closing" it would
    /// reset the whole app to Home (per <c>CloseTab</c>'s empty-tabs branch), which is not what
    /// archiving a chat should do.</summary>
    private void ArchiveChatTab(string tabId)
    {
        var tab = _tabs.Find(t => t.Id == tabId && t.IsChat);
        if (tab == null) return;

        _chatContextByTabId.TryGetValue(tabId, out var stat);
        ChatArchiveStore.Add(tab.Title, tab.EpicNumber, _currentConversationUrl, stat?.EstCharCount, stat?.TurnCount);
        _chatContextByTabId.Remove(tabId);

        try
        {
            ClaudeWebView.Source = new Uri("https://claude.ai/new");
        }
        catch (Exception ex)
        {
            Services.ConsoleOutputSink.Log(Services.LogLevel.Warn, $"[chat.archive] reset-to-new failed: {ex.Message}");
        }

        ToastEngine.Show("Chat archived", $"\"{tab.Title}\" moved to Archived. Started a fresh chat.", ToastKind.Info);
        if (tab.Id == _activeChatTab?.Id) UpdateContextGauge();
        if (_leftPanelSource == "Chat") RenderChatsPanel();
    }

    private void ReopenArchivedChat(ArchivedChat chat)
    {
        try
        {
            ClaudeWebView.Source = new Uri(chat.ConversationUrl);
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
