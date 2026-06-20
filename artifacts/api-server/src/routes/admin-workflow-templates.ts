import { Router, type IRouter, type Request, type Response } from "express";
import { db, workflowTemplatesTable, workflowTemplateStepsTable, projectTemplateTasksTable, projectTemplatesTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/workflow-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(workflowTemplatesTable).orderBy(workflowTemplatesTable.createdAt);
    res.json(templates);
  } catch {
    res.status(500).json({ error: "Failed to fetch workflow templates" });
  }
});

router.post("/admin/workflow-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, serviceId } = req.body as { name?: string; description?: string; serviceId?: number | null };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [template] = await db
      .insert(workflowTemplatesTable)
      .values({ name, description: description ?? null, serviceId: serviceId ?? null })
      .returning();
    res.status(201).json(template);
  } catch {
    res.status(500).json({ error: "Failed to create workflow template" });
  }
});

router.get("/admin/workflow-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [template] = await db.select().from(workflowTemplatesTable).where(eq(workflowTemplatesTable.id, id)).limit(1);
    if (!template) { res.status(404).json({ error: "Workflow template not found" }); return; }
    const steps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, id))
      .orderBy(asc(workflowTemplateStepsTable.order));

    const stepIds = steps.map(s => s.id);
    const allTasks = stepIds.length > 0
      ? await db.select().from(projectTemplateTasksTable)
          .where(inArray(projectTemplateTasksTable.workflowTemplateStepId, stepIds))
          .orderBy(asc(projectTemplateTasksTable.groupName), asc(projectTemplateTasksTable.order))
      : [];

    const stepsWithTasks = steps.map(s => ({
      ...s,
      tasks: allTasks.filter(t => t.workflowTemplateStepId === s.id),
    }));

    res.json({ ...template, steps: stepsWithTasks });
  } catch {
    res.status(500).json({ error: "Failed to fetch workflow template" });
  }
});

router.put("/admin/workflow-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, description, serviceId } = req.body as { name?: string; description?: string; serviceId?: number | null };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [updated] = await db
      .update(workflowTemplatesTable)
      .set({ name, description: description ?? null, serviceId: serviceId ?? null, updatedAt: new Date() })
      .where(eq(workflowTemplatesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Workflow template not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update workflow template" });
  }
});

router.delete("/admin/workflow-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(workflowTemplatesTable).where(eq(workflowTemplatesTable.id, id));
    res.json({ deleted: id });
  } catch {
    res.status(500).json({ error: "Failed to delete workflow template" });
  }
});

router.post("/admin/workflow-templates/:id/steps", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = Number(req.params.id);
    if (isNaN(templateId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { title, description, order } = req.body as { title?: string; description?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [step] = await db
      .insert(workflowTemplateStepsTable)
      .values({ workflowTemplateId: templateId, title, description: description ?? null, order: order ?? 0 })
      .returning();
    res.status(201).json(step);
  } catch {
    res.status(500).json({ error: "Failed to create step" });
  }
});

router.put("/admin/workflow-templates/:id/steps/:stepId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId)) { res.status(400).json({ error: "Invalid stepId" }); return; }
    const { title, description, order } = req.body as { title?: string; description?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [updated] = await db
      .update(workflowTemplateStepsTable)
      .set({ title, description: description ?? null, order: order ?? 0 })
      .where(eq(workflowTemplateStepsTable.id, stepId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Step not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update step" });
  }
});

router.delete("/admin/workflow-templates/:id/steps/:stepId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId)) { res.status(400).json({ error: "Invalid stepId" }); return; }
    await db.delete(workflowTemplateStepsTable).where(eq(workflowTemplateStepsTable.id, stepId));
    res.json({ deleted: stepId });
  } catch {
    res.status(500).json({ error: "Failed to delete step" });
  }
});

router.patch("/admin/workflow-templates/:id/steps/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = Number(req.params.id);
    if (isNaN(templateId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { steps } = req.body as { steps?: Array<{ id: number; order: number }> };
    if (!Array.isArray(steps)) { res.status(400).json({ error: "steps array required" }); return; }
    await Promise.all(
      steps.map(({ id, order }) =>
        db.update(workflowTemplateStepsTable).set({ order }).where(eq(workflowTemplateStepsTable.id, id))
      )
    );
    const updated = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, templateId))
      .orderBy(asc(workflowTemplateStepsTable.order));
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to reorder steps" });
  }
});

// ─── Step Task CRUD ───────────────────────────────────────────────────────────

router.get("/admin/workflow-templates/:id/steps/:stepId/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId)) { res.status(400).json({ error: "Invalid stepId" }); return; }
    const tasks = await db.select().from(projectTemplateTasksTable)
      .where(eq(projectTemplateTasksTable.workflowTemplateStepId, stepId))
      .orderBy(asc(projectTemplateTasksTable.groupName), asc(projectTemplateTasksTable.order));
    res.json(tasks);
  } catch {
    res.status(500).json({ error: "Failed to fetch step tasks" });
  }
});

router.post("/admin/workflow-templates/:id/steps/:stepId/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const templateId = Number(req.params.id);
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId) || isNaN(templateId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { title, description, groupName, order } = req.body as { title?: string; description?: string; groupName?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }

    const [projTemplate] = await db.select().from(projectTemplatesTable)
      .where(eq(projectTemplatesTable.workflowTemplateId, templateId))
      .limit(1);
    if (!projTemplate) { res.status(400).json({ error: "No project template linked to this workflow template" }); return; }

    const [task] = await db.insert(projectTemplateTasksTable)
      .values({
        projectTemplateId: projTemplate.id,
        workflowTemplateStepId: stepId,
        title,
        description: description ?? null,
        groupName: groupName ?? null,
        order: order ?? 0,
      })
      .returning();
    res.status(201).json(task);
  } catch {
    res.status(500).json({ error: "Failed to create step task" });
  }
});

router.put("/admin/workflow-templates/:id/steps/:stepId/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    const { title, description, groupName, order } = req.body as { title?: string; description?: string; groupName?: string; order?: number };
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [updated] = await db.update(projectTemplateTasksTable)
      .set({ title, description: description ?? null, groupName: groupName ?? null, order: order ?? 0 })
      .where(eq(projectTemplateTasksTable.id, taskId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update step task" });
  }
});

router.delete("/admin/workflow-templates/:id/steps/:stepId/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    await db.delete(projectTemplateTasksTable).where(eq(projectTemplateTasksTable.id, taskId));
    res.json({ deleted: taskId });
  } catch {
    res.status(500).json({ error: "Failed to delete step task" });
  }
});

export default router;
