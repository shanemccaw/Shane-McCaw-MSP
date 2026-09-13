using System;
using System.Collections.Generic;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;

namespace BuildConsole
{
    public partial class ScreenshotAnnotationWindow : Window
    {
        private readonly string _originalFilePath;
        private Color _currentColor = (Color)ColorConverter.ConvertFromString("#F38BA8"); // Red
        private double _currentThickness = 4.0;

        private enum ToolMode { Pen, Highlighter, Arrow, Rectangle, Ellipse, Text, Redact }
        private ToolMode _currentTool = ToolMode.Pen;

        // Shape drawing interaction state
        private Point? _shapeStartPoint;
        private Shape? _previewShape;
        private readonly Stack<UIElement> _overlayHistory = new();

        /// <summary>The path to the newly saved annotated PNG image if DialogResult == true.</summary>
        public string? ResultFilePath { get; private set; }

        public ScreenshotAnnotationWindow(string imageFilePath)
        {
            InitializeComponent();
            _originalFilePath = imageFilePath;

            Loaded += (s, e) => LoadImage();
            ApplyPenAttributes();
        }

        private void LoadImage()
        {
            try
            {
                if (!File.Exists(_originalFilePath))
                {
                    MessageBox.Show($"Could not find screenshot at {_originalFilePath}", "File Not Found", MessageBoxButton.OK, MessageBoxImage.Error);
                    Close();
                    return;
                }

                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.UriSource = new Uri(_originalFilePath, UriKind.Absolute);
                bmp.EndInit();
                bmp.Freeze();

                ImgBase.Source = bmp;
                CanvasContainer.Width = bmp.PixelWidth;
                CanvasContainer.Height = bmp.PixelHeight;
                InkDraw.Width = bmp.PixelWidth;
                InkDraw.Height = bmp.PixelHeight;
                ShapeOverlay.Width = bmp.PixelWidth;
                ShapeOverlay.Height = bmp.PixelHeight;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to load image: {ex.Message}", "Load Error", MessageBoxButton.OK, MessageBoxImage.Error);
                Close();
            }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void Tool_Changed(object sender, RoutedEventArgs e)
        {
            if (ToolPen?.IsChecked == true) _currentTool = ToolMode.Pen;
            else if (ToolHighlighter?.IsChecked == true) _currentTool = ToolMode.Highlighter;
            else if (ToolArrow?.IsChecked == true) _currentTool = ToolMode.Arrow;
            else if (ToolRectangle?.IsChecked == true) _currentTool = ToolMode.Rectangle;
            else if (ToolEllipse?.IsChecked == true) _currentTool = ToolMode.Ellipse;
            else if (ToolText?.IsChecked == true) _currentTool = ToolMode.Text;
            else if (ToolRedact?.IsChecked == true) _currentTool = ToolMode.Redact;

            UpdateToolState();
        }

        private void UpdateToolState()
        {
            if (InkDraw == null || ShapeOverlay == null) return;

            if (_currentTool == ToolMode.Pen || _currentTool == ToolMode.Highlighter)
            {
                InkDraw.EditingMode = InkCanvasEditingMode.Ink;
                ShapeOverlay.IsHitTestVisible = false;
                ApplyPenAttributes();
            }
            else
            {
                InkDraw.EditingMode = InkCanvasEditingMode.None;
                ShapeOverlay.IsHitTestVisible = true;
            }

            if (StatusHintText != null)
            {
                StatusHintText.Text = _currentTool switch
                {
                    ToolMode.Pen => "Draw freehand lines with the pen.",
                    ToolMode.Highlighter => "Highlight text or UI elements with translucent ink.",
                    ToolMode.Arrow => "Click and drag to draw an arrow pointing to an issue.",
                    ToolMode.Rectangle => "Click and drag to draw an outline rectangle.",
                    ToolMode.Ellipse => "Click and drag to draw an ellipse.",
                    ToolMode.Text => "Click anywhere to place a text callout.",
                    ToolMode.Redact => "Click and drag to blackout and redact sensitive information.",
                    _ => "Annotate screenshot, then click Save."
                };
            }
        }

        private void ApplyPenAttributes()
        {
            if (InkDraw == null) return;

            var da = new DrawingAttributes
            {
                Color = _currentTool == ToolMode.Highlighter
                    ? Color.FromArgb(120, _currentColor.R, _currentColor.G, _currentColor.B)
                    : _currentColor,
                Width = _currentTool == ToolMode.Highlighter ? _currentThickness * 3 : _currentThickness,
                Height = _currentTool == ToolMode.Highlighter ? _currentThickness * 3 : _currentThickness,
                IsHighlighter = _currentTool == ToolMode.Highlighter,
                FitToCurve = true
            };
            InkDraw.DefaultDrawingAttributes = da;
        }

        private void Color_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string hex)
            {
                try
                {
                    _currentColor = (Color)ColorConverter.ConvertFromString(hex);
                    ApplyPenAttributes();
                }
                catch { }
            }
        }

        private void CmbSize_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            _currentThickness = CmbSize.SelectedIndex switch
            {
                0 => 2.0,
                1 => 4.0,
                2 => 8.0,
                _ => 4.0
            };
            ApplyPenAttributes();
        }

        private void ShapeOverlay_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.LeftButton != MouseButtonState.Pressed) return;
            var pos = e.GetPosition(ShapeOverlay);

            if (_currentTool == ToolMode.Text)
            {
                AddTextLabel(pos);
                return;
            }

            _shapeStartPoint = pos;

            if (_currentTool == ToolMode.Rectangle || _currentTool == ToolMode.Redact)
            {
                var rect = new System.Windows.Shapes.Rectangle
                {
                    Stroke = _currentTool == ToolMode.Redact ? Brushes.Black : new SolidColorBrush(_currentColor),
                    StrokeThickness = _currentTool == ToolMode.Redact ? 1 : _currentThickness,
                    Fill = _currentTool == ToolMode.Redact ? Brushes.Black : Brushes.Transparent
                };
                Canvas.SetLeft(rect, pos.X);
                Canvas.SetTop(rect, pos.Y);
                _previewShape = rect;
                ShapeOverlay.Children.Add(rect);
            }
            else if (_currentTool == ToolMode.Ellipse)
            {
                var ell = new System.Windows.Shapes.Ellipse
                {
                    Stroke = new SolidColorBrush(_currentColor),
                    StrokeThickness = _currentThickness,
                    Fill = Brushes.Transparent
                };
                Canvas.SetLeft(ell, pos.X);
                Canvas.SetTop(ell, pos.Y);
                _previewShape = ell;
                ShapeOverlay.Children.Add(ell);
            }
            else if (_currentTool == ToolMode.Arrow)
            {
                var line = new Line
                {
                    X1 = pos.X,
                    Y1 = pos.Y,
                    X2 = pos.X,
                    Y2 = pos.Y,
                    Stroke = new SolidColorBrush(_currentColor),
                    StrokeThickness = _currentThickness
                };
                _previewShape = line;
                ShapeOverlay.Children.Add(line);
            }
        }

        private void ShapeOverlay_MouseMove(object sender, MouseEventArgs e)
        {
            if (!_shapeStartPoint.HasValue || _previewShape == null) return;
            var currentPos = e.GetPosition(ShapeOverlay);
            var start = _shapeStartPoint.Value;

            if (_previewShape is System.Windows.Shapes.Rectangle || _previewShape is System.Windows.Shapes.Ellipse)
            {
                double x = Math.Min(start.X, currentPos.X);
                double y = Math.Min(start.Y, currentPos.Y);
                double w = Math.Abs(currentPos.X - start.X);
                double h = Math.Abs(currentPos.Y - start.Y);

                Canvas.SetLeft(_previewShape, x);
                Canvas.SetTop(_previewShape, y);
                _previewShape.Width = Math.Max(1, w);
                _previewShape.Height = Math.Max(1, h);
            }
            else if (_previewShape is Line line)
            {
                line.X2 = currentPos.X;
                line.Y2 = currentPos.Y;
            }
        }

        private void ShapeOverlay_MouseUp(object sender, MouseButtonEventArgs e)
        {
            if (!_shapeStartPoint.HasValue || _previewShape == null) return;
            var start = _shapeStartPoint.Value;
            var end = e.GetPosition(ShapeOverlay);

            if (_previewShape is Line line)
            {
                // Add arrowhead
                var arrowHead = CreateArrowHead(start, end, _currentColor, _currentThickness);
                if (arrowHead != null)
                {
                    ShapeOverlay.Children.Add(arrowHead);
                    _overlayHistory.Push(arrowHead);
                }
            }

            _overlayHistory.Push(_previewShape);
            _previewShape = null;
            _shapeStartPoint = null;
        }

        private Polygon? CreateArrowHead(Point start, Point end, Color color, double thickness)
        {
            double theta = Math.Atan2(end.Y - start.Y, end.X - start.X);
            double arrowLength = Math.Max(12, thickness * 4);
            double arrowAngle = Math.PI / 6; // 30 degrees

            Point p1 = end;
            Point p2 = new Point(end.X - arrowLength * Math.Cos(theta - arrowAngle), end.Y - arrowLength * Math.Sin(theta - arrowAngle));
            Point p3 = new Point(end.X - arrowLength * Math.Cos(theta + arrowAngle), end.Y - arrowLength * Math.Sin(theta + arrowAngle));

            var poly = new Polygon
            {
                Fill = new SolidColorBrush(color),
                Points = new PointCollection { p1, p2, p3 }
            };
            return poly;
        }

        private void AddTextLabel(Point pos)
        {
            var border = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(220, 24, 24, 37)), // Catppuccin Crust with opacity
                BorderBrush = new SolidColorBrush(_currentColor),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 2, 4, 2)
            };

            var tb = new TextBox
            {
                Text = "Note...",
                FontSize = 12,
                Foreground = Brushes.White,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                MinWidth = 60,
                AcceptsReturn = true
            };

            border.Child = tb;
            Canvas.SetLeft(border, pos.X);
            Canvas.SetTop(border, pos.Y);

            ShapeOverlay.Children.Add(border);
            _overlayHistory.Push(border);

            tb.Focus();
            tb.SelectAll();
        }

        private void BtnUndo_Click(object sender, RoutedEventArgs e)
        {
            if (_overlayHistory.Count > 0)
            {
                var el = _overlayHistory.Pop();
                ShapeOverlay.Children.Remove(el);
            }
            else if (InkDraw.Strokes.Count > 0)
            {
                InkDraw.Strokes.RemoveAt(InkDraw.Strokes.Count - 1);
            }
        }

        private void BtnClear_Click(object sender, RoutedEventArgs e)
        {
            InkDraw.Strokes.Clear();
            ShapeOverlay.Children.Clear();
            _overlayHistory.Clear();
        }

        private RenderTargetBitmap RenderAnnotatedBitmap()
        {
            int w = (int)Math.Max(1, Math.Round(CanvasContainer.ActualWidth));
            int h = (int)Math.Max(1, Math.Round(CanvasContainer.ActualHeight));

            var rtb = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(CanvasContainer);
            return rtb;
        }

        private void BtnCopyImage_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var rtb = RenderAnnotatedBitmap();
                Clipboard.SetImage(rtb);
                StatusHintText.Text = "Annotated screenshot copied to clipboard.";
            }
            catch (Exception ex)
            {
                StatusHintText.Text = $"Could not copy: {ex.Message}";
            }
        }

        private void BtnSaveAttach_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var rtb = RenderAnnotatedBitmap();
                var dir = System.IO.Path.GetDirectoryName(_originalFilePath)!;
                var origName = System.IO.Path.GetFileNameWithoutExtension(_originalFilePath);
                var annotatedPath = System.IO.Path.Combine(dir, $"{origName}_annotated.png");

                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(rtb));

                using (var stream = File.Create(annotatedPath))
                {
                    encoder.Save(stream);
                }

                ResultFilePath = annotatedPath;
                DialogResult = true;
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to save annotated image: {ex.Message}", "Save Error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
            Close();
        }
    }
}
