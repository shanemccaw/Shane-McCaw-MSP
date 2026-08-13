// artifacts/admin-panel/src/components/simulatorConfigPack.ts
//
// Pure helpers for the Simulator "Config Packs" canvas — split from the .tsx
// (matching the simulatorWriteAction.ts / simulatorTreeState.ts convention) so
// the run-progress mapping and single-step reuse logic are unit-testable
// without React.
//
// TWO real safety properties this module encodes and its tests pin:
//   1. Whole-pack progress is mapped onto the SERVER's templateOrder (the
//      authoritative topological/dependency order returned by the run endpoint)
//      — the UI never re-derives or reorders steps, so what the operator watches
//      is exactly the order the executor runs.
//   2. A single step is executed by REUSING the existing Write Actions runner —
//      resolveStepWriteAction just resolves the step back to its real
//      baseline_action_template (WriteActionNode). There is deliberately NO
//      execute path in this module: single-step runs hand off to the tested
//      SimulatorWriteActionCanvas, never a second execution implementation.

import type { WriteActionNode } from "./SimulatorLeftTree";

/** Mirror of config-pack-graph.ts's templateNodeId — the wf_run node id for a
 *  pack step. Kept in sync with the backend so nodeResultMap lookups line up. */
export const templateNodeId = (templateId: string): string => `tpl-${templateId}`;

/** One step of the plan the run endpoint would materialize (GET .../run/plan). */
export interface ConfigPackPlanStep {
  templateId: string;
  label: string;
  sortOrder: number;
  effectiveDependsOn: string[];
  requiresVerificationGate: boolean;
  requiredVariables: string[];
  /** true when the pack's single verification gate is spliced right after this step. */
  gatedHere: boolean;
}

export interface ConfigPackPlan {
  packKey: string;
  label: string;
  ordered: ConfigPackPlanStep[];
  gatedTemplateId: string | null;
  coalescedGateTemplateIds: string[];
  /** Required vars with no derivable source — the only inputs the operator supplies. */
  operatorVariables: string[];
}

/** The subset of GET /admin/workflows/runs/:id this canvas reads for live progress. */
export interface WfRunSnapshot {
  status: string;
  activeNodeId: string | null;
  nodeResultMap: Record<
    string,
    { status: "ok" | "error" | "skipped"; errorMessage: string | null }
  >;
}

export type StepRunStatus =
  | "pending" // not started yet (run still in flight)
  | "running" // currently executing (activeNodeId)
  | "success"
  | "failed"
  | "skipped"
  | "not_run"; // run reached a terminal state without ever executing this step

export interface StepRunState {
  templateId: string;
  nodeId: string;
  status: StepRunStatus;
  errorMessage: string | null;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Map a wf_run snapshot onto the pack's REAL execution order. `templateOrder`
 * is the authoritative order from POST .../run (topologically sorted by the same
 * buildConfigPackGraph that executes the pack) — we render statuses onto it
 * verbatim, never re-sorting.
 */
export function deriveStepStatuses(
  templateOrder: string[],
  run: WfRunSnapshot | null,
): StepRunState[] {
  return templateOrder.map((templateId) => {
    const nodeId = templateNodeId(templateId);
    const result = run?.nodeResultMap?.[nodeId];
    let status: StepRunStatus;
    if (result?.status === "ok") status = "success";
    else if (result?.status === "error") status = "failed";
    else if (result?.status === "skipped") status = "skipped";
    else if (run && run.activeNodeId === nodeId) status = "running";
    else if (run && TERMINAL_RUN_STATUSES.has(run.status)) status = "not_run";
    else status = "pending";
    return { templateId, nodeId, status, errorMessage: result?.errorMessage ?? null };
  });
}

export interface PackProgress {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  running: number;
  /** Steps that reached a terminal per-step outcome (success/failed/skipped). */
  reached: number;
  pct: number;
  anyFailed: boolean;
  /** Index of the currently-running step, or -1. */
  activeIndex: number;
}

export function packProgress(states: StepRunState[]): PackProgress {
  const total = states.length;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let running = 0;
  let activeIndex = -1;
  states.forEach((s, i) => {
    if (s.status === "success") succeeded++;
    else if (s.status === "failed") failed++;
    else if (s.status === "skipped") skipped++;
    else if (s.status === "running") {
      running++;
      if (activeIndex === -1) activeIndex = i;
    }
  });
  const reached = succeeded + failed + skipped;
  return {
    total,
    succeeded,
    failed,
    skipped,
    running,
    reached,
    pct: total === 0 ? 0 : Math.round((reached / total) * 100),
    anyFailed: failed > 0,
    activeIndex,
  };
}

export type RunPhase = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

/** Collapse the raw wf_run status into the phase the progress UI shows. */
export function runPhase(run: WfRunSnapshot | null): RunPhase {
  if (!run) return "queued";
  switch (run.status) {
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused":
      return "paused";
    case "running":
      return "running";
    default:
      return "queued";
  }
}

/** Whether polling should stop — a terminal run, OR a pause (a gated pack halts
 *  at the verification gate and resumes only through the break-glass flow). */
export function isRunSettled(run: WfRunSnapshot | null): boolean {
  return !!run && (TERMINAL_RUN_STATUSES.has(run.status) || run.status === "paused");
}

/**
 * Resolve a pack step back to its REAL write-action template so a single-step
 * run can hand off to the existing Write Actions runner. Returns null when the
 * template isn't in the write-action catalog (never fabricate an execution).
 * This IS the single-step reuse: no second execution path is built here.
 */
export function resolveStepWriteAction(
  templateId: string,
  writeActions: WriteActionNode[],
): WriteActionNode | null {
  return writeActions.find((w) => w.templateId === templateId) ?? null;
}
