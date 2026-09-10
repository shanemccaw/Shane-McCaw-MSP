using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One row from GET /api/msp/documents-hub — mirrors msp-documents-hub.ts's real response shape
/// exactly (customer-generated deliverables: assessment reports, SOWs, consulting docs), not the
/// unrelated mspDocumentsTable pipeline msp-documents.ts backs.
/// </summary>
public sealed class DocumentHubItem
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("docType")]
    public string? DocType { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("deliveredAt")]
    public string? DeliveredAt { get; set; }

    [JsonPropertyName("createdAt")]
    public string? CreatedAt { get; set; }

    [JsonPropertyName("sowTotalPrice")]
    public string? SowTotalPrice { get; set; }

    [JsonPropertyName("projectId")]
    public int? ProjectId { get; set; }

    [JsonPropertyName("projectTitle")]
    public string? ProjectTitle { get; set; }

    [JsonPropertyName("customerId")]
    public int? CustomerId { get; set; }

    [JsonPropertyName("customerName")]
    public string? CustomerName { get; set; }

    [JsonPropertyName("deepLink")]
    public string? DeepLink { get; set; }
}

/// <summary>GET /api/msp/documents-hub's real paginated envelope.</summary>
public sealed class DocumentHubListResponse
{
    [JsonPropertyName("documents")]
    public List<DocumentHubItem> Documents { get; set; } = new();

    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("offset")]
    public int Offset { get; set; }
}

/// <summary>GET /api/msp/documents-hub/:id/view's real response — sandboxed-viewer HTML.</summary>
public sealed class DocumentHubViewResult
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("htmlContent")]
    public string HtmlContent { get; set; } = string.Empty;
}

/// <summary>POST /api/msp/documents-hub/:id/share's real response — a quick_win_result_shares
/// token URL, 30-day expiry.</summary>
public sealed class DocumentHubShareResult
{
    [JsonPropertyName("shareUrl")]
    public string ShareUrl { get; set; } = string.Empty;

    [JsonPropertyName("expiresAt")]
    public string ExpiresAt { get; set; } = string.Empty;
}
