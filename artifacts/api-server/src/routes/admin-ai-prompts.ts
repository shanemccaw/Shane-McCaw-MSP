import { Router, type Request, type Response } from "express";
import { db, aiPromptsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { getDefaultPromptMeta } from "../lib/prompt-loader";

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

// ── GET /api/admin/ai-prompts/by-key/:key ────────────────────────────────────
// Fetch a single prompt by its string key. If no DB row exists yet, returns the
// hardcoded default from prompt-loader so the dialog can pre-fill correctly.
router.get("/admin/ai-prompts/by-key/:key", requireAdmin, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "").trim();
  if (!key) { res.status(400).json({ error: "Key is required" }); return; }

  const [row] = await db
    .select()
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.key, key))
    .limit(1);

  if (row) { res.json({ prompt: row, fromDb: true }); return; }

  // Not in DB yet — return hardcoded defaults so the dialog can pre-fill
  const meta = getDefaultPromptMeta(key);
  if (!meta) { res.status(404).json({ error: "Prompt key not found" }); return; }

  res.json({
    prompt: {
      id: null,
      key,
      name: meta.name,
      description: meta.description,
      category: meta.category,
      featureArea: meta.featureArea,
      featureRoute: meta.featureRoute,
      model: meta.model ?? null,
      promptBody: meta.body,
      defaultBody: meta.body,
      updatedAt: null,
    },
    fromDb: false,
  });
});

// ── PATCH /api/admin/ai-prompts/by-key/:key ──────────────────────────────────
// Update promptBody for a key; creates the row (upsert) if it doesn't exist.
// Body: { promptBody: string, defaultBody?: string }
router.patch("/admin/ai-prompts/by-key/:key", requireAdmin, async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "").trim();
  if (!key) { res.status(400).json({ error: "Key is required" }); return; }

  const { promptBody, defaultBody } = req.body as { promptBody?: string; defaultBody?: string };
  if (!promptBody?.trim()) { res.status(400).json({ error: "promptBody is required" }); return; }

  const trimmedBody = promptBody.trim();

  // Try update first
  const [updated] = await db
    .update(aiPromptsTable)
    .set({ promptBody: trimmedBody, updatedAt: new Date() })
    .where(eq(aiPromptsTable.key, key))
    .returning();

  if (updated) {
    logger.info({ key }, "admin-ai-prompts: prompt updated by key");
    res.json({ prompt: updated });
    return;
  }

  // Row doesn't exist — insert it using the provided defaultBody or the hardcoded meta
  const meta = getDefaultPromptMeta(key);
  if (!meta && !defaultBody) {
    res.status(404).json({ error: "Prompt key not found and no defaultBody provided" });
    return;
  }

  const fallbackDefault = (defaultBody ?? meta?.body ?? trimmedBody).trim();
  const [inserted] = await db
    .insert(aiPromptsTable)
    .values({
      key,
      name: meta?.name ?? key,
      description: meta?.description ?? "",
      category: (meta?.category as "scripting" | "marketing" | "advisory" | "inbox" | "classification" | "artifacts" | "insights") ?? "insights",
      featureArea: meta?.featureArea ?? "",
      featureRoute: meta?.featureRoute ?? "",
      model: meta?.model,
      promptBody: trimmedBody,
      defaultBody: fallbackDefault,
    })
    .returning();

  logger.info({ key }, "admin-ai-prompts: prompt created via by-key upsert");
  res.json({ prompt: inserted });
});

export default router;
