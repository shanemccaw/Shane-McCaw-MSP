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
/// Real HTTP client for GET /api/admin/retainer/:customerId (admin-retainer.ts) — same
/// short-TTL-cache-with-forceRefresh pattern as <see cref="LaunchControlActionsService"/>
/// (Git #3460), reused here so the status bar's tenant-switch refresh doesn't hammer the
/// endpoint on rapid switching (Git #3474).
/// </summary>
public sealed class RetainerService : IRetainerService
{
    private static readonly TimeSpan DefaultCacheTtl = TimeSpan.FromSeconds(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly TimeSpan _cacheTtl;
    private readonly ConcurrentDictionary<int, CacheEntry> _cache = new();

    public string? AuthToken { get; set; }

    public RetainerService(HttpClient? httpClient = null, string? baseUrl = null, TimeSpan? cacheTtl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _cacheTtl = cacheTtl ?? DefaultCacheTtl;
    }

    public async Task<RetainerDetailResponse> GetRetainerAsync(
        int customerId,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        if (!forceRefresh && _cache.TryGetValue(customerId, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
        {
            return cached.Response;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/admin/retainer/{customerId}");

        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            // Real, honest server rejections land here — 401/403 (not signed in as a platform
            // admin — requireAdmin checks req.user.role === "admin"), 404 (customer has no
            // tenant identity), or a genuine 500. Never synthesized client-side.
            throw new RetainerServiceException(
                $"GET /api/admin/retainer/{customerId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<RetainerDetailResponse>(body, JsonOptions)
            ?? throw new RetainerServiceException("Retainer response body was empty", (int)response.StatusCode, body);

        _cache[customerId] = new CacheEntry(parsed, DateTimeOffset.UtcNow.Add(_cacheTtl));
        return parsed;
    }

    private readonly record struct CacheEntry(RetainerDetailResponse Response, DateTimeOffset ExpiresAt);
}

/// <summary>Real failure from the retainer endpoint — carries the actual status code + response
/// body so a caller can distinguish "not a platform admin" from a genuine server error.</summary>
public sealed class RetainerServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public RetainerServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
