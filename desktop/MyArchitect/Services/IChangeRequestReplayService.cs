using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// #3459 "Replay last run" for catalog-backed actions: re-fetches the most recent real
/// msp_change_requests row for a tenant + catalog action from the existing, real
/// GET /api/msp/change-requests endpoint, so a future Console UI panel (blocked on #3493) can
/// re-populate parameters from it. Ad-hoc console commands have no catalog/backend equivalent —
/// see <see cref="IConsoleHistoryService"/> for those.
/// </summary>
public interface IChangeRequestReplayService
{
    /// <summary>Returns the most recent change request's proposed_payload for this tenant +
    /// catalog action, or null if none exists yet. Never fabricates a result.</summary>
    Task<ChangeRequestReplayResult?> GetLastRunAsync(Tenant tenant, int catalogItemId, CancellationToken cancellationToken = default);
}
