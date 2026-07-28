/**
 * ai-billing-analytics.test.ts
 *
 * AI Cost Governance Phase 4 (#52): trend bucketing and dimension rollups.
 *
 * What these tests are actually protecting:
 *   - the series is GAPLESS. A quiet day must be a real $0.00 bucket, because a
 *     missing bucket both lies about the time axis and removes a genuine zero
 *     from the anomaly baseline;
 *   - buckets follow the VIEWER's calendar, the same way Phase 3's ranges do;
 *   - rows with no attribution are reported as unattributed and are NEVER folded
 *     into a named bucket — the acceptance criterion this phase was written
 *     around;
 *   - every rollup reconciles with the series total, so no view of the same rows
 *     can quietly disagree with another.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUCKET_COUNT,
  MAX_BUCKET_COUNT,
  bucketKeyOf,
  bucketTimeSeries,
  parseBucketCount,
  parseTrendBucket,
  resolveTrendWindow,
  rollupDimension,
  type DimensionInputRow,
  type TrendInputRow,
} from "./ai-billing-analytics.ts";

const UTC = 0;
/** US Eastern in summer: minutes to ADD to local time to reach UTC. */
const EASTERN = 240;

function row(iso: string, costCents: number): TrendInputRow {
  return { occurredAt: new Date(iso), costCents };
}

// ── Param parsing ─────────────────────────────────────────────────────────────

describe("parseTrendBucket", () => {
  it("defaults to day and rejects anything unrecognised", () => {
    expect(parseTrendBucket(undefined)).toBe("day");
    expect(parseTrendBucket("week")).toBe("week");
    expect(parseTrendBucket("month")).toBe("month");
    expect(parseTrendBucket("year")).toBe("day");
    expect(parseTrendBucket({ evil: true })).toBe("day");
  });
});

describe("parseBucketCount", () => {
  it("clamps to the bounds of the bucket size asked for", () => {
    expect(parseBucketCount("1000", "day")).toBe(MAX_BUCKET_COUNT.day);
    expect(parseBucketCount("1000", "month")).toBe(MAX_BUCKET_COUNT.month);
    expect(parseBucketCount("0", "day")).toBe(1);
    expect(parseBucketCount("-5", "week")).toBe(1);
  });

  it("falls back to the default for junk", () => {
    expect(parseBucketCount("abc", "day")).toBe(DEFAULT_BUCKET_COUNT.day);
    expect(parseBucketCount(undefined, "month")).toBe(DEFAULT_BUCKET_COUNT.month);
  });
});

// ── Window resolution ─────────────────────────────────────────────────────────

describe("resolveTrendWindow", () => {
  it("covers N whole days ending with the day in progress", () => {
    const now = new Date("2026-07-28T16:30:00.000Z");
    const w = resolveTrendWindow("day", 7, UTC, now);

    expect(w.start.toISOString()).toBe("2026-07-22T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("snaps to the viewer's midnight, not UTC's", () => {
    // 00:30 UTC on the 28th is still 20:30 on the 27th in US Eastern, so the
    // viewer's window ends at THEIR next midnight (04:00 UTC on the 28th).
    const now = new Date("2026-07-28T00:30:00.000Z");
    const w = resolveTrendWindow("day", 2, EASTERN, now);

    expect(w.start.toISOString()).toBe("2026-07-26T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-28T04:00:00.000Z");
  });

  it("starts weeks on Monday", () => {
    // 2026-07-28 is a Tuesday; its week began Monday the 27th.
    const now = new Date("2026-07-28T12:00:00.000Z");
    const w = resolveTrendWindow("week", 3, UTC, now);

    expect(w.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("walks months by calendar, not by 30-day steps", () => {
    const now = new Date("2026-03-15T12:00:00.000Z");
    const w = resolveTrendWindow("month", 3, UTC, now);

    expect(w.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("falls back to UTC for an out-of-band offset instead of producing garbage", () => {
    const now = new Date("2026-07-28T16:30:00.000Z");
    const hostile = resolveTrendWindow("day", 2, 99_999, now);
    const utc = resolveTrendWindow("day", 2, UTC, now);

    expect(hostile.start.toISOString()).toBe(utc.start.toISOString());
    expect(hostile.end.toISOString()).toBe(utc.end.toISOString());
  });
});

describe("bucketKeyOf", () => {
  it("labels days and weeks by date and months by month", () => {
    const ms = Date.UTC(2026, 6, 28);
    expect(bucketKeyOf(ms, "day", 0)).toBe("2026-07-28");
    expect(bucketKeyOf(ms, "week", 0)).toBe("2026-07-28");
    expect(bucketKeyOf(ms, "month", 0)).toBe("2026-07");
  });
});

// ── Time series ───────────────────────────────────────────────────────────────

describe("bucketTimeSeries", () => {
  const now = new Date("2026-07-28T16:00:00.000Z");
  const window = resolveTrendWindow("day", 5, UTC, now);

  it("emits a bucket for every period, including empty ones", () => {
    const series = bucketTimeSeries([row("2026-07-26T09:00:00.000Z", 500)], {
      bucket: "day",
      window,
      now,
    });

    expect(series.map((p) => p.bucketKey)).toEqual([
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
    ]);
    // The quiet days are present and honestly zero, not absent.
    expect(series.map((p) => p.costCents)).toEqual([0, 0, 500, 0, 0]);
    expect(series.map((p) => p.eventCount)).toEqual([0, 0, 1, 0, 0]);
  });

  it("sums multiple rows into the same bucket", () => {
    const series = bucketTimeSeries(
      [
        row("2026-07-25T01:00:00.000Z", 120),
        row("2026-07-25T23:59:00.000Z", 80),
        row("2026-07-27T12:00:00.000Z", 300),
      ],
      { bucket: "day", window, now },
    );

    expect(series.find((p) => p.bucketKey === "2026-07-25")).toMatchObject({
      costCents: 200,
      eventCount: 2,
    });
    expect(series.find((p) => p.bucketKey === "2026-07-27")?.costCents).toBe(300);
  });

  it("marks only the in-progress bucket partial", () => {
    const series = bucketTimeSeries([], { bucket: "day", window, now });

    expect(series.filter((p) => p.partial).map((p) => p.bucketKey)).toEqual(["2026-07-28"]);
  });

  it("marks buckets before observedFrom partial, so a clipped scan cannot be read as a quiet period", () => {
    const series = bucketTimeSeries([], {
      bucket: "day",
      window,
      now,
      observedFrom: new Date("2026-07-26T08:00:00.000Z"),
    });

    // 07-24 and 07-25 were never read; 07-26 began before the first row we hold,
    // so it is only partly observed too. All three are unjudgeable.
    expect(series.filter((p) => p.partial).map((p) => p.bucketKey)).toEqual([
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-28",
    ]);
  });

  it("assigns rows to the viewer's day, not UTC's", () => {
    const easternNow = new Date("2026-07-28T16:00:00.000Z");
    const easternWindow = resolveTrendWindow("day", 3, EASTERN, easternNow);
    // 02:00 UTC on the 27th is 22:00 on the 26th in Eastern.
    const series = bucketTimeSeries([row("2026-07-27T02:00:00.000Z", 250)], {
      bucket: "day",
      window: easternWindow,
      tzOffsetMinutes: EASTERN,
      now: easternNow,
    });

    expect(series.find((p) => p.costCents === 250)?.bucketKey).toBe("2026-07-26");
  });

  it("ignores rows outside the window and rows with no usable timestamp", () => {
    const series = bucketTimeSeries(
      [
        row("2026-07-01T00:00:00.000Z", 999),
        { occurredAt: null, costCents: 999 },
        { occurredAt: "not-a-date", costCents: 999 },
        row("2026-07-26T09:00:00.000Z", 100),
      ],
      { bucket: "day", window, now },
    );

    expect(series.reduce((a, p) => a + p.costCents, 0)).toBe(100);
  });

  it("treats a null cost as zero rather than NaN", () => {
    const series = bucketTimeSeries(
      [{ occurredAt: new Date("2026-07-26T09:00:00.000Z"), costCents: null }],
      { bucket: "day", window, now },
    );

    const bucket = series.find((p) => p.bucketKey === "2026-07-26");
    expect(bucket?.costCents).toBe(0);
    expect(bucket?.eventCount).toBe(1);
  });
});

// ── Dimension rollups ─────────────────────────────────────────────────────────

function dRow(over: Partial<DimensionInputRow>): DimensionInputRow {
  return {
    costCents: 100,
    customerId: null,
    customerName: null,
    mspId: null,
    mspName: null,
    generatedArtifactType: null,
    ...over,
  };
}

describe("rollupDimension — unattributed rows", () => {
  it("reports NULL-customer rows as unattributed instead of folding them into a bucket", () => {
    const rollup = rollupDimension(
      [
        dRow({ customerId: 7, customerName: "Acme", costCents: 300 }),
        dRow({ customerId: null, costCents: 900 }),
        dRow({ customerId: null, costCents: 100 }),
      ],
      "customer",
    );

    // The named bucket holds only what was genuinely attributed to it.
    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]).toMatchObject({ id: 7, label: "Acme", costCents: 300 });

    // The unattributed 1000c is visible, separate, and countable.
    expect(rollup.unattributed).toMatchObject({ costCents: 1000, eventCount: 2 });
    expect(rollup.unattributed.label).toContain("no customer");

    // And nothing went missing: attributed + unattributed = the total.
    expect(rollup.totalCostCents).toBe(1300);
    expect(
      rollup.slices.reduce((a, s) => a + s.costCents, 0) +
        rollup.other.costCents +
        rollup.unattributed.costCents,
    ).toBe(rollup.totalCostCents);
  });

  it("reports platform (null-MSP) spend as unattributed on the MSP dimension", () => {
    const rollup = rollupDimension(
      [
        dRow({ mspId: 2, mspName: "Northwind MSP", costCents: 400 }),
        dRow({ mspId: null, costCents: 600 }),
      ],
      "msp",
    );

    expect(rollup.slices.map((s) => s.label)).toEqual(["Northwind MSP"]);
    expect(rollup.unattributed.costCents).toBe(600);
  });

  it("reports calls that produced no artifact as unattributed on the doc-type dimension", () => {
    const rollup = rollupDimension(
      [
        dRow({ generatedArtifactType: "sow", costCents: 250 }),
        dRow({ generatedArtifactType: "  ", costCents: 250 }),
        dRow({ generatedArtifactType: null, costCents: 250 }),
      ],
      "artifactType",
    );

    // A whitespace-only artifact type is no attribution at all, not a bucket
    // named "  " sitting in the chart legend.
    expect(rollup.slices.map((s) => s.key)).toEqual(["sow"]);
    expect(rollup.unattributed).toMatchObject({ costCents: 500, eventCount: 2 });
  });

  it("falls back to the id, not to a guess, when a name did not resolve", () => {
    const rollup = rollupDimension([dRow({ customerId: 42, customerName: null })], "customer");
    expect(rollup.slices[0]?.label).toBe("Customer 42");
  });
});

describe("rollupDimension — ordering and the capped tail", () => {
  it("sorts by cost descending", () => {
    const rollup = rollupDimension(
      [
        dRow({ customerId: 1, customerName: "One", costCents: 100 }),
        dRow({ customerId: 2, customerName: "Two", costCents: 900 }),
        dRow({ customerId: 3, customerName: "Three", costCents: 500 }),
      ],
      "customer",
    );

    expect(rollup.slices.map((s) => s.label)).toEqual(["Two", "Three", "One"]);
  });

  it("folds the tail into `other` and says how many buckets that was", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      dRow({ customerId: i + 1, customerName: `C${i + 1}`, costCents: (i + 1) * 100 }),
    );
    const rollup = rollupDimension(rows, "customer", 2);

    expect(rollup.slices.map((s) => s.label)).toEqual(["C6", "C5"]);
    // 400 + 300 + 200 + 100 across four folded buckets — stated, not silently cut.
    expect(rollup.other).toEqual({ costCents: 1000, eventCount: 4, sliceCount: 4 });
    expect(rollup.totalCostCents).toBe(2100);
  });

  it("reconciles with the time series over the same rows", () => {
    const rows: DimensionInputRow[] = [
      dRow({ customerId: 1, customerName: "One", mspId: 5, costCents: 120 }),
      dRow({ customerId: null, mspId: null, costCents: 480 }),
      dRow({ customerId: 2, customerName: "Two", mspId: 5, costCents: 900 }),
    ];
    const total = rows.reduce((a, r) => a + (r.costCents ?? 0), 0);

    for (const dimension of ["customer", "msp", "artifactType"] as const) {
      expect(rollupDimension(rows, dimension).totalCostCents).toBe(total);
    }
  });

  it("is stable for ties", () => {
    const a = rollupDimension(
      [
        dRow({ customerId: 2, customerName: "B", costCents: 100 }),
        dRow({ customerId: 1, customerName: "A", costCents: 100 }),
      ],
      "customer",
    );
    const b = rollupDimension(
      [
        dRow({ customerId: 1, customerName: "A", costCents: 100 }),
        dRow({ customerId: 2, customerName: "B", costCents: 100 }),
      ],
      "customer",
    );

    expect(a.slices.map((s) => s.key)).toEqual(b.slices.map((s) => s.key));
  });
});
