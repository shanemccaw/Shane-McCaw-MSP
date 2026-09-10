using System;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// One execution record, exactly as `msp-change-execution.ts`'s
/// `toWireCrExecution` serializes it. Returned by
/// POST /api/msp/change-control/executions/human-action and
/// POST /api/msp/change-control/executions/:id/attest — the real record that
/// attests a catalog-backed / human-action change as actually carried out.
/// </summary>
public sealed class ChangeRequestExecution
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("changeRequestId")]
    public int ChangeRequestId { get; set; }

    /// <summary>The "CR-2026-NNN" display form — same encoding as
    /// <see cref="ChangeRequest.Id"/>, computed server-side.</summary>
    [JsonPropertyName("changeCode")]
    public string ChangeCode { get; set; } = string.Empty;

    [JsonPropertyName("tenantId")]
    public string TenantId { get; set; } = string.Empty;

    /// <summary>"human_action" | "workflow" (see CrExecutorKind).</summary>
    [JsonPropertyName("executorKind")]
    public string ExecutorKind { get; set; } = string.Empty;

    [JsonPropertyName("wfRunId")]
    public int? WfRunId { get; set; }

    [JsonPropertyName("packKey")]
    public string? PackKey { get; set; }

    /// <summary>"microsoft" | "customer" | "msp".</summary>
    [JsonPropertyName("implementer")]
    public string? Implementer { get; set; }

    [JsonPropertyName("outcome")]
    public string Outcome { get; set; } = string.Empty;

    [JsonPropertyName("confirmed")]
    public bool Confirmed { get; set; }

    [JsonPropertyName("plannedPlan")]
    public JsonElement? PlannedPlan { get; set; }

    [JsonPropertyName("actualOutcome")]
    public JsonElement? ActualOutcome { get; set; }

    [JsonPropertyName("planMatched")]
    public bool? PlanMatched { get; set; }

    [JsonPropertyName("planDiff")]
    public JsonElement? PlanDiff { get; set; }

    [JsonPropertyName("crRef")]
    public string? CrRef { get; set; }

    [JsonPropertyName("writtenBackAt")]
    public DateTimeOffset? WrittenBackAt { get; set; }

    [JsonPropertyName("attestedBy")]
    public string? AttestedBy { get; set; }

    [JsonPropertyName("attestedByPersonId")]
    public string? AttestedByPersonId { get; set; }

    [JsonPropertyName("attestedAt")]
    public DateTimeOffset? AttestedAt { get; set; }

    [JsonPropertyName("attestationNote")]
    public string? AttestationNote { get; set; }

    [JsonPropertyName("rollbackVerifiedAt")]
    public DateTimeOffset? RollbackVerifiedAt { get; set; }

    [JsonPropertyName("rollbackOutcome")]
    public string? RollbackOutcome { get; set; }

    [JsonPropertyName("executedAt")]
    public DateTimeOffset? ExecutedAt { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Response envelope from human-action and attest — both return
/// `{ execution: WireCrExecution }`.</summary>
public sealed class ChangeRequestExecutionResponse
{
    [JsonPropertyName("execution")]
    public ChangeRequestExecution Execution { get; set; } = new();
}
