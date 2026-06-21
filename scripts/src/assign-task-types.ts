/**
 * assign-task-types.ts
 *
 * One-time (idempotent) script that classifies every NULL task_type row in
 * workflow_template_step_tasks and kanban_tasks using two layers:
 *
 *   1. Deterministic: group_name "Artifacts Produced" | "Client Deliverables" → documentDelivery
 *   2. AI (Anthropic claude-haiku-4-5): batches of ~50 tasks classified by title + template name
 *
 * Rows that already have a non-null task_type are skipped (idempotent).
 *
 * Run:
 *   pnpm --filter @workspace/scripts run assign-task-types
 *
 * Required env vars:
 *   DATABASE_URL                        — Postgres connection string
 *   AI_INTEGRATIONS_ANTHROPIC_BASE_URL  — set via Replit AI Integrations
 *   AI_INTEGRATIONS_ANTHROPIC_API_KEY   — set via Replit AI Integrations
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, isNull, inArray } from "drizzle-orm";
import {
  workflowTemplateStepTasksTable,
  workflowTemplateStepsTable,
  workflowTemplatesTable,
  kanbanTasksTable,
  workflowStepsTable,
} from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const { Pool } = pg;

const VALID_TYPES = [
  "discovery",
  "training",
  "environmentHealthCheck",
  "governanceSetup",
  "automationBuild",
  "documentDelivery",
] as const;

type TaskType = (typeof VALID_TYPES)[number];

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

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
Example: [{"id": 1, "taskType": "discovery"}, {"id": 2, "taskType": "governanceSetup"}]

Do not include any explanation or markdown — only the raw JSON array.`;

async function classifyWithAI(
  tasks: Array<{ id: number; title: string; templateName: string }>
): Promise<Map<number, TaskType>> {
  const userContent = tasks
    .map(
      (t) =>
        `ID: ${t.id} | Template: "${t.templateName}" | Task: "${t.title}"`
    )
    .join("\n");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        messages: [
          { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nTasks to classify:\n${userContent}` },
        ],
      });

      const block = msg.content[0];
      if (block.type !== "text") throw new Error("Unexpected non-text response block");

      const raw = block.text.trim();
      const jsonStr = raw.startsWith("[") ? raw : raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonStr) as Array<{ id: number; taskType: string }>;

      const result = new Map<number, TaskType>();
      for (const item of parsed) {
        if (typeof item.id === "number" && isValidTaskType(item.taskType)) {
          result.set(item.id, item.taskType);
        } else {
          console.warn(`  [warn] Skipping invalid classification: id=${item.id} type=${item.taskType}`);
        }
      }
      return result;
    } catch (err) {
      console.error(`  [attempt ${attempt}/${MAX_RETRIES}] AI classification failed:`, (err as Error).message);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return new Map();
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

async function main() {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  console.log("=== assign-task-types ===\n");

  // ── 1. WORKFLOW TEMPLATE STEP TASKS ─────────────────────────────────────────

  console.log("Fetching workflow_template_step_tasks with NULL task_type…");

  const nullTasks = await db
    .select({
      id: workflowTemplateStepTasksTable.id,
      title: workflowTemplateStepTasksTable.title,
      groupName: workflowTemplateStepTasksTable.groupName,
      stepId: workflowTemplateStepTasksTable.workflowTemplateStepId,
    })
    .from(workflowTemplateStepTasksTable)
    .where(isNull(workflowTemplateStepTasksTable.taskType));

  console.log(`  Found ${nullTasks.length} tasks needing classification.\n`);

  if (nullTasks.length > 0) {
    // Build a map of stepId → templateName by joining steps + templates
    const stepIds = [...new Set(nullTasks.map((t) => t.stepId))];
    const steps = await db
      .select({
        stepId: workflowTemplateStepsTable.id,
        templateId: workflowTemplateStepsTable.workflowTemplateId,
      })
      .from(workflowTemplateStepsTable)
      .where(inArray(workflowTemplateStepsTable.id, stepIds));

    const templateIds = [...new Set(steps.map((s) => s.templateId))];
    const templates = await db
      .select({
        id: workflowTemplatesTable.id,
        name: workflowTemplatesTable.name,
      })
      .from(workflowTemplatesTable)
      .where(inArray(workflowTemplatesTable.id, templateIds));

    const templateNameById = new Map(templates.map((t) => [t.id, t.name]));
    const templateIdByStepId = new Map(steps.map((s) => [s.stepId, s.templateId]));

    // Layer 1: Deterministic by group_name
    const deterministic: Array<{ id: number; type: TaskType }> = [];
    const aiQueue: Array<{ id: number; title: string; templateName: string }> = [];

    for (const task of nullTasks) {
      const gn = task.groupName ?? "";
      if (gn === "Artifacts Produced" || gn === "Client Deliverables") {
        deterministic.push({ id: task.id, type: "documentDelivery" });
      } else {
        const templateId = templateIdByStepId.get(task.stepId) ?? 0;
        const templateName = templateNameById.get(templateId) ?? "Unknown";
        aiQueue.push({ id: task.id, title: task.title, templateName });
      }
    }

    console.log(`  Deterministic (group_name): ${deterministic.length} → documentDelivery`);
    console.log(`  AI classification queue:    ${aiQueue.length} tasks`);

    // Apply deterministic updates
    if (deterministic.length > 0) {
      const ids = deterministic.map((d) => d.id);
      await db
        .update(workflowTemplateStepTasksTable)
        .set({ taskType: "documentDelivery" })
        .where(inArray(workflowTemplateStepTasksTable.id, ids));
      console.log(`  ✓ Updated ${deterministic.length} documentDelivery tasks`);
    }

    // Layer 2: AI classification in batches
    const aiResults = new Map<number, TaskType>();
    const batches = chunks(aiQueue, BATCH_SIZE);
    console.log(`\n  Processing ${batches.length} batch(es) of up to ${BATCH_SIZE} tasks via AI…`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} tasks)…`);
      const batchResult = await classifyWithAI(batch);
      for (const [id, type] of batchResult) aiResults.set(id, type);

      // Small delay between batches to avoid rate limiting
      if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
    }

    // Group AI results by type for batched updates
    const byType = new Map<TaskType, number[]>();
    for (const [id, type] of aiResults) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(id);
    }

    for (const [type, ids] of byType) {
      await db
        .update(workflowTemplateStepTasksTable)
        .set({ taskType: type })
        .where(inArray(workflowTemplateStepTasksTable.id, ids));
      console.log(`  ✓ Updated ${ids.length} → ${type}`);
    }

    const missed = aiQueue.length - aiResults.size;
    if (missed > 0) console.warn(`  ⚠ ${missed} AI tasks could not be classified (inspect logs above)`);
  }

  // ── 2. KANBAN TASKS ──────────────────────────────────────────────────────────

  console.log("\nFetching kanban_tasks with NULL task_type…");

  const nullKanban = await db
    .select({
      id: kanbanTasksTable.id,
      title: kanbanTasksTable.title,
      groupName: kanbanTasksTable.groupName,
      workflowStepId: kanbanTasksTable.workflowStepId,
    })
    .from(kanbanTasksTable)
    .where(isNull(kanbanTasksTable.taskType));

  console.log(`  Found ${nullKanban.length} kanban tasks needing classification.\n`);

  if (nullKanban.length > 0) {
    // Build step → template name map for kanban tasks
    const kStepIds = [...new Set(nullKanban.map((t) => t.workflowStepId).filter(Boolean))] as number[];

    let kTemplateNameByStepId = new Map<number, string>();
    if (kStepIds.length > 0) {
      const kSteps = await db
        .select({
          stepId: workflowStepsTable.id,
          templateStepId: workflowStepsTable.workflowTemplateStepId,
        })
        .from(workflowStepsTable)
        .where(inArray(workflowStepsTable.id, kStepIds));

      const kTemplateStepIds = [...new Set(kSteps.map((s) => s.templateStepId).filter(Boolean))] as number[];

      if (kTemplateStepIds.length > 0) {
        const kTemplateSteps = await db
          .select({
            id: workflowTemplateStepsTable.id,
            templateId: workflowTemplateStepsTable.workflowTemplateId,
          })
          .from(workflowTemplateStepsTable)
          .where(inArray(workflowTemplateStepsTable.id, kTemplateStepIds));

        const kTemplateIds = [...new Set(kTemplateSteps.map((s) => s.templateId))];
        const kTemplates = await db
          .select({ id: workflowTemplatesTable.id, name: workflowTemplatesTable.name })
          .from(workflowTemplatesTable)
          .where(inArray(workflowTemplatesTable.id, kTemplateIds));

        const kTemplateNameById = new Map(kTemplates.map((t) => [t.id, t.name]));
        const kTemplateIdByTemplateStepId = new Map(kTemplateSteps.map((s) => [s.id, s.templateId]));
        const kTemplateStepIdByStepId = new Map(kSteps.map((s) => [s.stepId, s.templateStepId]));

        for (const stepId of kStepIds) {
          const tStepId = kTemplateStepIdByStepId.get(stepId);
          const tId = tStepId ? kTemplateIdByTemplateStepId.get(tStepId) : undefined;
          const name = tId ? kTemplateNameById.get(tId) : undefined;
          if (name) kTemplateNameByStepId.set(stepId, name);
        }
      }
    }

    const kDeterministic: Array<{ id: number }> = [];
    const kAiQueue: Array<{ id: number; title: string; templateName: string }> = [];

    for (const task of nullKanban) {
      const gn = task.groupName ?? "";
      if (gn === "Artifacts Produced" || gn === "Client Deliverables") {
        kDeterministic.push({ id: task.id });
      } else {
        const templateName = task.workflowStepId
          ? (kTemplateNameByStepId.get(task.workflowStepId) ?? "Unknown")
          : "Unknown";
        kAiQueue.push({ id: task.id, title: task.title, templateName });
      }
    }

    console.log(`  Deterministic (group_name): ${kDeterministic.length} → documentDelivery`);
    console.log(`  AI classification queue:    ${kAiQueue.length} tasks`);

    if (kDeterministic.length > 0) {
      await db
        .update(kanbanTasksTable)
        .set({ taskType: "documentDelivery" })
        .where(inArray(kanbanTasksTable.id, kDeterministic.map((d) => d.id)));
      console.log(`  ✓ Updated ${kDeterministic.length} documentDelivery kanban tasks`);
    }

    if (kAiQueue.length > 0) {
      const kBatches = chunks(kAiQueue, BATCH_SIZE);
      console.log(`\n  Processing ${kBatches.length} batch(es) for kanban tasks…`);

      const kAiResults = new Map<number, TaskType>();
      for (let i = 0; i < kBatches.length; i++) {
        const batch = kBatches[i];
        console.log(`  Batch ${i + 1}/${kBatches.length} (${batch.length} tasks)…`);
        const batchResult = await classifyWithAI(batch);
        for (const [id, type] of batchResult) kAiResults.set(id, type);
        if (i < kBatches.length - 1) await new Promise((r) => setTimeout(r, 500));
      }

      const kByType = new Map<TaskType, number[]>();
      for (const [id, type] of kAiResults) {
        if (!kByType.has(type)) kByType.set(type, []);
        kByType.get(type)!.push(id);
      }

      for (const [type, ids] of kByType) {
        await db
          .update(kanbanTasksTable)
          .set({ taskType: type })
          .where(inArray(kanbanTasksTable.id, ids));
        console.log(`  ✓ Updated ${ids.length} kanban → ${type}`);
      }
    }
  }

  // ── 3. FINAL SUMMARY ─────────────────────────────────────────────────────────

  console.log("\n=== Final Summary ===\n");

  const templateTaskCounts = await db.execute(sql`
    SELECT task_type, COUNT(*) AS count
    FROM workflow_template_step_tasks
    GROUP BY task_type
    ORDER BY count DESC
  `);

  console.log("workflow_template_step_tasks:");
  for (const row of templateTaskCounts.rows as Array<{ task_type: string | null; count: string }>) {
    const label = row.task_type ?? "(null)";
    console.log(`  ${label.padEnd(26)} ${row.count}`);
  }

  const kanbanCounts = await db.execute(sql`
    SELECT task_type, COUNT(*) AS count
    FROM kanban_tasks
    GROUP BY task_type
    ORDER BY count DESC
  `);

  console.log("\nkanban_tasks:");
  for (const row of kanbanCounts.rows as Array<{ task_type: string | null; count: string }>) {
    const label = row.task_type ?? "(null)";
    console.log(`  ${label.padEnd(26)} ${row.count}`);
  }

  const remainingResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM workflow_template_step_tasks WHERE task_type IS NULL) AS step_null,
      (SELECT COUNT(*) FROM kanban_tasks WHERE task_type IS NULL) AS kanban_null
  `);

  const r = remainingResult.rows[0] as { step_null: string; kanban_null: string } | undefined;
  console.log(`\nRemaining NULL task_type:`);
  console.log(`  workflow_template_step_tasks: ${r?.step_null ?? "?"}`);
  console.log(`  kanban_tasks:                 ${r?.kanban_null ?? "?"}`);
  console.log("\nDone.");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
