using System;
using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2806 (Local Map, item #2 of #2804's structured index) — the layout algorithm for a flat
    /// live-Postgres schema graph (<see cref="LocalSchemaDoc"/>): tables as nodes, real foreign-key
    /// constraints as edges.
    ///
    /// <b>Why this is NOT <see cref="ChainLayout.Compute"/></b>: #2805's own real audit (see
    /// <see cref="LocalSchemaDoc"/>'s class doc) already established that <c>ChainLayout.Compute</c>
    /// is hard-bound to <see cref="ChainDoc"/>'s Epic → Feature → Issue shape — one column per
    /// Feature in priority order, rows per issue, a sentinel card. A Postgres schema has no Epic, no
    /// Feature grouping and no GitHub-native priority order to lay columns out by, so that method
    /// cannot run against a <see cref="LocalSchemaDoc"/> at all (wrong parameter type, and the wrong
    /// shape even if it could). What genuinely IS reusable, and IS reused here, is
    /// <see cref="ChainLayout.ClampZoom"/>, <see cref="ChainLayout.FitZoom"/> and
    /// <see cref="ChainLayout.PathData"/> — all three are already generic over <see cref="ChainPort"/>
    /// and pure math with no <c>ChainDoc</c> dependency — plus the <see cref="ChainRect"/>/
    /// <see cref="ChainPort"/> value types themselves.
    ///
    /// <b>The algorithm</b>: a simple DAG-layered (Sugiyama-style) column layout. A table's layer is
    /// the length of its longest real foreign-key dependency chain: a table with no outgoing FK (it
    /// references nothing) sits at layer 0; a table that references another sits one layer to the
    /// right of the deepest table it references. This reads naturally left → right: reference/parent
    /// tables (e.g. `tenants`, `users`) cluster on the left, tables with the deepest FK chains
    /// (typically the most specific child records) fan out to the right. A real self-referencing FK
    /// (a table whose own foreign key points at itself, e.g. a parent-comment-id pattern) and a real
    /// FK cycle (two or more tables each referencing the other, directly or transitively — genuinely
    /// possible in Postgres, no acyclic constraint exists) are both handled by the same in-progress
    /// guard: an edge back into a table already on the current recursion path is simply not counted
    /// toward that table's own depth, so the layout always terminates and every real table still gets
    /// a real layer — a feedback-arc break for layout purposes only, the edge itself is still drawn.
    ///
    /// Within a layer, tables stack top → bottom in one column, ordered alphabetically by
    /// <see cref="LocalSchemaTable.Id"/> (schema.table) for a stable, predictable read.
    /// </summary>
    public static class LocalMapLayout
    {
        public const double PadL = 24;
        public const double PadT = 24;
        public const double NodeW = 240;
        public const double NodeH = 58;
        public const double RowGap = 14;
        public const double ColGutter = 120;

        public const double ZoomMin = ChainLayout.ZoomMin;
        public const double ZoomMax = ChainLayout.ZoomMax;
        public const double ZoomStep = ChainLayout.ZoomStep;

        public static LocalMapLayoutResult Compute(LocalSchemaDoc doc)
        {
            var byId = doc.Tables.ToDictionary(t => t.Id, StringComparer.Ordinal);

            var outgoing = new Dictionary<string, List<LocalSchemaEdge>>(StringComparer.Ordinal);
            foreach (var edge in doc.Edges)
            {
                if (!outgoing.TryGetValue(edge.FromTableId, out var list))
                    outgoing[edge.FromTableId] = list = new List<LocalSchemaEdge>();
                list.Add(edge);
            }

            var layerOf = new Dictionary<string, int>(StringComparer.Ordinal);
            var onPath = new HashSet<string>(StringComparer.Ordinal);

            int LayerOf(string tableId)
            {
                if (layerOf.TryGetValue(tableId, out var cached)) return cached;
                // Cycle/self-reference guard: an edge back into a table already being computed
                // contributes nothing to depth here (the edge is still real and still drawn by
                // RenderEdgeLayer — this only affects column placement).
                if (!onPath.Add(tableId)) return 0;

                int deepest = -1;
                if (outgoing.TryGetValue(tableId, out var edges))
                {
                    foreach (var edge in edges)
                    {
                        if (edge.ToTableId == tableId) continue; // self-referencing FK
                        if (!byId.ContainsKey(edge.ToTableId)) continue; // real but out-of-scope target
                        deepest = Math.Max(deepest, LayerOf(edge.ToTableId));
                    }
                }

                onPath.Remove(tableId);
                int layer = deepest + 1;
                layerOf[tableId] = layer;
                return layer;
            }

            foreach (var table in doc.Tables) LayerOf(table.Id);

            var result = new LocalMapLayoutResult();
            double x = PadL;
            double maxBottom = PadT;

            var columns = doc.Tables
                .GroupBy(t => layerOf[t.Id])
                .OrderBy(g => g.Key);

            foreach (var column in columns)
            {
                double y = PadT;
                foreach (var table in column.OrderBy(t => t.Id, StringComparer.Ordinal))
                {
                    result.Node[table.Id] = new ChainRect(x, y, NodeW, NodeH);
                    y += NodeH + RowGap;
                }
                maxBottom = Math.Max(maxBottom, y - RowGap);
                x += NodeW + ColGutter;
            }

            result.W = Math.Max(NodeW + 2 * PadL, x - ColGutter + PadL);
            result.H = Math.Max(NodeH + 2 * PadT, maxBottom + PadT);
            return result;
        }

        /// <summary>The referencing (FK-owning) end of an edge — right-middle of its node.</summary>
        public static ChainPort? OutPort(LocalMapLayoutResult layout, string tableId) =>
            layout.Node.TryGetValue(tableId, out var rect)
                ? new ChainPort(rect.X + rect.W, rect.Y + rect.H / 2, tableId)
                : null;

        /// <summary>The referenced (parent) end of an edge — left-middle of its node.</summary>
        public static ChainPort? InPort(LocalMapLayoutResult layout, string tableId) =>
            layout.Node.TryGetValue(tableId, out var rect)
                ? new ChainPort(rect.X, rect.Y + rect.H / 2, tableId)
                : null;
    }

    public sealed class LocalMapLayoutResult
    {
        /// <summary>Table rects by <see cref="LocalSchemaTable.Id"/> (schema.table).</summary>
        public Dictionary<string, ChainRect> Node { get; } = new(StringComparer.Ordinal);

        public double W { get; set; }
        public double H { get; set; }
    }
}
