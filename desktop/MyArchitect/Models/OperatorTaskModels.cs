using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from the virtual operator task queue (msp-sla.ts <c>GET /api/msp/operator-tasks</c>)
/// — a real aggregate of unresolved SLA breaches and scope-creep violations, not its own table.
/// <see cref="Id"/> is the underlying breach_id/violation_id (text), not a numeric row id.
/// </summary>
public sealed class OperatorTask
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>"sla_breach" or "scope_creep_violation" — the real source table this task was
    /// aggregated from.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("customerId")]
    public int? CustomerId { get; set; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; set; }

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTimeOffset? ResolvedAt { get; set; }

    /// <summary>Relative Admin Panel deep link (e.g. <c>/admin-panel/#/sla</c>) to the engine
    /// detail page this task came from. Shown as reference text — MyArchitect has no generic
    /// external-URL opener wired up for admin-panel routes, so this is not clickable.</summary>
    [JsonPropertyName("deepLink")]
    public string? DeepLink { get; set; }
}

public sealed class OperatorTasksResponse
{
    [JsonPropertyName("tasks")]
    public List<OperatorTask> Tasks { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }
}
