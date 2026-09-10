using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for `GET/POST /api/msp/vip-classifications`
/// (`msp-vip-classifications.ts`) — #3484's read + "told" author path. Same
/// shape as <see cref="RemediationTrackerService"/>: base URL from
/// <c>API_BASE_URL</c>, bearer token pushed in by <see cref="MainWindow.ApplyAuthState"/>,
/// real status code + body surfaced on failure rather than swallowed.
/// </summary>
public sealed class VipClassificationsService : IVipClassificationsService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public VipClassificationsService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<VipClassification>> GetClassificationsAsync(int customerId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/vip-classifications?customerId={customerId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new VipClassificationsException(
                $"GET /api/msp/vip-classifications returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<VipClassificationsResponse>(body, JsonOptions);
        return parsed?.Classifications ?? new List<VipClassification>();
    }

    public async Task<VipClassification> SetToldAsync(
        int customerId,
        string principalId,
        string principalUpn,
        bool isVip,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(principalId)) throw new ArgumentException("principalId is required", nameof(principalId));
        if (string.IsNullOrWhiteSpace(principalUpn)) throw new ArgumentException("principalUpn is required", nameof(principalUpn));

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/vip-classifications")
        {
            Content = JsonContent.Create(new { customerId, principalId, principalUpn, isVip }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new VipClassificationsException(
                $"POST /api/msp/vip-classifications returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<VipClassification>(body, JsonOptions)
            ?? throw new VipClassificationsException(
                "POST /api/msp/vip-classifications returned an empty classification",
                (int)response.StatusCode,
                body);
    }

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }
}

/// <summary>
/// Real failure from the VIP classification endpoints — carries the actual status
/// code + response body so a caller can distinguish a 401/403 (auth/MSP-scope
/// gap), a 400 (validation), or a genuine 500.
/// </summary>
public sealed class VipClassificationsException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public VipClassificationsException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
