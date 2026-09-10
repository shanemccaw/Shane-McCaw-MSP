using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from `sla_policies` (msp-sla.ts <c>GET /api/msp/sla/policies</c>). MSP-wide — not
/// scoped to a selected tenant (a policy applies across the book, or is a global default when
/// <see cref="MspId"/> is null).
/// </summary>
public sealed class SlaPolicy
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("mspId")]
    public int? MspId { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("responseTimeMinutes")]
    public int ResponseTimeMinutes { get; set; }

    [JsonPropertyName("warningThresholdPct")]
    public int WarningThresholdPct { get; set; }

    [JsonPropertyName("resolutionTimeMinutes")]
    public int ResolutionTimeMinutes { get; set; }

    [JsonPropertyName("resolutionWarningThresholdPct")]
    public int ResolutionWarningThresholdPct { get; set; }

    [JsonPropertyName("priority")]
    public string Priority { get; set; } = string.Empty;

    [JsonPropertyName("isActive")]
    public bool IsActive { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>One row from `sla_breaches` (msp-sla.ts <c>GET /api/msp/sla/breaches</c>). Carries the
/// real numeric <see cref="CustomerId"/> and <see cref="TimerId"/> — the latter is what
/// <c>POST /api/msp/sla/timers/:timerId/resolve</c> actually needs.</summary>
public sealed class SlaBreach
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("breachId")]
    public string BreachId { get; set; } = string.Empty;

    [JsonPropertyName("timerId")]
    public string TimerId { get; set; } = string.Empty;

    [JsonPropertyName("mspId")]
    public int MspId { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("policyId")]
    public int? PolicyId { get; set; }

    [JsonPropertyName("ticketRef")]
    public string? TicketRef { get; set; }

    [JsonPropertyName("phase")]
    public string Phase { get; set; } = string.Empty;

    [JsonPropertyName("breachType")]
    public string? BreachType { get; set; }

    [JsonPropertyName("elapsedMinutes")]
    public double ElapsedMinutes { get; set; }

    [JsonPropertyName("thresholdMinutes")]
    public double ThresholdMinutes { get; set; }

    [JsonPropertyName("operatorTaskId")]
    public string? OperatorTaskId { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTimeOffset? ResolvedAt { get; set; }

    [JsonPropertyName("resolutionNotes")]
    public string? ResolutionNotes { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>One row from `sla_escalations` (msp-sla.ts <c>GET /api/msp/sla/escalations</c>) —
/// always pending/in_progress (the route only returns open ones).</summary>
public sealed class SlaEscalation
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("escalationId")]
    public string EscalationId { get; set; } = string.Empty;

    [JsonPropertyName("breachId")]
    public string? BreachId { get; set; }

    [JsonPropertyName("mspId")]
    public int MspId { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("level")]
    public int Level { get; set; }

    [JsonPropertyName("escalationType")]
    public string? EscalationType { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("assignedTo")]
    public string? AssignedTo { get; set; }

    [JsonPropertyName("target")]
    public string? Target { get; set; }

    [JsonPropertyName("escalatedAt")]
    public DateTimeOffset? EscalatedAt { get; set; }

    [JsonPropertyName("resolvedAt")]
    public DateTimeOffset? ResolvedAt { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>One row from `sla_compliance_records` (msp-sla.ts <c>GET /api/msp/sla/compliance</c>)
/// — a monthly (or otherwise periodic) compliance snapshot, read-only reporting.</summary>
public sealed class SlaComplianceRecord
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("recordId")]
    public string RecordId { get; set; } = string.Empty;

    [JsonPropertyName("mspId")]
    public int MspId { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("policyId")]
    public int? PolicyId { get; set; }

    [JsonPropertyName("periodStart")]
    public DateTimeOffset PeriodStart { get; set; }

    [JsonPropertyName("periodEnd")]
    public DateTimeOffset PeriodEnd { get; set; }

    [JsonPropertyName("totalTickets")]
    public int TotalTickets { get; set; }

    [JsonPropertyName("breachedTickets")]
    public int BreachedTickets { get; set; }

    [JsonPropertyName("compliancePct")]
    public double CompliancePct { get; set; }

    [JsonPropertyName("avgResponseMinutes")]
    public double? AvgResponseMinutes { get; set; }

    [JsonPropertyName("avgResolutionMinutes")]
    public double? AvgResolutionMinutes { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>One tracked M365 service's 30/90-day uptime for one customer, from
/// <c>GET /api/msp/m365-sla</c> (msp-m365-sla.ts) — Microsoft's own third-party uptime
/// commitment, unrelated to the internal ticket-SLA domain above despite the shared name.</summary>
public sealed class M365SlaService
{
    [JsonPropertyName("serviceName")]
    public string ServiceName { get; set; } = string.Empty;

    [JsonPropertyName("uptimePercent30d")]
    public double? UptimePercent30d { get; set; }

    [JsonPropertyName("uptimePercent90d")]
    public double? UptimePercent90d { get; set; }

    [JsonPropertyName("breached30d")]
    public bool Breached30d { get; set; }

    [JsonPropertyName("breached90d")]
    public bool Breached90d { get; set; }
}

/// <summary>One customer's M365 SLA row from <c>GET /api/msp/m365-sla</c> — carries the real
/// <see cref="TenantId"/> GUID, which (unlike the internal ticket-SLA rows above) lets this app
/// filter to the selected tenant via <c>ITenantService.CurrentTenant.TenantGuid</c> today, no
/// numeric customer id needed.</summary>
public sealed class M365SlaCustomer
{
    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("customerName")]
    public string CustomerName { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("services")]
    public List<M365SlaService> Services { get; set; } = new();
}

public sealed class SlaPoliciesResponse
{
    [JsonPropertyName("policies")]
    public List<SlaPolicy> Policies { get; set; } = new();
}

public sealed class SlaBreachesResponse
{
    [JsonPropertyName("breaches")]
    public List<SlaBreach> Breaches { get; set; } = new();
}

public sealed class SlaEscalationsResponse
{
    [JsonPropertyName("escalations")]
    public List<SlaEscalation> Escalations { get; set; } = new();
}

public sealed class SlaComplianceResponse
{
    [JsonPropertyName("records")]
    public List<SlaComplianceRecord> Records { get; set; } = new();
}

public sealed class M365SlaResponse
{
    [JsonPropertyName("target")]
    public double Target { get; set; }

    [JsonPropertyName("customers")]
    public List<M365SlaCustomer> Customers { get; set; } = new();
}

/// <summary>POST /api/msp/sla/timers/:timerId/resolve response — <c>{ resolved: boolean }</c>.</summary>
public sealed class SlaTimerResolveResult
{
    [JsonPropertyName("resolved")]
    public bool Resolved { get; set; }
}
