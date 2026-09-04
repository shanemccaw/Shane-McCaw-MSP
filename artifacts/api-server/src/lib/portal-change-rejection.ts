/**
 * portal-change-rejection.ts — the terminal REJECTION path of the Change Control
 * approval model (Git #1496).
 *
 * Kept apart from `portal-change-approvals-store.ts` on purpose: this is the one
 * approval-model path that reuses the router's #1514 risk hook
 * (`declineRoutedChangeToRisk`), so it must import `m365-change-router`. Keeping
 * that import out of the store lets `m365-change-router` import
 * `materializeApprovalsForChange` from the store with no import cycle.
 *
 * The two settled terminal shapes (#1496):
 *   • a CUSTOMER rejection produces an assigned risk — the residual risk is now
 *     theirs. For a routed Microsoft change this reuses the existing #1514 hook
 *     (which also flips the routing ledger); for any other change it creates the
 *     risk directly here, with Change-Control provenance.
 *   • an MSP rejection of its own proposed change produces NO risk — the finding
 *     stays open, unremediated and unaccepted.
 */

import {
  db,
  crApprovalsTable,
  mspChangeRequestsTable,
  mspRiskDecisionsTable,
  type MspChangeRequest,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { declineRoutedChangeToRisk } from "./m365-change-router";
import { violatesSeparationOfDuties } from "./portal-change-approvals";
import { resolveDelegatedAuthority, NO_POLICY, type ApprovalPolicyConfig, type ApproverIdentity, type CrEssentials } from "./portal-change-approvals-store";
import { recordCrEvent } from "./portal-change-timeline-store";
import { assignRegisterRef } from "./risk-register-ref";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

export type RejectionOutcome =
  | { readonly ok: true; readonly riskDecisionId: number | null }
  | { readonly ok: false; readonly code: 400 | 403 | 409; readonly error: string };

export async function recordRejection(
  cr: CrEssentials & Pick<MspChangeRequest, "sourceKind">,
  approver: ApproverIdentity,
  reason: string,
  policy: ApprovalPolicyConfig = NO_POLICY,
): Promise<RejectionOutcome> {
  if (cr.status === "rejected") return { ok: false, code: 409, error: "This change has already been rejected." };
  if (approver.role === "customer" && policy.requireSeparateApprover && violatesSeparationOfDuties(cr.requestedBy, approver.email)) {
    return { ok: false, code: 403, error: "Separation of duties: the person who raised a change cannot reject it." };
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

  const now = new Date();
  const onBehalfOf = await resolveDelegatedAuthority(approver.customerId, approver.personId);
  const pending = rows.filter((r) => r.decision === "pending");
  // The stage the rejection landed on — carried past the branch below so the
  // single terminal `rejected` cr_event (emitted once the CR's actual status
  // flips, not here at the approval-ledger row) can still name it.
  let decidedStage = 1;

  if (pending.length > 0) {
    const stage = Math.min(...pending.map((r) => r.stage));
    const slot = pending.find((r) => r.stage === stage)!;
    decidedStage = stage;
    // #1500 — same higher bar as the approval path: only MSP staff may decide
    // (reject, same as approve) a freeze-exception stage.
    if (slot.freezeWindowId !== null && approver.role !== "msp") {
      return {
        ok: false,
        code: 403,
        error: "This change was raised inside an active freeze window — its exception requires MSP sign-off.",
      };
    }
    await db
      .update(crApprovalsTable)
      .set({
        decision: "rejected",
        approverRole: approver.role,
        approverPersonId: approver.personId,
        approverName: approver.name,
        onBehalfOfPersonId: onBehalfOf,
        reason,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(crApprovalsTable.id, slot.id));
    // Any later pending stage is now moot.
    for (const r of pending) {
      if (r.id !== slot.id) {
        await db.update(crApprovalsTable).set({ decision: "superseded", updatedAt: now }).where(eq(crApprovalsTable.id, r.id));
        await recordCrEvent({
          changeRequestId: cr.id,
          mspId: cr.mspId,
          tenantId: cr.tenantId,
          eventType: "superseded",
          fromValue: "pending",
          toValue: `superseded (stage ${r.stage})`,
          stage: r.stage,
          actorRole: approver.role,
          actorPersonId: approver.personId,
          actorName: approver.name,
          reason: "Superseded by the rejection at an earlier stage.",
          occurredAt: now,
        });
      }
    }
  } else {
    // No pending slot (e.g. a pre-approved change being overridden) — record the
    // rejection as its own row so the decision is never lost.
    await db.insert(crApprovalsTable).values({
      changeRequestId: cr.id,
      mspId: cr.mspId,
      tenantId: cr.tenantId,
      stage: 1,
      decision: "rejected",
      approverRole: approver.role,
      approverPersonId: approver.personId,
      approverName: approver.name,
      onBehalfOfPersonId: onBehalfOf,
      reason,
      decidedAt: now,
    });
  }

  // Terminal state + the risk hook.
  let riskDecisionId: number | null = null;
  if (cr.sourceKind === "microsoft_change") {
    // Reuse the tested #1514 path — it drives the CR terminal, creates the risk
    // (customer) or not (msp), and flips the routing ledger.
    const result = await declineRoutedChangeToRisk({
      changeRequestId: cr.id,
      mspId: cr.mspId,
      declinedBy: approver.role,
      approverName: approver.name,
      approverEmail: approver.email,
      statement: reason,
      stage: decidedStage,
      actorPersonId: approver.personId,
    });
    riskDecisionId = result.riskDecisionId;
  } else {
    await db
      .update(mspChangeRequestsTable)
      .set({ status: "rejected", approvedBy: `Rejected by ${approver.name}`, updatedAt: now })
      .where(eq(mspChangeRequestsTable.id, cr.id));
    await recordCrEvent({
      changeRequestId: cr.id,
      mspId: cr.mspId,
      tenantId: cr.tenantId,
      eventType: "rejected",
      fromValue: cr.status,
      toValue: "rejected",
      stage: decidedStage,
      actorRole: approver.role,
      actorPersonId: approver.personId,
      actorName: approver.name,
      reason,
      occurredAt: now,
    });
    if (approver.role === "customer") {
      riskDecisionId = await createAssignedRiskFromRejection(cr, approver, reason, now);
    }
  }

  log.info(
    { changeRequestId: cr.id, mspId: cr.mspId, role: approver.role, riskDecisionId, sourceKind: cr.sourceKind ?? null },
    "cr-approvals: rejection recorded",
  );
  return { ok: true, riskDecisionId };
}

const RISK_REVIEW_DAYS = 90;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
function formatReviewDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function riskScoreForLevel(level: string): number {
  switch (level) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 50;
    default:
      return 25;
  }
}

/**
 * The assigned-risk hook for a CUSTOMER rejection of a NON-routed change. Mirrors
 * the #1514 routed hook but with Change-Control provenance (not Microsoft). The
 * risk REGISTER itself is #1487's surface — this only creates the record it will
 * show, linked back to the change the customer rejected.
 */
async function createAssignedRiskFromRejection(
  cr: CrEssentials & Pick<MspChangeRequest, "sourceKind">,
  approver: ApproverIdentity,
  statement: string,
  now: Date,
): Promise<number> {
  const [full] = await db.select().from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, cr.id)).limit(1);
  if (!full) throw new Error(`Change request ${cr.id} vanished during rejection`);

  const rbdId = `RR-CR-${cr.id}`;
  const rawScore = riskScoreForLevel(full.riskLevel);
  const reviewDate = new Date(now.getTime() + RISK_REVIEW_DAYS * 86_400_000);
  const signedAtDisplay = now.toISOString().substring(0, 19).replace("T", " ") + " UTC";
  const signatureHash = createHash("sha256")
    .update([rbdId, approver.name, now.toISOString(), statement].join(" "))
    .digest("hex");

  const [inserted] = await db
    .insert(mspRiskDecisionsTable)
    .values({
      mspId: full.mspId,
      rbdId,
      tenantId: full.tenantId,
      tenantName: full.tenantName,
      primaryDomain: full.primaryDomain,
      title: full.title,
      controlViolated: full.targetResource,
      framework: "Microsoft 365 Change Control",
      // #1514 — carried forward from the CR's own #1541 structured link so the
      // accepted-risk suppression (#1279, keyed on tenant_id + check_key +
      // status='active') and this build's discharge lookup can both find this
      // row. NULL exactly when the CR itself carries none (every hand-typed
      // wizard submission with no remediation item behind it).
      checkKey: full.remediationCheckKey,
      rawRiskLevel: full.riskLevel,
      residualRiskLevel: full.riskLevel,
      rawRiskScore: rawScore,
      residualRiskScore: rawScore,
      liabilityValueUsd: 0,
      hazardDescription: `${full.description} The customer rejected this change; the residual risk is accepted until a future change supersedes it.`,
      graphEndpoint: "",
      compensatingControls: [],
      mspAssessor: { name: "Change Control approval model", upn: "system@change-control", timestamp: now.toISOString() },
      clientApprover: {
        name: approver.name,
        title: "",
        email: approver.email,
        signedAt: signedAtDisplay,
        ipAddress: null,
        signatureHash,
      },
      expirationDate: formatReviewDate(reviewDate),
      status: "active",
      riskStatus: "Accepted",
      reviewDate: formatReviewDate(reviewDate),
      acceptedAt: now,
      acceptedStatement: statement,
      spawnedByChangeRequestId: cr.id,
    })
    .onConflictDoUpdate({
      target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId],
      set: { updatedAt: now },
    })
    .returning({ id: mspRiskDecisionsTable.id });
  await assignRegisterRef(inserted.id);
  return inserted.id;
}
