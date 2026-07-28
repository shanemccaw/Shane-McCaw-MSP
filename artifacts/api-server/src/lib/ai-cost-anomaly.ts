// artifacts/api-server/src/lib/ai-cost-anomaly.ts
//
// Anomaly detection for AI spend (initiative: ai-cost-governance-billing-rollup,
// Phase 4 / Issue #52).
//
// Pure module: no DB access, no logging, no side effects. It takes an ordered
// series of cost buckets and returns the ones the stated rule flags, along with
// the rule that produced them, so the reader of the AI Billing page sees the
// threshold rather than a black box.
//
// ── DIRECTION: HIGH IS BAD ───────────────────────────────────────────────────
//
// For AI cost, a HIGH number is the alarm. Spend rising sharply above its own
// recent baseline is the thing worth waking up for; spend falling is not an
// anomaly this module reports, at any magnitude.
//
// This is stated explicitly, exported as AI_COST_ANOMALY_DIRECTION, and covered
// by a dedicated "a large DROP never fires" test, because this repo has been
// bitten by threshold rules that encoded the wrong direction — rules written to
// fire on a high count in cases where a ZERO count was the real alarm. The
// direction is a property of the metric, not of the comparison operator that
// happened to get typed, so it is recorded next to the rule it governs.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
//
// A bucket is flagged when ALL of these hold:
//
//   1. The bucket is FULLY OBSERVED (`partial === false`). An in-progress
//      period, or one clipped by a row-scan limit, is understated by
//      construction; comparing it to a full-period baseline would systematically
//      under-fire, which for a high-is-bad metric means missing real overruns.
//   2. There are at least `minBaselineBuckets` fully-observed buckets in the
//      preceding `baselineBuckets` window. With fewer, there is no baseline, so
//      nothing is claimed — the first data point of a new deployment is not an
//      anomaly.
//   3. The bucket's spend is at least `minAbsoluteCents`. Without this floor,
//      $0.02 rising to $0.09 is a 4.5x "spike" and the page becomes noise.
//   4. Either
//        a. the baseline is > 0 and spend >= baseline * factor  → "above-baseline"
//        b. the baseline is 0                                   → "new-spend"
//      Case (b) is separated because a ratio against zero is undefined; calling
//      it "new-spend" says what actually happened (a bucket that historically
//      cost nothing started costing money) instead of reporting Infinity.
//
// The baseline is the MEDIAN of the prior window, not the mean. With a mean, one
// spike lifts the baseline enough to hide the next one — exactly the sustained
// overrun this initiative exists to catch.

/** One bucket of spend, as produced by ai-billing-analytics.ts's time series. */
export interface CostBucketPoint {
  bucketKey: string;
  bucketStart: string;
  costCents: number;
  /** True when the bucket's data is not fully observed (in progress, or clipped). */
  partial: boolean;
}

/**
 * The direction of the alarm for this metric, encoded as data rather than left
 * implicit in a `>` somewhere. For cost, high is bad.
 */
export const AI_COST_ANOMALY_DIRECTION = "high-is-bad" as const;
export type AiCostAnomalyDirection = typeof AI_COST_ANOMALY_DIRECTION;

export interface AiCostAnomalyRule {
  /** How many preceding buckets the baseline is drawn from. */
  baselineBuckets: number;
  /** Fully-observed buckets required in that window before anything is claimed. */
  minBaselineBuckets: number;
  /** Multiple of the baseline that constitutes an anomaly. */
  factor: number;
  /** Multiple of the baseline at which the anomaly is called "severe". */
  severeFactor: number;
  /** Spend floor, in integer cents, below which nothing is ever flagged. */
  minAbsoluteCents: number;
}

export const DEFAULT_AI_COST_ANOMALY_RULE: AiCostAnomalyRule = {
  baselineBuckets: 7,
  minBaselineBuckets: 3,
  factor: 3,
  severeFactor: 6,
  minAbsoluteCents: 100,
};

export type AnomalySeverity = "elevated" | "severe";
export type AnomalyReason = "above-baseline" | "new-spend";

export interface AiCostAnomaly {
  bucketKey: string;
  bucketStart: string;
  costCents: number;
  /** Median of the prior fully-observed buckets, in integer cents. */
  baselineCents: number;
  /**
   * cost / baseline in basis points (30000 = 3.00x). Null when the baseline is
   * zero, where the ratio is undefined — never Infinity, never a fabricated 0.
   */
  ratioBps: number | null;
  severity: AnomalySeverity;
  reason: AnomalyReason;
}

export interface AiCostAnomalyScan {
  /** The rule as applied, echoed so the UI can state it verbatim. */
  rule: AiCostAnomalyRule & {
    direction: AiCostAnomalyDirection;
    description: string;
  };
  anomalies: AiCostAnomaly[];
  /** Buckets the rule actually got to test. */
  evaluated: number;
  /** Buckets it deliberately did not test, and why — never silently dropped. */
  skipped: {
    partialBucket: number;
    insufficientBaseline: number;
  };
}

/** Median of a non-empty list of integer cents, rounded back to integer cents. */
function medianCents(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const raw =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(raw);
}

/** Render the active rule as one sentence the page can print for the reader. */
export function describeAnomalyRule(rule: AiCostAnomalyRule, bucketNoun: string): string {
  const floor = (rule.minAbsoluteCents / 100).toFixed(2);
  return (
    `Flags a ${bucketNoun} whose spend is at least ${rule.factor}x the median of the ` +
    `previous ${rule.baselineBuckets} fully-observed ${bucketNoun}s (minimum ` +
    `${rule.minBaselineBuckets}) and is at least $${floor}. ` +
    `${rule.severeFactor}x or more is "severe". A ${bucketNoun} with no prior spend ` +
    `that crosses the $${floor} floor is flagged as new spend. ` +
    `Direction: high is bad — a fall in spend never flags, and an in-progress ` +
    `${bucketNoun} is not judged against complete ones.`
  );
}

/**
 * Apply the rule to an ordered series (oldest bucket first).
 *
 * The caller owns bucketing and the `partial` flag; this function only decides
 * what is anomalous, so it is testable against fixtures with no clock, no
 * timezone and no database involved.
 */
export function scanCostAnomalies(
  points: readonly CostBucketPoint[],
  overrides: Partial<AiCostAnomalyRule> = {},
  bucketNoun = "period",
): AiCostAnomalyScan {
  const rule: AiCostAnomalyRule = { ...DEFAULT_AI_COST_ANOMALY_RULE, ...overrides };
  const anomalies: AiCostAnomaly[] = [];
  let evaluated = 0;
  let partialBucket = 0;
  let insufficientBaseline = 0;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] as CostBucketPoint;

    if (point.partial) {
      partialBucket += 1;
      continue;
    }

    // Baseline: the fully-observed buckets among the preceding `baselineBuckets`.
    // Partial buckets are excluded rather than counted as low — including an
    // understated bucket would drag the baseline down and manufacture a spike.
    const priorCosts = points
      .slice(Math.max(0, i - rule.baselineBuckets), i)
      .filter((p) => !p.partial)
      .map((p) => p.costCents);

    if (priorCosts.length < rule.minBaselineBuckets) {
      insufficientBaseline += 1;
      continue;
    }

    evaluated += 1;

    // Floor first: a rise from nearly nothing to nearly nothing is not news,
    // however large the multiple looks.
    if (point.costCents < rule.minAbsoluteCents) continue;

    const baselineCents = medianCents(priorCosts);

    if (baselineCents <= 0) {
      anomalies.push({
        bucketKey: point.bucketKey,
        bucketStart: point.bucketStart,
        costCents: point.costCents,
        baselineCents: 0,
        ratioBps: null,
        severity: "elevated",
        reason: "new-spend",
      });
      continue;
    }

    // The one comparison that encodes the direction: only spend ABOVE the
    // baseline fires. There is deliberately no lower-bound branch.
    if (point.costCents < baselineCents * rule.factor) continue;

    anomalies.push({
      bucketKey: point.bucketKey,
      bucketStart: point.bucketStart,
      costCents: point.costCents,
      baselineCents,
      ratioBps: Math.round((point.costCents * 10_000) / baselineCents),
      severity:
        point.costCents >= baselineCents * rule.severeFactor ? "severe" : "elevated",
      reason: "above-baseline",
    });
  }

  return {
    rule: {
      ...rule,
      direction: AI_COST_ANOMALY_DIRECTION,
      description: describeAnomalyRule(rule, bucketNoun),
    },
    anomalies,
    evaluated,
    skipped: { partialBucket, insufficientBaseline },
  };
}
