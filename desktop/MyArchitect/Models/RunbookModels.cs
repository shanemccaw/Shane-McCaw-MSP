using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MyArchitect.Models;

/// <summary>
/// A single step on a runbook's CURRENT cycle. Mirrors WireStep
/// (portal-runbook-wire.ts) exactly.
/// </summary>
public sealed class RunbookStep
{
    [JsonPropertyName("position")]
    public int Position { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;

    [JsonPropertyName("checked")]
    public bool Checked { get; set; }

    [JsonPropertyName("isCustom")]
    public bool IsCustom { get; set; }

    [JsonPropertyName("checkedAt")]
    public string? CheckedAt { get; set; }
}

/// <summary>The endpoint's { kind, label } primary-action hint for a hold window.</summary>
public sealed class HoldWindowPrimaryAction
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;
}

/// <summary>
/// A hold window gating a runbook step. Mirrors WireHoldWindow
/// (portal-runbook-wire.ts) exactly — no field invented here that the
/// endpoint doesn't already send.
/// </summary>
public sealed class HoldWindow
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("holdKey")]
    public string HoldKey { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("gates")]
    public string Gates { get; set; } = string.Empty;

    [JsonPropertyName("gatesStepPosition")]
    public int? GatesStepPosition { get; set; }

    /// <summary>The cycle this window gates (#1940). Null for a legacy window raised before the column existed.</summary>
    [JsonPropertyName("runId")]
    public int? RunId { get; set; }

    [JsonPropertyName("pillar")]
    public string Pillar { get; set; } = string.Empty;

    [JsonPropertyName("why")]
    public string Why { get; set; } = string.Empty;

    [JsonPropertyName("state")]
    public string State { get; set; } = string.Empty;

    [JsonPropertyName("tone")]
    public string Tone { get; set; } = string.Empty;

    [JsonPropertyName("badge")]
    public string Badge { get; set; } = string.Empty;

    [JsonPropertyName("tMinus")]
    public string TMinus { get; set; } = string.Empty;

    [JsonPropertyName("daysLeft")]
    public int DaysLeft { get; set; }

    [JsonPropertyName("daysSaved")]
    public int DaysSaved { get; set; }

    [JsonPropertyName("hoursLeft")]
    public int HoursLeft { get; set; }

    [JsonPropertyName("totalDays")]
    public int TotalDays { get; set; }

    [JsonPropertyName("waitDays")]
    public int WaitDays { get; set; }

    [JsonPropertyName("extendedDays")]
    public int ExtendedDays { get; set; }

    [JsonPropertyName("startedAt")]
    public string StartedAt { get; set; } = string.Empty;

    [JsonPropertyName("closesAt")]
    public string ClosesAt { get; set; } = string.Empty;

    [JsonPropertyName("closedAt")]
    public string? ClosedAt { get; set; }

    /// <summary>"done" | "partial" | "todo" per elapsed day.</summary>
    [JsonPropertyName("ticks")]
    public List<string> Ticks { get; set; } = new();

    [JsonPropertyName("scanVerdict")]
    public string ScanVerdict { get; set; } = string.Empty;

    [JsonPropertyName("scanLabel")]
    public string ScanLabel { get; set; } = string.Empty;

    [JsonPropertyName("scanTone")]
    public string ScanTone { get; set; } = string.Empty;

    [JsonPropertyName("scanLine")]
    public string ScanLine { get; set; } = string.Empty;

    [JsonPropertyName("scanProvenance")]
    public string ScanProvenance { get; set; } = string.Empty;

    [JsonPropertyName("primaryAction")]
    public HoldWindowPrimaryAction PrimaryAction { get; set; } = new();

    /// <summary>Which of the README's three alerts this window currently owes.</summary>
    [JsonPropertyName("notificationsDue")]
    public List<string> NotificationsDue { get; set; } = new();
}

/// <summary>A past cycle's own record — history only, no step detail. Mirrors WireRunbookRunSummary.</summary>
public sealed class RunbookRunSummary
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("cycleNumber")]
    public int CycleNumber { get; set; }

    [JsonPropertyName("startedOn")]
    public string StartedOn { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("completedAt")]
    public string? CompletedAt { get; set; }

    [JsonPropertyName("checkedSteps")]
    public int CheckedSteps { get; set; }

    [JsonPropertyName("totalSteps")]
    public int TotalSteps { get; set; }
}

/// <summary>A runbook + its current cycle. Mirrors WireRunbook (portal-runbook-wire.ts) exactly.</summary>
public sealed class Runbook
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("runbookKey")]
    public string RunbookKey { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("context")]
    public string Context { get; set; } = string.Empty;

    [JsonPropertyName("pillar")]
    public string Pillar { get; set; } = string.Empty;

    /// <summary>Whether finishing the current cycle spawns the next one automatically (#1557).</summary>
    [JsonPropertyName("recurring")]
    public bool Recurring { get; set; }

    /// <summary>The id of the cycle whose steps are below — null if this schedule somehow has no run yet.</summary>
    [JsonPropertyName("currentRunId")]
    public int? CurrentRunId { get; set; }

    [JsonPropertyName("cycleNumber")]
    public int CycleNumber { get; set; }

    [JsonPropertyName("startedOn")]
    public string? StartedOn { get; set; }

    [JsonPropertyName("cycleDays")]
    public int CycleDays { get; set; }

    [JsonPropertyName("daysElapsed")]
    public int DaysElapsed { get; set; }

    [JsonPropertyName("daysLeft")]
    public int DaysLeft { get; set; }

    [JsonPropertyName("checkedSteps")]
    public int CheckedSteps { get; set; }

    [JsonPropertyName("totalSteps")]
    public int TotalSteps { get; set; }

    [JsonPropertyName("pct")]
    public double Pct { get; set; }

    [JsonPropertyName("statusLabel")]
    public string StatusLabel { get; set; } = string.Empty;

    /// <summary>The current cycle's steps.</summary>
    [JsonPropertyName("steps")]
    public List<RunbookStep> Steps { get; set; } = new();

    [JsonPropertyName("hold")]
    public HoldWindow? Hold { get; set; }

    /// <summary>Past cycles, newest first.</summary>
    [JsonPropertyName("runHistory")]
    public List<RunbookRunSummary> RunHistory { get; set; } = new();
}

/// <summary>The panel's summary line. Mirrors RunbooksSummary (portal-runbook-wire.ts) exactly.</summary>
public sealed class RunbooksSummary
{
    [JsonPropertyName("running")]
    public int Running { get; set; }

    [JsonPropertyName("closing")]
    public int Closing { get; set; }

    [JsonPropertyName("due")]
    public int Due { get; set; }

    [JsonPropertyName("early")]
    public int Early { get; set; }

    [JsonPropertyName("openCount")]
    public int OpenCount { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;
}

/// <summary>The full response envelope from GET /api/msp/runbooks.</summary>
public sealed class RunbooksPayload
{
    [JsonPropertyName("runbooks")]
    public List<Runbook> Runbooks { get; set; } = new();

    [JsonPropertyName("holds")]
    public List<HoldWindow> Holds { get; set; } = new();

    [JsonPropertyName("summary")]
    public RunbooksSummary Summary { get; set; } = new();
}

/// <summary>The response from PUT /api/msp/runbooks/:runbookId/steps/:position.</summary>
public sealed class StepCompletionResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("position")]
    public int Position { get; set; }

    [JsonPropertyName("checked")]
    public bool Checked { get; set; }
}

/// <summary>The response from POST /api/msp/hold-windows/:holdId/extend.</summary>
public sealed class ExtendHoldWindowResult
{
    [JsonPropertyName("extendedDays")]
    public int ExtendedDays { get; set; }
}

/// <summary>A single row of a hold window's decision audit trail. Mirrors the shape
/// GET /api/msp/hold-windows/:holdId/events returns per event.</summary>
public sealed class HoldWindowEvent
{
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    [JsonPropertyName("daysDelta")]
    public int? DaysDelta { get; set; }

    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("changeRequestCode")]
    public string? ChangeRequestCode { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>The response envelope from GET /api/msp/hold-windows/:holdId/events.</summary>
public sealed class HoldWindowEventsResponse
{
    [JsonPropertyName("events")]
    public List<HoldWindowEvent> Events { get; set; } = new();
}
