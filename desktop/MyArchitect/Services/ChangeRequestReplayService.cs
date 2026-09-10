using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real implementation of #3459's catalog-backed "Replay last run": calls the existing
/// GET /api/msp/change-requests endpoint, filters client-side to this tenant + catalog action,
/// and returns the most recent real proposed_payload — never a fabricated one.
///
/// KNOWN GAP (flagged, not silently worked around): this endpoint requires requireAuth +
/// requireCapability("ladder.msp-operator") server-side, and MyArchitect has no MSP-operator
/// authentication/session mechanism yet (same real gap AssessmentService's HTTP calls to
/// /api/portal/* already have — see its try/catch-and-degrade pattern, mirrored here). Until
/// that lands, calls here will 401 and this returns null, exactly like AssessmentService
/// degrades to "Standby/Disconnected" today; it does not throw or crash the caller.
/// </summary>
public sealed class ChangeRequestReplayService : IChangeRequestReplayService
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public ChangeRequestReplayService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    }

    public async Task<ChangeRequestReplayResult?> GetLastRunAsync(Tenant tenant, int catalogItemId, CancellationToken cancellationToken = default)
    {
        if (tenant == null) throw new ArgumentNullException(nameof(tenant));

        try
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/msp/change-requests", cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;

            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

            ChangeRequestReplayResult? best = null;
            DateTimeOffset bestCreatedAt = DateTimeOffset.MinValue;

            foreach (var row in doc.RootElement.EnumerateArray())
            {
                string rowTenantId = row.TryGetProperty("tenantId", out var t) ? t.GetString() ?? "" : "";
                if (!rowTenantId.Equals(tenant.TenantGuid, StringComparison.OrdinalIgnoreCase)) continue;

                int? rowCatalogItemId = row.TryGetProperty("catalogItemId", out var c) && c.ValueKind == JsonValueKind.Number
                    ? c.GetInt32() : (int?)null;
                if (rowCatalogItemId != catalogItemId) continue;

                if (!row.TryGetProperty("createdAt", out var createdAtEl)) continue;
                if (!DateTimeOffset.TryParse(createdAtEl.GetString(), out var createdAt)) continue;
                if (createdAt <= bestCreatedAt && best != null) continue;

                string id = row.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                string payload = row.TryGetProperty("proposedPayload", out var p) ? p.GetRawText() : "{}";

                best = new ChangeRequestReplayResult
                {
                    ChangeRequestId = id,
                    ProposedPayloadJson = payload,
                    CreatedAtUtc = createdAt,
                };
                bestCreatedAt = createdAt;
            }

            return best;
        }
        catch
        {
            // Backend unreachable / unauthenticated / malformed response — replay simply isn't
            // available right now. No fabricated fallback.
            return null;
        }
    }
}
