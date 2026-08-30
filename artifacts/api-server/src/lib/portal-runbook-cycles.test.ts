/**
 * portal-runbook-cycles.test.ts — the pure cycle-completion / next-cycle-clone
 * / day-progress logic behind #1557 (runbook recurrence is a schedule that
 * spawns runs, not a row that gets wiped).
 */

import { describe, it, expect } from "vitest";
import {
  isCycleComplete,
  cloneStepsForNextCycle,
  wholeDaysSince,
  cycleProgress,
} from "./portal-runbook-cycles";

describe("isCycleComplete", () => {
  it("is false for an empty step list — nothing to have finished", () => {
    expect(isCycleComplete([])).toBe(false);
  });

  it("is false while any step is unchecked", () => {
    expect(isCycleComplete([{ checked: true }, { checked: false }])).toBe(false);
  });

  it("is true once every step is checked", () => {
    expect(isCycleComplete([{ checked: true }, { checked: true }, { checked: true }])).toBe(true);
  });
});

describe("cloneStepsForNextCycle", () => {
  it("carries position, text and isCustom forward and resets checked", () => {
    const next = cloneStepsForNextCycle([
      { position: 1, text: "Inventory guests", isCustom: false },
      { position: 2, text: "Ask owners to confirm", isCustom: false },
    ]);
    expect(next).toEqual([
      { position: 1, text: "Inventory guests", isCustom: false, checked: false },
      { position: 2, text: "Ask owners to confirm", isCustom: false, checked: false },
    ]);
  });

  it("carries a customer's own added (isCustom) step into the next cycle too", () => {
    const next = cloneStepsForNextCycle([
      { position: 1, text: "Catalogue step", isCustom: false },
      { position: 2, text: "Our own extra check", isCustom: true },
    ]);
    expect(next.map((s) => s.isCustom)).toEqual([false, true]);
  });

  it("normalises to position order regardless of input order", () => {
    const next = cloneStepsForNextCycle([
      { position: 3, text: "third", isCustom: false },
      { position: 1, text: "first", isCustom: false },
      { position: 2, text: "second", isCustom: false },
    ]);
    expect(next.map((s) => s.text)).toEqual(["first", "second", "third"]);
  });
});

describe("wholeDaysSince", () => {
  it("returns 0 the same UTC calendar day it started", () => {
    expect(wholeDaysSince("2026-08-30", new Date("2026-08-30T23:59:00Z"))).toBe(0);
  });

  it("counts whole days elapsed, not partial", () => {
    expect(wholeDaysSince("2026-08-16", new Date("2026-08-30T04:00:00Z"))).toBe(14);
  });

  it("never goes negative for a future-dated start (clock skew, etc.)", () => {
    expect(wholeDaysSince("2026-09-15", new Date("2026-08-30T00:00:00Z"))).toBe(0);
  });
});

describe("cycleProgress", () => {
  it("reports on-track progress within the cycle window", () => {
    const p = cycleProgress("2026-08-23", 14, new Date("2026-08-30T00:00:00Z"), false);
    expect(p).toEqual({ daysElapsed: 7, daysLeft: 7, overdue: false });
  });

  it("is overdue once elapsed days exceed cycleDays and the cycle is not complete", () => {
    const p = cycleProgress("2026-08-01", 14, new Date("2026-08-30T00:00:00Z"), false);
    expect(p.overdue).toBe(true);
    expect(p.daysLeft).toBe(0);
  });

  it("is NOT overdue once the cycle is complete, even if it ran long", () => {
    const p = cycleProgress("2026-08-01", 14, new Date("2026-08-30T00:00:00Z"), true);
    expect(p.overdue).toBe(false);
  });
});
