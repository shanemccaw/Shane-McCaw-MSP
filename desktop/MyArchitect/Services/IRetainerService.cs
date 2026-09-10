using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing retainer endpoint (GET /api/admin/retainer/:customerId,
/// admin-retainer.ts) — Plan Awareness &amp; Hour Utilization (#3474) is a client to this
/// endpoint, not a second computation of the same numbers. Per #3474's own audit, no new
/// backend surface was needed for this Feature; #3473 fixed the endpoint's period logic
/// (anniversary-based, not calendar-month) before this client was built against it.
/// </summary>
public interface IRetainerService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so this admin-gated (requireAdmin) endpoint receives a real
    /// Authorization header.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// Fetches the real settings + current-period bucket for one customer. Served from a
    /// short-TTL cache unless <paramref name="forceRefresh"/> is set — the status bar refreshes
    /// on every tenant switch, so a cache avoids re-hitting the endpoint for a customer just
    /// viewed a moment ago.
    /// </summary>
    Task<RetainerDetailResponse> GetRetainerAsync(
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);
}
