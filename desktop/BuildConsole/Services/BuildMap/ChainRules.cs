using System.Collections.Generic;
using System.Linq;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>Per-issue open-blocker/derived state for one <see cref="ChainIssue"/> — the node-level
    /// vocabulary <see cref="ChainRules.Derive"/> computes, distinct from <see cref="ChainStatus"/> (the
    /// raw board status a `ChainIssue.Status` carries). See BuildMap/README.md's "Derived state per
    /// issue" bullet and the Node-state table (`ready`/`blocked (waiting)`/`held`/`ask`/`done`).</summary>
    public enum ChainNodeState { Ready, Blocked, Held, Ask, Done }

    /// <summary>Per-Feature count of each <see cref="ChainNodeState"/> across its issues — the
    /// "Feature selected" inspector's five count tiles (README.md).</summary>
    public class ChainFeatureSummary
    {
        public int Ready { get; set; }
        public int Blocked { get; set; }
        public int Held { get; set; }
        public int Ask { get; set; }
        public int Done { get; set; }

        public void Add(ChainNodeState state)
        {
            switch (state)
            {
                case ChainNodeState.Ready: Ready++; break;
                case ChainNodeState.Blocked: Blocked++; break;
                case ChainNodeState.Held: Held++; break;
                case ChainNodeState.Ask: Ask++; break;
                case ChainNodeState.Done: Done++; break;
            }
        }
    }

    /// <summary>Whole-ChainDoc totals — the top-bar stats strip (Features / Issues / Ready now /
    /// Waiting / Backlog / Ask Shane / Done chips in README.md).</summary>
    public class ChainTotals
    {
        public int Issues { get; set; }
        public int Ready { get; set; }
        public int Blocked { get; set; }
        public int Held { get; set; }
        public int Ask { get; set; }
        public int Done { get; set; }

        public void Add(ChainNodeState state)
        {
            Issues++;
            switch (state)
            {
                case ChainNodeState.Ready: Ready++; break;
                case ChainNodeState.Blocked: Blocked++; break;
                case ChainNodeState.Held: Held++; break;
                case ChainNodeState.Ask: Ask++; break;
                case ChainNodeState.Done: Done++; break;
            }
        }
    }

    /// <summary>The real, full derived-state snapshot of a <see cref="ChainDoc"/> at a point in time —
    /// the C# port of <c>Build Chain Map.dc.html</c>'s <c>derive(doc)</c>. Every field is recomputed
    /// fresh from <c>doc</c>'s current features/edges; nothing here is persisted on the document itself
    /// (same as the prototype, which recomputes this on every render rather than caching it).</summary>
    public class ChainDerived
    {
        public Dictionary<int, ChainIssue> ByNum { get; } = new();
        public Dictionary<int, ChainFeature> FeatureOf { get; } = new();
        public Dictionary<int, List<ChainEdge>> IncomingEdges { get; } = new();
        public Dictionary<int, List<ChainEdge>> OutgoingEdges { get; } = new();

        /// <summary>Every real `(from,to)` pair currently wired as an edge — the JS `has` Set, used to
        /// test "does this exact fan-in/gate edge already exist" for the gap count below.</summary>
        public HashSet<(int From, int To)> HasEdge { get; } = new();

        /// <summary>Per-issue count of incoming edges whose blocker isn't (yet) Done — §5's "open
        /// blocker" count shown on a `blocked` node's tag.</summary>
        public Dictionary<int, int> OpenBlockers { get; } = new();

        public Dictionary<int, ChainNodeState> State { get; } = new();
        public Dictionary<string, ChainFeatureSummary> FeatureSummary { get; } = new();

        /// <summary>Missing fan-in/gate edges under the exact §5.2 pattern — the "Chain has N gap(s)"
        /// pill and the "Re-wire §5.2" prompt.</summary>
        public int Gaps { get; set; }

        /// <summary>The O(n·m) cross-product edge count §5.2 avoids — "Wiring every next-Feature issue
        /// to every previous-Feature issue would take {cross} edges."</summary>
        public int Cross { get; set; }

        public ChainTotals Totals { get; } = new();

        public int FanInCount { get; set; }
        public int GateCount { get; set; }
        public int ManualCount { get; set; }
    }

    /// <summary>
    /// Git #2476 (Build Chain Map, item #2 of #2473's structured index) — the pure-logic chain-rules
    /// engine, no UI. Ported 1:1 from `Build Chain Map.dc.html`'s reference `class Component`
    /// (`cascade`, `pickSentinel`, `push`, `rechainFanin`, `rechainGates`, `rechainAll`, `derive`),
    /// implementing BUILD_QUEUE_METHOD.md §5 exactly against #2475's real <see cref="ChainDoc"/> C#
    /// model:
    ///
    ///   • §5.2 step 1 — sentinel = the highest-numbered cascade issue (status != Ask) by default.
    ///   • §5.2 step 2 — fan-in: every cascade issue of a Feature (except the sentinel) blocked_by
    ///     that Feature's sentinel.
    ///   • §5.2 step 3 — cross-feature gate: every cascade issue of Feature B blocked_by Feature A's
    ///     sentinel, for every consecutive A → B pair in <see cref="ChainDoc.Order"/>.
    ///   • §5.3 — manual gate is a Backlog/Batter-Up board-status effect (see
    ///     <see cref="BuildChainMapService"/>'s `BuildGatesMap`), not an edge-shape change here — the
    ///     `blocked_by` edges this class generates stay identical whether or not a gate is manual.
    ///   • Chain-gap/cross-product count — see <see cref="Derive"/>'s `Gaps`/`Cross`.
    ///
    /// This class only ever mutates the <see cref="ChainDoc"/> passed to it (edges list, and a
    /// Feature's `Sentinel` when it's unset or invalidated) — it never talks to GitHub. Persisting an
    /// edit back as a real `blocked_by`/sub-issue/board-status write is item #7 of #2473's structured
    /// index, not this class's job.
    /// </summary>
    public static class ChainRules
    {
        /// <summary>§5.1/§10: "Cascade of a Feature = its issues whose status ≠ Ask Shane."</summary>
        public static List<ChainIssue> Cascade(IEnumerable<ChainIssue> issues) =>
            issues.Where(i => i.Status != ChainStatus.Ask).ToList();

        public static List<ChainIssue> Cascade(ChainFeature feature) => Cascade(feature.Issues);

        /// <summary>§5.2 step 1: the highest-numbered cascade issue by default. Null when the Feature
        /// has no cascade issues (empty, or every issue is Ask Shane).</summary>
        public static int? PickSentinel(IEnumerable<ChainIssue> issues)
        {
            var cascade = Cascade(issues);
            return cascade.Count == 0 ? null : cascade.Max(i => i.Num);
        }

        public static int? PickSentinel(ChainFeature feature) => PickSentinel(feature.Issues);

        public static ChainFeature? FindFeature(ChainDoc doc, string id) =>
            doc.Features.FirstOrDefault(f => f.Id == id);

        public static ChainFeature? FeatureOf(ChainDoc doc, int num) =>
            doc.Features.FirstOrDefault(f => f.Issues.Any(i => i.Num == num));

        public static ChainIssue? FindIssue(ChainDoc doc, int num) =>
            doc.Features.SelectMany(f => f.Issues).FirstOrDefault(i => i.Num == num);

        /// <summary>The JS `push(doc, e)`: adds a real edge unless one already exists between the same
        /// `(from, to)` pair. When one does exist and it's currently `Manual` but the newly-derived
        /// kind isn't, the existing edge is promoted in place (a §5.2-pattern edge always wins over a
        /// `manual` classification of the same pair) rather than duplicated. Returns true only when a
        /// brand-new edge was actually appended.</summary>
        public static bool Push(ChainDoc doc, ChainEdge edge)
        {
            if (edge.From == edge.To) return false;

            var existing = doc.Edges.FirstOrDefault(e => e.From == edge.From && e.To == edge.To);
            if (existing != null)
            {
                if (existing.Kind == ChainEdgeKind.Manual && edge.Kind != ChainEdgeKind.Manual)
                    existing.Kind = edge.Kind;
                return false;
            }

            doc.Edges.Add(edge);
            return true;
        }

        /// <summary>§5.2 steps 1+2 for one Feature: drop its stale fan-in edges, re-pick the sentinel
        /// if the current one is unset or no longer in the cascade, then wire every remaining cascade
        /// issue → sentinel. Mutates `doc.Edges` and `feature.Sentinel` in place.</summary>
        public static void RechainFanin(ChainDoc doc, ChainFeature feature)
        {
            var issueNums = new HashSet<int>(feature.Issues.Select(i => i.Num));
            doc.Edges = doc.Edges.Where(e => !(e.Kind == ChainEdgeKind.FanIn && issueNums.Contains(e.To))).ToList();

            var cascade = Cascade(feature);
            if (feature.Sentinel == null || !cascade.Any(i => i.Num == feature.Sentinel.Value))
                feature.Sentinel = PickSentinel(feature);

            if (feature.Sentinel == null) return;

            foreach (var issue in cascade)
            {
                if (issue.Num != feature.Sentinel.Value)
                    Push(doc, new ChainEdge { From = issue.Num, To = feature.Sentinel.Value, Kind = ChainEdgeKind.FanIn });
            }
        }

        /// <summary>§5.2 step 3 for the whole chain: drop every existing `gate` edge, then for every
        /// consecutive Feature pair A → B in <see cref="ChainDoc.Order"/>, wire every cascade issue of
        /// B → A's sentinel. A Feature with no sentinel (empty/all-Ask cascade) gates nothing.</summary>
        public static void RechainGates(ChainDoc doc)
        {
            doc.Edges = doc.Edges.Where(e => e.Kind != ChainEdgeKind.Gate).ToList();

            for (int k = 1; k < doc.Order.Count; k++)
            {
                var a = FindFeature(doc, doc.Order[k - 1]);
                var b = FindFeature(doc, doc.Order[k]);
                if (a == null || b == null || a.Sentinel == null) continue;

                foreach (var j in Cascade(b))
                    Push(doc, new ChainEdge { From = a.Sentinel.Value, To = j.Num, Kind = ChainEdgeKind.Gate });
            }
        }

        /// <summary>Full §5.2 re-wire: fan-in for every Feature, then every cross-feature gate. This is
        /// the "Re-wire §5.2" button's real logic and what a fresh <see cref="ChainDoc"/> is expected
        /// to be run through once before its edges are trusted.</summary>
        public static void RechainAll(ChainDoc doc)
        {
            foreach (var feature in doc.Features)
                RechainFanin(doc, feature);
            RechainGates(doc);
        }

        /// <summary>The C# port of the JS `derive(doc)` — recomputes the full derived-state snapshot
        /// (node states, per-Feature/whole-doc summaries, chain-gap and cross-product counts, edge-kind
        /// counts) fresh from `doc`'s current features/edges. Never mutates `doc`.</summary>
        public static ChainDerived Derive(ChainDoc doc)
        {
            var d = new ChainDerived();

            foreach (var feature in doc.Features)
            {
                foreach (var issue in feature.Issues)
                {
                    d.ByNum[issue.Num] = issue;
                    d.FeatureOf[issue.Num] = feature;
                }
            }

            foreach (var edge in doc.Edges)
            {
                if (!d.IncomingEdges.TryGetValue(edge.To, out var incoming))
                    d.IncomingEdges[edge.To] = incoming = new List<ChainEdge>();
                incoming.Add(edge);

                if (!d.OutgoingEdges.TryGetValue(edge.From, out var outgoing))
                    d.OutgoingEdges[edge.From] = outgoing = new List<ChainEdge>();
                outgoing.Add(edge);

                d.HasEdge.Add((edge.From, edge.To));
            }

            foreach (var (num, issue) in d.ByNum)
            {
                int open = d.IncomingEdges.TryGetValue(num, out var incoming)
                    ? incoming.Count(e => d.ByNum.TryGetValue(e.From, out var blocker) && blocker.Status != ChainStatus.Done)
                    : 0;
                d.OpenBlockers[num] = open;

                d.State[num] = issue.Status == ChainStatus.Done ? ChainNodeState.Done
                    : issue.Status == ChainStatus.Ask ? ChainNodeState.Ask
                    : issue.Status == ChainStatus.Backlog ? ChainNodeState.Held
                    : open > 0 ? ChainNodeState.Blocked
                    : ChainNodeState.Ready;
            }

            foreach (var feature in doc.Features)
            {
                var summary = new ChainFeatureSummary();
                foreach (var issue in feature.Issues)
                    summary.Add(d.State[issue.Num]);
                d.FeatureSummary[feature.Id] = summary;
            }

            int gaps = 0, cross = 0;

            foreach (var feature in doc.Features)
            {
                if (feature.Sentinel == null) continue;
                foreach (var issue in Cascade(feature))
                {
                    if (issue.Num != feature.Sentinel.Value && !d.HasEdge.Contains((issue.Num, feature.Sentinel.Value)))
                        gaps++;
                }
            }

            for (int k = 1; k < doc.Order.Count; k++)
            {
                var a = FindFeature(doc, doc.Order[k - 1]);
                var b = FindFeature(doc, doc.Order[k]);
                if (a == null || b == null) continue;

                var cascadeB = Cascade(b);
                cross += Cascade(a).Count * cascadeB.Count;

                if (a.Sentinel == null)
                {
                    gaps += cascadeB.Count;
                    continue;
                }

                foreach (var j in cascadeB)
                {
                    if (!d.HasEdge.Contains((a.Sentinel.Value, j.Num)))
                        gaps++;
                }
            }

            d.Gaps = gaps;
            d.Cross = cross;

            foreach (var num in d.ByNum.Keys)
                d.Totals.Add(d.State[num]);

            d.FanInCount = doc.Edges.Count(e => e.Kind == ChainEdgeKind.FanIn);
            d.GateCount = doc.Edges.Count(e => e.Kind == ChainEdgeKind.Gate);
            d.ManualCount = doc.Edges.Count - d.FanInCount - d.GateCount;

            return d;
        }
    }
}
