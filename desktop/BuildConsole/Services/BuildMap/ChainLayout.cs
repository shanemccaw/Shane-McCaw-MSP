using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2477 (Build Chain Map, item #3 of #2473's structured index) — the auto-layout engine,
    /// ported 1:1 from `Build Chain Map.dc.html`'s `layout(doc, expanded)` / `outPort` / `inPort` /
    /// `zoomBy` / `fit`, using BuildMap/README.md's "Canvas geometry" constants table verbatim.
    /// Pure math, no UI: <see cref="ChainCanvasControl"/> renders from the rects computed here, and
    /// #2478's SVG-equivalent edge layer draws between the ports computed here.
    ///
    /// All positions are absolute inside a stage sized to content; zoom is a uniform scale on the
    /// stage (transform-origin 0,0) with the scroll extent sized to W·z × H·z. Columns accumulate
    /// left → right in priority order: `x₀ = padL + epicW + epicGap`; each column is `colW` wide
    /// collapsed or `stackW + sentGap + sentW = 412` expanded; `x += width + gutter`.
    /// </summary>
    public static class ChainLayout
    {
        // README.md "Canvas geometry" constants table — exact values, do not tune.
        public const double PadL = 20;      // left padding
        public const double RailY = 42;     // y of the epic tree rail
        public const double Top = 66;       // y of all Feature headers and the Epic card
        public const double EpicW = 148;    // Epic card width
        public const double EpicGap = 64;   // gap from Epic card to first column
        public const double ColW = 204;     // collapsed Feature column width
        public const double StackW = 212;   // issue stack width (expanded)
        public const double SentGap = 40;   // gap from stack to sentinel card
        public const double SentW = 160;    // sentinel card width
        public const double HeadH = 94;     // Feature header height
        public const double Gutter = 88;    // horizontal space between Feature columns
        public const double RowH = 26;      // issue row height
        public const double RowGap = 5;     // gap between issue rows (pitch = RowH + RowGap = 31)
        public const double SentH = 66;     // sentinel card height

        public const double ZoomMin = 0.35;
        public const double ZoomMax = 1.6;
        public const double ZoomStep = 0.1;

        /// <summary>Expanded column width: stackW + sentGap + sentW = 412 (README).</summary>
        public const double ExpandedW = StackW + SentGap + SentW;

        public static ChainLayoutResult Compute(ChainDoc doc, ISet<string> expanded)
        {
            var result = new ChainLayoutResult();
            double x = PadL + EpicW + EpicGap;
            double maxBottom = Top + HeadH;

            foreach (var fid in doc.Order)
            {
                var feature = ChainRules.FindFeature(doc, fid);
                if (feature == null) continue;

                bool isExpanded = expanded.Contains(fid);
                double width = isExpanded ? ExpandedW : ColW;
                result.Head[fid] = new ChainRect(x, Top, width, HeadH);

                if (isExpanded)
                {
                    var siblings = feature.Issues
                        .Where(i => i.Num != feature.Sentinel)
                        .OrderBy(i => i.Num)
                        .ToList();
                    double y0 = Top + HeadH + 18;

                    for (int r = 0; r < siblings.Count; r++)
                        result.Node[siblings[r].Num] = new ChainRect(x, y0 + r * (RowH + RowGap), StackW, RowH, ChainNodeKind.Row);

                    double stackH = siblings.Count > 0 ? siblings.Count * (RowH + RowGap) - RowGap : SentH;

                    if (feature.Sentinel is int sentinel)
                    {
                        var sentinelRect = new ChainRect(
                            x + StackW + SentGap,
                            Math.Max(y0, y0 + stackH / 2 - SentH / 2),
                            SentW, SentH, ChainNodeKind.Sentinel);
                        result.Node[sentinel] = sentinelRect;
                        maxBottom = Math.Max(maxBottom, sentinelRect.Y + SentH);
                    }

                    maxBottom = Math.Max(maxBottom, y0 + stackH);
                }

                x += width + Gutter;
            }

            result.W = x - Gutter + PadL + 24;
            result.H = maxBottom + 48;
            return result;
        }

        /// <summary>The blocker end of an edge: the node's right-middle when its Feature is expanded,
        /// else its Feature header's right-middle (a collapsed header stands in for its issues).
        /// `Key` collapses bundled edges: two edges share a path when both endpoints share keys.</summary>
        public static ChainPort? OutPort(ChainLayoutResult layout, ChainDerived derived, ISet<string> expanded, int num)
        {
            if (!derived.FeatureOf.TryGetValue(num, out var feature)) return null;
            if (expanded.Contains(feature.Id) && layout.Node.TryGetValue(num, out var node))
                return new ChainPort(node.X + node.W, node.Y + node.H / 2, "i" + num);
            if (!layout.Head.TryGetValue(feature.Id, out var head)) return null;
            return new ChainPort(head.X + head.W, head.Y + head.H / 2, "f" + feature.Id);
        }

        /// <summary>The blocked end of an edge: left-middle of the node, or of its collapsed header.</summary>
        public static ChainPort? InPort(ChainLayoutResult layout, ChainDerived derived, ISet<string> expanded, int num)
        {
            if (!derived.FeatureOf.TryGetValue(num, out var feature)) return null;
            if (expanded.Contains(feature.Id) && layout.Node.TryGetValue(num, out var node))
                return new ChainPort(node.X, node.Y + node.H / 2, "i" + num);
            if (!layout.Head.TryGetValue(feature.Id, out var head)) return null;
            return new ChainPort(head.X, head.Y + head.H / 2, "f" + feature.Id);
        }

        /// <summary>Zoom clamp: range 0.35–1.6, rounded to 2 decimals (the prototype's `zoomBy`).</summary>
        public static double ClampZoom(double zoom) =>
            Math.Round(Math.Max(ZoomMin, Math.Min(ZoomMax, zoom)) * 100) / 100;

        /// <summary>Fit = `min(1, (viewportWidth − 16) / W)`, floored at the 0.35 zoom minimum
        /// (the prototype's `fit()`). Never zooms in past 100% to fill a wide viewport.</summary>
        public static double FitZoom(double viewportWidth, double stageWidth)
        {
            if (stageWidth <= 0) return 1;
            return Math.Round(Math.Max(ZoomMin, Math.Min(1, (viewportWidth - 16) / stageWidth)) * 100) / 100;
        }

        /// <summary>Git #2478 — the edge path itself, a 1:1 port of `Build Chain Map.dc.html`'s
        /// `pathD(a, b, ortho)`. Orthogonal (default): `M a H mid V b.y H b` where
        /// `mid = (a.x + b.x)/2` — two right-angle turns, matching WPF's own supported Path Markup
        /// Syntax (M/H/V/C are all real WPF mini-language commands, already proven by the epic-tree
        /// rail in <see cref="ChainCanvasControl.RenderEpicTreeRail"/>). Curved: a cubic Bézier with
        /// control offset `dx = clamp(|b.x − a.x|/2, 36, 110)` — note `dx` is always positive, so the
        /// curve's tangent at `b` always points +x (see <see cref="ChainCanvasControl"/>'s edge-layer
        /// arrowhead comment for what this means for a backward-running edge; ported faithfully, not
        /// "corrected", since the reference is high-fidelity).</summary>
        public static string PathData(ChainPort a, ChainPort b, ChainEdgeStyle style)
        {
            var inv = CultureInfo.InvariantCulture;
            if (style == ChainEdgeStyle.Orthogonal)
            {
                double mid = (a.X + b.X) / 2;
                return string.Format(inv, "M{0} {1} H{2} V{3} H{4}", a.X, a.Y, mid, b.Y, b.X);
            }
            double dx = Math.Max(36, Math.Min(110, Math.Abs(b.X - a.X) * .5));
            return string.Format(inv, "M{0} {1} C{2} {3} {4} {5} {6} {7}",
                a.X, a.Y, a.X + dx, a.Y, b.X - dx, b.Y, b.X, b.Y);
        }
    }

    /// <summary>The README's "Tweakable props" `edgeStyle`: `'orthogonal'` (default) | `'curved'`.</summary>
    public enum ChainEdgeStyle { Orthogonal, Curved }

    public enum ChainNodeKind { Row, Sentinel }

    public class ChainRect
    {
        public double X { get; }
        public double Y { get; }
        public double W { get; }
        public double H { get; }
        public ChainNodeKind Kind { get; }

        public ChainRect(double x, double y, double w, double h, ChainNodeKind kind = ChainNodeKind.Row)
        {
            X = x; Y = y; W = w; H = h; Kind = kind;
        }
    }

    /// <summary>An edge endpoint. `Key` identifies the visual node the port sits on (`i{num}` or
    /// `f{featureId}`) so #2478 can bundle edges whose collapsed endpoints coincide.</summary>
    public class ChainPort
    {
        public double X { get; }
        public double Y { get; }
        public string Key { get; }

        public ChainPort(double x, double y, string key)
        {
            X = x; Y = y; Key = key;
        }
    }

    public class ChainLayoutResult
    {
        /// <summary>Feature header rects by Feature id, in priority order.</summary>
        public Dictionary<string, ChainRect> Head { get; } = new();

        /// <summary>Issue-node rects by issue number — only issues of expanded Features are present
        /// (a collapsed Feature's issues have no rect; its header stands in for them).</summary>
        public Dictionary<int, ChainRect> Node { get; } = new();

        /// <summary>Stage size at zoom 1: `W = lastX + padL + 24`, `H = lowest node bottom + 48`.</summary>
        public double W { get; set; }
        public double H { get; set; }
    }
}
