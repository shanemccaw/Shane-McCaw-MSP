using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP-console POA&amp;M endpoints (msp-poams.ts, Git #3080):
///
///   GET    /api/msp/poams                              — list this MSP's POA&amp;Ms
///   POST   /api/msp/poams                               — create one
///   GET    /api/msp/poams/:poamId                       — one, with its milestones
///   PATCH  /api/msp/poams/:poamId                        — edit narrative/schedule/status
///   PATCH  /api/msp/poams/:poamId/cancel                 — mark cancelled
///   POST   /api/msp/poams/:poamId/milestones             — add a milestone
///   PATCH  /api/msp/poams/:poamId/milestones/:milestoneId — edit / mark complete
///   DELETE /api/msp/poams/:poamId/milestones/:milestoneId — remove a milestone
///
/// No client-side cache — unlike <see cref="RunbooksService"/>'s short-TTL cache, a POA&amp;M
/// list is read rarely enough (opened from a Home-tab gallery, not polled) that the added
/// invalidation bookkeeping isn't worth it; same simpler shape <see cref="ChangeControlService"/>
/// already uses for the same reason.
/// </summary>
public sealed class PoamsService : IPoamsService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // Optional fields the server schemas treat as "not supplied" (undefined) rather than
        // an explicit null — same reasoning ChangeControlService's JsonOptions documents.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    /// <inheritdoc />
    public string? AuthToken { get; set; }

    public PoamsService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<Poam>> GetPoamsAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/poams");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"GET /api/msp/poams returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<List<Poam>>(body, JsonOptions) ?? new List<Poam>();
    }

    public async Task<Poam> GetPoamAsync(string poamId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"GET /api/msp/poams/{poamId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<Poam>(body, JsonOptions)
            ?? throw new PoamsServiceException($"GET /api/msp/poams/{poamId} returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<CreatePoamResult> CreatePoamAsync(
        string tenantId,
        string tenantName,
        string primaryDomain,
        string title,
        string weaknessDescription,
        string scheduledCompletionDate,
        string interimCompensatingControl,
        string resourcesRequired,
        string status,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/poams")
        {
            Content = JsonContent.Create(
                new
                {
                    tenantId,
                    tenantName,
                    primaryDomain,
                    title,
                    weaknessDescription,
                    scheduledCompletionDate,
                    interimCompensatingControl,
                    resourcesRequired,
                    status,
                },
                options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"POST /api/msp/poams returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<CreatePoamResult>(body, JsonOptions)
            ?? throw new PoamsServiceException("POST /api/msp/poams returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<PoamActionResult> UpdatePoamAsync(
        string poamId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}")
        {
            Content = JsonContent.Create(fields, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"PATCH /api/msp/poams/{poamId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<PoamActionResult>(body, JsonOptions)
            ?? throw new PoamsServiceException($"PATCH /api/msp/poams/{poamId} returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<PoamActionResult> CancelPoamAsync(string poamId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}/cancel");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"PATCH /api/msp/poams/{poamId}/cancel returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<PoamActionResult>(body, JsonOptions)
            ?? throw new PoamsServiceException($"PATCH /api/msp/poams/{poamId}/cancel returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<MilestoneActionResult> CreateMilestoneAsync(
        string poamId,
        string title,
        string? description,
        string dueDate,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}/milestones")
        {
            Content = JsonContent.Create(new { title, description, dueDate }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"POST /api/msp/poams/{poamId}/milestones returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<MilestoneActionResult>(body, JsonOptions)
            ?? throw new PoamsServiceException($"POST /api/msp/poams/{poamId}/milestones returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<MilestoneActionResult> UpdateMilestoneAsync(
        string poamId,
        int milestoneId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}/milestones/{milestoneId}")
        {
            Content = JsonContent.Create(fields, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"PATCH /api/msp/poams/{poamId}/milestones/{milestoneId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<MilestoneActionResult>(body, JsonOptions)
            ?? throw new PoamsServiceException($"PATCH /api/msp/poams/{poamId}/milestones/{milestoneId} returned an empty body", (int)response.StatusCode, body);
    }

    public async Task<MilestoneActionResult> DeleteMilestoneAsync(
        string poamId,
        int milestoneId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"{_baseUrl}/api/msp/poams/{Uri.EscapeDataString(poamId)}/milestones/{milestoneId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new PoamsServiceException(
                $"DELETE /api/msp/poams/{poamId}/milestones/{milestoneId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<MilestoneActionResult>(body, JsonOptions)
            ?? throw new PoamsServiceException($"DELETE /api/msp/poams/{poamId}/milestones/{milestoneId} returned an empty body", (int)response.StatusCode, body);
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
/// Real failure from a POA&amp;M endpoint — carries the actual status code + response body so a
/// caller can distinguish a 401/403 (not signed in / not MSPAdmin for cancel), a 404 (not found
/// or not in this MSP's book), a 409 (POAM already cancelled/completed, milestone already
/// completed, "active" attempted through this route) from a genuine 500.
/// </summary>
public sealed class PoamsServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public PoamsServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
