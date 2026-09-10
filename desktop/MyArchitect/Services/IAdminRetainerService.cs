using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing admin retainer ledger (`admin-retainer.ts`) —
/// the ad-hoc half of #3464's real hour-logging scope. Work not tied to a
/// tracker step (see <see cref="IRemediationTrackerService"/>) or a change
/// request (see <see cref="IChangeControlService"/>) logs here instead.
/// </summary>
public interface IAdminRetainerService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). This route is
    /// gated by `requireAdmin` (platform-admin role) — a different, narrower gate than the
    /// `ladder.msp-operator` capability the remediation-tracker/change-control routes use — so a
    /// signed-in operator without the admin role will legitimately 403 here even while other
    /// MSP-scoped calls succeed.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// POST /api/admin/retainer/:customerId/unscoped — logs ad-hoc hours not
    /// tied to any tracked item. <paramref name="item"/> and
    /// <paramref name="hours"/> are required; <paramref name="pillar"/>,
    /// <paramref name="finding"/> and <paramref name="outcome"/> are optional
    /// free text, matching the server's own `unscopedSchema`.
    /// </summary>
    Task<RetainerWorkLogEntry> LogUnscopedHoursAsync(
        int customerId,
        string item,
        double hours,
        string? pillar = null,
        string? finding = null,
        string? outcome = null,
        CancellationToken cancellationToken = default);
}
