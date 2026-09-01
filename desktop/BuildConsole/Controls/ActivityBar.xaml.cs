using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace BuildConsole.Controls
{
    public partial class ActivityBar : UserControl
    {
        /// <summary>Raised when the user clicks a different activity-bar icon.</summary>
        public event EventHandler<string>? ActiveViewChanged;

        /// <summary>Raised when the user clicks one of the quick navigation icons.</summary>
        public event EventHandler<string>? QuickNavRequested;

        /// <summary>Git #864 — raised when the user picks an entry from the Web Tools popout. (name, url)</summary>
        public event EventHandler<(string Name, string Url)>? WebToolRequested;

        /// <summary>Git #937 — raised when the Sticky Notes icon is clicked; MainWindow toggles the always-on-top floaty open/closed.</summary>
        public event EventHandler? StickyNotesToggleRequested;

        /// <summary>Git #973 — raised when the LinkedIn composer icon is clicked; MainWindow toggles the always-on-top LinkedIn post pre-fill floaty open/closed.</summary>
        public event EventHandler? LinkedInComposerToggleRequested;

        /// <summary>Git #980 — raised when the Build Watch icon is clicked; MainWindow toggles the floaty 8-slot Build Watch window open/closed.</summary>
        public event EventHandler? BuildWatchToggleRequested;

        /// <summary>Git #1472 — raised when the Visual Test Tracker icon is clicked; MainWindow toggles the always-on-top floaty open/closed.</summary>
        public event EventHandler? VisualTestTrackerToggleRequested;

        /// <summary>Git #2110 — raised when the Build Queue Map icon is clicked; MainWindow toggles the floaty live queue-map window open/closed.</summary>
        public event EventHandler? BuildQueueMapToggleRequested;

        /// <summary>Raised when the Shelf icon is clicked. MainWindow owns the shelved-tab
        /// state (the live off-screen content), so it responds by calling <see cref="ShowShelf"/>
        /// with the current entries' rows.</summary>
        public event EventHandler? ShelfOpenRequested;

        public ActivityBar() => InitializeComponent();

        /// <summary>Git #834 — File > Settings menu item routes here so it lands on the SAME SettingsView the cog icon already opens, instead of being a second, divergent path.</summary>
        public void SelectSettings() => BtnSettings.IsChecked = true;
        public void SelectGitBoard() => BtnIssues.IsChecked = true;

        private void Btn_Checked(object sender, RoutedEventArgs e)
        {
            if (sender is RadioButton rb)
                ActiveViewChanged?.Invoke(this, rb.Tag?.ToString() ?? "Chats");
        }

        /// <summary>Git #937 — toggles the always-on-top Sticky Notes floaty.</summary>
        private void BtnStickyNotes_Click(object sender, RoutedEventArgs e) =>
            StickyNotesToggleRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Git #973 — toggles the always-on-top LinkedIn post pre-fill floaty.</summary>
        private void BtnLinkedInComposer_Click(object sender, RoutedEventArgs e) =>
            LinkedInComposerToggleRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Git #980 — toggles the floaty 8-slot Build Watch window.</summary>
        private void BtnBuildWatch_Click(object sender, RoutedEventArgs e) =>
            BuildWatchToggleRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Git #1472 — toggles the always-on-top Visual Test Tracker floaty.</summary>
        private void BtnVisualTestTracker_Click(object sender, RoutedEventArgs e) =>
            VisualTestTrackerToggleRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Git #2110 — toggles the floaty live Build Queue Map window.</summary>
        private void BtnBuildQueueMap_Click(object sender, RoutedEventArgs e) =>
            BuildQueueMapToggleRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Shelf icon clicked — ask MainWindow (which owns the shelved-tab state)
        /// to populate + open the popout via <see cref="ShowShelf"/>.</summary>
        private void BtnShelf_Click(object sender, RoutedEventArgs e) =>
            ShelfOpenRequested?.Invoke(this, EventArgs.Empty);

        /// <summary>Host the given shelf entry rows in the anchored popout and open it.
        /// MainWindow builds each row (real icon + title + restore-on-click); the
        /// ActivityBar just presents them — same owner/host split as the Web Tools
        /// popout, but with MainWindow-owned live data. Shows an empty-state hint when
        /// nothing is shelved.</summary>
        public void ShowShelf(IReadOnlyList<UIElement> rows)
        {
            ShelfList.Children.Clear();
            if (rows == null || rows.Count == 0)
            {
                ShelfList.Children.Add(new TextBlock
                {
                    Text = "Nothing shelved. Right-click a tab → Shelve Tab to park it here — it stays alive in the background.",
                    FontSize = 11,
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(8)
                });
            }
            else
            {
                foreach (var row in rows)
                    ShelfList.Children.Add(row);
            }
            ShelfPopup.IsOpen = true;
        }

        /// <summary>Close the Shelf popout (e.g. right after a restore consumes an entry).</summary>
        public void CloseShelf() => ShelfPopup.IsOpen = false;

        /// <summary>Reflect the current shelved-tab count as a small badge on the Shelf
        /// icon, so parked tabs are never invisibly lost from the tab bar.</summary>
        public void SetShelfCount(int count)
        {
            ShelfCountText.Text = count > 99 ? "99+" : count.ToString();
            ShelfCountBadge.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        private void QuickNav_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string url)
            {
                QuickNavRequested?.Invoke(this, url);
            }
        }

        /// <summary>Git #864 — reloads the configured tools fresh every open, so edits made in Settings > Web Tools show up without restarting the app.</summary>
        private void BtnWebTools_Click(object sender, RoutedEventArgs e)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            WebToolsList.Children.Clear();

            if (settings.WebTools.Count == 0)
            {
                WebToolsList.Children.Add(new TextBlock
                {
                    Text = "No web tools configured — add some in Settings.",
                    FontSize = 11,
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(8)
                });
            }

            foreach (var tool in settings.WebTools)
            {
                var entryButton = new Button
                {
                    Style = (Style)FindResource("IconButton"),
                    HorizontalContentAlignment = HorizontalAlignment.Left,
                    Padding = new Thickness(8, 6, 8, 6),
                    Margin = new Thickness(0, 0, 0, 2),
                    Tag = tool
                };

                var row = new StackPanel { Orientation = Orientation.Horizontal };

                var iconGlyph = new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(tool.Icon) ? "" : tool.Icon,
                    FontFamily = new FontFamily("Segoe MDL2 Assets"),
                    FontSize = 14,
                    Width = 16,
                    Margin = new Thickness(0, 0, 8, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("BlueBrush")
                };
                row.Children.Add(iconGlyph);
                row.Children.Add(new TextBlock
                {
                    Text = tool.Name,
                    FontSize = 12,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = (Brush)FindResource("TextBrush")
                });

                entryButton.Content = row;
                entryButton.Click += WebToolEntry_Click;
                WebToolsList.Children.Add(entryButton);

                LoadFaviconAsync(tool.Url, iconGlyph, row);
            }

            WebToolsPopup.IsOpen = true;
        }

        /// <summary>Fetches (or reads from the on-disk cache) the real favicon for a Web Tools
        /// entry's domain and swaps it in for the generic glyph once ready. Never throws and
        /// never removes the glyph if the fetch fails - the glyph stays as the fallback icon.</summary>
        private static async void LoadFaviconAsync(string url, TextBlock glyph, StackPanel row)
        {
            string? path;
            try
            {
                path = await BuildConsole.Services.FaviconCacheService.GetIconPathAsync(url);
            }
            catch
            {
                return;
            }

            if (string.IsNullOrEmpty(path)) return;

            try
            {
                var bitmap = new BitmapImage();
                bitmap.BeginInit();
                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.UriSource = new Uri(path, UriKind.Absolute);
                bitmap.EndInit();
                bitmap.Freeze();

                var image = new Image
                {
                    Source = bitmap,
                    Width = 16,
                    Height = 16,
                    Margin = glyph.Margin,
                    VerticalAlignment = VerticalAlignment.Center
                };

                var index = row.Children.IndexOf(glyph);
                if (index >= 0)
                {
                    row.Children.RemoveAt(index);
                    row.Children.Insert(index, image);
                }
            }
            catch
            {
                // Corrupt/partial cache file - leave the glyph in place.
            }
        }

        private void WebToolEntry_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is BuildConsole.Services.WebToolEntry tool)
            {
                WebToolRequested?.Invoke(this, (tool.Name, tool.Url));
            }
            WebToolsPopup.IsOpen = false;
        }
    }
}
