/**
 * remediation-reveal-gate.ts — the CR gate on a customer-executed fix's script
 * (#1541).
 *
 * WHAT THIS GATES
 * ────────────────
 * `remediation_knowledge_base.remediation_steps[].code` is a real, verified
 * PowerShell/Graph command. For a `you_must_run` item (#1539) that command is
 * how the customer actually changes their own tenant. Handing it to them with
 * no Change Request in the picture would make the CR gate decoration: the
 * platform would be telling a customer how to change production with no
 * snapshot, no rollback and no record — see #1541's own header.
 *
 * THE RULE
 * ────────
 * The diff (before/after JSON on the CR) is visible from the moment the CR is
 * raised — nothing gates that (`portal-change-control.ts` already serves it
 * unconditionally). Only the EXECUTABLE stays behind the gate:
 *
 *   we_can_run   — the executable is the write path itself. Already fail-closed
 *                  by #1497 (`change-control-write-gate.ts`): no approved,
 *                  unconsumed CR, no tenant write. Nothing to add here.
 *   you_must_run — the executable is the PowerShell text. THIS module is that
 *                  gate: it may be read only once a CR raised for that exact
 *                  finding (`msp_change_requests.remediation_check_key`) has
 *                  cleared approval.
 *
 * "Approved" is the same derivation `portal-change-control.ts`'s `displayStatus`
 * already uses: `approvedBy` is set the instant the required approval stage(s)
 * clear (`portal-change-approvals-store.ts`), and stays set through
 * scheduled/in_progress/completed/rolled_back — a customer who was authorized to
 * see the script does not lose that because the change later executed or was
 * rolled back. Only `rejected` withdraws it, and a rejected CR can never carry
 * an `approvedBy` in the first place (rejection and approval are exclusive
 * outcomes of the same ledger), so checking `rejected` explicitly is belt and
 * braces against a future writer that sets both.
 *
 * RECORDING THE REVEAL
 * ─────────────────────
 * Not proof of execution — the platform never observes whether the customer
 * actually ran what they were shown. It is the difference between "we told
 * them" and "nobody knows" (#1541's own words). Recorded as a `cr_events` row
 * (`script_revealed`) rather than a new table: `cr_events` is already the
 * append-only "one story" timeline for a change (see its own header), and a
 * reveal is exactly that kind of fact — every reveal writes a new row, even a
 * re-open of the same item, because each one really happened.
 */

import { and, eq } from "drizzle-orm";
import { db, mspChangeRequestsTable } from "@workspace/db";

import { recordCrEvent } from "./portal-change-timeline-store";

/** The columns the pure verdict needs from every CR raised for a given (tenant, checkKey). */
export interface RemediationRevealCandidate {
  readonly id: number;
  readonly status: string;
  readonly approvedBy: string | null;
}

/** The verdict of the pure reveal rule. */
export type RevealVerdict =
  | { readonly authorized: true; readonly changeRequestId: number }
  | { readonly authorized: false; readonly reason: string };

/** Whether ONE loaded CR, on its own, authorizes revealing the script it was raised to fix. */
export function isChangeRequestApprovedForReveal(
  cr: Pick<RemediationRevealCandidate, "status" | "approvedBy">,
): boolean {
  if (cr.status === "rejected") return false;
  return !!(cr.approvedBy && cr.approvedBy.trim().length > 0);
}

/**
 * PURE — given every CR ever raised against this tenant for this checkKey (any
 * order), decide whether the customer-executed fix's script may be revealed
 * right now. Fail-closed: no CR at all, or every CR still pending/rejected,
 * withholds it. Unit-tested in isolation; never reads a database or a request.
 *
 * When more than one CR qualifies (e.g. a prior rejection followed by a fresh
 * approved re-raise), the most recently raised (highest id) wins — it is the CR
 * actually behind the customer's current attempt, and its code is what the
 * `script_revealed` event attributes the reveal to.
 */
export function evaluateRevealAuthorization(
  candidates: readonly RemediationRevealCandidate[],
): RevealVerdict {
  if (candidates.length === 0) {
    return { authorized: false, reason: "no change request has been raised for this fix yet" };
  }
  const approved = candidates.filter(isChangeRequestApprovedForReveal).sort((a, b) => b.id - a.id);
  if (approved.length === 0) {
    return { authorized: false, reason: "change request approval is not complete" };
  }
  return { authorized: true, changeRequestId: approved[0].id };
}

/**
 * Load every CR raised for this (mspId, tenantId, checkKey) — the candidate set
 * the pure rule above evaluates. Scoped the same way `portal-change-control.ts`
 * scopes the register: BOTH predicates, never `tenantId` alone (see that file's
 * header for why).
 */
export async function findRevealCandidates(opts: {
  mspId: number;
  tenantId: string;
  checkKey: string;
}): Promise<RemediationRevealCandidate[]> {
  return db
    .select({
      id: mspChangeRequestsTable.id,
      status: mspChangeRequestsTable.status,
      approvedBy: mspChangeRequestsTable.approvedBy,
    })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.mspId, opts.mspId),
        eq(mspChangeRequestsTable.tenantId, opts.tenantId),
        eq(mspChangeRequestsTable.remediationCheckKey, opts.checkKey),
      ),
    );
}

/**
 * Record that the script was shown — the append-only fact, not a permission
 * check (the caller already ran `evaluateRevealAuthorization` before calling
 * this). Non-fatal by design at the call site: a reveal that failed to log
 * still succeeded at its actual job of showing the customer their script, so
 * the route logs and continues rather than 500ing an authorized read over a
 * timeline-write failure (the same posture #1496's approval materialization
 * takes).
 */
export async function recordScriptReveal(opts: {
  changeRequestId: number;
  mspId: number;
  tenantId: string;
  checkKey: string;
  actorPersonId: string;
  actorName: string;
}): Promise<void> {
  await recordCrEvent({
    changeRequestId: opts.changeRequestId,
    mspId: opts.mspId,
    tenantId: opts.tenantId,
    eventType: "script_revealed",
    fromValue: null,
    toValue: opts.checkKey,
    actorRole: "customer",
    actorPersonId: opts.actorPersonId,
    actorName: opts.actorName,
  });
}
