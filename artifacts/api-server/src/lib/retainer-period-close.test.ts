/**
 * retainer-period-close.test.ts — Git #4020's pure period-close rules.
 */
import { describe, it, expect } from "vitest";
import {
  isPeriodKeyForAnchor,
  periodEndsAt,
  periodHasEnded,
  summaryPeriodKeys,
  bucketFromCloseSnapshot,
} from "./retainer-period-close.ts";

describe("isPeriodKeyForAnchor", () => {
  it("accepts the real anniversary start for the anchor", () => {
    expect(isPeriodKeyForAnchor(10, "2026-06-10")).toBe(true);
    expect(isPeriodKeyForAnchor(1, "2026-06-01")).toBe(true);
  });

  it("rejects a real date that is not this anchor's boundary", () => {
    expect(isPeriodKeyForAnchor(10, "2026-06-11")).toBe(false);
    expect(isPeriodKeyForAnchor(10, "2026-06-01")).toBe(false);
  });

  it("follows the short-month clamp: anchor 31 in February is the 28th", () => {
    expect(isPeriodKeyForAnchor(31, "2026-02-28")).toBe(true);
    expect(isPeriodKeyForAnchor(31, "2026-03-31")).toBe(true);
    expect(isPeriodKeyForAnchor(31, "2026-03-28")).toBe(false);
  });

  it("rejects malformed and impossible keys", () => {
    expect(isPeriodKeyForAnchor(10, "2026-06")).toBe(false);
    expect(isPeriodKeyForAnchor(10, "not-a-date")).toBe(false);
    expect(isPeriodKeyForAnchor(30, "2026-02-30")).toBe(false);
    expect(isPeriodKeyForAnchor(10, "2026-6-10")).toBe(false);
  });
});

describe("periodEndsAt / periodHasEnded", () => {
  it("a period ends at the next anniversary start, UTC midnight", () => {
    expect(periodEndsAt(10, "2026-06-10").toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(periodEndsAt(31, "2026-01-31").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(periodEndsAt(15, "2026-12-15").toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("has not ended one millisecond before its end, and has ended exactly at it", () => {
    const end = new Date("2026-07-10T00:00:00.000Z");
    expect(periodHasEnded(10, "2026-06-10", new Date(end.getTime() - 1))).toBe(false);
    expect(periodHasEnded(10, "2026-06-10", end)).toBe(true);
  });

  it("a future period has not ended", () => {
    expect(periodHasEnded(10, "2026-09-10", new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });
});

describe("summaryPeriodKeys", () => {
  it("unions current, entry and closed keys, newest first, without duplicates", () => {
    expect(
      summaryPeriodKeys("2026-09-10", ["2026-06-10", "2026-07-10", "2026-06-10"], ["2026-06-10", "2026-05-10"]),
    ).toEqual(["2026-09-10", "2026-07-10", "2026-06-10", "2026-05-10"]);
  });

  it("is just the current period when there is no activity", () => {
    expect(summaryPeriodKeys("2026-09-10", [], [])).toEqual(["2026-09-10"]);
  });
});

describe("bucketFromCloseSnapshot", () => {
  it("maps stored columns onto the MonthBucket shape unchanged", () => {
    expect(
      bucketFromCloseSnapshot({
        periodKey: "2026-06-10",
        retainedMinutes: 480,
        rolledMinutes: 120,
        usedMinutes: 330,
        remainingMinutes: 270,
        overMinutes: 0,
      }),
    ).toEqual({
      period: "2026-06-10",
      retainedMinutes: 480,
      rolledMinutes: 120,
      usedMinutes: 330,
      remainingMinutes: 270,
      overMinutes: 0,
    });
  });
});
