/**
 * portal-change-approvals-store.ts — the DB side of the Change Control approval
 * model (Git #1496). The pure rules live in `portal-change-approvals.ts`; this is
 * where they touch `cr_approvals`, `msp_change_requests` and the delegation
 * table.
 *
 * This module is deliberately free of any import of `m365-change-router` so that
 * `m365-change-router` can import `materializeApprovalsForChange` from here
 * without a cycle. The rejection path — the one place that reuses the router's
 * #1514 risk hook — lives in `portal-change-rejection.ts` instead.
 *
 * Every write here keeps `msp_change_requests.approved_by` in step with the
 * ledger as a denormalised display cache, so the existing `displayStatus()`
 * derivation keeps reading the same truth without knowing this table exists.
 */

import {
  db,
  crApprovalsTable,
  mspChangeRequestsTable,
  portalOwnershipDelegationsTable,
  type CrApproval,
  type MspChangeRequest,
} from "@workspace/db";
import { and, asc, eq, isNull, lte } from "drizzle-orm";

import {
  computeDueAt,
  requiredStages,
  slaDaysFor,
  summarizeApprovals,
  violatesSeparationOfDuties,
} from "./portal-change-approvals";
import type { StoredChangeClass, StoredRiskLevel } from "./portal-change-control";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

/** The CR fields the ledger writers need. A subset of the full row. */
export type CrEssentials = Pick<
  MspChangeRequest,
  | "id"
  | "mspId"
  | "tenantId"
  | "changeClass"
  | "riskLevel"
  | "status"
  | "approvedBy"
  | "requestedBy"
  | "createdAt"
>;

/**
 * Create the approval record(s) a NEW change requires — the "a standard or
 * auto-approved change still produces a real approval record" rule. Idempotent:
 * if the CR already has any approval rows it does nothing, so it is safe to call
 * from every CR-creation path and to re-run.
 *
 *   • Already-approved at creation (a routed Microsoft forced change, or any CR
 *     that arrives with an `approvedBy`) → ONE `approved` row. Its approver is
 *     the real party named in `approvedBy` — Microsoft for a forced change,
 *     recorded as `microsoft_forced`; anything else as `catalog_inherited` (the
 *     human whose catalog approval the change carries). Never "the system".
 *   • Needs a human → the required number of `pending` customer slots, one per
 *     stage, each carrying the SLA `dueAt`.
 */
export async function materializeApprovalsForChange(cr: CrEssentials): Promise<number> {
  const existing = await db
    .select({ id: crApprovalsTable.id })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, cr.id))
    .limit(1);
  if (existing.length > 0) return 0;

  const changeClass = cr.changeClass as StoredChangeClass;
  const risk = cr.riskLevel as StoredRiskLevel;
  const now = new Date();
  const approvedBy = (cr.approvedBy ?? "").trim();

  if (approvedBy) {
    const approverRole = /^microsoft/i.test(approvedBy) ? "microsoft_forced" : "catalog_inherited";
    await db.insert(crApprovalsTable).values({
      changeRequestId: cr.id,
      mspId: cr.mspId,
      tenantId: cr.tenantId,
      stage: 1,
      decision: "approved",
      approverRole,
      approverName: approvedBy,
      reason: "Auto-approved at creation — inherited approval.",
      decidedAt: cr.createdAt ?? now,
    });
    return 1;
  }

  const stages = requiredStages(changeClass, risk);
  if (stages === 0) {
    // A standard change with no approver named yet: still a real, pre-approved
    // record rather than a pending human ask.
    await db.insert(crApprovalsTable).values({
      changeRequestId: cr.id,
      mspId: cr.mspId,
      tenantId: cr.tenantId,
      stage: 1,
      decision: "approved",
      approverRole: "catalog_inherited",
      approverName: "Standard change — pre-approved",
      reason: "Standard change — pre-approved by policy.",
      decidedAt: cr.createdAt ?? now,
    });
    return 1;
  }

  const dueAt = computeDueAt(cr.createdAt ?? now, changeClass, risk);
  const rows = Array.from({ length: stages }, (_unused, i) => ({
    changeRequestId: cr.id,
    mspId: cr.mspId,
    tenantId: cr.tenantId,
    stage: i + 1,
    decision: "pending" as const,
    approverRole: "customer" as const,
    dueAt,
  }));
  await db.insert(crApprovalsTable).values(rows);
  return rows.length;
}

/** Every approval row for a set of CRs — for callers that read the ledger by id. */
export async function listApprovalsForChangeIds(ids: readonly number[]): Promise<CrApproval[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(crApprovalsTable)
    .orderBy(asc(crApprovalsTable.changeRequestId), asc(crApprovalsTable.stage), asc(crApprovalsTable.id));
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.changeRequestId));
}

/**
 * Whether the acting person is covering someone else's approval authority via an
 * active `portal_ownership_delegations` handover (reused, not reinvented). If
 * they are a `toPersonId` on a live (not-done) delegation, returns the
 * `fromPersonId` they are acting for; otherwise null. Delegation is recorded on
 * the decision as `onBehalfOfPersonId`, never used to bypass separation of duties.
 */
export async function resolveDelegatedAuthority(
  customerId: number,
  actingPersonId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ fromPersonId: portalOwnershipDelegationsTable.fromPersonId })
    .from(portalOwnershipDelegationsTable)
    .where(
      and(
        eq(portalOwnershipDelegationsTable.customerId, customerId),
        eq(portalOwnershipDelegationsTable.toPersonId, actingPersonId),
        eq(portalOwnershipDelegationsTable.done, false),
      ),
    )
    .limit(1);
  return row?.fromPersonId ?? null;
}

export interface ApproverIdentity {
  readonly personId: string;
  readonly name: string;
  readonly email: string;
  readonly customerId: number;
  readonly role: "customer" | "msp";
}

export type DecisionOutcome =
  | { readonly ok: true; readonly complete: boolean; readonly stage: number }
  | { readonly ok: false; readonly code: 400 | 403 | 409; readonly error: string };

/**
 * Record an APPROVAL on the earliest pending stage. Enforces separation of duties
 * (the requester may not approve) and gates stages in order. When the final
 * required stage clears, the CR's `approvedBy` cache is set so the register reads
 * "Approved".
 */
export async function recordApproval(cr: CrEssentials, approver: ApproverIdentity, note: string | null): Promise<DecisionOutcome> {
  if (cr.status === "rejected") return { ok: false, code: 409, error: "This change has been rejected and cannot be approved." };
  if (violatesSeparationOfDuties(cr.requestedBy, approver.email)) {
    return { ok: false, code: 403, error: "Separation of duties: the person who raised a change cannot approve it." };
  }

  const rows = await db
    .select({
      id: crApprovalsTable.id,
      stage: crApprovalsTable.stage,
      decision: crApprovalsTable.decision,
      freezeWindowId: crApprovalsTable.freezeWindowId,
    })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, cr.id))
    .orderBy(asc(crApprovalsTable.stage), asc(crApprovalsTable.id));

  const pending = rows.filter((r) => r.decision === "pending");
  if (pending.length === 0) {
    return { ok: false, code: 409, error: "This change has no approval awaiting a decision." };
  }
  const stage = Math.min(...pending.map((r) => r.stage));
  const slot = pending.find((r) => r.stage === stage)!;

  // #1500 — the higher approval bar a freeze exception promises: this specific
  // slot exists ONLY because the change was raised inside an active freeze
  // window, and clearing it is not a customer's ordinary approval authority.
  if (slot.freezeWindowId !== null && approver.role !== "msp") {
    return {
      ok: false,
      code: 403,
      error: "This change was raised inside an active freeze window — its exception requires MSP sign-off.",
    };
  }

  const onBehalfOf = await resolveDelegatedAuthority(approver.customerId, approver.personId);
  const now = new Date();

  await db
    .update(crApprovalsTable)
    .set({
      decision: "approved",
      approverRole: approver.role,
      approverPersonId: approver.personId,
      approverName: approver.name,
      onBehalfOfPersonId: onBehalfOf,
      reason: note,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(crApprovalsTable.id, slot.id));

  // Recompute completeness against the required stage count.
  const after = await db
    .select({ stage: crApprovalsTable.stage, decision: crApprovalsTable.decision, dueAt: crApprovalsTable.dueAt })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, cr.id));
  const required = requiredStages(cr.changeClass as StoredChangeClass, cr.riskLevel as StoredRiskLevel);
  const state = summarizeApprovals(after, required, now);

  if (state.complete) {
    // Denormalised display cache — the register's displayStatus() reads this.
    await db
      .update(mspChangeRequestsTable)
      .set({ approvedBy: `Approved by ${approver.name}`, updatedAt: now })
      .where(eq(mspChangeRequestsTable.id, cr.id));
  }

  log.info(
    { changeRequestId: cr.id, mspId: cr.mspId, stage, approverPersonId: approver.personId, onBehalfOf, complete: state.complete },
    "cr-approvals: approval recorded",
  );
  return { ok: true, complete: state.complete, stage };
}

/**
 * The breach sweep. A pending approval past its SLA `dueAt` that has not yet been
 * escalated is stamped `escalatedAt` (exactly once) and logged on the
 * notification channel. Returns how many breached this run. Wire this as a
 * workflow node alongside the routing sweep for continuous escalation; it is safe
 * to call ad hoc.
 */
export async function escalateBreachedApprovals(now: Date = new Date()): Promise<number> {
  const breached = await db
    .select({ id: crApprovalsTable.id, changeRequestId: crApprovalsTable.changeRequestId, mspId: crApprovalsTable.mspId, dueAt: crApprovalsTable.dueAt })
    .from(crApprovalsTable)
    .where(
      and(
        eq(crApprovalsTable.decision, "pending"),
        isNull(crApprovalsTable.escalatedAt),
        lte(crApprovalsTable.dueAt, now),
      ),
    );

  const notify = logger.child({ channel: "notification" });
  for (const row of breached) {
    await db.update(crApprovalsTable).set({ escalatedAt: now, updatedAt: now }).where(eq(crApprovalsTable.id, row.id));
    notify.warn(
      { changeRequestId: row.changeRequestId, mspId: row.mspId, approvalId: row.id, dueAt: row.dueAt },
      "cr-approvals: approval SLA breached — escalated",
    );
  }

  if (breached.length > 0) {
    log.info({ escalated: breached.length }, "cr-approvals: breach sweep complete");
  }
  return breached.length;
}

// slaDaysFor is re-exported for callers wiring the sweep cadence off policy.
export { slaDaysFor };
