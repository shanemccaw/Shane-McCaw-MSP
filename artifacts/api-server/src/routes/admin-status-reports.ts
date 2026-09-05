import { Router, type IRouter, type Request, type Response } from "express";
import { db, statusReportsTable, usersTable, kanbanTasksTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { createNotification } from "../lib/notification-center.ts";
import { sendEmailFromTemplate, getTenantHealthBlockHtml, statusReportReplyEmail, adminThreadReplyEmail, canSendAutomatedCustomerEmailForUser } from "../lib/mailer.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "admin.status-reports" });

const router: IRouter = Router();

router.post("/admin/status-reports/:id/reply", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { reply } = req.body as { reply?: string };
  if (!reply?.trim()) { res.status(400).json({ error: "reply is required" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "This report has no pending client question" });
    return;
  }

  if (report.adminReply) {
    res.status(409).json({ error: "A reply has already been sent for this report" });
    return;
  }

  const [updated] = await db.update(statusReportsTable)
    .set({ adminReply: reply.trim(), updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  if (report.clientUserId) {
    const linkPath = report.projectId
      ? `/portal/projects/${report.projectId}`
      : "/portal/projects";
    await createNotification({
      title: `Reply to your question on: ${report.title}`,
      body: "Shane has replied to your question on a status report. View it in your portal.",
      notifType: "project_update",
      category: "project",
      linkPath,
      recipient: { type: "customer_user", userId: report.clientUserId },
      // This route already sends its own branded "status-report-reply"
      // template email below — don't let createNotification's own
      // preference-gated email double it up once the client opts in (#2933).
      suppressPreferenceEmail: true,
    });

    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email && await canSendAutomatedCustomerEmailForUser(report.clientUserId)) {
      await sendEmailFromTemplate(
        "status-report-reply",
        client.email,
        {
          clientName: client.name ?? "",
          reportTitle: report.title,
          adminReply: reply.trim(),
          projectUrl: report.projectId ? `${getMspPortalBaseUrl()}/projects/${report.projectId}` : getMspPortalBaseUrl(),
          tenantHealthBlockHtml: await getTenantHealthBlockHtml(report.clientUserId),
        },
        `Reply to your question on: ${report.title}`,
        statusReportReplyEmail({ clientName: client.name ?? "", reportTitle: report.title, adminReply: reply.trim(), projectId: report.projectId }),
      );
    }
  }

  if (report.clientUserId) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "status_report_reply",
      entityType: "status_report",
      entityId: report.id,
      entityLabel: report.title,
      clientId: report.clientUserId,
      projectId: report.projectId ?? null,
    });
  }

  res.json(updated);
});

// ─── ADMIN: Thread reply to client follow-up ─────────────────────────────────

router.post("/admin/status-reports/:id/thread", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "This report has no active client question" }); return;
  }

  const newMessage = { sender: "admin" as const, content: content.trim(), timestamp: new Date().toISOString() };
  const updatedThread = [...(report.replyThread ?? []), newMessage];

  const [updated] = await db.update(statusReportsTable)
    .set({ replyThread: updatedThread, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  // Notify client via in-app notification + email (fire-and-forget)
  if (report.clientUserId) {
    const linkPath = report.projectId
      ? `/portal/projects/${report.projectId}`
      : "/portal/projects";
    void createNotification({
      title: `New reply on: ${report.title}`,
      body: "Shane has replied to your follow-up message on a status report.",
      notifType: "project_update",
      category: "project",
      linkPath,
      recipient: { type: "customer_user", userId: report.clientUserId },
      // This route already sends its own branded "admin-thread-reply"
      // template email below — don't let createNotification's own
      // preference-gated email double it up once the client opts in (#2933).
      suppressPreferenceEmail: true,
    });
    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email && await canSendAutomatedCustomerEmailForUser(report.clientUserId)) {
      void sendEmailFromTemplate(
        "admin-thread-reply",
        client.email,
        {
          clientName: client.name ?? "",
          reportTitle: report.title,
          replyContent: content.trim(),
          tenantHealthBlockHtml: await getTenantHealthBlockHtml(report.clientUserId),
          projectUrl: report.projectId ? `${getMspPortalBaseUrl()}/projects/${report.projectId}` : getMspPortalBaseUrl(),
        },
        `Reply to your follow-up on: ${report.title}`,
        adminThreadReplyEmail({ clientName: client.name ?? "", reportTitle: report.title, replyContent: content.trim(), projectId: report.projectId }),
      );
    }
  }

  res.json(updated);
});

// ─── ADMIN: Status Reports ───────────────────────────────────────────────────

router.get("/admin/status-reports", requireAdmin, async (_req: Request, res: Response) => {
  const reports = await db.select().from(statusReportsTable).orderBy(desc(statusReportsTable.updatedAt));
  res.json(reports);
});

router.post("/admin/status-reports", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, clientUserId, title, period, executiveSummary, completedActivities, keyOutcomes, nextSteps, reportDate } = req.body as {
    projectId?: number; clientUserId?: number; title?: string; period?: string;
    executiveSummary?: string; completedActivities?: Array<{ title: string; description: string }>;
    keyOutcomes?: string; nextSteps?: Array<{ label: string; title: string; description: string }>;
    reportDate?: string;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  const validPeriods = ["weekly", "monthly", "executive_summary", "other"];
  const [report] = await db.insert(statusReportsTable).values({
    projectId: projectId ?? null,
    clientUserId: clientUserId ?? null,
    title,
    period: (validPeriods.includes(period ?? "") ? period : "monthly") as "weekly" | "monthly" | "executive_summary" | "other",
    reportStatus: "draft",
    executiveSummary: executiveSummary ?? null,
    completedActivities: completedActivities ?? [],
    keyOutcomes: keyOutcomes ?? null,
    nextSteps: nextSteps ?? [],
    reportDate: reportDate ? new Date(reportDate) : null,
  }).returning();
  res.status(201).json(report);
});

router.patch("/admin/status-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, period, executiveSummary, completedActivities, keyOutcomes, nextSteps, reportDate } = req.body as {
    title?: string; period?: string; executiveSummary?: string;
    completedActivities?: Array<{ title: string; description: string }>;
    keyOutcomes?: string; nextSteps?: Array<{ label: string; title: string; description: string }>;
    reportDate?: string;
  };

  const updates: Partial<typeof statusReportsTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (period !== undefined) updates.period = period as "weekly" | "monthly" | "executive_summary" | "other";
  if (executiveSummary !== undefined) updates.executiveSummary = executiveSummary;
  if (completedActivities !== undefined) updates.completedActivities = completedActivities;
  if (keyOutcomes !== undefined) updates.keyOutcomes = keyOutcomes;
  if (nextSteps !== undefined) updates.nextSteps = nextSteps;
  if (reportDate !== undefined) updates.reportDate = reportDate ? new Date(reportDate) : null;

  const [updated] = await db.update(statusReportsTable).set(updates).where(eq(statusReportsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.post("/admin/status-reports/:id/send", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db.update(statusReportsTable)
    .set({ reportStatus: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  if (report.clientUserId) {
    await createNotification({
      title: `New status report: ${report.title}`,
      body: "Your consultant has sent you a project status report. View it in your portal.",
      notifType: "project_update",
      category: "project",
      linkPath: "/portal/projects",
      recipient: { type: "customer_user", userId: report.clientUserId },
    });
  }

  if (report.clientUserId) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "status_report_published",
      entityType: "status_report",
      entityId: report.id,
      entityLabel: report.title,
      clientId: report.clientUserId,
      projectId: report.projectId ?? null,
      metadata: { period: report.period ?? null },
    });
  }

  res.json(updated);
});

router.delete("/admin/status-reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(statusReportsTable).where(eq(statusReportsTable.id, id));
  res.json({ deleted: id });
});

type NextStepWithKanban = { label: string; title: string; description: string; kanbanTaskId?: number | null };

router.post("/admin/status-reports/:id/next-steps/:index/push-to-kanban", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  const index = parseInt(String(req.params.index ?? ""), 10);
  if (isNaN(id) || isNaN(index)) { res.status(400).json({ error: "Invalid params" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (!report.projectId) { res.status(400).json({ error: "Assign a project to this report before pushing to Kanban" }); return; }

  const steps = (report.nextSteps ?? []) as NextStepWithKanban[];
  if (index < 0 || index >= steps.length) { res.status(400).json({ error: "Index out of range" }); return; }

  const step = steps[index];
  if (step.kanbanTaskId) {
    res.json({ report, kanbanTaskId: step.kanbanTaskId });
    return;
  }

  const descParts = [step.label ? `[${step.label}]` : null, step.description || null].filter(Boolean);
  const desc = descParts.length > 0 ? descParts.join(" ") : null;
  const [task] = await db.insert(kanbanTasksTable).values({
    projectId: report.projectId,
    title: step.title || "Untitled step",
    description: desc,
    column: "backlog",
    priority: "medium",
  }).returning();

  const updatedSteps = steps.map((s, i) => i === index ? { ...s, kanbanTaskId: task.id } : s);
  const [updatedReport] = await db.update(statusReportsTable)
    .set({ nextSteps: updatedSteps, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  res.json({ report: updatedReport, kanbanTaskId: task.id });
});

router.post("/admin/status-reports/:id/push-all-to-kanban", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable).where(eq(statusReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (!report.projectId) { res.status(400).json({ error: "Assign a project to this report before pushing to Kanban" }); return; }

  const steps = (report.nextSteps ?? []) as NextStepWithKanban[];
  const updatedSteps = [...steps];
  let pushed = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kanbanTaskId) continue;
    const descParts = [step.label ? `[${step.label}]` : null, step.description || null].filter(Boolean);
    const desc = descParts.length > 0 ? descParts.join(" ") : null;
    const [task] = await db.insert(kanbanTasksTable).values({
      projectId: report.projectId,
      title: step.title || "Untitled step",
      description: desc,
      column: "backlog",
      priority: "medium",
    }).returning();
    updatedSteps[i] = { ...step, kanbanTaskId: task.id };
    pushed++;
  }

  const [updatedReport] = await db.update(statusReportsTable)
    .set({ nextSteps: updatedSteps, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  res.json({ report: updatedReport, pushed });
});

export default router;
