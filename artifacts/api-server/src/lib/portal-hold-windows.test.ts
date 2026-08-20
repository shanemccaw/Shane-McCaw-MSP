/**
 * portal-hold-windows.test.ts — the hold-window state machine.
 *
 * Structured around the FOUR DEFECTS the design prototype's own version of this
 * logic carries. Each has its own describe block, each is pinned where possible
 * to the prototype's real fixture data rather than a synthetic case, and each
 * asserts BOTH the corrected behaviour and — explicitly — the prototype's wrong
 * answer, so the test reads as a record of what was fixed and why.
 *
 * The prototype's four windows (proto 7009-7042) against its own frozen clock
 * `HOLD_NOW = 2026-08-18T09:00:00Z`:
 *
 *   hold-ca01    start 2026-08-11T08:00Z  wait  7d  verdict signals  ->  -1h  (past)
 *   hold-guest   start 2026-08-13T10:00Z  wait 14d  verdict clear    -> 217h  (9d 1h)
 *   hold-admins  start 2026-08-12T06:00Z  wait  7d  verdict watch    ->  21h
 *   hold-private start 2026-08-11T09:00Z  wait 30d  verdict watch    -> 552h  (23d)
 */

import { describe, it, expect } from "vitest";

import {
  HOLD_CLOSING_THRESHOLD_HOURS,
  HOLD_TONE,
  closesAt,
  closesDayWord,
  deriveHoldState,
  deriveHoldWindow,
  dueHoldNotifications,
  effectiveWaitDays,
  holdBadge,
  holdDayTicks,
  holdPrimaryAction,
  holdScanLabel,
  holdScanProvenance,
  holdTMinus,
  runbookStatusFromHold,
  type HoldWindowInput,
} from "./portal-hold-windows";

/** The prototype's frozen clock (proto 7008). */
const NOW = new Date("2026-08-18T09:00:00Z");

/** The prototype's own four windows, verbatim in the fields that matter. */
const CA01: HoldWindowInput = {
  startedAt: "2026-08-11T08:00:00Z",
  waitDays: 7,
  scanVerdict: "signals",
};
const GUEST: HoldWindowInput = {
  startedAt: "2026-08-13T10:00:00Z",
  waitDays: 14,
  scanVerdict: "clear",
};
const ADMINS: HoldWindowInput = {
  startedAt: "2026-08-12T06:00:00Z",
  waitDays: 7,
  scanVerdict: "watch",
};
const PRIVATE: HoldWindowInput = {
  startedAt: "2026-08-11T09:00:00Z",
  waitDays: 30,
  scanVerdict: "watch",
};

describe("the prototype's own four windows land in the states the design intends", () => {
  it("hold-ca01 is past its close moment, so a decision is due", () => {
    const d = deriveHoldWindow(CA01, NOW);
    expect(d.hoursLeft).toBe(-1);
    expect(d.state).toBe("due");
    expect(d.tone).toBe(HOLD_TONE.due);
  });

  it("hold-guest is clear with nine whole days left, so it can close early", () => {
    const d = deriveHoldWindow(GUEST, NOW);
    expect(d.hoursLeft).toBe(217);
    expect(d.state).toBe("early");
  });

  it("hold-admins is inside its final 24 hours", () => {
    const d = deriveHoldWindow(ADMINS, NOW);
    expect(d.hoursLeft).toBe(21);
    expect(d.state).toBe("closing");
  });

  it("hold-private is still just running", () => {
    const d = deriveHoldWindow(PRIVATE, NOW);
    expect(d.hoursLeft).toBe(552);
    expect(d.state).toBe("running");
  });
});

describe("DEFECT 1 — `closing` must be reachable when the verdict is clear", () => {
  // The prototype's ternary tests `clear` BEFORE proximity:
  //   hoursLeft <= 0 ? 'due' : clear ? 'early' : hoursLeft <= 24 ? 'closing' : 'running'
  // so a clear window three hours out could never be `closing`.
  const clearAndImminent: HoldWindowInput = {
    startedAt: "2026-08-11T09:00:00Z",
    waitDays: 7,
    scanVerdict: "clear",
  };

  it("a clear window three hours from closing is `closing`, not `early`", () => {
    const now = new Date("2026-08-18T06:00:00Z"); // closes 18 Aug 09:00 -> 3h left
    expect(deriveHoldWindow(clearAndImminent, now).hoursLeft).toBe(3);
    expect(deriveHoldState(clearAndImminent, now)).toBe("closing");
  });

  it("and it does not offer to close 0 days early, which is not an action", () => {
    const now = new Date("2026-08-18T06:00:00Z");
    const action = holdPrimaryAction(clearAndImminent, now);
    expect(action.kind).not.toBe("close_early");
    expect(action.label).not.toContain("0 days early");
  });

  it("proximity beats the verdict for `signals` and `watch` too — the rule is uniform", () => {
    for (const verdict of ["clear", "signals", "watch"] as const) {
      const w = { ...clearAndImminent, scanVerdict: verdict };
      expect(deriveHoldState(w, new Date("2026-08-18T06:00:00Z"))).toBe("closing");
    }
  });
});

describe("DEFECT 2 — `early` must not overstate the days it saves", () => {
  it("hold-guest saves NINE days, not the prototype's ten", () => {
    // 217 hours = 9 days and 1 hour. Math.ceil(217/24) = 10, which is what the
    // prototype renders; Math.floor gives 9, which is what the README's own
    // alerting copy says ("you don't need to wait the remaining 9 days").
    const d = deriveHoldWindow(GUEST, NOW);
    expect(d.daysSaved).toBe(9);
    expect(Math.ceil(217 / 24)).toBe(10); // the prototype's answer, for the record
    expect(holdPrimaryAction(GUEST, NOW).label).toBe("Close the window 9 days early");
  });

  it("`early` requires at least one WHOLE day to be saved", () => {
    // 25 hours out and clear: past the closing threshold, but only one whole day
    // is saveable, so `early` is legitimate and says "1 day", singular.
    const w: HoldWindowInput = { startedAt: "2026-08-17T08:00:00Z", waitDays: 1, scanVerdict: "clear" };
    const now = new Date("2026-08-17T07:00:00Z");
    expect(deriveHoldWindow(w, now).hoursLeft).toBe(25);
    expect(deriveHoldState(w, now)).toBe("early");
    expect(holdPrimaryAction(w, now).label).toBe("Close the window 1 day early");
  });

  it("never rounds the countdown UP — an overstated deadline is the one that catches people out", () => {
    // Closes 18 Aug 08:59; read at 17 Aug 09:00, so 23h59m remain. That must
    // report 23 hours, never 24: rounding a deadline up hands back time that
    // does not exist.
    const w: HoldWindowInput = { startedAt: "2026-08-11T08:59:00Z", waitDays: 7, scanVerdict: "watch" };
    const now = new Date("2026-08-17T09:00:00Z");
    const d = deriveHoldWindow(w, now);
    expect(d.msLeft).toBe(23 * 3_600_000 + 59 * 60_000);
    expect(d.hoursLeft).toBe(23);
    expect(holdTMinus(w, now)).toBe("T-23h");
  });
});

describe("DEFECT 3 — 'closes tomorrow' must come from the calendar, not from hours", () => {
  it("a 20-hour remainder starting at 01:00 closes TODAY, and says so", () => {
    // The prototype badges any window inside 24h as "closes tomorrow". Here the
    // close moment is 21:00 on the same UTC day.
    const w: HoldWindowInput = { startedAt: "2026-08-11T21:00:00Z", waitDays: 7, scanVerdict: "watch" };
    const now = new Date("2026-08-18T01:00:00Z");
    const d = deriveHoldWindow(w, now);
    expect(d.hoursLeft).toBe(20);
    expect(d.state).toBe("closing");
    expect(closesDayWord(d.closesAt, now)).toBe("today");
    expect(holdBadge(w, now)).toBe("T-20h · closes today");
  });

  it("a 20-hour remainder starting at 23:00 really does close tomorrow", () => {
    const w: HoldWindowInput = { startedAt: "2026-08-11T19:00:00Z", waitDays: 7, scanVerdict: "watch" };
    const now = new Date("2026-08-17T23:00:00Z");
    expect(deriveHoldWindow(w, now).hoursLeft).toBe(20);
    expect(holdBadge(w, now)).toBe("T-20h · closes tomorrow");
  });

  it("hold-admins at 21 hours out closes tomorrow, which is the design's own case", () => {
    // 18 Aug 09:00 + 21h = 19 Aug 06:00. The prototype's scanLine for this
    // window says "before the window closes tomorrow morning", so the design
    // agrees — this case is the one where the prototype happens to be right.
    expect(holdBadge(ADMINS, NOW)).toBe("T-21h · closes tomorrow");
  });
});

describe("DEFECT 4 — the badge and the T-minus readout must share one threshold", () => {
  it("a 30-hour window does not pair a relaxed state with an urgent number", () => {
    // The prototype: state `running` (>24h) but readout "T-30h" (<=48h).
    const w: HoldWindowInput = { startedAt: "2026-08-11T15:00:00Z", waitDays: 7, scanVerdict: "watch" };
    const now = new Date("2026-08-17T09:00:00Z");
    expect(deriveHoldWindow(w, now).hoursLeft).toBe(30);
    expect(deriveHoldState(w, now)).toBe("running");
    expect(holdBadge(w, now)).toBe("Holding");
    // Days, matching the state — not the prototype's "T-30h".
    expect(holdTMinus(w, now)).toBe("T-1d");
  });

  it("the switch to hours happens exactly at the state boundary", () => {
    const at = (hoursOut: number) => {
      const now = new Date("2026-08-18T09:00:00Z");
      const started = new Date(now.getTime() + hoursOut * 3_600_000 - 7 * 86_400_000);
      return { w: { startedAt: started, waitDays: 7, scanVerdict: "watch" } as HoldWindowInput, now };
    };
    const boundary = at(HOLD_CLOSING_THRESHOLD_HOURS);
    expect(deriveHoldState(boundary.w, boundary.now)).toBe("closing");
    expect(holdTMinus(boundary.w, boundary.now)).toBe("T-24h");

    const justOutside = at(HOLD_CLOSING_THRESHOLD_HOURS + 1);
    expect(deriveHoldState(justOutside.w, justOutside.now)).toBe("running");
    expect(holdTMinus(justOutside.w, justOutside.now)).toBe("T-1d");
  });

  it("a passed window reports how long ago it closed", () => {
    expect(holdTMinus(CA01, NOW)).toBe("Closed 1h ago");
    expect(holdBadge(CA01, NOW)).toBe("T-0 · decision due 1h ago");
  });
});

describe("extensions", () => {
  it("extend the close moment without rewriting the agreed wait", () => {
    const extended: HoldWindowInput = { ...ADMINS, extendedDays: 3 };
    expect(effectiveWaitDays(extended)).toBe(10);
    expect(extended.waitDays).toBe(7); // the agreement is not overwritten
    expect(closesAt(extended).toISOString()).toBe("2026-08-22T06:00:00.000Z");
  });

  it("move a window out of `closing` back to `running`", () => {
    expect(deriveHoldState(ADMINS, NOW)).toBe("closing");
    expect(deriveHoldState({ ...ADMINS, extendedDays: 3 }, NOW)).toBe("running");
  });

  it("lengthen the day-tick track, because the track shows the real wait", () => {
    expect(holdDayTicks(ADMINS, NOW)).toHaveLength(7);
    expect(holdDayTicks({ ...ADMINS, extendedDays: 3 }, NOW)).toHaveLength(10);
  });
});

describe("the alerting contract", () => {
  it("owes T-24 once inside the final 24 hours, and only once", () => {
    expect(dueHoldNotifications(ADMINS, NOW)).toContain("t24");
    expect(dueHoldNotifications({ ...ADMINS, notifiedT24At: NOW }, NOW)).not.toContain("t24");
  });

  it("still owes T-24 for a window that passed the boundary unattended", () => {
    // A missed T-24 must not be silently skipped just because T-0 also arrived.
    const due = dueHoldNotifications(CA01, NOW);
    expect(due).toContain("t24");
    expect(due).toContain("t0");
  });

  it("owes the early-clear FINDING when a clear scan lands with real days left", () => {
    expect(dueHoldNotifications(GUEST, NOW)).toContain("early_clear");
    expect(dueHoldNotifications({ ...GUEST, notifiedEarlyClearAt: NOW }, NOW)).not.toContain("early_clear");
  });

  it("does not raise an early-clear finding that would save no days", () => {
    // "You don't need to wait the remaining 0 days" is not a finding.
    const w: HoldWindowInput = { startedAt: "2026-08-11T09:00:00Z", waitDays: 7, scanVerdict: "clear" };
    const now = new Date("2026-08-18T06:00:00Z"); // 3h left
    expect(dueHoldNotifications(w, now)).not.toContain("early_clear");
  });

  it("owes nothing at all once the window is closed", () => {
    expect(dueHoldNotifications({ ...CA01, closedAt: NOW }, NOW)).toEqual([]);
  });

  it("owes nothing while a window is comfortably running", () => {
    expect(dueHoldNotifications(PRIVATE, NOW)).toEqual([]);
  });
});

describe("day ticks", () => {
  it("fill one per elapsed day and half-light the day in progress", () => {
    // hold-admins: 7 days total, 21h left, so 6 days and 3 hours elapsed.
    const ticks = holdDayTicks(ADMINS, NOW);
    expect(ticks).toHaveLength(7);
    expect(ticks.filter((t) => t === "done")).toHaveLength(6);
    expect(ticks[6]).toBe("partial");
  });

  it("are entirely done once the window has passed", () => {
    expect(holdDayTicks(CA01, NOW).every((t) => t === "done")).toBe(true);
  });
});

describe("presentation helpers", () => {
  it("state the verdict in the design's own words", () => {
    expect(holdScanLabel("clear")).toBe("Scan says: no further interruption expected");
    expect(holdScanLabel("signals")).toBe("Scan says: enforcing today would break something");
    expect(holdScanLabel("watch")).toBe("Scan says: watch this one");
  });

  it("offer the right primary action per the README's decision table", () => {
    // `signals` at T-0 must not offer a bare "release" — the scan named
    // something that would break.
    expect(holdPrimaryAction(CA01, NOW)).toEqual({
      kind: "decide",
      label: "Decide — release, exclude or extend",
    });
    expect(holdPrimaryAction(ADMINS, NOW).kind).toBe("prepare_cr");
  });

  it("compose the scan provenance line rather than storing it as prose", () => {
    expect(
      holdScanProvenance({
        scanSource: "Report-only sign-in logs",
        scanCadence: "hourly",
        scanAt: "2026-08-18T08:00:00Z",
      }),
    ).toBe("Report-only sign-in logs, scanned hourly, last 08:00 UTC");
  });

  it("omit the timestamp rather than inventing one when no scan has run", () => {
    expect(holdScanProvenance({ scanSource: "Guest activity", scanCadence: "daily", scanAt: null })).toBe(
      "Guest activity, scanned daily",
    );
  });

  it("let an open hold override the runbook's own status", () => {
    expect(runbookStatusFromHold("due")).toBe("Decision due");
    expect(runbookStatusFromHold("early")).toBe("Clear to close early");
    expect(runbookStatusFromHold("closing")).toBe("Holding");
    expect(runbookStatusFromHold("running")).toBe("Holding");
  });
});
