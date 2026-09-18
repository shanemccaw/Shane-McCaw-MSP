/**
 * ca-policy-promotion.ts
 *
 * Git #4522 — the report-only → enabled promotion workflow for Conditional Access
 * policies (Shane's #4518 decision: monitor-first by default, promote to enforced
 * only after real sign-in impact has been verified).
 *
 *   listCaPoliciesForTenant     — live policies + how long each has been in its state
 *   evaluateCaPolicyImpact      — the policy's real report-only sign-in outcomes,
 *                                 read from GET /auditLogs/signIns (ca-policy-impact.ts
 *                                 does the arithmetic)
 *   promoteCaPolicy             — the gated write. Re-reads the policy and re-derives
 *                                 impact SERVER-SIDE, refuses unless the operator's
 *                                 reviewed fingerprint still matches and any impact
 *                                 was explicitly acknowledged, writes a
 *                                 ca_policy_promotions row BEFORE the PATCH, raises the
 *                                 Change Request the write stands behind, then fires
 *                                 action.set-ca-policy-state with an in-process
 *                                 authorization the executor verifies against that row.
 *
 * Every attempt — refused, failed or succeeded — leaves a ca_policy_promotions row
 * and an msp_audit_logs row naming who, when, and the impact that was reviewed.
 *
 * Reads use the READ multi-tenant app (Policy.Read.All, AuditLog.Read.All). Sign-in
 * logs need Entra ID P1/P2 — a tenant without it cannot have a report-only policy
 * either, and the read reports `entra_premium_required` instead of guessing.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  caPolicyPromotionsTable,
  mspAuditLogsTable,
  tenantsTable,
  writeActionCatalogTable,
  type CaPolicyPromotion,
} from "@workspace/db";
import { ConsentRevokedError, LicenseGapError, graphFetchForTenant } from "./graph.ts";
import {
  computeImpactWindow,
  impactFingerprint,
  promotionReadiness,
  summarizeReportOnlyImpact,
  type GraphConditionalAccessPolicy,
  type GraphSignInForImpact,
  type ImpactWindow,
  type PromotionReadiness,
  type ReportOnlyImpactSummary,
} from "./ca-policy-impact.ts";
import { CA_STATE_ENABLED, CA_STATE_REPORT_ONLY, stripCaReportOnlySuffix } from "./ca-enforcement-mode.ts";
import {
  raiseChangeRequestForLaunchControlExecution,
  recordLaunchControlExecutionOutcome,
} from "./launch-control-change-request.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.ca-promotion" });

export const SET_CA_POLICY_STATE_TEMPLATE_ID = "action.set-ca-policy-state";
/** Sign-in pages read per evaluation (x SIGN_IN_PAGE_SIZE rows). Beyond it the read is reported incomplete. */
export const MAX_SIGN_IN_PAGES = 20;
export const SIGN_IN_PAGE_SIZE = 500;

export type TenantReadStatus = "ok" | "entra_premium_required" | "consent_revoked" | "policy_not_found" | "graph_error";

export interface CaPolicyListItem extends GraphConditionalAccessPolicy {
  reportOnly: boolean;
  /** Whole days since the policy was last modified (its current state began no later). */
  daysInCurrentState: number | null;
}

export interface CaPolicyList {
  status: TenantReadStatus;
  detail: string | null;
  policies: CaPolicyListItem[];
}

export interface CaPolicyImpact {
  status: TenantReadStatus;
  detail: string | null;
  evaluatedAt: string;
  policy: GraphConditionalAccessPolicy | null;
  window: ImpactWindow | null;
  /** False when the sign-in read stopped at MAX_SIGN_IN_PAGES with more pages left. */
  complete: boolean;
  pagesRead: number;
  /** Oldest sign-in actually read (equals window.from's coverage only when complete). */
  oldestSignInRead: string | null;
  summary: ReportOnlyImpactSummary | null;
  readiness: PromotionReadiness | null;
  /** Hash of what an operator reviews — sent back on promote. Null unless status is ok. */
  fingerprint: string | null;
  /** v1.0 /auditLogs/signIns lists interactive user sign-ins; stated so nobody reads it as all traffic. */
  coverageNote: string;
}

const COVERAGE_NOTE =
  "Counts interactive user sign-ins recorded by Microsoft Entra (GET /auditLogs/signIns). Non-interactive, " +
  "service principal and managed identity sign-ins are not included.";

function readFailure(err: unknown): { status: TenantReadStatus; detail: string } {
  if (err instanceof ConsentRevokedError) {
    return { status: "consent_revoked", detail: "Admin consent for this tenant has been revoked or was never granted." };
  }
  if (err instanceof LicenseGapError) {
    return {
      status: "entra_premium_required",
      detail: `Conditional Access and sign-in logs require ${err.feature}, which this tenant does not have.`,
    };
  }
  return { status: "graph_error", detail: err instanceof Error ? err.message : String(err) };
}

async function graphJson(tenantId: string, path: string): Promise<{ ok: true; body: any } | { ok: false; status: number; text: string }> {
  const res = await graphFetchForTenant(tenantId, path);
  if (!res.ok) return { ok: false, status: res.status, text: (await res.text()).slice(0, 500) };
  return { ok: true, body: await res.json() };
}

const POLICY_SELECT = "$select=id,displayName,state,createdDateTime,modifiedDateTime";

export async function listCaPoliciesForTenant(tenantId: string, now = new Date()): Promise<CaPolicyList> {
  try {
    const policies: GraphConditionalAccessPolicy[] = [];
    let next: string | null = `/identity/conditionalAccess/policies?${POLICY_SELECT}`;
    for (let page = 0; next && page < MAX_SIGN_IN_PAGES; page++) {
      const r = await graphJson(tenantId, next);
      if (!r.ok) {
        return { status: "graph_error", detail: `Graph returned ${r.status} listing Conditional Access policies: ${r.text}`, policies: [] };
      }
      policies.push(...((r.body.value ?? []) as GraphConditionalAccessPolicy[]));
      next = typeof r.body["@odata.nextLink"] === "string" ? r.body["@odata.nextLink"] : null;
    }
    return {
      status: "ok",
      detail: null,
      policies: policies
        .map((p) => ({
          ...p,
          reportOnly: p.state === CA_STATE_REPORT_ONLY,
          daysInCurrentState: computeImpactWindow(p, now).reportOnlyDays,
        }))
        .sort((a, b) => Number(b.reportOnly) - Number(a.reportOnly) || (a.displayName ?? "").localeCompare(b.displayName ?? "")),
    };
  } catch (err) {
    const f = readFailure(err);
    log.warn({ tenantId, status: f.status, detail: f.detail }, "ca-promotion: policy list read failed");
    return { ...f, policies: [] };
  }
}

/** A policy id goes into a Graph path — only a GUID is accepted. */
export function isPolicyIdShape(policyId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(policyId);
}

export async function evaluateCaPolicyImpact(tenantId: string, policyId: string, now = new Date()): Promise<CaPolicyImpact> {
  const evaluatedAt = now.toISOString();
  const empty = (status: TenantReadStatus, detail: string, policy: GraphConditionalAccessPolicy | null = null): CaPolicyImpact => ({
    status, detail, evaluatedAt, policy, window: null, complete: false, pagesRead: 0, oldestSignInRead: null,
    summary: null, readiness: null, fingerprint: null, coverageNote: COVERAGE_NOTE,
  });
  if (!isPolicyIdShape(policyId)) return empty("policy_not_found", "Policy id is not a Conditional Access policy GUID.");

  let policy: GraphConditionalAccessPolicy;
  try {
    const r = await graphJson(tenantId, `/identity/conditionalAccess/policies/${policyId}?${POLICY_SELECT}`);
    if (!r.ok) {
      return r.status === 404
        ? empty("policy_not_found", "No Conditional Access policy with this id exists on the tenant.")
        : empty("graph_error", `Graph returned ${r.status} reading the policy: ${r.text}`);
    }
    policy = r.body as GraphConditionalAccessPolicy;
  } catch (err) {
    const f = readFailure(err);
    return empty(f.status, f.detail);
  }

  const window = computeImpactWindow(policy, now);
  const signIns: GraphSignInForImpact[] = [];
  let pagesRead = 0;
  let next: string | null =
    `/auditLogs/signIns?$filter=createdDateTime%20ge%20${window.from}&$top=${SIGN_IN_PAGE_SIZE}`;
  try {
    while (next && pagesRead < MAX_SIGN_IN_PAGES) {
      const r = await graphJson(tenantId, next);
      if (!r.ok) {
        return { ...empty("graph_error", `Graph returned ${r.status} reading sign-in logs: ${r.text}`, policy), window };
      }
      pagesRead++;
      signIns.push(...((r.body.value ?? []) as GraphSignInForImpact[]));
      next = typeof r.body["@odata.nextLink"] === "string" ? r.body["@odata.nextLink"] : null;
    }
  } catch (err) {
    const f = readFailure(err);
    return { ...empty(f.status, f.detail, policy), window };
  }

  const complete = next === null;
  const summary = summarizeReportOnlyImpact(signIns, policyId);
  const oldestSignInRead = signIns.reduce<string | null>(
    (oldest, s) => (s.createdDateTime && (!oldest || s.createdDateTime < oldest) ? s.createdDateTime : oldest),
    null,
  );
  return {
    status: "ok",
    detail: null,
    evaluatedAt,
    policy,
    window,
    complete,
    pagesRead,
    oldestSignInRead,
    summary,
    readiness: promotionReadiness({ policy, summary, complete, window }),
    fingerprint: impactFingerprint({ policy, summary, complete }),
    coverageNote: COVERAGE_NOTE,
  };
}

// ── Promotion ────────────────────────────────────────────────────────────────

export type PromotionRefusalCode =
  | "customer_not_found"
  | "customer_not_connected"
  | "customer_not_testbed"
  | "impact_unverifiable"
  | "not_report_only"
  | "impact_changed"
  | "acknowledgement_required"
  | "catalog_action_missing";

export const PROMOTION_REFUSAL_STATUS: Record<PromotionRefusalCode, number> = {
  customer_not_found: 404,
  customer_not_connected: 400,
  customer_not_testbed: 403,
  impact_unverifiable: 424,
  not_report_only: 409,
  impact_changed: 409,
  acknowledgement_required: 422,
  catalog_action_missing: 409,
};

export interface PromotionActor {
  userId: number | null;
  name: string;
  role: string | null;
  email: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export type PromoteCaPolicyResult =
  | { outcome: "refused"; code: PromotionRefusalCode; message: string; promotionId: number | null; impact: CaPolicyImpact | null }
  | {
      outcome: "succeeded" | "failed";
      promotionId: number;
      changeRequest: { id: number; code: string };
      status: number;
      errorType: string | null;
      message: string | null;
      impact: CaPolicyImpact;
    };

function impactSnapshotForAudit(impact: CaPolicyImpact): Record<string, unknown> {
  return {
    evaluatedAt: impact.evaluatedAt,
    status: impact.status,
    window: impact.window,
    complete: impact.complete,
    pagesRead: impact.pagesRead,
    oldestSignInRead: impact.oldestSignInRead,
    summary: impact.summary,
    readiness: impact.readiness,
    coverageNote: impact.coverageNote,
  };
}

async function writeMspAudit(opts: {
  mspId: number;
  customerId: number;
  actor: PromotionActor;
  actionType: string;
  outcome: "success" | "failure";
  policyId: string;
  policyDisplayName: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(mspAuditLogsTable).values({
      actorUserId: opts.actor.userId,
      actorRole: opts.actor.role,
      mspId: opts.mspId,
      customerId: opts.customerId,
      actionType: opts.actionType,
      entityType: "conditional_access_policy",
      entityId: opts.policyId,
      entityLabel: opts.policyDisplayName,
      ...(opts.actor.correlationId ? { correlationId: opts.actor.correlationId } : {}),
      ipAddress: opts.actor.ipAddress ?? null,
      userAgent: opts.actor.userAgent ?? null,
      outcome: opts.outcome,
      metadata: opts.metadata,
    });
  } catch (err) {
    // The ca_policy_promotions row is the durable, pre-write record; this mirror
    // feeds the MSP audit log surface. A failure here is loud, not silent.
    log.error({ err, mspId: opts.mspId, policyId: opts.policyId, actionType: opts.actionType }, "ca-promotion: msp_audit_logs insert failed");
  }
}

export async function promoteCaPolicy(opts: {
  mspId: number;
  customerId: number;
  policyId: string;
  reviewedFingerprint: string;
  acknowledgeImpact: boolean;
  note: string | null;
  actor: PromotionActor;
}): Promise<PromoteCaPolicyResult> {
  const { mspId, customerId, policyId, actor } = opts;

  const [customer] = await db
    .select({
      id: tenantsTable.id,
      tenantId: tenantsTable.tenantId,
      isTestbed: tenantsTable.isTestbed,
      name: tenantsTable.customerName,
      domain: tenantsTable.domain,
    })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  if (!customer) {
    return { outcome: "refused", code: "customer_not_found", message: "Customer not found for this MSP.", promotionId: null, impact: null };
  }
  if (!customer.tenantId) {
    return { outcome: "refused", code: "customer_not_connected", message: "Customer has no connected tenant.", promotionId: null, impact: null };
  }

  const tenantId = customer.tenantId;
  const impact = await evaluateCaPolicyImpact(tenantId, policyId);
  const displayName = impact.policy?.displayName ?? null;

  // Every refusal past this point is an attempt against a real tenant policy, so it
  // is recorded exactly like a promotion: who tried, what the server saw.
  const refuse = async (code: PromotionRefusalCode, message: string): Promise<PromoteCaPolicyResult> => {
    let promotionId: number | null = null;
    try {
      const [row] = await db
        .insert(caPolicyPromotionsTable)
        .values({
          mspId, customerId, tenantId, policyId,
          policyDisplayName: displayName,
          previousState: impact.policy?.state ?? null,
          newState: CA_STATE_ENABLED,
          outcome: "refused",
          outcomeReason: `${code}: ${message}`,
          impactFingerprint: impact.fingerprint,
          impactSnapshot: impactSnapshotForAudit(impact),
          impactAcknowledged: opts.acknowledgeImpact,
          operatorNote: opts.note,
          actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role,
          completedAt: new Date(),
        })
        .returning({ id: caPolicyPromotionsTable.id });
      promotionId = row?.id ?? null;
    } catch (err) {
      log.error({ err, mspId, customerId, policyId, code }, "ca-promotion: refused-attempt row insert failed");
    }
    await writeMspAudit({
      mspId, customerId, actor, actionType: "ca_policy.promotion_refused", outcome: "failure", policyId,
      policyDisplayName: displayName,
      metadata: { promotionId, code, message, reviewedFingerprint: opts.reviewedFingerprint, serverFingerprint: impact.fingerprint },
    });
    log.info({ mspId, customerId, policyId, code, userId: actor.userId }, "ca-promotion: promotion refused");
    return { outcome: "refused", code, message, promotionId, impact };
  };

  // Launch Control's own TEMPORARY STAGING RESTRICTION (msp-launch-control.ts)
  // applies to this write too: a live Graph write from the MSP console runs only
  // against a testbed-flagged customer until that restriction is lifted everywhere.
  if (!customer.isTestbed) {
    return refuse("customer_not_testbed", "Promotion writes are only available for a customer flagged isTestbed.");
  }
  if (impact.status !== "ok" || !impact.policy || !impact.readiness || !impact.fingerprint) {
    return refuse(
      "impact_unverifiable",
      `The policy's sign-in impact could not be verified (${impact.status}${impact.detail ? `: ${impact.detail}` : ""}). ` +
        "A policy is not enforced without verified impact.",
    );
  }
  if (!impact.readiness.eligible) {
    return refuse("not_report_only", impact.readiness.ineligibleReason ?? "The policy is not report-only.");
  }
  if (impact.fingerprint !== opts.reviewedFingerprint) {
    return refuse(
      "impact_changed",
      "The policy's sign-in impact has changed since it was reviewed. Review the current impact before promoting.",
    );
  }
  if (impact.readiness.requiresAcknowledgement && !opts.acknowledgeImpact) {
    return refuse(
      "acknowledgement_required",
      `Promoting this policy needs explicit acknowledgement: ${impact.readiness.acknowledgementReasons.join(" ")}`,
    );
  }

  const [catalogRow] = await db
    .select({
      id: writeActionCatalogTable.id,
      domain: writeActionCatalogTable.domain,
      actionName: writeActionCatalogTable.actionName,
      surface: writeActionCatalogTable.surface,
      safeOrGated: writeActionCatalogTable.safeOrGated,
    })
    .from(writeActionCatalogTable)
    .where(eq(writeActionCatalogTable.templateId, SET_CA_POLICY_STATE_TEMPLATE_ID))
    .limit(1);
  if (!catalogRow) {
    return refuse("catalog_action_missing", `No write_action_catalog row is linked to ${SET_CA_POLICY_STATE_TEMPLATE_ID}.`);
  }

  // Write-ahead: the row exists (outcome "executing") before any Graph call, and its
  // id is the authorization the executor checks. Insert failure = no write.
  const summary = impact.summary!;
  const [promotion] = await db
    .insert(caPolicyPromotionsTable)
    .values({
      mspId, customerId, tenantId, policyId,
      policyDisplayName: displayName,
      previousState: impact.policy.state ?? null,
      newState: CA_STATE_ENABLED,
      outcome: "executing",
      impactFingerprint: impact.fingerprint,
      impactSnapshot: impactSnapshotForAudit(impact),
      impactAcknowledged: opts.acknowledgeImpact,
      operatorNote: opts.note,
      actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role,
    })
    .returning();
  const promotionId = promotion!.id;

  // Git #4549 — a policy created (or previously left) with the stale "(report-only)"
  // suffix in its name gets renamed as part of promotion, so the tenant-side name
  // never disagrees with the real state. A name that never had the suffix comes
  // back unchanged (a harmless no-op rename).
  const newDisplayName = stripCaReportOnlySuffix(displayName ?? "");
  const proposedPayload = { policyId, state: CA_STATE_ENABLED, displayName: newDisplayName, customerId };
  const changeRequest = await raiseChangeRequestForLaunchControlExecution({
    mspId,
    tenantId,
    tenantName: customer.name,
    primaryDomain: customer.domain ?? "",
    catalogRow,
    templateId: SET_CA_POLICY_STATE_TEMPLATE_ID,
    proposedPayload,
    requestedBy: actor.email ?? actor.name,
    reverseTemplateId: null,
    origin: {
      description:
        `Promote Conditional Access policy "${displayName ?? policyId}" from report-only to enforced on ${customer.name}. ` +
        `Reviewed sign-in impact over ${impact.window?.reportOnlyDays ?? "an unknown number of"} day(s) in report-only: ` +
        `${summary.wouldBlock} would have been blocked, ${summary.wouldInterrupt} interrupted, ` +
        `${summary.affectedUserCount} user(s) affected, ${summary.evaluated} evaluated sign-in(s)` +
        `${impact.complete ? "" : " (incomplete read)"}. Promotion #${promotionId} by ${actor.name}.`,
      scheduledFor: "Immediate — Conditional Access promotion after sign-in impact review",
      impactedUsersCount: summary.affectedUserCount,
    },
  });

  let result: Awaited<ReturnType<typeof import("./workflow-executor.ts")["runBaselineTemplateAgainstTenant"]>>;
  try {
    const { runBaselineTemplateAgainstTenant } = await import("./workflow-executor.ts");
    result = await runBaselineTemplateAgainstTenant(
      SET_CA_POLICY_STATE_TEMPLATE_ID,
      tenantId,
      customerId,
      proposedPayload,
      "ca_promotion",
      { caEnforcement: { kind: "verified_promotion", promotionId } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(caPolicyPromotionsTable)
      .set({ outcome: "failed", outcomeReason: message, changeRequestId: changeRequest.id, completedAt: new Date() })
      .where(eq(caPolicyPromotionsTable.id, promotionId));
    await writeMspAudit({
      mspId, customerId, actor, actionType: "ca_policy.promotion_failed", outcome: "failure", policyId,
      policyDisplayName: displayName,
      metadata: { promotionId, changeRequestId: changeRequest.id, error: message, impact: impactSnapshotForAudit(impact) },
    });
    throw err;
  }

  try {
    await recordLaunchControlExecutionOutcome({ changeRequestId: changeRequest.id, mspId, tenantId, success: result.success });
  } catch (err) {
    log.error({ err, mspId, changeRequestId: changeRequest.id }, "ca-promotion: execution record failed (non-fatal)");
  }

  const message = result.success ? null : typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null).slice(0, 500);
  await db
    .update(caPolicyPromotionsTable)
    .set({
      outcome: result.success ? "succeeded" : "failed",
      outcomeReason: result.success ? null : `${result.errorType ?? "unexpected"} (${result.status}): ${message}`,
      changeRequestId: changeRequest.id,
      templateAuditLogId: result.auditLogId ?? null,
      completedAt: new Date(),
    })
    .where(eq(caPolicyPromotionsTable.id, promotionId));

  await writeMspAudit({
    mspId, customerId, actor,
    actionType: result.success ? "ca_policy.promoted" : "ca_policy.promotion_failed",
    outcome: result.success ? "success" : "failure",
    policyId,
    policyDisplayName: displayName,
    metadata: {
      promotionId,
      changeRequestId: changeRequest.id,
      changeRequestCode: changeRequest.code,
      previousState: impact.policy.state,
      newState: CA_STATE_ENABLED,
      graphStatus: result.status,
      errorType: result.errorType ?? null,
      impactFingerprint: impact.fingerprint,
      impactAcknowledged: opts.acknowledgeImpact,
      operatorNote: opts.note,
      impact: impactSnapshotForAudit(impact),
    },
  });

  log.info(
    { mspId, customerId, policyId, promotionId, success: result.success, status: result.status, userId: actor.userId },
    "ca-promotion: promotion write completed",
  );

  return {
    outcome: result.success ? "succeeded" : "failed",
    promotionId,
    changeRequest,
    status: result.status,
    errorType: result.errorType ?? null,
    message,
    impact,
  };
}

export async function listCaPolicyPromotions(mspId: number, customerId: number, limit = 25): Promise<CaPolicyPromotion[]> {
  return db
    .select()
    .from(caPolicyPromotionsTable)
    .where(and(eq(caPolicyPromotionsTable.mspId, mspId), eq(caPolicyPromotionsTable.customerId, customerId)))
    .orderBy(desc(caPolicyPromotionsTable.createdAt))
    .limit(limit);
}
