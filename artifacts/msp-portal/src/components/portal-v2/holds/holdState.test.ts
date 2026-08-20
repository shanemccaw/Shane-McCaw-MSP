/**
 * holdState.test.ts — the DRIFT GUARD on the client-side hold derivation.
 *
 * This is deliberately not an independent set of cases. It pins the SAME four
 * defect scenarios, at the SAME boundaries, with the SAME expected answers as
 * api-server's `portal-hold-windows.test.ts`. Two implementations of one rule is
 * a real risk, and this is the house answer to it — the same shape as
 * `remediation-tracker-catalogue.test.ts` guarding the remediation step
 * catalogue across the same app boundary.
 *
 * If someone edits one side's rules and not the other, one of the two suites
 * goes red. Keep the cases in step when either changes.
 *
 * The scenarios, all from the design prototype's own fixtures where possible:
 *   1. `closing` must be reachable when the verdict is `clear`.
 *   2. `early` must floor, not ceil — hold-guest saves 9 days, not 10.
 *   3. "closes tomorrow" must come from the calendar, not from hours.
 *   4. Badge and readout must share one threshold.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HOLD_CLOSING_THRESHOLD_HOURS,
  closesDayWord,
  deriveHoldClock,
  deriveHoldState,
  holdPrimaryLabel,
} from "./holdState";

/** The prototype's frozen clock (proto 7008), so the fixtures line up exactly. */
const NOW = new Date("2026-08-18T09:00:00Z");

/** Build a `closesAt` a given number of hours from NOW. */
const closesIn = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

describe("the prototype's four windows land in the four states", () => {
  it("hold-ca01 at T-0 minus 1h is due", () => {
    assert.equal(deriveHoldState({ closesAt: closesIn(-1), scanVerdict: "signals" }, NOW), "due");
  });
  it("hold-admins at 21h is closing", () => {
    assert.equal(deriveHoldState({ closesAt: closesIn(21), scanVerdict: "watch" }, NOW), "closing");
  });
  it("hold-guest at 217h and clear is early", () => {
    assert.equal(deriveHoldState({ closesAt: closesIn(217), scanVerdict: "clear" }, NOW), "early");
  });
  it("hold-private at 552h is running", () => {
    assert.equal(deriveHoldState({ closesAt: closesIn(552), scanVerdict: "watch" }, NOW), "running");
  });
});

describe("DEFECT 1 — closing must be reachable when the verdict is clear", () => {
  it("a clear window three hours out is closing, not early", () => {
    assert.equal(deriveHoldState({ closesAt: closesIn(3), scanVerdict: "clear" }, NOW), "closing");
  });

  it("and does not offer to close 0 days early", () => {
    const label = holdPrimaryLabel({ closesAt: closesIn(3), scanVerdict: "clear" }, NOW);
    assert.ok(!label.includes("0 days early"), `unexpected label: ${label}`);
  });

  it("proximity beats the verdict uniformly", () => {
    for (const verdict of ["clear", "signals", "watch"] as const) {
      assert.equal(deriveHoldState({ closesAt: closesIn(3), scanVerdict: verdict }, NOW), "closing");
    }
  });
});

describe("DEFECT 2 — early must not overstate the days it saves", () => {
  it("hold-guest saves NINE days, not the prototype's ten", () => {
    const c = deriveHoldClock({ closesAt: closesIn(217), scanVerdict: "clear" }, NOW);
    assert.equal(c.daysSaved, 9);
    assert.equal(Math.ceil(217 / 24), 10); // the prototype's answer, for the record
    assert.equal(
      holdPrimaryLabel({ closesAt: closesIn(217), scanVerdict: "clear" }, NOW),
      "Close the window 9 days early",
    );
  });

  it("says '1 day' singular when exactly one is saved", () => {
    assert.equal(
      holdPrimaryLabel({ closesAt: closesIn(25), scanVerdict: "clear" }, NOW),
      "Close the window 1 day early",
    );
  });

  it("never rounds the countdown up", () => {
    const c = deriveHoldClock({ closesAt: new Date(NOW.getTime() + 23 * 3_600_000 + 59 * 60_000).toISOString(), scanVerdict: "watch" }, NOW);
    assert.equal(c.hoursLeft, 23);
    assert.equal(c.tMinus, "T-23h");
  });
});

describe("DEFECT 3 — 'closes tomorrow' must come from the calendar", () => {
  it("a 20-hour remainder starting at 01:00 closes TODAY", () => {
    const now = new Date("2026-08-18T01:00:00Z");
    const closes = new Date("2026-08-18T21:00:00Z").toISOString();
    assert.equal(closesDayWord(new Date(closes), now), "today");
    assert.equal(deriveHoldClock({ closesAt: closes, scanVerdict: "watch" }, now).badge, "T-20h · closes today");
  });

  it("a 20-hour remainder starting at 23:00 really does close tomorrow", () => {
    const now = new Date("2026-08-17T23:00:00Z");
    const closes = new Date("2026-08-18T19:00:00Z").toISOString();
    assert.equal(deriveHoldClock({ closesAt: closes, scanVerdict: "watch" }, now).badge, "T-20h · closes tomorrow");
  });

  it("hold-admins at 21h out closes tomorrow, the design's own case", () => {
    assert.equal(
      deriveHoldClock({ closesAt: closesIn(21), scanVerdict: "watch" }, NOW).badge,
      "T-21h · closes tomorrow",
    );
  });
});

describe("DEFECT 4 — badge and readout must share one threshold", () => {
  it("a 30-hour window does not pair a relaxed state with an urgent number", () => {
    const c = deriveHoldClock({ closesAt: closesIn(30), scanVerdict: "watch" }, NOW);
    assert.equal(c.state, "running");
    assert.equal(c.badge, "Holding");
    assert.equal(c.tMinus, "T-1d"); // not the prototype's "T-30h"
  });

  it("switches units exactly at the state boundary", () => {
    const at = deriveHoldClock({ closesAt: closesIn(HOLD_CLOSING_THRESHOLD_HOURS), scanVerdict: "watch" }, NOW);
    assert.equal(at.state, "closing");
    assert.equal(at.tMinus, "T-24h");

    const past = deriveHoldClock({ closesAt: closesIn(HOLD_CLOSING_THRESHOLD_HOURS + 1), scanVerdict: "watch" }, NOW);
    assert.equal(past.state, "running");
    assert.equal(past.tMinus, "T-1d");
  });

  it("reports how long ago a passed window closed", () => {
    const c = deriveHoldClock({ closesAt: closesIn(-1), scanVerdict: "signals" }, NOW);
    assert.equal(c.tMinus, "Closed 1h ago");
    assert.equal(c.badge, "T-0 · decision due 1h ago");
  });
});

describe("the primary action matches the README's decision table", () => {
  it("offers a decision, not a bare release, when the scan named something", () => {
    assert.equal(
      holdPrimaryLabel({ closesAt: closesIn(-1), scanVerdict: "signals" }, NOW),
      "Decide — release, exclude or extend",
    );
  });

  it("offers a plain release when the scan found nothing to stop it", () => {
    assert.equal(
      holdPrimaryLabel({ closesAt: closesIn(-1), scanVerdict: "watch" }, NOW),
      "Release the gated step",
    );
  });

  it("offers to prepare the CR while the window is still running", () => {
    assert.equal(
      holdPrimaryLabel({ closesAt: closesIn(552), scanVerdict: "watch" }, NOW),
      "Prepare the change request now",
    );
  });
});
