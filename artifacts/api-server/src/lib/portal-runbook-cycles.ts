/**
 * portal-runbook-cycles.ts — pure logic for a runbook's cycle model (#1557).
 *
 * A runbook is a SCHEDULE, not a single run. `portal_runbook_runs` holds one row
 * per cycle; `portal_runbook_steps` is keyed off the run, not the schedule.
 * Everything here is pure — it takes plain data and a clock and returns what to
 * do — so the rules that decide "did this cycle just finish" and "what does the
 * next cycle's checklist start out looking like" have a single, testable home
 * instead of being buried inside the route handler's DB calls.
 *
 * ── Why a cycle completes exactly when every step is checked ────────────────
 * There is no separate "mark this runbook done" affordance in the design — the
 * prototype's runbook page is a checklist, and finishing the checklist IS
 * finishing the cycle. So completion is derived from step state rather than
 * asserted by a caller, matching how `checkedSteps === totalSteps` already drove
 * the "Complete" status label before #1557.
 *
 * ── Why the next cycle's steps are cloned from the one that just finished ───
 * There is no separate step CATALOGUE table — a runbook's step list has always
 * lived on `portal_runbook_steps` itself, including customer-added ("isCustom")
 * steps the catalogue never shipped with. The only place to source "what steps
 * does cycle N+1 start with" is cycle N's own step list, carrying isCustom rows
 * forward too: a customer's own note about how they run this procedure is part
 * of the procedure now, not a one-cycle scratch pad.
 */

/** The subset of a step row this module needs — position/text/isCustom, nothing about check state. */
export interface RunbookStepTemplate {
  readonly position: number;
  readonly text: string;
  readonly isCustom: boolean;
}

/** The subset of a step row needed to ask "is this cycle done". */
export interface RunbookStepCheckState {
  readonly checked: boolean;
}

/**
 * A cycle is complete the moment every one of its steps is checked. A cycle
 * with zero steps is never "complete" by this rule — there is nothing to have
 * finished, and treating an empty checklist as done would spawn an infinite
 * chain of empty next cycles for a recurring schedule with no steps yet.
 */
export function isCycleComplete(steps: readonly RunbookStepCheckState[]): boolean {
  return steps.length > 0 && steps.every((s) => s.checked);
}

/**
 * The next cycle's step list, sourced from the cycle that just finished.
 * Position and text and isCustom carry forward; every step starts unchecked.
 * Order is normalised by position regardless of the input's own order, so a
 * caller that already queried "order by position" or not gets the same result.
 */
export function cloneStepsForNextCycle(
  steps: readonly RunbookStepTemplate[],
): ReadonlyArray<{ position: number; text: string; isCustom: boolean; checked: false }> {
  return steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ position: s.position, text: s.text, isCustom: s.isCustom, checked: false as const }));
}

/**
 * Whole-day arithmetic against UTC midnight, not against `now` — matches the
 * runbook page's "Day 7 of 14" whole-day count regardless of when in the day it
 * is opened. Moved here from the route (it used to be `wholeDaysSince` in
 * `portal-runbooks.ts`) so cycle-progress math has the same testable home as
 * the rest of this module.
 */
export function wholeDaysSince(startedOn: string, now: Date): number {
  const start = Date.parse(`${startedOn}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - start) / 86_400_000));
}

export interface CycleProgress {
  readonly daysElapsed: number;
  readonly daysLeft: number;
  /** True once the cycle has run past its expected `cycleDays` without finishing. */
  readonly overdue: boolean;
}

/**
 * A cycle's day-progress against its schedule's `cycleDays`, e.g. the "Day 7 of
 * 14" reading. `complete` is passed in rather than re-derived here, because
 * "overdue" is specifically about a cycle that is BOTH past its expected
 * duration AND not finished — a completed cycle that ran long is not overdue,
 * it is just late-but-done, and #1557's own point is that lateness should stay
 * visible rather than erased, not that it should read as a false alarm forever.
 */
export function cycleProgress(startedOn: string, cycleDays: number, now: Date, complete: boolean): CycleProgress {
  const daysElapsed = wholeDaysSince(startedOn, now);
  const daysLeftRaw = cycleDays - daysElapsed;
  return {
    daysElapsed,
    daysLeft: Math.max(0, daysLeftRaw),
    overdue: daysLeftRaw < 0 && !complete,
  };
}
