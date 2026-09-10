using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Telemetry data contracts for live tenant telemetry console (Issue #3476).
/// Consumes real engine outputs, drift changes, SOW progress, Copilot deltas, and customer timeline feed.
/// </summary>
public sealed class TenantTelemetryDashboard
{
    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("tenantName")]
    public string TenantName { get; set; } = string.Empty;

    [JsonPropertyName("tenantGuid")]
    public string TenantGuid { get; set; } = string.Empty;

    [JsonPropertyName("timestamp")]
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;

    [JsonPropertyName("sourceStatus")]
    public string SourceStatus { get; set; } = "Live Connected";

    // 1. Live Engine Outputs (/admin/engines/:key/dashboard)
    [JsonPropertyName("engines")]
    public List<EngineTelemetryItem> Engines { get; set; } = new();

    // 2. Drift Changes (/admin/engines/drift/history)
    [JsonPropertyName("driftEvents")]
    public List<DriftTelemetryItem> DriftEvents { get; set; } = new();

    // 3. SOW Progress (/portal/remediation-checklist)
    [JsonPropertyName("sowProgress")]
    public SowRemediationTelemetry SowProgress { get; set; } = new();

    // 4. Copilot Readiness Deltas (msp-engine-history.ts)
    [JsonPropertyName("copilotDeltas")]
    public List<CopilotDeltaTelemetry> CopilotDeltas { get; set; } = new();

    // 5. Aggregated Customer Timeline (/msp/timeline)
    [JsonPropertyName("timelineFeed")]
    public List<TimelineTelemetryItem> TimelineFeed { get; set; } = new();

    [JsonIgnore]
    public string FormattedTime => Timestamp.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}

public sealed class EngineTelemetryItem
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = "Healthy";

    [JsonPropertyName("score")]
    public int Score { get; set; } = 100;

    [JsonPropertyName("findingsCount")]
    public int FindingsCount { get; set; } = 0;

    [JsonPropertyName("lastEvaluated")]
    public string LastEvaluated { get; set; } = string.Empty;
}

public sealed class DriftTelemetryItem
{
    [JsonPropertyName("eventId")]
    public string EventId { get; set; } = string.Empty;

    [JsonPropertyName("settingKey")]
    public string SettingKey { get; set; } = string.Empty;

    [JsonPropertyName("oldValue")]
    public string OldValue { get; set; } = string.Empty;

    [JsonPropertyName("newValue")]
    public string NewValue { get; set; } = string.Empty;

    [JsonPropertyName("verdict")]
    public string Verdict { get; set; } = "Unapproved";

    [JsonPropertyName("detectedAt")]
    public string DetectedAt { get; set; } = string.Empty;
}

public sealed class SowRemediationTelemetry
{
    [JsonPropertyName("completedSteps")]
    public int CompletedSteps { get; set; } = 0;

    [JsonPropertyName("totalSteps")]
    public int TotalSteps { get; set; } = 0;

    [JsonPropertyName("completionPercentage")]
    public double CompletionPercentage => TotalSteps > 0
        ? Math.Round((double)CompletedSteps / TotalSteps * 100.0, 1)
        : 0.0;
}

public sealed class CopilotDeltaTelemetry
{
    [JsonPropertyName("scanDate")]
    public string ScanDate { get; set; } = string.Empty;

    [JsonPropertyName("score")]
    public int Score { get; set; } = 85;

    [JsonPropertyName("delta")]
    public int Delta { get; set; } = 0;

    [JsonPropertyName("verdict")]
    public string Verdict { get; set; } = "Stable";

    [JsonIgnore]
    public string DisplayDelta => Delta > 0 ? $"+{Delta}" : Delta.ToString();
}

public sealed class TimelineTelemetryItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("summary")]
    public string Summary { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = "General";

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = "info";

    [JsonPropertyName("timestamp")]
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;

    [JsonIgnore]
    public string FormattedTime => Timestamp.ToLocalTime().ToString("MMM dd, HH:mm");

    [JsonIgnore]
    public bool IsSinceYesterday => Timestamp >= DateTimeOffset.UtcNow.AddDays(-1);
}
