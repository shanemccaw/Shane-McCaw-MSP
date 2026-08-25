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
 * `PROJECT_META` (the SOW label, fee, delivery-lead name) and every hand-written
 * narrative sentence (the schedule callout, the waiting/with-us card tails, the
 * scope note) stay on the design fixture unconditionally — same call the
 * pillar drill-downs already made in `PillarLiveSource.tsx`: what the schema
 * genuinely has (phase status, task columns, due dates) goes live; prose that
 * would have to be regenerated to stay honest does not.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { pjRows as fixturePjRows, pjPct as fixturePjPct } from "./overviewModel";
import { pjMilestones as fixturePjMilestones, type PjMilestone, type PjRow } from "./projectsModel";
import {
  PJ_CONTRACT_END,
  PJ_MINE,
  PJ_SCOPE_BARS,
  PJ_TASKS,
  PJ_TODAY,
  PROJECT_PHASES,
  type ProjectMineItem,
  type ProjectPhase,
  type ProjectTask,
  type ScopeBar,
} from "./projectsData";
import {
  toLiveProjectGeometry,
  toMineItems,
  toProjectTasks,
  toScopeBars,
  type WireKanbanTask,
  type WireProjectStep,
  type WireProjectSummary,
} from "./projectsWire";

const DASHBOARD_URL = "/api/portal/dashboard";
const projectUrl = (id: number) => `/api/portal/projects/${id}`;
const kanbanUrl = (id: number) => `/api/portal/projects/${id}/delivery-kanban-tasks`;

export interface ProjectsLiveState {
  /** "live" once a real project's phases and tasks have landed; the design fixture until then or on error/no active project. */
  readonly dataState: "live" | "fixture";
  readonly loading: boolean;
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
  readonly phases: readonly ProjectPhase[];
  readonly rows: readonly PjRow[];
  readonly milestones: readonly PjMilestone[];
  readonly tasks: readonly ProjectTask[];
  readonly mineItems: readonly ProjectMineItem[];
  readonly scopeBars: readonly ScopeBar[];
  readonly todayPct: number;
  readonly contractEndPct: number;
}

export function useProjectsLive(): ProjectsLiveState {
  const { fetchWithAuth } = useAuth();
  const [live, setLive] = useState<LiveResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dashRes = await fetchWithAuth(DASHBOARD_URL, undefined, { silent: true });
        if (!dashRes.ok) throw new Error(`dashboard ${dashRes.status}`);
        const dashBody = (await dashRes.json()) as { projects?: readonly WireProjectSummary[] };
        const project = dashBody?.projects?.[0];
        if (!project) throw new Error("no active project");

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
        const geometry = toLiveProjectGeometry(steps, kanbanTasks, project, nowIso);

        setLive({
          phases: geometry.phases,
          rows: geometry.rows,
          milestones: geometry.milestones,
          todayPct: geometry.todayPct,
          contractEndPct: geometry.contractEndPct,
          tasks: toProjectTasks(kanbanTasks, geometry.phaseNByStepId, nowIso),
          mineItems: toMineItems(kanbanTasks),
          scopeBars: toScopeBars(geometry.phases, kanbanTasks, geometry.todayDay, geometry.winDays),
        });
      } catch {
        if (!cancelled) setLive(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  return useMemo(() => {
    if (live) return { dataState: "live" as const, loading, ...live };
    return {
      dataState: "fixture" as const,
      loading,
      phases: PROJECT_PHASES,
      rows: fixturePjRows(),
      milestones: fixturePjMilestones(),
      tasks: PJ_TASKS,
      mineItems: PJ_MINE,
      scopeBars: PJ_SCOPE_BARS,
      todayPct: fixturePjPct(PJ_TODAY),
      contractEndPct: fixturePjPct(PJ_CONTRACT_END),
    };
  }, [live, loading]);
}
