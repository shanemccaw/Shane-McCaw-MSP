import { Router, type IRouter, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import {
  db,
  projectsTable,
  usersTable,
  contractsTable,
  invoicesTable,
  reportsTable,
  documentsTable,
  projectUpdatesTable,
  clientServicesTable,
  workflowStepsTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  kanbanTasksTable,
  statusReportsTable,
  quickWinPresentationsTable,
  clientCallbackTokensTable,
  projectClosuresTable,
  powershellScriptsTable,
  scriptModulesTable,
} from "@workspace/db";
import { eq, and, asc, desc, count, sql, inArray, isNotNull, isNull, gte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { createNotification } from "../lib/notification-center.ts";
import { createAuditLog } from "../lib/audit.ts";
import { createProjectFolder } from "../lib/graph.ts";
import { resolveTemplateTaskMetadata } from "../lib/template-task-metadata";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { advancePhaseIfComplete, syncProjectProgress as syncProjectProgressLib, seedKanbanCardsForPhase } from "../lib/kanban-phase-advance.ts";
import { broadcastKanbanChange, registerSSEClient } from "../lib/sse-channels.ts";
import { sendEmailFromTemplate, getTenantHealthBlockHtml, closureRequestEmail } from "../lib/mailer.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.projects" });

const router: IRouter = Router();

// Helper to set up common SSE response headers and keep-alive
function setupSSE(req: Request, res: Response, projectId: number): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(": connected\n\n");
  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);

  registerSSEClient(projectId, res, () => clearInterval(keepAlive));
}

async function syncProjectProgress(projectId: number): Promise<void> {
  const [result] = await db
    .select({
      total: count(),
      completed: count(sql`case when ${kanbanTasksTable.column} = 'completed' then 1 end`),
    })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId));
  const total = result?.total ?? 0;
  const completed = Number(result?.completed ?? 0);
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);
  await db.update(projectsTable).set({ progress }).where(eq(projectsTable.id, projectId));
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

router.get("/admin/projects/:id/kanban-events", async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const token = String(req.query.token ?? "");
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) { res.status(401).json({ error: "Missing token" }); return; }

  let user: { role: string };
  try { user = jwt.verify(token, secret) as { role: string }; }
  catch { res.status(401).json({ error: "Invalid or expired token" }); return; }
  if (user.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }

  setupSSE(req, res, projectId);
});

router.get("/admin/projects", requireAdmin, async (_req: Request, res: Response) => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

router.get("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(project);
});

router.post("/admin/projects", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, status, phase, progress, clientUserId, startDate, endDate, projectType, workflowTemplateId } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number; startDate?: string; endDate?: string; projectType?: string; workflowTemplateId?: number;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const validStatuses = ["active", "on_hold", "completed"];
  const [project] = await db.insert(projectsTable).values({
    title,
    description: description ?? null,
    status: (validStatuses.includes(status ?? "") ? status : "active") as "active" | "on_hold" | "completed",
    phase: phase ?? null,
    progress: progress ?? 0,
    clientUserId: clientUserId ?? null,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    projectType: (["retainer", "quick_win"].includes(projectType ?? "") ? projectType : "project") as "project" | "retainer" | "quick_win",
  }).returning();

  // ── Provision workflow steps + kanban tasks from template (if selected) ───
  if (workflowTemplateId) {
    try {
      const templateSteps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, workflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));

      if (templateSteps.length > 0) {
        const createdSteps = await db.insert(workflowStepsTable).values(
          templateSteps.map((s, idx) => ({
            projectId: project.id,
            title: s.title,
            description: s.description ?? "",
            status: (idx === 0 ? "in_progress" : "pending") as "in_progress" | "pending",
            order: idx + 1,
            workflowTemplateStepId: s.id,
          }))
        ).returning();

        // Seed kanban tasks for the first step only
        const firstStep = createdSteps[0];
        if (firstStep?.workflowTemplateStepId) {
          const step1Tasks = await db
            .select()
            .from(workflowTemplateStepTasksTable)
            .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, firstStep.workflowTemplateStepId))
            .orderBy(asc(workflowTemplateStepTasksTable.order));

          if (step1Tasks.length > 0) {
            const resolvedMetadata = await resolveTemplateTaskMetadata(step1Tasks);
            await db.insert(kanbanTasksTable).values(
              step1Tasks.map((t, idx) => ({
                projectId: project.id,
                workflowStepId: firstStep.id,
                groupName: t.groupName ?? null,
                title: t.title,
                description: t.description ?? null,
                column: (t.isCustomerTask ? "waiting_on_customer" : "backlog") as "backlog" | "waiting_on_customer",
                order: idx,
                taskType: t.taskType ?? null,
                taskMetadata: resolvedMetadata[idx],
              }))
            );
          }
        }
      }
    } catch (err) {
      req.log.warn({ err, projectId: project.id }, "Workflow template provisioning failed (non-fatal)");
    }
  }

  // ── Auto-create SharePoint folder if client has a site ───────────────────
  if (clientUserId) {
    try {
      const [clientUser] = await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
        .from(usersTable).where(eq(usersTable.id, clientUserId));
      if (clientUser?.sharepointSiteId) {
        const folderUrl = await createProjectFolder(clientUser.sharepointSiteId, title);
        if (folderUrl) {
          await db.update(projectsTable)
            .set({ sharepointFolderUrl: folderUrl })
            .where(eq(projectsTable.id, project.id));
          project.sharepointFolderUrl = folderUrl;
          req.log.info({ projectId: project.id, folderUrl }, "SharePoint project folder created");
        }
      }
    } catch (err) {
      req.log.warn({ err, projectId: project.id }, "SharePoint folder auto-create failed (non-fatal)");
    }
  }

  // Notify client
  if (clientUserId) {
    await createNotification({
      title: `New project started: ${title}`,
      body: description?.slice(0, 100) ?? undefined,
      notifType: "project_update",
      category: "project",
      linkPath: `/portal/projects/${project.id}`,
      recipient: { type: "customer_user", userId: clientUserId },
    });
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "project_created",
    entityType: "project",
    entityId: project.id,
    entityLabel: project.title,
    clientId: clientUserId ?? null,
    projectId: project.id,
  });

  res.status(201).json(project);
});

// ── Manually create SharePoint folder for an existing project ─────────────
router.post("/admin/projects/:id/sharepoint-folder", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.sharepointFolderUrl) {
    res.status(409).json({ error: "SharePoint folder already exists", sharepointFolderUrl: project.sharepointFolderUrl });
    return;
  }
  if (!project.clientUserId) {
    res.status(400).json({ error: "Project has no assigned client" }); return;
  }

  const [clientUser] = await db.select({ sharepointSiteId: usersTable.sharepointSiteId })
    .from(usersTable).where(eq(usersTable.id, project.clientUserId));
  if (!clientUser?.sharepointSiteId) {
    res.status(400).json({ error: "Client has no SharePoint site configured" }); return;
  }

  const folderUrl = await createProjectFolder(clientUser.sharepointSiteId, project.title);
  if (!folderUrl) {
    res.status(502).json({ error: "Failed to create SharePoint folder. Check Graph API credentials." });
    return;
  }

  await db.update(projectsTable)
    .set({ sharepointFolderUrl: folderUrl })
    .where(eq(projectsTable.id, id));

  req.log.info({ projectId: id, folderUrl }, "SharePoint project folder created manually");
  res.json({ sharepointFolderUrl: folderUrl });
});

router.patch("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, description, status, phase, progress, clientUserId, startDate, endDate, projectType } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number | null; startDate?: string; endDate?: string; projectType?: string;
  };

  const updates: Partial<typeof projectsTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status as "active" | "on_hold" | "completed";
  if (phase !== undefined) updates.phase = phase;
  if (progress !== undefined) updates.progress = progress;
  if (clientUserId !== undefined) updates.clientUserId = clientUserId;
  if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
  if (projectType !== undefined) updates.projectType = (["retainer", "quick_win"].includes(projectType) ? projectType : "project") as "project" | "retainer" | "quick_win";

  const [updated] = await db.update(projectsTable).set(updates).where(eq(projectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }

  // Auto-revoke all active callback tokens when a project is marked completed
  if (status === "completed") {
    try {
      await db
        .update(clientCallbackTokensTable)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(clientCallbackTokensTable.projectId, id),
            isNull(clientCallbackTokensTable.revokedAt),
          )
        );
    } catch (revokeErr) {
      log.warn({ revokeErr, projectId: id }, "portal: failed to auto-revoke callback tokens on project completion (non-fatal)");
    }
  }

  res.json(updated);
});

router.delete("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, id)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, id));
    await db.delete(workflowStepsTable).where(eq(workflowStepsTable.projectId, id));
    await db.delete(documentsTable).where(eq(documentsTable.projectId, id));
    await db.delete(projectUpdatesTable).where(eq(projectUpdatesTable.projectId, id));

    await db.update(clientServicesTable).set({ projectId: null }).where(eq(clientServicesTable.projectId, id));
    await db.update(contractsTable).set({ projectId: null }).where(eq(contractsTable.projectId, id));
    await db.update(invoicesTable).set({ projectId: null }).where(eq(invoicesTable.projectId, id));
    await db.update(reportsTable).set({ projectId: null }).where(eq(reportsTable.projectId, id));

    await db.delete(projectsTable).where(eq(projectsTable.id, id));

    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete project" });
  }
});

router.get("/admin/workflow-steps", requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
  const clientServiceId = req.query.clientServiceId ? parseInt(String(req.query.clientServiceId), 10) : null;
  let q = db.select().from(workflowStepsTable).$dynamic();
  if (projectId && !isNaN(projectId)) q = q.where(eq(workflowStepsTable.projectId, projectId));
  else if (clientServiceId && !isNaN(clientServiceId)) q = q.where(eq(workflowStepsTable.clientServiceId, clientServiceId));
  const steps = await q.orderBy(asc(workflowStepsTable.order));
  res.json(steps);
});

router.delete("/admin/workflow-steps/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(workflowStepsTable).where(eq(workflowStepsTable.id, id));
  res.json({ deleted: id });
});

router.post("/admin/workflow-steps/bulk", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, steps } = req.body as {
    projectId?: number;
    steps?: Array<{ title?: string; description?: string; status?: string; dueDate?: string | null; notes?: string }>;
  };
  if (!projectId || isNaN(projectId)) { res.status(400).json({ error: "projectId is required" }); return; }
  if (!Array.isArray(steps) || steps.length === 0) { res.status(400).json({ error: "steps must be a non-empty array" }); return; }

  const invalid = steps.findIndex(s => !s.title?.trim());
  if (invalid !== -1) { res.status(400).json({ error: `Step at index ${invalid} is missing a title` }); return; }

  const existing = await db.select({ order: workflowStepsTable.order })
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, projectId))
    .orderBy(desc(workflowStepsTable.order))
    .limit(1);
  const maxOrder = existing[0]?.order ?? -1;

  const validStatuses = ["pending", "in_progress", "completed", "blocked"];
  const rows = steps.map((s, i) => ({
    projectId,
    title: s.title!.trim(),
    description: s.description?.trim() ?? null,
    status: (validStatuses.includes(s.status ?? "") ? s.status : "pending") as "pending" | "in_progress" | "completed" | "blocked",
    order: maxOrder + 1 + i,
    dueDate: s.dueDate ? new Date(s.dueDate) : null,
    notes: s.notes?.trim() ?? null,
  }));

  const created = await db.insert(workflowStepsTable).values(rows).returning();
  res.status(201).json(created);
});

router.post("/admin/workflow-steps", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, clientServiceId, title, description, order, status, dueDate } = req.body as {
    projectId?: number; clientServiceId?: number; title?: string; description?: string; order?: number; status?: string; dueDate?: string | null;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const [step] = await db.insert(workflowStepsTable).values({
    projectId: projectId ?? null,
    clientServiceId: clientServiceId ?? null,
    title,
    description: description ?? null,
    order: order ?? 0,
    status: (status as "pending" | "in_progress" | "completed" | "blocked") ?? "pending",
    dueDate: dueDate ? new Date(dueDate) : null,
  }).returning();
  res.status(201).json(step);
});

router.patch("/admin/workflow-steps/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, notes, title, description, dueDate } = req.body as { status?: string; notes?: string; title?: string; description?: string; dueDate?: string | null };
  const updates: Partial<typeof workflowStepsTable.$inferInsert> = {};
  if (status !== undefined) {
    updates.status = status as "pending" | "in_progress" | "completed" | "blocked";
    if (status === "completed") updates.completedAt = new Date();
  }
  if (notes !== undefined) updates.notes = notes;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

  const [existing] = await db.select().from(workflowStepsTable).where(eq(workflowStepsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Step not found" }); return; }

  const [updated] = await db.update(workflowStepsTable).set(updates).where(eq(workflowStepsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Step not found" }); return; }

  if (status !== undefined) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "workflow_step_changed",
      entityType: "workflow_step",
      entityId: updated.id,
      entityLabel: updated.title,
      projectId: updated.projectId ?? undefined,
      metadata: { from: existing.status, to: updated.status },
    });
  }

  // Emit phase.delivery_date_changed when dueDate is modified
  if (
    dueDate !== undefined &&
    updated.projectId &&
    String(existing.dueDate ?? "") !== String(updated.dueDate ?? "")
  ) {
    void (async () => {
      try {
        const [proj] = await db
          .select({ clientUserId: projectsTable.clientUserId })
          .from(projectsTable)
          .where(eq(projectsTable.id, updated.projectId!))
          .limit(1);
        const [pres] = await db
          .select({ paymentPlan: quickWinPresentationsTable.paymentPlan })
          .from(quickWinPresentationsTable)
          .where(eq(quickWinPresentationsTable.projectId, updated.projectId!))
          .limit(1);
        void emitWorkflowEvent("phase.delivery_date_changed", {
          phaseId: updated.id,
          projectId: updated.projectId,
          clientUserId: proj?.clientUserId ?? null,
          paymentPlan: pres?.paymentPlan ?? null,
          oldDueDate: existing.dueDate ? existing.dueDate.toISOString() : null,
          newDueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        });
      } catch (e) {
        req.log.warn({ err: e, stepId: updated.id }, "workflow-steps: failed to emit phase.delivery_date_changed (non-fatal)");
      }
    })();
  }

  // Emit phase_completed event when a step is marked complete
  if (status === "completed" && updated.projectId) {
    void (async () => {
      try {
        // Look up paymentPlan from the linked presentation for this project
        const [pres] = await db
          .select({ paymentPlan: quickWinPresentationsTable.paymentPlan })
          .from(quickWinPresentationsTable)
          .where(eq(quickWinPresentationsTable.projectId, updated.projectId!))
          .limit(1);
        const [proj] = await db
          .select({ clientUserId: projectsTable.clientUserId })
          .from(projectsTable)
          .where(eq(projectsTable.id, updated.projectId!))
          .limit(1);
        void emitWorkflowEvent("phase_completed", {
          phaseId: updated.id,
          projectId: updated.projectId,
          clientId: proj?.clientUserId ?? null,
          paymentPlan: pres?.paymentPlan ?? "full",
          stripeInvoiceId: updated.stripeInvoiceId ?? null,
        });
      } catch (e) {
        req.log.warn({ err: e, stepId: updated.id }, "workflow-steps: failed to emit phase_completed event (non-fatal)");
      }
    })();
  }

  // When a phase is moved to in_progress, auto-populate its template tasks into the Kanban backlog
  if (status === "in_progress") {
    await seedKanbanCardsForPhase(updated.id, req.log);
  }

  res.json(updated);
});

router.get("/admin/kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
  if (!projectId || isNaN(projectId)) { res.status(400).json({ error: "projectId query param required" }); return; }
  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId))
    .orderBy(asc(kanbanTasksTable.order));

  const reportIds = tasks.map(t => t.statusReportId).filter((id): id is number => id !== null);
  const reports = reportIds.length > 0
    ? await db.select({
        id: statusReportsTable.id,
        clientQuestion: statusReportsTable.clientQuestion,
        adminReply: statusReportsTable.adminReply,
        replyThread: statusReportsTable.replyThread,
      }).from(statusReportsTable).where(inArray(statusReportsTable.id, reportIds))
    : [];
  const reportMap = new Map(reports.map(r => [r.id, r]));

  // ── Enrich task_metadata.linkedRunbook from template task runbookId ───────────
  // Chain: kanban_task.workflow_step_id → workflow_steps.workflow_template_step_id
  //        → workflow_template_step_tasks.runbook_id → powershell_scripts | script_modules
  // runbook_id is always a UUID (FK to powershell_scripts.id).
  // Lookup order: powershell_scripts first, then script_modules (for any legacy module UUIDs).
  const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function wordJaccard(a: string, b: string): number {
    const aw = new Set((a.toLowerCase().match(/\w+/g) ?? []));
    const bw = new Set((b.toLowerCase().match(/\w+/g) ?? []));
    const inter = [...aw].filter(w => bw.has(w)).length;
    const union = new Set([...aw, ...bw]).size;
    return union === 0 ? 0 : inter / union;
  }

  const stepIds = [...new Set(tasks.map(t => t.workflowStepId).filter((id): id is number => id !== null))];
  if (stepIds.length > 0) {
    const wSteps = await db
      .select({ id: workflowStepsTable.id, templateStepId: workflowStepsTable.workflowTemplateStepId })
      .from(workflowStepsTable)
      .where(inArray(workflowStepsTable.id, stepIds));

    const templateStepIds = [...new Set(wSteps.map(s => s.templateStepId).filter((id): id is number => id !== null))];
    const stepToTemplateStep = new Map(wSteps.map(s => [s.id, s.templateStepId]));

    if (templateStepIds.length > 0) {
      const templateTasks = await db
        .select({
          title: workflowTemplateStepTasksTable.title,
          workflowTemplateStepId: workflowTemplateStepTasksTable.workflowTemplateStepId,
          runbookId: workflowTemplateStepTasksTable.runbookId,
        })
        .from(workflowTemplateStepTasksTable)
        .where(and(
          inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, templateStepIds),
          isNotNull(workflowTemplateStepTasksTable.runbookId),
        ));

      if (templateTasks.length > 0) {
        // All runbook_id values are UUIDs (FK to powershell_scripts.id).
        // Ignore any non-UUID values left from before the migration.
        const allUuidIds = [...new Set(
          templateTasks.map(t => t.runbookId).filter((id): id is string => !!id && UUID_RE_LOCAL.test(id))
        )];

        const [scriptRows, moduleRows] = await Promise.all([
          allUuidIds.length > 0
            ? db.select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
                .from(powershellScriptsTable).where(inArray(powershellScriptsTable.id, allUuidIds))
            : Promise.resolve([]),
          allUuidIds.length > 0
            ? db.select({ id: scriptModulesTable.id, description: scriptModulesTable.description, filename: scriptModulesTable.filename })
                .from(scriptModulesTable).where(inArray(scriptModulesTable.id, allUuidIds))
            : Promise.resolve([]),
        ]);

        const scriptMap = new Map(scriptRows.map(s => [s.id, s]));
        const moduleMap = new Map(moduleRows.map(m => [m.id, m]));

        function resolveRunbook(runbookId: string): { scriptId: string; scriptTitle: string } | null {
          // Primary: powershell_scripts UUID
          const script = scriptMap.get(runbookId);
          if (script) {
            return { scriptId: script.id, scriptTitle: script.title };
          }
          // Fallback: script_modules UUID (legacy module-linked tasks)
          const mod = moduleMap.get(runbookId);
          if (mod) {
            return { scriptId: mod.id, scriptTitle: mod.description ?? mod.filename.replace(/\.ps1$/i, "") };
          }
          return null;
        }

        // Group template tasks by their step for efficient lookup
        const ttByStep = new Map<number, typeof templateTasks>();
        for (const tt of templateTasks) {
          const arr = ttByStep.get(tt.workflowTemplateStepId) ?? [];
          arr.push(tt);
          ttByStep.set(tt.workflowTemplateStepId, arr);
        }

        for (const task of tasks) {
          // Skip if already has a stored linkedRunbook
          const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
          if (meta.linkedRunbook) continue;
          if (!task.workflowStepId) continue;
          const tStepId = stepToTemplateStep.get(task.workflowStepId);
          if (!tStepId) continue;
          const candidates = ttByStep.get(tStepId) ?? [];
          if (candidates.length === 0) continue;

          // Best-match template task by title similarity
          let best: typeof candidates[0] | null = null;
          let bestSim = 0;
          for (const tt of candidates) {
            const sim = wordJaccard(task.title, tt.title);
            if (sim > bestSim) { bestSim = sim; best = tt; }
          }
          if (!best || !best.runbookId || bestSim < 0.30) continue;

          const resolved = resolveRunbook(best.runbookId);
          if (resolved) {
            task.taskMetadata = { ...meta, linkedRunbook: resolved };
          }
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  res.json(tasks.map(t => ({
    ...t,
    statusReportQuestion: t.statusReportId ? (reportMap.get(t.statusReportId)?.clientQuestion ?? null) : null,
    statusReportAdminReply: t.statusReportId ? (reportMap.get(t.statusReportId)?.adminReply ?? null) : null,
    statusReportReplyThread: t.statusReportId ? (reportMap.get(t.statusReportId)?.replyThread ?? []) : [],
  })));
});

router.post("/admin/kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, title, description, column, order, assignedTo, dueDate, priority, taskType, taskMetadata } = req.body as {
    projectId?: number; title?: string; description?: string; column?: string; order?: number; assignedTo?: string; dueDate?: string; priority?: string;
    taskType?: string; taskMetadata?: Record<string, unknown>;
  };
  if (!projectId || !title) { res.status(400).json({ error: "projectId and title are required" }); return; }

  const [task] = await db.insert(kanbanTasksTable).values({
    projectId,
    title,
    description: description ?? null,
    column: (column as "backlog" | "in_progress" | "waiting_on_customer" | "completed") ?? "backlog",
    order: order ?? 0,
    assignedTo: assignedTo ?? null,
    dueDate: dueDate ? new Date(dueDate) : null,
    priority: priority ?? "medium",
    taskType: taskType ?? null,
    taskMetadata: taskMetadata ?? null,
  }).returning();
  await syncProjectProgress(projectId);

  const [createdTaskProject] = await db.select({ clientUserId: projectsTable.clientUserId })
    .from(projectsTable).where(eq(projectsTable.id, projectId));

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "kanban_task_created",
    entityType: "kanban_task",
    entityId: task.id,
    entityLabel: task.title,
    projectId: task.projectId,
    clientId: createdTaskProject?.clientUserId ?? undefined,
  });

  broadcastKanbanChange(task.projectId, { action: "created", task });
  res.status(201).json(task);
});

router.patch("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { column, title, description, order, assignedTo, dueDate, waitingReason, completionStatus, completionNotes, priority, taskType, taskMetadata } = req.body as {
    column?: string; title?: string; description?: string; order?: number; assignedTo?: string; dueDate?: string;
    waitingReason?: string | null; completionStatus?: string | null; completionNotes?: string | null; priority?: string | null;
    taskType?: string | null; taskMetadata?: Record<string, unknown> | null;
  };

  const [existingTask] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!existingTask) { res.status(404).json({ error: "Task not found" }); return; }

  const updates: Partial<typeof kanbanTasksTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (column !== undefined) updates.column = column as "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (order !== undefined) updates.order = order;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  if (waitingReason !== undefined) updates.waitingReason = waitingReason ?? null;
  if (completionStatus !== undefined) updates.completionStatus = completionStatus ?? null;
  if (completionNotes !== undefined) updates.completionNotes = completionNotes ?? null;
  if (priority !== undefined) updates.priority = priority ?? "medium";
  if (taskType !== undefined) updates.taskType = taskType ?? null;
  if (taskMetadata !== undefined) {
    if (taskMetadata === null) {
      updates.taskMetadata = null;
    } else {
      const existing = (existingTask.taskMetadata as Record<string, unknown>) ?? {};
      updates.taskMetadata = deepMerge(existing, taskMetadata);
    }
  }

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  const [taskProject] = updated.projectId
    ? await db.select({ clientUserId: projectsTable.clientUserId }).from(projectsTable).where(eq(projectsTable.id, updated.projectId))
    : [];

  // Auto-progression: when a task is completed, check if its workflow step is done.
  // Shared logic lives in kanban-phase-advance.ts so admin-m365-run.ts can reuse it.
  if (updates.column === "completed" && updated.workflowStepId && updated.projectId) {
    const { spawnedTasks } = await advancePhaseIfComplete(updated.workflowStepId, updated.projectId);
    for (const spawnedTask of spawnedTasks) {
      broadcastKanbanChange(spawnedTask.projectId, { action: "created", task: spawnedTask });
    }
  }

  await syncProjectProgressLib(updated.projectId);

  const auditBase = {
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin" as const,
    entityType: "kanban_task",
    entityId: updated.id,
    entityLabel: updated.title,
    projectId: updated.projectId ?? undefined,
    clientId: taskProject?.clientUserId ?? undefined,
  };

  if (column !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: column === "completed" ? "kanban_task_closed" : "kanban_task_moved",
      metadata: { from: existingTask.column, to: column, notes: completionNotes ?? null },
    });
  } else if (dueDate !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: "kanban_task_due_date_set",
      metadata: { from: existingTask.dueDate ?? null, to: dueDate ?? null },
    });
    // Emit milestone.delivery_date_changed when the dueDate actually changed
    if (String(existingTask.dueDate ?? "") !== String(updated.dueDate ?? "")) {
      void (async () => {
        try {
          void emitWorkflowEvent("milestone.delivery_date_changed", {
            taskId: updated.id,
            phaseId: updated.workflowStepId ?? null,
            projectId: updated.projectId,
            clientUserId: taskProject?.clientUserId ?? null,
            oldDueDate: existingTask.dueDate ? existingTask.dueDate.toISOString() : null,
            newDueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
          });
        } catch (e) {
          log.warn({ err: e, taskId: updated.id }, "kanban-tasks: failed to emit milestone.delivery_date_changed (non-fatal)");
        }
      })();
    }
  } else if (title !== undefined || description !== undefined || priority !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: "kanban_task_updated",
      metadata: { changedFields: Object.keys(req.body as object).filter(k => ["title","description","priority"].includes(k)) },
    });
  }

  broadcastKanbanChange(updated.projectId, { action: "updated", task: updated });
  res.json(updated);
});

router.post("/admin/kanban-tasks/:id/checklist/:itemId/completion-schema", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const itemId = String(req.params.itemId ?? "");
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }
  if (!itemId) { res.status(400).json({ error: "Invalid item ID" }); return; }

  const [task] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
  const checklist = (meta.checklist ?? []) as Array<{ id: string; label: string }>;
  const checklistItem = checklist.find(c => c.id === itemId);
  if (!checklistItem) { res.status(404).json({ error: "Checklist item not found" }); return; }

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const systemPrompt = `You are a project knowledge-capture assistant. When an engineer completes a checklist item, your job is to generate a small set of targeted questions to capture meaningful closure details. Return ONLY a valid JSON array (no markdown, no commentary) of field definitions with this exact shape:
[{"id":"snake_case_id","label":"Human readable label","type":"text"|"textarea"|"date"|"list"|"url","placeholder":"optional hint text","required":true|false,"hint":"optional extra guidance"}]
Rules:
- Return 2 to 5 fields maximum.
- Choose the field type that best fits the expected answer: url for links, date for dates, list for multiple items (attendees, files, etc.), textarea for free-form notes, text for short single values.
- Make the questions specific to the checklist item label and card context — do not ask generic questions.
- Do not ask for information already captured in the card title or description.`;

    const userMsg = `Card title: ${task.title}
${task.description ? `Card description: ${task.description}` : ""}
Checklist item just completed: ${checklistItem.label}

Generate the closure questions JSON array:`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.json({ fields: [] });
      return;
    }

    const text = block.text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) { res.json({ fields: [] }); return; }

    const fields = JSON.parse(match[0]) as Array<{
      id: string; label: string; type: string;
      placeholder?: string; required?: boolean; hint?: string;
    }>;
    res.json({ fields: fields.slice(0, 5) });
  } catch (err) {
    req.log.warn({ err }, "AI completion-schema generation failed — returning empty fields");
    res.json({ fields: [] });
  }
});

router.patch("/admin/kanban-tasks/:id/checklist/:itemId", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const itemId = String(req.params.itemId ?? "");
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }
  if (!itemId) { res.status(400).json({ error: "Invalid item ID" }); return; }

  const { checked, closureData } = req.body as { checked?: boolean; closureData?: { schema: unknown; answers: unknown } };
  if (typeof checked !== "boolean") { res.status(400).json({ error: "checked (boolean) is required" }); return; }

  const [existingTask] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!existingTask) { res.status(404).json({ error: "Task not found" }); return; }

  const currentMeta = (existingTask.taskMetadata ?? {}) as Record<string, unknown>;
  const currentState = (currentMeta.checklistState ?? {}) as Record<string, boolean>;
  const currentItemData = (currentMeta.checklistItemData ?? {}) as Record<string, unknown>;

  const updatedMeta: Record<string, unknown> = {
    ...currentMeta,
    checklistState: {
      ...currentState,
      [itemId]: checked,
    },
  };

  if (closureData) {
    updatedMeta.checklistItemData = {
      ...currentItemData,
      [itemId]: {
        schema: closureData.schema,
        answers: closureData.answers,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  const [updated] = await db
    .update(kanbanTasksTable)
    .set({ taskMetadata: updatedMeta, updatedAt: new Date() })
    .where(eq(kanbanTasksTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
  res.json({ taskMetadata: updated.taskMetadata });
});

router.delete("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select({ projectId: kanbanTasksTable.projectId }).from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (existing?.projectId) await syncProjectProgress(existing.projectId);
  if (existing?.projectId) broadcastKanbanChange(existing.projectId, { action: "deleted", task: { id } });
  res.json({ deleted: id });
});

router.get("/admin/projects/:id/report-autofill", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const sinceParam = typeof req.query.since === "string" ? req.query.since : null;
  const sinceDate = sinceParam ? new Date(sinceParam) : null;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [client] = project.clientUserId
    ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
        .from(usersTable).where(eq(usersTable.id, project.clientUserId))
    : [null];

  // Find the most recent status report date + period for this project (to return to the frontend)
  const [lastReport] = await db
    .select({ reportDate: statusReportsTable.reportDate, sentAt: statusReportsTable.sentAt, createdAt: statusReportsTable.createdAt, period: statusReportsTable.period })
    .from(statusReportsTable)
    .where(eq(statusReportsTable.projectId, id))
    .orderBy(desc(statusReportsTable.createdAt))
    .limit(1);

  const lastReportDate = lastReport
    ? (lastReport.reportDate ?? lastReport.sentAt ?? lastReport.createdAt).toISOString()
    : null;

  const lastReportPeriod = lastReport?.period ?? null;

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasksWhere = sinceDate
    ? and(eq(kanbanTasksTable.projectId, id), gte(kanbanTasksTable.updatedAt, sinceDate))
    : eq(kanbanTasksTable.projectId, id);

  const tasks = await db.select().from(kanbanTasksTable)
    .where(tasksWhere)
    .orderBy(asc(kanbanTasksTable.order));

  const completedTasks = tasks
    .filter(t => t.column === "completed")
    .map(t => ({
      title: t.title,
      description: t.description ?? "",
      completionStatus: t.completionStatus ?? null,
      completionNotes: t.completionNotes ?? null,
    }));

  // For steps, filter by completedAt when sinceDate is provided
  const allCompletedSteps = steps.filter(s => s.status === "completed");
  const filteredCompletedSteps = sinceDate
    ? allCompletedSteps.filter(s => s.completedAt && s.completedAt >= sinceDate)
    : allCompletedSteps;

  const completedSteps = filteredCompletedSteps.map(s => ({ title: s.title, description: s.description ?? "" }));

  const pendingSteps = steps
    .filter(s => s.status === "pending" || s.status === "in_progress")
    .map(s => ({ label: s.status === "in_progress" ? "In Progress" : "Upcoming", title: s.title, description: s.description ?? "" }));

  const blockedCount = steps.filter(s => s.status === "blocked").length;
  const completedStepsCount = allCompletedSteps.length;

  res.json({
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      progress: completedStepsCount > 0 && steps.length > 0
        ? Math.round((completedStepsCount / steps.length) * 100)
        : project.progress,
      description: project.description,
      endDate: project.endDate,
    },
    client,
    completedTasks,
    completedSteps,
    pendingSteps,
    blockedCount,
    totalSteps: steps.length,
    completedStepsCount,
    lastReportDate,
    lastReportPeriod,
    sinceDate: sinceDate ? sinceDate.toISOString() : null,
  });
});

router.post("/admin/projects/:id/closure-request", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (project.status !== "completed") {
    res.status(422).json({ error: "Closure can only be requested for completed projects" });
    return;
  }

  const existing = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (existing.length > 0) {
    res.status(409).json({ error: "Closure already requested for this project", closure: existing[0] });
    return;
  }

  const [closure] = await db.insert(projectClosuresTable).values({ projectId }).returning();

  // Send email to client if project has a clientUserId
  if (project.clientUserId) {
    const [client] = await db.select().from(usersTable).where(eq(usersTable.id, project.clientUserId));
    if (client) {
      await sendEmailFromTemplate(
        "closure-request",
        client.email,
        { clientName: client.name ?? "", projectTitle: project.title, projectUrl: `${getMspPortalBaseUrl()}/projects/${projectId}`, tenantHealthBlockHtml: await getTenantHealthBlockHtml(project.clientUserId) },
        `Project Sign-Off: ${project.title}`,
        closureRequestEmail({ clientName: client.name ?? "", projectTitle: project.title, projectId }),
      );
    }
  }

  res.json(closure);
});

router.get("/admin/projects/:id/closure", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [closure] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!closure) { res.status(404).json({ error: "No closure record found" }); return; }
  res.json(closure);
});

export default router;
