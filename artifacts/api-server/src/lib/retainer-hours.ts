/**
 * retainer-hours.ts — the retainer ledger's pure domain logic.
 *
 * The real source for the customer-facing "My Architect" retainer page
 * (Git #1285/#1293). Everything here is pure and unit-tested (retainer-hours
 * .test.ts) — the route (`routes/admin-retainer.ts`) and the byproduct hooks
 * only ever read/write rows and call these helpers, never re-implement the
 * arithmetic.
 *
 * Hours are integer MINUTES throughout (30 = 0.5h). Display conversion to a
 * decimal-hours number happens once, in `minutesToHours`.
 *
 * This module is intentionally dependency-free (no logger, no db) so its
 * arithmetic is unit-testable without provisioning a database.
 */

/** Stored lowercase; the customer page's display vocabulary. */
export const RETAINER_STATE_DISPLAY: Record<string, string> = {
  in_progress: "In progress",
  closed: "Closed",
  in_review: "In review",
  scheduled: "Scheduled",
};

/**
 * Pillar → identity colour, matching the customer page's own inline values
 * (msp-portal retainerData.ts RET_WORK). Kept here so the admin ledger stamps
 * the same colour the customer page renders, instead of each side inventing one.
 */
export const RETAINER_PILLAR_COLORS: Record<string, string> = {
  Health: "#22C55E",
  Compliance: "#E2E8F0",
  Governance: "#3B82F6",
  Security: "#8B5CF6",
  Adoption: "#F97316",
};

export function pillarColor(pillar: string | null | undefined): string {
  if (!pillar) return "#E2E8F0";
  return RETAINER_PILLAR_COLORS[pillar] ?? "#E2E8F0";
}

/** Minutes → hours, rounded to one decimal (0.5h granularity, never per-minute). */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/** Hours (a decimal like 1.5) → integer minutes, clamped non-negative. */
export function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) return 0;
  return Math.round(hours * 60);
}

/** "YYYY-MM" for a Date, in the given timezone offset (default UTC). */
export function periodMonthOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** The previous "YYYY-MM" bucket. periodBefore("2026-01") === "2025-12". */
export function periodBefore(period: string): string {
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return periodMonthOf(d);
}

/**
 * ISO-8601 week label, e.g. "W34". The customer page groups the log by these.
 */
export function isoWeekLabel(date: Date): string {
  // ISO week: Thursday of the current week decides the year/week number.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // to the Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `W${week}`;
}

export interface MonthBucket {
  /** "YYYY-MM" */
  readonly period: string;
  /** This month's allotment, in minutes. */
  readonly retainedMinutes: number;
  /** Unused RETAINED minutes carried from last month (rolled once, then expire). */
  readonly rolledMinutes: number;
  /** Minutes consumed this month (sum of the log) — the honest, uncapped "delivered" figure. */
  readonly usedMinutes: number;
  /** retained + rolled − used, floored at 0. This is a leftover BALANCE, never negative. */
  readonly remainingMinutes: number;
  /**
   * used − (retained + rolled), floored at 0. Over-month is a normal state, not an
   * error — this is the honest, UNCAPPED amount delivered beyond what was retained,
   * so a consumer can render "10h retained · 12h delivered" (2h over) without
   * inferring the state from `remainingMinutes === 0`, which is also true for a
   * customer who used exactly their allotment (not over).
   */
  readonly overMinutes: number;
}

/**
 * The rollover model, matching RET_TERMS: "Unused hours roll forward one month,
 * then expire." Consumption is ROLLED-FIRST (spend the expiring hours before the
 * fresh allotment), so the amount that can roll into the next month is the
 * unused portion of THIS month's retained allotment only — last month's rolled
 * hours that go unused simply expire, they never roll a second time.
 *
 *   rolled(M)    = max(0, retained(M-1) − max(0, used(M-1) − rolled(M-1)))
 *   remaining(M) = max(0, retained(M) + rolled(M) − used(M))
 *
 * `usedByPeriod` maps "YYYY-MM" → minutes used that month. `retainedMinutes` is
 * held constant across months (the settings' current allotment); a customer who
 * changes bands mid-history is a rare enough case that per-month allotment
 * history is deliberately out of scope here — noted, not silently assumed.
 *
 * Verified against the design's own headline figures: July retained 8h, used 6h
 * → 2h roll into August; August retained 8h + rolled 2h − used 5.5h = 4.5h
 * remaining. (retainerData.ts RET_HOURS = { retained: 8, rolled: 2, used: 5.5 }.)
 */
export function computeMonthBucket(
  targetPeriod: string,
  retainedMinutes: number,
  usedByPeriod: ReadonlyMap<string, number>,
): MonthBucket {
  // Walk forward from the earliest month with activity (or the target itself),
  // carrying `rolled` one month at a time. Bounded to at most 24 months back so
  // a stray far-past row can't make this loop unbounded.
  const periods = [...usedByPeriod.keys()].filter((p) => p <= targetPeriod).sort();
  const start = periods.length > 0 && periods[0] < targetPeriod ? periods[0] : targetPeriod;

  let cursor = start;
  let prevRetained = 0;
  let prevRolled = 0;
  let prevUsed = 0;
  let guard = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rolled = Math.max(0, prevRetained - Math.max(0, prevUsed - prevRolled));
    const used = usedByPeriod.get(cursor) ?? 0;
    if (cursor === targetPeriod) {
      return {
        period: targetPeriod,
        retainedMinutes,
        rolledMinutes: rolled,
        usedMinutes: used,
        remainingMinutes: Math.max(0, retainedMinutes + rolled - used),
        overMinutes: Math.max(0, used - (retainedMinutes + rolled)),
      };
    }
    prevRetained = retainedMinutes;
    prevRolled = rolled;
    prevUsed = used;
    cursor = periodAfter(cursor);
    if (++guard > 240) {
      // Unreachable in practice; a safety valve, not a real path.
      const usedGuard = usedByPeriod.get(targetPeriod) ?? 0;
      return {
        period: targetPeriod,
        retainedMinutes,
        rolledMinutes: 0,
        usedMinutes: usedGuard,
        remainingMinutes: Math.max(0, retainedMinutes - usedGuard),
        overMinutes: Math.max(0, usedGuard - retainedMinutes),
      };
    }
  }
}

/** The next "YYYY-MM" bucket. periodAfter("2025-12") === "2026-01". */
export function periodAfter(period: string): string {
  const [y, m] = period.split("-").map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return periodMonthOf(d);
}

/** Sum minutes by "YYYY-MM" from a list of ledger rows. */
export function usedMinutesByPeriod(
  rows: ReadonlyArray<{ periodMonth: string; minutes: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.periodMonth, (out.get(r.periodMonth) ?? 0) + (r.minutes ?? 0));
  }
  return out;
}
