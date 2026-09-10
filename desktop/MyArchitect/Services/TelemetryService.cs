using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Telemetry service querying the 5 confirmed real endpoints scoped by the active tenant (Issue #3476).
/// Pure API consumption without remote database dependencies or fixture fabrication.
/// </summary>
public sealed class TelemetryService : ITelemetryService
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    /// <summary>Bearer token attached to every request, sourced from the real MyArchitect
    /// session (#3501) and pushed in by the shell on sign-in/refresh. All five telemetry
    /// endpoints are auth-gated; with this unset they 401 — which previously vanished into a
    /// generic "Backend Standby / Offline" status. When set, real data flows; when a call
    /// comes back 401/403, that is now surfaced as an authentication failure rather than
    /// masked as the backend being offline (#3476).</summary>
    public string? AuthToken { get; set; }

    // Records whether the most recent FetchTelemetryAsync saw a 401/403, so the source-status
    // line can distinguish "not signed in / not authorized" from "backend genuinely offline".
    private bool _lastRunHadAuthFailure;

    public TelemetryService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(3)
        };
    }

    /// <summary>Issues a GET with the current <see cref="AuthToken"/> attached as a Bearer
    /// header, and records a 401/403 into <see cref="_lastRunHadAuthFailure"/> so the caller
    /// can surface a real auth failure instead of swallowing it as "offline".</summary>
    private async Task<HttpResponseMessage> SendGetAsync(string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrWhiteSpace(AuthToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthToken);
        }

        var response = await _httpClient.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden)
        {
            _lastRunHadAuthFailure = true;
        }
        return response;
    }

    public async Task<TenantTelemetryDashboard> FetchTelemetryAsync(Tenant tenant, bool sinceYesterdayOnly = false)
    {
        var dashboard = new TenantTelemetryDashboard
        {
            TenantId = tenant.Id,
            TenantName = tenant.Name,
            TenantGuid = tenant.TenantGuid,
            Timestamp = DateTimeOffset.UtcNow,
            SourceStatus = "Live Telemetry Connected"
        };

        bool anyEndpointReached = false;
        _lastRunHadAuthFailure = false;

        // 1. Live Engine Outputs (/api/admin/engines/:key/dashboard)
        string[] engineKeys = { "security", "compliance", "identity", "copilot" };
        foreach (var key in engineKeys)
        {
            try
            {
                var res = await SendGetAsync($"{_baseUrl}/api/admin/engines/{key}/dashboard?tenantId={tenant.TenantGuid}");
                if (res.IsSuccessStatusCode)
                {
                    anyEndpointReached = true;
                    var json = await res.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(json);
                    var item = new EngineTelemetryItem
                    {
                        Key = key,
                        Name = Capitalize(key),
                        Status = doc.RootElement.TryGetProperty("status", out var st) ? st.GetString() ?? "Healthy" : "Healthy",
                        Score = doc.RootElement.TryGetProperty("score", out var sc) ? sc.GetInt32() : 100,
                        FindingsCount = doc.RootElement.TryGetProperty("findingsCount", out var fc) ? fc.GetInt32() : 0,
                        LastEvaluated = doc.RootElement.TryGetProperty("evaluatedAt", out var ea) ? ea.GetString() ?? "Live" : "Live"
                    };
                    dashboard.Engines.Add(item);
                }
            }
            catch
            {
                // Engine route offline
            }
        }

        // 2. Drift Changes (/api/admin/drift/events or /api/admin/engines/drift/history)
        try
        {
            var res = await SendGetAsync($"{_baseUrl}/api/admin/drift/events?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("events", out var evs) && evs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ev in evs.EnumerateArray())
                    {
                        dashboard.DriftEvents.Add(new DriftTelemetryItem
                        {
                            EventId = ev.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                            SettingKey = ev.TryGetProperty("settingKey", out var sk) ? sk.GetString() ?? "" : "",
                            OldValue = ev.TryGetProperty("oldValue", out var ov) ? ov.GetString() ?? "" : "",
                            NewValue = ev.TryGetProperty("newValue", out var nv) ? nv.GetString() ?? "" : "",
                            Verdict = ev.TryGetProperty("verdict", out var v) ? v.GetString() ?? "Unapproved" : "Unapproved",
                            DetectedAt = ev.TryGetProperty("detectedAt", out var da) ? da.GetString() ?? "" : ""
                        });
                    }
                }
            }
        }
        catch
        {
            // Drift route offline
        }

        // 3. SOW Progress (/api/portal/remediation/checklist)
        try
        {
            var res = await SendGetAsync($"{_baseUrl}/api/portal/remediation/checklist?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("steps", out var steps) && steps.ValueKind == JsonValueKind.Array)
                {
                    int total = 0;
                    int completed = 0;
                    foreach (var s in steps.EnumerateArray())
                    {
                        total++;
                        if (s.TryGetProperty("isCompleted", out var ic) && ic.GetBoolean())
                        {
                            completed++;
                        }
                    }
                    dashboard.SowProgress = new SowRemediationTelemetry
                    {
                        TotalSteps = total,
                        CompletedSteps = completed
                    };
                }
            }
        }
        catch
        {
            // Remediation checklist offline
        }

        // 4. Copilot Readiness Deltas (/api/admin/engines/copilot/history — admin-scoped by customerId,
        //    same real tenant_engine_snapshots history the health engine's copilot sub-score reads from)
        try
        {
            var res = await SendGetAsync($"{_baseUrl}/api/admin/engines/copilot/history?customerId={tenant.Id}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("series", out var series) && series.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in series.EnumerateArray())
                    {
                        int score = s.TryGetProperty("score", out var sc) ? sc.GetInt32() : 0;
                        int delta = s.TryGetProperty("delta", out var dl) && dl.ValueKind == JsonValueKind.Number ? dl.GetInt32() : 0;
                        string date = s.TryGetProperty("date", out var sd) ? sd.GetString() ?? "" : "";
                        string trend = s.TryGetProperty("trendDirection", out var td) && td.ValueKind == JsonValueKind.String
                            ? td.GetString() ?? "Stable"
                            : (delta > 0 ? "Improving" : (delta < 0 ? "Degraded" : "Stable"));

                        dashboard.CopilotDeltas.Add(new CopilotDeltaTelemetry
                        {
                            ScanDate = date,
                            Score = score,
                            Delta = delta,
                            Verdict = trend
                        });
                    }
                }
            }
        }
        catch
        {
            // Engine history offline
        }

        // 5. Aggregated Customer Timeline Feed (/api/portal/customer/timeline or /api/msp/timeline)
        try
        {
            var res = await SendGetAsync($"{_baseUrl}/api/portal/customer/timeline?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("events", out var events) && events.ValueKind == JsonValueKind.Array)
                {
                    var cutoff = DateTimeOffset.UtcNow.AddDays(-1);
                    foreach (var ev in events.EnumerateArray())
                    {
                        var ts = ev.TryGetProperty("timestamp", out var t) && DateTimeOffset.TryParse(t.GetString(), out var parsedTs)
                            ? parsedTs
                            : DateTimeOffset.UtcNow;

                        if (sinceYesterdayOnly && ts < cutoff)
                        {
                            continue;
                        }

                        dashboard.TimelineFeed.Add(new TimelineTelemetryItem
                        {
                            Id = ev.TryGetProperty("id", out var id) ? id.GetString() ?? "" : Guid.NewGuid().ToString(),
                            Title = ev.TryGetProperty("title", out var title) ? title.GetString() ?? "" : "",
                            Summary = ev.TryGetProperty("summary", out var sm) ? sm.GetString() ?? "" : "",
                            Category = ev.TryGetProperty("category", out var cat) ? cat.GetString() ?? "General" : "General",
                            Severity = ev.TryGetProperty("severity", out var sev) ? sev.GetString() ?? "info" : "info",
                            Timestamp = ts
                        });
                    }
                }
            }
        }
        catch
        {
            // Timeline route offline
        }

        if (!anyEndpointReached)
        {
            // Surface a real auth failure honestly instead of masking it as "offline" (#3476,
            // #3501): if every call came back 401/403, the backend is reachable — we're just
            // not signed in / not authorized — which is an actionable, different problem.
            dashboard.SourceStatus = _lastRunHadAuthFailure
                ? "Live Telemetry (Authentication required — sign in)"
                : "Live Telemetry (Backend Standby / Offline)";
        }

        return dashboard;
    }

    private static string Capitalize(string text) =>
        string.IsNullOrEmpty(text) ? text : char.ToUpper(text[0]) + text.Substring(1);
}
