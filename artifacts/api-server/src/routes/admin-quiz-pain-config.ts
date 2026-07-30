import { Router } from "express";
import { db, quizPainSignalConfigTable, leadStagingTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { z } from "zod";
import { sql, eq, isNotNull, desc } from "drizzle-orm";
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

    // #135 (Decommission Legacy CRM Phase A). This endpoint used to read
    // `quiz_leads`, then join it to `leads` BY EMAIL to find the lead row to write
    // the derived signals onto. Under `lead_staging` (#83) those are the SAME row —
    // the table is the union of both — so the join is gone and this is one pass.
    // The endpoint therefore collapses rather than translating 1:1; the observable
    // contract ({ updated, total }) is unchanged.
    //
    // `quizType IS NOT NULL` selects rows that actually carry a quiz submission —
    // there is nothing to derive signals from otherwise.
    //
    // The best-per-email dedupe is KEPT even though `ensureLeadStagingForEmail` is
    // find-or-create: `lead_staging.email` carries an index, not a unique
    // constraint, and the #83 backfill can legitimately produce more than one row
    // for an address. Highest `totalScore` still wins, as before.
    const stagedQuizLeads = await db
      .select()
      .from(leadStagingTable)
      .where(isNotNull(leadStagingTable.quizType))
      .orderBy(desc(leadStagingTable.totalScore));

    const bestByEmail = new Map<string, typeof stagedQuizLeads[0]>();
    for (const ql of stagedQuizLeads) {
      if (!bestByEmail.has(ql.email)) {
        bestByEmail.set(ql.email, ql);
      }
    }

    const matched = [...bestByEmail.values()];
    if (matched.length === 0) {
      return res.json({ updated: 0, total: 0 });
    }

    let updated = 0;
    for (const lead of matched) {
      // `lead_staging.quiz_type` is nullable where `quiz_leads.quiz_type` was not,
      // so narrow in code as well as in the WHERE above — the SQL filter cannot
      // narrow the TS type, and deriveSignalsFromQuiz requires a real quizType.
      if (lead.quizType === null) continue;

      const source = lead.source === "lead_magnet" ? "lead_magnet" : "contact_form";
      const signals = deriveSignalsFromQuiz(
        {
          quizType: lead.quizType,
          categoryScores: (lead.categoryScores ?? {}) as Record<string, number>,
          conversation: (lead.conversation ?? []) as { role: "user" | "assistant"; content: string }[],
        },
        source,
        config,
      );

      await db
        .update(leadStagingTable)
        .set({
          painPoints: signals.painPoints,
          maturityIndicators: signals.maturityIndicators,
          engagementSignals: signals.engagementSignals,
          urgencySignals: signals.urgencySignals,
          updatedAt: new Date(),
        })
        .where(eq(leadStagingTable.id, lead.id));

      updated++;
    }

    req.log.info({ updated, total: matched.length }, "quiz-pain-config recalculate complete");
    return res.json({ updated, total: matched.length });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-pain-config/recalculate POST failed");
    return res.status(500).json({ error: "Failed to recalculate lead signals" });
  }
});

export default router;
