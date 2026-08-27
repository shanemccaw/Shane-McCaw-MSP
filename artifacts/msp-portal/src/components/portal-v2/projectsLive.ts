/**
 * projectsLive.ts — the Projects page's real data (Git #1241).
 *
 *   GET /api/portal/dashboard                                (find the active project id)
 *   GET /api/portal/projects/:id                              (steps → phases/gantt)
 *   GET /api/portal/projects/:id/delivery-kanban-tasks         (task board)
 *
 * `/api/portal/projects/:id` also returns a `tasks` field straight off
 * `kanban_tasks`, but that field carries `internalNotes` UNSTRIPPED for a client
 * caller (portal-projects.ts has no `stripInternalNotes` the way
 * portal-delivery-kanban.ts does) — it is only ever read for `project.title`
 * elsewhere in the app today. This hook deliberately does not read `.tasks` off
 * that response and sources the task board from the delivery-kanban endpoint
 * instead, which strips `internalNotes` for a non-admin caller.
 *
 * ── dataState (Git #1399) ────────────────────────────────────────────────
 * The old two-state `"live" | "fixture"` model conflated three genuinely
 * different situations under `"fixture"`: the first read still in flight, a
 * customer with an active project but nothing scheduled in it yet, and a
 * customer who has no active project at all. All three rendered identically
 * — the full design fixture, `PROJECT_META` included — which is exactly the
 * silent fixture-fallback Shane's standing rule forbids (Git #1398 fixed the
 * same shape of bug for `useRetainerLive`). `dataState` now names all five
 * real cases, same names #1398 uses:
 *   - "loading"      — first read in flight.
 *   - "live"          — an active project with at least one real step or task.
 *   - "empty"         — an active project row, genuinely no steps AND no
 *                       tasks yet — real data, just nothing scheduled yet.
 *   - "unconfigured"  — no active project row. There is nothing real to show.
 *   - "error"         — a read failed. Distinct from "unconfigured" so the
 *                       page never tells a customer "you have no project"
 *                       when the truth is "the request failed."
 * `meta` (the header's title/SOW-type/date-range/day-of-schedule) is `null`
 * for "loading"/"unconfigured"/"error" and populated from the real project
 * row for "live"/"empty" — see `projectsWire.ts`'s `toProjectMeta` for which
 * of `PROJECT_META`'s fields have a real column behind them (title,
 * project type, dates, description) and which genuinely do not (there is no
 * SOW-number, fee, or delivery-lead column) and so are simply omitted rather
 * than invented. The hand-written narrative sentences (the schedule callout,
 * the waiting/with-us card tails, the scope note) still have no live
 * analogue and stay the design fixture unconditionally when "live"/"empty" —
 * same call the pillar drill-downs already made in `PillarLiveSource.tsx`.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { type PjMilestone, type PjRow } from "./projectsModel";
import type { ProjectMineItem, ProjectPhase, ProjectTask, ScopeBar } from "./projectsData";
import {
  toLiveProjectGeometry,
  toMineItems,
  toProjectMeta,
  toProjectTasks,
  toScopeBars,
  type LiveProjectMeta,
  type WireKanbanTask,
  type WireProjectStep,
  type WireProjectSummary,
} from "./projectsWire";

const DASHBOARD_URL = "/api/portal/dashboard";
const projectUrl = (id: number) => `/api/portal/projects/${id}`;
const kanbanUrl = (id: number) => `/api/portal/projects/${id}/delivery-kanban-tasks`;

export type ProjectsDataState = "loading" | "live" | "empty" | "unconfigured" | "error";

export interface ProjectsLiveState {
  readonly dataState: ProjectsDataState;
  readonly loading: boolean;
  /** Real header meta for the active project. `null` unless `dataState` is "live"/"empty". */
  readonly meta: LiveProjectMeta | null;
  readonly phases: readonly ProjectPhase[];
  readonly rows: readonly PjRow[];
  readonly milestones: readonly PjMilestone[];
  readonly tasks: readonly ProjectTask[];
  readonly mineItems: readonly ProjectMineItem[];
  readonly scopeBars: readonly ScopeBar[];
  readonly todayPct: number;
  readonly contractEndPct: number;
}

interface LiveResult {
  readonly hasSchedule: boolean;
  readonly meta: LiveProjectMeta;
  readonly phases: readonly ProjectPhase[];
  readonly rows: readonly PjRow[];
  readonly milestones: readonly PjMilestone[];
  readonly tasks: readonly ProjectTask[];
  readonly mineItems: readonly ProjectMineItem[];
  readonly scopeBars: readonly ScopeBar[];
  readonly todayPct: number;
  readonly contractEndPct: number;
}

const LOADING_STATE: ProjectsLiveState = {
  dataState: "loading",
  loading: true,
  meta: null,
  phases: [],
  rows: [],
  milestones: [],
  tasks: [],
  mineItems: [],
  scopeBars: [],
  todayPct: 0,
  contractEndPct: 0,
};

type Outcome = { kind: "ok"; result: LiveResult } | { kind: "unconfigured" } | { kind: "error" };

export function useProjectsLive(): ProjectsLiveState {
  const { fetchWithAuth } = useAuth();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dashRes = await fetchWithAuth(DASHBOARD_URL, undefined, { silent: true });
        if (!dashRes.ok) throw new Error(`dashboard ${dashRes.status}`);
        const dashBody = (await dashRes.json()) as { projects?: readonly WireProjectSummary[] };
        const project = dashBody?.projects?.[0];
        if (!project) {
          if (!cancelled) setOutcome({ kind: "unconfigured" });
          return;
        }

        const [detailRes, kanbanRes] = await Promise.all([
          fetchWithAuth(projectUrl(project.id), undefined, { silent: true }),
          fetchWithAuth(kanbanUrl(project.id), undefined, { silent: true }),
        ]);
        if (!detailRes.ok) throw new Error(`project ${detailRes.status}`);
        if (!kanbanRes.ok) throw new Error(`kanban ${kanbanRes.status}`);

        const detailBody = (await detailRes.json()) as { steps?: readonly WireProjectStep[] };
        const kanbanTasks = (await kanbanRes.json()) as readonly WireKanbanTask[];
        if (cancelled) return;

        const nowIso = new Date().toISOString();
        const steps = detailBody?.steps ?? [];
        const hasSchedule = steps.length > 0 || kanbanTasks.length > 0;
        const geometry = toLiveProjectGeometry(steps, kanbanTasks, project, nowIso);

        setOutcome({
          kind: "ok",
          result: {
            hasSchedule,
            meta: toProjectMeta(project, geometry.todayDay, geometry.winDays, hasSchedule),
            phases: geometry.phases,
            rows: geometry.rows,
            milestones: geometry.milestones,
            todayPct: geometry.todayPct,
            contractEndPct: geometry.contractEndPct,
            tasks: toProjectTasks(kanbanTasks, geometry.phaseNByStepId, nowIso),
            mineItems: toMineItems(kanbanTasks),
            scopeBars: toScopeBars(geometry.phases, kanbanTasks, geometry.todayDay, geometry.winDays),
          },
        });
      } catch {
        if (!cancelled) setOutcome({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return useMemo(() => {
    if (!outcome) return LOADING_STATE;

    if (outcome.kind === "unconfigured") {
      return { ...LOADING_STATE, dataState: "unconfigured", loading: false };
    }
    if (outcome.kind === "error") {
      return { ...LOADING_STATE, dataState: "error", loading: false };
    }

    const { result } = outcome;
    return {
      dataState: result.hasSchedule ? ("live" as const) : ("empty" as const),
      loading: false,
      meta: result.meta,
      phases: result.phases,
      rows: result.rows,
      milestones: result.milestones,
      tasks: result.tasks,
      mineItems: result.mineItems,
      scopeBars: result.scopeBars,
      todayPct: result.todayPct,
      contractEndPct: result.contractEndPct,
    };
  }, [outcome]);
}
