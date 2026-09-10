using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire models for the real MSP Audit Log route (#3489, <c>msp-audit-log.ts</c>). The route
/// serializes <c>msp_audit_logs</c> rows with UI-friendly field aliases (<c>actionType</c> →
/// <c>action</c>, <c>entityLabel</c> → <c>resource</c>, <c>occurredAt</c> → <c>createdAt</c>) —
/// these mirror that exact shape, no new schema, no fixture. Gated by
/// <c>requireCapability("ladder.msp-admin")</c>: PlatformAdmin sees every MSP's entries and may
/// pass <c>mspId</c> to scope to one; an ordinary MSP admin is always scoped server-side to their
/// own MSP regardless of what's requested.
/// </summary>
public sealed class AuditLogEntry
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("eventId")]
    public string? EventId { get; set; }

    [JsonPropertyName("actorEmail")]
    public string? ActorEmail { get; set; }

    [JsonPropertyName("actorName")]
    public string? ActorName { get; set; }

    [JsonPropertyName("actorRole")]
    public string? ActorRole { get; set; }

    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty;

    [JsonPropertyName("resource")]
    public string? Resource { get; set; }

    [JsonPropertyName("detail")]
    public string? Detail { get; set; }

    [JsonPropertyName("outcome")]
    public string? Outcome { get; set; }

    [JsonPropertyName("createdAt")]
    public string CreatedAt { get; set; } = string.Empty;
}

/// <summary>The GET /api/msp/audit envelope.</summary>
public sealed class AuditLogPage
{
    [JsonPropertyName("entries")]
    public List<AuditLogEntry> Entries { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }
}

/// <summary>Real query filters the route honors (<c>mspId</c> is the "tenant" filter — enforced
/// server-side to PlatformAdmin only, a non-admin's value is silently ignored by the route, not
/// rejected). <see cref="Page"/> defaults to 1, <see cref="Limit"/> to the route's own default of
/// 30 (server clamps to 100 max) when left null.</summary>
public sealed class AuditLogFilter
{
    public string? MspId { get; set; }
    public string? ActionType { get; set; }
    public string? Outcome { get; set; }
    public string? Search { get; set; }
    public int? Page { get; set; }
    public int? Limit { get; set; }
}
