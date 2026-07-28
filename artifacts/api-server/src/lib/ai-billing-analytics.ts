// artifacts/api-server/src/lib/ai-billing-analytics.ts
//
// Trend bucketing and dimension rollups for the AI Billing analytics layer
// (initiative: ai-cost-governance-billing-rollup, Phase 4 / Issue #52).
//
// Pure module, in the same spirit as ai-billing-rollup.ts (Phase 3): everything
// here is a function over values the route already has in hand, so the calendar
// arithmetic and the attribution rules are unit-testable without an express +
// drizzle harness and without a live database.
//
// Two jobs:
//
//   1. bucketTimeSeries() — turn raw usage rows into a gapless, viewer-local
//      day/week/month series. Gapless matters: a quiet day must appear as a real
//      $0.00 bucket, not vanish. A missing bucket would both compress the chart's
//      time axis and remove a genuine zero from the anomaly baseline, making the
//      next real spike look smaller than it is.
//
//   2. rollupDimension() — cost per customer / per MSP / per document type, with
//      rows that carry no attribution reported SEPARATELY as `unattributed`
//      rather than folded into a named bucket. A NULL customerId is not
//      "Customer 0" and it is not the platform's own spend; it is a call whose
//      customer we do not know, and a cost-per-customer view that quietly buries
//      it would overstate how well attributed the spend actually is.
//
// All money is integer cents end to end. No currency formatting happens here.

import type { CostBucketPoint } from "./ai-cost-anomaly.ts";

// ── Buckets ──────────────────────────────────────────────────────────────────

export const TREND_BUCKETS = ["day", "week", "month"] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

/** Parse an untrusted `bucket` query param, defaulting to "day". */
export function parseTrendBucket(raw: unknown): TrendBucket {
  return raw === "week" || raw === "month" ? raw : "day";
}

/**
 * Upper bound on how many buckets may be requested, per bucket size. These are
 * chosen so every option covers a comparable span (roughly six months to two
 * years) without letting a single request ask for an unbounded window.
 */
export const MAX_BUCKET_COUNT: Record<TrendBucket, number> = {
  day: 180,
  week: 104,
  month: 36,
};

export const DEFAULT_BUCKET_COUNT: Record<TrendBucket, number> = {
  day: 30,
  week: 26,
  month: 12,
};

/** Human noun for the bucket size, used when stating the anomaly rule. */
export const BUCKET_NOUN: Record<TrendBucket, string> = {
  day: "day",
  week: "week",
  month: "month",
};

/**
 * Normalise a timezone offset the same way Phase 3's resolveRangeBounds does:
 * minutes to ADD to local time to reach UTC (US Eastern in summer = 240), with
 * anything out of band or non-finite falling back to UTC rather than producing
 * garbage bounds.
 *
 * Same deliberate limitation as Phase 3: the offset is treated as FIXED across
 * the whole window, so a window straddling a DST transition is off by an hour at
 * one edge. Stated, not hidden.
 */
function normaliseOffsetMs(tzOffsetMinutes: number): number {
  const off =
    Number.isFinite(tzOffsetMinutes) && Math.abs(tzOffsetMinutes) <= 14 * 60
      ? Math.trunc(tzOffsetMinutes)
      : 0;
  return off * 60_000;
}

/** Viewer-local calendar fields of an instant. */
function localFields(ms: number, offMs: number) {
  const shifted = new Date(ms - offMs);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

/** UTC instant at which the viewer-local bucket containing `ms` begins. */
export function bucketStartMs(ms: number, bucket: TrendBucket, offMs: number): number {
  const { y, m, d, dow } = localFields(ms, offMs);
  if (bucket === "month") return Date.UTC(y, m, 1) + offMs;
  if (bucket === "week") {
    // ISO weeks start Monday; getUTCDay() puts Sunday at 0.
    const backToMonday = (dow + 6) % 7;
    return Date.UTC(y, m, d - backToMonday) + offMs;
  }
  return Date.UTC(y, m, d) + offMs;
}

/** UTC instant at which the bucket starting at `startMs` ends (exclusive). */
export function nextBucketStartMs(
  startMs: number,
  bucket: TrendBucket,
  offMs: number,
): number {
  if (bucket === "month") {
    const { y, m } = localFields(startMs, offMs);
    return Date.UTC(y, m + 1, 1) + offMs;
  }
  return startMs + (bucket === "week" ? 7 : 1) * 86_400_000;
}

/** UTC instant at which the bucket starting at `startMs` began (its predecessor). */
function prevBucketStartMs(startMs: number, bucket: TrendBucket, offMs: number): number {
  if (bucket === "month") {
    const { y, m } = localFields(startMs, offMs);
    return Date.UTC(y, m - 1, 1) + offMs;
  }
  return startMs - (bucket === "week" ? 7 : 1) * 86_400_000;
}

/** Stable label for a bucket: "YYYY-MM-DD" for day/week starts, "YYYY-MM" for months. */
export function bucketKeyOf(startMs: number, bucket: TrendBucket, offMs: number): string {
  const { y, m, d } = localFields(startMs, offMs);
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m + 1).padStart(2, "0");
  if (bucket === "month") return `${yyyy}-${mm}`;
  return `${yyyy}-${mm}-${String(d).padStart(2, "0")}`;
}

export interface TrendWindow {
  /** Inclusive lower bound (UTC instant), snapped to a bucket boundary. */
  start: Date;
  /** Exclusive upper bound (UTC instant), the end of the in-progress bucket. */
  end: Date;
}

/**
 * Resolve the [start, end) window covering `bucketCount` buckets ending with the
 * one currently in progress.
 *
 * The window is snapped to bucket boundaries at both ends. A window that began
 * mid-bucket would open the chart on an artificially small bar, which for a
 * high-is-bad metric reads as "spend was low then and has climbed" — an artifact
 * of where the window was cut, not a fact about spend.
 */
export function resolveTrendWindow(
  bucket: TrendBucket,
  bucketCount: number,
  tzOffsetMinutes = 0,
  now: Date = new Date(),
): TrendWindow {
  const offMs = normaliseOffsetMs(tzOffsetMinutes);
  const count = Math.min(
    MAX_BUCKET_COUNT[bucket],
    Math.max(1, Math.trunc(Number.isFinite(bucketCount) ? bucketCount : 1)),
  );

  const currentStart = bucketStartMs(now.getTime(), bucket, offMs);
  let startMs = currentStart;
  for (let i = 1; i < count; i += 1) {
    startMs = prevBucketStartMs(startMs, bucket, offMs);
  }

  return {
    start: new Date(startMs),
    end: new Date(nextBucketStartMs(currentStart, bucket, offMs)),
  };
}

/** Parse an untrusted bucket-count param against that bucket size's own bounds. */
export function parseBucketCount(raw: unknown, bucket: TrendBucket): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_BUCKET_COUNT[bucket];
  return Math.min(MAX_BUCKET_COUNT[bucket], Math.max(1, Math.trunc(n)));
}

// ── Time series ──────────────────────────────────────────────────────────────

/** The columns of a usage row that the time series needs. */
export interface TrendInputRow {
  occurredAt: Date | string | null;
  costCents: number | null;
}

export interface TrendPoint extends CostBucketPoint {
  eventCount: number;
}

function toMs(value: Date | string | null): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export interface BucketTimeSeriesOpts {
  bucket: TrendBucket;
  window: TrendWindow;
  tzOffsetMinutes?: number;
  now?: Date;
  /**
   * Earliest instant actually covered by the rows supplied. Set when the row
   * scan was clipped by a limit: buckets starting before it are only partly
   * observed, and are marked `partial` so the anomaly rule refuses to judge them
   * or to use them as a baseline. Null means the whole window was read.
   */
  observedFrom?: Date | null;
}

/**
 * Bucket rows into a gapless viewer-local series, oldest first.
 *
 * `partial` is set on any bucket whose data is not fully observed — either the
 * bucket is still in progress, or it predates `observedFrom` because the scan
 * was clipped. Both cases understate spend, so both are marked the same way and
 * excluded downstream.
 */
export function bucketTimeSeries(
  rows: readonly TrendInputRow[],
  opts: BucketTimeSeriesOpts,
): TrendPoint[] {
  const { bucket, window } = opts;
  const offMs = normaliseOffsetMs(opts.tzOffsetMinutes ?? 0);
  const nowMs = (opts.now ?? new Date()).getTime();
  const observedFromMs = opts.observedFrom ? opts.observedFrom.getTime() : null;

  const points: TrendPoint[] = [];
  const indexByStart = new Map<number, number>();

  const endMs = window.end.getTime();
  let cursor = bucketStartMs(window.start.getTime(), bucket, offMs);
  // Guard against a pathological window (e.g. end before start) spinning here.
  let guard = 0;
  while (cursor < endMs && guard < 1000) {
    const bucketEnd = nextBucketStartMs(cursor, bucket, offMs);
    indexByStart.set(cursor, points.length);
    points.push({
      bucketKey: bucketKeyOf(cursor, bucket, offMs),
      bucketStart: new Date(cursor).toISOString(),
      costCents: 0,
      eventCount: 0,
      partial:
        bucketEnd > nowMs || (observedFromMs != null && cursor < observedFromMs),
    });
    cursor = bucketEnd;
    guard += 1;
  }

  for (const row of rows) {
    const ms = toMs(row.occurredAt);
    if (ms == null || ms < window.start.getTime() || ms >= endMs) continue;
    const idx = indexByStart.get(bucketStartMs(ms, bucket, offMs));
    if (idx === undefined) continue;
    const point = points[idx] as TrendPoint;
    point.costCents += row.costCents ?? 0;
    point.eventCount += 1;
  }

  return points;
}

// ── Dimension rollups ────────────────────────────────────────────────────────

export const TREND_DIMENSIONS = ["customer", "msp", "artifactType"] as const;
export type TrendDimension = (typeof TREND_DIMENSIONS)[number];

export interface DimensionInputRow {
  costCents: number | null;
  customerId: number | null;
  customerName: string | null;
  mspId: number | null;
  mspName: string | null;
  generatedArtifactType: string | null;
}

export interface DimensionSlice {
  /** Stable key for React lists and for drill-down links. */
  key: string;
  /** Numeric id when the dimension has one, so the UI can deep-link a filter. */
  id: number | null;
  label: string;
  costCents: number;
  eventCount: number;
}

export interface DimensionRollup {
  dimension: TrendDimension;
  /** Attributed buckets only, highest cost first, capped at `limit`. */
  slices: DimensionSlice[];
  /**
   * The attributed tail beyond `limit`, folded — reported explicitly with the
   * number of buckets folded, so a capped list never reads as a complete one.
   */
  other: { costCents: number; eventCount: number; sliceCount: number };
  /**
   * Rows the dimension cannot attribute (NULL id / NULL artifact type). Kept out
   * of `slices` on purpose — see the module docblock.
   */
  unattributed: { costCents: number; eventCount: number; label: string };
  /** Attributed + other + unattributed. Always reconciles with the series total. */
  totalCostCents: number;
  eventCount: number;
}

export const DEFAULT_DIMENSION_LIMIT = 8;

interface DimensionSpec {
  /** Null return means the row is unattributed on this dimension. */
  idOf: (row: DimensionInputRow) => number | null;
  keyOf: (row: DimensionInputRow) => string | null;
  labelOf: (row: DimensionInputRow) => string;
  unattributedLabel: string;
}

const DIMENSION_SPECS: Record<TrendDimension, DimensionSpec> = {
  customer: {
    idOf: (r) => r.customerId,
    keyOf: (r) => (r.customerId == null ? null : String(r.customerId)),
    // customerId is an msp_customers.id — the same id space routes/admin-ai-billing.ts
    // joins on. This platform straddles two customer id spaces (users.id vs
    // msp_customers.id); the name is resolved by the caller's join, and falls back
    // to the id rather than to a guess when the customer row is gone.
    labelOf: (r) => r.customerName ?? `Customer ${r.customerId}`,
    unattributedLabel: "Unattributed (no customer)",
  },
  msp: {
    idOf: (r) => r.mspId,
    keyOf: (r) => (r.mspId == null ? null : String(r.mspId)),
    labelOf: (r) => r.mspName ?? `MSP ${r.mspId}`,
    unattributedLabel: "Unattributed (platform / no MSP)",
  },
  artifactType: {
    idOf: () => null,
    keyOf: (r) => {
      const t = r.generatedArtifactType?.trim();
      return t ? t : null;
    },
    labelOf: (r) => r.generatedArtifactType?.trim() ?? "",
    unattributedLabel: "Unattributed (no artifact produced)",
  },
};

/**
 * Roll rows up on one dimension.
 *
 * Sorted by cost descending, ties broken by event count then key, so the
 * ordering is stable across calls with identical data (the same rule
 * ai-billing-rollup.ts's rollupBy uses).
 */
export function rollupDimension(
  rows: readonly DimensionInputRow[],
  dimension: TrendDimension,
  limit: number = DEFAULT_DIMENSION_LIMIT,
): DimensionRollup {
  const spec = DIMENSION_SPECS[dimension];
  const buckets = new Map<string, DimensionSlice>();
  const unattributed = { costCents: 0, eventCount: 0, label: spec.unattributedLabel };
  let totalCostCents = 0;
  let eventCount = 0;

  for (const row of rows) {
    const cost = row.costCents ?? 0;
    totalCostCents += cost;
    eventCount += 1;

    const key = spec.keyOf(row);
    if (key == null) {
      unattributed.costCents += cost;
      unattributed.eventCount += 1;
      continue;
    }

    const existing = buckets.get(key);
    if (existing) {
      existing.costCents += cost;
      existing.eventCount += 1;
    } else {
      buckets.set(key, {
        key,
        id: spec.idOf(row),
        label: spec.labelOf(row),
        costCents: cost,
        eventCount: 1,
      });
    }
  }

  const sorted = [...buckets.values()].sort(
    (a, b) =>
      b.costCents - a.costCents ||
      b.eventCount - a.eventCount ||
      a.key.localeCompare(b.key),
  );

  const capped = Math.max(1, Math.trunc(limit));
  const slices = sorted.slice(0, capped);
  const tail = sorted.slice(capped);

  return {
    dimension,
    slices,
    other: {
      costCents: tail.reduce((acc, s) => acc + s.costCents, 0),
      eventCount: tail.reduce((acc, s) => acc + s.eventCount, 0),
      sliceCount: tail.length,
    },
    unattributed,
    totalCostCents,
    eventCount,
  };
}
