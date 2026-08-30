/**
 * portal-change-freeze.ts — the pure derivations behind Change Control's
 * freeze / blackout calendar (#1500).
 *
 * `change_freeze_windows` stores one row per STANDING rule (a one-off span, or
 * a recurring cadence anchored at `startsAt`) rather than one row per
 * occurrence. Everything here is a total function over a stored row plus a
 * clock reading, so "is a freeze in effect right now" is unit-testable
 * without a database — the same split the rest of Change Control
 * (`portal-change-control.ts`, `portal-change-approvals.ts`) already follows.
 *
 * ── Enforcement point: submission time, not the change's scheduled window ──
 * `msp_change_requests.scheduled_for` is free text (a schema gap flagged in
 * `portal-change-control.ts`'s own header — it "wants to be a timestamp"),
 * so there is no sound way to test a freeze against WHEN a change is booked
 * to run. What the issue actually asks for — "ENFORCEMENT AT SUBMIT,
 * SERVER-SIDE" — is enforceable exactly as written: a freeze blocks RAISING a
 * change while the freeze is in effect, evaluated against the moment the
 * request lands on the server. That is the `now` every function below takes.
 */

import type { ChangeFreezeWindow } from "@workspace/db";

export const CHANGE_FREEZE_SCOPES = ["global", "tenant", "workload"] as const;
export type ChangeFreezeScope = (typeof CHANGE_FREEZE_SCOPES)[number];

export const CHANGE_FREEZE_RECURRENCES = ["none", "weekly", "monthly", "quarterly", "annually"] as const;
export type ChangeFreezeRecurrence = (typeof CHANGE_FREEZE_RECURRENCES)[number];

export function isChangeFreezeScope(v: unknown): v is ChangeFreezeScope {
  return (CHANGE_FREEZE_SCOPES as readonly string[]).includes(v as string);
}

export function isChangeFreezeRecurrence(v: unknown): v is ChangeFreezeRecurrence {
  return (CHANGE_FREEZE_RECURRENCES as readonly string[]).includes(v as string);
}

/** Advance `date` by `count` cadence periods (`count` may be 0 — identity). */
function addPeriod(date: Date, recurrence: ChangeFreezeRecurrence, count: number): Date {
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

/** Safety bound on how many cadence periods to walk forward — weekly for ~190
 *  years, comfortably past any real standing freeze rule. Prevents a runaway
 *  loop rather than modelling an actual limit on how long a rule may stand. */
const MAX_OCCURRENCES = 10_000;

export interface FreezeWindowSpan {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly recurrence: ChangeFreezeRecurrence;
  readonly recurrenceUntil: Date | null;
  readonly active: boolean;
}

/**
 * Whether `now` falls inside a live occurrence of this window. A `none`
 * window is just its own literal span. A recurring window is anchored at
 * `startsAt` and repeats every cadence period until `recurrenceUntil` (or
 * forever, if null) — found by walking forward from the anchor to the LAST
 * occurrence whose start is not after `now`, then checking whether that one
 * occurrence's span still covers `now`.
 */
export function isWindowActiveAt(window: FreezeWindowSpan, now: Date): boolean {
  if (!window.active) return false;
  const durationMs = window.endsAt.getTime() - window.startsAt.getTime();
  if (durationMs <= 0) return false;

  if (window.recurrence === "none") {
    return now.getTime() >= window.startsAt.getTime() && now.getTime() < window.endsAt.getTime();
  }

  let lastStart: Date | null = null;
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const occStart = addPeriod(window.startsAt, window.recurrence, i);
    if (window.recurrenceUntil && occStart.getTime() > window.recurrenceUntil.getTime()) break;
    if (occStart.getTime() > now.getTime()) break;
    lastStart = occStart;
  }
  if (!lastStart) return false;
  const occEnd = new Date(lastStart.getTime() + durationMs);
  return now.getTime() < occEnd.getTime();
}

/** The (mspId, tenantId, workload) a submitted change is evaluated against. */
export interface FreezeMatchContext {
  readonly mspId: number;
  readonly tenantId: string;
  readonly workload: string;
}

export interface FreezeWindowCandidate extends FreezeWindowSpan {
  readonly id: number;
  readonly mspId: number;
  readonly scope: ChangeFreezeScope;
  readonly tenantId: string | null;
  readonly workload: string | null;
  readonly name: string;
}

/** A stored row → the shape the matching functions consume. */
export function toFreezeCandidate(row: ChangeFreezeWindow): FreezeWindowCandidate {
  return {
    id: row.id,
    mspId: row.mspId,
    scope: row.scope as ChangeFreezeScope,
    tenantId: row.tenantId,
    workload: row.workload,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    recurrence: row.recurrence as ChangeFreezeRecurrence,
    recurrenceUntil: row.recurrenceUntil,
    active: row.active,
  };
}

/** Whether this window's scope names the change being evaluated at all — the
 *  recurrence/date check is separate (`isWindowActiveAt`). */
export function matchesFreezeScope(window: FreezeWindowCandidate, ctx: FreezeMatchContext): boolean {
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
 * The active freeze a submission collides with, or null. Candidates are
 * checked in the order given; pass them scope-most-specific-first (tenant,
 * then workload, then global) so the message a caller surfaces names the
 * most specific rule in effect.
 */
export function findActiveFreeze(
  candidates: readonly FreezeWindowCandidate[],
  ctx: FreezeMatchContext,
  now: Date,
): FreezeWindowCandidate | null {
  for (const w of candidates) {
    if (matchesFreezeScope(w, ctx) && isWindowActiveAt(w, now)) return w;
  }
  return null;
}
