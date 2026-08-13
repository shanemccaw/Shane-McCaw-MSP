/**
 * engagement-followup-cancellation-guard.ts
 *
 * Purchase Cancellation Guard — when a lead completes checkout for a service
 * that overlaps an Engagement Offer rule's eligibleServiceIds, cancel that
 * lead's in-flight Delayed Follow-Up run so they never get emailed a bundle
 * discount for something they just bought at full price.
 *
 * Cancellation mechanism: flips wf_runs.status to "cancelled" — the exact
 * same update POST /admin/workflows/runs/:id/cancel performs (admin-workflows.ts).
 * The executor rechecks wf_runs.status before running each subsequent node
 * (workflow-executor.ts, main run loop), so a cancelled run's remaining nodes
 * (send_email, in particular) are skipped. KNOWN LIMITATION: this does not
 * interrupt a `delay` node's in-progress in-process wait (a raw setTimeout
 * await, not a resumable/DB-persisted pause) — if the run is currently inside
 * its 2-hour delay, that wait still elapses fully; only the send_email node
 * after it gets skipped. Functionally sufficient for this guard's purpose
 * (never send the stale offer), not a workaround for a real gap.
 *
 * Identity bridge: purchase.completed's clientId is a users.id (the buyer's
 * portal account), a different id-space from the Engagement Offer Engine's
 * leadId (leads.id, pre-signup CRM identity — see engagement-offer-engine.ts).
 * Bridged via email, the same pattern findLeadByEmail (lead-intent.ts) and
 * analytics_sessions.identifiedEmail already use elsewhere in this codebase.
 *
 * Coverage gap (not fabricated around): purchase.completed fires with
 * `serviceIds` only on the modern document-routing emission (portal.ts, the
 * second of two purchase.completed emits per checkout). The other emission
 * (packageKey-only, monitoring-package purchases resolved via
 * checkout_sessions.productSlug) carries no serviceIds, so this guard has
 * nothing to compare against eligibleServiceIds and correctly no-ops for
 * that purchase shape rather than guessing.
 */

import {
  db,
  usersTable,
  leadsTable,
  engagementOfferFiringsTable,
  engagementOfferRulesTable,
  wfRunsTable,
} from "@workspace/db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.engagement-offer" });

export interface CancelConflictingFollowupInput {
  clientId?: number | string;
  /** Comma-separated service IDs from the purchase.completed payload, e.g. "14,22". */
  serviceIds?: string;
}

export interface CancelConflictingFollowupResult {
  checked: boolean;
  matched: boolean;
  cancelledCount: number;
  leadId: number | null;
  cancelledRunIds: number[];
  reason?: string;
}

export async function cancelConflictingEngagementFollowup(
  input: CancelConflictingFollowupInput,
): Promise<CancelConflictingFollowupResult> {
  const clientId = typeof input.clientId === "string" ? parseInt(input.clientId, 10) : input.clientId;
  if (clientId == null || Number.isNaN(clientId)) {
    log.warn({ input }, "cancellation-guard: no clientId in purchase.completed payload — cannot resolve purchaser");
    return { checked: false, matched: false, cancelledCount: 0, leadId: null, cancelledRunIds: [], reason: "missing_client_id" };
  }

  const purchasedServiceIds = (input.serviceIds ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseInt(s, 10))
    .filter(n => !Number.isNaN(n));

  if (purchasedServiceIds.length === 0) {
    log.info({ clientId }, "cancellation-guard: purchase.completed carried no serviceIds (packageKey-only purchase shape) — nothing to check for overlap");
    return { checked: false, matched: false, cancelledCount: 0, leadId: null, cancelledRunIds: [], reason: "no_service_ids_in_payload" };
  }

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
  if (!user?.email) {
    log.warn({ clientId }, "cancellation-guard: purchaser user/email not found");
    return { checked: true, matched: false, cancelledCount: 0, leadId: null, cancelledRunIds: [], reason: "purchaser_not_found" };
  }

  const [lead] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.email, user.email)).limit(1);
  if (!lead) {
    log.info({ clientId, email: user.email }, "cancellation-guard: no matching lead row for purchaser email — no engagement-offer history to guard");
    return { checked: true, matched: false, cancelledCount: 0, leadId: null, cancelledRunIds: [], reason: "no_matching_lead" };
  }

  const candidates = await db
    .select({
      firingId: engagementOfferFiringsTable.id,
      runId: engagementOfferFiringsTable.followUpRunId,
      eligibleServiceIds: engagementOfferRulesTable.eligibleServiceIds,
    })
    .from(engagementOfferFiringsTable)
    .innerJoin(engagementOfferRulesTable, eq(engagementOfferRulesTable.id, engagementOfferFiringsTable.ruleId))
    .where(and(
      eq(engagementOfferFiringsTable.leadId, lead.id),
      isNotNull(engagementOfferFiringsTable.followUpRunId),
    ))
    .orderBy(desc(engagementOfferFiringsTable.firedAt));

  const matches = candidates.filter(c =>
    (c.eligibleServiceIds ?? []).some(id => purchasedServiceIds.includes(id)),
  );

  if (matches.length === 0) {
    log.info({ clientId, leadId: lead.id, purchasedServiceIds }, "cancellation-guard: no pending follow-up run overlaps the purchased services");
    return { checked: true, matched: false, cancelledCount: 0, leadId: lead.id, cancelledRunIds: [] };
  }

  const cancelledRunIds: number[] = [];
  for (const match of matches) {
    const runId = match.runId;
    if (runId == null) continue;
    const [run] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
    if (!run || (run.status !== "pending" && run.status !== "running")) continue;

    await db.update(wfRunsTable)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(wfRunsTable.id, runId));
    cancelledRunIds.push(runId);
    log.info(
      { clientId, leadId: lead.id, firingId: match.firingId, runId },
      "cancellation-guard: cancelled in-flight Delayed Follow-Up run — lead already purchased an eligible service",
    );
  }

  return {
    checked: true,
    matched: true,
    cancelledCount: cancelledRunIds.length,
    leadId: lead.id,
    cancelledRunIds,
  };
}
