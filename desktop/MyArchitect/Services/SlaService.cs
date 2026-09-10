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
/// Real HTTP client for msp-sla.ts (internal ticket-response SLA engine — policies, breaches,
/// escalations, compliance) and msp-m365-sla.ts (Microsoft's own third-party uptime commitment).
/// Same shape as <see cref="RemediationTrackerService"/> — a Bearer token set once auth lands
/// (#3501), and a real, typed exception carrying the actual status code + body on failure.
/// </summary>
public sealed class SlaService : ISlaService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public SlaService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<SlaPolicy>> GetPoliciesAsync(CancellationToken cancellationToken = default)
    {
        var response = await GetAsync<SlaPoliciesResponse>("/api/msp/sla/policies", cancellationToken).ConfigureAwait(false);
        return response.Policies;
    }

    public async Task<IReadOnlyList<SlaBreach>> GetBreachesAsync(int? customerId = null, CancellationToken cancellationToken = default)
    {
        var path = customerId.HasValue ? $"/api/msp/sla/breaches?customerId={customerId.Value}" : "/api/msp/sla/breaches";
        var response = await GetAsync<SlaBreachesResponse>(path, cancellationToken).ConfigureAwait(false);
        return response.Breaches;
    }

    public async Task<IReadOnlyList<SlaEscalation>> GetEscalationsAsync(CancellationToken cancellationToken = default)
    {
        var response = await GetAsync<SlaEscalationsResponse>("/api/msp/sla/escalations", cancellationToken).ConfigureAwait(false);
        return response.Escalations;
    }

    public async Task<IReadOnlyList<SlaComplianceRecord>> GetComplianceAsync(int? customerId = null, CancellationToken cancellationToken = default)
    {
        var path = customerId.HasValue ? $"/api/msp/sla/compliance?customerId={customerId.Value}" : "/api/msp/sla/compliance";
        var response = await GetAsync<SlaComplianceResponse>(path, cancellationToken).ConfigureAwait(false);
        return response.Records;
    }

    public Task<M365SlaResponse> GetM365SlaAsync(int? customerId = null, CancellationToken cancellationToken = default)
    {
        var path = customerId.HasValue ? $"/api/msp/m365-sla?customerId={customerId.Value}" : "/api/msp/m365-sla";
        return GetAsync<M365SlaResponse>(path, cancellationToken);
    }

    public async Task<bool> ResolveTimerAsync(string timerId, string? notes, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(timerId)) throw new ArgumentException("timerId is required", nameof(timerId));

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{_baseUrl}/api/msp/sla/timers/{Uri.EscapeDataString(timerId)}/resolve")
        {
            Content = JsonContent.Create(new { notes }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new SlaServiceException(
                $"POST /api/msp/sla/timers/{timerId}/resolve returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<SlaTimerResolveResult>(body, JsonOptions);
        return parsed?.Resolved ?? false;
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken) where T : new()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new SlaServiceException(
                $"GET {path} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<T>(body, JsonOptions) ?? new T();
    }

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }
}

/// <summary>Real failure from the SLA endpoints — carries the actual status code + response body,
/// same convention as <see cref="RemediationTrackerException"/>.</summary>
public sealed class SlaServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public SlaServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
