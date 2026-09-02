using System.Collections.Generic;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2475 (Build Chain Map, item #1 of #2473's structured index) — the real, GitHub-backed
    /// C# port of BuildMap/README.md's "State &amp; data model" TypeScript block:
    ///
    /// <code>
    /// type Status = 'batter' | 'backlog' | 'ask' | 'done';
    /// type EdgeKind = 'fanin' | 'gate' | 'manual';
    /// interface Issue   { num: number; title: string; status: Status; model: string; effort: string }
    /// interface Feature { id: string; num: number; name: string; short: string; issues: Issue[]; sentinel: number | null }
    /// interface Edge    { from: number; to: number; kind: EdgeKind }
    /// interface ChainDoc {
    ///   epic: { num: number; name: string };
    ///   features: Feature[];
    ///   order: string[];
    ///   edges: Edge[];
    ///   gates: Record&lt;string, boolean&gt;;
    /// }
    /// </code>
    ///
    /// Every value on every one of these types is produced by <see cref="BuildChainMapService"/> from
    /// a real GitHub API response — no placeholder Feature/issue numbers, no fabricated edges. See
    /// that class for the exact read/derivation rules.
    /// </summary>
    public enum ChainStatus { Batter, Backlog, Ask, Done }

    /// <summary>fanin/gate = the two edge kinds §5.2 generates automatically; manual = a real
    /// blocked_by edge that exists on GitHub but doesn't match either auto pattern — i.e. a human
    /// added it deliberately (BuildMap/README.md's edges table, "Added by user").</summary>
    public enum ChainEdgeKind { FanIn, Gate, Manual }

    public class ChainEpic
    {
        public int Num { get; set; }
        public string Name { get; set; } = "";
    }

    public class ChainIssue
    {
        public int Num { get; set; }
        public string Title { get; set; } = "";
        public ChainStatus Status { get; set; }
        /// <summary>Model id parsed from the issue's latest real `BUILD:` comment (e.g. `claude-sonnet-5`).
        /// Empty when no BUILD comment was found — never a fabricated/placeholder value.</summary>
        public string Model { get; set; } = "";
        /// <summary>Effort parsed from the same `BUILD:` comment (e.g. `high`). Empty when unavailable.</summary>
        public string Effort { get; set; } = "";
        public string HtmlUrl { get; set; } = "";
        /// <summary>Real GitHub issue state (closed independently of the derived <see cref="Status"/>,
        /// which can be `done` via a verified bookend before or without the issue itself being closed —
        /// closing is Shane's own separate call per CLAUDE.md's "you never close an issue" rule).</summary>
        public bool IsClosed { get; set; }
    }

    public class ChainFeature
    {
        /// <summary>Stable id derived from the real issue number: `"F" + Num` (e.g. `"F2481"`). Referenced
        /// by <see cref="ChainDoc.Order"/> and <see cref="ChainDoc.Gates"/>.</summary>
        public string Id { get; set; } = "";
        public int Num { get; set; }
        /// <summary>Real issue title with a leading `"Feature: "` prefix stripped, verbatim otherwise —
        /// copy is never rewritten.</summary>
        public string Name { get; set; } = "";
        /// <summary>buildSet short name, mechanically derived from <see cref="Name"/> per
        /// BUILD_QUEUE_METHOD.md §4.2 (PascalCase, no spaces, no punctuation) — not a separate GitHub
        /// field, since none exists; a deterministic transform of real title text.</summary>
        public string Short { get; set; } = "";
        public string HtmlUrl { get; set; } = "";
        public List<ChainIssue> Issues { get; set; } = new();
        /// <summary>Highest-numbered cascade issue (status != Ask) by default, per §5.2 step 1. Null
        /// when the Feature has no cascade issues (empty, or every issue is Ask Shane). GitHub has no
        /// native "sentinel" field yet — persistence/override (item #7 of #2473) isn't built; until it
        /// is, this default is the only real source.</summary>
        public int? Sentinel { get; set; }
    }

    public class ChainEdge
    {
        /// <summary>The blocker — `to` is blocked_by `from`, matching GitHub's real dependency
        /// direction and BuildMap/README.md's Edge type exactly.</summary>
        public int From { get; set; }
        public int To { get; set; }
        public ChainEdgeKind Kind { get; set; }
    }

    public class ChainDoc
    {
        public ChainEpic Epic { get; set; } = new();
        public List<ChainFeature> Features { get; set; } = new();
        /// <summary>Feature ids in real priority order — straight from the order GitHub's own
        /// sub-issues API returns the Epic's children in (a real, reorderable, stored ordering; not
        /// invented here).</summary>
        public List<string> Order { get; set; } = new();
        /// <summary>Every real `blocked_by` edge on GitHub between two issues that are both inside
        /// this Epic's chain, classified fanin/gate/manual per §5.2's exact rule (see
        /// <see cref="BuildChainMapService"/>).</summary>
        public List<ChainEdge> Edges { get; set; } = new();
        /// <summary>Downstream Feature id → manual gate before it. Derived (not GitHub-native — see
        /// <see cref="BuildChainMapService"/>'s class doc) from real board-status observation: true
        /// when every cascade issue of that Feature is currently held in Backlog despite a real gate
        /// edge from the previous Feature's sentinel.</summary>
        public Dictionary<string, bool> Gates { get; set; } = new();
    }
}
