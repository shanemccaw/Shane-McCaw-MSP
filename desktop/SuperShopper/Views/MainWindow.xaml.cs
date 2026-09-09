using System;
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
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 initialization failed: {ex.Message}\nPlease ensure WebView2 Runtime is installed.", "SuperShopper Warning", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private async void CoreWebView2_WebResourceResponseReceived(object? sender, CoreWebView2WebResourceResponseReceivedEventArgs e)
        {
            try
            {
                var uri = e.Request.Uri.ToLowerInvariant();
                // Check if response is from Publix or store API endpoints
                if (uri.Contains("publix.com") || uri.Contains("weeklyad") || uri.Contains("savings") || uri.Contains("promotion") || uri.Contains("deals") || uri.Contains("api"))
                {
                    var headers = e.Response.Headers;
                    if (headers.Contains("content-type"))
                    {
                        var contentType = headers.GetHeader("content-type");
                        if (contentType != null && contentType.Contains("application/json"))
                        {
                            using var stream = await e.Response.GetContentAsync();
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
            }
            catch
            {
                // Silently swallow background stream reading exceptions
            }
        }

        private async void ExtractDeals_Click(object sender, RoutedEventArgs e)
        {
            if (webView == null || webView.CoreWebView2 == null) return;

            if (DataContext is MainViewModel vm)
            {
                vm.IsExtractingDeals = true;
                vm.StatusMessage = "Extracting deals from page...";
            }

            try
            {
                // Execute JavaScript extraction on current page DOM & Next.js state
                string script = @"(function() {
                    let deals = [];
                    try {
                        // 1. Try Next.js __NEXT_DATA__
                        if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
                            let jsonStr = JSON.stringify(window.__NEXT_DATA__.props);
                            return jsonStr;
                        }
                    } catch(e){}

                    // 2. Query DOM for product deal tiles
                    let cards = document.querySelectorAll('[data-testid*=""deal""], [class*=""deal""], [class*=""card""], article');
                    cards.forEach(card => {
                        let titleEl = card.querySelector('h2, h3, h4, p, [class*=""title""], [class*=""name""]');
                        let dealEl = card.querySelector('[class*=""badge""], [class*=""savings""], [class*=""promo""]');
                        let priceEl = card.querySelector('[class*=""price""]');
                        if (titleEl && titleEl.innerText && titleEl.innerText.length > 3 && titleEl.innerText.length < 80) {
                            deals.push({
                                title: titleEl.innerText.trim(),
                                dealType: dealEl ? dealEl.innerText.trim() : 'Weekly Sale',
                                price: priceEl ? priceEl.innerText.trim() : 'See Weekly Circular',
                                category: 'Weekly Ad'
                            });
                        }
                    });
                    return JSON.stringify(deals);
                })();";

                string resultJson = await webView.ExecuteScriptAsync(script);
                if (DataContext is MainViewModel mainVm && !string.IsNullOrWhiteSpace(resultJson) && resultJson != "null")
                {
                    // Unescape string returned by ExecuteScriptAsync
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
                    mainVm.StatusMessage = $"Extracted {mainVm.ExtractedDealsCount} deals!";
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
                    vm.StatusMessage = "Page loaded successfully";
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
