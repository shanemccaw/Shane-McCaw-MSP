using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real HTTP client for the MSP Audit Log route (#3489, <c>msp-audit-log.ts</c>). Same shape and
/// conventions as <see cref="BreakGlassService"/> — a shared <see cref="HttpClient"/>, a
/// Web-defaults <see cref="JsonSerializerOptions"/>, an optional bearer <see cref="AuthToken"/>,
/// and a typed <see cref="AuditLogServiceException"/> carrying the real status code + body. No
/// fixture data is ever synthesized here.
/// </summary>
public sealed class AuditLogService : IAuditLogService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public AuditLogService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<AuditLogPage> GetAuditLogAsync(AuditLogFilter filter, CancellationToken cancellationToken = default)
    {
        var query = new List<string>();
        void Add(string key, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value)) query.Add($"{key}={Uri.EscapeDataString(value)}");
        }
        Add("mspId", filter.MspId);
        Add("actionType", filter.ActionType);
        Add("outcome", filter.Outcome);
        Add("search", filter.Search);
        if (filter.Page is int page) query.Add($"page={page}");
        if (filter.Limit is int limit) query.Add($"limit={limit}");

        var path = "/api/msp/audit";
        if (query.Count > 0)
        {
            var sb = new StringBuilder(path).Append('?').Append(string.Join('&', query));
            path = sb.ToString();
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AuditLogServiceException(
                $"GET {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<AuditLogPage>(body, JsonOptions);
        return parsed ?? throw new AuditLogServiceException(
            $"GET {path} returned an empty body", (int)response.StatusCode, body);
    }

    /// <summary>Pull the route's own <c>{ error, detail? }</c> message out of the body for a
    /// human-readable exception, falling back to the raw body if it isn't the expected JSON.</summary>
    private static string DescribeError(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "(no body)";
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                var error = root.TryGetProperty("error", out var e) ? e.GetString() : null;
                var detail = root.TryGetProperty("detail", out var d) ? d.GetString() : null;
                if (!string.IsNullOrEmpty(error))
                {
                    return string.IsNullOrEmpty(detail) ? error! : $"{error} ({detail})";
                }
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

/// <summary>Real failure from the Audit Log endpoint — carries the actual status code + response
/// body so a caller can tell a 401/403 (operator session not attached) from a genuine 5xx.</summary>
public sealed class AuditLogServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public AuditLogServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
