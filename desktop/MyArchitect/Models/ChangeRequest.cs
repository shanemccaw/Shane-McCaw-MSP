using System;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace MyArchitect.Models;

/// <summary>
/// One row from GET /api/msp/change-requests (msp-changes.ts) — the real
/// `msp_change_requests` table, MSP-scoped server-side. That route has no
/// per-tenant filter, so a per-tenant queue is built by filtering this list
/// client-side on <see cref="TenantId"/>, the same approach #3459's
/// ChangeRequestReplayService already uses against this same endpoint.
///
/// Fields mirror the columns `msp-changes.ts`'s GET route actually serializes
/// (`{ ...row, id: formatCrId(row.id) }`) that a browse/execute surface needs.
/// Execution-record-only fields (pre/post snapshot, executor run id, source
/// interpretation ids, etc.) live on <see cref="ChangeRequestExecution"/> or
/// are internal to the write-gate and are intentionally not duplicated here.
/// </summary>
public sealed class ChangeRequest
{
    /// <summary>The human-readable "CR-2026-NNN" form — this is literally what
    /// the wire field is named `id`; there is no separate numeric id in this
    /// response (see <see cref="NumericId"/>).</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("mspId")]
    public int MspId { get; set; }

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("tenantName")]
    public string TenantName { get; set; } = string.Empty;

    [JsonPropertyName("primaryDomain")]
    public string PrimaryDomain { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    /// <summary>"standard" | "normal" | "emergency".</summary>
    [JsonPropertyName("changeClass")]
    public string ChangeClass { get; set; } = string.Empty;

    /// <summary>"critical" | "high" | "medium" | "low".</summary>
    [JsonPropertyName("riskLevel")]
    public string RiskLevel { get; set; } = string.Empty;

    /// <summary>"ConditionalAccess" | "Exchange" | "Identity" | "Intune" |
    /// "Defender" | "SharePoint" | "Purview" | "Teams".</summary>
    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("targetResource")]
    public string TargetResource { get; set; } = string.Empty;

    [JsonPropertyName("psaTicketId")]
    public string PsaTicketId { get; set; } = string.Empty;

    [JsonPropertyName("requestedBy")]
    public string RequestedBy { get; set; } = string.Empty;

    [JsonPropertyName("requestedAt")]
    public string RequestedAt { get; set; } = string.Empty;

    /// <summary>Free-text human label — may not parse as a date (#1762's own
    /// header comment). Use <see cref="ScheduledStart"/>/<see cref="ScheduledEnd"/>
    /// for anything that needs a real instant, and treat those as unavailable
    /// when null — never default them.</summary>
    [JsonPropertyName("scheduledFor")]
    public string ScheduledFor { get; set; } = string.Empty;

    [JsonPropertyName("scheduledStart")]
    public DateTimeOffset? ScheduledStart { get; set; }

    [JsonPropertyName("scheduledEnd")]
    public DateTimeOffset? ScheduledEnd { get; set; }

    [JsonPropertyName("impactedUsersCount")]
    public int ImpactedUsersCount { get; set; }

    /// <summary>"pending_approval" | "scheduled" | "in_progress" | "completed" |
    /// "rolled_back" | "rejected".</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("backupVerified")]
    public bool BackupVerified { get; set; }

    [JsonPropertyName("rollbackScriptSnippet")]
    public string RollbackScriptSnippet { get; set; } = string.Empty;

    [JsonPropertyName("executedAt")]
    public string? ExecutedAt { get; set; }

    [JsonPropertyName("approvedBy")]
    public string? ApprovedBy { get; set; }

    /// <summary>The finding this CR was raised from, e.g. "Governance ·
    /// External Sharing Drift" — null for CRs not raised off a finding.</summary>
    [JsonPropertyName("linkedFinding")]
    public string? LinkedFinding { get; set; }

    [JsonPropertyName("remediationCheckKey")]
    public string? RemediationCheckKey { get; set; }

    /// <summary>"informed" | "approval" | "advisory".</summary>
    [JsonPropertyName("intake")]
    public string? Intake { get; set; }

    /// <summary>"microsoft" | "customer" | "msp" — who actually carries out the
    /// change. This is what #3471's "per item type" execute wiring branches on.</summary>
    [JsonPropertyName("implementer")]
    public string? Implementer { get; set; }

    [JsonPropertyName("sourceKind")]
    public string? SourceKind { get; set; }

    /// <summary>Non-null when this CR is catalog-backed (a Script Library /
    /// write_action_catalog entry) rather than a free-form change — the signal
    /// #3471's "catalog-backed changes" execute path keys off.</summary>
    [JsonPropertyName("catalogItemId")]
    public int? CatalogItemId { get; set; }

    [JsonPropertyName("rollbackOfChangeRequestId")]
    public int? RollbackOfChangeRequestId { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }

    private static readonly Regex CrIdPattern = new(@"^CR-2026-(\d+)$", RegexOptions.Compiled);

    /// <summary>
    /// Decodes the real database id back out of <see cref="Id"/>. Mirrors
    /// msp-changes.ts's own `formatCrId`/`parseCrId` pair exactly
    /// (`CR-2026-${100 + id}` / `parseInt(match[1]) - 100`) — this response
    /// never sends the numeric id directly, but
    /// POST /msp/change-control/executions/human-action needs it as a number.
    /// Null if <see cref="Id"/> doesn't match the expected shape.
    /// </summary>
    public int? NumericId
    {
        get
        {
            var match = CrIdPattern.Match(Id ?? string.Empty);
            if (!match.Success) return null;
            if (!int.TryParse(match.Groups[1].Value, out var n)) return null;
            return n - 100;
        }
    }
}
