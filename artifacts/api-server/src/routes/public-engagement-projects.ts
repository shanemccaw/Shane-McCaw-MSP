import { Router, type IRouter, type Request, type Response } from "express";
import { db, engagementProjectsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/public/engagement-projects", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(engagementProjectsTable)
      .where(eq(engagementProjectsTable.isVisible, true))
      .orderBy(asc(engagementProjectsTable.sortOrder), asc(engagementProjectsTable.createdAt));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch engagement projects" });
  }
});

export default router;
