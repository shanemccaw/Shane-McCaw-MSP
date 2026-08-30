/**
 * portal-change-approvals.test.ts — the Change Control approval-model
 * derivations (Git #1496).
 *
 * These decide authority and timing: how many approvals a change needs, when the
 * SLA is breached, whether the person who raised a change may approve it, and
 * whether a change is fully approved. They are pure over stored values, so the
 * rules are pinned here rather than eyeballed against the DB.
 */

import { describe, it, expect } from "vitest";

import type { CrApproval } from "@workspace/db";
import {
  computeDueAt,
  isApprovalBreached,
  nextPendingStage,
  requiredStages,
  slaDaysFor,
  summarizeApprovals,
  violatesSeparationOfDuties,
} from "./portal-change-approvals";

describe("requiredStages", () => {
  it("a standard change needs zero human stages — it is pre-approved", () => {
    expect(requiredStages("standard", "low")).toBe(0);
    expect(requiredStages("standard", "critical")).toBe(0);
  });
  it("an emergency needs exactly one (retrospective) stage regardless of risk", () => {
    expect(requiredStages("emergency", "critical")).toBe(1);
    expect(requiredStages("emergency", "low")).toBe(1);
  });
  it("a normal change escalates to two stages at high/critical risk, one below", () => {
    expect(requiredStages("normal", "low")).toBe(1);
    expect(requiredStages("normal", "medium")).toBe(1);
    expect(requiredStages("normal", "high")).toBe(2);
    expect(requiredStages("normal", "critical")).toBe(2);
  });

  // #1759 — the tenant policy floors the count UP, never below the risk floor.
  it("no policy row (null) leaves the risk-derived count untouched", () => {
    expect(requiredStages("normal", "low", null)).toBe(1);
    expect(requiredStages("normal", "high", null)).toBe(2);
    expect(requiredStages("emergency", "low", null)).toBe(1);
  });
  it("a policy demanding more signatures raises the count", () => {
    expect(requiredStages("normal", "low", 2)).toBe(2);
    expect(requiredStages("normal", "low", 3)).toBe(3);
    expect(requiredStages("emergency", "low", 2)).toBe(2);
  });
  it("risk floors the policy — a tenant cannot configure below what risk requires", () => {
    // policy asks for 1, but high risk requires 2 → 2 wins.
    expect(requiredStages("normal", "high", 1)).toBe(2);
    expect(requiredStages("normal", "critical", 1)).toBe(2);
  });
  it("a standard change stays pre-approved (0) even under a signature policy", () => {
    expect(requiredStages("standard", "low", 3)).toBe(0);
    expect(requiredStages("standard", "critical", 3)).toBe(0);
  });
});

describe("slaDaysFor / computeDueAt", () => {
  it("no SLA applies to a pre-approved standard change", () => {
    expect(slaDaysFor("standard", "high")).toBeNull();
    expect(computeDueAt(new Date("2026-08-29T00:00:00Z"), "standard", "high")).toBeNull();
  });
  it("tighter deadlines for riskier changes; emergency is effectively immediate", () => {
    expect(slaDaysFor("emergency", "low")).toBe(1);
    expect(slaDaysFor("normal", "critical")).toBe(1);
    expect(slaDaysFor("normal", "high")).toBe(2);
    expect(slaDaysFor("normal", "medium")).toBe(5);
    expect(slaDaysFor("normal", "low")).toBe(7);
  });
  it("computes the deadline as created_at + the SLA days", () => {
    const created = new Date("2026-08-29T00:00:00Z");
    const due = computeDueAt(created, "normal", "medium");
    expect(due?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("isApprovalBreached", () => {
  const past = new Date("2026-08-01T00:00:00Z");
  const now = new Date("2026-08-29T00:00:00Z");
  it("a pending slot past its due date is breached", () => {
    expect(isApprovalBreached({ decision: "pending", dueAt: past }, now)).toBe(true);
  });
  it("a pending slot before its due date is not", () => {
    const future = new Date("2026-09-30T00:00:00Z");
    expect(isApprovalBreached({ decision: "pending", dueAt: future }, now)).toBe(false);
  });
  it("a decided or SLA-less slot never breaches", () => {
    expect(isApprovalBreached({ decision: "approved", dueAt: past }, now)).toBe(false);
    expect(isApprovalBreached({ decision: "pending", dueAt: null }, now)).toBe(false);
  });
});

describe("violatesSeparationOfDuties", () => {
  it("the requester may not be the approver (case-insensitive, trimmed)", () => {
    expect(violatesSeparationOfDuties("dana@acme.com", "DANA@acme.com ")).toBe(true);
  });
  it("a different person is fine", () => {
    expect(violatesSeparationOfDuties("dana@acme.com", "sam@acme.com")).toBe(false);
  });
  it("a blank requester (system-raised) never collides", () => {
    expect(violatesSeparationOfDuties("", "sam@acme.com")).toBe(false);
    expect(violatesSeparationOfDuties("Microsoft 365 change routing", "")).toBe(false);
  });
});

describe("nextPendingStage", () => {
  it("returns the lowest still-pending stage — stages gate in order", () => {
    expect(nextPendingStage([
      { stage: 1, decision: "approved" },
      { stage: 2, decision: "pending" },
    ])).toBe(2);
  });
  it("null when nothing is pending", () => {
    expect(nextPendingStage([{ stage: 1, decision: "approved" }])).toBeNull();
  });
});

/** A minimal approval row for the summarize tests. */
function row(partial: Partial<Pick<CrApproval, "stage" | "decision" | "dueAt">>): Pick<CrApproval, "stage" | "decision" | "dueAt"> {
  return { stage: 1, decision: "pending", dueAt: null, ...partial };
}

describe("summarizeApprovals", () => {
  const now = new Date("2026-08-29T00:00:00Z");

  it("a pre-approved change (required 0) is complete once it has an approved row", () => {
    const s = summarizeApprovals([row({ decision: "approved" })], 0, now);
    expect(s.complete).toBe(true);
    expect(s.rejectedTerminal).toBe(false);
  });

  it("a two-stage change is incomplete until BOTH stages clear", () => {
    const oneOfTwo = summarizeApprovals(
      [row({ stage: 1, decision: "approved" }), row({ stage: 2, decision: "pending" })],
      2,
      now,
    );
    expect(oneOfTwo.complete).toBe(false);
    expect(oneOfTwo.nextStage).toBe(2);

    const bothCleared = summarizeApprovals(
      [row({ stage: 1, decision: "approved" }), row({ stage: 2, decision: "approved" })],
      2,
      now,
    );
    expect(bothCleared.complete).toBe(true);
  });

  it("any rejection is terminal and blocks completion", () => {
    const s = summarizeApprovals([row({ decision: "rejected" })], 1, now);
    expect(s.rejectedTerminal).toBe(true);
    expect(s.complete).toBe(false);
  });

  it("surfaces a breached pending slot", () => {
    const s = summarizeApprovals([row({ decision: "pending", dueAt: new Date("2026-08-01T00:00:00Z") })], 1, now);
    expect(s.breached).toBe(true);
    expect(s.pending).toBe(1);
  });
});
