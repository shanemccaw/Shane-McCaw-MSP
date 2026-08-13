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
import { eq, and, gte, isNull, isNotNull } from "drizzle-orm";
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

/**
 * Resolve an email to a lead id in the LEGACY `leads.id` space, sourced from
 * `lead_staging` (#136 — Decommission Legacy CRM Phase B). No longer reads the
 * `leads` table.
 *
 * The legacy id space is what this function must keep returning: its callers
 * feed the result straight into `lead_intent_events.lead_id` (analytics.ts) and
 * `engagement_offer_firings.lead_id` (public-personalization.ts), both of which
 * still store `leads.id`. Returning a `lead_staging.id` here would put two id
 * spaces in one column and silently match wrong rows.
 *
 * Therefore: a staged lead with no `legacy_lead_id` — i.e. one captured after
 * this cutover — resolves to null, and the Engagement Offer Engine will not
 * fire for it. That is the recorded tradeoff of keeping the id spaces clean;
 * it lifts when those satellite FK columns are re-keyed onto `lead_staging.id`
 * (follow-up to #135/#136, and #114's scoring-engine territory).
 */
export async function findLeadByEmail(email: string): Promise<{ id: number } | null> {
  const [staged] = await db.select({ legacyLeadId: leadStagingTable.legacyLeadId })
    .from(leadStagingTable)
    .where(and(
      eq(leadStagingTable.email, email.toLowerCase().trim()),
      isNotNull(leadStagingTable.legacyLeadId),
    ))
    .limit(1);
  return staged?.legacyLeadId != null ? { id: staged.legacyLeadId } : null;
}

/**
 * Bridges an identity known only outside the CRM (a quiz submission, a portal
 * first-login) into a `lead_staging` row. Delegates wholesale to
 * [[ensureLeadStagingForEmail]] — as of #136 there is no separate `leads` row
 * to create, so this is the staging call plus the legacy-id return contract its
 * callers were written against.
 *
 * Returns the legacy lead id when the staged row has one, else 0. Both current
 * callers (quiz.ts, portal-first-login.ts) fire-and-forget, so a 0 costs them
 * nothing directly — but see findLeadByEmail's note for what a missing legacy
 * id means downstream.
 */
export async function ensureLeadForEmail(
  email: string,
  opts: { name?: string; company?: string; source: "quiz" | "portal_login"; ga4ClientId?: string },
): Promise<number> {
  try {
    // Self-contained — ensureLeadStagingForEmail never throws, so a Zoho outage
    // cannot break the quiz/login flow that called us.
    const staged = await ensureLeadStagingForEmail(email, opts);
    if (!staged) return 0;

    log.info(
      { leadStagingId: staged.id, legacyLeadId: staged.legacyLeadId, source: opts.source },
      "lead-intent: bridged identity into lead_staging",
    );

    return staged.legacyLeadId ?? 0;
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
