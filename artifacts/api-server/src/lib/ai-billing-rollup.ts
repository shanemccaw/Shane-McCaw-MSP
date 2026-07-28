// artifacts/api-server/src/lib/ai-billing-rollup.ts
//
// Pure helpers backing the PlatformAdmin AI Billing surface
// (routes/admin-ai-billing.ts, initiative: ai-cost-governance-billing-rollup,
// Phase 3 / Issue #51). Kept out of the route file so the date-boundary and
// rollup logic is unit-testable without an express + drizzle mock harness.
//
// No DB access, no logging, no side effects — everything here is a pure
// function over values the route already has in hand.

export const AI_BILLING_RANGES = ["today", "month"] as const;
export type AiBillingRange = (typeof AI_BILLING_RANGES)[number];

export interface RangeBounds {
  /** Inclusive lower bound (UTC instant). */
  start: Date;
  /** Exclusive upper bound (UTC instant). */
  end: Date;
}

/**
 * Resolve the [start, end) instants for a "today" or "month" range, expressed
 * in the VIEWER's local day rather than UTC.
 *
 * `tzOffsetMinutes` is exactly what `Date.prototype.getTimezoneOffset()`
 * returns in the browser: minutes to ADD to local time to reach UTC (US
 * Eastern in summer = 240). The client sends its own offset so the status
 * bar's "Today" rolls over at the viewer's midnight, not UTC's — otherwise a
 * US-based admin would watch "Today" reset at 8pm.
 *
 * Deliberate limitation: this treats the offset as FIXED for the whole range.
 * A month that straddles a DST transition is therefore off by an hour at one
 * edge. That is accepted here — the alternative is a full tz database for a
 * status-bar total — but it is a real (small) inaccuracy, not a rounding
 * artifact, so it is stated rather than hidden.
 *
 * An out-of-band or non-finite offset falls back to 0 (UTC) rather than
 * producing garbage bounds.
 */
export function resolveRangeBounds(
  range: AiBillingRange,
  tzOffsetMinutes = 0,
  now: Date = new Date(),
): RangeBounds {
  const off = Number.isFinite(tzOffsetMinutes) && Math.abs(tzOffsetMinutes) <= 14 * 60
    ? Math.trunc(tzOffsetMinutes)
    : 0;
  const offMs = off * 60_000;

  // Shift the instant so its UTC calendar fields read as the viewer's local
  // wall clock, then read the day/month off those fields.
  const shifted = new Date(now.getTime() - offMs);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  if (range === "today") {
    const start = Date.UTC(y, m, d) + offMs;
    return { start: new Date(start), end: new Date(start + 86_400_000) };
  }
  return {
    start: new Date(Date.UTC(y, m, 1) + offMs),
    end: new Date(Date.UTC(y, m + 1, 1) + offMs),
  };
}

/** Parse an untrusted `range` query param, defaulting to "today". */
export function parseRange(raw: unknown): AiBillingRange {
  return raw === "month" ? "month" : "today";
}

/** Parse an untrusted timezone-offset query param (minutes). */
export function parseTzOffsetMinutes(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse an untrusted integer query param, clamped to [min, max].
 * Returns `fallback` for anything non-numeric.
 */
export function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Parse an untrusted id query param — a positive integer, or null. */
export function parseIdParam(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse an untrusted ISO date/datetime query param, or null when unusable. */
export function parseDateParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface RollupBucket<K> {
  key: K;
  costCents: number;
  eventCount: number;
}

/**
 * Group rows into { key, costCents, eventCount } buckets, sorted by cost
 * descending (ties broken by event count, then by key, so the ordering is
 * stable across calls with identical data).
 *
 * Used for the summary endpoint's by-cost-owner / by-MSP / by-feature
 * breakdowns. Grouping happens here rather than in SQL because the summary
 * already reads the period's rows once for the total, and re-querying three
 * more times with GROUP BY would cost three extra round trips to compute
 * numbers that must sum to the same total anyway — this way the breakdowns
 * cannot disagree with the headline figure.
 */
export function rollupBy<T, K extends string | number>(
  rows: readonly T[],
  keyOf: (row: T) => K,
  costOf: (row: T) => number,
): RollupBucket<K>[] {
  const buckets = new Map<K, RollupBucket<K>>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = buckets.get(key);
    if (existing) {
      existing.costCents += costOf(row);
      existing.eventCount += 1;
    } else {
      buckets.set(key, { key, costCents: costOf(row), eventCount: 1 });
    }
  }
  return [...buckets.values()].sort(
    (a, b) =>
      b.costCents - a.costCents ||
      b.eventCount - a.eventCount ||
      String(a.key).localeCompare(String(b.key)),
  );
}
