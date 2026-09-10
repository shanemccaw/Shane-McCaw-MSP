using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP Audit Log route (#3489, <c>ladder.msp-admin</c>-gated
/// <c>msp-audit-log.ts</c>). No fixture, no local model — reads the exact same
/// <c>msp_audit_logs</c> rows the route serializes.
/// </summary>
public interface IAuditLogService
{
    /// <summary>Bearer token attached to every request — sourced from the real signed-in session
    /// (<see cref="IAuthService.AccessToken"/>). Unset ⇒ a legitimate 401/403 from the gated route.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /api/msp/audit — a filtered, paged page of the caller's real audit trail.
    /// PlatformAdmin sees every MSP's entries (optionally scoped by <see cref="AuditLogFilter.MspId"/>);
    /// an ordinary MSP admin is always scoped server-side to their own MSP.</summary>
    Task<AuditLogPage> GetAuditLogAsync(AuditLogFilter filter, CancellationToken cancellationToken = default);
}
