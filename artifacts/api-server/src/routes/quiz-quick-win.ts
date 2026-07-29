import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, quickWinQuizResultsTable, servicesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ensureLeadStagingForEmail } from "../lib/lead-intent";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "growth.quiz" });

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many quiz submissions from this IP. Please try again later." },
});

const VALID_SLUGS = [
  "tenant-health-audit",
  "power-platform-quick-start",
  "governance-foundations",
  "migration-readiness-assessment",
  "copilot-readiness-assessment",
  "m365-training-enablement",
] as const;

type QuizSlug = typeof VALID_SLUGS[number];

const submitSchema = z.object({
  answers: z.record(z.string(), z.number()),
  scores: z.record(z.string(), z.number()),
  rankedSlugs: z.array(z.string()).min(1).max(6),
});

router.post("/quiz/quick-win/submit", submitLimiter, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid quiz submission", details: parsed.error.flatten() });
    return;
  }

  const { answers, scores, rankedSlugs } = parsed.data;

  try {
    const [row] = await db
      .insert(quickWinQuizResultsTable)
      .values({ answers, scores, rankedSlugs })
      .returning({ id: quickWinQuizResultsTable.id });

    res.json({ resultId: row.id });
  } catch (err) {
    log.error({ err }, "Failed to save quick win quiz result");
    res.status(500).json({ error: "Failed to save result" });
  }
});

// Identity capture (#83). A quick-win result is anonymous by construction —
// the table has no name or email column at all — so these rows cannot be
// staged leads on their own. This is the promotion point: once a visitor gives
// an email against a result, the result is linked to a lead_staging row and
// that lead (not the anonymous result) is what syncs to Zoho.
const captureSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().max(200).optional(),
});

router.post("/quiz/quick-win/results/:resultId/identify", submitLimiter, async (req, res) => {
  const id = parseInt(String(req.params.resultId), 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid result ID" });
    return;
  }

  const parsed = captureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid identity", details: parsed.error.flatten() });
    return;
  }

  try {
    const [result] = await db
      .select({ id: quickWinQuizResultsTable.id, leadStagingId: quickWinQuizResultsTable.leadStagingId })
      .from(quickWinQuizResultsTable)
      .where(eq(quickWinQuizResultsTable.id, id))
      .limit(1);

    if (!result) {
      res.status(404).json({ error: "Result not found" });
      return;
    }

    const staged = await ensureLeadStagingForEmail(parsed.data.email, {
      name: parsed.data.name,
      company: parsed.data.company,
      source: "quick_win_quiz",
    });

    if (!staged) {
      // Staging is non-fatal by design; the visitor still gets their results.
      res.status(202).json({ resultId: id, leadStagingId: null, synced: false });
      return;
    }

    await db
      .update(quickWinQuizResultsTable)
      .set({ leadStagingId: staged.id })
      .where(eq(quickWinQuizResultsTable.id, id));

    res.json({ resultId: id, leadStagingId: staged.id, synced: true, zohoSyncState: staged.zohoSyncState });
  } catch (err) {
    log.error({ err }, "Failed to capture identity for quick win quiz result");
    res.status(500).json({ error: "Failed to capture identity" });
  }
});

router.get("/quiz/quick-win/results/:resultId", async (req, res) => {
  const id = parseInt(req.params.resultId, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid result ID" });
    return;
  }

  try {
    const [result] = await db
      .select()
      .from(quickWinQuizResultsTable)
      .where(eq(quickWinQuizResultsTable.id, id))
      .limit(1);

    if (!result) {
      res.status(404).json({ error: "Result not found" });
      return;
    }

    const rankedSlugs = result.rankedSlugs as string[];
    const scores = result.scores as Record<string, number>;
    const answers = result.answers as Record<string, number>;

    const validSlugs = rankedSlugs.filter((s): s is QuizSlug =>
      VALID_SLUGS.includes(s as QuizSlug)
    );

    const services =
      validSlugs.length > 0
        ? await db
            .select({
              pageSlug: servicesTable.pageSlug,
              name: servicesTable.name,
              tagline: servicesTable.tagline,
              description: servicesTable.description,
              targetAudience: servicesTable.targetAudience,
              price: servicesTable.price,
              turnaround: servicesTable.turnaround,
              durationDays: servicesTable.durationDays,
              deliverables: servicesTable.deliverables,
              features: servicesTable.features,
              inclusions: servicesTable.inclusions,
              pageHref: servicesTable.pageHref,
              badge: servicesTable.badge,
              highlighted: servicesTable.highlighted,
            })
            .from(servicesTable)
            .where(inArray(servicesTable.pageSlug, validSlugs))
        : [];

    const servicesByPageSlug = Object.fromEntries(services.map((s) => [s.pageSlug, s]));

    const recommendations = rankedSlugs
      .filter((s): s is QuizSlug => VALID_SLUGS.includes(s as QuizSlug))
      .map((slug, index) => {
        const svc = servicesByPageSlug[slug];
        return {
          rank: index + 1,
          slug,
          score: scores[slug] ?? 0,
          service: svc
            ? {
                name: svc.name,
                tagline: svc.tagline ?? null,
                description: svc.description ?? null,
                targetAudience: svc.targetAudience ?? null,
                price: svc.price ?? null,
                turnaround: svc.turnaround ?? null,
                durationDays: svc.durationDays ?? null,
                deliverables: svc.deliverables ?? null,
                features: svc.features ?? null,
                inclusions: svc.inclusions ?? null,
                pageHref: svc.pageHref ?? null,
                badge: svc.badge ?? null,
                highlighted: svc.highlighted ?? false,
              }
            : null,
        };
      });

    res.json({
      id: result.id,
      answers,
      scores,
      rankedSlugs,
      recommendations,
      createdAt: result.createdAt,
    });
  } catch (err) {
    log.error({ err }, "Failed to fetch quick win quiz result");
    res.status(500).json({ error: "Failed to fetch result" });
  }
});

export default router;
