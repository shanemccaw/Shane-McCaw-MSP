using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP operator Tenant Consent Status surface (#3485) — the six
/// <c>ladder.msp-operator</c>-gated routes in <c>msp-consent.ts</c>. No fixture, no local model:
/// every method reads/writes the exact same <c>tenants.consent</c> jsonb column the customer-facing
/// consent flow and PlatformAdmin's own <c>/api/admin/consent</c> already use.
/// </summary>
public interface IConsentService
{
    /// <summary>Bearer token attached to every request — sourced from the real signed-in session
    /// (<see cref="IAuthService.AccessToken"/>). Unset ⇒ a legitimate 401/403 from the gated route.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/consent — consent status (all three grant keys) for every tenant in
    /// the caller's own MSP book that has at least one grant record.</summary>
    Task<IReadOnlyList<CustomerConsentSummary>> GetAllAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/consent — single-customer detail across all
    /// three grant keys.</summary>
    Task<CustomerConsentSummary> GetForCustomerAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/customers/:customerId/consent/invite-link — mints a single-use
    /// read (graph) consent invite URL. <paramref name="ttlHours"/> defaults server-side to 72
    /// (clamped 1–168) when omitted.</summary>
    Task<ConsentInviteLinkResult> CreateInviteLinkAsync(int customerId, int? ttlHours = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/write-consent/start — mints a write-back
    /// consent invite URL. 503 if MT_APP_WRITE_CLIENT_ID isn't configured.</summary>
    Task<ConsentStartResult> StartWriteConsentAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/sharepoint-consent/start — mints a SharePoint
    /// consent invite URL. 503 if MT_APP_CLIENT_ID isn't configured.</summary>
    Task<ConsentSharePointStartResult> StartSharePointConsentAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>PATCH /api/msp/customers/:customerId/consent/revoke — force-revoke one grant
    /// (<paramref name="key"/>: "graph" | "writeBack" | "sharepoint").</summary>
    Task<ConsentRevokeResult> RevokeAsync(int customerId, string key, CancellationToken cancellationToken = default);
}
