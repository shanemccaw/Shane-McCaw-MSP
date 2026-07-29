import {
  db,
  leadsTable,
  leadStagingTable,
  leadIntentEventsTable,
  leadScoringRulesTable,
  leadScoringTrackedPagesTable,
  leadScoringConfigTable,
  type LeadStaging,
} from "@workspace/db";
import { eq, and, gte, isNull } from "drizzle-orm";
import { logger } from "./logger";
import { queueLeadStagingPush } from "./zoho-lead-sync.ts";
import { ZOHO_DEFAULT_MSP_ID } from "./zoho-client.ts";

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
  opts: { name?: string; company?: string; source: "quiz" | "portal_login"; ga4ClientId?: string },
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

    // Zoho CRM (#83): the same identity is staged and queued for Zoho. Awaited
    // but self-contained — ensureLeadStagingForEmail never throws, so a Zoho
    // outage cannot break the quiz/login flow that called us.
    await ensureLeadStagingForEmail(normalizedEmail, { ...opts, legacyLeadId: newLead!.id });

    return newLead!.id;
  } catch (err) {
    log.warn({ err, email }, "lead-intent: ensureLeadForEmail failed (non-fatal)");
    return 0;
  }
}

/**
 * The lead_staging half of the identity bridge (#83), and the single place a
 * captured identity becomes a Zoho-bound lead.
 *
 * Find-or-create by email, then queue an upsert push. Returns the staged row,
 * or null if staging failed — callers treat that as "no Zoho sync", never as a
 * reason to fail their own flow.
 *
 * An already-staged email is NOT re-queued: `zoho_upsert_lead` is idempotent,
 * but re-queueing on every login would put one job per login on the drain for
 * no new information.
 */
export async function ensureLeadStagingForEmail(
  email: string,
  opts: {
    name?: string;
    company?: string;
    source: "quiz" | "portal_login" | "quick_win_quiz" | "contact_form" | "assessment" | "purchase" | "lead_magnet";
    legacyLeadId?: number;
    legacyQuizLeadId?: number;
    ga4ClientId?: string;
  },
): Promise<LeadStaging | null> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return null;

    const [existing] = await db
      .select()
      .from(leadStagingTable)
      .where(eq(leadStagingTable.email, normalizedEmail))
      .limit(1);

    if (existing) return existing;

    const [staged] = await db
      .insert(leadStagingTable)
      .values({
        name: opts.name?.trim() || normalizedEmail,
        email: normalizedEmail,
        company: opts.company?.trim() || null,
        source: opts.source,
        status: "new",
        stage: "Cold",
        legacyLeadId: opts.legacyLeadId ?? null,
        legacyQuizLeadId: opts.legacyQuizLeadId ?? null,
        ga4ClientId: opts.ga4ClientId?.trim() || null,
      })
      .returning();

    log.info({ leadStagingId: staged?.id, source: opts.source }, "lead-intent: staged lead for Zoho sync");
    await queueLeadStagingPush(staged, { mspId: ZOHO_DEFAULT_MSP_ID });
    return staged ?? null;
  } catch (err) {
    log.warn({ err, email }, "lead-intent: ensureLeadStagingForEmail failed (non-fatal)");
    return null;
  }
}
