using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Phase 7: Dialog for exporting one or more bug reports directly into the local repo
    /// at /Bugs/<Area>/ as clean, structured JSON documents.
    /// </summary>
    public partial class ExportBugDialog : Window
    {
        private readonly List<VisualTestTrackerEntry> _entries;
        private readonly string _baseUrl;
        private readonly string _pagePath;
        private string? _lastExportedDir;

        public ExportBugDialog(List<VisualTestTrackerEntry> entries, string baseUrl, string pagePath)
        {
            InitializeComponent();

            _entries = entries ?? new List<VisualTestTrackerEntry>();
            _baseUrl = baseUrl ?? "";
            _pagePath = pagePath ?? "";

            InitDialog();
        }

        public ExportBugDialog(VisualTestTrackerEntry singleEntry, string baseUrl, string pagePath)
            : this(new List<VisualTestTrackerEntry> { singleEntry }, baseUrl, pagePath)
        {
        }

        private void InitDialog()
        {
            // Set scope description
            if (_entries.Count == 1)
            {
                var e = _entries[0];
                var title = !string.IsNullOrWhiteSpace(e.Title) ? e.Title : (!string.IsNullOrWhiteSpace(e.Notes) ? e.Notes : "Visual observation");
                if (title.Length > 50) title = title.Substring(0, 47) + "...";
                ScopeDescriptionText.Text = $"1 bug: [{e.Severity}] {title}";
            }
            else
            {
                var route = !string.IsNullOrWhiteSpace(_pagePath) ? _pagePath : "/";
                ScopeDescriptionText.Text = $"{_entries.Count} bug reports for page: {route} ({_baseUrl})";
            }

            // Auto-detect target area
            var detected = VisualTestTrackerExportService.DetectArea(_baseUrl, _pagePath);
            SetAreaSelection(detected);
            UpdateDestinationPath();

            // Wire text changed if user types a custom area into editable combobox
            CmbTargetArea.AddHandler(System.Windows.Controls.Primitives.TextBoxBase.TextChangedEvent,
                new TextChangedEventHandler((s, e) => UpdateDestinationPath()));
        }

        private void SetAreaSelection(string area)
        {
            for (int i = 0; i < CmbTargetArea.Items.Count; i++)
            {
                if (CmbTargetArea.Items[i] is ComboBoxItem cbi &&
                    string.Equals(cbi.Content as string, area, StringComparison.OrdinalIgnoreCase))
                {
                    CmbTargetArea.SelectedIndex = i;
                    return;
                }
            }
            CmbTargetArea.Text = area;
        }

        private string GetSelectedArea()
        {
            if (CmbTargetArea.SelectedItem is ComboBoxItem cbi && cbi.Content is string s)
                return s;
            var txt = CmbTargetArea.Text?.Trim();
            return !string.IsNullOrWhiteSpace(txt) ? txt : "General";
        }

        private void UpdateDestinationPath()
        {
            var area = GetSelectedArea();
            var dir = VisualTestTrackerExportService.GetAreaDirectory(area);
            DestinationPathText.Text = dir;
        }

        private void CmbTargetArea_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            UpdateDestinationPath();
        }

        private void BtnExport_Click(object sender, RoutedEventArgs e)
        {
            var area = GetSelectedArea();
            bool copyShots = ChkCopyScreenshots.IsChecked == true;

            BtnExport.IsEnabled = false;
            try
            {
                BugExportResult result;
                if (_entries.Count == 1)
                {
                    result = VisualTestTrackerExportService.ExportEntry(_entries[0], area, copyShots);
                }
                else
                {
                    result = VisualTestTrackerExportService.ExportEntries(_entries, area, copyShots);
                }

                if (result.Success)
                {
                    _lastExportedDir = result.DirectoryPath;
                    BtnOpenFolder.IsEnabled = true;
                    BtnExport.Content = "✓ Re-Export to Local Repo";

                    string shotMsg = result.CopiedScreenshots.Count > 0
                        ? $" with {result.CopiedScreenshots.Count} screenshot(s) bundled in attachments/"
                        : "";
                    StatusMessageText.Text = $"✓ Successfully exported {result.ExportedCount} bug report(s) to /Bugs/{result.Area}/{shotMsg}.";
                    StatusMessageText.Foreground = (Brush)FindResource("StatusSuccessBrush");
                    StatusMessageText.Visibility = Visibility.Visible;
                }
                else
                {
                    StatusMessageText.Text = $"Export failed: {result.Error}";
                    StatusMessageText.Foreground = (Brush)FindResource("StatusErrorBrush");
                    StatusMessageText.Visibility = Visibility.Visible;
                }
            }
            catch (Exception ex)
            {
                StatusMessageText.Text = $"Export error: {ex.Message}";
                StatusMessageText.Foreground = (Brush)FindResource("StatusErrorBrush");
                StatusMessageText.Visibility = Visibility.Visible;
            }
            finally
            {
                BtnExport.IsEnabled = true;
            }
        }

        private void BtnOpenFolder_Click(object sender, RoutedEventArgs e)
        {
            var targetDir = _lastExportedDir ?? VisualTestTrackerExportService.GetAreaDirectory(GetSelectedArea());
            if (Directory.Exists(targetDir))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = targetDir,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Could not open directory: {ex.Message}", "Open Folder", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
            else
            {
                MessageBox.Show($"Directory does not exist yet: {targetDir}", "Folder Missing", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}
