import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectTemplatesTable, projectTemplateTasksTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/project-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(projectTemplatesTable).orderBy(projectTemplatesTable.createdAt);
    res.json(templates);
  } catch {
    res.status(500).json({ error: "Failed to fetch project templates" });
  }
});

router.post("/admin/project-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, workflowTemplateId, serviceId } = req.body as { name?: string; workflowTemplateId?: number | null; serviceId?: number | null };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [template] = await db
      .insert(projectTemplatesTable)
      .values({ name, workflowTemplateId: workflowTemplateId ?? null, serviceId: serviceId ?? null })
      .returning();
    res.status(201).json(template);
  } catch {
    res.status(500).json({ error: "Failed to create project template" });
  }
});

router.get("/admin/project-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [template] = await db.select().from(projectTemplatesTable).where(eq(projectTemplatesTable.id, id)).limit(1);
    if (!template) { res.status(404).json({ error: "Project template not found" }); return; }
    const tasks = await db
      .select()
      .from(projectTemplateTasksTable)
      .where(eq(projectTemplateTasksTable.projectTemplateId, id))
      .orderBy(asc(projectTemplateTasksTable.order));
    res.json({ ...template, tasks });
  } catch {
    res.status(500).json({ error: "Failed to fetch project template" });
  }
});

router.put("/admin/project-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, workflowTemplateId, serviceId } = req.body as { name?: string; workflowTemplateId?: number | null; serviceId?: number | null };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [updated] = await db
      .update(projectTemplatesTable)
      .set({ name, workflowTemplateId: workflowTemplateId ?? null, serviceId: serviceId ?? null, updatedAt: new Date() })
      .where(eq(projectTemplatesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Project template not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update project template" });
  }
});

router.delete("/admin/project-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(projectTemplatesTable).where(eq(projectTemplatesTable.id, id));
    res.json({ deleted: id });
  } catch {
    res.status(500).json({ error: "Failed to delete project template" });
  }
});

router.post("/admin/project-templates/:id/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = Number(req.params.id);
    if (isNaN(templateId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { title, description, order } = req.body as { title?: string; description?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [task] = await db
      .insert(projectTemplateTasksTable)
      .values({ projectTemplateId: templateId, title, description: description ?? null, order: order ?? 0 })
      .returning();
    res.status(201).json(task);
  } catch {
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.put("/admin/project-templates/:id/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    const { title, description, order } = req.body as { title?: string; description?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [updated] = await db
      .update(projectTemplateTasksTable)
      .set({ title, description: description ?? null, order: order ?? 0 })
      .where(eq(projectTemplateTasksTable.id, taskId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/admin/project-templates/:id/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    await db.delete(projectTemplateTasksTable).where(eq(projectTemplateTasksTable.id, taskId));
    res.json({ deleted: taskId });
  } catch {
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
