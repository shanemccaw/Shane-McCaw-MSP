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
  scriptPackagesTable,
  scriptModulesTable,
} from "@workspace/db";
import { eq, asc, inArray, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { classifyAndUpdateTask, classifyTaskForScriptGeneration } from "../lib/classify-task-type";
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

// ─── AI: Generate asset sets — 3-step pipeline ────────────────────────────────

function parseJsonText(text: string): unknown {
  const raw = text.trim().replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(raw);
}

async function generateInstructionSet(opts: {
  templateName: string;
  stepTitle: string;
  taskTitle: string;
}): Promise<string[]> {
  const { templateName, stepTitle, taskTitle } = opts;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: `You are an expert Microsoft 365 consulting workflow designer. Respond with valid JSON only — no markdown, no preamble. Output: {"instructionSet": ["string", ...]}`,
      messages: [{
        role: "user",
        content: `Generate the engineer instruction set for this task:
Workflow: "${templateName}"
Step: "${stepTitle}"
Task: "${taskTitle}"
Rules:
- 5-8 concise engineer action strings (imperative, present tense)
- Specific to the Microsoft 365 / "${templateName}" context`,
      }],
    });
    const block = msg.content[0];
    if (!block || block.type !== "text") return [];
    const parsed = parseJsonText(block.text) as { instructionSet?: unknown };
    return Array.isArray(parsed.instructionSet)
      ? parsed.instructionSet.filter((s): s is string => typeof s === "string")
      : [];
  } catch (err) {
    logger.warn({ err }, "generate-asset-sets: instruction set AI call failed");
    return [];
  }
}

async function generateChecklist(opts: {
  templateName: string;
  stepTitle: string;
  taskTitle: string;
  instructions: string[];
}): Promise<Array<{ id: string; label: string }>> {
  const { templateName, stepTitle, taskTitle, instructions } = opts;
  const instructionList = instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: `You are an expert Microsoft 365 consulting workflow designer. Respond with valid JSON only — no markdown, no preamble. Output: {"checklist": [{"id": "item-1", "label": "string"}, ...]}`,
      messages: [{
        role: "user",
        content: `Generate a pre-completion checklist for this task, derived directly from its instruction set.
Workflow: "${templateName}"
Step: "${stepTitle}"
Task: "${taskTitle}"
Instruction Set (what the engineer will do):
${instructionList}
Rules:
- 4-6 checklist items the engineer verifies before marking the task done
- Each item should map to one or more of the instructions above
- Label describes what was confirmed/checked, not what was done`,
      }],
    });
    const block = msg.content[0];
    if (!block || block.type !== "text") return [];
    const parsed = parseJsonText(block.text) as { checklist?: unknown };
    return Array.isArray(parsed.checklist)
      ? parsed.checklist.filter(
          (it): it is { id: string; label: string } =>
            typeof it === "object" && it !== null && "id" in it && "label" in it &&
            typeof (it as Record<string, unknown>).id === "string" &&
            typeof (it as Record<string, unknown>).label === "string"
        )
      : [];
  } catch (err) {
    logger.warn({ err }, "generate-asset-sets: checklist AI call failed");
    return [];
  }
}

async function generateOutputSets(opts: {
  templateName: string;
  stepTitle: string;
  taskTitle: string;
  instructions: string[];
  checklist: Array<{ id: string; label: string }>;
}): Promise<{ artifactSet: string[]; deliverableSet: string[] }> {
  const { templateName, stepTitle, taskTitle, instructions, checklist } = opts;
  const instructionList = instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const checklistList = checklist.map(c => `- ${c.label}`).join("\n");
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: `You are an expert Microsoft 365 consulting workflow designer. Respond with valid JSON only — no markdown, no preamble. Output: {"artifactSet": ["string", ...], "deliverableSet": ["string", ...]}`,
      messages: [{
        role: "user",
        content: `Based on this completed workflow task, determine what would be produced.
Workflow: "${templateName}"
Step: "${stepTitle}"
Task: "${taskTitle}"
Instructions (what the engineer does):
${instructionList}
Checklist (what was verified):
${checklistList}
Rules:
- "artifactSet": 2-4 internal work products the engineer produces (e.g. configuration export, audit report, test results, script, diagram)
- "deliverableSet": 1-3 client-facing outputs the customer receives (e.g. governance playbook, readiness report, configured environment access)
- Be specific to this task, not generic`,
      }],
    });
    const block = msg.content[0];
    if (!block || block.type !== "text") return { artifactSet: [], deliverableSet: [] };
    const parsed = parseJsonText(block.text) as { artifactSet?: unknown; deliverableSet?: unknown };
    return {
      artifactSet: Array.isArray(parsed.artifactSet)
        ? parsed.artifactSet.filter((s): s is string => typeof s === "string")
        : [],
      deliverableSet: Array.isArray(parsed.deliverableSet)
        ? parsed.deliverableSet.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch (err) {
    logger.warn({ err }, "generate-asset-sets: outputs AI call failed");
    return { artifactSet: [], deliverableSet: [] };
  }
}

router.post("/admin/workflow-templates/:id/generate-asset-sets", requireAdmin, async (req: Request, res: Response) => {
  const acceptsSSE = (req.headers.accept ?? "").includes("text/event-stream");

  const sendSSE = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      if (acceptsSSE) { res.status(400).end(); return; }
      res.status(400).json({ error: "Invalid id" }); return;
    }

    // 1. Fetch template
    const [template] = await db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.id, id))
      .limit(1);
    if (!template) {
      if (acceptsSSE) { res.status(404).end(); return; }
      res.status(404).json({ error: "Template not found" }); return;
    }

    // 2. Fetch all steps for this template
    const steps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, id))
      .orderBy(asc(workflowTemplateStepsTable.order));

    const stepIds = steps.map(s => s.id);
    if (stepIds.length === 0) {
      if (acceptsSSE) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
        sendSSE({ type: "done", processed: 0, setsCreated: 0, failed: 0 });
        res.end(); return;
      }
      res.json({ processed: 0, setsCreated: 0 }); return;
    }

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
      if (acceptsSSE) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
        sendSSE({ type: "done", processed: 0, setsCreated: 0, failed: 0 });
        res.end(); return;
      }
      res.json({ processed: 0, setsCreated: 0 });
      return;
    }

    // 5. Set up SSE headers now if streaming
    if (acceptsSSE) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    }

    // 6. Ensure category exists for this template name
    const categoryName = template.name;
    const existing = await db
      .select()
      .from(assetLibraryCategoriesTable)
      .where(eq(assetLibraryCategoriesTable.name, categoryName))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(assetLibraryCategoriesTable).values({ name: categoryName }).onConflictDoNothing();
    }

    // 7. Build step map for titles
    const stepMap = new Map(steps.map(s => [s.id, s]));

    let setsCreated = 0;
    let processed = 0;
    let failed = 0;
    const total = incompleteTasks.length;

    // 8. Process each incomplete task sequentially — 3-step pipeline per task
    for (let i = 0; i < incompleteTasks.length; i++) {
      const task = incompleteTasks[i]!;
      const step = task.workflowTemplateStepId != null ? stepMap.get(task.workflowTemplateStepId) : null;
      const stepTitle = step?.title ?? "Unknown Step";

      const updates: {
        instructionSetId?: number;
        checklistId?: number;
        artifactsId?: number;
        deliverablesId?: number;
      } = {};
      let taskSetsCreated = 0;

      // ── Step 1: Instruction Set ──────────────────────────────────────────────
      let instructions: string[] = [];
      if (task.instructionSetId == null) {
        if (acceptsSSE) {
          sendSSE({ type: "progress", current: i, total, stepTitle, taskTitle: task.title, subStep: "instructions" });
        }
        instructions = await generateInstructionSet({ templateName: template.name, stepTitle, taskTitle: task.title });
        if (instructions.length > 0) {
          const [ins] = await db
            .insert(instructionSetsTable)
            .values({ title: `${task.title} — Instructions`, instructions, category: categoryName })
            .returning();
          if (ins) { updates.instructionSetId = ins.id; setsCreated++; taskSetsCreated++; }
        }
      } else {
        // Fetch existing IS content so subsequent steps can use it as context
        const [existing] = await db
          .select()
          .from(instructionSetsTable)
          .where(eq(instructionSetsTable.id, task.instructionSetId))
          .limit(1);
        instructions = (existing?.instructions as string[] | null) ?? [];
      }

      // ── Step 2: Checklist (derived from Instruction Set) ────────────────────
      let checklist: Array<{ id: string; label: string }> = [];
      if (task.checklistId == null) {
        if (acceptsSSE) {
          sendSSE({ type: "progress", current: i, total, stepTitle, taskTitle: task.title, subStep: "checklist" });
        }
        checklist = await generateChecklist({ templateName: template.name, stepTitle, taskTitle: task.title, instructions });
        if (checklist.length > 0) {
          const [chk] = await db
            .insert(checklistsTable)
            .values({ title: `${task.title} — Checklist`, items: checklist, category: categoryName })
            .returning();
          if (chk) { updates.checklistId = chk.id; setsCreated++; taskSetsCreated++; }
        }
      } else {
        // Fetch existing checklist content for context
        const [existing] = await db
          .select()
          .from(checklistsTable)
          .where(eq(checklistsTable.id, task.checklistId))
          .limit(1);
        checklist = (existing?.items as Array<{ id: string; label: string }> | null) ?? [];
      }

      // ── Step 3: Artifacts + Deliverables (derived from IS + Checklist) ──────
      if (task.artifactsId == null || task.deliverablesId == null) {
        if (acceptsSSE) {
          sendSSE({ type: "progress", current: i, total, stepTitle, taskTitle: task.title, subStep: "outputs" });
        }
        const { artifactSet, deliverableSet } = await generateOutputSets({
          templateName: template.name, stepTitle, taskTitle: task.title, instructions, checklist,
        });
        if (task.artifactsId == null && artifactSet.length > 0) {
          const [art] = await db
            .insert(artifactSetsTable)
            .values({ title: `${task.title} — Artifacts`, artifacts: artifactSet, category: categoryName })
            .returning();
          if (art) { updates.artifactsId = art.id; setsCreated++; taskSetsCreated++; }
        }
        if (task.deliverablesId == null && deliverableSet.length > 0) {
          const [del] = await db
            .insert(deliverableSetsTable)
            .values({ title: `${task.title} — Deliverables`, deliverables: deliverableSet, category: categoryName })
            .returning();
          if (del) { updates.deliverablesId = del.id; setsCreated++; taskSetsCreated++; }
        }
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(workflowTemplateStepTasksTable)
          .set(updates)
          .where(eq(workflowTemplateStepTasksTable.id, task.id));
      }

      processed++;
      const taskFailed = taskSetsCreated === 0 && (
        task.instructionSetId == null || task.checklistId == null ||
        task.artifactsId == null || task.deliverablesId == null
      );
      if (taskFailed) failed++;

      if (acceptsSSE) {
        sendSSE({ type: "task_done", current: i + 1, total, stepTitle, taskTitle: task.title, setsCreated: taskSetsCreated, failed: taskFailed });
      }
    }

    if (acceptsSSE) {
      sendSSE({ type: "done", processed, setsCreated, failed });
      res.end();
    } else {
      res.json({ processed, setsCreated, failed });
    }
  } catch (err) {
    logger.error({ err }, "generate-asset-sets: endpoint failed");
    if (acceptsSSE) {
      sendSSE({ type: "error", message: "Failed to generate asset sets" });
      res.end();
    } else {
      res.status(500).json({ error: "Failed to generate asset sets" });
    }
  }
});

// ─── PS Script generation helpers ─────────────────────────────────────────────

const STEP_SCRIPTS_SYSTEM_PROMPT = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience across Azure, Exchange Online, SharePoint, Teams, Intune, Defender, and related services.

When asked to produce a PowerShell script, you MUST:

1. Write a complete, production-ready script with:
   - [CmdletBinding()] attribute
   - A param() block with typed, documented parameters (include -TenantId, -ClientId, -ClientSecret where applicable)
   - Structured error handling via try/catch/finally blocks
   - Write-Output (NOT Write-Host) for all console output
   - Inline comments explaining each logical section
   - Clear output (export to CSV where applicable, structured objects, or console summary)
   - $ErrorActionPreference = "Stop" at the top

IMPORTANT: Never use Write-Host. Always use Write-Output for any status messages or console output.

2. After the script, output a JSON block (inside a \`\`\`json fence) with the EXACT permissions required:
{
  "appPermissions": ["<e.g. User.Read.All (Microsoft Graph Application)>"],
  "delegatedPermissions": [],
  "notes": "<Brief note about which permissions are required>"
}`;

function toScriptFilename(title: string): string {
  return (
    title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") + ".ps1"
  );
}

// ─── POST /api/admin/workflow-templates/:id/steps/:stepId/generate-scripts ───

router.post(
  "/admin/workflow-templates/:id/steps/:stepId/generate-scripts",
  requireAdmin,
  async (req: Request, res: Response) => {
    const templateId = parseInt(req.params.id as string, 10);
    const stepId = parseInt(req.params.stepId as string, 10);
    if (isNaN(templateId) || isNaN(stepId)) {
      res.status(400).json({ error: "Invalid template or step ID" });
      return;
    }

    const { mode = "append" } = req.body as { mode?: "replace" | "append" };
    const acceptsSSE = req.headers.accept?.includes("text/event-stream");

    function sendSSE(data: unknown) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    try {
      // 1. Verify step belongs to template
      const [step] = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.id, stepId))
        .limit(1);

      if (!step || step.workflowTemplateId !== templateId) {
        res.status(404).json({ error: "Step not found" });
        return;
      }

      // 2. Fetch tasks
      const tasks = await db
        .select()
        .from(workflowTemplateStepTasksTable)
        .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, stepId))
        .orderBy(asc(workflowTemplateStepTasksTable.order));

      if (tasks.length === 0) {
        if (acceptsSSE) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.flushHeaders();
          sendSSE({ type: "done", packageId: null, packageTitle: null, generated: 0, skipped: 0, failed: 0 });
          res.end();
        } else {
          res.json({ generated: 0, skipped: 0, failed: 0 });
        }
        return;
      }

      // 3. Set up SSE
      if (acceptsSSE) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();
      }

      // 4. Find or create package
      const packageTitle = `${step.title} Scripts`;
      const existingPkgs = await db
        .select()
        .from(scriptPackagesTable)
        .where(eq(scriptPackagesTable.title, packageTitle))
        .orderBy(desc(scriptPackagesTable.createdAt))
        .limit(1);

      let packageId: string;

      if (existingPkgs.length > 0 && mode === "replace") {
        packageId = existingPkgs[0]!.id;
        await db.delete(scriptModulesTable).where(eq(scriptModulesTable.packageId, packageId));
      } else if (existingPkgs.length > 0 && mode === "append") {
        packageId = existingPkgs[0]!.id;
      } else {
        const [pkg] = await db
          .insert(scriptPackagesTable)
          .values({ title: packageTitle, category: "other", permissions: { appPermissions: [], delegatedPermissions: [], notes: "" }, tags: [] })
          .returning();
        packageId = pkg!.id;
      }

      // 5. Get existing module count (for sort order in append mode)
      let baseModuleCount = 0;
      if (mode === "append" && existingPkgs.length > 0) {
        const existingMods = await db
          .select({ id: scriptModulesTable.id })
          .from(scriptModulesTable)
          .where(eq(scriptModulesTable.packageId, packageId));
        baseModuleCount = existingMods.length;
      }

      let generated = 0;
      let skipped = 0;
      let failed = 0;
      const total = tasks.length;

      // 6. Process each task
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;

        // Classify
        if (acceptsSSE) {
          sendSSE({ type: "progress", current: i, total, taskTitle: task.title, status: "classifying" });
        }

        const classification = await classifyTaskForScriptGeneration(task.title, task.description);

        // Only skip HUMAN_ONLY — generate for both AUTOMATABLE and USER_ACCOUNT_REQUIRED
        if (classification === "HUMAN_ONLY") {
          skipped++;
          if (acceptsSSE) {
            sendSSE({ type: "task_done", current: i + 1, total, taskTitle: task.title, classification, saved: false, skipped: true });
          }
          continue;
        }

        // Generate PS script
        if (acceptsSSE) {
          sendSSE({ type: "progress", current: i, total, taskTitle: task.title, status: "generating" });
        }

        try {
          const contextParts: string[] = [];
          if (task.description) contextParts.push(`Context: ${task.description}`);
          if (Array.isArray(task.instructions) && (task.instructions as string[]).length > 0) {
            contextParts.push(`Instructions:\n${(task.instructions as string[]).join("\n")}`);
          }
          const userPrompt = `${STEP_SCRIPTS_SYSTEM_PROMPT}\n\nTask description: ${task.title}${contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : ""}\n\nWrite the complete PowerShell script followed by the permissions JSON block.`;

          const genMsg = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 8192,
            messages: [{ role: "user", content: userPrompt }],
          });

          const block = genMsg.content[0];
          if (!block || block.type !== "text") {
            failed++;
            if (acceptsSSE) {
              sendSSE({ type: "task_done", current: i + 1, total, taskTitle: task.title, classification, saved: false, skipped: false });
            }
            continue;
          }

          const fullText = block.text;

          // Extract script body (everything before the ```json block)
          const jsonFenceIdx = fullText.search(/```json/i);
          let scriptBody =
            jsonFenceIdx > 0
              ? fullText.slice(0, jsonFenceIdx).replace(/```powershell\s*/i, "").replace(/```\s*$/, "").trim()
              : fullText.replace(/```(?:powershell)?\s*/gi, "").replace(/```\s*/g, "").trim();

          if (scriptBody.length < 20) {
            const jsonBlockRe = /```json[\s\S]*?```/gi;
            scriptBody = fullText
              .replace(jsonBlockRe, "")
              .replace(/```(?:powershell)?\s*/gi, "")
              .replace(/```\s*$/gm, "")
              .trim();
          }

          const filename = toScriptFilename(task.title);

          await db.insert(scriptModulesTable).values({
            packageId,
            filename,
            description: task.description ?? task.title,
            content: scriptBody,
            sortOrder: baseModuleCount + generated,
          });

          generated++;
          if (acceptsSSE) {
            sendSSE({ type: "task_done", current: i + 1, total, taskTitle: task.title, classification, saved: true, skipped: false });
          }
        } catch (err) {
          logger.error({ err, taskTitle: task.title }, "generate-scripts: script generation failed");
          failed++;
          if (acceptsSSE) {
            sendSSE({ type: "task_done", current: i + 1, total, taskTitle: task.title, classification, saved: false, skipped: false });
          }
        }
      }

      if (acceptsSSE) {
        sendSSE({ type: "done", packageId, packageTitle, generated, skipped, failed });
        res.end();
      } else {
        res.json({ packageId, packageTitle, generated, skipped, failed });
      }
    } catch (err) {
      logger.error({ err }, "generate-scripts: endpoint failed");
      if (acceptsSSE) {
        sendSSE({ type: "error", message: "Failed to generate scripts" });
        res.end();
      } else {
        res.status(500).json({ error: "Failed to generate scripts" });
      }
    }
  }
);

export default router;
