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
/// Git #2471 (phase 2 of Feature #2469 — Multi-Tab Lifecycle) — Dismiss (park alive) vs.
/// Close (real kill), replacing the old <c>ArchiveChatTab</c>'s conflated "record identity to
/// ChatArchiveStore, then reset THIS tab's own view to a fresh chat" behavior. That reset was
/// a correct no-op under the old one-persistent-chat-tab model; it stopped being correct once
/// #2470 gave every keep-alive tab its own real WebView2 and #2323 let more than one chat tab
/// be open at a time — the tab never actually left the strip or the active session, and
/// #2465's orphan bug (an archived secondary tab stays in <c>_tabs</c> pointing at nothing)
/// traces straight back to that half-migration.
///
/// This is a DIRECT GENERALIZATION of the per-workspace Dismiss/Restore mechanism ShaneBuilder
/// already has (<c>_stashedWorkspaces</c> / <c>WorkspaceBoxPopup</c>, MainWindow.xaml.cs) down
/// to individual tabs — NOT a new mechanism, and not BuildConsole's separate Shelf
/// implementation (MainWindow.ShelvedTabs.cs) either, which pulls a TabItem's WPF content out
/// of a TabControl; ShaneBuilder's tab strip is TabDef-driven, not TabControl-based, so the
/// existing stash pattern (filter a strip render, list the hidden entries in the SAME popout,
/// restore is a plain un-filter) is the one already proven here. The workspace box's own
/// tooltip and DISMISSED WORKSPACES rows are unchanged; this file only adds a second,
/// tab-granular section to the same popout.
///
/// - Dismiss: the tab is filtered out of <see cref="RenderTabStrip"/> (never removed from
///   <c>_tabs</c> — same design as a stashed workspace) and listed under DISMISSED TABS in
///   <c>WorkspaceBoxPopup</c>. A keep-alive tab's WebView2 (#2470) is PARKED off-screen alive
///   via <c>ParkKeepAliveView</c>, never reset/disposed — restoring is a plain reflow back into
///   the strip, no reload. A reloadable tab has no live session to preserve, so dismissing one
///   is just the strip filter; restoring re-enters <see cref="SelectTab"/>'s normal per-kind
///   load path (e.g. <c>LoadMarkdownViewerTab</c> re-reads the file from disk — nothing was
///   kept "warm" because there was nothing warm to keep). Home is never dismissible — it is
///   the fixed anchor every dismiss/close fallback already returns to.
/// - Close: unchanged real-kill behavior in <c>CloseTab</c> (MainWindow.xaml.cs) — this file
///   only adds the ChatArchiveStore recording that behavior needs (see
///   <see cref="RecordChatArchiveIfNeeded"/>), now correctly keyed to the CLOSING tab's own
///   tracked URL instead of the old ArchiveChatTab's global <c>_currentConversationUrl</c>,
///   which was silently wrong for any tab other than the currently-active one — a chat closed
///   from the Chats panel row, or as part of "Close Others", would have archived the ACTIVE
///   tab's conversation URL, not its own. That bug never manifested because ArchiveChatTab was
///   only ever reachable in a state where the two happened to be the same tab; Close is
///   reachable from any tab, so it needed the real per-tab source of truth.
///
/// Isolated in its own partial-class file (same pattern MainWindow.KeepAliveTabs.cs and
/// desktop/BuildConsole/MainWindow.ShelvedTabs.cs both use) to stay out of the way of the
/// concurrently-edited MainWindow.xaml.cs.
/// </summary>
public partial class MainWindow
{
    // Dismissed tab ids — the tab itself STAYS in _tabs (same design as _stashedWorkspaces),
    // just filtered out of the rendered strip. This is what makes restore a plain un-filter
    // rather than a re-add-and-hope-nothing-else-changed.
    private readonly HashSet<string> _dismissedTabIds = new();

    /// <summary>Dismiss: leave the visible tab strip, keep the tab (and its keep-alive
    /// WebView2, if any) genuinely alive, list it under DISMISSED TABS in the workspace box.
    /// A no-op for Home or an already-dismissed tab.</summary>
    private void DismissTab(string id)
    {
        var tab = _tabs.Find(t => t.Id == id);
        if (tab == null || tab.IsHome || !_dismissedTabIds.Add(id)) return;

        // A tab that wasn't already the active/mounted one is already parked (ShowKeepAliveTab
        // only ever mounts the active keep-alive tab and parks every other) — this covers the
        // case where the tab being dismissed WAS the one currently mounted.
        if (tab.IsKeepAlive && _keepAliveViews.TryGetValue(id, out var kav))
            ParkKeepAliveView(kav);

        // Same fallback StashWorkspace already uses for a workspace that owned the active tab:
        // always Home, never a guess at "the next reasonable tab."
        if (_activeTabId == id)
            SelectTab(_tabs.First(t => t.IsHome).Id);
        else
            RenderTabStrip();

        RenderWorkspaceBox();
        if (_leftPanelSource == "Chat") RenderChatsPanel();
        ToastEngine.Show("Dismissed", $"\"{tab.Title}\" parked — restore it from the workspace box.", ToastKind.Info);
        Services.ConsoleOutputSink.Log(Services.LogLevel.Info,
            $"[tabs.dismiss] dismissed: {tab.Title} ({tab.Id}); {_dismissedTabIds.Count} tab(s) dismissed");
    }

    /// <summary>Restore a dismissed tab: un-filter it and select it. SelectTab's normal
    /// per-kind path takes it from there — ShowKeepAliveTab reflows the still-live parked view
    /// (no reload) for a keep-alive tab, or the reloadable tab's own load path re-renders it,
    /// same as opening it fresh. Also un-stashes/un-collapses its workspace (SelectTab already
    /// does this for a normal open) so a tab dismissed while its whole workspace was ALSO
    /// stashed doesn't restore invisible.</summary>
    private void RestoreDismissedTab(string id)
    {
        if (!_dismissedTabIds.Remove(id)) return;
        var tab = _tabs.Find(t => t.Id == id);
        if (tab == null)
        {
            // Shouldn't happen — a dismissed tab is never removed from _tabs — but stay honest
            // about state rather than silently leaving a dangling dismissed-id entry.
            RenderWorkspaceBox();
            return;
        }

        SelectTab(id);
        RenderWorkspaceBox();
        if (_leftPanelSource == "Chat") RenderChatsPanel();
        Services.ConsoleOutputSink.Log(Services.LogLevel.Info, $"[tabs.dismiss] restored: {tab.Title} ({tab.Id})");
    }

    /// <summary>Close a dismissed tab straight from the workspace box, without restoring it to
    /// the strip first — the real kill (ChatArchiveStore recording if it's a chat, tear down
    /// its keep-alive view and terminal sessions for real, drop it from <c>_tabs</c>
    /// permanently). Dismiss only ever parks; this is the one path that actually ends the
    /// session for a tab that's currently sitting dismissed.</summary>
    private void CloseDismissedTab(string id)
    {
        if (!_dismissedTabIds.Remove(id)) return;
        int idx = _tabs.FindIndex(t => t.Id == id);
        if (idx < 0) { RenderWorkspaceBox(); return; }
        var tab = _tabs[idx];

        RecordChatArchiveIfNeeded(tab);
        DisposeTerminalSessionsForTab(id);
        DisposeKeepAliveView(id);
        _tabs.RemoveAt(idx);

        RenderWorkspaceBox();
        if (_leftPanelSource == "Chat") RenderChatsPanel();
        Services.ConsoleOutputSink.Log(Services.LogLevel.Info, $"[tabs.dismiss] closed from dismissed: {tab.Title} ({tab.Id})");
    }

    /// <summary>The real Close-time replacement for what ArchiveChatTab used to do: record a
    /// closing chat tab's identity + last-known size into ChatArchiveStore so it's still
    /// findable/reopenable (by URL, via ReopenArchivedChat) after its live session is gone for
    /// real. Keyed to THIS tab's own tracked keep-alive URL, not the shared
    /// <c>_currentConversationUrl</c> — that field only reflects whichever tab is currently
    /// active, which is wrong for a tab being closed from the Chats panel row or via "Close
    /// Others" while a different tab is active. No-op for a non-chat tab or one with no
    /// resolvable URL (never navigated).</summary>
    private void RecordChatArchiveIfNeeded(TabDef tab)
    {
        if (!tab.IsChat) return;

        string? url = _keepAliveViews.TryGetValue(tab.Id, out var kav)
            ? kav.CurrentUrl
            : (tab.Id == _activeChatTab?.Id ? _currentConversationUrl : null);
        if (string.IsNullOrEmpty(url)) return;

        _chatContextByTabId.TryGetValue(tab.Id, out var stat);
        ChatArchiveStore.Add(tab.Title, tab.EpicNumber, url, stat?.EstCharCount, stat?.TurnCount);
        _chatContextByTabId.Remove(tab.Id);
    }

    // ── Workspace box UI — DISMISSED TABS section (appended after the existing DISMISSED
    // WORKSPACES rows in the same popout, built by RenderWorkspaceBox in MainWindow.xaml.cs) ──

    /// <summary>Build the DISMISSED TABS header + one row per dismissed tab. Called from
    /// RenderWorkspaceBox, which owns clearing/rebuilding WorkspaceBoxPanelList and the
    /// BtnWorkspaceBox visibility toggle.</summary>
    private void AppendDismissedTabRows(StackPanel host)
    {
        if (_dismissedTabIds.Count == 0) return;

        host.Children.Add(new TextBlock
        {
            Text = "DISMISSED TABS",
            Margin = new Thickness(4, host.Children.Count > 0 ? 10 : 4, 4, 4),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 9,
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
            Foreground = (Brush)FindResource("Brush.Text.Dim")
        });

        foreach (var id in _dismissedTabIds.ToList())
        {
            var tab = _tabs.Find(t => t.Id == id);
            if (tab == null) continue; // stale id (shouldn't happen) — skip rather than fake a row
            host.Children.Add(BuildDismissedTabRow(tab));
        }
    }

    private Border BuildDismissedTabRow(TabDef tab)
    {
        var accent = tab.Dot ?? (Brush)FindResource("Brush.Accent.Primary");

        var row = new Grid { Margin = new Thickness(4, 4, 4, 4) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(new Ellipse { Width = 8, Height = 8, Margin = new Thickness(0, 0, 8, 0), Fill = accent });
        left.Children.Add(new TextBlock
        {
            Text = tab.Title,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 11,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Text.Heading"),
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = 120
        });
        Grid.SetColumn(left, 0);
        row.Children.Add(left);

        var restore = new TextBlock
        {
            Text = "Restore",
            Cursor = Cursors.Hand,
            Margin = new Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 10.5,
            FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
            Foreground = (Brush)FindResource("Brush.Accent.IssueNum")
        };
        var capturedId = tab.Id;
        restore.MouseLeftButtonDown += (s, e) => { e.Handled = true; RestoreDismissedTab(capturedId); WorkspaceBoxPopup.IsOpen = false; };
        Grid.SetColumn(restore, 1);
        row.Children.Add(restore);

        var close = new TextBlock
        {
            Text = "Close",
            Cursor = Cursors.Hand,
            Margin = new Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"),
            FontSize = 10.5,
            Foreground = (Brush)FindResource("Brush.Alert.Danger.Border")
        };
        close.MouseLeftButtonDown += (s, e) => { e.Handled = true; CloseDismissedTab(capturedId); };
        Grid.SetColumn(close, 2);
        row.Children.Add(close);

        return new Border { Child = row };
    }
}
