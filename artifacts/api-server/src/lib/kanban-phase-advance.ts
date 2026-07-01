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
import { eq, asc, count, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { broadcastKanbanChange } from "./sse-broadcast";

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
    triggersHealthScore?: boolean | null;
  }>
): Promise<Array<{
  instructions: string[];
  checklist: Array<{ id: string; label: string }>;
  artifactsProduced: string[];
  clientDeliverables: string[];
  checklistState: Record<string, never>;
  uploadedArtifacts: never[];
  linkedRunbook: { scriptId: string; azureRunbookName: string; scriptTitle: string } | null;
  triggersHealthScore: boolean;
}>> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const linkedInstrIds = [...new Set(templateTasks.map(t => t.instructionSetId).filter((id): id is number => id != null))];
  const linkedClIds   = [...new Set(templateTasks.map(t => t.checklistId).filter((id): id is number => id != null))];
  const linkedArtIds  = [...new Set(templateTasks.map(t => t.artifactsId).filter((id): id is number => id != null))];
  const linkedDelIds  = [...new Set(templateTasks.map(t => t.deliverablesId).filter((id): id is number => id != null))];
  const allRunIds     = [...new Set(templateTasks.map(t => t.runbookId).filter((id): id is string => !!id))];
  const uuidRunIds    = allRunIds.filter(id => UUID_RE.test(id));

  if (allRunIds.some(id => !UUID_RE.test(id))) {
    logger.warn({ nonUuids: allRunIds.filter(id => !UUID_RE.test(id)) }, "kanban-phase-advance: ignoring non-UUID runbook_id values (legacy slugs)");
  }

  const [instrRows, clRows, artRows, delRows, moduleRunbookRows, scriptRunbookRows] = await Promise.all([
    linkedInstrIds.length > 0 ? db.select().from(instructionSetsTable).where(inArray(instructionSetsTable.id, linkedInstrIds)) : Promise.resolve([]),
    linkedClIds.length   > 0 ? db.select().from(checklistsTable).where(inArray(checklistsTable.id, linkedClIds)) : Promise.resolve([]),
    linkedArtIds.length  > 0 ? db.select().from(artifactSetsTable).where(inArray(artifactSetsTable.id, linkedArtIds)) : Promise.resolve([]),
    linkedDelIds.length  > 0 ? db.select().from(deliverableSetsTable).where(inArray(deliverableSetsTable.id, linkedDelIds)) : Promise.resolve([]),
    uuidRunIds.length > 0
      ? db.select({ id: scriptModulesTable.id, filename: scriptModulesTable.filename, description: scriptModulesTable.description, azureRunbookName: scriptModulesTable.azureRunbookName })
          .from(scriptModulesTable).where(inArray(scriptModulesTable.id, uuidRunIds))
      : Promise.resolve([]),
    uuidRunIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title, azureRunbookName: powershellScriptsTable.azureRunbookName })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, uuidRunIds))
      : Promise.resolve([]),
  ]);

  const instrMap         = new Map(instrRows.map(r => [r.id, r.instructions as string[]]));
  const clMap            = new Map(clRows.map(r => [r.id, r.items as Array<{ id: string; label: string }>]));
  const artMap           = new Map(artRows.map(r => [r.id, r.artifacts as string[]]));
  const delMap           = new Map(delRows.map(r => [r.id, r.deliverables as string[]]));
  const moduleRunbookMap = new Map(moduleRunbookRows.map(r => [r.id, r]));
  const scriptRunbookMap = new Map(scriptRunbookRows.map(r => [r.id, r]));

  return templateTasks.map(t => {
    let linkedRunbook: { scriptId: string; azureRunbookName: string; scriptTitle: string } | null = null;
    if (t.runbookId && UUID_RE.test(t.runbookId)) {
      const mod = moduleRunbookMap.get(t.runbookId);
      if (mod?.azureRunbookName) {
        linkedRunbook = { scriptId: mod.id, azureRunbookName: mod.azureRunbookName, scriptTitle: mod.description ?? mod.filename.replace(/\.ps1$/i, "") };
      } else if (!mod) {
        const script = scriptRunbookMap.get(t.runbookId);
        if (script?.azureRunbookName) {
          linkedRunbook = { scriptId: script.id, azureRunbookName: script.azureRunbookName, scriptTitle: script.title };
        }
      }
    }
    return {
      instructions:       t.instructionSetId ? (instrMap.get(t.instructionSetId)  ?? (t.instructions  as string[]|null) ?? []) : ((t.instructions  as string[]|null) ?? []),
      checklist:          t.checklistId      ? (clMap.get(t.checklistId)           ?? (t.checklist     as Array<{id:string;label:string}>|null) ?? []) : ((t.checklist as Array<{id:string;label:string}>|null) ?? []),
      artifactsProduced:  t.artifactsId      ? (artMap.get(t.artifactsId)          ?? (t.artifactsProduced as string[]|null) ?? []) : ((t.artifactsProduced as string[]|null) ?? []),
      clientDeliverables: t.deliverablesId   ? (delMap.get(t.deliverablesId)       ?? (t.clientDeliverables as string[]|null) ?? []) : ((t.clientDeliverables as string[]|null) ?? []),
      checklistState: {} as Record<string, never>,
      uploadedArtifacts: [] as never[],
      linkedRunbook,
      triggersHealthScore: t.triggersHealthScore === true,
    };
  });
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
    logger.warn({ err, projectId }, "kanban-phase-advance: syncProjectProgress failed (non-fatal)");
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

    const [completedStep] = await db.update(workflowStepsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(workflowStepsTable.id, workflowStepId))
      .returning();

    if (!completedStep?.projectId) return empty;

    const allProjectSteps = await db.select().from(workflowStepsTable)
      .where(eq(workflowStepsTable.projectId, completedStep.projectId))
      .orderBy(asc(workflowStepsTable.order));
    const currentIdx = allProjectSteps.findIndex(s => s.id === workflowStepId);
    const nextStep   = allProjectSteps[currentIdx + 1];

    if (!nextStep || nextStep.status === "completed") return empty;

    const [activatedStep] = await db.update(workflowStepsTable)
      .set({ status: "in_progress" })
      .where(eq(workflowStepsTable.id, nextStep.id))
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

    logger.info(
      { workflowStepId, nextStepId: nextStep.id, spawnedCount: spawnedTasks.length, projectId },
      "kanban-phase-advance: next phase activated",
    );

    for (const t of spawnedTasks) broadcastKanbanChange(projectId, { action: "created", task: t });

    return { spawnedTasks, nextStepActivated: true };
  } catch (err) {
    logger.warn({ err, workflowStepId, projectId }, "kanban-phase-advance: phase advance failed (non-fatal)");
    return empty;
  }
}
