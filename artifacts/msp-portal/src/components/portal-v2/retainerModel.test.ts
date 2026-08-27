/**
 * retainerModel.test.ts — pins the retainer's hour arithmetic and week view.
 *
 * The page renders the SAME budget as a bar, a percentage and a "remaining"
 * figure, all derived from `RET_HOURS`. If those three ever disagree the page
 * lies about how much time is left, so the derivation is pinned here rather
 * than trusted to stay consistent by hand.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RET_HOURS, RET_WEEKS } from "./retainerData";
import {
  RET_AVAILABLE,
  RET_REMAINING,
  RET_USED_PCT,
  askWho,
  buildWeekView,
  currentHeadingLabel,
  daysLeftInPeriodLabel,
  hoursChip,
  outcomeToneColor,
  periodEndDate,
  pillarTextColor,
  retSummary,
  rolledExpiryLabel,
  selectWeek,
  workStateColor,
} from "./retainerModel";

describe("hour arithmetic", () => {
  it("adds rolled-forward hours to the monthly retainer", () => {
    assert.equal(RET_AVAILABLE, RET_HOURS.retained + RET_HOURS.rolled);
    assert.equal(RET_AVAILABLE, 10);
  });

  it("computes remaining as available minus used", () => {
    assert.equal(RET_REMAINING, 4.5);
  });

  it("rounds the used percentage to a whole number", () => {
    // 5.5 of 10 -> 55%.
    assert.equal(RET_USED_PCT, 55);
  });

  it("pre-formats the four headline figures to one decimal", () => {
    assert.deepEqual(
      { u: retSummary.used, a: retSummary.available, r: retSummary.remaining, ro: retSummary.rolled },
      { u: "5.5", a: "10.0", r: "4.5", ro: "2.0" },
    );
    assert.equal(retSummary.usedPctLabel, "55%");
  });
});

describe("hoursChip", () => {
  it("writes an hour figure with its unit", () => {
    assert.equal(hoursChip(2), "2.0 h");
    assert.equal(hoursChip(0.5), "0.5 h");
  });
});

describe("workStateColor", () => {
  it("greens a closed item, blues one in progress, ambers the rest", () => {
    assert.equal(workStateColor("Closed"), "#34d399");
    assert.equal(workStateColor("In progress"), "#60a5fa");
    assert.equal(workStateColor("In review"), "#c2a63d");
    assert.equal(workStateColor("Scheduled"), "#c2a63d");
  });
});

describe("pillarTextColor", () => {
  it("drops Compliance's near-white to a legible slate", () => {
    assert.equal(pillarTextColor("#E2E8F0"), "#cbd5e1");
  });
  it("passes every other identity colour through", () => {
    assert.equal(pillarTextColor("#3B82F6"), "#3B82F6");
  });
});

describe("outcomeToneColor", () => {
  it("maps the three tones the design uses", () => {
    assert.equal(outcomeToneColor("green"), "#34d399");
    assert.equal(outcomeToneColor("blue"), "#60a5fa");
    assert.equal(outcomeToneColor("amber"), "#c2a63d");
  });
});

describe("selectWeek", () => {
  it("defaults to the current week when nothing is asked for", () => {
    assert.equal(selectWeek(null).key, "W34");
    assert.equal(selectWeek(undefined).key, "W34");
    assert.equal(RET_WEEKS[0].key, "W34");
    assert.equal(RET_WEEKS[0].current, true);
  });

  it("falls back to the current week for an unknown key rather than throwing", () => {
    assert.equal(selectWeek("W99").key, "W34");
  });

  it("returns the requested week when it exists", () => {
    assert.equal(selectWeek("W32").key, "W32");
  });
});

describe("periodEndDate (#1401)", () => {
  it("resolves the last real calendar day of a 31-day month", () => {
    assert.equal(periodEndDate("2026-08").toISOString(), "2026-08-31T00:00:00.000Z");
  });
  it("resolves the last real calendar day of a 30-day month", () => {
    assert.equal(periodEndDate("2026-09").toISOString(), "2026-09-30T00:00:00.000Z");
  });
  it("resolves February in a leap year", () => {
    assert.equal(periodEndDate("2028-02").toISOString(), "2028-02-29T00:00:00.000Z");
  });
});

describe("rolledExpiryLabel (#1401)", () => {
  it("names the real last day of the bucket's own period, not a fixture date", () => {
    assert.equal(rolledExpiryLabel("2026-08"), "expire 31 Aug");
    assert.equal(rolledExpiryLabel("2026-09"), "expire 30 Sep");
  });
});

describe("daysLeftInPeriodLabel (#1401)", () => {
  it("counts real days remaining in the period from `now`", () => {
    assert.equal(daysLeftInPeriodLabel("2026-08", new Date("2026-08-27T00:00:00.000Z")), "4 days left");
    assert.equal(daysLeftInPeriodLabel("2026-08", new Date("2026-08-30T00:00:00.000Z")), "1 day left");
  });
  it("floors at 0 rather than reading negative for a stale read past period end", () => {
    assert.equal(daysLeftInPeriodLabel("2026-08", new Date("2026-09-02T00:00:00.000Z")), "0 days left");
  });
});

describe("currentHeadingLabel (#1401)", () => {
  it("states the real current calendar month and year, not a hardcoded one", () => {
    assert.equal(currentHeadingLabel(new Date("2026-08-27T00:00:00.000Z")), "My Architect · August 2026");
    assert.equal(currentHeadingLabel(new Date("2027-01-05T00:00:00.000Z")), "My Architect · January 2027");
  });
});

describe("askWho", () => {
  it("names the two voices in a report thread", () => {
    assert.equal(askWho("you"), "You");
    assert.equal(askWho("them"), "Priya Raman");
  });
});

describe("buildWeekView", () => {
  it("formats the week's logged total and each log line", () => {
    const v = buildWeekView("W34");
    assert.equal(v.hours, "2.0 h logged");
    assert.equal(v.hasLog, true);
    assert.deepEqual(
      v.log.map((l) => l.hours),
      ["0.5 h", "1.0 h", "0.5 h"],
    );
  });

  it("carries the two-tone flag on each ask, customer-first", () => {
    const v = buildWeekView("W34");
    assert.equal(v.hasAsks, true);
    assert.deepEqual(
      v.asks.map((a) => [a.who, a.fromYou]),
      [
        ["You", true],
        ["Priya Raman", false],
      ],
    );
  });

  it("flags an empty week so the design can omit its blocks, not draw empty headings", () => {
    // W31 logged no hours: no log, no deliverables, no asks.
    const v = buildWeekView("W31");
    assert.equal(v.hours, "0.0 h logged");
    assert.equal(v.hasLog, false);
    assert.equal(v.hasDeliverables, false);
    assert.equal(v.hasAsks, false);
  });
});
