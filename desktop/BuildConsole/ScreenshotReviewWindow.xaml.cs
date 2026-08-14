using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Epic #803 — the screenshot review / approval presentation dialog. Shown by
    /// <see cref="ScreenshotReviewService"/> ONLY when a run's captured screenshots have no baseline
    /// yet or a meaningful visual diff was found (never on a clean matching run). Walks the screenshots
    /// one at a time with narration (which step, what it verified, pass/fail, how it differs from the
    /// baseline) alongside the stored baseline for side-by-side comparison.
    ///
    /// Two end actions:
    ///   • Report issue — reuses #937's SendTextToActiveClaudeChatAsync (passed in as
    ///     <c>sendToChat</c>) to drop a context-seeded note into the active Claude chat.
    ///   • Approve — promotes this run's screenshots to the baseline, sends a landed-and-verified note
    ///     to the active chat, and closes the linked GitHub issue (all wired in the <c>approveAsync</c>
    ///     callback the service supplies).
    ///
    /// Pure UI: it holds no baseline/GitHub logic itself — the service owns that behind the two
    /// delegates — so the same window works for any screenshot-producing run, not just uiSteps.
    /// </summary>
    public partial class ScreenshotReviewWindow : Window
    {
        private readonly ScreenshotReviewSubject _subject;
        private readonly List<ScreenshotReviewItem> _items;
        private readonly Func<string, Action<string, bool>, Action?, Task> _sendToChat;
        private readonly Func<Task<string>> _approveAsync;
        private int _index;
        private bool _approved;

        // ── Zoom / pan state (full-page screenshots) ──
        // _zoom is a multiplier over each pane's own fit-to-width scale: 1.0 = the image exactly fills
        // the panel width (the sensible default for a tall full-page capture — scroll vertically to read),
        // >1.0 magnifies. It is shared across both panes so baseline and current stay at the same scale.
        private double _zoom = 1.0;
        private const double MinZoom = 0.25;
        private const double MaxZoom = 5.0;
        private const double ZoomStep = 1.15;   // per wheel notch / button press
        private bool _updatingSlider;           // guards ZoomSlider.ValueChanged re-entry
        private bool _syncingScroll;            // guards Pane_ScrollChanged re-entry when mirroring
        private bool _panning;
        private Point _panStart;
        private double _panStartH, _panStartV;
        private ScrollViewer? _panViewer;

        public ScreenshotReviewWindow(
            ScreenshotReviewSubject subject,
            List<ScreenshotReviewItem> items,
            Func<string, Action<string, bool>, Action?, Task> sendToChat,
            Func<Task<string>> approveAsync)
        {
            InitializeComponent();
            _subject = subject;
            _items = items ?? new List<ScreenshotReviewItem>();
            _sendToChat = sendToChat;
            _approveAsync = approveAsync;

            int noBaseline = _items.Count(i => !i.HasBaseline);
            int diffs = _items.Count(i => i.HasBaseline && i.NeedsReview);

            TitleText.Text = $"Screenshot Review — {_subject.Title}";
            SubjectText.Text = _subject.IssueNumber > 0
                ? $"{_subject.DisplayName}  ·  issue #{_subject.IssueNumber}  ·  {_items.Count} screenshot(s), {noBaseline} new, {diffs} changed"
                : $"{_subject.DisplayName}  ·  {_items.Count} screenshot(s), {noBaseline} new, {diffs} changed";

            ComposeBox.Text = BuildDefaultReport(noBaseline, diffs);

            _index = FirstReviewIndex();
            Render();
        }

        // ── Git #1006: custom title bar caption buttons (same pattern as MainWindow, Git #894) ──
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
            BtnMaximizeRestoreIcon.Text = maximized ? "" : "";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }

        /// <summary>Open on the first screenshot that actually needs review (missing baseline or a diff),
        /// so Shane lands on the interesting one rather than a clean earlier step.</summary>
        private int FirstReviewIndex()
        {
            int i = _items.FindIndex(x => x.NeedsReview);
            return i < 0 ? 0 : i;
        }

        private void Render()
        {
            if (_items.Count == 0)
            {
                CounterText.Text = "0 / 0";
                PrevButton.IsEnabled = NextButton.IsEnabled = false;
                return;
            }
            if (_index < 0) _index = 0;
            if (_index >= _items.Count) _index = _items.Count - 1;

            var item = _items[_index];
            CounterText.Text = $"{_index + 1} / {_items.Count}";
            PrevButton.IsEnabled = _index > 0;
            NextButton.IsEnabled = _index < _items.Count - 1;

            // Baseline pane (left).
            var baseline = item.HasBaseline ? LoadImage(item.BaselinePath) : null;
            BaselineImage.Source = baseline;
            if (!item.HasBaseline)
            {
                BaselineEmptyText.Text = "No baseline yet — this screenshot becomes the baseline on Approve.";
                BaselineEmptyText.Visibility = Visibility.Visible;
            }
            else if (baseline == null)
            {
                BaselineEmptyText.Text = $"Baseline file couldn't be loaded:\n{item.BaselinePath}";
                BaselineEmptyText.Visibility = Visibility.Visible;
            }
            else
            {
                BaselineEmptyText.Visibility = Visibility.Collapsed;
            }

            // This-run pane (right).
            var current = LoadImage(item.CurrentPath);
            CurrentImage.Source = current;
            if (current == null)
            {
                CurrentEmptyText.Text = $"Screenshot couldn't be loaded:\n{item.CurrentPath}";
                CurrentEmptyText.Visibility = Visibility.Visible;
            }
            else
            {
                CurrentEmptyText.Visibility = Visibility.Collapsed;
            }

            // Narration.
            NarrationStep.Text = $"Step {item.StepIndex}: {item.What}";
            VerdictText.Text = item.Verdict;
            VerdictChip.Background = item.Passed ? Brush("GreenBrush") : Brush("RedBrush");
            VerdictText.Foreground = Brush("CrustBrush");
            NarrationWhat.Text = $"Captured because: {ReasonText(item.Reason)}.";
            NarrationDiff.Text = $"Baseline: {item.DiffNote}.";

            // Diff chip (this item's baseline status).
            if (!item.HasBaseline)
            {
                DiffChipText.Text = "NO BASELINE";
                DiffChip.Background = Brush("PeachBrush");
                DiffChipText.Foreground = Brush("CrustBrush");
            }
            else if (item.NeedsReview)
            {
                DiffChipText.Text = "DIFF";
                DiffChip.Background = Brush("RedBrush");
                DiffChipText.Foreground = Brush("CrustBrush");
            }
            else
            {
                DiffChipText.Text = "MATCHES";
                DiffChip.Background = Brush("GreenBrush");
                DiffChipText.Foreground = Brush("CrustBrush");
            }

            // New image in each pane: reset the scroll to the top-left and (re)apply the shared zoom.
            // Deferred to Loaded priority so the ScrollViewer's ViewportWidth is real before we compute
            // the fit-to-width scale (setting Source doesn't lay out synchronously).
            BaselineScroll.ScrollToHome();
            CurrentScroll.ScrollToHome();
            Dispatcher.BeginInvoke(new Action(ApplyZoom), DispatcherPriority.Loaded);
        }

        // ── Zoom / pan (full-page screenshot legibility) ─────────────────────

        /// <summary>Applies the shared <see cref="_zoom"/> to both panes and refreshes the % label.</summary>
        private void ApplyZoom()
        {
            ApplyZoomTo(BaselineScroll, BaselineImage, BaselineScale);
            ApplyZoomTo(CurrentScroll, CurrentImage, CurrentScale);
            if (ZoomLabel != null) ZoomLabel.Text = $"{_zoom * 100:0}%";
        }

        /// <summary>Sets one pane's ScaleTransform to (fit-to-width × _zoom). Fit-to-width is the pane's
        /// current viewport width divided by the image's real pixel width, so at _zoom=1 a tall full-page
        /// capture fills the panel width and scrolls vertically instead of rendering as a thin sliver.</summary>
        private void ApplyZoomTo(ScrollViewer scroll, Image image, ScaleTransform scale)
        {
            if (image.Source is not BitmapSource bmp || bmp.PixelWidth <= 0)
            {
                scale.ScaleX = scale.ScaleY = 1.0;
                return;
            }
            // ViewportWidth is the visible area (excludes a shown vertical scrollbar), so fitting to it
            // avoids a spurious horizontal scrollbar. Fall back to ActualWidth before first layout.
            double avail = scroll.ViewportWidth > 1 ? scroll.ViewportWidth : scroll.ActualWidth;
            if (avail <= 1) return; // not laid out yet — a SizeChanged will re-apply once it is
            double fit = (avail - 2) / bmp.PixelWidth;   // -2 keeps the fit strictly inside the viewport
            double s = fit * _zoom;
            if (s <= 0 || double.IsNaN(s) || double.IsInfinity(s)) s = 1.0;
            scale.ScaleX = scale.ScaleY = s;
        }

        /// <summary>Sets the shared zoom (clamped), syncs the slider, and re-applies to both panes.</summary>
        private void SetZoom(double zoom)
        {
            _zoom = Math.Max(MinZoom, Math.Min(MaxZoom, zoom));
            if (ZoomSlider != null && Math.Abs(ZoomSlider.Value - _zoom * 100.0) > 0.5)
            {
                _updatingSlider = true;
                ZoomSlider.Value = _zoom * 100.0;
                _updatingSlider = false;
            }
            ApplyZoom();
        }

        private void ZoomInButton_Click(object sender, RoutedEventArgs e) => SetZoom(_zoom * ZoomStep);
        private void ZoomOutButton_Click(object sender, RoutedEventArgs e) => SetZoom(_zoom / ZoomStep);
        private void ZoomFitButton_Click(object sender, RoutedEventArgs e) => SetZoom(1.0);

        private void ZoomSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_updatingSlider) return;
            SetZoom(e.NewValue / 100.0);
        }

        /// <summary>Mouse wheel over either pane zooms (shared) instead of scrolling — the natural gesture
        /// for reading a full-page capture. Handled so the ScrollViewer doesn't also scroll on the notch.</summary>
        private void Pane_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            SetZoom(e.Delta > 0 ? _zoom * ZoomStep : _zoom / ZoomStep);
            e.Handled = true;
        }

        // Left-drag to pan the zoomed image (in addition to the scrollbars).
        private void Pane_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (sender is not ScrollViewer sv) return;
            _panViewer = sv;
            _panning = true;
            _panStart = e.GetPosition(sv);
            _panStartH = sv.HorizontalOffset;
            _panStartV = sv.VerticalOffset;
            sv.CaptureMouse();
            sv.Cursor = Cursors.ScrollAll;
        }

        private void Pane_MouseMove(object sender, MouseEventArgs e)
        {
            if (!_panning || _panViewer is not ScrollViewer sv || !ReferenceEquals(sender, sv)) return;
            Point p = e.GetPosition(sv);
            sv.ScrollToHorizontalOffset(_panStartH - (p.X - _panStart.X));
            sv.ScrollToVerticalOffset(_panStartV - (p.Y - _panStart.Y));
        }

        private void Pane_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (sender is ScrollViewer sv)
            {
                sv.ReleaseMouseCapture();
                sv.Cursor = Cursors.Arrow;
            }
            _panning = false;
            _panViewer = null;
        }

        /// <summary>Re-apply the fit-to-width scale when a pane is resized (window resize / scrollbar
        /// appearing), so zoom stays anchored to the panel width.</summary>
        private void Pane_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyZoom();
        }

        /// <summary>When Sync scroll is on, mirror one pane's scroll offset onto the other so baseline and
        /// current show the same region for side-by-side comparison.</summary>
        private void Pane_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            if (_syncingScroll) return;
            if (SyncScrollCheck?.IsChecked != true) return;
            if (sender is not ScrollViewer src) return;
            ScrollViewer other = ReferenceEquals(src, BaselineScroll) ? CurrentScroll : BaselineScroll;
            if (Math.Abs(other.HorizontalOffset - src.HorizontalOffset) < 0.5 &&
                Math.Abs(other.VerticalOffset - src.VerticalOffset) < 0.5) return;
            _syncingScroll = true;
            other.ScrollToHorizontalOffset(src.HorizontalOffset);
            other.ScrollToVerticalOffset(src.VerticalOffset);
            _syncingScroll = false;
        }

        private static string ReasonText(string reason) => reason switch
        {
            "step-failed" => "the step failed",
            "navigation-failed" => "the initial navigation failed",
            "explicit" => "the step opted in with \"screenshot\": true",
            _ => reason,
        };

        private string BuildDefaultReport(int noBaseline, int diffs)
        {
            var sb = new StringBuilder();
            string issue = _subject.IssueNumber > 0 ? $" (issue #{_subject.IssueNumber})" : "";
            sb.AppendLine($"Screenshot review — {_subject.Title} [{_subject.DisplayName}]{issue}");
            sb.AppendLine();
            if (noBaseline > 0 && diffs == 0)
                sb.AppendLine($"{noBaseline} screenshot(s) have no baseline yet (first capture).");
            else
                sb.AppendLine($"A visual difference was found this run ({diffs} changed, {noBaseline} new):");

            foreach (var item in _items.Where(i => i.NeedsReview))
                sb.AppendLine($"- Step {item.StepIndex}: {item.What} — {item.Verdict} — {item.DiffNote}");

            sb.AppendLine();
            sb.AppendLine("[Describe what looks wrong above, then send.]");
            return sb.ToString();
        }

        /// <summary>OnLoad + Freeze so the file handle is released immediately (never locks the PNG the
        /// executor / baseline store just wrote). Returns null on a missing/unreadable file.</summary>
        private static BitmapImage? LoadImage(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !System.IO.File.Exists(path)) return null;
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                bmp.UriSource = new Uri(path, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();
                return bmp;
            }
            catch
            {
                return null;
            }
        }

        private Brush Brush(string key) => (Brush)FindResource(key);

        private void PrevButton_Click(object sender, RoutedEventArgs e)
        {
            if (_index > 0) { _index--; Render(); }
        }

        private void NextButton_Click(object sender, RoutedEventArgs e)
        {
            if (_index < _items.Count - 1) { _index++; Render(); }
        }

        // ── Git #1017 — right-click "Copy Image" (Baseline + This run) ──────
        private void CopyBaselineImage_Click(object sender, RoutedEventArgs e) => CopyImageToClipboard(BaselineImage.Source);

        private void CopyCurrentImage_Click(object sender, RoutedEventArgs e) => CopyImageToClipboard(CurrentImage.Source);

        private static void CopyImageToClipboard(ImageSource source)
        {
            if (source is BitmapSource bitmap) Clipboard.SetImage(bitmap);
        }

        private async void ReportButton_Click(object sender, RoutedEventArgs e)
        {
            string text = ComposeBox.Text?.Trim() ?? "";
            if (string.IsNullOrEmpty(text))
            {
                ShowStatus("Nothing to send — add a note first.", isError: true);
                return;
            }
            ReportButton.IsEnabled = false;
            try
            {
                await _sendToChat(text, ShowStatus, null);
            }
            catch (Exception ex)
            {
                ShowStatus($"Send failed: {ex.Message}", isError: true);
            }
            finally
            {
                ReportButton.IsEnabled = true;
            }
        }

        private async void ApproveButton_Click(object sender, RoutedEventArgs e)
        {
            if (_approved) return;
            ApproveButton.IsEnabled = false;
            ReportButton.IsEnabled = false;
            ShowStatus("Approving — updating baseline, sending note, closing issue…", isError: false);
            try
            {
                string result = await _approveAsync();
                _approved = true;
                ApproveButton.Content = "Approved ✓";
                ShowStatus(result, isError: false);
            }
            catch (Exception ex)
            {
                ShowStatus($"Approve failed: {ex.Message}", isError: true);
                ApproveButton.IsEnabled = true;
                ReportButton.IsEnabled = true;
            }
        }

        private void ShowStatus(string message, bool isError)
        {
            StatusText.Text = message;
            StatusText.Foreground = isError ? Brush("RedBrush") : Brush("GreenBrush");
        }
    }
}
