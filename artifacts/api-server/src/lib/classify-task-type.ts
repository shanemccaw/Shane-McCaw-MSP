/**
 * classify-task-type.ts
 *
 * Server-side helper that infers a task_type for a single
 * workflow_template_step_task at insert time.
 *
 * Two-layer logic (mirrors scripts/src/assign-task-types.ts):
 *   1. Deterministic: group_name "Artifacts Produced" | "Client Deliverables" → documentDelivery
 *   2. AI (claude-haiku): title + template name → one of the six task types
 *
 * Returns null on any failure — callers must tolerate null gracefully.
 */

import { db, workflowTemplateStepsTable, workflowTemplatesTable, workflowTemplateStepTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";

const VALID_TYPES = [
  "discovery",
  "training",
  "environmentHealthCheck",
  "governanceSetup",
  "automationBuild",
  "documentDelivery",
] as const;

type TaskType = (typeof VALID_TYPES)[number];

function isValidTaskType(t: string): t is TaskType {
  return (VALID_TYPES as readonly string[]).includes(t);
}

const CLASSIFICATION_PROMPT = `You are classifying consulting workflow tasks for a Microsoft 365 specialist. For each task, pick exactly one task type from this list:

- discovery: gathering information, reviewing existing state, documenting requirements, stakeholder workshops, interviews, assessments
- environmentHealthCheck: validating, auditing, scanning, analyzing tenant/system health, configuration reviews, security checks
- governanceSetup: configuring policies, updating settings, implementing governance controls, compliance changes, permissions, access control
- automationBuild: building flows, apps, automations, Power Platform solutions, scripts, integrations
- training: delivering training sessions, enablement, user adoption activities, anything in a "Training & Enablement" template
- documentDelivery: producing reports, guides, deliverable documents, roadmaps, presentations, templates

Rules:
- If the template name contains "Training" or "Enablement", default to "training" unless clearly otherwise
- Tasks about creating/writing documents or reports → documentDelivery
- Tasks about running scripts, health checks, audits → environmentHealthCheck
- Tasks about configuring SharePoint, Teams, DLP, policies → governanceSetup
- Tasks about Power Automate, Power Apps, flows → automationBuild
- Tasks about discovery workshops, requirements gathering → discovery

Return ONLY a JSON array of objects with exactly these keys: id (number) and taskType (string).
Example: [{"id": 1, "taskType": "discovery"}]

Do not include any explanation or markdown — only the raw JSON array.`;

async function callAI(
  tasks: Array<{ id: number; title: string; templateName: string }>
): Promise<TaskType | null> {
  const userContent = tasks
    .map((t) => `ID: ${t.id} | Template: "${t.templateName}" | Task: "${t.title}"`)
    .join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [
        { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nTasks to classify:\n${userContent}` },
      ],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") return null;

    const raw = block.text.trim();
    const jsonStr = raw.startsWith("[")
      ? raw
      : raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");

    const parsed = JSON.parse(jsonStr) as Array<{ id: number; taskType: string }>;
    const first = parsed[0];
    if (first && isValidTaskType(first.taskType)) return first.taskType;
    return null;
  } catch (err) {
    logger.warn({ err }, "classify-task-type: AI call failed");
    return null;
  }
}

/**
 * Classify a single newly-inserted task and update its task_type in the DB.
 * Designed to be called as a fire-and-forget background job — never throws.
 */
export async function classifyAndUpdateTask(opts: {
  taskId: number;
  title: string;
  groupName: string | null;
  stepId: number;
}): Promise<void> {
  try {
    const { taskId, title, groupName, stepId } = opts;

    // Layer 1: deterministic by group_name
    if (groupName === "Artifacts Produced" || groupName === "Client Deliverables") {
      await db
        .update(workflowTemplateStepTasksTable)
        .set({ taskType: "documentDelivery" })
        .where(eq(workflowTemplateStepTasksTable.id, taskId));
      return;
    }

    // Resolve template name for AI context
    const [step] = await db
      .select({ templateId: workflowTemplateStepsTable.workflowTemplateId })
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.id, stepId))
      .limit(1);

    let templateName = "Unknown";
    if (step) {
      const [template] = await db
        .select({ name: workflowTemplatesTable.name })
        .from(workflowTemplatesTable)
        .where(eq(workflowTemplatesTable.id, step.templateId))
        .limit(1);
      if (template) templateName = template.name;
    }

    // Layer 2: AI classification
    const taskType = await callAI([{ id: taskId, title, templateName }]);
    if (taskType) {
      await db
        .update(workflowTemplateStepTasksTable)
        .set({ taskType })
        .where(eq(workflowTemplateStepTasksTable.id, taskId));
    }
  } catch (err) {
    logger.warn({ err }, "classify-task-type: background classification failed");
  }
}
