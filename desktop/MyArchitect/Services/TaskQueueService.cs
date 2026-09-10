using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for msp-sla.ts's virtual operator task queue and its SSE events stream —
/// #3490's two audited endpoints. Same shape as <see cref="SlaService"/>.
/// </summary>
public sealed class TaskQueueService : ITaskQueueService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public TaskQueueService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<OperatorTask>> GetTasksAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/operator-tasks");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new TaskQueueServiceException(
                $"GET /api/msp/operator-tasks returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<OperatorTasksResponse>(body, JsonOptions);
        return parsed?.Tasks ?? new List<OperatorTask>();
    }

    /// <summary>Reads the real <c>text/event-stream</c> response for /api/msp/sla/events/stream
    /// line by line. Lines are either a heartbeat comment (<c>: heartbeat</c>) or a real
    /// <c>data: {...}</c> event; only the latter is forwarded to <paramref name="onEvent"/> (the
    /// event's raw JSON payload, e.g. <c>{"type":"connected","mspId":1}</c> or whatever engine
    /// event the server emits next — parsing/shaping that further is the caller's concern). One
    /// connection attempt; a transport failure or the token being cancelled both end the method
    /// normally rather than retrying internally.</summary>
    public async Task SubscribeToEventsAsync(Action<string> onEvent, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/sla/events/stream");
        Authorize(request);

        using var response = await _httpClient
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new TaskQueueServiceException(
                $"GET /api/msp/sla/events/stream returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var reader = new StreamReader(stream);

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line == null) break; // server closed the connection
            if (line.Length == 0) continue; // blank line separating SSE events
            if (line.StartsWith(':')) continue; // comment / heartbeat, not a real event

            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                var payload = line["data:".Length..].TrimStart();
                onEvent(payload);
            }
        }
    }

    private void Authorize(HttpRequestMessage request)
    {
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }
    }
}

/// <summary>Real failure from the operator-tasks/events-stream endpoints — carries the actual
/// status code + response body, same convention as <see cref="SlaServiceException"/>.</summary>
public sealed class TaskQueueServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public TaskQueueServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
