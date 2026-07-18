/**
 * kanban-phase-advance.ts
 *
 * Shared phase-advancement logic consumed by:
 *   - portal.ts  PATCH /admin/kanban-tasks/:id  (admin manually completes a card)
 *   - admin-m365-run.ts processRunInBackground   (script finishes and auto-completes cards)
 *
 * When cards are moved to "completed", call advancePhaseIfComplete(workflowStepId, projectId).
 * It checks whether ALL tasks in that phase are done; if so it marks the step complete,
 * activates the next step, and spawns the next phase's kanban cards.
 *
 * Returns the spawned tasks so callers can broadcast SSE updates if they have access
 * to the real-time registry (portal.ts does; background workers skip the broadcast).
 */

import {
  db,
  kanbanTasksTable,
  workflowStepsTable,
  workflowTemplateStepTasksTable,
  powershellScriptsTable,
  scriptModulesTable,
  instructionSetsTable,
  checklistsTable,
  artifactSetsTable,
  deliverableSetsTable,
  projectsTable,
} from "@workspace/db";
import { eq, asc, and, count, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.kanban" });
import { broadcastKanbanChange } from "./sse-channels";

type SpawnedTask = typeof kanbanTasksTable.$inferSelect;

export interface PhaseAdvanceResult {
  spawnedTasks: SpawnedTask[];
  nextStepActivated: boolean;
}

async function resolveTemplateTaskMetadata(
  templateTasks: Array<{
    instructionSetId?: number | null;
    checklistId?: number | null;
    artifactsId?: number | null;
    deliverablesId?: number | null;
    instructions?: unknown;
    checklist?: unknown;
    artifactsProduced?: unknown;
    clientDeliverables?: unknown;
    runbookId?: string | null;
    customerDownloadScriptId?: string | null;
    triggersHealthScore?: boolean | null;
    taskMetadata?: Record<string, unknown> | null;
  }>
): Promise<Array<{
  instructions: string[];
  checklist: Array<{ id: string; label: string }>;
  artifactsProduced: string[];
  clientDeliverables: string[];
  checklistState: Record<string, never>;
  uploadedArtifacts: never[];
  linkedRunbook: { scriptId: string; scriptTitle: string } | null;
  customerDownload: { scriptId: string; scriptTitle: string } | null;
  triggersHealthScore: boolean;
  documentGeneration: { category: string; docType: string; title: string } | null;
}>> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const linkedInstrIds = [...new Set(templateTasks.map(t => t.instructionSetId).filter((id): id is number => id != null))];
  const linkedClIds   = [...new Set(templateTasks.map(t => t.checklistId).filter((id): id is number => id != null))];
  const linkedArtIds  = [...new Set(templateTasks.map(t => t.artifactsId).filter((id): id is number => id != null))];
  const linkedDelIds  = [...new Set(templateTasks.map(t => t.deliverablesId).filter((id): id is number => id != null))];
  const allRunIds     = [...new Set(templateTasks.map(t => t.runbookId).filter((id): id is string => !!id))];
  const uuidRunIds    = allRunIds.filter(id => UUID_RE.test(id));
  const allDlIds      = [...new Set(templateTasks.map(t => t.customerDownloadScriptId).filter((id): id is string => !!id && UUID_RE.test(id)))];

  if (allRunIds.some(id => !UUID_RE.test(id))) {
    log.warn({ nonUuids: allRunIds.filter(id => !UUID_RE.test(id)) }, "kanban-phase-advance: ignoring non-UUID runbook_id values (legacy slugs)");
  }

  const [instrRows, clRows, artRows, delRows, moduleRunbookRows, scriptRunbookRows, dlScriptRows] = await Promise.all([
    linkedInstrIds.length > 0 ? db.select().from(instructionSetsTable).where(inArray(instructionSetsTable.id, linkedInstrIds)) : Promise.resolve([]),
    linkedClIds.length   > 0 ? db.select().from(checklistsTable).where(inArray(checklistsTable.id, linkedClIds)) : Promise.resolve([]),
    linkedArtIds.length  > 0 ? db.select().from(artifactSetsTable).where(inArray(artifactSetsTable.id, linkedArtIds)) : Promise.resolve([]),
    linkedDelIds.length  > 0 ? db.select().from(deliverableSetsTable).where(inArray(deliverableSetsTable.id, linkedDelIds)) : Promise.resolve([]),
    uuidRunIds.length > 0
      ? db.select({ id: scriptModulesTable.id, filename: scriptModulesTable.filename, description: scriptModulesTable.description })
          .from(scriptModulesTable).where(inArray(scriptModulesTable.id, uuidRunIds))
      : Promise.resolve([]),
    uuidRunIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, uuidRunIds))
      : Promise.resolve([]),
    allDlIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, allDlIds))
      : Promise.resolve([]),
  ]);

  const instrMap         = new Map(instrRows.map(r => [r.id, r.instructions as string[]]));
  const clMap            = new Map(clRows.map(r => [r.id, r.items as Array<{ id: string; label: string }>]));
  const artMap           = new Map(artRows.map(r => [r.id, r.artifacts as string[]]));
  const delMap           = new Map(delRows.map(r => [r.id, r.deliverables as string[]]));
  const moduleRunbookMap = new Map(moduleRunbookRows.map(r => [r.id, r]));
  const scriptRunbookMap = new Map(scriptRunbookRows.map(r => [r.id, r]));
  const dlScriptMap      = new Map(dlScriptRows.map(r => [r.id, r]));

  return templateTasks.map(t => {
    let linkedRunbook: { scriptId: string; scriptTitle: string } | null = null;
    if (t.runbookId && UUID_RE.test(t.runbookId)) {
      const mod = moduleRunbookMap.get(t.runbookId);
      if (mod) {
        linkedRunbook = { scriptId: mod.id, scriptTitle: mod.description ?? mod.filename.replace(/\.ps1$/i, "") };
      } else {
        const script = scriptRunbookMap.get(t.runbookId);
        if (script) {
          linkedRunbook = { scriptId: script.id, scriptTitle: script.title };
        }
      }
    }

    let customerDownload: { scriptId: string; scriptTitle: string } | null = null;
    if (t.customerDownloadScriptId && UUID_RE.test(t.customerDownloadScriptId)) {
      const dlScript = dlScriptMap.get(t.customerDownloadScriptId);
      if (dlScript) {
        customerDownload = { scriptId: dlScript.id, scriptTitle: dlScript.title };
      }
    }

    const rawMeta = (t.taskMetadata ?? {}) as Record<string, unknown>;
    return {
      instructions:       t.instructionSetId ? (instrMap.get(t.instructionSetId)  ?? (t.instructions  as string[]|null) ?? []) : ((t.instructions  as string[]|null) ?? []),
      checklist:          t.checklistId      ? (clMap.get(t.checklistId)           ?? (t.checklist     as Array<{id:string;label:string}>|null) ?? []) : ((t.checklist as Array<{id:string;label:string}>|null) ?? []),
      artifactsProduced:  t.artifactsId      ? (artMap.get(t.artifactsId)          ?? (t.artifactsProduced as string[]|null) ?? []) : ((t.artifactsProduced as string[]|null) ?? []),
      clientDeliverables: t.deliverablesId   ? (delMap.get(t.deliverablesId)       ?? (t.clientDeliverables as string[]|null) ?? []) : ((t.clientDeliverables as string[]|null) ?? []),
      checklistState: {} as Record<string, never>,
      uploadedArtifacts: [] as never[],
      linkedRunbook,
      customerDownload,
      triggersHealthScore: t.triggersHealthScore === true,
      documentGeneration: (rawMeta.documentGeneration as { category: string; docType: string; title: string } | undefined) ?? null,
    };
  });
}

/**
 * Seed kanban cards for a workflow step that has just been moved to `in_progress`.
 *
 * Logic:
 *  1. Look up the workflow_step to resolve its workflowTemplateStepId and projectId.
 *  2. Check whether kanban tasks already exist for that step — if so, skip (idempotent).
 *  3. Fetch the matching workflow_template_step_tasks, resolve FK-linked metadata, and
 *     bulk-insert into kanban_tasks.
 *  4. Sync project progress.
 *
 * Intentionally does NOT call autoFireFirstBacklogScript, autoFireDocumentCard, or
 * autoFireRunWorkflowCards — those automations are only triggered from the existing
 * route handler path and must remain excluded here.
 *
 * Returns { seeded: boolean; taskCount: number }.
 * Never throws — all errors are caught and logged.
 */
export async function seedKanbanCardsForPhase(
  stepId: number,
  log: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<{ seeded: boolean; taskCount: number }> {
  try {
    const [step] = await db
      .select({
        id: workflowStepsTable.id,
        projectId: workflowStepsTable.projectId,
        workflowTemplateStepId: workflowStepsTable.workflowTemplateStepId,
      })
      .from(workflowStepsTable)
      .where(eq(workflowStepsTable.id, stepId))
      .limit(1);

    if (!step?.projectId || !step?.workflowTemplateStepId) {
      log.warn({ stepId }, "seedKanbanCardsForPhase: step not found or missing projectId/templateStepId");
      return { seeded: false, taskCount: 0 };
    }

    const [existingCount] = await db
      .select({ n: count() })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.workflowStepId, stepId));

    if (Number(existingCount?.n ?? 0) > 0) {
      log.info({ stepId, projectId: step.projectId }, "seedKanbanCardsForPhase: tasks already exist, skipping");
      return { seeded: false, taskCount: 0 };
    }

    const templateTasks = await db
      .select()
      .from(workflowTemplateStepTasksTable)
      .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, step.workflowTemplateStepId))
      .orderBy(asc(workflowTemplateStepTasksTable.order));

    if (templateTasks.length === 0) {
      log.info({ stepId, projectId: step.projectId }, "seedKanbanCardsForPhase: no template tasks found");
      return { seeded: false, taskCount: 0 };
    }

    const resolvedMetadata = await resolveTemplateTaskMetadata(templateTasks);
    await db.insert(kanbanTasksTable).values(
      templateTasks.map((t, idx) => ({
        projectId:      step.projectId!,
        workflowStepId: step.id,
        groupName:      t.groupName ?? null,
        title:          t.title,
        description:    t.description ?? null,
        column:         (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
        order:          idx,
        taskType:       t.taskType ?? null,
        taskMetadata:   resolvedMetadata[idx],
      })),
    );

    await syncProjectProgress(step.projectId);
    log.info({ stepId, projectId: step.projectId, taskCount: templateTasks.length }, "seedKanbanCardsForPhase: seeded kanban tasks");
    return { seeded: true, taskCount: templateTasks.length };
  } catch (err) {
    log.warn({ err, stepId }, "seedKanbanCardsForPhase: failed (non-fatal)");
    return { seeded: false, taskCount: 0 };
  }
}

/**
 * Recompute project progress percentage and persist it.
 * Mirrors syncProjectProgress in portal.ts.
 */
export async function syncProjectProgress(projectId: number): Promise<void> {
  try {
    const [result] = await db
      .select({
        total:     count(),
        completed: count(sql`case when ${kanbanTasksTable.column} = 'completed' then 1 end`),
      })
      .from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.projectId, projectId));
    const total     = result?.total ?? 0;
    const completed = Number(result?.completed ?? 0);
    const progress  = total === 0 ? 0 : Math.round((completed / total) * 100);
    await db.update(projectsTable).set({ progress }).where(eq(projectsTable.id, projectId));
  } catch (err) {
    log.warn({ err, projectId }, "kanban-phase-advance: syncProjectProgress failed (non-fatal)");
  }
}

/**
 * After kanban tasks are moved to "completed", call this once per unique workflowStepId.
 *
 *  1. If every task in the step is completed → mark step completed.
 *  2. Find the next ordered step in the project.
 *  3. Activate the next step and spawn its kanban cards (all start in "backlog"
 *     unless the template marks them as customer tasks).
 *
 * Returns spawned tasks so callers with SSE access can broadcast them.
 * All errors are caught internally and logged — never throws.
 */
export async function advancePhaseIfComplete(
  workflowStepId: number,
  projectId: number,
): Promise<PhaseAdvanceResult> {
  const empty: PhaseAdvanceResult = { spawnedTasks: [], nextStepActivated: false };

  try {
    const allStepTasks = await db.select().from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.workflowStepId, workflowStepId));
    const allDone = allStepTasks.length > 0 && allStepTasks.every(t => t.column === "completed");
    if (!allDone) return empty;

    // Atomic guard: only mark completed if still in_progress.
    // If 0 rows returned, a concurrent advancePhaseIfComplete call already
    // handled this step — bail out to avoid seeding duplicate tasks.
    const [completedStep] = await db.update(workflowStepsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(
        eq(workflowStepsTable.id, workflowStepId),
        eq(workflowStepsTable.status, "in_progress"),
      ))
      .returning();

    if (!completedStep?.projectId) return empty;

    const allProjectSteps = await db.select().from(workflowStepsTable)
      .where(eq(workflowStepsTable.projectId, completedStep.projectId))
      .orderBy(asc(workflowStepsTable.order));
    const currentIdx = allProjectSteps.findIndex(s => s.id === workflowStepId);
    const nextStep   = allProjectSteps[currentIdx + 1];

    if (!nextStep || nextStep.status === "completed") return empty;

    // Guard: only activate if still pending — prevents a second concurrent
    // caller that also passed the allDone check from double-seeding tasks.
    const [activatedStep] = await db.update(workflowStepsTable)
      .set({ status: "in_progress" })
      .where(and(
        eq(workflowStepsTable.id, nextStep.id),
        eq(workflowStepsTable.status, "pending"),
      ))
      .returning();

    if (!activatedStep?.workflowTemplateStepId || !activatedStep.projectId) return empty;

    const templateTasks = await db.select().from(workflowTemplateStepTasksTable)
      .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, activatedStep.workflowTemplateStepId))
      .orderBy(asc(workflowTemplateStepTasksTable.order));

    if (templateTasks.length === 0) return empty;

    const resolvedMetadata = await resolveTemplateTaskMetadata(templateTasks);
    const spawnedTasks = await db.insert(kanbanTasksTable).values(
      templateTasks.map((t, idx) => ({
        projectId:        activatedStep.projectId!,
        workflowStepId:   activatedStep.id,
        groupName:        t.groupName ?? null,
        title:            t.title,
        description:      t.description ?? null,
        column:           (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
        order:            idx,
        taskType:         t.taskType ?? null,
        taskMetadata:     resolvedMetadata[idx],
      }))
    ).returning();

    log.info(
      { workflowStepId, nextStepId: nextStep.id, spawnedCount: spawnedTasks.length, projectId },
      "kanban-phase-advance: next phase activated",
    );

    for (const t of spawnedTasks) broadcastKanbanChange(projectId, { action: "created", task: t });

    return { spawnedTasks, nextStepActivated: true };
  } catch (err) {
    log.warn({ err, workflowStepId, projectId }, "kanban-phase-advance: phase advance failed (non-fatal)");
    return empty;
  }
}
