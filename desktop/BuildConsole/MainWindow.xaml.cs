using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

            // LeftSidebar file clicks -> Open Viewer tabs
            LeftSidebar.FileSelected += LeftSidebar_FileSelected;

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
            if (EditorTabs.SelectedItem is TabItem ti)
            {
                if (ti.Content is Microsoft.Web.WebView2.Wpf.WebView2 wvDirect)
                    return wvDirect;

                if (ti.Content is Panel panel)
                {
                    foreach (var child in panel.Children)
                    {
                        if (child is Microsoft.Web.WebView2.Wpf.WebView2 wvChild)
                            return wvChild;
                    }
                }
            }
            return ClaudeWebView;
        }

        private void ActivityBar_QuickNavRequested(object? sender, string url)
        {
            var (title, glyph) = url switch
            {
                var u when u.Contains("/admin-panel/") => ("Admin Center", "\uE7EF"),
                var u when u.Contains("/portal/")      => ("Customer Portal", "\uE77B"),
                _                                      => ("Marketing Site", "\uE774")
            };
            OpenWebTab(url, title, glyph);
        }

        private void EditorTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (e.Source == EditorTabs)
            {
                try
                {
                    var wv = GetActiveWebView();
                    UrlStatusText.Text = wv.Source?.ToString() ?? string.Empty;
                    UpdateZoomDisplay();
                }
                catch { }
            }
        }

        private void LeftSidebar_StopRecordingRequested(object? sender, EventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv != null && wv.CoreWebView2 != null)
            {
                wv.ExecuteScriptAsync("window.__isRecordingUI = false;");
            }
        }

        private void LeftSidebar_PlayTestRequested(object? sender, (string url, List<Controls.AutomationAction> steps) e)
        {
            var runner = new AutomationRunnerWindow(e.url, e.steps);
            runner.Show();
        }

        public void OpenWebTab(string url, string title, string glyph)
        {
            // Deduplicate if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagUrl && string.Equals(tagUrl, url, StringComparison.OrdinalIgnoreCase))
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

            // Browser navigation toolbar bar
            var navBar = new Grid
            {
                Background = (Brush)FindResource("MantleBrush"),
                Height = 36
            };
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Back
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Forward
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Refresh
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // URL Address Box
            navBar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Go

            var btnBack = new Button
            {
                Content = new TextBlock { Text = "\uE72B", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(4, 4, 2, 4), ToolTip = "Back"
            };
            btnBack.Click += (s, e) => { if (wv.CanGoBack) wv.GoBack(); };

            var btnForward = new Button
            {
                Content = new TextBlock { Text = "\uE72A", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(0, 4, 2, 4), ToolTip = "Forward"
            };
            btnForward.Click += (s, e) => { if (wv.CanGoForward) wv.GoForward(); };

            var btnRefresh = new Button
            {
                Content = new TextBlock { Text = "\uE72C", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(0, 4, 6, 4), ToolTip = "Refresh"
            };
            btnRefresh.Click += (s, e) => wv.Reload();

            var urlBox = new TextBox
            {
                Text = url,
                FontSize = 12,
                Height = 26,
                Margin = new Thickness(0, 4, 0, 4),
                Padding = new Thickness(8, 2, 8, 2),
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("BaseBrush"),
                Foreground = (Brush)FindResource("TextBrush"),
                BorderThickness = new Thickness(1),
                BorderBrush = (Brush)FindResource("Surface0Brush")
            };

            Action navigateUrl = () =>
            {
                string target = urlBox.Text.Trim();
                if (!target.StartsWith("http://") && !target.StartsWith("https://"))
                    target = "https://" + target;
                try { wv.Source = new Uri(target); } catch { }
            };

            urlBox.KeyDown += (s, e) =>
            {
                if (e.Key == System.Windows.Input.Key.Enter) navigateUrl();
            };

            var btnGo = new Button
            {
                Content = new TextBlock { Text = "\uE751", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12 },
                Style = (Style)FindResource("IconButton"),
                Width = 28, Height = 28, Margin = new Thickness(4, 4, 4, 4), ToolTip = "Go to URL"
            };
            btnGo.Click += (s, e) => navigateUrl();

            Grid.SetColumn(btnBack, 0);
            Grid.SetColumn(btnForward, 1);
            Grid.SetColumn(btnRefresh, 2);
            Grid.SetColumn(urlBox, 3);
            Grid.SetColumn(btnGo, 4);

            navBar.Children.Add(btnBack);
            navBar.Children.Add(btnForward);
            navBar.Children.Add(btnRefresh);
            navBar.Children.Add(urlBox);
            navBar.Children.Add(btnGo);

            wv.SourceChanged += (s, e) =>
            {
                urlBox.Text = wv.Source?.ToString() ?? string.Empty;
            };

            var webContainer = new Grid();
            webContainer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            webContainer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Grid.SetRow(navBar, 0);
            Grid.SetRow(wv, 1);

            webContainer.Children.Add(navBar);
            webContainer.Children.Add(wv);

            var newTab = new TabItem
            {
                Tag = url,
                Header = headerPanel,
                Content = webContainer
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

        private void LeftSidebar_FileSelected(object? sender, string filePath)
        {
            OpenFileTab(filePath);
        }

        public void OpenFileTab(string filePath)
        {
            if (!File.Exists(filePath)) return;

            string fileName = Path.GetFileName(filePath);
            string ext = Path.GetExtension(filePath).ToLowerInvariant();

            // Deduplicate if already open
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tagPath && string.Equals(tagPath, filePath, StringComparison.OrdinalIgnoreCase))
                {
                    EditorTabs.SelectedItem = item;
                    return;
                }
            }

            string glyph = ext switch
            {
                ".json"               => "⚙",
                ".sql"                => "🗄️",
                ".md"                 => "📝",
                ".cs"                 => "⚡",
                ".xaml"               => "🎨",
                ".ts" or ".tsx" or ".js" or ".jsx" => "⚛",
                ".csproj"             => "📦",
                _                     => "📄"
            };

            // Header panel
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
            if (glyph.Length == 1 && glyph[0] >= 0xE000)
            {
                iconBlock.FontFamily = new FontFamily("Segoe MDL2 Assets");
                iconBlock.Foreground = (Brush)FindResource("BlueBrush");
            }

            var titleBlock = new TextBlock
            {
                Text = fileName,
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

            // Right-click context menu on tab header
            var tabContextMenu = new ContextMenu();
            var miCloseThis = new MenuItem { Header = "Close Tab" };
            miCloseThis.Click += (s, e) =>
            {
                if (headerPanel.Parent is TabItem ti)
                {
                    EditorTabs.Items.Remove(ti);
                    if (EditorTabs.Items.Count > 0)
                        EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
                }
            };

            var miCloseOthers = new MenuItem { Header = "Close Other Tabs" };
            miCloseOthers.Click += (s, e) =>
            {
                if (headerPanel.Parent is TabItem ti)
                {
                    var toRemove = System.Linq.Enumerable.ToList(System.Linq.Enumerable.Where(EditorTabs.Items.OfType<TabItem>(), t => t != ti && t != ClaudeWebView.Parent));
                    foreach (var t in toRemove) EditorTabs.Items.Remove(t);
                }
            };

            var miCloseAll = new MenuItem { Header = "Close All Tabs" };
            miCloseAll.Click += (s, e) =>
            {
                var toRemove = System.Linq.Enumerable.ToList(System.Linq.Enumerable.Where(EditorTabs.Items.OfType<TabItem>(), t => t != ClaudeWebView.Parent));
                foreach (var t in toRemove) EditorTabs.Items.Remove(t);
            };

            var miCopyTabPath = new MenuItem { Header = "Copy File Path" };
            miCopyTabPath.Click += (s, e) => Clipboard.SetText(filePath);

            tabContextMenu.Items.Add(miCloseThis);
            tabContextMenu.Items.Add(miCloseOthers);
            tabContextMenu.Items.Add(miCloseAll);
            tabContextMenu.Items.Add(new Separator());
            tabContextMenu.Items.Add(miCopyTabPath);

            headerPanel.ContextMenu = tabContextMenu;

            headerPanel.Children.Add(iconBlock);
            headerPanel.Children.Add(titleBlock);
            headerPanel.Children.Add(closeBtn);

            // Tab Content
            UIElement tabContent;

            if (ext == ".sql")
            {
                // SQL Viewer tab
                var sqlViewer = new Controls.SqlRunnerView();
                try
                {
                    string sqlText = File.ReadAllText(filePath);
                    sqlViewer.SetSqlQuery(sqlText);
                }
                catch { }

                tabContent = sqlViewer;
            }
            else
            {
                // Rich HTML Viewer / Monaco Code Editor in WebView2
                string fileText;
                try
                {
                    fileText = File.ReadAllText(filePath);
                }
                catch (Exception ex)
                {
                    fileText = $"Error reading file: {ex.Message}";
                }

                string htmlContent = GenerateViewerHtml(filePath, fileText, ext);
                var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
                wv.Loaded += async (s, e) =>
                {
                    try
                    {
                        await wv.EnsureCoreWebView2Async();
                        wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                        wv.NavigateToString(htmlContent);
                    }
                    catch { }
                };

                tabContent = wv;
            }

            var newTab = new TabItem
            {
                Tag = filePath,
                Header = headerPanel,
                Content = tabContent
            };

            closeBtn.Click += (s, e) =>
            {
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;

            ActiveDocTitleText.Text = $" - {fileName}";
        }

        private static string GenerateViewerHtml(string filePath, string fileText, string ext)
        {
            string safePath = System.Net.WebUtility.HtmlEncode(filePath);
            long fileBytes = 0;
            try { fileBytes = new FileInfo(filePath).Length; } catch {}
            string sizeStr = fileBytes > 1024 * 1024 ? $"{fileBytes / (1024.0 * 1024.0):F2} MB" : fileBytes > 1024 ? $"{fileBytes / 1024.0:F1} KB" : $"{fileBytes} B";
            string codeJson = System.Text.Json.JsonSerializer.Serialize(fileText);

            if (ext == ".md")
            {
                string mdTemplate = @"<!DOCTYPE html>
<html>
<head>
<meta charset=""utf-8"">
<script src=""https://cdn.jsdelivr.net/npm/marked/marked.min.js""></script>
<style>
  body { background-color: #1E1E2E; color: #CDD6F4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; line-height: 1.6; }
  .toolbar { background-color: #181825; border-bottom: 1px solid #313244; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; position: sticky; top: 0; z-index: 100; }
  .path { color: #94E2D5; font-weight: 600; }
  .badge { background-color: #313244; color: #89B4FA; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .content { padding: 24px 32px; max-width: 960px; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { color: #89B4FA; border-bottom: 1px solid #313244; padding-bottom: 6px; margin-top: 24px; }
  h1 { color: #CBA6F7; }
  a { color: #89B4FA; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background-color: #181825; color: #A6E3A1; padding: 2px 6px; border-radius: 4px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background-color: #181825; border: 1px solid #313244; padding: 14px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; color: #CDD6F4; }
  blockquote { border-left: 4px solid #CBA6F7; margin: 12px 0; padding: 4px 16px; background-color: #181825; color: #BAC2DE; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #313244; padding: 8px 12px; text-align: left; }
  th { background-color: #181825; color: #89B4FA; }
  tr:nth-child(even) { background-color: #181825; }
  hr { border: none; border-top: 1px solid #313244; margin: 24px 0; }
</style>
</head>
<body>
  <div class=""toolbar"">
    <span class=""path"">📝 Markdown Preview — __PATH__</span>
    <span class=""badge"">__SIZE__</span>
  </div>
  <div class=""content"" id=""markdown-body""></div>
  <script>
    var rawMd = __CODE__;
    if (typeof marked !== 'undefined') {
      document.getElementById('markdown-body').innerHTML = marked.parse(rawMd);
    } else {
      document.getElementById('markdown-body').innerHTML = '<pre>' + rawMd.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
    }
  </script>
</body>
</html>";
                return mdTemplate.Replace("__PATH__", safePath).Replace("__SIZE__", sizeStr).Replace("__CODE__", codeJson);
            }

            // Monaco Code Editor for TypeScript (.ts, .tsx), JS, C#, XAML, JSON, CSS, etc.
            string lang = GetMonacoLanguage(ext);
            string monacoTemplate = @"<!DOCTYPE html>
<html>
<head>
  <meta charset=""utf-8"">
  <link rel=""stylesheet"" data-name=""vs/editor/editor.main"" href=""https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/editor/editor.main.css"">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background-color: #1E1E2E; font-family: 'Segoe UI', sans-serif; }
    #toolbar { height: 32px; background-color: #181825; border-bottom: 1px solid #313244; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; font-size: 12px; box-sizing: border-box; }
    .path { color: #89B4FA; font-weight: 600; }
    .badge { background-color: #313244; color: #A6E3A1; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    #editor-container { width: 100%; height: calc(100% - 32px); }
  </style>
</head>
<body>
  <div id=""toolbar"">
    <span class=""path"">⚛ __PATH__</span>
    <span class=""badge"">__SIZE__  •  Ctrl+F Find  •  Ctrl+G Go to Line</span>
  </div>
  <div id=""editor-container""></div>

  <script src=""https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.js""></script>
  <script>
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
      monaco.editor.defineTheme('catppuccin-mocha', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: '', background: '1E1E2E', foreground: 'CDD6F4' },
          { token: 'keyword', foreground: 'CBA6F7', fontStyle: 'bold' },
          { token: 'string', foreground: 'A6E3A1' },
          { token: 'number', foreground: 'FAB387' },
          { token: 'comment', foreground: '6C7086', fontStyle: 'italic' },
          { token: 'type', foreground: '89B4FA' },
          { token: 'identifier', foreground: '89DCEB' }
        ],
        colors: {
          'editor.background': '#1E1E2E',
          'editor.foreground': '#CDD6F4',
          'editorLineNumber.foreground': '#585B70',
          'editorLineNumber.activeForeground': '#89B4FA',
          'editor.selectionBackground': '#45475A',
          'editor.lineHighlightBackground': '#181825',
          'editorCursor.foreground': '#89B4FA'
        }
      });

      var editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: __CODE__,
        language: '__LANG__',
        theme: 'catppuccin-mocha',
        lineNumbers: 'on',
        renderLineHighlight: 'all',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'Consolas, ""Courier New"", monospace',
        contextmenu: true,
        minimap: { enabled: true }
      });
    });
  </script>
</body>
</html>";

            return monacoTemplate.Replace("__PATH__", safePath)
                                 .Replace("__SIZE__", sizeStr)
                                 .Replace("__LANG__", lang)
                                 .Replace("__CODE__", codeJson);
        }

        private static string GetMonacoLanguage(string ext)
        {
            switch (ext.ToLowerInvariant())
            {
                case ".ts":
                case ".tsx":
                    return "typescript";
                case ".js":
                case ".jsx":
                    return "javascript";
                case ".cs":
                    return "csharp";
                case ".xaml":
                case ".xml":
                case ".html":
                case ".htm":
                case ".csproj":
                    return "xml";
                case ".css":
                    return "css";
                case ".json":
                    return "json";
                case ".md":
                    return "markdown";
                case ".sql":
                    return "sql";
                case ".yaml":
                case ".yml":
                    return "yaml";
                case ".ps1":
                case ".bat":
                case ".sh":
                    return "powershell";
                default:
                    return "plaintext";
            }
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
