/**
 * portal-change-approvals.ts — the pure derivations behind the Change Control
 * APPROVAL MODEL (Git #1496).
 *
 * `msp_change_requests.approved_by` is a single string. This file (and the
 * `cr_approvals` ledger it reasons over) is what turns that into a real approval
 * record: multi-stage requirements, an SLA with breach escalation, separation of
 * duties, and delegated authority.
 *
 * Everything here is a total function over stored values — no database, no
 * request. The route (`routes/portal-change-control.ts`) and the store
 * (`portal-change-approvals-store.ts`) are where those functions meet the DB, so
 * that the rules that decide what a customer is *allowed to do* to their own
 * tenant stay unit-testable in isolation — the same discipline
 * `portal-change-control.ts` follows.
 *
 * ── Approval attaches to the CHANGE, not the class (settled, #1496) ─────────
 * A standard or auto-approved change still produces a real CR and a real
 * approval row. `requiredStages` returns 0 for a pre-approved change: the ledger
 * holds one already-`approved` row (its approver a real human/party, never "the
 * system"), and no human is asked to act. A change that needs a human returns
 * the stages a human must clear, in order.
 */

import type { CrApproval, CrApproverRole } from "@workspace/db";
import type { StoredChangeClass, StoredRiskLevel } from "./portal-change-control";

/** The stored `cr_approvals.decision` vocabulary. */
export const CR_APPROVAL_DECISIONS = ["pending", "approved", "rejected", "superseded"] as const;
export type CrApprovalDecisionValue = (typeof CR_APPROVAL_DECISIONS)[number];

/** The stored `cr_approvals.approver_role` vocabulary. */
export const CR_APPROVER_ROLES = ["customer", "msp", "catalog_inherited", "microsoft_forced"] as const;

/**
 * How many HUMAN approval stages a change needs, in order, before it is
 * approved. Risk level decides a FLOOR — the same principle the risk
 * recomputation in `portal-change-control.ts` exists to protect ("risk level
 * decides how many approvals a change needs, so a client that can name its own
 * risk can name its way past the gate").
 *
 *   • standard          → 0. Pre-approved; the ledger records one inherited
 *                          approval and nobody is asked to act. A pre-approved
 *                          change has no human stage for a policy to raise, so
 *                          the tenant policy does not apply here.
 *   • emergency         → 1. A single retrospective sign-off (a very short SLA).
 *   • normal, low/med   → 1.
 *   • normal, high      → 2 (a second, independent approver).
 *   • normal, critical  → 2.
 *
 * ── The tenant policy floors it UP, never down (#1759) ──────────────────────
 * `portal_change_control_policy.required_signatures` is the tenant's own
 * "signatures required" setting. When a policy row exists, the effective count
 * is `max(policySignatures, riskDerived)`: a tenant may demand MORE signatures
 * than its risk requires, but risk is the floor it can never configure below —
 * that floor is the whole reason this function exists. `policySignatures` of
 * `null` means the tenant has no policy row, and the result is exactly the
 * risk-derived count, byte for byte as before this was wired.
 *
 * Each stage is quorum-1 today; the `cr_approvals` table can hold a quorum
 * (multiple rows sharing a stage) if policy later asks for one.
 */
export function requiredStages(
  changeClass: StoredChangeClass,
  risk: StoredRiskLevel,
  policySignatures: number | null = null,
): number {
  if (changeClass === "standard") return 0;
  const riskDerived = changeClass === "emergency" ? 1 : risk === "high" || risk === "critical" ? 2 : 1;
  return policySignatures === null ? riskDerived : Math.max(policySignatures, riskDerived);
}

/**
 * The approval SLA, in whole days from CR creation, for a pending stage. Null
 * means no SLA applies (a pre-approved standard change has no pending slot to
 * time). A tighter deadline for a riskier change; emergencies are effectively
 * immediate.
 */
export function slaDaysFor(changeClass: StoredChangeClass, risk: StoredRiskLevel): number | null {
  if (changeClass === "standard") return null;
  if (changeClass === "emergency") return 1;
  switch (risk) {
    case "critical":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 5;
    default:
      return 7;
  }
}

const DAY_MS = 86_400_000;

/** The SLA deadline for a pending slot, or null when no SLA applies. */
export function computeDueAt(
  createdAt: Date,
  changeClass: StoredChangeClass,
  risk: StoredRiskLevel,
): Date | null {
  const days = slaDaysFor(changeClass, risk);
  if (days === null) return null;
  return new Date(createdAt.getTime() + days * DAY_MS);
}

/**
 * A pending approval whose SLA deadline has passed is breached. Only a still
 * `pending` slot with a real `dueAt` can breach — a decided or SLA-less slot
 * never does.
 */
export function isApprovalBreached(
  row: Pick<CrApproval, "decision" | "dueAt">,
  now: Date,
): boolean {
  return row.decision === "pending" && row.dueAt !== null && now.getTime() > row.dueAt.getTime();
}

/**
 * Separation of duties: the person who RAISED a change may not APPROVE it.
 * Compared by email — the CR's `requested_by` is an email and the approver's
 * identity comes from the authenticated session. Case-insensitive, trimmed;
 * a blank requester (a system-raised CR) can never collide with a real approver.
 */
export function violatesSeparationOfDuties(
  requestedBy: string | null | undefined,
  approverEmail: string | null | undefined,
): boolean {
  const requester = (requestedBy ?? "").trim().toLowerCase();
  const approver = (approverEmail ?? "").trim().toLowerCase();
  if (!requester || !approver) return false;
  return requester === approver;
}

/**
 * The lowest-numbered stage that still has a pending slot — the stage a new
 * decision applies to. Stages are gated in order: stage 2 cannot be decided
 * while stage 1 is still pending. Null when nothing is pending.
 */
export function nextPendingStage(rows: readonly Pick<CrApproval, "stage" | "decision">[]): number | null {
  const pending = rows.filter((r) => r.decision === "pending").map((r) => r.stage);
  return pending.length > 0 ? Math.min(...pending) : null;
}

export interface ApprovalState {
  /** Human stages this change requires (0 for a pre-approved change). */
  readonly requiredStages: number;
  readonly approved: number;
  readonly rejected: number;
  readonly pending: number;
  readonly superseded: number;
  /** A pending slot has passed its SLA. */
  readonly breached: boolean;
  /** Every required stage has cleared — the change is fully approved. */
  readonly complete: boolean;
  /** Any rejection at all is terminal for the change. */
  readonly rejectedTerminal: boolean;
  /** The stage a new decision would land on, or null when nothing is pending. */
  readonly nextStage: number | null;
}

/**
 * Fold a change's approval rows into the state the register and the routes both
 * read. `requiredStages` is passed in (derived from the CR's class/risk) rather
 * than inferred from row count, so a change that needs two approvals but has one
 * recorded still reads as incomplete.
 */
export function summarizeApprovals(
  rows: readonly Pick<CrApproval, "stage" | "decision" | "dueAt">[],
  required: number,
  now: Date,
): ApprovalState {
  let approved = 0;
  let rejected = 0;
  let pending = 0;
  let superseded = 0;
  let breached = false;
  const clearedStages = new Set<number>();

  for (const r of rows) {
    switch (r.decision) {
      case "approved":
        approved += 1;
        clearedStages.add(r.stage);
        break;
      case "rejected":
        rejected += 1;
        break;
      case "superseded":
        superseded += 1;
        break;
      default:
        pending += 1;
        if (isApprovalBreached(r, now)) breached = true;
        break;
    }
  }

  const rejectedTerminal = rejected > 0;
  // A pre-approved change (required 0) is complete once it has any approved row;
  // otherwise every required stage must have cleared.
  const complete =
    !rejectedTerminal &&
    (required === 0 ? approved > 0 : clearedStages.size >= required && pending === 0);

  return {
    requiredStages: required,
    approved,
    rejected,
    pending,
    superseded,
    breached,
    complete,
    rejectedTerminal,
    nextStage: nextPendingStage(rows),
  };
}

/** A single approval decision, as the register consumes it. Narrower than the row. */
export interface WireApprovalRecord {
  readonly stage: number;
  readonly decision: CrApprovalDecisionValue;
  readonly approverRole: CrApproverRole;
  readonly approverName: string | null;
  readonly approverPersonId: string | null;
  /** Set when the decision was made under a delegation — who it was made for. */
  readonly onBehalfOfPersonId: string | null;
  readonly reason: string | null;
  readonly decidedAt: string | null;
  readonly dueAt: string | null;
  /** This slot is pending and past its SLA. */
  readonly breached: boolean;
  readonly escalatedAt: string | null;
}

/** One stored approval row → its wire shape. */
export function toWireApproval(
  row: Pick<
    CrApproval,
    | "stage"
    | "decision"
    | "approverRole"
    | "approverName"
    | "approverPersonId"
    | "onBehalfOfPersonId"
    | "reason"
    | "decidedAt"
    | "dueAt"
    | "escalatedAt"
  >,
  now: Date,
): WireApprovalRecord {
  return {
    stage: row.stage,
    decision: row.decision,
    approverRole: row.approverRole,
    approverName: row.approverName,
    approverPersonId: row.approverPersonId,
    onBehalfOfPersonId: row.onBehalfOfPersonId,
    reason: row.reason,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    breached: isApprovalBreached(row, now),
    escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
  };
}
