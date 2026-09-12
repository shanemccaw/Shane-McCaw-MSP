using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for /api/admin/live-stream (+ its /channels sibling) — #3506's Live half.
/// Same shape as <see cref="TaskQueueService"/>: a Bearer token set once auth lands, real typed
/// exceptions on failure, no fixture data.
/// </summary>
public sealed class LogStreamService : ILogStreamService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public LogStreamService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<string>> GetChannelsAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/admin/live-stream/channels");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new LogStreamServiceException(
                $"GET /api/admin/live-stream/channels returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<LogStreamChannelsResponse>(body, JsonOptions);
        return parsed?.Channels ?? new List<string>();
    }

    /// <summary>Reads the real <c>text/event-stream</c> response for /api/admin/live-stream line
    /// by line. Lines are either a keepalive comment (<c>: connected</c> / <c>: ping</c>) or a
    /// real <c>data: {...}</c> event; only the latter is forwarded to <paramref name="onEvent"/>
    /// (the event's raw JSON payload — shaping it further is the caller's concern). The token is
    /// sent as a query parameter because the server route only ever reads
    /// <c>req.query.token</c> for this endpoint (an EventSource in the browser can't attach an
    /// Authorization header either, so the server was written to match that constraint).</summary>
    public async Task SubscribeAsync(string channel, int mspId, Action<string> onEvent, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(AuthToken))
        {
            throw new LogStreamServiceException("No access token — cannot open the live-stream connection.", 401, string.Empty);
        }

        var url = $"{_baseUrl}/api/admin/live-stream?channel={Uri.EscapeDataString(channel)}&mspId={mspId}&token={Uri.EscapeDataString(AuthToken)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);

        using var response = await _httpClient
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new LogStreamServiceException(
                $"GET /api/admin/live-stream returned {(int)response.StatusCode} {response.ReasonPhrase}",
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
            if (line.StartsWith(':')) continue; // ": connected" / ": ping" keepalive, not a real event

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

    private sealed class LogStreamChannelsResponse
    {
        [JsonPropertyName("channels")]
        public List<string> Channels { get; set; } = new();
    }
}

/// <summary>Real failure from the live-stream/channels endpoints — carries the actual status code
/// and response body, same convention as <see cref="TaskQueueServiceException"/>.</summary>
public sealed class LogStreamServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public LogStreamServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
