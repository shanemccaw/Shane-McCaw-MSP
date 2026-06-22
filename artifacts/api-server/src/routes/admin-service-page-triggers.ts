import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicePageTriggerKeysTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/service-page-triggers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(servicePageTriggerKeysTable)
      .orderBy(asc(servicePageTriggerKeysTable.pageSlug));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch service page trigger keys" });
  }
});

router.put("/admin/service-page-triggers/:pageSlug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = req.params["pageSlug"] as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { triggerKeys } = body;
    const keys: string[] = Array.isArray(triggerKeys) ? (triggerKeys as string[]) : [];

    const rows = await db
      .select()
      .from(servicePageTriggerKeysTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(eq(servicePageTriggerKeysTable.pageSlug as any, slug))
      .limit(1);
    const existing = rows[0];

    if (existing) {
      const updated = await db
        .update(servicePageTriggerKeysTable)
        .set({ triggerKeys: keys, updatedAt: new Date() })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq(servicePageTriggerKeysTable.pageSlug as any, slug))
        .returning();
      res.json(updated[0]);
    } else {
      const created = await db
        .insert(servicePageTriggerKeysTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ pageSlug: slug, triggerKeys: keys } as any)
        .returning();
      res.status(201).json(created[0]);
    }
  } catch {
    res.status(500).json({ error: "Failed to update service page trigger keys" });
  }
});

export default router;
