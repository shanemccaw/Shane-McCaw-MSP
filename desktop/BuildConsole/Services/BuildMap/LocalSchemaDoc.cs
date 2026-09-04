using System;
using System.Collections.Generic;

namespace BuildConsole.Services.BuildMap
{
    /// <summary>
    /// Git #2805 (Local Map, item #1 of #2804's structured index) — the real data contract for a
    /// live Postgres schema graph: tables as nodes, real foreign-key constraints as edges.
    ///
    /// <b>Why this is a NEW parallel model, not a reuse of <see cref="ChainDoc"/>:</b> the issue's own
    /// real-audit requirement was to read every field of <c>ChainDoc</c> before assuming the
    /// tables↔Features / FKs↔edges mapping fits. It doesn't. Every field on <c>ChainDoc</c> and its
    /// nested types is GitHub-issue-tracker-specific and has no honest analog here:
    ///   • <see cref="ChainEpic"/>/<see cref="ChainFeature"/>/<see cref="ChainIssue"/> encode a real
    ///     three-level hierarchy (Epic → Feature → Issue) with a real priority <c>Order</c> GitHub's
    ///     sub-issues API returns. A Postgres schema has no such hierarchy — tables are flat; there is
    ///     no "Feature" a table belongs to, and no GitHub-native ordering to reuse for <c>Order</c>.
    ///   • <see cref="ChainIssue.Status"/>/<see cref="ChainIssue.Model"/>/<see cref="ChainIssue.Effort"/>
    ///     come from board-status fields and <c>BUILD:</c> comment parsing — meaningless for a table.
    ///   • <see cref="ChainFeature.Sentinel"/> and <see cref="ChainDoc.Gates"/> encode
    ///     BUILD_QUEUE_METHOD.md §5.2/§5.3's fan-in/gate cascade rules over build-queue state — a table
    ///     has no "sentinel" and a foreign key has no "gate".
    ///   • <see cref="ChainEdge.Kind"/> classifies a real <c>blocked_by</c> GitHub dependency as
    ///     fanin/gate/manual, a build-queue-only concept; a foreign key has no equivalent kind to
    ///     assign, only real referencing/referenced columns.
    ///   • <see cref="ChainLayout.Compute"/> is likewise hard-coded to that exact shape (one column per
    ///     Feature, one row per issue, a sentinel card) — it takes a <c>ChainDoc</c> directly, not a
    ///     generic node/edge graph, so it isn't a reusable layout primitive here either. #2806 (the
    ///     Local Map window) needs its own graph layout over this flat table/edge shape.
    ///
    /// What IS real and shared: this is a flat, directed graph exactly like <c>ChainDoc</c>'s edges
    /// (nodes + real FK relationships), so #2806/#2807 can borrow <c>ChainCanvasControl</c>'s
    /// pan/zoom/click rendering machinery over a different layout, per #2804's own real audit note
    /// ("`ChainLayout` and the window's rendering are the real, reusable parts").
    ///
    /// Produced by <see cref="LocalSchemaMapService"/> from a live query against the real local
    /// Postgres database BuildConsole already connects to for the build queue — no placeholder
    /// tables, no fabricated foreign keys. A database with zero real user tables returns a
    /// <see cref="LocalSchemaDoc"/> with an empty <see cref="Tables"/> list — a true, un-fabricated
    /// result, not a placeholder.
    /// </summary>
    public sealed class LocalSchemaDoc
    {
        /// <summary>The real Postgres database name this graph was read from (e.g. `shanemccawmsp`).</summary>
        public string Database { get; set; } = "";

        /// <summary>Real wall-clock time (UTC) this document was produced — a schema graph is a
        /// point-in-time snapshot, not a live subscription; the UI can show "as of" from this.</summary>
        public DateTime GeneratedAtUtc { get; set; }

        public List<LocalSchemaTable> Tables { get; set; } = new();

        /// <summary>Every real foreign-key constraint found — see
        /// <see cref="LocalSchemaMapService"/> for the exact `information_schema` read.</summary>
        public List<LocalSchemaEdge> Edges { get; set; } = new();
    }

    public sealed class LocalSchemaTable
    {
        /// <summary>Real Postgres schema this table lives in (almost always `public` here, but not
        /// assumed — read from `information_schema.tables.table_schema`).</summary>
        public string Schema { get; set; } = "";

        public string Name { get; set; } = "";

        /// <summary>Stable node id used by <see cref="LocalSchemaEdge.FromTableId"/>/
        /// <see cref="LocalSchemaEdge.ToTableId"/> and by #2806's layout/render lookups:
        /// `"{Schema}.{Name}"`.</summary>
        public string Id => Schema + "." + Name;

        /// <summary>Real column count from `information_schema.columns` — not row count (row counts
        /// are a live, expensive, constantly-changing number; a schema graph node doesn't need one).</summary>
        public int ColumnCount { get; set; }

        /// <summary>Real primary-key column name(s), in ordinal order. Empty when the table genuinely
        /// has no primary key (real Postgres allows this) — not a fabricated `id` guess.</summary>
        public List<string> PrimaryKeyColumns { get; set; } = new();
    }

    public sealed class LocalSchemaEdge
    {
        /// <summary>Real constraint name from `information_schema.table_constraints.constraint_name`.</summary>
        public string ConstraintName { get; set; } = "";

        /// <summary>The table that OWNS the foreign key (the referencing side) — matches
        /// <see cref="ChainEdge"/>'s `From`-is-the-blocker convention loosely, but here it's simply
        /// "the table whose row can't exist without the referenced row".</summary>
        public string FromTableId { get; set; } = "";

        /// <summary>The table being referenced (the parent/target of the FK).</summary>
        public string ToTableId { get; set; } = "";

        /// <summary>Real referencing column name(s), ordinal order. Single-element for the (verified,
        /// see <see cref="LocalSchemaMapService"/>) common case of a non-composite FK; a composite FK
        /// carries every real column here rather than being silently truncated to one.</summary>
        public List<string> FromColumns { get; set; } = new();

        /// <summary>Real referenced column name(s), aligned 1:1 by position with
        /// <see cref="FromColumns"/>.</summary>
        public List<string> ToColumns { get; set; } = new();
    }
}
