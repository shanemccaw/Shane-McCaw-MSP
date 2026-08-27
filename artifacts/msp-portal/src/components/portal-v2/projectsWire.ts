/**
 * projectsWire.ts — the shape `portal-projects.ts` / `portal-delivery-kanban.ts`
 * serve, and the normalisation into `projectsData.ts`'s own `ProjectPhase` /
 * `ProjectTask` / `ProjectMineItem` / `ScopeBar` types (Git #1241).
 *
 * Split out of `projectsLive.ts` so the mapping is testable as plain functions —
 * no React, no fetching. Same discipline `complianceObligationsWire.ts` and
 * `riskRegisterWire.ts` follow.
 *
 * ── What genuinely has no live source, and stays fixture ───────────────────
 * `workflow_steps` has no `deliverables` list and no hand-written phase
 * `summary`/`note` narrative distinct from its own `description`/`notes` — those
 * two DB fields are reused directly rather than inventing prose. The gantt has
 * no live "slip" concept either: the DB tracks one `dueDate` per step, not a
 * planned-vs-actual pair, so a live phase never draws a slip band (`slip: null`
 * always) rather than fabricating one. "Contracted deliverables accepted" on the
 * scope card has no per-deliverable acceptance record either; it is reported as
 * phases signed off (`status === "complete"`) out of total phases, the closest
 * real proxy the schema has — documented here, not silently invented.
 */

import type {
  DueTone,
  LaneKey,
  PhaseStatus,
  ProjectMineItem,
  ProjectPhase,
  ProjectTask,
  ScopeBar,
  TaskPriority,
} from "./projectsData";
import type { PjMilestone, PjRow } from "./projectsModel";

/* ── The wire shapes the two routes actually return ─────────────────────── */

export interface WireProjectSummary {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly projectType: "project" | "retainer" | "quick_win";
  readonly startDate: string | null;
  readonly endDate: string | null;
}

export interface WireProjectStep {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
  readonly order: number;
  readonly notes: string | null;
  readonly dueDate: string | null;
}

export interface WireKanbanTask {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly column: "backlog" | "in_progress" | "waiting_on_customer" | "review" | "completed";
  readonly assignedTo: string | null;
  readonly dueDate: string | null;
  readonly updatedAt: string | null;
  readonly workflowStepId: number | null;
  readonly waitingReason: string | null;
  readonly completionNotes: string | null;
  readonly publicNotes: string | null;
  readonly priority: string;
}

/* ── Date helpers — UTC-pinned for the same reason riskRegisterWire.ts's
   formatLongDate is: every timestamp in this schema is stored UTC, and a
   fixed-window gantt whose "today" line moves with the viewer's timezone would
   render the same day's tasks on the wrong side of the line for someone west
   of Greenwich. ────────────────────────────────────────────────────────────*/

const MS_PER_DAY = 86_400_000;

function toUtcDay(iso: string): number {
  const d = new Date(iso);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
}

function diffDays(fromIso: string, toIso: string): number {
  return toUtcDay(toIso) - toUtcDay(fromIso);
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function formatDateWithYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* ── Header meta (Git #1399) ──────────────────────────────────────────────
 * `sowLabel`/`terms`/`day` have no dedicated schema fields the way the design
 * fixture invents ("SOW-2026-0114", "fixed fee $14,800", "next report
 * Friday") — there is no SOW-number column, no per-project fee, no report
 * schedule. Rather than fabricate those, each field is derived only from a
 * column that genuinely exists (`projectType`, `startDate`/`endDate`,
 * `description`, the real schedule window) and left `null` — rendered as
 * honest no-data by the page — when the source column itself is null. */

const PROJECT_TYPE_LABEL: Readonly<Record<WireProjectSummary["projectType"], string>> = {
  project: "Fixed-scope project",
  retainer: "Retainer engagement",
  quick_win: "Quick win",
};

export interface LiveProjectMeta {
  readonly title: string;
  readonly sowLabel: string;
  readonly intro: string | null;
  readonly terms: string | null;
  readonly day: string | null;
}

export function toProjectMeta(
  project: WireProjectSummary,
  todayDay: number,
  winDays: number,
  hasSchedule: boolean,
): LiveProjectMeta {
  const terms =
    project.startDate && project.endDate
      ? `${formatDateWithYear(project.startDate)} – ${formatDateWithYear(project.endDate)}`
      : null;
  return {
    title: project.title,
    sowLabel: PROJECT_TYPE_LABEL[project.projectType] ?? "Delivery project",
    intro: project.description && project.description.trim().length > 0 ? project.description : null,
    terms,
    day: hasSchedule ? `Day ${todayDay} of ${winDays}` : null,
  };
}

/* ── Phase status / lane / priority maps ─────────────────────────────────── */

const STATUS_MAP: Readonly<Record<WireProjectStep["status"], PhaseStatus>> = {
  pending: "pending",
  in_progress: "active",
  completed: "complete",
  blocked: "blocked",
};

const COLUMN_TO_LANE: Readonly<Record<WireKanbanTask["column"], LaneKey>> = {
  backlog: "backlog",
  in_progress: "progress",
  waiting_on_customer: "waiting",
  review: "review",
  completed: "done",
};

const PRIORITY_MAP: Readonly<Record<string, TaskPriority>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function toPriority(priority: string): TaskPriority {
  return PRIORITY_MAP[priority.toLowerCase()] ?? "Medium";
}

/* ── Task due label/tone — prototype `pjDueTone` had no live analogue, so this
   derives the same four tones from the real due date instead. ─────────────*/

function deriveDue(task: WireKanbanTask, nowIso: string): { dueLabel: string; dueTone: DueTone } {
  if (task.column === "completed") {
    const on = task.updatedAt ?? task.dueDate;
    return { dueLabel: on ? `done ${formatShortDate(on)}` : "done", dueTone: "done" };
  }
  if (!task.dueDate) return { dueLabel: "No due date", dueTone: "neutral" };
  const days = diffDays(nowIso, task.dueDate);
  if (days < 0) return { dueLabel: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`, dueTone: "red" };
  if (days === 0) return { dueLabel: "due today", dueTone: "amber" };
  if (days <= 3) return { dueLabel: `in ${days} day${days === 1 ? "" : "s"}`, dueTone: "amber" };
  return { dueLabel: `in ${days} days`, dueTone: "neutral" };
}

/* ── Tasks → ProjectTask[] ────────────────────────────────────────────────*/

export function toProjectTasks(
  tasks: readonly WireKanbanTask[],
  phaseNByStepId: ReadonlyMap<number, number>,
  nowIso: string,
): readonly ProjectTask[] {
  return tasks.map((t) => {
    const { dueLabel, dueTone } = deriveDue(t, nowIso);
    return {
      id: String(t.id),
      lane: COLUMN_TO_LANE[t.column],
      title: t.title,
      prio: toPriority(t.priority),
      dueLabel,
      dueTone,
      owner: t.column === "waiting_on_customer" ? (t.assignedTo ? `You · ${t.assignedTo}` : "You") : (t.assignedTo ?? "Unassigned"),
      phase: t.workflowStepId != null ? (phaseNByStepId.get(t.workflowStepId) ?? 0) : 0,
      reason: t.waitingReason ?? undefined,
      blocks: t.publicNotes ?? undefined,
      next: t.completionNotes ?? undefined,
      detail: t.description ?? undefined,
    } satisfies ProjectTask;
  });
}

/** The "With us" card list — every task currently in progress. */
export function toMineItems(tasks: readonly WireKanbanTask[]): readonly ProjectMineItem[] {
  return tasks
    .filter((t) => t.column === "in_progress")
    .map((t) => ({ title: t.title, due: t.dueDate ? formatShortDate(t.dueDate) : "—" }));
}

/* ── Steps → phases + gantt geometry ─────────────────────────────────────── */

export interface LiveProjectGeometry {
  readonly phases: readonly ProjectPhase[];
  readonly rows: readonly PjRow[];
  readonly milestones: readonly PjMilestone[];
  readonly phaseNByStepId: ReadonlyMap<number, number>;
  readonly todayPct: number;
  readonly contractEndPct: number;
  readonly todayDay: number;
  readonly winDays: number;
}

const PHASE_TONE: Readonly<Record<PhaseStatus, string>> = {
  complete: "#4ade80",
  active: "#60a5fa",
  blocked: "#fbbf24",
  pending: "#64748b",
};

function pct(day: number, winDays: number): number {
  return winDays > 0 ? (day / winDays) * 100 : 0;
}

export function toLiveProjectGeometry(
  steps: readonly WireProjectStep[],
  tasks: readonly WireKanbanTask[],
  project: WireProjectSummary,
  nowIso: string,
): LiveProjectGeometry {
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  const lastDueDate = [...ordered].reverse().find((s) => s.dueDate)?.dueDate ?? null;
  const startIso = project.startDate ?? ordered[0]?.dueDate ?? nowIso;
  const endIso = project.endDate ?? lastDueDate ?? nowIso;
  const winDays = Math.max(1, diffDays(startIso, endIso));
  const todayDay = Math.min(Math.max(diffDays(startIso, nowIso), 0), winDays);

  const phaseNByStepId = new Map<number, number>();
  const tasksByStep = new Map<number, WireKanbanTask[]>();
  for (const t of tasks) {
    if (t.workflowStepId == null) continue;
    const arr = tasksByStep.get(t.workflowStepId) ?? [];
    arr.push(t);
    tasksByStep.set(t.workflowStepId, arr);
  }

  const phases: ProjectPhase[] = [];
  const rows: PjRow[] = [];
  const milestones: PjMilestone[] = [];
  let prevEndDay = 0;

  ordered.forEach((step, i) => {
    const n = i + 1;
    phaseNByStepId.set(step.id, n);

    const status = STATUS_MAP[step.status];
    const stepTasks = tasksByStep.get(step.id) ?? [];
    const total = stepTasks.length;
    const done = stepTasks.filter((t) => t.column === "completed").length;

    const endDay = step.dueDate
      ? Math.min(Math.max(diffDays(startIso, step.dueDate), 0), winDays)
      : Math.round(((i + 1) / ordered.length) * winDays);
    const startDay = Math.min(prevEndDay, endDay);
    prevEndDay = Math.max(endDay, startDay);

    phases.push({
      n,
      name: step.title,
      dates: step.dueDate ? `Due ${formatShortDate(step.dueDate)}` : "No date set",
      status,
      done,
      total,
      summary: step.description ?? "",
      deliverables: [],
      note: step.notes ?? "",
    });

    rows.push({
      n,
      name: step.title,
      dates: step.dueDate ? `Due ${formatShortDate(step.dueDate)}` : "No date set",
      status,
      tone: PHASE_TONE[status],
      left: pct(startDay, winDays),
      width: pct(endDay - startDay, winDays),
      donePct: total ? Math.round((done / total) * 100) : 0,
      barText: status === "complete" ? "Signed off" : status === "blocked" ? "Blocked" : `${done}/${total} tasks`,
      slip: null,
    });

    milestones.push({
      label: step.title,
      tone: status === "complete" ? "met" : status === "blocked" ? "risk" : "next",
      left: pct(endDay, winDays),
      nearEnd: endDay > winDays * 0.8,
    });
  });

  return {
    phases,
    rows,
    milestones,
    phaseNByStepId,
    todayPct: pct(todayDay, winDays),
    contractEndPct: pct(winDays, winDays),
    todayDay,
    winDays,
  };
}

/* ── Scope card bars ──────────────────────────────────────────────────────*/

export function toScopeBars(
  phases: readonly ProjectPhase[],
  tasks: readonly WireKanbanTask[],
  todayDay: number,
  winDays: number,
): readonly ScopeBar[] {
  const donePhases = phases.filter((p) => p.status === "complete").length;
  const totalPhases = phases.length;
  const doneTasks = tasks.filter((t) => t.column === "completed").length;
  const totalTasks = tasks.length;
  const elapsedPct = winDays > 0 ? Math.round((todayDay / winDays) * 100) : 0;

  return [
    {
      label: "Contracted deliverables accepted",
      value: `${donePhases} of ${totalPhases}`,
      pct: totalPhases ? Math.round((donePhases / totalPhases) * 100) : 0,
      color: "#4ade80",
    },
    {
      label: "Tasks closed",
      value: `${doneTasks} of ${totalTasks}`,
      pct: totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0,
      color: "#60a5fa",
    },
    { label: "Schedule elapsed", value: `${elapsedPct}%`, pct: elapsedPct, color: "#94a3b8" },
  ];
}
