import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  instructionSetsTable,
  checklistsTable,
  artifactSetsTable,
  deliverableSetsTable,
  assetLibraryCategoriesTable,
} from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { classifyAndUpdateTask } from "../lib/classify-task-type";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";

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

// ─── AI: Generate asset sets for all tasks missing ≥1 FK ──────────────────────

async function generateAssetSetsForTask(opts: {
  templateName: string;
  stepTitle: string;
  taskTitle: string;
}): Promise<{
  instructionSet: string[];
  checklist: Array<{ id: string; label: string }>;
  artifactSet: string[];
  deliverableSet: string[];
} | null> {
  const { templateName, stepTitle, taskTitle } = opts;

  const prompt = `You are an expert Microsoft 365 consulting workflow designer. Generate asset set content for this task:

Workflow Template: "${templateName}"
Step: "${stepTitle}"
Task: "${taskTitle}"

Return a JSON object with exactly these four keys:
- "instructionSet": array of 5-8 concise step-by-step engineer action strings (imperative, present tense)
- "checklist": array of 4-6 objects each with "id" (unique string like "item-1") and "label" (verification item the engineer checks before marking done)
- "artifactSet": array of 2-4 strings naming internal work products produced (e.g. "Audit Report Draft", "Configuration Backup")
- "deliverableSet": array of 1-3 strings naming client-facing deliverables (what the client receives, e.g. "Governance Policy Document")

Keep everything specific to Microsoft 365 / "${templateName}" context. Return only valid JSON with no markdown fences.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") return null;

    const raw = block.text.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as {
      instructionSet?: unknown;
      checklist?: unknown;
      artifactSet?: unknown;
      deliverableSet?: unknown;
    };

    return {
      instructionSet: Array.isArray(parsed.instructionSet)
        ? parsed.instructionSet.filter((s): s is string => typeof s === "string")
        : [],
      checklist: Array.isArray(parsed.checklist)
        ? parsed.checklist.filter(
            (it): it is { id: string; label: string } =>
              typeof it === "object" && it !== null && "id" in it && "label" in it &&
              typeof (it as Record<string, unknown>).id === "string" &&
              typeof (it as Record<string, unknown>).label === "string"
          )
        : [],
      artifactSet: Array.isArray(parsed.artifactSet)
        ? parsed.artifactSet.filter((s): s is string => typeof s === "string")
        : [],
      deliverableSet: Array.isArray(parsed.deliverableSet)
        ? parsed.deliverableSet.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch (err) {
    logger.warn({ err }, "generate-asset-sets: AI call failed for task");
    return null;
  }
}

router.post("/admin/workflow-templates/:id/generate-asset-sets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // 1. Fetch template
    const [template] = await db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.id, id))
      .limit(1);
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    // 2. Fetch all steps for this template
    const steps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, id))
      .orderBy(asc(workflowTemplateStepsTable.order));

    const stepIds = steps.map(s => s.id);
    if (stepIds.length === 0) { res.json({ processed: 0, setsCreated: 0 }); return; }

    // 3. Fetch all tasks for those steps
    const allTasks = await db
      .select()
      .from(workflowTemplateStepTasksTable)
      .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, stepIds));

    // 4. Filter to tasks missing ≥1 asset FK
    const incompleteTasks = allTasks.filter(
      t => t.instructionSetId == null || t.checklistId == null || t.artifactsId == null || t.deliverablesId == null
    );

    if (incompleteTasks.length === 0) {
      res.json({ processed: 0, setsCreated: 0 });
      return;
    }

    // 5. Ensure category exists for this template name
    const categoryName = template.name;
    const existing = await db
      .select()
      .from(assetLibraryCategoriesTable)
      .where(eq(assetLibraryCategoriesTable.name, categoryName))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(assetLibraryCategoriesTable).values({ name: categoryName }).onConflictDoNothing();
    }

    // 6. Build step map for titles
    const stepMap = new Map(steps.map(s => [s.id, s]));

    let setsCreated = 0;
    let processed = 0;

    // 7. Process each incomplete task sequentially
    for (const task of incompleteTasks) {
      const step = task.workflowTemplateStepId != null ? stepMap.get(task.workflowTemplateStepId) : null;
      const stepTitle = step?.title ?? "Unknown Step";

      const aiResult = await generateAssetSetsForTask({
        templateName: template.name,
        stepTitle,
        taskTitle: task.title,
      });

      if (!aiResult) continue;

      const updates: {
        instructionSetId?: number;
        checklistId?: number;
        artifactsId?: number;
        deliverablesId?: number;
      } = {};

      if (task.instructionSetId == null && aiResult.instructionSet.length > 0) {
        const [ins] = await db
          .insert(instructionSetsTable)
          .values({ title: `${task.title} — Instructions`, instructions: aiResult.instructionSet, category: categoryName })
          .returning();
        if (ins) { updates.instructionSetId = ins.id; setsCreated++; }
      }

      if (task.checklistId == null && aiResult.checklist.length > 0) {
        const [chk] = await db
          .insert(checklistsTable)
          .values({ title: `${task.title} — Checklist`, items: aiResult.checklist, category: categoryName })
          .returning();
        if (chk) { updates.checklistId = chk.id; setsCreated++; }
      }

      if (task.artifactsId == null && aiResult.artifactSet.length > 0) {
        const [art] = await db
          .insert(artifactSetsTable)
          .values({ title: `${task.title} — Artifacts`, artifacts: aiResult.artifactSet, category: categoryName })
          .returning();
        if (art) { updates.artifactsId = art.id; setsCreated++; }
      }

      if (task.deliverablesId == null && aiResult.deliverableSet.length > 0) {
        const [del] = await db
          .insert(deliverableSetsTable)
          .values({ title: `${task.title} — Deliverables`, deliverables: aiResult.deliverableSet, category: categoryName })
          .returning();
        if (del) { updates.deliverablesId = del.id; setsCreated++; }
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(workflowTemplateStepTasksTable)
          .set(updates)
          .where(eq(workflowTemplateStepTasksTable.id, task.id));
      }

      processed++;
    }

    res.json({ processed, setsCreated });
  } catch (err) {
    logger.error({ err }, "generate-asset-sets: endpoint failed");
    res.status(500).json({ error: "Failed to generate asset sets" });
  }
});

export default router;
