import {
  db,
  instructionSetsTable,
  checklistsTable,
  artifactSetsTable,
  deliverableSetsTable,
  scriptModulesTable,
  powershellScriptsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.templates" });

/**
 * Extracted from portal.ts (#175, portal.ts route decommission) — shared by
 * admin-projects.ts, admin-services.ts, and portal-checkout-free.ts.
 */
export async function resolveTemplateTaskMetadata(
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
  const linkedInstrIds = [...new Set(templateTasks.map(t => t.instructionSetId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedClIds = [...new Set(templateTasks.map(t => t.checklistId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedArtIds = [...new Set(templateTasks.map(t => t.artifactsId).filter((id): id is number => id !== null && id !== undefined))];
  const linkedDelIds = [...new Set(templateTasks.map(t => t.deliverablesId).filter((id): id is number => id !== null && id !== undefined))];
  const PROV_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const allRunbookIds = [...new Set(templateTasks.map(t => t.runbookId).filter((id): id is string => !!id))];
  const uuidRunbookIds = allRunbookIds.filter(id => PROV_UUID_RE.test(id));
  const nonUuidRunbookIds = allRunbookIds.filter(id => !PROV_UUID_RE.test(id));
  if (nonUuidRunbookIds.length > 0) {
    log.warn({ nonUuidRunbookIds }, "portal: ignoring non-UUID runbook_id values (legacy slugs — update workflow template tasks)");
  }
  const allDlIds = [...new Set(templateTasks.map(t => t.customerDownloadScriptId).filter((id): id is string => !!id && PROV_UUID_RE.test(id)))];

  const [instrRows, clRows, artRows, delRows, moduleRunbookRows, scriptRunbookRows, dlScriptRows] = await Promise.all([
    linkedInstrIds.length > 0 ? db.select().from(instructionSetsTable).where(inArray(instructionSetsTable.id, linkedInstrIds)) : Promise.resolve([]),
    linkedClIds.length > 0 ? db.select().from(checklistsTable).where(inArray(checklistsTable.id, linkedClIds)) : Promise.resolve([]),
    linkedArtIds.length > 0 ? db.select().from(artifactSetsTable).where(inArray(artifactSetsTable.id, linkedArtIds)) : Promise.resolve([]),
    linkedDelIds.length > 0 ? db.select().from(deliverableSetsTable).where(inArray(deliverableSetsTable.id, linkedDelIds)) : Promise.resolve([]),
    uuidRunbookIds.length > 0
      ? db.select({ id: scriptModulesTable.id, filename: scriptModulesTable.filename, description: scriptModulesTable.description })
          .from(scriptModulesTable).where(inArray(scriptModulesTable.id, uuidRunbookIds))
      : Promise.resolve([]),
    uuidRunbookIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, uuidRunbookIds))
      : Promise.resolve([]),
    allDlIds.length > 0
      ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
          .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, allDlIds))
      : Promise.resolve([]),
  ]);

  const instrMap = new Map(instrRows.map(r => [r.id, r.instructions as string[]]));
  const clMap = new Map(clRows.map(r => [r.id, r.items as Array<{ id: string; label: string }>]));
  const artMap = new Map(artRows.map(r => [r.id, r.artifacts as string[]]));
  const delMap = new Map(delRows.map(r => [r.id, r.deliverables as string[]]));
  const moduleRunbookMap = new Map(moduleRunbookRows.map(r => [r.id, r]));
  const scriptRunbookMap = new Map(scriptRunbookRows.map(r => [r.id, r]));
  const dlScriptMap = new Map(dlScriptRows.map(r => [r.id, r]));

  return templateTasks.map(t => {
    let linkedRunbook: { scriptId: string; scriptTitle: string } | null = null;
    if (t.runbookId && PROV_UUID_RE.test(t.runbookId)) {
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
    if (t.customerDownloadScriptId && PROV_UUID_RE.test(t.customerDownloadScriptId)) {
      const dlScript = dlScriptMap.get(t.customerDownloadScriptId);
      if (dlScript) {
        customerDownload = { scriptId: dlScript.id, scriptTitle: dlScript.title };
      }
    }

    const rawMeta = (t.taskMetadata ?? {}) as Record<string, unknown>;
    return {
      instructions: t.instructionSetId ? (instrMap.get(t.instructionSetId) ?? (t.instructions as string[] | null) ?? []) : ((t.instructions as string[] | null) ?? []),
      checklist: t.checklistId ? (clMap.get(t.checklistId) ?? (t.checklist as Array<{ id: string; label: string }> | null) ?? []) : ((t.checklist as Array<{ id: string; label: string }> | null) ?? []),
      artifactsProduced: t.artifactsId ? (artMap.get(t.artifactsId) ?? (t.artifactsProduced as string[] | null) ?? []) : ((t.artifactsProduced as string[] | null) ?? []),
      clientDeliverables: t.deliverablesId ? (delMap.get(t.deliverablesId) ?? (t.clientDeliverables as string[] | null) ?? []) : ((t.clientDeliverables as string[] | null) ?? []),
      checklistState: {} as Record<string, never>,
      uploadedArtifacts: [] as never[],
      linkedRunbook,
      customerDownload,
      triggersHealthScore: t.triggersHealthScore === true,
      documentGeneration: (rawMeta.documentGeneration as { category: string; docType: string; title: string } | undefined) ?? null,
    };
  });
}
