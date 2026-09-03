using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using BuildConsole.Services.BuildMap;

namespace BuildConsole.Controls.BuildMap
{
    /// <summary>
    /// Git #2477 (Build Chain Map, item #3 of #2473's structured index) — the auto-layout canvas:
    /// node rendering for the Epic card, Feature headers (collapsed 204×94 / expanded 412×94),
    /// issue rows, sentinel cards and gate pills, positioned exclusively by
    /// <see cref="ChainLayout"/>, plus the epic-tree rail and zoom 0.35–1.6 with Fit.
    ///
    /// Recreated from `BuildMap/README.md` ("Canvas geometry", "Nodes") and the reference
    /// prototype `Build Chain Map.dc.html` — colors, sizes and copy are taken from there verbatim.
    /// View-only interactions live here (expand/collapse on header click, zoom, selection
    /// highlight); every document-mutating interaction (drag reorder, gate toggle, sentinel
    /// change, board status, edge add/remove) is Git #2480 and hangs off the public events below.
    /// Git #2478 (the <c>ChainCanvasControl.EdgeLayer.cs</c> partial) draws the blocked_by edge
    /// layer into <see cref="EdgeLayer"/> using <see cref="ChainLayout.OutPort"/>/
    /// <see cref="ChainLayout.InPort"/> against <see cref="Layout"/>/<see cref="Derived"/>/
    /// <see cref="ExpandedFeatures"/>, and owns its own click-to-select/hover state — edge
    /// selection is a 4th selection kind alongside the issue/Feature selection below.
    /// </summary>
    public partial class ChainCanvasControl : UserControl
    {
        // ---- palette (README "Design tokens") ----
        private static readonly Brush PanelBg = Frozen("#0d1117");
        private static readonly Brush CardBg = Frozen("#0f1319");
        private static readonly Brush SentinelBg = Frozen("#0e141c");
        private static readonly Brush SelectedFill = Frozen("#131c27");
        private static readonly Brush DoneFill = Frozen("#0c1210");
        private static readonly Brush Border1 = Frozen("#1b212a");
        private static readonly Brush Border2 = Frozen("#21262d");
        private static readonly Brush Border3 = Frozen("#2e3742");
        private static readonly Brush TextHi = Frozen("#e6edf3");
        private static readonly Brush TextMid = Frozen("#aab4bf");
        private static readonly Brush TextDim = Frozen("#8b949e");
        private static readonly Brush TextFaint = Frozen("#576069");
        private static readonly Brush BlueFill = Frozen("#1d3450");
        private static readonly Brush BlueBorder = Frozen("#3d5875");
        private static readonly Brush Blue = Frozen("#4d7aa8");
        private static readonly Brush BlueSoft = Frozen("#6a8fb5");
        private static readonly Brush BlueLight = Frozen("#9fc0dd");
        private static readonly Brush Green = Frozen("#7fb08a");
        private static readonly Brush GreenDim = Frozen("#5f9a6c");
        private static readonly Brush GreenDark = Frozen("#2f5a3a");
        private static readonly Brush GreenBorder = Frozen("#2e4a36");
        private static readonly Brush Amber = Frozen("#e0a879");
        private static readonly Brush AmberBorder = Frozen("#5a3f2a");
        private static readonly Brush AmberBg = Frozen("#1a1512");
        private static readonly Brush AmberRing = FrozenRgba(224, 168, 121, .35);
        private static readonly Brush AmberLine = FrozenRgba(224, 168, 121, .4);
        private static readonly Brush Violet = Frozen("#a374ea");
        private static readonly Brush VioletDim = Frozen("#8b7aa8");
        private static readonly Brush VioletBorder = Frozen("#3a3050");
        private static readonly Brush HeldDot = Frozen("#6b7480");
        private static readonly Brush HeldSeg = Frozen("#3a4250");
        private static readonly Brush RailStroke = Frozen("#2a323d");
        private static readonly Brush BarTrack = Frozen("#0a0d12");

        private static readonly FontFamily UiFont = new("Inter, Segoe UI");
        private static readonly FontFamily MonoFont = new("Consolas, Menlo, monospace");

        // Lucide 24×24 geometries (2px stroke, round caps/joins), scaled via Viewbox.
        private static readonly Dictionary<string, string> IconPaths = new()
        {
            ["layers"] = "M12.83 2.18 a2 2 0 0 0 -1.66 0 L2.6 6.08 a1 1 0 0 0 0 1.83 l8.58 3.91 a2 2 0 0 0 1.66 0 l8.58 -3.9 a1 1 0 0 0 0 -1.83 Z M2 12.65 l9.17 4.16 a2 2 0 0 0 1.66 0 L22 12.65 M2 17.65 l9.17 4.16 a2 2 0 0 0 1.66 0 L22 17.65",
            ["chevron-down"] = "M6 9 l6 6 l6 -6",
            ["chevron-up"] = "M18 15 l-6 -6 l-6 6",
            ["target"] = "M22 12 a10 10 0 1 1 -20 0 a10 10 0 0 1 20 0 M18 12 a6 6 0 1 1 -12 0 a6 6 0 0 1 12 0 M14 12 a2 2 0 1 1 -4 0 a2 2 0 0 1 4 0",
            ["zap"] = "M4 14 a1 1 0 0 1 -0.78 -1.63 l9.9 -10.2 a0.5 0.5 0 0 1 0.86 0.46 l-1.92 6.02 A1 1 0 0 0 13 10 h7 a1 1 0 0 1 0.78 1.63 l-9.9 10.2 a0.5 0.5 0 0 1 -0.86 -0.46 l1.92 -6.02 A1 1 0 0 0 11 14 z",
            ["pause"] = "M9 4 H7 a1 1 0 0 0 -1 1 v14 a1 1 0 0 0 1 1 h2 a1 1 0 0 0 1 -1 V5 a1 1 0 0 0 -1 -1 Z M17 4 h-2 a1 1 0 0 0 -1 1 v14 a1 1 0 0 0 1 1 h2 a1 1 0 0 0 1 -1 V5 a1 1 0 0 0 -1 -1 Z",
        };

        private ChainDoc? _doc;
        private ChainDerived? _derived;
        private ChainLayoutResult? _layout;
        private readonly HashSet<string> _expanded = new();
        private double _zoom = 1.0;
        private int? _selectedIssue;
        private string? _selectedFeatureId;
        private int? _linkModeTarget;

        // Drag-to-reorder state (README "Interactions": "Drag a Feature header onto another").
        // A press records the point + Feature id but does NOT toggle/select yet; only movement past
        // the system drag threshold promotes it to a drag (so a plain click still toggles+selects on
        // mouse-up). While a drag is live the source header shows at .45 opacity, matching the
        // prototype's `opacity: drag === fid ? .45 : 1`.
        private Point _headerPressPoint;
        private string? _pressedHeaderId;
        private bool _headerDragging;

        public ChainCanvasControl()
        {
            InitializeComponent();
            Scroller.PreviewMouseWheel += OnPreviewMouseWheel;
            Stage.MouseLeftButtonDown += (_, e) => { ClearSelection(); e.Handled = true; };
            Scroller.MouseLeftButtonDown += (_, _) => ClearSelection();
        }

        // ---- public surface for #2478/#2479/#2480/#2482 ----

        /// <summary>The layer #2478's blocked_by edge rendering draws into (under the nodes).</summary>
        public Canvas EdgeLayer => EdgeLayerHost;

        public ChainDoc? Document => _doc;
        public ChainDerived? Derived => _derived;
        public ChainLayoutResult? Layout => _layout;
        public IReadOnlySet<string> ExpandedFeatures => _expanded;
        public int? SelectedIssueNum => _selectedIssue;
        public string? SelectedFeatureId => _selectedFeatureId;
        public double Zoom => _zoom;

        /// <summary>Non-null while "Add blocker…" link mode is active (README "Interactions"):
        /// the issue a newly-picked blocker will be wired to. Set by #2479's inspector via
        /// <see cref="EnterLinkMode"/>; cleared by <see cref="CancelLinkMode"/>, by picking a
        /// blocker (a click on any other issue node), or by any selection-clearing action.</summary>
        public int? LinkModeTargetIssue => _linkModeTarget;

        public event EventHandler? SelectionChanged;
        public event EventHandler? ZoomChanged;
        public event EventHandler? Rendered;
        /// <summary>Gate pill clicked — the §5.3 manual-gate toggle itself is #2479/#2480's to perform.</summary>
        public event EventHandler<string>? GatePillClicked;
        /// <summary>A Feature header was dragged onto another (README "Interactions": "Drag a Feature
        /// header onto another"). <c>From</c> = the dragged Feature's id, <c>To</c> = the drop
        /// target's id. The splice + §5.2-step-3 gate re-wire itself is the window's to perform
        /// (<c>BuildChainMapWindow.ReorderFeature</c>) — same window-owns-the-mutation split the gate
        /// pill and inspector reorder arrows already use.</summary>
        public event EventHandler<(string From, string To)>? FeatureReordered;
        /// <summary>Fires whenever link mode is entered, cancelled, or resolved by picking a blocker.</summary>
        public event EventHandler? LinkModeChanged;
        /// <summary>Fires when link mode resolves a real edge pick — <c>WasNew</c> is
        /// <see cref="ChainRules.Push"/>'s own return (false when the pair was already wired), so
        /// #2479's inspector can show the same "already blocked_by" vs. "is now blocked_by" note the
        /// reference distinguishes.</summary>
        public event EventHandler<(int From, int To, bool WasNew)>? EdgeLinked;

        /// <summary>Enter "Add blocker…" link mode for <paramref name="targetIssueNum"/> (README:
        /// "click any other issue node" adds `{from: clicked, to: selected, kind:'manual'}`).</summary>
        public void EnterLinkMode(int targetIssueNum)
        {
            if (_linkModeTarget == targetIssueNum) return;
            _linkModeTarget = targetIssueNum;
            if (Stage != null) Stage.Cursor = Cursors.Cross;
            LinkModeChanged?.Invoke(this, EventArgs.Empty);
        }

        public void CancelLinkMode()
        {
            if (_linkModeTarget == null) return;
            _linkModeTarget = null;
            if (Stage != null) Stage.Cursor = Cursors.Arrow;
            LinkModeChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Routes a click on an issue/sentinel node: while link mode is active, a click on
        /// any node other than the link target adds a real `manual` blocked_by edge (README: "click
        /// any other issue node"; duplicates are ignored by <see cref="ChainRules.Push"/>) and exits
        /// link mode, re-selecting the target so its BLOCKED BY list refreshes. Clicking the target
        /// itself is a no-op ("not-allowed"). Outside link mode this is a plain node select.</summary>
        private void OnNodeClicked(int num)
        {
            if (_linkModeTarget is int target)
            {
                if (num == target || _doc == null) return;
                bool wasNew = ChainRules.Push(_doc, new ChainEdge { From = num, To = target, Kind = ChainEdgeKind.Manual });
                _linkModeTarget = null;
                if (Stage != null) Stage.Cursor = Cursors.Arrow;
                LinkModeChanged?.Invoke(this, EventArgs.Empty);
                SelectIssue(target);
                EdgeLinked?.Invoke(this, (num, target, wasNew));
                return;
            }
            SelectIssue(num);
        }

        /// <summary>Runs the modal WPF drag loop for a Feature header, showing the source at .45
        /// opacity for its duration (the prototype's `opacity: drag === fid ? .45 : 1`). The drop
        /// itself lands on another header's <c>Drop</c> handler, which raises
        /// <see cref="FeatureReordered"/>; a drop on empty canvas just cancels (opacity restored in
        /// the finally). The dragged Feature id travels as the drag payload.</summary>
        private void BeginHeaderDrag(FrameworkElement card, string featureId)
        {
            double prev = card.Opacity;
            card.Opacity = 0.45;
            try
            {
                DragDrop.DoDragDrop(card, featureId, DragDropEffects.Move);
            }
            finally
            {
                card.Opacity = prev;
                _headerDragging = false;
                _pressedHeaderId = null;
            }
        }

        /// <summary>Set (or replace) the real ChainDoc and render. Derived state is recomputed via
        /// <see cref="ChainRules.Derive"/> on every render, same as the prototype.</summary>
        public void SetDocument(ChainDoc doc)
        {
            _doc = doc;
            _expanded.RemoveWhere(id => doc.Features.All(f => f.Id != id));
            if (_selectedFeatureId != null && doc.Features.All(f => f.Id != _selectedFeatureId)) _selectedFeatureId = null;
            if (_selectedIssue != null && ChainRules.FindIssue(doc, _selectedIssue.Value) == null) _selectedIssue = null;
            if (_selectedEdgePairs != null && !_selectedEdgePairs.Any(p => doc.Edges.Any(e => e.From == p.From && e.To == p.To)))
                ClearEdgeSelectionSilently();
            Render();
        }

        /// <summary>Re-derive and re-render from the current document (after #2480 mutates it).</summary>
        public void Rerender() => Render();

        public void ExpandAll()
        {
            if (_doc == null) return;
            foreach (var f in _doc.Features) _expanded.Add(f.Id);
            Render();
        }

        public void CollapseAll()
        {
            _expanded.Clear();
            Render();
        }

        public void ToggleFeature(string featureId)
        {
            if (!_expanded.Remove(featureId)) _expanded.Add(featureId);
            Render();
        }

        public void SelectIssue(int num, bool ensureExpanded = false)
        {
            if (_doc == null || _derived == null) return;
            if (ensureExpanded && _derived.FeatureOf.TryGetValue(num, out var f)) _expanded.Add(f.Id);
            _selectedIssue = num;
            _selectedFeatureId = null;
            ClearEdgeSelectionSilently(); // mutual exclusivity — selecting a node deselects any edge (#2478)
            Render();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        public void SelectFeature(string featureId)
        {
            _selectedFeatureId = featureId;
            _selectedIssue = null;
            ClearEdgeSelectionSilently();
            Render();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        public void ClearSelection()
        {
            bool hadLinkMode = _linkModeTarget != null;
            if (_selectedIssue == null && _selectedFeatureId == null && _selectedEdgePairs == null && !hadLinkMode) return;
            _selectedIssue = null;
            _selectedFeatureId = null;
            _linkModeTarget = null;
            if (hadLinkMode && Stage != null) Stage.Cursor = Cursors.Arrow;
            ClearEdgeSelectionSilently();
            Render();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
            if (hadLinkMode) LinkModeChanged?.Invoke(this, EventArgs.Empty);
        }

        public void ZoomIn() => SetZoom(_zoom + ChainLayout.ZoomStep);
        public void ZoomOut() => SetZoom(_zoom - ChainLayout.ZoomStep);

        public void SetZoom(double zoom)
        {
            double clamped = ChainLayout.ClampZoom(zoom);
            if (Math.Abs(clamped - _zoom) < 0.001) return;
            _zoom = clamped;
            StageScale.ScaleX = _zoom;
            StageScale.ScaleY = _zoom;
            ZoomChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Fit = min(1, (viewportWidth − 16) / W), floored at 0.35 (README).</summary>
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
            SetZoom(_zoom + (e.Delta > 0 ? ChainLayout.ZoomStep : -ChainLayout.ZoomStep));
            e.Handled = true;
        }

        // ---- render ----

        private void Render()
        {
            RailLayer.Children.Clear();
            NodeLayer.Children.Clear();
            EdgeLayerHost.Children.Clear();
            _edgeGroups.Clear();
            _edgeVisuals.Clear();

            if (_doc == null)
            {
                _derived = null;
                _layout = null;
                Stage.Width = 0;
                Stage.Height = 0;
                return;
            }

            _derived = ChainRules.Derive(_doc);
            _layout = ChainLayout.Compute(_doc, _expanded);

            Stage.Width = _layout.W;
            Stage.Height = _layout.H;

            RenderEpicTreeRail(_doc, _layout);
            RenderEdgeLayer(_doc, _derived, _layout); // #2478 — under the nodes, per README layer order
            RenderEpicCard(_doc, _derived, _layout);
            RenderGatePills(_doc, _layout);

            var blockersOfSel = _selectedIssue is int si && _derived.IncomingEdges.TryGetValue(si, out var inc)
                ? new HashSet<int>(inc.Select(e => e.From)) : new HashSet<int>();
            var dependentsOfSel = _selectedIssue is int so && _derived.OutgoingEdges.TryGetValue(so, out var outg)
                ? new HashSet<int>(outg.Select(e => e.To)) : new HashSet<int>();

            for (int k = 0; k < _doc.Order.Count; k++)
            {
                var feature = ChainRules.FindFeature(_doc, _doc.Order[k]);
                if (feature == null || !_layout.Head.TryGetValue(feature.Id, out var head)) continue;

                RenderFeatureHeader(_doc, _derived, feature, head, k);

                if (!_expanded.Contains(feature.Id)) continue;
                foreach (var issue in feature.Issues)
                {
                    if (!_layout.Node.TryGetValue(issue.Num, out var rect)) continue;
                    if (rect.Kind == ChainNodeKind.Sentinel)
                        RenderSentinelCard(_derived, issue, rect, blockersOfSel, dependentsOfSel);
                    else
                        RenderIssueRow(_derived, issue, rect, blockersOfSel, dependentsOfSel);
                }
            }

            Rendered?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Epic tree connectors: from the Epic card's right-middle, horizontal to
        /// `padL + epicW + epicGap/2`, up to railY, across to the last column, with a vertical drop
        /// into each header at `header.x + 28` (stroke #2a323d, 1px).</summary>
        private void RenderEpicTreeRail(ChainDoc doc, ChainLayoutResult layout)
        {
            var cols = doc.Order
                .Where(fid => layout.Head.ContainsKey(fid))
                .Select(fid => layout.Head[fid].X + 28)
                .ToList();
            if (cols.Count == 0) return;

            double ex = ChainLayout.PadL + ChainLayout.EpicW;
            double ey = ChainLayout.Top + ChainLayout.HeadH / 2;
            double tx = ChainLayout.PadL + ChainLayout.EpicW + ChainLayout.EpicGap / 2;

            var d = new StringBuilder();
            d.Append(Inv("M{0} {1} H{2} V{3} H{4}", ex, ey, tx, ChainLayout.RailY, cols[^1]));
            foreach (var cx in cols)
                d.Append(Inv(" M{0} {1} V{2}", cx, ChainLayout.RailY, ChainLayout.Top));

            RailLayer.Children.Add(new Path
            {
                Data = Geometry.Parse(d.ToString()),
                Stroke = RailStroke,
                StrokeThickness = 1,
            });
        }

        /// <summary>Epic card — 148×94 at (padL, top). Border #2e3742, or #21262d while something
        /// else is selected. Click clears the selection.</summary>
        private void RenderEpicCard(ChainDoc doc, ChainDerived derived, ChainLayoutResult layout)
        {
            bool somethingSelected = _selectedIssue != null || _selectedFeatureId != null;

            var content = SpaceBetweenColumn(
                HStack(6,
                    IconTile("layers", 20, 5, BlueFill, BlueSoft, 11),
                    Eyebrow("EPIC", 8.5, BlueSoft),
                    Spacer(),
                    MonoText("#" + doc.Epic.Num, 9, TextFaint)),
                Text(doc.Epic.Name, 12.5, FontWeights.ExtraBold, TextHi, wrap: true),
                Text($"{doc.Features.Count} Features · {derived.Totals.Issues} issues · {doc.Edges.Count} blocked_by edges",
                    9.5, FontWeights.Normal, TextDim, wrap: true));

            var card = Card(ChainLayout.EpicW, ChainLayout.HeadH,
                fill: PanelBg,
                stroke: somethingSelected ? Border2 : Border3,
                radius: 7, padding: new Thickness(10, 9, 10, 9), content: content);
            card.ToolTip = "Epic — a container for scope. Closes when its children close.";
            card.Cursor = Cursors.Hand;
            card.MouseLeftButtonDown += (_, e) => { ClearSelection(); e.Handled = true; };

            Place(card, ChainLayout.PadL, ChainLayout.Top);
        }

        /// <summary>Feature header — 204×94 collapsed / 412×94 expanded. Click toggles expansion
        /// and selects the Feature (README "Interactions": collapse-until-selected).</summary>
        private void RenderFeatureHeader(ChainDoc doc, ChainDerived derived, ChainFeature feature, ChainRect head, int k)
        {
            bool expanded = _expanded.Contains(feature.Id);
            bool selected = _selectedFeatureId == feature.Id;
            var summary = derived.FeatureSummary[feature.Id];
            var (stateText, stateColor) = FeatureStateText(doc, feature, summary, k);

            // Stacked state bar: flex-grow segments in ready/waiting/done/held/ask order.
            var segs = new (int Count, Brush Fill)[]
            {
                (summary.Ready, Green), (summary.Blocked, Blue), (summary.Done, GreenDark),
                (summary.Held, HeldSeg), (summary.Ask, VioletDim),
            }.Where(s => s.Count > 0).ToList();

            var bar = new Grid { Height = 4, VerticalAlignment = VerticalAlignment.Center };
            foreach (var (count, fill) in segs)
            {
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(count, GridUnitType.Star) });
                var seg = new Rectangle { Fill = fill };
                Grid.SetColumn(seg, bar.ColumnDefinitions.Count - 1);
                bar.Children.Add(seg);
            }
            var barBox = new Border
            {
                Height = 6,
                CornerRadius = new CornerRadius(99),
                Background = BarTrack,
                BorderBrush = Border1,
                BorderThickness = new Thickness(1),
                Child = bar,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var barRow = new Grid();
            barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(barBox, 0);
            barRow.Children.Add(barBox);
            var countText = MonoText(feature.Issues.Count + " issues", 9, TextDim, FontWeights.Bold);
            countText.Margin = new Thickness(7, 0, 0, 0);
            Grid.SetColumn(countText, 1);
            barRow.Children.Add(countText);

            var sentinelRow = new Grid();
            sentinelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            sentinelRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var sentinelText = MonoText("sentinel #" + (feature.Sentinel?.ToString() ?? "—"), 9, TextFaint);
            sentinelRow.Children.Add(sentinelText);
            var stateTextBlock = Text(stateText, 9, FontWeights.Bold, stateColor);
            stateTextBlock.TextTrimming = TextTrimming.CharacterEllipsis;
            stateTextBlock.TextAlignment = TextAlignment.Right;
            stateTextBlock.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetColumn(stateTextBlock, 1);
            sentinelRow.Children.Add(stateTextBlock);

            var name = Text(feature.Name, 12, FontWeights.ExtraBold, TextHi);
            name.TextTrimming = TextTrimming.CharacterEllipsis;
            name.TextWrapping = TextWrapping.NoWrap;

            var content = SpaceBetweenColumn(
                HStack(6,
                    Badge("P" + (k + 1), BlueFill, BlueLight),
                    Eyebrow("FEATURE", 8.5, TextFaint),
                    Spacer(),
                    MonoText("#" + feature.Num, 9, TextFaint),
                    Icon(expanded ? "chevron-up" : "chevron-down", 12, TextFaint)),
                name,
                barRow,
                sentinelRow);

            var card = Card(head.W, head.H,
                fill: PanelBg,
                stroke: selected ? BlueSoft : expanded ? Border3 : Border2,
                radius: 7, padding: new Thickness(10, 9, 10, 9), content: content,
                ring: selected ? BlueSoft : null);
            card.ToolTip = $"Feature: {feature.Name} · #{feature.Num}\nClick to {(expanded ? "collapse" : "open its issues")}. Drag to change priority.";
            card.Cursor = Cursors.Hand;
            card.AllowDrop = true;
            string fid = feature.Id;

            // Press records the intent; the actual toggle+select happens on mouse-up only if no drag
            // occurred (README: a click toggles+selects, a drag reorders — they must not both fire).
            card.MouseLeftButtonDown += (_, e) =>
            {
                e.Handled = true;
                _headerPressPoint = e.GetPosition(this);
                _pressedHeaderId = fid;
                _headerDragging = false;
            };
            card.MouseMove += (_, e) =>
            {
                if (e.LeftButton != MouseButtonState.Pressed || _pressedHeaderId != fid || _headerDragging) return;
                var p = e.GetPosition(this);
                if (Math.Abs(p.X - _headerPressPoint.X) < SystemParameters.MinimumHorizontalDragDistance
                    && Math.Abs(p.Y - _headerPressPoint.Y) < SystemParameters.MinimumVerticalDragDistance) return;
                _headerDragging = true;
                BeginHeaderDrag(card, fid);
            };
            card.MouseLeftButtonUp += (_, e) =>
            {
                bool wasClick = _pressedHeaderId == fid && !_headerDragging;
                _pressedHeaderId = null;
                _headerDragging = false;
                if (!wasClick) return;
                e.Handled = true;
                if (!_expanded.Remove(fid)) _expanded.Add(fid);
                _selectedFeatureId = fid;
                _selectedIssue = null;
                ClearEdgeSelectionSilently();
                Render();
                SelectionChanged?.Invoke(this, EventArgs.Empty);
            };
            card.DragOver += (_, e) =>
            {
                e.Effects = e.Data.GetDataPresent(DataFormats.StringFormat) ? DragDropEffects.Move : DragDropEffects.None;
                e.Handled = true;
            };
            card.Drop += (_, e) =>
            {
                e.Handled = true;
                if (e.Data.GetData(DataFormats.StringFormat) is string fromId && fromId != fid)
                    FeatureReordered?.Invoke(this, (fromId, fid));
            };

            Place(card, head.X, head.Y);
        }

        /// <summary>Issue row — 212×26. Dot · #num · title · state tag; fills/borders per state and
        /// per selection emphasis (selected / blocker-of-selection / blocked-by-selection).</summary>
        private void RenderIssueRow(ChainDerived derived, ChainIssue issue, ChainRect rect,
            HashSet<int> blockersOfSel, HashSet<int> dependentsOfSel)
        {
            var state = derived.State[issue.Num];
            bool selected = _selectedIssue == issue.Num;
            bool isBlocker = blockersOfSel.Contains(issue.Num);
            bool isDependent = dependentsOfSel.Contains(issue.Num);

            Brush stroke = selected ? BlueSoft
                : isBlocker ? Amber
                : isDependent ? Blue
                : state switch
                {
                    ChainNodeState.Ready => GreenBorder,
                    ChainNodeState.Held => Border3,
                    ChainNodeState.Ask => VioletBorder,
                    _ => Border1,
                };
            bool dashed = state == ChainNodeState.Held && !selected && !isBlocker && !isDependent;
            Brush fill = selected ? SelectedFill : state == ChainNodeState.Done ? DoneFill : CardBg;
            Brush titleColor = state == ChainNodeState.Done ? TextFaint
                : state == ChainNodeState.Blocked ? TextMid : TextHi;
            string tag = state == ChainNodeState.Blocked
                ? derived.OpenBlockers[issue.Num].ToString()
                : StateTagLabel(state);

            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var dot = StateDot(state, 7);
            dot.VerticalAlignment = VerticalAlignment.Center;
            row.Children.Add(dot);

            var num = MonoText("#" + issue.Num, 9, TextFaint);
            num.Margin = new Thickness(6, 0, 0, 0);
            num.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(num, 1);
            row.Children.Add(num);

            var title = Text(issue.Title, 10.5, FontWeights.SemiBold, titleColor);
            title.TextTrimming = TextTrimming.CharacterEllipsis;
            title.Margin = new Thickness(6, 0, 6, 0);
            title.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(title, 2);
            row.Children.Add(title);

            var tagText = MonoText(tag.ToUpperInvariant(), 8.5, StateTagBrush(state), FontWeights.ExtraBold);
            tagText.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(tagText, 3);
            row.Children.Add(tagText);

            var card = Card(rect.W, rect.H, fill, stroke, radius: 5, padding: new Thickness(8, 0, 8, 0),
                content: row,
                ring: selected ? BlueSoft : isBlocker ? AmberRing : null,
                dashedStroke: dashed);
            card.ToolTip = $"#{issue.Num} {issue.Title}\n{StatusLabel(issue.Status)} · {StateDescription(state)}";
            card.Cursor = _linkModeTarget != null && _linkModeTarget != issue.Num ? Cursors.Cross : Cursors.Hand;
            int numCopy = issue.Num;
            card.MouseLeftButtonDown += (_, e) => { e.Handled = true; OnNodeClicked(numCopy); };

            Place(card, rect.X, rect.Y);
        }

        /// <summary>Sentinel card — 160×66, `target` icon + SENTINEL eyebrow + #num / title /
        /// `fan-in {done}/{total}` + state tag.</summary>
        private void RenderSentinelCard(ChainDerived derived, ChainIssue issue, ChainRect rect,
            HashSet<int> blockersOfSel, HashSet<int> dependentsOfSel)
        {
            var state = derived.State[issue.Num];
            bool selected = _selectedIssue == issue.Num;
            bool isBlocker = blockersOfSel.Contains(issue.Num);
            bool isDependent = dependentsOfSel.Contains(issue.Num);

            var fanIn = derived.IncomingEdges.TryGetValue(issue.Num, out var inc)
                ? inc.Where(e => e.Kind == ChainEdgeKind.FanIn).ToList() : new List<ChainEdge>();
            int fanDone = fanIn.Count(e => derived.ByNum.TryGetValue(e.From, out var blocker) && blocker.Status == ChainStatus.Done);

            Brush stroke = selected ? BlueSoft : isBlocker ? Amber : isDependent ? BlueSoft : BlueBorder;
            Brush titleColor = state == ChainNodeState.Done ? TextFaint
                : state == ChainNodeState.Blocked ? TextMid : TextHi;
            string tag = state == ChainNodeState.Blocked
                ? derived.OpenBlockers[issue.Num].ToString()
                : StateTagLabel(state);

            var fanRow = new Grid();
            fanRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            fanRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            fanRow.Children.Add(MonoText($"fan-in {fanDone}/{fanIn.Count}", 9, TextDim));
            var fanTag = MonoText(tag.ToUpperInvariant(), 9, StateTagBrush(state), FontWeights.ExtraBold);
            fanTag.TextAlignment = TextAlignment.Right;
            fanTag.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetColumn(fanTag, 1);
            fanRow.Children.Add(fanTag);

            var title = Text(issue.Title, 10.5, FontWeights.Bold, titleColor);
            title.TextTrimming = TextTrimming.CharacterEllipsis;

            var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var headerRow = HStack(5,
                Icon("target", 10, BlueSoft),
                Eyebrow("SENTINEL", 8, BlueSoft),
                Spacer(),
                MonoText("#" + issue.Num, 9, TextFaint));
            headerRow.Margin = new Thickness(0, 0, 0, 4);
            title.Margin = new Thickness(0, 0, 0, 4);
            stack.Children.Add(headerRow);
            stack.Children.Add(title);
            stack.Children.Add(fanRow);

            var card = Card(rect.W, rect.H,
                fill: selected ? SelectedFill : SentinelBg,
                stroke: stroke, radius: 6, padding: new Thickness(9, 7, 9, 7), content: stack,
                ring: selected ? BlueSoft : isBlocker ? AmberRing : null);
            card.ToolTip = $"#{issue.Num} {issue.Title}\n{StatusLabel(issue.Status)} · {StateDescription(state)}";
            card.Cursor = _linkModeTarget != null && _linkModeTarget != issue.Num ? Cursors.Cross : Cursors.Hand;
            int numCopy = issue.Num;
            card.MouseLeftButtonDown += (_, e) => { e.Handled = true; OnNodeClicked(numCopy); };

            Place(card, rect.X, rect.Y);
        }

        /// <summary>Gate pills — 80×20, centered in every gutter at header mid-height; a manual
        /// gate also drops a dashed amber line down the whole gutter from railY to H − 24.
        /// Click raises <see cref="GatePillClicked"/> (the toggle itself is #2480).</summary>
        private void RenderGatePills(ChainDoc doc, ChainLayoutResult layout)
        {
            for (int k = 1; k < doc.Order.Count; k++)
            {
                var prev = ChainRules.FindFeature(doc, doc.Order[k - 1]);
                var feature = ChainRules.FindFeature(doc, doc.Order[k]);
                if (prev == null || feature == null || !layout.Head.TryGetValue(prev.Id, out var prevHead)) continue;

                double gx = prevHead.X + prevHead.W + ChainLayout.Gutter / 2;
                bool manual = doc.Gates.TryGetValue(feature.Id, out var g) && g;

                if (manual)
                {
                    var line = new Line
                    {
                        X1 = gx, Y1 = ChainLayout.RailY,
                        X2 = gx, Y2 = layout.H - 24,
                        Stroke = AmberLine,
                        StrokeThickness = 1,
                        StrokeDashArray = new DoubleCollection { 3, 3 },
                    };
                    NodeLayer.Children.Add(line);
                }

                var label = MonoText(manual ? "MANUAL GATE" : "AUTO", 8,
                    manual ? Amber : TextFaint, FontWeights.ExtraBold);
                label.Margin = new Thickness(4, 0, 0, 0);
                label.VerticalAlignment = VerticalAlignment.Center;

                var inner = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                };
                inner.Children.Add(Icon(manual ? "pause" : "zap", 10, manual ? Amber : TextFaint));
                inner.Children.Add(label);

                var pill = new Border
                {
                    Width = 80,
                    Height = 20,
                    CornerRadius = new CornerRadius(99),
                    Background = manual ? AmberBg : PanelBg,
                    BorderBrush = manual ? AmberBorder : Border2,
                    BorderThickness = new Thickness(1),
                    Child = inner,
                    Cursor = Cursors.Hand,
                    ToolTip = manual
                        ? $"Manual cutover: {feature.Name} stays in Backlog until Shane confirms {prev.Name}. Click to make it automatic."
                        : $"Automatic: {feature.Name} launches when #{prev.Sentinel} posts its DONE bookend. Click to make this a manual gate.",
                };
                string fidCopy = feature.Id;
                pill.MouseLeftButtonDown += (_, e) => { e.Handled = true; GatePillClicked?.Invoke(this, fidCopy); };

                Place(pill, gx - 40, ChainLayout.Top + ChainLayout.HeadH / 2 - 10);
            }
        }

        // ---- copy/state helpers (ported verbatim from the prototype) ----

        /// <summary>Header state text, priority order, first match wins (README "Feature state text").</summary>
        private static (string Text, Brush Color) FeatureStateText(ChainDoc doc, ChainFeature feature, ChainFeatureSummary c, int k)
        {
            var prev = k > 0 ? ChainRules.FindFeature(doc, doc.Order[k - 1]) : null;
            string askTail = c.Ask > 0 ? $" · {c.Ask} ask" : "";
            if (c.Done == feature.Issues.Count && feature.Issues.Count > 0) return ("complete", GreenDim);
            if (c.Ready > 0) return ($"{c.Ready} ready now{askTail}", Green);
            if (c.Blocked > 0) return ($"{c.Blocked} waiting{(prev?.Sentinel != null ? " on #" + prev.Sentinel : "")}{askTail}", BlueSoft);
            if (c.Held > 0)
            {
                bool gated = doc.Gates.TryGetValue(feature.Id, out var g) && g;
                return ($"{c.Held} held{(gated ? " · manual gate" : "")}{askTail}", TextDim);
            }
            if (c.Ask > 0) return ($"{c.Ask} ask Shane", Violet);
            return ("no issues", TextFaint);
        }

        private static string StateTagLabel(ChainNodeState state) => state switch
        {
            ChainNodeState.Ready => "ready",
            ChainNodeState.Blocked => "waits",
            ChainNodeState.Held => "held",
            ChainNodeState.Ask => "ask",
            _ => "done",
        };

        private static Brush StateTagBrush(ChainNodeState state) => state switch
        {
            ChainNodeState.Ready => Green,
            ChainNodeState.Blocked => BlueSoft,
            ChainNodeState.Held => TextDim,
            ChainNodeState.Ask => Violet,
            _ => GreenDim,
        };

        private static string StateDescription(ChainNodeState state) => state switch
        {
            ChainNodeState.Ready => "Batter Up with no open blockers. Launches on the next refresh.",
            ChainNodeState.Blocked => "Batter Up, waiting on blocked_by edges to clear. The number is how many.",
            ChainNodeState.Held => "Backlog. A human moves it, even after its edges clear.",
            ChainNodeState.Ask => "Ask Shane. An open question with no build attached; outside the cascade.",
            _ => "Verified DONE bookend on origin/main.",
        };

        private static string StatusLabel(ChainStatus status) => status switch
        {
            ChainStatus.Batter => "Batter Up",
            ChainStatus.Backlog => "Backlog",
            ChainStatus.Ask => "Ask Shane",
            _ => "Done",
        };

        /// <summary>State dot per the README node-state table (dashed/solid ring vs. fill).</summary>
        private static Ellipse StateDot(ChainNodeState state, double size)
        {
            var dot = new Ellipse { Width = size, Height = size };
            switch (state)
            {
                case ChainNodeState.Ready:
                    dot.Fill = Green; break;
                case ChainNodeState.Blocked:
                    dot.Stroke = Blue; dot.StrokeThickness = 1.5; break;
                case ChainNodeState.Held:
                    dot.Stroke = HeldDot; dot.StrokeThickness = 1.5;
                    dot.StrokeDashArray = new DoubleCollection { 1.5, 1.5 }; break;
                case ChainNodeState.Ask:
                    dot.Fill = VioletDim; break;
                default:
                    dot.Fill = GreenDark; dot.Stroke = Green; dot.StrokeThickness = 1; break;
            }
            return dot;
        }

        // ---- element factory helpers ----

        /// <summary>A positioned card: rounded Rectangle box (dash-capable, unlike Border) + an
        /// optional −1px ring Rectangle (the prototype's `box-shadow: 0 0 0 1px`) + padded content.</summary>
        private static Grid Card(double w, double h, Brush fill, Brush stroke, double radius,
            Thickness padding, FrameworkElement content, Brush? ring = null, bool dashedStroke = false)
        {
            var grid = new Grid { Width = w, Height = h, Background = Brushes.Transparent };

            var box = new Rectangle
            {
                RadiusX = radius, RadiusY = radius,
                Fill = fill, Stroke = stroke, StrokeThickness = 1,
            };
            if (dashedStroke) box.StrokeDashArray = new DoubleCollection { 3, 2 };
            grid.Children.Add(box);

            if (ring != null)
            {
                var ringRect = new Rectangle
                {
                    RadiusX = radius + 1, RadiusY = radius + 1,
                    Stroke = ring, StrokeThickness = 1,
                    Margin = new Thickness(-1),
                    IsHitTestVisible = false,
                };
                grid.Children.Add(ringRect);
            }

            content.Margin = padding;
            grid.Children.Add(content);
            return grid;
        }

        /// <summary>CSS `justify-content: space-between` column: items in Auto rows with Star
        /// spacer rows between them.</summary>
        private static Grid SpaceBetweenColumn(params FrameworkElement[] items)
        {
            var grid = new Grid();
            for (int i = 0; i < items.Length; i++)
            {
                if (i > 0)
                    grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                Grid.SetRow(items[i], grid.RowDefinitions.Count - 1);
                grid.Children.Add(items[i]);
            }
            return grid;
        }

        /// <summary>Horizontal row with a fixed gap; a <see cref="Spacer"/> child takes the slack.</summary>
        private static Grid HStack(double gap, params FrameworkElement[] items)
        {
            var grid = new Grid();
            for (int i = 0; i < items.Length; i++)
            {
                bool isSpacer = items[i] is FrameworkElement { Tag: "spacer" };
                grid.ColumnDefinitions.Add(new ColumnDefinition
                {
                    Width = isSpacer ? new GridLength(1, GridUnitType.Star) : GridLength.Auto,
                });
                if (i > 0 && !isSpacer) items[i].Margin = new Thickness(gap, 0, 0, 0);
                items[i].VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(items[i], i);
                grid.Children.Add(items[i]);
            }
            return grid;
        }

        private static FrameworkElement Spacer() => new Border { Tag = "spacer" };

        private static TextBlock Text(string text, double size, FontWeight weight, Brush color, bool wrap = false)
        {
            return new TextBlock
            {
                Text = text,
                FontFamily = UiFont,
                FontSize = size,
                FontWeight = weight,
                Foreground = color,
                TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
            };
        }

        private static TextBlock MonoText(string text, double size, Brush color, FontWeight? weight = null)
        {
            var tb = Text(text, size, weight ?? FontWeights.Normal, color);
            tb.FontFamily = MonoFont;
            return tb;
        }

        private static TextBlock Eyebrow(string text, double size, Brush color)
        {
            // Uppercase 800-weight label; WPF TextBlock has no letter-spacing, the tracking is dropped.
            return Text(text.ToUpperInvariant(), size, FontWeights.ExtraBold, color);
        }

        private static Border Badge(string text, Brush bg, Brush fg)
        {
            var tb = MonoText(text, 8.5, fg, FontWeights.ExtraBold);
            return new Border
            {
                Background = bg,
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1, 5, 1),
                Child = tb,
            };
        }

        private static Border IconTile(string icon, double size, double radius, Brush bg, Brush fg, double iconSize)
        {
            return new Border
            {
                Width = size, Height = size,
                Background = bg,
                CornerRadius = new CornerRadius(radius),
                Child = Icon(icon, iconSize, fg),
            };
        }

        /// <summary>Lucide icon: 24×24 geometry in a Viewbox (stroke scales with size, like SVG viewBox).</summary>
        private static FrameworkElement Icon(string name, double size, Brush stroke)
        {
            var path = new Path
            {
                Data = Geometry.Parse(IconPaths[name]),
                Stroke = stroke,
                StrokeThickness = 2,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            };
            var canvas = new Canvas { Width = 24, Height = 24 };
            canvas.Children.Add(path);
            return new Viewbox
            {
                Width = size, Height = size,
                Child = canvas,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        private void Place(FrameworkElement element, double x, double y)
        {
            Canvas.SetLeft(element, x);
            Canvas.SetTop(element, y);
            NodeLayer.Children.Add(element);
        }

        private static string Inv(string format, params object[] args) =>
            string.Format(CultureInfo.InvariantCulture, format, args);

        private static SolidColorBrush Frozen(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }

        private static SolidColorBrush FrozenRgba(byte r, byte g, byte b, double a)
        {
            var brush = new SolidColorBrush(Color.FromArgb((byte)Math.Round(a * 255), r, g, b));
            brush.Freeze();
            return brush;
        }
    }
}
