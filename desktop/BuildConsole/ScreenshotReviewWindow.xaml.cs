using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
