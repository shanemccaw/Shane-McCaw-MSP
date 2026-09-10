using System;
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
/// Real HTTP client for the admin retainer ledger's ad-hoc logging endpoint
/// (POST /api/admin/retainer/:customerId/unscoped, admin-retainer.ts). #3464's
/// ad-hoc consumer — no local ledger model, no fixture entries, just the real
/// `retainer_work_log` row this endpoint inserts and returns.
/// </summary>
public sealed class AdminRetainerService : IAdminRetainerService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // pillar/finding/outcome are z.string().nullable().optional() server-side — omitting an
        // unset field, not sending null, is what "not supplied" means to that schema.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    /// <summary>
    /// Bearer token attached to every request, sourced from the real MyArchitect session
    /// (#3501). This route is gated by `requireAdmin`, not `requireCapability("ladder.msp-operator")`
    /// like the remediation-tracker/change-control routes — see the interface doc comment.
    /// </summary>
    public string? AuthToken { get; set; }

    public AdminRetainerService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<RetainerWorkLogEntry> LogUnscopedHoursAsync(
        int customerId,
        string item,
        double hours,
        string? pillar = null,
        string? finding = null,
        string? outcome = null,
        CancellationToken cancellationToken = default)
    {
        if (customerId <= 0) throw new ArgumentException("customerId is required", nameof(customerId));
        if (string.IsNullOrWhiteSpace(item)) throw new ArgumentException("item is required", nameof(item));
        if (hours < 0) throw new ArgumentException("hours cannot be negative", nameof(hours));

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{_baseUrl}/api/admin/retainer/{customerId}/unscoped")
        {
            Content = JsonContent.Create(
                new { item, hours, pillar, finding, outcome },
                options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AdminRetainerException(
                $"POST /api/admin/retainer/{customerId}/unscoped returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<RetainerWorkLogEntryResponse>(body, JsonOptions);
        return parsed?.Entry ?? throw new AdminRetainerException(
            $"POST /api/admin/retainer/{customerId}/unscoped returned an empty entry",
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
/// Real failure from the admin retainer endpoints — carries the actual status
/// code + response body so a caller can distinguish a 401/403 (not signed in,
/// or signed in without the `admin` role this route requires), a 400 (the
/// server's own `unscopedSchema` validation), a 404 (customer has no tenant
/// identity), or a genuine 500.
/// </summary>
public sealed class AdminRetainerException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public AdminRetainerException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
