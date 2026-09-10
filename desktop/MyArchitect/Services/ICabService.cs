using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real Change Advisory Board surface
/// (`msp-change-control-cab.ts`, Git #1501) — #3482's "CAB meeting/agenda
/// view" checklist item. Meetings, their agenda, and the one real decision
/// path (`recordAgendaDecision`, which writes through the same #1496
/// `cr_approvals` ledger the customer register uses — there is no second
/// approval model here).
/// </summary>
public interface ICabService
{
    /// <summary>Bearer token from the real MyArchitect session (#3501), same as
    /// <see cref="IChangeControlService.AuthToken"/>.</summary>
    string? AuthToken { get; set; }

    /// <summary>GET /msp/change-control/cab/meetings — every meeting for this MSP,
    /// each with its agenda summary.</summary>
    Task<IReadOnlyList<CabMeeting>> GetMeetingsAsync(CancellationToken cancellationToken = default);

    /// <summary>GET /msp/change-control/cab/meetings/:id — one meeting plus its full
    /// agenda (each item resolved against its change's real code/title).</summary>
    Task<(CabMeeting Meeting, IReadOnlyList<CabAgendaItem> Agenda)> GetMeetingAsync(
        int meetingId, CancellationToken cancellationToken = default);

    /// <summary>GET /msp/change-control/cab/meetings/:id/eligible-changes — changes of
    /// this meeting's class with a pending approval slot, not already agendaed elsewhere.</summary>
    Task<IReadOnlyList<CabEligibleChange>> GetEligibleChangesAsync(
        int meetingId, CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/meetings — schedules a new meeting.</summary>
    Task<CabMeeting> ScheduleMeetingAsync(
        string meetingType,
        System.DateTimeOffset scheduledFor,
        string chairName = "",
        string location = "",
        string notes = "",
        CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/meetings/:id/start.</summary>
    Task<CabMeeting> StartMeetingAsync(int meetingId, CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/meetings/:id/close — only legal once every
    /// agenda item has a recommendation.</summary>
    Task<CabMeeting> CloseMeetingAsync(int meetingId, CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/meetings/:id/cancel.</summary>
    Task<CabMeeting> CancelMeetingAsync(int meetingId, CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/meetings/:id/agenda — adds a change to this
    /// meeting's agenda.</summary>
    Task AddAgendaItemAsync(
        int meetingId, int changeRequestId, string presenterName = "", CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/agenda/:id/decision — the board's recorded
    /// decision; writes through the real #1496 approval ledger.</summary>
    Task RecordDecisionAsync(
        int agendaItemId, string decision, string note = "", CancellationToken cancellationToken = default);

    /// <summary>POST /msp/change-control/cab/agenda/:id/defer — decides nothing; rolls the
    /// item to a future meeting (or leaves it unassigned when <paramref name="deferredToMeetingId"/>
    /// is null).</summary>
    Task DeferAgendaItemAsync(
        int agendaItemId, int? deferredToMeetingId, CancellationToken cancellationToken = default);
}
