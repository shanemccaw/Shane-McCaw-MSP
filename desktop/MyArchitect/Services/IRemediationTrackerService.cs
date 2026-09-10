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
    /// <summary>Bearer access token from the real MyArchitect session (#3501). Set by the shell
    /// on sign-in/refresh so these auth-gated tracker endpoints receive a real Authorization
    /// header.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// GET /api/msp/customers/:customerId/remediation-tracker — every stored
    /// step state for this customer, plus the live pricing envelope.
    /// </summary>
    Task<RemediationTrackerResponse> GetTrackerAsync(int customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// GET /api/msp/customers/:customerId/remediation-tracker/catalogue —
    /// all 28 real steps with their real title/pillar text, each joined with
    /// this customer's real state (untouched steps default to
    /// "not_started"/"unverified" rather than being omitted). This is what
    /// #3471's unified item browser reads for the checklist-style half of
    /// its two sources — the plain <see cref="GetTrackerAsync"/> response
    /// carries no human title.
    /// </summary>
    Task<RemediationTrackerCatalogueResponse> GetCatalogueAsync(int customerId, CancellationToken cancellationToken = default);

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
