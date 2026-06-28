import { Router, type Request, type Response } from "express";
import { db, aiPromptsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

router.get("/admin/ai-prompts", requireAdmin, async (_req: Request, res: Response) => {
  const prompts = await db
    .select()
    .from(aiPromptsTable)
    .orderBy(asc(aiPromptsTable.category), asc(aiPromptsTable.name));
  res.json({ prompts });
});

router.get("/admin/ai-prompts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [prompt] = await db
    .select()
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.id, id))
    .limit(1);

  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }
  res.json({ prompt });
});

router.put("/admin/ai-prompts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { promptBody } = req.body as { promptBody?: string };
  if (!promptBody?.trim()) {
    res.status(400).json({ error: "promptBody is required" });
    return;
  }

  const [updated] = await db
    .update(aiPromptsTable)
    .set({ promptBody: promptBody.trim(), updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Prompt not found" }); return; }

  logger.info({ id, key: updated.key }, "admin-ai-prompts: prompt updated");
  res.json({ prompt: updated });
});

router.post("/admin/ai-prompts/:id/reset", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db
    .select({ defaultBody: aiPromptsTable.defaultBody })
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Prompt not found" }); return; }

  const [updated] = await db
    .update(aiPromptsTable)
    .set({ promptBody: row.defaultBody, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();

  logger.info({ id }, "admin-ai-prompts: prompt reset to default");
  res.json({ prompt: updated });
});

export default router;
