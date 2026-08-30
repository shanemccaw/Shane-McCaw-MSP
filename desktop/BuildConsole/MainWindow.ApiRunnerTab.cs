using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class MainWindow : Window
    {
        private const string ApiRunnerTabKey = "api:runner";

        private void OpenApiRunner_Click(object sender, RoutedEventArgs e)
        {
            OpenApiRunnerTab();
        }

        public void OpenApiRunnerTab()
        {
            // Focus if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tag && string.Equals(tag, ApiRunnerTabKey, StringComparison.Ordinal))
                {
                    EditorTabs.SelectedItem = item;
                    ActivityLog.Log("api-runner.tab", "focused existing API Runner tab");
                    return;
                }
            }

            if (_buildTrackerApi == null)
            {
                ToastEngine.Error("API Runner", "Build Tracker API client is not initialized.");
                return;
            }

            var view = new ApiRunnerView();
            view.Initialize(_buildTrackerApi);

            // Build tab header panel
            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = "⚡",
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = FindResource("MauveBrush") as Brush
            };

            var titleBlock = new TextBlock
            {
                Text = "API Runner",
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = FindResource("TextBrush") as Brush,
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = "API Runner"
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
                Tag = ApiRunnerTabKey,
                Header = headerPanel,
                Content = view
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);

            closeBtn.Click += (s, e) => CloseTab(newTab, EditorTabs);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;

            ActivityLog.Log("api-runner.tab", "API Runner tab opened");
        }
    }
}
