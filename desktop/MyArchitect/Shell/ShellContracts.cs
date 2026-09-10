using System;
using System.Collections.Generic;
using Brush = System.Windows.Media.Brush;

namespace MyArchitect.Shell;

/// <summary>
/// The five fixed Ribbon tabs (UI_RULES.md §2). Closed list — a new fixed tab is a shell
/// change, not something a Feature adds for itself.
/// </summary>
public enum FixedTab
{
    Home,
    Console,
    Watch,
    Documents,
    Admin,
}

/// <summary>
/// What a <see cref="RibbonCommandSpec"/> is allowed to do. Mirrors AdminV2's intent contract
/// (SHELL.md §1) exactly: a fixed tab may only ever carry <see cref="Open"/>,
/// <see cref="Create"/> or <see cref="Global"/> — never <see cref="Record"/>. A command needing a
/// specific record open belongs on a contextual tab instead.
/// </summary>
public enum RibbonIntent
{
    /// <summary>Navigates to or reveals something. Fixed-tab legal.</summary>
    Open,
    /// <summary>Makes a new thing. Fixed-tab legal.</summary>
    Create,
    /// <summary>Acts across every record at once. Fixed-tab legal.</summary>
    Global,
    /// <summary>Needs a specific record open. Contextual-tab only — never legal on a fixed tab.</summary>
    Record,
}

/// <summary>
/// Thrown when a <see cref="ShellRegistry"/> registration violates the shell's own contract
/// (UI_RULES.md §2 / SHELL.md's <c>ShellContractError</c>) — e.g. a <see cref="RibbonIntent.Record"/>
/// command registered on a fixed tab. A contract violation is a startup failure, not a silent
/// no-op, exactly as AdminV2 enforces it.
/// </summary>
public sealed class ShellContractException : Exception
{
    public ShellContractException(string message) : base(message) { }
}

/// <summary>One ribbon command — a button in a group's Large/Small/Row slot.</summary>
public sealed class RibbonCommandSpec
{
    public required string Label { get; init; }
    public required RibbonIntent Intent { get; init; }
    public required Action OnSelect { get; init; }
    public string? ToolTip { get; init; }
    /// <summary>Optional live count badge — the one place a badge is allowed (UI_RULES.md §8).</summary>
    public Func<int>? LiveCount { get; init; }
    public Brush? Accent { get; init; }
    /// <summary>When set, the command renders as a dropdown gallery instead of firing OnSelect directly.</summary>
    public GallerySpec? Gallery { get; init; }
}

/// <summary>
/// A group of commands on a ribbon tab. Groups sharing the same <see cref="Label"/> on the same
/// fixed tab are merged into one physical box (UI_RULES.md §2's Watch-tab example — Alerts, SLA
/// breaches and the Task Queue all land in one themed group, not three tabs) — see
/// <see cref="RibbonAssembly.MergeGroupsByLabel"/>.
/// </summary>
public sealed class RibbonGroupSpec
{
    public required string Label { get; init; }
    /// <summary>Lower sorts left/first. Default 100.</summary>
    public int Order { get; init; } = 100;
    public List<RibbonCommandSpec> Large { get; init; } = new();
    public List<RibbonCommandSpec> Small { get; init; } = new();
}

/// <summary>A real-data gallery row (UI_RULES.md §4) — never a bare label.</summary>
public sealed class GalleryRowSpec
{
    public required string Id { get; init; }
    /// <summary>Two or three characters — the row's most useful number/code, not an icon.</summary>
    public string? Tile { get; init; }
    public required string Name { get; init; }
    public string? Sub { get; init; }
    public bool IsCurrent { get; init; }
    public required Action OnSelect { get; init; }
}

public sealed class GallerySpec
{
    public required string Title { get; init; }
    public bool Searchable { get; init; }
    public required Func<IReadOnlyList<GalleryRowSpec>> GetRows { get; init; }
}

/// <summary>One entry in the navigation trail (most-recent-first, deduped on Kind:Id, capped at 6)
/// used to splice the Back group into every contextual tab (UI_RULES.md §2 / SHELL.md §2).</summary>
public sealed record TrailEntry(string Kind, string Id, string Label, Action Open);

/// <summary>A contextual tab spec — appears to the right of the fixed tabs, auto-selected when a
/// record opens. The Back group is spliced in by the shell at position 2; never hand-author it.</summary>
public sealed class ContextualTabSpec
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public List<RibbonGroupSpec> Groups { get; init; } = new();
}

/// <summary>A size-aware fact row (SHELL.md §3's Peek fact rule, ported). Short numeric/short-text
/// renders big; longer text wraps small. Set <see cref="Prose"/> to force small on a short value
/// that's really prose rather than a figure.</summary>
public sealed class WorkspaceFact
{
    public required string Label { get; init; }
    public required string Value { get; init; }
    public bool Prose { get; init; }
}

/// <summary>Write-through edit — no save step, no dirty state. Supplying <see cref="Options"/>
/// turns the field into a cycle button.</summary>
public sealed class WorkspaceEdit
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    public required string Value { get; init; }
    public List<string>? Options { get; init; }
    public required Action<string> OnChange { get; init; }
}

/// <summary>An action row. <see cref="Confirm"/> arms in place — first press relabels
/// "&lt;label&gt; — press again"; only the second press fires <see cref="OnSelect"/>. There is
/// deliberately no confirm dialog. Arming resets when the workspace closes or a different record
/// opens (see <see cref="RecordWorkspacePanel"/>).</summary>
public sealed class WorkspaceAction
{
    public required string Label { get; init; }
    public bool Confirm { get; init; }
    public bool Danger { get; init; }
    public required Action OnSelect { get; init; }
}

public sealed class WorkspaceListRow
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string? Sub { get; init; }
    public string? Right { get; init; }
    public required Action OnSelect { get; init; }
}

/// <summary>
/// The full-panel record workspace contract (UI_RULES.md §3) — same field shapes as AdminV2's
/// Peek, rendered at full right-panel size instead of a small overlay.
/// </summary>
public sealed class RecordWorkspaceSpec
{
    public required string Kind { get; init; }
    public required string Id { get; init; }
    public string? Eyebrow { get; init; }
    public required string Title { get; init; }
    public string? Sub { get; init; }
    public List<WorkspaceFact> Facts { get; init; } = new();
    public List<WorkspaceEdit> Edits { get; init; } = new();
    public (string Title, string Content)? Body { get; init; }
    public (string Title, List<WorkspaceListRow> Rows)? List { get; init; }
    public List<WorkspaceAction> Actions { get; init; } = new();
}

/// <summary>The four command-palette prefixes (UI_RULES.md §5), ported directly from AdminV2's
/// <c>@</c>/<c>&gt;</c>/<c>#</c>/<c>?</c> scheme.</summary>
public enum PaletteType
{
    /// <summary><c>@</c> — browse all places without knowing names.</summary>
    Destination,
    /// <summary><c>&gt;</c> — verbs only.</summary>
    Action,
    /// <summary><c>#</c> — nouns only, a specific record.</summary>
    Record,
    /// <summary><c>?</c> — live numbers; the number IS the point.</summary>
    Answer,
}

/// <summary>
/// One palette entry. Computed live on every palette open by whatever registered the provider —
/// never cached, so a stale <see cref="PaletteType.Answer"/> reading is never shown
/// (UI_RULES.md §5).
/// </summary>
public sealed class PaletteCommand
{
    public required string Id { get; init; }
    public required PaletteType Type { get; init; }
    public required string Name { get; init; }
    public string? Sub { get; init; }
    /// <summary>Only meaningful for <see cref="PaletteType.Answer"/> — the live number itself.</summary>
    public string? Live { get; init; }
    public required Action Run { get; init; }
}
