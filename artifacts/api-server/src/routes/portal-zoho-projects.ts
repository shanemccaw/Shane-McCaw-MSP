/**
 * portal-zoho-projects.ts (#85)
 *
 * msp-portal's Zoho Projects board — admin and customer views, live-fed from
 * Zoho (never local storage of tasks/tasklists/milestones themselves).
 *
 * Deliberately separate from portal-delivery-kanban.ts / kanban_tasks, which
 * this phase does not touch, reference, or add sync columns to. The only
 * schema footprint here is `projects.zohoProjectId` — a nullable link from an
 * existing local project row to the Zoho Project that feeds this board.
 *
 * Auth/ownership pattern is copied from portal-delivery-kanban.ts's
 * assertProjectAccess/isAdmin (not imported — that file exports a router
 * only): a customer may only reach a project they own via
 * projects.clientUserId; admin/MSP staff reach every project.
 *
 * Read/write split matches Zoho CRM (#83) and Zoho Projects' own node layer
 * (zoho-projects.ts): GETs call Zoho inline and return live records; writes
 * (POST/PATCH) enqueue via msp_job_queue and answer 202 with a jobId — never
 * a synchronous 200/201 with a record, because the record does not exist (or
 * is not yet updated) in Zoho when the response is written. The one
 * exception is linking/unlinking a local project to a Zoho project id
 * (PATCH /zoho-project), which is a local-only column set, not a Zoho call.
 */

import { Router, type Request, type Response } from "express";
import { db, projectsTable, mspJobQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth.ts";
import {
  listProjects,
  getProject,
  getTasklist,
  listTasks,
  getTask,
  listMilestones,
  getMilestone,
} from "../lib/zoho-projects-read.ts";
import { enqueueZohoProjectsWrite, sanitizeFields } from "../lib/zoho-projects.ts";
import { ZohoNotConnectedError, ZohoApiError, ZOHO_DEFAULT_MSP_ID } from "../lib/zoho-client.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "integration.zoho" });

const router = Router();

interface AccessibleProject {
  id: number;
  title: string;
  clientUserId: number | null;
  zohoProjectId: string | null;
}

async function assertProjectAccess(req: Request, projectId: number): Promise<{ project: AccessibleProject } | null> {
  const [project] = await db
    .select({ id: projectsTable.id, title: projectsTable.title, clientUserId: projectsTable.clientUserId, zohoProjectId: projectsTable.zohoProjectId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return null;
  if (req.user?.role === "client" && project.clientUserId !== req.user.id) return null;

  return { project };
}

function parseProjectId(req: Request, res: Response): number | null {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return null; }
  return id;
}

/** Maps Zoho/connection failures onto honest HTTP status codes, same as zoho-crm.ts routes. */
function handleZohoError(err: unknown, res: Response, context: string): void {
  if (err instanceof ZohoNotConnectedError) {
    log.warn({ context }, "portal-zoho-projects: Zoho not connected");
    res.status(503).json({ error: err.message, code: "zoho_not_connected" });
    return;
  }
  if (err instanceof ZohoApiError) {
    log.warn({ context, status: err.status }, "portal-zoho-projects: Zoho API error");
    res.status(err.status >= 400 && err.status < 500 ? err.status : 502).json({
      error: `Zoho API error (${err.status})`,
      code: "zoho_api_error",
      details: err.body,
    });
    return;
  }
  log.error({ err, context }, "portal-zoho-projects: unexpected failure");
  res.status(500).json({ error: "Unexpected failure talking to Zoho" });
}

async function queueWrite(res: Response, nodeType: string, payload: Record<string, unknown>, action: string): Promise<void> {
  try {
    const queued = await enqueueZohoProjectsWrite(nodeType, payload, { mspId: ZOHO_DEFAULT_MSP_ID });
    res.status(202).json({
      ...queued,
      action,
      status: "queued",
      message: "Queued — the Zoho Queue Drain applies this within 5 minutes.",
    });
  } catch (err) {
    log.error({ err, nodeType }, "portal-zoho-projects: failed to queue write");
    res.status(500).json({ error: "Failed to queue the Zoho write" });
  }
}

// ── Project link ──────────────────────────────────────────────────────────

router.get("/portal/projects/:id/zoho-project", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }

  const { zohoProjectId } = access.project;
  if (!zohoProjectId) { res.json({ linked: false, zohoProjectId: null, record: null }); return; }

  try {
    const record = await getProject(zohoProjectId);
    res.json({ linked: true, zohoProjectId, record: record ?? null });
  } catch (err) {
    handleZohoError(err, res, "get linked zoho project");
  }
});

/** Admin-only link picker source — browse the portal's Zoho Projects. */
router.get("/portal/projects/:id/zoho-project/browse", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }

  const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
  const perPage = req.query.perPage ? parseInt(String(req.query.perPage), 10) : undefined;

  try {
    const result = await listProjects({ page, perPage });
    res.json({ entity: "Project", ...result, more: result.records.length >= result.perPage });
  } catch (err) {
    handleZohoError(err, res, "browse zoho projects");
  }
});

/** Local-only: set or clear which Zoho Project this local project is linked to. Not a Zoho call. */
router.patch("/portal/projects/:id/zoho-project", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }

  const zohoProjectId = req.body?.zohoProjectId === null ? null : String(req.body?.zohoProjectId ?? "").trim() || null;

  await db.update(projectsTable).set({ zohoProjectId, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  log.info({ projectId, zohoProjectId }, "portal-zoho-projects: link updated");
  res.json({ linked: zohoProjectId !== null, zohoProjectId });
});

/** Creates a brand-new Zoho Project (queued). Link it via PATCH once the job's result carries the new zohoId. */
router.post("/portal/projects/:id/zoho-project", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(res, "zoho_create_project", { fields }, "create Project");
});

/** Updates the linked Zoho Project's own fields (queued). */
router.patch("/portal/projects/:id/zoho-project/details", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(res, "zoho_update_project", { zohoProjectId: access.project.zohoProjectId, fields }, "update Project");
});

// ── Tasklists ────────────────────────────────────────────────────────────────

router.get("/portal/projects/:id/zoho-tasklists/:tasklistId", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  try {
    const record = await getTasklist(access.project.zohoProjectId, String(req.params.tasklistId));
    if (!record) { res.status(404).json({ error: "Tasklist not found in Zoho" }); return; }
    res.json({ entity: "Tasklist", record });
  } catch (err) {
    handleZohoError(err, res, "get zoho tasklist");
  }
});

router.post("/portal/projects/:id/zoho-tasklists", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(res, "zoho_create_tasklist", { zohoProjectId: access.project.zohoProjectId, fields }, "create Tasklist");
});

// ── Tasks ────────────────────────────────────────────────────────────────────

router.get("/portal/projects/:id/zoho-tasks", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }
  if (!access.project.zohoProjectId) { res.json({ entity: "Task", records: [], page: 1, perPage: 50, more: false, linked: false }); return; }

  const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
  const perPage = req.query.perPage ? parseInt(String(req.query.perPage), 10) : undefined;
  const tasklistId = req.query.tasklistId ? String(req.query.tasklistId) : undefined;

  try {
    const result = await listTasks(access.project.zohoProjectId, { page, perPage, tasklistId });
    res.json({ entity: "Task", ...result, more: result.records.length >= result.perPage, linked: true });
  } catch (err) {
    handleZohoError(err, res, "list zoho tasks");
  }
});

router.get("/portal/projects/:id/zoho-tasks/:taskId", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  try {
    const record = await getTask(access.project.zohoProjectId, String(req.params.taskId));
    if (!record) { res.status(404).json({ error: "Task not found in Zoho" }); return; }
    res.json({ entity: "Task", record });
  } catch (err) {
    handleZohoError(err, res, "get zoho task");
  }
});

router.post("/portal/projects/:id/zoho-tasks", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }
  if (typeof req.body?.tasklistId === "string" && req.body.tasklistId.trim()) {
    fields.tasklist_id = req.body.tasklistId.trim();
  }

  await queueWrite(res, "zoho_create_task", { zohoProjectId: access.project.zohoProjectId, fields }, "create Task");
});

/**
 * Admin-only. Customer view surfaces tasks read-only — same "managed by your
 * project team" convention project-kanban.tsx already uses for its board.
 */
router.patch("/portal/projects/:id/zoho-tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(
    res,
    "zoho_update_task",
    { zohoProjectId: access.project.zohoProjectId, zohoTaskId: String(req.params.taskId), fields },
    "update Task",
  );
});

// ── Milestones ───────────────────────────────────────────────────────────────

router.get("/portal/projects/:id/zoho-milestones", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }
  if (!access.project.zohoProjectId) { res.json({ entity: "Milestone", records: [], page: 1, perPage: 50, more: false, linked: false }); return; }

  const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
  const perPage = req.query.perPage ? parseInt(String(req.query.perPage), 10) : undefined;

  try {
    const result = await listMilestones(access.project.zohoProjectId, { page, perPage });
    res.json({ entity: "Milestone", ...result, more: result.records.length >= result.perPage, linked: true });
  } catch (err) {
    handleZohoError(err, res, "list zoho milestones");
  }
});

router.get("/portal/projects/:id/zoho-milestones/:milestoneId", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  try {
    const record = await getMilestone(access.project.zohoProjectId, String(req.params.milestoneId));
    if (!record) { res.status(404).json({ error: "Milestone not found in Zoho" }); return; }
    res.json({ entity: "Milestone", record });
  } catch (err) {
    handleZohoError(err, res, "get zoho milestone");
  }
});

router.post("/portal/projects/:id/zoho-milestones", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(res, "zoho_create_milestone", { zohoProjectId: access.project.zohoProjectId, fields }, "create Milestone");
});

router.patch("/portal/projects/:id/zoho-milestones/:milestoneId", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseProjectId(req, res);
  if (projectId === null) return;
  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.project.zohoProjectId) { res.status(400).json({ error: "This project is not linked to a Zoho Project yet" }); return; }

  const fields = sanitizeFields(req.body?.fields ?? req.body);
  if (Object.keys(fields).length === 0) { res.status(400).json({ error: "No writable fields supplied" }); return; }

  await queueWrite(
    res,
    "zoho_update_milestone",
    { zohoProjectId: access.project.zohoProjectId, zohoMilestoneId: String(req.params.milestoneId), fields },
    "update Milestone",
  );
});

// ── Job status ───────────────────────────────────────────────────────────────

/** Lets the board turn "queued" into "synced"/"failed" — reports the real msp_job_queue row the drain updates. */
router.get("/portal/zoho-projects/jobs/:jobId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const [job] = await db
      .select({
        jobId: mspJobQueueTable.jobId,
        jobType: mspJobQueueTable.jobType,
        status: mspJobQueueTable.status,
        attemptCount: mspJobQueueTable.attemptCount,
        maxAttempts: mspJobQueueTable.maxAttempts,
        errorMessage: mspJobQueueTable.errorMessage,
        result: mspJobQueueTable.result,
        scheduledAt: mspJobQueueTable.scheduledAt,
        completedAt: mspJobQueueTable.completedAt,
      })
      .from(mspJobQueueTable)
      .where(eq(mspJobQueueTable.jobId, String(req.params.jobId)))
      .limit(1);

    if (!job) { res.status(404).json({ error: "No such queued write" }); return; }
    res.json(job);
  } catch (err) {
    log.error({ err }, "portal-zoho-projects: job status lookup failed");
    res.status(500).json({ error: "Failed to read job status" });
  }
});

export default router;
