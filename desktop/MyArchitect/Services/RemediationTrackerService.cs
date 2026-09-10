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
/// Real HTTP client for the MSP-side remediation tracker
/// (GET/PUT /api/msp/customers/:customerId/remediation-tracker[/steps/:stepId],
/// msp-remediation-tracker.ts). #3471's checklist-style consumer — no local
/// tracker model, no fixture steps, just the real
/// `remediation_tracker_steps` rows this endpoint already serves.
/// </summary>
public sealed class RemediationTrackerService : IRemediationTrackerService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    /// <summary>
    /// Bearer token attached to every request, once MyArchitect has a real
    /// auth/session mechanism to source one from — none exists yet anywhere in
    /// this app (see LaunchControlActionsService's own note, #3460/#3501).
    /// The endpoint is gated by requireCapability("ladder.msp-operator") +
    /// assertCustomerAccess, so a call made with this unset will legitimately
    /// 401/403 rather than return data.
    /// </summary>
    public string? AuthToken { get; set; }

    public RemediationTrackerService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<RemediationTrackerResponse> GetTrackerAsync(int customerId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/customers/{customerId}/remediation-tracker");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RemediationTrackerException(
                $"GET /api/msp/customers/{customerId}/remediation-tracker returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<RemediationTrackerResponse>(body, JsonOptions) ?? new RemediationTrackerResponse();
    }

    public async Task<RemediationTrackerCatalogueResponse> GetCatalogueAsync(int customerId, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/customers/{customerId}/remediation-tracker/catalogue");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RemediationTrackerException(
                $"GET /api/msp/customers/{customerId}/remediation-tracker/catalogue returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        return JsonSerializer.Deserialize<RemediationTrackerCatalogueResponse>(body, JsonOptions) ?? new RemediationTrackerCatalogueResponse();
    }

    public async Task<RemediationTrackerStep> SetStepStatusAsync(
        int customerId,
        string stepId,
        string status,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(stepId)) throw new ArgumentException("stepId is required", nameof(stepId));
        if (string.IsNullOrWhiteSpace(status)) throw new ArgumentException("status is required", nameof(status));

        using var request = new HttpRequestMessage(
            HttpMethod.Put,
            $"{_baseUrl}/api/msp/customers/{customerId}/remediation-tracker/steps/{Uri.EscapeDataString(stepId)}")
        {
            Content = JsonContent.Create(new { status }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RemediationTrackerException(
                $"PUT /api/msp/customers/{customerId}/remediation-tracker/steps/{stepId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<RemediationTrackerStepUpdateResponse>(body, JsonOptions);
        return parsed?.Step ?? throw new RemediationTrackerException(
            $"PUT /api/msp/customers/{customerId}/remediation-tracker/steps/{stepId} returned an empty step",
            (int)response.StatusCode,
            body);
    }

    public async Task<RemediationTrackerStep> SetStepNoteAsync(
        int customerId,
        string stepId,
        string? note,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(stepId)) throw new ArgumentException("stepId is required", nameof(stepId));

        using var request = new HttpRequestMessage(
            HttpMethod.Put,
            $"{_baseUrl}/api/msp/customers/{customerId}/remediation-tracker/steps/{Uri.EscapeDataString(stepId)}/note")
        {
            Content = JsonContent.Create(new { note }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new RemediationTrackerException(
                $"PUT /api/msp/customers/{customerId}/remediation-tracker/steps/{stepId}/note returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<RemediationTrackerStepUpdateResponse>(body, JsonOptions);
        return parsed?.Step ?? throw new RemediationTrackerException(
            $"PUT /api/msp/customers/{customerId}/remediation-tracker/steps/{stepId}/note returned an empty step",
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
/// Real failure from the remediation tracker endpoints — carries the actual
/// status code + response body so a caller can distinguish a 401/403 (auth
/// not wired yet), a 400 (e.g. the server's own "accepted_risk cannot be set
/// directly" rejection), or a genuine 500.
/// </summary>
public sealed class RemediationTrackerException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public RemediationTrackerException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
