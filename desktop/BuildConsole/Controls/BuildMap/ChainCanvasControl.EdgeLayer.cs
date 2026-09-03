using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using BuildConsole.Services.BuildMap;

namespace BuildConsole.Controls.BuildMap
{
    /// <summary>
    /// Git #2478 (Build Chain Map, item #4 of #2473's structured index) — the `blocked_by` edge
    /// layer, the WPF equivalent of `Build Chain Map.dc.html`'s SVG `buildEdgeLayer`/`edgeLook`.
    /// Draws into <see cref="ChainCanvasControl.EdgeLayer"/> (the <c>EdgeLayerHost</c> canvas #2477
    /// already placed under the node layer), positioned exclusively by
    /// <see cref="ChainLayout.OutPort"/>/<see cref="ChainLayout.InPort"/> against the same
    /// <see cref="ChainCanvasControl.Layout"/>/<see cref="ChainCanvasControl.Derived"/>/
    /// <see cref="ChainCanvasControl.ExpandedFeatures"/> #2477 already computes on every render —
    /// this partial adds no layout math of its own.
    ///
    /// Per README.md "Edges (SVG layer under the nodes)":
    ///  • Every real `blocked_by` edge draws blocker out-port → blocked in-port. A collapsed
    ///    Feature's issues share its header's port, so edges between the same two visual nodes
    ///    bundle into one path with a `×N` label — and an edge whose two ports collapse to the
    ///    *same* key (fan-in inside one still-collapsed Feature) is never drawn, exactly like the
    ///    reference's `a.key === b.key` guard.
    ///  • Path shape: `edgeStyle` orthogonal (default, two right-angle turns) or curved (cubic
    ///    Bézier, control offset clamped 36–110px) — see <see cref="ChainLayout.PathData"/>.
    ///  • A 6×6 filled arrowhead at the target end, colored per the same 7-color marker palette the
    ///    reference pre-registers as SVG `<marker>` defs (this port skips defs — each arrowhead is
    ///    just a small filled triangle built at render time, no reuse benefit in WPF).
    ///  • The exact stroke/width/opacity/dash table per edge kind, `dimUnrelated` selection-emphasis
    ///    dimming, and hover (invisible 10px-wide hit path; opacity/width bump; the reference's own
    ///    CSS `transition: stroke-opacity .15s` — the only two properties it actually transitions,
    ///    and hover never changes color, so a 150ms <see cref="DoubleAnimation"/> on the visible
    ///    path's <see cref="UIElement.Opacity"/> is a faithful, not approximate, port).
    /// </summary>
    public partial class ChainCanvasControl
    {
        // ---- edge-look palette (README "Edges" table + the reference's `MARK`) ----
        // Same hex values as the node layer's own brushes above in this partial class (Blue,
        // BlueSoft, Amber, ...) — built via the shared `Frozen` helper directly rather than
        // referencing those fields, since static field initializers referencing another field
        // declared in a *different* file of the same partial class have compiler-undefined
        // cross-file ordering (harmless in practice here, since none of these have side effects,
        // but the direct call avoids the nullable-analysis false positive it otherwise produces).
        private static readonly Brush EdgeFanIn = Frozen("#4d7aa8");
        private static readonly Brush EdgeGate = Frozen("#6a8fb5");
        private static readonly Brush EdgeManualGate = Frozen("#e0a879");
        private static readonly Brush EdgeManual = Frozen("#a374ea");
        private static readonly Brush EdgeDone = Frozen("#7fb08a");
        private static readonly Brush EdgeSelectedOut = Frozen("#9fc0dd");  // "out of selected issue"
        private static readonly Brush EdgeSelectedWhite = Frozen("#e6edf3"); // edge-selected / "sel"
        private static readonly Brush EdgeDim = Frozen("#2a323d");         // the reference's unused "dim" marker id
        private static readonly Brush EdgeHalo = Frozen("#0a0d12");        // bundle-label halo

        /// <summary>The 7 marker ids the reference pre-registers (`this.MARK`), each with a fixed
        /// solid fill independent of the path's own stroke-opacity — an arrowhead is always fully
        /// opaque in its marker color, even while its path is faded (dimmed/fan-in/done). A path's
        /// `MarkerKey` can name a marker whose color differs from the path's own stroke (e.g. the
        /// "out of selected issue" case: stroke `#9fc0dd`, marker reuses the pre-existing `white`
        /// def) — ported verbatim, not "fixed", since the reference is the high-fidelity source.</summary>
        private static readonly Dictionary<string, Brush> EdgeMarkerBrush = new()
        {
            ["fanin"] = EdgeFanIn,
            ["blue"] = EdgeGate,
            ["amber"] = EdgeManualGate,
            ["violet"] = EdgeManual,
            ["green"] = EdgeDone,
            ["dim"] = EdgeDim,
            ["white"] = EdgeSelectedWhite,
        };

        private ChainEdgeStyle _edgeStyle = ChainEdgeStyle.Orthogonal;
        private bool _dimUnrelated = true;
        private bool _showFanIn = true;
        private HashSet<(int From, int To)>? _selectedEdgePairs;
        private string? _hoverEdgeKey;

        private readonly Dictionary<string, EdgeGroup> _edgeGroups = new();
        private readonly Dictionary<string, EdgeVisual> _edgeVisuals = new();

        // ---- public surface (README "Tweakable props") ----

        /// <summary>`edgeStyle`: `'orthogonal'` (default) | `'curved'`.</summary>
        public ChainEdgeStyle EdgeStyle
        {
            get => _edgeStyle;
            set { if (_edgeStyle == value) return; _edgeStyle = value; if (_doc != null) Render(); }
        }

        /// <summary>`dimUnrelated` — fade edges unrelated to the current selection to low opacity.</summary>
        public bool DimUnrelated
        {
            get => _dimUnrelated;
            set { if (_dimUnrelated == value) return; _dimUnrelated = value; if (_doc != null) Render(); }
        }

        /// <summary>`showFanIn` — draw fan-in edges inside expanded Features.</summary>
        public bool ShowFanIn
        {
            get => _showFanIn;
            set { if (_showFanIn == value) return; _showFanIn = value; if (_doc != null) Render(); }
        }

        /// <summary>The currently-selected edge bundle's real `(from, to)` pairs, or null when no
        /// edge is selected. A 4th selection kind alongside issue/Feature (mutually exclusive with
        /// both — see <see cref="SelectIssue"/>/<see cref="SelectFeature"/>/<see cref="ClearSelection"/>).</summary>
        public IReadOnlySet<(int From, int To)>? SelectedEdgePairs => _selectedEdgePairs;

        /// <summary>Every real edge currently in the selected bundle (recomputed fresh from
        /// <see cref="Document"/> each call, so a stale pair from a since-removed edge is simply
        /// absent rather than throwing) — what #2479's inspector reads for the "Edge selected" view.</summary>
        public IReadOnlyList<ChainEdge> SelectedEdges =>
            _doc == null || _selectedEdgePairs == null
                ? Array.Empty<ChainEdge>()
                : _doc.Edges.Where(e => _selectedEdgePairs.Contains((e.From, e.To))).ToList();

        /// <summary>Fires whenever the edge selection changes (select, clear, or invalidated by a
        /// document update) — independent of <see cref="SelectionChanged"/>, which only covers
        /// issue/Feature selection, so #2479 can listen to just the one it needs.</summary>
        public event EventHandler? EdgeSelectionChanged;

        /// <summary>Select an edge bundle by its real `(from, to)` pairs. Clears any issue/Feature
        /// selection (mutual exclusivity — README's selection model is none | feature | issue | edge)
        /// and re-renders, since node emphasis (blocker/dependent borders) depends on that.</summary>
        public void SelectEdgeBundle(IEnumerable<(int From, int To)> pairs)
        {
            _selectedEdgePairs = new HashSet<(int, int)>(pairs);
            bool hadNodeSelection = _selectedIssue != null || _selectedFeatureId != null;
            _selectedIssue = null;
            _selectedFeatureId = null;
            Render();
            EdgeSelectionChanged?.Invoke(this, EventArgs.Empty);
            if (hadNodeSelection) SelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        public void ClearEdgeSelection()
        {
            if (_selectedEdgePairs == null) return;
            ClearEdgeSelectionSilently();
            Render();
            EdgeSelectionChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>Clears edge-selection state without rendering or raising an event — used by the
        /// node-selection methods above, which already render and raise <see cref="SelectionChanged"/>
        /// themselves right after.</summary>
        private void ClearEdgeSelectionSilently() => _selectedEdgePairs = null;

        // ---- render ----

        /// <summary>One bundled visual edge: the shared endpoints, and every real
        /// <see cref="ChainEdge"/> collapsed onto them (&gt;1 when the reference would draw a `×N`
        /// bundle label).</summary>
        private sealed class EdgeGroup
        {
            public ChainPort A { get; }
            public ChainPort B { get; }
            public List<ChainEdge> Edges { get; } = new();
            public EdgeGroup(ChainPort a, ChainPort b) { A = a; B = b; }
        }

        /// <summary>The live WPF elements for one group, kept so hover can animate opacity on the
        /// existing <see cref="Path"/> in place instead of tearing down/rebuilding the whole layer.</summary>
        private sealed class EdgeVisual
        {
            public required Path Visible { get; init; }
            public required Path Arrow { get; init; }
        }

        private readonly record struct EdgeLook(Brush Stroke, double Width, double Opacity, DoubleCollection? Dash, string MarkerKey);

        /// <summary>Rebuild the whole edge layer from the current document/derived-state/layout —
        /// called by <see cref="Render"/> on every relayout (document change, expand/collapse, edge
        /// mutation, selection change). Zoom does not call this: edges live in the same
        /// <c>Stage</c>/<c>EdgeLayerHost</c> canvas as the nodes, under the same
        /// <c>ScaleTransform</c>, so they scale for free.</summary>
        private void RenderEdgeLayer(ChainDoc doc, ChainDerived derived, ChainLayoutResult layout)
        {
            foreach (var edge in doc.Edges)
            {
                if (!_showFanIn && edge.Kind == ChainEdgeKind.FanIn) continue;

                var a = ChainLayout.OutPort(layout, derived, _expanded, edge.From);
                var b = ChainLayout.InPort(layout, derived, _expanded, edge.To);
                if (a == null || b == null || a.Key == b.Key) continue; // collapsed fan-in — not drawn

                string key = a.Key + ">" + b.Key;
                if (!_edgeGroups.TryGetValue(key, out var group))
                {
                    group = new EdgeGroup(a, b);
                    _edgeGroups[key] = group;
                }
                group.Edges.Add(edge);
            }

            foreach (var (key, group) in _edgeGroups)
            {
                var look = EdgeLookFor(group, doc, derived, key);
                string pathData = ChainLayout.PathData(group.A, group.B, _edgeStyle);
                var geometry = Geometry.Parse(pathData);
                geometry.Freeze();

                var visible = new Path
                {
                    Data = geometry,
                    Stroke = look.Stroke,
                    StrokeThickness = look.Width,
                    StrokeDashArray = look.Dash,
                    Fill = null,
                    Opacity = look.Opacity,
                    IsHitTestVisible = false,
                };
                EdgeLayerHost.Children.Add(visible);

                var arrow = BuildArrowMarker(group.A, group.B, _edgeStyle, EdgeMarkerBrush[look.MarkerKey]);
                EdgeLayerHost.Children.Add(arrow);

                // Invisible 10px-wide hit path (README "Hit area is an invisible 10px-wide twin
                // path") — Transparent (not null) so WPF still hit-tests it, same trick this
                // control's own Card() helper already uses for its background Grid.
                var hit = new Path
                {
                    Data = geometry,
                    Stroke = Brushes.Transparent,
                    StrokeThickness = 10,
                    Fill = null,
                    Cursor = Cursors.Hand,
                    ToolTip = EdgeTooltip(group, doc),
                };
                string keyCopy = key;
                var pairsCopy = group.Edges.Select(e => (e.From, e.To)).ToList();
                hit.MouseEnter += (_, __) => SetHoverEdge(keyCopy);
                hit.MouseLeave += (_, __) => { if (_hoverEdgeKey == keyCopy) SetHoverEdge(null); };
                hit.MouseLeftButtonDown += (_, e) => { e.Handled = true; SelectEdgeBundle(pairsCopy); };
                EdgeLayerHost.Children.Add(hit);

                _edgeVisuals[key] = new EdgeVisual { Visible = visible, Arrow = arrow };

                if (group.Edges.Count > 1)
                    EdgeLayerHost.Children.Add(BuildBundleLabel(group.A, group.B, group.Edges.Count, look));
            }
        }

        /// <summary>Hover in/out on an edge's hit path — updates just that group's existing
        /// <see cref="Path"/> in place (opacity animated 150ms per README "Transitions:
        /// stroke, stroke-opacity 150ms"; width/color/dash snap instantly, matching that the
        /// reference's CSS `transition` list only ever names `stroke`/`stroke-opacity`, and hover
        /// itself never changes color anyway — only width and opacity).</summary>
        private void SetHoverEdge(string? key)
        {
            if (_hoverEdgeKey == key) return;
            string? prev = _hoverEdgeKey;
            _hoverEdgeKey = key;
            if (prev != null) ApplyEdgeLook(prev);
            if (key != null) ApplyEdgeLook(key);
        }

        private void ApplyEdgeLook(string key)
        {
            if (_doc == null || _derived == null) return;
            if (!_edgeGroups.TryGetValue(key, out var group) || !_edgeVisuals.TryGetValue(key, out var visual)) return;

            var look = EdgeLookFor(group, _doc, _derived, key);
            visual.Visible.StrokeThickness = look.Width;
            visual.Visible.StrokeDashArray = look.Dash;
            visual.Visible.Stroke = look.Stroke;
            visual.Arrow.Fill = EdgeMarkerBrush[look.MarkerKey];

            var anim = new DoubleAnimation(visual.Visible.Opacity, look.Opacity, TimeSpan.FromMilliseconds(150));
            visual.Visible.BeginAnimation(UIElement.OpacityProperty, anim);
        }

        /// <summary>The C# port of the reference's `edgeLook(g, ctx)` — exact stroke/width/opacity/
        /// dash per edge kind (README table), then the "blocker already DONE" override, then
        /// selection-emphasis, then hover last (hover always wins on opacity/width, never color).</summary>
        private EdgeLook EdgeLookFor(EdgeGroup group, ChainDoc doc, ChainDerived derived, string key)
        {
            var e0 = group.Edges[0];
            derived.ByNum.TryGetValue(e0.From, out var fromIssue);
            derived.FeatureOf.TryGetValue(e0.To, out var toFeature);
            bool manualGate = e0.Kind == ChainEdgeKind.Gate && toFeature != null
                && doc.Gates.TryGetValue(toFeature.Id, out var gated) && gated;

            Brush stroke;
            double opacity;
            double width = 1.1;
            DoubleCollection? dash = null;
            string markerKey;

            switch (e0.Kind)
            {
                case ChainEdgeKind.FanIn:
                    stroke = EdgeFanIn; opacity = .5; markerKey = "fanin";
                    break;
                case ChainEdgeKind.Gate when manualGate:
                    stroke = EdgeManualGate; opacity = .7; dash = new DoubleCollection { 4, 3 }; markerKey = "amber";
                    break;
                case ChainEdgeKind.Gate:
                    stroke = EdgeGate; opacity = .6; markerKey = "blue";
                    break;
                default:
                    stroke = EdgeManual; opacity = .75; markerKey = "violet";
                    break;
            }

            if (fromIssue != null && fromIssue.Status == ChainStatus.Done)
            {
                stroke = EdgeDone; opacity = .4; markerKey = "green";
            }

            if (_selectedIssue is int selIssue)
            {
                bool into = group.Edges.Any(e => e.To == selIssue);
                bool outOf = !into && group.Edges.Any(e => e.From == selIssue);
                if (into) { stroke = EdgeManualGate /* amber */; opacity = 1; width = 1.8; markerKey = "amber"; }
                else if (outOf) { stroke = EdgeSelectedOut; opacity = .95; width = 1.6; markerKey = "white"; }
                else if (_dimUnrelated) opacity = .1;
            }
            else if (_selectedFeatureId is string selFeatureId)
            {
                var feature = ChainRules.FindFeature(doc, selFeatureId);
                var issueNums = feature != null ? new HashSet<int>(feature.Issues.Select(i => i.Num)) : new HashSet<int>();
                bool touches = group.Edges.Any(e => issueNums.Contains(e.From) || issueNums.Contains(e.To));
                if (!touches && _dimUnrelated) opacity = .1;
            }
            else if (_selectedEdgePairs is { } selectedPairs)
            {
                bool selected = group.Edges.Any(e => selectedPairs.Contains((e.From, e.To)));
                if (selected) { stroke = EdgeSelectedWhite; opacity = 1; width = 2; markerKey = "white"; }
                // README's Edges table documents .18 here (not the reference .dc.html's uniform .1
                // for every dimmed case) — followed per README as the "exact...table" this issue
                // cites; filed as a finding, see build-journal/2478.md.
                else if (_dimUnrelated) opacity = .18;
            }

            if (_hoverEdgeKey == key)
            {
                opacity = 1;
                width = Math.Max(width, 1.8);
            }

            return new EdgeLook(stroke, width, opacity, dash, markerKey);
        }

        /// <summary>A 6×6 filled triangle arrowhead at the target end (README "Arrowheads: 6×6
        /// marker at the target end, filled in the edge color"). The tangent direction at the
        /// target endpoint is computed the same way the reference's SVG `orient="auto-start-reverse"`
        /// would from the real path math: orthogonal's final `H b.x` segment runs from `mid` to
        /// `b.x` (so the arrow correctly flips for a backward-running edge); curved's cubic tangent
        /// at `t=1` is `(dx, 0)` with `dx` always positive (see <see cref="ChainLayout.PathData"/>),
        /// so a curved arrowhead always points +x — a real quirk of the reference math, ported
        /// faithfully rather than "corrected".</summary>
        private static Path BuildArrowMarker(ChainPort a, ChainPort b, ChainEdgeStyle style, Brush color)
        {
            double ux;
            if (style == ChainEdgeStyle.Orthogonal)
            {
                double mid = (a.X + b.X) / 2;
                double d = b.X - mid;
                ux = d < 0 ? -1 : 1;
            }
            else
            {
                ux = 1;
            }
            const double uy = 0;
            double vx = -uy, vy = ux; // perpendicular to (ux, uy)
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

            return new Path { Data = geometry, Fill = color, IsHitTestVisible = false };
        }

        /// <summary>The `×N` bundle-count label (README "bundled into one path with a `×N` label at
        /// the midpoint... `paint-order:stroke` with a 4px `#0a0d12` halo"). A WPF `Path` built from
        /// the text's own outline geometry with both `Fill` (the edge color) and a thick `Stroke`
        /// (the halo) reproduces that halo without needing SVG's paint-order property.</summary>
        private static Path BuildBundleLabel(ChainPort a, ChainPort b, int count, EdgeLook look)
        {
            double mx = (a.X + b.X) / 2, my = (a.Y + b.Y) / 2;
            var typeface = new Typeface(MonoFont, FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);
            var formatted = new FormattedText("×" + count, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                typeface, 9, Brushes.Black, 1.0);
            var textGeometry = formatted.BuildGeometry(new Point(mx - formatted.Width / 2, my - formatted.Height / 2));

            return new Path
            {
                Data = textGeometry,
                Fill = look.Stroke,
                Opacity = Math.Min(1, look.Opacity + .35),
                Stroke = EdgeHalo,
                StrokeThickness = 4,
                IsHitTestVisible = false,
            };
        }

        private static string EdgeTooltip(EdgeGroup group, ChainDoc doc)
        {
            var e0 = group.Edges[0];
            string kind = group.Edges.Count > 1
                ? string.Join(" + ", group.Edges.Select(e => EdgeKindLabel(e.Kind)).Distinct())
                : EdgeKindLabel(e0.Kind);
            return group.Edges.Count > 1
                ? $"{group.Edges.Count} edges bundled ({kind}) · #{e0.To} blocked_by #{e0.From} and {group.Edges.Count - 1} more"
                : $"#{e0.To} blocked_by #{e0.From} · {kind}";
        }

        private static string EdgeKindLabel(ChainEdgeKind kind) => kind switch
        {
            ChainEdgeKind.FanIn => "fan-in",
            ChainEdgeKind.Gate => "cross-feature gate",
            _ => "added by you",
        };
    }
}
