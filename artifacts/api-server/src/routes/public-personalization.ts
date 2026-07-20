import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, analyticsSessionsTable, quizLeadsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { makeResendToken } from "./quiz";

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

export default router;
