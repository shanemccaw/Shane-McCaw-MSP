/**
 * ai-cost-anomaly.test.ts
 *
 * AI Cost Governance Phase 4 (#52): the anomaly rule.
 *
 * The load-bearing assertion in this file is the DIRECTION one. This repo has
 * shipped threshold rules that fired on a high count when a zero count was the
 * real alarm, so the direction is tested as a first-class property here: for
 * cost, high is bad, and a fall in spend — however dramatic — must never flag.
 *
 * The rest guards the noise floor and the honesty of the "no baseline" case: a
 * rule that flags $0.02 -> $0.09, or that flags the first day a platform ever
 * ran, would be switched off by its reader within a week and would then be worse
 * than no rule at all.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  AI_COST_ANOMALY_DIRECTION,
  DEFAULT_AI_COST_ANOMALY_RULE,
  describeAnomalyRule,
  scanCostAnomalies,
  type CostBucketPoint,
} from "./ai-cost-anomaly.ts";

/** Build a fully-observed series from a list of cent amounts, oldest first. */
function series(costs: number[], partialFlags: boolean[] = []): CostBucketPoint[] {
  return costs.map((costCents, i) => ({
    bucketKey: `2026-07-${String(i + 1).padStart(2, "0")}`,
    bucketStart: new Date(Date.UTC(2026, 6, i + 1)).toISOString(),
    costCents,
    partial: partialFlags[i] ?? false,
  }));
}

describe("scanCostAnomalies — direction (high is bad)", () => {
  it("exports the direction as data, not as an implicit comparison", () => {
    expect(AI_COST_ANOMALY_DIRECTION).toBe("high-is-bad");
  });

  it("FIRES on a spike above the baseline", () => {
    // Baseline median of 100c across seven steady days, then a 10x day.
    const scan = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 1000]));

    expect(scan.anomalies).toHaveLength(1);
    expect(scan.anomalies[0]).toMatchObject({
      bucketKey: "2026-07-08",
      costCents: 1000,
      baselineCents: 100,
      ratioBps: 100_000,
      reason: "above-baseline",
      severity: "severe",
    });
  });

  it("DOES NOT FIRE on a collapse below the baseline", () => {
    // The mirror image of the case above: same steady baseline, then spend
    // falls to a hundredth of it. Cheap is not an alarm for this metric.
    const scan = scanCostAnomalies(series([1000, 1000, 1000, 1000, 1000, 1000, 1000, 10]));

    expect(scan.anomalies).toEqual([]);
    // It was genuinely evaluated and cleared, not skipped for want of a baseline.
    expect(scan.evaluated).toBeGreaterThan(0);
  });

  it("does not fire on a rise that stays under the factor", () => {
    // 2.9x against a 3x rule — deliberately just short.
    const scan = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 290]));
    expect(scan.anomalies).toEqual([]);
  });

  it("fires exactly at the factor boundary", () => {
    const scan = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 300]));
    expect(scan.anomalies).toHaveLength(1);
    expect(scan.anomalies[0]?.severity).toBe("elevated");
  });
});

describe("scanCostAnomalies — noise floor", () => {
  it("does not fire on a large multiple of a trivial baseline", () => {
    // 1c -> 9c is a 9x rise and completely uninteresting.
    const scan = scanCostAnomalies(series([1, 1, 1, 1, 1, 1, 1, 9]));
    expect(scan.anomalies).toEqual([]);
  });

  it("fires once the same multiple clears the absolute floor", () => {
    const scan = scanCostAnomalies(series([50, 50, 50, 50, 50, 50, 50, 450]));
    expect(scan.anomalies).toHaveLength(1);
    expect(scan.anomalies[0]?.costCents).toBe(450);
  });

  it("honours an overridden floor", () => {
    const scan = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 1000]), {
      minAbsoluteCents: 5000,
    });
    expect(scan.anomalies).toEqual([]);
  });
});

describe("scanCostAnomalies — baseline handling", () => {
  it("claims nothing until there are enough fully-observed prior buckets", () => {
    // Two prior buckets against a minimum of three.
    const scan = scanCostAnomalies(series([100, 100, 9999]));
    expect(scan.anomalies).toEqual([]);
    expect(scan.skipped.insufficientBaseline).toBe(3);
    expect(scan.evaluated).toBe(0);
  });

  it("uses the MEDIAN so one spike cannot mask the next", () => {
    // A mean baseline over [100,100,100,100,100,100,5000] is ~800, which would
    // hide the 1500c day that follows. The median is 100, so it does not.
    const scan = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 5000, 1500]));
    const last = scan.anomalies.find((a) => a.bucketKey === "2026-07-08");

    expect(last).toBeDefined();
    expect(last?.baselineCents).toBe(100);
  });

  it("reports a zero baseline as new spend rather than an infinite ratio", () => {
    const scan = scanCostAnomalies(series([0, 0, 0, 0, 0, 0, 0, 750]));

    expect(scan.anomalies).toHaveLength(1);
    expect(scan.anomalies[0]).toMatchObject({
      reason: "new-spend",
      baselineCents: 0,
      ratioBps: null,
      severity: "elevated",
    });
    expect(Number.isFinite(scan.anomalies[0]?.costCents ?? NaN)).toBe(true);
  });

  it("grades severity by the severe factor", () => {
    const elevated = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 400]));
    const severe = scanCostAnomalies(series([100, 100, 100, 100, 100, 100, 100, 600]));

    expect(elevated.anomalies[0]?.severity).toBe("elevated");
    expect(severe.anomalies[0]?.severity).toBe("severe");
  });
});

describe("scanCostAnomalies — partial buckets", () => {
  it("never judges a bucket that is not fully observed", () => {
    // The final bucket is in progress and holds a spike-sized number already.
    const scan = scanCostAnomalies(
      series(
        [100, 100, 100, 100, 100, 100, 100, 9999],
        [false, false, false, false, false, false, false, true],
      ),
    );

    expect(scan.anomalies).toEqual([]);
    expect(scan.skipped.partialBucket).toBe(1);
  });

  it("excludes partial buckets from the baseline", () => {
    // Four clipped buckets read as 0c. Counted, they would drag the median to
    // zero and turn an ordinary 250c day into a "new spend" anomaly. Excluded,
    // the baseline is the 100c the three observed buckets actually show, and
    // 250c is under the 3x threshold.
    const partialFlags = [false, false, false, true, true, true, true, false];
    const scan = scanCostAnomalies(series([100, 100, 100, 0, 0, 0, 0, 250], partialFlags));

    expect(scan.anomalies).toEqual([]);
    expect(scan.skipped.partialBucket).toBe(4);
  });
});

describe("describeAnomalyRule", () => {
  it("states the threshold, the floor and the direction in words", () => {
    const text = describeAnomalyRule(DEFAULT_AI_COST_ANOMALY_RULE, "day");

    expect(text).toContain("3x");
    expect(text).toContain("$1.00");
    expect(text).toContain("high is bad");
  });

  it("is echoed on every scan so the page cannot print a stale rule", () => {
    const scan = scanCostAnomalies(series([100]), { factor: 4 }, "week");

    expect(scan.rule.factor).toBe(4);
    expect(scan.rule.direction).toBe("high-is-bad");
    expect(scan.rule.description).toContain("4x");
    expect(scan.rule.description).toContain("week");
  });
});
