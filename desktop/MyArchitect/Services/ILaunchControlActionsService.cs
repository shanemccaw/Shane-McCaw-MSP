using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing write_action_catalog + baseline_action_templates
/// listing endpoint (GET /api/msp/:mspId/launch-control/actions). MyArchitect's
/// Script Library (#3460) is a client to this endpoint, not a second catalog — see
/// the issue's own "corrected" audit note.
/// </summary>
public interface ILaunchControlActionsService
{
    /// <summary>
    /// Fetches the entitlement-resolved action catalog for one MSP+customer pair.
    /// Served from cache when a fresh-enough entry exists unless
    /// <paramref name="forceRefresh"/> is set.
    /// </summary>
    Task<LaunchControlCatalog> GetActionsAsync(
        int mspId,
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);

    /// <summary>Drops any cached entry for this MSP+customer pair so the next
    /// call is guaranteed to hit the real endpoint.</summary>
    void InvalidateCache(int mspId, int customerId);
}
