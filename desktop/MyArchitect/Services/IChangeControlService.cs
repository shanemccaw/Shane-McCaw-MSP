using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP change-control surface
/// (`msp-changes.ts` + `msp-change-executions.ts`) — the catalog-backed half
/// of #3471's two consumed systems. Real execution records, real
/// human-action attestation, real rollback support already exists server
/// side; this is the client MyArchitect calls it through.
/// </summary>
public interface IChangeControlService
{
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so these auth-gated change-control endpoints receive a real
    /// Authorization header.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// GET /api/msp/change-requests — the caller's full MSP change-request
    /// queue. That route has no per-tenant filter server-side, so when
    /// <paramref name="tenantGuid"/> is supplied the result is filtered
    /// client-side to that tenant's rows only (same approach #3459's
    /// ChangeRequestReplayService already takes against this endpoint);
    /// pass null to get every change request for the MSP.
    /// </summary>
    Task<IReadOnlyList<ChangeRequest>> GetChangeRequestsAsync(
        string? tenantGuid = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /api/msp/change-control/executions/human-action — records (and
    /// attests, at record time) that a human carried out
    /// <paramref name="changeRequestId"/>. Use
    /// <see cref="ChangeRequest.NumericId"/> to get the numeric id this
    /// expects from a <see cref="ChangeRequest.Id"/> string.
    /// </summary>
    Task<ChangeRequestExecution> RecordHumanActionAsync(
        int changeRequestId,
        string? implementer = null,
        string? attestationNote = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /api/msp/change-control/executions/:id/attest — attests a
    /// previously recorded, still-unattested human action execution.
    /// </summary>
    Task<ChangeRequestExecution> AttestExecutionAsync(
        int executionId,
        string? attestationNote = null,
        CancellationToken cancellationToken = default);
}
