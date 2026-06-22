import { Router } from "express";
import { db, quizLeadsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { desc, eq, count, sql, and, isNull, isNotNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// GET /api/admin/quiz-leads — paginated list with optional tier/contacted filters
router.get("/admin/quiz-leads", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;
  const tierParam = req.query.tier;
  const tier = typeof tierParam === "string" && tierParam !== "all" ? tierParam : null;
  const contacted = req.query.contacted;
  const quizTypeParam = req.query.quizType;
  const quizType = typeof quizTypeParam === "string" && quizTypeParam !== "all" ? quizTypeParam : null;

  const filters: SQL[] = [];
  if (tier) filters.push(eq(quizLeadsTable.tier, tier));
  if (contacted === "yes") filters.push(isNotNull(quizLeadsTable.contactedAt));
  else if (contacted === "no") filters.push(isNull(quizLeadsTable.contactedAt));
  if (quizType) filters.push(eq(quizLeadsTable.quizType, quizType));

  const where = filters.length > 0 ? and(...filters) : undefined;

  try {
    const [rows, totals] = await Promise.all([
      db.select().from(quizLeadsTable)
        .where(where)
        .orderBy(desc(quizLeadsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(quizLeadsTable).where(where),
    ]);

    return res.json({
      leads: rows,
      total: totals[0]?.total ?? 0,
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-leads GET failed");
    return res.status(500).json({ error: "Failed to fetch quiz leads" });
  }
});

// GET /api/admin/quiz-leads/stats — summary counts
router.get("/admin/quiz-leads/stats", requireAdmin, async (req, res) => {
  try {
    const [totalRow, contactedRow, thisWeekRow] = await Promise.all([
      db.select({ total: count() }).from(quizLeadsTable),
      db.select({ total: count() }).from(quizLeadsTable).where(isNotNull(quizLeadsTable.contactedAt)),
      db.select({ total: count() }).from(quizLeadsTable).where(
        sql`${quizLeadsTable.createdAt} >= now() - interval '7 days'`
      ),
    ]);

    return res.json({
      total: totalRow[0]?.total ?? 0,
      contacted: contactedRow[0]?.total ?? 0,
      newThisWeek: thisWeekRow[0]?.total ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "admin/quiz-leads/stats GET failed");
    return res.status(500).json({ error: "Failed to fetch quiz lead stats" });
  }
});

// PATCH /api/admin/quiz-leads/:id/contacted — toggle contacted status
const contactedSchema = z.object({
  contacted: z.boolean(),
});

router.patch("/admin/quiz-leads/:id/contacted", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid ID" });

  const parsed = contactedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });

  const { contacted } = parsed.data;

  try {
    const rows = await db
      .update(quizLeadsTable)
      .set({ contactedAt: contacted ? new Date() : null })
      .where(eq(quizLeadsTable.id, id))
      .returning();

    if (rows.length === 0) return res.status(404).json({ error: "Quiz lead not found" });
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "admin/quiz-leads PATCH contacted failed");
    return res.status(500).json({ error: "Failed to update quiz lead" });
  }
});

export default router;
