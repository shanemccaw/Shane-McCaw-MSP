import { describe, it, expect } from "vitest";
import {
  minutesToHours,
  hoursToMinutes,
  isoDateKey,
  periodKeyOf,
  periodKeyBefore,
  periodKeyAfter,
  isoWeekLabel,
  computeMonthBucket,
  usedMinutesByPeriod,
  pillarColor,
} from "./retainer-hours.ts";

describe("minutes ⇄ hours", () => {
  it("converts minutes to one-decimal hours", () => {
    expect(minutesToHours(30)).toBe(0.5);
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(120)).toBe(2);
    expect(minutesToHours(0)).toBe(0);
  });
  it("converts decimal hours to integer minutes, clamped non-negative", () => {
    expect(hoursToMinutes(0.5)).toBe(30);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(hoursToMinutes(8)).toBe(480);
    expect(hoursToMinutes(-3)).toBe(0);
    expect(hoursToMinutes(NaN)).toBe(0);
  });
});

describe("isoDateKey", () => {
  it("formats YYYY-MM-DD in UTC", () => {
    expect(isoDateKey(new Date("2026-08-15T12:00:00Z"))).toBe("2026-08-15");
    expect(isoDateKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("periodKeyOf — anniversary-based (Git #3473)", () => {
  it("REGRESSION: a customer signed up mid-month resets on THEIR real day, not the 1st", () => {
    // The exact bug: a customer whose real Stripe cycle starts the 14th used to
    // get bucketed into the shared calendar month regardless. Anchor day 14.
    const anchorDay = 14;
    // Just before the anniversary → still last period.
    expect(periodKeyOf(anchorDay, new Date("2026-08-13T23:59:59Z"))).toBe("2026-07-14");
    // On the anniversary itself → the new period starts.
    expect(periodKeyOf(anchorDay, new Date("2026-08-14T00:00:00Z"))).toBe("2026-08-14");
    // Mid-period.
    expect(periodKeyOf(anchorDay, new Date("2026-08-20T12:00:00Z"))).toBe("2026-08-14");
    // The OLD calendar-month bug would have bucketed 2026-08-01..31 as one
    // shared "2026-08" period regardless of the 14th boundary — assert the two
    // dates straddling the real anniversary land in DIFFERENT periods.
    expect(periodKeyOf(anchorDay, new Date("2026-08-13T00:00:00Z"))).not.toBe(
      periodKeyOf(anchorDay, new Date("2026-08-14T00:00:00Z")),
    );
  });

  it("clamps a short-month anchor day to that month's real last day (Stripe's own behavior)", () => {
    const anchorDay = 31;
    // February has no 31st — clamps to the 28th (2026 is not a leap year).
    expect(periodKeyOf(anchorDay, new Date("2026-02-20T00:00:00Z"))).toBe("2026-01-31");
    expect(periodKeyOf(anchorDay, new Date("2026-02-28T00:00:00Z"))).toBe("2026-02-28");
    // March has 31 days again — back to the real anchor day.
    expect(periodKeyOf(anchorDay, new Date("2026-03-31T00:00:00Z"))).toBe("2026-03-31");
  });

  it("still works for a plain 1st-of-month anchor (the old default-of-nothing shape)", () => {
    expect(periodKeyOf(1, new Date("2026-08-15T12:00:00Z"))).toBe("2026-08-01");
    expect(periodKeyOf(1, new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("periodKeyBefore / periodKeyAfter — anniversary-based", () => {
  it("walks a period back and forward on a mid-month anchor, crossing the year boundary", () => {
    const anchorDay = 14;
    expect(periodKeyBefore(anchorDay, "2026-01-14")).toBe("2025-12-14");
    expect(periodKeyBefore(anchorDay, "2026-08-14")).toBe("2026-07-14");
    expect(periodKeyAfter(anchorDay, "2025-12-14")).toBe("2026-01-14");
    expect(periodKeyAfter(anchorDay, "2026-07-14")).toBe("2026-08-14");
  });

  it("keeps stepping off the ORIGINAL anchor day even after a clamp, not the clamped day", () => {
    // Anchor day 31. Nov has 30 days → clamps to "2026-11-30". Stepping forward
    // to December must return to day 31 (min(31,31)=31), not 31+1=Dec 1.
    const anchorDay = 31;
    expect(periodKeyAfter(anchorDay, "2026-11-30")).toBe("2026-12-31");
    expect(periodKeyBefore(anchorDay, "2026-12-31")).toBe("2026-11-30");
  });
});

describe("isoWeekLabel", () => {
  it("labels ISO weeks", () => {
    // 2026-08-19 is in ISO week 34.
    expect(isoWeekLabel(new Date("2026-08-19T00:00:00Z"))).toBe("W34");
    // 2026-01-01 (Thursday) is ISO week 1 of 2026.
    expect(isoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("W1");
  });
});

describe("pillarColor", () => {
  it("maps known pillars and falls back for unknown/blank", () => {
    expect(pillarColor("Health")).toBe("#22C55E");
    expect(pillarColor("Security")).toBe("#8B5CF6");
    expect(pillarColor("Nonsense")).toBe("#E2E8F0");
    expect(pillarColor(null)).toBe("#E2E8F0");
  });
});

describe("computeMonthBucket — rollover, calendar-anchor (anchorDay=1) parity with the old behavior", () => {
  it("matches the design's headline figures (July→August)", () => {
    // July: retained 8h (480), used 6h (360) → 2h unused rolls into August.
    // August: retained 8h, rolled 2h, used 5.5h → 4.5h remaining.
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-07-01", minutes: 360 },
      { periodMonth: "2026-08-01", minutes: 330 },
    ]);
    const bucket = computeMonthBucket(1, "2026-08-01", 480, used);
    expect(minutesToHours(bucket.retainedMinutes)).toBe(8);
    expect(minutesToHours(bucket.rolledMinutes)).toBe(2);
    expect(minutesToHours(bucket.usedMinutes)).toBe(5.5);
    expect(minutesToHours(bucket.remainingMinutes)).toBe(4.5);
  });

  it("rolls forward only ONE month, then expires", () => {
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-07-01", minutes: 0 },
      { periodMonth: "2026-08-01", minutes: 0 },
    ]);
    const sep = computeMonthBucket(1, "2026-09-01", 480, used);
    expect(minutesToHours(sep.rolledMinutes)).toBe(8);
  });

  it("consumes rolled hours first (expiring hours spent before fresh allotment)", () => {
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-06-01", minutes: 0 },
      { periodMonth: "2026-07-01", minutes: 480 },
    ]);
    const aug = computeMonthBucket(1, "2026-08-01", 480, used);
    expect(minutesToHours(aug.rolledMinutes)).toBe(8);
  });

  it("floors remaining at zero on an overage, but reports the overage honestly and uncapped", () => {
    const used = usedMinutesByPeriod([{ periodMonth: "2026-08-01", minutes: 900 }]); // 15h used
    const bucket = computeMonthBucket(1, "2026-08-01", 480, used);
    expect(bucket.remainingMinutes).toBe(0);
    expect(minutesToHours(bucket.usedMinutes)).toBe(15);
    expect(minutesToHours(bucket.overMinutes)).toBe(7);
  });

  it("matches the design's own headline over-month example (10h retained · 12h delivered)", () => {
    const used = usedMinutesByPeriod([{ periodMonth: "2026-08-01", minutes: 720 }]); // 12h used
    const bucket = computeMonthBucket(1, "2026-08-01", 600, used); // 10h retained, no rollover
    expect(minutesToHours(bucket.retainedMinutes)).toBe(10);
    expect(minutesToHours(bucket.usedMinutes)).toBe(12);
    expect(minutesToHours(bucket.overMinutes)).toBe(2);
    expect(bucket.remainingMinutes).toBe(0);
  });

  it("does NOT flag over-month when used exactly matches the allotment", () => {
    const used = usedMinutesByPeriod([{ periodMonth: "2026-08-01", minutes: 480 }]);
    const bucket = computeMonthBucket(1, "2026-08-01", 480, used);
    expect(bucket.remainingMinutes).toBe(0);
    expect(bucket.overMinutes).toBe(0);
  });

  it("gives a clean bucket for a period with no prior activity", () => {
    const bucket = computeMonthBucket(1, "2026-08-01", 480, new Map());
    expect(minutesToHours(bucket.rolledMinutes)).toBe(0);
    expect(minutesToHours(bucket.usedMinutes)).toBe(0);
    expect(minutesToHours(bucket.remainingMinutes)).toBe(8);
    expect(bucket.overMinutes).toBe(0);
  });

  it("counts rolled hours toward the over-month threshold, not just the fresh allotment", () => {
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-06-01", minutes: 0 },
      { periodMonth: "2026-07-01", minutes: 1200 }, // 20h
    ]);
    const bucket = computeMonthBucket(1, "2026-07-01", 480, used);
    expect(minutesToHours(bucket.rolledMinutes)).toBe(8);
    expect(minutesToHours(bucket.overMinutes)).toBe(4);
  });
});

describe("computeMonthBucket — REGRESSION: real anniversary anchor (Git #3473)", () => {
  it("a customer signed up on the 14th rolls over on THEIR real 14th boundary, not the calendar month", () => {
    const anchorDay = 14;
    // "July" for this customer runs 2026-07-14 .. 2026-08-13.
    // "August" for this customer runs 2026-08-14 .. 2026-09-13.
    // Log 6h against the customer's real July anniversary period, and 5.5h
    // against their real August anniversary period — using calendar-month
    // dates that straddle the boundary would have gone to the WRONG bucket
    // under the old periodMonth-of-calendar-date bug.
    const julyKey = periodKeyOf(anchorDay, new Date("2026-07-20T00:00:00Z"));
    const augKey = periodKeyOf(anchorDay, new Date("2026-08-20T00:00:00Z"));
    expect(julyKey).toBe("2026-07-14");
    expect(augKey).toBe("2026-08-14");

    const used = usedMinutesByPeriod([
      { periodMonth: julyKey, minutes: 360 }, // 6h
      { periodMonth: augKey, minutes: 330 }, // 5.5h
    ]);
    const bucket = computeMonthBucket(anchorDay, augKey, 480, used);
    expect(minutesToHours(bucket.rolledMinutes)).toBe(2); // 8h - 6h used in July
    expect(minutesToHours(bucket.usedMinutes)).toBe(5.5);
    expect(minutesToHours(bucket.remainingMinutes)).toBe(4.5);
  });

  it("hours logged on the 13th (still last period) do NOT count toward the period starting the 14th", () => {
    const anchorDay = 14;
    const augKey = periodKeyOf(anchorDay, new Date("2026-08-20T00:00:00Z")); // "2026-08-14"
    // Work logged 2026-08-13 (one day before the anniversary) belongs to the
    // PRIOR period, "2026-07-14", not "2026-08-14" — the exact distinction the
    // old shared calendar-month key could not make (both dates were "2026-08").
    const priorPeriodKey = periodKeyOf(anchorDay, new Date("2026-08-13T00:00:00Z"));
    expect(priorPeriodKey).toBe("2026-07-14");
    expect(priorPeriodKey).not.toBe(augKey);

    // 2h used against the prior 8h allotment → 6h unused rolls forward.
    const used = usedMinutesByPeriod([{ periodMonth: priorPeriodKey, minutes: 120 }]);
    const bucket = computeMonthBucket(anchorDay, augKey, 480, used);
    // None of the prior-period hours count as "used" THIS period — they only
    // affect this period's rollover.
    expect(bucket.usedMinutes).toBe(0);
    expect(minutesToHours(bucket.rolledMinutes)).toBe(6);
  });
});
