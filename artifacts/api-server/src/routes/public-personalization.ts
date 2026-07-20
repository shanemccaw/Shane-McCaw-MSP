import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  analyticsSessionsTable,
  quizLeadsTable,
  engagementOfferFiringsTable,
  engagementOfferRulesTable,
  servicesTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { makeResendToken } from "./quiz";
import { findLeadByEmail } from "../lib/lead-intent";

const router: IRouter = Router();
const log = logger.child({ channel: "growth.website-analytics" });

const publicLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

const stateQuerySchema = z.object({ sessionId: z.string().uuid() });

// ── GET /api/public/personalization/state ──────────────────────────────────────
// Public — no auth required. Resolves the durable, cookie-based session id (Stage 1's
// smc_sid cookie, see analytics.ts) to a personalization confidence tier for a visitor
// who has NOT logged in (website-rebuild-reference-v2.md §3). The "assessment" tier is
// deliberately NOT resolved here — it always requires a real account, checked client-side
// via the existing POST /api/auth/refresh + Authorization Bearer pattern (LandingPage.tsx).
//
// Resolution: session_id -> analytics_sessions.identified_email (set by the existing
// POST /api/analytics/identify call quiz/lead-capture forms already make) -> most recent
// quiz_leads row for that email. A hit means "quiz" tier; no hit (or no identified email
// yet) means "cold". The quiz_leads.lead_offer_result the frontend actually wants to
// render lives behind the real GET /api/quiz/results/:leadId route, which is token-gated
// (verifyResendToken) — so this endpoint also mints a fresh resend token server-side
// (same HMAC helper /quiz/resend-pdf and /quiz/results/:leadId already use) rather than
// duplicating that route's response shape here.
router.get("/public/personalization/state", publicLimiter, async (req: Request, res: Response) => {
  const parsed = stateQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid or missing sessionId" });
    return;
  }

  try {
    const [session] = await db
      .select({ identifiedEmail: analyticsSessionsTable.identifiedEmail })
      .from(analyticsSessionsTable)
      .where(eq(analyticsSessionsTable.sessionId, parsed.data.sessionId))
      .limit(1);

    const email = session?.identifiedEmail;
    if (!email) {
      res.json({ tier: "cold" });
      return;
    }

    const [lead] = await db
      .select({ id: quizLeadsTable.id, quizType: quizLeadsTable.quizType })
      .from(quizLeadsTable)
      .where(eq(quizLeadsTable.email, email))
      .orderBy(desc(quizLeadsTable.createdAt))
      .limit(1);

    if (!lead) {
      res.json({ tier: "cold" });
      return;
    }

    res.json({
      tier: "quiz",
      leadId: lead.id,
      quizType: lead.quizType,
      resendToken: makeResendToken(lead.id),
    });
  } catch (err) {
    log.error({ err }, "GET /public/personalization/state error");
    res.status(500).json({ error: "Unable to resolve personalization state." });
  }
});

const engagementOfferQuerySchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    email: z.string().email().optional(),
  })
  .refine((d) => Boolean(d.sessionId || d.email), { message: "sessionId or email is required" });

// ── GET /api/public/personalization/engagement-offer ───────────────────────────
// Public — no auth required. Stage 4c live-query (website-rebuild-reference-v2.md §3):
// while a recognized visitor is still browsing, ask whether the Engagement Offer Engine
// (engagement-offer-engine.ts) already fired a bundle for them, and if so render it
// immediately instead of waiting on the separate 1-2hr delayed-follow-up workflow.
//
// DISCOVERY (confirmed via code read before building): the engine's decision IS persisted
// — every fire writes a row to engagement_offer_firings (ruleId, leadId, firedAt) — so this
// is a pure read endpoint, not a re-evaluation. discountPct/eligibleServiceIds are NOT
// duplicated onto the firing row; they live on the joined engagement_offer_rules row, which
// is correct for a "what are they eligible for right now" check (vs. a historical record).
// A firing is treated as still live while now < firedAt + rule.cooldownMinutes — the same
// window the engine itself uses to decide whether it's allowed to fire again for that lead.
//
// Lead identity here is the engine's own real id space: leadIntentEventsTable.leadId
// references leadsTable (the CRM leads table populated by the contact form / lead magnet /
// admin actions) — NOT quizLeadsTable, and NOT msp_customers. The bridge is the same one
// analytics.ts's maybeFireIntentEvent/maybeFireCtaFormIntentEvent already use to feed this
// engine: analytics_sessions.identified_email -> findLeadByEmail(email) -> leads.id.
// identifyLead() is called on quiz submit (GenericQuizModal.tsx), so a quiz-tier session's
// identified_email is usually set — but quiz submission never creates a leads row, so a
// quiz-only visitor who never separately submitted the contact form will honestly resolve
// to { eligible: false } here, matching the engine's real (incomplete) reach today. For the
// assessment tier we accept an explicit `email` (the visitor's real, refresh-token-verified
// account email — same already-established pattern as usePortalUrl()'s POST
// /public/checkout/gate) since assessment-tier sessions never call identifyLead on login.
router.get("/public/personalization/engagement-offer", publicLimiter, async (req: Request, res: Response) => {
  const parsed = engagementOfferQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId or email is required" });
    return;
  }

  try {
    let email = parsed.data.email?.toLowerCase().trim() ?? null;

    if (!email && parsed.data.sessionId) {
      const [session] = await db
        .select({ identifiedEmail: analyticsSessionsTable.identifiedEmail })
        .from(analyticsSessionsTable)
        .where(eq(analyticsSessionsTable.sessionId, parsed.data.sessionId))
        .limit(1);
      email = session?.identifiedEmail ?? null;
    }

    if (!email) {
      res.json({ eligible: false });
      return;
    }

    const lead = await findLeadByEmail(email);
    if (!lead) {
      res.json({ eligible: false });
      return;
    }

    const [firing] = await db
      .select({
        firedAt: engagementOfferFiringsTable.firedAt,
        ruleName: engagementOfferRulesTable.name,
        discountPct: engagementOfferRulesTable.discountPct,
        eligibleServiceIds: engagementOfferRulesTable.eligibleServiceIds,
        cooldownMinutes: engagementOfferRulesTable.cooldownMinutes,
      })
      .from(engagementOfferFiringsTable)
      .innerJoin(engagementOfferRulesTable, eq(engagementOfferRulesTable.id, engagementOfferFiringsTable.ruleId))
      .where(and(
        eq(engagementOfferFiringsTable.leadId, lead.id),
        eq(engagementOfferRulesTable.isActive, true),
        isNull(engagementOfferRulesTable.mspId),
      ))
      .orderBy(desc(engagementOfferFiringsTable.firedAt))
      .limit(1);

    const stillLive = firing && firing.firedAt.getTime() + firing.cooldownMinutes * 60_000 > Date.now();
    if (!stillLive) {
      res.json({ eligible: false });
      return;
    }

    const serviceIds = firing.eligibleServiceIds ?? [];
    const services = serviceIds.length
      ? await db
          .select({ id: servicesTable.id, name: servicesTable.name, slug: servicesTable.slug, priceCents: servicesTable.priceCents })
          .from(servicesTable)
          .where(inArray(servicesTable.id, serviceIds))
      : [];

    if (services.length === 0) {
      res.json({ eligible: false });
      return;
    }

    res.json({
      eligible: true,
      ruleName: firing.ruleName,
      discountPct: firing.discountPct,
      services: services.map((s) => ({ id: s.id, name: s.name, slug: s.slug, priceCents: s.priceCents ?? null })),
    });
  } catch (err) {
    log.error({ err }, "GET /public/personalization/engagement-offer error");
    res.status(500).json({ error: "Unable to resolve engagement offer." });
  }
});

export default router;
