using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// A single row from the real write_action_catalog table, entitlement-resolved
/// for one MSP+customer pair. Mirrors the exact shape returned by
/// GET /api/msp/:mspId/launch-control/actions (msp-launch-control.ts) — no field
/// invented here that the endpoint doesn't already send.
/// </summary>
public sealed class LaunchControlAction
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("domain")]
    public string Domain { get; set; } = string.Empty;

    [JsonPropertyName("actionName")]
    public string ActionName { get; set; } = string.Empty;

    [JsonPropertyName("surface")]
    public string Surface { get; set; } = string.Empty;

    [JsonPropertyName("requiredPermission")]
    public string? RequiredPermission { get; set; }

    /// <summary>"safe" | "gated" | null — null for the catalog's
    /// blocked_no_workaround rows (no safe/gated classification exists).</summary>
    [JsonPropertyName("safeOrGated")]
    public string? SafeOrGated { get; set; }

    [JsonPropertyName("minBundledTier")]
    public string? MinBundledTier { get; set; }

    [JsonPropertyName("requiredCapabilityKey")]
    public string? RequiredCapabilityKey { get; set; }

    [JsonPropertyName("snapshotNotes")]
    public string? SnapshotNotes { get; set; }

    /// <summary>'metadata_pending' | 'endpoint_design_pending' | 'blocked' |
    /// 'blocked_no_workaround' | 'execution_ready' | null.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("blockedReason")]
    public string? BlockedReason { get; set; }

    [JsonPropertyName("sortOrder")]
    public int SortOrder { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Null until this catalog row is wired to a real
    /// baseline_action_templates row — that's also what gates RequiredVariables
    /// being non-empty and what the execute route requires to be non-null.</summary>
    [JsonPropertyName("templateId")]
    public string? TemplateId { get; set; }

    /// <summary>Server-computed, never trust a client-cached copy of this for the
    /// actual execute gate — "included" | "billable_upsell" | "a_la_carte".</summary>
    [JsonPropertyName("availability")]
    public string Availability { get; set; } = string.Empty;

    /// <summary>Sourced from baseline_action_templates.requiredVariables, keyed
    /// off TemplateId — empty until TemplateId is set.</summary>
    [JsonPropertyName("requiredVariables")]
    public List<string> RequiredVariables { get; set; } = new();
}

/// <summary>
/// The full response envelope from GET /api/msp/:mspId/launch-control/actions.
/// </summary>
public sealed class LaunchControlCatalog
{
    [JsonPropertyName("actions")]
    public List<LaunchControlAction> Actions { get; set; } = new();

    /// <summary>The customer's resolved Monitoring tier (services.tier) used to
    /// compute each action's Availability — "basic" | "enhanced" | "premium" |
    /// null when no active client_services row was found for the customer.</summary>
    [JsonPropertyName("customerTier")]
    public string? CustomerTier { get; set; }
}

/// <summary>
/// Real result shape from POST /api/msp/:mspId/launch-control/execute — mirrors
/// BaselineTemplateExecutionResult (workflow-executor.ts) plus the server-added
/// `reversible` flag, exactly as msp-launch-control.ts:293-296 sends it. No field
/// invented here that the endpoint doesn't already send.
/// </summary>
public sealed class LaunchControlExecuteResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("status")]
    public int Status { get; set; }

    /// <summary>Opaque — the real Graph/template response body, shape varies per action.</summary>
    [JsonPropertyName("data")]
    public System.Text.Json.JsonElement Data { get; set; }

    /// <summary>"insufficient_privilege" | "conflict" | "bad_request" | "unexpected" | null.</summary>
    [JsonPropertyName("errorType")]
    public string? ErrorType { get; set; }

    [JsonPropertyName("endpoint")]
    public string Endpoint { get; set; } = string.Empty;

    [JsonPropertyName("method")]
    public string Method { get; set; } = string.Empty;

    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;

    /// <summary>Present + Success=false when required variables didn't resolve — no real
    /// Graph call was made.</summary>
    [JsonPropertyName("missingVariables")]
    public List<string>? MissingVariables { get; set; }

    /// <summary>baseline_action_template_audit_log.id — needed to call the rollback route.</summary>
    [JsonPropertyName("auditLogId")]
    public int? AuditLogId { get; set; }

    /// <summary>Server-computed: Success && the template's own `reversible` flag.</summary>
    [JsonPropertyName("reversible")]
    public bool Reversible { get; set; }
}

/// <summary>The customer tenant Launch Control actually executed against — real Graph writes
/// are currently staging-restricted to isTestbed customers (msp-launch-control.ts:257-267).</summary>
public sealed class LaunchControlExecuteTenant
{
    [JsonPropertyName("customerId")]
    public int CustomerId { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

/// <summary>The real, pre-approved standard Change Request (Git #3541) that
/// msp-launch-control.ts now raises BEFORE the Graph write fires and closes to
/// `completed` on success — the changeRequestId that never existed before
/// #3541, filed exactly because there was nothing here for a `human-action`
/// attestation call to reference.</summary>
public sealed class LaunchControlChangeRequest
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    /// <summary>Human-readable "CR-2026-&lt;n&gt;" code (formatChangeRequestCode).</summary>
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;
}

/// <summary>The full response envelope from POST /api/msp/:mspId/launch-control/execute.</summary>
public sealed class LaunchControlExecuteResponse
{
    [JsonPropertyName("result")]
    public LaunchControlExecuteResult Result { get; set; } = new();

    [JsonPropertyName("tenant")]
    public LaunchControlExecuteTenant Tenant { get; set; } = new();

    [JsonPropertyName("changeRequest")]
    public LaunchControlChangeRequest ChangeRequest { get; set; } = new();
}
