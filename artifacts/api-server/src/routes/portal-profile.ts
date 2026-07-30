import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, quizLeadsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

router.get("/portal/quiz-results", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.json([]); return; }

  const rows = await db
    .select({
      id: quizLeadsTable.id,
      quizType: quizLeadsTable.quizType,
      totalScore: quizLeadsTable.totalScore,
      tier: quizLeadsTable.tier,
      categoryScores: quizLeadsTable.categoryScores,
      createdAt: quizLeadsTable.createdAt,
    })
    .from(quizLeadsTable)
    .where(eq(quizLeadsTable.email, user.email))
    .orderBy(desc(quizLeadsTable.createdAt));

  res.json(rows);
});

export default router;
