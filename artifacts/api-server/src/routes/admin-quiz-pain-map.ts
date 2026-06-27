import { Router } from "express";
import { db, quizPainSignalConfigTable as quizPainMappingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import { sql } from "drizzle-orm";

const router = Router();

const DEFAULT_QUIZ_TYPE_PAIN_MAP: Record<string, string[]> = {
  sharepoint: ["SharePoint", "Governance"],
  migration: ["Migration"],
  "security-compliance": ["Security", "Compliance", "Governance"],
  copilot: ["Copilot", "AI Readiness"],
  teams: ["Teams"],
  "power-platform": ["Power Platform", "Governance"],
  governance: ["Governance", "Compliance"],
  "m365-health": ["Security", "Compliance", "Governance"],
};

const DEFAULT_CATEGORY_PAIN_MAP: [string, string][] = [
  ["sharepoint", "SharePoint"],
  ["teams", "Teams"],
  ["powerplatform", "Power Platform"],
  ["power", "Power Platform"],
  ["security", "Security"],
  ["compliance", "Compliance"],
  ["governance", "Governance"],
  ["copilot", "Copilot"],
  ["migration", "Migration"],
  ["adoption", "Adoption"],
  ["training", "Training"],
];

// GET /api/admin/quiz-pain-map
// Returns the current mapping config, or the hardcoded defaults if none is saved yet.
router.get("/admin/quiz-pain-map", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(quizPainMappingsTable)
      .where(sql`id = 1`)
      .limit(1);
    if (rows.length === 0) {
      return res.json({
        quizTypePainMap: DEFAULT_QUIZ_TYPE_PAIN_MAP,
        categoryPainMap: DEFAULT_CATEGORY_PAIN_MAP,
        isDefault: true,
      });
    }
    const row = rows[0]!;
    const hasQuizType = row.quizTypePainMap && Object.keys(row.quizTypePainMap).length > 0;
    const hasCat = Array.isArray(row.categoryPainMap) && row.categoryPainMap.length > 0;
    return res.json({
      quizTypePainMap: hasQuizType ? row.quizTypePainMap : DEFAULT_QUIZ_TYPE_PAIN_MAP,
      categoryPainMap: hasCat ? row.categoryPainMap : DEFAULT_CATEGORY_PAIN_MAP,
      isDefault: !hasQuizType && !hasCat,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-map GET failed");
    return res.status(500).json({ error: "Failed to fetch quiz pain map" });
  }
});

const PutSchema = z.object({
  quizTypePainMap: z.record(z.string(), z.array(z.string())),
  categoryPainMap: z.array(z.tuple([z.string(), z.string()])),
});

// PUT /api/admin/quiz-pain-map
// Upserts the single-row config (creates on first save, updates thereafter).
router.put("/admin/quiz-pain-map", requireAdmin, async (req, res) => {
  const parsed = PutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const { quizTypePainMap, categoryPainMap } = parsed.data;

  try {
    // Upsert: update row id=1 if it exists, else insert.
    await db.execute(sql`
      INSERT INTO quiz_pain_mappings (id, quiz_type_pain_map, category_pain_map, updated_at)
      VALUES (1, ${JSON.stringify(quizTypePainMap)}::jsonb, ${JSON.stringify(categoryPainMap)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE
        SET quiz_type_pain_map = EXCLUDED.quiz_type_pain_map,
            category_pain_map  = EXCLUDED.category_pain_map,
            updated_at         = now()
    `);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-map PUT failed");
    return res.status(500).json({ error: "Failed to save quiz pain map" });
  }
});

// DELETE /api/admin/quiz-pain-map — resets to defaults by clearing the saved row
router.delete("/admin/quiz-pain-map", requireAdmin, async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM quiz_pain_mappings WHERE id = 1`);
    return res.json({
      ok: true,
      quizTypePainMap: DEFAULT_QUIZ_TYPE_PAIN_MAP,
      categoryPainMap: DEFAULT_CATEGORY_PAIN_MAP,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-map DELETE failed");
    return res.status(500).json({ error: "Failed to reset quiz pain map" });
  }
});

export default router;
