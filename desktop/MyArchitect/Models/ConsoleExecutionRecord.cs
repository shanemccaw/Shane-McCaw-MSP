using System;

namespace MyArchitect.Models;

/// <summary>
/// One real, executed command in the hosted PowerShell console (#3459) — command text,
/// tenant context, real captured output, duration, and the "mark for report" flag a future
/// Console UI panel (blocked on #3493) will expose as a toggle/hotkey. Also the shape the
/// #3459 logging hook feeds to the Activity Layer (#3463) once that local consumer exists.
/// </summary>
public sealed class ConsoleExecutionRecord
{
    public Guid ExecutionId { get; set; } = Guid.NewGuid();
    public string Command { get; set; } = string.Empty;
    public string TenantId { get; set; } = string.Empty;
    public string TenantName { get; set; } = string.Empty;
    public string TenantGuid { get; set; } = string.Empty;
    public DateTimeOffset StartedAtUtc { get; set; }
    public long DurationMs { get; set; }
    public string Output { get; set; } = string.Empty;
    public string ErrorOutput { get; set; } = string.Empty;
    public bool Succeeded { get; set; }

    /// <summary>Not every command's output should reach Status Reports — only the ones an
    /// operator explicitly flags. Local-only; no backend field this maps to.</summary>
    public bool MarkedForReport { get; set; }
}
