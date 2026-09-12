using System;
using System.Collections.Generic;
using System.Linq;
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
/// Real HTTP client for the MSP change-control surface — GET the queue
/// (msp-changes.ts), then record + attest execution (msp-change-executions.ts).
/// #3471's catalog-backed consumer: no new gating layer, no local change-request
/// model — this reads and writes the exact same `msp_change_requests` /
/// change-execution records the customer-facing change-control page and the
/// MSP console already use.
/// </summary>
public sealed class ChangeControlService : IChangeControlService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // Human-action/attest fields are z.string().optional() server-side —
        // undefined (omitted), not null, is what "not supplied" means to that
        // schema. Only affects writes; reads are unaffected.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    /// <summary>
    /// Bearer token attached to every request, once MyArchitect has a real
    /// auth/session mechanism to source one from — none exists yet anywhere in
    /// this app (see LaunchControlActionsService's own note, #3460/#3501).
    /// These routes are gated by requireCapability("ladder.msp-operator"), so a
    /// call made with this unset will legitimately 401/403 rather than succeed.
    /// </summary>
    public string? AuthToken { get; set; }

    public ChangeControlService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<ChangeRequest>> GetChangeRequestsAsync(
        string? tenantGuid = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/change-requests");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"GET /api/msp/change-requests returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var rows = JsonSerializer.Deserialize<List<ChangeRequest>>(body, JsonOptions) ?? new List<ChangeRequest>();

        if (string.IsNullOrWhiteSpace(tenantGuid))
        {
            return rows;
        }

        // GET /api/msp/change-requests has no per-tenant filter server-side —
        // filter client-side, same approach #3459's ChangeRequestReplayService
        // already takes against this same endpoint.
        return rows
            .Where(r => string.Equals(r.TenantId, tenantGuid, StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    public async Task<ChangeRequestExecution> RecordHumanActionAsync(
        int changeRequestId,
        string? implementer = null,
        string? attestationNote = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/change-control/executions/human-action")
        {
            Content = JsonContent.Create(
                new { changeRequestId, implementer, attestationNote },
                options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"POST /api/msp/change-control/executions/human-action returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestExecutionResponse>(body, JsonOptions);
        return parsed?.Execution ?? throw new ChangeControlException(
            "POST /api/msp/change-control/executions/human-action returned an empty execution",
            (int)response.StatusCode,
            body);
    }

    public async Task<ChangeRequestExecution> AttestExecutionAsync(
        int executionId,
        string? attestationNote = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/change-control/executions/{executionId}/attest")
        {
            Content = JsonContent.Create(new { attestationNote }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"POST /api/msp/change-control/executions/{executionId}/attest returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestExecutionResponse>(body, JsonOptions);
        return parsed?.Execution ?? throw new ChangeControlException(
            $"POST /api/msp/change-control/executions/{executionId}/attest returned an empty execution",
            (int)response.StatusCode,
            body);
    }

    public async Task<IReadOnlyList<ChangeRequestExecution>> GetExecutionsForChangeAsync(
        int changeRequestId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/change-control/executions?changeRequestId={changeRequestId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"GET /api/msp/change-control/executions returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestExecutionListResponse>(body, JsonOptions);
        return parsed?.Executions ?? new List<ChangeRequestExecution>();
    }

    public async Task<IReadOnlyList<ChangeRequestPir>> GetPirsForChangeAsync(
        int changeRequestId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{_baseUrl}/api/msp/change-control/pirs?changeRequestId={changeRequestId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"GET /api/msp/change-control/pirs returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestPirListResponse>(body, JsonOptions);
        return parsed?.Pirs ?? new List<ChangeRequestPir>();
    }

    public async Task<ChangeRequestPir> RecordPirAsync(
        int executionId,
        string closeCode,
        string summary,
        string? issuesNoted = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/msp/change-control/executions/{executionId}/pir")
        {
            Content = JsonContent.Create(new { closeCode, summary, issuesNoted }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"POST /api/msp/change-control/executions/{executionId}/pir returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestPirResponse>(body, JsonOptions);
        return parsed?.Pir ?? throw new ChangeControlException(
            $"POST /api/msp/change-control/executions/{executionId}/pir returned an empty PIR",
            (int)response.StatusCode,
            body);
    }

    public async Task<ChangeRequestRollbackResult> RaiseRollbackAsync(
        int changeRequestId,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{_baseUrl}/api/msp/change-control/change-requests/{changeRequestId}/rollback");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"POST /api/msp/change-control/change-requests/{changeRequestId}/rollback returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeRequestRollbackResult>(body, JsonOptions);
        return parsed ?? throw new ChangeControlException(
            $"POST /api/msp/change-control/change-requests/{changeRequestId}/rollback returned an empty result",
            (int)response.StatusCode,
            body);
    }

    public async Task<IReadOnlyList<ChangeFreezeWindow>> GetFreezeWindowsAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/change-freeze-windows");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"GET /api/msp/change-freeze-windows returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeFreezeWindowsResponse>(body, JsonOptions);
        return parsed?.Windows ?? new List<ChangeFreezeWindow>();
    }

    public async Task<IReadOnlyList<ChangeMaintenanceWindow>> GetMaintenanceWindowsAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/msp/change-maintenance-windows");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new ChangeControlException(
                $"GET /api/msp/change-maintenance-windows returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<ChangeMaintenanceWindowsResponse>(body, JsonOptions);
        return parsed?.Windows ?? new List<ChangeMaintenanceWindow>();
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
/// Real failure from the change-control endpoints — carries the actual status
/// code + response body so a caller can distinguish a 401/403 (auth not wired
/// yet), a 404 (CR not found for this MSP), a 409 (attest.ts's "not found, not
/// a human action, or already attested"), or a genuine 500.
/// </summary>
public sealed class ChangeControlException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public ChangeControlException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
