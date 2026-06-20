import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, instructionSetsTable, checklistsTable, artifactSetsTable, deliverableSetsTable } from "@workspace/db";
import { eq, ilike, or, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const InstructionSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  description: z.string().max(2000).optional(),
  instructions: z.array(z.string().max(4000)).optional().default([]),
});

const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(1000),
});

const ChecklistInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  items: z.array(ChecklistItemSchema).optional().default([]),
});

const ArtifactSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  artifacts: z.array(z.string().max(2000)).optional().default([]),
});

const DeliverableSetInputSchema = z.object({
  title: z.string().min(1, "title is required").max(255),
  deliverables: z.array(z.string().max(2000)).optional().default([]),
});

function validationError(res: Response, error: z.ZodError): void {
  const first = error.errors[0];
  res.status(400).json({ error: first?.message ?? "Validation failed", fields: error.errors });
}

// ─── Instruction Sets ────────────────────────────────────────────────────────

router.get("/admin/asset-library/instruction-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows = q
      ? await db.select().from(instructionSetsTable)
          .where(or(ilike(instructionSetsTable.title, `%${q}%`), ilike(instructionSetsTable.description, `%${q}%`)))
          .orderBy(desc(instructionSetsTable.createdAt))
      : await db.select().from(instructionSetsTable).orderBy(desc(instructionSetsTable.createdAt));
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
    const { title, description, instructions } = parsed.data;
    const [created] = await db.insert(instructionSetsTable).values({
      title: title.trim(),
      description: description?.trim() || null,
      instructions,
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
    const { title, description, instructions } = parsed.data;
    const [updated] = await db.update(instructionSetsTable).set({
      title: title.trim(),
      description: description?.trim() || null,
      instructions,
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
    const rows = q
      ? await db.select().from(checklistsTable)
          .where(ilike(checklistsTable.title, `%${q}%`))
          .orderBy(desc(checklistsTable.createdAt))
      : await db.select().from(checklistsTable).orderBy(desc(checklistsTable.createdAt));
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
    const { title, items } = parsed.data;
    const [created] = await db.insert(checklistsTable).values({ title: title.trim(), items }).returning();
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
    const { title, items } = parsed.data;
    const [updated] = await db.update(checklistsTable).set({ title: title.trim(), items, updatedAt: new Date() })
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
    const rows = q
      ? await db.select().from(artifactSetsTable)
          .where(ilike(artifactSetsTable.title, `%${q}%`))
          .orderBy(desc(artifactSetsTable.createdAt))
      : await db.select().from(artifactSetsTable).orderBy(desc(artifactSetsTable.createdAt));
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
    const { title, artifacts } = parsed.data;
    const [created] = await db.insert(artifactSetsTable).values({ title: title.trim(), artifacts }).returning();
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
    const { title, artifacts } = parsed.data;
    const [updated] = await db.update(artifactSetsTable).set({ title: title.trim(), artifacts, updatedAt: new Date() })
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
    const rows = q
      ? await db.select().from(deliverableSetsTable)
          .where(ilike(deliverableSetsTable.title, `%${q}%`))
          .orderBy(desc(deliverableSetsTable.createdAt))
      : await db.select().from(deliverableSetsTable).orderBy(desc(deliverableSetsTable.createdAt));
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
    const { title, deliverables } = parsed.data;
    const [created] = await db.insert(deliverableSetsTable).values({ title: title.trim(), deliverables }).returning();
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
    const { title, deliverables } = parsed.data;
    const [updated] = await db.update(deliverableSetsTable).set({ title: title.trim(), deliverables, updatedAt: new Date() })
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
