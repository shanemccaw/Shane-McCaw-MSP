import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectsTable,
  workflowStepsTable,
  kanbanTasksTable,
  workflowTemplateStepTasksTable,
  documentsTable,
  projectUpdatesTable,
  statusReportsTable,
  contractsTable,
  servicesTable,
  invoicesTable,
} from "@workspace/db";
import { eq, and, asc, desc, inArray, isNotNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveSiblingUserIds } from "../lib/tenant-signals.ts";
import { registerSSEClient } from "../lib/sse-channels.ts";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

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

// Portal: subscribe to kanban events for a project (token via query param)
router.get("/portal/projects/:id/kanban-events", async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const token = String(req.query.token ?? "");
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) { res.status(401).json({ error: "Missing token" }); return; }

  let user: { id: number; role: string };
  try { user = jwt.verify(token, secret) as { id: number; role: string }; }
  catch { res.status(401).json({ error: "Invalid or expired token" }); return; }

  if (user.role === "client") {
    // #1397: a project belongs to the CUSTOMER account, not one login — allow
    // any sibling login of the same tenant to subscribe.
    const [project] = await db.select({ clientUserId: projectsTable.clientUserId })
      .from(projectsTable).where(eq(projectsTable.id, projectId));
    const siblingIds = await resolveSiblingUserIds(user.id);
    if (!project || project.clientUserId == null || !siblingIds.includes(project.clientUserId)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  setupSSE(req, res, projectId);
});

router.get("/portal/projects/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  // #1397: scope project access to the whole customer account, not one login.
  const siblingIds = isAdmin ? [] : await resolveSiblingUserIds(userId);
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), inArray(projectsTable.clientUserId, siblingIds)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, id))
    .orderBy(asc(kanbanTasksTable.order));

  // For steps that haven't had kanban tasks seeded yet, return their template tasks as a preview
  const seededStepIds = new Set(tasks.map(t => t.workflowStepId).filter(Boolean));
  const unseededSteps = steps.filter(s => s.workflowTemplateStepId && !seededStepIds.has(s.id));
  let previewTasks: Array<{ stepId: number; title: string; groupName: string | null; description: string | null }> = [];
  if (unseededSteps.length > 0) {
    const templateStepIds = unseededSteps.map(s => s.workflowTemplateStepId!);
    const tmplTasks = await db.select().from(workflowTemplateStepTasksTable)
      .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, templateStepIds))
      .orderBy(asc(workflowTemplateStepTasksTable.order));
    // Map each template task back to the project step ID
    const templateStepToProjectStep = new Map(unseededSteps.map(s => [s.workflowTemplateStepId!, s.id]));
    previewTasks = tmplTasks
      .filter(t => templateStepToProjectStep.has(t.workflowTemplateStepId))
      .map(t => ({
        stepId: templateStepToProjectStep.get(t.workflowTemplateStepId)!,
        title: t.title,
        groupName: t.groupName ?? null,
        description: t.description ?? null,
      }));
  }

  const documents = await db.select().from(documentsTable)
    .where(eq(documentsTable.projectId, id))
    .orderBy(desc(documentsTable.createdAt));

  const updates = await db.select().from(projectUpdatesTable)
    .where(eq(projectUpdatesTable.projectId, id))
    .orderBy(desc(projectUpdatesTable.createdAt));

  // Status reports for this project (sent only, visible to client).
  // #1397: for a client, match across every login of the customer account;
  // for an admin, scope to the project's own owning login.
  const reportScopeUserIds = isAdmin ? [project.clientUserId ?? userId] : siblingIds;
  const statusReports = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.projectId, id),
      inArray(statusReportsTable.clientUserId, reportScopeUserIds),
      eq(statusReportsTable.reportStatus, "sent"),
    ))
    .orderBy(desc(statusReportsTable.sentAt));

  // First unacknowledged report = pending banner (pending OR has_questions — only "accepted" clears it)
  const pendingStatusReport = statusReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;

  // Contracts for this project (with SharePoint URLs, local path, and service names)
  const contracts = await db.select({
    id: contractsTable.id,
    signedAt: contractsTable.signedAt,
    signerName: contractsTable.signerName,
    pdfFilename: contractsTable.pdfFilename,
    sharepointFileUrl: contractsTable.sharepointFileUrl,
    sharepointFileId: contractsTable.sharepointFileId,
    localFilePath: contractsTable.localFilePath,
    serviceName: servicesTable.name,
  }).from(contractsTable)
    .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .where(eq(contractsTable.projectId, id))
    .orderBy(desc(contractsTable.signedAt));

  const contract = contracts[0] ?? null;

  // Fetch coupon info — sum all discount amounts across project invoices sharing
  // the same coupon code, ordered by earliest invoice for determinism.
  const [projectInvoiceCoupon] = await db
    .select({ couponCode: invoicesTable.couponCode, discountAmount: invoicesTable.discountAmount })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.projectId, id), isNotNull(invoicesTable.couponCode)))
    .orderBy(invoicesTable.createdAt)
    .limit(1);
  const appliedCoupon = projectInvoiceCoupon?.couponCode
    ? { couponCode: projectInvoiceCoupon.couponCode, discountAmount: projectInvoiceCoupon.discountAmount ?? null }
    : null;

  res.json({ project, steps, tasks, previewTasks, documents, updates, statusReports, pendingStatusReport: pendingStatusReport ?? null, contract, contracts, appliedCoupon });
});

export default router;
