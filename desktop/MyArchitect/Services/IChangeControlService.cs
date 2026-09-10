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

    /// <summary>
    /// GET /api/msp/change-control/executions?changeRequestId=&lt;n&gt; — every
    /// execution recorded against one change (#3482's PIR-filing checklist item
    /// needs this to find a completed execution with no PIR yet).
    /// </summary>
    Task<IReadOnlyList<ChangeRequestExecution>> GetExecutionsForChangeAsync(
        int changeRequestId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// GET /api/msp/change-control/pirs?changeRequestId=&lt;n&gt; — every
    /// Post-Implementation Review already filed for one change's executions.
    /// </summary>
    Task<IReadOnlyList<ChangeRequestPir>> GetPirsForChangeAsync(
        int changeRequestId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POST /api/msp/change-control/executions/:id/pir — files the
    /// Post-Implementation Review for a completed execution. 409s (surfaced as
    /// <see cref="ChangeControlException"/>) if that execution already has one
    /// — a correction is a new execution + a new PIR, never a rewrite.
    /// </summary>
    Task<ChangeRequestPir> RecordPirAsync(
        int executionId,
        string closeCode,
        string summary,
        string? issuesNoted = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// GET /api/msp/change-freeze-windows — every standing freeze/blackout rule
    /// for this MSP (#1500). Evaluated client-side against a specific
    /// (tenant, workload, instant) via <see cref="Models.ChangeCalendarMatching"/>
    /// — no server endpoint answers "is a freeze active right now" directly.
    /// </summary>
    Task<IReadOnlyList<ChangeFreezeWindow>> GetFreezeWindowsAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// GET /api/msp/change-maintenance-windows — every standing maintenance
    /// rule for this MSP (#1504). Same evaluation model as
    /// <see cref="GetFreezeWindowsAsync"/>.
    /// </summary>
    Task<IReadOnlyList<ChangeMaintenanceWindow>> GetMaintenanceWindowsAsync(
        CancellationToken cancellationToken = default);
}
