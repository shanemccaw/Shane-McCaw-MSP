import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, instructionSetsTable, checklistsTable, artifactSetsTable, deliverableSetsTable, assetLibraryCategoriesTable } from "@workspace/db";
import { eq, ilike, or, desc, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const InstructionSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  description: z.string().max(2000).optional(),
  instructions: z.array(z.string().max(4000)).optional().default([]),
  category: z.string().min(1).max(255).optional().default("Generic"),
});

const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(1000),
});

const ChecklistInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  items: z.array(ChecklistItemSchema).optional().default([]),
  category: z.string().min(1).max(255).optional().default("Generic"),
});

const ArtifactSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  artifacts: z.array(z.string().max(2000)).optional().default([]),
  category: z.string().min(1).max(255).optional().default("Generic"),
});

const DeliverableSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  deliverables: z.array(z.string().max(2000)).optional().default([]),
  category: z.string().min(1).max(255).optional().default("Generic"),
});

const CategoryInputSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

function validationError(res: Response, error: z.ZodError): void {
  const first = error.errors[0];
  res.status(400).json({ error: first?.message ?? "Validation failed", fields: error.errors });
}

// ─── Asset Library Categories ────────────────────────────────────────────────

router.get("/admin/asset-library/categories", requireAdmin, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(assetLibraryCategoriesTable).orderBy(asc(assetLibraryCategoriesTable.name));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.post("/admin/asset-library/categories", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = CategoryInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const name = parsed.data.name.trim();
    const [created] = await db.insert(assetLibraryCategoriesTable).values({ name }).returning();
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "create",
      entityType: "asset_library_category",
      entityId: created.id,
      entityLabel: created.name,
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A category with that name already exists" });
    } else {
      res.status(500).json({ error: "Failed to create category" });
    }
  }
});

router.put("/admin/asset-library/categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = CategoryInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const newName = parsed.data.name.trim();

    const [existing] = await db.select().from(assetLibraryCategoriesTable).where(eq(assetLibraryCategoriesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const oldName = existing.name;

    const [updated] = await db.update(assetLibraryCategoriesTable).set({ name: newName }).where(eq(assetLibraryCategoriesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    // Propagate rename to all asset tables
    if (oldName !== newName) {
      await db.update(instructionSetsTable).set({ category: newName }).where(eq(instructionSetsTable.category, oldName));
      await db.update(checklistsTable).set({ category: newName }).where(eq(checklistsTable.category, oldName));
      await db.update(artifactSetsTable).set({ category: newName }).where(eq(artifactSetsTable.category, oldName));
      await db.update(deliverableSetsTable).set({ category: newName }).where(eq(deliverableSetsTable.category, oldName));
    }

    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "update",
      entityType: "asset_library_category",
      entityId: id,
      entityLabel: newName,
      metadata: { oldName },
    });
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A category with that name already exists" });
    } else {
      res.status(500).json({ error: "Failed to rename category" });
    }
  }
});

router.delete("/admin/asset-library/categories/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [cat] = await db.select().from(assetLibraryCategoriesTable).where(eq(assetLibraryCategoriesTable.id, id)).limit(1);
    if (!cat) { res.status(404).json({ error: "Not found" }); return; }

    // Check usage across all asset tables
    const [isBusy] = await Promise.all([
      db.select({ id: instructionSetsTable.id }).from(instructionSetsTable).where(eq(instructionSetsTable.category, cat.name)).limit(1),
    ]);
    const checklistBusy = await db.select({ id: checklistsTable.id }).from(checklistsTable).where(eq(checklistsTable.category, cat.name)).limit(1);
    const artifactBusy = await db.select({ id: artifactSetsTable.id }).from(artifactSetsTable).where(eq(artifactSetsTable.category, cat.name)).limit(1);
    const deliverableBusy = await db.select({ id: deliverableSetsTable.id }).from(deliverableSetsTable).where(eq(deliverableSetsTable.category, cat.name)).limit(1);

    if (isBusy.length > 0 || checklistBusy.length > 0 || artifactBusy.length > 0 || deliverableBusy.length > 0) {
      res.status(409).json({ error: "Cannot delete a category that is still in use by assets. Reassign or delete those assets first." });
      return;
    }

    const [deleted] = await db.delete(assetLibraryCategoriesTable).where(eq(assetLibraryCategoriesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "delete",
      entityType: "asset_library_category",
      entityId: id,
      entityLabel: deleted.name,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// ─── Instruction Sets ────────────────────────────────────────────────────────

router.get("/admin/asset-library/instruction-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    let query = db.select().from(instructionSetsTable).$dynamic();
    if (q) {
      query = query.where(or(ilike(instructionSetsTable.title, `%${q}%`), ilike(instructionSetsTable.description, `%${q}%`)));
    } else if (category) {
      query = query.where(eq(instructionSetsTable.category, category));
    }
    const rows = await query.orderBy(asc(instructionSetsTable.category), asc(instructionSetsTable.title));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch instruction sets" });
  }
});

router.get("/admin/asset-library/instruction-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(instructionSetsTable).where(eq(instructionSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to fetch instruction set" });
  }
});

router.get("/admin/asset-library/instruction-sets/:id/export", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(instructionSetsTable).where(eq(instructionSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="instruction-set-${id}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(row, null, 2));
  } catch {
    res.status(500).json({ error: "Failed to export instruction set" });
  }
});

router.post("/admin/asset-library/instruction-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = InstructionSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, description, instructions, category } = parsed.data;
    const [created] = await db.insert(instructionSetsTable).values({
      title: title.trim(),
      description: description?.trim() || null,
      instructions,
      category,
    }).returning();
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "create",
      entityType: "instruction_set",
      entityId: created.id,
      entityLabel: created.title,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create instruction set" });
  }
});

router.put("/admin/asset-library/instruction-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = InstructionSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, description, instructions, category } = parsed.data;
    const [updated] = await db.update(instructionSetsTable).set({
      title: title.trim(),
      description: description?.trim() || null,
      instructions,
      category,
      updatedAt: new Date(),
    }).where(eq(instructionSetsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "update",
      entityType: "instruction_set",
      entityId: id,
      entityLabel: updated.title,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update instruction set" });
  }
});

router.delete("/admin/asset-library/instruction-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [deleted] = await db.delete(instructionSetsTable).where(eq(instructionSetsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "delete",
      entityType: "instruction_set",
      entityId: id,
      entityLabel: deleted.title,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete instruction set" });
  }
});

// ─── Checklists ───────────────────────────────────────────────────────────────

router.get("/admin/asset-library/checklists", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    let query = db.select().from(checklistsTable).$dynamic();
    if (q) {
      query = query.where(ilike(checklistsTable.title, `%${q}%`));
    } else if (category) {
      query = query.where(eq(checklistsTable.category, category));
    }
    const rows = await query.orderBy(asc(checklistsTable.category), asc(checklistsTable.title));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch checklists" });
  }
});

router.get("/admin/asset-library/checklists/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(checklistsTable).where(eq(checklistsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to fetch checklist" });
  }
});

router.get("/admin/asset-library/checklists/:id/export", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(checklistsTable).where(eq(checklistsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="checklist-${id}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(row, null, 2));
  } catch {
    res.status(500).json({ error: "Failed to export checklist" });
  }
});

router.post("/admin/asset-library/checklists", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = ChecklistInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, items, category } = parsed.data;
    const [created] = await db.insert(checklistsTable).values({ title: title.trim(), items, category }).returning();
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "create",
      entityType: "checklist",
      entityId: created.id,
      entityLabel: created.title,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create checklist" });
  }
});

router.put("/admin/asset-library/checklists/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = ChecklistInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, items, category } = parsed.data;
    const [updated] = await db.update(checklistsTable).set({ title: title.trim(), items, category, updatedAt: new Date() })
      .where(eq(checklistsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "update",
      entityType: "checklist",
      entityId: id,
      entityLabel: updated.title,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update checklist" });
  }
});

router.delete("/admin/asset-library/checklists/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [deleted] = await db.delete(checklistsTable).where(eq(checklistsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "delete",
      entityType: "checklist",
      entityId: id,
      entityLabel: deleted.title,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete checklist" });
  }
});

// ─── Artifact Sets ────────────────────────────────────────────────────────────

router.get("/admin/asset-library/artifact-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    let query = db.select().from(artifactSetsTable).$dynamic();
    if (q) {
      query = query.where(ilike(artifactSetsTable.title, `%${q}%`));
    } else if (category) {
      query = query.where(eq(artifactSetsTable.category, category));
    }
    const rows = await query.orderBy(asc(artifactSetsTable.category), asc(artifactSetsTable.title));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch artifact sets" });
  }
});

router.get("/admin/asset-library/artifact-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(artifactSetsTable).where(eq(artifactSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to fetch artifact set" });
  }
});

router.get("/admin/asset-library/artifact-sets/:id/export", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(artifactSetsTable).where(eq(artifactSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="artifact-set-${id}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(row, null, 2));
  } catch {
    res.status(500).json({ error: "Failed to export artifact set" });
  }
});

router.post("/admin/asset-library/artifact-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = ArtifactSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, artifacts, category } = parsed.data;
    const [created] = await db.insert(artifactSetsTable).values({ title: title.trim(), artifacts, category }).returning();
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "create",
      entityType: "artifact_set",
      entityId: created.id,
      entityLabel: created.title,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create artifact set" });
  }
});

router.put("/admin/asset-library/artifact-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = ArtifactSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, artifacts, category } = parsed.data;
    const [updated] = await db.update(artifactSetsTable).set({ title: title.trim(), artifacts, category, updatedAt: new Date() })
      .where(eq(artifactSetsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "update",
      entityType: "artifact_set",
      entityId: id,
      entityLabel: updated.title,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update artifact set" });
  }
});

router.delete("/admin/asset-library/artifact-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [deleted] = await db.delete(artifactSetsTable).where(eq(artifactSetsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "delete",
      entityType: "artifact_set",
      entityId: id,
      entityLabel: deleted.title,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete artifact set" });
  }
});

// ─── Deliverable Sets ─────────────────────────────────────────────────────────

router.get("/admin/asset-library/deliverable-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    let query = db.select().from(deliverableSetsTable).$dynamic();
    if (q) {
      query = query.where(ilike(deliverableSetsTable.title, `%${q}%`));
    } else if (category) {
      query = query.where(eq(deliverableSetsTable.category, category));
    }
    const rows = await query.orderBy(asc(deliverableSetsTable.category), asc(deliverableSetsTable.title));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch deliverable sets" });
  }
});

router.get("/admin/asset-library/deliverable-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(deliverableSetsTable).where(eq(deliverableSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to fetch deliverable set" });
  }
});

router.get("/admin/asset-library/deliverable-sets/:id/export", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(deliverableSetsTable).where(eq(deliverableSetsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Disposition", `attachment; filename="deliverable-set-${id}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(row, null, 2));
  } catch {
    res.status(500).json({ error: "Failed to export deliverable set" });
  }
});

router.post("/admin/asset-library/deliverable-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = DeliverableSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, deliverables, category } = parsed.data;
    const [created] = await db.insert(deliverableSetsTable).values({ title: title.trim(), deliverables, category }).returning();
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "create",
      entityType: "deliverable_set",
      entityId: created.id,
      entityLabel: created.title,
    });
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create deliverable set" });
  }
});

router.put("/admin/asset-library/deliverable-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = DeliverableSetInputSchema.safeParse(req.body);
    if (!parsed.success) { validationError(res, parsed.error); return; }
    const { title, deliverables, category } = parsed.data;
    const [updated] = await db.update(deliverableSetsTable).set({ title: title.trim(), deliverables, category, updatedAt: new Date() })
      .where(eq(deliverableSetsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "update",
      entityType: "deliverable_set",
      entityId: id,
      entityLabel: updated.title,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update deliverable set" });
  }
});

router.delete("/admin/asset-library/deliverable-sets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [deleted] = await db.delete(deliverableSetsTable).where(eq(deliverableSetsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    void createAuditLog({
      actorUserId: req.user?.id ?? null,
      actorName: req.user?.email ?? "admin",
      actorRole: "admin",
      actionType: "delete",
      entityType: "deliverable_set",
      entityId: id,
      entityLabel: deleted.title,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete deliverable set" });
  }
});

export default router;
