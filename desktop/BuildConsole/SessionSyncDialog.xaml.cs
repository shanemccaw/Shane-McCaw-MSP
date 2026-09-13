using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Dialog for finalizing a QA session and synchronizing all artifacts to Git under /Bugs/<ProductName>/<SessionId>/.
    /// </summary>
    public partial class SessionSyncDialog : Window
    {
        private readonly SessionSyncContext _context;
        private readonly string _repoRoot;
        private bool _isSynced;
        private SessionSyncResult? _lastResult;
        private bool _isUpdating;

        public bool IsSynced => _isSynced;
        public SessionSyncResult? Result => _lastResult;

        public SessionSyncDialog(SessionSyncContext context, string? repoRoot = null)
        {
            InitializeComponent();

            _context = context ?? new SessionSyncContext();
            _repoRoot = !string.IsNullOrWhiteSpace(repoRoot) ? repoRoot : VisualTestTrackerExportService.ResolveRepoRoot();

            InitDialog();
        }

        private void InitDialog()
        {
            _isUpdating = true;

            // Pre-select product name
            SetProductNameSelection(_context.ProductName);

            // Pre-fill session ID if not set
            if (string.IsNullOrWhiteSpace(_context.SessionId))
            {
                _context.SessionId = VisualTestTrackerSessionSyncService.GenerateSessionId(_context.StartedAt);
            }
            TxtSessionId.Text = _context.SessionId;

            // Badges
            TxtBugCountBadge.Text = _context.Entries.Count.ToString();
            TxtShotsBadge.Text = (_context.ScreenshotPaths.Count + _context.Entries.Sum(e => e.ScreenshotPaths?.Count ?? 0)).ToString();
            int errorCount = _context.ConsoleLogs.Count(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection");
            TxtErrorsBadge.Text = errorCount.ToString();
            TxtApiBadge.Text = (_context.ApiResults.Count + _context.NetworkFailures.Count).ToString();
            TxtDurationBadge.Text = $"{_context.Duration.Minutes:D2}:{_context.Duration.Seconds:D2}";

            _isUpdating = false;

            UpdatePreview();
        }

        private void SetProductNameSelection(string name)
        {
            for (int i = 0; i < CmbProductName.Items.Count; i++)
            {
                if (CmbProductName.Items[i] is ComboBoxItem cbi &&
                    string.Equals(cbi.Content as string, name, StringComparison.OrdinalIgnoreCase))
                {
                    CmbProductName.SelectedIndex = i;
                    return;
                }
            }
            CmbProductName.Text = name;
        }

        private string GetSelectedProductName()
        {
            if (CmbProductName.SelectedItem is ComboBoxItem cbi && cbi.Content is string s)
                return s;
            var txt = CmbProductName.Text?.Trim();
            return !string.IsNullOrWhiteSpace(txt) ? txt : "MSP_Console";
        }

        private void UpdatePreview()
        {
            if (_isUpdating) return;

            string prodName = GetSelectedProductName();
            string sessId = !string.IsNullOrWhiteSpace(TxtSessionId.Text) ? TxtSessionId.Text.Trim() : _context.SessionId;

            _context.ProductName = prodName;
            _context.SessionId = sessId;

            string cleanProd = VisualTestTrackerExportService.SanitizeDirectoryName(prodName);
            string destRel = $"/Bugs/{cleanProd}/{sessId}/";
            TxtDestinationPath.Text = destRel;

            // Auto-generate commit message and summary
            string commitMsg = VisualTestTrackerSessionSyncService.GenerateCommitMessage(_context);
            TxtCommitMessage.Text = commitMsg;

            string summaryMd = VisualTestTrackerSessionSyncService.GenerateSummaryMarkdown(_context);
            TxtSummaryPreview.Text = summaryMd;
        }

        private void CmbProductName_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            UpdatePreview();
        }

        private void TxtSessionId_TextChanged(object sender, TextChangedEventArgs e)
        {
            UpdatePreview();
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton == MouseButtonState.Pressed)
            {
                DragMove();
            }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = _isSynced;
            Close();
        }

        private async void BtnSyncAndPush_Click(object sender, RoutedEventArgs e)
        {
            if (_isSynced)
            {
                DialogResult = true;
                Close();
                return;
            }

            BtnSyncAndPush.IsEnabled = false;
            BtnCancel.IsEnabled = false;
            CmbProductName.IsEnabled = false;
            TxtSessionId.IsEnabled = false;
            TxtCommitMessage.IsEnabled = false;
            ChkPushToGit.IsEnabled = false;

            SyncProgressBar.Visibility = Visibility.Visible;
            StatusMessageText.Visibility = Visibility.Visible;
            StatusMessageText.Foreground = (Brush)FindResource("AccentBrush");
            StatusMessageText.Text = "Gathering artifacts & writing session files...";

            try
            {
                _context.ProductName = GetSelectedProductName();
                _context.SessionId = !string.IsNullOrWhiteSpace(TxtSessionId.Text) ? TxtSessionId.Text.Trim() : _context.SessionId;

                // Sync to Git
                StatusMessageText.Text = ChkPushToGit.IsChecked == true
                    ? "Writing artifacts, committing, and pushing to remote Git repository..."
                    : "Writing artifacts and committing to local Git repository...";

                bool push = ChkPushToGit.IsChecked == true;
                var res = await VisualTestTrackerSessionSyncService.ExecuteGitSyncAsync(_context, _repoRoot, pushToRemote: push);
                _lastResult = res;

                if (res.Success)
                {
                    _isSynced = true;
                    SyncProgressBar.Visibility = Visibility.Collapsed;

                    string commitPart = !string.IsNullOrEmpty(res.CommitHash) ? $" (Commit: {res.CommitHash})" : "";
                    string pushPart = res.PushedToRemote ? " • Pushed to remote." : (push ? " • Committed locally (push skipped/offline)." : "");

                    StatusMessageText.Text = $"✓ Session saved and synced to Git!{commitPart}{pushPart}\nPath: /Bugs/{res.ProductName}/{res.SessionId}/";
                    StatusMessageText.Foreground = (Brush)FindResource("StatusSuccessBrush");

                    BtnOpenFolder.IsEnabled = true;
                    BtnCopySummary.IsEnabled = true;
                    BtnSyncAndPush.Content = "✓ Done";
                    BtnSyncAndPush.IsEnabled = true;
                    BtnCancel.Content = "Close";
                    BtnCancel.IsEnabled = true;
                }
                else
                {
                    SyncProgressBar.Visibility = Visibility.Collapsed;
                    StatusMessageText.Text = $"❌ Sync failed: {res.Error}";
                    StatusMessageText.Foreground = (Brush)FindResource("StatusErrorBrush");
                    BtnSyncAndPush.IsEnabled = true;
                    BtnCancel.IsEnabled = true;
                }
            }
            catch (Exception ex)
            {
                SyncProgressBar.Visibility = Visibility.Collapsed;
                StatusMessageText.Text = $"❌ Error: {ex.Message}";
                StatusMessageText.Foreground = (Brush)FindResource("StatusErrorBrush");
                BtnSyncAndPush.IsEnabled = true;
                BtnCancel.IsEnabled = true;
            }
        }

        private void BtnOpenFolder_Click(object sender, RoutedEventArgs e)
        {
            if (_lastResult != null && !string.IsNullOrEmpty(_lastResult.SessionDirectory) && Directory.Exists(_lastResult.SessionDirectory))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = _lastResult.SessionDirectory,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Could not open directory: {ex.Message}", "Open Folder", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }

        private void BtnCopySummary_Click(object sender, RoutedEventArgs e)
        {
            if (!string.IsNullOrEmpty(TxtSummaryPreview.Text))
            {
                try
                {
                    Clipboard.SetText(TxtSummaryPreview.Text);
                    StatusMessageText.Text = "✓ summary.md copied to clipboard!";
                    StatusMessageText.Foreground = (Brush)FindResource("LightGreenBrush");
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Clipboard copy failed: {ex.Message}", "Copy Summary", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }
    }
}
