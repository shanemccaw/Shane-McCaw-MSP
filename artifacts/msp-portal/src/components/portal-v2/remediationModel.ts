/**
 * remediationModel.ts — the Operate → Remediation Tracker derivation (Part 5).
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'; this transcribes
 * the `rtRun` logic (20380-20441) that the `isRemediation` markup (5961-6013)
 * renders. Named and tested here so a wrong count can't render as a
 * plausible-but-wrong number the rest of the page never contradicts.
 *
 * VERIFICATION IS READ, NOT DERIVED. `rtTaskState` returns `verified` only when
 * a task's own `verified` flag is set — which the fixture never does, because
 * only a real scan may set it (see remediationData.ts's header). Nothing here
 * promotes a task to verified from tick or filter state.
 */

import {
  RT_PHASES,
  RT_PILLAR_LABEL,
  RT_PILLAR_ORDER,
  RT_PILLAR_OWNER,
  type RemediationTask,
  type RtOwner,
  type RtPillarKey,
} from "./remediationData";

export type RtStateKey = "verified" | "done" | "open" | "accepted";

export interface RtState {
  key: RtStateKey;
  label: string;
  tone: string;
}

/** Every task, flattened in phase order — prototype `rtAllTasks` (15706). */
export const RT_ALL_TASKS: readonly RemediationTask[] = RT_PHASES.flatMap((p) => p.tasks);

/**
 * A task's state — prototype `stateFor` (20385-20390).
 *
 * `skipped` is the set of task ids a user has deliberately accepted; this page
 * has no skip control, so it defaults to empty and no task reaches `accepted`.
 * A DONE task is `verified` only when the fixture says so (it never does), else
 * "Awaiting re-scan"; an open task reads "Not started", coloured by severity.
 */
export function rtTaskState(
  task: RemediationTask,
  skipped: ReadonlySet<string> = new Set(),
): RtState {
  if (skipped.has(task.id)) return { key: "accepted", label: "Accepted as-is", tone: "#a78bfa" };
  if (task.done) {
    return task.verified
      ? { key: "verified", label: "Verified", tone: "#34d399" }
      : { key: "done", label: "Awaiting re-scan", tone: "#5eead4" };
  }
  return task.sev === "Critical"
    ? { key: "open", label: "Not started", tone: "#f87171" }
    : { key: "open", label: "Not started", tone: "#fbbf24" };
}

export interface RtRoute {
  label: string;
  tone: string;
}

/** Who closes it — prototype `routeFor` (20384). */
export function rtTaskRoute(task: RemediationTask): RtRoute {
  if (task.shane) return { label: "We run it", tone: "#60a5fa" };
  if (task.sev === "Critical") return { label: "Runbook", tone: "#22d3ee" };
  return { label: "Your team", tone: "#94a3b8" };
}

/**
 * The change-request number a Shane-run, done task carries — prototype 20402:
 * `'CR-0' + (100 + (i % 40))`, where `i` is the task's index across all tasks.
 * Null for anything that is not both Shane-run and done.
 */
export function rtCrNumber(task: RemediationTask, index: number): string | null {
  return task.shane && task.done ? `CR-0${100 + (index % 40)}` : null;
}

/** One rendered row. */
export interface RtRow {
  id: string;
  index: number;
  title: string;
  ev: string;
  sev: RemediationTask["sev"];
  pillarKey: RtPillarKey;
  pillar: string;
  state: RtState;
  route: RtRoute;
  cr: string | null;
  owner: RtOwner;
}

/** Every task as a render row, in phase order — prototype `all` (20392-20409). */
export function rtAllRows(skipped: ReadonlySet<string> = new Set()): readonly RtRow[] {
  return RT_ALL_TASKS.map((t, i) => ({
    id: t.id,
    index: i,
    title: t.title,
    ev: t.ev,
    sev: t.sev,
    pillarKey: t.pillar,
    pillar: RT_PILLAR_LABEL[t.pillar] ?? t.pillar,
    state: rtTaskState(t, skipped),
    route: rtTaskRoute(t),
    cr: rtCrNumber(t, i),
    owner: RT_PILLAR_OWNER[t.pillar],
  }));
}

/** How many tasks sit in each state — over ALL tasks, not the filtered view. */
export function rtStateCounts(
  skipped: ReadonlySet<string> = new Set(),
): Readonly<Record<RtStateKey, number>> {
  const counts: Record<RtStateKey, number> = { verified: 0, done: 0, open: 0, accepted: 0 };
  for (const row of rtAllRows(skipped)) counts[row.state.key] += 1;
  return counts;
}

export interface RtCounter {
  key: RtStateKey;
  label: string;
  sub: string;
  tone: string;
  value: string;
  active: boolean;
}

/** The four counter cards — prototype `counters` (20417-20431). */
const COUNTER_META: readonly { key: RtStateKey; label: string; sub: string; tone: string }[] = [
  { key: "verified", label: "Fixed and verified", sub: "confirmed by a re-scan, not marked done", tone: "#34d399" },
  { key: "done", label: "Done, awaiting re-scan", sub: "the change ran, the proof has not landed", tone: "#5eead4" },
  { key: "open", label: "Still to do", sub: "nothing has run against these yet", tone: "#f87171" },
  { key: "accepted", label: "Accepted as-is", sub: "a decision, with an owner and a date", tone: "#a78bfa" },
];

export function rtCounters(
  filter: RtStateKey | null,
  skipped: ReadonlySet<string> = new Set(),
): readonly RtCounter[] {
  const counts = rtStateCounts(skipped);
  return COUNTER_META.map((m) => ({
    key: m.key,
    label: m.label,
    sub: m.sub,
    tone: m.tone,
    value: String(counts[m.key]),
    active: filter === m.key,
  }));
}

export interface RtGroup {
  key: RtPillarKey;
  label: string;
  /** Count of shown rows in this group, as a string — prototype `g.n`. */
  n: string;
  items: readonly RtRow[];
}

/**
 * The rows grouped by pillar, filtered to the selected state — prototype
 * `shown`/`groups` (20410-20415). Empty groups are dropped.
 */
export function rtGroups(
  filter: RtStateKey | null,
  skipped: ReadonlySet<string> = new Set(),
): readonly RtGroup[] {
  const shown = rtAllRows(skipped).filter((r) => !filter || r.state.key === filter);
  return RT_PILLAR_ORDER.map((k) => {
    const items = shown.filter((r) => r.pillarKey === k);
    return { key: k, label: RT_PILLAR_LABEL[k], n: String(items.length), items };
  }).filter((g) => g.items.length > 0);
}

export interface RtProgress {
  total: string;
  done: string;
  pct: number;
  headline: string;
  sub: string;
}

/** The progress bar and headline — prototype 20432-20439. */
export function rtProgress(skipped: ReadonlySet<string> = new Set()): RtProgress {
  const counts = rtStateCounts(skipped);
  const total = RT_ALL_TASKS.length;
  const doneN = counts.verified + counts.done;
  const pct = Math.round((doneN / total) * 100);
  return {
    total: String(total),
    done: String(doneN),
    pct,
    headline: `${doneN} of ${total} things fixed since the first scan.`,
    sub: "This is the run-down from the tenant we found to the tenant you want. Nothing here is a project plan — items appear when a scan finds them and leave when a re-scan proves they are gone.",
  };
}
