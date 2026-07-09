import { Router, type Request, type Response } from "express";
import { db, aiPromptsTable, aiPromptVersionsTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { getDefaultPromptMeta } from "../lib/prompt-loader";
import { generateAndDeliverDocument } from "../lib/document-generator";
import { generateConsolidatedSowDocument } from "../lib/consolidated-sow-generator";

const router = Router();

// ── Version history helper ───────────────────────────────────────────────────
async function recordVersion(promptId: number, body: string, action: "draft" | "publish" | "reset"): Promise<void> {
  const [last] = await db
    .select({ versionNumber: aiPromptVersionsTable.versionNumber })
    .from(aiPromptVersionsTable)
    .where(eq(aiPromptVersionsTable.promptId, promptId))
    .orderBy(desc(aiPromptVersionsTable.versionNumber))
    .limit(1);
  const nextVersion = (last?.versionNumber ?? 0) + 1;
  await db.insert(aiPromptVersionsTable).values({
    promptId,
    versionNumber: nextVersion,
    body,
    action,
  });
}

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

// ── GET /admin/ai-prompts/:id/versions ───────────────────────────────────────
router.get("/admin/ai-prompts/:id/versions", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const versions = await db
    .select()
    .from(aiPromptVersionsTable)
    .where(eq(aiPromptVersionsTable.promptId, id))
    .orderBy(desc(aiPromptVersionsTable.versionNumber));

  res.json({ versions });
});

// ── PUT /admin/ai-prompts/:id — saves a DRAFT (kept at this path for backward compatibility) ──
// Historically this endpoint published directly. It now always stages a draft so a
// save can never silently overwrite the live/published prompt without an explicit Publish.
router.put("/admin/ai-prompts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { promptBody } = req.body as { promptBody?: string };
  if (!promptBody?.trim()) {
    res.status(400).json({ error: "promptBody is required" });
    return;
  }
  const trimmed = promptBody.trim();

  const [updated] = await db
    .update(aiPromptsTable)
    .set({ draftBody: trimmed, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Prompt not found" }); return; }

  await recordVersion(id, trimmed, "draft");

  logger.info({ id, key: updated.key }, "admin-ai-prompts: draft saved");
  res.json({ prompt: updated });
});

// ── POST /admin/ai-prompts/:id/publish — promote a body to the live/published body ──
// Body: { promptBody?: string } — if omitted, publishes the currently-saved draftBody.
router.post("/admin/ai-prompts/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { promptBody } = req.body as { promptBody?: string };

  const [row] = await db
    .select({ draftBody: aiPromptsTable.draftBody })
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Prompt not found" }); return; }

  const bodyToPublish = (promptBody?.trim() || row.draftBody?.trim() || "");
  if (!bodyToPublish) {
    res.status(400).json({ error: "No draft or body to publish" });
    return;
  }

  const [updated] = await db
    .update(aiPromptsTable)
    .set({ promptBody: bodyToPublish, draftBody: null, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();

  await recordVersion(id, bodyToPublish, "publish");

  logger.info({ id, key: updated!.key }, "admin-ai-prompts: prompt published");
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
    .set({ promptBody: row.defaultBody, draftBody: null, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();

  await recordVersion(id, row.defaultBody, "reset");

  logger.info({ id }, "admin-ai-prompts: prompt reset to default");
  res.json({ prompt: updated });
});

// ── POST /admin/ai-prompts/:id/revert/:versionId — revert to a prior version and publish it ──
// Reverting immediately becomes the new live/published body (and clears any pending
// draft), recorded as its own "publish" version so history stays a linear, auditable trail.
router.post("/admin/ai-prompts/:id/revert/:versionId", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  const versionId = parseInt(String(req.params["versionId"] ?? ""), 10);
  if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [version] = await db
    .select()
    .from(aiPromptVersionsTable)
    .where(eq(aiPromptVersionsTable.id, versionId))
    .limit(1);
  if (!version || version.promptId !== id) { res.status(404).json({ error: "Version not found" }); return; }

  const [updated] = await db
    .update(aiPromptsTable)
    .set({ promptBody: version.body, draftBody: null, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Prompt not found" }); return; }

  await recordVersion(id, version.body, "publish");

  logger.info({ id, versionId }, "admin-ai-prompts: reverted to prior version and published it");
  res.json({ prompt: updated });
});

// ── POST /admin/ai-prompts/:id/test-draft — run the real generation flow using the draft body ──
// Only supported for document-generation and SOW-generation prompt keys.
// Never persists anything to insights_generated_documents.
router.post("/admin/ai-prompts/:id/test-draft", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { clientUserId, projectId, body } = req.body as {
    clientUserId?: number;
    projectId?: number;
    body?: string;
  };
  if (!clientUserId) { res.status(400).json({ error: "clientUserId is required" }); return; }

  const [prompt] = await db
    .select()
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.id, id))
    .limit(1);
  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }

  const testBody = (body ?? prompt.draftBody ?? "").trim();
  if (!testBody) {
    res.status(400).json({ error: "No draft body to test — save a draft first" });
    return;
  }

  const key = prompt.key;

  try {
    if (key === "insights-consulting-consolidated_sow") {
      const result = await generateConsolidatedSowDocument({
        clientUserId,
        projectId: projectId ?? null,
        title: `Test Draft — ${prompt.name}`,
        promptOverride: testBody,
        testMode: true,
      });
      res.json({ htmlContent: result.htmlContent, sowTotal: result.sowTotal, clientName: result.clientName });
      return;
    }

    // The pricing-formula prompt is only meaningful when exercised through the
    // real consolidated SOW pipeline (it's interpolated into the SOW prompt, not
    // used standalone) — route it through the same generator with the formula override.
    if (key === "insights-consulting-sow_pricing_formula") {
      const result = await generateConsolidatedSowDocument({
        clientUserId,
        projectId: projectId ?? null,
        title: `Test Draft — ${prompt.name}`,
        pricingFormulaOverride: testBody,
        testMode: true,
      });
      res.json({ htmlContent: result.htmlContent, sowTotal: result.sowTotal, clientName: result.clientName });
      return;
    }

    if (key.startsWith("insights-report-")) {
      if (!projectId) { res.status(400).json({ error: "projectId is required to test this prompt" }); return; }
      const docType = key.replace("insights-report-", "");
      const result = await generateAndDeliverDocument(clientUserId, projectId, {
        category: "report",
        docType,
        title: `Test Draft — ${prompt.name}`,
      }, { promptOverride: testBody, testMode: true });
      res.json({ htmlContent: result.htmlContent });
      return;
    }

    if (key.startsWith("insights-consulting-")) {
      if (!projectId) { res.status(400).json({ error: "projectId is required to test this prompt" }); return; }
      const docType = key.replace("insights-consulting-", "");
      const result = await generateAndDeliverDocument(clientUserId, projectId, {
        category: "consulting",
        docType,
        title: `Test Draft — ${prompt.name}`,
      }, { promptOverride: testBody, testMode: true });
      res.json({ htmlContent: result.htmlContent });
      return;
    }

    res.status(400).json({ error: "This prompt does not support Test Draft — it isn't used by a document or SOW generation flow" });
  } catch (err) {
    logger.error({ id, key, err }, "admin-ai-prompts: test-draft generation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Test generation failed" });
  }
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
      draftBody: null,
      updatedAt: null,
    },
    fromDb: false,
  });
});

// ── PATCH /api/admin/ai-prompts/by-key/:key ──────────────────────────────────
// Update the published promptBody for a key; creates the row (upsert) if it doesn't exist.
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
    .set({ promptBody: trimmedBody, draftBody: null, updatedAt: new Date() })
    .where(eq(aiPromptsTable.key, key))
    .returning();

  if (updated) {
    await recordVersion(updated.id, trimmedBody, "publish");
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

  await recordVersion(inserted!.id, trimmedBody, "publish");

  logger.info({ key }, "admin-ai-prompts: prompt created via by-key upsert");
  res.json({ prompt: inserted });
});

export default router;
