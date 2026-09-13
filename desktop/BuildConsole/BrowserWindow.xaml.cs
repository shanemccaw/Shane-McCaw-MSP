using System;
using System.Windows;
using System.Windows.Input;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3913 — <c>File &gt; New Browser Window</c>. A real, standalone, generic
    /// browser window: address bar, Back/Forward/Refresh, a single
    /// <see cref="Controls.ChatSafeWebView2"/> filling the rest — explicitly NOT
    /// another Claude chat tab (every other WebView2 host in this app —
    /// <c>OpenWebTab</c>, chat tabs, <c>BuildChatWebView</c> — is a bare, chrome-less
    /// WebView2 built for a fixed set of known destinations). Single address bar +
    /// single WebView2 per window is the real, complete scope; opening several is
    /// just opening the menu item multiple times (no in-window tabs).
    ///
    /// Reuses the app's one real WebView2 startup path
    /// (<see cref="MainWindow.EnsureWebViewInitializedAsync"/>) rather than
    /// reinventing initialization, and the app's one real safe-WebView2 subclass
    /// (<see cref="Controls.ChatSafeWebView2"/>) rather than a bare WebView2.
    /// </summary>
    public partial class BrowserWindow : Window
    {
        private const string DefaultStartUrl = "about:blank";
        private const string LogChannel = "browser-window";

        private Controls.ChatSafeWebView2? _wv;

        public BrowserWindow() : this(DefaultStartUrl)
        {
        }

        public BrowserWindow(string startUrl)
        {
            InitializeComponent();
            AddressBar.Text = string.IsNullOrWhiteSpace(startUrl) ? DefaultStartUrl : startUrl;
            Loaded += BrowserWindow_Loaded;
        }

        private async void BrowserWindow_Loaded(object sender, RoutedEventArgs e)
        {
            Loaded -= BrowserWindow_Loaded;

            _wv = new Controls.ChatSafeWebView2
            {
                DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 24, 24, 37)
            };
            BrowserHost.Children.Add(_wv);

            bool ready = await MainWindow.EnsureWebViewInitializedAsync(_wv);
            if (!ready || _wv.CoreWebView2 == null)
            {
                ActivityLog.Log(LogChannel, "BrowserWindow: WebView2 initialization failed.");
                TitleBarText.Text = "Browser — WebView2 unavailable";
                return;
            }

            _wv.CoreWebView2.SourceChanged += CoreWebView2_SourceChanged;
            _wv.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;
            _wv.CoreWebView2.NavigationStarting += CoreWebView2_NavigationStarting;
            _wv.CoreWebView2.DocumentTitleChanged += CoreWebView2_DocumentTitleChanged;

            Navigate(AddressBar.Text);
        }

        /// <summary>
        /// Normalizes whatever was typed into the address bar into a real navigable
        /// URL: passes through anything that already has a scheme (http/https/about/
        /// file/etc.), promotes a bare host or host/path (no spaces, contains a dot
        /// or is "localhost") to https://, and otherwise treats the input as a search
        /// query — the same real, sensible behavior a normal browser's address bar has.
        /// </summary>
        private static string NormalizeAddress(string input)
        {
            string text = (input ?? string.Empty).Trim();
            if (text.Length == 0) return DefaultStartUrl;

            if (text.Contains("://", StringComparison.Ordinal) ||
                text.StartsWith("about:", StringComparison.OrdinalIgnoreCase) ||
                text.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                return text;
            }

            bool looksLikeHost = !text.Contains(' ') &&
                (text.Contains('.') || text.StartsWith("localhost", StringComparison.OrdinalIgnoreCase));

            if (looksLikeHost) return "https://" + text;

            return "https://www.google.com/search?q=" + Uri.EscapeDataString(text);
        }

        private void Navigate(string rawInput)
        {
            if (_wv?.CoreWebView2 == null) return;
            string url = NormalizeAddress(rawInput);
            try
            {
                _wv.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(LogChannel, $"BrowserWindow: navigation to '{url}' failed: {ex.Message}");
            }
        }

        // ── Address bar / Go ─────────────────────────────────────────────────────
        private void BtnGo_Click(object sender, RoutedEventArgs e) => Navigate(AddressBar.Text);

        private void AddressBar_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                e.Handled = true;
                Navigate(AddressBar.Text);
            }
        }

        // ── Back / Forward / Refresh — real CoreWebView2 navigation, per the issue ──
        private void BtnBack_Click(object sender, RoutedEventArgs e)
        {
            if (_wv?.CoreWebView2 != null && _wv.CoreWebView2.CanGoBack) _wv.CoreWebView2.GoBack();
        }

        private void BtnForward_Click(object sender, RoutedEventArgs e)
        {
            if (_wv?.CoreWebView2 != null && _wv.CoreWebView2.CanGoForward) _wv.CoreWebView2.GoForward();
        }

        private void BtnRefresh_Click(object sender, RoutedEventArgs e)
        {
            _wv?.CoreWebView2?.Reload();
        }

        // ── Real address-bar sync: reflects wherever the page actually navigates
        // (including client-side redirects), not just what was manually typed. ──
        private void CoreWebView2_NavigationStarting(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
        {
            Dispatcher.Invoke(() => AddressBar.Text = e.Uri);
        }

        private void CoreWebView2_SourceChanged(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2SourceChangedEventArgs e)
        {
            if (_wv?.CoreWebView2 == null) return;
            Dispatcher.Invoke(() =>
            {
                AddressBar.Text = _wv.CoreWebView2.Source;
                UpdateNavButtons();
            });
        }

        private void CoreWebView2_NavigationCompleted(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
        {
            Dispatcher.Invoke(UpdateNavButtons);
        }

        private void CoreWebView2_DocumentTitleChanged(object? sender, object e)
        {
            if (_wv?.CoreWebView2 == null) return;
            Dispatcher.Invoke(() =>
            {
                string title = _wv.CoreWebView2.DocumentTitle;
                TitleBarText.Text = string.IsNullOrWhiteSpace(title) ? "Browser" : title;
                Title = string.IsNullOrWhiteSpace(title) ? "Browser" : title;
            });
        }

        private void UpdateNavButtons()
        {
            if (_wv?.CoreWebView2 == null) return;
            BtnBack.IsEnabled = _wv.CoreWebView2.CanGoBack;
            BtnForward.IsEnabled = _wv.CoreWebView2.CanGoForward;
        }

        // ── Custom title bar (same pattern as ManifestViewerWindow/TestHistoryWindow, Git #1006) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }
    }
}
