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
/// Real HTTP client for the MSP operator Tenant Consent Status routes (#3485,
/// <c>msp-consent.ts</c>). Same shape and conventions as <see cref="BreakGlassService"/> — a
/// shared <see cref="HttpClient"/>, a Web-defaults <see cref="JsonSerializerOptions"/>, an optional
/// bearer <see cref="AuthToken"/>, and a typed <see cref="ConsentServiceException"/> carrying the
/// real status code + body so a caller can tell a 401/403 (auth) from a 503 (MT app credentials not
/// configured) from a genuine 5xx. No fixture data is ever synthesized here.
/// </summary>
public sealed class ConsentService : IConsentService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // ttlHours on invite-link is z.number().optional() — omit, don't send null, so the
        // schema reads "not supplied" (server default 72h) rather than "supplied as null".
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public ConsentService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<IReadOnlyList<CustomerConsentSummary>> GetAllAsync(CancellationToken cancellationToken = default)
        => await GetAsync<List<CustomerConsentSummary>>("/api/msp/consent", cancellationToken).ConfigureAwait(false);

    public Task<CustomerConsentSummary> GetForCustomerAsync(int customerId, CancellationToken cancellationToken = default)
        => GetAsync<CustomerConsentSummary>($"/api/msp/customers/{customerId}/consent", cancellationToken);

    public async Task<ConsentInviteLinkResult> CreateInviteLinkAsync(int customerId, int? ttlHours = null, CancellationToken cancellationToken = default)
    {
        var path = $"/api/msp/customers/{customerId}/consent/invite-link";
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}{path}")
        {
            Content = JsonContent.Create(new { ttlHours }, options: JsonOptions),
        };
        Authorize(request);

        return await SendAsync<ConsentInviteLinkResult>(request, path, cancellationToken).ConfigureAwait(false);
    }

    public Task<ConsentStartResult> StartWriteConsentAsync(int customerId, CancellationToken cancellationToken = default)
        => GetAsync<ConsentStartResult>($"/api/msp/customers/{customerId}/write-consent/start", cancellationToken);

    public Task<ConsentSharePointStartResult> StartSharePointConsentAsync(int customerId, CancellationToken cancellationToken = default)
        => GetAsync<ConsentSharePointStartResult>($"/api/msp/customers/{customerId}/sharepoint-consent/start", cancellationToken);

    public async Task<ConsentRevokeResult> RevokeAsync(int customerId, string key, CancellationToken cancellationToken = default)
    {
        var path = $"/api/msp/customers/{customerId}/consent/revoke";
        using var request = new HttpRequestMessage(HttpMethod.Patch, $"{_baseUrl}{path}")
        {
            Content = JsonContent.Create(new { key }, options: JsonOptions),
        };
        Authorize(request);

        return await SendAsync<ConsentRevokeResult>(request, path, cancellationToken).ConfigureAwait(false);
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}{path}");
        Authorize(request);

        return await SendAsync<T>(request, path, cancellationToken).ConfigureAwait(false);
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage request, string path, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ConsentServiceException(
                $"{request.Method} {path} returned {(int)response.StatusCode}: {DescribeError(body)}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<T>(body, JsonOptions);
        return parsed ?? throw new ConsentServiceException(
            $"{request.Method} {path} returned an empty body", (int)response.StatusCode, body);
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

/// <summary>
/// Real failure from a Tenant Consent Status endpoint — carries the actual status code + response
/// body so a caller can distinguish a 401/403 (operator token not attached), a 404 (not this MSP's
/// customer), a 503 (MT app credentials not configured), or a genuine 5xx.
/// </summary>
public sealed class ConsentServiceException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public ConsentServiceException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
