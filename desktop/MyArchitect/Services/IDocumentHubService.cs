using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Client for the real, existing MSP-console Documents Hub endpoints
/// (msp-documents-hub.ts, #3486): the aggregated customer-generated-document
/// browse across the caller's book (optionally scoped to one customer), the
/// sandboxed-viewer HTML, the branded PDF download, and a customer share
/// link. #3486's own real remaining scope (Client: document hub browse/view
/// for the selected tenant, Client: PDF/share actions) is exactly this
/// service, wired into #3493's real shell (Documents tab gallery + record
/// workspace) in MainWindow.
/// </summary>
public interface IDocumentHubService
{
    /// <summary>Bearer token attached to every request — set from <see cref="MyArchitect.MainWindow"/>'s
    /// single auth-fanout point (<c>ApplyAuthState</c>) alongside every other MSP-console service.</summary>
    string? AuthToken { get; set; }

    /// <summary>
    /// Fetches the aggregated document list (GET /api/msp/documents-hub), optionally scoped to
    /// one customer. Served from a short-TTL cache keyed by mspId+customerId unless
    /// <paramref name="forceRefresh"/> is set.
    /// </summary>
    Task<DocumentHubListResponse> GetDocumentsAsync(
        int mspId,
        int? customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default);

    /// <summary>Fetches a document's sandboxed-viewer HTML (GET /api/msp/documents-hub/:id/view).
    /// Always hits the endpoint — a document's content is never served from the list cache.</summary>
    Task<DocumentHubViewResult> GetDocumentViewAsync(int documentId, CancellationToken cancellationToken = default);

    /// <summary>Fetches a document's branded PDF (GET /api/msp/documents-hub/:id/pdf) as raw
    /// bytes. Only available for approved/delivered documents — the server enforces this too.</summary>
    Task<byte[]> GetDocumentPdfAsync(int documentId, CancellationToken cancellationToken = default);

    /// <summary>Creates (replacing any existing) customer share link for a document
    /// (POST /api/msp/documents-hub/:id/share).</summary>
    Task<DocumentHubShareResult> ShareDocumentAsync(int documentId, CancellationToken cancellationToken = default);

    /// <summary>Drops any cached document list for this MSP+customer pair so the next
    /// <see cref="GetDocumentsAsync"/> call is guaranteed to hit the real endpoint.</summary>
    void InvalidateCache(int mspId, int? customerId);
}
