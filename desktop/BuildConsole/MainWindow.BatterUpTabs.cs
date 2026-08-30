using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #1872 — Batter Up and AI Batter Up move from the docked right-hand queue column
    /// (Grid.Column 5) into their own native document tabs, opened/focused from two new
    /// title-bar buttons. Same open-or-focus + header/close/drag recipe as
    /// MainWindow.SettingsTab.cs's OpenSettingsTab, except the existing-tab scan checks
    /// every pane the way MainWindow.GitDetailTabs.cs's FocusExistingGitDetailTab does —
    /// these documents are draggable to any pane per #893, so a single-pane scan would miss
    /// one dragged elsewhere and open a duplicate.
    ///
    /// MainWindow no longer constructs these two controls via XAML `x:Name` — they're
    /// hoisted here as fields and built exactly once, for the same reason the issue calls
    /// out: each `Initialize()` (GitHub read, #1870 free-flow gate) and the #1813
    /// manual-refresh cascade must operate on a single live instance, or a second instance
    /// would double up on refreshes and could race `QueueBuildAsync` with free flow on.
    /// Closing a document tab only removes its `TabItem` from the visual tree — the field
    /// still holds the same panel instance, so state (last-fetched rows, the free-flow
    /// toggle) survives a close/reopen and the #1813 cascade keeps reaching it either way.
    /// </summary>
    public partial class MainWindow
    {
        private const string BatterUpTabChannel = "batter-up";
        private const string AiBatterUpTabChannel = "ai-batter-up";
        private const string BatterUpTabKey = "batter-up:main";
        private const string AiBatterUpTabKey = "ai-batter-up:main";

        // Git #1872 — the SAME instances every existing wire in MainWindow.xaml.cs
        // (RowsAutoQueued, Initialize, the #1813 BoardRefreshCompleted cascade) already
        // targets. Built once as fields instead of via XAML x:Name, since these no longer
        // live anywhere in the XAML tree by default — only inside their document tab, when
        // one is open.
        private readonly BatterUpPanel _batterUpPanel = new();
        private readonly AiBatterUpPanel _aiBatterUpPanel = new();

        /// <summary>Git #1872 — subscribes the two title-bar count badges to each panel's
        /// CountChanged event and seeds them with whatever count each panel already has
        /// (both start at 0, but this stays correct if that default ever changes). No new
        /// polling or fetch — this only mirrors a count the panel already computed.</summary>
        private void WireBatterUpTitleBarCounts()
        {
            _batterUpPanel.CountChanged += (_, count) => TopBatterUpCount.Text = count.ToString();
            _aiBatterUpPanel.CountChanged += (_, count) => TopAiBatterUpCount.Text = count.ToString();
            TopBatterUpCount.Text = _batterUpPanel.Count.ToString();
            TopAiBatterUpCount.Text = _aiBatterUpPanel.Count.ToString();
        }

        private void BtnBatterUp_Click(object sender, RoutedEventArgs e) => OpenBatterUpTab();

        private void BtnAiBatterUp_Click(object sender, RoutedEventArgs e) => OpenAiBatterUpTab();

        /// <summary>Open (or focus, across every pane) the single Batter Up document tab.</summary>
        public void OpenBatterUpTab()
        {
            if (FocusExistingDocumentTab(BatterUpTabKey))
            {
                ActivityLog.Log(BatterUpTabChannel, "focus existing tab");
                return;
            }
            AddBatterUpDocumentTab(BatterUpTabKey, "⚾", "Batter Up", _batterUpPanel, BatterUpTabChannel);
        }

        /// <summary>Open (or focus, across every pane) the single AI Batter Up document tab.</summary>
        public void OpenAiBatterUpTab()
        {
            if (FocusExistingDocumentTab(AiBatterUpTabKey))
            {
                ActivityLog.Log(AiBatterUpTabChannel, "focus existing tab");
                return;
            }
            AddBatterUpDocumentTab(AiBatterUpTabKey, "🔍", "AI Batter Up", _aiBatterUpPanel, AiBatterUpTabChannel);
        }

        /// <summary>Focus an already-open tab by its Tag key, scanning every split pane — mirrors
        /// MainWindow.GitDetailTabs.cs's FocusExistingGitDetailTab all-panes scan. Returns true if
        /// a matching tab existed (and is now focused).</summary>
        private bool FocusExistingDocumentTab(string tabKey)
        {
            foreach (var pane in new[] { EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4 })
            {
                foreach (TabItem item in pane.Items)
                {
                    if (item.Tag is string tag && string.Equals(tag, tabKey, StringComparison.Ordinal))
                    {
                        pane.SelectedItem = item;
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>Build and add the document tab — same header/close/context-menu/drag recipe as
        /// AddSettingsTab / AddGitDetailTab, always opened into the default EditorTabs pane (same
        /// convention OpenSettingsTab uses; dragging to another pane is #893's job, not this one's).</summary>
        private void AddBatterUpDocumentTab(string tabKey, string glyph, string title, UserControl view, string channel)
        {
            // Git #1872 — these two tabs are the first to reuse a persistent UserControl instance
            // across close/reopen (every other tab type constructs fresh Content each open).
            // CloseTab detaches the old TabItem's Content asynchronously (UiFadeHelper.FadeOut's
            // onComplete) — a close immediately followed by a reopen could otherwise race
            // "element is already the logical child of another element." Clearing any stale parent
            // link up front is a no-op in the normal case and closes that race in the rare one.
            if (view.Parent is TabItem staleTab) staleTab.Content = null;

            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = glyph,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"),
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = title
            };

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

            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            var newTab = new TabItem
            {
                Tag = tabKey,
                Header = headerPanel,
                Content = view
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab, EditorTabs);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;

            ActivityLog.Log(channel, "tab opened");
        }
    }
}
