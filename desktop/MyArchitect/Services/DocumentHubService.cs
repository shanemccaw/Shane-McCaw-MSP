using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP-console Documents Hub endpoints
/// (msp-documents-hub.ts, #3486):
///
///   GET  /api/msp/documents-hub                 — aggregated list, filterable by customerId, paginated
///   GET  /api/msp/documents-hub/:id/view         — sandboxed-viewer HTML
///   GET  /api/msp/documents-hub/:id/pdf          — branded PDF download (raw bytes)
///   POST /api/msp/documents-hub/:id/share        — create a customer share link
///
/// Short-TTL in-memory cache per MSP+customer pair for the list payload, the same pattern
/// <see cref="RunbooksService"/> uses — a share doesn't change the list, so nothing invalidates
/// the cache on its own; <see cref="InvalidateCache"/> exists for callers that need it.
/// </summary>
public sealed class DocumentHubService : IDocumentHubService
{
    private static readonly TimeSpan DefaultCacheTtl = TimeSpan.FromSeconds(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly TimeSpan _cacheTtl;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();

    /// <summary>Bearer token attached to every request. The endpoint is gated by
    /// requireCapability("ladder.msp-operator") + resolveMspIdStrict, so a call made with this
    /// unset will legitimately 401/403 rather than return data.</summary>
    public string? AuthToken { get; set; }

    public DocumentHubService(HttpClient? httpClient = null, string? baseUrl = null, TimeSpan? cacheTtl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    public async Task<DocumentHubListResponse> GetDocumentsAsync(
        int mspId,
        int? customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var key = CacheKey(mspId, customerId);

        if (!forceRefresh && _cache.TryGetValue(key, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Payload;
        }

        var url = customerId.HasValue
            ? $"{_baseUrl}/api/msp/documents-hub?customerId={customerId.Value}"
            : $"{_baseUrl}/api/msp/documents-hub";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new DocumentHubServiceException(
                $"GET {url} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var payload = JsonSerializer.Deserialize<DocumentHubListResponse>(body, JsonOptions) ?? new DocumentHubListResponse();

        _cache[key] = new CacheEntry(payload, DateTimeOffset.UtcNow.Add(_cacheTtl));
        return payload;
    }

    public async Task<DocumentHubViewResult> GetDocumentViewAsync(int documentId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/documents-hub/{documentId}/view");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new DocumentHubServiceException(
                $"GET /api/msp/documents-hub/{documentId}/view returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<DocumentHubViewResult>(body, JsonOptions) ?? new DocumentHubViewResult();
    }

    public async Task<byte[]> GetDocumentPdfAsync(int documentId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/documents-hub/{documentId}/pdf");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new DocumentHubServiceException(
                $"GET /api/msp/documents-hub/{documentId}/pdf returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<DocumentHubShareResult> ShareDocumentAsync(int documentId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/documents-hub/{documentId}/share");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new DocumentHubServiceException(
                $"POST /api/msp/documents-hub/{documentId}/share returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<DocumentHubShareResult>(body, JsonOptions) ?? new DocumentHubShareResult();
    }

    public void InvalidateCache(int mspId, int? customerId) => _cache.TryRemove(CacheKey(mspId, customerId), out _);

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }

    private static string CacheKey(int mspId, int? customerId) => $"{mspId}:{(customerId.HasValue ? customerId.Value.ToString() : "all")}";

    private readonly record struct CacheEntry(DocumentHubListResponse Payload, DateTimeOffset ExpiresAt);
}

/// <summary>
/// Real failure from a Documents Hub endpoint — carries the actual status code + response body so
/// a caller can distinguish a 401/403 (auth not wired yet), a 404 (document not found / not in
/// this MSP's book), a 403 (document not available for download/share) from a genuine 500,
/// instead of swallowing every failure the same way.
/// </summary>
public sealed class DocumentHubServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public DocumentHubServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
