/**
 * engagement-offer-engine.ts
 *
 * Engagement Offer Engine — fires an offer event when a lead's raw behavioral
 * engagement (distinct pages viewed + a self-computed intent score, both
 * within a per-rule time window) crosses a rule's thresholds.
 *
 * This is deliberately NOT quiz-derived (see lead-offer-engine.ts) and NOT
 * the official Lead Scoring Engine score (see lead-intent.ts). It is a
 * standalone read of raw leadIntentEventsTable rows with its own point-value
 * map, so it must never import from lead-offer-engine.ts, lead-intent.ts, or
 * sales-offer-engine.ts — those coincidences in scoring values are just that,
 * coincidences, not shared code.
 */

import { db, engagementOfferRulesTable, engagementOfferFiringsTable, leadIntentEventsTable } from "@workspace/db";
import { eq, and, gte, isNull, sql } from "drizzle-orm";
import { emitWorkflowEvent } from "./workflow-executor";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.offer" });

const ENGAGEMENT_INTENT_POINTS: Record<string, number> = {
  email_open: 1,
  link_click: 3,
  cta_click: 5,
  site_visit: 2,
  form_submit: 10,
  reply: 15,
};

export async function evaluateEngagementOfferForLead(leadId: number): Promise<{ fired: number; checked: number }> {
  const rules = await db
    .select()
    .from(engagementOfferRulesTable)
    .where(and(
      eq(engagementOfferRulesTable.isActive, true),
      isNull(engagementOfferRulesTable.mspId),
    ));

  let fired = 0;
  const checked = rules.length;

  for (const rule of rules) {
    try {
      const windowStart = new Date(Date.now() - rule.windowMinutes * 60_000);

      const events = await db
        .select({ eventType: leadIntentEventsTable.eventType, metadata: leadIntentEventsTable.metadata })
        .from(leadIntentEventsTable)
        .where(and(
          eq(leadIntentEventsTable.leadId, leadId),
          gte(leadIntentEventsTable.occurredAt, windowStart),
        ));

      const distinctPages = new Set<string>();
      let intentScore = 0;

      for (const event of events) {
        const page = event.metadata?.page;
        if (typeof page === "string" && page.length > 0) {
          distinctPages.add(page);
        }
        intentScore += ENGAGEMENT_INTENT_POINTS[event.eventType] ?? 1;
      }

      const distinctPagesViewed = distinctPages.size;

      if (distinctPagesViewed < rule.minDistinctPagesViewed || intentScore < rule.minIntentScore) {
        continue;
      }

      const recentFiring = await db.execute(sql`
        SELECT id FROM engagement_offer_firings
        WHERE rule_id = ${rule.id} AND lead_id = ${leadId}
          AND fired_at > NOW() - (${rule.cooldownMinutes} || ' minutes')::interval
        LIMIT 1
      `);
      if (recentFiring.rows.length > 0) continue;

      await emitWorkflowEvent(rule.eventName, {
        leadId,
        ruleId: rule.id,
        ruleName: rule.name,
        eligibleServiceIds: rule.eligibleServiceIds,
        discountPct: rule.discountPct,
        distinctPagesViewed,
        intentScore,
      });

      await db.insert(engagementOfferFiringsTable).values({
        ruleId: rule.id,
        leadId,
        firedAt: new Date(),
      });

      fired++;
      log.info({ ruleId: rule.id, ruleName: rule.name, leadId, distinctPagesViewed, intentScore }, "engagement-offer-engine: rule fired");
    } catch (err) {
      log.warn({ err, ruleId: rule.id, leadId }, "engagement-offer-engine: rule evaluation failed — continuing");
    }
  }

  return { fired, checked };
}

export async function evaluateAllEngagementOffers(): Promise<{ leadsChecked: number; totalFired: number }> {
  const leadRows = await db.execute(sql`
    SELECT DISTINCT lead_id AS "leadId" FROM lead_intent_events WHERE occurred_at > NOW() - INTERVAL '24 hours'
  `);
  const leadIds = (leadRows.rows as { leadId: number }[]).map(r => r.leadId);

  let leadsChecked = 0;
  let totalFired = 0;

  for (const leadId of leadIds) {
    try {
      const { fired } = await evaluateEngagementOfferForLead(leadId);
      totalFired += fired;
      leadsChecked++;
    } catch (err) {
      log.warn({ err, leadId }, "engagement-offer-engine: lead evaluation failed — continuing");
    }
  }

  log.info({ leadsChecked, totalFired }, "engagement-offer-engine: evaluateAllEngagementOffers complete");
  return { leadsChecked, totalFired };
}
