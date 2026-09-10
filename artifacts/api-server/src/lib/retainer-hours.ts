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
 *
 * ── Anniversary-based periods (Git #3473) ───────────────────────────────────
 * Periods used to key on the shared calendar month ("YYYY-MM"), which reset
 * every customer's retainer on the 1st regardless of when their own Stripe
 * billing cycle actually started. That was a real, confirmed bug. Periods now
 * key on each customer's own real cycle boundary: every period function below
 * takes an `anchorDay` (1-31 — the day-of-month `tenant_subscriptions
 * .currentPeriodStart` falls on for that customer; see
 * `../lib/retainer-period-anchor.ts` for how that's resolved) and a period's
 * `key` is the ISO "YYYY-MM-DD" of ITS OWN start date, not a shared "YYYY-MM"
 * label. A short month clamps the anchor day to that month's real last day
 * (day 31 in February lands on the 28th/29th), matching how Stripe itself
 * anchors monthly subscriptions.
 *
 * Flagged, not solved (per #3473's own stated scope): if a customer's anchor
 * day itself changes mid-history (a plan swap that shifts
 * `currentPeriodStart`'s day-of-month), period keys logged under the OLD
 * anchor day won't line up with keys `periodKeyBefore`/`periodKeyAfter`
 * compute under the NEW one, and rollover across that transition will be
 * imprecise. No real historical data exists yet (Shane confirmed the ledger
 * is agent-test data only, cleared as part of #3473), so this has zero
 * present impact — it's recorded here rather than guessed at.
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

/** "YYYY-MM-DD" for a Date, in UTC. The building block period keys are made of. */
export function isoDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDateKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return { year: y, month: (Number.isFinite(m) ? m : 1) - 1, day: Number.isFinite(d) ? d : 1 };
}

/**
 * `anchorDay` (1-31) placed into a given UTC year/month, clamped to that
 * month's real last day. day 31 in February → the 28th (or 29th). Matches how
 * Stripe itself anchors a monthly subscription on a short month.
 */
function anchorDateInMonth(anchorDay: number, year: number, monthIndex0: number): Date {
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, anchorDay), daysInMonth);
  return new Date(Date.UTC(year, monthIndex0, day));
}

/**
 * The anniversary-period key covering `date`: the ISO "YYYY-MM-DD" of that
 * period's OWN start date, anchored on `anchorDay`. Replaces the old shared
 * calendar "YYYY-MM" keying (Git #3473) — see the module doc above.
 */
export function periodKeyOf(anchorDay: number, date: Date): string {
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  let start = anchorDateInMonth(anchorDay, year, month);
  if (date.getTime() < start.getTime()) {
    // Before this month's anchor day → the covering period actually started
    // last month.
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    start = anchorDateInMonth(anchorDay, year, month);
  }
  return isoDateKey(start);
}

/** The previous anniversary-period key, same anchor. */
export function periodKeyBefore(anchorDay: number, key: string): string {
  const { year, month } = parseIsoDateKey(key);
  let y = year;
  let m = month - 1;
  if (m < 0) {
    m = 11;
    y -= 1;
  }
  return isoDateKey(anchorDateInMonth(anchorDay, y, m));
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
  /** ISO "YYYY-MM-DD" of THIS period's own anniversary start date (Git #3473). */
  readonly period: string;
  /** This period's allotment, in minutes. */
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
 * `usedByPeriod` maps a period key (see `periodKeyOf`) → minutes used that
 * period. `retainedMinutes` is held constant across periods (the settings'
 * current allotment); a customer who changes bands mid-history is a rare
 * enough case that per-period allotment history is deliberately out of scope
 * here — noted, not silently assumed.
 *
 * `anchorDay` (1-31) is the customer's real cycle anchor (Git #3473) — it's
 * how the walk steps from one period key to the next via `periodKeyAfter`,
 * so the walk follows THIS customer's own cycle boundaries, not a shared
 * calendar month.
 *
 * Verified against the design's own headline figures: July retained 8h, used 6h
 * → 2h roll into August; August retained 8h + rolled 2h − used 5.5h = 4.5h
 * remaining. (retainerData.ts RET_HOURS = { retained: 8, rolled: 2, used: 5.5 }.)
 */
export function computeMonthBucket(
  anchorDay: number,
  targetPeriod: string,
  retainedMinutes: number,
  usedByPeriod: ReadonlyMap<string, number>,
): MonthBucket {
  // Walk forward from the earliest period with activity (or the target itself),
  // carrying `rolled` one period at a time. Bounded to at most 24 periods back
  // so a stray far-past row can't make this loop unbounded.
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
    cursor = periodKeyAfter(anchorDay, cursor);
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

/** The next anniversary-period key, same anchor. */
export function periodKeyAfter(anchorDay: number, key: string): string {
  const { year, month } = parseIsoDateKey(key);
  let y = year;
  let m = month + 1;
  if (m > 11) {
    m = 0;
    y += 1;
  }
  return isoDateKey(anchorDateInMonth(anchorDay, y, m));
}

/** Sum minutes by period key from a list of ledger rows. */
export function usedMinutesByPeriod(
  rows: ReadonlyArray<{ periodMonth: string; minutes: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.periodMonth, (out.get(r.periodMonth) ?? 0) + (r.minutes ?? 0));
  }
  return out;
}
