using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Editor tab "Shelve" — Shane: set any open editor tab (Claude chat, manifest
    /// viewer, a web tool, anything) aside so it stops eating tab-bar space, WITHOUT
    /// killing it. The tab vanishes from the visible tab bar but its real content
    /// keeps running genuinely alive in the background; a "Shelf" popout (opened from
    /// the Shelf activity-bar icon) lists everything currently shelved, each entry
    /// one click away from coming back as a real tab — resuming the exact same live
    /// session, never a reload.
    ///
    /// This is a DIRECT GENERALIZATION of the #972/#982 pinned-tab keep-alive, NOT a
    /// second mechanism. It reuses the very same primitives from
    /// <see cref="MainWindow.PinnedTabs"/> (same partial class): the shelved content
    /// lives permanently in <c>PinnedHostCanvas</c> (the off-screen overlay canvas
    /// over the editor panes) and is parked via <see cref="ParkOffscreen"/> — shrunk
    /// to 1×1 and moved to (-20000,-20000) at z-index 0. That 1×1 size is the
    /// load-bearing #982 fix: a WebView2 is an HwndHost whose surface only reliably
    /// leaves view on a SIZE change (z-order can't occlude an HwndHost), and 1×1 is
    /// nonzero so CoreWebView2 is never torn down — the session stays warm/logged in.
    /// Where Pin fronts its live content with an always-visible strip item / header
    /// chip that expands it back OVER the panes, Shelve deliberately never expands
    /// over the panes at all: a shelved item is only ever restored back into the tab
    /// bar. So a shelved item can never visually interfere with the active tab — it
    /// sits parked 1×1 off-screen the entire time, on the non-hit-testable canvas.
    ///
    /// Isolated in its own partial-class file (same #893/#894/#921 pattern the pinned
    /// feature uses) to stay out of the way of the concurrently-edited MainWindow.xaml.cs.
    /// </summary>
    public partial class MainWindow
    {
        private const string ShelfChannel = "tabs.shelf";

        private sealed class ShelvedTabEntry
        {
            public string Tag = "";
            public string Label = "";
            public string Glyph = "";
            public FrameworkElement Content = null!;   // the tab's real, still-live content
            public Grid ContentSlot = null!;           // holds Content inside HostBorder
            public Border HostBorder = null!;          // parked 1×1 off-screen in PinnedHostCanvas
        }

        private readonly List<ShelvedTabEntry> _shelvedEntries = new();

        // ── Shelve trigger (tab context menu → "Shelve Tab") ────────────────

        /// <summary>Shelve an existing editor tab: pull its live content out of the
        /// TabItem, park it off-screen in the #972/#982 keep-alive canvas, drop the
        /// tab from its pane, and surface it on the Shelf. Called from the tab context
        /// menu ("Shelve Tab"). The content is never recreated, so the session (e.g. a
        /// WebView2's CoreWebView2) keeps running untouched — restoring reflows the
        /// page, it does not reload.</summary>
        internal void ShelveTabFromMenu(TabItem tabItem)
        {
            if (tabItem == null) return;
            if (tabItem.Content is not FrameworkElement content) return;

            var (glyph, label) = ExtractHeaderText(tabItem);
            string tag = tabItem.Tag?.ToString() ?? label;

            // Detach the content from the TabItem, then drop the tab from its pane.
            tabItem.Content = null;
            var owner = tabItem.Parent as TabControl;
            owner?.Items.Remove(tabItem);

            RegisterShelvedEntry(content, tag, label, glyph);
            ActivityBar.SetShelfCount(_shelvedEntries.Count);
            ActivityLog.Log(ShelfChannel, $"shelved: {label} ({tag}) -> parked alive off-screen; shelf now holds {_shelvedEntries.Count}");
        }

        /// <summary>Park a piece of live content in the keep-alive canvas as a shelved
        /// entry. Reuses the exact #972/#982 primitives: wrap the content in a host
        /// Border added to <c>PinnedHostCanvas</c>, then <see cref="ParkOffscreen"/> it
        /// (1×1, off-screen, z-index 0 — genuinely alive but out of view).</summary>
        private ShelvedTabEntry RegisterShelvedEntry(FrameworkElement content, string tag, string label, string glyph)
        {
            var entry = new ShelvedTabEntry { Tag = tag, Label = label, Glyph = glyph, Content = content };

            entry.ContentSlot = new Grid();
            entry.ContentSlot.Children.Add(content);

            entry.HostBorder = new Border
            {
                Background = (Brush)FindResource("BaseBrush"),
                Child = entry.ContentSlot
            };
            PinnedHostCanvas.Children.Add(entry.HostBorder);
            ParkOffscreen(entry.HostBorder); // #972/#982 keep-alive: 1×1, off-screen, alive

            _shelvedEntries.Add(entry);
            return entry;
        }

        // ── Restore — bring a shelved tab back as a real editor tab ─────────

        /// <summary>Restore a shelved entry back into a fresh, closable editor tab in
        /// the active pane. The SAME live content object is reparented out of the shelf
        /// host and into the new TabItem — no reload, same session, resuming exactly
        /// where it was.</summary>
        private void RestoreShelvedEntry(ShelvedTabEntry entry)
        {
            // Pull the still-live content out of the shelf host (same object).
            entry.ContentSlot.Children.Clear();
            var content = entry.Content;

            var pane = _activeEditorPane;
            if (pane == null || pane.Visibility != Visibility.Visible) pane = EditorTabs;

            var header = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            if (!string.IsNullOrEmpty(entry.Glyph))
                header.Children.Add(BuildTabGlyphBlock(entry.Glyph, 12, new Thickness(0, 0, 6, 0)));
            header.Children.Add(new TextBlock
            {
                Text = entry.Label,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            });
            var closeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1),
                Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab",
                VerticalAlignment = VerticalAlignment.Center
            };
            header.Children.Add(closeBtn);

            var tab = new TabItem { Tag = entry.Tag, Header = header, Content = content };
            closeBtn.Click += (s, e) => CloseTab(tab, pane);
            AttachTabContextMenu(tab, pane);
            AttachTabDragHandlers(tab);
            pane.Items.Add(tab);
            pane.SelectedItem = tab;

            // Tear down the shelf representation.
            PinnedHostCanvas.Children.Remove(entry.HostBorder);
            _shelvedEntries.Remove(entry);
            ActivityBar.SetShelfCount(_shelvedEntries.Count);
            ActivityBar.CloseShelf();

            ActivityLog.Log(ShelfChannel, $"restored: {entry.Label} ({entry.Tag}) -> reopened as a tab (same live session); shelf now holds {_shelvedEntries.Count}");
        }

        // ── Shelf browsing popout (Shelf activity-bar icon) ─────────────────

        /// <summary>The Shelf activity-bar icon was clicked. MainWindow owns the
        /// shelved-tab state, so we build a row per shelved entry (real icon + title,
        /// matching how the tab itself displays) and hand them to the ActivityBar to
        /// host in its anchored popout — the same owner/host split as the Web Tools
        /// popout (Git #864).</summary>
        private void ActivityBar_ShelfOpenRequested(object? sender, EventArgs e)
        {
            var rows = _shelvedEntries.Select(BuildShelfRow).ToList();
            ActivityBar.ShowShelf(rows);
            ActivityLog.Log(ShelfChannel, $"shelf opened: {_shelvedEntries.Count} item(s)");
        }

        /// <summary>Build one clickable Shelf row for a shelved entry: its real icon +
        /// title (same glyph the tab shows), clicking it restores the tab.</summary>
        private UIElement BuildShelfRow(ShelvedTabEntry entry)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            if (!string.IsNullOrEmpty(entry.Glyph))
                row.Children.Add(BuildTabGlyphBlock(entry.Glyph, 14, new Thickness(0, 0, 8, 0)));
            row.Children.Add(new TextBlock
            {
                Text = entry.Label,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                Foreground = (Brush)FindResource("TextBrush")
            });

            var btn = new Button
            {
                Style = (Style)FindResource("IconButton"),
                HorizontalContentAlignment = HorizontalAlignment.Left,
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 2),
                Content = row,
                ToolTip = $"{entry.Label} — click to restore as a tab (session kept alive in the background)"
            };
            btn.Click += (s, e) => RestoreShelvedEntry(entry);
            return btn;
        }

        /// <summary>An icon TextBlock that renders a tab's glyph the same way the tab
        /// bar does: a Segoe MDL2 Assets PUA glyph gets the icon font + blue accent,
        /// anything else (an emoji like ⚙/📝/⚛) renders in the default font. Mirrors
        /// OpenFileTab's own glyph handling so shelf rows read identically to tabs.</summary>
        private TextBlock BuildTabGlyphBlock(string glyph, double fontSize, Thickness margin)
        {
            var tb = new TextBlock
            {
                Text = glyph,
                FontSize = fontSize,
                Margin = margin,
                VerticalAlignment = VerticalAlignment.Center
            };
            if (glyph.Length == 1 && glyph[0] >= 0xE000)
            {
                tb.FontFamily = new FontFamily("Segoe MDL2 Assets");
                tb.Foreground = (Brush)FindResource("BlueBrush");
            }
            else
            {
                tb.Foreground = (Brush)FindResource("TextBrush");
            }
            return tb;
        }
    }
}
