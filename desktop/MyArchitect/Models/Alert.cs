using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from GET /api/msp/alerts (msp-alerts.ts, #3483) — a merged, already-triaged
/// cross-tenant feed. <see cref="Source"/> is "policy_incident" (a Signal Policy Engine
/// incident; <see cref="Id"/> is "incident-&lt;n&gt;") or "diagnostic_finding" ("finding-&lt;id&gt;",
/// immutable scan output with no per-item resolution mechanism — see <see cref="Id"/>'s doc).
/// Field set mirrors the route's own <c>CrossTenantAlert</c> interface exactly.
/// </summary>
public sealed class CrossTenantAlert
{
    /// <summary>Composite id — the exact string a caller passes back to the acknowledge route.
    /// Only an "incident-*" id can actually be acknowledged today (see msp-alerts.ts's own
    /// header); a "finding-*" id returns a real 400 from the server, not a client-side guess.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    /// <summary>info | warning | critical.</summary>
    [JsonPropertyName("severity")]
    public string Severity { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("customerId")]
    public int? CustomerId { get; set; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; set; }

    [JsonPropertyName("occurredAt")]
    public DateTimeOffset OccurredAt { get; set; }

    [JsonPropertyName("escalationLevel")]
    public int? EscalationLevel { get; set; }

    [JsonPropertyName("deepLink")]
    public string? DeepLink { get; set; }
}

/// <summary>GET /api/msp/alerts response envelope — already severity-ranked/date-sorted and
/// paginated server-side.</summary>
public sealed class AlertsPayload
{
    [JsonPropertyName("alerts")]
    public List<CrossTenantAlert> Alerts { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("offset")]
    public int Offset { get; set; }
}

/// <summary>POST /api/msp/alerts/:alertId/acknowledge response.</summary>
public sealed class AcknowledgeAlertResult
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("resolvedAt")]
    public DateTimeOffset? ResolvedAt { get; set; }
}
