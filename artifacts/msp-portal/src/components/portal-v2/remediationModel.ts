/**
 * remediationModel.ts — the Operate → Remediation Tracker derivation (Part 5,
 * wired to real tracker rows).
 *
 * Prototype references are to 'Customer Portal Shell.dc.html'; this transcribes
 * the `rtRun` logic (20380-20441) that the `isRemediation` markup (5961-6013)
 * renders. Named and tested here so a wrong count can't render as a
 * plausible-but-wrong number the rest of the page never contradicts.
 *
 * ── WHERE THE FACTS COME FROM ──────────────────────────────────────────────
 * The CATALOGUE (title, evidence, severity, pillar, owner, who runs it) is
 * still the design's fixture — remediationData.ts, which has no real source to
 * read from yet. The STATE is not: every "is this done" and "has a scan
 * verified it" is resolved per step out of the customer's own
 * `remediation_tracker_steps` rows, handed in as `RtLiveState` and mapped onto
 * the design's task ids by remediationLive.ts.
 *
 * ── VERIFICATION IS READ, NOT DERIVED ──────────────────────────────────────
 * `rtTaskState` returns `verified` in exactly one circumstance: the wire said
 * `verificationState === "verified"` for that step. There is no other branch
 * that can reach it — not a status, not a tick, not a filter, not a fixture
 * flag (the fixture no longer has one to set). Only
 * `reverifyRemediationTrackerSteps()`, running inside a real scan, produces
 * that value in the first place.
 *
 * A step the scan actively CONTRADICTED (`drift`) is not quietly folded back
 * into "awaiting re-scan" — that would claim the proof merely hasn't landed
 * when in fact contrary proof has. It reads "Drifted", in the critical tone,
 * and counts under "Still to do", because the platform's position is that a
 * fix which drifted back is outstanding work. (The design draws four counters
 * and its copy is final, so drift gets an honest row badge rather than a fifth
 * card the design never specified.)
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
import {
  RT_ACCEPTED_STATUSES,
  RT_FIXED_STATUSES,
  RT_LIVE_EMPTY,
  rtLiveStep,
  type RtLiveState,
} from "./remediationLive";

export type RtStateKey = "verified" | "done" | "open" | "accepted";

export interface RtState {
  key: RtStateKey;
  label: string;
  tone: string;
  /**
   * True only when a real scan contradicted the claim. Counts under `open`
   * (see the header) but says so on the row rather than pretending the
   * re-scan is still pending.
   */
  drifted?: boolean;
}

/** Every task, flattened in phase order — prototype `rtAllTasks` (15706). */
export const RT_ALL_TASKS: readonly RemediationTask[] = RT_PHASES.flatMap((p) => p.tasks);

/**
 * A task's state — prototype `stateFor` (20385-20390), resolved against the
 * customer's real tracker rows.
 *
 * `skipped` is the set of task ids a user has deliberately accepted in the
 * session; this page has no skip control, so it defaults to empty and the
 * `accepted` bucket is reached through the real `not_applicable`/`deferred`
 * statuses instead.
 */
export function rtTaskState(
  task: RemediationTask,
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): RtState {
  if (skipped.has(task.id)) return { key: "accepted", label: "Accepted as-is", tone: "#a78bfa" };

  const { status, verification } = rtLiveStep(task.id, live);

  // A decision, not a fix — the design's own "Accepted as-is".
  if (RT_ACCEPTED_STATUSES.has(status)) {
    return { key: "accepted", label: "Accepted as-is", tone: "#a78bfa" };
  }

  // A claim the change landed. Whether it is TRUE is a separate fact, and the
  // only thing that answers it is the wire's verification state.
  if (RT_FIXED_STATUSES.has(status)) {
    if (verification === "verified") return { key: "verified", label: "Verified", tone: "#34d399" };
    if (verification === "drift") {
      return { key: "open", label: "Drifted", tone: "#f87171", drifted: true };
    }
    return { key: "done", label: "Awaiting re-scan", tone: "#5eead4" };
  }

  // `not_started` and `shane_handles` alike: the work is still outstanding.
  // A hand-off only changes who closes it (see rtTaskRoute), not whether it is
  // done.
  return task.sev === "Critical"
    ? { key: "open", label: "Not started", tone: "#f87171" }
    : { key: "open", label: "Not started", tone: "#fbbf24" };
}

export interface RtRoute {
  label: string;
  tone: string;
}

/**
 * Who closes it — prototype `routeFor` (20384), plus the real `shane_handles`
 * status: a customer who asked Shane to take a step gets the same "We run it"
 * chip as one the design already assigns to him.
 */
export function rtTaskRoute(task: RemediationTask, live: RtLiveState = RT_LIVE_EMPTY): RtRoute {
  const { status } = rtLiveStep(task.id, live);
  if (task.shane || status === "shane_handles") return { label: "We run it", tone: "#60a5fa" };
  if (task.sev === "Critical") return { label: "Runbook", tone: "#22d3ee" };
  return { label: "Your team", tone: "#94a3b8" };
}

/**
 * The change-request number a Shane-run, done task carries — prototype 20402:
 * `'CR-0' + (100 + (i % 40))`, where `i` is the task's index across all tasks.
 * Null for anything that is not both Shane-run and actually claimed done, which
 * is now a real fact off the wire rather than a fixture flag. A drifted step
 * loses its badge along with its claim.
 */
export function rtCrNumber(task: RemediationTask, index: number, state: RtState): string | null {
  const done = state.key === "verified" || state.key === "done";
  return task.shane && done ? `CR-0${100 + (index % 40)}` : null;
}

/** One rendered row. */
export interface RtRow {
  id: string;
  /** The platform's own step id, or null for a task it no longer carries (#757). */
  stepId: string | null;
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
export function rtAllRows(
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): readonly RtRow[] {
  return RT_ALL_TASKS.map((t, i) => {
    const state = rtTaskState(t, live, skipped);
    return {
      id: t.id,
      stepId: rtLiveStep(t.id, live).stepId,
      index: i,
      title: t.title,
      ev: t.ev,
      sev: t.sev,
      pillarKey: t.pillar,
      pillar: RT_PILLAR_LABEL[t.pillar] ?? t.pillar,
      state,
      route: rtTaskRoute(t, live),
      cr: rtCrNumber(t, i, state),
      owner: RT_PILLAR_OWNER[t.pillar],
    };
  });
}

/** How many tasks sit in each state — over ALL tasks, not the filtered view. */
export function rtStateCounts(
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): Readonly<Record<RtStateKey, number>> {
  const counts: Record<RtStateKey, number> = { verified: 0, done: 0, open: 0, accepted: 0 };
  for (const row of rtAllRows(live, skipped)) counts[row.state.key] += 1;
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
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): readonly RtCounter[] {
  const counts = rtStateCounts(live, skipped);
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
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): readonly RtGroup[] {
  const shown = rtAllRows(live, skipped).filter((r) => !filter || r.state.key === filter);
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

/**
 * The progress bar and headline — prototype 20432-20439.
 *
 * "Fixed" is verified + done-awaiting-re-scan, as the prototype counts it. A
 * drifted step is deliberately NOT in that numerator: the scan said it is not
 * fixed.
 */
export function rtProgress(
  live: RtLiveState = RT_LIVE_EMPTY,
  skipped: ReadonlySet<string> = new Set(),
): RtProgress {
  const counts = rtStateCounts(live, skipped);
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
