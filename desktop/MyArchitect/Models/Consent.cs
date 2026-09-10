using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire models for the MSP operator Tenant Consent Status surface (#3485) — the exact JSON
/// shapes <c>artifacts/api-server/src/routes/msp-consent.ts</c> serializes. All three grant keys
/// (<c>graph</c> read, <c>writeBack</c>, <c>sharepoint</c>) live in the same
/// <c>tenants.consent</c> jsonb column server-side (<c>TenantConsentMap</c>,
/// <c>lib/db/src/schema/msp.ts</c>) — this file mirrors that shape, it never invents a fourth.
/// Every route is gated by <c>requireCapability("ladder.msp-operator")</c>, so a call made
/// without a real operator bearer token legitimately 401/403s rather than returning data.
/// </summary>

/// <summary>One consent grant's real state (<c>consentRow()</c> in <c>consent.ts</c>) — null when
/// no consent flow has ever been started for that key on that tenant.</summary>
public sealed class ConsentGrant
{
    /// <summary>"pending" | "granted" | "declined" | "revoked".</summary>
    [JsonPropertyName("consentStatus")]
    public string ConsentStatus { get; set; } = string.Empty;

    [JsonPropertyName("consentedAt")]
    public string? ConsentedAt { get; set; }

    [JsonPropertyName("revokedAt")]
    public string? RevokedAt { get; set; }

    [JsonPropertyName("adminEmail")]
    public string? AdminEmail { get; set; }

    [JsonPropertyName("adminDisplayName")]
    public string? AdminDisplayName { get; set; }

    /// <summary>Graph/write-back: OAuth scopes granted. SharePoint: application permissions
    /// granted.</summary>
    [JsonPropertyName("grants")]
    public List<string> Grants { get; set; } = new();
}

/// <summary>One row from GET /api/msp/consent (list) or the full body of
/// GET /api/msp/customers/:customerId/consent (single). Carries the real numeric
/// <see cref="CustomerId"/> (tenants.id) — every per-customer action (invite-link, write/SharePoint
/// consent start, revoke) is scoped by this, never a locally-resolved tenant id.</summary>
public sealed class CustomerConsentSummary
{
    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("tenantId")]
    public string? TenantId { get; set; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset? UpdatedAt { get; set; }

    [JsonPropertyName("graph")]
    public ConsentGrant? Graph { get; set; }

    [JsonPropertyName("writeBack")]
    public ConsentGrant? WriteBack { get; set; }

    [JsonPropertyName("sharepoint")]
    public ConsentGrant? Sharepoint { get; set; }
}

/// <summary>POST /api/msp/customers/:customerId/consent/invite-link response — a single-use
/// read (graph) consent invite URL.</summary>
public sealed class ConsentInviteLinkResult
{
    [JsonPropertyName("consentUrl")]
    public string ConsentUrl { get; set; } = string.Empty;

    [JsonPropertyName("token")]
    public string? Token { get; set; }

    [JsonPropertyName("expiresAt")]
    public DateTimeOffset ExpiresAt { get; set; }

    [JsonPropertyName("scopes")]
    public List<string>? Scopes { get; set; }
}

/// <summary>GET /api/msp/customers/:customerId/write-consent/start response.</summary>
public sealed class ConsentStartResult
{
    [JsonPropertyName("consentUrl")]
    public string ConsentUrl { get; set; } = string.Empty;

    [JsonPropertyName("expiresAt")]
    public DateTimeOffset ExpiresAt { get; set; }
}

/// <summary>GET /api/msp/customers/:customerId/sharepoint-consent/start response — same shape as
/// <see cref="ConsentStartResult"/> plus the real permission list being requested.</summary>
public sealed class ConsentSharePointStartResult
{
    [JsonPropertyName("consentUrl")]
    public string ConsentUrl { get; set; } = string.Empty;

    [JsonPropertyName("expiresAt")]
    public DateTimeOffset ExpiresAt { get; set; }

    [JsonPropertyName("permissions")]
    public List<string>? Permissions { get; set; }
}

/// <summary>PATCH /api/msp/customers/:customerId/consent/revoke response.</summary>
public sealed class ConsentRevokeResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;
}
