using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Media.Imaging;

namespace BuildConsole
{
    /// <summary>
    /// Git #966 (Epic #803) — the on-demand screenshot review gallery. A simple click-through of the
    /// last run's captured WebView2 screenshots (with #977 always-on capture, that's one per uiStep),
    /// opened from TestRunnerWindow's "📷 Screenshots" button. Deliberately capture + human review
    /// only — no automated pixel-diffing, no baseline, no approve/close-issue workflow (that is #975's
    /// separate <see cref="ScreenshotReviewWindow"/>, a conditional baseline-diff APPROVAL GATE, which
    /// this gallery is deliberately NOT — see the PLATFORM_BUILD row for why the two are kept distinct).
    ///
    /// This is a real top-level <see cref="Window"/> rather than the in-TestRunnerWindow overlay Grid
    /// it used to be, so it renders ABOVE the Live UI Test View's hosted WebView2 control instead of
    /// behind it — the classic WPF+WebView2 airspace problem, which a hosted control's Z-order can't
    /// beat but a genuine separate HWND (a Window) does.
    /// </summary>
    public partial class ScreenshotGalleryWindow : Window
    {
        private readonly List<Services.UiScreenshotCapture> _shots;
        private int _index;

        public ScreenshotGalleryWindow(IEnumerable<Services.UiScreenshotCapture> shots)
        {
            InitializeComponent();
            _shots = (shots ?? Enumerable.Empty<Services.UiScreenshotCapture>()).ToList();
            _index = 0;
            ShowCurrent();
        }

        private void BtnGalleryClose_Click(object sender, RoutedEventArgs e) => Close();

        // ── Git #1006: custom title bar caption buttons (same pattern as MainWindow, Git #894) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Services.WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }

        private void BtnGalleryPrev_Click(object sender, RoutedEventArgs e)
        {
            if (_shots.Count == 0) return;
            _index = (_index - 1 + _shots.Count) % _shots.Count;
            ShowCurrent();
        }

        private void BtnGalleryNext_Click(object sender, RoutedEventArgs e)
        {
            if (_shots.Count == 0) return;
            _index = (_index + 1) % _shots.Count;
            ShowCurrent();
        }

        /// <summary>Loads the current screenshot into the gallery Image and updates the counter/caption/path.
        /// Reads the PNG with OnLoad caching so the file handle is released immediately (never locks the file
        /// the executor just wrote). A missing/unreadable file shows a message rather than throwing.</summary>
        private void ShowCurrent()
        {
            if (_shots.Count == 0)
            {
                GalleryImage.Source = null;
                TxtGalleryEmpty.Text = "No screenshots captured for the last run.";
                TxtGalleryEmpty.Visibility = Visibility.Visible;
                TxtGalleryCounter.Text = "0 / 0";
                TxtGalleryCaption.Text = "";
                TxtGalleryFile.Text = "";
                BtnGalleryPrev.IsEnabled = BtnGalleryNext.IsEnabled = false;
                return;
            }

            if (_index < 0 || _index >= _shots.Count) _index = 0;
            var shot = _shots[_index];

            TxtGalleryCounter.Text = $"{_index + 1} / {_shots.Count}";
            TxtGalleryCaption.Text = $"Step {shot.StepIndex}: {shot.StepLabel}  —  {shot.Reason}";
            TxtGalleryFile.Text = shot.FilePath;
            bool many = _shots.Count > 1;
            BtnGalleryPrev.IsEnabled = BtnGalleryNext.IsEnabled = many;

            try
            {
                if (!System.IO.File.Exists(shot.FilePath))
                {
                    GalleryImage.Source = null;
                    TxtGalleryEmpty.Text = $"Screenshot file not found:\n{shot.FilePath}";
                    TxtGalleryEmpty.Visibility = Visibility.Visible;
                    return;
                }

                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                bmp.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                GalleryImage.Source = bmp;
                TxtGalleryEmpty.Visibility = Visibility.Collapsed;
            }
            catch (Exception ex)
            {
                GalleryImage.Source = null;
                TxtGalleryEmpty.Text = $"Couldn't load screenshot:\n{ex.Message}";
                TxtGalleryEmpty.Visibility = Visibility.Visible;
            }
        }
    }
}
