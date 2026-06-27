/**
 * admin-m365-categories.ts
 *
 * CRUD for M365 Script Catalog categories.
 *
 * GET    /api/admin/script-categories           — list all, ordered by display_order
 * POST   /api/admin/script-categories           — create category
 * PATCH  /api/admin/script-categories/:id       — rename or reorder
 * DELETE /api/admin/script-categories/:id       — delete (unlinks scripts, does not delete them)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, scriptCategoriesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /api/admin/script-categories ─────────────────────────────────────────

router.get("/admin/script-categories", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(scriptCategoriesTable)
      .orderBy(asc(scriptCategoriesTable.displayOrder), asc(scriptCategoriesTable.name));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "m365-categories: failed to list");
    res.status(500).json({ error: "Failed to list categories" });
  }
});

// ── POST /api/admin/script-categories ────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  displayOrder: z.number().int().min(0).optional(),
});

router.post("/admin/script-categories", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  try {
    const [row] = await db
      .insert(scriptCategoriesTable)
      .values({ name: parsed.data.name, displayOrder: parsed.data.displayOrder ?? 0 })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "m365-categories: failed to create");
    res.status(500).json({ error: "Failed to create category" });
  }
});

// ── PATCH /api/admin/script-categories/:id ───────────────────────────────────

const updateSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  displayOrder: z.number().int().min(0).optional(),
}).refine(d => d.name !== undefined || d.displayOrder !== undefined, {
  message: "At least one field (name or displayOrder) is required",
});

router.patch("/admin/script-categories/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  try {
    const [row] = await db
      .update(scriptCategoriesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(scriptCategoriesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Category not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err, id }, "m365-categories: failed to update");
    res.status(500).json({ error: "Failed to update category" });
  }
});

// ── DELETE /api/admin/script-categories/:id ──────────────────────────────────
// Cascades via FK: script_catalog_categories rows are deleted automatically.
// Scripts themselves are NOT deleted.

router.delete("/admin/script-categories/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [deleted] = await db
      .delete(scriptCategoriesTable)
      .where(eq(scriptCategoriesTable.id, id))
      .returning({ id: scriptCategoriesTable.id });
    if (!deleted) { res.status(404).json({ error: "Category not found" }); return; }
    res.json({ deleted: true, id });
  } catch (err) {
    logger.error({ err, id }, "m365-categories: failed to delete");
    res.status(500).json({ error: "Failed to delete category" });
  }
});

export default router;
