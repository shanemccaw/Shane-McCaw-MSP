/**
 * admin-m365-scripts.ts
 *
 * CRUD for the M365 Command Center script catalog and package→script mappings.
 *
 * GET    /api/admin/scripts                          — list all scripts
 * POST   /api/admin/scripts                          — create script
 * POST   /api/admin/scripts/analyze                 — AI-analyze a PS script body (self-registration)
 * GET    /api/admin/scripts/:id                      — get script by id
 * PUT    /api/admin/scripts/:id                      — update script
 * DELETE /api/admin/scripts/:id                      — delete script
 *
 * GET    /api/admin/package-scripts?packageId=X      — list scripts in a package (sorted by run_order)
 * POST   /api/admin/package-scripts                  — assign script to package
 * PUT    /api/admin/package-scripts/:id              — update run_order
 * DELETE /api/admin/package-scripts/:id              — remove mapping
 *
 * GET    /api/admin/appreg/requirements?packageId=X  — union of all app_reg_permissions for a package
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, scriptCatalogTable, packageScriptsTable, scriptCatalogCategoriesTable, scriptCategoriesTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { isAzureConfigured, pushScriptToAzure, deleteRunbook } from "../lib/azure-automation";
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ── Azure push helper (fire-and-forget) ───────────────────────────────────────

async function tryPushCatalogScriptToAzure(scriptId: number, runbookName: string, psCode: string): Promise<void> {
  if (!isAzureConfigured()) {
    logger.warn({ scriptId }, "admin-m365-scripts: Azure not configured — skipping push to Azure Automation");
    return;
  }
  try {
    await pushScriptToAzure(runbookName, psCode);
    await db
      .update(scriptCatalogTable)
      .set({ azureSyncedAt: new Date() })
      .where(eq(scriptCatalogTable.id, scriptId));
    logger.info({ scriptId, runbookName }, "admin-m365-scripts: pushed to Azure Automation and stamped azureSyncedAt");
  } catch (err) {
    logger.warn({ err, scriptId, runbookName }, "admin-m365-scripts: push to Azure failed (non-fatal) — DB record unchanged");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getScriptCategoryIds(scriptIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (scriptIds.length === 0) return map;
  const rows = await db
    .select({ scriptId: scriptCatalogCategoriesTable.scriptId, categoryId: scriptCatalogCategoriesTable.categoryId })
    .from(scriptCatalogCategoriesTable)
    .where(inArray(scriptCatalogCategoriesTable.scriptId, scriptIds));
  for (const r of rows) {
    if (!map.has(r.scriptId)) map.set(r.scriptId, []);
    map.get(r.scriptId)!.push(r.categoryId);
  }
  return map;
}

async function syncScriptCategories(scriptId: number, categoryIds: number[]): Promise<void> {
  await db.delete(scriptCatalogCategoriesTable).where(eq(scriptCatalogCategoriesTable.scriptId, scriptId));
  if (categoryIds.length > 0) {
    await db.insert(scriptCatalogCategoriesTable).values(
      categoryIds.map(cid => ({ scriptId, categoryId: cid }))
    );
  }
}

const router: IRouter = Router();

// ── Metadata block parser ──────────────────────────────────────────────────────

/**
 * Extracts .CATALOG_NAME and .CATALOG_RUNBOOK from a PowerShell comment block.
 *
 * Supported format:
 *   <#
 *   .CATALOG_NAME  MFA Status Audit
 *   .CATALOG_RUNBOOK  Check-MFAStatus
 *   #>
 *
 * Falls back to the first `# Comment` line as name if no block is present.
 */
function parseCatalogBlock(psBody: string): { name: string | null; runbookName: string | null } {
  let name: string | null = null;
  let runbookName: string | null = null;

  const blockMatch = psBody.match(/<#([\s\S]*?)#>/);
  if (blockMatch) {
    const block = blockMatch[1];
    const nameMatch = block.match(/\.CATALOG_NAME\s+(.+)/i);
    const runbookMatch = block.match(/\.CATALOG_RUNBOOK\s+(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();
    if (runbookMatch) runbookName = runbookMatch[1].trim();
  }

  if (!name) {
    const firstCommentMatch = psBody.match(/^#\s+(.+)/m);
    if (firstCommentMatch) name = firstCommentMatch[1].trim().replace(/^#+\s*/, "");
  }

  return { name, runbookName };
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const appRegPermissionSchema = z.object({
  permission: z.string().min(1),
  type: z.enum(["Application", "Delegated"]),
  reason: z.string().min(1),
});

const outputSchemaPropertySchema = z.object({
  type: z.enum(["string", "number", "boolean", "array", "object"]),
});

const outputSchemaSchema = z.object({
  required: z.array(z.string().min(1)).optional(),
  properties: z.record(z.string(), outputSchemaPropertySchema).optional(),
}).nullable().optional();

const createScriptSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  runbookName: z.string().min(1).max(200),
  appRegPermissions: z.array(appRegPermissionSchema).default([]),
  aiInstructions: z.string().optional(),
  executionMode: z.enum(["automated", "manual"]).default("automated"),
  manualRequirements: z.array(z.string()).default([]),
  psScriptBody: z.string().optional(),
  outputSchema: outputSchemaSchema,
  categoryIds: z.array(z.number().int().positive()).optional(),
});

const updateScriptSchema = createScriptSchema.partial();

const assignPackageScriptSchema = z.object({
  packageId: z.number().int().positive(),
  scriptId: z.number().int().positive(),
  runOrder: z.number().int().min(0).default(0),
});

const updatePackageScriptSchema = z.object({
  runOrder: z.number().int().min(0),
});

// ── POST /api/admin/scripts/analyze ───────────────────────────────────────────
// Parses a PS script body for catalog metadata and uses AI to generate
// description, aiInstructions, suggested categories, and app permissions.
// Must be registered BEFORE /admin/scripts/:id to avoid "analyze" being
// treated as an id parameter.

router.post("/admin/scripts/analyze", requireAdmin, async (req: Request, res: Response) => {
  const parsed = z.object({ psScriptBody: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "psScriptBody is required" });
    return;
  }

  const psBody = parsed.data.psScriptBody;
  const { name, runbookName } = parseCatalogBlock(psBody);

  let categories: Array<{ id: number; name: string }> = [];
  try {
    categories = await db
      .select({ id: scriptCategoriesTable.id, name: scriptCategoriesTable.name })
      .from(scriptCategoriesTable)
      .orderBy(scriptCategoriesTable.displayOrder);
  } catch (err) {
    logger.warn({ err }, "admin-m365-scripts: could not fetch categories for analyze — continuing without");
  }

  const categoryList = categories.length > 0
    ? categories.map(c => c.name).join(", ")
    : "No categories defined yet";

  const prompt = `You are a Microsoft 365 security and governance expert. Analyze the following PowerShell script and return a JSON object describing it for a script catalog.

Available category names (choose only from this list for suggestedCategories):
${categoryList}

=== POWERSHELL SCRIPT ===
${psBody.slice(0, 8000)}
=== END SCRIPT ===

Return ONLY a JSON object with exactly these fields:
{
  "description": "2-4 sentence description of what the script does, what data it collects, and what M365 area it covers",
  "aiInstructions": "2-5 sentences instructing an AI analyzer how to interpret this script's output — what fields to look for, what constitutes a risk finding, how to score security impact",
  "suggestedCategories": ["up to 3 category names chosen ONLY from the available list above"],
  "appRegPermissions": [
    { "permission": "Graph.Permission.Name", "type": "Application", "reason": "why this permission is needed by the script" }
  ]
}

Rules:
- suggestedCategories: use ONLY names from the available list; empty array if none fit
- appRegPermissions: list every Microsoft Graph API permission the script calls or would need; "type" is "Application" for app-only/unattended scripts and "Delegated" for interactive user-context scripts; use official Microsoft Graph permission names (e.g. "User.Read.All", "Policy.Read.All"); if no Graph permissions are needed return an empty array
- Return ONLY the JSON — no markdown fences, no preamble, no trailing text`;

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("No text response from AI");
    raw = textBlock.text.trim();
  } catch (err) {
    logger.error({ err }, "admin-m365-scripts: AI analyze call failed");
    res.status(502).json({ error: "AI analysis failed — please try again" });
    return;
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ raw: raw.slice(0, 300) }, "admin-m365-scripts: analyze response had no JSON");
    res.status(502).json({ error: "AI returned an unparseable response — please try again" });
    return;
  }

  let aiResult: {
    description?: string;
    aiInstructions?: string;
    suggestedCategories?: string[];
    appRegPermissions?: Array<{ permission: string; type: string; reason: string }>;
  };
  try {
    aiResult = JSON.parse(jsonMatch[0]) as typeof aiResult;
  } catch {
    logger.warn({ raw: raw.slice(0, 300) }, "admin-m365-scripts: analyze JSON.parse failed");
    res.status(502).json({ error: "AI returned malformed JSON — please try again" });
    return;
  }

  // Match suggested category names to real IDs
  const suggestedNames = Array.isArray(aiResult.suggestedCategories) ? aiResult.suggestedCategories : [];
  const matchedCategoryIds = categories
    .filter(c => suggestedNames.some(n => n.toLowerCase() === c.name.toLowerCase()))
    .map(c => c.id);

  // Validate / normalise appRegPermissions
  const rawPerms = Array.isArray(aiResult.appRegPermissions) ? aiResult.appRegPermissions : [];
  const appRegPermissions = rawPerms
    .filter(p => p && typeof p.permission === "string" && p.permission.trim())
    .map(p => ({
      permission: String(p.permission).trim(),
      type: p.type === "Delegated" ? "Delegated" : "Application",
      reason: String(p.reason ?? "").trim(),
    })) as Array<{ permission: string; type: "Application" | "Delegated"; reason: string }>;

  res.json({
    name: name ?? null,
    runbookName: runbookName ?? null,
    description: typeof aiResult.description === "string" ? aiResult.description.trim() : "",
    aiInstructions: typeof aiResult.aiInstructions === "string" ? aiResult.aiInstructions.trim() : "",
    suggestedCategoryIds: matchedCategoryIds,
    appRegPermissions,
  });
});

// ── Script Catalog CRUD ────────────────────────────────────────────────────────

router.get("/admin/scripts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(scriptCatalogTable).orderBy(scriptCatalogTable.name);
    const categoryMap = await getScriptCategoryIds(rows.map(r => r.id));
    res.json(rows.map(r => ({ ...r, categoryIds: categoryMap.get(r.id) ?? [] })));
  } catch (err) {
    logger.error({ err }, "admin-m365-scripts: failed to list scripts");
    res.status(500).json({ error: "Failed to list scripts" });
  }
});

router.post("/admin/scripts", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  try {
    const [row] = await db
      .insert(scriptCatalogTable)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        runbookName: parsed.data.runbookName,
        appRegPermissions: parsed.data.appRegPermissions,
        aiInstructions: parsed.data.aiInstructions ?? null,
        executionMode: parsed.data.executionMode ?? "automated",
        manualRequirements: parsed.data.manualRequirements ?? [],
        psScriptBody: parsed.data.psScriptBody ?? null,
        outputSchema: parsed.data.outputSchema ?? null,
      })
      .returning();

    const categoryIds = parsed.data.categoryIds ?? [];
    await syncScriptCategories(row.id, categoryIds);

    // Fire-and-forget push to Azure Automation when script body is provided
    if (parsed.data.psScriptBody?.trim()) {
      void tryPushCatalogScriptToAzure(row.id, row.runbookName, parsed.data.psScriptBody.trim());
    }

    res.status(201).json({ ...row, categoryIds });
  } catch (err) {
    logger.error({ err }, "admin-m365-scripts: failed to create script");
    res.status(500).json({ error: "Failed to create script" });
  }
});

router.get("/admin/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  try {
    const [row] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Script not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to get script");
    res.status(500).json({ error: "Failed to get script" });
  }
});

router.put("/admin/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  const parsed = updateScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const { categoryIds, ...scriptFields } = parsed.data;
    const [row] = await db
      .update(scriptCatalogTable)
      .set({ ...scriptFields, updatedAt: new Date() })
      .where(eq(scriptCatalogTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    if (categoryIds !== undefined) {
      await syncScriptCategories(id, categoryIds);
    }

    const finalCategoryIds = categoryIds !== undefined
      ? categoryIds
      : ((await getScriptCategoryIds([id])).get(id) ?? []);

    // Fire-and-forget re-sync when psScriptBody is part of this update
    const newPsBody = parsed.data.psScriptBody ?? row.psScriptBody;
    if (newPsBody?.trim()) {
      void tryPushCatalogScriptToAzure(id, row.runbookName, newPsBody.trim());
    }

    res.json({ ...row, categoryIds: finalCategoryIds });
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to update script");
    res.status(500).json({ error: "Failed to update script" });
  }
});

// ── POST /api/admin/scripts/:id/push-to-azure ─────────────────────────────────

router.post("/admin/scripts/:id/push-to-azure", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  // Not configured: return a non-fatal warning (200) so the UI can show an
  // informational message without treating it as an error.
  if (!isAzureConfigured()) {
    logger.warn({ id }, "admin-m365-scripts: push-to-azure skipped — Azure not configured");
    res.json({ ok: false, warning: "Azure Automation is not configured on this server — push skipped" });
    return;
  }

  try {
    const [script] = await db
      .select()
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, id))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    if (!script.psScriptBody?.trim()) {
      res.status(400).json({ error: "This script has no PowerShell body to push" });
      return;
    }

    await pushScriptToAzure(script.runbookName, script.psScriptBody.trim());

    const [updated] = await db
      .update(scriptCatalogTable)
      .set({ azureSyncedAt: new Date() })
      .where(eq(scriptCatalogTable.id, id))
      .returning();

    res.json({ ok: true, azureSyncedAt: updated.azureSyncedAt });
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: push-to-azure failed");
    const msg = err instanceof Error ? err.message : "Push to Azure failed";
    res.status(500).json({ error: msg });
  }
});

router.delete("/admin/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  try {
    // Fetch the runbook name before deleting so we can clean up Azure afterward
    const [existing] = await db
      .select({ runbookName: scriptCatalogTable.runbookName, azureSyncedAt: scriptCatalogTable.azureSyncedAt })
      .from(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, id))
      .limit(1);

    const [deleted] = await db
      .delete(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, id))
      .returning({ id: scriptCatalogTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    // If the script was pushed to Azure, delete the matching runbook.
    // This is best-effort: failures are logged but never surface as errors to the client.
    if (existing?.azureSyncedAt && existing.runbookName && isAzureConfigured()) {
      void (async () => {
        try {
          await deleteRunbook(existing.runbookName);
        } catch (err) {
          logger.warn({ err, id, runbookName: existing.runbookName }, "admin-m365-scripts: failed to delete runbook from Azure (non-fatal)");
        }
      })();
    } else if (existing?.azureSyncedAt && !isAzureConfigured()) {
      logger.warn({ id, runbookName: existing.runbookName }, "admin-m365-scripts: Azure not configured — runbook left in Azure after script delete");
    }

    res.json({ deleted: true, id });
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to delete script");
    res.status(500).json({ error: "Failed to delete script" });
  }
});

// ── Package-Script Mappings ────────────────────────────────────────────────────

router.get("/admin/package-scripts", requireAdmin, async (req: Request, res: Response) => {
  const packageId = req.query.packageId ? parseInt(String(req.query.packageId)) : NaN;
  if (isNaN(packageId)) {
    res.status(400).json({ error: "packageId query parameter is required" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: packageScriptsTable.id,
        packageId: packageScriptsTable.packageId,
        scriptId: packageScriptsTable.scriptId,
        runOrder: packageScriptsTable.runOrder,
        createdAt: packageScriptsTable.createdAt,
        script: {
          id: scriptCatalogTable.id,
          name: scriptCatalogTable.name,
          description: scriptCatalogTable.description,
          runbookName: scriptCatalogTable.runbookName,
          appRegPermissions: scriptCatalogTable.appRegPermissions,
          aiInstructions: scriptCatalogTable.aiInstructions,
        },
      })
      .from(packageScriptsTable)
      .innerJoin(scriptCatalogTable, eq(packageScriptsTable.scriptId, scriptCatalogTable.id))
      .where(eq(packageScriptsTable.packageId, packageId))
      .orderBy(asc(packageScriptsTable.runOrder));

    res.json(rows);
  } catch (err) {
    logger.error({ err, packageId }, "admin-m365-scripts: failed to list package scripts");
    res.status(500).json({ error: "Failed to list package scripts" });
  }
});

router.post("/admin/package-scripts", requireAdmin, async (req: Request, res: Response) => {
  const parsed = assignPackageScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { packageId, scriptId, runOrder } = parsed.data;

  // Enforce uniqueness of run_order per package
  try {
    const [existing] = await db
      .select({ id: packageScriptsTable.id })
      .from(packageScriptsTable)
      .where(and(
        eq(packageScriptsTable.packageId, packageId),
        eq(packageScriptsTable.runOrder, runOrder),
      ))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: `run_order ${runOrder} is already taken in this package. Use a different value.` });
      return;
    }

    const [row] = await db
      .insert(packageScriptsTable)
      .values({ packageId, scriptId, runOrder })
      .returning();

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err, packageId, scriptId }, "admin-m365-scripts: failed to assign script to package");
    res.status(500).json({ error: "Failed to assign script to package" });
  }
});

// ── PUT /api/admin/package-scripts/reorder ───────────────────────────────────
// Accepts { packageId, orderedIds: number[] } and reassigns run_order atomically.
// Uses a two-phase approach (temp negative values → final values) to avoid the
// unique (packageId, runOrder) constraint conflict that a direct swap would cause.

router.put("/admin/package-scripts/reorder", requireAdmin, async (req: Request, res: Response) => {
  const reorderSchema = z.object({
    packageId: z.number().int().positive(),
    orderedIds: z.array(z.number().int().positive()).min(1).max(500),
  });

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { packageId, orderedIds } = parsed.data;

  try {
    // Phase 1: set every mapping to a unique negative run_order to clear any
    // value collisions — using -(id) guarantees no two rows share the same temp value.
    for (const id of orderedIds) {
      await db
        .update(packageScriptsTable)
        .set({ runOrder: -id })
        .where(and(eq(packageScriptsTable.id, id), eq(packageScriptsTable.packageId, packageId)));
    }

    // Phase 2: assign the desired sequential positions (0-based).
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(packageScriptsTable)
        .set({ runOrder: i })
        .where(and(eq(packageScriptsTable.id, orderedIds[i]), eq(packageScriptsTable.packageId, packageId)));
    }

    res.json({ reordered: orderedIds.length });
  } catch (err) {
    logger.error({ err, packageId }, "admin-m365-scripts: failed to bulk reorder package scripts");
    res.status(500).json({ error: "Failed to reorder package scripts" });
  }
});

router.put("/admin/package-scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid mapping id" });
    return;
  }

  const parsed = updatePackageScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  try {
    // Fetch the existing mapping to check package context for run_order uniqueness
    const [existing] = await db
      .select()
      .from(packageScriptsTable)
      .where(eq(packageScriptsTable.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Package-script mapping not found" });
      return;
    }

    // Check run_order uniqueness within the same package (excluding self)
    const [conflict] = await db
      .select({ id: packageScriptsTable.id })
      .from(packageScriptsTable)
      .where(and(
        eq(packageScriptsTable.packageId, existing.packageId),
        eq(packageScriptsTable.runOrder, parsed.data.runOrder),
      ))
      .limit(1);

    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: `run_order ${parsed.data.runOrder} is already taken in this package.` });
      return;
    }

    const [updated] = await db
      .update(packageScriptsTable)
      .set({ runOrder: parsed.data.runOrder })
      .where(eq(packageScriptsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to update package-script run_order");
    res.status(500).json({ error: "Failed to update run_order" });
  }
});

router.delete("/admin/package-scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid mapping id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(packageScriptsTable)
      .where(eq(packageScriptsTable.id, id))
      .returning({ id: packageScriptsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Package-script mapping not found" });
      return;
    }
    res.json({ deleted: true, id });
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to remove package-script mapping");
    res.status(500).json({ error: "Failed to remove mapping" });
  }
});

// ── App Registration Requirements ─────────────────────────────────────────────

router.get("/admin/appreg/requirements", requireAdmin, async (req: Request, res: Response) => {
  const packageId = req.query.packageId ? parseInt(String(req.query.packageId)) : NaN;
  if (isNaN(packageId)) {
    res.status(400).json({ error: "packageId query parameter is required" });
    return;
  }

  try {
    const rows = await db
      .select({ appRegPermissions: scriptCatalogTable.appRegPermissions })
      .from(packageScriptsTable)
      .innerJoin(scriptCatalogTable, eq(packageScriptsTable.scriptId, scriptCatalogTable.id))
      .where(eq(packageScriptsTable.packageId, packageId));

    // Flatten and de-duplicate permissions (key = permission+type)
    const seen = new Set<string>();
    const permissions: Array<{ permission: string; type: string; reason: string }> = [];

    for (const row of rows) {
      const perms = Array.isArray(row.appRegPermissions) ? row.appRegPermissions : [];
      for (const p of perms) {
        const key = `${p.permission}::${p.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          permissions.push(p);
        }
      }
    }

    // Group by type for human-readable output
    const applicationPermissions = permissions.filter(p => p.type === "Application");
    const delegatedPermissions = permissions.filter(p => p.type === "Delegated");

    res.json({
      packageId,
      totalScripts: rows.length,
      totalPermissions: permissions.length,
      applicationPermissions,
      delegatedPermissions,
      instructions: permissions.length === 0
        ? "No App Registration permissions are required for scripts in this package."
        : [
            "In Azure AD, navigate to: App Registrations → [your app] → API permissions → Add a permission → Microsoft Graph.",
            "Grant the following permissions, then click 'Grant admin consent':",
            ...applicationPermissions.map(p => `  [Application] ${p.permission} — ${p.reason}`),
            ...delegatedPermissions.map(p => `  [Delegated]   ${p.permission} — ${p.reason}`),
          ],
    });
  } catch (err) {
    logger.error({ err, packageId }, "admin-m365-scripts: failed to build appreg requirements");
    res.status(500).json({ error: "Failed to build App Registration requirements" });
  }
});

export default router;
