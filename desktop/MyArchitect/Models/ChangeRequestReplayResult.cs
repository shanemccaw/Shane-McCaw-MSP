using System;

namespace MyArchitect.Models;

/// <summary>
/// #3459 "Replay last run" — the real proposed_payload of the most recent
/// msp_change_requests row matching a given tenant + catalog action, re-fetched from
/// GET /api/msp/change-requests (real, existing endpoint). Never fabricated.
/// </summary>
public sealed class ChangeRequestReplayResult
{
    /// <summary>The real formatted change-request id the API returns, e.g. "CR-2026-1326" —
    /// never a raw database int (the endpoint doesn't expose one).</summary>
    public string ChangeRequestId { get; init; } = string.Empty;
    public string ProposedPayloadJson { get; init; } = "{}";
    public DateTimeOffset CreatedAtUtc { get; init; }
}
