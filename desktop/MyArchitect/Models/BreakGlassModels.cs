using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire models for the MSP operator Break-Glass surface (#3480) — the exact JSON shapes
/// <c>artifacts/api-server/src/routes/msp-break-glass.ts</c> serializes. No new schema, no fixture:
/// these mirror the real <c>break_glass_pending_secrets</c> / <c>break_glass_verification_attempts</c>
/// / <c>break_glass_override_audit</c> columns the route already reads. All four endpoints are gated
/// by <c>requireCapability("ladder.msp-operator")</c>, so a call made without a real operator bearer
/// token legitimately 401/403s rather than returning data.
/// </summary>

/// <summary>One row from GET /api/msp/break-glass — a currently <c>pending_delivery</c> secret across
/// the caller's whole MSP book. Carries the real numeric <see cref="CustomerId"/> (tenants.id), which
/// is what every per-customer drill-down (detail / override / audit / history) is scoped by — so the
/// operator never depends on a locally-resolved tenant id to act on one of these.</summary>
public sealed class BreakGlassPendingItem
{
    [JsonPropertyName("pendingSecretId")]
    public int PendingSecretId { get; set; }

    [JsonPropertyName("runId")]
    public string? RunId { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Verification links still in <c>pending</c> state — a still-live invite blocks an
    /// admin-override server-side (the route returns 409 "still live verification links").</summary>
    [JsonPropertyName("liveInviteCount")]
    public int LiveInviteCount { get; set; }

    [JsonPropertyName("totalInviteCount")]
    public int TotalInviteCount { get; set; }
}

/// <summary>The GET /api/msp/break-glass envelope.</summary>
public sealed class BreakGlassPendingList
{
    [JsonPropertyName("pending")]
    public List<BreakGlassPendingItem> Pending { get; set; } = new();
}

/// <summary>One row from GET /api/msp/customers/:customerId/break-glass — the full pending-secret
/// history (any status) for one customer, the "per-tenant" list half of #3480's checklist.</summary>
public sealed class BreakGlassSecretHistoryItem
{
    [JsonPropertyName("pendingSecretId")]
    public int PendingSecretId { get; set; }

    [JsonPropertyName("runId")]
    public string? RunId { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("deliveredAt")]
    public DateTimeOffset? DeliveredAt { get; set; }

    [JsonPropertyName("deliveredToEmail")]
    public string? DeliveredToEmail { get; set; }
}

/// <summary>The GET /api/msp/customers/:customerId/break-glass envelope.</summary>
public sealed class BreakGlassSecretHistory
{
    [JsonPropertyName("secrets")]
    public List<BreakGlassSecretHistoryItem> Secrets { get; set; } = new();
}

/// <summary>One verification attempt against a pending secret (from the detail endpoint's
/// <c>attempts</c> array). Never carries the link token or the encrypted secret value — the route
/// applies the same status-only read contract the customer-facing portal endpoint does.</summary>
public sealed class BreakGlassAttempt
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("invitedEmail")]
    public string? InvitedEmail { get; set; }

    /// <summary>"pending" | "expired" | "superseded" | ... — only an attempt that is NOT pending
    /// counts as terminal for the still-live check the override enforces.</summary>
    [JsonPropertyName("linkStatus")]
    public string? LinkStatus { get; set; }

    [JsonPropertyName("verificationOutcome")]
    public string? VerificationOutcome { get; set; }

    [JsonPropertyName("entraUserPrincipalName")]
    public string? EntraUserPrincipalName { get; set; }

    [JsonPropertyName("failedAttemptCount")]
    public int FailedAttemptCount { get; set; }

    [JsonPropertyName("attemptedAt")]
    public DateTimeOffset? AttemptedAt { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>GET /api/msp/customers/:customerId/break-glass/:pendingSecretId — one pending secret with
/// its verification attempts.</summary>
public sealed class BreakGlassSecretDetail
{
    [JsonPropertyName("pendingSecretId")]
    public int PendingSecretId { get; set; }

    [JsonPropertyName("runId")]
    public string? RunId { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("deliveredAt")]
    public DateTimeOffset? DeliveredAt { get; set; }

    [JsonPropertyName("deliveredToEmail")]
    public string? DeliveredToEmail { get; set; }

    [JsonPropertyName("attempts")]
    public List<BreakGlassAttempt> Attempts { get; set; } = new();
}

/// <summary>The success body of POST .../admin-override — mirrors the route's
/// <c>AdminOverrideResult</c> ok-branch (<c>{ ok, newPendingSecretId, reissued, sent }</c>). Refusals
/// (409/502/503) and write-back-gate blocks (409 with <c>blockedBy</c>) come back as non-2xx and are
/// surfaced through <see cref="BreakGlassServiceException"/> instead.</summary>
public sealed class BreakGlassOverrideResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("newPendingSecretId")]
    public int NewPendingSecretId { get; set; }

    [JsonPropertyName("reissued")]
    public int Reissued { get; set; }

    [JsonPropertyName("sent")]
    public int Sent { get; set; }
}

/// <summary>One row from GET /api/msp/customers/:customerId/break-glass/audit — the override audit
/// trail, with the acting admin's display name already resolved server-side.</summary>
public sealed class BreakGlassAuditEntry
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("adminUserId")]
    public int AdminUserId { get; set; }

    [JsonPropertyName("adminName")]
    public string AdminName { get; set; } = string.Empty;

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("oldPendingSecretId")]
    public int? OldPendingSecretId { get; set; }

    [JsonPropertyName("newPendingSecretId")]
    public int? NewPendingSecretId { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>The GET .../break-glass/audit envelope.</summary>
public sealed class BreakGlassAuditTrail
{
    [JsonPropertyName("audit")]
    public List<BreakGlassAuditEntry> Audit { get; set; } = new();
}
