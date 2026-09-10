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
/// Real HTTP client for the Change Advisory Board surface
/// (`msp-change-control-cab.ts`). See <see cref="ICabService"/> for scope.
/// </summary>
public sealed class CabService : ICabService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public CabService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<CabMeeting>> GetMeetingsAsync(CancellationToken cancellationToken = default)
    {
        var body = await GetAsync("/api/msp/change-control/cab/meetings", cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingListResponse>(body, JsonOptions);
        return parsed?.Meetings ?? new List<CabMeeting>();
    }

    public async Task<(CabMeeting Meeting, IReadOnlyList<CabAgendaItem> Agenda)> GetMeetingAsync(
        int meetingId, CancellationToken cancellationToken = default)
    {
        var body = await GetAsync($"/api/msp/change-control/cab/meetings/{meetingId}", cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingDetailResponse>(body, JsonOptions)
            ?? throw new ChangeControlException("GET .../cab/meetings/:id returned an empty body", 200, body);
        return (parsed.Meeting, parsed.Agenda);
    }

    public async Task<IReadOnlyList<CabEligibleChange>> GetEligibleChangesAsync(
        int meetingId, CancellationToken cancellationToken = default)
    {
        var body = await GetAsync($"/api/msp/change-control/cab/meetings/{meetingId}/eligible-changes", cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabEligibleChangesResponse>(body, JsonOptions);
        return parsed?.Eligible ?? new List<CabEligibleChange>();
    }

    public async Task<CabMeeting> ScheduleMeetingAsync(
        string meetingType,
        DateTimeOffset scheduledFor,
        string chairName = "",
        string location = "",
        string notes = "",
        CancellationToken cancellationToken = default)
    {
        var body = await PostAsync(
            "/api/msp/change-control/cab/meetings",
            new { meetingType, scheduledFor = scheduledFor.ToUniversalTime().ToString("o"), chairName, location, notes },
            cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingResponse>(body, JsonOptions)
            ?? throw new ChangeControlException("POST .../cab/meetings returned an empty body", 200, body);
        return parsed.Meeting;
    }

    public async Task<CabMeeting> StartMeetingAsync(int meetingId, CancellationToken cancellationToken = default)
    {
        var body = await PostAsync($"/api/msp/change-control/cab/meetings/{meetingId}/start", new { }, cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingResponse>(body, JsonOptions)
            ?? throw new ChangeControlException("POST .../start returned an empty body", 200, body);
        return parsed.Meeting;
    }

    public async Task<CabMeeting> CloseMeetingAsync(int meetingId, CancellationToken cancellationToken = default)
    {
        var body = await PostAsync($"/api/msp/change-control/cab/meetings/{meetingId}/close", new { }, cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingResponse>(body, JsonOptions)
            ?? throw new ChangeControlException("POST .../close returned an empty body", 200, body);
        return parsed.Meeting;
    }

    public async Task<CabMeeting> CancelMeetingAsync(int meetingId, CancellationToken cancellationToken = default)
    {
        var body = await PostAsync($"/api/msp/change-control/cab/meetings/{meetingId}/cancel", new { }, cancellationToken).ConfigureAwait(false);
        var parsed = JsonSerializer.Deserialize<CabMeetingResponse>(body, JsonOptions)
            ?? throw new ChangeControlException("POST .../cancel returned an empty body", 200, body);
        return parsed.Meeting;
    }

    public async Task AddAgendaItemAsync(
        int meetingId, int changeRequestId, string presenterName = "", CancellationToken cancellationToken = default)
    {
        await PostAsync(
            $"/api/msp/change-control/cab/meetings/{meetingId}/agenda",
            new { changeRequestId, presenterName },
            cancellationToken).ConfigureAwait(false);
    }

    public async Task RecordDecisionAsync(
        int agendaItemId, string decision, string note = "", CancellationToken cancellationToken = default)
    {
        await PostAsync(
            $"/api/msp/change-control/cab/agenda/{agendaItemId}/decision",
            new { decision, note },
            cancellationToken).ConfigureAwait(false);
    }

    public async Task DeferAgendaItemAsync(
        int agendaItemId, int? deferredToMeetingId, CancellationToken cancellationToken = default)
    {
        await PostAsync(
            $"/api/msp/change-control/cab/agenda/{agendaItemId}/defer",
            new { deferredToMeetingId },
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> GetAsync(string path, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException($"GET {path} returned {(int)response.StatusCode} {response.ReasonPhrase}", (int)response.StatusCode, body);
        }
        return body;
    }

    private async Task<string> PostAsync(string path, object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}{path}")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };
        Authorize(request);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException($"POST {path} returned {(int)response.StatusCode} {response.ReasonPhrase}", (int)response.StatusCode, body);
        }
        return body;
    }

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }
}
