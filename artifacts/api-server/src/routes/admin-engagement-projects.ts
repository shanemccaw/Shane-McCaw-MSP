import { Router, type IRouter, type Request, type Response } from "express";
import { db, engagementProjectsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/engagement-projects", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(engagementProjectsTable)
      .orderBy(asc(engagementProjectsTable.sortOrder), asc(engagementProjectsTable.createdAt));
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch engagement projects" });
  }
});

router.get("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(engagementProjectsTable).where(eq(engagementProjectsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to fetch engagement project" });
  }
});

router.post("/admin/engagement-projects", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { title, priceRange, description, triggeredBy, sowItems, pages, sortOrder, isVisible } = body;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" }); return;
    }
    if (!priceRange || typeof priceRange !== "string" || !priceRange.trim()) {
      res.status(400).json({ error: "priceRange is required" }); return;
    }
    const [created] = await db
      .insert(engagementProjectsTable)
      .values({
        title: title.trim(),
        priceRange: (priceRange as string).trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        triggeredBy: Array.isArray(triggeredBy) ? (triggeredBy as string[]) : [],
        sowItems: Array.isArray(sowItems) ? (sowItems as string[]) : [],
        pages: Array.isArray(pages) ? (pages as string[]) : [],
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        isVisible: typeof isVisible === "boolean" ? isVisible : true,
      })
      .returning();
    res.status(201).json(created);
  } catch {
    res.status(500).json({ error: "Failed to create engagement project" });
  }
});

router.put("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { title, priceRange, description, triggeredBy, sowItems, pages, sortOrder, isVisible } = body;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" }); return;
    }
    if (!priceRange || typeof priceRange !== "string" || !priceRange.trim()) {
      res.status(400).json({ error: "priceRange is required" }); return;
    }
    const [updated] = await db
      .update(engagementProjectsTable)
      .set({
        title: title.trim(),
        priceRange: (priceRange as string).trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        triggeredBy: Array.isArray(triggeredBy) ? (triggeredBy as string[]) : [],
        sowItems: Array.isArray(sowItems) ? (sowItems as string[]) : [],
        pages: Array.isArray(pages) ? (pages as string[]) : [],
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        isVisible: typeof isVisible === "boolean" ? isVisible : true,
        updatedAt: new Date(),
      })
      .where(eq(engagementProjectsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update engagement project" });
  }
});

router.delete("/admin/engagement-projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(engagementProjectsTable).where(eq(engagementProjectsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete engagement project" });
  }
});

export default router;
