using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace BuildConsole
{
    /// <summary>
    /// Git #3914 — WPF Control Tester: a developer diagnostic window that
    /// instantiates any BuildConsole.Controls UserControl in isolation so that
    /// layout, visual tree, and event behaviour can be inspected without running
    /// the full shell. Provides a live dimension readout, collapsible visual-tree
    /// browser, property inspector for selected visual elements, width presets,
    /// background override, and event-log with severity levels. Screenshot export
    /// saves a PNG to the Desktop.
    /// </summary>
    public partial class WpfTesterWindow : Window
    {
        // ── Data ──────────────────────────────────────────────────────────────
        private readonly ObservableCollection<LogEntry> _logEntries = new();
        private FrameworkElement? _currentControl;
        private bool _suppressDimensionChange;

        // Maps friendly display name → full type
        private readonly List<(string DisplayName, Type Type)> _catalogue = new();

        // ── Initialisation ────────────────────────────────────────────────────

        public WpfTesterWindow()
        {
            InitializeComponent();
            LstEventLog.ItemsSource = _logEntries;
        }

        private void Window_Loaded(object sender, RoutedEventArgs e)
        {
            DiscoverControls();
            PopulateControlPicker();
            Log("WPF Tester ready — select a control from the dropdown.", "Info");
        }

        // ── Control Discovery ─────────────────────────────────────────────────

        /// <summary>
        /// Reflects over the BuildConsole assembly and builds a catalogue of every
        /// public UserControl that can be instantiated with a parameterless constructor.
        /// </summary>
        private void DiscoverControls()
        {
            _catalogue.Clear();
            var asm = Assembly.GetExecutingAssembly();
            try
            {
                var controlTypes = asm.GetTypes()
                    .Where(t => t.IsPublic && !t.IsAbstract
                                && typeof(UserControl).IsAssignableFrom(t)
                                && t.GetConstructor(Type.EmptyTypes) != null)
                    .OrderBy(t => t.Name)
                    .ToList();

                foreach (var t in controlTypes)
                {
                    // Short display name — strip namespace prefix for readability
                    string name = t.Name;
                    _catalogue.Add((name, t));
                }
            }
            catch (Exception ex)
            {
                Log($"Discovery error: {ex.Message}", "Error");
            }
        }

        private void PopulateControlPicker()
        {
            CmbControlPicker.Items.Clear();
            CmbControlPicker.Items.Add(new ComboBoxItem { Content = "(select a control…)", Tag = null });
            foreach (var (name, type) in _catalogue)
            {
                CmbControlPicker.Items.Add(new ComboBoxItem
                {
                    Content = name,
                    Tag = type
                });
            }
            CmbControlPicker.SelectedIndex = 0;
        }

        // ── Control Loading ───────────────────────────────────────────────────

        private void CmbControlPicker_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CmbControlPicker.SelectedItem is ComboBoxItem { Tag: Type type })
                LoadControl(type);
        }

        private void BtnRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (CmbControlPicker.SelectedItem is ComboBoxItem { Tag: Type type })
                LoadControl(type);
        }

        private void LoadControl(Type type)
        {
            PnlEmpty.Visibility = Visibility.Collapsed;
            PnlError.Visibility = Visibility.Collapsed;
            RenderHost.Child = null;
            _currentControl = null;

            TxtRenderStatus.Text = $"Loading {type.Name}…";
            Log($"Loading control: {type.FullName}", "Info");

            try
            {
                var instance = (FrameworkElement)Activator.CreateInstance(type)!;
                _currentControl = instance;

                ApplyDimensionOverrides(instance);

                // Monitor size changes for the live readout
                instance.SizeChanged += Control_SizeChanged;

                RenderHost.Child = instance;

                UpdateInfoPanel(type, instance);
                BuildVisualTree(instance);

                // Force a layout pass so actual sizes are available
                instance.UpdateLayout();
                UpdateLiveDimensions(instance);

                TxtRenderStatus.Text = $"Loaded {type.Name}";
                Log($"Control '{type.Name}' rendered OK — ActualSize {instance.ActualWidth:F0}×{instance.ActualHeight:F0}", "Success");
            }
            catch (Exception ex)
            {
                TxtErrorMessage.Text = ex.ToString();
                PnlError.Visibility = Visibility.Visible;
                TxtRenderStatus.Text = "Render error";
                Log($"Render error for '{type.Name}': {ex.Message}", "Error");
            }
        }

        // ── Dimension Helpers ─────────────────────────────────────────────────

        private void ApplyDimensionOverrides(FrameworkElement fe)
        {
            // Width
            string wStr = TxtOverrideWidth.Text?.Trim() ?? "Auto";
            if (wStr.Equals("Auto", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(wStr))
                fe.Width = double.NaN;
            else if (double.TryParse(wStr, out double w) && w > 0)
                fe.Width = w;
            else
                fe.Width = double.NaN;

            // Height
            string hStr = TxtOverrideHeight.Text?.Trim() ?? "Auto";
            if (hStr.Equals("Auto", StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(hStr))
                fe.Height = double.NaN;
            else if (double.TryParse(hStr, out double h) && h > 0)
                fe.Height = h;
            else
                fe.Height = double.NaN;
        }

        private void TxtOverrideDimension_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppressDimensionChange) return;
            if (_currentControl != null)
            {
                ApplyDimensionOverrides(_currentControl);
                _currentControl.UpdateLayout();
                UpdateLiveDimensions(_currentControl);
            }
        }

        private void SizePreset_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tag)
            {
                _suppressDimensionChange = true;
                TxtOverrideWidth.Text = tag;
                _suppressDimensionChange = false;

                if (_currentControl != null)
                {
                    ApplyDimensionOverrides(_currentControl);
                    _currentControl.UpdateLayout();
                    UpdateLiveDimensions(_currentControl);
                    Log($"Width preset → {tag}", "Info");
                }
            }
        }

        private void Control_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (sender is FrameworkElement fe)
                UpdateLiveDimensions(fe);
        }

        private void RenderHost_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (_currentControl != null)
                UpdateLiveDimensions(_currentControl);
        }

        private void UpdateLiveDimensions(FrameworkElement fe)
        {
            TxtLiveWidth.Text  = double.IsNaN(fe.ActualWidth)  ? "Auto" : $"{fe.ActualWidth:F1}";
            TxtLiveHeight.Text = double.IsNaN(fe.ActualHeight) ? "Auto" : $"{fe.ActualHeight:F1}";
            TxtDesiredWidth.Text  = double.IsNaN(fe.DesiredSize.Width)  ? "—" : $"{fe.DesiredSize.Width:F1}";
            TxtDesiredHeight.Text = double.IsNaN(fe.DesiredSize.Height) ? "—" : $"{fe.DesiredSize.Height:F1}";
            TxtInfoSize.Text  = $"{fe.ActualWidth:F0} × {fe.ActualHeight:F0}";
        }

        // ── Info Panel ────────────────────────────────────────────────────────

        private void UpdateInfoPanel(Type type, FrameworkElement fe)
        {
            TxtInfoName.Text  = type.Name;
            TxtInfoType.Text  = type.FullName ?? type.Name;
            TxtInfoSize.Text  = "—";

            int visualCount = CountVisuals(fe);
            TxtInfoVisuals.Text = $"{visualCount} visual children (recursive)";
        }

        private static int CountVisuals(DependencyObject parent)
        {
            int count = 0;
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            {
                count++;
                var child = VisualTreeHelper.GetChild(parent, i);
                count += CountVisuals(child);
            }
            return count;
        }

        // ── Visual Tree Browser ───────────────────────────────────────────────

        private void BuildVisualTree(DependencyObject root)
        {
            VisualTree.Items.Clear();
            var rootItem = BuildTreeItem(root);
            VisualTree.Items.Add(rootItem);
            rootItem.IsExpanded = true;
        }

        private static TreeViewItem BuildTreeItem(DependencyObject node)
        {
            string label = node.GetType().Name;
            if (node is FrameworkElement fe && !string.IsNullOrEmpty(fe.Name))
                label = $"{label} [{fe.Name}]";

            var item = new TreeViewItem
            {
                Header = label,
                Tag = node,
                FontSize = 11
            };

            int childCount = VisualTreeHelper.GetChildrenCount(node);
            // Limit depth to keep tree readable
            if (childCount > 0 && childCount <= 200)
            {
                for (int i = 0; i < Math.Min(childCount, 50); i++)
                {
                    var child = VisualTreeHelper.GetChild(node, i);
                    item.Items.Add(BuildTreeItem(child));
                }
                if (childCount > 50)
                    item.Items.Add(new TreeViewItem { Header = $"… {childCount - 50} more", IsEnabled = false });
            }

            return item;
        }

        private void VisualTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem { Tag: DependencyObject node })
                InspectElement(node);
        }

        // ── Element Inspector ─────────────────────────────────────────────────

        private void InspectElement(DependencyObject node)
        {
            string typeName = node.GetType().Name;
            string name = node is FrameworkElement fe2 ? fe2.Name : "";
            TxtSelectedElement.Text = string.IsNullOrEmpty(name) ? typeName : $"{typeName} [{name}]";

            var sb = new StringBuilder();

            if (node is FrameworkElement fe)
            {
                sb.AppendLine($"ActualWidth  = {fe.ActualWidth:F1}");
                sb.AppendLine($"ActualHeight = {fe.ActualHeight:F1}");
                sb.AppendLine($"Width        = {(double.IsNaN(fe.Width) ? "Auto" : fe.Width.ToString("F1"))}");
                sb.AppendLine($"Height       = {(double.IsNaN(fe.Height) ? "Auto" : fe.Height.ToString("F1"))}");
                sb.AppendLine($"Margin       = {fe.Margin}");
                sb.AppendLine($"Padding      = {(fe is Control c ? c.Padding.ToString() : "—")}");
                sb.AppendLine($"Visibility   = {fe.Visibility}");
                sb.AppendLine($"HorizAlign   = {fe.HorizontalAlignment}");
                sb.AppendLine($"VertAlign    = {fe.VerticalAlignment}");
            }

            if (node is TextBlock tb)
            {
                sb.AppendLine($"Text         = {tb.Text?.Truncate(80)}");
                sb.AppendLine($"FontSize     = {tb.FontSize:F1}");
                sb.AppendLine($"FontFamily   = {tb.FontFamily}");
                sb.AppendLine($"Foreground   = {BrushToHex(tb.Foreground)}");
                sb.AppendLine($"TextWrapping = {tb.TextWrapping}");
                sb.AppendLine($"Trimming     = {tb.TextTrimming}");
            }
            else if (node is Control ctrl)
            {
                sb.AppendLine($"FontSize     = {ctrl.FontSize:F1}");
                sb.AppendLine($"FontFamily   = {ctrl.FontFamily}");
                sb.AppendLine($"Background   = {BrushToHex(ctrl.Background)}");
                sb.AppendLine($"Foreground   = {BrushToHex(ctrl.Foreground)}");
            }

            TxtSelectedProperties.Text = sb.ToString();
        }

        private static string BrushToHex(Brush? brush)
        {
            if (brush is SolidColorBrush scb)
                return $"#{scb.Color.A:X2}{scb.Color.R:X2}{scb.Color.G:X2}{scb.Color.B:X2}";
            if (brush == null) return "(null)";
            return brush.ToString() ?? "—";
        }

        // ── Background Override ───────────────────────────────────────────────

        private void CmbBgOverride_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (RenderArea == null) return;

            string tag = (CmbBgOverride.SelectedItem as ComboBoxItem)?.Tag as string ?? "default";
            switch (tag)
            {
                case "white":
                    RenderArea.Background = Brushes.White;
                    break;
                case "black":
                    RenderArea.Background = Brushes.Black;
                    break;
                case "checker":
                    RenderArea.Background = CreateCheckerBrush();
                    break;
                default:
                    // Restore theme BaseBrush
                    if (TryFindResource("BaseBrush") is Brush baseBrush)
                        RenderArea.Background = baseBrush;
                    else
                        RenderArea.Background = new SolidColorBrush(Color.FromRgb(13, 17, 23));
                    break;
            }
            Log($"Background → {tag}", "Info");
        }

        private static DrawingBrush CreateCheckerBrush()
        {
            var light = new SolidColorBrush(Color.FromRgb(170, 170, 170));
            var dark  = new SolidColorBrush(Color.FromRgb(128, 128, 128));
            var drawing = new DrawingGroup();
            drawing.Children.Add(new GeometryDrawing(light, null, new RectangleGeometry(new Rect(0, 0, 20, 20))));
            drawing.Children.Add(new GeometryDrawing(dark,  null, new RectangleGeometry(new Rect(0, 0, 10, 10))));
            drawing.Children.Add(new GeometryDrawing(dark,  null, new RectangleGeometry(new Rect(10, 10, 10, 10))));
            return new DrawingBrush(drawing)
            {
                TileMode = TileMode.Tile,
                Viewport = new Rect(0, 0, 20, 20),
                ViewportUnits = BrushMappingMode.Absolute
            };
        }

        // ── Screenshot Export ─────────────────────────────────────────────────

        private void BtnScreenshot_Click(object sender, RoutedEventArgs e)
        {
            if (_currentControl == null)
            {
                Log("No control loaded — nothing to screenshot.", "Warning");
                return;
            }
            try
            {
                var element = RenderHost;
                var renderTarget = new RenderTargetBitmap(
                    (int)Math.Max(element.ActualWidth, 1),
                    (int)Math.Max(element.ActualHeight, 1),
                    96, 96, PixelFormats.Pbgra32);
                renderTarget.Render(element);

                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(renderTarget));

                string fileName = $"WpfTester_{_currentControl.GetType().Name}_{DateTime.Now:yyyyMMdd_HHmmss}.png";
                string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), fileName);
                using var stream = File.Create(path);
                encoder.Save(stream);

                Log($"Screenshot saved: {path}", "Success");
            }
            catch (Exception ex)
            {
                Log($"Screenshot error: {ex.Message}", "Error");
            }
        }

        // ── Event Log ─────────────────────────────────────────────────────────

        private void Log(string message, string level = "Info")
        {
            var entry = new LogEntry
            {
                TimeStr = DateTime.Now.ToString("HH:mm:ss.fff"),
                Level   = level,
                Message = message
            };
            _logEntries.Add(entry);
            TxtLogCount.Text  = $"{_logEntries.Count} event{(_logEntries.Count != 1 ? "s" : "")}";
            TxtLogLastTime.Text = entry.TimeStr;

            // Auto-scroll to bottom
            Dispatcher.BeginInvoke(DispatcherPriority.Background, () =>
            {
                LogScrollViewer.ScrollToBottom();
            });
        }

        private void BtnClearLog_Click(object sender, RoutedEventArgs e)
        {
            _logEntries.Clear();
            TxtLogCount.Text   = "0 events";
            TxtLogLastTime.Text = "—";
        }

        // ── Caption Buttons ───────────────────────────────────────────────────

        private void BtnMinimize_Click(object sender, RoutedEventArgs e)
            => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e)
            => WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e)
            => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            if (BtnMaximizeRestoreIcon != null)
                BtnMaximizeRestoreIcon.Text = WindowState == WindowState.Maximized ? "\uE923" : "\uE922";
        }
    }

    // ── Supporting Models ──────────────────────────────────────────────────

    /// <summary>A single entry in the WPF Tester event log.</summary>
    public sealed class LogEntry
    {
        public string TimeStr { get; init; } = "";
        public string Level   { get; init; } = "Info";
        public string Message { get; init; } = "";
    }

    // Small string extension used only within this file.
    file static class StringEx
    {
        public static string Truncate(this string s, int maxLen)
            => s.Length <= maxLen ? s : s[..maxLen] + "…";
    }
}
