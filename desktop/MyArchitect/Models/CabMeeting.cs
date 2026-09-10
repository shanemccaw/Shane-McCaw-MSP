using System;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One Change Advisory Board meeting, exactly as `msp-change-control-cab.ts`'s
/// `toWireCabMeeting` serializes it (Git #1501). Convened, chaired and minuted
/// by the MSP — "cab" for normal changes, "ecab" for emergency changes
/// reviewed retroactively.
/// </summary>
public sealed class CabMeeting
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>"cab" | "ecab".</summary>
    [JsonPropertyName("meetingType")]
    public string MeetingType { get; set; } = string.Empty;

    /// <summary>"scheduled" | "in_progress" | "completed" | "cancelled".</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("scheduledFor")]
    public DateTimeOffset ScheduledFor { get; set; }

    [JsonPropertyName("heldAt")]
    public DateTimeOffset? HeldAt { get; set; }

    [JsonPropertyName("closedAt")]
    public DateTimeOffset? ClosedAt { get; set; }

    [JsonPropertyName("chairPersonId")]
    public string? ChairPersonId { get; set; }

    [JsonPropertyName("chairName")]
    public string ChairName { get; set; } = string.Empty;

    [JsonPropertyName("location")]
    public string Location { get; set; } = string.Empty;

    [JsonPropertyName("notes")]
    public string Notes { get; set; } = string.Empty;

    [JsonPropertyName("minutes")]
    public string Minutes { get; set; } = string.Empty;

    [JsonPropertyName("agendaSummary")]
    public CabAgendaSummary AgendaSummary { get; set; } = new();

    public bool IsOpen => Status is "scheduled" or "in_progress";
}

public sealed class CabAgendaSummary
{
    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("approved")]
    public int Approved { get; set; }

    [JsonPropertyName("rejected")]
    public int Rejected { get; set; }

    [JsonPropertyName("deferred")]
    public int Deferred { get; set; }

    [JsonPropertyName("undecided")]
    public int Undecided { get; set; }

    [JsonPropertyName("retroactive")]
    public int Retroactive { get; set; }
}

/// <summary>One agenda item, exactly as `toWireCabAgendaItem` serializes it.</summary>
public sealed class CabAgendaItem
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("changeRequestId")]
    public int ChangeRequestId { get; set; }

    [JsonPropertyName("changeCode")]
    public string ChangeCode { get; set; } = string.Empty;

    [JsonPropertyName("changeTitle")]
    public string ChangeTitle { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("ordinal")]
    public int Ordinal { get; set; }

    [JsonPropertyName("presenterName")]
    public string PresenterName { get; set; } = string.Empty;

    [JsonPropertyName("discussionNotes")]
    public string DiscussionNotes { get; set; } = string.Empty;

    /// <summary>null (undecided) | "approve" | "reject" | "defer".</summary>
    [JsonPropertyName("recommendation")]
    public string? Recommendation { get; set; }

    [JsonPropertyName("decidedAt")]
    public DateTimeOffset? DecidedAt { get; set; }

    [JsonPropertyName("crApprovalId")]
    public int? CrApprovalId { get; set; }

    [JsonPropertyName("isRetroactive")]
    public bool IsRetroactive { get; set; }

    [JsonPropertyName("deferredToMeetingId")]
    public int? DeferredToMeetingId { get; set; }
}

/// <summary>One eligible change for a meeting's agenda — a change of the meeting's own
/// class (normal→cab, emergency→ecab) with a pending approval slot and not already
/// on another open meeting's agenda. From
/// GET /msp/change-control/cab/meetings/:id/eligible-changes.</summary>
public sealed class CabEligibleChange
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("riskLevel")]
    public string RiskLevel { get; set; } = string.Empty;
}

public sealed class CabMeetingResponse
{
    [JsonPropertyName("meeting")]
    public CabMeeting Meeting { get; set; } = new();
}

public sealed class CabMeetingListResponse
{
    [JsonPropertyName("meetings")]
    public System.Collections.Generic.List<CabMeeting> Meetings { get; set; } = new();
}

/// <summary>GET /msp/change-control/cab/meetings/:id's combined response.</summary>
public sealed class CabMeetingDetailResponse
{
    [JsonPropertyName("meeting")]
    public CabMeeting Meeting { get; set; } = new();

    [JsonPropertyName("agenda")]
    public System.Collections.Generic.List<CabAgendaItem> Agenda { get; set; } = new();
}

public sealed class CabEligibleChangesResponse
{
    [JsonPropertyName("eligible")]
    public System.Collections.Generic.List<CabEligibleChange> Eligible { get; set; } = new();
}
