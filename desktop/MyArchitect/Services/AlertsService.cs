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
/// Real HTTP client for the Cross-Tenant Alerts endpoints (msp-alerts.ts, #3483):
///
///   GET  /api/msp/alerts                      — merged, filterable (severity/category/customerId), paginated
///   POST /api/msp/alerts/:alertId/acknowledge — real acknowledge/dismiss (Git #3366)
///
/// Short-TTL in-memory cache keyed on the exact filter combination, same pattern
/// <see cref="RunbooksService"/> (#3479) uses — the Watch tab's live count badge and its
/// gallery dropdown both call <see cref="GetAlertsAsync"/> with identical (default) filters in
/// the same render pass, so this avoids a second real GET for what is functionally the same
/// read. An acknowledge invalidates the whole cache immediately rather than waiting out the
/// TTL, since it changes the feed's own contents.
/// </summary>
public sealed class AlertsService : IAlertsService
{
    private static readonly TimeSpan DefaultCacheTtl = TimeSpan.FromSeconds(20);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly TimeSpan _cacheTtl;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();

    /// <inheritdoc />
    public string? AuthToken { get; set; }

    public AlertsService(HttpClient? httpClient = null, string? baseUrl = null, TimeSpan? cacheTtl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    public async Task<AlertsPayload> GetAlertsAsync(
        string? severity = null,
        string? category = null,
        int? customerId = null,
        int limit = 50,
        int offset = 0,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var key = CacheKey(severity, category, customerId, limit, offset);

        if (!forceRefresh && _cache.TryGetValue(key, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Payload;
        }

        var query = new System.Collections.Generic.List<string> { $"limit={limit}", $"offset={offset}" };
        if (!string.IsNullOrWhiteSpace(severity)) query.Add($"severity={Uri.EscapeDataString(severity)}");
        if (!string.IsNullOrWhiteSpace(category)) query.Add($"category={Uri.EscapeDataString(category)}");
        if (customerId.HasValue) query.Add($"customerId={customerId.Value}");

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/alerts?{string.Join("&", query)}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AlertsServiceException(
                $"GET /api/msp/alerts returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var payload = JsonSerializer.Deserialize<AlertsPayload>(body, JsonOptions) ?? new AlertsPayload();
        _cache[key] = new CacheEntry(payload, DateTimeOffset.UtcNow.Add(_cacheTtl));
        return payload;
    }

    public async Task<AcknowledgeAlertResult> AcknowledgeAlertAsync(string alertId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/alerts/{Uri.EscapeDataString(alertId)}/acknowledge");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AlertsServiceException(
                $"POST /api/msp/alerts/{alertId}/acknowledge returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        InvalidateCache();

        return JsonSerializer.Deserialize<AcknowledgeAlertResult>(body, JsonOptions)
            ?? throw new AlertsServiceException($"POST /api/msp/alerts/{alertId}/acknowledge returned an empty body", (int)response.StatusCode, body);
    }

    public void InvalidateCache() => _cache.Clear();

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }

    private static string CacheKey(string? severity, string? category, int? customerId, int limit, int offset) =>
        $"{severity ?? "-"}:{category ?? "-"}:{customerId?.ToString() ?? "-"}:{limit}:{offset}";

    private readonly record struct CacheEntry(AlertsPayload Payload, DateTimeOffset ExpiresAt);
}

/// <summary>
/// Real failure from an Alerts endpoint — carries the actual status code + response body so a
/// caller can distinguish a 401/403 (not signed in / not msp-operator), a 404 (alert not found
/// or belongs to another MSP), the real 400 acknowledging returns for a "finding-*" id (no
/// per-item resolution mechanism exists yet — see msp-alerts.ts's own header) from a genuine 500.
/// </summary>
public sealed class AlertsServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public AlertsServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
