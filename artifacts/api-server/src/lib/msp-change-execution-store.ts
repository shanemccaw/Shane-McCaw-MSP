/**
 * msp-change-execution-store.ts — the DB side of the Change Control EXECUTION
 * record (Git #1499). The pure rules live in `msp-change-execution.ts`; this is
 * where they touch `cr_executions`, `msp_change_requests`, `wf_runs` /
 * `wf_run_node_outputs`, and — for a rollback, which is itself a change — the
 * #1496 approval ledger via `portal-change-approvals-store.ts`.
 *
 * Nothing here EXECUTES a change: the executor is the config-pack run (or a
 * person, for a human action). This module records the execution, writes back
 * the authorizing `crRef` on completion, reconciles the captured plan against the
 * real outcome, and raises/verifies the inverse CR a rollback is.
 */

import {
  db,
  crExecutionsTable,
  mspChangeRequestsTable,
  tenantsTable,
  wfRunsTable,
  wfRunNodeOutputsTable,
  type ChangeRequestImplementer,
  type CrExecution,
  type CrExecutorKind,
  type CrRollbackOutcome,
  type MspChangeRequest,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  actualStepsFromRunNodes,
  diffPlannedVsActual,
  formatChangeRequestCode,
  planStepsFromDryRun,
  type PlanDiff,
} from "./msp-change-execution";
import { loadApprovalPolicy, materializeApprovalsForChange } from "./portal-change-approvals-store";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

// ── Recording an execution ───────────────────────────────────────────────────

export interface RecordExecutionInput {
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  readonly executorKind: CrExecutorKind;
  /** The wf_run that executed this change (runbook/write executions). NULL for a human action. */
  readonly wfRunId?: number | null;
  readonly packKey?: string | null;
  readonly implementer?: ChangeRequestImplementer | null;
  /** The captured `planOnly` dry-run (a ConfigPackDryRun), stored verbatim. */
  readonly plannedPlan?: unknown;
  // Human-action attestation, supplied when the recorded execution IS an attested human action.
  readonly attestedBy?: string | null;
  readonly attestedByPersonId?: string | null;
  readonly attestationNote?: string | null;
}

/**
 * Record one execution of an authorized change. A `runbook_run` / `write_action`
 * starts `pending` — its crRef is written back only once its run completes
 * (`settleChangeExecutions`). A `human_action` supplied WITH an attestation is
 * confirmed at record time: the attestation is the completion, so its crRef is
 * written back immediately. A `human_action` with no attestation stays `pending`
 * until `attestHumanAction` is called.
 */
export async function recordExecution(input: RecordExecutionInput): Promise<CrExecution> {
  const now = new Date();
  const isAttestedHuman = input.executorKind === "human_action" && !!(input.attestedBy && input.attestedBy.trim());

  const [row] = await db
    .insert(crExecutionsTable)
    .values({
      changeRequestId: input.changeRequestId,
      mspId: input.mspId,
      tenantId: input.tenantId,
      executorKind: input.executorKind,
      wfRunId: input.wfRunId ?? null,
      packKey: input.packKey ?? null,
      implementer: input.implementer ?? null,
      plannedPlan: input.plannedPlan ?? null,
      outcome: isAttestedHuman ? "succeeded" : "pending",
      attestedBy: input.attestedBy ?? null,
      attestedByPersonId: input.attestedByPersonId ?? null,
      attestedAt: isAttestedHuman ? now : null,
      attestationNote: input.attestationNote ?? null,
      // A confirmed human action completes the moment it is attested: write back
      // the authorizing reference and stamp the execution time now.
      crRef: isAttestedHuman ? formatChangeRequestCode(input.changeRequestId) : null,
      writtenBackAt: isAttestedHuman ? now : null,
      executedAt: isAttestedHuman ? now : null,
    })
    .returning();

  log.info(
    { changeRequestId: input.changeRequestId, executionId: row.id, executorKind: input.executorKind, wfRunId: input.wfRunId ?? null },
    "cr-execution: recorded",
  );
  return row;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getExecution(mspId: number, executionId: number): Promise<CrExecution | null> {
  const [row] = await db
    .select()
    .from(crExecutionsTable)
    .where(and(eq(crExecutionsTable.id, executionId), eq(crExecutionsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

export async function listExecutionsForChange(mspId: number, changeRequestId: number): Promise<CrExecution[]> {
  return db
    .select()
    .from(crExecutionsTable)
    .where(and(eq(crExecutionsTable.mspId, mspId), eq(crExecutionsTable.changeRequestId, changeRequestId)))
    .orderBy(desc(crExecutionsTable.createdAt));
}

export async function listExecutionsForMsp(mspId: number, limit = 100): Promise<CrExecution[]> {
  return db
    .select()
    .from(crExecutionsTable)
    .where(eq(crExecutionsTable.mspId, mspId))
    .orderBy(desc(crExecutionsTable.createdAt))
    .limit(limit);
}

// ── Human-action attestation ─────────────────────────────────────────────────

export interface AttestInput {
  readonly attestedBy: string;
  readonly attestedByPersonId: string | null;
  readonly attestationNote: string | null;
}

/**
 * Attest a previously-recorded, still-unattested human action. Guarded on
 * `executor_kind = 'human_action'` and `attested_at IS NULL` so a code-observed
 * execution can never be "attested" and an attestation can never be overwritten.
 * The attestation IS the completion, so this also writes back the crRef.
 */
export async function attestHumanAction(
  mspId: number,
  executionId: number,
  input: AttestInput,
): Promise<CrExecution | null> {
  const existing = await getExecution(mspId, executionId);
  if (!existing || existing.executorKind !== "human_action" || existing.attestedAt !== null) return null;

  const now = new Date();
  const [row] = await db
    .update(crExecutionsTable)
    .set({
      attestedBy: input.attestedBy,
      attestedByPersonId: input.attestedByPersonId,
      attestationNote: input.attestationNote,
      attestedAt: now,
      outcome: "succeeded",
      // The attestation is the completion: write back the authorizing reference.
      crRef: formatChangeRequestCode(existing.changeRequestId),
      writtenBackAt: now,
      executedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(crExecutionsTable.id, executionId),
        eq(crExecutionsTable.mspId, mspId),
        eq(crExecutionsTable.executorKind, "human_action"),
        isNull(crExecutionsTable.attestedAt),
      ),
    )
    .returning();
  if (!row) return null;
  log.info({ mspId, executionId, changeRequestId: row.changeRequestId }, "cr-execution: human action attested");
  return row;
}

// ── crRef writeback: the completion sweep ────────────────────────────────────

export interface SettleExecutionsResult {
  /** Executions whose run completed → crRef written back, outcome succeeded. */
  readonly writtenBack: number;
  /** Executions whose run failed/cancelled → outcome failed (no crRef writeback). */
  readonly failed: number;
}

/**
 * The completion sweep for run-backed executions — the mechanical half of "the
 * authorizing CR reference written back on completion of the authorized action".
 * For every still-`pending` runbook/write execution bound to a finished run:
 *   • run `completed`            → outcome `succeeded`, `cr_ref = CR-<id>`,
 *     `written_back_at`/`executed_at` stamped from the run's finish. A change
 *     that actually landed now carries its authorizing reference, which is what
 *     lets drift attribution read it as approved rather than unattributed.
 *   • run `failed` / `cancelled` → outcome `failed`, NO crRef writeback: a change
 *     that did not happen must never be cited as authorization for later drift.
 *
 * Idempotent and non-fatal by construction — a pending execution whose run is
 * still running is left alone, and a second sweep finds nothing to do. Meant to
 * run in the same 60s reconciliation tick as `settleAuthorizedChangeRequests`.
 */
export async function settleChangeExecutions(now: Date = new Date()): Promise<SettleExecutionsResult> {
  const pending = await db
    .select({
      execId: crExecutionsTable.id,
      changeRequestId: crExecutionsTable.changeRequestId,
      runStatus: wfRunsTable.status,
      finishedAt: wfRunsTable.finishedAt,
    })
    .from(crExecutionsTable)
    .innerJoin(wfRunsTable, eq(crExecutionsTable.wfRunId, wfRunsTable.id))
    .where(
      and(
        eq(crExecutionsTable.outcome, "pending"),
        inArray(crExecutionsTable.executorKind, ["runbook_run", "write_action"]),
        inArray(wfRunsTable.status, ["completed", "failed", "cancelled"]),
      ),
    );

  let writtenBack = 0;
  let failed = 0;
  for (const row of pending) {
    const executedAt = row.finishedAt ?? now;
    if (row.runStatus === "completed") {
      const updated = await db
        .update(crExecutionsTable)
        .set({
          outcome: "succeeded",
          crRef: formatChangeRequestCode(row.changeRequestId),
          writtenBackAt: now,
          executedAt,
          updatedAt: now,
        })
        .where(and(eq(crExecutionsTable.id, row.execId), eq(crExecutionsTable.outcome, "pending")))
        .returning({ id: crExecutionsTable.id });
      if (updated.length > 0) {
        writtenBack += 1;
        log.info(
          { executionId: row.execId, changeRequestId: row.changeRequestId, crRef: formatChangeRequestCode(row.changeRequestId) },
          "cr-execution: crRef written back — executor run completed",
        );
      }
    } else {
      const updated = await db
        .update(crExecutionsTable)
        .set({ outcome: "failed", executedAt, updatedAt: now })
        .where(and(eq(crExecutionsTable.id, row.execId), eq(crExecutionsTable.outcome, "pending")))
        .returning({ id: crExecutionsTable.id });
      if (updated.length > 0) failed += 1;
    }
  }

  if (writtenBack > 0 || failed > 0) {
    log.info({ writtenBack, failed }, "cr-execution: completion sweep done");
  }
  return { writtenBack, failed };
}

// ── Planned-vs-actual reconciliation ─────────────────────────────────────────

/**
 * Diff a captured plan against the run's real per-node outcome and persist the
 * result on the execution. Reads the stored `planned_plan` and the run's
 * `wf_run_node_outputs`, normalises both to comparable steps, and writes
 * `actual_outcome` / `plan_matched` / `plan_diff`. Returns the computed diff, or
 * null when the execution is unknown to this MSP or carries no captured plan /
 * bound run to reconcile against.
 */
export async function reconcileExecutionPlan(mspId: number, executionId: number): Promise<PlanDiff | null> {
  const exec = await getExecution(mspId, executionId);
  if (!exec || exec.plannedPlan == null || exec.wfRunId == null) return null;

  const nodeRows = await db
    .select({
      nodeId: wfRunNodeOutputsTable.nodeId,
      status: wfRunNodeOutputsTable.status,
      output: wfRunNodeOutputsTable.output,
      errorMessage: wfRunNodeOutputsTable.errorMessage,
    })
    .from(wfRunNodeOutputsTable)
    .where(eq(wfRunNodeOutputsTable.runId, exec.wfRunId));

  const planned = planStepsFromDryRun(exec.plannedPlan);
  const actual = actualStepsFromRunNodes(nodeRows);
  const diff = diffPlannedVsActual(planned, actual);

  const now = new Date();
  await db
    .update(crExecutionsTable)
    .set({
      actualOutcome: { steps: actual },
      planMatched: diff.matched,
      planDiff: diff,
      updatedAt: now,
    })
    .where(eq(crExecutionsTable.id, executionId));

  log.info({ mspId, executionId, matched: diff.matched, plannedCount: diff.plannedCount, actualCount: diff.actualCount }, "cr-execution: planned-vs-actual reconciled");
  return diff;
}

// ── Rollback: an inverse CR is itself a change ───────────────────────────────

export interface ExecutionActor {
  readonly email: string;
  readonly personId: string | null;
}

export type RaiseRollbackResult =
  | { readonly ok: true; readonly inverse: MspChangeRequest; readonly approvalsCreated: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Raise the INVERSE change request that a rollback is. This does NOT revert the
 * tenant — it creates a new `msp_change_requests` row pointing back at the
 * original (`rollback_of_change_request_id`) and seeds its own `cr_approvals`
 * ledger, so the revert must clear approval and be executed through the same
 * authorization gate as any forward change. The inverse's `proposedPayload` is
 * the original's `preChangeSnapshot` (restore the prior state) and it carries the
 * original's `rollbackScriptSnippet` as the thing to run.
 *
 * The original CR is NOT flipped to `rolled_back` here — that only happens once
 * the inverse execution is VERIFIED (`verifyRollback`). Raising a rollback that
 * is never approved or executed must not falsely mark the original reverted.
 */
export async function raiseRollbackChangeRequest(
  mspId: number,
  originalChangeRequestId: number,
  actor: ExecutionActor,
): Promise<RaiseRollbackResult> {
  const [orig] = await db
    .select()
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, originalChangeRequestId), eq(mspChangeRequestsTable.mspId, mspId)))
    .limit(1);

  if (!orig) return { ok: false, reason: "change request not found for this MSP" };
  if (orig.rollbackOfChangeRequestId !== null) {
    return { ok: false, reason: "a rollback cannot itself be rolled back — raise a new forward change instead" };
  }
  if (orig.status !== "completed") {
    return { ok: false, reason: `only a completed change can be rolled back (this one is '${orig.status}')` };
  }
  if (!orig.rollbackScriptSnippet || orig.rollbackScriptSnippet.trim().length === 0) {
    return { ok: false, reason: "this change has no defined rollback and cannot be reverted automatically" };
  }

  const nowIso = new Date().toISOString();
  const [inverse] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: orig.mspId,
      tenantId: orig.tenantId,
      tenantName: orig.tenantName,
      primaryDomain: orig.primaryDomain,
      title: `Rollback of ${formatChangeRequestCode(orig.id)} — ${orig.title}`,
      description: `Inverse change to revert ${formatChangeRequestCode(orig.id)}. Restores the pre-change state captured before that change was executed.`,
      changeClass: orig.changeClass,
      riskLevel: orig.riskLevel,
      category: orig.category,
      targetResource: orig.targetResource,
      psaTicketId: orig.psaTicketId,
      requestedBy: actor.email,
      requestedAt: nowIso,
      scheduledFor: nowIso,
      impactedUsersCount: orig.impactedUsersCount,
      status: "pending_approval",
      backupVerified: orig.backupVerified,
      backupHash: orig.backupHash,
      // The revert restores the original's pre-change snapshot; its own
      // pre-change state is what the original had applied.
      preChangeSnapshot: orig.proposedPayload,
      proposedPayload: orig.preChangeSnapshot,
      rollbackScriptSnippet: orig.rollbackScriptSnippet,
      implementer: orig.implementer,
      linkedFinding: `Rollback of ${formatChangeRequestCode(orig.id)}`,
      rollbackOfChangeRequestId: orig.id,
    })
    .returning();

  // Seed the inverse CR's OWN approval ledger — it clears approval like any
  // change, honouring the tenant's policy floor (#1759).
  const policy = await loadApprovalPolicy(await resolveTenantRowId(orig));
  const approvalsCreated = await materializeApprovalsForChange(
    {
      id: inverse.id,
      mspId: inverse.mspId,
      tenantId: inverse.tenantId,
      changeClass: inverse.changeClass,
      riskLevel: inverse.riskLevel,
      status: inverse.status,
      approvedBy: inverse.approvedBy,
      requestedBy: inverse.requestedBy,
      createdAt: inverse.createdAt,
    },
    policy,
  );

  log.info(
    { mspId, originalChangeRequestId: orig.id, inverseId: inverse.id, inverseCode: formatChangeRequestCode(inverse.id), approvalsCreated },
    "cr-execution: inverse rollback CR raised",
  );
  return { ok: true, inverse, approvalsCreated };
}

/**
 * Resolve the `tenants.id` a CR's approval policy is keyed by, from the CR's
 * tenant GUID + MSP. `portal_change_control_policy` is keyed by `tenants.id`
 * (`loadApprovalPolicy(customerId)`); the CR carries the tenant GUID. Returns 0
 * (→ NO_POLICY, current behaviour) when the tenant row can't be resolved.
 */
async function resolveTenantRowId(cr: Pick<MspChangeRequest, "mspId" | "tenantId">): Promise<number> {
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.mspId, cr.mspId), eq(tenantsTable.tenantId, cr.tenantId)))
    .limit(1);
  return row?.id ?? 0;
}

// ── Rollback verification ────────────────────────────────────────────────────

/**
 * Record the verification result on a rollback execution — an execution whose CR
 * is an inverse CR. On a `verified` outcome this also closes the loop: the
 * ORIGINAL change is flipped to `rolled_back` and its forward execution's outcome
 * is marked `rolled_back`, which is the only place a forward execution reaches
 * that state (it is a lifecycle event a later inverse imposes, never a run
 * status). Returns null when the execution is unknown to this MSP or is not a
 * rollback execution.
 */
export async function verifyRollback(
  mspId: number,
  executionId: number,
  outcome: CrRollbackOutcome,
): Promise<CrExecution | null> {
  const exec = await getExecution(mspId, executionId);
  if (!exec) return null;

  const [inverseCr] = await db
    .select({ id: mspChangeRequestsTable.id, rollbackOf: mspChangeRequestsTable.rollbackOfChangeRequestId })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, exec.changeRequestId), eq(mspChangeRequestsTable.mspId, mspId)))
    .limit(1);
  if (!inverseCr || inverseCr.rollbackOf === null) return null;

  const now = new Date();
  const [updated] = await db
    .update(crExecutionsTable)
    .set({ rollbackVerifiedAt: outcome === "verified" ? now : null, rollbackOutcome: outcome, updatedAt: now })
    .where(and(eq(crExecutionsTable.id, executionId), eq(crExecutionsTable.mspId, mspId)))
    .returning();

  if (outcome === "verified") {
    // Close the loop on the ORIGINAL change and its forward execution.
    await db
      .update(mspChangeRequestsTable)
      .set({ status: "rolled_back", updatedAt: now })
      .where(and(eq(mspChangeRequestsTable.id, inverseCr.rollbackOf), eq(mspChangeRequestsTable.mspId, mspId)));
    await db
      .update(crExecutionsTable)
      .set({ outcome: "rolled_back", updatedAt: now })
      .where(and(eq(crExecutionsTable.changeRequestId, inverseCr.rollbackOf), eq(crExecutionsTable.mspId, mspId)));
    log.info(
      { mspId, executionId, originalChangeRequestId: inverseCr.rollbackOf },
      "cr-execution: rollback verified — original change marked rolled_back",
    );
  }
  return updated ?? null;
}
