/**
 * msp-change-execution.ts — the pure derivations behind the Change Control
 * EXECUTION record (Git #1499).
 *
 * A CR authorizes a change; it does not execute one. This file (and the
 * `cr_executions` table it reasons over) is what records the execution itself:
 * which executor carried the change out, whether what happened matched what was
 * planned, the authorizing `crRef` written back on completion, and — for the one
 * executor no code path can confirm — a human attestation.
 *
 * Everything here is a total function over stored values — no database, no
 * request — the same split `portal-change-control.ts` / `portal-change-approvals.ts`
 * / `portal-cab.ts` follow. The store (`msp-change-execution-store.ts`) and the
 * route (`routes/msp-change-executions.ts`) are where these functions meet the DB,
 * so that the rules describing what happened to a live tenant stay unit-testable
 * in isolation.
 *
 * ── One approval model, one execution model ─────────────────────────────────
 * A rollback is itself a change, so it does NOT get a bespoke "revert" state
 * here: it is a new inverse CR (`msp_change_requests.rollback_of_change_request_id`
 * points back at the original) that clears its own `cr_approvals` and produces
 * its own `cr_executions` row like any other change. `rollbackVerifiedAt` /
 * `rollbackOutcome` are the verification result on THAT inverse execution.
 */

import type {
  CrExecution,
  CrExecutionOutcome,
  CrExecutorKind,
  CrRollbackOutcome,
  ChangeRequestImplementer,
  WfRun,
} from "@workspace/db";
import {
  CR_EXECUTION_OUTCOMES,
  CR_EXECUTOR_KINDS,
  CR_ROLLBACK_OUTCOMES,
} from "@workspace/db";
import { formatChangeRequestCode } from "./portal-change-control";

export {
  CR_EXECUTION_OUTCOMES,
  CR_EXECUTOR_KINDS,
  CR_ROLLBACK_OUTCOMES,
  formatChangeRequestCode,
};
export type { CrExecutionOutcome, CrExecutorKind, CrRollbackOutcome };

// ── Execution outcome from an executor run ───────────────────────────────────

/**
 * Map a Workflow Engine run status to the execution outcome. This is the same
 * settle vocabulary the write gate already reconciles CRs on
 * (`settleAuthorizedChangeRequests`): a `completed` run succeeded; a
 * `failed`/`cancelled` run failed; anything still in flight is `pending`.
 * `rolled_back` is never derived from a run status — it is a lifecycle event a
 * later inverse CR imposes, not a state a run reports.
 */
export function deriveExecutionOutcomeFromRunStatus(status: WfRun["status"]): CrExecutionOutcome {
  switch (status) {
    case "completed":
      return "succeeded";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Whether an execution is confirmed — i.e. the change is known to have actually
 * happened. A `runbook_run` / `write_action` is confirmed once its run
 * succeeded. A `human_action` has no code path to observe it, so it is confirmed
 * ONLY by an attestation: a non-null `attestedAt`. This is the whole reason the
 * attestation columns exist — an unattested human action is indistinguishable
 * from unattributed drift.
 */
export function isExecutionConfirmed(
  row: Pick<CrExecution, "executorKind" | "outcome" | "attestedAt">,
): boolean {
  if (row.executorKind === "human_action") {
    return row.attestedAt !== null;
  }
  return row.outcome === "succeeded";
}

// ── Planned-vs-actual ────────────────────────────────────────────────────────

/**
 * One planned step, normalised out of the config-pack `planOnly` dry-run. The
 * `key` is what a planned step and its actual counterpart are matched on — the
 * template id when there is one, else the check key, else the label.
 */
export interface PlanStep {
  readonly key: string;
  readonly label: string;
  readonly method: string | null;
  readonly endpoint: string | null;
  readonly plannedWrite: Record<string, unknown> | null;
  readonly changeKind: string;
}

/** One actual step, normalised out of the run's per-node outcomes. */
export interface ActualStep {
  readonly key: string;
  readonly label: string;
  readonly status: string;
  readonly output: Record<string, unknown> | null;
  readonly errorMessage: string | null;
}

/** Whether one actual step is present in both plans and matched. */
export type StepPresence = "both" | "planned_only" | "actual_only";

export interface PlanStepDiff {
  readonly key: string;
  readonly label: string;
  readonly presence: StepPresence;
  /** The actual step's status, or null when the step never ran (planned_only). */
  readonly status: string | null;
  /** True when reality deviated from the plan for this step (didn't run, or ran with an error / unplanned). */
  readonly changed: boolean;
  readonly note: string | null;
}

export interface PlanDiff {
  /** True when every planned step ran without error and nothing unplanned failed. */
  readonly matched: boolean;
  readonly plannedCount: number;
  readonly actualCount: number;
  readonly steps: PlanStepDiff[];
}

/** An actual step "succeeded" when its status is one of these — the wf_run node-output ok vocabulary. */
const ACTUAL_OK_STATUSES = new Set(["ok", "completed", "succeeded", "success"]);

/** An actual step is a skip (not a failure, but not an executed write either). */
const ACTUAL_SKIP_STATUSES = new Set(["skipped", "skip"]);

/**
 * Diff the captured plan against what actually happened. Deterministic and
 * total: matching is by `key`, so the same plan and outcome always produce the
 * same diff. A step is `changed` when it was planned but never ran, ran with an
 * error, or ran without ever being planned. `matched` is the AND of "no changed
 * step": the plan is honoured exactly when nothing deviated.
 */
export function diffPlannedVsActual(planned: readonly PlanStep[], actual: readonly ActualStep[]): PlanDiff {
  const actualByKey = new Map(actual.map((a) => [a.key, a] as const));
  const plannedByKey = new Map(planned.map((p) => [p.key, p] as const));
  const steps: PlanStepDiff[] = [];

  for (const p of planned) {
    const a = actualByKey.get(p.key);
    if (!a) {
      steps.push({
        key: p.key,
        label: p.label,
        presence: "planned_only",
        status: null,
        changed: true,
        note: "planned but never executed",
      });
      continue;
    }
    const ok = ACTUAL_OK_STATUSES.has(a.status) || ACTUAL_SKIP_STATUSES.has(a.status);
    steps.push({
      key: p.key,
      label: p.label,
      presence: "both",
      status: a.status,
      changed: !ok,
      note: ok ? null : (a.errorMessage ?? `executed with status '${a.status}'`),
    });
  }

  for (const a of actual) {
    if (plannedByKey.has(a.key)) continue;
    const ok = ACTUAL_OK_STATUSES.has(a.status) || ACTUAL_SKIP_STATUSES.has(a.status);
    steps.push({
      key: a.key,
      label: a.label,
      presence: "actual_only",
      status: a.status,
      // An unplanned step that nonetheless ran clean is still a deviation from
      // the approved plan — the plan did not authorise it.
      changed: true,
      note: ok ? "executed but was not in the approved plan" : (a.errorMessage ?? "unplanned step failed"),
    });
  }

  const matched = steps.every((s) => !s.changed);
  return { matched, plannedCount: planned.length, actualCount: actual.length, steps };
}

// ── Rollback eligibility ─────────────────────────────────────────────────────

/**
 * Whether a change may be rolled back. Only an executed (`completed`) forward
 * change with a stored rollback snippet can be — a change that never landed has
 * nothing to revert, and a change with no `rollbackScriptSnippet` has no defined
 * inverse. An inverse CR (one that is itself a rollback) is not rolled back
 * again: rolling back a rollback is a new forward change, raised on its own.
 */
export function canRaiseRollback(cr: {
  readonly status: string;
  readonly rollbackScriptSnippet: string;
  readonly rollbackOfChangeRequestId: number | null;
}): boolean {
  if (cr.rollbackOfChangeRequestId !== null) return false;
  if (cr.status !== "completed") return false;
  return typeof cr.rollbackScriptSnippet === "string" && cr.rollbackScriptSnippet.trim().length > 0;
}

// ── Wire shape ───────────────────────────────────────────────────────────────

/** One execution record, as the MSP operator surface consumes it. */
export interface WireCrExecution {
  readonly id: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly tenantId: string;
  readonly executorKind: CrExecutorKind;
  readonly wfRunId: number | null;
  readonly packKey: string | null;
  readonly implementer: ChangeRequestImplementer | null;
  readonly outcome: CrExecutionOutcome;
  readonly confirmed: boolean;
  /** The captured planOnly plan, verbatim. NULL until captured. */
  readonly plannedPlan: unknown;
  /** The real per-step outcome. NULL until reconciled. */
  readonly actualOutcome: unknown;
  readonly planMatched: boolean | null;
  readonly planDiff: unknown;
  readonly crRef: string | null;
  readonly writtenBackAt: string | null;
  readonly attestedBy: string | null;
  readonly attestedByPersonId: string | null;
  readonly attestedAt: string | null;
  readonly attestationNote: string | null;
  readonly rollbackVerifiedAt: string | null;
  readonly rollbackOutcome: CrRollbackOutcome | null;
  readonly executedAt: string | null;
  readonly createdAt: string;
}

export function toWireCrExecution(row: CrExecution): WireCrExecution {
  return {
    id: row.id,
    changeRequestId: row.changeRequestId,
    changeCode: formatChangeRequestCode(row.changeRequestId),
    tenantId: row.tenantId,
    executorKind: row.executorKind,
    wfRunId: row.wfRunId,
    packKey: row.packKey,
    implementer: row.implementer,
    outcome: row.outcome,
    confirmed: isExecutionConfirmed(row),
    plannedPlan: row.plannedPlan ?? null,
    actualOutcome: row.actualOutcome ?? null,
    planMatched: row.planMatched,
    planDiff: row.planDiff ?? null,
    crRef: row.crRef,
    writtenBackAt: row.writtenBackAt ? row.writtenBackAt.toISOString() : null,
    attestedBy: row.attestedBy,
    attestedByPersonId: row.attestedByPersonId,
    attestedAt: row.attestedAt ? row.attestedAt.toISOString() : null,
    attestationNote: row.attestationNote,
    rollbackVerifiedAt: row.rollbackVerifiedAt ? row.rollbackVerifiedAt.toISOString() : null,
    rollbackOutcome: row.rollbackOutcome,
    executedAt: row.executedAt ? row.executedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
