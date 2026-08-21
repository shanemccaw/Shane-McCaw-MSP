/**
 * projectsModel.ts — the Projects page's derivations.
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'.
 *
 * The gantt geometry is REUSED, not re-implemented: `pjPct`, `pjRows` and
 * `slippedPhaseCount` already live in overviewModel.ts (they power the
 * Overview's mini-gantt) and are tested there. Re-exporting them here means the
 * full gantt on this page and the mini-gantt on the Overview position their
 * bars with the exact same arithmetic over the exact same phase fixture — they
 * cannot drift. Everything below is the geometry the full page needs on top of
 * those rows: the milestone diamonds, the task-lane split, and the two card
 * counts.
 *
 * A wrong percentage renders as a plausible bar in the wrong place, which is
 * why the maths is named and unit-tested rather than written inline in the JSX.
 */

import { pjPct, pjRows, slippedPhaseCount, type PjRow } from "./overviewModel";
import {
  PJ_MILESTONES,
  PJ_MINE,
  PJ_TASKS,
  PJ_WIN,
  type LaneKey,
  type MilestoneTone,
  type ProjectTask,
} from "./projectsData";

// Reuse the Overview's gantt geometry verbatim — one source, one set of tests.
export { pjPct, pjRows, slippedPhaseCount };
export type { PjRow };

/* ── The task board split — prototype `pjLanes`, shell 16124 ────────────────*/

/** Every task in one lane, in fixture order. */
export function pjTasksInLane(lane: LaneKey, tasks: readonly ProjectTask[] = PJ_TASKS): readonly ProjectTask[] {
  return tasks.filter((t) => t.lane === lane);
}

/** The three tasks the customer is the blocker on — the "Waiting on you" card. */
export function pjWaitingTasks(tasks: readonly ProjectTask[] = PJ_TASKS): readonly ProjectTask[] {
  return pjTasksInLane("waiting", tasks);
}

/** The count on the "Waiting on you" card — prototype `pjWaitingCount`, shell 19606. */
export function pjWaitingCount(tasks: readonly ProjectTask[] = PJ_TASKS): number {
  return pjWaitingTasks(tasks).length;
}

/** The count on the "With us" card — prototype `pjMineCount`, shell 19608. */
export function pjMineCount(mine: readonly unknown[] = PJ_MINE): number {
  return mine.length;
}

/** Every task on the board, across the five lanes. */
export function pjTaskTotal(tasks: readonly ProjectTask[] = PJ_TASKS): number {
  return tasks.length;
}

/**
 * The "You · " owner prefix a waiting item drops on the card — prototype
 * `t.owner.replace('You · ', '')`, shell 16177. "You · IT + Legal" → "IT + Legal".
 */
export function pjOwnerShort(owner: string): string {
  return owner.replace("You · ", "");
}

/* ── The milestone diamonds — prototype `pjMilestones`, shell 16278 ─────────*/

export interface PjMilestone {
  label: string;
  tone: MilestoneTone;
  /** Left edge on the window, as a percentage. */
  left: number;
  /**
   * A milestone in the last fifth of the window is drawn RIGHT of its dot, not
   * left, so its label does not run off the track — prototype 16280,
   * `ms.d > PJ_WIN * 0.8`.
   */
  nearEnd: boolean;
}

export function pjMilestones(milestones = PJ_MILESTONES): readonly PjMilestone[] {
  return milestones.map((m) => ({
    label: m.label,
    tone: m.tone,
    left: pjPct(m.day),
    nearEnd: m.day > PJ_WIN * 0.8,
  }));
}
