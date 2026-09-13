using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace BuildConsole
{
    public partial class VisualDiffWindow : Window
    {
        private readonly string _pageUrl;
        private readonly Action<Services.VisualDiffService.VisualDiffResult>? _onAttachToBug;
        private Services.VisualDiffService.VisualDiffResult? _currentResult;
        private bool _isSyncingScroll;
        private double _currentZoom = 1.0;

        public VisualDiffWindow(string pageUrl, string? currentScreenshotPath = null, Action<Services.VisualDiffService.VisualDiffResult>? onAttachToBug = null)
        {
            InitializeComponent();
            _pageUrl = pageUrl;
            _onAttachToBug = onAttachToBug;

            TxtPageUrl.Text = string.IsNullOrWhiteSpace(pageUrl) ? "about:blank" : pageUrl;

            LoadScreenshotOptions(currentScreenshotPath);
        }

        private void LoadScreenshotOptions(string? preferredCurrentPath)
        {
            var available = Services.VisualDiffService.GetAvailableScreenshotsForPage(_pageUrl);

            CboBaseline.Items.Clear();
            CboCurrent.Items.Clear();

            string baselinePath = Services.VisualDiffService.GetBaselinePath(_pageUrl);
            if (File.Exists(baselinePath))
            {
                CboBaseline.Items.Add(new ComboBoxItem { Content = $"⭐ Baseline: {Path.GetFileName(baselinePath)}", Tag = baselinePath });
            }

            foreach (var file in available)
            {
                if (file.Equals(baselinePath, StringComparison.OrdinalIgnoreCase)) continue;
                string label = $"{Path.GetFileName(file)} ({File.GetLastWriteTime(file):MM/dd HH:mm})";
                CboBaseline.Items.Add(new ComboBoxItem { Content = label, Tag = file });
                CboCurrent.Items.Add(new ComboBoxItem { Content = label, Tag = file });
            }

            // If preferredCurrentPath is supplied, make sure it's in CboCurrent and selected
            if (!string.IsNullOrEmpty(preferredCurrentPath) && File.Exists(preferredCurrentPath))
            {
                bool exists = false;
                foreach (ComboBoxItem item in CboCurrent.Items)
                {
                    if (string.Equals(item.Tag as string, preferredCurrentPath, StringComparison.OrdinalIgnoreCase))
                    {
                        CboCurrent.SelectedItem = item;
                        exists = true;
                        break;
                    }
                }
                if (!exists)
                {
                    var newItem = new ComboBoxItem
                    {
                        Content = $"📷 Current: {Path.GetFileName(preferredCurrentPath)}",
                        Tag = preferredCurrentPath
                    };
                    CboCurrent.Items.Insert(0, newItem);
                    CboCurrent.SelectedItem = newItem;
                }
            }
            else if (CboCurrent.Items.Count > 0)
            {
                CboCurrent.SelectedIndex = 0;
            }

            if (CboBaseline.Items.Count > 0)
            {
                CboBaseline.SelectedIndex = 0;
            }

            RunDiff();
        }

        private void RunDiff()
        {
            string? baselinePath = (CboBaseline.SelectedItem as ComboBoxItem)?.Tag as string;
            string? currentPath = (CboCurrent.SelectedItem as ComboBoxItem)?.Tag as string;

            if (string.IsNullOrEmpty(baselinePath) || !File.Exists(baselinePath) ||
                string.IsNullOrEmpty(currentPath) || !File.Exists(currentPath))
            {
                TxtDiffStats.Text = "Select both a baseline and a current screenshot to compare.";
                TxtDiffStatusIcon.Text = "⚠️";
                BadgeDiffStats.Background = (Brush)FindResource("Surface0Brush");
                return;
            }

            double tolerance = SliderTolerance.Value;
            var result = Services.VisualDiffService.Compare(baselinePath, currentPath, tolerance);
            _currentResult = result;

            if (!result.Success)
            {
                TxtDiffStats.Text = $"Error: {result.Error}";
                TxtDiffStatusIcon.Text = "❌";
                BadgeDiffStats.Background = new SolidColorBrush(Color.FromRgb(80, 20, 20));
                return;
            }

            // Update stats
            TxtDiffStats.Text = $"{result.DiffPercentage:F2}% diff ({result.MismatchedPixels:N0} / {result.TotalPixels:N0} px mismatched) • {result.SimilarityPercentage:F2}% match";

            if (result.DiffPercentage == 0.0)
            {
                TxtDiffStatusIcon.Text = "✅";
                BadgeDiffStats.Background = new SolidColorBrush(Color.FromRgb(20, 60, 30));
            }
            else if (result.DiffPercentage <= 2.0)
            {
                TxtDiffStatusIcon.Text = "⚡";
                BadgeDiffStats.Background = new SolidColorBrush(Color.FromRgb(40, 50, 20));
            }
            else
            {
                TxtDiffStatusIcon.Text = "⚠️";
                BadgeDiffStats.Background = new SolidColorBrush(Color.FromRgb(70, 30, 20));
            }

            // Update Side-by-Side
            ImgBaseline.Source = result.BaselineImage;
            ImgCurrent.Source = result.CurrentImage;

            // Update Swipe Slider
            ImgSwipeBaseline.Source = result.BaselineImage;
            ImgSwipeCurrent.Source = result.CurrentImage;
            UpdateSwipeClip();

            // Update Heatmap
            ImgHeatmap.Source = result.DiffMapImage;
        }

        private void UpdateSwipeClip()
        {
            if (_currentResult?.BaselineImage == null) return;
            double w = _currentResult.Width;
            double h = _currentResult.Height;

            double splitX = w * SliderSwipePosition.Value;
            SwipeClipRect.Rect = new Rect(splitX, 0, Math.Max(0, w - splitX), h);

            // Position divider line & thumb
            SwipeDividerLine.X1 = splitX;
            SwipeDividerLine.Y1 = 0;
            SwipeDividerLine.X2 = splitX;
            SwipeDividerLine.Y2 = h;

            Canvas.SetLeft(SwipeThumbBadge, splitX - 12);
            Canvas.SetTop(SwipeThumbBadge, (h / 2) - 12);
        }

        private void DiffMode_Changed(object sender, RoutedEventArgs e)
        {
            if (PanelSideBySide == null || PanelSwipeSlider == null || PanelHeatmap == null) return;

            PanelSideBySide.Visibility = Visibility.Collapsed;
            PanelSwipeSlider.Visibility = Visibility.Collapsed;
            PanelHeatmap.Visibility = Visibility.Collapsed;

            if (RbSideBySide.IsChecked == true)
            {
                PanelSideBySide.Visibility = Visibility.Visible;
            }
            else if (RbSwipeSlider.IsChecked == true)
            {
                PanelSwipeSlider.Visibility = Visibility.Visible;
                UpdateSwipeClip();
            }
            else if (RbHeatmap.IsChecked == true)
            {
                PanelHeatmap.Visibility = Visibility.Visible;
            }
        }

        private void SliderSwipePosition_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            UpdateSwipeClip();
        }

        private void SliderTolerance_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (TxtTolerancePercent != null)
            {
                TxtTolerancePercent.Text = $"{Math.Round(SliderTolerance.Value * 100)}%";
            }
            RunDiff();
        }

        private void SliderZoom_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            ApplyZoom(SliderZoom.Value);
        }

        private void ApplyZoom(double zoom)
        {
            _currentZoom = Math.Clamp(zoom, 0.2, 3.0);
            if (TxtZoomPercent != null)
            {
                TxtZoomPercent.Text = $"{Math.Round(_currentZoom * 100)}%";
            }

            if (ScaleBaseline != null) { ScaleBaseline.ScaleX = _currentZoom; ScaleBaseline.ScaleY = _currentZoom; }
            if (ScaleCurrent != null) { ScaleCurrent.ScaleX = _currentZoom; ScaleCurrent.ScaleY = _currentZoom; }
            if (ScaleSwipe != null) { ScaleSwipe.ScaleX = _currentZoom; ScaleSwipe.ScaleY = _currentZoom; }
            if (ScaleHeatmap != null) { ScaleHeatmap.ScaleX = _currentZoom; ScaleHeatmap.ScaleY = _currentZoom; }
        }

        private void ScrollViewer_PreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (Keyboard.Modifiers == ModifierKeys.Control)
            {
                e.Handled = true;
                double delta = e.Delta > 0 ? 0.1 : -0.1;
                SliderZoom.Value = Math.Clamp(SliderZoom.Value + delta, SliderZoom.Minimum, SliderZoom.Maximum);
            }
        }

        private void ScrollBaseline_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            if (_isSyncingScroll || ChkSyncScroll.IsChecked != true) return;
            try
            {
                _isSyncingScroll = true;
                ScrollCurrent.ScrollToHorizontalOffset(ScrollBaseline.HorizontalOffset);
                ScrollCurrent.ScrollToVerticalOffset(ScrollBaseline.VerticalOffset);
            }
            finally
            {
                _isSyncingScroll = false;
            }
        }

        private void ScrollCurrent_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            if (_isSyncingScroll || ChkSyncScroll.IsChecked != true) return;
            try
            {
                _isSyncingScroll = true;
                ScrollBaseline.ScrollToHorizontalOffset(ScrollCurrent.HorizontalOffset);
                ScrollBaseline.ScrollToVerticalOffset(ScrollCurrent.VerticalOffset);
            }
            finally
            {
                _isSyncingScroll = false;
            }
        }

        private void CboBaseline_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            RunDiff();
        }

        private void CboCurrent_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            RunDiff();
        }

        private void BtnBrowseBaseline_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new OpenFileDialog
            {
                Filter = "Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|All files (*.*)|*.*",
                Title = "Select Baseline Screenshot"
            };
            if (dlg.ShowDialog() == true)
            {
                var item = new ComboBoxItem { Content = $"📁 {Path.GetFileName(dlg.FileName)}", Tag = dlg.FileName };
                CboBaseline.Items.Insert(0, item);
                CboBaseline.SelectedItem = item;
            }
        }

        private void BtnBrowseCurrent_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new OpenFileDialog
            {
                Filter = "Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|All files (*.*)|*.*",
                Title = "Select Current Screenshot"
            };
            if (dlg.ShowDialog() == true)
            {
                var item = new ComboBoxItem { Content = $"📁 {Path.GetFileName(dlg.FileName)}", Tag = dlg.FileName };
                CboCurrent.Items.Insert(0, item);
                CboCurrent.SelectedItem = item;
            }
        }

        private void BtnSetCurrentAsBaseline_Click(object sender, RoutedEventArgs e)
        {
            string? currentPath = (CboCurrent.SelectedItem as ComboBoxItem)?.Tag as string;
            if (string.IsNullOrEmpty(currentPath) || !File.Exists(currentPath))
            {
                MessageBox.Show("No valid current screenshot selected to promote as baseline.", "Visual Diff", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            bool saved = Services.VisualDiffService.SaveBaseline(_pageUrl, currentPath);
            if (saved)
            {
                MessageBox.Show("Current screenshot promoted as the new baseline for this page!", "Baseline Saved", MessageBoxButton.OK, MessageBoxImage.Information);
                LoadScreenshotOptions(currentPath);
            }
            else
            {
                MessageBox.Show("Failed to save baseline.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnAttachToBug_Click(object sender, RoutedEventArgs e)
        {
            if (_currentResult == null || !_currentResult.Success)
            {
                MessageBox.Show("No valid visual diff computed to attach.", "Visual Diff", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            _onAttachToBug?.Invoke(_currentResult);
            MessageBox.Show("Diff heatmap and summary attached to the active bug report draft in Visual Test Tracker!", "Attached to Bug", MessageBoxButton.OK, MessageBoxImage.Information);
            Close();
        }

        private void BtnCopySummary_Click(object sender, RoutedEventArgs e)
        {
            if (_currentResult == null) return;
            try
            {
                Clipboard.SetText(_currentResult.Summary);
                MessageBox.Show("Copied visual diff summary to clipboard.", "Copied", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch { }
        }

        private void BtnSaveDiffImage_Click(object sender, RoutedEventArgs e)
        {
            if (_currentResult?.DiffMapImage == null)
            {
                MessageBox.Show("No difference image available to save.", "Visual Diff", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var dlg = new SaveFileDialog
            {
                Filter = "PNG Image (*.png)|*.png",
                FileName = $"visual_diff_{DateTime.Now:yyyyMMdd_HHmmss}.png"
            };
            if (dlg.ShowDialog() == true)
            {
                try
                {
                    Services.VisualDiffService.SaveBitmapAsPng(_currentResult.DiffMapImage, dlg.FileName);
                    MessageBox.Show($"Diff map saved to {dlg.FileName}", "Saved", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Failed to save diff map: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        private void Window_StateChanged(object sender, EventArgs e)
        {
            if (BtnMaximizeRestoreIcon != null)
            {
                BtnMaximizeRestoreIcon.Text = WindowState == WindowState.Maximized ? "\uE923" : "\uE922";
            }
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();
    }
}
