using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from GET /api/msp/change-freeze-windows (msp-change-freeze-windows.ts)
/// — a standing freeze/blackout rule (#1500). One row per rule, not per
/// occurrence: a recurring window is anchored at <see cref="StartsAt"/> and
/// repeats on <see cref="Recurrence"/> until <see cref="RecurrenceUntil"/> (or
/// forever). See <see cref="ChangeCalendarMatching.IsFreezeActiveAt"/> for the
/// port of the server's own occurrence-walk (portal-change-freeze.ts).
/// </summary>
public sealed class ChangeFreezeWindow
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>"global" | "tenant" | "workload".</summary>
    [JsonPropertyName("scope")]
    public string Scope { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string? TenantId { get; set; }

    /// <summary>One of CHANGE_REQUEST_WORKLOADS, e.g. "Exchange / mail".</summary>
    [JsonPropertyName("workload")]
    public string? Workload { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("startsAt")]
    public DateTimeOffset StartsAt { get; set; }

    [JsonPropertyName("endsAt")]
    public DateTimeOffset EndsAt { get; set; }

    /// <summary>"none" | "weekly" | "monthly" | "quarterly" | "annually".</summary>
    [JsonPropertyName("recurrence")]
    public string Recurrence { get; set; } = "none";

    [JsonPropertyName("recurrenceUntil")]
    public DateTimeOffset? RecurrenceUntil { get; set; }

    [JsonPropertyName("active")]
    public bool Active { get; set; }

    [JsonPropertyName("createdBy")]
    public string? CreatedBy { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ChangeFreezeWindowsResponse
{
    [JsonPropertyName("windows")]
    public System.Collections.Generic.List<ChangeFreezeWindow> Windows { get; set; } = new();
}
