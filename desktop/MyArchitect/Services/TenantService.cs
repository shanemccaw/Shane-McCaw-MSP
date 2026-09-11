using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Real client for <c>GET /api/msp/v1/msps/:mspId/customers</c>
/// (<c>artifacts/api-server/src/routes/msp-v1.ts</c>) — the MSP-scoped, paginated customer
/// list, gated by <c>requireCapability("ladder.msp-operator")</c> +
/// <c>requireMspScope("params")</c>. Replaces the four hardcoded fixture tenants MyArchitect
/// shipped with (#3540); the mspId comes from #3501's real signed-in session and the bearer
/// token is fanned out from <c>MainWindow.ApplyAuthState</c> exactly like every other
/// real-endpoint service in this app.
/// </summary>
public sealed class TenantService : ITenantService
{
    // Server's own MAX_PAGE_SIZE (artifacts/api-server/src/lib/api-helpers.ts) — requesting more
    // than this per page is silently clamped server-side, so this is also this client's page size.
    private const int PageSize = 100;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly List<Tenant> _tenants = new();
    private Tenant? _currentTenant;

    public event EventHandler<Tenant?>? CurrentTenantChanged;
    public event EventHandler? TenantsChanged;

    public string? AuthToken { get; set; }
    public bool IsLoaded { get; private set; }
    public string? LoadError { get; private set; }

    public TenantService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public IReadOnlyList<Tenant> Tenants => _tenants.AsReadOnly();

    public Tenant? CurrentTenant
    {
        get => _currentTenant;
        set
        {
            if (_currentTenant != value)
            {
                _currentTenant = value;
                CurrentTenantChanged?.Invoke(this, _currentTenant);
            }
        }
    }

    public void SelectTenant(string tenantId)
    {
        var tenant = _tenants.FirstOrDefault(t => t.Id.Equals(tenantId, StringComparison.OrdinalIgnoreCase) ||
                                                 t.TenantGuid.Equals(tenantId, StringComparison.OrdinalIgnoreCase));
        if (tenant != null)
        {
            CurrentTenant = tenant;
        }
    }

    public async Task LoadTenantsAsync(int mspId, CancellationToken cancellationToken = default)
    {
        // #3618 — the HTTP awaits below use ConfigureAwait(false) (the service-layer convention), so
        // this method's continuation resumes on a threadpool thread. The state commits + event raises
        // (CurrentTenant setter → CurrentTenantChanged, TenantsChanged) are handled by UI subscribers
        // that touch WPF elements directly (TenantSwitcher, MainWindow.OnCurrentTenantChanged, the
        // telemetry/SOW views), so raising them off the UI thread throws the cross-thread
        // "The calling thread cannot access this object because a different thread owns it"
        // InvalidOperationException. Capture the calling context (the UI thread — this is always
        // awaited from it) and run every commit-and-raise block back on it via Commit(). A null
        // context (headless/unit-test) runs inline, unchanged from the old behaviour.
        var callerContext = SynchronizationContext.Current;
        void Commit(Action commit)
        {
            if (callerContext != null && callerContext != SynchronizationContext.Current)
            {
                callerContext.Send(_ => commit(), null);
            }
            else
            {
                commit();
            }
        }

        if (mspId <= 0)
        {
            // No real MSP context (signed out) — clear rather than call an endpoint that would
            // 401/403 anyway.
            Commit(() =>
            {
                _tenants.Clear();
                CurrentTenant = null;
                IsLoaded = false;
                LoadError = null;
                TenantsChanged?.Invoke(this, EventArgs.Empty);
            });
            return;
        }

        try
        {
            var loaded = new List<Tenant>();
            var page = 1;
            while (true)
            {
                using var request = new HttpRequestMessage(
                    HttpMethod.Get,
                    $"{_baseUrl}/api/msp/v1/msps/{mspId}/customers?page={page}&pageSize={PageSize}&sortBy=name&sortDir=asc");

                if (!string.IsNullOrWhiteSpace(AuthToken))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
                }

                using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
                var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

                if (!response.IsSuccessStatusCode)
                {
                    // Real, honest failure — most likely 401/403 while auth is settling, or a
                    // genuinely unreachable server. Never synthesized client-side.
                    throw new InvalidOperationException(
                        $"GET /api/msp/v1/msps/{mspId}/customers returned {(int)response.StatusCode} {response.ReasonPhrase}: {body}");
                }

                var parsed = JsonSerializer.Deserialize<CustomerListResponse>(body, JsonOptions) ?? new CustomerListResponse();
                loaded.AddRange(parsed.Data.Select(ToTenant));

                if (parsed.Data.Count == 0 || parsed.Meta.Page >= parsed.Meta.TotalPages)
                {
                    break;
                }

                page++;
            }

            Commit(() =>
            {
                var previousGuid = _currentTenant?.TenantGuid;

                _tenants.Clear();
                _tenants.AddRange(loaded);
                IsLoaded = true;
                LoadError = null;

                // Preserve the current selection across a reload when it still exists; otherwise
                // fall back to the first real customer (or null if the MSP genuinely has none).
                var restored = !string.IsNullOrEmpty(previousGuid)
                    ? _tenants.FirstOrDefault(t => t.TenantGuid.Equals(previousGuid, StringComparison.OrdinalIgnoreCase))
                    : null;
                CurrentTenant = restored ?? _tenants.FirstOrDefault();

                TenantsChanged?.Invoke(this, EventArgs.Empty);
            });
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Commit(() =>
            {
                _tenants.Clear();
                CurrentTenant = null;
                IsLoaded = false;
                LoadError = ex.Message;
                TenantsChanged?.Invoke(this, EventArgs.Empty);
            });
        }
    }

    private static Tenant ToTenant(CustomerDto dto) => new()
    {
        Id = dto.Id.ToString(),
        CustomerId = dto.Id,
        Name = dto.Name,
        TenantGuid = dto.TenantId ?? string.Empty,
        Domain = dto.Domain,
        Industry = dto.Industry,
        Status = dto.Status,
        IsTestbed = dto.IsTestbed,
        PortalUrls = TenantPortalUrls.CreateForTenant(dto.TenantId ?? string.Empty),
    };

    // ── Wire DTOs — mirror msp-v1.ts's explicit projection exactly (msp-v1.ts:144-157) ─────────

    private sealed class CustomerListResponse
    {
        [JsonPropertyName("data")]
        public List<CustomerDto> Data { get; set; } = new();

        [JsonPropertyName("meta")]
        public PaginationMeta Meta { get; set; } = new();
    }

    private sealed class CustomerDto
    {
        public int Id { get; set; }
        public int MspId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Domain { get; set; }
        public string? Industry { get; set; }
        public string? TenantId { get; set; }
        public string? TenantUrl { get; set; }
        public string? Status { get; set; }
        public bool IsTestbed { get; set; }
        public DateTimeOffset? CreatedAt { get; set; }
        public DateTimeOffset? UpdatedAt { get; set; }
    }

    private sealed class PaginationMeta
    {
        public int Page { get; set; } = 1;
        public int PageSize { get; set; }
        public int Total { get; set; }
        public int TotalPages { get; set; } = 1;
    }
}
