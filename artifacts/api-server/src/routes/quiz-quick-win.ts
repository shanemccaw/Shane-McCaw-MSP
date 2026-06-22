import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, quickWinQuizResultsTable, servicesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";

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
    logger.error({ err }, "Failed to save quick win quiz result");
    res.status(500).json({ error: "Failed to save result" });
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

    const slugsToFetch = (result.rankedSlugs as string[]).filter((s): s is typeof VALID_SLUGS[number] =>
      VALID_SLUGS.includes(s as typeof VALID_SLUGS[number])
    );

    const services =
      slugsToFetch.length > 0
        ? await db
            .select({
              slug: servicesTable.slug,
              name: servicesTable.name,
              tagline: servicesTable.tagline,
              price: servicesTable.price,
              pageHref: servicesTable.pageHref,
            })
            .from(servicesTable)
            .where(inArray(servicesTable.slug, slugsToFetch))
        : [];

    const servicesBySlug = Object.fromEntries(services.map((s) => [s.slug, s]));

    res.json({
      id: result.id,
      scores: result.scores,
      rankedSlugs: result.rankedSlugs,
      createdAt: result.createdAt,
      services: servicesBySlug,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch quick win quiz result");
    res.status(500).json({ error: "Failed to fetch result" });
  }
});

export default router;
