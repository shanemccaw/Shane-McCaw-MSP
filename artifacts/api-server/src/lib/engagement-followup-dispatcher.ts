/**
 * engagement-followup-dispatcher.ts
 *
 * Finds engagement_offer_firings rows that haven't yet had a Delayed Follow-Up
 * workflow run spawned for them, and spawns one per firing — the per-lead
 * session-lookup + delay + send_email graph lives in that workflow's own
 * definition (DELAYED_FOLLOWUP_WORKFLOW_NAME), not here.
 *
 * Trigger design note: the Engagement Offer Engine emits rule.eventName on
 * fire (engagement-offer-engine.ts), but that value is a per-rule-configurable
 * DB column and no code or manual SQL migration anywhere seeds
 * engagement_offer_rules rows — the table has never been populated in this
 * environment, so no real eventName value could be confirmed before building.
 * This dispatcher polls the already-real, already-written
 * engagement_offer_firings table directly instead (Shane's call), so the
 * Delayed Follow-Up workflow works regardless of what eventName ends up
 * configured once rules exist.
 */

import {
  db,
  engagementOfferFiringsTable,
  engagementOfferRulesTable,
  leadsTable,
  servicesTable,
  wfDefinitionsTable,
} from "@workspace/db";
import { eq, and, isNull, gte, inArray, sql } from "drizzle-orm";
import { fireWorkflowForDefinition } from "./workflow-executor";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.engagement-offer" });

export const DELAYED_FOLLOWUP_WORKFLOW_NAME = "__system__: Engagement Offer Delayed Follow-Up";

export async function dispatchPendingEngagementFollowups(): Promise<{ checked: number; dispatched: number }> {
  const firings = await db
    .select({
      id: engagementOfferFiringsTable.id,
      leadId: engagementOfferFiringsTable.leadId,
      ruleId: engagementOfferFiringsTable.ruleId,
      ruleName: engagementOfferRulesTable.name,
      eligibleServiceIds: engagementOfferRulesTable.eligibleServiceIds,
      discountPct: engagementOfferRulesTable.discountPct,
    })
    .from(engagementOfferFiringsTable)
    .innerJoin(engagementOfferRulesTable, eq(engagementOfferRulesTable.id, engagementOfferFiringsTable.ruleId))
    .where(and(
      isNull(engagementOfferFiringsTable.followUpDispatchedAt),
      gte(engagementOfferFiringsTable.firedAt, sql`NOW() - INTERVAL '24 hours'`),
    ));

  const checked = firings.length;
  let dispatched = 0;

  if (checked === 0) return { checked, dispatched };

  const [def] = await db
    .select({ id: wfDefinitionsTable.id })
    .from(wfDefinitionsTable)
    .where(eq(wfDefinitionsTable.name, DELAYED_FOLLOWUP_WORKFLOW_NAME))
    .limit(1);

  if (!def) {
    log.warn({ checked }, "engagement-followup-dispatcher: Delayed Follow-Up workflow definition not found — skipping dispatch this cycle");
    return { checked, dispatched };
  }

  for (const firing of firings) {
    try {
      if (firing.leadId == null) {
        log.warn({ firingId: firing.id }, "engagement-followup-dispatcher: firing has no leadId — marking dispatched without spawning a run");
        await db.update(engagementOfferFiringsTable)
          .set({ followUpDispatchedAt: new Date() })
          .where(eq(engagementOfferFiringsTable.id, firing.id));
        continue;
      }

      const [lead] = await db
        .select({ email: leadsTable.email, name: leadsTable.name })
        .from(leadsTable)
        .where(eq(leadsTable.id, firing.leadId))
        .limit(1);

      if (!lead) {
        log.warn({ firingId: firing.id, leadId: firing.leadId }, "engagement-followup-dispatcher: lead not found — marking dispatched without spawning a run");
        await db.update(engagementOfferFiringsTable)
          .set({ followUpDispatchedAt: new Date() })
          .where(eq(engagementOfferFiringsTable.id, firing.id));
        continue;
      }

      const serviceIds = firing.eligibleServiceIds ?? [];
      const services = serviceIds.length > 0
        ? await db.select({ name: servicesTable.name }).from(servicesTable).where(inArray(servicesTable.id, serviceIds))
        : [];
      const serviceNames = services.map(s => s.name).join(", ") || "your recommended services";

      const runId = await fireWorkflowForDefinition(def.id, "manual", `engagement-firing:${firing.id}`, {
        leadId: firing.leadId,
        firingId: firing.id,
        ruleId: firing.ruleId,
        ruleName: firing.ruleName,
        eligibleServiceIds: serviceIds,
        discountPct: firing.discountPct,
        leadEmail: lead.email,
        leadName: lead.name,
        serviceNames,
      });

      if (!runId) {
        // Concurrency limit or no published version — leave followUpDispatchedAt
        // NULL so the next poll cycle retries this firing.
        log.warn({ firingId: firing.id, leadId: firing.leadId }, "engagement-followup-dispatcher: fireWorkflowForDefinition returned no runId — will retry next cycle");
        continue;
      }

      await db.update(engagementOfferFiringsTable)
        .set({ followUpDispatchedAt: new Date(), followUpRunId: runId })
        .where(eq(engagementOfferFiringsTable.id, firing.id));

      dispatched++;
      log.info({ firingId: firing.id, leadId: firing.leadId, runId }, "engagement-followup-dispatcher: spawned Delayed Follow-Up run");
    } catch (err) {
      log.warn({ err, firingId: firing.id }, "engagement-followup-dispatcher: firing dispatch failed — continuing");
    }
  }

  log.info({ checked, dispatched }, "engagement-followup-dispatcher: dispatchPendingEngagementFollowups complete");
  return { checked, dispatched };
}
