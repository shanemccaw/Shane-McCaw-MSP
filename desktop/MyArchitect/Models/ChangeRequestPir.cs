using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One Post-Implementation Review, exactly as `msp-change-pir.ts`'s
/// `toWireCrPir` serializes it. Filed against a specific EXECUTION (not the
/// change request directly) via
/// POST /api/msp/change-control/executions/:id/pir — the real close-code
/// review that turns a completed change into a REVIEWED one.
/// </summary>
public sealed class ChangeRequestPir
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("executionId")]
    public int ExecutionId { get; set; }

    [JsonPropertyName("changeRequestId")]
    public int ChangeRequestId { get; set; }

    [JsonPropertyName("changeCode")]
    public string ChangeCode { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    /// <summary>"successful" | "successful_with_issues" | "failed" | "rolled_back".</summary>
    [JsonPropertyName("closeCode")]
    public string CloseCode { get; set; } = string.Empty;

    [JsonPropertyName("summary")]
    public string Summary { get; set; } = string.Empty;

    [JsonPropertyName("issuesNoted")]
    public string? IssuesNoted { get; set; }

    [JsonPropertyName("reviewedBy")]
    public string ReviewedBy { get; set; } = string.Empty;

    [JsonPropertyName("reviewedByPersonId")]
    public string? ReviewedByPersonId { get; set; }

    [JsonPropertyName("reviewedAt")]
    public DateTimeOffset ReviewedAt { get; set; }

    [JsonPropertyName("driftRescan")]
    public PirDriftRescan DriftRescan { get; set; } = new();

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>The honest drift-rescan boundary (#1502's own header): real only for
/// Conditional Access changes today; every other category records
/// `not_applicable` rather than a fake pass.</summary>
public sealed class PirDriftRescan
{
    [JsonPropertyName("applicable")]
    public bool Applicable { get; set; }

    [JsonPropertyName("domainKey")]
    public string? DomainKey { get; set; }

    [JsonPropertyName("checkKey")]
    public string? CheckKey { get; set; }

    /// <summary>e.g. "not_applicable" | "clean" | "drift_detected" | ...
    /// (CR_PIR_DRIFT_RESCAN_STATUSES) — kept as a free string client-side rather
    /// than an enum since this app does not otherwise branch on it, only
    /// displays it.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("eventsInsertedCount")]
    public int? EventsInsertedCount { get; set; }

    [JsonPropertyName("attributedCount")]
    public int? AttributedCount { get; set; }

    [JsonPropertyName("otherOpenDriftCount")]
    public int? OtherOpenDriftCount { get; set; }

    [JsonPropertyName("note")]
    public string? Note { get; set; }

    [JsonPropertyName("ranAt")]
    public DateTimeOffset? RanAt { get; set; }
}

public sealed class ChangeRequestPirResponse
{
    [JsonPropertyName("pir")]
    public ChangeRequestPir? Pir { get; set; }
}

public sealed class ChangeRequestPirListResponse
{
    [JsonPropertyName("pirs")]
    public System.Collections.Generic.List<ChangeRequestPir> Pirs { get; set; } = new();
}

public sealed class ChangeRequestExecutionListResponse
{
    [JsonPropertyName("executions")]
    public System.Collections.Generic.List<ChangeRequestExecution> Executions { get; set; } = new();
}
