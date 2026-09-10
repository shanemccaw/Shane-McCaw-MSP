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
/// Real HTTP client for GET /api/msp/:mspId/launch-control/actions
/// (msp-launch-control.ts) — the entitlement-resolved write_action_catalog +
/// baseline_action_templates listing. Short-TTL in-memory cache per MSP+customer
/// pair so re-opening the Script Library or re-selecting the same customer
/// doesn't re-hit the endpoint every time; <see cref="GetActionsAsync"/>'s
/// forceRefresh param and <see cref="InvalidateCache"/> both bypass it (Git #3460).
/// </summary>
public sealed class LaunchControlActionsService : ILaunchControlActionsService
{
    private static readonly TimeSpan DefaultCacheTtl = TimeSpan.FromSeconds(60);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly TimeSpan _cacheTtl;
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();

    /// <summary>
    /// Bearer token attached to every request, once MyArchitect has a real
    /// auth/session mechanism to source one from — none exists yet anywhere in
    /// this app (confirmed: no Authorization header usage, no mspId concept, in
    /// any MyArchitect service as of #3460). The endpoint is gated by
    /// requireCapability("ladder.msp-operator") + requireMspScope, so a call made
    /// with this unset will legitimately 401/403 rather than return data — a
    /// correct response from a real auth-gated route, not a bug in this client.
    /// Tracked as its own finding, filed against the MyArchitect epic.
    /// </summary>
    public string? AuthToken { get; set; }

    public LaunchControlActionsService(HttpClient? httpClient = null, string? baseUrl = null, TimeSpan? cacheTtl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    public async Task<LaunchControlCatalog> GetActionsAsync(
        int mspId,
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var key = CacheKey(mspId, customerId);

        if (!forceRefresh && _cache.TryGetValue(key, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Catalog;
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/{mspId}/launch-control/actions?customerId={customerId}");

        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new LaunchControlActionsException(
                $"GET /api/msp/{mspId}/launch-control/actions?customerId={customerId} returned " +
                $"{(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var catalog = JsonSerializer.Deserialize<LaunchControlCatalog>(body, JsonOptions) ?? new LaunchControlCatalog();

        _cache[key] = new CacheEntry(catalog, DateTimeOffset.UtcNow.Add(_cacheTtl));
        return catalog;
    }

    public void InvalidateCache(int mspId, int customerId) => _cache.TryRemove(CacheKey(mspId, customerId), out _);

    private static string CacheKey(int mspId, int customerId) => $"{mspId}:{customerId}";

    private readonly record struct CacheEntry(LaunchControlCatalog Catalog, DateTimeOffset ExpiresAt);
}

/// <summary>
/// Real failure from the launch-control actions endpoint — carries the actual
/// status code + response body so a caller can distinguish a 401/403 (auth not
/// wired yet) from a genuine 500, instead of swallowing every failure the same way.
/// </summary>
public sealed class LaunchControlActionsException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public LaunchControlActionsException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
