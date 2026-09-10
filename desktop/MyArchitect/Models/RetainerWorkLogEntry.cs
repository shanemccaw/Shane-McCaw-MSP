using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One `retainer_work_log` row, wire-mapped by `entryToWire` in
/// `admin-retainer.ts` — no field invented here that the endpoint doesn't
/// already send. Returned by every admin-retainer write (including
/// POST .../unscoped) and by the GET ledger reads.
/// </summary>
public sealed class RetainerWorkLogEntry
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("periodMonth")]
    public string PeriodMonth { get; set; } = string.Empty;

    [JsonPropertyName("week")]
    public string Week { get; set; } = string.Empty;

    [JsonPropertyName("item")]
    public string Item { get; set; } = string.Empty;

    /// <summary>Decimal hours — the wire unit. Stored server-side as integer minutes.</summary>
    [JsonPropertyName("hours")]
    public double Hours { get; set; }

    [JsonPropertyName("minutes")]
    public int Minutes { get; set; }

    [JsonPropertyName("pillar")]
    public string? Pillar { get; set; }

    [JsonPropertyName("pillarColor")]
    public string? PillarColor { get; set; }

    [JsonPropertyName("finding")]
    public string? Finding { get; set; }

    [JsonPropertyName("outcome")]
    public string? Outcome { get; set; }

    /// <summary>Display label from RETAINER_STATE_DISPLAY (e.g. "In Progress").</summary>
    [JsonPropertyName("state")]
    public string State { get; set; } = string.Empty;

    /// <summary>Raw stored enum value — "in_progress" | "closed" | "in_review" | "scheduled".</summary>
    [JsonPropertyName("stateStored")]
    public string StateStored { get; set; } = string.Empty;

    /// <summary>"unscoped" for ad-hoc entries logged via this client; "remediation_tracker" /
    /// other values for entries logged as a byproduct of other flows.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    [JsonPropertyName("sourceRefId")]
    public string? SourceRefId { get; set; }

    [JsonPropertyName("occurredAt")]
    public DateTimeOffset OccurredAt { get; set; }
}

/// <summary>Envelope for POST .../unscoped — `{ entry: {...} }`.</summary>
public sealed class RetainerWorkLogEntryResponse
{
    [JsonPropertyName("entry")]
    public RetainerWorkLogEntry? Entry { get; set; }
}
