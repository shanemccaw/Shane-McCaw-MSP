using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using MyArchitect.Models;

namespace MyArchitect.Services;

/// <summary>
/// Implementation of IAssessmentService consuming confirmed real API endpoints
/// and providing local JSON snapshot load/save capabilities (Issue #3475).
/// </summary>
public sealed class AssessmentService : IAssessmentService
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public AssessmentService(HttpClient? httpClient = null, string? baseUrl = null)
    {
        _baseUrl = !string.IsNullOrWhiteSpace(baseUrl)
            ? baseUrl.TrimEnd('/')
            : (Environment.GetEnvironmentVariable("API_BASE_URL")?.TrimEnd('/') ?? "http://localhost:8080");

        _httpClient = httpClient ?? new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(3)
        };
    }

    public async Task<TenantAssessmentSnapshot> FetchLiveAssessmentAsync(Tenant tenant)
    {
        var snapshot = new TenantAssessmentSnapshot
        {
            TenantId = tenant.Id,
            TenantName = tenant.Name,
            TenantGuid = tenant.TenantGuid,
            SnapshotTimestamp = DateTimeOffset.UtcNow,
            Source = "Live Backend",
            CopilotGateThreshold = 82
        };

        bool anyEndpointReached = false;

        // 1. Copilot Gate & Pillar Scores (/portal/pillars)
        try
        {
            var res = await _httpClient.GetAsync($"{_baseUrl}/api/portal/pillars?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("copilotScore", out var cs))
                {
                    snapshot.CopilotScore = cs.GetInt32();
                }
                if (doc.RootElement.TryGetProperty("pillars", out var pillars) && pillars.ValueKind == JsonValueKind.Array)
                {
                    foreach (var p in pillars.EnumerateArray())
                    {
                        snapshot.PillarScores.Add(new PillarScoreItem
                        {
                            PillarKey = p.TryGetProperty("key", out var k) ? k.GetString() ?? "" : "",
                            Name = p.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                            Score = p.TryGetProperty("score", out var s) ? s.GetInt32() : 0,
                            Status = p.TryGetProperty("status", out var st) ? st.GetString() ?? "Good" : "Good"
                        });
                    }
                }
            }
        }
        catch
        {
            // Dev backend offline / unreachable
        }

        // 2. Drift History (/api/admin/drift/events or /admin/engines/drift/history)
        try
        {
            var res = await _httpClient.GetAsync($"{_baseUrl}/api/admin/drift/events?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("summary", out var summary))
                {
                    if (summary.TryGetProperty("totalActive", out var ta)) snapshot.ActiveDriftCount = ta.GetInt32();
                    if (summary.TryGetProperty("unapproved", out var ua)) snapshot.UnapprovedDriftCount = ua.GetInt32();
                }
                if (doc.RootElement.TryGetProperty("events", out var events) && events.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ev in events.EnumerateArray())
                    {
                        snapshot.DriftEvents.Add(new DriftEventItem
                        {
                            EventId = ev.TryGetProperty("id", out var eid) ? eid.GetString() ?? "" : "",
                            SettingKey = ev.TryGetProperty("settingKey", out var sk) ? sk.GetString() ?? "" : "",
                            Verdict = ev.TryGetProperty("verdict", out var v) ? v.GetString() ?? "Unapproved" : "Unapproved",
                            Status = ev.TryGetProperty("status", out var st) ? st.GetString() ?? "Open" : "Open",
                            DetectedAt = ev.TryGetProperty("detectedAt", out var da) ? da.GetString() ?? "" : ""
                        });
                    }
                }
            }
        }
        catch
        {
            // Dev backend offline / unreachable
        }

        // 3. Oversharing Sites (/api/portal/oversharing/sites)
        try
        {
            var res = await _httpClient.GetAsync($"{_baseUrl}/api/portal/oversharing/sites?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("sites", out var sites) && sites.ValueKind == JsonValueKind.Array)
                {
                    snapshot.TotalOversharedSites = sites.GetArrayLength();
                    foreach (var site in sites.EnumerateArray())
                    {
                        snapshot.OversharedSites.Add(new OversharedSiteItem
                        {
                            SiteName = site.TryGetProperty("siteName", out var sn) ? sn.GetString() ?? "" : "",
                            SiteUrl = site.TryGetProperty("siteUrl", out var su) ? su.GetString() ?? "" : "",
                            SensitiveItemsCount = site.TryGetProperty("sensitiveCount", out var sc) ? sc.GetInt32() : 0,
                            GuestCount = site.TryGetProperty("guestCount", out var gc) ? gc.GetInt32() : 0
                        });
                    }
                }
            }
        }
        catch
        {
            // Dev backend offline / unreachable
        }

        // 4. DLP & PII Governance Signals (/api/portal/pii-governance)
        try
        {
            var res = await _httpClient.GetAsync($"{_baseUrl}/api/portal/pii-governance?tenantId={tenant.TenantGuid}");
            if (res.IsSuccessStatusCode)
            {
                anyEndpointReached = true;
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("dlpIncidentsCount", out var dic)) snapshot.DlpIncidentCount = dic.GetInt32();
                if (doc.RootElement.TryGetProperty("weakDlpPoliciesCount", out var wdc)) snapshot.WeakDlpPoliciesCount = wdc.GetInt32();
                if (doc.RootElement.TryGetProperty("missingLabelsCount", out var mlc)) snapshot.MissingLabelsCount = mlc.GetInt32();
            }
        }
        catch
        {
            // Dev backend offline / unreachable
        }

        // 5. Remediation Progress (/api/portal/remediation-checklist)
        try
        {
            var res = await _httpClient.GetAsync($"{_baseUrl}/api/portal/remediation-checklist?tenantId={tenant.TenantGuid}");
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
                        bool isDone = s.TryGetProperty("isCompleted", out var ic) && ic.GetBoolean();
                        if (isDone) completed++;

                        snapshot.RemediationChecklist.Add(new RemediationChecklistItem
                        {
                            Id = s.TryGetProperty("id", out var sid) ? sid.GetString() ?? "" : "",
                            Title = s.TryGetProperty("title", out var stitle) ? stitle.GetString() ?? "" : "",
                            Pillar = s.TryGetProperty("pillar", out var spillar) ? spillar.GetString() ?? "General" : "General",
                            IsCompleted = isDone,
                            Severity = s.TryGetProperty("severity", out var ssev) ? ssev.GetString() ?? "Medium" : "Medium"
                        });
                    }
                    snapshot.TotalRemediationSteps = total;
                    snapshot.CompletedRemediationSteps = completed;
                }
            }
        }
        catch
        {
            // Dev backend offline / unreachable
        }

        if (!anyEndpointReached)
        {
            snapshot.Source = "Live Backend (API Server Standby / Disconnected)";
        }

        return snapshot;
    }

    public async Task SaveSnapshotAsync(TenantAssessmentSnapshot snapshot, string filePath)
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        var json = JsonSerializer.Serialize(snapshot, options);
        var dir = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }
        await File.WriteAllTextAsync(filePath, json);
    }

    public async Task<TenantAssessmentSnapshot> LoadSnapshotAsync(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException("Snapshot file not found.", filePath);
        }

        var json = await File.ReadAllTextAsync(filePath);
        var snapshot = JsonSerializer.Deserialize<TenantAssessmentSnapshot>(json);
        if (snapshot == null)
        {
            throw new InvalidDataException("Unable to deserialize assessment snapshot from JSON.");
        }

        snapshot.Source = $"Offline Snapshot ({Path.GetFileName(filePath)})";
        return snapshot;
    }
}
