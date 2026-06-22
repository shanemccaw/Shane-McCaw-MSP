import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicePageTriggerKeysTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/public/service-page-triggers", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(servicePageTriggerKeysTable)
      .orderBy(asc(servicePageTriggerKeysTable.pageSlug));
    const mapping: Record<string, string[]> = {};
    for (const row of rows) {
      mapping[row.pageSlug] = row.triggerKeys;
    }
    res.json(mapping);
  } catch {
    res.status(500).json({ error: "Failed to fetch service page trigger keys" });
  }
});

export default router;
