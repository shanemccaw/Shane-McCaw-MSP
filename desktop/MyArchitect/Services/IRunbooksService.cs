using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP-console Runbooks endpoints
/// (msp-runbooks.ts, #2669): a customer's Active Runbooks + run history,
/// step completion on a live cycle, and hold-window extend + audit trail.
/// #3479's own real remaining scope (Client: GET runbooks, PUT step
/// completion, hold-window extend + audit view) is exactly this service,
/// now wired into #3493's real shell (Console tab galleries + record
/// workspaces) in MainWindow.
/// </summary>
public interface IRunbooksService
{
    /// <summary>Bearer token attached to every request — set from <see cref="MyArchitect.MainWindow"/>'s
    /// single auth-fanout point (<c>ApplyAuthState</c>) alongside every other MSP-console service.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// Fetches a customer's runbooks + run history (GET /api/msp/runbooks).
    /// Served from cache when a fresh-enough entry exists unless
    /// <paramref name="forceRefresh"/> is set.
    /// </summary>
    Task<RunbooksPayload> GetRunbooksAsync(
        int mspId,
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks (or un-marks) a step complete on a runbook's current live cycle
    /// (PUT /api/msp/runbooks/:runbookId/steps/:position). Invalidates the
    /// cached payload for this MSP+customer pair on success.
    /// </summary>
    Task<StepCompletionResult> SetStepCompletionAsync(
        int mspId,
        int customerId,
        int runbookId,
        int position,
        bool isChecked,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Extends a hold window by a number of days, with a required reason
    /// (POST /api/msp/hold-windows/:holdId/extend). Invalidates the cached
    /// payload for this MSP+customer pair on success.
    /// </summary>
    Task<ExtendHoldWindowResult> ExtendHoldWindowAsync(
        int mspId,
        int customerId,
        int holdId,
        int days,
        string reason,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads a hold window's decision audit trail
    /// (GET /api/msp/hold-windows/:holdId/events). Always hits the endpoint —
    /// an audit trail is never served stale from cache.
    /// </summary>
    Task<HoldWindowEventsResponse> GetHoldWindowEventsAsync(
        int mspId,
        int customerId,
        int holdId,
        CancellationToken cancellationToken = default);

    /// <summary>Drops any cached runbooks payload for this MSP+customer pair
    /// so the next <see cref="GetRunbooksAsync"/> call is guaranteed to hit
    /// the real endpoint.</summary>
    void InvalidateCache(int mspId, int customerId);
}
