using System;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4442 — per-tab banner under the browser toolbar reporting what Test Mode's navigation
    /// auto-check just did (see <see cref="PageAutoCheckService"/>). One banner per browser tab, found
    /// from the tab's WebView2 via <see cref="For"/>.
    /// </summary>
    public partial class PageAutoCheckBanner : UserControl
    {
        private static readonly ConditionalWeakTable<WebView2, PageAutoCheckBanner> _byWebView = new();

        private PageAutoCheckOutcome? _outcome;

        /// <summary>Raised when "View drift" is clicked, with the outcome the banner is showing.</summary>
        public event Action<PageAutoCheckOutcome>? ViewDriftRequested;

        public PageAutoCheckBanner()
        {
            InitializeComponent();
        }

        /// <summary>Associates this banner with the browser tab's WebView2.</summary>
        public void AttachTo(WebView2 webView) => _byWebView.AddOrUpdate(webView, this);

        /// <summary>The banner under <paramref name="webView"/>'s toolbar, or null for a WebView2 hosted
        /// somewhere without one.</summary>
        public static PageAutoCheckBanner? For(WebView2 webView)
            => _byWebView.TryGetValue(webView, out var banner) ? banner : null;

        /// <summary>The page this banner is currently reporting on, if it is showing.</summary>
        public string? ShowingPageKey => Visibility == Visibility.Visible && _outcome != null
            ? _outcome.BaseUrl + _outcome.PagePath
            : null;

        public void Show(PageAutoCheckOutcome outcome)
        {
            _outcome = outcome;
            TxtHeadline.Text = outcome.Headline;
            TxtDetail.Text = outcome.Detail;
            TxtDetail.Visibility = string.IsNullOrWhiteSpace(outcome.Detail) ? Visibility.Collapsed : Visibility.Visible;
            BtnViewDrift.Visibility = outcome.Drift.Count > 0 && outcome.Observation != null ? Visibility.Visible : Visibility.Collapsed;

            var (glyph, accentKey, tintKey) = outcome.Kind switch
            {
                PageAutoCheckKind.Drift => ("", "PeachBrush", "PeachBrushTint"),        // Warning
                PageAutoCheckKind.Problem => ("", "StatusErrorBrush", "StatusErrorWashLightBrush"), // ErrorBadge
                _ => ("", "BlueBrush", "BlueBrushTint"),                               // Diagnostic
            };
            TxtIcon.Text = glyph;
            TxtIcon.Foreground = (Brush)FindResource(accentKey);
            BdrBanner.BorderBrush = (Brush)FindResource(accentKey);
            BdrBanner.Background = (Brush)FindResource(tintKey);

            Visibility = Visibility.Visible;
        }

        public void Hide()
        {
            Visibility = Visibility.Collapsed;
            _outcome = null;
        }

        private void BtnViewDrift_Click(object sender, RoutedEventArgs e)
        {
            if (_outcome != null) ViewDriftRequested?.Invoke(_outcome);
        }

        private void BtnDismiss_Click(object sender, RoutedEventArgs e) => Hide();
    }
}
