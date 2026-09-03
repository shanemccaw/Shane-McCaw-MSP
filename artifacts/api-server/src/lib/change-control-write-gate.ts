/**
 * change-control-write-gate.ts — Change Control as the AUTHORIZATION GATE on the
 * tenant write path (#1497).
 *
 * The control-flow inversion: an approved Change Request *is* the permission to
 * write to a customer's live Microsoft tenant. Change Control stops being a
 * module beside the write path and becomes a gate INSIDE it — the config-pack
 * orchestrator (`runConfigPackForCustomer`) refuses to fire unless one of these
 * claims succeeds. Fail-closed: no approved, unconsumed CR for the target tenant,
 * no tenant write.
 *
 *   1. `evaluateChangeRequestAuthorization` — the PURE rule (no DB) that decides
 *      whether a loaded CR authorizes a write. Unit-tested in isolation, the same
 *      discipline `portal-change-approvals.ts` follows, because this is a function
 *      that decides what may be done to a live tenant.
 *   2. `claimChangeRequestForWrite` — loads the CR scoped to (mspId, tenantId),
 *      folds its `cr_approvals` ledger, evaluates the rule, and — only if it
 *      passes — ATOMICALLY claims the CR (`pending_approval`/`scheduled` ->
 *      `in_progress`). The atomic claim is the concurrency guard: two runs racing
 *      the same CR, only one wins the transition.
 *   3. `bindChangeRequestToRun` / `releaseChangeRequestClaim` — stamp the wf_run
 *      that executes the claimed CR, or release the claim if the run never fired.
 *   4. `settleAuthorizedChangeRequests` — the reconciliation sweep: closes a CR to
 *      `completed` once its executor run has completed (which is what makes the
 *      `CR-<id>` reference available to drift attribution — the live bug this
 *      fixes by construction), and releases a CR whose executor run failed so it
 *      can be retried.
 *
 * "A CR authorizes; it does not execute." Nothing here fires a workflow — the
 * executor is the config-pack run. This module only gates it and records the
 * link.
 */

import {
  db,
  crApprovalsTable,
  mspChangeRequestsTable,
  wfRunsTable,
  type CrApproval,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { requiredStages, summarizeApprovals } from "./portal-change-approvals";
import { formatChangeRequestCode, type StoredChangeClass, type StoredRiskLevel } from "./portal-change-control";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

/** Stored statuses from which an approved CR may be claimed to authorize a write. */
const CLAIMABLE_STATUSES = ["pending_approval", "scheduled"] as const;

/** Stored statuses that are terminal for a CR — it can never authorize a write. */
const TERMINAL_STATUSES = new Set(["completed", "rolled_back", "rejected"]);

/** The verdict of the pure authorization rule. */
export type ChangeRequestAuthorizationVerdict =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly reason: string };

/** The CR facts the pure rule reasons over — everything it needs, nothing from a request. */
export interface ChangeRequestAuthorizationFacts {
  /** False when no CR scoped to the caller's tenant was found. */
  readonly found: boolean;
  /** The stored `msp_change_requests.status`. */
  readonly status: string;
  /** The wf_run already bound to this CR, if any — a non-null value means already consumed. */
  readonly executorRunId: number | null;
  /** Whether every required approval stage has cleared (from the #1496 ledger). */
  readonly approvalComplete: boolean;
  /**
   * #1773 — the `pack:<packKey>` / `sop:<sopId>` this CR was scoped to at raise
   * time, from `msp_change_requests.authorized_target_key`. `undefined`/`null`
   * means the CR was never pinned to one target — #1497's original
   * tenant-granularity model, unaffected by this check.
   */
  readonly authorizedTargetKey?: string | null;
  /**
   * The `pack:<packKey>` / `sop:<sopId>` the caller is actually about to
   * execute under this claim. Only compared against `authorizedTargetKey` when
   * the CR carries one — an unscoped CR still authorizes any target for this
   * tenant, exactly as before #1773.
   */
  readonly requestedTargetKey?: string | null;
}

/**
 * PURE — does a loaded CR authorize a write? Fail-closed: every branch that is
 * not an unambiguous yes returns `authorized: false` with a specific reason.
 * Never reads a database or a request; unit-tested in isolation.
 */
export function evaluateChangeRequestAuthorization(
  facts: ChangeRequestAuthorizationFacts,
): ChangeRequestAuthorizationVerdict {
  if (!facts.found) {
    return { authorized: false, reason: "no change request scoped to this tenant" };
  }
  if (TERMINAL_STATUSES.has(facts.status)) {
    return { authorized: false, reason: `change request is already ${facts.status}` };
  }
  if (facts.executorRunId !== null) {
    return {
      authorized: false,
      reason: `change request is already executing under run ${facts.executorRunId}`,
    };
  }
  if (!(CLAIMABLE_STATUSES as readonly string[]).includes(facts.status)) {
    return { authorized: false, reason: `change request status '${facts.status}' is not an authorizable state` };
  }
  if (!facts.approvalComplete) {
    return { authorized: false, reason: "change request approval is not complete" };
  }
  // #1773 — a CR scoped to a specific target at raise time may ONLY authorize
  // that target. Fail-closed on a mismatch even though every other branch above
  // already passed; an unscoped CR (authorizedTargetKey null/undefined) still
  // authorizes any target for this tenant, exactly as before this check existed.
  if (facts.authorizedTargetKey != null && facts.authorizedTargetKey !== facts.requestedTargetKey) {
    return {
      authorized: false,
      reason: `change request is scoped to '${facts.authorizedTargetKey}', not '${facts.requestedTargetKey ?? "(unscoped)"}'`,
    };
  }
  return { authorized: true };
}

/** The result of trying to claim a CR to authorize a write. */
export type ClaimOutcome =
  | { readonly ok: true; readonly changeRequestId: number; readonly code: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether a set of approval rows means the CR is fully approved, per the #1496
 * model (`requiredStages` derived from class/risk, not row count).
 */
function isApprovalComplete(
  approvals: readonly Pick<CrApproval, "stage" | "decision" | "dueAt">[],
  changeClass: string,
  riskLevel: string,
  now: Date,
): boolean {
  const required = requiredStages(changeClass as StoredChangeClass, riskLevel as StoredRiskLevel);
  return summarizeApprovals(approvals, required, now).complete;
}

/**
 * Load the CR scoped to (id, mspId, tenantId), fold its approval ledger, evaluate
 * the pure rule, and — only if authorized — ATOMICALLY claim it
 * (`pending_approval`/`scheduled` -> `in_progress`). The atomic UPDATE is the
 * fail-closed concurrency guard: if it transitions 0 rows the CR was consumed by
 * a racing run in the same instant, and this returns `ok: false`.
 *
 * On success the CR is `in_progress` with `executor_run_id` still NULL — the
 * caller binds the real run id via `bindChangeRequestToRun` the moment it fires,
 * or releases the claim via `releaseChangeRequestClaim` if the run never starts.
 */
export async function claimChangeRequestForWrite(opts: {
  changeRequestId: number;
  mspId: number;
  tenantId: string;
  /**
   * #1773 — the `pack:<packKey>` / `sop:<sopId>` this write is actually about
   * to execute. Compared against the claimed CR's own `authorizedTargetKey`
   * when it has one; omitted/undefined is fine for a CR that was never scoped
   * to a single target (#1497's original tenant-granularity model).
   */
  targetKey?: string;
  now?: Date;
}): Promise<ClaimOutcome> {
  const now = opts.now ?? new Date();

  const [cr] = await db
    .select({
      id: mspChangeRequestsTable.id,
      changeClass: mspChangeRequestsTable.changeClass,
      riskLevel: mspChangeRequestsTable.riskLevel,
      status: mspChangeRequestsTable.status,
      executorRunId: mspChangeRequestsTable.executorRunId,
      authorizedTargetKey: mspChangeRequestsTable.authorizedTargetKey,
    })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.id, opts.changeRequestId),
        eq(mspChangeRequestsTable.mspId, opts.mspId),
        eq(mspChangeRequestsTable.tenantId, opts.tenantId),
      ),
    )
    .limit(1);

  if (!cr) {
    const verdict = evaluateChangeRequestAuthorization({
      found: false,
      status: "",
      executorRunId: null,
      approvalComplete: false,
    });
    return { ok: false, reason: verdict.authorized ? "" : verdict.reason };
  }

  const approvals = await db
    .select({ stage: crApprovalsTable.stage, decision: crApprovalsTable.decision, dueAt: crApprovalsTable.dueAt })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, cr.id));

  const verdict = evaluateChangeRequestAuthorization({
    found: true,
    status: cr.status,
    executorRunId: cr.executorRunId,
    approvalComplete: isApprovalComplete(approvals, cr.changeClass, cr.riskLevel, now),
    authorizedTargetKey: cr.authorizedTargetKey,
    requestedTargetKey: opts.targetKey ?? null,
  });
  if (!verdict.authorized) {
    return { ok: false, reason: verdict.reason };
  }

  // Atomic claim. The status predicate is the concurrency guard: once one run
  // wins the transition to in_progress, no second claim can match.
  const claimed = await db
    .update(mspChangeRequestsTable)
    .set({ status: "in_progress", updatedAt: now })
    .where(
      and(
        eq(mspChangeRequestsTable.id, cr.id),
        inArray(mspChangeRequestsTable.status, [...CLAIMABLE_STATUSES]),
        isNull(mspChangeRequestsTable.executorRunId),
      ),
    )
    .returning({ id: mspChangeRequestsTable.id });

  if (claimed.length === 0) {
    return { ok: false, reason: "change request was claimed by a concurrent write" };
  }

  log.info(
    { changeRequestId: cr.id, mspId: opts.mspId, code: formatChangeRequestCode(cr.id) },
    "change-control-write-gate: CR claimed to authorize a tenant write",
  );
  return { ok: true, changeRequestId: cr.id, code: formatChangeRequestCode(cr.id) };
}

/**
 * Stamp the wf_run that is executing a claimed CR. Guarded on `status = in_progress`
 * so it only ever binds a CR this gate actually claimed.
 */
export async function bindChangeRequestToRun(
  changeRequestId: number,
  runId: number,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(mspChangeRequestsTable)
    .set({ executorRunId: runId, updatedAt: now })
    .where(and(eq(mspChangeRequestsTable.id, changeRequestId), eq(mspChangeRequestsTable.status, "in_progress")));
}

/**
 * Release a claim whose run never fired (e.g. the pack hit its concurrency limit
 * or a pre-fire error). Returns the CR to `pending_approval` — its approval
 * ledger is untouched, so it still reads as approved and can authorize a retry.
 * Guarded on `executor_run_id IS NULL` so a claim that DID bind a run is never
 * torn back out from under the executor.
 */
export async function releaseChangeRequestClaim(
  changeRequestId: number,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(mspChangeRequestsTable)
    .set({ status: "pending_approval", executorRunId: null, updatedAt: now })
    .where(
      and(
        eq(mspChangeRequestsTable.id, changeRequestId),
        eq(mspChangeRequestsTable.status, "in_progress"),
        isNull(mspChangeRequestsTable.executorRunId),
      ),
    );
}

/** How many CRs the reconciliation sweep settled this run. */
export interface SettleResult {
  /** CRs closed to `completed` because their executor run completed. */
  readonly completed: number;
  /** CRs released back to `pending_approval` because their executor run failed/cancelled. */
  readonly released: number;
}

/**
 * The reconciliation sweep — "its completion is what closes the CR and makes the
 * reference available". For every CR still `in_progress` with a bound executor
 * run:
 *   • run `completed`            → close the CR to `completed`, stamp `executed_at`
 *     (from the run's `finished_at`). This is what lets monitor-executor's
 *     attribution query (which matches `status = 'completed'`) finally find the
 *     CR and attribute the resulting drift to `CR-<id>` — the live bug fixed by
 *     construction.
 *   • run `failed` / `cancelled` → release the claim so the approved CR can
 *     authorize a retry (approval ledger untouched).
 *
 * Idempotent and non-fatal by construction: a CR whose run is still `running`
 * is left alone, and a second sweep finds nothing to do.
 */
export async function settleAuthorizedChangeRequests(now: Date = new Date()): Promise<SettleResult> {
  // ── Completed executor runs → close the CR ──
  const done = await db
    .select({ crId: mspChangeRequestsTable.id, finishedAt: wfRunsTable.finishedAt })
    .from(mspChangeRequestsTable)
    .innerJoin(wfRunsTable, eq(mspChangeRequestsTable.executorRunId, wfRunsTable.id))
    .where(and(eq(mspChangeRequestsTable.status, "in_progress"), eq(wfRunsTable.status, "completed")));

  let completed = 0;
  for (const row of done) {
    const executedAt = (row.finishedAt ?? now).toISOString();
    const updated = await db
      .update(mspChangeRequestsTable)
      .set({ status: "completed", executedAt, updatedAt: now })
      .where(and(eq(mspChangeRequestsTable.id, row.crId), eq(mspChangeRequestsTable.status, "in_progress")))
      .returning({ id: mspChangeRequestsTable.id });
    completed += updated.length;
    if (updated.length > 0) {
      log.info(
        { changeRequestId: row.crId, code: formatChangeRequestCode(row.crId), executedAt },
        "change-control-write-gate: CR closed — executor run completed, reference now available to drift attribution",
      );
    }
  }

  // ── Failed / cancelled executor runs → release the claim for retry ──
  const failed = await db
    .select({ crId: mspChangeRequestsTable.id })
    .from(mspChangeRequestsTable)
    .innerJoin(wfRunsTable, eq(mspChangeRequestsTable.executorRunId, wfRunsTable.id))
    .where(and(eq(mspChangeRequestsTable.status, "in_progress"), inArray(wfRunsTable.status, ["failed", "cancelled"])));

  let released = 0;
  for (const row of failed) {
    const updated = await db
      .update(mspChangeRequestsTable)
      .set({ status: "pending_approval", executorRunId: null, updatedAt: now })
      .where(and(eq(mspChangeRequestsTable.id, row.crId), eq(mspChangeRequestsTable.status, "in_progress")))
      .returning({ id: mspChangeRequestsTable.id });
    released += updated.length;
    if (updated.length > 0) {
      log.warn(
        { changeRequestId: row.crId, code: formatChangeRequestCode(row.crId) },
        "change-control-write-gate: CR released — executor run failed, approval preserved for retry",
      );
    }
  }

  if (completed > 0 || released > 0) {
    log.info({ completed, released }, "change-control-write-gate: reconciliation sweep complete");
  }
  return { completed, released };
}
