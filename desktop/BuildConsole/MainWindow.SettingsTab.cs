using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #954 (Epic #803) — the native Settings tab, opened/focused the exact
    /// same opens-or-focuses way the #921 Git detail tabs are, reusing the
    /// #893/#894 multi-pane editor tab infra (header StackPanel + IconButton
    /// close + AttachTabContextMenu/AttachTabDragHandlers). Both the ActivityBar
    /// cog and File > Settings route here (see ActivityBar_ActiveViewChanged /
    /// MenuSettings_Click), and the sidebar's Settings category nav list opens
    /// this tab scrolled to a section (LeftSidebar.SettingsCategoryRequested).
    ///
    /// Split into its own partial-class file so it stays isolated from the
    /// concurrently-edited MainWindow.xaml.cs.
    /// </summary>
    public partial class MainWindow
    {
        private const string SettingsTabChannel = "settings.tab";
        private const string SettingsTabKey = "settings:main";

        /// <summary>Open (or focus) the single Settings tab. If <paramref name="category"/>
        /// is given (from the sidebar's category nav list), scroll to that section.</summary>
        public void OpenSettingsTab(string? category = null)
        {
            // Focus if already open — same dedup scan every other detail tab uses.
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tag && string.Equals(tag, SettingsTabKey, StringComparison.Ordinal))
                {
                    EditorTabs.SelectedItem = item;
                    if (item.Content is SettingsTabView existing && category != null)
                    {
                        existing.ScrollToSection(category);
                        ActivityLog.Log(SettingsTabChannel, $"navigate to '{category}' (existing tab)");
                    }
                    else
                    {
                        ActivityLog.Log(SettingsTabChannel, "focus existing tab");
                    }
                    return;
                }
            }

            var view = new SettingsTabView();
            view.Initialize(_buildTrackerApi);
            // Git #902 — the Replit watcher re-applies live on save; wired per tab
            // instance (the tab can be closed and reopened), same lifecycle as
            // GitDetailView's OpenIssueNumberRequested hook.
            view.ReplitWatcherSettingsChanged += (s, e) => _replitWatcher?.ApplyConfig();
            // Git #967 — the scheduled-runs settings re-apply live on save the same way.
            view.ScheduleSettingsChanged += (s, e) => _regressionScheduler?.ApplyConfig();

            AddSettingsTab(view);

            if (category != null)
            {
                // Defer until the fresh tab has laid out, so BringIntoView has real
                // extents to scroll to.
                Dispatcher.BeginInvoke(new Action(() => view.ScrollToSection(category)), DispatcherPriority.Loaded);
                ActivityLog.Log(SettingsTabChannel, $"tab opened → '{category}'");
            }
            else
            {
                ActivityLog.Log(SettingsTabChannel, "tab opened");
            }
        }

        /// <summary>Git #2122 — live-apply forwarding target for the Settings UI's max concurrent
        /// build slots control (see SettingsTabView.BtnSaveMaxConcurrent_Click). No-ops if the
        /// watcher hasn't been constructed yet (e.g. the build tracker API isn't configured).</summary>
        public void UpdateMaxConcurrentBuildSlots(int value) => _queueWatcher?.UpdateMaxConcurrent(value);

        /// <summary>Build and add the Settings tab — same header/close/context-menu/
        /// drag recipe as AddGitDetailTab, so multi-pane drag/dock keep working.</summary>
        private void AddSettingsTab(SettingsTabView view)
        {
            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = "⚙",
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            var titleBlock = new TextBlock
            {
                Text = "Settings",
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"),
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = "Settings"
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
                Tag = SettingsTabKey,
                Header = headerPanel,
                Content = view
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab, EditorTabs);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }
    }
}
