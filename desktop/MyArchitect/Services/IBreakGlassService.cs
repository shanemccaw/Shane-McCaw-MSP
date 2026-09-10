using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP operator Break-Glass surface (#3480) — the four
/// <c>ladder.msp-operator</c>-gated routes in <c>msp-break-glass.ts</c>. No fixture, no local model:
/// every method reads/writes the exact same break-glass tables the customer-facing portal path and
/// the <c>break_glass_verification_gate</c> workflow node already use.
/// </summary>
public interface IBreakGlassService
{
    /// <summary>Bearer token attached to every request — sourced from the real signed-in session
    /// (<see cref="IAuthService.AccessToken"/>). Unset ⇒ a legitimate 401/403 from the gated route.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/break-glass — every currently pending_delivery secret across the caller's
    /// MSP book, honoring per-staff customer scoping server-side.</summary>
    Task<IReadOnlyList<BreakGlassPendingItem>> GetPendingAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/break-glass — full pending-secret history (any
    /// status) for one customer.</summary>
    Task<IReadOnlyList<BreakGlassSecretHistoryItem>> GetCustomerHistoryAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/break-glass/:pendingSecretId — one secret + its
    /// verification attempts.</summary>
    Task<BreakGlassSecretDetail> GetSecretDetailAsync(int customerId, int pendingSecretId, CancellationToken cancellationToken = default);

    /// <summary>POST /api/msp/customers/:customerId/break-glass/:pendingSecretId/admin-override —
    /// force-reset + reissue. <paramref name="reason"/> is required; <paramref name="emails"/>, when
    /// supplied, must be 1–5 valid addresses. Throws <see cref="BreakGlassServiceException"/> on any
    /// non-2xx (409 still-live-links / not-awaiting-delivery, 409 write-back-gate block, 5xx).</summary>
    Task<BreakGlassOverrideResult> AdminOverrideAsync(int customerId, int pendingSecretId, string reason, IReadOnlyList<string>? emails = null, CancellationToken cancellationToken = default);

    /// <summary>GET /api/msp/customers/:customerId/break-glass/audit — override audit trail for one
    /// customer.</summary>
    Task<IReadOnlyList<BreakGlassAuditEntry>> GetAuditAsync(int customerId, CancellationToken cancellationToken = default);
}
