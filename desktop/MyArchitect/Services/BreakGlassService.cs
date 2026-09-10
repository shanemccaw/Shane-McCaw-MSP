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
/// Real HTTP client for the MSP operator Break-Glass routes (#3480, <c>msp-break-glass.ts</c>). Same
/// shape and conventions as <see cref="ChangeControlService"/> — a shared <see cref="HttpClient"/>,
/// a Web-defaults <see cref="JsonSerializerOptions"/>, an optional bearer <see cref="AuthToken"/>,
/// and a typed <see cref="BreakGlassServiceException"/> carrying the real status code + body so a
/// caller can tell a 401/403 (auth) from a 409 (still-live links / not awaiting delivery / write-back
/// gate) from a genuine 5xx. No fixture data is ever synthesized here.
/// </summary>
public sealed class BreakGlassService : IBreakGlassService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // Optional server-side fields (emails on override) are z.array(...).optional() — omit, don't
        // send null, so the schema reads "not supplied" rather than "supplied as null".
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public BreakGlassService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<IReadOnlyList<BreakGlassPendingItem>> GetPendingAsync(CancellationToken cancellationToken = default)
    {
        var envelope = await GetAsync<BreakGlassPendingList>("/api/msp/break-glass", cancellationToken).ConfigureAwait(false);
        return envelope.Pending;
    }

    public async Task<IReadOnlyList<BreakGlassSecretHistoryItem>> GetCustomerHistoryAsync(int customerId, CancellationToken cancellationToken = default)
    {
        var envelope = await GetAsync<BreakGlassSecretHistory>($"/api/msp/customers/{customerId}/break-glass", cancellationToken).ConfigureAwait(false);
        return envelope.Secrets;
    }

    public Task<BreakGlassSecretDetail> GetSecretDetailAsync(int customerId, int pendingSecretId, CancellationToken cancellationToken = default)
        => GetAsync<BreakGlassSecretDetail>($"/api/msp/customers/{customerId}/break-glass/{pendingSecretId}", cancellationToken);

    public async Task<IReadOnlyList<BreakGlassAuditEntry>> GetAuditAsync(int customerId, CancellationToken cancellationToken = default)
    {
        var envelope = await GetAsync<BreakGlassAuditTrail>($"/api/msp/customers/{customerId}/break-glass/audit", cancellationToken).ConfigureAwait(false);
        return envelope.Audit;
    }

    public async Task<BreakGlassOverrideResult> AdminOverrideAsync(
        int customerId,
        int pendingSecretId,
        string reason,
        IReadOnlyList<string>? emails = null,
        CancellationToken cancellationToken = default)
    {
        var path = $"/api/msp/customers/{customerId}/break-glass/{pendingSecretId}/admin-override";
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}{path}")
        {
            // emails omitted (null) ⇒ server reuses the original invite recipients; a non-empty list
            // must be 1–5 valid addresses (route's own zod schema).
            Content = JsonContent.Create(
                new { reason, emails = emails is { Count: > 0 } ? emails : null },
                options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new BreakGlassServiceException(
                $"POST {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<BreakGlassOverrideResult>(body, JsonOptions);
        return parsed ?? throw new BreakGlassServiceException(
            $"POST {path} returned an empty body", (int)response.StatusCode, body);
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new BreakGlassServiceException(
                $"GET {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<T>(body, JsonOptions);
        return parsed ?? throw new BreakGlassServiceException(
            $"GET {path} returned an empty body", (int)response.StatusCode, body);
    }

    /// <summary>Pull the route's own <c>{ error, detail?, blockedBy? }</c> message out of the body for
    /// a human-readable exception, falling back to the raw body if it isn't the expected JSON.</summary>
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
                var blockedBy = root.TryGetProperty("blockedBy", out var b) ? b.GetString() : null;
                if (!string.IsNullOrEmpty(error))
                {
                    var extra = blockedBy ?? detail;
                    return string.IsNullOrEmpty(extra) ? error! : $"{error} ({extra})";
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

/// <summary>
/// Real failure from a Break-Glass endpoint — carries the actual status code + response body so a
/// caller can distinguish a 401/403 (operator token not attached), a 404 (not this MSP's customer /
/// unknown pending secret), a 409 (still-live verification links, not awaiting delivery, or a
/// write-back-gate block), or a genuine 5xx.
/// </summary>
public sealed class BreakGlassServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public BreakGlassServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
