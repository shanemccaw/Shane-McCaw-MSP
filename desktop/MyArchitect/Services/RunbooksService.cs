using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP-console Runbooks endpoints
/// (msp-runbooks.ts, #2669):
///
///   GET  /api/msp/runbooks                              — customer's runbooks + run history
///   PUT  /api/msp/runbooks/:runbookId/steps/:position    — mark a step complete on a live run
///   POST /api/msp/hold-windows/:holdId/extend            — extend a hold window, with a reason
///   GET  /api/msp/hold-windows/:holdId/events            — a hold window's decision audit trail
///
/// Short-TTL in-memory cache per MSP+customer pair for the runbooks payload,
/// the same pattern <see cref="LaunchControlActionsService"/> (#3460) uses —
/// a step toggle or hold extend invalidates it immediately rather than
/// waiting out the TTL, since those are this same client's own writes.
/// </summary>
public sealed class RunbooksService : IRunbooksService
{
    private static readonly TimeSpan DefaultCacheTtl = TimeSpan.FromSeconds(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly TimeSpan _cacheTtl;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();

    /// <summary>
    /// Bearer token attached to every request, once MyArchitect has a real
    /// auth/session mechanism to source one from — none exists yet anywhere
    /// in this app (see LaunchControlActionsService's own note, #3460). The
    /// endpoint is gated by requireCapability("ladder.msp-operator") +
    /// resolveMspIdStrict, so a call made with this unset will legitimately
    /// 401/403 rather than return data — a correct response from a real
    /// auth-gated route, not a bug in this client.
    /// </summary>
    public string? AuthToken { get; set; }

    public RunbooksService(HttpClient? httpClient = null, string? baseUrl = null, TimeSpan? cacheTtl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    public async Task<RunbooksPayload> GetRunbooksAsync(
        int mspId,
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var key = CacheKey(mspId, customerId);

        if (!forceRefresh && _cache.TryGetValue(key, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Payload;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/runbooks?customerId={customerId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RunbooksServiceException(
                $"GET /api/msp/runbooks?customerId={customerId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var payload = JsonSerializer.Deserialize<RunbooksPayload>(body, JsonOptions) ?? new RunbooksPayload();

        _cache[key] = new CacheEntry(payload, DateTimeOffset.UtcNow.Add(_cacheTtl));
        return payload;
    }

    public async Task<StepCompletionResult> SetStepCompletionAsync(
        int mspId,
        int customerId,
        int runbookId,
        int position,
        bool isChecked,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"{_baseUrl}/api/msp/runbooks/{runbookId}/steps/{position}");
        Authorize(request);
        request.Content = JsonContent(new { customerId, @checked = isChecked });

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RunbooksServiceException(
                $"PUT /api/msp/runbooks/{runbookId}/steps/{position} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        InvalidateCache(mspId, customerId);
        return JsonSerializer.Deserialize<StepCompletionResult>(body, JsonOptions) ?? new StepCompletionResult();
    }

    public async Task<ExtendHoldWindowResult> ExtendHoldWindowAsync(
        int mspId,
        int customerId,
        int holdId,
        int days,
        string reason,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/hold-windows/{holdId}/extend");
        Authorize(request);
        request.Content = JsonContent(new { customerId, days, reason });

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RunbooksServiceException(
                $"POST /api/msp/hold-windows/{holdId}/extend returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        InvalidateCache(mspId, customerId);
        return JsonSerializer.Deserialize<ExtendHoldWindowResult>(body, JsonOptions) ?? new ExtendHoldWindowResult();
    }

    public async Task<HoldWindowEventsResponse> GetHoldWindowEventsAsync(
        int mspId,
        int customerId,
        int holdId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/hold-windows/{holdId}/events?customerId={customerId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RunbooksServiceException(
                $"GET /api/msp/hold-windows/{holdId}/events?customerId={customerId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<HoldWindowEventsResponse>(body, JsonOptions) ?? new HoldWindowEventsResponse();
    }

    public void InvalidateCache(int mspId, int customerId) => _cache.TryRemove(CacheKey(mspId, customerId), out _);

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }

    private static StringContent JsonContent(object value) =>
        new(JsonSerializer.Serialize(value, JsonOptions), Encoding.UTF8, "application/json");

    private static string CacheKey(int mspId, int customerId) => $"{mspId}:{customerId}";

    private readonly record struct CacheEntry(RunbooksPayload Payload, DateTimeOffset ExpiresAt);
}

/// <summary>
/// Real failure from a Runbooks endpoint — carries the actual status code +
/// response body so a caller can distinguish a 401/403 (auth not wired yet),
/// a 404 (runbook/hold not found or not in this MSP's book), a 409 (window
/// already closed) from a genuine 500, instead of swallowing every failure
/// the same way.
/// </summary>
public sealed class RunbooksServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public RunbooksServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
