/**
 * THE RETENTION CLOCK (Git #1947, for EPIC #1944 part 7).
 *
 * Pure arithmetic — no database, no I/O, no ambient `Date.now()`. Every function
 * takes `now` explicitly so a seven-year freeze can be tested in milliseconds and so
 * a sweep can evaluate a whole batch against one consistent instant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The requirement, and why the obvious implementation is wrong
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #1944 part 7: when a customer cancels, every per-record clock FREEZES exactly where
 * it stands, for up to seven years, and **resumes from where it froze** if they come
 * back. *"A record ghosted the day before cancellation is still ghosted, unresolved,
 * the day the customer returns three years later. It does not silently resolve
 * itself, and it does not restart."*
 *
 * #1947 states the consequence directly: store the clock as a remaining duration or
 * an explicit resume-adjusted target, **not** as a raw `deleted_at + 90d`. That
 * obvious implementation is not merely imprecise — it is wrong in the direction that
 * destroys data. A record deleted the day before a three-year cancellation would come
 * back already past its purge date and be swept on the first pass after the customer
 * returns, having spent none of its recoverable window recoverable.
 *
 * So the durable state is `(stageEnteredAt, stageRemainingSeconds)`:
 *
 *     running:  remaining(now) = stageRemainingSeconds - (now - stageEnteredAt)
 *     frozen:   remaining(now) = stageRemainingSeconds                (constant)
 *
 *     freeze:   stageRemainingSeconds := remaining(now);  frozenAt := now
 *     resume:   stageEnteredAt        := now;             frozenAt := null
 *
 * `stageDueAt` is a maintained convenience for the sweep's index and is **null while
 * frozen** — the freeze is therefore enforced by the index shape, not only by a WHERE
 * clause, and there is no stale due date left behind for a sweep to fire on.
 *
 * The import below is `@workspace/db/schema`, not `@workspace/db`: the package root
 * opens a connection pool on import, and this module — like `reference-guard.ts`,
 * `origin-registry.ts` and `registry.ts` — is deliberately reachable without a
 * database so the mechanism's core can be tested as pure arithmetic.
 */

import {
  RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS,
  RETENTION_DEFAULT_SOFT_DELETE_DAYS,
  type RetentionStage,
} from "@workspace/db/schema";

export const SECONDS_PER_DAY = 86_400;

/**
 * The clock's durable state — the exact subset of `record_deletions` columns this
 * module reads and writes. Deliberately a plain structural type rather than the
 * table's `$inferSelect`, so the arithmetic is testable without a database row and so
 * a caller can drive it from a partial object.
 */
export interface RetentionClockState {
  /** When the current stage's countdown last started or resumed. */
  stageEnteredAt: Date;
  /** Seconds left in the current stage **as of `stageEnteredAt`**. */
  stageRemainingSeconds: number;
  /** Maintained `stageEnteredAt + stageRemainingSeconds`; null while frozen. */
  stageDueAt: Date | null;
  /** Non-null while the clock is frozen. */
  frozenAt: Date | null;
  frozenReason: string | null;
  /** Cumulative seconds spent frozen, across every freeze. */
  totalFrozenSeconds: number;
  freezeCount: number;
}

/** The two stages that actually run a clock. `purged` and `restored` are terminal. */
export const RUNNING_STAGES: readonly RetentionStage[] = ["soft", "semi_hard"];

export function isRunningStage(stage: RetentionStage): boolean {
  return RUNNING_STAGES.includes(stage);
}

function secondsBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 1000);
}

function addSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

export function isFrozen(clock: RetentionClockState): boolean {
  return clock.frozenAt !== null;
}

/**
 * Start a fresh clock for a stage. `stageDueAt` is populated because a newly-started
 * clock is by definition running — a record deleted inside an already-frozen tenant
 * is started and then immediately frozen by the caller, which is one extra write but
 * keeps this function free of the freeze concept entirely.
 */
export function startClock(seconds: number, now: Date): RetentionClockState {
  const remaining = Math.max(0, Math.floor(seconds));
  return {
    stageEnteredAt: now,
    stageRemainingSeconds: remaining,
    stageDueAt: addSeconds(now, remaining),
    frozenAt: null,
    frozenReason: null,
    totalFrozenSeconds: 0,
    freezeCount: 0,
  };
}

/**
 * Seconds left in the current stage at `now`. Never negative — an overdue clock reads
 * zero, and how overdue it is belongs to the sweep, not to the remaining-time display
 * a customer sees.
 *
 * A frozen clock returns its stored remainder unchanged no matter how long the freeze
 * has run. That is the whole point of the design and the one behaviour a
 * `deleted_at + 90d` implementation cannot express.
 */
export function remainingSeconds(clock: RetentionClockState, now: Date): number {
  if (isFrozen(clock)) return Math.max(0, clock.stageRemainingSeconds);
  const elapsed = secondsBetween(clock.stageEnteredAt, now);
  return Math.max(0, clock.stageRemainingSeconds - elapsed);
}

/** The instant this stage ends, given no further freeze. Null while frozen — a frozen clock has no due date. */
export function dueAt(clock: RetentionClockState, now: Date): Date | null {
  if (isFrozen(clock)) return null;
  return addSeconds(now, remainingSeconds(clock, now));
}

/**
 * Has this stage's time run out? Always false while frozen — that is the freeze doing
 * its job, and it is asserted here as well as in the sweep's index so a caller that
 * hand-rolls a query cannot accidentally purge a frozen record.
 */
export function isDue(clock: RetentionClockState, now: Date): boolean {
  if (isFrozen(clock)) return false;
  return remainingSeconds(clock, now) <= 0;
}

/**
 * Freeze the clock. Idempotent: freezing an already-frozen clock returns it unchanged
 * rather than resetting `frozenAt`, so a repeated subscription-lapse sweep cannot
 * quietly extend a record's life by re-stamping the freeze instant.
 */
export function freezeClock(clock: RetentionClockState, now: Date, reason: string): RetentionClockState {
  if (isFrozen(clock)) return clock;
  return {
    ...clock,
    stageEnteredAt: now,
    stageRemainingSeconds: remainingSeconds(clock, now),
    // Null, not stale. Nothing can fire on a frozen record because the sweep's
    // partial index does not contain it.
    stageDueAt: null,
    frozenAt: now,
    frozenReason: reason,
    freezeCount: clock.freezeCount + 1,
  };
}

/**
 * Resume a frozen clock at `now`, from exactly the remainder it froze with. Idempotent
 * on an already-running clock.
 *
 * The frozen interval is added to `totalFrozenSeconds` rather than discarded, so a
 * record that has been ghosted for three years can explain to a returning customer
 * why — *"some cleanup to do"* (part 7) is expected, and unexplainable is not.
 */
export function resumeClock(clock: RetentionClockState, now: Date): RetentionClockState {
  if (!isFrozen(clock)) return clock;
  const frozenFor = Math.max(0, secondsBetween(clock.frozenAt as Date, now));
  const remaining = Math.max(0, clock.stageRemainingSeconds);
  return {
    ...clock,
    stageEnteredAt: now,
    stageRemainingSeconds: remaining,
    stageDueAt: addSeconds(now, remaining),
    frozenAt: null,
    frozenReason: null,
    totalFrozenSeconds: clock.totalFrozenSeconds + frozenFor,
  };
}

/**
 * Move to the next stage's clock once the current one has run out.
 *
 * The new stage starts at the **boundary instant** the old one actually expired —
 * `stageEnteredAt + stageRemainingSeconds` — not at `now`. A sweep that runs six hours
 * late must not hand the record six extra hours of tier-2 life; the boundary is a
 * property of the data, and when the sweep noticed is not.
 *
 * If the sweep is late by more than the whole next stage, the returned clock is
 * already due and the next pass advances it again. That is correct: a genuinely
 * overdue record does not get its window back because nothing was watching.
 */
export function advanceStageClock(
  clock: RetentionClockState,
  nextStageSeconds: number,
  now: Date,
): RetentionClockState {
  const boundary = addSeconds(clock.stageEnteredAt, clock.stageRemainingSeconds);
  // A boundary in the future means the caller advanced a clock that was not due.
  const startedAt = boundary.getTime() <= now.getTime() ? boundary : now;
  const remaining = Math.max(0, Math.floor(nextStageSeconds));
  return {
    ...clock,
    stageEnteredAt: startedAt,
    stageRemainingSeconds: remaining,
    stageDueAt: addSeconds(startedAt, remaining),
    frozenAt: null,
    frozenReason: null,
  };
}

/**
 * The stage that follows `stage` when its clock runs out. `null` means the lifecycle
 * has reached its end and the caller must purge rather than advance.
 */
export function nextStage(stage: RetentionStage): RetentionStage | null {
  if (stage === "soft") return "semi_hard";
  if (stage === "semi_hard") return "purged";
  return null;
}

/**
 * The effective durations for a tenant, in seconds, given a resolved policy. Separate
 * from `policy.ts`'s resolution so the arithmetic here never has to know whether a
 * value came from an override or the platform default.
 */
export interface RetentionStageDurations {
  softSeconds: number;
  semiHardSeconds: number;
}

export function stageDurations(
  softDeleteDays: number = RETENTION_DEFAULT_SOFT_DELETE_DAYS,
  semiHardDeleteDays: number = RETENTION_DEFAULT_SEMI_HARD_DELETE_DAYS,
): RetentionStageDurations {
  return {
    softSeconds: softDeleteDays * SECONDS_PER_DAY,
    semiHardSeconds: semiHardDeleteDays * SECONDS_PER_DAY,
  };
}

export function stageSeconds(stage: RetentionStage, durations: RetentionStageDurations): number {
  return stage === "soft" ? durations.softSeconds : durations.semiHardSeconds;
}
