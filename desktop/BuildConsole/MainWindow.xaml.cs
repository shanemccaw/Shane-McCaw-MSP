using System.Windows;
using System.Windows.Controls.Ribbon;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : RibbonWindow
    {
        // Default pane widths so we can restore them after a "Reset Layout"
        private const double DefaultLeftWidth  = 220;
        private const double DefaultRightWidth = 300;

        public MainWindow()
        {
            InitializeComponent();
        }

        // ── File menu ─────────────────────────────────────────────────────────
        private void MenuExit_Click(object sender, RoutedEventArgs e)
            => Application.Current.Shutdown();

        // ── Navigation (Back / Forward / Refresh) ─────────────────────────────
        private void NavBack_Click(object sender, RoutedEventArgs e)
        {
            if (ClaudeWebView.CanGoBack)
                ClaudeWebView.GoBack();
        }

        private void NavForward_Click(object sender, RoutedEventArgs e)
        {
            if (ClaudeWebView.CanGoForward)
                ClaudeWebView.GoForward();
        }

        private void NavRefresh_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.Reload();

        // ── View — panel show/hide ─────────────────────────────────────────────
        private void ToggleLeftPanel_Click(object sender, RoutedEventArgs e)
        {
            bool show = BtnToggleLeft.IsChecked == true;
            ColLeft.Width   = show ? new GridLength(DefaultLeftWidth) : new GridLength(0);
            LeftPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        private void ToggleRightPanel_Click(object sender, RoutedEventArgs e)
        {
            bool show = BtnToggleRight.IsChecked == true;
            ColRight.Width   = show ? new GridLength(DefaultRightWidth) : new GridLength(0);
            RightPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        }

        // ── View — layout reset ────────────────────────────────────────────────
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
            => ClaudeWebView.ZoomFactor = System.Math.Min(ClaudeWebView.ZoomFactor + 0.1, 3.0);

        private void ZoomOut_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.ZoomFactor = System.Math.Max(ClaudeWebView.ZoomFactor - 0.1, 0.25);

        private void ZoomReset_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.ZoomFactor = 1.0;

        // ── Tools ─────────────────────────────────────────────────────────────
        private void OpenDevTools_Click(object sender, RoutedEventArgs e)
            => ClaudeWebView.CoreWebView2?.OpenDevToolsWindow();
    }
}
