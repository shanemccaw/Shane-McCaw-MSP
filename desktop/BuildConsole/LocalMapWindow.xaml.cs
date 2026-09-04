using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;
using BuildConsole.Services.BuildMap;

namespace BuildConsole
{
    /// <summary>
    /// Git #2806 (Local Map, item #2 of #2804's structured index) — the real window: reuses
    /// <see cref="Controls.BuildMap.ChainCanvasControl"/>'s rendering/interaction pattern (via the
    /// new <see cref="Controls.BuildMap.LocalMapCanvasControl"/>) and <see cref="ChainLayout"/>'s
    /// genuinely generic pieces (<see cref="ChainLayout.ClampZoom"/>/<see cref="ChainLayout.FitZoom"/>/
    /// <see cref="ChainLayout.PathData"/>), fed by the real <see cref="LocalSchemaDoc"/>
    /// <see cref="LocalSchemaMapService"/> (#2805) reads from the live local Postgres database —
    /// no GitHub data, no fixture rows.
    ///
    /// Read-only: this window has no write plane (a live application schema isn't something a
    /// build session edits from a map view), so unlike <c>BuildChainMapWindow</c> there is no
    /// Re-wire button, no drag-reorder, no persistence layer — just load, lay out, look, click.
    ///
    /// Opening this window from the chain-map icon's Git Map / Local Map picker is #2807's own
    /// scope (#2804's structured-index item #3) — this window is a standalone, directly
    /// constructible <see cref="Window"/> in the meantime, same as <c>BuildChainMapWindow</c> was
    /// before #2482 wired its own top bar.
    /// </summary>
    public partial class LocalMapWindow : Window
    {
        private const string Channel = "buildconsole.local-map";

        private LocalSchemaDoc? _doc;
        private double _zoom = 1.0;
        private bool _busy;

        private TextBlock _tablesValue = null!;
        private TextBlock _edgesValue = null!;
        private TextBlock _pkValue = null!;

        public LocalMapWindow()
        {
            InitializeComponent();
            BuildStatsStrip();

            Canvas.SelectionChanged += (_, __) => { RenderInspector(); RenderStatusStrip(); };
            Canvas.EdgeSelectionChanged += (_, __) => { RenderInspector(); RenderStatusStrip(); };
            Canvas.ZoomChanged += (_, __) => { _zoom = Canvas.Zoom; RenderZoom(); };

            Loaded += async (_, __) => await RefreshAsync();
        }

        // ── Stats strip ──────────────────────────────────────────────────────────────────────
        private void BuildStatsStrip()
        {
            _tablesValue = AddChip("TABLES", "#e6edf3");
            _edgesValue = AddChip("FK EDGES", "#7fb08a");
            _pkValue = AddChip("NO PRIMARY KEY", "#e0a879", last: true);
        }

        private TextBlock AddChip(string label, string valueColorHex, bool last = false)
        {
            var stack = new StackPanel { Margin = new Thickness(0, 0, last ? 0 : 12, 0) };
            stack.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 8,
                FontWeight = FontWeights.ExtraBold,
                Foreground = (Brush)new BrushConverter().ConvertFromString("#576069")!,
            });
            var value = new TextBlock
            {
                Text = "—",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 13,
                FontWeight = FontWeights.ExtraBold,
                Foreground = (Brush)new BrushConverter().ConvertFromString(valueColorHex)!,
                Margin = new Thickness(0, 1, 0, 0),
            };
            stack.Children.Add(value);
            StatsStripPanel.Children.Add(stack);
            return value;
        }

        // ── Load / refresh from the real live Postgres database ─────────────────────────────
        private async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                StatusHintText.Text = "Reading the live schema…";
                CanvasPlaceholderText.Text = "Reading the live schema…";
                CanvasPlaceholderText.Visibility = Visibility.Visible;

                _doc = await LocalSchemaMapService.BuildAsync();

                Canvas.SetDocument(_doc);
                CanvasPlaceholderText.Visibility = _doc.Tables.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
                CanvasPlaceholderText.Text = "This database has no real tables to show.";
                Render();
                RenderInspector();
                ActivityLog.Log(Channel, $"{_doc.Database}: loaded {_doc.Tables.Count} tables, {_doc.Edges.Count} FK edges");
            }
            catch (Exception ex)
            {
                StatusHintText.Text = $"Couldn't read the live schema: {ex.Message}";
                CanvasPlaceholderText.Text = $"Couldn't read the live schema.\n{ex.Message}";
                CanvasPlaceholderText.Visibility = Visibility.Visible;
                ActivityLog.Log(Channel, $"load failed — {ex.Message}");
            }
            finally
            {
                _busy = false;
            }
        }

        // ── Render (title block, stats, status strip) ───────────────────────────────────────
        private void Render()
        {
            if (_doc == null) return;

            DatabaseNameText.Text = _doc.Database;
            GeneratedAtText.Text = $"as of {_doc.GeneratedAtUtc:yyyy-MM-dd HH:mm} UTC";

            _tablesValue.Text = _doc.Tables.Count.ToString();
            _edgesValue.Text = _doc.Edges.Count.ToString();
            _pkValue.Text = _doc.Tables.Count(t => t.PrimaryKeyColumns.Count == 0).ToString();

            RenderStatusStrip();
            RenderZoom();
        }

        private void RenderStatusStrip()
        {
            if (_doc == null) return;
            StatusHintText.Text = Canvas.SelectedTableId != null || Canvas.SelectedEdge != null
                ? "Click empty space to clear selection"
                : "Click a table to see its real columns/PK · click an edge to see the real foreign key it represents";
            StatusCountsText.Text = $"{_doc.Tables.Count} table{(_doc.Tables.Count == 1 ? "" : "s")} · {_doc.Edges.Count} FK edge{(_doc.Edges.Count == 1 ? "" : "s")}";
        }

        private void RenderZoom() => ZoomPercentText.Text = $"{Math.Round(_zoom * 100)}%";

        // ── Inspector (right panel) — nothing / table / edge selected ───────────────────────
        private void RenderInspector()
        {
            InspectorHost.Children.Clear();
            if (_doc == null) return;

            if (Canvas.SelectedTableId is string tableId && _doc.Tables.FirstOrDefault(t => t.Id == tableId) is LocalSchemaTable table)
                RenderInspectorTable(table);
            else if (Canvas.SelectedEdge is LocalSchemaEdge edge)
                RenderInspectorEdge(edge);
            else
                RenderInspectorNothing();
        }

        private void RenderInspectorNothing()
        {
            InspectorHost.Children.Add(InsEyebrow("How to read this"));
            InspectorHost.Children.Add(InsText(
                "Real tables from the live Postgres schema, laid out left → right by real foreign-key depth: a table with no outgoing foreign key sits at the left; a table referencing it sits one column to the right. Click a table to see its real columns and primary key; click an edge to see the real foreign key it represents.",
                topMargin: 7));

            InspectorHost.Children.Add(InsEyebrow("Database", topMargin: 16));
            InspectorHost.Children.Add(InsText(_doc!.Database, topMargin: 4));

            InspectorHost.Children.Add(InsEyebrow("Generated", topMargin: 16));
            InspectorHost.Children.Add(InsText($"{_doc.GeneratedAtUtc:yyyy-MM-dd HH:mm:ss} UTC", topMargin: 4));
        }

        private void RenderInspectorTable(LocalSchemaTable table)
        {
            InspectorHost.Children.Add(InsEyebrow("TABLE"));
            InspectorHost.Children.Add(InsTitle(table.Name));
            InspectorHost.Children.Add(InsText(table.Id, topMargin: 2, faint: true));

            InspectorHost.Children.Add(InsEyebrow("Columns", topMargin: 16));
            InspectorHost.Children.Add(InsText($"{table.ColumnCount} real column(s)", topMargin: 4));

            InspectorHost.Children.Add(InsEyebrow("Primary key", topMargin: 16));
            InspectorHost.Children.Add(InsText(
                table.PrimaryKeyColumns.Count == 0 ? "This table genuinely has no primary key." : string.Join(", ", table.PrimaryKeyColumns),
                topMargin: 4));

            var outgoing = _doc!.Edges.Where(e => e.FromTableId == table.Id).OrderBy(e => e.ToTableId, StringComparer.Ordinal).ToList();
            var incoming = _doc.Edges.Where(e => e.ToTableId == table.Id).OrderBy(e => e.FromTableId, StringComparer.Ordinal).ToList();

            InspectorHost.Children.Add(InsEyebrow($"References ({outgoing.Count})", topMargin: 16));
            if (outgoing.Count == 0)
                InspectorHost.Children.Add(InsText("No outgoing foreign keys.", topMargin: 4, faint: true));
            foreach (var e in outgoing)
                InspectorHost.Children.Add(InsText($"→ {e.ToTableId}  ({string.Join(",", e.FromColumns)} → {string.Join(",", e.ToColumns)})", topMargin: 4));

            InspectorHost.Children.Add(InsEyebrow($"Referenced by ({incoming.Count})", topMargin: 16));
            if (incoming.Count == 0)
                InspectorHost.Children.Add(InsText("No other real table references this one.", topMargin: 4, faint: true));
            foreach (var e in incoming)
                InspectorHost.Children.Add(InsText($"← {e.FromTableId}  ({string.Join(",", e.FromColumns)} → {string.Join(",", e.ToColumns)})", topMargin: 4));
        }

        private void RenderInspectorEdge(LocalSchemaEdge edge)
        {
            InspectorHost.Children.Add(InsEyebrow("FOREIGN KEY"));
            InspectorHost.Children.Add(InsTitle(edge.ConstraintName));

            InspectorHost.Children.Add(InsEyebrow("Referencing table", topMargin: 16));
            InspectorHost.Children.Add(InsText($"{edge.FromTableId}  ({string.Join(", ", edge.FromColumns)})", topMargin: 4));

            InspectorHost.Children.Add(InsEyebrow("Referenced table", topMargin: 16));
            InspectorHost.Children.Add(InsText($"{edge.ToTableId}  ({string.Join(", ", edge.ToColumns)})", topMargin: 4));
        }

        private static TextBlock InsEyebrow(string text, double topMargin = 0) => new()
        {
            Text = text.ToUpperInvariant(),
            FontSize = 8.5,
            FontWeight = FontWeights.ExtraBold,
            Foreground = (Brush)new BrushConverter().ConvertFromString("#6a8fb5")!,
            Margin = new Thickness(0, topMargin, 0, 0),
        };

        private static TextBlock InsTitle(string text) => new()
        {
            Text = text,
            FontSize = 14,
            FontWeight = FontWeights.ExtraBold,
            Foreground = (Brush)new BrushConverter().ConvertFromString("#e6edf3")!,
            Margin = new Thickness(0, 4, 0, 0),
            TextWrapping = TextWrapping.Wrap,
        };

        private static TextBlock InsText(string text, double topMargin = 0, bool faint = false) => new()
        {
            Text = text,
            FontSize = 11.5,
            Foreground = (Brush)new BrushConverter().ConvertFromString(faint ? "#576069" : "#c9d1d9")!,
            Margin = new Thickness(0, topMargin, 0, 0),
            TextWrapping = TextWrapping.Wrap,
        };

        // ── Controls ─────────────────────────────────────────────────────────────────────
        private void ZoomOutButton_Click(object sender, RoutedEventArgs e) => Canvas.ZoomOut();
        private void ZoomInButton_Click(object sender, RoutedEventArgs e) => Canvas.ZoomIn();
        private void FitButton_Click(object sender, RoutedEventArgs e) => Canvas.Fit();

        private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await RefreshAsync();
    }
}
