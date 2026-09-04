using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using BuildConsole.Services.BuildMap;

namespace BuildConsole.Controls.BuildMap
{
    /// <summary>
    /// Git #2806 (Local Map, item #2 of #2804's structured index) — the real schema-graph canvas:
    /// table nodes + real foreign-key edges, positioned exclusively by
    /// <see cref="LocalMapLayout"/>, with the same pan/zoom/click interaction feel as
    /// <see cref="ChainCanvasControl"/> (<see cref="ChainLayout.ClampZoom"/>/<see cref="ChainLayout.FitZoom"/>/
    /// <see cref="ChainLayout.PathData"/> reused directly — see <see cref="LocalMapLayout"/>'s own
    /// class doc for why the node layout itself is new).
    ///
    /// Unlike <see cref="ChainCanvasControl"/> this is read-only: a live Postgres schema isn't a
    /// document a build session edits from this window (no drag-reorder, no gate pills, no
    /// blocked_by mutation — there is no GitHub write plane here). Click selects a table node or an
    /// edge and reports it via <see cref="SelectionChanged"/>/<see cref="EdgeSelectionChanged"/> so
    /// <c>LocalMapWindow</c>'s Inspector panel can show its real fields.
    /// </summary>
    public partial class LocalMapCanvasControl : UserControl
    {
        // ---- palette — same tokens ChainCanvasControl uses, for visual consistency between the
        // Git Map and the Local Map (BuildMap/README.md "Design tokens"). ----
        private static readonly Brush CardBg = Frozen("#0f1319");
        private static readonly Brush SelectedFill = Frozen("#131c27");
        private static readonly Brush Border1 = Frozen("#1b212a");
        private static readonly Brush Border2 = Frozen("#21262d");
        private static readonly Brush Border3 = Frozen("#2e3742");
        private static readonly Brush TextHi = Frozen("#e6edf3");
        private static readonly Brush TextDim = Frozen("#8b949e");
        private static readonly Brush TextFaint = Frozen("#576069");
        private static readonly Brush BlueFill = Frozen("#1d3450");
        private static readonly Brush BlueSoft = Frozen("#6a8fb5");
        private static readonly Brush BlueLight = Frozen("#9fc0dd");
        private static readonly Brush EdgeColor = Frozen("#4d7aa8");
        private static readonly Brush EdgeSelected = Frozen("#e6edf3");
        private static readonly Brush EdgeHalo = Frozen("#0a0d12");

        private static readonly FontFamily UiFont = new("Inter, Segoe UI");
        private static readonly FontFamily MonoFont = new("Consolas, Menlo, monospace");

        private LocalSchemaDoc? _doc;
        private LocalMapLayoutResult? _layout;
        private double _zoom = 1.0;
        private string? _selectedTableId;
        private LocalSchemaEdge? _selectedEdge;

        public LocalMapCanvasControl()
        {
            InitializeComponent();
            Scroller.PreviewMouseWheel += OnPreviewMouseWheel;
            Stage.MouseLeftButtonDown += (_, e) => { ClearSelection(); e.Handled = true; };
            Scroller.MouseLeftButtonDown += (_, _) => ClearSelection();
        }

        // ---- public surface for LocalMapWindow ----
        public LocalSchemaDoc? Document => _doc;
        public LocalMapLayoutResult? Layout => _layout;
        public string? SelectedTableId => _selectedTableId;
        public LocalSchemaEdge? SelectedEdge => _selectedEdge;
        public double Zoom => _zoom;

        public event EventHandler? SelectionChanged;
        public event EventHandler? EdgeSelectionChanged;
        public event EventHandler? ZoomChanged;
        public event EventHandler? Rendered;

        /// <summary>Set (or replace) the real schema document and render.</summary>
        public void SetDocument(LocalSchemaDoc doc)
        {
            _doc = doc;
            if (_selectedTableId != null && doc.Tables.All(t => t.Id != _selectedTableId))
                _selectedTableId = null;
            _selectedEdge = null;
            Render();
        }

        public void SelectTable(string tableId)
        {
            if (_doc == null || _doc.Tables.All(t => t.Id != tableId)) return;
            _selectedTableId = tableId;
            _selectedEdge = null;
            Render();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        public void ClearSelection()
        {
            if (_selectedTableId == null && _selectedEdge == null) return;
            _selectedTableId = null;
            _selectedEdge = null;
            Render();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
            EdgeSelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        public void ZoomIn() => SetZoom(_zoom + LocalMapLayout.ZoomStep);
        public void ZoomOut() => SetZoom(_zoom - LocalMapLayout.ZoomStep);

        public void SetZoom(double zoom)
        {
            double clamped = ChainLayout.ClampZoom(zoom);
            if (Math.Abs(clamped - _zoom) < 0.001) return;
            _zoom = clamped;
            StageScale.ScaleX = _zoom;
            StageScale.ScaleY = _zoom;
            ZoomChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Fit = min(1, (viewportWidth − 16) / W), floored at 0.35 — same formula
        /// <see cref="ChainCanvasControl.Fit"/> uses, via the shared <see cref="ChainLayout.FitZoom"/>.</summary>
        public void Fit()
        {
            if (_layout == null || Scroller.ViewportWidth <= 0) return;
            double fit = ChainLayout.FitZoom(Scroller.ViewportWidth, _layout.W);
            _zoom = fit;
            StageScale.ScaleX = fit;
            StageScale.ScaleY = fit;
            ZoomChanged?.Invoke(this, EventArgs.Empty);
        }

        private void OnPreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if ((Keyboard.Modifiers & ModifierKeys.Control) == 0) return;
            SetZoom(_zoom + (e.Delta > 0 ? LocalMapLayout.ZoomStep : -LocalMapLayout.ZoomStep));
            e.Handled = true;
        }

        // ---- render ----
        private void Render()
        {
            NodeLayer.Children.Clear();
            EdgeLayerHost.Children.Clear();

            if (_doc == null)
            {
                _layout = null;
                Stage.Width = 0;
                Stage.Height = 0;
                return;
            }

            _layout = LocalMapLayout.Compute(_doc);
            Stage.Width = _layout.W;
            Stage.Height = _layout.H;

            var relatedTo = new HashSet<string>(StringComparer.Ordinal);
            if (_selectedTableId is string sel)
            {
                relatedTo.Add(sel);
                foreach (var e in _doc.Edges)
                {
                    if (e.FromTableId == sel) relatedTo.Add(e.ToTableId);
                    if (e.ToTableId == sel) relatedTo.Add(e.FromTableId);
                }
            }

            RenderEdgeLayer(_doc, _layout);

            foreach (var table in _doc.Tables)
            {
                if (!_layout.Node.TryGetValue(table.Id, out var rect)) continue;
                RenderTableNode(table, rect, relatedTo);
            }

            Rendered?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Table node — real name, real column count, real PK columns. No fabricated row
        /// count or fabricated description — a table with no columns loaded yet would just show 0,
        /// not a placeholder guess.</summary>
        private void RenderTableNode(LocalSchemaTable table, ChainRect rect, HashSet<string> relatedTo)
        {
            bool selected = _selectedTableId == table.Id;
            bool related = _selectedTableId != null && relatedTo.Contains(table.Id) && !selected;
            bool dimmed = _selectedTableId != null && !selected && !related;

            var headerRow = HStack(6,
                IconTile(18, 5, BlueFill, BlueSoft),
                Eyebrow(table.Schema == "public" ? "TABLE" : table.Schema.ToUpperInvariant(), 8, BlueSoft),
                Spacer(),
                MonoText(table.ColumnCount + " col" + (table.ColumnCount == 1 ? "" : "s"), 8.5, TextFaint));

            var name = Text(table.Name, 12, FontWeights.ExtraBold, TextHi);
            name.TextTrimming = TextTrimming.CharacterEllipsis;

            string pkText = table.PrimaryKeyColumns.Count == 0
                ? "no primary key"
                : "pk: " + string.Join(", ", table.PrimaryKeyColumns);
            var pk = MonoText(pkText, 8.5, TextDim);
            pk.TextTrimming = TextTrimming.CharacterEllipsis;

            var content = new StackPanel();
            headerRow.Margin = new Thickness(0, 0, 0, 4);
            name.Margin = new Thickness(0, 0, 0, 3);
            content.Children.Add(headerRow);
            content.Children.Add(name);
            content.Children.Add(pk);

            var card = Card(rect.W, rect.H,
                fill: selected ? SelectedFill : CardBg,
                stroke: selected ? BlueSoft : related ? Border3 : Border2,
                radius: 7, padding: new Thickness(10, 8, 10, 8), content: content,
                ring: selected ? BlueSoft : null);
            card.Opacity = dimmed ? 0.35 : 1.0;
            card.ToolTip = $"{table.Id} — {table.ColumnCount} column(s), {pkText}";
            card.Cursor = Cursors.Hand;
            string idCopy = table.Id;
            card.MouseLeftButtonDown += (_, e) => { e.Handled = true; SelectTable(idCopy); };

            Place(card, rect.X, rect.Y);
        }

        /// <summary>The real FK edge layer. Multiple real FK constraints between the same two tables
        /// bundle into one path with a `×N` label, same convention <see cref="ChainCanvasControl"/>
        /// uses for bundled blocked_by edges.</summary>
        private void RenderEdgeLayer(LocalSchemaDoc doc, LocalMapLayoutResult layout)
        {
            var groups = new Dictionary<(string From, string To), List<LocalSchemaEdge>>();
            foreach (var edge in doc.Edges)
            {
                var a = LocalMapLayout.OutPort(layout, edge.FromTableId);
                var b = LocalMapLayout.InPort(layout, edge.ToTableId);
                if (a == null || b == null) continue;
                var key = (edge.FromTableId, edge.ToTableId);
                if (!groups.TryGetValue(key, out var list))
                    groups[key] = list = new List<LocalSchemaEdge>();
                list.Add(edge);
            }

            foreach (var ((fromId, toId), edges) in groups)
            {
                var a = LocalMapLayout.OutPort(layout, fromId)!;
                var b = LocalMapLayout.InPort(layout, toId)!;

                bool selected = _selectedEdge != null && edges.Contains(_selectedEdge);
                bool touchesSelection = _selectedTableId != null && (fromId == _selectedTableId || toId == _selectedTableId);
                double opacity = selected ? 1.0 : touchesSelection ? 0.9
                    : _selectedTableId != null ? 0.08 : 0.55;
                double width = selected ? 2.0 : touchesSelection ? 1.6 : 1.1;
                Brush stroke = selected || touchesSelection ? EdgeSelected : EdgeColor;

                string pathData = ChainLayout.PathData(a, b, ChainEdgeStyle.Orthogonal);
                var geometry = Geometry.Parse(pathData);
                geometry.Freeze();

                EdgeLayerHost.Children.Add(new Path
                {
                    Data = geometry,
                    Stroke = stroke,
                    StrokeThickness = width,
                    Fill = null,
                    Opacity = opacity,
                    IsHitTestVisible = false,
                });
                EdgeLayerHost.Children.Add(BuildArrowMarker(a, b, stroke, opacity));

                var hit = new Path
                {
                    Data = geometry,
                    Stroke = Brushes.Transparent,
                    StrokeThickness = 10,
                    Fill = null,
                    Cursor = Cursors.Hand,
                    ToolTip = EdgeTooltip(fromId, toId, edges),
                };
                var edgesCopy = edges;
                hit.MouseLeftButtonDown += (_, e) => { e.Handled = true; SelectEdge(edgesCopy[0]); };
                EdgeLayerHost.Children.Add(hit);

                if (edges.Count > 1)
                    EdgeLayerHost.Children.Add(BuildBundleLabel(a, b, edges.Count, stroke, opacity));
            }
        }

        private void SelectEdge(LocalSchemaEdge edge)
        {
            _selectedEdge = edge;
            _selectedTableId = null;
            Render();
            EdgeSelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        private static string EdgeTooltip(string fromId, string toId, List<LocalSchemaEdge> edges)
        {
            if (edges.Count == 1)
            {
                var e = edges[0];
                return $"{fromId}.({string.Join(",", e.FromColumns)}) → {toId}.({string.Join(",", e.ToColumns)})\n{e.ConstraintName}";
            }
            return $"{edges.Count} foreign keys: {fromId} → {toId}\n" + string.Join("\n", edges.Select(e => e.ConstraintName));
        }

        private static Path BuildArrowMarker(ChainPort a, ChainPort b, Brush color, double opacity)
        {
            double mid = (a.X + b.X) / 2;
            double d = b.X - mid;
            double ux = d < 0 ? -1 : 1;
            const double uy = 0;
            double vx = -uy, vy = ux;
            const double len = 6, half = 3;

            var tip = new Point(b.X, b.Y);
            var baseCenter = new Point(b.X - ux * len, b.Y - uy * len);
            var p1 = new Point(baseCenter.X + vx * half, baseCenter.Y + vy * half);
            var p2 = new Point(baseCenter.X - vx * half, baseCenter.Y - vy * half);

            var geometry = new StreamGeometry();
            using (var ctx = geometry.Open())
            {
                ctx.BeginFigure(tip, true, true);
                ctx.LineTo(p1, true, false);
                ctx.LineTo(p2, true, false);
            }
            geometry.Freeze();

            return new Path { Data = geometry, Fill = color, Opacity = opacity, IsHitTestVisible = false };
        }

        private static Path BuildBundleLabel(ChainPort a, ChainPort b, int count, Brush color, double opacity)
        {
            double mx = (a.X + b.X) / 2, my = (a.Y + b.Y) / 2;
            var typeface = new Typeface(MonoFont, FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);
            var formatted = new FormattedText("×" + count, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                typeface, 9, Brushes.Black, 1.0);
            var textGeometry = formatted.BuildGeometry(new Point(mx - formatted.Width / 2, my - formatted.Height / 2));

            return new Path
            {
                Data = textGeometry,
                Fill = color,
                Opacity = Math.Min(1, opacity + .35),
                Stroke = EdgeHalo,
                StrokeThickness = 4,
                IsHitTestVisible = false,
            };
        }

        // ---- element factory helpers — same small set ChainCanvasControl uses ----
        private static Grid Card(double w, double h, Brush fill, Brush stroke, double radius,
            Thickness padding, FrameworkElement content, Brush? ring = null)
        {
            var grid = new Grid { Width = w, Height = h, Background = Brushes.Transparent };
            var box = new Rectangle { RadiusX = radius, RadiusY = radius, Fill = fill, Stroke = stroke, StrokeThickness = 1 };
            grid.Children.Add(box);
            if (ring != null)
            {
                grid.Children.Add(new Rectangle
                {
                    RadiusX = radius + 1, RadiusY = radius + 1,
                    Stroke = ring, StrokeThickness = 1,
                    Margin = new Thickness(-1),
                    IsHitTestVisible = false,
                });
            }
            content.Margin = padding;
            grid.Children.Add(content);
            return grid;
        }

        private static Grid HStack(double gap, params FrameworkElement[] items)
        {
            var grid = new Grid();
            for (int i = 0; i < items.Length; i++)
            {
                bool isSpacer = items[i] is FrameworkElement { Tag: "spacer" };
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = isSpacer ? new GridLength(1, GridUnitType.Star) : GridLength.Auto });
                if (i > 0 && !isSpacer) items[i].Margin = new Thickness(gap, 0, 0, 0);
                items[i].VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(items[i], i);
                grid.Children.Add(items[i]);
            }
            return grid;
        }

        private static FrameworkElement Spacer() => new Border { Tag = "spacer" };

        private static TextBlock Text(string text, double size, FontWeight weight, Brush color)
        {
            return new TextBlock { Text = text, FontFamily = UiFont, FontSize = size, FontWeight = weight, Foreground = color };
        }

        private static TextBlock MonoText(string text, double size, Brush color)
        {
            var tb = Text(text, size, FontWeights.Normal, color);
            tb.FontFamily = MonoFont;
            return tb;
        }

        private static TextBlock Eyebrow(string text, double size, Brush color) =>
            Text(text.ToUpperInvariant(), size, FontWeights.ExtraBold, color);

        private static Border IconTile(double size, double radius, Brush bg, Brush fg)
        {
            var path = new Path
            {
                Data = (Geometry)Application.Current.FindResource("Icon.Database"),
                Stroke = fg,
                StrokeThickness = 1.6,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            };
            var canvas = new Canvas { Width = 24, Height = 24 };
            canvas.Children.Add(path);
            return new Border
            {
                Width = size, Height = size,
                Background = bg,
                CornerRadius = new CornerRadius(radius),
                Child = new Viewbox { Width = 11, Height = 11, Child = canvas, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
            };
        }

        private void Place(FrameworkElement element, double x, double y)
        {
            Canvas.SetLeft(element, x);
            Canvas.SetTop(element, y);
            NodeLayer.Children.Add(element);
        }

        private static SolidColorBrush Frozen(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }
    }
}
