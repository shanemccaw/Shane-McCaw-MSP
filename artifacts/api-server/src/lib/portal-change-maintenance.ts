/**
 * portal-change-maintenance.ts — the pure derivations behind Change Control's
 * maintenance-window calendar (#1504).
 *
 * `change_maintenance_windows` is the OPPOSITE of `change_freeze_windows`
 * (#1500): a freeze window is when change is FORBIDDEN; a maintenance window
 * is when change is EXPECTED. It stores one row per STANDING rule (a one-off
 * span, or a recurring cadence anchored at `startsAt`) — same shape as the
 * freeze table, deliberately its own table (see the Drizzle schema's own
 * header on why the two are never merged).
 *
 * The scope-matching and cadence-walking math below is a parallel
 * implementation of `portal-change-freeze.ts`'s, not a shared import. Both are
 * small (~60 lines), independently unit-tested, and read the SAME event
 * ("does this span fall inside a standing calendar rule") in opposite
 * directions — freeze asks "is it inside a forbidden span", this asks "is it
 * inside a required span". A shared engine would need a "which verb"
 * parameter threaded through every call site for two products that otherwise
 * share nothing; keeping them separate keeps each one readable on its own,
 * the same trade the codebase already makes between `cr_approvals` and the
 * freeze-exception ledger rather than merging those two ideas either.
 *
 * ── Enforcement point: the change's BOOKED window, not "right now" ──────────
 * Unlike a freeze (which can also block outright at the moment of submission,
 * because a freeze is about NOW), a maintenance window only makes sense
 * against WHEN the change is actually scheduled to run
 * (`scheduled_start`/`scheduled_end`, #1762). There is no "is a maintenance
 * window active right now" check — only "does the booked span fall inside
 * one". Callers gate this on a non-null `scheduled_start`, same discipline
 * `findFreezeForBookedWindow` already follows: a change with no real instant
 * is not evaluated at all, never guessed at.
 */

import type { ChangeMaintenanceWindow } from "@workspace/db";

export const CHANGE_MAINTENANCE_SCOPES = ["global", "tenant", "workload"] as const;
export type ChangeMaintenanceScope = (typeof CHANGE_MAINTENANCE_SCOPES)[number];

export const CHANGE_MAINTENANCE_RECURRENCES = ["none", "weekly", "monthly", "quarterly", "annually"] as const;
export type ChangeMaintenanceRecurrence = (typeof CHANGE_MAINTENANCE_RECURRENCES)[number];

export function isChangeMaintenanceScope(v: unknown): v is ChangeMaintenanceScope {
  return (CHANGE_MAINTENANCE_SCOPES as readonly string[]).includes(v as string);
}

export function isChangeMaintenanceRecurrence(v: unknown): v is ChangeMaintenanceRecurrence {
  return (CHANGE_MAINTENANCE_RECURRENCES as readonly string[]).includes(v as string);
}

/** Advance `date` by `count` cadence periods (`count` may be 0 — identity). */
function addPeriod(date: Date, recurrence: ChangeMaintenanceRecurrence, count: number): Date {
  const d = new Date(date.getTime());
  switch (recurrence) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7 * count);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + count);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3 * count);
      break;
    case "annually":
      d.setUTCFullYear(d.getUTCFullYear() + count);
      break;
    case "none":
      break;
  }
  return d;
}

/** Safety bound on how many cadence periods to walk forward — same bound as the freeze module. */
const MAX_OCCURRENCES = 10_000;

export interface MaintenanceWindowSpan {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly recurrence: ChangeMaintenanceRecurrence;
  readonly recurrenceUntil: Date | null;
  readonly active: boolean;
}

/**
 * Whether a booked span [`spanStart`, `spanEnd`) is FULLY CONTAINED within a
 * live occurrence of this window — the maintenance-window question is "is the
 * whole change inside the expected window", not merely "does it overlap it"
 * (that weaker overlap test is what freeze uses, because a freeze only needs
 * to catch the change touching the forbidden span at all).
 *
 * `spanEnd` may be null — a booked window known only by its start instant.
 * Treated as a zero-duration point: contained when `occStart <= spanStart <
 * occEnd`.
 */
export function spanWithinMaintenanceWindow(window: MaintenanceWindowSpan, spanStart: Date, spanEnd: Date | null): boolean {
  if (!window.active) return false;
  const durationMs = window.endsAt.getTime() - window.startsAt.getTime();
  if (durationMs <= 0) return false;
  const spanEndT = spanEnd ? spanEnd.getTime() : spanStart.getTime();
  if (spanEnd && spanEndT <= spanStart.getTime()) return false;

  if (window.recurrence === "none") {
    return spanStart.getTime() >= window.startsAt.getTime() && spanEndT <= window.endsAt.getTime();
  }

  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const occStart = addPeriod(window.startsAt, window.recurrence, i);
    if (window.recurrenceUntil && occStart.getTime() > window.recurrenceUntil.getTime()) break;
    if (occStart.getTime() > spanStart.getTime()) break;
    const occEnd = occStart.getTime() + durationMs;
    if (spanStart.getTime() >= occStart.getTime() && spanEndT <= occEnd) return true;
  }
  return false;
}

/**
 * Whether ANY occurrence of this window — walking its recurrence cadence
 * forward from `startsAt` — overlaps `[rangeStart, rangeEnd)`. A different
 * question from `spanWithinMaintenanceWindow` above: that asks "is this one
 * booked change fully inside an occurrence"; this asks "does this standing
 * rule apply at all during this stretch of calendar" — what the dashboard
 * roll-up (#2922, "change schedule for the week") needs to count a recurring
 * window (e.g. "every Saturday") that was created months ago and whose raw
 * `startsAt` column is long past, but which still fires every week.
 *
 * Same cadence walk as `spanWithinMaintenanceWindow`, bounded by the same
 * `MAX_OCCURRENCES` safety cap and by stopping as soon as an occurrence starts
 * at or after `rangeEnd` — occurrences only move forward in time, so nothing
 * past that point can still land inside the range.
 */
export function windowOverlapsRange(window: MaintenanceWindowSpan, rangeStart: Date, rangeEnd: Date): boolean {
  if (!window.active) return false;
  const durationMs = window.endsAt.getTime() - window.startsAt.getTime();
  if (durationMs <= 0) return false;
  if (rangeEnd.getTime() <= rangeStart.getTime()) return false;

  if (window.recurrence === "none") {
    return window.startsAt.getTime() < rangeEnd.getTime() && window.endsAt.getTime() > rangeStart.getTime();
  }

  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const occStart = addPeriod(window.startsAt, window.recurrence, i);
    if (window.recurrenceUntil && occStart.getTime() > window.recurrenceUntil.getTime()) break;
    if (occStart.getTime() >= rangeEnd.getTime()) break;
    const occEnd = occStart.getTime() + durationMs;
    if (occEnd > rangeStart.getTime()) return true;
  }
  return false;
}

/** The (mspId, tenantId, workload) a submitted change is evaluated against. */
export interface MaintenanceMatchContext {
  readonly mspId: number;
  readonly tenantId: string;
  readonly workload: string;
}

export interface MaintenanceWindowCandidate extends MaintenanceWindowSpan {
  readonly id: number;
  readonly mspId: number;
  readonly scope: ChangeMaintenanceScope;
  readonly tenantId: string | null;
  readonly workload: string | null;
  readonly name: string;
}

/** A stored row → the shape the matching functions consume. */
export function toMaintenanceCandidate(row: ChangeMaintenanceWindow): MaintenanceWindowCandidate {
  return {
    id: row.id,
    mspId: row.mspId,
    scope: row.scope as ChangeMaintenanceScope,
    tenantId: row.tenantId,
    workload: row.workload,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    recurrence: row.recurrence as ChangeMaintenanceRecurrence,
    recurrenceUntil: row.recurrenceUntil,
    active: row.active,
  };
}

/** Whether this window's scope names the change being evaluated at all — same
 *  shape as `matchesFreezeScope`. */
export function matchesMaintenanceScope(window: MaintenanceWindowCandidate, ctx: MaintenanceMatchContext): boolean {
  if (window.mspId !== ctx.mspId) return false;
  switch (window.scope) {
    case "global":
      return true;
    case "tenant":
      return (window.tenantId ?? "") === ctx.tenantId;
    case "workload":
      return (window.workload ?? "") === ctx.workload;
    default:
      return false;
  }
}

/**
 * The maintenance window that COVERS a change's booked span, or null. A null
 * result is the VIOLATION case when enforcement is on — the span is not
 * inside any matching, active maintenance window (including the case where
 * the MSP has curated none at all: an MSP that turns enforcement on with an
 * empty calendar correctly blocks every change until it defines one).
 * Candidates are checked most-specific-first (tenant, then workload, then
 * global) purely for a consistent "which rule covers it" answer when more
 * than one would.
 */
export function findMaintenanceCoverage(
  candidates: readonly MaintenanceWindowCandidate[],
  ctx: MaintenanceMatchContext,
  spanStart: Date,
  spanEnd: Date | null,
): MaintenanceWindowCandidate | null {
  for (const w of candidates) {
    if (matchesMaintenanceScope(w, ctx) && spanWithinMaintenanceWindow(w, spanStart, spanEnd)) return w;
  }
  return null;
}
