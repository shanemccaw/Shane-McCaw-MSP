using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public enum ClaudeStatusHealth
    {
        Operational,  // green - "none" indicator / All Systems Operational
        Minor,        // peach / yellow - "minor" / degraded performance
        Major,        // red - "major" / "critical" outage
        Unknown       // grey - network or parse failure
    }

    public class ClaudeStatusInfo
    {
        public ClaudeStatusHealth Health { get; set; } = ClaudeStatusHealth.Unknown;
        public string Indicator { get; set; } = "unknown";
        public string Description { get; set; } = "Checking...";
        public DateTimeOffset? UpdatedAt { get; set; }
        public DateTime CheckedAt { get; set; } = DateTime.Now;
        public string PageUrl { get; set; } = "https://status.anthropic.com/";
    }

    /// <summary>
    /// Polls Anthropic's public Statuspage API (https://status.anthropic.com/api/v2/status.json)
    /// to provide a live Claude service health indicator in the Status Bar.
    /// </summary>
    public class ClaudeStatusService
    {
        private const string StatusApiUrl = "https://status.anthropic.com/api/v2/status.json";
        private static readonly HttpClient _httpClient = new()
        {
            Timeout = TimeSpan.FromSeconds(10)
        };

        static ClaudeStatusService()
        {
            try
            {
                _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 BuildConsole");
                _httpClient.DefaultRequestHeaders.Accept.ParseAdd("application/json");
            }
            catch { }
        }

        public event EventHandler<ClaudeStatusInfo>? StatusChanged;
        public ClaudeStatusInfo CurrentStatus { get; private set; } = new();

        public async Task<ClaudeStatusInfo> CheckStatusAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync(StatusApiUrl);
                if (response.IsSuccessStatusCode)
                {
                    var json = await response.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;

                    string indicator = "none";
                    string description = "All Systems Operational";
                    DateTimeOffset? updatedAt = null;
                    string pageUrl = "https://status.anthropic.com/";

                    if (root.TryGetProperty("page", out var pageEl))
                    {
                        if (pageEl.TryGetProperty("url", out var urlEl) && urlEl.GetString() is string u) pageUrl = u;
                        if (pageEl.TryGetProperty("updated_at", out var upEl) && DateTimeOffset.TryParse(upEl.GetString(), out var dt)) updatedAt = dt;
                    }

                    if (root.TryGetProperty("status", out var statusEl))
                    {
                        if (statusEl.TryGetProperty("indicator", out var indEl) && indEl.GetString() is string ind) indicator = ind.ToLowerInvariant();
                        if (statusEl.TryGetProperty("description", out var descEl) && descEl.GetString() is string desc) description = desc;
                    }

                    var health = indicator switch
                    {
                        "none" => ClaudeStatusHealth.Operational,
                        "minor" => ClaudeStatusHealth.Minor,
                        "major" or "critical" => ClaudeStatusHealth.Major,
                        _ => ClaudeStatusHealth.Operational
                    };

                    var info = new ClaudeStatusInfo
                    {
                        Health = health,
                        Indicator = indicator,
                        Description = description,
                        UpdatedAt = updatedAt,
                        CheckedAt = DateTime.Now,
                        PageUrl = pageUrl
                    };

                    CurrentStatus = info;
                    StatusChanged?.Invoke(this, info);
                    ActivityLog.Log("claude-status", $"Health: {health} ({description}, indicator={indicator})");
                    return info;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log("claude-status", $"Check failed: {ex.Message}");
            }

            var errInfo = new ClaudeStatusInfo
            {
                Health = ClaudeStatusHealth.Unknown,
                Indicator = "error",
                Description = "Status unavailable",
                CheckedAt = DateTime.Now
            };
            CurrentStatus = errInfo;
            StatusChanged?.Invoke(this, errInfo);
            return errInfo;
        }
    }
}
