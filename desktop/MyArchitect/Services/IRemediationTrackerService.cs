using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP-side remediation tracker
/// (`msp-remediation-tracker.ts`) — the checklist-style half of #3471's two
/// consumed systems. GET the customer's real step states; PUT one step's
/// status as the MSP operator working the tracker on the customer's behalf.
/// </summary>
public interface IRemediationTrackerService
{
    /// <summary>
    /// GET /api/msp/customers/:customerId/remediation-tracker — every stored
    /// step state for this customer, plus the live pricing envelope.
    /// </summary>
    Task<RemediationTrackerResponse> GetTrackerAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// PUT /api/msp/customers/:customerId/remediation-tracker/steps/:stepId —
    /// sets one step's status. <paramref name="status"/> must be one of
    /// REMEDIATION_TRACKER_STEP_STATUS minus "accepted_risk" — the server
    /// rejects "accepted_risk" here outright, it's only ever set by the
    /// customer's own signed decline-to-risk flow (see the route's own
    /// header comment).
    /// </summary>
    Task<RemediationTrackerStep> SetStepStatusAsync(
        int customerId,
        string stepId,
        string status,
        CancellationToken cancellationToken = default);
}
