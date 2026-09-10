using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP operator Support Tickets routes (#3488, <c>msp-support.ts</c>).
/// Same shape and conventions as <see cref="BreakGlassService"/> — a shared <see cref="HttpClient"/>,
/// a Web-defaults <see cref="JsonSerializerOptions"/>, an optional bearer <see cref="AuthToken"/>,
/// and a typed <see cref="SupportTicketsServiceException"/> carrying the real status code + body so
/// a caller can tell a 401/403 (auth) from a 404 (unknown ticket) from a 503 (Zoho not connected /
/// unavailable) from a genuine 5xx. No fixture data is ever synthesized here.
/// </summary>
public sealed class SupportTicketsService : ISupportTicketsService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public SupportTicketsService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<SupportRequestsList> GetRequestsAsync(
        int? limit = null,
        int? offset = null,
        CancellationToken cancellationToken = default)
    {
        var query = "";
        if (limit.HasValue) query += $"?limit={limit.Value}";
        if (offset.HasValue) query += (query.Length == 0 ? "?" : "&") + $"offset={offset.Value}";

        var path = $"/api/msp/support/requests{query}";
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new SupportTicketsServiceException(
                $"GET {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<SupportRequestsList>(body, JsonOptions) ?? new SupportRequestsList();
    }

    public async Task<SupportTicketDetail?> GetTicketDetailAsync(
        string ticketId,
        CancellationToken cancellationToken = default)
    {
        var path = $"/api/msp/support/requests/{Uri.EscapeDataString(ticketId)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new SupportTicketsServiceException(
                $"GET {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<SupportTicketDetail>(body, JsonOptions);
    }

    public async Task<SupportTicketReplyResult> ReplyAsync(
        string ticketId,
        string message,
        bool isPublic = true,
        CancellationToken cancellationToken = default)
    {
        var path = $"/api/msp/support/requests/{Uri.EscapeDataString(ticketId)}/reply";
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}{path}")
        {
            Content = JsonContent.Create(new { message, isPublic }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new SupportTicketsServiceException(
                $"POST {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<SupportTicketReplyResult>(body, JsonOptions);
        return parsed ?? throw new SupportTicketsServiceException(
            $"POST {path} returned an empty body", (int)response.StatusCode, body);
    }

    /// <summary>Pull the route's own <c>{ error }</c> message out of the body for a human-readable
    /// exception, falling back to the raw body if it isn't the expected JSON.</summary>
    private static string DescribeError(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "(no body)";
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("error", out var e))
            {
                var error = e.GetString();
                if (!string.IsNullOrEmpty(error)) return error;
            }
        }
        catch (JsonException)
        {
            // Not JSON — fall through to the raw body.
        }
        return body.Length > 300 ? body[..300] : body;
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
/// Real failure from a Support Tickets endpoint — carries the actual status code + response body
/// so a caller can distinguish a 401/403 (operator token not attached), a 503 (Zoho Desk not
/// connected/unavailable), a 502 (a genuine Zoho API error), or another 5xx.
/// </summary>
public sealed class SupportTicketsServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public SupportTicketsServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
