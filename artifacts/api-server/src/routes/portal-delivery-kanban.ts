/**
 * portal-delivery-kanban.ts
 *
 * Project Delivery Kanban — admin and customer views, SSE-synced.
 *
 * Columns: backlog → in_progress → waiting_on_customer → review → completed (Done)
 *
 * Field visibility:
 *   - publicNotes  : visible to both admin and customer
 *   - internalNotes: visible to admin ONLY — stripped from all customer responses
 *
 * Admin-only actions per task:
 *   - Run Workflow  : fires a published Workflow Definition (linkedWorkflowId in taskMetadata)
 *   - Run Monitoring: fires executeMonitoringPackage on-demand (monitoringPackageKey in taskMetadata)
 *
 * Undo-on-Done: the PATCH endpoint returns `{ task, prevColumn }` so the UI
 * can show a timed undo banner and re-PATCH back if the user clicks Undo.
 */

import { Router, type Request, type Response } from "express";
import {
  db,
  kanbanTasksTable,
  projectsTable,
  usersTable,
  clientAppRegistrationsTable,
  wfDefinitionsTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth.ts";
import { broadcastKanbanChange } from "../lib/sse-broadcast.ts";
import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";
import { executeMonitoringPackage } from "../lib/monitor-executor.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "engine.kanban" });

const router = Router();

type DeliveryColumn = "backlog" | "in_progress" | "waiting_on_customer" | "review" | "completed";

const VALID_COLUMNS: DeliveryColumn[] = [
  "backlog",
  "in_progress",
  "waiting_on_customer",
  "review",
  "completed",
];

function isAdmin(req: Request): boolean {
  return req.user?.role === "admin" || (req.user?.mspRole !== "CustomerUser" && req.user?.mspRole !== undefined && req.user?.role !== "client");
}

function stripInternalNotes<T extends { internalNotes?: string | null }>(task: T): Omit<T, "internalNotes"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { internalNotes: _i, ...rest } = task;
  return rest;
}

async function assertProjectAccess(req: Request, projectId: number): Promise<{ project: { clientUserId: number | null } } | null> {
  const [project] = await db
    .select({ clientUserId: projectsTable.clientUserId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return null;

  if (req.user?.role === "client") {
    if (project.clientUserId !== req.user.id) return null;
  }

  return { project };
}

// ─── GET /portal/projects/:id/delivery-kanban-tasks ──────────────────────────
// Returns all tasks for a project, ordered by column position.
// Customers: internalNotes stripped.
router.get("/portal/projects/:id/delivery-kanban-tasks", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const access = await assertProjectAccess(req, projectId);
  if (!access) { res.status(404).json({ error: "Project not found or access denied" }); return; }

  const tasks = await db
    .select()
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId))
    .orderBy(asc(kanbanTasksTable.order));

  const adminView = isAdmin(req);
  res.json(adminView ? tasks : tasks.map(stripInternalNotes));
});

// ─── POST /portal/delivery-kanban-tasks ──────────────────────────────────────
// Admin-only: create a new delivery task.
router.post("/portal/delivery-kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const {
    projectId, title, description, column, order, priority,
    publicNotes, internalNotes, taskMetadata, dueDate, assignedTo,
  } = req.body as {
    projectId?: number; title?: string; description?: string; column?: string;
    order?: number; priority?: string; publicNotes?: string; internalNotes?: string;
    taskMetadata?: Record<string, unknown>; dueDate?: string; assignedTo?: string;
  };

  if (!projectId || !title) { res.status(400).json({ error: "projectId and title are required" }); return; }

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const validCol = VALID_COLUMNS.includes(column as DeliveryColumn) ? (column as DeliveryColumn) : "backlog";

  const maxOrderRow = await db
    .select({ order: kanbanTasksTable.order })
    .from(kanbanTasksTable)
    .where(and(eq(kanbanTasksTable.projectId, projectId), eq(kanbanTasksTable.column, validCol)))
    .orderBy(desc(kanbanTasksTable.order))
    .limit(1);
  const nextOrder = order ?? ((maxOrderRow[0]?.order ?? -1) + 1);

  const [task] = await db.insert(kanbanTasksTable).values({
    projectId,
    title,
    description: description ?? null,
    column: validCol,
    order: nextOrder,
    priority: priority ?? "medium",
    publicNotes: publicNotes ?? null,
    internalNotes: internalNotes ?? null,
    taskMetadata: taskMetadata ?? null,
    dueDate: dueDate ? new Date(dueDate) : null,
    assignedTo: assignedTo ?? null,
  }).returning();

  broadcastKanbanChange(projectId, { action: "created", task });
  res.status(201).json(task);
});

// ─── PATCH /portal/delivery-kanban-tasks/:id ─────────────────────────────────
// Admin: full update (all fields including internalNotes, column moves).
// Customer: may only move their own task to/from waiting_on_customer.
// Returns { task, prevColumn } for undo-on-done support.
router.patch("/portal/delivery-kanban-tasks/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const [existing] = await db
    .select()
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  const access = await assertProjectAccess(req, existing.projectId);
  if (!access) { res.status(403).json({ error: "Access denied" }); return; }

  const adminView = isAdmin(req);
  const prevColumn = existing.column;

  const {
    column, title, description, order, priority, publicNotes, internalNotes,
    taskMetadata, dueDate, assignedTo, waitingReason, completionNotes,
  } = req.body as {
    column?: string; title?: string; description?: string; order?: number;
    priority?: string; publicNotes?: string; internalNotes?: string;
    taskMetadata?: Record<string, unknown>; dueDate?: string; assignedTo?: string;
    waitingReason?: string; completionNotes?: string;
  };

  if (!adminView) {
    const allowed = column === "waiting_on_customer" || (prevColumn === "waiting_on_customer" && column === "in_progress");
    if (column !== undefined && !allowed) {
      res.status(403).json({ error: "Customers may only respond to Waiting for You tasks" }); return;
    }
    if (internalNotes !== undefined) {
      res.status(403).json({ error: "Customers cannot set internal notes" }); return;
    }
    if (title !== undefined || description !== undefined || priority !== undefined || assignedTo !== undefined) {
      res.status(403).json({ error: "Customers cannot edit task details" }); return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (column !== undefined && VALID_COLUMNS.includes(column as DeliveryColumn)) {
    updates.column = column;
  }
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (order !== undefined) updates.order = order;
  if (priority !== undefined) updates.priority = priority;
  if (publicNotes !== undefined) updates.publicNotes = publicNotes;
  if (internalNotes !== undefined && adminView) updates.internalNotes = internalNotes;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (waitingReason !== undefined) updates.waitingReason = waitingReason;
  if (completionNotes !== undefined) updates.completionNotes = completionNotes;
  if (taskMetadata !== undefined && adminView) {
    const existing_meta = (existing.taskMetadata as Record<string, unknown>) ?? {};
    updates.taskMetadata = { ...existing_meta, ...taskMetadata };
  }

  const [updated] = await db
    .update(kanbanTasksTable)
    .set(updates as Parameters<typeof db.update>[0] extends { set: (v: infer V) => unknown } ? V : Record<string, unknown>)
    .where(eq(kanbanTasksTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  const broadcastTask = adminView ? updated : stripInternalNotes(updated);
  broadcastKanbanChange(updated.projectId, { action: "updated", task: broadcastTask });

  res.json({ task: adminView ? updated : stripInternalNotes(updated), prevColumn });
});

// ─── DELETE /portal/delivery-kanban-tasks/:id ────────────────────────────────
// Admin-only: remove a task.
router.delete("/portal/delivery-kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const [existing] = await db
    .select({ id: kanbanTasksTable.id, projectId: kanbanTasksTable.projectId })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  broadcastKanbanChange(existing.projectId, { action: "deleted", task: { id: existing.id } });
  res.status(204).end();
});

// ─── POST /portal/delivery-kanban-tasks/:id/run-workflow ─────────────────────
// Admin-only: fire the Workflow Definition linked via taskMetadata.linkedWorkflowId.
router.post("/portal/delivery-kanban-tasks/:id/run-workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const [task] = await db
    .select()
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, id))
    .limit(1);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const meta = (task.taskMetadata as Record<string, unknown>) ?? {};
  const workflowDefId = typeof meta.linkedWorkflowId === "number" ? meta.linkedWorkflowId : null;
  if (!workflowDefId) {
    res.status(400).json({ error: "No Workflow Definition linked to this task (set taskMetadata.linkedWorkflowId)" });
    return;
  }

  const [def] = await db
    .select({ id: wfDefinitionsTable.id, name: wfDefinitionsTable.name })
    .from(wfDefinitionsTable)
    .where(eq(wfDefinitionsTable.id, workflowDefId))
    .limit(1);
  if (!def) { res.status(404).json({ error: "Workflow Definition not found" }); return; }

  const [project] = await db
    .select({ clientUserId: projectsTable.clientUserId })
    .from(projectsTable)
    .where(eq(projectsTable.id, task.projectId))
    .limit(1);

  const payload: Record<string, unknown> = {
    taskId: task.id,
    projectId: task.projectId,
    taskTitle: task.title,
    clientUserId: project?.clientUserId ?? null,
    triggeredBy: "admin_kanban_action",
  };

  const runId = await fireWorkflowForDefinition(workflowDefId, "manual", `delivery-kanban-task:${id}`, payload);
  if (!runId) {
    res.status(503).json({ error: "Workflow could not be started (no published version or concurrency limit reached)" });
    return;
  }

  log.info({ taskId: id, workflowDefId, runId }, "delivery-kanban: admin fired run-workflow");
  res.json({ ok: true, runId, workflowName: def.name });
});

// ─── POST /portal/delivery-kanban-tasks/:id/run-monitoring ───────────────────
// Admin-only: fire a monitoring package on-demand for the client on this task.
// Requires taskMetadata.monitoringPackageKey + the client's M365 tenant ID.
router.post("/portal/delivery-kanban-tasks/:id/run-monitoring", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const [task] = await db
    .select()
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.id, id))
    .limit(1);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const meta = (task.taskMetadata as Record<string, unknown>) ?? {};
  const packageKey = typeof meta.monitoringPackageKey === "string" ? meta.monitoringPackageKey : null;
  if (!packageKey) {
    res.status(400).json({ error: "No monitoring package key linked to this task (set taskMetadata.monitoringPackageKey)" });
    return;
  }

  const [project] = await db
    .select({ clientUserId: projectsTable.clientUserId })
    .from(projectsTable)
    .where(eq(projectsTable.id, task.projectId))
    .limit(1);
  const clientUserId = project?.clientUserId ?? null;

  let tenantId: string | null = null;
  if (clientUserId) {
    const [appReg] = await db
      .select({ tenantId: clientAppRegistrationsTable.tenantId })
      .from(clientAppRegistrationsTable)
      .where(eq(clientAppRegistrationsTable.clientUserId, clientUserId))
      .limit(1);
    tenantId = appReg?.tenantId ?? null;
  }

  if (!tenantId) {
    res.status(400).json({ error: "Client has no M365 tenant ID on file — cannot run monitoring" });
    return;
  }

  const triggerId = `delivery-kanban:${id}:${Date.now()}`;

  try {
    const result = await executeMonitoringPackage({ packageKey, tenantId, triggerId });
    log.info({ taskId: id, packageKey, tenantId, runStatus: result.runStatus }, "delivery-kanban: admin fired run-monitoring");
    res.json({ ok: true, packageKey, runStatus: result.runStatus, checksRan: result.checks.length });
  } catch (err) {
    log.warn({ err, taskId: id, packageKey }, "delivery-kanban: run-monitoring failed");
    res.status(500).json({ error: "Monitoring package execution failed" });
  }
});

export default router;
