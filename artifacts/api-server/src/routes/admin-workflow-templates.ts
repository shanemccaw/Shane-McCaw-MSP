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
  servicesTable,
  kanbanTasksTable,
  powershellScriptsTable,
} from "@workspace/db";
import { eq, asc, inArray, desc, and, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { classifyAndUpdateTask, classifyTaskForScriptGeneration } from "../lib/classify-task-type";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";
import { getPrompt } from "../lib/prompt-loader";

const log = logger.child({ channel: "workflow.run" });

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
  isCustomerTask?: boolean;
  runbookId?: string | null;
  customerDownloadScriptId?: string | null;
  triggersHealthScore?: boolean;
  taskMetadata?: Record<string, unknown> | null;
}

router.post("/admin/workflow-templates/:id/steps/:stepId/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stepId = Number(req.params.stepId);
    if (isNaN(stepId)) { res.status(400).json({ error: "Invalid stepId" }); return; }
    const { title, description, groupName, taskType, order, instructions, checklist, artifactsProduced, clientDeliverables, instructionSetId, checklistId, artifactsId, deliverablesId, isCustomerTask, runbookId, customerDownloadScriptId, triggersHealthScore, taskMetadata } = req.body as TaskBody;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [task] = await db.insert(workflowTemplateStepTasksTable)
      .values({
        workflowTemplateStepId: stepId,
        title,
        description: description ?? null,
        groupName: groupName ?? null,
        taskType: taskType ?? null,
        taskMetadata: taskMetadata ?? null,
        order: order ?? 0,
        instructions: instructions ?? null,
        checklist: checklist ?? null,
        artifactsProduced: artifactsProduced ?? null,
        clientDeliverables: clientDeliverables ?? null,
        instructionSetId: instructionSetId ?? null,
        checklistId: checklistId ?? null,
        artifactsId: artifactsId ?? null,
        deliverablesId: deliverablesId ?? null,
        isCustomerTask: isCustomerTask ?? false,
        runbookId: runbookId ?? null,
        customerDownloadScriptId: customerDownloadScriptId ?? null,
        triggersHealthScore: triggersHealthScore ?? false,
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
    const stepId = Number(req.params.stepId);
    if (isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }
    const { title, description, groupName, taskType, order, instructions, checklist, artifactsProduced, clientDeliverables, instructionSetId, checklistId, artifactsId, deliverablesId, isCustomerTask, runbookId, customerDownloadScriptId, triggersHealthScore, taskMetadata } = req.body as TaskBody;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    const [updated] = await db.update(workflowTemplateStepTasksTable)
      .set({
        title,
        description: description ?? null,
        groupName: groupName ?? null,
        taskType: taskType ?? null,
        taskMetadata: taskMetadata ?? null,
        order: order ?? 0,
        instructions: instructions ?? null,
        checklist: checklist ?? null,
        artifactsProduced: artifactsProduced ?? null,
        clientDeliverables: clientDeliverables ?? null,
        instructionSetId: instructionSetId ?? null,
        checklistId: checklistId ?? null,
        artifactsId: artifactsId ?? null,
        deliverablesId: deliverablesId ?? null,
        isCustomerTask: isCustomerTask ?? false,
        runbookId: runbookId ?? null,
        customerDownloadScriptId: customerDownloadScriptId ?? null,
        triggersHealthScore: triggersHealthScore ?? false,
      })
      .where(eq(workflowTemplateStepTasksTable.id, taskId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

    // Backfill: sync customerDownload into any already-created waiting_on_customer
    // kanban tasks that came from this workflow step. This ensures customers
    // immediately see the download button even if the script was linked after
    // the kanban task was created.
    if (!isNaN(stepId)) {
      try {
        let customerDownloadPatch: Record<string, unknown>;
        if (customerDownloadScriptId) {
          const [script] = await db
            .select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
            .from(powershellScriptsTable)
            .where(eq(powershellScriptsTable.id, customerDownloadScriptId))
            .limit(1);
          customerDownloadPatch = script
            ? { customerDownload: { scriptId: script.id, scriptTitle: script.title } }
            : { customerDownload: null };
        } else {
          customerDownloadPatch = { customerDownload: null };
        }

        await db
          .update(kanbanTasksTable)
          .set({
            taskMetadata: sql`COALESCE(${kanbanTasksTable.taskMetadata}, '{}'::jsonb) || ${JSON.stringify(customerDownloadPatch)}::jsonb`,
          })
          .where(
            and(
              eq(kanbanTasksTable.workflowStepId, stepId),
              eq(kanbanTasksTable.column, "waiting_on_customer"),
            ),
          );
      } catch (backfillErr) {
        req.log.warn({ backfillErr, stepId }, "workflow-templates: customerDownload backfill failed (non-fatal)");
      }
    }

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
    log.warn({ err }, "generate-asset-sets: instruction set AI call failed");
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
    log.warn({ err }, "generate-asset-sets: checklist AI call failed");
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
    log.warn({ err }, "generate-asset-sets: outputs AI call failed");
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
    log.error({ err }, "generate-asset-sets: endpoint failed");
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
          log.error({ err, taskTitle: task.title }, "generate-scripts: script generation failed");
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
      log.error({ err }, "generate-scripts: endpoint failed");
      if (acceptsSSE) {
        sendSSE({ type: "error", message: "Failed to generate scripts" });
        res.end();
      } else {
        res.status(500).json({ error: "Failed to generate scripts" });
      }
    }
  }
);

// ─── AI Generate Workflow Steps + Tasks from linked service ──────────────────

function extractJsonArrayFromText(text: string): unknown[] | null {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7;
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      try {
        const v = JSON.parse(text.slice(afterNewline, closingPos).trim()) as unknown;
        if (Array.isArray(v)) return v;
      } catch { /* fall through */ }
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      try {
        const v = JSON.parse(text.slice(afterTag + 1, closingPos).trim()) as unknown;
        if (Array.isArray(v)) return v;
      } catch { /* fall through */ }
    }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(v)) return v;
    } catch { /* fall through */ }
  }
  return null;
}

const VALID_TASK_TYPES = new Set([
  "discovery", "environmentHealthCheck", "governanceSetup",
  "automationBuild", "training", "documentDelivery", "script",
]);
const VALID_GROUP_NAMES = new Set(["Engineer Tasks", "Artifacts Produced", "Client Deliverables"]);

// ─── Service Link ─────────────────────────────────────────────────────────────
// `services.workflowTemplateId` is the authoritative one-to-one link.
// This endpoint clears the old link and sets the new one atomically.

router.put("/admin/workflow-templates/:id/service-link", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { serviceId } = req.body as { serviceId?: number | null };

    // Clear any existing service that points to this template
    await db
      .update(servicesTable)
      .set({ workflowTemplateId: null })
      .where(eq(servicesTable.workflowTemplateId, id));

    // Set new link
    if (serviceId) {
      await db
        .update(servicesTable)
        .set({ workflowTemplateId: id })
        .where(eq(servicesTable.id, serviceId));
    }

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "service-link: failed to update service link");
    res.status(500).json({ error: "Failed to update service link" });
  }
});

router.post("/admin/workflow-templates/:id/ai-generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { mode = "append" } = req.body as { mode?: "replace" | "append" };

    const [template] = await db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.id, id))
      .limit(1);
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    // Use services.workflowTemplateId as the authoritative link (reverse-lookup)
    const [service] = await db
      .select({
        name: servicesTable.name,
        description: servicesTable.description,
        category: servicesTable.category,
        deliverables: servicesTable.deliverables,
        inclusions: servicesTable.inclusions,
        features: servicesTable.features,
      })
      .from(servicesTable)
      .where(eq(servicesTable.workflowTemplateId, id))
      .limit(1);
    if (!service) {
      res.status(400).json({ error: "This workflow template has no linked service. Link a service first." });
      return;
    }

    const serviceContext = [
      `Service: ${service.name}`,
      service.description ? `Description: ${service.description}` : "",
      service.category ? `Category: ${service.category}` : "",
      service.deliverables?.length ? `Deliverables:\n${service.deliverables.map(d => `  - ${d}`).join("\n")}` : "",
      service.inclusions?.length ? `Inclusions:\n${service.inclusions.map(i => `  - ${i}`).join("\n")}` : "",
      service.features?.length ? `Features:\n${service.features.map(f => `  - ${f}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const WORKFLOW_GENERATOR_DEFAULT = `You are Shane McCaw — Lead Microsoft 365 Architect with 30 years of Microsoft ecosystem experience. You design delivery workflows for your consulting firm, Shane McCaw Consulting.
Your job is to generate a complete, engineer-ready delivery workflow for a consulting service engagement.
Respond with a JSON array ONLY — no preamble, no explanation, no markdown prose outside the JSON block.

Output format:
[
  {
    "title": "Phase title (e.g. Discovery & Assessment)",
    "description": "One-sentence description of what this delivery phase covers",
    "tasks": [
      {
        "title": "Specific engineer action (verb-first, e.g. 'Audit existing SharePoint structure')",
        "taskType": "discovery | environmentHealthCheck | governanceSetup | automationBuild | training | documentDelivery | script",
        "groupName": "Engineer Tasks | Artifacts Produced | Client Deliverables",
        "requiresManualRun": false
      }
    ]
  }
]

Rules:
- Generate 4-8 delivery phases covering: discovery → environment prep → configuration → validation → knowledge transfer → handoff
- Each phase should have 3-8 tasks
- Prefer taskType "script" for PowerShell runbooks, Azure automation, Graph API calls, or any automated provisioning step; the majority of configuration tasks should be scripts
- Set requiresManualRun: true ONLY for script tasks where the customer must trigger execution themselves — for example: delegated-permission consent flows, end-user MFA registration scripts, or client-side onboarding scripts the customer runs in their own tenant; do NOT set requiresManualRun: true for engineer-run scripts
- Use groupName "Engineer Tasks" for internal technical work, "Artifacts Produced" for outputs the engineer creates (reports, configs, exports), "Client Deliverables" for customer-facing handoff items
- Be specific to this exact service using its description, deliverables, inclusions, and features — avoid generic placeholder tasks
- Every task title must be a concrete action (start with a verb: Provision, Configure, Audit, Deploy, Generate, Validate, Train, Document)`;

    const systemPrompt = await getPrompt("workflow-generator", WORKFLOW_GENERATOR_DEFAULT);

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Generate a complete workflow for this consulting service:\n\n${serviceContext}`,
      }],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") {
      res.status(500).json({ error: "AI returned no response" }); return;
    }

    const rawSteps = extractJsonArrayFromText(block.text);
    if (!rawSteps) {
      log.warn({ text: block.text.slice(0, 500) }, "ai-generate: could not extract JSON array from response");
      res.status(500).json({ error: "AI response could not be parsed as a step array" }); return;
    }

    if (mode === "replace") {
      await db.delete(workflowTemplateStepsTable).where(eq(workflowTemplateStepsTable.workflowTemplateId, id));
    }

    const existingSteps = await db
      .select({ order: workflowTemplateStepsTable.order })
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, id));
    let stepOrder = existingSteps.length > 0
      ? Math.max(...existingSteps.map(s => s.order)) + 1
      : 0;

    let stepsCreated = 0;
    let tasksCreated = 0;

    for (const rawStep of rawSteps) {
      if (!rawStep || typeof rawStep !== "object") continue;
      const s = rawStep as Record<string, unknown>;
      const stepTitle = typeof s.title === "string" ? s.title.trim() : null;
      if (!stepTitle) continue;
      const stepDescription = typeof s.description === "string" ? s.description.trim() : null;

      const [insertedStep] = await db
        .insert(workflowTemplateStepsTable)
        .values({
          workflowTemplateId: id,
          title: stepTitle,
          description: stepDescription ?? null,
          order: stepOrder++,
        })
        .returning();
      if (!insertedStep) continue;
      stepsCreated++;

      const tasks = Array.isArray(s.tasks) ? s.tasks : [];
      let taskOrder = 0;
      for (const rawTask of tasks) {
        if (!rawTask || typeof rawTask !== "object") continue;
        const t = rawTask as Record<string, unknown>;
        const taskTitle = typeof t.title === "string" ? t.title.trim() : null;
        if (!taskTitle) continue;
        const taskType = typeof t.taskType === "string" && VALID_TASK_TYPES.has(t.taskType) ? t.taskType : null;
        const groupName = typeof t.groupName === "string" && VALID_GROUP_NAMES.has(t.groupName) ? t.groupName : "Engineer Tasks";
        const requiresManualRun = t.requiresManualRun === true;

        await db.insert(workflowTemplateStepTasksTable).values({
          workflowTemplateStepId: insertedStep.id,
          title: taskTitle,
          taskType: taskType ?? null,
          groupName,
          requiresManualRun,
          order: taskOrder++,
        });
        tasksCreated++;
      }
    }

    res.json({ stepsCreated, tasksCreated, mode });
  } catch (err) {
    log.error({ err }, "ai-generate: endpoint failed");
    res.status(500).json({ error: "Failed to generate workflow" });
  }
});

export default router;
