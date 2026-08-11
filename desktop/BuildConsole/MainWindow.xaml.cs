using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace BuildConsole
{
    public class TabSwitcherCard
    {
        public string Title { get; set; } = string.Empty;
        public string Url { get; set; } = string.Empty;
        public string Glyph { get; set; } = "\uE8BD";
        public string IndexTag { get; set; } = "Tab 1";
        public int TabIndex { get; set; }
    }

    public partial class MainWindow : Window
    {
        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        // ── Layout constants ───────────────────────────────────────────────────
        private const double DefaultSidebarWidth  = 260;
        private const double DefaultQueueWidth    = 300;
        private const double DefaultBottomHeight  = 240;

        // ── Status dot brushes (frozen) ───────────────────────────────────────
        private static readonly SolidColorBrush DotReady   = Frozen(0xA6, 0xE3, 0xA1);
        private static readonly SolidColorBrush DotLoading = Frozen(0xFA, 0xB3, 0x87);
        private static readonly SolidColorBrush DotError   = Frozen(0xF3, 0x8B, 0xA8);

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        // ── Clock ─────────────────────────────────────────────────────────────
        private readonly DispatcherTimer _clockTimer;

        public MainWindow()
        {
            InitializeComponent();

            // Clock
            _clockTimer = new DispatcherTimer(DispatcherPriority.Background)
            {
                Interval = TimeSpan.FromSeconds(1)
            };
            _clockTimer.Tick += (_, _) => ClockText.Text = DateTime.Now.ToString("HH:mm:ss");
            _clockTimer.Start();
            ClockText.Text = DateTime.Now.ToString("HH:mm:ss");

            // Initial WebView2 events
            ClaudeWebView.NavigationStarting  += WebView_NavigationStarting;
            ClaudeWebView.NavigationCompleted += WebView_NavigationCompleted;
            ClaudeWebView.SourceChanged       += WebView_SourceChanged;

            // Build Queue selection -> Build Log
            BuildQueuePanel.TaskSelected += BuildQueuePanel_TaskSelected;

            // ActivityBar quick navigation
            ActivityBar.QuickNavRequested += ActivityBar_QuickNavRequested;

            UpdateZoomDisplay();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                int darkMode = 1;
                DwmSetWindowAttribute(hwnd, 20, ref darkMode, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(hwnd, 19, ref darkMode, sizeof(int)); // Fallback for older Win10 builds
            }
            catch { }
        }

        // ── Window Preview Key Handlers for Ctrl+Tab ─────────────────────────
        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Tab && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                bool isReverse = (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift;
                ShowTabSwitcher(isReverse);
            }
            else if (TabSwitcherOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    HideTabSwitcher(confirmSelection: false);
                }
                else if (e.Key == Key.Return)
                {
                    e.Handled = true;
                    HideTabSwitcher(confirmSelection: true);
                }
                else if (e.Key == Key.Down)
                {
                    e.Handled = true;
                    CycleTabSwitcher(forward: true);
                }
                else if (e.Key == Key.Up)
                {
                    e.Handled = true;
                    CycleTabSwitcher(forward: false);
                }
            }
        }

        private void Window_PreviewKeyUp(object sender, KeyEventArgs e)
        {
            if (TabSwitcherOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.LeftCtrl || e.Key == Key.RightCtrl)
                {
                    HideTabSwitcher(confirmSelection: true);
                }
            }
        }

        private void ShowTabSwitcher(bool isReverse = false)
        {
            var cards = new System.Collections.Generic.List<TabSwitcherCard>();
            int count = EditorTabs.Items.Count;
            if (count == 0) return;

            for (int i = 0; i < count; i++)
            {
                if (EditorTabs.Items[i] is TabItem item)
                {
                    string url = item.Tag?.ToString() ?? string.Empty;
                    string title = ExtractTabTitle(item);
                    string glyph = ExtractTabGlyph(url);

                    cards.Add(new TabSwitcherCard
                    {
                        Title = title,
                        Url = url,
                        Glyph = glyph,
                        IndexTag = $"Ctrl+{(i + 1) % 10}",
                        TabIndex = i
                    });
                }
            }

            TabSwitcherList.ItemsSource = cards;
            TabSwitcherCountText.Text = $"{count} document{(count == 1 ? "" : "s")}";

            int currentIdx = Math.Max(0, EditorTabs.SelectedIndex);
            int nextIdx = (currentIdx + (isReverse ? -1 : 1) + count) % count;

            TabSwitcherOverlay.Visibility = Visibility.Visible;
            TabSwitcherList.SelectedIndex = nextIdx;

            if (TabSwitcherList.SelectedItem != null)
                TabSwitcherList.ScrollIntoView(TabSwitcherList.SelectedItem);

            // Transfer keyboard focus from WebView2 native HWND to WPF ListBox
            Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
            {
                TabSwitcherList.Focus();
                Keyboard.Focus(TabSwitcherList);
            }));
        }

        private void CycleTabSwitcher(bool forward)
        {
            int count = TabSwitcherList.Items.Count;
            if (count == 0) return;

            int newIdx = (TabSwitcherList.SelectedIndex + (forward ? 1 : -1) + count) % count;
            TabSwitcherList.SelectedIndex = newIdx;
            if (TabSwitcherList.SelectedItem != null)
                TabSwitcherList.ScrollIntoView(TabSwitcherList.SelectedItem);
        }

        private void HideTabSwitcher(bool confirmSelection)
        {
            if (confirmSelection && TabSwitcherList.SelectedItem is TabSwitcherCard card)
            {
                EditorTabs.SelectedIndex = card.TabIndex;
            }

            TabSwitcherOverlay.Visibility = Visibility.Collapsed;

            // Return focus to active WebView2
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() =>
            {
                GetActiveWebView()?.Focus();
            }));
        }

        private void OpenTabSwitcher_Click(object sender, RoutedEventArgs e)
        {
            ShowTabSwitcher(isReverse: false);
        }

        private void TabSwitcherOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            HideTabSwitcher(confirmSelection: false);
        }

        private void TabSwitcherCard_MouseDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            HideTabSwitcher(confirmSelection: true);
        }

        private static string ExtractTabTitle(TabItem tab)
        {
            if (tab.Header is StackPanel sp)
            {
                foreach (var child in sp.Children)
                {
                    if (child is TextBlock tb)
                    {
                        if (tb.FontFamily != null && tb.FontFamily.Source.Contains("Segoe MDL2", StringComparison.OrdinalIgnoreCase))
                            continue;

                        if (!string.IsNullOrWhiteSpace(tb.Text) && tb.Text != "✕")
                            return tb.Text;
                    }
                }
            }
            return tab.Header?.ToString() ?? "Document";
        }

        private static string ExtractTabGlyph(string url)
        {
            return url switch
            {
                var u when u.Contains("/admin-panel/") => "\uE7EF",
                var u when u.Contains("/portal/")      => "\uE77B",
                var u when u.Contains("claude.ai")     => "\uE8BD",
                _                                      => "\uE774"
            };
        }

        private Microsoft.Web.WebView2.Wpf.WebView2 GetActiveWebView()
        {
            if (EditorTabs.SelectedItem is TabItem ti && ti.Content is Microsoft.Web.WebView2.Wpf.WebView2 wv)
            {
                return wv;
            }
            return ClaudeWebView;
        }

        private void EditorTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (e.Source == EditorTabs)
            {
                var wv = GetActiveWebView();
                UrlStatusText.Text = wv.Source?.ToString() ?? string.Empty;
                UpdateZoomDisplay();
            }
        }

        private void ActivityBar_QuickNavRequested(object? sender, string url)
        {
            var (title, glyph) = url switch
            {
                var u when u.Contains("/admin-panel/") => ("Admin Center", "\uE7EF"),
                var u when u.Contains("/portal/")      => ("Customer Portal", "\uE77B"),
                _                                      => ("Marketing Site", "\uE774")
            };
            OpenWebTab(title, url, glyph);
        }

        public void OpenWebTab(string title, string url, string glyph)
        {
            // If tab with this URL is already open, switch to it
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string existingUrl && string.Equals(existingUrl, url, StringComparison.OrdinalIgnoreCase))
                {
                    EditorTabs.SelectedItem = item;
                    return;
                }
            }

            // Tab header panel
            var headerPanel = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            var iconBlock = new TextBlock
            {
                Text = glyph,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("BlueBrush")
            };

            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
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

            // WebView2 content
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2
            {
                Source = new Uri(url)
            };

            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;

            var newTab = new TabItem
            {
                Tag = url,
                Header = headerPanel,
                Content = wv
            };

            closeBtn.Click += (s, e) =>
            {
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        private void BuildQueuePanel_TaskSelected(object? sender, Controls.TaskSelectedEventArgs e)
        {
            BuildLogView.LoadTaskLog(e.Epic, e.Task, e.Status, e.StatusDetails);
            SetBottomPanel(true, tabIndex: 0);
        }

        // ── ActivityBar → LeftSidebar ─────────────────────────────────────────
        private void ActivityBar_ActiveViewChanged(object? sender, string view)
        {
            // VS Code behaviour: clicking the already-active icon collapses the sidebar
            if (ColSidebar.Width.Value > 0 && LeftSidebar.GetCurrentView() == view)
            {
                ColSidebar.Width = new GridLength(0);
            }
            else
            {
                if (ColSidebar.Width.Value == 0)
                    ColSidebar.Width = new GridLength(DefaultSidebarWidth);
                LeftSidebar.SwitchView(view);
            }
        }

        // ── WebView2 events ───────────────────────────────────────────────────
        private void WebView_NavigationStarting(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
        {
            NavStatusText.Text = "Loading…";
            StatusDot.Fill     = DotLoading;
            UrlStatusText.Text = e.Uri ?? string.Empty;
        }

        private void WebView_NavigationCompleted(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
        {
            NavStatusText.Text = e.IsSuccess ? "Ready" : $"Error {(int)e.WebErrorStatus}";
            StatusDot.Fill     = e.IsSuccess ? DotReady : DotError;
            var activeWv = sender as Microsoft.Web.WebView2.Wpf.WebView2 ?? GetActiveWebView();
            UrlStatusText.Text = activeWv.Source?.ToString() ?? string.Empty;
        }

        private void WebView_SourceChanged(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2SourceChangedEventArgs e)
        {
            var activeWv = sender as Microsoft.Web.WebView2.Wpf.WebView2 ?? GetActiveWebView();
            UrlStatusText.Text = activeWv.Source?.ToString() ?? string.Empty;
        }

        private void UpdateZoomDisplay()
            => ZoomText.Text = $"{GetActiveWebView().ZoomFactor:P0}";

        // ── Menu: File ────────────────────────────────────────────────────────
        private void MenuExit_Click(object sender, RoutedEventArgs e)
            => Application.Current.Shutdown();

        // ── Menu: View ────────────────────────────────────────────────────────
        private void ToggleSidebar_Click(object sender, RoutedEventArgs e)
        {
            ColSidebar.Width = ColSidebar.Width.Value > 0
                ? new GridLength(0)
                : new GridLength(DefaultSidebarWidth);
        }

        private void ToggleQueuePanel_Click(object sender, RoutedEventArgs e)
        {
            ColQueue.Width = ColQueue.Width.Value > 0
                ? new GridLength(0)
                : new GridLength(DefaultQueueWidth);
            BuildQueuePanel.Visibility = ColQueue.Width.Value > 0
                ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ToggleBottomPanel_Click(object sender, RoutedEventArgs e)
            => SetBottomPanel(RowBottom.Height.Value == 0);

        private void SetBottomPanel(bool open, int tabIndex = -1)
        {
            if (open)
            {
                RowBottom.Height      = new GridLength(DefaultBottomHeight);
                BottomSplitter.Visibility = Visibility.Visible;
                BottomTabs.Visibility     = Visibility.Visible;
                if (tabIndex >= 0 && tabIndex < BottomTabs.Items.Count)
                    BottomTabs.SelectedIndex = tabIndex;
            }
            else
            {
                RowBottom.Height          = new GridLength(0);
                BottomSplitter.Visibility = Visibility.Collapsed;
                BottomTabs.Visibility     = Visibility.Collapsed;
            }
        }

        private void ResetLayout_Click(object sender, RoutedEventArgs e)
        {
            ColSidebar.Width = new GridLength(DefaultSidebarWidth);
            ColQueue.Width   = new GridLength(DefaultQueueWidth);
            SetBottomPanel(false);

            BuildQueuePanel.Visibility = Visibility.Visible;
            LeftSidebar.Visibility     = Visibility.Visible;
        }

        // ── Menu: View → Zoom ─────────────────────────────────────────────────
        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = Math.Min(wv.ZoomFactor + 0.1, 3.0);
            UpdateZoomDisplay();
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = Math.Max(wv.ZoomFactor - 0.1, 0.25);
            UpdateZoomDisplay();
        }

        private void ZoomReset_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            wv.ZoomFactor = 1.0;
            UpdateZoomDisplay();
        }

        // ── Menu: Claude ──────────────────────────────────────────────────────
        private void NavBack_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv.CanGoBack) wv.GoBack();
        }

        private void NavForward_Click(object sender, RoutedEventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv.CanGoForward) wv.GoForward();
        }

        private void NavRefresh_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().Reload();

        // ── Menu: Terminal ────────────────────────────────────────────────────
        private void OpenTerminal_Click(object sender, RoutedEventArgs e)
            => SetBottomPanel(true, tabIndex: 1);

        private void GitChip_Click(object sender, RoutedEventArgs e)
        {
            SetBottomPanel(true, tabIndex: 1);
            if (sender is MenuItem mi)
                TerminalView.SetCommand(mi.Tag?.ToString() ?? string.Empty);
        }

        // ── Menu: SQL ─────────────────────────────────────────────────────────
        private void OpenSql_Click(object sender, RoutedEventArgs e)
            => SetBottomPanel(true, tabIndex: 2);

        // ── Menu: Help ────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().CoreWebView2?.OpenDevToolsWindow();
    }
}
