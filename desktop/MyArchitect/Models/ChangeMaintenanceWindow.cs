using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from GET /api/msp/change-maintenance-windows
/// (msp-change-maintenance-windows.ts) — a standing maintenance-window rule
/// (#1504), the OPPOSITE calendar to <see cref="ChangeFreezeWindow"/>: a
/// maintenance window is when change is EXPECTED, a freeze window is when it
/// is FORBIDDEN. Same shape, same recurrence encoding.
/// </summary>
public sealed class ChangeMaintenanceWindow
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>"global" | "tenant" | "workload".</summary>
    [JsonPropertyName("scope")]
    public string Scope { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string? TenantId { get; set; }

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

public sealed class ChangeMaintenanceWindowsResponse
{
    [JsonPropertyName("windows")]
    public System.Collections.Generic.List<ChangeMaintenanceWindow> Windows { get; set; } = new();
}
