import { Router } from "express";
import { db, quizPainSignalConfigTable, leadsTable, quizLeadsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import { sql, eq, inArray, desc } from "drizzle-orm";
import { loadQuizPainConfig, deriveSignalsFromQuiz } from "../lib/derive-quiz-signals";

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

// POST /api/admin/quiz-pain-config/recalculate
// Re-derives pain signals for every lead that has a matching quiz submission,
// using the current saved config. Returns { updated, total }.
router.post("/admin/quiz-pain-config/recalculate", requireAdmin, async (req, res) => {
  try {
    const config = await loadQuizPainConfig();

    // Fetch all quiz leads ordered by total score desc so the first entry
    // per email is the highest-scoring (best) match.
    const allQuizLeads = await db
      .select()
      .from(quizLeadsTable)
      .orderBy(desc(quizLeadsTable.totalScore));

    // Keep only the best quiz match per email
    const bestByEmail = new Map<string, typeof allQuizLeads[0]>();
    for (const ql of allQuizLeads) {
      if (!bestByEmail.has(ql.email)) {
        bestByEmail.set(ql.email, ql);
      }
    }

    const emails = [...bestByEmail.keys()];
    if (emails.length === 0) {
      return res.json({ updated: 0, total: 0 });
    }

    // Fetch all leads whose email matches a quiz submission
    const matchedLeads = await db
      .select({ id: leadsTable.id, email: leadsTable.email, source: leadsTable.source })
      .from(leadsTable)
      .where(inArray(leadsTable.email, emails));

    let updated = 0;
    for (const lead of matchedLeads) {
      const quiz = bestByEmail.get(lead.email);
      if (!quiz) continue;

      const source = lead.source === "lead_magnet" ? "lead_magnet" : "contact_form";
      const signals = deriveSignalsFromQuiz(
        {
          quizType: quiz.quizType,
          categoryScores: (quiz.categoryScores ?? {}) as Record<string, number>,
          conversation: (quiz.conversation ?? []) as { role: "user" | "assistant"; content: string }[],
        },
        source,
        config,
      );

      await db
        .update(leadsTable)
        .set({
          painPoints: signals.painPoints,
          maturityIndicators: signals.maturityIndicators,
          engagementSignals: signals.engagementSignals,
          urgencySignals: signals.urgencySignals,
          updatedAt: new Date(),
        })
        .where(eq(leadsTable.id, lead.id));

      updated++;
    }

    req.log.info({ updated, total: matchedLeads.length }, "quiz-pain-config recalculate complete");
    return res.json({ updated, total: matchedLeads.length });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-config/recalculate POST failed");
    return res.status(500).json({ error: "Failed to recalculate lead signals" });
  }
});

export default router;
