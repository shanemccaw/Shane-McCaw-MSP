/**
 * shadow-it-governance.ts — Shadow IT as an accumulating governance risk
 * (#1545, part of #1489).
 *
 * Individual drift events already surface on their own (#1270, drift-collector.ts).
 * "On top of that" (#1545's own words), an accumulating pattern of unauthorized
 * change is a real governance risk ABOUT THE ORGANISATION — it cites an
 * obligation, it has instances, and it can be signed.
 *
 * Model: fits the RBD container-plus-line-items shape #1509 built exactly.
 * **No separate path.** This module is glue, not a new mechanism:
 *   - a standing "Shadow IT" `msp_risk_decisions` container, one per tenant,
 *     created once via the SAME insert shape `msp-rbd.ts` / #1509's
 *     `createAssignedRiskFromRejection` precedent already use for a
 *     system-authored risk (0 liability / empty graphEndpoint are the honest
 *     "unassessed" values that precedent already established — never a
 *     fabricated number);
 *   - one `risk_instances` line item per unauthorized drift occurrence, added
 *     through the SAME `addRiskInstance` #1509 built;
 *   - every accumulation captures a new `msp_rbd_versions` version through the
 *     SAME `createRbdVersion` #1508/#1510 built. That is what makes "signature
 *     on scope expansion" (#1510) apply here with zero extra code: a new
 *     unauthorized change is an addition to the container's live scope, so
 *     `computeRbdScopeDiff` forces a fresh signature exactly the way it would
 *     for any other RBD whose scope grew.
 *
 * Framing (#1545, #1489's non-goal #1546): Shadow IT is the risk, not the
 * individual. The label below names the SETTING and the domain, never a
 * person as the subject of a judgment — `changedBy` is carried into the label
 * as plain attribution text (the same fact drift_events already surfaces
 * individually), not as an accusation. This module must never be extended
 * toward per-person pattern detection; see #1546.
 *
 * Called from `drift-collector.ts`'s `collectDrift`, wrapped in its own
 * try/catch there — a Shadow IT bookkeeping failure must never fail the scan
 * that triggered it, matching `maybeCollectDriftForCheck`'s existing
 * non-fatal contract for drift bookkeeping generally.
 */
import { db, tenantsTable, mspRiskDecisionsTable, type DriftEventVerdict } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { addRiskInstance, listActiveRiskInstancesByDriftEventId, listRiskInstancesByRbdId } from "./rbd-instances.ts";
import { createRbdVersion } from "./rbd-versioning.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.portal" });

/** Verdicts that represent a change made with no linked change request —
 * exactly the fact drift_events already records per-event (#1270's
 * `deriveVerdict`). `informational` and `approved` are excluded: an approved
 * change went through change control, and an informational domain isn't a
 * governance-relevant setting at all. */
const UNAUTHORIZED_VERDICTS: readonly DriftEventVerdict[] = ["attributed_unapproved", "unattributed"];

export function isUnauthorizedVerdict(verdict: DriftEventVerdict): boolean {
  return UNAUTHORIZED_VERDICTS.includes(verdict);
}

/** One drift occurrence eligible for Shadow IT accumulation — the minimal
 * shape this module needs, kept independent of `drift-collector.ts`'s own
 * `PlannedDriftEvent` so there is no import cycle (drift-collector.ts is the
 * caller of this module, not the other way around). */
export interface ShadowItDriftOccurrence {
  /** The persisted `drift_events.id` — required so this occurrence can be
   * logged idempotently and traced back to its source event. */
  driftEventId: number;
  setting: string;
  changedBy: string | null;
  verdict: DriftEventVerdict;
  detectedAt: Date;
}

export interface ShadowItAccumulationResult {
  rbdId: string;
  riskDecisionId: number;
  /** Line items newly added this call (excludes occurrences already logged
   * and still active — see `listActiveRiskInstancesByDriftEventId`). */
  addedInstanceIds: number[];
  versionNumber: number;
  requiresSignature: boolean;
}

const RISK_REVIEW_DAYS = 90;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
function formatReviewDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The one standing Shadow IT container per tenant — deterministic id so a
 * concurrent caller (two domains drifting in the same scan cycle) always
 * resolves to the same row. */
function shadowItRbdId(tenantId: string): string {
  return `RBD-SHADOWIT-${tenantId}`;
}

/**
 * Finds the tenant's standing Shadow IT container, creating it on first use.
 * Values mirror the honest "unassessed, system-authored" shape
 * `portal-change-rejection.ts`'s `createAssignedRiskFromRejection` already
 * established for this exact situation (a risk record system-authored from
 * an event, not from an MSP operator's manual assessment) — `liabilityValueUsd:
 * 0` and `graphEndpoint: ""` are that precedent's real "not yet assessed"
 * values, not invented numbers. `status: "pending_signature"` because #1510's
 * rule makes the very first version of any container require a signature
 * regardless — there is nothing to inherit from.
 */
export async function findOrCreateShadowItRbd(
  mspId: number,
  tenantId: string,
  tenantName: string,
  primaryDomain: string,
): Promise<{ id: number; rbdId: string }> {
  const rbdId = shadowItRbdId(tenantId);
  const [existing] = await db
    .select({ id: mspRiskDecisionsTable.id })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.mspId, mspId), eq(mspRiskDecisionsTable.rbdId, rbdId)))
    .limit(1);
  if (existing) return { id: existing.id, rbdId };

  const now = new Date();
  const reviewDate = new Date(now.getTime() + RISK_REVIEW_DAYS * 86_400_000);

  const [inserted] = await db
    .insert(mspRiskDecisionsTable)
    .values({
      mspId,
      rbdId,
      tenantId,
      tenantName,
      primaryDomain,
      title: "Shadow IT — accumulating unauthorized configuration change",
      controlViolated: "Change Control",
      framework: "Internal Change Control Policy",
      rawRiskLevel: "medium",
      residualRiskLevel: "medium",
      rawRiskScore: 50,
      residualRiskScore: 50,
      liabilityValueUsd: 0,
      hazardDescription:
        "Unauthorized changes are accumulating outside change control for this tenant. " +
        "This describes a pattern of exposure about the organisation, not any individual's " +
        "conduct — each line below is one specific configuration change made with no linked " +
        "change request.",
      graphEndpoint: "",
      compensatingControls: [],
      mspAssessor: { name: "Shadow IT Governance (automated)", upn: "system@platform-drift", timestamp: now.toISOString() },
      clientApprover: { name: "", title: "", email: "", signedAt: null, ipAddress: null, signatureHash: null },
      expirationDate: formatReviewDate(reviewDate),
      status: "pending_signature",
      riskStatus: "Open",
      reviewDate: formatReviewDate(reviewDate),
    })
    .onConflictDoNothing({ target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId] })
    .returning({ id: mspRiskDecisionsTable.id });

  if (inserted) return { id: inserted.id, rbdId };

  // Lost the create race to a concurrent caller (two domains drifting in the
  // same scan cycle) — the row now exists, re-select it.
  const [row] = await db
    .select({ id: mspRiskDecisionsTable.id })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.mspId, mspId), eq(mspRiskDecisionsTable.rbdId, rbdId)))
    .limit(1);
  if (!row) throw new Error(`shadow-it-governance: failed to find-or-create ${rbdId} for msp ${mspId}`);
  return { id: row.id, rbdId };
}

/**
 * Rolls newly-unauthorized drift occurrences into the tenant's standing
 * Shadow IT governance risk. Returns null when there is nothing to log (no
 * unauthorized occurrences this call, or every one of them is already an
 * active line item — a caller passing the same occurrence twice is a no-op,
 * not a duplicate).
 *
 * `domainLabel` is plain display text (e.g. "Conditional Access policy") for
 * the line item's label — passed in by the caller rather than imported from
 * `drift-collector.ts`'s `DRIFT_DOMAINS`, which would create an import cycle
 * (drift-collector.ts is this module's own caller).
 */
export async function recordShadowItDrift(
  tenantId: string,
  domainLabel: string,
  occurrences: ShadowItDriftOccurrence[],
): Promise<ShadowItAccumulationResult | null> {
  const unauthorized = occurrences.filter((o) => isUnauthorizedVerdict(o.verdict));
  if (unauthorized.length === 0) return null;

  const [tenant] = await db
    .select({ mspId: tenantsTable.mspId, tenantName: tenantsTable.customerName, domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);
  if (!tenant) {
    log.warn({ tenantId }, "shadow-it-governance: drift tenant has no tenants row, skipping accumulation");
    return null;
  }

  const { id: riskDecisionId, rbdId } = await findOrCreateShadowItRbd(
    tenant.mspId,
    tenantId,
    tenant.tenantName,
    tenant.domain ?? "",
  );

  const addedInstanceIds: number[] = [];
  for (const occ of unauthorized) {
    // Idempotency: if this exact drift event already has an ACTIVE line item
    // logged against it, this occurrence was already accumulated — never
    // double-log the same still-open exposure.
    const alreadyLogged = await listActiveRiskInstancesByDriftEventId(tenant.mspId, occ.driftEventId);
    if (alreadyLogged.length > 0) continue;

    const attribution = occ.changedBy ? ` by ${occ.changedBy}` : "";
    const created = await addRiskInstance({
      mspId: tenant.mspId,
      riskDecisionId,
      rbdId,
      label: `${domainLabel}: "${occ.setting}" changed${attribution} with no linked change request`,
      objectId: occ.setting,
      foundAt: occ.detectedAt,
      driftEventId: occ.driftEventId,
    });
    if (created) addedInstanceIds.push(created.id);
  }
  if (addedInstanceIds.length === 0) return null;

  // Capture a new version through the SAME mechanism #1510 built — this is
  // what makes "signature required on scope expansion" apply automatically:
  // the newly-added instances are real additions to the live scope
  // `createRbdVersion` derives, so its own diff decides whether a fresh
  // signature is required (it always is here, since at minimum one new
  // instance was just added).
  const [container] = await db
    .select({
      hazardDescription: mspRiskDecisionsTable.hazardDescription,
      compensatingControls: mspRiskDecisionsTable.compensatingControls,
      residualRiskScore: mspRiskDecisionsTable.residualRiskScore,
      residualRiskLevel: mspRiskDecisionsTable.residualRiskLevel,
    })
    .from(mspRiskDecisionsTable)
    .where(eq(mspRiskDecisionsTable.id, riskDecisionId))
    .limit(1);
  if (!container) throw new Error(`shadow-it-governance: container ${riskDecisionId} vanished mid-accumulation`);

  const instances = await listRiskInstancesByRbdId(tenant.mspId, rbdId);
  const scopeInstanceIds = instances.filter((i) => i.status === "active").map((i) => i.id);
  const now = new Date();

  const version = await createRbdVersion({
    mspId: tenant.mspId,
    rbdId,
    tenantId,
    tenantName: tenant.tenantName,
    content: { kind: "shadow_it_governance_risk", domainLabel, generatedAt: now.toISOString() },
    createdBy: { name: "Shadow IT Governance (automated)", upn: "system@platform-drift", timestamp: now.toISOString() },
    scopeInstanceIds,
    narrativeSnapshot: {
      hazardDescription: container.hazardDescription,
      compensatingControls: container.compensatingControls,
      residualRiskScore: container.residualRiskScore,
      residualRiskLevel: container.residualRiskLevel,
    },
  });

  log.info(
    {
      mspId: tenant.mspId,
      rbdId,
      added: addedInstanceIds.length,
      versionNumber: version.versionNumber,
      requiresSignature: version.requiresSignature,
    },
    "shadow-it-governance: unauthorized drift rolled into standing governance risk",
  );

  return {
    rbdId,
    riskDecisionId,
    addedInstanceIds,
    versionNumber: version.versionNumber,
    requiresSignature: version.requiresSignature,
  };
}
