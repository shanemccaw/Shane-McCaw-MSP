using System;
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
    /// Git #1472 — the Visual Test Tracker floaty: a NEW standalone panel, separate
    /// from StickyNotesWindow (which stays exactly as-is). MainWindow calls
    /// <see cref="OnTrackedNavigation"/> every time the active tab navigates to a
    /// page matching one of the configured watched base URLs
    /// (BuildConsoleSettings.VisualTestTrackerBaseUrls); this window then auto-fills
    /// the read-only page path, restores/creates that page's Good/Bad + notes, and
    /// loads its screenshot gallery (newest first, full history).
    ///
    /// Standing rule from the issue: if a capture fails, show an honest failure
    /// message and never let the gallery imply something was captured when it
    /// wasn't. Same rule applies to the DB itself — if Shane hasn't yet run the
    /// visual_test_tracker_* migration, every control here disables with an honest
    /// "database not ready" message rather than silently no-op'ing or faking data.
    /// </summary>
    public partial class VisualTestTrackerWindow : Window
    {
        private readonly DispatcherTimer _notesDebounce;
        private bool _loaded;
        private bool _suppressEvents; // true while we're programmatically populating controls from a loaded page

        private VisualTestTrackerStore? _store;
        private string? _storeUnavailableReason;

        private WebView2? _activeWebView;
        private string _activeBaseUrl = "";
        private string _activePagePath = "";
        private VisualTestTrackerPage? _activePage;

        public VisualTestTrackerWindow()
        {
            InitializeComponent();

            _notesDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            _notesDebounce.Tick += (s, e) =>
            {
                _notesDebounce.Stop();
                _ = SaveCurrentPageAsync();
            };

            var settings = BuildConsoleSettings.Load();
            if (settings.VisualTestTrackerWidth > 0) Width = settings.VisualTestTrackerWidth;
            if (settings.VisualTestTrackerHeight > 0) Height = settings.VisualTestTrackerHeight;
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
            SizeChanged += (s, e) => PersistBounds();

            InitStore();
        }

        private void InitStore()
        {
            try
            {
                var connStr = VisualTestTrackerStore.ResolveConnectionString();
                if (string.IsNullOrWhiteSpace(connStr))
                {
                    _storeUnavailableReason = "No DATABASE_URL found — set one in .env.local or build-queue-watcher.config.json.";
                    return;
                }
                _store = new VisualTestTrackerStore(connStr);
            }
            catch (Exception ex)
            {
                _storeUnavailableReason = $"Couldn't set up the tracker database connection: {ex.Message}";
            }
        }

        /// <summary>MainWindow calls this on every NavigationCompleted whose tab matches a watched base URL.
        /// Loads (or creates, defaulting to Bad) that page's row and refreshes the whole panel.</summary>
        public async void OnTrackedNavigation(WebView2 webView, string baseUrl, string pagePath)
        {
            _activeWebView = webView;
            _activeBaseUrl = baseUrl;
            _activePagePath = pagePath;
            PagePathText.Text = $"{baseUrl}{pagePath}";

            if (_store == null)
            {
                ShowMessage(_storeUnavailableReason ?? "Visual Test Tracker database not available.", isError: true);
                SetControlsEnabled(false);
                return;
            }

            try
            {
                _suppressEvents = true;
                var page = await _store.GetOrCreatePageAsync(baseUrl, pagePath);
                _activePage = page;
                GoodCheckBox.IsChecked = page.IsGood;
                NotesBox.Text = page.Notes;
                SetControlsEnabled(true);
                ShowMessage("", isError: false);
                await RefreshGalleryAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Failed to load page {baseUrl}{pagePath}: {ex.Message}");
                ShowMessage($"Couldn't load this page's tracked state — has Shane run the visual_test_tracker migration? ({ex.Message})", isError: true);
                SetControlsEnabled(false);
                _activePage = null;
            }
            finally
            {
                _suppressEvents = false;
            }
        }

        /// <summary>Called by MainWindow when the active tab is no longer on a watched base URL (or no
        /// tracked tab is active at all) — clears the panel to its idle state.</summary>
        public void ClearActiveTab()
        {
            _activeWebView = null;
            _activePage = null;
            PagePathText.Text = "No tracked tab active — navigate a watched tab to a configured base URL.";
            SetControlsEnabled(false);
            GalleryPanel.Children.Clear();
            GalleryEmptyText.Visibility = Visibility.Collapsed;
            ShowMessage("", isError: false);
        }

        private void SetControlsEnabled(bool enabled)
        {
            GoodCheckBox.IsEnabled = enabled;
            NotesBox.IsEnabled = enabled;
            BtnCaptureFull.IsEnabled = enabled;
            BtnCaptureRegion.IsEnabled = enabled;
        }

        private async System.Threading.Tasks.Task SaveCurrentPageAsync()
        {
            if (_store == null || _activePage == null) return;
            try
            {
                bool isGood = GoodCheckBox.IsChecked == true;
                string notes = NotesBox.Text;
                await _store.SavePageAsync(_activePage.Id, isGood, notes);
                _activePage.IsGood = isGood;
                _activePage.Notes = notes;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Save failed for page id={_activePage?.Id}: {ex.Message}");
                ShowMessage($"Couldn't save — {ex.Message}", isError: true);
            }
        }

        private async System.Threading.Tasks.Task RefreshGalleryAsync()
        {
            GalleryPanel.Children.Clear();
            if (_store == null || _activePage == null) return;

            var shots = await _store.ListScreenshotsAsync(_activePage.Id);
            GalleryEmptyText.Visibility = shots.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

            foreach (var shot in shots)
                GalleryPanel.Children.Add(BuildThumbnailRow(shot));
        }

        private UIElement BuildThumbnailRow(VisualTestTrackerScreenshot shot)
        {
            var outer = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(4),
                Margin = new Thickness(0, 0, 0, 6),
                Padding = new Thickness(6)
            };

            var stack = new StackPanel();

            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.DecodePixelWidth = 340;
                bmp.UriSource = new Uri(shot.FilePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();
                stack.Children.Add(new Image
                {
                    Source = bmp,
                    Stretch = Stretch.Uniform,
                    MaxHeight = 220,
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Margin = new Thickness(0, 0, 0, 4)
                });
            }
            catch (Exception ex)
            {
                stack.Children.Add(new TextBlock
                {
                    Text = $"(couldn't load thumbnail: {ex.Message})",
                    Foreground = (Brush)FindResource("RedBrush"),
                    FontSize = 10,
                    TextWrapping = TextWrapping.Wrap
                });
            }

            var infoRow = new Grid();
            infoRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            infoRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            infoRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var label = new TextBlock
            {
                Text = $"{shot.CreatedAt:yyyy-MM-dd HH:mm:ss} · {shot.CaptureType}",
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(label, 0);

            var copyBtn = new Button
            {
                Content = "Copy",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(6, 2, 6, 2),
                Margin = new Thickness(4, 0, 4, 0),
                Tag = shot.FilePath
            };
            copyBtn.Click += CopyThumbnail_Click;
            Grid.SetColumn(copyBtn, 1);

            var deleteBtn = new Button
            {
                Content = "Delete",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(6, 2, 6, 2),
                Tag = shot.Id
            };
            deleteBtn.Click += DeleteThumbnail_Click;
            Grid.SetColumn(deleteBtn, 2);

            infoRow.Children.Add(label);
            infoRow.Children.Add(copyBtn);
            infoRow.Children.Add(deleteBtn);
            stack.Children.Add(infoRow);

            outer.Child = stack;
            return outer;
        }

        private void CopyThumbnail_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string path) return;
            try
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.UriSource = new Uri(path, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();
                Clipboard.SetImage(bmp);
                ShowMessage("Copied to clipboard.", isError: false);
            }
            catch (Exception ex)
            {
                ShowMessage($"Couldn't copy — {ex.Message}", isError: true);
            }
        }

        private async void DeleteThumbnail_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not int id || _store == null) return;
            try
            {
                await _store.DeleteScreenshotAsync(id);
                await RefreshGalleryAsync();
            }
            catch (Exception ex)
            {
                ShowMessage($"Couldn't delete — {ex.Message}", isError: true);
            }
        }

        private async void BtnCaptureFull_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null || _activePage == null || _store == null) return;
            BtnCaptureFull.IsEnabled = false;
            try
            {
                var result = await VisualTestTrackerCapture.CaptureFullPageAsync(_activeWebView, _activeBaseUrl, _activePagePath);
                if (!result.Success)
                {
                    ShowMessage($"Full-page capture failed — {result.Error}", isError: true);
                    return;
                }
                await _store.AddScreenshotAsync(_activePage.Id, "full", result.FilePath);
                ShowMessage("Full-page screenshot captured.", isError: false);
                await RefreshGalleryAsync();
            }
            catch (Exception ex)
            {
                ShowMessage($"Full-page capture failed — {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureFull.IsEnabled = true;
            }
        }

        private async void BtnCaptureRegion_Click(object sender, RoutedEventArgs e)
        {
            if (_activeWebView == null || _activePage == null || _store == null) return;

            // Position the overlay exactly over the WebView2's on-screen bounds.
            Point topLeft;
            try
            {
                topLeft = _activeWebView.PointToScreen(new Point(0, 0));
            }
            catch (Exception ex)
            {
                ShowMessage($"Couldn't locate the page on screen — {ex.Message}", isError: true);
                return;
            }

            var source = PresentationSource.FromVisual(_activeWebView);
            double dpiX = 1.0, dpiY = 1.0;
            if (source?.CompositionTarget != null)
            {
                dpiX = source.CompositionTarget.TransformToDevice.M11;
                dpiY = source.CompositionTarget.TransformToDevice.M22;
            }

            var overlay = new RegionSelectOverlayWindow
            {
                Left = topLeft.X / dpiX,
                Top = topLeft.Y / dpiY,
                Width = _activeWebView.ActualWidth,
                Height = _activeWebView.ActualHeight
            };

            bool? drawn = overlay.ShowDialog();
            if (drawn != true) return; // cancelled or too-small selection

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
                    ShowMessage($"Region capture failed — {result.Error}", isError: true);
                    return;
                }
                await _store.AddScreenshotAsync(_activePage.Id, "region", result.FilePath);
                ShowMessage("Region screenshot captured.", isError: false);
                await RefreshGalleryAsync();
            }
            catch (Exception ex)
            {
                ShowMessage($"Region capture failed — {ex.Message}", isError: true);
            }
            finally
            {
                BtnCaptureRegion.IsEnabled = true;
            }
        }

        private void GoodCheckBox_Changed(object sender, RoutedEventArgs e)
        {
            if (_suppressEvents) return;
            _notesDebounce.Stop();
            _ = SaveCurrentPageAsync(); // checkbox flips save immediately, not debounced
        }

        private void NotesBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppressEvents) return;
            _notesDebounce.Stop();
            _notesDebounce.Start();
        }

        private void ShowMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Visibility = string.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "RedBrush" : "GreenBrush");
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

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
                settings.VisualTestTrackerHeight = Height;
                settings.Save();
            }
            catch { /* best-effort */ }
        }
    }
}
