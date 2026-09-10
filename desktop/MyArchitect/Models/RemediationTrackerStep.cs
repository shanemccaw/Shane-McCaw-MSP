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

    /// <summary>MSP operator's free-text note (#3472 — Session Notes). Null until one
    /// is written; written through its own endpoint, never through the status PUT.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; set; }
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

/// <summary>
/// One row from GET /api/msp/customers/:customerId/remediation-tracker/catalogue
/// (#3471's browse endpoint) — all 28 real steps from
/// `remediation-tracker-catalogue.ts` (the same catalogue
/// msp-remediation-tracker-export.ts's CSV/PDF already reads), each joined
/// server-side with this customer's real stored state, defaulting an
/// untouched step to "not_started"/"unverified" rather than omitting it.
/// This is the only endpoint that carries a human title/pillar for a
/// step — the plain state GET has neither.
/// </summary>
public sealed class RemediationTrackerCatalogueStep
{
    [JsonPropertyName("stepId")]
    public string StepId { get; set; } = string.Empty;

    [JsonPropertyName("stepLabel")]
    public string StepLabel { get; set; } = string.Empty;

    /// <summary>Real instruction/action text for this step, e.g. "Close org-wide
    /// sharing on the four sensitive sites" — the browse row's own required text.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>"governance" | "security" | "compliance" | "licensing" | "adoption" | "health".</summary>
    [JsonPropertyName("pillar")]
    public string Pillar { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    /// <summary>Real, server-owned display text for <see cref="Status"/> —
    /// never re-derived client-side.</summary>
    [JsonPropertyName("statusLabel")]
    public string StatusLabel { get; set; } = string.Empty;

    [JsonPropertyName("completedAt")]
    public DateTimeOffset? CompletedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset? UpdatedAt { get; set; }

    [JsonPropertyName("verificationState")]
    public string VerificationState { get; set; } = string.Empty;

    [JsonPropertyName("verifiedAt")]
    public DateTimeOffset? VerifiedAt { get; set; }

    [JsonPropertyName("terminalState")]
    public string TerminalState { get; set; } = string.Empty;

    /// <summary>MSP operator's free-text note (#3472 — Session Notes). Null until one
    /// is written.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; set; }
}

/// <summary>One assignable status this route will accept on a PUT — real
/// status/label pair, server-owned (never a client-invented display string).</summary>
public sealed class RemediationTrackerAssignableStatus
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;
}

/// <summary>The full response envelope from GET .../remediation-tracker/catalogue.</summary>
public sealed class RemediationTrackerCatalogueResponse
{
    [JsonPropertyName("steps")]
    public List<RemediationTrackerCatalogueStep> Steps { get; set; } = new();

    [JsonPropertyName("statusLabels")]
    public Dictionary<string, string> StatusLabels { get; set; } = new();

    /// <summary>The real, MSP-settable subset of REMEDIATION_TRACKER_STEP_STATUS —
    /// "accepted_risk" is deliberately excluded server-side (it's the
    /// customer's own signed decline-to-risk fact, rejected by this same
    /// route's PUT if set directly).</summary>
    [JsonPropertyName("assignableStatuses")]
    public List<RemediationTrackerAssignableStatus> AssignableStatuses { get; set; } = new();
}
