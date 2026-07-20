import {
  db,
  leadsTable,
  leadIntentEventsTable,
  leadScoringRulesTable,
  leadScoringTrackedPagesTable,
  leadScoringConfigTable,
} from "@workspace/db";
import { eq, and, gte, isNull } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "crm" });

export async function isHighValuePage(page: string): Promise<boolean> {
  const [row] = await db
    .select({ id: leadScoringTrackedPagesTable.id })
    .from(leadScoringTrackedPagesTable)
    .where(and(eq(leadScoringTrackedPagesTable.path, page), eq(leadScoringTrackedPagesTable.isActive, true)))
    .limit(1);
  return row != null;
}

export async function recomputeAndPersistHotScore(leadId: number): Promise<number> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) return 0;

  const [config] = await db
    .select()
    .from(leadScoringConfigTable)
    .where(isNull(leadScoringConfigTable.mspId))
    .limit(1);
  const lookbackDays = config?.lookbackDays ?? 14;
  const maxScore = config?.maxScore ?? 100;

  const rules = await db
    .select()
    .from(leadScoringRulesTable)
    .where(eq(leadScoringRulesTable.isActive, true));
  const rulePoints = (ruleType: string, key: string): number =>
    rules.find(r => r.ruleType === ruleType && r.key === key)?.points ?? 0;

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const events = await db.select().from(leadIntentEventsTable)
    .where(and(eq(leadIntentEventsTable.leadId, leadId), gte(leadIntentEventsTable.occurredAt, cutoff)));

  const intentScore = events.reduce((sum, e) => {
    const points = rules.find(r => r.ruleType === "intent_event" && r.key === e.eventType)?.points;
    return sum + (points ?? 1);
  }, 0);

  // pain_point_bonus/engagement_signal_bonus/urgency_signal_bonus rules are per-count
  // multipliers rather than per-specific-key like intent_event, so they're stored under
  // a fixed key "default" rather than one row per possible pain point/signal value.
  const icpBonus =
    (lead.painPoints?.length ?? 0) * rulePoints("pain_point_bonus", "default") +
    (lead.stage === "Hot" ? rulePoints("stage_bonus", "Hot") : lead.stage === "Warm" ? rulePoints("stage_bonus", "Warm") : 0) +
    (lead.engagementSignals?.length ?? 0) * rulePoints("engagement_signal_bonus", "default") +
    (lead.urgencySignals?.length ?? 0) * rulePoints("urgency_signal_bonus", "default");

  const newScore = Math.min(maxScore, intentScore + icpBonus);
  const prevScore = lead.score;

  await db.update(leadsTable)
    .set({ score: newScore, previousScore: prevScore, updatedAt: new Date() })
    .where(eq(leadsTable.id, leadId));

  return newScore;
}

export async function ingestIntentEvent(
  leadId: number,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<{ event: unknown; hotScore: number }> {
  const [ev] = await db.insert(leadIntentEventsTable).values({
    leadId,
    eventType: eventType as "email_open" | "link_click" | "cta_click" | "site_visit" | "form_submit" | "reply",
    metadata: metadata ?? {},
    occurredAt: new Date(),
  }).returning();
  const hotScore = await recomputeAndPersistHotScore(leadId);
  return { event: ev, hotScore };
}

export async function findLeadByEmail(email: string): Promise<{ id: number } | null> {
  const [lead] = await db.select({ id: leadsTable.id })
    .from(leadsTable)
    .where(eq(leadsTable.email, email.toLowerCase().trim()))
    .limit(1);
  return lead ?? null;
}

/**
 * Bridges an identity known only outside the CRM (a quiz submission, a portal
 * first-login) into a real leadsTable row, so downstream lookups keyed on
 * findLeadByEmail — e.g. the Engagement Offer Engine — have something to find.
 * Check-then-create by email, mirroring crm-pipeline.ts's ensureLeadForClient;
 * non-fatal so a CRM bookkeeping failure never breaks the calling flow.
 */
export async function ensureLeadForEmail(
  email: string,
  opts: { name?: string; company?: string; source: "quiz" | "portal_login" },
): Promise<number> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await findLeadByEmail(normalizedEmail);
    if (existing) return existing.id;

    const [newLead] = await db
      .insert(leadsTable)
      .values({
        name: opts.name?.trim() || normalizedEmail,
        email: normalizedEmail,
        company: opts.company?.trim() || undefined,
        source: opts.source,
        status: "new",
        stage: "Cold",
      })
      .returning({ id: leadsTable.id });

    log.info({ leadId: newLead!.id, source: opts.source }, "lead-intent: created lead from identity bridge");
    return newLead!.id;
  } catch (err) {
    log.warn({ err, email }, "lead-intent: ensureLeadForEmail failed (non-fatal)");
    return 0;
  }
}
