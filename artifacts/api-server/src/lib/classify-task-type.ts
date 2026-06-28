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
  "script",
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
- Tasks about running PowerShell scripts, Azure Automation Runbooks → script

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

// ─── Script automatable classification ────────────────────────────────────────

const SCRIPT_AUTOMATABLE_PROMPT = `You are classifying Microsoft 365 workflow tasks to determine automation eligibility for PowerShell scripting.

Classify the task as exactly one of:
- AUTOMATABLE: Can be fully or partially automated with PowerShell (provisioning accounts/sites/groups, configuring policies, bulk operations, reports, running cmdlets, setting permissions, Azure Automation runbooks)
- USER_ACCOUNT_REQUIRED: Requires admin UI interaction but a helper or companion script could assist (enabling features in admin center, tasks with PowerShell equivalents, hybrid tasks mixing UI and scripting)
- HUMAN_ONLY: Inherently human with no meaningful script component: meetings, training sessions, document writing, stakeholder communication, strategic decisions, reviews requiring human judgment

Reply with ONLY one word: AUTOMATABLE, USER_ACCOUNT_REQUIRED, or HUMAN_ONLY`;

/**
 * Classify a task as AUTOMATABLE, USER_ACCOUNT_REQUIRED, or HUMAN_ONLY
 * for the purpose of PowerShell script generation.
 * Never throws — defaults to HUMAN_ONLY on any failure.
 */
export async function classifyTaskForScriptGeneration(
  title: string,
  description?: string | null
): Promise<"AUTOMATABLE" | "USER_ACCOUNT_REQUIRED" | "HUMAN_ONLY"> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [
        {
          role: "user",
          content: `${SCRIPT_AUTOMATABLE_PROMPT}\n\nTask: "${title}"${description ? `\nDescription: ${description}` : ""}`,
        },
      ],
    });
    const block = msg.content[0];
    const text = block?.type === "text" ? block.text.trim().toUpperCase() : "";
    if (text.includes("USER_ACCOUNT")) return "USER_ACCOUNT_REQUIRED";
    if (text.includes("AUTOMATABLE")) return "AUTOMATABLE";
    return "HUMAN_ONLY";
  } catch (err) {
    logger.warn({ err }, "classifyTaskForScriptGeneration: AI call failed, defaulting to HUMAN_ONLY");
    return "HUMAN_ONLY";
  }
}

// ─── DB-updating classification ────────────────────────────────────────────────

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
