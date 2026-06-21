import { Router, type IRouter, type Request, type Response } from "express";
import { db, workflowTemplatesTable, workflowTemplateStepsTable, workflowTemplateStepTasksTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { classifyAndUpdateTask } from "../lib/classify-task-type";

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

router.get("/admin/workflow-templates/export", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(workflowTemplatesTable).orderBy(workflowTemplatesTable.createdAt);

    const allSteps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .orderBy(asc(workflowTemplateStepsTable.workflowTemplateId), asc(workflowTemplateStepsTable.order));

    const stepIds = allSteps.map(s => s.id);
    const allTasks = stepIds.length > 0
      ? await db.select().from(workflowTemplateStepTasksTable)
          .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, stepIds))
          .orderBy(asc(workflowTemplateStepTasksTable.workflowTemplateStepId), asc(workflowTemplateStepTasksTable.groupName), asc(workflowTemplateStepTasksTable.order))
      : [];

    const stepsWithTasks = allSteps.map(s => ({
      ...s,
      tasks: allTasks.filter(t => t.workflowTemplateStepId === s.id),
    }));

    const result = templates.map(tmpl => ({
      ...tmpl,
      steps: stepsWithTasks.filter(s => s.workflowTemplateId === tmpl.id),
    }));

    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to export workflow templates" });
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
      ? await db.select().from(workflowTemplateStepTasksTable)
          .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, stepIds))
          .orderBy(asc(workflowTemplateStepTasksTable.groupName), asc(workflowTemplateStepTasksTable.order))
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
    const tasks = await db.select().from(workflowTemplateStepTasksTable)
      .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, stepId))
      .orderBy(asc(workflowTemplateStepTasksTable.groupName), asc(workflowTemplateStepTasksTable.order));
    res.json(tasks);
  } catch {
    res.status(500).json({ error: "Failed to fetch step tasks" });
  }
});

interface TaskBody {
  title?: string;
  description?: string;
  groupName?: string;
  taskType?: string | null;
  order?: number;
  instructions?: string[] | null;
  checklist?: Array<{ id: string; label: string }> | null;
  artifactsProduced?: string[] | null;
  clientDeliverables?: string[] | null;
  instructionSetId?: number | null;
  checklistId?: number | null;
  artifactsId?: number | null;
  deliverablesId?: number | null;
}

router.post("/admin/workflow-templates/:id/steps/:stepId/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId)) { res.status(400).json({ error: "Invalid stepId" }); return; }
    const { title, description, groupName, taskType, order, instructions, checklist, artifactsProduced, clientDeliverables, instructionSetId, checklistId, artifactsId, deliverablesId } = req.body as TaskBody;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [task] = await db.insert(workflowTemplateStepTasksTable)
      .values({
        workflowTemplateStepId: stepId,
        title,
        description: description ?? null,
        groupName: groupName ?? null,
        taskType: taskType ?? null,
        order: order ?? 0,
        instructions: instructions ?? null,
        checklist: checklist ?? null,
        artifactsProduced: artifactsProduced ?? null,
        clientDeliverables: clientDeliverables ?? null,
        instructionSetId: instructionSetId ?? null,
        checklistId: checklistId ?? null,
        artifactsId: artifactsId ?? null,
        deliverablesId: deliverablesId ?? null,
      })
      .returning();
    res.status(201).json(task);

    // Fire-and-forget AI classification when no explicit taskType was supplied
    if (!taskType) {
      classifyAndUpdateTask({
        taskId: task.id,
        title,
        groupName: groupName ?? null,
        stepId,
      }).catch(() => { /* already logged inside helper */ });
    }
  } catch {
    res.status(500).json({ error: "Failed to create step task" });
  }
});

router.put("/admin/workflow-templates/:id/steps/:stepId/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.taskId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    const { title, description, groupName, taskType, order, instructions, checklist, artifactsProduced, clientDeliverables, instructionSetId, checklistId, artifactsId, deliverablesId } = req.body as TaskBody;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [updated] = await db.update(workflowTemplateStepTasksTable)
      .set({
        title,
        description: description ?? null,
        groupName: groupName ?? null,
        taskType: taskType ?? null,
        order: order ?? 0,
        instructions: instructions ?? null,
        checklist: checklist ?? null,
        artifactsProduced: artifactsProduced ?? null,
        clientDeliverables: clientDeliverables ?? null,
        instructionSetId: instructionSetId ?? null,
        checklistId: checklistId ?? null,
        artifactsId: artifactsId ?? null,
        deliverablesId: deliverablesId ?? null,
      })
      .where(eq(workflowTemplateStepTasksTable.id, taskId))
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
    await db.delete(workflowTemplateStepTasksTable).where(eq(workflowTemplateStepTasksTable.id, taskId));
    res.json({ deleted: taskId });
  } catch {
    res.status(500).json({ error: "Failed to delete step task" });
  }
});

export default router;
