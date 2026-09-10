using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP-console Support Tickets endpoints (<c>msp-support.ts</c>,
/// #2672/#2570): every ticket under the caller's MSP's Zoho Desk org (customer-opened requests
/// and chat escalations both live here — there is no separate escalation queue), one ticket's
/// full operator-visible conversation thread, and a reply/internal-note write. #3488's own real
/// scope (Client: ticket list + detail for selected tenant, Client: reply action) is exactly this
/// service, wired into #3493's real shell (Watch tab list + record workspace) in MainWindow.
/// </summary>
public interface ISupportTicketsService
{
    /// <summary>Bearer token attached to every request — set from <see cref="MyArchitect.MainWindow"/>'s
    /// single auth-fanout point (<c>OnAuthSessionChanged</c>) alongside every other MSP-console service.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// Fetches every ticket under the caller's MSP's Zoho Desk org, newest-modified first
    /// (GET /api/msp/support/requests). <see cref="SupportRequestsList.Configured"/> is false when
    /// the MSP has no Zoho Desk connection yet — a real state, not an error.
    /// </summary>
    Task<SupportRequestsList> GetRequestsAsync(
        int? limit = null,
        int? offset = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Fetches one ticket's detail + full conversation thread, including private agent notes
    /// (GET /api/msp/support/requests/:ticketId). Returns null on a 404 (unknown ticket / not this
    /// MSP's org) rather than throwing, so a caller can render a real "not found" state.
    /// </summary>
    Task<SupportTicketDetail?> GetTicketDetailAsync(
        string ticketId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Posts an operator reply or internal note (POST /api/msp/support/requests/:ticketId/reply).
    /// <paramref name="isPublic"/> true (default) is visible to the customer; false adds an
    /// internal-only note. Queued through Zoho's own comment job, not applied synchronously.
    /// </summary>
    Task<SupportTicketReplyResult> ReplyAsync(
        string ticketId,
        string message,
        bool isPublic = true,
        CancellationToken cancellationToken = default);
}
