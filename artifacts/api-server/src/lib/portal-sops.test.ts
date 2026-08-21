/**
 * portal-sops.test.ts — pins the mappings behind the customer-scoped SOP routes.
 *
 * Every function here turns a stored column into a sentence a customer reads, so
 * a wrong one is not a crash — it is a plausible, confident, incorrect statement
 * about their own procedures. That is the failure mode worth a test.
 *
 * The cases below are weighted towards the ones the shipped fixture could never
 * produce and real rows do: a `hybrid` SOP whose steps carry no endpoint, a
 * completed run that did not pass every step, a blocked run whose current step
 * has run ahead of its passed count, and unparseable stored dates.
 */

import { describe, it, expect } from "vitest";

import {
  auditResult,
  automatedStepCount,
  durationSeconds,
  evidenceHash,
  formatAuditTimestamp,
  formatDurationSeconds,
  formatLongDate,
  formatUpdated,
  isSameUtcMonth,
  ownerTone,
  personLabel,
  progressPct,
  queueStateFor,
  readSteps,
  relativeSince,
  runModeLabel,
  runStateLabel,
  sopLevel,
  sopRunnable,
  stepEndpoint,
  stepStates,
  stepText,
  whoRunsIt,
} from "./portal-sops.ts";

describe("readSteps / stepText / stepEndpoint", () => {
  it("reads the real stored step shape", () => {
    const steps = readSteps([
      {
        stepNumber: 1,
        title: "Revoke User Sessions & Refresh Tokens",
        description: "Executes Graph API POST to revoke sign-in sessions.",
        type: "automated",
        graphEndpoint: "POST /v1.0/users/{upn}/revokeSignInSessions",
      },
      { stepNumber: 2, title: "Verify Identity with HR Contact", type: "manual" },
    ]);
    expect(steps).toHaveLength(2);
    expect(stepText(steps[0])).toBe(
      "Revoke User Sessions & Refresh Tokens — Executes Graph API POST to revoke sign-in sessions.",
    );
    expect(stepEndpoint(steps[0])).toBe("POST /v1.0/users/{upn}/revokeSignInSessions");
    expect(stepEndpoint(steps[1])).toBe("");
  });

  it("survives jsonb that is not an array of objects", () => {
    expect(readSteps(null)).toEqual([]);
    expect(readSteps("nonsense")).toEqual([]);
    expect(readSteps([null, 3])).toHaveLength(2);
    expect(stepText({})).toBe("Step details not recorded.");
  });

  it("falls back to the title alone when there is no description", () => {
    expect(stepText({ title: "Verify Identity with HR Contact" })).toBe(
      "Verify Identity with HR Contact",
    );
  });
});

describe("sopLevel / sopRunnable / whoRunsIt", () => {
  it("maps automation_type onto the design's four levels", () => {
    expect(sopLevel("automated", 3)).toBe("Fully automated");
    expect(sopLevel("hybrid", 3)).toBe("Partially automated");
    expect(sopLevel("manual", 3)).toBe("Manual with verification");
    expect(sopLevel("something-else", 3)).toBe("Reference only");
  });

  it("reads a SOP with no steps as reference only whatever its type claims", () => {
    expect(sopLevel("automated", 0)).toBe("Reference only");
  });

  it("calls a SOP runnable only when a step actually names an endpoint", () => {
    const hybridWithEndpoint = readSteps([{ graphEndpoint: "GET /v1.0/users" }, {}]);
    const hybridWithout = readSteps([{ type: "automated" }, {}]);
    expect(sopRunnable(hybridWithEndpoint)).toBe(true);
    // Typed automated, but there is nothing to call — Runnable would be a lie.
    expect(sopRunnable(hybridWithout)).toBe(false);
    expect(automatedStepCount(hybridWithEndpoint)).toBe(1);
  });

  it("describes who runs it from the same column, and says so when there is nothing", () => {
    expect(whoRunsIt("automated", 2)).toMatch(/^Runs automatically through Graph/);
    expect(whoRunsIt("hybrid", 2)).toMatch(/^Run by us/);
    expect(whoRunsIt("manual", 2)).toMatch(/^Run by hand/);
    expect(whoRunsIt("automated", 0)).toBe("Reference only — there is nothing to execute.");
  });
});

describe("date and duration formatting", () => {
  it("formats a stored plain date the way the design writes it", () => {
    expect(formatLongDate("2026-08-19")).toBe("19 August 2026");
    expect(formatUpdated("2026-08-19", "v1.0")).toBe("Updated 19 August 2026 · v1.0");
    expect(formatUpdated("2026-08-19", "")).toBe("Updated 19 August 2026");
  });

  it("returns an unparseable stored date verbatim rather than 'Invalid Date'", () => {
    expect(formatLongDate("not a date")).toBe("not a date");
    expect(formatLongDate("2026-13-01")).toBe("2026-13-01");
  });

  it("formats the audit timestamp in UTC", () => {
    expect(formatAuditTimestamp("2026-08-19T09:14:22Z")).toBe("19 Aug 2026 · 09:14:22");
  });

  it("formats durations as the design's m/s, rolling over to hours", () => {
    expect(formatDurationSeconds(700)).toBe("11m 40s");
    expect(formatDurationSeconds(252)).toBe("4m 12s");
    expect(formatDurationSeconds(5)).toBe("0m 05s");
    expect(formatDurationSeconds(7200)).toBe("2h 0m");
  });

  it("computes a duration only when both ends are usable", () => {
    expect(durationSeconds("2026-08-19T09:00:00Z", "2026-08-19T09:11:40Z")).toBe(700);
    expect(durationSeconds("2026-08-19T09:00:00Z", null)).toBeNull();
    expect(durationSeconds("2026-08-19T09:00:00Z", "nonsense")).toBeNull();
    // A completion before its own start is data corruption, not a negative run.
    expect(durationSeconds("2026-08-19T09:00:00Z", "2026-08-19T08:00:00Z")).toBeNull();
  });

  it("says how long ago something started", () => {
    const now = new Date("2026-08-19T09:15:00Z");
    expect(relativeSince("2026-08-19T09:11:00Z", now, "Started")).toBe("Started 4 minutes ago");
    expect(relativeSince("2026-08-19T09:14:30Z", now, "Queued")).toBe(
      "Queued less than a minute ago",
    );
    expect(relativeSince("2026-08-19T08:15:00Z", now, "Started")).toBe("Started 1 hour ago");
    expect(relativeSince("2026-08-17T09:15:00Z", now, "Started")).toBe("Started 2 days ago");
    expect(relativeSince("nonsense", now, "Started")).toBe("Started at an unrecorded time");
  });

  it("matches the calendar month for the executions-this-month card", () => {
    const now = new Date("2026-08-19T09:15:00Z");
    expect(isSameUtcMonth("2026-08-01T00:00:00Z", now)).toBe(true);
    expect(isSameUtcMonth("2026-07-31T23:59:59Z", now)).toBe(false);
    expect(isSameUtcMonth("nonsense", now)).toBe(false);
  });
});

describe("run state", () => {
  it("puts in-progress and blocked runs on the queue and finished ones in history", () => {
    expect(queueStateFor("In Progress")).toBe("Running");
    expect(queueStateFor("Blocked")).toBe("Queued");
    expect(queueStateFor("Completed")).toBeNull();
    expect(queueStateFor("Failed")).toBeNull();
  });

  it("calls a narrowed run 'automated steps only' and a full one 'full execution'", () => {
    expect(runModeLabel(5, 8)).toBe("Automated steps only");
    expect(runModeLabel(8, 8)).toBe("Full execution");
    // No steps recorded on the SOP — nothing to have narrowed against.
    expect(runModeLabel(5, 0)).toBe("Full execution");
  });

  it("honours passed-count and current-index separately, as a blocked run needs", () => {
    // 5 steps, 3 passed, sitting on index 4 — the gap is step 4, which is
    // neither done nor current. Deriving one counter from the other loses that.
    expect(stepStates(5, 4, 3)).toEqual(["done", "done", "done", "todo", "now"]);
    expect(stepStates(3, 0, 0)).toEqual(["now", "todo", "todo"]);
  });

  it("computes progress without dividing by zero", () => {
    expect(progressPct(5, 8)).toBe(63);
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(9, 8)).toBe(100);
  });

  it("calls a completed-but-incomplete run part-complete, not Complete", () => {
    expect(runStateLabel("Completed", 8, 8)).toBe("Complete");
    expect(runStateLabel("Completed", 5, 8)).toBe("Part-complete");
    expect(runStateLabel("Failed", 2, 8)).toBe("Failed");
    expect(runStateLabel("Blocked", 2, 8)).toBe("Blocked");
  });

  it("grades the audit result on the same rule", () => {
    expect(auditResult("Completed", 8, 8)).toBe("Success");
    expect(auditResult("Completed", 5, 8)).toBe("Partial");
    expect(auditResult("Failed", 5, 8)).toBe("Failure");
    expect(auditResult("In Progress", 5, 8)).toBe("Partial");
  });
});

describe("evidenceHash", () => {
  it("is a real digest of the record, in the design's first4…last4 form", () => {
    const h = evidenceHash("run-1", "SOP-IDN-004", "2026-08-19T09:14:22Z", "started");
    expect(h).toMatch(/^[0-9a-f]{4}…[0-9a-f]{4}$/);
    // Reproducible — which is the whole point of the claim the page makes.
    expect(evidenceHash("run-1", "SOP-IDN-004", "2026-08-19T09:14:22Z", "started")).toBe(h);
    expect(evidenceHash("run-2", "SOP-IDN-004", "2026-08-19T09:14:22Z", "started")).not.toBe(h);
  });
});

describe("personLabel / ownerTone", () => {
  it("prefers a resolved display name", () => {
    expect(personLabel("shane@shanemccaw.com", "Shane McCaw")).toBe("Shane McCaw");
  });

  it("falls back to a readable form of the email's local part", () => {
    expect(personLabel("jordan.diaz@contoso.com", null)).toBe("Jordan Diaz");
    expect(personLabel("shanemccaw+assessment1@outlook.com", "")).toBe("Shanemccaw Assessment1");
  });

  it("says Unassigned rather than inventing somebody", () => {
    expect(personLabel("", null)).toBe("Unassigned");
    expect(personLabel("   ", undefined)).toBe("Unassigned");
  });

  it("gives the same person the same tone every time", () => {
    expect(ownerTone("Shane McCaw")).toBe(ownerTone("Shane McCaw"));
    expect(ownerTone("Shane McCaw")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
