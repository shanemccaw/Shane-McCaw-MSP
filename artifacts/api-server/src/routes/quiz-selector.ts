import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { eq, sql, count } from "drizzle-orm";
import { db, quizAnalyticsEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many quiz submissions from this IP. Please try again later." },
});

const VALID_SLUGS = new Set([
  "tenant-health-audit",
  "power-platform-quick-start",
  "governance-foundations",
  "migration-readiness-assessment",
  "copilot-readiness-assessment",
  "m365-training-enablement",
]);

const resultSchema = z.object({
  slugs: z
    .array(z.string())
    .min(1)
    .max(3)
    .refine((arr) => arr.every((s) => VALID_SLUGS.has(s)), { message: "Invalid slug" }),
});

// POST /api/quiz-selector/result — log a Quick Wins Selector completion (no PII)
router.post("/quiz-selector/result", submitLimiter, async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { slugs } = parsed.data;
  const properties: Record<string, string> = {};
  slugs.forEach((slug, i) => {
    properties[`slug${i + 1}`] = slug;
  });

  try {
    await db.insert(quizAnalyticsEventsTable).values({
      eventName: "quick_wins_selector_result",
      properties,
    });
    return res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "quiz-selector POST /result failed");
    return res.status(500).json({ error: "Failed to record result" });
  }
});

// GET /api/admin/quiz-selector/stats — aggregate counts per recommended slug
router.get("/admin/quiz-selector/stats", requireAdmin, async (req, res) => {
  try {
    const [totalRow, slugRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(quizAnalyticsEventsTable)
        .where(eq(quizAnalyticsEventsTable.eventName, "quick_wins_selector_result")),
      db.execute(sql`
        SELECT slug, COUNT(*)::int AS count
        FROM (
          SELECT ${quizAnalyticsEventsTable.properties}->>'slug1' AS slug
          FROM ${quizAnalyticsEventsTable}
          WHERE ${quizAnalyticsEventsTable.eventName} = 'quick_wins_selector_result'
          UNION ALL
          SELECT ${quizAnalyticsEventsTable.properties}->>'slug2' AS slug
          FROM ${quizAnalyticsEventsTable}
          WHERE ${quizAnalyticsEventsTable.eventName} = 'quick_wins_selector_result'
          UNION ALL
          SELECT ${quizAnalyticsEventsTable.properties}->>'slug3' AS slug
          FROM ${quizAnalyticsEventsTable}
          WHERE ${quizAnalyticsEventsTable.eventName} = 'quick_wins_selector_result'
        ) t
        WHERE slug IS NOT NULL
        GROUP BY slug
        ORDER BY count DESC
      `),
    ]);

    const rows = (slugRows as unknown as { rows: { slug: string; count: number }[] }).rows ?? [];

    return res.json({
      total: totalRow[0]?.total ?? 0,
      bySlugs: rows,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-selector/stats GET failed");
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
