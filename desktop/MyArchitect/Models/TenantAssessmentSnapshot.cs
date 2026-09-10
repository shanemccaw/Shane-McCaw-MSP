using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// Combined assessment and SOW snapshot model for a tenant (Issue #3475).
/// Holds live backend data from the six confirmed real endpoints, and serializes to/from local JSON files
/// for offline viewing and auditing.
/// </summary>
public sealed class TenantAssessmentSnapshot
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0";

    [JsonPropertyName("snapshotTimestamp")]
    public DateTimeOffset SnapshotTimestamp { get; set; } = DateTimeOffset.UtcNow;

    [JsonPropertyName("source")]
    public string Source { get; set; } = "Live Backend";

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    [JsonPropertyName("tenantName")]
    public string TenantName { get; set; } = string.Empty;

    [JsonPropertyName("tenantGuid")]
    public string TenantGuid { get; set; } = string.Empty;

    // ── Copilot Gate & Pillar Scores ──────────────────────────────────
    [JsonPropertyName("copilotScore")]
    public int CopilotScore { get; set; } = 0;

    [JsonPropertyName("copilotGateThreshold")]
    public int CopilotGateThreshold { get; set; } = 82;

    [JsonPropertyName("isGatePassed")]
    public bool IsGatePassed => CopilotScore >= CopilotGateThreshold;

    [JsonPropertyName("gateVerdict")]
    public string GateVerdict => IsGatePassed ? "PASSED" : "BLOCKED";

    [JsonPropertyName("pillarScores")]
    public List<PillarScoreItem> PillarScores { get; set; } = new();

    // ── SOW Phases ────────────────────────────────────────────────────
    [JsonPropertyName("sowPhases")]
    public List<SowPhaseItem> SowPhases { get; set; } = new();

    // ── Remediation Progress ──────────────────────────────────────────
    [JsonPropertyName("completedRemediationSteps")]
    public int CompletedRemediationSteps { get; set; } = 0;

    [JsonPropertyName("totalRemediationSteps")]
    public int TotalRemediationSteps { get; set; } = 0;

    [JsonPropertyName("remediationPercentage")]
    public double RemediationPercentage => TotalRemediationSteps > 0
        ? Math.Round((double)CompletedRemediationSteps / TotalRemediationSteps * 100.0, 1)
        : 0.0;

    [JsonPropertyName("remediationChecklist")]
    public List<RemediationChecklistItem> RemediationChecklist { get; set; } = new();

    // ── Drift Counts ──────────────────────────────────────────────────
    [JsonPropertyName("activeDriftCount")]
    public int ActiveDriftCount { get; set; } = 0;

    [JsonPropertyName("unapprovedDriftCount")]
    public int UnapprovedDriftCount { get; set; } = 0;

    [JsonPropertyName("driftEvents")]
    public List<DriftEventItem> DriftEvents { get; set; } = new();

    // ── Oversharing Counts ────────────────────────────────────────────
    [JsonPropertyName("totalOversharedSites")]
    public int TotalOversharedSites { get; set; } = 0;

    [JsonPropertyName("oversharedSites")]
    public List<OversharedSiteItem> OversharedSites { get; set; } = new();

    // ── DLP Conflicts & Governance ────────────────────────────────────
    [JsonPropertyName("dlpIncidentCount")]
    public int DlpIncidentCount { get; set; } = 0;

    [JsonPropertyName("weakDlpPoliciesCount")]
    public int WeakDlpPoliciesCount { get; set; } = 0;

    [JsonPropertyName("missingLabelsCount")]
    public int MissingLabelsCount { get; set; } = 0;

    // ── Diagnostic Findings ───────────────────────────────────────────
    [JsonPropertyName("findings")]
    public List<DiagnosticFindingItem> Findings { get; set; } = new();

    [JsonIgnore]
    public string FormattedTimestamp => SnapshotTimestamp.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}

public sealed class PillarScoreItem
{
    [JsonPropertyName("pillarKey")]
    public string PillarKey { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("score")]
    public int Score { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "Good";
}

public sealed class SowPhaseItem
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("scope")]
    public string Scope { get; set; } = string.Empty;

    [JsonPropertyName("weeks")]
    public int Weeks { get; set; } = 1;

    [JsonPropertyName("priceUsd")]
    public decimal PriceUsd { get; set; }

    [JsonPropertyName("deliveryDate")]
    public string DeliveryDate { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = "Planned";
}

public sealed class RemediationChecklistItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("pillar")]
    public string Pillar { get; set; } = string.Empty;

    [JsonPropertyName("isCompleted")]
    public bool IsCompleted { get; set; }

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = "Medium";
}

public sealed class DriftEventItem
{
    [JsonPropertyName("eventId")]
    public string EventId { get; set; } = string.Empty;

    [JsonPropertyName("settingKey")]
    public string SettingKey { get; set; } = string.Empty;

    [JsonPropertyName("verdict")]
    public string Verdict { get; set; } = "Unapproved";

    [JsonPropertyName("status")]
    public string Status { get; set; } = "Open";

    [JsonPropertyName("detectedAt")]
    public string DetectedAt { get; set; } = string.Empty;
}

public sealed class OversharedSiteItem
{
    [JsonPropertyName("siteName")]
    public string SiteName { get; set; } = string.Empty;

    [JsonPropertyName("siteUrl")]
    public string SiteUrl { get; set; } = string.Empty;

    [JsonPropertyName("sensitiveItemsCount")]
    public int SensitiveItemsCount { get; set; }

    [JsonPropertyName("guestCount")]
    public int GuestCount { get; set; }
}

public sealed class DiagnosticFindingItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = "Medium";

    [JsonPropertyName("recommendation")]
    public string Recommendation { get; set; } = string.Empty;
}
