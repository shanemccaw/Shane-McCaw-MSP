using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2156 — the embedded Claude terminal (#2149) moved out of the cramped
    /// bottom-panel strip into a real, full-size center-pane document tab.
    /// Mirrors the document-tab pattern in MainWindow.GitDetailTabs.cs
    /// (FocusExistingGitDetailTab-style dedup, AddGitDetailTab-style tab
    /// construction) rather than inventing a parallel mechanism.
    ///
    /// The ClaudeTerminalView instance is created once and reused — its
    /// ConPTY/xterm.js session (Controls/ClaudeTerminalView.xaml.cs) is
    /// unchanged, and only stays alive as long as the instance stays in the
    /// visual tree, so re-focusing the existing tab (rather than recreating
    /// the view) is what keeps the shell session persistent.
    /// </summary>
    public partial class MainWindow
    {
        private const string ClaudeTerminalDedupKey = "claude-terminal";

        private ClaudeTerminalView? _claudeTerminalView;

        private void OpenClaudeTerminal_Click(object sender, RoutedEventArgs e) => OpenClaudeTerminalTab();

        /// <summary>Open (or focus) the Claude terminal as a full document tab.</summary>
        public void OpenClaudeTerminalTab()
        {
            if (FocusExistingGitDetailTab(ClaudeTerminalDedupKey)) return;

            _claudeTerminalView ??= new ClaudeTerminalView();
            AddClaudeTerminalTab(_claudeTerminalView);
        }

        private void AddClaudeTerminalTab(ClaudeTerminalView view)
        {
            var pane = EditorTabs;

            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = "⌨",
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            var titleBlock = new TextBlock
            {
                Text = "Claude Terminal",
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"),
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = "Claude Terminal"
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
                Tag = ClaudeTerminalDedupKey,
                Header = headerPanel,
                Content = view
            };

            AttachTabContextMenu(newTab, pane);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab, pane);

            pane.Items.Add(newTab);
            pane.SelectedItem = newTab;

            ActivityLog.Log("system.core", $"tab opened ({pane.Name}): {ClaudeTerminalDedupKey}");
        }
    }
}
