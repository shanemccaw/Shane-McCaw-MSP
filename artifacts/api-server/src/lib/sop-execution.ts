/**
 * sop-execution.ts — the SOP/Runbooks execution hook (#1559).
 *
 * The IO half of `sop-workflow-graph.ts`'s pure materialization: loading the
 * SOP + customer, the #1497 Change Control authorization gate, firing through
 * the Workflow Engine, and writing the `msp_sop_runs` row nothing wrote before
 * this issue. Mirrors `config-pack-orchestrator.ts`'s `runConfigPackForCustomer`
 * deliberately closely — same authorization posture, same reused functions
 * (`claimChangeRequestForWrite` / `bindChangeRequestToRun` /
 * `releaseChangeRequestClaim` from `change-control-write-gate.ts`,
 * `persistMaterializedWorkflow` from `config-pack-orchestrator.ts`,
 * `fireWorkflowForDefinition` from `workflow-executor.ts`) — because #1559 is
 * explicit that this must never become a second execution path.
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 * A hybrid SOP mixes automated (write-verb `graphEndpoint`) steps with manual
 * ones. This module only fires the automated prefix through the Workflow
 * Engine; the pre-existing `PATCH /api/msp/sop-runs/:runId` remains how an
 * operator closes out the manual steps by hand — unchanged, already real, not
 * touched here. A run whose automated steps all complete but which still has
 * unclosed manual steps settles to `Blocked` (see `settleSopRuns`) rather than
 * `Completed` — "waiting on something rather than executing" is exactly what
 * that status already means on the read side (`portal-sops.ts`'s
 * `queueStateFor`/`runStateLabel`).
 *
 * ── Reconciliation, not a live callback ──────────────────────────────────────
 * The Workflow Engine has no per-SOP-run completion hook, so — exactly like
 * #1497's `settleAuthorizedChangeRequests` — `settleSopRuns` is a periodic
 * sweep (wired in `index.ts` alongside it) that reads the real `wf_runs` /
 * `wf_run_node_outputs` rows for every run still `In Progress` and advances
 * `currentStepIndex` / `passedStepsCount` / `status` from what actually
 * happened. It reads the run's own `automated_step_map` snapshot, never the
 * SOP's live `steps` (which may have been edited since the run fired).
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  db,
  mspSopsTable,
  mspSopRunsTable,
  tenantsTable,
  wfRunsTable,
  wfRunNodeOutputsTable,
  type MspSopRunOrigin,
  type SopRunAutomatedStep,
} from "@workspace/db";

import { persistMaterializedWorkflow } from "./config-pack-orchestrator";
import { fireWorkflowForDefinition } from "./workflow-executor";
import {
  claimChangeRequestForWrite,
  bindChangeRequestToRun,
  releaseChangeRequestClaim,
} from "./change-control-write-gate";
import { formatChangeRequestCode } from "./portal-change-control";
import { readSteps } from "./portal-sops";
import { buildSopWorkflowGraph, sopDefinitionName } from "./sop-workflow-graph";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.config-pack" });

export type SopExecutionErrorCode =
  | "sop_not_found"
  | "sop_not_runnable"
  | "customer_not_found"
  | "customer_wrong_msp"
  | "customer_not_connected"
  | "missing_variables"
  | "customer_not_testbed"
  | "change_request_not_authorized"
  | "concurrency_limit";

export class SopExecutionError extends Error {
  constructor(
    public readonly code: SopExecutionErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SopExecutionError";
  }
}

export interface RunSopResult {
  runId: number;
  runIdentifier: string;
  wfRunId: number;
  definitionId: number;
  versionId: number;
  reusedVersion: boolean;
  authorizingChangeRequestId: number | null;
  automatedStepCount: number;
  totalSteps: number;
}

/**
 * Fire `sopId` (an MSP's own procedure) for real against `customerId`. Fails
 * closed exactly like `runConfigPackForCustomer`: either an approved,
 * unconsumed Change Request authorizes the write (claimed atomically before
 * anything fires), or the target is a testbed customer. Anything else throws
 * before touching the tenant.
 */
export async function runSopForCustomer(opts: {
  /** The caller's own MSP — the SOP lookup AND the customer-ownership check are both scoped to it. */
  mspId: number;
  sopId: string;
  customerId: number;
  /** Substituted for `{id}`/`{upn}` placeholders — the run's one target entity. */
  targetEntity?: string;
  /** Any other named placeholder a step's endpoint/body references (e.g. `{messageId}`). */
  variables?: Record<string, string>;
  operator: string;
  origin?: MspSopRunOrigin;
  /**
   * #1548/#1550 — the `standing_policies.id` this run enacts, when
   * `origin === "policy"`. Persisted onto `msp_sop_runs.standing_policy_id`,
   * the enactment record a policy-invoked run is traced back through. #1548
   * added that column; this is where it actually gets set — every other
   * origin leaves it null.
   */
  standingPolicyId?: number;
  triggeredBy?: string;
  changeRequestAuthorization?: { changeRequestId: number };
}): Promise<RunSopResult> {
  const { mspId, sopId, customerId } = opts;

  const [sop] = await db
    .select()
    .from(mspSopsTable)
    .where(and(eq(mspSopsTable.mspId, mspId), eq(mspSopsTable.sopId, sopId)))
    .limit(1);
  if (!sop) throw new SopExecutionError("sop_not_found", `SOP '${sopId}' not found`);

  const steps = readSteps(sop.steps);
  const { graph, materialized, requiredVariables } = buildSopWorkflowGraph(steps);
  if (materialized.length === 0) {
    throw new SopExecutionError(
      "sop_not_runnable",
      `SOP '${sopId}' has no automatable step (a step whose graphEndpoint is a POST/PATCH/PUT/DELETE) — nothing for the platform to execute`,
    );
  }

  const [customer] = await db
    .select({
      id: tenantsTable.id,
      mspId: tenantsTable.mspId,
      name: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      isTestbed: tenantsTable.isTestbed,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  if (!customer) throw new SopExecutionError("customer_not_found", `Customer ${customerId} not found`);
  if (customer.mspId !== mspId) {
    // Scoping guard: `msp_sops`/`claimChangeRequestForWrite` are both keyed on
    // mspId, but tenantsTable is a separate row — without this, an operator
    // could run their own SOP against a customer belonging to a different MSP.
    throw new SopExecutionError("customer_wrong_msp", `Customer ${customerId} does not belong to this MSP`);
  }
  if (!customer.tenantId) {
    throw new SopExecutionError("customer_not_connected", `Customer ${customerId} has no connected tenant`);
  }

  const targetEntity = (opts.targetEntity ?? "").trim();
  const payload: Record<string, unknown> = {
    customerId,
    ...(targetEntity ? { id: targetEntity, upn: targetEntity } : {}),
    ...(opts.variables ?? {}),
  };
  const missingVariables = requiredVariables.filter((v) => {
    const value = payload[v];
    return value === undefined || value === "";
  });
  if (missingVariables.length > 0) {
    throw new SopExecutionError(
      "missing_variables",
      `Missing required variables for SOP '${sopId}': ${missingVariables.join(", ")}. Pass targetEntity and/or "variables" in the request body.`,
      { missingVariables },
    );
  }

  // ── Authorization — fail-closed, same posture as runConfigPackForCustomer ──
  let claimedChangeRequestId: number | null = null;
  if (opts.changeRequestAuthorization) {
    const claim = await claimChangeRequestForWrite({
      changeRequestId: opts.changeRequestAuthorization.changeRequestId,
      mspId,
      tenantId: customer.tenantId,
    });
    if (!claim.ok) {
      throw new SopExecutionError(
        "change_request_not_authorized",
        `Change request ${opts.changeRequestAuthorization.changeRequestId} does not authorize this write: ${claim.reason}`,
        { changeRequestId: opts.changeRequestAuthorization.changeRequestId, reason: claim.reason },
      );
    }
    claimedChangeRequestId = claim.changeRequestId;
  } else if (!customer.isTestbed) {
    throw new SopExecutionError(
      "customer_not_testbed",
      `Customer ${customerId} is not a testbed customer — SOP runs write to the live tenant and require a testbed customer or an approved change request`,
    );
  }

  try {
    const { definitionId, versionId, reusedVersion } = await persistMaterializedWorkflow(
      sopDefinitionName(sop.sopId),
      `Materialized from SOP '${sop.sopId}' (${sop.title}). Regenerated automatically on each run request when the SOP's automated steps change — edit the SOP, not this definition.`,
      { sop: sop.sopId, orchestrated: true },
      graph,
    );

    const wfRunId = await fireWorkflowForDefinition(
      definitionId,
      "manual",
      opts.triggeredBy ?? `sop:${sopId}:customer:${customerId}`,
      payload,
      { versionId },
    );
    if (!wfRunId) {
      throw new SopExecutionError(
        "concurrency_limit",
        `Run not started — the definition's concurrency limit is reached (another '${sopId}' run is in flight)`,
      );
    }

    const runIdentifier = `RUN-SOP-${randomUUID()}`;
    const now = new Date();
    const [inserted] = await db
      .insert(mspSopRunsTable)
      .values({
        mspId,
        runId: runIdentifier,
        sopId: sop.sopId,
        sopTitle: sop.title,
        tenantId: customer.tenantId,
        tenantName: customer.name,
        targetEntity,
        operator: opts.operator,
        origin: opts.origin ?? "manual",
        standingPolicyId: opts.standingPolicyId ?? null,
        startedAt: now.toISOString(),
        status: "In Progress",
        currentStepIndex: 0,
        totalSteps: steps.length,
        passedStepsCount: 0,
        // The row's own /^CR-/ test (portal-sops.ts) is what turns this into a
        // CR link on the read side — see that file's header.
        psaTicketId: claimedChangeRequestId !== null ? formatChangeRequestCode(claimedChangeRequestId) : "",
        logs: [
          `Run started — ${materialized.length} of ${steps.length} step(s) automated, firing through wf_run ${wfRunId}.`,
        ],
        wfRunId,
        automatedStepMap: materialized.map(
          (m): SopRunAutomatedStep => ({ nodeId: m.nodeId, stepIndex: m.stepIndex }),
        ),
      })
      .returning({ id: mspSopRunsTable.id });
    if (!inserted) throw new Error(`Failed to insert msp_sop_runs row for '${sopId}'`);

    // Bind LAST — nothing below can throw, matching runConfigPackForCustomer's
    // own ordering, so a failure before this point still lets the release path
    // (below) undo the claim cleanly.
    if (claimedChangeRequestId !== null) {
      await bindChangeRequestToRun(claimedChangeRequestId, wfRunId);
    }

    log.info(
      { sopId, customerId, wfRunId, sopRunId: inserted.id, authorizingChangeRequestId: claimedChangeRequestId },
      "sop-execution: run fired",
    );

    return {
      runId: inserted.id,
      runIdentifier,
      wfRunId,
      definitionId,
      versionId,
      reusedVersion,
      authorizingChangeRequestId: claimedChangeRequestId,
      automatedStepCount: materialized.length,
      totalSteps: steps.length,
    };
  } catch (err) {
    if (claimedChangeRequestId !== null) {
      await releaseChangeRequestClaim(claimedChangeRequestId).catch((releaseErr: unknown) => {
        log.error(
          { err: releaseErr, changeRequestId: claimedChangeRequestId },
          "sop-execution: failed to release CR claim after a run error",
        );
      });
    }
    throw err;
  }
}

// ── Reconciliation sweep ─────────────────────────────────────────────────────

export interface SettleSopRunsResult {
  readonly advanced: number;
  readonly completed: number;
  readonly blocked: number;
  readonly failed: number;
}

/**
 * For every `msp_sop_runs` row still `In Progress` with a bound `wf_run_id`,
 * read the real `wf_runs` status and `wf_run_node_outputs` for the run's own
 * `automated_step_map`, and advance the row to match. Idempotent and
 * non-fatal by construction — a run whose wf_run is still `running`/`pending`
 * is left with just its progress counters moved.
 */
export async function settleSopRuns(now: Date = new Date()): Promise<SettleSopRunsResult> {
  const inFlight = await db
    .select()
    .from(mspSopRunsTable)
    .where(and(eq(mspSopRunsTable.status, "In Progress"), isNotNull(mspSopRunsTable.wfRunId)));

  let advanced = 0;
  let completed = 0;
  let blocked = 0;
  let failed = 0;

  for (const run of inFlight) {
    const wfRunId = run.wfRunId;
    if (wfRunId == null) continue;

    const [wfRun] = await db
      .select({ status: wfRunsTable.status, finishedAt: wfRunsTable.finishedAt, errorMessage: wfRunsTable.errorMessage })
      .from(wfRunsTable)
      .where(eq(wfRunsTable.id, wfRunId))
      .limit(1);
    if (!wfRun) continue;

    const map = (Array.isArray(run.automatedStepMap) ? run.automatedStepMap : []) as SopRunAutomatedStep[];
    const sortedMap = [...map].sort((a, b) => a.stepIndex - b.stepIndex);

    let passedStepsCount = run.passedStepsCount;
    let anyNodeError = false;

    if (sortedMap.length > 0) {
      const outputs = await db
        .select({ nodeId: wfRunNodeOutputsTable.nodeId, status: wfRunNodeOutputsTable.status })
        .from(wfRunNodeOutputsTable)
        .where(eq(wfRunNodeOutputsTable.runId, wfRunId));
      const byNode = new Map(outputs.map((o) => [o.nodeId, o.status]));

      let count = 0;
      for (const step of sortedMap) {
        const status = byNode.get(step.nodeId);
        if (status === "ok") {
          count = step.stepIndex + 1;
          continue;
        }
        if (status === "error") anyNodeError = true;
        break; // chain is linear — the first non-ok node is where progress stops
      }
      passedStepsCount = count;
    }

    const currentStepIndex = Math.min(passedStepsCount, Math.max(run.totalSteps - 1, 0));

    let nextStatus = run.status;
    let completedAt = run.completedAt;
    const logsAppend: string[] = [];

    if (anyNodeError || wfRun.status === "failed") {
      nextStatus = "Failed";
      completedAt = (wfRun.finishedAt ?? now).toISOString();
      if (run.status !== "Failed") {
        failed += 1;
        if (wfRun.errorMessage) logsAppend.push(`Run failed: ${wfRun.errorMessage}`);
      }
    } else if (wfRun.status === "cancelled") {
      nextStatus = "Failed";
      completedAt = (wfRun.finishedAt ?? now).toISOString();
      if (run.status !== "Failed") {
        failed += 1;
        logsAppend.push("Run cancelled.");
      }
    } else if (wfRun.status === "completed") {
      if (passedStepsCount >= run.totalSteps) {
        nextStatus = "Completed";
        completedAt = (wfRun.finishedAt ?? now).toISOString();
        completed += 1;
      } else {
        // Automated steps done; manual steps remain — a human closes them out
        // via the pre-existing PATCH /api/msp/sop-runs/:runId.
        nextStatus = "Blocked";
        blocked += 1;
      }
    }
    // Otherwise the wf_run is still pending/running/awaiting_approval — stays
    // "In Progress"; only the progress counters below may have moved.

    const changed =
      nextStatus !== run.status || passedStepsCount !== run.passedStepsCount || currentStepIndex !== run.currentStepIndex;
    if (!changed) continue;

    await db
      .update(mspSopRunsTable)
      .set({
        status: nextStatus,
        passedStepsCount,
        currentStepIndex,
        completedAt,
        logs: logsAppend.length > 0 ? [...(Array.isArray(run.logs) ? run.logs : []), ...logsAppend] : run.logs,
        updatedAt: now,
      })
      .where(eq(mspSopRunsTable.id, run.id));
    advanced += 1;
  }

  if (advanced > 0) {
    log.info({ advanced, completed, blocked, failed }, "sop-execution: reconciliation sweep advanced runs");
  }
  return { advanced, completed, blocked, failed };
}
