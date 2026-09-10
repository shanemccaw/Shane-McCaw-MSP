using System;
using System.Collections.Generic;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// #3459 — local-only history for ad-hoc console runs. Per the issue's own scope: catalog-backed
/// runs replay from the real `msp_change_requests.proposedPayload` (see
/// <see cref="IChangeRequestReplayService"/>); ad-hoc console commands have no backend equivalent,
/// so their history is local-only (the issue names #3463 as the eventual real dependency for
/// anything beyond local, and #3463's own corrected scope is local, in-app tracking only — so
/// this local store already satisfies it, not a stand-in for a backend that doesn't exist).
/// </summary>
public interface IConsoleHistoryService
{
    IReadOnlyList<ConsoleExecutionRecord> GetAll();

    void Add(ConsoleExecutionRecord record);

    /// <summary>Flips the "mark for report" flag on a previously recorded execution. Returns
    /// false if no record with that id exists.</summary>
    bool ToggleMarkedForReport(Guid executionId);

    IReadOnlyList<ConsoleExecutionRecord> GetMarkedForReport();
}
