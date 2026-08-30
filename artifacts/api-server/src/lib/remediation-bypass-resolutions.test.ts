/**
 * remediation-bypass-resolutions.test.ts — the CR-bypass-but-resolved dual
 * state (#1543).
 *
 * Locks the run-window join: a verified tracker step only correlates with a
 * drift event that (a) has a bypass verdict and (b) was detected inside the
 * exact run that verified it. Domain mapping (`domainsForStep`) is exercised
 * against the real `REMEDIATION_TRACKER_STEP_CHECK_KEYS` / `DRIFT_CHECK_SPECS`
 * registries so the two real, already-shipped tables this correlates.
 */

import { describe, it, expect } from "vitest";
import { domainsForStep, correlateStepBypasses, type BypassCandidateEvent, type RunWindow, type VerifiedTrackerStep } from "./remediation-bypass-resolutions";

describe("domainsForStep", () => {
  it("resolves the drift domain for a step whose mapped check is drift-tracked", () => {
    // s8 maps to identity:ca-policy-count (drift-tracked, domain "ca-policy")
    // and identity:ca-mfa-coverage (not drift-tracked).
    expect(domainsForStep("s8")).toEqual(["ca-policy"]);
  });

  it("resolves the drift domain for s26 (sharepoint tenant sharing capability)", () => {
    expect(domainsForStep("s26")).toEqual(["tenant-sharing-capability"]);
  });

  it("returns empty for a step with no drift-tracked check at all", () => {
    // s7 → identity:mfa-registration, not in DRIFT_CHECK_SPECS.
    expect(domainsForStep("s7")).toEqual([]);
  });

  it("returns empty for a step id with no mapping (gap/process-only step)", () => {
    expect(domainsForStep("s18")).toEqual([]);
    expect(domainsForStep("s27")).toEqual([]);
  });
});

describe("correlateStepBypasses", () => {
  const step: VerifiedTrackerStep = {
    stepId: "s8",
    verifiedAt: new Date("2026-08-30T12:05:00Z"),
    verifiedByRunId: "run-1",
  };

  const runWindow: RunWindow = {
    runId: "run-1",
    tenantId: "tenant-guid-1",
    startedAt: new Date("2026-08-30T12:00:00Z"),
    completedAt: new Date("2026-08-30T12:05:00Z"),
  };

  function event(overrides: Partial<BypassCandidateEvent> = {}): BypassCandidateEvent {
    return {
      eventId: "evt-1",
      domainKey: "ca-policy",
      setting: "/policies/0/state",
      op: "replace",
      verdict: "attributed_unapproved",
      changedBy: "admin@customer.example",
      detectedAt: new Date("2026-08-30T12:02:00Z"),
      status: "open",
      ...overrides,
    };
  }

  it("correlates a bypass event detected inside the verifying run's window", () => {
    const result = correlateStepBypasses(step, runWindow, [event()]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stepId: "s8",
      verifiedByRunId: "run-1",
      domainKey: "ca-policy",
      driftEvent: { eventId: "evt-1", verdict: "attributed_unapproved" },
    });
  });

  it("does not correlate an event detected BEFORE the run started (a stale, unrelated drift)", () => {
    const result = correlateStepBypasses(step, runWindow, [event({ detectedAt: new Date("2026-08-30T11:00:00Z") })]);
    expect(result).toEqual([]);
  });

  it("does not correlate an event detected AFTER the run completed (a later, unrelated drift)", () => {
    const result = correlateStepBypasses(step, runWindow, [event({ detectedAt: new Date("2026-08-30T13:00:00Z") })]);
    expect(result).toEqual([]);
  });

  it("still correlates against an open-ended window when the run has no completedAt yet", () => {
    const openRun: RunWindow = { ...runWindow, completedAt: null };
    const result = correlateStepBypasses(step, openRun, [event({ detectedAt: new Date("2026-08-30T23:00:00Z") })]);
    expect(result).toHaveLength(1);
  });

  it("returns nothing when the run never started (no window to join against)", () => {
    const noRun: RunWindow = { ...runWindow, startedAt: null };
    expect(correlateStepBypasses(step, noRun, [event()])).toEqual([]);
  });

  it("carries the unattributed verdict through unedited — never upgrades it toward approved", () => {
    const result = correlateStepBypasses(step, runWindow, [event({ verdict: "unattributed", changedBy: null })]);
    expect(result[0].driftEvent.verdict).toBe("unattributed");
    expect(result[0].driftEvent.changedBy).toBeNull();
  });
});
