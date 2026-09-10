using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One stored step state, exactly as returned by
/// GET /api/msp/customers/:customerId/remediation-tracker (msp-remediation-tracker.ts's
/// `toWire`/`WireTrackerStep`). No field invented here that the endpoint doesn't
/// already send.
/// </summary>
public sealed class RemediationTrackerStep
{
    [JsonPropertyName("stepId")]
    public string StepId { get; set; } = string.Empty;

    /// <summary>"not_started" | "in_progress" | "completed" | "accepted_risk".</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("completedAt")]
    public DateTimeOffset? CompletedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset? UpdatedAt { get; set; }

    /// <summary>"unverified" | "verified" (see remediation-tracker-verification.ts).</summary>
    [JsonPropertyName("verificationState")]
    public string VerificationState { get; set; } = string.Empty;

    [JsonPropertyName("verifiedAt")]
    public DateTimeOffset? VerifiedAt { get; set; }

    /// <summary>Server-derived — "verified" | "accepted" | "outstanding". Never
    /// recompute this client-side; it already folds status + verificationState.</summary>
    [JsonPropertyName("terminalState")]
    public string TerminalState { get; set; } = string.Empty;
}

/// <summary>One phase's live pricing — mirrors RemediationTrackerPhasePricing.</summary>
public sealed class RemediationTrackerPhasePricing
{
    [JsonPropertyName("phase")]
    public int Phase { get; set; }

    [JsonPropertyName("pillars")]
    public List<string> Pillars { get; set; } = new();

    [JsonPropertyName("ready")]
    public bool Ready { get; set; }

    [JsonPropertyName("fee")]
    public double Fee { get; set; }

    [JsonPropertyName("feeDisplay")]
    public string FeeDisplay { get; set; } = string.Empty;
}

/// <summary>Mirrors RemediationTrackerHirePricing.</summary>
public sealed class RemediationTrackerHirePricing
{
    [JsonPropertyName("price")]
    public string Price { get; set; } = string.Empty;

    [JsonPropertyName("was")]
    public string Was { get; set; } = string.Empty;

    [JsonPropertyName("wasShow")]
    public bool WasShow { get; set; }

    [JsonPropertyName("saved")]
    public string Saved { get; set; } = string.Empty;

    [JsonPropertyName("savedShow")]
    public bool SavedShow { get; set; }

    [JsonPropertyName("cta")]
    public string Cta { get; set; } = string.Empty;

    [JsonPropertyName("note")]
    public string Note { get; set; } = string.Empty;
}

/// <summary>Mirrors RemediationTrackerPricing.</summary>
public sealed class RemediationTrackerPricing
{
    [JsonPropertyName("phases")]
    public List<RemediationTrackerPhasePricing> Phases { get; set; } = new();

    [JsonPropertyName("hire")]
    public RemediationTrackerHirePricing Hire { get; set; } = new();
}

/// <summary>
/// The full response envelope from
/// GET /api/msp/customers/:customerId/remediation-tracker.
/// </summary>
public sealed class RemediationTrackerResponse
{
    [JsonPropertyName("steps")]
    public List<RemediationTrackerStep> Steps { get; set; } = new();

    [JsonPropertyName("pricing")]
    public RemediationTrackerPricing Pricing { get; set; } = new();
}

/// <summary>The response envelope from the PUT step-status endpoint.</summary>
public sealed class RemediationTrackerStepUpdateResponse
{
    [JsonPropertyName("step")]
    public RemediationTrackerStep Step { get; set; } = new();
}
