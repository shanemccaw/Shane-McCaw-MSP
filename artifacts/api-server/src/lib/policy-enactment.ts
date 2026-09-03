/**
 * policy-enactment.ts — the #1550 mechanism: "a policy IS a standard change
 * catalog item" resolves the CR-flood collision between continuous evaluation
 * (#1549) and #1497's write gate.
 *
 * #1497: no tenant write happens without an approved Change Request. #1548:
 * a standing policy is enacted by firing its named SOP (`msp_sops` /
 * `msp_sop_runs`, `origin: "policy"`) — the engine itself never executes.
 * Wiring those two together naively would raise one fresh CR needing its own
 * manual approval PER enactment: onboarding twenty VIPs would flood the
 * register with twenty approval requests for a rule already agreed.
 *
 * The resolution (#1550): a standing policy binds to a pre-approved
 * `change_catalog_items` row (`standingPoliciesTable.catalogItemId`).
 * Approving THAT catalog item — a real, signed, dated, revocable decision — is
 * what "approving the policy" means; every enactment after that inherits its
 * authority. This module is the one function that turns a policy-origin SOP
 * run (`sop-execution.ts`'s `runSopForCustomer`, when a `standingPolicyId` run
 * carries no explicit CR) into a real, auto-approved `standard` change
 * request: the same `changeClass: "standard"` / `approverRole:
 * "catalog_inherited"` machinery `routes/portal-change-catalog.ts`'s
 * customer-facing "execute" already uses for self-service, applied here to
 * the policy-enacted path instead.
 *
 * Live-checked every single call, never cached — #1555's discipline, reused
 * here for the same reason: the policy must be `isActive`, and its bound
 * catalog item must be `approved` AT THE MOMENT OF ENACTMENT. Revoking either
 * stops future enactments cold, per #1550's own consequence — "no per-instance
 * approval" does not mean "no gate"; it means the gate is the standing
 * decision, re-checked live, not a fresh signature every time.
 */

import { db, standingPoliciesTable, changeCatalogItemsTable, tenantsTable, mspChangeRequestsTable, type InsertMspChangeRequest } from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { materializeApprovalsForChange } from "./portal-change-approvals-store";
import { formatChangeRequestCode } from "./portal-change-control";
import { evaluatePolicyEnactmentGate } from "./standing-policies";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

export type PolicyEnactmentResult =
  | { readonly ok: true; readonly changeRequestId: number; readonly code: string }
  | { readonly ok: false; readonly reason: string };

export interface RaisePolicyEnactmentOpts {
  readonly mspId: number;
  readonly standingPolicyId: number;
  readonly customerId: number;
  /** Free-text description of who/what this specific enactment concerns — e.g. "jane.doe@tenant.com — VIP onboarding". */
  readonly targetDescription: string;
  /** The real person (or the automated trigger's operator identity) that caused this enactment — never "the system". */
  readonly requestedBy: string;
}

/**
 * Raise a real, auto-approved `standard` change request for ONE enactment of
 * a standing policy — "approve once, execute many" applied to policy
 * enactments instead of customer self-service. Fails closed with a specific
 * reason on every branch that is not an unambiguous yes; never raises a CR it
 * cannot fully justify.
 */
export async function raisePolicyEnactmentChangeRequest(opts: RaisePolicyEnactmentOpts): Promise<PolicyEnactmentResult> {
  const [policy] = await db
    .select()
    .from(standingPoliciesTable)
    .where(and(eq(standingPoliciesTable.id, opts.standingPolicyId), eq(standingPoliciesTable.mspId, opts.mspId)))
    .limit(1);
  if (!policy) return { ok: false, reason: "standing policy not found" };

  const item =
    policy.catalogItemId === null
      ? null
      : (
          await db
            .select()
            .from(changeCatalogItemsTable)
            .where(and(eq(changeCatalogItemsTable.id, policy.catalogItemId), eq(changeCatalogItemsTable.mspId, opts.mspId)))
            .limit(1)
        )[0] ?? null;

  // Live check, not cached — #1555's revocation model, reused here: revoking
  // the catalog item (or deactivating the policy) stops future enactments
  // cold, checked at every single call.
  const gate = evaluatePolicyEnactmentGate({
    isActive: policy.isActive,
    catalogItemId: policy.catalogItemId,
    catalogItemStatus: item?.status ?? null,
  });
  if (!gate.ok) return { ok: false, reason: gate.reason };
  // `evaluatePolicyEnactmentGate` returning ok guarantees `item` is non-null.
  if (!item) return { ok: false, reason: "the catalog item bound to this policy no longer exists" };

  const [tenant] = await db
    .select({ id: tenantsTable.id, tenantId: tenantsTable.tenantId, customerName: tenantsTable.customerName, domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, opts.customerId), eq(tenantsTable.mspId, opts.mspId)))
    .limit(1);
  if (!tenant) return { ok: false, reason: "customer not found for this MSP" };
  const tenantId = (tenant.tenantId ?? "").trim();
  if (!tenantId) return { ok: false, reason: "customer has no connected Microsoft 365 tenant" };

  const targetDescription = opts.targetDescription.trim() || "Unnamed target";
  const requestedBy = opts.requestedBy.trim() || "unknown";
  const requestedAt = new Date().toISOString();

  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: opts.mspId,
      tenantId,
      tenantName: (tenant.customerName ?? "").trim() || "Your organisation",
      primaryDomain: (tenant.domain ?? "").trim(),
      title: `${policy.title} — ${targetDescription}`,
      description: `Raised by the Policy Engine from standing policy "${policy.title}" (policy #${policy.id}), pre-approved via catalog item #${item.id}. Target: ${targetDescription}. No CAB required — the policy's own approval already authorizes this enactment.`,
      changeClass: "standard",
      riskLevel: item.riskLevel as "critical" | "high" | "medium" | "low",
      category: item.category as InsertMspChangeRequest["category"],
      targetResource: targetDescription,
      psaTicketId: "No ticket reference",
      requestedBy,
      requestedAt,
      scheduledFor: "Immediate — standard, pre-approved change (policy enactment)",
      impactedUsersCount: 0,
      status: "pending_approval",
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: {},
      proposedPayload: {},
      rollbackScriptSnippet: "",
      catalogItemId: item.id,
      // The catalog item's own real, signed approver — inherited, never "the system".
      approvedBy: item.approvedByName,
      // #1773 — this CR is auto-raised for exactly one SOP enactment, so it can
      // (and must) be pinned: the write gate now refuses to let it authorize
      // anything else. `sopId` is nullable on the schema but is always set here
      // — `runSopForCustomer` already verified it matches the SOP being run
      // before calling in.
      authorizedTargetKey: policy.sopId ? `sop:${policy.sopId}` : null,
    })
    .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

  try {
    await materializeApprovalsForChange({
      id: inserted.id,
      mspId: opts.mspId,
      tenantId,
      changeClass: "standard",
      riskLevel: item.riskLevel as "critical" | "high" | "medium" | "low",
      status: "pending_approval",
      approvedBy: item.approvedByName,
      requestedBy,
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    log.error(
      { err, crId: inserted.id, standingPolicyId: policy.id },
      "policy-raised change created but approval materialisation failed",
    );
  }

  const code = formatChangeRequestCode(inserted.id);
  log.info(
    { mspId: opts.mspId, standingPolicyId: policy.id, catalogItemId: item.id, code, customerId: opts.customerId },
    "policy-enactment: auto-approved standard change request raised",
  );
  return { ok: true, changeRequestId: inserted.id, code };
}
