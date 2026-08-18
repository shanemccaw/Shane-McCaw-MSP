// Zoho Projects nodes — Project / Tasklist / Task / Milestone (#85).
//
// Builds strictly on the #82 Foundation (`zoho-client.ts`, `zoho-batch-drain.ts`)
// and this phase's own `zoho-projects-read.ts` (portal id resolution + every
// read/list call). Nothing here reimplements a read — this file owns writes,
// the drain registration, and the workflow-executor entry point.
//
// Follows the exact read/write split #83 (Zoho CRM) established: read nodes
// (zoho_get_*/zoho_list_*) call Zoho inline and return records; write nodes
// (zoho_create_*/zoho_update_*) enqueue an msp_job_queue row and return
// { queued: true, jobId } — the actual Zoho write happens on the next
// zoho_batch_drain (5 minutes). No delete nodes: Zoho is the system of
// record and deletion stays a manual Zoho-side action.
//
// #1162 (2026-08-18): found alongside Desk's identical bug in the same issue.
// Never live-verified until now — this file assumed Projects sat on the same
// www.zohoapis.com gateway CRM/Books use. It doesn't; Projects' real API root
// is projectsapi.zoho.com/api/v3 (see ZOHO_PROJECTS_API_HOST in
// zoho-projects-read.ts).

import { zohoPost, zohoPut, ZohoApiError } from "./zoho-client.ts";
import { registerZohoJobHandler } from "./zoho-batch-drain.ts";
import { enqueueJob } from "./msp-jobs.ts";
import { logger } from "./logger";
import {
  resolveZohoPortalId,
  zohoProjectsBasePath,
  ZOHO_PROJECTS_API_HOST,
  listProjects,
  getProject,
  getTasklist,
  listTasks,
  getTask,
  listMilestones,
  getMilestone,
} from "./zoho-projects-read.ts";

const log = logger.child({ channel: "integration.zoho" });

// Re-exported so a caller that only needs reads can import everything from
// this one module, same convenience zoho-crm.ts offers over zoho-read.ts.
export {
  resolveZohoPortalId,
  listProjects,
  getProject,
  getTasklist,
  listTasks,
  getTask,
  listMilestones,
  getMilestone,
};

// ── Node catalog ─────────────────────────────────────────────────────────────
// Lives in the dependency-free zoho-projects-nodes.ts so node-type-registry.ts
// can derive its entries without importing this module's DB/queue deps.

import {
  ZOHO_PROJECTS_NODES,
  ZOHO_PROJECTS_NODE_TYPES,
  isZohoProjectsNodeType,
  getZohoProjectsNodeSpec,
  type ZohoProjectsEntity,
  type ZohoProjectsNodeSpec,
} from "./zoho-projects-nodes.ts";

export {
  ZOHO_PROJECTS_NODES,
  ZOHO_PROJECTS_NODE_TYPES,
  isZohoProjectsNodeType,
  getZohoProjectsNodeSpec,
  type ZohoProjectsEntity,
  type ZohoProjectsNodeSpec,
};

const NODE_SPECS = new Map(ZOHO_PROJECTS_NODES.map((n) => [n.nodeType, n]));

/**
 * Only string/number/boolean field values are forwarded to Zoho. `fields` on a
 * node is free-form operator/UI input, so anything else is dropped rather than
 * serialized into a shape Zoho will reject for the whole record.
 */
export function sanitizeFields(fields: unknown): Record<string, unknown> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === null) { out[key] = null; continue; }
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") out[key] = value;
  }
  return out;
}

// ── Write operations (drain handlers — these are what actually call Zoho) ────

async function createProject(fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoPost(`${zohoProjectsBasePath(portalId)}/projects/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  const projects = body.projects;
  const rec = Array.isArray(projects) ? (projects[0] as Record<string, unknown> | undefined) : undefined;
  if (!rec || rec.id === undefined) throw new Error("Zoho Projects: project create returned no id");
  return { entity: "Project", action: "create", zohoId: String(rec.id) };
}

async function updateProject(projectId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  await zohoPut(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  return { entity: "Project", action: "update", zohoId: projectId };
}

async function createTasklist(projectId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoPost(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasklists/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  const tasklists = body.tasklists;
  const rec = Array.isArray(tasklists) ? (tasklists[0] as Record<string, unknown> | undefined) : undefined;
  if (!rec || rec.id === undefined) throw new Error("Zoho Projects: tasklist create returned no id");
  return { entity: "Tasklist", action: "create", projectId, zohoId: String(rec.id) };
}

async function createTask(projectId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoPost(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  const tasks = body.tasks;
  const rec = Array.isArray(tasks) ? (tasks[0] as Record<string, unknown> | undefined) : undefined;
  if (!rec || rec.id === undefined) throw new Error("Zoho Projects: task create returned no id");
  return { entity: "Task", action: "create", projectId, zohoId: String(rec.id) };
}

async function updateTask(projectId: string, taskId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  await zohoPut(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  return { entity: "Task", action: "update", projectId, zohoId: taskId };
}

async function createMilestone(projectId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  const body = await zohoPost(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/milestones/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  const milestones = body.milestones;
  const rec = Array.isArray(milestones) ? (milestones[0] as Record<string, unknown> | undefined) : undefined;
  if (!rec || rec.id === undefined) throw new Error("Zoho Projects: milestone create returned no id");
  return { entity: "Milestone", action: "create", projectId, zohoId: String(rec.id) };
}

async function updateMilestone(projectId: string, milestoneId: string, fields: Record<string, unknown>, mspId?: number): Promise<Record<string, unknown>> {
  const portalId = await resolveZohoPortalId(mspId);
  await zohoPut(`${zohoProjectsBasePath(portalId)}/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}/`, fields, mspId, ZOHO_PROJECTS_API_HOST);
  return { entity: "Milestone", action: "update", projectId, zohoId: milestoneId };
}

// ── Job-handler registration ─────────────────────────────────────────────────
// One handler per write node type. jobType string === node type string, so
// there is no mapping table to drift — same discipline #83 established.

type WriteHandler = (payload: Record<string, unknown>, mspId: number | undefined) => Promise<Record<string, unknown>>;

function requireString(payload: Record<string, unknown>, key: string, nodeType: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${nodeType} requires a non-empty "${key}"`);
  }
  return value.trim();
}

const WRITE_HANDLERS: Record<string, WriteHandler> = {
  zoho_create_project: (p, msp) => createProject(sanitizeFields(p.fields), msp),
  zoho_update_project: (p, msp) => updateProject(requireString(p, "zohoProjectId", "zoho_update_project"), sanitizeFields(p.fields), msp),

  zoho_create_tasklist: (p, msp) => createTasklist(requireString(p, "zohoProjectId", "zoho_create_tasklist"), sanitizeFields(p.fields), msp),

  zoho_create_task: (p, msp) => createTask(requireString(p, "zohoProjectId", "zoho_create_task"), sanitizeFields(p.fields), msp),
  zoho_update_task: (p, msp) => updateTask(requireString(p, "zohoProjectId", "zoho_update_task"), requireString(p, "zohoTaskId", "zoho_update_task"), sanitizeFields(p.fields), msp),

  zoho_create_milestone: (p, msp) => createMilestone(requireString(p, "zohoProjectId", "zoho_create_milestone"), sanitizeFields(p.fields), msp),
  zoho_update_milestone: (p, msp) => updateMilestone(requireString(p, "zohoProjectId", "zoho_update_milestone"), requireString(p, "zohoMilestoneId", "zoho_update_milestone"), sanitizeFields(p.fields), msp),
};

let handlersRegistered = false;

/**
 * Registers every write node's handler on the Foundation's drain. Idempotent —
 * safe to call from more than one entry point without double-registering.
 */
export function registerZohoProjectsJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  for (const [jobType, handler] of Object.entries(WRITE_HANDLERS)) {
    registerZohoJobHandler(jobType, async (job) => {
      const mspId = job.mspId ?? undefined;
      try {
        const result = await handler(job.payload, mspId);
        log.info({ jobId: job.jobId, jobType, attempt: job.attemptCount, result }, "zoho-projects: write applied");
        return result;
      } catch (err) {
        if (err instanceof ZohoApiError) {
          throw new Error(`${jobType} failed (HTTP ${err.status}): ${JSON.stringify(err.body)}`);
        }
        throw err;
      }
    });
  }

  log.info({ count: Object.keys(WRITE_HANDLERS).length }, "zoho-projects: registered write job handlers");
}

// ── Enqueue side (what routes and write nodes actually call) ─────────────────

export interface EnqueueZohoProjectsWriteOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

/**
 * Queues a Zoho Projects write. This is the ONLY way a route or a workflow
 * node causes a Zoho Projects write — nothing on a request path blocks on a
 * live Zoho call. Applied by the same seeded 5-minute "Zoho Queue Drain"
 * workflow the Foundation and Zoho CRM already share.
 */
export async function enqueueZohoProjectsWrite(
  nodeType: string,
  payload: Record<string, unknown>,
  opts: EnqueueZohoProjectsWriteOptions = {},
): Promise<{ queued: true; jobId: string; jobType: string }> {
  if (!WRITE_HANDLERS[nodeType]) {
    throw new Error(`Unknown Zoho Projects write node type: ${nodeType}`);
  }
  const jobId = await enqueueJob(nodeType, payload, {
    mspId: opts.mspId,
    customerId: opts.customerId,
    correlationId: opts.correlationId,
  });
  log.info({ jobId, jobType: nodeType }, "zoho-projects: write queued for next drain");
  return { queued: true, jobId, jobType: nodeType };
}

// ── Executor entry point ─────────────────────────────────────────────────────

/**
 * Executes one Zoho Projects node. `resolve` is the executor's own
 * placeholder interpolation, passed in so this module stays independent of
 * the executor — mirrors executeZohoCrmNode's contract exactly.
 */
export async function executeZohoProjectsNode(
  nodeType: string,
  data: Record<string, unknown>,
  resolve: (value: unknown) => string | undefined,
): Promise<Record<string, unknown>> {
  const spec = NODE_SPECS.get(nodeType);
  if (!spec) throw new Error(`Not a Zoho Projects node type: ${nodeType}`);

  const mspIdRaw = Number(resolve(data.mspId) ?? data.mspId);
  const mspId = Number.isFinite(mspIdRaw) && mspIdRaw > 0 ? mspIdRaw : undefined;

  if (spec.mode === "read") {
    switch (nodeType) {
      case "zoho_list_projects": {
        const result = await listProjects({ mspId });
        return { records: result.records, count: result.records.length, entity: "Project" };
      }
      case "zoho_get_project": {
        const projectId = resolve(data.zohoProjectId);
        if (!projectId) return { error: "zoho_get_project requires zohoProjectId", found: false };
        const record = await getProject(projectId, mspId);
        return { found: Boolean(record), record: record ?? null, entity: "Project" };
      }
      case "zoho_get_tasklist": {
        const projectId = resolve(data.zohoProjectId);
        const tasklistId = resolve(data.zohoTasklistId);
        if (!projectId || !tasklistId) return { error: "zoho_get_tasklist requires zohoProjectId and zohoTasklistId", found: false };
        const record = await getTasklist(projectId, tasklistId, mspId);
        return { found: Boolean(record), record: record ?? null, entity: "Tasklist" };
      }
      case "zoho_list_tasks": {
        const projectId = resolve(data.zohoProjectId);
        if (!projectId) return { error: "zoho_list_tasks requires zohoProjectId", records: [], count: 0 };
        const tasklistId = resolve(data.zohoTasklistId);
        const result = await listTasks(projectId, { tasklistId, mspId });
        return { records: result.records, count: result.records.length, entity: "Task" };
      }
      case "zoho_get_task": {
        const projectId = resolve(data.zohoProjectId);
        const taskId = resolve(data.zohoTaskId);
        if (!projectId || !taskId) return { error: "zoho_get_task requires zohoProjectId and zohoTaskId", found: false };
        const record = await getTask(projectId, taskId, mspId);
        return { found: Boolean(record), record: record ?? null, entity: "Task" };
      }
      case "zoho_list_milestones": {
        const projectId = resolve(data.zohoProjectId);
        if (!projectId) return { error: "zoho_list_milestones requires zohoProjectId", records: [], count: 0 };
        const result = await listMilestones(projectId, { mspId });
        return { records: result.records, count: result.records.length, entity: "Milestone" };
      }
      case "zoho_get_milestone": {
        const projectId = resolve(data.zohoProjectId);
        const milestoneId = resolve(data.zohoMilestoneId);
        if (!projectId || !milestoneId) return { error: "zoho_get_milestone requires zohoProjectId and zohoMilestoneId", found: false };
        const record = await getMilestone(projectId, milestoneId, mspId);
        return { found: Boolean(record), record: record ?? null, entity: "Milestone" };
      }
      default:
        throw new Error(`Unhandled Zoho Projects read node: ${nodeType}`);
    }
  }

  // Write: resolve placeholders in the node's own data, then queue it. The
  // whole resolved data object becomes the job payload so the handler sees
  // exactly what the node was configured with.
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      payload[key] = resolve(value) ?? value;
    } else {
      payload[key] = value;
    }
  }

  const queued = await enqueueZohoProjectsWrite(nodeType, payload, { mspId });
  return { ...queued, entity: spec.entity, note: "queued — applied by the next Zoho Queue Drain (runs every 5 minutes)" };
}

// Register on import so the drain has handlers regardless of which entry
// point pulls this module in first — same discipline zoho-crm.ts uses.
registerZohoProjectsJobHandlers();
