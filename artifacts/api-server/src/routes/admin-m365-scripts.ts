/**
 * admin-m365-scripts.ts
 *
 * CRUD for the M365 Command Center script catalog and package→script mappings.
 *
 * GET    /api/admin/scripts                          — list all scripts
 * POST   /api/admin/scripts                          — create script
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
import { db, scriptCatalogTable, packageScriptsTable, scriptCatalogCategoriesTable } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

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

// ── Zod schemas ────────────────────────────────────────────────────────────────

const appRegPermissionSchema = z.object({
  permission: z.string().min(1),
  type: z.enum(["Application", "Delegated"]),
  reason: z.string().min(1),
});

const createScriptSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  runbookName: z.string().min(1).max(200),
  appRegPermissions: z.array(appRegPermissionSchema).default([]),
  aiInstructions: z.string().optional(),
  executionMode: z.enum(["automated", "manual"]).default("automated"),
  manualRequirements: z.array(z.string()).default([]),
  psScriptBody: z.string().optional(),
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
      })
      .returning();

    const categoryIds = parsed.data.categoryIds ?? [];
    await syncScriptCategories(row.id, categoryIds);

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

    res.json({ ...row, categoryIds: finalCategoryIds });
  } catch (err) {
    logger.error({ err, id }, "admin-m365-scripts: failed to update script");
    res.status(500).json({ error: "Failed to update script" });
  }
});

router.delete("/admin/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid script id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(scriptCatalogTable)
      .where(eq(scriptCatalogTable.id, id))
      .returning({ id: scriptCatalogTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Script not found" });
      return;
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
