using System.Collections.Generic;
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
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so this auth-gated endpoint receives a real Authorization header.</summary>
    string? AuthToken { get; set; }

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

    /// <summary>
    /// Runs one catalog action for real against a customer's tenant via
    /// POST /api/msp/:mspId/launch-control/execute (msp-launch-control.ts) — the
    /// Script Library's "run entries straight into the embedded Console" wiring
    /// (#3460). <paramref name="catalogActionId"/> is the write_action_catalog row's
    /// own id (not templateId, not actionName). <paramref name="variables"/> is keyed
    /// by the action's own <see cref="LaunchControlAction.RequiredVariables"/> names.
    /// The server re-validates entitlement and the isTestbed staging restriction from
    /// scratch — never trusts anything this client cached.
    /// </summary>
    Task<LaunchControlExecuteResponse> ExecuteAsync(
        int mspId,
        int catalogActionId,
        int customerId,
        IReadOnlyDictionary<string, string> variables,
        CancellationToken cancellationToken = default);
}
