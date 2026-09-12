using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Response envelope from POST /api/msp/change-control/change-requests/:id/rollback
/// (msp-change-executions.ts) — raising a rollback does not revert the tenant, it raises a new,
/// separately-approved INVERSE change request. This carries just enough of that inverse CR for
/// the caller to report what happened; the full record is fetched the normal way
/// (GetChangeRequestsAsync) if the operator wants to open it.
/// </summary>
public sealed class ChangeRequestRollbackResult
{
    /// <summary>The real database id of the new inverse change request.</summary>
    [JsonPropertyName("inverseChangeRequestId")]
    public int InverseChangeRequestId { get; set; }

    /// <summary>The inverse CR's human-readable "CR-2026-NNN" code.</summary>
    [JsonPropertyName("inverseChangeCode")]
    public string InverseChangeCode { get; set; } = string.Empty;

    /// <summary>The original change request's real database id — the one Undo was invoked
    /// against.</summary>
    [JsonPropertyName("rollbackOfChangeRequestId")]
    public int RollbackOfChangeRequestId { get; set; }

    /// <summary>How many approval rows were seeded on the inverse CR's own approval ledger —
    /// it must clear approval like any change, same as the original did.</summary>
    [JsonPropertyName("approvalsCreated")]
    public int ApprovalsCreated { get; set; }
}
