using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using BuildConsole.Services;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole
{
    /// <summary>
    /// Upgraded Visual Test Tracker:
    /// - True Bug List &amp; Issue Entries (notes + screenshots binding, status management, markdown export).
    /// - Crash-safe keystroke auto-save (persisted to drafts.json across navigations, app restarts, and crashes).
    /// - Live Session Indicator showing active tab, route, and test duration.
    /// - Collapsible/minimize mode for a compact floating HUD.
    /// - Screenshot &amp; Annotation features: WebView2 full/region captures, full WPF window (HUD/overlays) capture,
    ///   and interactive InkCanvas studio (pen, highlighter, shapes, arrows, text, blackout redaction).
    /// - Title-bar API Helper integration for creating test accounts and executing page actions.
    /// </summary>
    public partial class VisualTestTrackerWindow : Window
    {
        private readonly DispatcherTimer _autoSaveDebounce;
        private readonly DispatcherTimer _sessionTimer;
        private DateTime _sessionStartTime = DateTime.Now;

        private bool _loaded;
        private bool _suppressEvents;
        private bool _isCollapsed;
        private double _expandedHeight = 680;

        private VisualTestTrackerStore? _store;
        private string? _storeUnavailableReason;

        private WebView2? _activeWebView;
        private string _activeBaseUrl = "";
        private string _activePagePath = "";
        private VisualTestTrackerPage? _activePage;

        private string _selectedSeverity = "Bug";
        private readonly List<string> _stagedScreenshots = new();
        private List<VisualTestTrackerEntry> _currentEntries = new();
        private string _activeFilter = "All"; // "All", "Open", "Resolved"

        private ApiHelperWindow? _apiHelperWindow;

        public VisualTestTrackerWindow()
        {
            InitializeComponent();

            _autoSaveDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
            _autoSaveDebounce.Tick += (s, e) =>
            {
                _autoSaveDebounce.Stop();
                PerformAutoSave();
            };

            _sessionTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _sessionTimer.Tick += (s, e) =>
            {
                var elapsed = DateTime.Now - _sessionStartTime;
                SessionTimerText.Text = $"⏱ {elapsed:mm\\:ss}";
            };
            _sessionTimer.Start();

            var settings = BuildConsoleSettings.Load();
            if (settings.VisualTestTrackerWidth > 0) Width = settings.VisualTestTrackerWidth;
            if (settings.VisualTestTrackerHeight > 0)
            {
                Height = settings.VisualTestTrackerHeight;
                _expandedHeight = Height;
            }
            if (settings.VisualTestTrackerLeft >= 0 && settings.VisualTestTrackerTop >= 0)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = settings.VisualTestTrackerLeft;
                Top = settings.VisualTestTrackerTop;
            }
            else
            {
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }

            Loaded += (s, e) => _loaded = true;
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) =>
            {
                if (!_isCollapsed) _expandedHeight = Height;
                PersistBounds();
            };

            InitStore();
        }

        private void InitStore()
        {
            try
            {
                var connStr = VisualTestTrackerStore.ResolveConnectionString();
                if (!string.IsNullOrWhiteSpace(connStr))
                {
                    _store = new VisualTestTrackerStore(connStr);
                }
                else
                {
                    // Fall back cleanly to local storage without disabling tracker
                    _store = new VisualTestTrackerStore("Host=localhost;Database=local_fallback;Username=postgres;Password=postgres");
                }
            }
            catch (Exception ex)
            {
                _storeUnavailableReason = ex.Message;
                // Store will still use local JSON file persistence
                try
                {
                    _store = new VisualTestTrackerStore("Host=localhost;Database=local_fallback;Username=postgres;Password=postgres");
                }
                catch { }
            }
        }

        /// <summary>Called on navigation to a watched base URL.</summary>
        public async void OnTrackedNavigation(WebView2 webView, string baseUrl, string pagePath)
        {
            // Auto-save any previous page's draft before switching
            if (!string.IsNullOrWhiteSpace(_activeBaseUrl) && (!string.IsNullOrWhiteSpace(NotesBox.Text) || _stagedScreenshots.Count > 0))
            {
                VisualTestTrackerDraftStore.SaveDraft(_activeBaseUrl, _activePagePath, NotesBox.Text, _selectedSeverity, _stagedScreenshots);
            }

            _activeWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;
            _sessionStartTime = DateTime.Now;

            // Update Session Indicator
            UpdateSessionIndicator(true);

            // Notify API Helper if open
            _apiHelperWindow?.UpdateActivePage(webView, baseUrl, pagePath);

            SetControlsEnabled(true);

            try
            {
                _suppressEvents = true;

                if (_store != null)
                {
                    try
                    {
                        var page = await _store.GetOrCreatePageAsync(baseUrl, pagePath);
                        _activePage = page;
                        GoodCheckBox.IsChecked = page.IsGood;
                    }
                    catch
                    {
                        // Offline or DB not ready — keep UI enabled using local tracking
                        _activePage = new VisualTestTrackerPage { BaseUrl = baseUrl, PagePath = pagePath };
                    }
                }

                // Restore draft from crash-safe store if present
                var draft = VisualTestTrackerDraftStore.GetDraft(baseUrl, pagePath);
                if (draft != null)
                {
                    NotesBox.Text = draft.Notes;
                    SetSeveritySelection(draft.Severity);
                    _stagedScreenshots.Clear();
                    _stagedScreenshots.AddRange(draft.StagedScreenshots);
                    RenderStagedThumbnails();
                    AutoSaveIndicator.Text = "✓ Draft Restored";
                }
                else
                {
                    NotesBox.Text = _activePage?.Notes ?? "";
                    SetSeveritySelection("Bug");
                    _stagedScreenshots.Clear();
                    RenderStagedThumbnails();
                    AutoSaveIndicator.Text = "✓ Ready";
                }

                ShowMessage("", isError: false);
                await RefreshBugListAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Failed on navigation: {ex.Message}");
                ShowMessage($"Tracker running locally: {ex.Message}", isError: false);
            }
            finally
            {
                _suppressEvents = false;
            }
        }

        /// <summary>Called when the active tab is no longer on a watched URL.</summary>
        public void ClearActiveTab()
        {
            if (!string.IsNullOrWhiteSpace(_activeBaseUrl) && (!string.IsNullOrWhiteSpace(NotesBox.Text) || _stagedScreenshots.Count > 0))
            {
                VisualTestTrackerDraftStore.SaveDraft(_activeBaseUrl, _activePagePath, NotesBox.Text, _selectedSeverity, _stagedScreenshots);
            }

            _activeWebView = null;
            _activePage = null;
            UpdateSessionIndicator(false);
            SetControlsEnabled(false);
            _apiHelperWindow?.UpdateActivePage(null, "", "");
        }

        private void UpdateSessionIndicator(bool isConnected)
        {
            if (isConnected && !string.IsNullOrWhiteSpace(_activeBaseUrl))
            {
                SessionPulseDot.Fill = (Brush)FindResource("StatusSuccessBrush");
                SessionPulseDot.ToolTip = "Active testing session";

                // Tab title or route
                string routeDisplay = _activePagePath;
                if (string.IsNullOrEmpty(routeDisplay)) routeDisplay = "/";
                SessionIndicatorText.Text = $"{routeDisplay} ({_activeBaseUrl})";
                SessionIndicatorText.ToolTip = $"{_activeBaseUrl}{_activePagePath}";
            }
            else
            {
                SessionPulseDot.Fill = (Brush)FindResource("StatusWarningBrush");
                SessionPulseDot.ToolTip = "Idle — no watched tab active";
                SessionIndicatorText.Text = "No tracked tab active — navigate a watched URL";
                SessionIndicatorText.ToolTip = null;
            }
        }

        private void SetControlsEnabled(bool enabled)
        {
            GoodCheckBox.IsEnabled = enabled;
            NotesBox.IsEnabled = enabled;
            CmbSeverity.IsEnabled = enabled;
            BtnCaptureFull.IsEnabled = enabled;
            BtnCaptureRegion.IsEnabled = enabled;
            BtnCaptureWpfWindow.IsEnabled = enabled;
            BtnSaveEntry.IsEnabled = enabled;
            BtnClearDraft.IsEnabled = enabled;
        }

        // ── Auto-Save & Keystroke Persistence ────────────────────────────────────

        private void NotesBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppressEvents) return;
            AutoSaveIndicator.Text = "Saving...";
            _autoSaveDebounce.Stop();
            _autoSaveDebounce.Start();
        }

        private void CmbSeverity_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CmbSeverity.SelectedItem is ComboBoxItem item && item.Content is string s)
            {
                _selectedSeverity = s;
                if (!_suppressEvents) PerformAutoSave();
            }
        }

        private void SetSeveritySelection(string severity)
        {
            _selectedSeverity = severity;
            for (int i = 0; i < CmbSeverity.Items.Count; i++)
            {
                if (CmbSeverity.Items[i] is ComboBoxItem cbi && string.Equals(cbi.Content as string, severity, StringComparison.OrdinalIgnoreCase))
                {
                    CmbSeverity.SelectedIndex = i;
                    break;
                }
            }
        }

        private void PerformAutoSave()
        {
            if (string.IsNullOrWhiteSpace(_activeBaseUrl)) return;
            try
            {
                VisualTestTrackerDraftStore.SaveDraft(_activeBaseUrl, _activePagePath, NotesBox.Text, _selectedSeverity, _stagedScreenshots);
                AutoSaveIndicator.Text = "✓ Auto-Saved";
            }
            catch
            {
                AutoSaveIndicator.Text = "Save error";
            }
        }

        private void GoodCheckBox_Changed(object sender, RoutedEventArgs e)
        {
            if (_suppressEvents || _store == null || _activePage == null) return;
            _ = SaveCurrentPageCleanStatusAsync();
        }

        private async System.Threading.Tasks.Task SaveCurrentPageCleanStatusAsync()
        {
            if (_store == null || _activePage == null) return;
            try
            {
                bool isGood = GoodCheckBox.IsChecked == true;
                await _store.SavePageAsync(_activePage.Id, isGood, NotesBox.Text);
                _activePage.IsGood = isGood;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Clean status save failed: {ex.Message}");
            }
        }

        // ── Capture Actions ──────────────────────────────────────────────────────

        private async void BtnCaptureFull_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;
            BtnCaptureFull.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCapture.CaptureFullPageAsync(_activeWebView, _activeBaseUrl, _activePagePath);
                if (!result.Success)
                {
                    ShowMessage($"Full-page capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                PerformAutoSave();
                ShowMessage("Full page captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureFull.IsEnabled = true;
            }
        }

        private async void BtnCaptureRegion_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null) return;

            Point topLeft;
            try
            {
                topLeft = _activeWebView.PointToScreen(new Point(0, 0));
            }
            catch (Exception ex)
            {
                ShowMessage($"Could not locate WebView2 on screen: {ex.Message}", isError: true);
                return;
            }

            var source = PresentationSource.FromVisual(_activeWebView);
            double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
            double dpiY = source?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;

            var overlay = new RegionSelectOverlayWindow
            {
                Left = topLeft.X / dpiX,
                Top = topLeft.Y / dpiY,
                Width = _activeWebView.ActualWidth,
                Height = _activeWebView.ActualHeight
            };

            bool? drawn = overlay.ShowDialog();
            if (drawn != true) return;

            var rect = overlay.SelectedRect;
            var deviceRect = new Int32Rect(
                (int)Math.Round(rect.X * dpiX),
                (int)Math.Round(rect.Y * dpiY),
                (int)Math.Round(rect.Width * dpiX),
                (int)Math.Round(rect.Height * dpiY));

            BtnCaptureRegion.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCapture.CaptureRegionAsync(_activeWebView, _activeBaseUrl, _activePagePath, deviceRect);
                if (!result.Success)
                {
                    ShowMessage($"Region capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                PerformAutoSave();
                ShowMessage("Region captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Region capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureRegion.IsEnabled = true;
            }
        }

        private async void BtnCaptureWpfWindow_Click(object sender, RoutedEventArgs e)
        {
            BtnCaptureWpfWindow.IsEnabled = false;
            try
            {
                // Capture the main BuildConsole application window (including HUD, overlays, and dialogs)
                var targetWin = Application.Current.MainWindow ?? this;
                var result = await VisualTestTrackerCapture.CaptureWpfWindowAsync(targetWin, _activeBaseUrl, _activePagePath);
                if (!result.Success)
                {
                    ShowMessage($"Window capture failed: {result.Error}", isError: true);
                    return;
                }

                _stagedScreenshots.Add(result.FilePath);
                RenderStagedThumbnails();
                PerformAutoSave();
                ShowMessage("Full WPF window HUD captured & attached to draft.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Window capture failed: {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureWpfWindow.IsEnabled = true;
            }
        }

        private void RenderStagedThumbnails()
        {
            StagedThumbnailsPanel.Children.Clear();
            StagedScreenshotsContainer.Visibility = _stagedScreenshots.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var path in _stagedScreenshots)
            {
                var thumb = BuildStagedThumbnail(path);
                StagedThumbnailsPanel.Children.Add(thumb);
            }
        }

        private UIElement BuildStagedThumbnail(string filePath)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("Surface1Brush"),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 0, 6, 0),
                Padding = new Thickness(4)
            };

            var stack = new StackPanel();

            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 140;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                var img = new Image
                {
                    Source = bmp,
                    Height = 60,
                    Stretch = Stretch.Uniform,
                    Margin = new Thickness(0, 0, 0, 4)
                };
                stack.Children.Add(img);
            }
            catch
            {
                stack.Children.Add(new TextBlock { Text = "(image)", FontSize = 9, Foreground = (Brush)FindResource("Subtext1Brush") });
            }

            var btnRow = new Grid();
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var annotateBtn = new Button
            {
                Content = "✏ Annotate",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Tag = filePath
            };
            annotateBtn.Click += StagedAnnotate_Click;
            Grid.SetColumn(annotateBtn, 0);

            var removeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 0, 0),
                Tag = filePath
            };
            removeBtn.Click += StagedRemove_Click;
            Grid.SetColumn(removeBtn, 1);

            btnRow.Children.Add(annotateBtn);
            btnRow.Children.Add(removeBtn);
            stack.Children.Add(btnRow);

            border.Child = stack;
            return border;
        }

        private void StagedAnnotate_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string path) return;

            var annotWin = new ScreenshotAnnotationWindow(path) { Owner = this };
            if (annotWin.ShowDialog() == true && !string.IsNullOrEmpty(annotWin.ResultFilePath))
            {
                int idx = _stagedScreenshots.IndexOf(path);
                if (idx >= 0)
                {
                    _stagedScreenshots[idx] = annotWin.ResultFilePath;
                    RenderStagedThumbnails();
                    PerformAutoSave();
                    ShowMessage("Annotated screenshot updated in draft.", isError: false);
                }
            }
        }

        private void StagedRemove_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string path) return;
            _stagedScreenshots.Remove(path);
            RenderStagedThumbnails();
            PerformAutoSave();
        }

        // ── Bug Entry Save & Management ──────────────────────────────────────────

        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            // Ctrl+Enter commits the bug entry
            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                if (BtnSaveEntry.IsEnabled)
                {
                    e.Handled = true;
                    BtnSaveEntry_Click(this, new RoutedEventArgs());
                }
            }
        }

        private async void BtnSaveEntry_Click(object sender, RoutedEventArgs e)
        {
            var notes = NotesBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(notes) && _stagedScreenshots.Count == 0)
            {
                ShowMessage("Please enter notes or capture a screenshot before saving.", isError: true);
                return;
            }

            BtnSaveEntry.IsEnabled = false;

            try
            {
                var entry = new VisualTestTrackerEntry
                {
                    PageId = _activePage?.Id ?? 0,
                    BaseUrl = _activeBaseUrl,
                    PagePath = _activePagePath,
                    Title = ExtractTitleFromNotes(notes),
                    Notes = notes,
                    Severity = _selectedSeverity,
                    Status = "Open",
                    ScreenshotPaths = new List<string>(_stagedScreenshots),
                    CreatedAt = DateTime.Now,
                    UpdatedAt = DateTime.Now
                };

                if (_store != null)
                {
                    await _store.SaveEntryAsync(entry);
                }

                // Clear draft
                VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
                NotesBox.Text = "";
                _stagedScreenshots.Clear();
                RenderStagedThumbnails();
                AutoSaveIndicator.Text = "✓ Saved";

                ShowMessage($"Saved {entry.Severity} entry to Bug List.", isError: false);
                await RefreshBugListAsync();
            }
            catch (Exception ex)
            {
                ShowMessage($"Failed to save entry: {ex.Message}", isError: true);
            }
            finally
            {
                BtnSaveEntry.IsEnabled = true;
            }
        }

        private void BtnClearDraft_Click(object sender, RoutedEventArgs e)
        {
            NotesBox.Text = "";
            _stagedScreenshots.Clear();
            RenderStagedThumbnails();
            VisualTestTrackerDraftStore.ClearDraft(_activeBaseUrl, _activePagePath);
            AutoSaveIndicator.Text = "Cleared";
            ShowMessage("Draft cleared.", isError: false);
        }

        private static string ExtractTitleFromNotes(string notes)
        {
            if (string.IsNullOrWhiteSpace(notes)) return "Visual Observation";
            var lines = notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length > 0)
            {
                var first = lines[0].Trim();
                if (first.Length > 60) return first.Substring(0, 57) + "...";
                return first;
            }
            return "Visual Observation";
        }

        // ── Bug List Refresh & Card Rendering ───────────────────────────────────

        private async System.Threading.Tasks.Task RefreshBugListAsync()
        {
            BugListPanel.Children.Clear();
            if (_store == null) return;

            try
            {
                var entries = await _store.ListEntriesAsync(_activePage?.Id ?? 0, _activeBaseUrl, _activePagePath);
                _currentEntries = entries;

                var filtered = _currentEntries.FindAll(e =>
                {
                    if (string.Equals(_activeFilter, "Open", StringComparison.OrdinalIgnoreCase))
                        return string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase);
                    if (string.Equals(_activeFilter, "Resolved", StringComparison.OrdinalIgnoreCase))
                        return string.Equals(e.Status, "Resolved", StringComparison.OrdinalIgnoreCase);
                    return true;
                });

                int openCount = _currentEntries.FindAll(e => string.Equals(e.Status, "Open", StringComparison.OrdinalIgnoreCase)).Count;
                BugCountHeader.Text = $"BUG LIST ({openCount} open / {_currentEntries.Count} total)";
                BugListEmptyText.Visibility = filtered.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

                foreach (var entry in filtered)
                {
                    BugListPanel.Children.Add(BuildBugEntryCard(entry));
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"RefreshBugListAsync error: {ex.Message}");
            }
        }

        private UIElement BuildBugEntryCard(VisualTestTrackerEntry entry)
        {
            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Margin = new Thickness(0, 0, 0, 6),
                Padding = new Thickness(8)
            };

            var stack = new StackPanel();

            // Header row: Status toggle button + Severity + Timestamp + Actions
            var header = new Grid { Margin = new Thickness(0, 0, 0, 4) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Status Toggle Button (Clickable pill)
            bool isOpen = string.Equals(entry.Status, "Open", StringComparison.OrdinalIgnoreCase);
            var statusBtn = new Button
            {
                Content = isOpen ? "● Open" : "✓ Resolved",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(6, 1, 6, 1),
                Foreground = (Brush)FindResource(isOpen ? "StatusErrorBrush" : "StatusSuccessBrush"),
                ToolTip = "Click to toggle Open / Resolved status",
                Tag = entry
            };
            statusBtn.Click += async (s, e) =>
            {
                string nextStatus = isOpen ? "Resolved" : "Open";
                entry.Status = nextStatus;
                if (_store != null) await _store.UpdateEntryStatusAsync(entry.EntryUuid, nextStatus);
                await RefreshBugListAsync();
            };
            Grid.SetColumn(statusBtn, 0);

            // Severity Badge
            var sevColor = entry.Severity switch
            {
                "Blocker" => "#F38BA8",
                "UI Glitch" => "#FAB387",
                "Functional" => "#F9E2AF",
                _ => "#EBA0AC"
            };
            var sevBadge = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(sevColor)),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(4, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = entry.Severity.ToUpperInvariant(),
                    FontSize = 8,
                    FontWeight = FontWeights.Bold,
                    Foreground = Brushes.Black
                }
            };
            Grid.SetColumn(sevBadge, 1);

            // Timestamp
            var timeText = new TextBlock
            {
                Text = $"{entry.CreatedAt:HH:mm:ss}",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0)
            };
            Grid.SetColumn(timeText, 2);

            // Copy Markdown Button
            var copyMdBtn = new Button
            {
                Content = "📋",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 2, 0),
                ToolTip = "Copy this bug as Markdown",
                Tag = entry
            };
            copyMdBtn.Click += (s, e) =>
            {
                Clipboard.SetText(entry.ToMarkdown());
                ShowMessage("Bug markdown copied to clipboard.", isError: false);
            };
            Grid.SetColumn(copyMdBtn, 3);

            // Delete Button
            var delBtn = new Button
            {
                Content = "🗑",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                ToolTip = "Delete this bug entry",
                Tag = entry.EntryUuid
            };
            delBtn.Click += async (s, e) =>
            {
                if (MessageBox.Show("Delete this bug entry?", "Confirm Delete", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
                {
                    if (_store != null) await _store.DeleteEntryAsync(entry.EntryUuid);
                    await RefreshBugListAsync();
                }
            };
            Grid.SetColumn(delBtn, 4);

            header.Children.Add(statusBtn);
            header.Children.Add(sevBadge);
            header.Children.Add(timeText);
            header.Children.Add(copyMdBtn);
            header.Children.Add(delBtn);
            stack.Children.Add(header);

            // Notes Body
            if (!string.IsNullOrWhiteSpace(entry.Notes))
            {
                var notesText = new TextBox
                {
                    Text = entry.Notes,
                    FontSize = 11,
                    Foreground = (Brush)FindResource("TextBrush"),
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    IsReadOnly = true,
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 2, 0, 4)
                };
                stack.Children.Add(notesText);
            }

            // Attached Screenshots
            if (entry.ScreenshotPaths != null && entry.ScreenshotPaths.Count > 0)
            {
                var shotRow = new WrapPanel { Margin = new Thickness(0, 2, 0, 0) };
                foreach (var shotPath in entry.ScreenshotPaths)
                {
                    if (File.Exists(shotPath))
                    {
                        var shotThumb = BuildSavedScreenshotThumbnail(shotPath, entry);
                        shotRow.Children.Add(shotThumb);
                    }
                }
                stack.Children.Add(shotRow);
            }

            card.Child = stack;
            return card;
        }

        private UIElement BuildSavedScreenshotThumbnail(string filePath, VisualTestTrackerEntry entry)
        {
            var border = new Border
            {
                Background = (Brush)FindResource("Surface1Brush"),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 0, 6, 4),
                Padding = new Thickness(3)
            };

            var stack = new StackPanel();

            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 160;
                bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                var img = new Image
                {
                    Source = bmp,
                    MaxHeight = 80,
                    Stretch = Stretch.Uniform,
                    Margin = new Thickness(0, 0, 0, 2),
                    Cursor = Cursors.Hand,
                    ToolTip = "Click to open in Annotation Studio"
                };
                img.MouseLeftButtonDown += (s, e) =>
                {
                    var win = new ScreenshotAnnotationWindow(filePath) { Owner = this };
                    if (win.ShowDialog() == true && !string.IsNullOrEmpty(win.ResultFilePath))
                    {
                        int idx = entry.ScreenshotPaths.IndexOf(filePath);
                        if (idx >= 0) entry.ScreenshotPaths[idx] = win.ResultFilePath;
                        if (_store != null) _ = _store.SaveEntryAsync(entry);
                        _ = RefreshBugListAsync();
                    }
                };
                stack.Children.Add(img);
            }
            catch
            {
                stack.Children.Add(new TextBlock { Text = "(image)", FontSize = 9, Foreground = (Brush)FindResource("Subtext1Brush") });
            }

            var btnRow = new Grid();
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var copyBtn = new Button
            {
                Content = "Copy",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Tag = filePath
            };
            copyBtn.Click += (s, e) =>
            {
                try
                {
                    var bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.UriSource = new Uri(filePath, UriKind.Absolute);
                    bmp.EndInit();
                    Clipboard.SetImage(bmp);
                    ShowMessage("Screenshot copied to clipboard.", isError: false);
                }
                catch (Exception ex)
                {
                    ShowMessage($"Copy error: {ex.Message}", isError: true);
                }
            };
            Grid.SetColumn(copyBtn, 0);

            var annotBtn = new Button
            {
                Content = "✏",
                Style = (Style)FindResource("IconButton"),
                FontSize = 9,
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(2, 0, 0, 0),
                ToolTip = "Annotate this screenshot",
                Tag = filePath
            };
            annotBtn.Click += (s, e) =>
            {
                var win = new ScreenshotAnnotationWindow(filePath) { Owner = this };
                if (win.ShowDialog() == true && !string.IsNullOrEmpty(win.ResultFilePath))
                {
                    int idx = entry.ScreenshotPaths.IndexOf(filePath);
                    if (idx >= 0) entry.ScreenshotPaths[idx] = win.ResultFilePath;
                    if (_store != null) _ = _store.SaveEntryAsync(entry);
                    _ = RefreshBugListAsync();
                }
            };
            Grid.SetColumn(annotBtn, 1);

            btnRow.Children.Add(copyBtn);
            btnRow.Children.Add(annotBtn);
            stack.Children.Add(btnRow);

            border.Child = stack;
            return border;
        }

        private void BtnFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tag)
            {
                _activeFilter = tag;
                _ = RefreshBugListAsync();
            }
        }

        private void BtnCopyAllMarkdown_Click(object sender, RoutedEventArgs e)
        {
            if (_currentEntries.Count == 0)
            {
                ShowMessage("No bug entries to copy.", isError: true);
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"# Visual Test Report — {_activeBaseUrl}{_activePagePath}");
            sb.AppendLine($"**Generated**: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"**Total Issues**: {_currentEntries.Count}");
            sb.AppendLine();

            foreach (var entry in _currentEntries)
            {
                sb.AppendLine(entry.ToMarkdown());
                sb.AppendLine("---");
                sb.AppendLine();
            }

            Clipboard.SetText(sb.ToString());
            ShowMessage("Full page bug report copied as Markdown.", isError: false);
        }

        // ── Collapsible / Mini Mode ──────────────────────────────────────────────

        private void BtnToggleCollapse_Click(object sender, RoutedEventArgs e)
        {
            if (!_isCollapsed)
            {
                // Collapse to compact HUD bar
                _expandedHeight = Height;
                MainWorkspaceGrid.Visibility = Visibility.Collapsed;
                Height = 110;
                BtnToggleCollapse.Content = "▼ Full";
                BtnToggleCollapse.ToolTip = "Expand full workspace";
                _isCollapsed = true;
            }
            else
            {
                // Expand back to full workspace
                MainWorkspaceGrid.Visibility = Visibility.Visible;
                Height = _expandedHeight > 200 ? _expandedHeight : 680;
                BtnToggleCollapse.Content = "▲ Mini";
                BtnToggleCollapse.ToolTip = "Collapse to mini HUD bar";
                _isCollapsed = false;
            }
        }

        // ── Title Bar API Helper ─────────────────────────────────────────────────

        private void BtnApiHelper_Click(object sender, RoutedEventArgs e)
        {
            if (_apiHelperWindow != null && _apiHelperWindow.IsLoaded)
            {
                _apiHelperWindow.Activate();
                return;
            }

            _apiHelperWindow = new ApiHelperWindow(_activeWebView, _activeBaseUrl, _activePagePath)
            {
                Owner = this
            };
            _apiHelperWindow.Closed += (s, e) => _apiHelperWindow = null;
            _apiHelperWindow.Show();
        }

        // ── Standard Window Plumbing ────────────────────────────────────────────

        private void ShowMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "StatusErrorBrush" : "StatusSuccessBrush");
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            _apiHelperWindow?.Close();
            Close();
        }

        private void PersistBounds()
        {
            if (!_loaded) return;
            if (WindowState != WindowState.Normal) return;
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.VisualTestTrackerLeft = Left;
                settings.VisualTestTrackerTop = Top;
                settings.VisualTestTrackerWidth = Width;
                if (!_isCollapsed) settings.VisualTestTrackerHeight = Height;
                settings.Save();
            }
            catch { }
        }
    }
}
