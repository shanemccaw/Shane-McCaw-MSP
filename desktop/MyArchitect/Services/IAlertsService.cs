using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing Cross-Tenant Alerts endpoints (msp-alerts.ts, #3483) — the
/// Watch tab's "what needs my attention" surface (UI_RULES.md §2), across every customer in
/// the signed-in operator's own MSP.
/// </summary>
public interface IAlertsService
{
    /// <summary>Bearer token attached to every request, sourced from <see cref="IAuthService"/>
    /// the same way every other service's <c>AuthToken</c> is (#3501). Gated by
    /// requireCapability("ladder.msp-operator"), so a call made with this unset will
    /// legitimately 401/403 rather than succeed.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/alerts — the merged, already-triaged, severity-ranked feed.
    /// mspId is resolved server-side from the JWT; no tenant/customer id is required to see the
    /// whole book, which is the point of a cross-tenant feed. All filters are optional and map
    /// straight onto the route's own query params.</summary>
    Task<AlertsPayload> GetAlertsAsync(
        string? severity = null,
        string? category = null,
        int? customerId = null,
        int limit = 50,
        int offset = 0,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/alerts/:alertId/acknowledge. Only real for a "incident-*" id — a
    /// "finding-*" id gets a real 400 back from the server (see msp-alerts.ts's own header: no
    /// per-item resolution mechanism exists for diagnostic findings yet), surfaced via
    /// <see cref="AlertsServiceException"/> rather than guessed at client-side.</summary>
    Task<AcknowledgeAlertResult> AcknowledgeAlertAsync(string alertId, CancellationToken cancellationToken = default);

    /// <summary>Drops the short-TTL cache so the next <see cref="GetAlertsAsync"/> call is a
    /// real, fresh GET — called automatically after a successful acknowledge.</summary>
    void InvalidateCache();
}
