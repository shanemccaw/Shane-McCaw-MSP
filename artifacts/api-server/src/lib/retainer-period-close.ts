/**
 * retainer-period-close.ts — pure period-close rules for the retainer ledger (Git #4020).
 *
 * The MSP Console operator route (`routes/msp-retainer.ts`) closes an
 * anniversary billing period by writing a `retainer_period_closes` row that
 * freezes the bucket `computeMonthBucket` produced at that moment. These
 * helpers decide which period keys are real, whether a period has ended, and
 * turn a stored snapshot back into the same `MonthBucket` shape — built only on
 * `./retainer-hours.ts`'s own period functions, never a second copy of the math.
 *
 * Dependency-free (no db, no logger), like `retainer-hours.ts`, so it is
 * unit-testable without a database.
 */

import { periodKeyOf, periodKeyAfter, type MonthBucket } from "./retainer-hours.ts";

const ISO_DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `key` is a genuine period start under `anchorDay` — i.e. the key a
 * ledger row logged today would actually carry. Rejects malformed strings,
 * impossible dates ("2026-02-30"), and real dates that aren't this customer's
 * anniversary boundary.
 */
export function isPeriodKeyForAnchor(anchorDay: number, key: string): boolean {
  if (!ISO_DATE_KEY.test(key)) return false;
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return periodKeyOf(anchorDay, date) === key;
}

/** The instant a period ends: the start of the next anniversary period, UTC midnight. */
export function periodEndsAt(anchorDay: number, key: string): Date {
  return new Date(`${periodKeyAfter(anchorDay, key)}T00:00:00Z`);
}

/** A period can only be closed once it has fully ended — never mid-period, never in the future. */
export function periodHasEnded(anchorDay: number, key: string, now: Date): boolean {
  return periodEndsAt(anchorDay, key).getTime() <= now.getTime();
}

/**
 * Every period worth summarising for one customer: the current period, every
 * period with ledger activity, and every closed period. Newest first, no duplicates.
 */
export function summaryPeriodKeys(
  currentKey: string,
  entryKeys: Iterable<string>,
  closedKeys: Iterable<string>,
): string[] {
  return [...new Set([currentKey, ...entryKeys, ...closedKeys])].sort().reverse();
}

/** The stored columns a close snapshot carries. */
export interface PeriodCloseSnapshotRow {
  readonly periodKey: string;
  readonly retainedMinutes: number;
  readonly rolledMinutes: number;
  readonly usedMinutes: number;
  readonly remainingMinutes: number;
  readonly overMinutes: number;
}

/** A stored close snapshot → the `MonthBucket` shape, so it goes through the same wire mapper as a live bucket. */
export function bucketFromCloseSnapshot(row: PeriodCloseSnapshotRow): MonthBucket {
  return {
    period: row.periodKey,
    retainedMinutes: row.retainedMinutes,
    rolledMinutes: row.rolledMinutes,
    usedMinutes: row.usedMinutes,
    remainingMinutes: row.remainingMinutes,
    overMinutes: row.overMinutes,
  };
}
