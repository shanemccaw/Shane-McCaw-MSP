import { Router } from "express";
import { db, quizPainSignalConfigTable } from "@workspace/db";
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

const updateSchema = z.object({
  quizTypePainMap: z.record(z.string(), z.array(z.string())),
  categoryPainMap: z.array(z.tuple([z.string(), z.string()])),
});

// GET /api/admin/quiz-pain-config
// Returns the current config, falling back to hardcoded defaults if none exists
router.get("/admin/quiz-pain-config", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(quizPainSignalConfigTable).limit(1);
    const row = rows[0];
    if (!row) {
      return res.json({
        quizTypePainMap: DEFAULT_QUIZ_TYPE_PAIN_MAP,
        categoryPainMap: DEFAULT_CATEGORY_PAIN_MAP,
        isDefault: true,
      });
    }
    return res.json({
      quizTypePainMap: row.quizTypePainMap,
      categoryPainMap: row.categoryPainMap,
      isDefault: false,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-config GET failed");
    return res.status(500).json({ error: "Failed to fetch quiz pain config" });
  }
});

// PUT /api/admin/quiz-pain-config
// Upserts the singleton config row (always id=1; ON CONFLICT enforces single-row semantics)
router.put("/admin/quiz-pain-config", requireAdmin, async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid payload", details: parse.error.flatten() });
  }
  const { quizTypePainMap, categoryPainMap } = parse.data;
  try {
    await db
      .insert(quizPainSignalConfigTable)
      .values({ id: 1, quizTypePainMap, categoryPainMap, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: quizPainSignalConfigTable.id,
        set: { quizTypePainMap, categoryPainMap, updatedAt: sql`now()` },
      });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-config PUT failed");
    return res.status(500).json({ error: "Failed to save quiz pain config" });
  }
});

// DELETE /api/admin/quiz-pain-config
// Resets to defaults by deleting the custom row
router.delete("/admin/quiz-pain-config", requireAdmin, async (req, res) => {
  try {
    await db.delete(quizPainSignalConfigTable);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-config DELETE failed");
    return res.status(500).json({ error: "Failed to reset quiz pain config" });
  }
});

export default router;
