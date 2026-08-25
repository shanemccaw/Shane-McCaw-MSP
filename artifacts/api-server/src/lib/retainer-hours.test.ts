import { describe, it, expect } from "vitest";
import {
  minutesToHours,
  hoursToMinutes,
  periodMonthOf,
  periodBefore,
  periodAfter,
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

describe("period math", () => {
  it("formats YYYY-MM in UTC", () => {
    expect(periodMonthOf(new Date("2026-08-15T12:00:00Z"))).toBe("2026-08");
    expect(periodMonthOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
  it("walks a month back and forward, crossing the year boundary", () => {
    expect(periodBefore("2026-01")).toBe("2025-12");
    expect(periodBefore("2026-08")).toBe("2026-07");
    expect(periodAfter("2025-12")).toBe("2026-01");
    expect(periodAfter("2026-07")).toBe("2026-08");
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

describe("computeMonthBucket — rollover", () => {
  it("matches the design's headline figures (July→August)", () => {
    // July: retained 8h (480), used 6h (360) → 2h unused rolls into August.
    // August: retained 8h, rolled 2h, used 5.5h → 4.5h remaining.
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-07", minutes: 360 },
      { periodMonth: "2026-08", minutes: 330 },
    ]);
    const bucket = computeMonthBucket("2026-08", 480, used);
    expect(minutesToHours(bucket.retainedMinutes)).toBe(8);
    expect(minutesToHours(bucket.rolledMinutes)).toBe(2);
    expect(minutesToHours(bucket.usedMinutes)).toBe(5.5);
    expect(minutesToHours(bucket.remainingMinutes)).toBe(4.5);
  });

  it("rolls forward only ONE month, then expires", () => {
    // July retained 8h used 0 → 8h unused. But only retained-unused rolls, and
    // rolled hours themselves do NOT roll a second time.
    // Aug: rolled 8h, used 0 → Aug retained-unused = 8 (rolled first means Aug's
    // rolled 8 goes untouched, Aug retained 8 untouched). rolled into Sep = Aug
    // retained unused = 8; Aug's own rolled 8 expires.
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-07", minutes: 0 },
      { periodMonth: "2026-08", minutes: 0 },
    ]);
    const sep = computeMonthBucket("2026-09", 480, used);
    // Sep rolled = Aug retained-unused = 8h (NOT 16h — Aug's rolled 8h expired).
    expect(minutesToHours(sep.rolledMinutes)).toBe(8);
  });

  it("consumes rolled hours first (expiring hours spent before fresh allotment)", () => {
    // July retained 8h used 8h → 0 rolls. Wait — pick a case where rolled-first
    // matters: June retained 8h used 0 → 8h rolls to July. July retained 8h,
    // rolled 8h, used 8h. Rolled-first: the 8h used comes entirely from rolled,
    // leaving July's retained 8h fully unused → 8h rolls to August.
    const used = usedMinutesByPeriod([
      { periodMonth: "2026-06", minutes: 0 },
      { periodMonth: "2026-07", minutes: 480 },
    ]);
    const aug = computeMonthBucket("2026-08", 480, used);
    expect(minutesToHours(aug.rolledMinutes)).toBe(8);
  });

  it("floors remaining at zero on an overage", () => {
    const used = usedMinutesByPeriod([{ periodMonth: "2026-08", minutes: 900 }]); // 15h used
    const bucket = computeMonthBucket("2026-08", 480, used);
    expect(bucket.remainingMinutes).toBe(0);
    expect(minutesToHours(bucket.usedMinutes)).toBe(15);
  });

  it("gives a clean bucket for a month with no prior activity", () => {
    const bucket = computeMonthBucket("2026-08", 480, new Map());
    expect(minutesToHours(bucket.rolledMinutes)).toBe(0);
    expect(minutesToHours(bucket.usedMinutes)).toBe(0);
    expect(minutesToHours(bucket.remainingMinutes)).toBe(8);
  });
});
