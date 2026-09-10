using System;

namespace MyArchitect.Models;

/// <summary>
/// One entry in the local Activity Layer timeline (#3463) — which tenant/step/console-command
/// was active, and when. Local-only, in-app bookkeeping: powers auto-tagging for Screenshot Tool
/// (#3470) and Session Notes (#3472), and its own daily review/tagging UI here. Does NOT feed
/// Status Reports or retainer hours — that already happens for real via #3464's endpoint calls
/// against <c>retainer_work_log</c>, not this pipeline. Never synced to any backend.
/// </summary>
public sealed class ActivityEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset TimestampUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>"tenant-switch" | "console-command" | "record-open" | "external-app".</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Human-readable summary — the command text, the record title, the app name, etc.</summary>
    public string Detail { get; set; } = string.Empty;

    public string? TenantId { get; set; }
    public string? TenantName { get; set; }

    /// <summary>Free-text local tag, set from the review/tagging UI. Never synced anywhere.</summary>
    public string? Tag { get; set; }
}
