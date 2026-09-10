using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Wire models for the MSP operator Support Tickets surface (#3488) — the exact JSON shapes
/// <c>artifacts/api-server/src/routes/msp-support.ts</c> serializes (which itself mirrors
/// <c>CustomerTicketSummary</c> / <c>CustomerTicketThreadEntry</c> from
/// <c>artifacts/api-server/src/lib/zoho-desk.ts</c>). No new schema, no fixture: an escalated
/// chat ticket and a customer-opened portal request are both just rows here — the route's own
/// docblock notes there is no separate escalation queue, the operator's request list IS it. All
/// three routes are gated by <c>requireCapability("ladder.msp-operator")</c>, so a call made
/// without a real operator bearer token legitimately 401/403s rather than returning data.
/// </summary>

/// <summary>One ticket row — same shape for the list and for a detail's own <c>request</c> field.</summary>
public sealed class SupportTicketSummary
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("ticketNumber")]
    public string? TicketNumber { get; set; }

    [JsonPropertyName("subject")]
    public string Subject { get; set; } = string.Empty;

    /// <summary>Zoho's free-text status, e.g. "Open", "Closed".</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Zoho's coarse bucket: Open | On Hold | Escalated | Closed.</summary>
    [JsonPropertyName("statusType")]
    public string? StatusType { get; set; }

    [JsonPropertyName("createdTime")]
    public string? CreatedTime { get; set; }

    [JsonPropertyName("modifiedTime")]
    public string? ModifiedTime { get; set; }

    [JsonPropertyName("webUrl")]
    public string? WebUrl { get; set; }
}

/// <summary>The GET /api/msp/support/requests envelope. <see cref="Configured"/> is false (with an
/// empty <see cref="Requests"/> list) when the MSP has no Zoho Desk connection yet — a real,
/// distinguishable state from "connected, zero tickets," not an error.</summary>
public sealed class SupportRequestsList
{
    [JsonPropertyName("configured")]
    public bool Configured { get; set; }

    [JsonPropertyName("requests")]
    public List<SupportTicketSummary> Requests { get; set; } = new();

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

/// <summary>One entry in a ticket's conversation timeline (from the detail endpoint's
/// <c>thread</c> array). Unlike the customer-facing route, this is the OPERATOR read — private
/// agent notes are included, not filtered out (<c>getDeskTicketThreadForOperator</c>).</summary>
public sealed class SupportTicketThreadEntry
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>"thread" | "comment" — a comment is an agent-authored note made public/private,
    /// a thread is the actual back-and-forth message.</summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    /// <summary>"in" = from the customer, "out" = a reply from support. Null for comments, which
    /// have no direction.</summary>
    [JsonPropertyName("direction")]
    public string? Direction { get; set; }

    [JsonPropertyName("author")]
    public string? Author { get; set; }

    [JsonPropertyName("isPublic")]
    public bool IsPublic { get; set; }

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("createdTime")]
    public string? CreatedTime { get; set; }
}

/// <summary>GET /api/msp/support/requests/:ticketId — one ticket with its full operator-visible
/// conversation thread.</summary>
public sealed class SupportTicketDetail
{
    [JsonPropertyName("request")]
    public SupportTicketSummary Request { get; set; } = new();

    [JsonPropertyName("thread")]
    public List<SupportTicketThreadEntry> Thread { get; set; } = new();
}

/// <summary>The success body of POST .../reply (202 Accepted — the reply is queued through
/// <c>zoho_desk_add_comment</c>, not applied synchronously).</summary>
public sealed class SupportTicketReplyResult
{
    [JsonPropertyName("queued")]
    public bool Queued { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}
