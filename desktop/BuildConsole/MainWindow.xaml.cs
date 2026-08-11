using System;
using System.Windows;
using System.Windows.Controls.Ribbon;
using System.Windows.Media;
using System.Windows.Threading;

namespace BuildConsole
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : RibbonWindow
    {
        // ── Layout constants ───────────────────────────────────────────────────
        private const double DefaultLeftWidth  = 220;
        private const double DefaultRightWidth = 300;

        // ── Status-dot brushes (pre-allocated) ────────────────────────────────
        private static readonly SolidColorBrush DotReady   = Frozen(0xA6, 0xE3, 0xA1); // green
        private static readonly SolidColorBrush DotLoading = Frozen(0xFA, 0xB3, 0x87); // peach
        private static readonly SolidColorBrush DotError   = Frozen(0xF3, 0x8B, 0xA8); // red
        private static readonly SolidColorBrush DotIdle    = Frozen(0x58, 0x5B, 0x70); // surface2

        private static SolidColorBrush Frozen(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        // ── Clock timer ───────────────────────────────────────────────────────
        private readonly DispatcherTimer _clockTimer;

        public MainWindow()
        {
            InitializeComponent();

            // Live clock
            _clockTimer = new DispatcherTimer(DispatcherPriority.Background)
            {
                Interval = TimeSpan.FromSeconds(1)
            };
            _clockTimer.Tick += (_, _) => TickClock();
            _clockTimer.Start();
            TickClock(); // set immediately so there's no blank moment

            // Wire up WebView2 navigation events
            ClaudeWebView.NavigationStarting  += WebView_NavigationStarting;
            ClaudeWebView.NavigationCompleted += WebView_NavigationCompleted;
            ClaudeWebView.SourceChanged       += WebView_SourceChanged;

            // Initial status bar state
            UpdateZoomDisplay();
        }

        // ── Clock ──────────────────────────────────────────────────────────────
        private void TickClock()
            => ClockText.Text = DateTime.Now.ToString("HH:mm:ss");

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
            if (e.IsSuccess)
            {
                NavStatusText.Text = "Ready";
                StatusDot.Fill     = DotReady;
            }
            else
            {
                NavStatusText.Text = $"Error {(int)e.WebErrorStatus}";
                StatusDot.Fill     = DotError;
            }

            // Sync URL after redirect chains settle
            UrlStatusText.Text = ClaudeWebView.Source?.ToString() ?? string.Empty;
        }

        private void WebView_SourceChanged(
            object? sender,
            Microsoft.Web.WebView2.Core.CoreWebView2SourceChangedEventArgs e)
        {
            UrlStatusText.Text = ClaudeWebView.Source?.ToString() ?? string.Empty;
        }

        // ── Zoom helpers ──────────────────────────────────────────────────────
        private void UpdateZoomDisplay()
            => ZoomText.Text = $"{ClaudeWebView.ZoomFactor:P0}";

        // ── File menu ─────────────────────────────────────────────────────────
        private void MenuExit_Click(object sender, RoutedEventArgs e)
            => Application.Current.Shutdown();

        // ── Navigation ───────────────────────────────────────────────────────
        private void NavBack_Click(object sender, RoutedEventArgs e)
        {
            if (ClaudeWebView.CanGoBack) ClaudeWebView.GoBack();
        }

        private void NavForward_Click(object sender, RoutedEventArgs e)
        {
            if (ClaudeWebView.CanGoForward) ClaudeWebView.GoForward();
        }

        private void NavRefresh_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.Reload();

        // ── View — panel show/hide ────────────────────────────────────────────
        private void ToggleLeftPanel_Click(object sender, RoutedEventArgs e)
        {
            bool show = BtnToggleLeft.IsChecked == true;
            ColLeft.Width        = show ? new GridLength(DefaultLeftWidth) : new GridLength(0);
            LeftPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ToggleRightPanel_Click(object sender, RoutedEventArgs e)
        {
            bool show = BtnToggleRight.IsChecked == true;
            ColRight.Width        = show ? new GridLength(DefaultRightWidth) : new GridLength(0);
            RightPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── View — layout reset ───────────────────────────────────────────────
        private void ResetLayout_Click(object sender, RoutedEventArgs e)
        {
            ColLeft.Width  = new GridLength(DefaultLeftWidth);
            ColRight.Width = new GridLength(DefaultRightWidth);

            LeftPanel.Visibility  = Visibility.Visible;
            RightPanel.Visibility = Visibility.Visible;

            BtnToggleLeft.IsChecked  = true;
            BtnToggleRight.IsChecked = true;
        }

        // ── View — zoom ───────────────────────────────────────────────────────
        private void ZoomIn_Click(object sender, RoutedEventArgs e)
        {
            ClaudeWebView.ZoomFactor = Math.Min(ClaudeWebView.ZoomFactor + 0.1, 3.0);
            UpdateZoomDisplay();
        }

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
        {
            ClaudeWebView.ZoomFactor = Math.Max(ClaudeWebView.ZoomFactor - 0.1, 0.25);
            UpdateZoomDisplay();
        }

        private void ZoomReset_Click(object sender, RoutedEventArgs e)
        {
            ClaudeWebView.ZoomFactor = 1.0;
            UpdateZoomDisplay();
        }

        // ── Tools ─────────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.CoreWebView2?.OpenDevToolsWindow();
    }
}
