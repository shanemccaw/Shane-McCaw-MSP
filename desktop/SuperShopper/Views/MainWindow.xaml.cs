using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using SuperShopper.ViewModels;

namespace SuperShopper.Views
{
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
            SourceInitialized += MainWindow_SourceInitialized;
            DataContextChanged += MainWindow_DataContextChanged;
        }

        private void MainWindow_DataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (e.OldValue is INotifyPropertyChanged oldVm)
            {
                oldVm.PropertyChanged -= ViewModel_PropertyChanged;
            }
            if (e.NewValue is INotifyPropertyChanged newVm)
            {
                newVm.PropertyChanged += ViewModel_PropertyChanged;
            }
        }

        private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(MainViewModel.CurrentUrl) && webView != null && webView.CoreWebView2 != null)
            {
                if (DataContext is MainViewModel vm && !string.IsNullOrWhiteSpace(vm.CurrentUrl))
                {
                    try
                    {
                        var targetUri = new Uri(vm.CurrentUrl);
                        if (webView.Source != targetUri)
                        {
                            webView.Source = targetUri;
                        }
                    }
                    catch { }
                }
            }
        }

        private void MainWindow_SourceInitialized(object? sender, EventArgs e)
        {
            var handle = new WindowInteropHelper(this).Handle;
            HwndSource.FromHwnd(handle)?.AddHook(WindowProc);
        }

        private IntPtr WindowProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == 0x0024) // WM_GETMINMAXINFO
            {
                WmGetMinMaxInfo(hwnd, lParam);
                handled = true;
            }
            return IntPtr.Zero;
        }

        private static void WmGetMinMaxInfo(IntPtr hwnd, IntPtr lParam)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);

            var currentMonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (currentMonitor != IntPtr.Zero)
            {
                var monitorInfo = new MONITORINFO();
                monitorInfo.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                GetMonitorInfo(currentMonitor, ref monitorInfo);

                var rcWorkArea = monitorInfo.rcWork;
                var rcMonitorArea = monitorInfo.rcMonitor;

                mmi.ptMaxPosition.X = Math.Abs(rcWorkArea.Left - rcMonitorArea.Left);
                mmi.ptMaxPosition.Y = Math.Abs(rcWorkArea.Top - rcMonitorArea.Top);
                mmi.ptMaxSize.X = Math.Abs(rcWorkArea.Right - rcWorkArea.Left);
                mmi.ptMaxSize.Y = Math.Abs(rcWorkArea.Bottom - rcWorkArea.Top);
                mmi.ptMaxTrackSize.X = mmi.ptMaxSize.X;
                mmi.ptMaxTrackSize.Y = mmi.ptMaxSize.Y;
            }

            Marshal.StructureToPtr(mmi, lParam, true);
        }

        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            try
            {
                // Permanent User Data Folder to preserve cookies, store selection, local storage, & cache across sessions
                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SuperShopper",
                    "WebView2Data"
                );

                Directory.CreateDirectory(userDataFolder);

                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                // Wire up Network Response Interceptor for API deal feeds
                webView.CoreWebView2.WebResourceResponseReceived += CoreWebView2_WebResourceResponseReceived;

                // Navigate to initial URL after CoreWebView2 environment is ready
                if (DataContext is MainViewModel vm && !string.IsNullOrWhiteSpace(vm.CurrentUrl))
                {
                    webView.Source = new Uri(vm.CurrentUrl);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 initialization failed: {ex.Message}\nPlease ensure WebView2 Runtime is installed.", "SuperShopper Warning", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void CoreWebView2_WebResourceResponseReceived(object? sender, CoreWebView2WebResourceResponseReceivedEventArgs e)
        {
            var requestUri = e.Request.Uri.ToLowerInvariant();
            var response = e.Response;

            if (requestUri.Contains("publix.com") || requestUri.Contains("weeklyad") || requestUri.Contains("savings") || requestUri.Contains("promotion") || requestUri.Contains("deals") || requestUri.Contains("flipp") || requestUri.Contains("api"))
            {
                Task.Run(async () =>
                {
                    try
                    {
                        var headers = response.Headers;
                        if (headers.Contains("content-type"))
                        {
                            var contentType = headers.GetHeader("content-type");
                            if (contentType != null && (contentType.Contains("application/json") || contentType.Contains("text/plain")))
                            {
                                using var stream = await response.GetContentAsync();
                                if (stream != null)
                                {
                                    using var reader = new StreamReader(stream);
                                    string json = await reader.ReadToEndAsync();
                                    if (DataContext is MainViewModel vm && !string.IsNullOrWhiteSpace(json))
                                    {
                                        vm.ProcessExtractedJson(json);
                                    }
                                }
                            }
                        }
                    }
                    catch
                    {
                        // Background stream read timeout swallow
                    }
                });
            }
        }

        private async void ExtractDeals_Click(object sender, RoutedEventArgs e)
        {
            if (webView == null || webView.CoreWebView2 == null) return;

            if (DataContext is MainViewModel vm)
            {
                vm.IsExtractingDeals = true;
                vm.StatusMessage = "Scanning page for all weekly ad deals...";
            }

            try
            {
                // 1. Scroll page slightly to trigger lazy-loaded images & deals
                await webView.ExecuteScriptAsync("window.scrollBy(0, 400);");
                await Task.Delay(300);

                // 2. Comprehensive Client-Side JS Scraper
                string script = @"(function() {
                    let deals = [];
                    let titlesSeen = new Set();

                    function add(title, dealType, price, category) {
                        if (!title) return;
                        title = title.trim();
                        if (title.length < 3 || title.length > 140) return;
                        if (/^(home|savings|weekly ad|publix|cart|account|search|store|login|sign in|help|menu|all|departments)$/i.test(title)) return;

                        let key = title.toLowerCase();
                        if (!titlesSeen.has(key)) {
                            titlesSeen.add(key);
                            deals.push({
                                title: title,
                                dealType: dealType || 'Weekly Sale',
                                price: price || 'See Circular',
                                category: category || 'Groceries'
                            });
                        }
                    }

                    try {
                        // A. Inspect DOM elements containing deal cards / tiles
                        let containers = document.querySelectorAll('div, article, section, li, a');
                        containers.forEach(el => {
                            let text = el.innerText || '';
                            if (text.length > 5 && text.length < 300 && (text.includes('BOGO') || text.includes('$') || text.includes('Save') || text.includes('off') || text.includes('ea'))) {
                                let h = el.querySelector('h1, h2, h3, h4, h5, strong, [class*=""title""], [class*=""name""], [data-qa*=""title""]');
                                let titleText = h ? h.innerText : '';
                                if (!titleText && el.children.length <= 4) {
                                    let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                                    if (lines.length > 0) titleText = lines[0];
                                }

                                if (titleText) {
                                    let dealType = 'Weekly Sale';
                                    if (text.includes('BOGO') || text.includes('Buy 1 Get 1')) dealType = 'Buy 1 Get 1 Free';
                                    else if (text.includes('2 for') || text.includes('3 for')) {
                                        let m = text.match(/\d+ for \$\d+(\.\d{2})?/i);
                                        if (m) dealType = m[0];
                                    }

                                    let priceMatch = text.match(/\$\d+(\.\d{2})?(\s*ea)?/i) || text.match(/Save up to \$\d+(\.\d{2})?/i);
                                    let priceText = priceMatch ? priceMatch[0] : 'Weekly Special';

                                    add(titleText, dealType, priceText, 'Weekly Ad');
                                }
                            }
                        });
                    } catch(e){}

                    try {
                        // B. Inspect Next.js __NEXT_DATA__
                        if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
                            let str = JSON.stringify(window.__NEXT_DATA__.props);
                            let matches = str.matchAll(/""title""\s*:\s*""([^""]+)""/g);
                            for (let m of matches) {
                                if (m[1]) add(m[1], 'Weekly Deal', 'Sale Price', 'Groceries');
                            }
                        }
                    } catch(e){}

                    return JSON.stringify(deals);
                })();";

                string resultJson = await webView.ExecuteScriptAsync(script);
                if (DataContext is MainViewModel mainVm && !string.IsNullOrWhiteSpace(resultJson) && resultJson != "null")
                {
                    string rawJson = JsonSerializer.Deserialize<string>(resultJson) ?? resultJson;
                    mainVm.ProcessExtractedJson(rawJson);
                }
            }
            catch (Exception ex)
            {
                if (DataContext is MainViewModel mainVm)
                {
                    mainVm.StatusMessage = $"Extraction notice: {ex.Message}";
                }
            }
            finally
            {
                if (DataContext is MainViewModel mainVm)
                {
                    mainVm.IsExtractingDeals = false;
                    mainVm.IsPanelOpen = true;
                    mainVm.StatusMessage = $"Extracted {mainVm.ExtractedDealsCount} deals from page!";
                }
            }
        }

        private void Window_StateChanged(object sender, EventArgs e)
        {
            if (WindowState == WindowState.Maximized)
            {
                mainBorder.BorderThickness = new Thickness(0);
                mainBorder.Margin = new Thickness(0);
            }
            else
            {
                mainBorder.BorderThickness = new Thickness(1);
                mainBorder.Margin = new Thickness(0);
            }
        }

        private void TitleBar_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left)
            {
                DragMove();
            }
        }

        private void WindowMinimize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void WindowMaximize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        private void WindowClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void MenuExit_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void WebBack_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null && webView.CanGoBack)
            {
                webView.GoBack();
            }
        }

        private void WebForward_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null && webView.CanGoForward)
            {
                webView.GoForward();
            }
        }

        private void WebRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null)
            {
                webView.Reload();
            }
        }

        private void AddressBar_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                if (DataContext is MainViewModel vm && vm.NavigateToUrlCommand.CanExecute(null))
                {
                    vm.NavigateToUrlCommand.Execute(null);
                }
            }
        }

        private void WebView_NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (DataContext is MainViewModel vm)
            {
                vm.IsLoading = true;
                vm.StatusMessage = "Loading weekly ad...";
            }
        }

        private void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (DataContext is MainViewModel vm)
            {
                vm.IsLoading = false;
                if (e.IsSuccess)
                {
                    vm.StatusMessage = "Weekly ad loaded! Click '⚡ Extract Sales Deals' to extract deals.";
                    if (webView.Source != null)
                    {
                        vm.AddressBarInput = webView.Source.ToString();
                    }
                }
                else
                {
                    vm.StatusMessage = $"Navigation failed (Error code: {e.WebErrorStatus})";
                }
            }
        }

        #region Win32 P/Invoke Definitions
        private const int MONITOR_DEFAULTTONEAREST = 0x00000002;

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr handle, int flags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public POINT ptReserved;
            public POINT ptMaxSize;
            public POINT ptMaxPosition;
            public POINT ptMinTrackSize;
            public POINT ptMaxTrackSize;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }
        #endregion
    }
}
