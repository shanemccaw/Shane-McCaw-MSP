import { Router, type IRouter, type Request, type Response } from "express";
import { db, checklistDownloadsTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.post("/downloads/checklist", async (req: Request, res: Response) => {
  const { asset } = req.body as { asset?: string };
  const assetName = typeof asset === "string" && asset.length > 0 ? asset : "copilot-readiness";

  try {
    await db.insert(checklistDownloadsTable).values({ asset: assetName });
    res.status(201).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record download" });
  }
});

router.get("/downloads/checklist/stats", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [totalRow] = await db.select({ count: count() }).from(checklistDownloadsTable);
    res.json({ total: totalRow?.count ?? 0 });
  } catch {
    res.status(500).json({ error: "Failed to read download stats" });
  }
});

export default router;
