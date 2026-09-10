using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from the real `msp_poams` table (msp-poams.ts, Git #3080/#1935) —
/// MSP-authored Plan of Action &amp; Milestones. Field set mirrors
/// <c>lib/db/src/schema/msp.ts</c>'s <c>mspPoamsTable</c> exactly (camelCase,
/// as Drizzle/Express actually serialize it). <see cref="Milestones"/> is only
/// populated by <c>GET /api/msp/poams/:poamId</c> — the list route
/// (<c>GET /api/msp/poams</c>) never includes it.
/// </summary>
public sealed class Poam
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("mspId")]
    public int MspId { get; set; }

    /// <summary>Human-facing container id, e.g. "POAM-2026-014".</summary>
    [JsonPropertyName("poamId")]
    public string PoamId { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("tenantName")]
    public string TenantName { get; set; } = string.Empty;

    [JsonPropertyName("primaryDomain")]
    public string PrimaryDomain { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("weaknessDescription")]
    public string WeaknessDescription { get; set; } = string.Empty;

    [JsonPropertyName("checkKey")]
    public string? CheckKey { get; set; }

    [JsonPropertyName("additionalCheckKeys")]
    public List<string>? AdditionalCheckKeys { get; set; }

    /// <summary>The current, live target — the one date that ever moves after creation. ISO
    /// "YYYY-MM-DD" (a Postgres `date`, not a timestamp).</summary>
    [JsonPropertyName("scheduledCompletionDate")]
    public string ScheduledCompletionDate { get; set; } = string.Empty;

    /// <summary>Set once at creation, never rewritten — see msp-poams.ts's own header.</summary>
    [JsonPropertyName("originalScheduledCompletionDate")]
    public string OriginalScheduledCompletionDate { get; set; } = string.Empty;

    [JsonPropertyName("interimCompensatingControl")]
    public string InterimCompensatingControl { get; set; } = string.Empty;

    [JsonPropertyName("resourcesRequired")]
    public string ResourcesRequired { get; set; } = string.Empty;

    /// <summary>POAM_STATUSES: draft | pending_signature | active | completed | cancelled |
    /// converted_to_risk_acceptance.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("authorizingWorkloadId")]
    public string? AuthorizingWorkloadId { get; set; }

    [JsonPropertyName("authorizingWorkloadLabel")]
    public string? AuthorizingWorkloadLabel { get; set; }

    [JsonPropertyName("signedAt")]
    public DateTimeOffset? SignedAt { get; set; }

    [JsonPropertyName("signedStatement")]
    public string? SignedStatement { get; set; }

    [JsonPropertyName("sowId")]
    public Guid? SowId { get; set; }

    [JsonPropertyName("convertedToRiskDecisionId")]
    public int? ConvertedToRiskDecisionId { get; set; }

    [JsonPropertyName("conversionReason")]
    public string? ConversionReason { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Only present on <c>GET /api/msp/poams/:poamId</c>'s response
    /// (<c>{ ...existing, milestones }</c>) — null on the list route.</summary>
    [JsonPropertyName("milestones")]
    public List<PoamMilestone>? Milestones { get; set; }
}

/// <summary>One row from `msp_poam_milestones` (msp-poams.ts). Own due date and completion
/// state, independent of the parent POA&amp;M's own <see cref="Poam.ScheduledCompletionDate"/>
/// / <see cref="Poam.Status"/>.</summary>
public sealed class PoamMilestone
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("poamId")]
    public int PoamId { get; set; }

    [JsonPropertyName("sortOrder")]
    public int SortOrder { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>ISO "YYYY-MM-DD".</summary>
    [JsonPropertyName("dueDate")]
    public string DueDate { get; set; } = string.Empty;

    /// <summary>POAM_MILESTONE_STATUSES: pending | completed.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = "pending";

    /// <summary>Null until marked complete; never rewritten after (write-once, enforced at the
    /// route — see msp-poams.ts's PATCH milestone handler).</summary>
    [JsonPropertyName("completedAt")]
    public DateTimeOffset? CompletedAt { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>POST /api/msp/poams response.</summary>
public sealed class CreatePoamResult
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("poamId")]
    public string PoamId { get; set; } = string.Empty;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}

/// <summary>PATCH /api/msp/poams/:poamId and .../cancel share this response shape.</summary>
public sealed class PoamActionResult
{
    [JsonPropertyName("poamId")]
    public string PoamId { get; set; } = string.Empty;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}

/// <summary>POST/PATCH/DELETE .../milestones[/:milestoneId] share this response shape.</summary>
public sealed class MilestoneActionResult
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}
