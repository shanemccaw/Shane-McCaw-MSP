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
/// Real HTTP client for the automation registry endpoints
/// (/api/admin/automation-registry/..., admin-automation-registry.ts, Git #3771) — no local
/// fixture list, just the real `automation_registry` rows those endpoints insert/return.
/// </summary>
public sealed class AutomationRegistryService : IAutomationRegistryService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // status/notes are optional server-side — omitting an unset field, not sending null, is
        // what "not supplied" means to the server's zod schemas (same convention as
        // AdminRetainerService).
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public string? AuthToken { get; set; }

    public AutomationRegistryService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<IReadOnlyList<AutomationRegistryEntry>> GetEntriesAsync(
        int customerId,
        CancellationToken cancellationToken = default)
    {
        if (customerId <= 0) throw new ArgumentException("customerId is required", nameof(customerId));

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/admin/automation-registry/{customerId}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AutomationRegistryException(
                $"GET /api/admin/automation-registry/{customerId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<AutomationRegistryListResponse>(body, JsonOptions);
        return parsed?.Entries ?? new List<AutomationRegistryEntry>();
    }

    public async Task<AutomationRegistryEntry> CreateEntryAsync(
        int customerId,
        string type,
        string name,
        string? status = null,
        string? notes = null,
        CancellationToken cancellationToken = default)
    {
        if (customerId <= 0) throw new ArgumentException("customerId is required", nameof(customerId));
        if (string.IsNullOrWhiteSpace(type)) throw new ArgumentException("type is required", nameof(type));
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("name is required", nameof(name));

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/admin/automation-registry/{customerId}")
        {
            Content = JsonContent.Create(new { type, name, status, notes }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AutomationRegistryException(
                $"POST /api/admin/automation-registry/{customerId} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<AutomationRegistryEntryResponse>(body, JsonOptions);
        return parsed?.Entry ?? throw new AutomationRegistryException(
            $"POST /api/admin/automation-registry/{customerId} returned an empty entry",
            (int)response.StatusCode,
            body);
    }

    public async Task<AutomationRegistryEntry> UpdateEntryAsync(
        int id,
        string? type = null,
        string? name = null,
        string? status = null,
        string? notes = null,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) throw new ArgumentException("id is required", nameof(id));

        using var request = new HttpRequestMessage(HttpMethod.Patch, $"{_baseUrl}/api/admin/automation-registry/entry/{id}")
        {
            Content = JsonContent.Create(new { type, name, status, notes }, options: JsonOptions),
        };
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new AutomationRegistryException(
                $"PATCH /api/admin/automation-registry/entry/{id} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
        }

        var parsed = JsonSerializer.Deserialize<AutomationRegistryEntryResponse>(body, JsonOptions);
        return parsed?.Entry ?? throw new AutomationRegistryException(
            $"PATCH /api/admin/automation-registry/entry/{id} returned an empty entry",
            (int)response.StatusCode,
            body);
    }

    public async Task DeleteEntryAsync(int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) throw new ArgumentException("id is required", nameof(id));

        using var request = new HttpRequestMessage(HttpMethod.Delete, $"{_baseUrl}/api/admin/automation-registry/entry/{id}");
        Authorize(request);

        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new AutomationRegistryException(
                $"DELETE /api/admin/automation-registry/entry/{id} returned {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode,
                body);
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

/// <summary>Real failure from the automation registry endpoints — carries the actual status code
/// and response body, same shape as <see cref="AdminRetainerException"/>.</summary>
public sealed class AutomationRegistryException : Exception
{
    public int StatusCode { get; }
    public string ResponseBody { get; }

    public AutomationRegistryException(string message, int statusCode, string responseBody) : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
