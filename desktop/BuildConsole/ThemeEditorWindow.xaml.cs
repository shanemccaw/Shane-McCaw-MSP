using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Models;
using BuildConsole.Services;

namespace BuildConsole
{
    public partial class ThemeEditorWindow : Window
    {
        private readonly ThemeParserService _parser = new();
        private ThemeModel? _themeModel;

        private bool _isPointAndIdentifyActive;
        private bool _isUpdatingFromCode;
        private bool _isInitialized;

        // Active edit targets
        private ColorModel? _selectedColor;
        private BrushModel? _selectedBrush;
        private TypographyModel? _selectedTypography;

        // Pending modifications for saving
        private readonly Dictionary<string, string> _modifiedColors = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, (string Hex, double Opacity)> _modifiedBrushes = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, (string Family, double Size, string Weight)> _modifiedTypography = new(StringComparer.OrdinalIgnoreCase);

        public ThemeEditorWindow()
        {
            _isUpdatingFromCode = true;
            InitializeComponent();
            _isUpdatingFromCode = false;
            _isInitialized = true;
            Loaded += ThemeEditorWindow_Loaded;
        }

        private async void ThemeEditorWindow_Loaded(object sender, RoutedEventArgs e)
        {
            await LoadThemeAsync();
        }

        private async Task LoadThemeAsync()
        {
            TxtThemeStatus.Text = "Parsing theme dictionaries...";
            try
            {
                _themeModel = await _parser.LoadAndParseUnifiedThemeAsync();

                ApplyColorFilter();
                ApplyBrushFilter();
                LstTypography.ItemsSource = _themeModel.Typography;

                TxtThemeStatus.Text = $"Loaded {_themeModel.Colors.Count} Colors, {_themeModel.Brushes.Count} Brushes, {_themeModel.Typography.Count} Typography";

                // Select default accent color for editor
                var defaultAccent = _themeModel.Colors.FirstOrDefault(c => c.Key == "AccentColor") ?? _themeModel.Colors.FirstOrDefault();
                if (defaultAccent != null)
                {
                    SelectColorForEditor(defaultAccent);
                }
            }
            catch (Exception ex)
            {
                TxtThemeStatus.Text = $"Error parsing theme: {ex.Message}";
                ShowNotification($"Theme parse error: {ex.Message}");
            }
        }

        // ══════════════════════════════════════════════════════════════
        // FILTERING & LIST MANAGEMENT
        // ══════════════════════════════════════════════════════════════

        private void ApplyColorFilter()
        {
            if (_themeModel == null) return;

            string query = TxtFilterColors.Text?.Trim() ?? "";
            var items = _themeModel.Colors.AsEnumerable();

            if (!string.IsNullOrEmpty(query))
            {
                items = items.Where(c => c.Key.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                         c.HexValue.Contains(query, StringComparison.OrdinalIgnoreCase));
            }

            if (RadFilterWarnings.IsChecked == true)
            {
                items = items.Where(c => c.HasDiagnostics);
            }
            else if (RadFilterUnused.IsChecked == true)
            {
                items = items.Where(c => c.IsUnused);
            }
            else if (RadFilterBg.IsChecked == true)
            {
                items = items.Where(c => c.Category == "Background");
            }
            else if (RadFilterText.IsChecked == true)
            {
                items = items.Where(c => c.Category == "Text");
            }
            else if (RadFilterAccents.IsChecked == true)
            {
                items = items.Where(c => c.Category == "Accent" || c.Category == "Status");
            }

            LstColors.ItemsSource = items.ToList();
        }

        private void ApplyBrushFilter()
        {
            if (_themeModel == null) return;

            string query = TxtFilterBrushes.Text?.Trim() ?? "";
            var items = _themeModel.Brushes.AsEnumerable();

            if (!string.IsNullOrEmpty(query))
            {
                items = items.Where(b => b.Key.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                         (b.ColorKey != null && b.ColorKey.Contains(query, StringComparison.OrdinalIgnoreCase)) ||
                                         b.ColorHex.Contains(query, StringComparison.OrdinalIgnoreCase));
            }

            LstBrushes.ItemsSource = items.ToList();
        }

        private void TxtFilterColors_TextChanged(object sender, TextChangedEventArgs e) => ApplyColorFilter();
        private void ColorFilter_Changed(object sender, RoutedEventArgs e) => ApplyColorFilter();
        private void TxtFilterBrushes_TextChanged(object sender, TextChangedEventArgs e) => ApplyBrushFilter();

        private void LstColors_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (LstColors.SelectedItem is ColorModel cm)
            {
                SelectColorForEditor(cm);
            }
        }

        private void LstBrushes_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (LstBrushes.SelectedItem is BrushModel bm)
            {
                SelectBrushForEditor(bm);
            }
        }

        private void LstTypography_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (LstTypography.SelectedItem is TypographyModel tm)
            {
                SelectTypographyForEditor(tm);
            }
        }

        // ══════════════════════════════════════════════════════════════
        // POINT & IDENTIFY MODE (HIT-TESTING & INSPECTION)
        // ══════════════════════════════════════════════════════════════

        private void BtnPointAndIdentify_Checked(object sender, RoutedEventArgs e)
        {
            _isPointAndIdentifyActive = true;
            TxtIdentifyStatus.Text = "Point & Identify: ON";
            BtnPointAndIdentify.Background = (Brush)FindResource("BlueBrushTint");
            GalleryScrollViewer.Cursor = Cursors.Hand;
            ShowNotification("Point & Identify mode active. Click any visual element in the gallery to inspect its brushes, colors, and typography.");
        }

        private void BtnPointAndIdentify_Unchecked(object sender, RoutedEventArgs e)
        {
            _isPointAndIdentifyActive = false;
            TxtIdentifyStatus.Text = "Point & Identify: OFF";
            BtnPointAndIdentify.Background = (Brush)FindResource("Surface0Brush");
            GalleryScrollViewer.Cursor = Cursors.Arrow;
        }

        private void Gallery_PreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (!_isPointAndIdentifyActive) return;

            e.Handled = true; // Intercept click so button or control doesn't trigger its click behavior

            var hit = e.OriginalSource as DependencyObject;
            if (hit == null) return;

            InspectVisualElement(hit);
        }

        private void InspectVisualElement(DependencyObject hit)
        {
            var hierarchy = new List<string>();
            DependencyObject? curr = hit;

            FrameworkElement? targetElement = hit as FrameworkElement;
            Brush? bgBrush = null;
            Brush? fgBrush = null;
            Brush? borderBrush = null;
            string? fontFamily = null;
            double? fontSize = null;
            FontWeight? fontWeight = null;
            Style? elementStyle = null;

            while (curr != null && curr != GalleryScrollViewer)
            {
                var typeName = curr.GetType().Name;
                if (curr is FrameworkElement fe && !string.IsNullOrEmpty(fe.Name))
                {
                    hierarchy.Insert(0, $"{typeName} [{fe.Name}]");
                }
                else
                {
                    hierarchy.Insert(0, typeName);
                }

                // Try read properties
                if (bgBrush == null)
                {
                    if (curr is Panel p) bgBrush = p.Background;
                    else if (curr is Border b) bgBrush = b.Background;
                    else if (curr is Control c) bgBrush = c.Background;
                }

                if (borderBrush == null)
                {
                    if (curr is Border b) borderBrush = b.BorderBrush;
                    else if (curr is Control c) borderBrush = c.BorderBrush;
                }

                if (fgBrush == null)
                {
                    if (curr is TextBlock tb) fgBrush = tb.Foreground;
                    else if (curr is Control c) fgBrush = c.Foreground;
                }

                if (fontFamily == null)
                {
                    if (curr is TextBlock tb) fontFamily = tb.FontFamily.ToString();
                    else if (curr is Control c) fontFamily = c.FontFamily.ToString();
                }

                if (fontSize == null)
                {
                    if (curr is TextBlock tb) fontSize = tb.FontSize;
                    else if (curr is Control c) fontSize = c.FontSize;
                }

                if (fontWeight == null)
                {
                    if (curr is TextBlock tb) fontWeight = tb.FontWeight;
                    else if (curr is Control c) fontWeight = c.FontWeight;
                }

                if (elementStyle == null && curr is FrameworkElement feStyle && feStyle.Style != null)
                {
                    elementStyle = feStyle.Style;
                    targetElement ??= feStyle;
                }

                curr = VisualTreeHelper.GetParent(curr);
            }

            // Find matching brush and color from ThemeModel
            Brush? activeBrush = bgBrush ?? fgBrush ?? borderBrush;
            Color activeColor = Colors.Transparent;
            if (activeBrush is SolidColorBrush scb) activeColor = scb.Color;

            string colorHex = activeColor.A != 255
                ? $"#{activeColor.A:X2}{activeColor.R:X2}{activeColor.G:X2}{activeColor.B:X2}"
                : $"#{activeColor.R:X2}{activeColor.G:X2}{activeColor.B:X2}";

            var matchedBrush = _themeModel?.Brushes.FirstOrDefault(b => b.ColorHex.Equals(colorHex, StringComparison.OrdinalIgnoreCase));
            var matchedColor = _themeModel?.Colors.FirstOrDefault(c => c.HexValue.Equals(colorHex, StringComparison.OrdinalIgnoreCase));

            // Populate Inspector UI
            TxtInspectElementName.Text = targetElement?.GetType().Name ?? hit.GetType().Name;
            TxtInspectElementHierarchy.Text = "Visual Hierarchy: " + string.Join(" ➔ ", hierarchy.TakeLast(4));

            if (matchedBrush != null)
            {
                TxtInspectBrushName.Text = $"Brush: {matchedBrush.Key}";
                TxtInspectSourceFile.Text = $"Defined in: {matchedBrush.SourceFile}";
                InspectColorSwatch.Background = matchedBrush.Brush;
                _selectedBrush = matchedBrush;
            }
            else
            {
                TxtInspectBrushName.Text = $"Brush: Direct ({colorHex})";
                TxtInspectSourceFile.Text = "Defined in: Colors.xaml / DarkTheme.xaml";
                InspectColorSwatch.Background = activeBrush ?? Brushes.Transparent;
                _selectedBrush = null;
            }

            if (matchedColor != null)
            {
                TxtInspectColorName.Text = $"Color: {matchedColor.Key} ({matchedColor.HexValue}) • Bri: {matchedColor.Brightness:F0} • CR: {matchedColor.ContrastDisplay}";
                _selectedColor = matchedColor;
            }
            else
            {
                TxtInspectColorName.Text = $"Color: {colorHex}";
                _selectedColor = null;
            }

            TxtInspectTypography.Text = $"Font: {fontFamily ?? "Segoe UI"} • Size: {fontSize ?? 14}px • Weight: {fontWeight?.ToString() ?? "Normal"}";

            TxtInspectStyle.Text = elementStyle != null
                ? $"Style: {elementStyle.TargetType?.Name ?? "Applied"}"
                : "Style: Theme Default";

            TxtInspectTemplate.Text = targetElement is Control ctrl && ctrl.Template != null
                ? $"Template: {ctrl.Template.TargetType?.Name ?? "ControlTemplate"}"
                : "Template: System Default";

            // Switch to Inspector tab
            MainToolTabs.SelectedItem = TabInspector;
        }

        private void BtnEditInspectedBrush_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedBrush != null)
            {
                SelectBrushForEditor(_selectedBrush);
            }
            else if (_selectedColor != null)
            {
                SelectColorForEditor(_selectedColor);
            }
        }

        private void BtnEditInspectedTypography_Click(object sender, RoutedEventArgs e)
        {
            var match = _themeModel?.Typography.FirstOrDefault(t => t.Key.Contains("Body") || t.Key.Contains("TextStyle")) ??
                        _themeModel?.Typography.FirstOrDefault();
            if (match != null)
            {
                SelectTypographyForEditor(match);
            }
        }

        // ══════════════════════════════════════════════════════════════
        // COLOR & BRUSH EDITOR LOGIC
        // ══════════════════════════════════════════════════════════════

        private void SelectColorForEditor(ColorModel cm)
        {
            _selectedColor = cm;
            _selectedBrush = _themeModel?.Brushes.FirstOrDefault(b => b.ColorKey == cm.Key);

            TxtEditorTargetDescription.Text = $"Editing Color: {cm.Key} ({cm.SourceFile})";
            PnlColorEditor.Visibility = Visibility.Visible;
            PnlTypographyEditor.Visibility = Visibility.Collapsed;

            UpdateEditorFromColor(cm.Color);
            MainToolTabs.SelectedItem = TabEditor;
        }

        private void SelectBrushForEditor(BrushModel bm)
        {
            _selectedBrush = bm;
            _selectedColor = !string.IsNullOrEmpty(bm.ColorKey)
                ? _themeModel?.Colors.FirstOrDefault(c => c.Key == bm.ColorKey)
                : null;

            TxtEditorTargetDescription.Text = $"Editing Brush: {bm.Key} ({bm.SourceFile})";
            PnlColorEditor.Visibility = Visibility.Visible;
            PnlTypographyEditor.Visibility = Visibility.Collapsed;

            Color c = ThemeParserService.ParseColorHex(bm.ColorHex);
            UpdateEditorFromColor(c);
            MainToolTabs.SelectedItem = TabEditor;
        }

        private void SelectTypographyForEditor(TypographyModel tm)
        {
            _selectedTypography = tm;
            TxtEditorTargetDescription.Text = $"Editing Typography: {tm.Key} ({tm.SourceFile})";
            PnlColorEditor.Visibility = Visibility.Collapsed;
            PnlTypographyEditor.Visibility = Visibility.Visible;

            _isUpdatingFromCode = true;
            SliderFontSize.Value = tm.FontSize;
            TxtFontSizeVal.Text = tm.FontSize.ToString("0");
            TxtTypographyPreview.FontFamily = new FontFamily(tm.FontFamily);
            TxtTypographyPreview.FontSize = tm.FontSize;
            _isUpdatingFromCode = false;

            MainToolTabs.SelectedItem = TabEditor;
        }

        private void UpdateEditorFromColor(Color c)
        {
            if (!_isInitialized || SliderR == null || SliderG == null || SliderB == null
                || SliderHue == null || SliderSat == null || SliderLightness == null
                || TxtEditorHex == null || EditorSwatch == null) return;

            _isUpdatingFromCode = true;

            string hex = ThemeParserService.ColorToHex(c);
            TxtEditorHex.Text = hex;
            EditorSwatch.Background = new SolidColorBrush(c);

            // RGB
            SliderR.Value = c.R;
            SliderG.Value = c.G;
            SliderB.Value = c.B;
            if (TxtValR != null) TxtValR.Text = c.R.ToString();
            if (TxtValG != null) TxtValG.Text = c.G.ToString();
            if (TxtValB != null) TxtValB.Text = c.B.ToString();

            // HSL
            var (h, s, l) = ThemeDiagnosticsService.ColorToHsl(c);
            SliderHue.Value = h;
            SliderSat.Value = s * 100.0;
            SliderLightness.Value = l * 100.0;
            if (TxtValHue != null) TxtValHue.Text = $"{h:F0}°";
            if (TxtValSat != null) TxtValSat.Text = $"{s * 100.0:F0}%";
            if (TxtValLightness != null) TxtValLightness.Text = $"{l * 100.0:F0}%";

            // Contrast & WCAG preview
            UpdateContrastDisplay(c);

            _isUpdatingFromCode = false;
        }

        private void UpdateContrastDisplay(Color c)
        {
            if (!_isInitialized || TxtEditorContrastPreview == null || BadgeWcag == null) return;

            double cr = ThemeDiagnosticsService.CalculateContrastRatio(c, ThemeDiagnosticsService.PrimaryBackgroundColor);
            bool passAAA = cr >= 7.0;
            bool passAA = cr >= 4.5;
            bool passLarge = cr >= 3.0;

            string rating = passAAA ? "AAA Pass" : (passAA ? "AA Pass" : (passLarge ? "AA Large Pass" : "Fail"));
            TxtEditorContrastPreview.Text = $"{cr:F1}:1 ({rating})";

            var successBrush = TryFindResource("StatusSuccessBrush") as Brush ?? Brushes.LightGreen;
            var warningBrush = TryFindResource("StatusWarningBrush") as Brush ?? Brushes.Orange;

            if (passAA)
            {
                TxtEditorContrastPreview.Foreground = successBrush;
                BadgeWcag.Background = new SolidColorBrush(Color.FromRgb(0x23, 0x4A, 0x2E));
                if (BadgeWcag.Child is TextBlock tb)
                {
                    tb.Text = passAAA ? "PASS AAA" : "PASS AA";
                    tb.Foreground = successBrush;
                }
            }
            else
            {
                TxtEditorContrastPreview.Foreground = warningBrush;
                BadgeWcag.Background = new SolidColorBrush(Color.FromRgb(0x4A, 0x2E, 0x18));
                if (BadgeWcag.Child is TextBlock tb)
                {
                    tb.Text = passLarge ? "AA LARGE" : "LOW CONTRAST";
                    tb.Foreground = warningBrush;
                }
            }
        }

        private void TxtEditorHex_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_isUpdatingFromCode || !_isInitialized || TxtEditorHex == null) return;
            string hex = TxtEditorHex.Text.Trim();
            if (hex.Length == 7 || hex.Length == 9)
            {
                Color c = ThemeParserService.ParseColorHex(hex);
                UpdateEditorFromColor(c);
            }
        }

        private void SliderRgb_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_isUpdatingFromCode || !_isInitialized || SliderR == null || SliderG == null || SliderB == null) return;
            byte r = (byte)Math.Clamp(SliderR.Value, 0, 255);
            byte g = (byte)Math.Clamp(SliderG.Value, 0, 255);
            byte b = (byte)Math.Clamp(SliderB.Value, 0, 255);

            Color c = Color.FromRgb(r, g, b);
            UpdateEditorFromColor(c);
        }

        private void SliderHsl_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_isUpdatingFromCode || !_isInitialized || SliderHue == null || SliderSat == null || SliderLightness == null) return;
            double h = SliderHue.Value;
            double s = SliderSat.Value / 100.0;
            double l = SliderLightness.Value / 100.0;

            Color c = ThemeDiagnosticsService.HslToColor(h, s, l);
            UpdateEditorFromColor(c);
        }

        private void BtnAutoDarken_Click(object sender, RoutedEventArgs e)
        {
            SliderLightness.Value = Math.Max(0, SliderLightness.Value - 10.0);
        }

        private void BtnAutoLighten_Click(object sender, RoutedEventArgs e)
        {
            SliderLightness.Value = Math.Min(100, SliderLightness.Value + 10.0);
        }

        private void BtnMatchPaletteHue_Click(object sender, RoutedEventArgs e)
        {
            // Match to primary accent hue ~232° (cool indigo)
            SliderHue.Value = 232.0;
        }

        private void BtnApplyLiveColor_Click(object sender, RoutedEventArgs e)
        {
            Color c = ThemeParserService.ParseColorHex(TxtEditorHex.Text.Trim());
            string hex = ThemeParserService.ColorToHex(c);

            if (_selectedColor != null)
            {
                _selectedColor.HexValue = hex;
                _selectedColor.Color = c;
                ThemeDiagnosticsService.EvaluateDiagnostics(_selectedColor);

                _modifiedColors[_selectedColor.Key] = hex;

                string? assocBrush = _selectedBrush?.Key ?? _selectedColor.ReferencedByBrushes.FirstOrDefault();
                ThemeReloaderService.ApplyLiveColorUpdate(_selectedColor.Key, c, assocBrush);

                ShowNotification($"Live updated color '{_selectedColor.Key}' to {hex}");
            }
            else if (_selectedBrush != null)
            {
                _selectedBrush.ColorHex = hex;
                var brush = new SolidColorBrush(c) { Opacity = _selectedBrush.Opacity };
                if (brush.CanFreeze) brush.Freeze();
                _selectedBrush.Brush = brush;

                _modifiedBrushes[_selectedBrush.Key] = (hex, _selectedBrush.Opacity);
                ThemeReloaderService.ApplyLiveBrushUpdate(_selectedBrush.Key, brush);

                ShowNotification($"Live updated brush '{_selectedBrush.Key}' to {hex}");
            }
        }

        // ══════════════════════════════════════════════════════════════
        // TYPOGRAPHY EDITOR LOGIC
        // ══════════════════════════════════════════════════════════════

        private void SliderFontSize_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (_isUpdatingFromCode || !_isInitialized || SliderFontSize == null || TxtFontSizeVal == null) return;
            TxtFontSizeVal.Text = SliderFontSize.Value.ToString("0");
            if (TxtTypographyPreview != null)
            {
                TxtTypographyPreview.FontSize = SliderFontSize.Value;
            }
        }

        private void CmbFontFamily_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CmbFontFamily?.SelectedItem is ComboBoxItem item && TxtTypographyPreview != null)
            {
                TxtTypographyPreview.FontFamily = new FontFamily(item.Content.ToString() ?? "Segoe UI");
            }
        }

        private void CmbFontWeight_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CmbFontWeight?.SelectedItem is ComboBoxItem item && TxtTypographyPreview != null)
            {
                string w = item.Content.ToString() ?? "Normal";
                TxtTypographyPreview.FontWeight = w == "Bold" ? FontWeights.Bold : (w == "SemiBold" ? FontWeights.SemiBold : FontWeights.Normal);
            }
        }

        private void BtnApplyLiveTypography_Click(object sender, RoutedEventArgs e)
        {
            if (_selectedTypography == null) return;

            string family = ((ComboBoxItem)CmbFontFamily.SelectedItem).Content.ToString() ?? "Segoe UI";
            double size = SliderFontSize.Value;
            string weight = ((ComboBoxItem)CmbFontWeight.SelectedItem).Content.ToString() ?? "Normal";

            _selectedTypography.FontFamily = family;
            _selectedTypography.FontSize = size;
            _selectedTypography.FontWeight = weight;

            _modifiedTypography[_selectedTypography.Key] = (family, size, weight);

            ThemeReloaderService.ApplyLiveTypographyUpdate(_selectedTypography.Key, size);
            ShowNotification($"Live updated typography resource '{_selectedTypography.Key}' to {size}px ({family})");
        }

        // ══════════════════════════════════════════════════════════════
        // RELOAD & SAVE LOGIC
        // ══════════════════════════════════════════════════════════════

        private async void BtnReloadTheme_Click(object sender, RoutedEventArgs e)
        {
            _modifiedColors.Clear();
            _modifiedBrushes.Clear();
            _modifiedTypography.Clear();
            await LoadThemeAsync();
            ShowNotification("Theme reloaded from disk. All local edits cleared.");
        }

        private async void BtnSaveChanges_Click(object sender, RoutedEventArgs e)
        {
            if (_themeModel == null) return;

            BtnSaveChanges.IsEnabled = false;
            TxtThemeStatus.Text = "Saving theme changes and creating backups...";

            try
            {
                var result = await ThemeReloaderService.SaveThemeChangesAsync(
                    _themeModel,
                    _modifiedColors,
                    _modifiedBrushes,
                    _modifiedTypography);

                if (result.Success)
                {
                    ShowNotification(result.Message);
                    TxtThemeStatus.Text = $"Saved {result.SavedFiles.Count} files ({result.BackupFiles.Count} backups created)";
                    _modifiedColors.Clear();
                    _modifiedBrushes.Clear();
                    _modifiedTypography.Clear();
                }
                else
                {
                    ShowNotification($"Save failed: {result.Message}");
                    TxtThemeStatus.Text = "Save failed";
                }
            }
            catch (Exception ex)
            {
                ShowNotification($"Save error: {ex.Message}");
                TxtThemeStatus.Text = "Save error";
            }
            finally
            {
                BtnSaveChanges.IsEnabled = true;
            }
        }

        // ══════════════════════════════════════════════════════════════
        // UI HELPERS & CAPTION BUTTONS
        // ══════════════════════════════════════════════════════════════

        private void ShowNotification(string msg)
        {
            TxtNotificationMessage.Text = msg;
            BannerNotification.Visibility = Visibility.Visible;
        }

        private void BtnDismissBanner_Click(object sender, RoutedEventArgs e)
        {
            BannerNotification.Visibility = Visibility.Collapsed;
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void Window_StateChanged(object sender, EventArgs e)
        {
            if (BtnMaximizeRestoreIcon != null)
            {
                BtnMaximizeRestoreIcon.Text = WindowState == WindowState.Maximized ? "\uE923" : "\uE922";
            }
        }
    }
}
