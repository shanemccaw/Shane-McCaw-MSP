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

        // ── Build Tracker API (shared by BuildQueuePanel + LeftSidebar's Issues board) ──
        private BuildConsole.Services.BuildTrackerApiClient? _buildTrackerApi;

        // ── Git #802: chat tabs + their build split panes ───────────────────────
        private class ChatTabState
        {
            public int? GithubNumber;
            public Grid SplitGrid = null!;
            public ColumnDefinition BuildColumn = null!;
            public TextBox BuildOutputBox = null!;
            public TextBlock BuildStatusText = null!;
            public int? TailingQueueItemId;
            public long TailedLength;
        }
        private readonly Dictionary<TabItem, ChatTabState> _chatTabs = new();
        private DispatcherTimer? _buildTailTimer;

        // ── Git #805: deploy-status poll (Epic #803 Phase 1) ─────────────────────
        private DispatcherTimer? _deployStatusTimer;
        private string? _lastSeenDeployCommitHash;

        // ── Git #806: test manifest runner (Epic #803 Phase 2) ───────────────────
        private BuildConsole.Services.TestManifest? _loadedManifest;

        public MainWindow()
        {
            InitializeComponent();

            // Git #815 — Shane: "put the startup SSE and api calls in
            // there... so we can just look and see whats happening as its
            // happening in the background. This should be multi-threaded so
            // my app doesnt hang." ActivityLog.Log() never blocks its caller
            // (BeginInvoke onto the UI thread) - safe to call from any
            // background await continuation, which is exactly where every
            // real API call in this app runs.
            BuildConsole.Services.ActivityLog.Attach(Dispatcher);
            BuildConsole.Services.ActivityLog.LineLogged += AppendOutputLog;
            BuildConsole.Services.ActivityLog.Log("startup", "BuildConsole starting…");

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

            _ = InitializeClaudeTabAsync();

            // Build Queue selection -> Build Log
            BuildQueuePanel.TaskSelected += BuildQueuePanel_TaskSelected;

            // Shane: "Feel free to change anything to patch how I actually work
            // based on the Add-In." One shared API client, reading the SAME
            // config scripts/build-queue-watcher.ps1 already uses (no separate
            // setup step) - both the queue panel and the left sidebar's real
            // Issues board are driven by it, same backend the extension talks to.
            var btConfig = BuildConsole.Services.BuildTrackerConfig.Load();
            BuildConsole.Services.ActivityLog.Log("startup", btConfig.IsConfigured
                ? $"Config loaded: {btConfig.ApiBaseUrl}"
                : $"Config NOT found/incomplete (checked {BuildConsole.Services.BuildTrackerConfig.FindConfigPath() ?? "scripts\\build-queue-watcher.config.json"}) — panels will show 'Not connected'.");
            _buildTrackerApi = new BuildConsole.Services.BuildTrackerApiClient(btConfig);
            BuildQueuePanel.Initialize(_buildTrackerApi);
            LeftSidebar.Initialize(_buildTrackerApi);
            SqlRunnerView.Initialize(_buildTrackerApi);

            // Git #815 — surfaces a failed poll as a real, visible signal
            // (status-bar QueueDot/QueueStatusText, previously unused
            // hardcoded XAML) instead of silent inline tree text nobody
            // notices, PLUS every poll's outcome goes to the Output log too.
            LeftSidebar.SyncError += (s, err) => ReportSyncStatus(err);
            BuildQueuePanel.SyncError += (s, err) => ReportSyncStatus(err);

            // Git #802 - Shane: "The Claude chats should open in their own
            // tabs. And if there is a build, that tab should split with the
            // build happening right there in that chats tab." Each chat gets
            // its own WebView2 tab (not the single shared ClaudeWebView
            // anymore); a shared timer watches the queue and splits/unsplits
            // each open chat tab based on whether ITS linked GitHub number has
            // a currently-running queue item ("still go through the queue" —
            // Shane's own answer when asked whether this should bypass it).
            LeftSidebar.ChatSelected += (s, e) => OpenChatTab(e.Chat, e.GithubNumber);
            _buildTailTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _buildTailTimer.Tick += async (_, _) => await PollChatTabBuildStateAsync();
            _buildTailTimer.Start();

            // Git #805 — Epic #803 Phase 1: "polling, not webhook/SSE... follow
            // the existing pattern." Same 3s DispatcherTimer shape as
            // _buildTailTimer above, hitting the new GET /api/internal/deploy-status
            // endpoint. A changed commitHash from the last-seen value IS the
            // "deploy complete" signal - no separate push mechanism needed.
            _deployStatusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            _deployStatusTimer.Tick += async (_, _) => await PollDeployStatusAsync();
            _deployStatusTimer.Start();

            // Shane To-Do "Load SQL" -> real GitHub file content into the SQL Runner tab (index 2 in BottomTabs — Build Log, Terminal, SQL Runner, Output).
            LeftSidebar.SqlLoadRequested += (s, path) =>
            {
                SetBottomPanel(true, 2);
                SqlRunnerView.LoadFromGitHub(path);
            };

            // Git #806 (Epic #803 Phase 2) — tracks the manifest last loaded via the
            // Automation sidebar's Load Manifest button for Menu > Run > "Run Tests (Current Issue)".
            LeftSidebar.ManifestLoaded += (s, manifest) => _loadedManifest = manifest;

            // Git #827 — LeftSidebar's Automation sidebar raises these three events, and
            // MainWindow already had correct handlers for all of them, but none were ever
            // subscribed: the Play button (and Start/Stop Recording) did nothing.
            LeftSidebar.PlayTestRequested += LeftSidebar_PlayTestRequested;
            LeftSidebar.StartRecordingRequested += LeftSidebar_StartRecordingRequested;
            LeftSidebar.StopRecordingRequested += LeftSidebar_StopRecordingRequested;

            // ActivityBar quick navigation
            ActivityBar.QuickNavRequested += ActivityBar_QuickNavRequested;

            // LeftSidebar file clicks -> Open Viewer tabs
            LeftSidebar.FileSelected += LeftSidebar_FileSelected;

            // Panel Pin / Unpin handlers
            LeftSidebar.PinToggled += (s, isPinned) =>
            {
                ColSidebar.Width = isPinned ? new GridLength(260) : new GridLength(0);
                SidebarSplitter.Visibility = isPinned ? Visibility.Visible : Visibility.Collapsed;
            };

            BuildQueuePanel.PinToggled += (s, isPinned) =>
            {
                ColQueue.Width = isPinned ? new GridLength(300) : new GridLength(0);
            };

            if (EditorTabs.Items.Count > 0 && EditorTabs.Items[0] is TabItem claudeTab)
            {
                AttachTabContextMenu(claudeTab, EditorTabs);
            }

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

        // ── Window Preview Key Handlers for Ctrl+K and Ctrl+Tab ─────────────────
        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.K && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                ToggleCommandPalette();
            }
            else if (e.Key == Key.Tab && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                bool isReverse = (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift;
                ShowTabSwitcher(isReverse);
            }
            else if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    CommandPaletteOverlay.Visibility = Visibility.Collapsed;
                }
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

            // Hide active WebView2 HWND to fix WPF Airspace overlap
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Hidden;

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

            // Restore active WebView2 HWND visibility
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Visible;

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

        private void LeftSidebar_StartRecordingRequested(object? sender, string targetUrl)
        {
            if (string.IsNullOrWhiteSpace(targetUrl))
            {
                targetUrl = "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/";
            }

            if (!targetUrl.StartsWith("http://") && !targetUrl.StartsWith("https://"))
            {
                targetUrl = "https://" + targetUrl;
            }

            // Automatically open live web browser tab in editor area
            OpenWebTab(targetUrl, "Recorder Browser", "\uE774");

            var wv = GetActiveWebView();
            if (wv != null)
            {
                wv.Loaded += (s, e) => InjectRecorderScript(wv);
                if (wv.CoreWebView2 != null)
                {
                    InjectRecorderScript(wv);
                }
            }
        }

        private void InjectRecorderScript(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            if (wv.CoreWebView2 == null) return;

            wv.WebMessageReceived -= Wv_WebMessageReceived;
            wv.WebMessageReceived += Wv_WebMessageReceived;

            string recorderJs = @"
(function() {
    if (window.__uiRecorderInjected) {
        window.__isRecordingUI = true;
        return;
    }
    window.__uiRecorderInjected = true;
    window.__isRecordingUI = true;

    function getSelector(el) {
        if (!el) return '';
        if (el.id) return '#' + el.id;
        if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name=""' + el.getAttribute('name') + '""]';
        if (el.className && typeof el.className === 'string') {
            let cls = el.className.trim().split(/\s+/).join('.');
            if (cls) return el.tagName.toLowerCase() + '.' + cls;
        }
        return el.tagName.toLowerCase();
    }

    document.addEventListener('click', function(e) {
        if (!window.__isRecordingUI) return;
        let el = e.target;
        let sel = getSelector(el);
        let txt = (el.innerText || el.value || '').trim().substring(0, 40);
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'RECORD_ACTION',
            action: 'click',
            selector: sel,
            tagName: el.tagName.toLowerCase(),
            value: txt
        }));
    }, true);

    document.addEventListener('change', function(e) {
        if (!window.__isRecordingUI) return;
        let el = e.target;
        let sel = getSelector(el);
        window.chrome.webview.postMessage(JSON.stringify({
            type: 'RECORD_ACTION',
            action: 'input',
            selector: sel,
            tagName: el.tagName.toLowerCase(),
            value: el.value
        }));
    }, true);
})();";
            wv.ExecuteScriptAsync(recorderJs);
        }

        private void LeftSidebar_StopRecordingRequested(object? sender, EventArgs e)
        {
            var wv = GetActiveWebView();
            if (wv != null && wv.CoreWebView2 != null)
            {
                wv.ExecuteScriptAsync("window.__isRecordingUI = false;");
            }
        }

        // Git #810 — the manual "Play" button (Automation sidebar) used to open the standalone
        // AutomationRunnerWindow popup; it now drives the same UiTestExecutor directly through
        // the Test Results tab's own WebView2, so both manual and manifest-driven UI runs share
        // one telemetry stream and the popup is retired entirely.
        private void LeftSidebar_PlayTestRequested(object? sender, (string url, List<Controls.AutomationAction> steps) e)
        {
            SetBottomPanel(true, 4);
            TestResultsView.Clear();
            _ = TestResultsView.RunUiTestAsync(e.url, e.steps);
        }

        private void Wv_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;

                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "RECORD_ACTION")
                {
                    string action = root.GetProperty("action").GetString() ?? "click";
                    string selector = root.GetProperty("selector").GetString() ?? "";
                    string tagName = root.GetProperty("tagName").GetString() ?? "div";
                    string val = root.TryGetProperty("value", out var vProp) ? (vProp.GetString() ?? "") : "";

                    Dispatcher.Invoke(() =>
                    {
                        LeftSidebar.RecordAction(action, selector, tagName, val);
                    });
                }
            }
            catch { }
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
            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;

            wv.Loaded += async (s, e) =>
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);
                if (ready)
                {
                    wv.CoreWebView2.Navigate(url);
                }
            };

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

            AttachTabContextMenu(newTab, EditorTabs);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        // ── Git #802: chat tabs (own WebView2 per chat) + build split pane ──────
        public void OpenChatTab(BuildConsole.Services.BoardChat chat, int? githubNumber)
        {
            // Dedupe on the chat's own id, not the URL - a chat's ClaudeUrl
            // doesn't change, so this is equivalent, but keeps the intent clear.
            foreach (var kvp in _chatTabs)
            {
                if (kvp.Key.Tag is BuildConsole.Services.BoardChat existing &&
                    existing.ConversationId == chat.ConversationId)
                {
                    EditorTabs.SelectedItem = kvp.Key;
                    return;
                }
            }

            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            headerPanel.Children.Add(new TextBlock
            {
                Text = "", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("BlueBrush")
            });
            headerPanel.Children.Add(new TextBlock
            {
                Text = chat.Title, FontSize = 13, Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)FindResource("TextBrush")
            });
            var closeBtn = new Button
            {
                Content = "✕", Style = (Style)FindResource("IconButton"), FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1), Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab", VerticalAlignment = VerticalAlignment.Center
            };
            headerPanel.Children.Add(closeBtn);

            var wv = new Microsoft.Web.WebView2.Wpf.WebView2();
            wv.NavigationStarting  += WebView_NavigationStarting;
            wv.NavigationCompleted += WebView_NavigationCompleted;
            wv.SourceChanged       += WebView_SourceChanged;
            wv.Loaded += async (s, e) =>
            {
                await InjectBuilderButtonsAsync(wv);
                if (wv.CoreWebView2 != null) wv.CoreWebView2.Navigate(chat.ClaudeUrl);
            };

            // Split grid: chat WebView2 in column 0, build output pane in
            // column 1 (starts collapsed - PollChatTabBuildStateAsync opens it
            // the moment a matching queue item goes 'running', closes it again
            // once that item finishes).
            var splitGrid = new Grid();
            var col0 = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) };
            var buildCol = new ColumnDefinition { Width = new GridLength(0) };
            splitGrid.ColumnDefinitions.Add(col0);
            splitGrid.ColumnDefinitions.Add(buildCol);
            Grid.SetColumn(wv, 0);
            splitGrid.Children.Add(wv);

            var buildPane = new Grid { Background = (Brush)FindResource("MantleBrush") };
            buildPane.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            buildPane.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var buildHeader = new Border
            {
                Background = (Brush)FindResource("CrustBrush"), Padding = new Thickness(8, 5, 8, 5),
                BorderBrush = (Brush)FindResource("Surface0Brush"), BorderThickness = new Thickness(0, 0, 0, 1)
            };
            var buildStatusText = new TextBlock
            {
                Text = "Build running…", FontSize = 11, FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("PeachBrush")
            };
            buildHeader.Child = buildStatusText;
            var buildOutputBox = new TextBox
            {
                IsReadOnly = true, Style = (Style)TryFindResource("TerminalOutputBox"),
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            Grid.SetRow(buildHeader, 0);
            Grid.SetRow(buildOutputBox, 1);
            buildPane.Children.Add(buildHeader);
            buildPane.Children.Add(buildOutputBox);

            var buildPaneSplitter = new GridSplitter { Width = 4, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Stretch };
            Grid.SetColumn(buildPane, 1);
            Grid.SetColumn(buildPaneSplitter, 1);
            splitGrid.Children.Add(buildPaneSplitter);
            splitGrid.Children.Add(buildPane);

            var newTab = new TabItem { Tag = chat, Header = headerPanel, Content = splitGrid };
            var state = new ChatTabState
            {
                GithubNumber = githubNumber,
                SplitGrid = splitGrid,
                BuildColumn = buildCol,
                BuildOutputBox = buildOutputBox,
                BuildStatusText = buildStatusText
            };
            _chatTabs[newTab] = state;

            closeBtn.Click += (s, e) =>
            {
                _chatTabs.Remove(newTab);
                EditorTabs.Items.Remove(newTab);
                if (EditorTabs.Items.Count > 0)
                    EditorTabs.SelectedIndex = Math.Max(0, EditorTabs.Items.Count - 1);
            };

            AttachTabContextMenu(newTab, EditorTabs);
            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        /// <summary>
        /// Git #802 - polls the real queue (same endpoint BuildQueuePanel
        /// already polls) and, for every open chat tab, opens/updates/closes
        /// its build split pane based on whether a queue item with a matching
        /// githubNumber is running. Tails scripts/build-queue-watcher.ps1's
        /// per-item log file (BuildLogPaths.ForQueueItem) rather than spawning
        /// anything itself - the build stays entirely the queue/watcher's.
        /// </summary>
        private async System.Threading.Tasks.Task PollChatTabBuildStateAsync()
        {
            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured || _chatTabs.Count == 0) return;

            List<BuildConsole.Services.QueueItem> queue;
            try { queue = await _buildTrackerApi.GetQueueAsync(); }
            catch { return; }

            foreach (var (tab, state) in _chatTabs.ToList())
            {
                if (state.GithubNumber == null) continue;

                var match = queue.FirstOrDefault(q => q.GithubNumber == state.GithubNumber && q.Status == "running");
                if (match == null)
                {
                    if (state.BuildColumn.Width.Value > 0)
                    {
                        state.BuildColumn.Width = new GridLength(0);
                        state.TailingQueueItemId = null;
                        state.TailedLength = 0;
                    }
                    continue;
                }

                if (state.BuildColumn.Width.Value == 0)
                {
                    state.BuildColumn.Width = new GridLength(420);
                }
                if (state.TailingQueueItemId != match.Id)
                {
                    state.TailingQueueItemId = match.Id;
                    state.TailedLength = 0;
                    state.BuildOutputBox.Text = "";
                    state.BuildStatusText.Text = $"▶ Building: {match.Title}";
                }

                TailBuildLog(state);
            }
        }

        /// <summary>
        /// Git #805 — polls GET /api/internal/deploy-status every 3s (same
        /// interval as PollChatTabBuildStateAsync above) and treats a changed
        /// commitHash from the last one this app has seen as "deploy complete".
        /// The first successful poll after startup only seeds the baseline -
        /// it deliberately does NOT fire a "deploy complete" line, since there
        /// was no prior deploy this app watched to compare against.
        /// </summary>
        private async System.Threading.Tasks.Task PollDeployStatusAsync()
        {
            if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured) return;

            BuildConsole.Services.DeployStatus? status;
            try
            {
                status = await _buildTrackerApi.GetDeployStatusAsync();
            }
            catch (Exception ex)
            {
                ReportDeployStatus(ex.Message);
                return;
            }

            if (status == null || string.IsNullOrWhiteSpace(status.CommitHash))
            {
                ReportDeployStatus("empty deploy-status response");
                return;
            }

            if (_lastSeenDeployCommitHash != null && _lastSeenDeployCommitHash != status.CommitHash)
            {
                BuildConsole.Services.ActivityLog.Log("deploy",
                    $"Deploy complete: {_lastSeenDeployCommitHash} -> {status.CommitHash} ({status.Timestamp})");
                DeployStatusText.Text = $"Deploy: {status.CommitHash} (complete)";
            }
            else
            {
                DeployStatusText.Text = $"Deploy: {status.CommitHash}";
            }

            _lastSeenDeployCommitHash = status.CommitHash;
            DeployDot.Fill = DotReady;
        }

        /// <summary>Git #805 — same visible-indicator pattern as Git #815's ReportSyncStatus: a failed poll turns the status-bar dot red with the error inline, PLUS the full text goes to the Output log, instead of failing silently.</summary>
        private void ReportDeployStatus(string error)
        {
            DeployDot.Fill = DotError;
            DeployStatusText.Text = $"Deploy sync error: {error}";
            BuildConsole.Services.ActivityLog.Log("deploy", $"FAILED: {error}");
        }

        private static void TailBuildLog(ChatTabState state)
        {
            if (state.TailingQueueItemId == null) return;
            var path = BuildConsole.Services.BuildLogPaths.ForQueueItem(state.TailingQueueItemId.Value);
            try
            {
                if (!File.Exists(path)) return;
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (fs.Length <= state.TailedLength) return;
                fs.Seek(state.TailedLength, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                string newText = reader.ReadToEnd();
                state.TailedLength = fs.Length;
                state.BuildOutputBox.AppendText(newText);
                state.BuildOutputBox.ScrollToEnd();
            }
            catch { /* file locked mid-write by the watcher - just retry next tick */ }
        }

        private void AttachTabContextMenu(TabItem tabItem, TabControl ownerTabControl)
        {
            var cm = new ContextMenu();

            // 1. Close
            var miClose = new MenuItem { Header = "Close", InputGestureText = "Ctrl+W" };
            miClose.Click += (s, e) => CloseTab(tabItem, ownerTabControl);
            cm.Items.Add(miClose);

            // 2. Close Others
            var miCloseOthers = new MenuItem { Header = "Close Others" };
            miCloseOthers.Click += (s, e) =>
            {
                var others = ownerTabControl.Items.OfType<TabItem>().Where(t => t != tabItem).ToList();
                foreach (var t in others)
                {
                    ownerTabControl.Items.Remove(t);
                }
            };
            cm.Items.Add(miCloseOthers);

            // 3. Close to the Right
            var miCloseRight = new MenuItem { Header = "Close to the Right" };
            miCloseRight.Click += (s, e) =>
            {
                int idx = ownerTabControl.Items.IndexOf(tabItem);
                if (idx >= 0)
                {
                    var itemsRight = ownerTabControl.Items.OfType<TabItem>().Skip(idx + 1).ToList();
                    foreach (var t in itemsRight)
                    {
                        ownerTabControl.Items.Remove(t);
                    }
                }
            };
            cm.Items.Add(miCloseRight);

            // 4. Close Saved
            var miCloseSaved = new MenuItem { Header = "Close Saved" };
            miCloseSaved.Click += (s, e) =>
            {
                var savedTabs = ownerTabControl.Items.OfType<TabItem>().Where(t => !(t.Tag?.ToString()?.EndsWith("*") ?? false)).ToList();
                foreach (var t in savedTabs)
                {
                    ownerTabControl.Items.Remove(t);
                }
            };
            cm.Items.Add(miCloseSaved);

            // 5. Close All
            var miCloseAll = new MenuItem { Header = "Close All" };
            miCloseAll.Click += (s, e) =>
            {
                ownerTabControl.Items.Clear();
            };
            cm.Items.Add(miCloseAll);

            cm.Items.Add(new Separator());

            // 6. Copy Path
            var miCopyPath = new MenuItem { Header = "Copy Path" };
            miCopyPath.Click += (s, e) =>
            {
                string path = tabItem.Tag?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(path))
                {
                    try { Clipboard.SetText(path); } catch { }
                }
            };
            cm.Items.Add(miCopyPath);

            // 7. Open in Explorer
            var miOpenExplorer = new MenuItem { Header = "Open in Explorer" };
            miOpenExplorer.Click += (s, e) =>
            {
                string path = tabItem.Tag?.ToString() ?? string.Empty;
                if (!string.IsNullOrEmpty(path))
                {
                    try
                    {
                        if (File.Exists(path))
                        {
                            System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{path}\"");
                        }
                        else if (Directory.Exists(path))
                        {
                            System.Diagnostics.Process.Start("explorer.exe", $"\"{path}\"");
                        }
                        else if (Uri.TryCreate(path, UriKind.Absolute, out var uri))
                        {
                            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
                        }
                    }
                    catch { }
                }
            };
            cm.Items.Add(miOpenExplorer);

            tabItem.ContextMenu = cm;
            if (tabItem.Header is FrameworkElement feHeader)
            {
                feHeader.ContextMenu = cm;
            }
        }

        private void CloseTab(TabItem tabItem, TabControl ownerTabControl)
        {
            ownerTabControl.Items.Remove(tabItem);
            if (ownerTabControl.Items.Count > 0)
            {
                ownerTabControl.SelectedIndex = Math.Max(0, ownerTabControl.Items.Count - 1);
            }
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
                    bool ready = await EnsureWebViewInitializedAsync(wv);
                    if (ready)
                    {
                        wv.CoreWebView2.NavigateToString(htmlContent);
                    }
                };

                tabContent = wv;
            }

            var newTab = new TabItem
            {
                Tag = filePath,
                Header = headerPanel,
                Content = tabContent
            };

            AttachTabContextMenu(newTab, EditorTabs);

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
            // VS Code behavior: clicking the already-active icon collapses the sidebar
            if (ColSidebar.Width.Value > 0 && LeftSidebar.GetCurrentView() == view)
            {
                ColSidebar.Width = new GridLength(0);
                SidebarSplitter.Visibility = Visibility.Collapsed;
            }
            else
            {
                if (ColSidebar.Width.Value == 0)
                {
                    ColSidebar.Width = new GridLength(DefaultSidebarWidth);
                    SidebarSplitter.Visibility = Visibility.Visible;
                    LeftSidebar.ExpandPanel();
                }
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

        // ── Git #815: live Output log + sync status indicator ──────────────────
        private const int MaxOutputLogChars = 200_000;

        private void AppendOutputLog(string line)
        {
            if (OutputLogBox.Text == "[Output] Waiting for activity…") OutputLogBox.Clear();
            OutputLogBox.AppendText(line + Environment.NewLine);
            if (OutputLogBox.Text.Length > MaxOutputLogChars)
            {
                OutputLogBox.Text = OutputLogBox.Text.Substring(OutputLogBox.Text.Length - MaxOutputLogChars);
            }
            OutputLogBox.ScrollToEnd();
        }

        /// <summary>null = last poll succeeded (green "live"); a message = last poll failed (red, message shown + full text in the Output log).</summary>
        private void ReportSyncStatus(string? error)
        {
            if (error == null)
            {
                QueueDot.Fill = DotReady;
                QueueStatusText.Text = "Sync: live";
            }
            else
            {
                QueueDot.Fill = DotError;
                QueueStatusText.Text = $"Sync error: {error}";
                BuildConsole.Services.ActivityLog.Log("sync", $"FAILED: {error}");
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

        // Git #817 — Shane: "the very first browser that opens is hard
        // stuck... that Claude works I'm logged in every time" (others
        // don't). Root cause: this was `if (_sharedWv2Env == null) {
        // _sharedWv2Env = await CreateAsync(...); }` — a check-then-assign
        // that is NOT safe against a second call arriving while the first
        // `await CreateAsync` is still pending (which happens routinely:
        // ClaudeWebView initializes at startup, then Shane opens a chat tab
        // seconds later before that first await has resolved). A second
        // concurrent CoreWebView2Environment.CreateAsync() against the SAME
        // user data folder while the first is still opening it does NOT
        // reliably hand back the same live session — cookies then don't
        // sync in real time between "whichever one won the race" and
        // everything after it, and AddScriptToExecuteOnDocumentCreatedAsync
        // on a WebView2 whose environment call got stuck behind that race
        // can also lose its window to run before the first navigation.
        // Caching the in-flight Task itself (not the eventual result) closes
        // the window: every caller awaits the exact same task, so there is
        // only ever one CreateAsync call for the app's whole lifetime.
        private static System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment>? _sharedWv2EnvTask;

        private static System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment> GetSharedWebView2EnvironmentAsync()
        {
            _sharedWv2EnvTask ??= CreateSharedWebView2EnvironmentAsync();
            return _sharedWv2EnvTask;
        }

        private static async System.Threading.Tasks.Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment> CreateSharedWebView2EnvironmentAsync()
        {
            string userDataDir = Path.Combine(Path.GetTempPath(), "BuildConsole_WebView2");
            Directory.CreateDirectory(userDataDir);
            BuildConsole.Services.ActivityLog.Log("startup", $"Creating shared WebView2 environment ({userDataDir})…");
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataDir);
            BuildConsole.Services.ActivityLog.Log("startup", "Shared WebView2 environment ready.");
            return env;
        }

        private static async System.Threading.Tasks.Task<bool> EnsureWebViewInitializedAsync(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            try
            {
                if (wv.CoreWebView2 != null) return true;

                var env = await GetSharedWebView2EnvironmentAsync();
                await wv.EnsureCoreWebView2Async(env);
                if (wv.CoreWebView2 != null)
                {
                    wv.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                    return true;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WebView2 init error: {ex.Message}");
                BuildConsole.Services.ActivityLog.Log("startup", $"WebView2 init error: {ex.Message}");
            }
            return false;
        }

        /// <summary>
        /// Git #814 — Shane: "can I use it like the addon? with the UI
        /// elements in the Chat?" Injects content.js's "Send to Builder" /
        /// "Queue" button bar into a claude.ai WebView2 via
        /// AddScriptToExecuteOnDocumentCreatedAsync (WPF's equivalent of a
        /// browser content script) - only meaningful on claude.ai itself, so
        /// callers should only use this for the Claude tab and per-chat tabs,
        /// not the generic OpenWebTab/OpenFileTab viewers.
        /// </summary>
        private async System.Threading.Tasks.Task<bool> InjectBuilderButtonsAsync(Microsoft.Web.WebView2.Wpf.WebView2 wv)
        {
            try
            {
                bool ready = await EnsureWebViewInitializedAsync(wv);
                if (!ready) return false;
                // Git #817 - MUST happen before the WebView2 navigates anywhere
                // (that's the whole reason ClaudeWebView's XAML Source binding
                // got removed - see the wv2:WebView2 declaration) - a script
                // added after navigation starts only applies to the NEXT one.
                await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BuildConsole.Services.ChatButtonInjector.Script);
                wv.WebMessageReceived -= ChatWv_WebMessageReceived;
                wv.WebMessageReceived += ChatWv_WebMessageReceived;
                return true;
            }
            catch { return false; }
        }

        /// <summary>Git #817 — injects the builder buttons into ClaudeWebView BEFORE navigating it to claude.ai for the first time (the XAML Source binding that used to do this navigated too early).</summary>
        private async System.Threading.Tasks.Task InitializeClaudeTabAsync()
        {
            await InjectBuilderButtonsAsync(ClaudeWebView);
            if (ClaudeWebView.CoreWebView2 != null) ClaudeWebView.CoreWebView2.Navigate("https://claude.ai");
            else ClaudeWebView.Source = new Uri("https://claude.ai");
        }

        /// <summary>
        /// Git #814 — the injected script's bridge back to the app (it can't
        /// reach chrome.runtime/chrome.storage since it isn't a browser
        /// extension). BT_SEND_TO_BUILDER reuses the exact same mybuilder://
        /// URI + OS-registered handler the browser extension already
        /// launches through, so behavior stays identical either way.
        /// BT_QUEUE_BUILD calls the real queue API directly (the app already
        /// holds the same client BuildQueuePanel/LeftSidebar use).
        /// </summary>
        private async void ChatWv_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                string type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";

                string? Str(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
                int? Int(string prop) => root.TryGetProperty(prop, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetInt32() : null;

                if (type == "BT_SEND_TO_BUILDER")
                {
                    var q = new List<string>();
                    void Add(string key, string? val) { if (!string.IsNullOrEmpty(val)) q.Add($"{key}={Uri.EscapeDataString(val)}"); }
                    Add("q", Str("prompt"));
                    Add("title", Str("title"));
                    Add("model", Str("model"));
                    Add("effort", Str("effort"));
                    Add("cwd", Str("cwd"));
                    Add("mode", Str("mode"));
                    var uri = $"mybuilder://open?{string.Join("&", q)}";
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
                }
                else if (type == "BT_QUEUE_BUILD")
                {
                    if (_buildTrackerApi == null || !_buildTrackerApi.IsConfigured)
                    {
                        MessageBox.Show("Not connected — see Settings.", "Queue Build");
                        return;
                    }
                    List<int>? blockedByNumbers = null;
                    if (root.TryGetProperty("blockedByNumbers", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
                    {
                        blockedByNumbers = arr.EnumerateArray().Select(x => x.GetInt32()).ToList();
                    }
                    var res = await _buildTrackerApi.QueueBuildAsync(
                        Str("title") ?? "Untitled", Str("prompt") ?? "", Str("model"), Str("effort"), Str("cwd"), Int("githubNumber"), blockedByNumbers);
                    if (!res.IsSuccessStatusCode)
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        MessageBox.Show($"Couldn't queue build: {body}", "Queue Build");
                    }
                    else
                    {
                        await BuildQueuePanel.RefreshAsync();
                    }
                }
                else if (type == "BT_LOAD_SQL")
                {
                    SetBottomPanel(true, tabIndex: 2);
                    SqlRunnerView.SetSqlQuery(Str("sql") ?? "");
                }
            }
            catch { }
        }

        // ── Menu: Help ────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => GetActiveWebView().CoreWebView2?.OpenDevToolsWindow();

        // ── Command Palette (Ctrl+K) logic ──────────────────────────────────
        private readonly List<PaletteItem> _allPaletteItems = new();

        private void ToggleCommandPalette()
        {
            if (CommandPaletteOverlay.Visibility == Visibility.Visible)
            {
                HideCommandPalette();
            }
            else
            {
                ShowCommandPalette();
            }
        }

        private void ShowCommandPalette()
        {
            BuildPaletteItems();

            // Hide active WebView2 HWND to fix WPF Airspace overlap
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Hidden;

            CommandPaletteOverlay.Visibility = Visibility.Visible;
            PaletteSearchBox.Text = string.Empty;
            PerformPaletteSearch();

            Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
            {
                PaletteSearchBox.Focus();
                Keyboard.Focus(PaletteSearchBox);
            }));
        }

        private void HideCommandPalette()
        {
            CommandPaletteOverlay.Visibility = Visibility.Collapsed;

            // Restore active WebView2 HWND visibility
            var activeWv = GetActiveWebView();
            if (activeWv != null) activeWv.Visibility = Visibility.Visible;
        }

        private void CommandPaletteOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.OriginalSource == CommandPaletteOverlay)
            {
                HideCommandPalette();
            }
        }

        private void BuildPaletteItems()
        {
            _allPaletteItems.Clear();

            // 1. Files - Safe non-blocking file search
            try
            {
                string repoDir = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";
                if (Directory.Exists(repoDir))
                {
                    var opt = new EnumerationOptions
                    {
                        IgnoreInaccessible = true,
                        RecurseSubdirectories = true,
                        MaxRecursionDepth = 6
                    };

                    foreach (var f in Directory.EnumerateFiles(repoDir, "*.*", opt))
                    {
                        string name = Path.GetFileName(f);
                        if (name.StartsWith(".") || f.Contains("\\bin\\") || f.Contains("\\obj\\") || f.Contains("\\node_modules\\") || f.Contains("\\.git\\"))
                            continue;

                        string ext = Path.GetExtension(f).ToLowerInvariant();
                        string icon = ext switch
                        {
                            ".cs" => "⚡",
                            ".xaml" => "🎨",
                            ".ts" or ".tsx" or ".js" or ".jsx" => "⚛",
                            ".json" => "⚙",
                            ".sql" => "🗄️",
                            ".md" => "📝",
                            _ => "📄"
                        };

                        _allPaletteItems.Add(new PaletteItem
                        {
                            Category = "Files",
                            Icon = icon,
                            Title = name,
                            Description = f,
                            ExecuteAction = () => OpenFileTab(f)
                        });

                        if (_allPaletteItems.Count >= 100) break;
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Palette file scan error: {ex.Message}");
            }

            // 2. Chats
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "Antigravity IDE layout & Catppuccin theme", Description = "Active pairing chat session", ExecuteAction = () => LeftSidebar.SwitchView("Chats") });
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "TreeViewUsability & Mouse Wheel Fix", Description = "File Explorer smooth scroll discussion", ExecuteAction = () => LeftSidebar.SwitchView("Chats") });
            _allPaletteItems.Add(new PaletteItem { Category = "Chats", Icon = "💬", Title = "UI Automation & Web Recorder Test", Description = "Recorded Web UI Test suite", ExecuteAction = () => LeftSidebar.SwitchView("Automation") });

            // 3. Builds
            _allPaletteItems.Add(new PaletteItem { Category = "Builds", Icon = "📦", Title = "dotnet build --configuration Release", Description = "Build desktop console application", ExecuteAction = () => SetBottomPanel(true, 0) });
            _allPaletteItems.Add(new PaletteItem { Category = "Builds", Icon = "📦", Title = "Compile MSP Backend & Portal Services", Description = "Full solution build queue", ExecuteAction = () => SetBottomPanel(true, 0) });

            // 4. Automation Tests
            _allPaletteItems.Add(new PaletteItem { Category = "Automation", Icon = "⚡", Title = "Public Facing Website Smoke Test", Description = "Target: https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/", ExecuteAction = () => LeftSidebar.SwitchView("Automation") });
            _allPaletteItems.Add(new PaletteItem { Category = "Automation", Icon = "⚡", Title = "Admin Panel v2 Navigation Test", Description = "Target: https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/admin-panel/adminv2", ExecuteAction = () => OpenWebTab("https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/admin-panel/adminv2", "Admin Center", "\uE7EF") });

            // 5. Git
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git status", Description = "Check working tree status", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git status"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git pull", Description = "Fetch and merge changes", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git pull"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git push", Description = "Push local commits", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git push"); } });
            _allPaletteItems.Add(new PaletteItem { Category = "Git", Icon = "🔀", Title = "git log", Description = "View commit history log", ExecuteAction = () => { SetBottomPanel(true, 1); TerminalView.SetCommand("git log --oneline -20"); } });
        }

        private void PerformPaletteSearch()
        {
            if (PaletteSearchBox == null || PaletteResultsList == null) return;

            string query = PaletteSearchBox.Text?.Trim().ToLowerInvariant() ?? string.Empty;
            string selectedCat = "All";
            if (ChipFiles?.IsChecked == true) selectedCat = "Files";
            else if (ChipChats?.IsChecked == true) selectedCat = "Chats";
            else if (ChipBuilds?.IsChecked == true) selectedCat = "Builds";
            else if (ChipAutomation?.IsChecked == true) selectedCat = "Automation";
            else if (ChipGit?.IsChecked == true) selectedCat = "Git";

            var filtered = _allPaletteItems.Where(item =>
            {
                if (selectedCat != "All" && !item.Category.Equals(selectedCat, StringComparison.OrdinalIgnoreCase))
                    return false;

                if (string.IsNullOrEmpty(query)) return true;

                return item.Title.ToLowerInvariant().Contains(query) ||
                       item.Description.ToLowerInvariant().Contains(query) ||
                       item.Category.ToLowerInvariant().Contains(query);
            }).ToList();

            PaletteResultsList.ItemsSource = filtered;
            if (filtered.Count > 0)
                PaletteResultsList.SelectedIndex = 0;
        }

        private void PaletteSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            PerformPaletteSearch();
        }

        private void PaletteChip_Click(object sender, RoutedEventArgs e)
        {
            PerformPaletteSearch();
        }

        private void PaletteSearchBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Down)
            {
                e.Handled = true;
                if (PaletteResultsList.Items.Count > 0)
                    PaletteResultsList.SelectedIndex = Math.Min(PaletteResultsList.SelectedIndex + 1, PaletteResultsList.Items.Count - 1);
            }
            else if (e.Key == Key.Up)
            {
                e.Handled = true;
                if (PaletteResultsList.Items.Count > 0)
                    PaletteResultsList.SelectedIndex = Math.Max(PaletteResultsList.SelectedIndex - 1, 0);
            }
            else if (e.Key == Key.Return)
            {
                e.Handled = true;
                ExecuteSelectedPaletteItem();
            }
            else if (e.Key == Key.Escape)
            {
                e.Handled = true;
                HideCommandPalette();
            }
        }

        private void PaletteResultsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
        {
            ExecuteSelectedPaletteItem();
        }

        private void ExecuteSelectedPaletteItem()
        {
            if (PaletteResultsList.SelectedItem is PaletteItem item)
            {
                HideCommandPalette();
                item.ExecuteAction?.Invoke();
            }
        }

        // ── SPLIT SCREEN GRID LAYOUT ENGINE ────────────────────────────────
        private string _currentLayoutMode = "Single";

        private void BtnLayout_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string mode)
            {
                SetLayoutMode(mode);
            }
        }

        private void DockTarget_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string mode)
            {
                SetLayoutMode(mode.StartsWith("SplitH") ? "SplitH" : mode);
                DockGuideOverlay.Visibility = Visibility.Collapsed;
            }
        }

        public void SetLayoutMode(string mode)
        {
            _currentLayoutMode = mode;

            switch (mode)
            {
                case "Single":
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(0);
                    PaneCol1.Width = new GridLength(0);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(0);
                    PaneRow1.Height = new GridLength(0);

                    PaneGridSplitterH.Visibility = Visibility.Collapsed;
                    PaneGridSplitterV.Visibility = Visibility.Collapsed;

                    EditorTabs2.Visibility = Visibility.Collapsed;
                    EditorTabs3.Visibility = Visibility.Collapsed;
                    EditorTabs4.Visibility = Visibility.Collapsed;

                    // Move all items back to EditorTabs
                    MoveAllTabsToTarget(EditorTabs2, EditorTabs);
                    MoveAllTabsToTarget(EditorTabs3, EditorTabs);
                    MoveAllTabsToTarget(EditorTabs4, EditorTabs);
                    break;

                case "SplitH": // 2 Columns (Side by Side)
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(4);
                    PaneCol1.Width = new GridLength(1, GridUnitType.Star);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(0);
                    PaneRow1.Height = new GridLength(0);

                    PaneGridSplitterH.Visibility = Visibility.Visible;
                    PaneGridSplitterV.Visibility = Visibility.Collapsed;

                    EditorTabs2.Visibility = Visibility.Visible;
                    EditorTabs3.Visibility = Visibility.Collapsed;
                    EditorTabs4.Visibility = Visibility.Collapsed;

                    DistributeTabsBetweenPanes(EditorTabs, EditorTabs2);
                    break;

                case "SplitV": // 2 Rows (Top / Bottom)
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(0);
                    PaneCol1.Width = new GridLength(0);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(4);
                    PaneRow1.Height = new GridLength(1, GridUnitType.Star);

                    PaneGridSplitterH.Visibility = Visibility.Collapsed;
                    PaneGridSplitterV.Visibility = Visibility.Visible;

                    EditorTabs2.Visibility = Visibility.Collapsed;
                    EditorTabs3.Visibility = Visibility.Visible;
                    EditorTabs4.Visibility = Visibility.Collapsed;

                    DistributeTabsBetweenPanes(EditorTabs, EditorTabs3);
                    break;

                case "Grid4": // 4 Squares Layout
                    PaneCol0.Width = new GridLength(1, GridUnitType.Star);
                    PaneColSplitter.Width = new GridLength(4);
                    PaneCol1.Width = new GridLength(1, GridUnitType.Star);

                    PaneRow0.Height = new GridLength(1, GridUnitType.Star);
                    PaneRowSplitter.Height = new GridLength(4);
                    PaneRow1.Height = new GridLength(1, GridUnitType.Star);

                    PaneGridSplitterH.Visibility = Visibility.Visible;
                    PaneGridSplitterV.Visibility = Visibility.Visible;

                    EditorTabs2.Visibility = Visibility.Visible;
                    EditorTabs3.Visibility = Visibility.Visible;
                    EditorTabs4.Visibility = Visibility.Visible;

                    DistributeTabsTo4Grid(EditorTabs, EditorTabs2, EditorTabs3, EditorTabs4);
                    break;
            }
        }

        private void MoveAllTabsToTarget(TabControl source, TabControl target)
        {
            var items = source.Items.OfType<TabItem>().ToList();
            foreach (var item in items)
            {
                source.Items.Remove(item);
                target.Items.Add(item);
            }
        }

        private void DistributeTabsBetweenPanes(TabControl source, TabControl target)
        {
            if (source.Items.Count > 1 && target.Items.Count == 0)
            {
                int half = source.Items.Count / 2;
                var itemsToMove = source.Items.OfType<TabItem>().Skip(half).ToList();
                foreach (var item in itemsToMove)
                {
                    source.Items.Remove(item);
                    target.Items.Add(item);
                }
            }
        }

        private void DistributeTabsTo4Grid(TabControl t1, TabControl t2, TabControl t3, TabControl t4)
        {
            var allItems = t1.Items.OfType<TabItem>()
                .Concat(t2.Items.OfType<TabItem>())
                .Concat(t3.Items.OfType<TabItem>())
                .Concat(t4.Items.OfType<TabItem>())
                .Distinct().ToList();

            t1.Items.Clear();
            t2.Items.Clear();
            t3.Items.Clear();
            t4.Items.Clear();

            TabControl[] targetPanes = new[] { t1, t2, t3, t4 };
            for (int i = 0; i < allItems.Count; i++)
            {
                targetPanes[i % 4].Items.Add(allItems[i]);
            }
        }

        // ── Git #806: test manifest runner (Epic #803 Phase 2 — orchestration shell) ──
        // This phase wires the Menu > Run items, tracks the manifest last loaded via
        // the Automation sidebar, and gives #807 (apiTests), #808 (graphTests) and
        // #809 (uiSteps, retrofitting AutomationRunnerWindow) a single, stable entry
        // point — RunManifestAsync — to plug their real execution into. Nothing here
        // actually runs an apiTest/graphTest/uiStep yet.
        private void RunTestsCurrentIssue_Click(object sender, RoutedEventArgs e)
        {
            if (_loadedManifest == null)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Run Tests (Current Issue): no manifest loaded — use Load Manifest in the Automation sidebar first.");
                MessageBox.Show("No manifest loaded — use Load Manifest in the Automation sidebar first.", "Run Tests");
                return;
            }
            _ = RunManifestAsync(_loadedManifest, isRegression: false);
        }

        private async void RunRegressionSuite_Click(object sender, RoutedEventArgs e)
        {
            string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
            if (repoRoot == null)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                    "Run Regression Suite: no repo root found (missing scripts\\build-queue-watcher.config.json).");
                return;
            }

            string suitePath = Path.Combine(repoRoot, "test-manifests", "_regression-suite.json");
            if (!File.Exists(suitePath))
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Run Regression Suite: {suitePath} not found.");
                return;
            }

            List<string> manifestFiles;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(suitePath));
                manifestFiles = doc.RootElement.TryGetProperty("manifests", out var arr)
                    ? arr.EnumerateArray().Select(v => v.GetString() ?? "").Where(s => s.Length > 0).ToList()
                    : new List<string>();
            }
            catch (Exception ex)
            {
                BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Couldn't parse {suitePath}: {ex.Message}");
                return;
            }

            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Run Regression Suite: {manifestFiles.Count} manifest(s) queued.");
            foreach (var relPath in manifestFiles)
            {
                var manifest = BuildConsole.Services.TestManifest.LoadFromFile(Path.Combine(repoRoot, "test-manifests", relPath));
                if (manifest == null)
                {
                    BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Skipping {relPath} — couldn't load/parse.");
                    continue;
                }
                await RunManifestAsync(manifest, isRegression: true);
            }
        }

        // ── Git #807 (Epic #803 Phase 3): HTTP test executor (apiTests) ──
        // Plugs into RunManifestAsync at the exact point #806 left as the stable
        // entry point. Results feed the ONE shared ManifestRunResult -> test-results/
        // pipeline #808 (graphTests) and #809 (uiSteps) will append their own
        // TestStepResult entries into as well, per #803/#807 — not a separate
        // output path per executor kind.
        private async System.Threading.Tasks.Task RunManifestAsync(BuildConsole.Services.TestManifest manifest, bool isRegression)
        {
            string mode = isRegression ? "regression" : "single";
            BuildConsole.Services.ActivityLog.Log("testing.manifest-runner",
                $"[{mode}] Running manifest for issue #{manifest.Issue} ({manifest.Feature}) — {manifest.ApiTests.Count} apiTests, {manifest.GraphTests.Count} graphTests, {manifest.UiSteps.Count} uiSteps.");

            var runResult = new BuildConsole.Services.ManifestRunResult
            {
                Issue = manifest.Issue,
                Feature = manifest.Feature,
                Mode = mode,
                StartedAt = DateTime.Now,
            };

            // Git #810 (Epic #803 Phase 6) — surface this run in the bottom "Test Results" tab.
            // apiTests/graphTests cards stream in live via HttpTestExecutor/GraphTestExecutor's
            // own StepCompleted events (subscribed once in TestResultsView itself), not pushed
            // from here.
            SetBottomPanel(true, 4);
            TestResultsView.Clear();
            TestResultsView.BeginRun(manifest.Issue, manifest.Feature, mode);

            var config = BuildConsole.Services.BuildTrackerConfig.Load();
            var apiResults = await BuildConsole.Services.HttpTestExecutor.RunAsync(manifest, config);
            runResult.AddRange(apiResults);

            if (apiResults.Count > 0)
            {
                int passed = apiResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.api-executor",
                    $"apiTests: {passed}/{apiResults.Count} passed for issue #{manifest.Issue}.");
            }

            // ── Git #808 (Epic #803 Phase 4): Graph test executor (graphTests) ──
            // Folds into the same runResult/ManifestRunResult #807 established —
            // not a separate output path. GraphTestExecutor itself enforces the
            // hard "test tenant only" guard before ever calling Graph.
            var graphResults = await BuildConsole.Services.GraphTestExecutor.RunAsync(manifest);
            runResult.AddRange(graphResults);

            if (graphResults.Count > 0)
            {
                int graphPassed = graphResults.Count(r => r.Passed);
                BuildConsole.Services.ActivityLog.Log("testing.graph-executor",
                    $"graphTests: {graphPassed}/{graphResults.Count} passed for issue #{manifest.Issue}.");
            }

            // Git #810 — uiSteps now run directly through TestResultsView.RunUiTestAsync (the
            // same UiTestExecutor #809 built), driving that tab's own WebView2 instead of opening
            // the standalone AutomationRunnerWindow popup — retired entirely, per #810's own
            // instruction. Telemetry cards stream live via UiTestExecutor.Telemetry, subscribed
            // for the duration of this call inside RunUiTestAsync itself.
            if (manifest.UiSteps.Count > 0)
            {
                var uiActions = manifest.UiSteps.Select((step, i) => new Controls.AutomationAction
                {
                    Index = i + 1,
                    ActionType = step.Action,
                    Selector = step.Selector ?? step.Target ?? string.Empty,
                    TagName = "div",
                    Value = step.Value ?? step.State ?? string.Empty,
                    CaptureResponse = step.CaptureResponseJson,
                }).ToList();

                var uiResult = await TestResultsView.RunUiTestAsync(manifest.BaseUrl, uiActions);
                var uiStepResults = uiResult.ToTestStepResults();
                runResult.AddRange(uiStepResults);

                BuildConsole.Services.ActivityLog.Log("testing.ui-executor",
                    $"[{mode}] Issue #{manifest.Issue} uiSteps: {uiResult.PassedSteps}/{uiResult.TotalSteps} passed.");
            }

            TestResultsView.CompleteRun(runResult);

            if (runResult.Steps.Count > 0)
            {
                string? repoRoot = BuildConsole.Services.BuildTrackerConfig.FindRepoRoot();
                if (repoRoot != null)
                {
                    try
                    {
                        string resultPath = runResult.WriteToFile(repoRoot);
                        BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Results written: {resultPath}");
                    }
                    catch (Exception ex)
                    {
                        BuildConsole.Services.ActivityLog.Log("testing.manifest-runner", $"Couldn't write test results: {ex.Message}");
                    }
                }
            }
        }
    }

    public class PaletteItem
    {
        public string Category { get; set; } = "Files";
        public string CategoryUpper => Category.ToUpper();
        public string Icon { get; set; } = "📁";
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public Action? ExecuteAction { get; set; }
    }
}
