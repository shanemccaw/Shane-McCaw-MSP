import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, clientServicesTable, servicesTable, workflowStepsTable, kanbanTasksTable, documentsTable, reportsTable, invoicesTable, messagesTable, notificationsTable, projectUpdatesTable, usersTable, contractsTable, passwordResetTokensTable, workflowTemplateStepsTable, workflowTemplateStepTasksTable, contractTemplatesTable, impersonationTokensTable, statusReportsTable, deviceTokensTable, projectClosuresTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql, inArray, gte } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { sendEmail, purchaseConfirmationEmail, onboardingConfirmationEmail, adminPurchaseAlertEmail, closureRequestEmail, statusReportReplyEmail, clientThreadReplyEmail, adminThreadReplyEmail } from "../lib/mailer";
import { sendAdminSms } from "../lib/sms";
import { sendPushNotifications } from "../lib/push";
import { createAuditLog } from "../lib/audit";
import multer from "multer";
import path from "path";
import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const router: IRouter = Router();

/**
 * Returns the number of messages that Shane has not yet read.
 * Used to set the iOS app icon badge count in outgoing push payloads so that
 * consecutive background pushes show 2, 3, … rather than always 1.
 */
async function getAdminUnreadMessageCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(messagesTable)
      .where(eq(messagesTable.readByAdmin, false));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "documents");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const reportStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "reports");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const invoiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_BASE, "invoices");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const uploadDoc = multer({ storage: docStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const uploadReport = multer({ storage: reportStorage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadInvoice = multer({ storage: invoiceStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── CLIENT: Dashboard summary ───────────────────────────────────────────────
router.get("/portal/dashboard", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const projects = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.clientUserId, userId), eq(projectsTable.status, "active")))
    .orderBy(desc(projectsTable.updatedAt)).limit(5);

  const clientServices = await db.select({
    cs: clientServicesTable,
    service: servicesTable,
  }).from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(and(eq(clientServicesTable.clientUserId, userId), eq(clientServicesTable.status, "active")))
    .orderBy(desc(clientServicesTable.purchasedAt)).limit(6);

  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, userId))
    .orderBy(desc(invoicesTable.createdAt)).limit(5);

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt)).limit(3);

  const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));

  const [{ unreadMessages }] = await db.select({ unreadMessages: count() }).from(messagesTable)
    .where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));

  res.json({ projects, clientServices, invoices, reports, unreadNotifications: unread, unreadMessages });
});

// ─── CLIENT: Projects ────────────────────────────────────────────────────────
router.get("/portal/projects", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projects = await db.select().from(projectsTable)
    .where(eq(projectsTable.clientUserId, userId))
    .orderBy(desc(projectsTable.createdAt));

  if (projects.length === 0) { res.json([]); return; }

  const projectIds = projects.map(p => p.id);
  const allSteps = await db.select().from(workflowStepsTable)
    .where(inArray(workflowStepsTable.projectId, projectIds))
    .orderBy(asc(workflowStepsTable.order));

  const stepsByProject = new Map<number, typeof allSteps>();
  for (const s of allSteps) {
    if (!stepsByProject.has(s.projectId!)) stepsByProject.set(s.projectId!, []);
    stepsByProject.get(s.projectId!)!.push(s);
  }

  const enriched = projects.map(p => {
    const steps = stepsByProject.get(p.id) ?? [];
    const currentStep = steps.find(s => s.status === "in_progress") ?? steps.find(s => s.status === "pending") ?? steps[steps.length - 1];
    const currentStepIndex = currentStep ? steps.indexOf(currentStep) : steps.length - 1;
    const completedSteps = steps.filter(s => s.status === "completed").length;
    const computedProgress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : p.progress;
    return {
      ...p,
      progress: computedProgress,
      stepCount: steps.length,
      currentStepIndex,
      currentStepTitle: currentStep?.title ?? null,
      steps: steps.map(s => ({ id: s.id, title: s.title, status: s.status, order: s.order })),
    };
  });

  res.json(enriched);
});

router.get("/portal/projects/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
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

  // Status reports for this project (sent only, visible to client)
  const effectiveUserId = isAdmin ? (project.clientUserId ?? userId) : userId;
  const statusReports = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.projectId, id),
      eq(statusReportsTable.clientUserId, effectiveUserId),
      eq(statusReportsTable.reportStatus, "sent"),
    ))
    .orderBy(desc(statusReportsTable.sentAt));

  // First unacknowledged report = pending banner (pending OR has_questions — only "accepted" clears it)
  const pendingStatusReport = statusReports.find(r => r.clientStatus === "pending" || r.clientStatus === "has_questions") ?? null;

  // Contract for this project (if any)
  const [contract] = await db.select({
    id: contractsTable.id,
    signedAt: contractsTable.signedAt,
    signerName: contractsTable.signerName,
  }).from(contractsTable)
    .where(eq(contractsTable.projectId, id))
    .orderBy(desc(contractsTable.signedAt))
    .limit(1);

  res.json({ project, steps, tasks, previewTasks, documents, updates, statusReports, pendingStatusReport: pendingStatusReport ?? null, contract: contract ?? null });
});

// ─── CLIENT: Project Audit PDF ───────────────────────────────────────────────
router.get("/portal/projects/:id/audit-pdf", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [project] = await db.select().from(projectsTable)
    .where(isAdmin ? eq(projectsTable.id, id) : and(eq(projectsTable.id, id), eq(projectsTable.clientUserId, userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const steps = await db.select().from(workflowStepsTable)
    .where(eq(workflowStepsTable.projectId, id))
    .orderBy(asc(workflowStepsTable.order));

  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, id))
    .orderBy(asc(kanbanTasksTable.order));

  const updates = await db.select().from(projectUpdatesTable)
    .where(eq(projectUpdatesTable.projectId, id))
    .orderBy(desc(projectUpdatesTable.createdAt));

  // Sent status reports for this project
  const sentReports = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.projectId, id), eq(statusReportsTable.reportStatus, "sent")))
    .orderBy(desc(statusReportsTable.reportDate));

  // Documents with uploader names
  const docs = await db.select({
    id: documentsTable.id,
    name: documentsTable.name,
    sizeBytes: documentsTable.sizeBytes,
    createdAt: documentsTable.createdAt,
    uploaderName: usersTable.name,
  }).from(documentsTable)
    .leftJoin(usersTable, eq(documentsTable.uploadedBy, usersTable.id))
    .where(eq(documentsTable.projectId, id))
    .orderBy(asc(documentsTable.createdAt));

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 55;
  const pageW = 595;
  const navy  = rgb(0.039, 0.145, 0.251);  // #0A2540
  const blue  = rgb(0,     0.471, 0.831);  // #0078D4
  const teal  = rgb(0,     0.706, 0.847);  // #00B4D8
  const grey  = rgb(0.45,  0.45,  0.45);
  const white = rgb(1, 1, 1);
  const green = rgb(0.086, 0.627, 0.220);  // success green
  const red   = rgb(0.753, 0.110, 0.157);

  let page = pdfDoc.addPage([pageW, 842]);
  let y = 800;

  const newPage = () => {
    page = pdfDoc.addPage([pageW, 842]);
    y = 800;
    // running header on continuation pages
    page.drawRectangle({ x: 0, y: 820, width: pageW, height: 22, color: navy });
    page.drawText("Shane McCaw Consulting  —  Project Audit Report", {
      x: margin, y: 826, font: bold, size: 9, color: white,
    });
  };

  const text = (str: string, x: number, yy: number, opts: { font?: typeof bold; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(str, { x, y: yy, font: opts.font ?? regular, size: opts.size ?? 10, color: opts.color ?? navy });
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 60) newPage();
  };

  // Wrap text to width, return lines
  const wrap = (str: string, maxChars: number): string[] => {
    const words = str.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > maxChars) { if (line) lines.push(line); line = w; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  // ── Page 1 header bar ──────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 820, width: pageW, height: 22, color: navy });
  text("Shane McCaw Consulting  —  Project Audit Report", margin, 826, { font: bold, size: 9, color: white });

  // ── Title block ────────────────────────────────────────────────────────────
  y = 775;
  text("Project Audit Report", margin, y, { font: bold, size: 20, color: navy });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1.5, color: blue });
  y -= 18;

  const year = new Date().getFullYear();
  const refNum = `SMC-${year}-${String(project.id).padStart(3, "0")}`;
  const statusLabel: Record<string, string> = { active: "In Progress", on_hold: "On Hold", completed: "Completed", cancelled: "Cancelled" };
  const generatedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const completedSteps = steps.filter(s => s.status === "completed").length;
  const overallPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : project.progress;

  const meta: [string, string][] = [
    ["Project:", project.title],
    ["Reference:", refNum],
    ["Status:", statusLabel[project.status] ?? project.status],
    ["Overall Progress:", `${overallPct}% complete (${completedSteps} of ${steps.length} phases)`],
    ["Generated:", generatedOn],
  ];
  if (project.startDate) meta.push(["Start Date:", new Date(project.startDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);
  if (project.endDate)   meta.push(["Target Date:", new Date(project.endDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);

  for (const [label, value] of meta) {
    text(label, margin, y, { font: bold, size: 10, color: grey });
    text(value,  margin + 110, y, { size: 10 });
    y -= 16;
  }
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 18;

  // ── Progress bar ────────────────────────────────────────────────────────────
  ensureSpace(30);
  text("Overall Completion", margin, y, { font: bold, size: 10, color: navy });
  y -= 14;
  const barW = pageW - margin * 2;
  page.drawRectangle({ x: margin, y, width: barW, height: 8, color: rgb(0.92, 0.93, 0.95) });
  const fillW = Math.round(barW * overallPct / 100);
  if (fillW > 0) page.drawRectangle({ x: margin, y, width: fillW, height: 8, color: blue });
  text(`${overallPct}%`, margin + barW + 6, y, { size: 9, color: grey });
  y -= 22;

  // ── Phase breakdown ─────────────────────────────────────────────────────────
  ensureSpace(24);
  text("Phase Breakdown", margin, y, { font: bold, size: 13, color: navy });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
  y -= 16;

  const stepColor = (status: string) => {
    if (status === "completed") return green;
    if (status === "in_progress") return blue;
    if (status === "blocked") return red;
    return grey;
  };
  const stepLabel = (status: string) => {
    const m: Record<string, string> = { completed: "Completed", in_progress: "In Progress", pending: "Pending", blocked: "Blocked" };
    return m[status] ?? status;
  };

  for (const step of steps) {
    ensureSpace(52);

    // Step row background
    const rowBg = step.status === "in_progress" ? rgb(0.94, 0.97, 1) : rgb(0.98, 0.98, 0.99);
    page.drawRectangle({ x: margin - 4, y: y - 2, width: barW + 8, height: 16, color: rowBg });

    // Step number + title
    const stepNum = `${step.order ?? steps.indexOf(step) + 1}.`;
    text(stepNum, margin, y, { font: bold, size: 9.5, color: grey });
    text(step.title, margin + 18, y, { font: bold, size: 9.5, color: navy });

    // Status badge aligned right
    const statusStr = stepLabel(step.status);
    text(statusStr, pageW - margin - 70, y, { size: 9, color: stepColor(step.status) });
    y -= 16;

    // Completion date
    if (step.completedAt) {
      const dateStr = new Date(step.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      text(`Completed: ${dateStr}`, margin + 18, y, { size: 8.5, color: grey });
      y -= 13;
    }

    // Notes
    if (step.notes && step.notes.trim()) {
      const noteLines = wrap(step.notes.trim(), 88);
      for (const line of noteLines) {
        ensureSpace(14);
        text(line, margin + 18, y, { size: 8.5, color: grey });
        y -= 12;
      }
    }

    // Description (short, if available)
    if (step.description && step.description.trim()) {
      const descLines = wrap(step.description.trim(), 88);
      for (const line of descLines.slice(0, 2)) {
        ensureSpace(14);
        text(line, margin + 18, y, { size: 8, color: rgb(0.55, 0.55, 0.55) });
        y -= 11;
      }
    }

    y -= 6;
  }

  // ── Task Summary ────────────────────────────────────────────────────────────
  if (tasks.length > 0) {
    ensureSpace(50);
    y -= 4;
    text("Task Summary", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 18;

    // ── Overall stats row ────────────────────────────────────────────────────
    const taskTotals = {
      backlog:             tasks.filter(t => t.column === "backlog").length,
      in_progress:         tasks.filter(t => t.column === "in_progress").length,
      waiting_on_customer: tasks.filter(t => t.column === "waiting_on_customer").length,
      completed:           tasks.filter(t => t.column === "completed").length,
    };

    const statsLabels: [string, number, ReturnType<typeof rgb>][] = [
      ["Backlog",         taskTotals.backlog,             grey],
      ["In Progress",     taskTotals.in_progress,         blue],
      ["Waiting on You",  taskTotals.waiting_on_customer, rgb(0.761, 0.490, 0)],
      ["Completed",       taskTotals.completed,           green],
    ];
    const colW = Math.floor(barW / statsLabels.length);
    let sx = margin;
    for (const [label, count, color] of statsLabels) {
      // Card background
      page.drawRectangle({ x: sx, y: y - 28, width: colW - 6, height: 40, color: rgb(0.96, 0.97, 0.99) });
      text(String(count), sx + 10, y - 2, { font: bold, size: 16, color });
      text(label,         sx + 10, y - 18, { size: 8, color: grey });
      sx += colW;
    }
    y -= 44;

    // Total task count
    text(`${tasks.length} total task${tasks.length !== 1 ? "s" : ""}`, margin, y, { size: 8.5, color: grey });
    y -= 18;

    // ── Full card listing grouped by column ──────────────────────────────────
    const kanbanColumns: Array<{ key: string; label: string; color: ReturnType<typeof rgb> }> = [
      { key: "backlog",             label: "Backlog",             color: grey },
      { key: "in_progress",         label: "In Progress",         color: blue },
      { key: "waiting_on_customer", label: "Waiting on Customer", color: rgb(0.761, 0.490, 0) },
      { key: "completed",           label: "Completed",           color: green },
    ];
    const priorityLabel: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
    const priorityColor: Record<string, ReturnType<typeof rgb>> = {
      low: grey, medium: blue, high: rgb(0.8, 0.4, 0), urgent: red,
    };

    for (const col of kanbanColumns) {
      const colTasks = tasks.filter(t => t.column === col.key);
      if (colTasks.length === 0) continue;

      ensureSpace(30);
      page.drawRectangle({ x: margin - 4, y: y - 3, width: barW + 8, height: 18, color: rgb(0.95, 0.96, 0.98) });
      text(col.label, margin + 4, y, { font: bold, size: 9.5, color: col.color });
      text(`${colTasks.length} card${colTasks.length !== 1 ? "s" : ""}`, pageW - margin - 50, y, { size: 8.5, color: grey });
      y -= 22;

      for (const task of colTasks) {
        ensureSpace(22);
        const colSymbol = col.key === "completed" ? "[x]" : col.key === "in_progress" ? "[>]" : col.key === "waiting_on_customer" ? "[?]" : "[ ]";
        text(colSymbol, margin + 8, y, { size: 8, color: col.color });
        const titleLines = wrap(task.title, 74);
        text(titleLines[0] ?? task.title, margin + 24, y, { font: bold, size: 8.5, color: navy });

        // Priority + due date aligned right
        const pri = task.priority ?? "medium";
        const metaParts: string[] = [];
        if (pri !== "medium") metaParts.push(priorityLabel[pri] ?? pri);
        if (task.dueDate) metaParts.push(`Due ${new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
        if (metaParts.length > 0) {
          text(metaParts.join("  ·  "), pageW - margin - 100, y, { size: 7.5, color: priorityColor[pri] ?? grey });
        }
        y -= 12;

        // Description
        if (task.description && task.description.trim()) {
          const dLines = wrap(task.description.trim(), 80);
          for (const line of dLines) {
            ensureSpace(12);
            text(line, margin + 24, y, { size: 7.5, color: rgb(0.5, 0.5, 0.5) });
            y -= 11;
          }
        }

        // Waiting reason
        if (task.waitingReason) {
          ensureSpace(11);
          text(`Waiting: ${task.waitingReason}`, margin + 24, y, { size: 7.5, color: rgb(0.761, 0.490, 0) });
          y -= 10;
        }

        // Completion notes
        if (task.completionNotes) {
          const nLines = wrap(task.completionNotes, 80);
          for (const line of nLines) {
            ensureSpace(11);
            text(line, margin + 24, y, { size: 7.5, color: rgb(0.45, 0.45, 0.45) });
            y -= 10;
          }
        }

        y -= 4;
      }
      y -= 4;
    }

    y -= 4;
  }

  // ── Consultant Updates ──────────────────────────────────────────────────────
  if (updates.length > 0) {
    ensureSpace(40);
    y -= 4;
    text("Consultant Updates", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    for (const upd of updates.slice(0, 10)) {
      ensureSpace(30);
      const dateStr = new Date(upd.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const typeLabel = upd.type === "milestone" ? "Milestone" : upd.type === "file" ? "Document" : "Update";
      text(`${dateStr}  ·  ${typeLabel}`, margin, y, { font: bold, size: 8.5, color: blue });
      y -= 13;

      const lines = wrap(upd.content, 92);
      for (const line of lines.slice(0, 4)) {
        ensureSpace(13);
        text(line, margin + 4, y, { size: 9, color: navy });
        y -= 12;
      }
      y -= 6;
    }
  }

  // ── Status Reports ──────────────────────────────────────────────────────────
  if (sentReports.length > 0) {
    ensureSpace(40);
    y -= 4;
    text("Status Reports", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    const periodLabels: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", executive_summary: "Executive Summary", other: "Other" };

    for (const sr of sentReports) {
      ensureSpace(40);

      // Report header
      const periodStr = periodLabels[sr.period] ?? sr.period;
      const rdStr = sr.reportDate ? new Date(sr.reportDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
      text(`${periodStr}${rdStr ? `  —  ${rdStr}` : ""}`, margin, y, { font: bold, size: 10, color: navy });
      y -= 13;
      text(sr.title, margin, y, { size: 9, color: grey });
      y -= 18;

      // Executive summary
      if (sr.executiveSummary) {
        ensureSpace(20);
        text("Executive Summary", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        const esLines = wrap(sr.executiveSummary, 90);
        for (const line of esLines) {
          ensureSpace(12);
          text(line, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Completed activities
      type SRActivity = { title: string; description: string };
      const activities = (sr.completedActivities ?? []) as SRActivity[];
      if (activities.length > 0) {
        ensureSpace(20);
        text("Completed Activities", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        for (const act of activities) {
          ensureSpace(12);
          text(`• ${act.title}`, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
          if (act.description) {
            const aLines = wrap(act.description, 85);
            for (const line of aLines) {
              ensureSpace(11);
              text(`  ${line}`, margin + 10, y, { size: 7.5, color: grey });
              y -= 10;
            }
          }
        }
        y -= 4;
      }

      // Key outcomes
      if (sr.keyOutcomes) {
        ensureSpace(20);
        text("Key Outcomes", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        const koLines = wrap(sr.keyOutcomes, 90);
        for (const line of koLines) {
          ensureSpace(11);
          text(line, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Next steps
      type SRNextStep = { label: string; title: string; description: string };
      const srNextSteps = (sr.nextSteps ?? []) as SRNextStep[];
      if (srNextSteps.length > 0) {
        ensureSpace(20);
        text("Next Steps", margin, y, { font: bold, size: 8.5, color: blue });
        y -= 12;
        for (const ns of srNextSteps) {
          ensureSpace(12);
          text(`• ${ns.title || ns.label}`, margin + 4, y, { size: 8.5, color: navy });
          y -= 11;
        }
        y -= 4;
      }

      // Client question + admin reply
      if (sr.clientQuestion) {
        ensureSpace(20);
        text("Client Question:", margin + 4, y, { font: bold, size: 8, color: rgb(0.5, 0.3, 0) });
        y -= 11;
        const qLines = wrap(sr.clientQuestion, 86);
        for (const line of qLines) {
          ensureSpace(11);
          text(line, margin + 10, y, { size: 8, color: navy });
          y -= 10;
        }
        if (sr.adminReply) {
          y -= 2;
          text("Response:", margin + 4, y, { font: bold, size: 8, color: blue });
          y -= 11;
          const rLines = wrap(sr.adminReply, 86);
          for (const line of rLines) {
            ensureSpace(11);
            text(line, margin + 10, y, { size: 8, color: navy });
            y -= 10;
          }
        }
        y -= 4;
      }

      // Divider between reports
      y -= 6;
      ensureSpace(4);
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.3, color: rgb(0.88, 0.88, 0.88) });
      y -= 12;
    }
  }

  // ── Documents ───────────────────────────────────────────────────────────────
  {
    ensureSpace(40);
    y -= 4;
    text("Project Documents", margin, y, { font: bold, size: 13, color: navy });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: teal });
    y -= 16;

    if (docs.length === 0) {
      text("No documents uploaded", margin, y, { size: 9, color: grey });
      y -= 16;
    } else {
      const fmtSize = (bytes: number | null) => {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };
      for (const doc of docs) {
        ensureSpace(16);
        const docDate = new Date(doc.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        const sizeStr = fmtSize(doc.sizeBytes);
        const uploaderStr = doc.uploaderName ?? "Unknown";
        const docMeta = [sizeStr, uploaderStr, docDate].filter(Boolean).join("  ·  ");
        text(`• ${doc.name}`, margin, y, { font: bold, size: 8.5, color: navy });
        text(docMeta, pageW - margin - 170, y, { size: 8, color: grey });
        y -= 14;
      }
    }
  }

  // ── Footer on last page ─────────────────────────────────────────────────────
  ensureSpace(30);
  y = 45;
  page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: pageW - margin, y: y + 12 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  text("Shane McCaw Consulting LLC  —  Confidential", margin, y, { size: 8, color: grey });
  text(`Generated ${generatedOn}`, pageW - margin - 100, y, { size: 8, color: grey });

  // ── Return PDF ─────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const filename = `audit-${refNum}.pdf`;
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(pdfBytes.length),
  });
  res.end(Buffer.from(pdfBytes));
});

// ─── CLIENT: Services ────────────────────────────────────────────────────────
router.get("/portal/services", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const services = await db.select({
    cs: clientServicesTable,
    service: servicesTable,
  }).from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(eq(clientServicesTable.clientUserId, userId))
    .orderBy(desc(clientServicesTable.purchasedAt));

  const result = await Promise.all(services.map(async ({ cs, service }) => {
    const steps = await db.select().from(workflowStepsTable)
      .where(eq(workflowStepsTable.clientServiceId, cs.id))
      .orderBy(asc(workflowStepsTable.order));
    return { ...cs, service, steps };
  }));

  res.json(result);
});

// ─── CLIENT: Service checkout ─────────────────────────────────────────────────
router.post("/portal/services/checkout", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, priceInCents, description, category, returnUrl } = req.body as {
    name?: string;
    priceInCents?: number;
    description?: string;
    category?: string;
    returnUrl?: string;
  };

  if (!name || !priceInCents) {
    res.status(400).json({ error: "name and priceInCents are required" });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "Online purchasing is not yet configured. Please contact us at info@shanemccaw.com to purchase this service." });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;
  const encodedName = encodeURIComponent(name);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name,
          description: description ?? undefined,
        },
        unit_amount: priceInCents,
      },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${baseUrl}/portal/services?purchase=success&service=${encodedName}`,
    cancel_url: `${baseUrl}/portal/services?purchase=cancelled`,
    metadata: {
      type: "service_purchase",
      userId: String(userId),
      serviceName: name,
      serviceCategory: category ?? "",
      servicePriceInCents: String(priceInCents),
    },
  });

  res.json({ url: session.url });
});

// ─── CLIENT: Reports ─────────────────────────────────────────────────────────
router.get("/portal/reports", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt));
  res.json(reports);
});

router.get("/portal/reports/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [report] = await db.select().from(reportsTable)
    .where(isAdmin ? eq(reportsTable.id, id) : and(eq(reportsTable.id, id), eq(reportsTable.clientUserId, userId)));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "reports", report.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, report.filename);
});

// ─── CLIENT: Documents ───────────────────────────────────────────────────────
router.get("/portal/documents/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  const isAdmin = req.user!.role === "admin";
  if (!isAdmin) {
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, doc.projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  const filePath = path.join(UPLOADS_BASE, "documents", doc.filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, doc.name);
});

// ─── CLIENT: Document Upload ─────────────────────────────────────────────────
router.post("/portal/projects/:projectId/documents", requireAuth, uploadDoc.single("file"), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const projectId = parseInt(String(req.params.projectId ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  if (!isAdmin) {
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  if (!req.file) { res.status(400).json({ error: "File is required" }); return; }

  const { name } = req.body as { name?: string };
  const [doc] = await db.insert(documentsTable).values({
    projectId,
    name: name?.trim() || req.file.originalname,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedBy: userId,
  }).returning();
  res.status(201).json(doc);
});

// ─── Helper: recompute and persist project progress from kanban completion ────
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

// ─── CLIENT: Kanban Tasks (client can move cards on their own project boards) ─
router.patch("/portal/kanban-tasks/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [task] = await db.select().from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  if (!isAdmin) {
    // Clients may only update tasks that belong to their own projects
    const [project] = await db.select().from(projectsTable)
      .where(and(eq(projectsTable.id, task.projectId), eq(projectsTable.clientUserId, userId)));
    if (!project) { res.status(403).json({ error: "Access denied" }); return; }
  }

  const { column } = req.body as { column?: string };
  const updates: Partial<typeof kanbanTasksTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (column !== undefined) updates.column = column as "backlog" | "in_progress" | "waiting_on_customer" | "completed";

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (updated?.projectId) await syncProjectProgress(updated.projectId);

  if (column !== undefined && updated) {
    const actor = req.user!;
    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: actor.role as "admin" | "client",
      actionType: column === "completed" ? "kanban_task_closed" : "kanban_task_moved",
      entityType: "kanban_task",
      entityId: updated.id,
      entityLabel: updated.title,
      projectId: updated.projectId,
      clientId: actor.role === "client" ? actor.id : null,
      metadata: { from: task.column, to: column },
    });
  }

  res.json(updated);
});

// ─── CLIENT: Invoices ────────────────────────────────────────────────────────
router.get("/portal/invoices", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, userId))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(invoices);
});

// ─── CLIENT: Invoice detail ───────────────────────────────────────────────────
router.get("/portal/invoices/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  let project: { id: number; title: string } | null = null;
  if (invoice.projectId) {
    const [p] = await db.select({ id: projectsTable.id, title: projectsTable.title })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, invoice.projectId), eq(projectsTable.clientUserId, userId)));
    project = p ?? null;
  }

  let contracts: Array<{
    id: number;
    serviceId: number;
    serviceName: string;
    signedAt: Date;
    signerName: string | null;
    contractVersion: string;
    finalPrice: string | null;
    wizardSelections: unknown;
    orderWorkflow: unknown;
  }> = [];

  if (invoice.projectId) {
    const rows = await db.select({
      id: contractsTable.id,
      serviceId: contractsTable.serviceId,
      serviceName: servicesTable.name,
      signedAt: contractsTable.signedAt,
      signerName: contractsTable.signerName,
      contractVersion: contractsTable.contractVersion,
      finalPrice: contractsTable.finalPrice,
      wizardSelections: contractsTable.wizardSelections,
      orderWorkflow: servicesTable.orderWorkflow,
    })
      .from(contractsTable)
      .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(and(
        eq(contractsTable.projectId, invoice.projectId),
        eq(contractsTable.userId, userId),
      ));
    contracts = rows;
  }

  res.json({ invoice, project, contracts });
});

router.post("/portal/invoices/:id/pay", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (invoice.status === "paid") { res.status(400).json({ error: "Invoice already paid" }); return; }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "Stripe not configured. Set STRIPE_SECRET_KEY." });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const { returnUrl } = req.body as { returnUrl?: string };
  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: invoice.currency,
        unit_amount: Math.round(parseFloat(String(invoice.amount)) * 100),
        product_data: { name: `Invoice ${invoice.invoiceNumber}`, description: invoice.description ?? undefined },
      },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${baseUrl}/portal/billing?payment=success&invoice=${id}`,
    cancel_url: `${baseUrl}/portal/billing?payment=cancelled`,
    metadata: { invoiceId: String(id) },
  });

  await db.update(invoicesTable).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(invoicesTable.id, id));

  res.json({ url: session.url });
});

router.get("/portal/invoices/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [invoice] = await db.select().from(invoicesTable)
    .where(isAdmin ? eq(invoicesTable.id, id) : and(eq(invoicesTable.id, id), eq(invoicesTable.clientUserId, userId)));
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!invoice.pdfFilename) { res.status(404).json({ error: "No PDF available" }); return; }

  const filePath = path.join(UPLOADS_BASE, "invoices", invoice.pdfFilename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, invoice.pdfFilename);
});

// ─── CLIENT: Contract detail ──────────────────────────────────────────────────
router.get("/portal/contracts/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({
    id: contractsTable.id,
    userId: contractsTable.userId,
    serviceId: contractsTable.serviceId,
    serviceName: servicesTable.name,
    orderWorkflow: servicesTable.orderWorkflow,
    signedAt: contractsTable.signedAt,
    signatureData: contractsTable.signatureData,
    signerName: contractsTable.signerName,
    contractVersion: contractsTable.contractVersion,
    projectId: contractsTable.projectId,
    pdfFilename: contractsTable.pdfFilename,
    finalPrice: contractsTable.finalPrice,
    wizardSelections: contractsTable.wizardSelections,
    agreementBody: contractsTable.agreementBody,
    createdAt: contractsTable.createdAt,
  })
    .from(contractsTable)
    .innerJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .where(and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));

  if (!row) { res.status(404).json({ error: "Contract not found" }); return; }

  // Use the snapshotted agreement body stored at signing time.
  // For older contracts where it was not snapshotted, fall back to the live template.
  let agreementBody: string | null = row.agreementBody ?? null;
  if (agreementBody === null) {
    const [template] = await db.select({ body: contractTemplatesTable.body })
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, row.serviceId));
    agreementBody = template?.body ?? null;
  }

  res.json({ ...row, agreementBody });
});

router.get("/portal/contracts/:id/download", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [contract] = await db.select().from(contractsTable)
    .where(and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));
  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  if (!contract.pdfFilename) { res.status(404).json({ error: "No PDF available" }); return; }

  const filePath = path.join(UPLOADS_BASE, "contracts", contract.pdfFilename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.download(filePath, contract.pdfFilename);
});

// ─── CLIENT: Subscriptions ────────────────────────────────────────────────────
router.get("/portal/billing/subscriptions", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const rows = await db.select({
    cs: clientServicesTable,
    svc: servicesTable,
  })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(clientServicesTable.clientUserId, userId),
        eq(servicesTable.billingType, "recurring_monthly"),
      )
    )
    .orderBy(desc(clientServicesTable.purchasedAt));

  const stripeKey = process.env.STRIPE_SECRET_KEY;

  const results = await Promise.all(rows.map(async ({ cs, svc }) => {
    let stripeData: {
      status: string;
      cancelAtPeriodEnd: boolean;
      cancelAt: number | null;
      billingCycleAnchor: number | null;
      amount: number | null;
      currency: string | null;
    } | null = null;

    if (cs.stripeSubscriptionId && stripeKey) {
      try {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);
        const sub = await stripe.subscriptions.retrieve(cs.stripeSubscriptionId);
        const item = sub.items.data[0];
        stripeData = {
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          cancelAt: sub.cancel_at ?? null,
          billingCycleAnchor: sub.billing_cycle_anchor ?? null,
          amount: item?.price?.unit_amount ?? null,
          currency: item?.price?.currency ?? null,
        };
      } catch {
        // Stripe unreachable — return record without live data
      }
    }

    return {
      id: cs.id,
      serviceId: svc.id,
      serviceName: svc.name,
      serviceSlug: svc.slug,
      status: cs.status,
      startDate: cs.startDate,
      purchasedAt: cs.purchasedAt,
      stripeSubscriptionId: cs.stripeSubscriptionId,
      stripe: stripeData,
    };
  }));

  res.json(results);
});

router.post("/portal/billing/subscriptions/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cs] = await db.select().from(clientServicesTable)
    .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)));
  if (!cs) { res.status(404).json({ error: "Subscription not found" }); return; }
  if (!cs.stripeSubscriptionId) {
    res.status(400).json({ error: "No Stripe subscription linked to this service. Please contact support." });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) { res.status(503).json({ error: "Stripe not configured." }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const sub = await stripe.subscriptions.update(cs.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  req.log.info({ clientServiceId: cs.id, subscriptionId: cs.stripeSubscriptionId }, "subscription: cancel_at_period_end set");

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "retainer_cancelled",
    entityType: "service",
    entityId: cs.id,
    entityLabel: String(cs.serviceId),
    clientId: userId,
  });

  res.json({
    ok: true,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: sub.cancel_at ?? null,
    billingCycleAnchor: sub.billing_cycle_anchor ?? null,
  });
});

// ─── Contract PDF generator ───────────────────────────────────────────────────
interface ContractPdfOptions {
  contractId: number;
  signerName: string;
  serviceName: string;
  servicePrice: string;
  serviceDeliverables: string;
  serviceTurnaround: string;
  signedAt: Date;
  signatureDataUrl?: string;
  contractTemplateBody?: string; // When provided, replaces hardcoded sections with admin-authored content
  selectionsSummary?: string;    // Plain-text wizard selection summary, injected after price row
}

async function generateContractPdf(opts: ContractPdfOptions): Promise<string> {
  const { contractId, signerName, serviceName, servicePrice, serviceDeliverables, serviceTurnaround, signedAt, signatureDataUrl, contractTemplateBody, selectionsSummary } = opts;

  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const margin = 60;
  const navy = rgb(0.039, 0.145, 0.251); // #0A2540
  const blue = rgb(0, 0.471, 0.831);    // #0078D4
  const grey = rgb(0.4, 0.4, 0.4);

  const addPage = () => {
    const p = pdfDoc.addPage([595, 842]); // A4
    return p;
  };

  const drawText = (page: ReturnType<typeof addPage>, text: string, x: number, y: number, opts2: { font?: typeof helvetica; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text, {
      x,
      y,
      font: opts2.font ?? helvetica,
      size: opts2.size ?? 10,
      color: opts2.color ?? navy,
    });
  };

  // ── Page 1: Contract terms ──────────────────────────────────────────────────
  const page1 = addPage();
  let y = 800;

  // Header bar
  page1.drawRectangle({ x: 0, y: 820, width: 595, height: 22, color: navy });
  drawText(page1, "Shane McCaw Consulting LLC  —  Service Agreement", margin, 826, { font: helveticaBold, size: 9, color: rgb(1, 1, 1) });

  y = 770;
  drawText(page1, "Service Agreement", margin, y, { font: helveticaBold, size: 20, color: navy });
  y -= 6;
  page1.drawLine({ start: { x: margin, y }, end: { x: 535, y }, thickness: 1.5, color: blue });
  y -= 18;

  const signedDate = signedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const meta = [
    ["Date:", signedDate],
    ["Service:", serviceName],
    ["Fixed Fee:", servicePrice],
    ["Turnaround:", serviceTurnaround],
    ["Client:", signerName],
    ["Provider:", "Shane McCaw Consulting LLC"],
  ];
  for (const [label, value] of meta) {
    drawText(page1, label, margin, y, { font: helveticaBold, size: 10, color: grey });
    drawText(page1, value, margin + 90, y, { size: 10 });
    y -= 16;
  }
  y -= 10;
  page1.drawLine({ start: { x: margin, y }, end: { x: 535, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 18;

  // ── Wizard selections summary (if any) ────────────────────────────────────
  if (selectionsSummary) {
    drawText(page1, "Customisation Selections", margin, y, { font: helveticaBold, size: 10, color: navy });
    y -= 14;
    for (const line of selectionsSummary.split("\n").filter(l => l.trim() !== "Customisation selections:")) {
      if (y < 80) break;
      drawText(page1, line, margin + 4, y, { size: 9, color: grey });
      y -= 13;
    }
    y -= 8;
    page1.drawLine({ start: { x: margin, y }, end: { x: 535, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    y -= 18;
  }

  if (contractTemplateBody) {
    // Render admin-authored contract body (variable substitution already applied by caller)
    const bodyLines = contractTemplateBody.split("\n");
    for (const rawLine of bodyLines) {
      if (y < 80) break;
      const trimmed = rawLine.trimEnd();
      if (trimmed.startsWith("# ")) {
        drawText(page1, trimmed.slice(2), margin, y, { font: helveticaBold, size: 12, color: navy });
        y -= 18;
      } else if (trimmed.startsWith("## ")) {
        drawText(page1, trimmed.slice(3), margin, y, { font: helveticaBold, size: 10, color: blue });
        y -= 16;
      } else if (trimmed === "") {
        y -= 8;
      } else {
        // Word-wrap plain text lines at ~90 chars
        const words = trimmed.split(" ");
        let line = "";
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (candidate.length > 90) {
            if (y < 80) break;
            drawText(page1, line, margin + 4, y, { size: 9.5, color: navy });
            y -= 13;
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line && y >= 80) { drawText(page1, line, margin + 4, y, { size: 9.5, color: navy }); y -= 13; }
      }
    }
  } else {
    const sections = [
      ["1. Services", `Consultant agrees to deliver the "${serviceName}" micro-offer package to Client. Deliverables include: ${serviceDeliverables}.`],
      ["2. Fees & Payment", `The fixed fee for this engagement is ${servicePrice} USD, payable in full at checkout before work commences. No additional charges will be incurred for the standard deliverables listed above.`],
      ["3. Scope", "This agreement covers only the deliverables specified in Section 1. Any additional work beyond this scope must be agreed in writing and may be subject to additional fees."],
      ["4. Delivery", `Consultant will deliver the agreed outputs within the stated turnaround period (${serviceTurnaround}) after receipt of payment and any required access or information from Client. Work will not commence until payment is confirmed.`],
      ["5. Revisions", "One round of revisions is included. Additional revisions are available at Consultant's standard hourly rate."],
      ["6. Confidentiality", "Each party agrees to keep the other party's confidential information confidential and not to disclose it to any third party without prior written consent."],
      ["7. Intellectual Property", "Upon receipt of full payment, all deliverables produced by Consultant for Client become the sole property of Client."],
      ["8. Limitation of Liability", "Consultant's total liability under this agreement shall not exceed the fees paid. Consultant is not liable for any indirect, incidental, or consequential damages."],
      ["9. Governing Law", "This agreement is governed by the laws of the State of Virginia, United States."],
      ["10. Entire Agreement", "This document constitutes the entire agreement between the parties with respect to this engagement and supersedes all prior discussions."],
    ];

    for (const [heading, body] of sections) {
      if (y < 80) break;
      drawText(page1, heading, margin, y, { font: helveticaBold, size: 10, color: blue });
      y -= 14;
      const words = body.split(" ");
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > 90) {
          drawText(page1, line, margin + 10, y, { size: 9.5, color: navy });
          y -= 13;
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) { drawText(page1, line, margin + 10, y, { size: 9.5, color: navy }); y -= 13; }
      y -= 8;
    }
  }

  // ── Page 2: Signature page ──────────────────────────────────────────────────
  const page2 = addPage();
  page2.drawRectangle({ x: 0, y: 820, width: 595, height: 22, color: navy });
  drawText(page2, "Shane McCaw Consulting LLC  —  Service Agreement  —  Signature Page", margin, 826, { font: helveticaBold, size: 9, color: rgb(1, 1, 1) });

  let y2 = 760;
  drawText(page2, "Electronic Signature", margin, y2, { font: helveticaBold, size: 16, color: navy });
  y2 -= 6;
  page2.drawLine({ start: { x: margin, y: y2 }, end: { x: 535, y: y2 }, thickness: 1.5, color: blue });
  y2 -= 20;

  drawText(page2, "By signing below, the Client confirms they have read, understood, and agreed to the", margin, y2, { size: 10, color: grey });
  y2 -= 14;
  drawText(page2, "Service Agreement on Page 1.", margin, y2, { size: 10, color: grey });
  y2 -= 30;

  // Signature image or placeholder
  if (signatureDataUrl && signatureDataUrl.startsWith("data:image/png;base64,")) {
    try {
      const base64Data = signatureDataUrl.replace("data:image/png;base64,", "");
      const sigBytes = Buffer.from(base64Data, "base64");
      const sigImg = await pdfDoc.embedPng(sigBytes);
      const imgW = 240;
      const imgH = Math.round((sigImg.height / sigImg.width) * imgW);
      page2.drawImage(sigImg, { x: margin, y: y2 - imgH, width: imgW, height: imgH });
      y2 -= imgH + 8;
    } catch {
      drawText(page2, "[Signature image could not be rendered]", margin, y2, { size: 9, color: grey });
      y2 -= 20;
    }
  } else {
    page2.drawRectangle({ x: margin, y: y2 - 60, width: 240, height: 60, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
    drawText(page2, "[Electronic signature on file]", margin + 10, y2 - 38, { size: 9, color: grey });
    y2 -= 70;
  }

  page2.drawLine({ start: { x: margin, y: y2 }, end: { x: margin + 260, y: y2 }, thickness: 0.75, color: navy });
  y2 -= 12;
  drawText(page2, `${signerName}  (Client)`, margin, y2, { size: 10, color: navy });
  y2 -= 14;
  drawText(page2, `Signed electronically on ${signedDate}`, margin, y2, { size: 9, color: grey });
  y2 -= 8;
  drawText(page2, `Contract ref: ${contractId}`, margin, y2, { size: 8, color: grey });
  y2 -= 40;

  drawText(page2, "For Shane McCaw Consulting LLC:", margin, y2, { size: 10, color: navy });
  y2 -= 14;
  drawText(page2, "Shane McCaw", margin, y2, { font: helveticaBold, size: 10, color: navy });
  y2 -= 14;
  drawText(page2, "Lead Microsoft 365 Architect & Consultant", margin, y2, { size: 9, color: grey });

  // Footer
  drawText(page2, "This document was generated electronically and is legally binding. Shane McCaw Consulting LLC  |  info@shanemccaw.com", margin, 30, { size: 7.5, color: grey });

  // ── Save to disk ────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const docsDir = path.join(UPLOADS_BASE, "documents");
  fs.mkdirSync(docsDir, { recursive: true });
  const filename = `contract-${contractId}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(docsDir, filename), Buffer.from(pdfBytes));
  return filename;
}

// ─── Onboarding provisioning helper ──────────────────────────────────────────
// Extracted from the webhook so control flow is clean (no break/return fights).
// Idempotent: checks for an existing invoice by stripeSessionId before acting.
// Supports both legacy single serviceId and new comma-separated serviceIds format.
async function provisionOnboardingProject(
  req: Request,
  session: import("stripe").Stripe.Checkout.Session,
  stripeSubscriptionId?: string | null,
): Promise<void> {
  const { userId, serviceId, serviceIds: serviceIdsStr, contractId, contractIds: contractIdsStr, servicePrices: servicePricesStr } = session.metadata ?? {};
  const uid = parseInt(userId ?? "", 10);

  // Support both legacy (serviceId) and new (serviceIds) metadata formats
  const sids = serviceIdsStr
    ? serviceIdsStr.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : serviceId
      ? [parseInt(serviceId, 10)].filter(n => !isNaN(n))
      : [];
  const cids = contractIdsStr
    ? contractIdsStr.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : contractId
      ? [parseInt(contractId, 10)].filter(n => !isNaN(n))
      : [];

  // Parse per-service prices stored in checkout session metadata
  const servicePricesList: number[] = servicePricesStr
    ? servicePricesStr.split(",").map(p => parseFloat(p.trim())).filter(n => !isNaN(n))
    : [];
  // Fallback: distribute session.amount_total equally when no per-service prices available
  const sessionTotalCents = session.amount_total;

  // Legacy single-value fallback for backwards compat
  const sid = sids[0] ?? NaN;
  const cid = cids[0] ?? NaN;

  if (isNaN(uid) || sids.length === 0) {
    req.log.error({ userId, serviceIds: serviceIdsStr ?? serviceId }, "provisionOnboardingProject: invalid metadata ids");
    return;
  }

  // ── Idempotency: skip if already processed ────────────────────────────────
  const [existingInvoice] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.stripeSessionId, session.id));
  if (existingInvoice) {
    req.log.info({ sessionId: session.id }, "onboarding_purchase: already processed, skipping");
    return;
  }

  // Fetch all services for this session (ordered by sids)
  const fetchedServices = sids.length > 0
    ? await db.select().from(servicesTable)
        .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(sids.map(id => sql`${id}`), sql`, `)}]::int[])`)
    : [];
  const serviceMap = new Map(fetchedServices.map(s => [s.id, s]));

  const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
  if (fetchedServices.length === 0 || !buyer) {
    req.log.error({ sids, uid }, "provisionOnboardingProject: services or buyer not found");
    return;
  }

  // Ordered service list matching sids order
  const orderedServices = sids.map(id => serviceMap.get(id)).filter(Boolean) as typeof fetchedServices;
  const serviceNames = orderedServices.map(s => s.name);
  // Use per-service prices from metadata when available; fall back to session total or DB price
  const totalAmountDollars = servicePricesList.length > 0
    ? servicePricesList.reduce((sum, p) => sum + p, 0).toFixed(2)
    : sessionTotalCents != null
      ? (sessionTotalCents / 100).toFixed(2)
      : orderedServices.reduce((sum, s) => sum + (s.price ? parseFloat(String(s.price)) : 0), 0).toFixed(2);

  // Parse optional start date from checkout metadata; default to now
  const rawStart = session.metadata?.startDate;
  const parsedStart = rawStart ? new Date(rawStart) : new Date();
  const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;

  // ── Create one project workspace covering all services in this session ─────
  const projectTitle = serviceNames.join(" + ");
  const [project] = await db.insert(projectsTable).values({
    title: projectTitle,
    description: orderedServices.length === 1
      ? (orderedServices[0].description ?? null)
      : `Engagement covering: ${serviceNames.join(", ")}`,
    status: "active",
    phase: "Kickoff",
    progress: 0,
    clientUserId: uid,
    startDate,
  }).returning();

  // ── Look up workflow template steps for the primary service directly ──────
  const primaryService = orderedServices[0];
  const resolvedWorkflowTemplateId = primaryService?.workflowTemplateId ?? null;

  // Workflow template steps (each step owns its task templates)
  let workflowTemplateSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
  if (resolvedWorkflowTemplateId) {
    workflowTemplateSteps = await db
      .select()
      .from(workflowTemplateStepsTable)
      .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
      .orderBy(asc(workflowTemplateStepsTable.order));
  }

  // ── Loop over every service: assign clientService, link contract, create invoice ──
  for (let i = 0; i < orderedServices.length; i++) {
    const svc = orderedServices[i];
    const cid = cids[i] ?? NaN;
    // Prefer per-service price from session metadata; fall back to session total ÷ services, then DB price
    const metaPrice = servicePricesList[i];
    const svcAmount = metaPrice != null && !isNaN(metaPrice)
      ? metaPrice.toFixed(2)
      : sessionTotalCents != null
        ? (sessionTotalCents / 100 / orderedServices.length).toFixed(2)
        : svc.price ? parseFloat(String(svc.price)).toFixed(2) : "0.00";

    // Assign service to client
    const [newCs] = await db.insert(clientServicesTable).values({
      clientUserId: uid,
      serviceId: svc.id,
      projectId: project.id,
      status: "active",
      progress: 0,
      startDate,
      stripeSubscriptionId: svc.billingType === "recurring_monthly" ? (stripeSubscriptionId ?? null) : null,
    }).returning();

    // ── Seed workflow steps for this client service ────────────────────────
    if (i === 0 && workflowTemplateSteps.length > 0) {
      // New: steps come from workflow template; first step auto-starts in_progress
      const createdSteps = await db.insert(workflowStepsTable).values(
        workflowTemplateSteps.map((s, idx) => ({
          clientServiceId: newCs.id,
          projectId: project.id,
          title: s.title,
          description: s.description ?? "",
          status: idx === 0 ? ("in_progress" as const) : ("pending" as const),
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
          await db.insert(kanbanTasksTable).values(
            step1Tasks.map((t, idx) => ({
              projectId: project.id,
              workflowStepId: firstStep.id,
              groupName: t.groupName ?? null,
              title: t.title,
              description: t.description ?? null,
              column: "backlog" as const,
              order: idx,
            }))
          );
        }
      }

    } else {
      await seedDefaultWorkflowSteps(newCs.id, project.id, svc.slug ?? "");
    }

    // Link contract → project and attach pre-generated PDF as document
    if (!isNaN(cid)) {
      const contractRecord = await db.select().from(contractsTable)
        .where(eq(contractsTable.id, cid))
        .then(r => r[0]);

      await db.update(contractsTable)
        .set({ projectId: project.id, stripeSessionId: session.id })
        .where(eq(contractsTable.id, cid));

      const pdfFilename = contractRecord?.pdfFilename;
      if (pdfFilename) {
        await db.insert(documentsTable).values({
          projectId: project.id,
          name: `Signed Service Agreement — ${svc.name}`,
          filename: pdfFilename,
          mimeType: "application/pdf",
          uploadedBy: uid,
        });
      }
    }

    // Create paid invoice for this service.
    // Only the first invoice gets stripeSessionId (idempotency guard reads it).
    await db.insert(invoicesTable).values({
      clientUserId: uid,
      projectId: project.id,
      invoiceNumber: `ONB-${Date.now()}-${i}`,
      description: `${svc.name} — self-service purchase${svc.billingType === "recurring_monthly" ? " (month 1)" : ""}`,
      amount: svcAmount,
      currency: "usd",
      status: "paid",
      paidAt: new Date(),
      stripeSessionId: i === 0 ? session.id : null,
    });
  }

  // ── Notify admins ─────────────────────────────────────────────────────────
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    await db.insert(notificationsTable).values({
      userId: admin.id,
      title: `New onboarding purchase: ${serviceNames.join(", ")}`,
      body: `${buyer.name ?? buyer.email} purchased ${serviceNames.length > 1 ? serviceNames.join(" + ") : `"${serviceNames[0]}"`} ($${totalAmountDollars}). Project #${project.id} auto-created.`,
      type: "general",
      linkPath: `/dashboard`,
    });
  }

  // ── Notify client ─────────────────────────────────────────────────────────
  await db.insert(notificationsTable).values({
    userId: uid,
    title: `Your project is ready: ${serviceNames.join(", ")}`,
    body: `Payment confirmed. Your project workspace has been created. Shane will be in touch within 1 business day to schedule your kickoff call.`,
    type: "project_update",
    linkPath: `/portal/projects/${project.id}`,
  });

  // ── Welcome message thread ────────────────────────────────────────────────
  const [adminUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);
  if (adminUser) {
    const serviceLabel = serviceNames.length === 1
      ? serviceNames[0]
      : serviceNames.join(" + ");
    await db.insert(messagesTable).values({
      clientUserId: uid,
      senderUserId: adminUser.id,
      body: `Welcome! 👋\n\nPayment confirmed for: ${serviceLabel}. Your project workspace is ready. I'll be in touch within 1 business day to schedule your kickoff call and confirm any access requirements.\n\nIf you have any questions in the meantime, feel free to message me here.\n\n— Shane`,
      readByClient: false,
      readByAdmin: true,
    });
  }

  // ── SharePoint site provisioning (fire-and-forget, non-blocking) ─────────
  void import("./admin-sharepoint").then(({ provisionProjectSite }) => {
    provisionProjectSite(project.id, projectTitle, req.log).catch(() => null);
  }).catch(() => null);

  // ── Confirmation email to client (fire-and-forget) ────────────────────────
  const primaryServiceName = serviceNames.join(", ");
  if (buyer.email) {
    sendEmail(
      buyer.email,
      `Your ${primaryServiceName} project is ready — next steps inside`,
      onboardingConfirmationEmail({
        clientName: buyer.name ?? "",
        serviceName: primaryServiceName,
        amountDollars: totalAmountDollars,
        projectId: project.id,
      }),
    ).catch(() => null);
  }

  // ── Admin notification email (fire-and-forget) ─────────────────────────────
  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    sendEmail(
      adminEmailAddr,
      `New onboarding purchase: ${primaryServiceName} — $${totalAmountDollars}`,
      adminPurchaseAlertEmail({
        clientName: buyer.name ?? "",
        clientEmail: buyer.email,
        serviceName: primaryServiceName,
        amountDollars: totalAmountDollars,
        type: "onboarding_purchase",
        projectId: project.id,
      }),
    ).catch(() => null);
  }
}

// ─── Default workflow step templates (mirrors Dashboard2 mock labels) ────────
// Slug matching is substring-based so "m365-health-check" hits the m365 bucket,
// "security-audit" hits security, "cloud-migration" hits migration, etc.
function getDefaultSteps(slug: string): Array<{ title: string; description: string }> {
  const s = slug.toLowerCase();

  if (s.includes("m365") || s.includes("microsoft-365") || s.includes("microsoft365") || s.includes("health-check")) {
    return [
      { title: "Access", description: "Client provisions required read-only admin access or tenant data exports." },
      { title: "Schedule", description: "Kickoff call scheduled to confirm scope, timeline, and key contacts." },
      { title: "Execute", description: "Shane runs automated and manual checks across the M365 environment." },
      { title: "Review", description: "Initial findings reviewed internally; data validated for accuracy." },
      { title: "Assessments", description: "Deep-dive assessments run against flagged areas identified during execution." },
      { title: "Report", description: "Health Check Report drafted with prioritised findings and remediation roadmap." },
      { title: "Debrief", description: "60-minute debrief call to walk through report findings and answer questions." },
      { title: "End", description: "Final report delivered. Engagement closed and next steps agreed." },
    ];
  }

  if (s.includes("security") || s.includes("audit")) {
    return [
      { title: "Intake", description: "Intake call to confirm scope, tenant access requirements, and risk appetite." },
      { title: "Scope", description: "Scope document agreed and signed off; access credentials provisioned." },
      { title: "Scan", description: "Automated and manual security scans run across the M365 tenant." },
      { title: "Analyze", description: "Findings categorised by severity (Critical / High / Medium / Low) with NIST alignment." },
      { title: "Validate", description: "Results validated and false positives filtered before drafting the report." },
      { title: "Findings", description: "Draft audit findings report shared with the client for review and corrections." },
      { title: "Strategy", description: "Remediation strategy and prioritised action plan agreed with the client." },
      { title: "Close", description: "Final audit report delivered with optional 60-minute debrief call." },
    ];
  }

  if (s.includes("migration") || s.includes("cloud") || s.includes("azure")) {
    return [
      { title: "Discovery", description: "Current environment inventory, dependencies, and constraints documented." },
      { title: "Assessment", description: "Workloads assessed for cloud readiness; risk and effort estimated." },
      { title: "Pilot", description: "Low-risk workload migrated as a proof-of-concept to validate approach." },
      { title: "Planning", description: "Full migration plan finalised — wave schedule, rollback steps, comms plan." },
      { title: "Migration", description: "Workloads migrated in agreed waves with continuous monitoring." },
      { title: "Testing", description: "Post-migration testing: functionality, performance, and security validation." },
      { title: "Go-Live", description: "Cutover to production; legacy environment decommissioned on confirmation." },
      { title: "Support", description: "Hypercare support window — issues resolved and knowledge transferred." },
    ];
  }

  if (s.includes("copilot")) {
    return [
      { title: "Intake", description: "Intake call to understand team roles, workflows, and key productivity pain points." },
      { title: "Scope", description: "Use-case shortlist agreed; licensing and data governance posture reviewed." },
      { title: "Discovery", description: "Client provides sample tasks and documents for prompt discovery." },
      { title: "Prompts", description: "Prompts written, tested, and refined across Word, Excel, Teams, Outlook, and Loop." },
      { title: "Validation", description: "Prompts validated with real client workflows and edge cases resolved." },
      { title: "Delivery", description: "Prompt library built as a SharePoint page or Word document and delivered." },
      { title: "Training", description: "Short video walkthrough recorded and prompt-maintenance guidance shared." },
      { title: "Close", description: "Engagement closed; 30-day follow-up window opens for questions." },
    ];
  }

  if (s.includes("sharepoint")) {
    return [
      { title: "Discovery", description: "60-minute discovery call to capture requirements, stakeholders, and success criteria." },
      { title: "Requirements", description: "Structured workshop to capture navigation, content types, audience, and governance rules." },
      { title: "Design", description: "Information architecture, site map, and global navigation design produced." },
      { title: "Review", description: "IA and wireframes reviewed with the client; feedback incorporated." },
      { title: "Build", description: "SharePoint sites and pages built to approved designs in the client tenant." },
      { title: "Testing", description: "User acceptance testing with key stakeholders; issues resolved." },
      { title: "Launch", description: "Intranet launched to the organisation with communications support." },
      { title: "Handover", description: "Full blueprint document and owner training delivered; engagement closed." },
    ];
  }

  if (s.includes("power")) {
    return [
      { title: "Discovery", description: "30-minute call to identify the highest-value process to automate." },
      { title: "Scope", description: "Process mapped end-to-end; automation boundaries and triggers agreed." },
      { title: "Design", description: "Solution design document produced and approved before build begins." },
      { title: "Build", description: "Power Automate flow (or app) built and unit-tested by Shane." },
      { title: "Test", description: "Flow tested in a staging environment with realistic data." },
      { title: "Refine", description: "Client feedback incorporated; edge cases and error handling added." },
      { title: "Deploy", description: "Solution deployed to production and smoke-tested end-to-end." },
      { title: "Handover", description: "Live walkthrough, documentation, and 30-day support window activated." },
    ];
  }

  // Generic fallback
  return [
    { title: "Kickoff", description: "Initial call to align on scope, deliverables, and timeline." },
    { title: "Discovery", description: "Information gathering, requirements review, and access provisioning." },
    { title: "Planning", description: "Detailed work plan produced and agreed with the client." },
    { title: "Execution", description: "Core engagement work carried out according to the agreed plan." },
    { title: "Review", description: "Draft outputs shared with the client for review and feedback." },
    { title: "Delivery", description: "Final deliverables produced and shared with the client." },
    { title: "Sign-off", description: "Client confirms acceptance of all deliverables." },
    { title: "Close", description: "Engagement closed; next steps and any follow-on work agreed." },
  ];
}

/**
 * Seed default workflow steps for a newly activated client service.
 * Idempotent: skips insertion if steps already exist for this clientServiceId.
 */
async function seedDefaultWorkflowSteps(
  clientServiceId: number,
  projectId: number | null,
  serviceSlug: string,
): Promise<void> {
  // Check if steps already exist for this client service
  const existing = await db
    .select({ id: workflowStepsTable.id })
    .from(workflowStepsTable)
    .where(eq(workflowStepsTable.clientServiceId, clientServiceId))
    .limit(1);

  if (existing.length > 0) return; // already seeded

  const steps = getDefaultSteps(serviceSlug);
  await db.insert(workflowStepsTable).values(
    steps.map((s, i) => ({
      clientServiceId,
      projectId: projectId ?? null,
      title: s.title,
      description: s.description,
      status: "pending" as const,
      order: i + 1,
    }))
  );
}

// ── Stripe webhook handler ───────────────────────────────────────────────────
// RUNBOOK: Stripe Dashboard webhook endpoints ↔ Replit Secrets
//
//  Endpoint URL                                    | Signing secret (Replit Secret)
//  ------------------------------------------------+--------------------------------
//  https://<your>.replit.dev/api/portal/stripe/webhook  | STRIPE_WEBHOOK_SECRET
//  https://shanemccaw.com/api/portal/stripe/webhook     | STRIPE_WEBHOOK_SECRET_PROD
//
//  To verify or auto-repair these registrations after a redeploy, run:
//    pnpm --filter @workspace/scripts run sync-webhooks          # check only
//    pnpm --filter @workspace/scripts run sync-webhooks -- --fix # check + auto-create
//
//  The script reads REPLIT_DOMAINS (set automatically by Replit in production)
//  and STRIPE_SECRET_KEY, then compares against registered Stripe endpoints.
//
//  If you change the webhook path or add a new domain, re-run the script.
//
// NOTE: app.ts registers express.raw() for this path before express.json(), so req.body is a raw Buffer here.
// Supports two signing secrets simultaneously:
//   STRIPE_WEBHOOK_SECRET     — dev endpoint (*.replit.dev)
//   STRIPE_WEBHOOK_SECRET_PROD — prod endpoint (shanemccaw.com)
// The handler tries each configured secret and accepts the event if any one verifies.
router.post("/portal/stripe/webhook", async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) { res.status(503).send("Stripe not configured. Set STRIPE_SECRET_KEY."); return; }

  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_PROD,
  ].filter(Boolean) as string[];

  if (secrets.length === 0) {
    res.status(503).send("Stripe webhook not configured. Set STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_PROD.");
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let event: import("stripe").Stripe.Event | null = null;
  const sig = req.headers["stripe-signature"] as string;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
      break;
    } catch {
      // try next secret
    }
  }

  if (!event) {
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  // ── Acknowledge immediately so Stripe doesn't retry on slow provisioning ──
  res.json({ received: true });

  // ── Process event asynchronously (after response is flushed) ─────────────
  setImmediate(() => {
    void processStripeEvent(req, event).catch((err: unknown) => {
      req.log.error({ err, eventType: event.type }, "processStripeEvent: unhandled error");
    });
  });
});

async function processStripeEvent(req: Request, event: import("stripe").Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;

    // Invoice payment
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId && session.payment_status === "paid") {
      const parsedInvoiceId = parseInt(invoiceId, 10);
      const [paidInvoice] = await db.update(invoicesTable)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(eq(invoicesTable.id, parsedInvoiceId))
        .returning();
      if (paidInvoice) {
        void createAuditLog({
          actorUserId: paidInvoice.clientUserId ?? undefined,
          actorName: session.customer_details?.name ?? session.customer_email ?? "Client",
          actorRole: "client",
          actionType: "invoice_paid",
          entityType: "invoice",
          entityId: parsedInvoiceId,
          entityLabel: paidInvoice.description ?? `Invoice #${parsedInvoiceId}`,
          clientId: paidInvoice.clientUserId ?? undefined,
          projectId: paidInvoice.projectId ?? undefined,
          metadata: { amountDollars: paidInvoice.amount, stripeSessionId: session.id },
        });
      }
    }

    // Service purchase — notify admin, create invoice record
    if (session.metadata?.type === "service_purchase" && session.payment_status === "paid") {
      const { userId, serviceName, serviceCategory, servicePriceInCents } = session.metadata;
      const uid = parseInt(userId, 10);
      const amountDollars = (parseInt(servicePriceInCents, 10) / 100).toFixed(2);

      // Create a paid invoice so it shows in billing history
      const [newInvoice] = await db.insert(invoicesTable).values({
        clientUserId: uid,
        invoiceNumber: `SVC-${Date.now()}`,
        description: `${serviceName} — purchased via portal`,
        amount: amountDollars,
        currency: "usd",
        status: "paid",
        paidAt: new Date(),
        stripeSessionId: session.id,
      }).returning({ id: invoicesTable.id });

      // Notify the admin user(s)
      const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
      const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
      for (const admin of admins) {
        await db.insert(notificationsTable).values({
          userId: admin.id,
          title: `New service purchase: ${serviceName}`,
          body: `${buyer?.email ?? "A client"} purchased "${serviceName}" ($${amountDollars}). Please activate the service in their portal.`,
          type: "general",
          linkPath: "/portal/services",
        });
      }

      // Send branded confirmation email to buyer (fire-and-forget)
      if (buyer?.email) {
        sendEmail(
          buyer.email,
          `Your purchase of "${serviceName}" is confirmed`,
          purchaseConfirmationEmail({
            clientName: buyer.name ?? "",
            serviceName,
            amountDollars,
          }),
        ).catch(() => null);
      }

      // Send admin notification email (fire-and-forget)
      const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
      if (adminEmail) {
        sendEmail(
          adminEmail,
          `New purchase: ${serviceName} — $${amountDollars}`,
          adminPurchaseAlertEmail({
            clientName: buyer?.name ?? "",
            clientEmail: buyer?.email ?? "",
            serviceName,
            amountDollars,
            type: "service_purchase",
          }),
        ).catch(() => null);
      }

      // Audit log
      void createAuditLog({
        actorUserId: uid,
        actorName: buyer?.name ?? buyer?.email ?? "Client",
        actorRole: "client",
        actionType: "service_purchased",
        entityType: "service",
        entityId: session.metadata?.serviceId ?? null,
        entityLabel: serviceName,
        clientId: uid,
        metadata: { amount: amountDollars, category: serviceCategory },
      });

      // SMS alert to Shane
      sendAdminSms(
        `New order: ${buyer?.name ?? buyer?.email ?? "A client"} — ${serviceName} — $${amountDollars}`,
      ).catch(() => null);

      // Push notification to Shane's devices
      db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
        .then(async (rows) => {
          const tokens = rows.map((r) => r.token);
          // Unread messages + 1 for this new order gives an accurate cumulative badge
          const badge = await getAdminUnreadMessageCount() + 1;
          return sendPushNotifications(
            tokens,
            "New Order",
            `${buyer?.name ?? buyer?.email ?? "Client"} — ${serviceName} — $${amountDollars}`,
            { screen: "order", id: String(newInvoice?.id ?? "") },
            undefined,
            badge,
          );
        })
        .catch(() => null);
    }

    // Onboarding purchase — auto-provision project + workflow steps
    if (session.metadata?.type === "onboarding_purchase" && session.payment_status === "paid") {
      const subId = typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription as { id?: string } | null)?.id ?? null;
      await provisionOnboardingProject(req, session, subId);

      // SMS alert to Shane — look up buyer + services after provisioning
      try {
        const uid = parseInt(session.metadata?.userId ?? "", 10);
        const [buyer] = isNaN(uid) ? [] : await db.select().from(usersTable).where(eq(usersTable.id, uid));
        const sidsStr = session.metadata?.serviceIds ?? session.metadata?.serviceId ?? "";
        const sids = sidsStr.split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        let serviceLabel = "Onboarding";
        if (sids.length > 0) {
          const svcs = await db.select({ name: servicesTable.name }).from(servicesTable)
            .where(inArray(servicesTable.id, sids));
          if (svcs.length > 0) serviceLabel = svcs.map(s => s.name).join(", ");
        }
        const totalDollars = session.amount_total ? (session.amount_total / 100).toFixed(2) : "—";
        sendAdminSms(
          `New order: ${buyer?.name ?? buyer?.email ?? "A client"} — ${serviceLabel} — $${totalDollars}`,
        ).catch(() => null);

        // Push notification to Shane's devices — look up the invoice ID created during provisioning
        const buyerLabel = buyer?.name ?? buyer?.email ?? "A client";
        db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
          .then(async (rows) => {
            const tokens = rows.map((r) => r.token);
            // Find the first invoice for this session so the push can deep-link to it
            const [firstInv] = await db
              .select({ id: invoicesTable.id })
              .from(invoicesTable)
              .where(eq(invoicesTable.stripeSessionId, session.id))
              .limit(1);
            const pushData: Record<string, string> = firstInv?.id
              ? { screen: "order", id: String(firstInv.id) }
              : { screen: "orders" };
            // Unread messages + 1 for this new order gives an accurate cumulative badge
            const badge = await getAdminUnreadMessageCount() + 1;
            return sendPushNotifications(
              tokens,
              "New Order",
              `${buyerLabel} — ${serviceLabel} — $${totalDollars}`,
              pushData,
              undefined,
              badge,
            );
          })
          .catch(() => null);
      } catch {
        // SMS/push failure must never break provisioning
      }
    }
  }
}

// ─── CLIENT: Messages ────────────────────────────────────────────────────────
router.get("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";

  if (isAdmin) {
    const clientId = parseInt(String(req.query.clientId ?? ""), 10);
    if (isNaN(clientId)) { res.status(400).json({ error: "clientId required for admin" }); return; }
    const [clientUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
    if (!clientUser) { res.status(404).json({ error: "Client not found" }); return; }
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.clientUserId, clientId))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByAdmin: true }).where(and(eq(messagesTable.clientUserId, clientId), eq(messagesTable.readByAdmin, false)));
    res.json(messages);
  } else {
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.clientUserId, userId))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByClient: true }).where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));
    res.json(messages);
  }
});

router.post("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const senderId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const { body, clientId } = req.body as { body?: string; clientId?: number };

  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  const clientUserId = isAdmin ? Number(clientId) : senderId;
  if (!clientUserId || isNaN(clientUserId)) { res.status(400).json({ error: "clientId required" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    clientUserId,
    senderUserId: senderId,
    body: body.trim(),
    readByAdmin: isAdmin,
    readByClient: !isAdmin,
  }).returning();

  // When admin replies, mark all unread client messages in this conversation as read
  if (isAdmin) {
    await db.update(messagesTable)
      .set({ readByAdmin: true })
      .where(and(eq(messagesTable.clientUserId, clientUserId), eq(messagesTable.readByAdmin, false)));
  }

  // Create in-app notification + email for the other party
  if (isAdmin) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: "New message from Shane",
      body: body.trim().slice(0, 100),
      type: "message",
      linkPath: "/portal/messages",
    });
    // Email the client
    const [clientUser] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, clientUserId)).limit(1);
    if (clientUser) {
      void sendEmail(clientUser.email, "New message from Shane McCaw Consulting", `
        <p>Hello ${clientUser.name ?? ""},</p>
        <p>You have a new message from Shane McCaw Consulting:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
        <p><a href="https://shanemccaw.consulting/crm/portal/messages" style="color:#0078D4;font-weight:bold;">View in your portal →</a></p>
      `);
    }
  } else {
    const [adminUser] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    if (adminUser) {
      await db.insert(notificationsTable).values({
        userId: adminUser.id,
        title: "New client message",
        body: body.trim().slice(0, 100),
        type: "message",
        linkPath: `/dashboard/messages?clientId=${senderId}`,
      });
      // Email the admin
      const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
      void sendEmail(adminUser.email, `New client message from ${clientUser?.name ?? clientUser?.email ?? "a client"}`, `
        <p>Hello Shane,</p>
        <p>${clientUser?.name ?? "A client"} sent a new message:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
      `);
      // Push notification to Shane's devices
      const clientName = clientUser?.name ?? clientUser?.email ?? "A client";
      db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
        .then(async (rows) => {
          const tokens = rows.map((r) => r.token);
          // The new message is already in the DB (readByAdmin = false), so the count
          // naturally includes it — this gives an accurate cumulative unread badge.
          const badge = await getAdminUnreadMessageCount();
          return sendPushNotifications(
            tokens,
            "New Client Message",
            `${clientName}: ${body.trim().slice(0, 80)}`,
            { screen: "conversation", clientId: String(senderId) },
            "MESSAGE",
            badge,
          );
        })
        .catch(() => null);
    }
  }

  res.status(201).json(msg);
});

// ─── CLIENT: Notifications ───────────────────────────────────────────────────
router.get("/portal/notifications", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(notifications);
});

router.patch("/portal/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.update(notificationsTable).set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.json({ ok: true });
});

router.post("/portal/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await db.update(notificationsTable).set({ read: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));
  res.json({ ok: true });
});

// ─── ADMIN: Clients ──────────────────────────────────────────────────────────
router.get("/admin/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select().from(usersTable)
    .where(eq(usersTable.role, "client"))
    .orderBy(desc(usersTable.createdAt));
  res.json(clients.map(c => ({ ...c, passwordHash: undefined })));
});

router.post("/admin/clients", requireAdmin, async (req: Request, res: Response) => {
  const { email, name, company, phone, password } = req.body as { email?: string; name?: string; company?: string; phone?: string; password?: string };
  if (!email || !password) { res.status(400).json({ error: "email and password are required" }); return; }

  const { default: bcrypt } = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(password, 12);

  const [client] = await db.insert(usersTable).values({
    email: email.toLowerCase().trim(),
    passwordHash,
    role: "client",
    name: name ?? null,
    company: company ?? null,
    phone: phone ?? null,
  }).returning();

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "client_created",
    entityType: "user",
    entityId: client.id,
    entityLabel: client.name ?? client.email,
  });

  res.status(201).json({ ...client, passwordHash: undefined });
});

router.patch("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { name, company, phone, email } = req.body as { name?: string; company?: string; phone?: string; email?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (company !== undefined) updates.company = company;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email.toLowerCase().trim();

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).returning();
  if (!updated) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ ...updated, passwordHash: undefined });
});

router.delete("/admin/clients/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [client] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"))).limit(1);
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    const clientProjectRows = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.clientUserId, id));
    const projectIds = clientProjectRows.map(p => p.id);

    const clientSvcRows = await db.select({ id: clientServicesTable.id }).from(clientServicesTable)
      .where(eq(clientServicesTable.clientUserId, id));
    const clientSvcIds = clientSvcRows.map(s => s.id);

    if (projectIds.length > 0) {
      await db.delete(kanbanTasksTable).where(inArray(kanbanTasksTable.projectId, projectIds));
      await db.delete(projectUpdatesTable).where(inArray(projectUpdatesTable.projectId, projectIds));
      await db.delete(documentsTable).where(inArray(documentsTable.projectId, projectIds));
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.projectId, projectIds));
    }
    if (clientSvcIds.length > 0) {
      await db.delete(workflowStepsTable).where(inArray(workflowStepsTable.clientServiceId, clientSvcIds));
    }
    await db.delete(clientServicesTable).where(eq(clientServicesTable.clientUserId, id));
    await db.delete(contractsTable).where(eq(contractsTable.userId, id));
    await db.delete(reportsTable).where(eq(reportsTable.clientUserId, id));
    await db.delete(invoicesTable).where(eq(invoicesTable.clientUserId, id));
    await db.delete(messagesTable).where(eq(messagesTable.clientUserId, id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
    await db.delete(impersonationTokensTable).where(eq(impersonationTokensTable.clientUserId, id));
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, id));
    if (projectIds.length > 0) {
      await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));

    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// ─── ADMIN: Impersonation ────────────────────────────────────────────────────
router.post("/admin/impersonate/:userId", requireAdmin, async (req: Request, res: Response) => {
  const userId = parseInt(String(req.params.userId ?? ""), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [client] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.role, "client")))
    .limit(1);
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  const adminId = req.user!.id;
  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(impersonationTokensTable).values({
    token,
    clientUserId: client.id,
    adminUserId: adminId,
    expiresAt,
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "admin_impersonated",
    entityType: "user",
    entityId: client.id,
    entityLabel: client.name ?? client.email,
  });

  res.json({ token, client: { id: client.id, email: client.email, name: client.name } });
});

// ─── ADMIN: Projects ─────────────────────────────────────────────────────────
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
  const { title, description, status, phase, progress, clientUserId, startDate, endDate, projectType } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number; startDate?: string; endDate?: string; projectType?: string;
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
    projectType: (projectType === "retainer" ? "retainer" : "project") as "project" | "retainer",
  }).returning();

  // Notify client
  if (clientUserId) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: `New project started: ${title}`,
      body: description?.slice(0, 100) ?? null,
      type: "project_update",
      linkPath: `/portal/projects/${project.id}`,
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
  if (projectType !== undefined) updates.projectType = (projectType === "retainer" ? "retainer" : "project") as "project" | "retainer";

  const [updated] = await db.update(projectsTable).set(updates).where(eq(projectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }
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

// ─── ADMIN: Workflow Steps ───────────────────────────────────────────────────
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

  res.json(updated);
});

// ─── ADMIN: Kanban Tasks ─────────────────────────────────────────────────────
router.get("/admin/kanban-tasks", requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.query.projectId ? parseInt(String(req.query.projectId), 10) : null;
  if (!projectId || isNaN(projectId)) { res.status(400).json({ error: "projectId query param required" }); return; }
  const tasks = await db.select().from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId))
    .orderBy(asc(kanbanTasksTable.order));
  res.json(tasks);
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
  if (taskMetadata !== undefined) updates.taskMetadata = taskMetadata ?? null;

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }

  const [taskProject] = updated.projectId
    ? await db.select({ clientUserId: projectsTable.clientUserId }).from(projectsTable).where(eq(projectsTable.id, updated.projectId))
    : [];

  // Auto-progression: when a task is completed, check if its workflow step is done
  if (updates.column === "completed" && updated.workflowStepId) {
    const allStepTasks = await db.select().from(kanbanTasksTable)
      .where(eq(kanbanTasksTable.workflowStepId, updated.workflowStepId));
    const allDone = allStepTasks.length > 0 && allStepTasks.every(t => t.column === "completed");
    if (allDone) {
      const [completedStep] = await db.update(workflowStepsTable)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(workflowStepsTable.id, updated.workflowStepId))
        .returning();

      if (completedStep?.projectId) {
        const allProjectSteps = await db.select().from(workflowStepsTable)
          .where(eq(workflowStepsTable.projectId, completedStep.projectId))
          .orderBy(asc(workflowStepsTable.order));
        const currentIdx = allProjectSteps.findIndex(s => s.id === updated.workflowStepId);
        const nextStep = allProjectSteps[currentIdx + 1];

        if (nextStep && nextStep.status !== "completed") {
          const [activatedStep] = await db.update(workflowStepsTable)
            .set({ status: "in_progress" })
            .where(eq(workflowStepsTable.id, nextStep.id))
            .returning();

          if (activatedStep?.workflowTemplateStepId && activatedStep.projectId) {
            const templateTasks = await db.select().from(workflowTemplateStepTasksTable)
              .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, activatedStep.workflowTemplateStepId))
              .orderBy(asc(workflowTemplateStepTasksTable.order));
            if (templateTasks.length > 0) {
              await db.insert(kanbanTasksTable).values(
                templateTasks.map((t, idx) => ({
                  projectId: activatedStep.projectId!,
                  workflowStepId: activatedStep.id,
                  groupName: t.groupName ?? null,
                  title: t.title,
                  description: t.description ?? null,
                  column: "backlog" as const,
                  order: idx,
                }))
              );
            }
          }

        }
      }
    }
  }

  await syncProjectProgress(updated.projectId);

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
  } else if (title !== undefined || description !== undefined || priority !== undefined) {
    void createAuditLog({
      ...auditBase,
      actionType: "kanban_task_updated",
      metadata: { changedFields: Object.keys(req.body as object).filter(k => ["title","description","priority"].includes(k)) },
    });
  }

  res.json(updated);
});

router.delete("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select({ projectId: kanbanTasksTable.projectId }).from(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
  if (existing?.projectId) await syncProjectProgress(existing.projectId);
  res.json({ deleted: id });
});

// ─── ADMIN: Documents ────────────────────────────────────────────────────────
router.get("/admin/documents", requireAdmin, async (_req: Request, res: Response) => {
  const docs = await db.select().from(documentsTable).orderBy(desc(documentsTable.createdAt));
  res.json(docs);
});

router.post("/admin/documents", requireAdmin, uploadDoc.single("file"), async (req: Request, res: Response) => {
  const { projectId, name } = req.body as { projectId?: string; name?: string };
  if (!req.file || !projectId) { res.status(400).json({ error: "file and projectId are required" }); return; }

  const [doc] = await db.insert(documentsTable).values({
    projectId: parseInt(projectId, 10),
    name: name ?? req.file.originalname,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedBy: req.user!.id,
  }).returning();

  // Notify client
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parseInt(projectId, 10)));
  if (project?.clientUserId) {
    await db.insert(notificationsTable).values({
      userId: project.clientUserId,
      title: "New document uploaded",
      body: name ?? req.file.originalname,
      type: "document",
      linkPath: `/portal/projects/${projectId}`,
    });
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "document_uploaded",
    entityType: "document",
    entityId: doc.id,
    entityLabel: doc.name,
    projectId: doc.projectId ?? undefined,
    clientId: project?.clientUserId ?? undefined,
    metadata: { filename: doc.filename, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes },
  });

  res.status(201).json(doc);
});

router.delete("/admin/documents/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "documents", doc.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.json({ deleted: id });
});

// ─── ADMIN: Reports ──────────────────────────────────────────────────────────
router.get("/admin/reports", requireAdmin, async (_req: Request, res: Response) => {
  const reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt));
  res.json(reports);
});

router.post("/admin/reports", requireAdmin, uploadReport.single("file"), async (req: Request, res: Response) => {
  const { clientUserId, projectId, title, period, reportDate } = req.body as {
    clientUserId?: string; projectId?: string; title?: string; period?: string; reportDate?: string;
  };
  if (!req.file || !clientUserId || !title) { res.status(400).json({ error: "file, clientUserId, and title are required" }); return; }

  const validPeriods = ["weekly", "monthly", "executive_summary", "other"];
  const [report] = await db.insert(reportsTable).values({
    clientUserId: parseInt(clientUserId, 10),
    projectId: projectId ? parseInt(projectId, 10) : null,
    title,
    period: (validPeriods.includes(period ?? "") ? period : "other") as "weekly" | "monthly" | "executive_summary" | "other",
    filename: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    reportDate: reportDate ? new Date(reportDate) : null,
  }).returning();

  await db.insert(notificationsTable).values({
    userId: parseInt(clientUserId, 10),
    title: `New report available: ${title}`,
    body: null,
    type: "general",
    linkPath: "/portal/reports",
  });

  res.status(201).json(report);
});

router.delete("/admin/reports/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  const filePath = path.join(UPLOADS_BASE, "reports", report.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.json({ deleted: id });
});

// ─── CLIENT: Status Reports (published only) ─────────────────────────────────
router.get("/portal/status-reports", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.clientUserId, userId), eq(statusReportsTable.reportStatus, "sent")))
    .orderBy(desc(statusReportsTable.sentAt));
  res.json(reports);
});

router.get("/portal/status-reports/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [report] = await db.select().from(statusReportsTable)
    .where(and(eq(statusReportsTable.id, id), eq(statusReportsTable.clientUserId, userId), eq(statusReportsTable.reportStatus, "sent")));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  res.json(report);
});

router.patch("/portal/status-reports/:id/acknowledge", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, question } = req.body as { status?: string; question?: string };
  if (status !== "accepted" && status !== "has_questions") {
    res.status(400).json({ error: "status must be 'accepted' or 'has_questions'" });
    return;
  }
  if (status === "has_questions" && !question?.trim()) {
    res.status(400).json({ error: "question is required when status is 'has_questions'" });
    return;
  }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  // Guard: only allow transition from pending (prevents duplicate kanban tasks on re-submission)
  if (report.clientStatus !== "pending") {
    res.status(409).json({ error: "Report has already been acknowledged" });
    return;
  }

  // Atomically update the report and (if has_questions) insert the kanban task
  const updated = await db.transaction(async (tx) => {
    const [updatedReport] = await tx.update(statusReportsTable)
      .set({
        clientStatus: status as "accepted" | "has_questions",
        clientQuestion: status === "has_questions" ? (question ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(statusReportsTable.id, id))
      .returning();

    if (status === "has_questions" && report.projectId && question?.trim()) {
      const existingTasks = await tx.select({ order: kanbanTasksTable.order })
        .from(kanbanTasksTable)
        .where(and(eq(kanbanTasksTable.projectId, report.projectId), eq(kanbanTasksTable.column, "backlog")))
        .orderBy(desc(kanbanTasksTable.order))
        .limit(1);
      const nextOrder = (existingTasks[0]?.order ?? 0) + 1;
      await tx.insert(kanbanTasksTable).values({
        projectId: report.projectId,
        title: `Client question: ${report.title}`,
        description: question.trim(),
        column: "backlog",
        order: nextOrder,
        statusReportId: id,
      });
    }

    return updatedReport;
  });

  res.json(updated);
});

// ─── PORTAL: Resolve Status Report (after reading Shane's reply) ─────────────

router.post("/portal/status-reports/:id/resolve", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }

  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "Report is not in has_questions state" });
    return;
  }
  if (!report.adminReply) {
    res.status(409).json({ error: "Cannot resolve: consultant has not replied yet" });
    return;
  }

  const [updated] = await db.update(statusReportsTable)
    .set({ clientStatus: "accepted", updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "status_report_resolved",
    entityType: "status_report",
    entityId: id,
    entityLabel: report.title,
    projectId: report.projectId ?? undefined,
    clientId: userId,
  });

  res.json(updated);
});

// ─── PORTAL: Client follow-up reply to a thread ──────────────────────────────

router.post("/portal/status-reports/:id/thread", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [report] = await db.select().from(statusReportsTable)
    .where(and(
      eq(statusReportsTable.id, id),
      eq(statusReportsTable.clientUserId, userId),
      eq(statusReportsTable.reportStatus, "sent"),
    ));
  if (!report) { res.status(404).json({ error: "Not found" }); return; }
  if (report.clientStatus !== "has_questions") {
    res.status(409).json({ error: "Report is not awaiting questions" }); return;
  }
  if (!report.adminReply) {
    res.status(409).json({ error: "Cannot follow up until the consultant has replied" }); return;
  }

  const newMessage = { sender: "client" as const, content: content.trim(), timestamp: new Date().toISOString() };
  const updatedThread = [...(report.replyThread ?? []), newMessage];

  const [updated] = await db.update(statusReportsTable)
    .set({ replyThread: updatedThread, updatedAt: new Date() })
    .where(eq(statusReportsTable.id, id))
    .returning();

  // Notify Shane by email (fire-and-forget)
  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    const [client] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    void sendEmail(
      adminEmailAddr,
      `Client follow-up on status report: ${report.title}`,
      clientThreadReplyEmail({
        clientName: client?.name ?? "",
        reportTitle: report.title,
        replyContent: content.trim(),
        projectId: report.projectId,
      }),
    );
  }

  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "status_report_question",
    entityType: "status_report",
    entityId: report.id,
    entityLabel: report.title,
    clientId: userId,
    projectId: report.projectId ?? null,
  });

  res.json(updated);
});

// ─── ADMIN: Status Report Reply ──────────────────────────────────────────────

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
    await db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `Reply to your question on: ${report.title}`,
      body: "Shane has replied to your question on a status report. View it in your portal.",
      type: "project_update",
      linkPath,
    });

    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email) {
      await sendEmail(
        client.email,
        `Reply to your question on: ${report.title}`,
        statusReportReplyEmail({
          clientName: client.name ?? "",
          reportTitle: report.title,
          adminReply: reply.trim(),
          projectId: report.projectId,
        }),
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
    void db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `New reply on: ${report.title}`,
      body: "Shane has replied to your follow-up message on a status report.",
      type: "project_update",
      linkPath,
    });
    const [client] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, report.clientUserId));
    if (client?.email) {
      void sendEmail(
        client.email,
        `Reply to your follow-up on: ${report.title}`,
        adminThreadReplyEmail({
          clientName: client.name ?? "",
          reportTitle: report.title,
          replyContent: content.trim(),
          projectId: report.projectId,
        }),
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
    await db.insert(notificationsTable).values({
      userId: report.clientUserId,
      title: `New status report: ${report.title}`,
      body: "Your consultant has sent you a project status report. View it in your portal.",
      type: "project_update",
      linkPath: "/portal/projects",
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

// Returns auto-populated data for a given project to pre-fill a new status report
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

// ─── ADMIN: Invoices ─────────────────────────────────────────────────────────
router.get("/admin/invoices", requireAdmin, async (_req: Request, res: Response) => {
  const invoices = await db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt));
  res.json(invoices);
});

router.post("/admin/invoices", requireAdmin, uploadInvoice.single("pdf"), async (req: Request, res: Response) => {
  const { clientUserId, projectId, invoiceNumber, description, amount, currency, dueDate } = req.body as {
    clientUserId?: string; projectId?: string; invoiceNumber?: string; description?: string; amount?: string; currency?: string; dueDate?: string;
  };
  if (!clientUserId || !invoiceNumber || !amount) { res.status(400).json({ error: "clientUserId, invoiceNumber, and amount are required" }); return; }

  const [invoice] = await db.insert(invoicesTable).values({
    clientUserId: parseInt(clientUserId, 10),
    projectId: projectId ? parseInt(projectId, 10) : null,
    invoiceNumber,
    description: description ?? null,
    amount,
    currency: currency ?? "usd",
    status: "due",
    dueDate: dueDate ? new Date(dueDate) : null,
    pdfFilename: req.file?.filename ?? null,
  }).returning();

  await db.insert(notificationsTable).values({
    userId: parseInt(clientUserId, 10),
    title: `New invoice: ${invoiceNumber}`,
    body: `Amount: $${amount}`,
    type: "invoice",
    linkPath: "/portal/billing",
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "invoice_created",
    entityType: "invoice",
    entityId: invoice.id,
    entityLabel: invoice.invoiceNumber,
    clientId: invoice.clientUserId,
    metadata: { amount: invoice.amount },
  });

  res.status(201).json(invoice);
});

router.patch("/admin/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, dueDate } = req.body as { status?: string; dueDate?: string };
  const updates: Partial<typeof invoicesTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (status !== undefined) {
    updates.status = status as "draft" | "due" | "paid" | "overdue";
    if (status === "paid") updates.paidAt = new Date();
  }
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

  const [updated] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (status) {
    void createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "admin",
      actionType: "invoice_status_changed",
      entityType: "invoice",
      entityId: updated.id,
      entityLabel: updated.invoiceNumber,
      clientId: updated.clientUserId,
      metadata: { status },
    });
  }

  res.json(updated);
});

// ─── ADMIN: Services ─────────────────────────────────────────────────────────
router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.name));
  res.json(services);
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [service] = await db.insert(servicesTable).values({
    name, description: description ?? null, category: category ?? null,
    deliverables: deliverables ?? null, price: price ?? null,
    basePrice: basePrice ?? null, maxPrice: maxPrice ?? null,
    durationDays: durationDays ?? null,
  }).returning();
  res.status(201).json(service);
});

router.patch("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { name, description, category, deliverables, price, basePrice, maxPrice, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string;
    price?: string; basePrice?: string; maxPrice?: string; durationDays?: number;
  };
  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (deliverables !== undefined) updates.deliverables = deliverables;
  if (price !== undefined) updates.price = price;
  if (basePrice !== undefined) updates.basePrice = basePrice;
  if (maxPrice !== undefined) updates.maxPrice = maxPrice;
  if (durationDays !== undefined) updates.durationDays = durationDays;
  const [updated] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ─── ADMIN: Get/set order workflow for a service ──────────────────────────────
router.get("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [service] = await db.select({ orderWorkflow: servicesTable.orderWorkflow })
    .from(servicesTable).where(eq(servicesTable.id, id));
  if (!service) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: service.orderWorkflow ?? [] });
});

router.put("/admin/services/:id/workflow", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { workflow } = req.body as { workflow: unknown };
  if (!Array.isArray(workflow)) { res.status(400).json({ error: "workflow must be a non-empty array of steps" }); return; }

  // Validate each step and its options
  const stepIds = new Set<string>();
  for (let si = 0; si < workflow.length; si++) {
    const step = workflow[si] as Record<string, unknown>;
    if (typeof step !== "object" || step === null) {
      res.status(400).json({ error: `step[${si}] must be an object` }); return;
    }
    if (typeof step.id !== "string" || step.id.trim() === "") {
      res.status(400).json({ error: `step[${si}].id must be a non-empty string` }); return;
    }
    if (stepIds.has(step.id)) {
      res.status(400).json({ error: `duplicate step id "${step.id}"` }); return;
    }
    stepIds.add(step.id);
    if (typeof step.title !== "string" || step.title.trim() === "") {
      res.status(400).json({ error: `step[${si}].title must be a non-empty string` }); return;
    }
    if (!Array.isArray(step.options) || step.options.length === 0) {
      res.status(400).json({ error: `step[${si}].options must be a non-empty array` }); return;
    }
    const optionIds = new Set<string>();
    for (let oi = 0; oi < step.options.length; oi++) {
      const opt = step.options[oi] as Record<string, unknown>;
      if (typeof opt !== "object" || opt === null) {
        res.status(400).json({ error: `step[${si}].options[${oi}] must be an object` }); return;
      }
      if (typeof opt.id !== "string" || opt.id.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].id must be a non-empty string` }); return;
      }
      if (optionIds.has(opt.id)) {
        res.status(400).json({ error: `step[${si}] has duplicate option id "${opt.id}"` }); return;
      }
      optionIds.add(opt.id);
      if (typeof opt.label !== "string" || opt.label.trim() === "") {
        res.status(400).json({ error: `step[${si}].options[${oi}].label must be a non-empty string` }); return;
      }
      if (typeof opt.priceAdjustment !== "number" || !isFinite(opt.priceAdjustment)) {
        res.status(400).json({ error: `step[${si}].options[${oi}].priceAdjustment must be a finite number` }); return;
      }
    }
  }

  const [updated] = await db.update(servicesTable)
    .set({ orderWorkflow: workflow as never })
    .where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ workflow: updated.orderWorkflow ?? [] });
});

// ─── ADMIN: Assign service to client ─────────────────────────────────────────
router.post("/admin/client-services", requireAdmin, async (req: Request, res: Response) => {
  const { clientUserId, serviceId, projectId, startDate, nextMilestone, nextMilestoneDate } = req.body as {
    clientUserId?: number; serviceId?: number; projectId?: number; startDate?: string; nextMilestone?: string; nextMilestoneDate?: string;
  };
  if (!clientUserId || !serviceId) { res.status(400).json({ error: "clientUserId and serviceId are required" }); return; }

  const [cs] = await db.insert(clientServicesTable).values({
    clientUserId, serviceId, projectId: projectId ?? null,
    startDate: startDate ? new Date(startDate) : null,
    nextMilestone: nextMilestone ?? null,
    nextMilestoneDate: nextMilestoneDate ? new Date(nextMilestoneDate) : null,
  }).returning();

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId));
  if (service) {
    await db.insert(notificationsTable).values({
      userId: clientUserId,
      title: `Service activated: ${service.name}`,
      body: null, type: "general", linkPath: "/portal/services",
    });

    // Auto-generate project from the service's directly linked workflow template (if any)
    const resolvedWorkflowTemplateId = service.workflowTemplateId ?? null;
    let templateWorkflowSteps: Array<{ id: number; title: string; description: string | null; order: number }> = [];
    if (resolvedWorkflowTemplateId) {
      templateWorkflowSteps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, resolvedWorkflowTemplateId))
        .orderBy(asc(workflowTemplateStepsTable.order));
    }

    let resolvedProjectId: number | null = projectId ?? null;
    let templateStepsSeeded = false;

    if (templateWorkflowSteps.length > 0) {
      const [autoProject] = await db.insert(projectsTable).values({
        title: service.name,
        description: service.description ?? `Auto-generated from service: ${service.name}`,
        status: "active",
        clientUserId,
        progress: 0,
        startDate: new Date(),
      }).returning();

      resolvedProjectId = autoProject.id;

      // Link the client service to this project
      await db.update(clientServicesTable)
        .set({ projectId: autoProject.id })
        .where(eq(clientServicesTable.id, cs.id));

      // Seed workflow steps from the workflow template; first step auto-starts
      const createdSteps = await db.insert(workflowStepsTable).values(
        templateWorkflowSteps.map((s, idx) => ({
          clientServiceId: cs.id,
          projectId: autoProject.id,
          title: s.title,
          description: s.description ?? "",
          status: idx === 0 ? ("in_progress" as const) : ("pending" as const),
          order: idx + 1,
          workflowTemplateStepId: s.id,
        }))
      ).returning();

      // Seed kanban tasks for the first step from workflow_template_step_tasks (via workflowTemplateStepId)
      const firstCreatedStep = createdSteps[0];
      if (firstCreatedStep?.workflowTemplateStepId) {
        const step1Tasks = await db
          .select()
          .from(workflowTemplateStepTasksTable)
          .where(eq(workflowTemplateStepTasksTable.workflowTemplateStepId, firstCreatedStep.workflowTemplateStepId))
          .orderBy(asc(workflowTemplateStepTasksTable.order));
        if (step1Tasks.length > 0) {
          await db.insert(kanbanTasksTable).values(
            step1Tasks.map((t, idx) => ({
              projectId: autoProject.id,
              workflowStepId: firstCreatedStep.id,
              groupName: t.groupName ?? null,
              title: t.title,
              description: t.description ?? null,
              column: "backlog" as const,
              order: idx,
            }))
          );
        }
      }

      templateStepsSeeded = true;

      // Notify client about the new project
      await db.insert(notificationsTable).values({
        userId: clientUserId,
        title: `Your project is ready: ${autoProject.title}`,
        body: null,
        type: "project_update",
        linkPath: `/portal/projects/${autoProject.id}`,
      });
    }

    // If no template steps were seeded, fall back to default slug-based steps
    // so the Dashboard tracker always has live data rather than showing mock content.
    if (!templateStepsSeeded) {
      await seedDefaultWorkflowSteps(cs.id, resolvedProjectId, service.slug ?? "");
    }
  }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "service_activated",
    entityType: "service",
    entityId: cs.id,
    entityLabel: service?.name ?? String(serviceId),
    clientId: clientUserId,
  });

  res.status(201).json(cs);
});

// ─── ADMIN: Project updates ──────────────────────────────────────────────────
router.post("/admin/project-updates", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, content, type } = req.body as { projectId?: number; content?: string; type?: string };
  if (!projectId || !content) { res.status(400).json({ error: "projectId and content are required" }); return; }

  const [update] = await db.insert(projectUpdatesTable).values({
    projectId,
    content,
    authorUserId: req.user!.id,
    type: (type as "update" | "milestone" | "message" | "file") ?? "update",
  }).returning();

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project?.clientUserId) {
    await db.insert(notificationsTable).values({
      userId: project.clientUserId,
      title: "Project update from Shane",
      body: content.slice(0, 100),
      type: "project_update",
      linkPath: `/portal/projects/${projectId}`,
    });
  }

  res.status(201).json(update);
});

// ─── ONBOARDING: List public micro-offers ────────────────────────────────────
router.get("/portal/onboarding/services", async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable)
    .where(eq(servicesTable.isPublic, true))
    .orderBy(asc(servicesTable.name));
  res.json(services);
});

// ─── ONBOARDING: Sign a contract (supports multi-service) ────────────────────
router.post("/portal/onboarding/contract", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { serviceId, serviceIds: rawServiceIds, signatureData, signerName, wizardSelections } = req.body as {
    serviceId?: number; serviceIds?: number[]; signatureData?: string; signerName?: string;
    wizardSelections?: Record<string, { stepId: string; stepTitle?: string; optionId: string; optionLabel?: string; priceAdjustment?: number }[]>;
  };

  // Support both single serviceId (legacy) and serviceIds array (multi-service)
  const resolvedServiceIds: number[] = rawServiceIds?.length
    ? rawServiceIds
    : serviceId
      ? [serviceId]
      : [];

  if (resolvedServiceIds.length === 0 || !signerName?.trim()) {
    res.status(400).json({ error: "serviceId(s) and signerName are required" });
    return;
  }

  if (!signatureData || signatureData.trim().length < 100) {
    res.status(400).json({ error: "A drawn signature is required to sign the agreement" });
    return;
  }
  if (!signatureData.startsWith("data:image/")) {
    res.status(400).json({ error: "Invalid signature format" });
    return;
  }

  const fetchedSvcs = await db.select().from(servicesTable)
    .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(resolvedServiceIds.map(id => sql`${id}`), sql`, `)}]::int[])`);
  if (fetchedSvcs.length !== resolvedServiceIds.length) {
    res.status(404).json({ error: "One or more services not found" });
    return;
  }
  // Preserve exact input order so contractIds[i] always pairs with serviceIds[i]
  const svcMap = new Map(fetchedSvcs.map(s => [s.id, s]));
  const services = resolvedServiceIds.map(id => svcMap.get(id)!);

  const ipAddress = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
  const userAgent = req.headers["user-agent"] ?? null;

  const createdContracts: typeof contractsTable.$inferSelect[] = [];

  for (const svc of services) {
    // Fetch admin-authored contract template for this service (if any)
    const [contractTemplate] = await db
      .select()
      .from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.serviceId, svc.id))
      .limit(1);

    // Substitute template variables into the body
    // ── Compute server-side wizard price for this service ───────────────
    let computedFinalPrice: number | null = null;
    const svcSelections = wizardSelections?.[String(svc.id)] ?? [];

    const rawWorkflow = svc.orderWorkflow as Array<unknown> | null;
    const hasWorkflow = Array.isArray(rawWorkflow) && rawWorkflow.length > 0 && svc.basePrice;

    if (hasWorkflow) {
      // Service has a wizard — selections are REQUIRED and strictly validated
      const workflow = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;

      // (1) Exactly one selection per step required — no missing, no duplicates
      const coveredStepIds = new Set<string>();
      for (const sel of svcSelections) {
        if (coveredStepIds.has(sel.stepId)) {
          res.status(400).json({ error: `Duplicate selection for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        coveredStepIds.add(sel.stepId);
      }
      for (const wfStep of workflow) {
        if (!coveredStepIds.has(wfStep.id)) {
          res.status(400).json({ error: `Missing selection for required step "${wfStep.id}" (${wfStep.title}) in service ${svc.id}` });
          return;
        }
      }

      // (2) All step/option IDs must exist in the stored workflow
      let total = parseFloat(String(svc.basePrice));
      for (const sel of svcSelections) {
        const wStep = workflow.find(s => s.id === sel.stepId);
        if (!wStep) {
          res.status(400).json({ error: `Unknown step id "${sel.stepId}" for service ${svc.id}` });
          return;
        }
        const wOpt = wStep.options.find(o => o.id === sel.optionId);
        if (!wOpt) {
          res.status(400).json({ error: `Unknown option id "${sel.optionId}" for step "${sel.stepId}" in service ${svc.id}` });
          return;
        }
        total += wOpt.priceAdjustment;
      }

      // (3) Clamp to maxPrice ceiling if set
      if (svc.maxPrice) {
        const max = parseFloat(String(svc.maxPrice));
        total = Math.min(total, max);
      }
      computedFinalPrice = Math.round(total * 100) / 100;
    }

    const signedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const effectivePriceStr = computedFinalPrice != null
      ? `$${computedFinalPrice.toLocaleString("en-US")}`
      : svc.price ? `$${parseFloat(String(svc.price)).toLocaleString("en-US")}` : "—";

    // Build a plain-text summary of wizard selections for the contract body/PDF
    let selectionsSummary = "";
    if (svcSelections.length > 0 && hasWorkflow) {
      const wf = rawWorkflow as Array<{ id: string; title: string; options: Array<{ id: string; label: string; priceAdjustment: number }> }>;
      const lines = svcSelections.map(sel => {
        const wStep = wf.find(s => s.id === sel.stepId);
        const wOpt = wStep?.options.find(o => o.id === sel.optionId);
        if (!wStep || !wOpt) return null;
        const adj = wOpt.priceAdjustment !== 0
          ? ` (${wOpt.priceAdjustment > 0 ? "+" : ""}$${wOpt.priceAdjustment.toLocaleString("en-US")})`
          : "";
        return `• ${wStep.title}: ${wOpt.label}${adj}`;
      }).filter(Boolean);
      if (lines.length > 0) {
        selectionsSummary = "Customisation selections:\n" + lines.join("\n");
      }
    }

    const templateBody = contractTemplate?.body?.trim()
      ? contractTemplate.body
          .replace(/\{\{client_name\}\}/g, signerName.trim())
          .replace(/\{\{service_name\}\}/g, svc.name)
          .replace(/\{\{price\}\}/g, effectivePriceStr)
          .replace(/\{\{date\}\}/g, signedDate)
          .replace(/\{\{selections_summary\}\}/g, selectionsSummary)
      : undefined;

    const [contract] = await db.insert(contractsTable).values({
      userId,
      serviceId: svc.id,
      signatureData,
      signerName: signerName.trim(),
      ipAddress,
      userAgent,
      contractVersion: contractTemplate?.version ?? "v1",
      finalPrice: computedFinalPrice != null ? String(computedFinalPrice) : null,
      wizardSelections: svcSelections.length > 0 ? svcSelections as never : null,
      agreementBody: templateBody ?? null,
    }).returning();

    // ── Generate signed PDF immediately at signing time ──────────────────
    try {
      const pdfFilename = await generateContractPdf({
        contractId: contract.id,
        signerName: signerName.trim(),
        serviceName: svc.name,
        servicePrice: effectivePriceStr,
        serviceDeliverables: svc.deliverables ?? "as described on the service page",
        serviceTurnaround: svc.turnaround ?? "see service details",
        signedAt: contract.signedAt ?? new Date(),
        signatureDataUrl: signatureData,
        contractTemplateBody: templateBody,
        selectionsSummary: selectionsSummary || undefined,
      });
      await db.update(contractsTable)
        .set({ pdfFilename })
        .where(eq(contractsTable.id, contract.id));
      createdContracts.push({ ...contract, pdfFilename });
    } catch (pdfErr) {
      req.log.error({ err: pdfErr }, "contract signing: PDF generation failed (non-fatal)");
      createdContracts.push(contract);
    }
  }

  // Audit the signing
  void createAuditLog({
    actorUserId: userId,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "client",
    actionType: "contract_signed",
    entityType: "contract",
    entityId: createdContracts.map(c => c.id).join(","),
    entityLabel: services.map(s => s.name).join(", "),
    clientId: userId,
    metadata: { signerName, serviceCount: createdContracts.length },
  });

  // Return both legacy single-contract and new multi-contract formats
  if (createdContracts.length === 1) {
    res.status(201).json({ ...createdContracts[0], contractIds: [createdContracts[0].id] });
  } else {
    res.status(201).json({ contractIds: createdContracts.map(c => c.id), contracts: createdContracts });
  }
});

// ─── ONBOARDING: Get a contract ───────────────────────────────────────────────
router.get("/portal/onboarding/contract/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const isAdmin = req.user!.role === "admin";
  const [contract] = await db.select().from(contractsTable)
    .where(isAdmin ? eq(contractsTable.id, id) : and(eq(contractsTable.id, id), eq(contractsTable.userId, userId)));
  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  res.json(contract);
});

// ─── ONBOARDING: Check Stripe session (success page polling) ─────────────────
router.get("/portal/onboarding/session/:sessionId", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);
  try {
    const session = await stripe.checkout.sessions.retrieve(String(req.params.sessionId));
    // ── Security: verify this session belongs to the requesting user (IDOR prevention) ──
    const sessionOwner = session.metadata?.userId;
    if (!sessionOwner || sessionOwner !== String(req.user!.id)) {
      res.status(403).json({ error: "Session not found or access denied" });
      return;
    }
    // For subscription sessions, retrieve next billing date from the subscription
    let nextBillingDate: number | null = null;
    if (session.mode === "subscription" && session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        nextBillingDate = sub.billing_cycle_anchor ?? null;
      } catch {
        // non-fatal — success page renders without it
      }
    }
    res.json({ status: session.payment_status, metadata: session.metadata, mode: session.mode, nextBillingDate });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// ─── ONBOARDING: Provision project after successful payment ──────────────────
// Called by the success page as a fallback when webhooks are not yet configured.
// Safe to call multiple times — provisionOnboardingProject is idempotent.
router.post("/portal/onboarding/provision/:sessionId", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let session: import("stripe").Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(String(req.params.sessionId));
  } catch {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Security: only the session owner may trigger provisioning
  if (!session.metadata?.userId || session.metadata.userId !== String(req.user!.id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (session.metadata?.type !== "onboarding_purchase") {
    res.status(400).json({ error: "Not an onboarding session" });
    return;
  }

  if (session.payment_status !== "paid") {
    res.status(402).json({ error: "Payment not yet confirmed" });
    return;
  }

  try {
    const subId = typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription as { id?: string } | null)?.id ?? null;
    await provisionOnboardingProject(req, session, subId);
    req.log.info({ sessionId: session.id }, "onboarding provision: triggered from success page");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "onboarding provision: failed");
    res.status(500).json({ error: "Provisioning failed" });
  }
});

// ─── ONBOARDING: Create Stripe checkout session (multi-service, mixed-cart) ──
router.post("/portal/checkout/create-session", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const {
    serviceId, serviceIds: rawServiceIds,
    contractId, contractIds: rawContractIds,
    returnUrl, startDate,
  } = req.body as {
    serviceId?: number; serviceIds?: number[];
    contractId?: number; contractIds?: number[];
    returnUrl?: string; startDate?: string;
  };

  // Support legacy single-service and new multi-service formats
  const resolvedServiceIds: number[] = rawServiceIds?.length ? rawServiceIds : serviceId ? [serviceId] : [];
  const resolvedContractIds: number[] = rawContractIds?.length ? rawContractIds : contractId ? [contractId] : [];

  if (resolvedServiceIds.length === 0 || resolvedContractIds.length === 0) {
    res.status(400).json({ error: "serviceIds and contractIds are required" });
    return;
  }
  if (resolvedServiceIds.length !== resolvedContractIds.length) {
    res.status(400).json({ error: "serviceIds and contractIds must have the same length" });
    return;
  }

  // ── Security: verify all contracts belong to this user and match services ──
  // Also capture finalPrice from each contract (server-computed wizard price)
  const contractFinalPrices = new Map<number, number | null>();
  for (let i = 0; i < resolvedContractIds.length; i++) {
    const [contract] = await db.select().from(contractsTable)
      .where(and(eq(contractsTable.id, resolvedContractIds[i]), eq(contractsTable.userId, userId)));
    if (!contract) {
      res.status(403).json({ error: "Contract not found or does not belong to this account" });
      return;
    }
    if (contract.serviceId !== resolvedServiceIds[i]) {
      res.status(403).json({ error: "Contract service mismatch" });
      return;
    }
    contractFinalPrices.set(
      resolvedServiceIds[i],
      contract.finalPrice != null ? parseFloat(String(contract.finalPrice)) : null,
    );
  }

  // Fetch all services
  const services = await db.select().from(servicesTable)
    .where(sql`${servicesTable.id} = ANY(ARRAY[${sql.join(resolvedServiceIds.map(id => sql`${id}`), sql`, `)}]::int[])`);

  const missingPrices = services.filter(s => !s.price && contractFinalPrices.get(s.id) == null);
  if (missingPrices.length > 0) {
    res.status(400).json({ error: `Service "${missingPrices[0].name}" has no price configured` });
    return;
  }
  if (services.length !== resolvedServiceIds.length) {
    res.status(404).json({ error: "One or more services not found" });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "Online purchasing is not yet configured. Please contact us at info@shanemccaw.com to purchase this service." });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;

  // Map serviceId → contractId for lookup
  const serviceToContract = new Map<number, number>();
  for (let i = 0; i < resolvedServiceIds.length; i++) {
    serviceToContract.set(resolvedServiceIds[i], resolvedContractIds[i]);
  }

  // Group by billing type (preserve original ordering)
  const oneTimeServices = services.filter(s => s.billingType === "one_time");
  const recurringServices = services.filter(s => s.billingType === "recurring_monthly");

  let oneTimeUrl: string | null = null;
  let subscriptionUrl: string | null = null;
  const startDateStr = startDate ?? new Date().toISOString();

  try {
    // ── One-time Checkout Session (payment mode) ───────────────────────────
    if (oneTimeServices.length > 0) {
      const otContractIds = oneTimeServices.map(s => serviceToContract.get(s.id)!);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: oneTimeServices.map(s => ({
          price_data: {
            currency: "usd",
            product_data: { name: s.name, description: s.description ?? undefined },
            unit_amount: Math.round((contractFinalPrices.get(s.id) ?? parseFloat(String(s.price!))) * 100),
          },
          quantity: 1,
        })),
        mode: "payment",
        automatic_tax: { enabled: true },
        success_url: `${baseUrl}/portal/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/onboarding/contract?serviceIds=${oneTimeServices.map(s => s.id).join(",")}&cancelled=1`,
        metadata: {
          type: "onboarding_purchase",
          userId: String(userId),
          serviceIds: oneTimeServices.map(s => s.id).join(","),
          contractIds: otContractIds.join(","),
          serviceName: oneTimeServices.map(s => s.name).join(", "),
          startDate: startDateStr,
          servicePrices: oneTimeServices.map(s => (contractFinalPrices.get(s.id) ?? parseFloat(String(s.price ?? 0))).toFixed(2)).join(","),
        },
      });
      oneTimeUrl = session.url;
    }

    // ── Subscription Checkout Session (subscription mode) ──────────────────
    if (recurringServices.length > 0) {
      const recContractIds = recurringServices.map(s => serviceToContract.get(s.id)!);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: recurringServices.map(s => ({
          price_data: {
            currency: "usd",
            product_data: { name: s.name, description: s.description ?? undefined },
            unit_amount: Math.round((contractFinalPrices.get(s.id) ?? parseFloat(String(s.price!))) * 100),
            recurring: { interval: "month" as const },
          },
          quantity: 1,
        })),
        mode: "subscription",
        success_url: `${baseUrl}/portal/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/onboarding/contract?serviceIds=${recurringServices.map(s => s.id).join(",")}&cancelled=1`,
        metadata: {
          type: "onboarding_purchase",
          userId: String(userId),
          serviceIds: recurringServices.map(s => s.id).join(","),
          contractIds: recContractIds.join(","),
          serviceName: recurringServices.map(s => s.name).join(", "),
          startDate: startDateStr,
          servicePrices: recurringServices.map(s => (contractFinalPrices.get(s.id) ?? parseFloat(String(s.price ?? 0))).toFixed(2)).join(","),
        },
      });
      subscriptionUrl = session.url;
    }
  } catch (stripeErr) {
    const msg = stripeErr instanceof Error ? stripeErr.message : "Stripe error";
    req.log.error({ err: stripeErr }, "checkout: Stripe session creation failed");
    res.status(502).json({ error: `Payment provider error: ${msg}` });
    return;
  }

  // Primary URL is one-time first (if mixed cart, subscription comes after)
  const primaryUrl = oneTimeUrl ?? subscriptionUrl;
  const secondaryUrl = oneTimeUrl && subscriptionUrl ? subscriptionUrl : null;

  res.json({ url: primaryUrl, oneTimeUrl, subscriptionUrl, secondaryUrl });
});

// ─── ADMIN: Contracts ─────────────────────────────────────────────────────────
router.get("/admin/contracts", requireAdmin, async (_req: Request, res: Response) => {
  const contracts = await db
    .select({
      id: contractsTable.id,
      serviceId: contractsTable.serviceId,
      userId: contractsTable.userId,
      signerName: contractsTable.signerName,
      signedAt: contractsTable.signedAt,
      contractVersion: contractsTable.contractVersion,
      projectId: contractsTable.projectId,
      stripeSessionId: contractsTable.stripeSessionId,
      serviceName: servicesTable.name,
      serviceSlug: servicesTable.slug,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
    })
    .from(contractsTable)
    .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .orderBy(desc(contractsTable.signedAt));
  res.json(contracts);
});

// ─── ADMIN: Purchases (onboarding invoices only) ──────────────────────────────
router.get("/admin/purchases", requireAdmin, async (_req: Request, res: Response) => {
  const purchases = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      createdAt: invoicesTable.createdAt,
      clientEmail: usersTable.email,
      clientName: usersTable.name,
      clientCompany: usersTable.company,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .where(sql`${invoicesTable.invoiceNumber} like 'ONB-%' OR ${invoicesTable.invoiceNumber} like 'SVC-%'`)
    .orderBy(desc(invoicesTable.createdAt));
  res.json(purchases);
});

// ─── ADMIN: Purchase detail ────────────────────────────────────────────────
router.get("/admin/purchases/:id", requireAdmin, async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch the base invoice row first (no contract join yet)
  const invoiceRows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      createdAt: invoicesTable.createdAt,
      clientId: usersTable.id,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
      projectId: projectsTable.id,
      projectName: projectsTable.title,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .leftJoin(projectsTable, eq(invoicesTable.projectId, projectsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);

  if (invoiceRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const inv = invoiceRows[0];

  // Fetch ALL contracts linked to this purchase (multi-service cart support).
  // Strategy: prefer stripeSessionId match (set on all contracts during fulfillment).
  // Fallback to projectId match for non-first invoices whose stripeSessionId is null.
  type ContractRow = {
    contractId: number;
    serviceName: string | null;
    wizardSelections: unknown;
    orderWorkflow: unknown;
  };
  let contracts: ContractRow[] = [];
  if (inv.stripeSessionId) {
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(eq(contractsTable.stripeSessionId, inv.stripeSessionId));
  } else if (inv.projectId) {
    // Non-first invoice in a multi-service cart — contracts were updated with
    // projectId at fulfillment time even though the invoice has no sessionId.
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(
        and(
          eq(contractsTable.projectId, inv.projectId),
          eq(contractsTable.userId, inv.clientId ?? -1)
        )
      );
  }

  res.json({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    description: inv.description,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    paidAt: inv.paidAt,
    stripeSessionId: inv.stripeSessionId,
    createdAt: inv.createdAt,
    client: {
      id: inv.clientId,
      name: inv.clientName,
      email: inv.clientEmail,
      company: inv.clientCompany,
    },
    project: inv.projectId ? { id: inv.projectId, name: inv.projectName } : null,
    contracts: contracts.map(c => ({
      contractId: c.contractId,
      serviceName: c.serviceName,
      wizardSelections: c.wizardSelections ?? null,
      orderWorkflow: c.orderWorkflow ?? null,
    })),
  });
});

// ─── PUBLIC: Testimonials ────────────────────────────────────────────────────
router.get("/public/testimonials", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      feedback: projectClosuresTable.feedback,
      signedAt: projectClosuresTable.signedAt,
      projectType: projectsTable.projectType,
      clientName: usersTable.name,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        eq(projectClosuresTable.permissionGranted, true),
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        sql`${projectClosuresTable.feedback} IS NOT NULL AND trim(${projectClosuresTable.feedback}) <> ''`,
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));

  const out = rows.map(r => ({
    id: r.id,
    feedback: r.feedback,
    signedAt: r.signedAt,
    projectType: r.projectType,
    clientFirstName: r.clientName ? r.clientName.trim().split(/\s+/)[0] : null,
  }));
  res.json(out);
});

// ─── ADMIN: Request closure sign-off for a project ───────────────────────────
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
      await sendEmail(
        client.email,
        `Project Sign-Off: ${project.title}`,
        closureRequestEmail({ clientName: client.name ?? "", projectTitle: project.title, projectId }),
      );
    }
  }

  res.json(closure);
});

// ─── ADMIN: Get closure for a project ────────────────────────────────────────
router.get("/admin/projects/:id/closure", requireAdmin, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [closure] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!closure) { res.status(404).json({ error: "No closure record found" }); return; }
  res.json(closure);
});

// ─── ADMIN: List all approved (signed + permissionGranted) closures ──────────
router.get("/admin/closures/approved", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      projectId: projectClosuresTable.projectId,
      projectTitle: projectsTable.title,
      projectType: projectsTable.projectType,
      feedback: projectClosuresTable.feedback,
      permissionGranted: projectClosuresTable.permissionGranted,
      signedAt: projectClosuresTable.signedAt,
      requestedAt: projectClosuresTable.requestedAt,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        eq(projectClosuresTable.permissionGranted, true),
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));
  res.json(rows);
});

// ─── PUBLIC: Testimonials alias ──────────────────────────────────────────────
router.get("/testimonials", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      feedback: projectClosuresTable.feedback,
      signedAt: projectClosuresTable.signedAt,
      projectType: projectsTable.projectType,
      clientName: usersTable.name,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(
      and(
        eq(projectClosuresTable.permissionGranted, true),
        sql`${projectClosuresTable.signedAt} IS NOT NULL`,
        sql`${projectClosuresTable.feedback} IS NOT NULL AND trim(${projectClosuresTable.feedback}) <> ''`,
      )
    )
    .orderBy(desc(projectClosuresTable.signedAt));

  const out = rows.map(r => ({
    id: r.id,
    feedback: r.feedback,
    signedAt: r.signedAt,
    projectType: r.projectType,
    clientFirstName: r.clientName ? r.clientName.trim().split(/\s+/)[0] : null,
  }));
  res.json(out);
});

// ─── ADMIN: List ALL signed closures (for admin testimonials page) ───────────
router.get("/admin/closures/signed", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: projectClosuresTable.id,
      projectId: projectClosuresTable.projectId,
      projectTitle: projectsTable.title,
      projectType: projectsTable.projectType,
      feedback: projectClosuresTable.feedback,
      permissionGranted: projectClosuresTable.permissionGranted,
      signedAt: projectClosuresTable.signedAt,
      requestedAt: projectClosuresTable.requestedAt,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
    .from(projectClosuresTable)
    .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
    .where(sql`${projectClosuresTable.signedAt} IS NOT NULL`)
    .orderBy(desc(projectClosuresTable.signedAt));
  res.json(rows);
});

// ─── PORTAL: Get closure for client's project ────────────────────────────────
router.get("/portal/projects/:id/closure", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.user!.id;
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  // Verify the project belongs to this user
  const [project] = await db.select().from(projectsTable).where(
    and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId))
  );
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [closure] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!closure) { res.status(404).json({ error: "No closure record" }); return; }
  res.json(closure);
});

// ─── PORTAL: Sign closure ─────────────────────────────────────────────────────
router.post("/portal/projects/:id/closure/sign", requireAuth, async (req: Request, res: Response) => {
  const projectId = parseInt(String(req.params.id ?? ""), 10);
  const userId = req.user!.id;
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const [project] = await db.select().from(projectsTable).where(
    and(eq(projectsTable.id, projectId), eq(projectsTable.clientUserId, userId))
  );
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [existing] = await db.select().from(projectClosuresTable).where(eq(projectClosuresTable.projectId, projectId));
  if (!existing) { res.status(404).json({ error: "Closure not requested yet" }); return; }
  if (existing.signedAt) { res.status(409).json({ error: "Project has already been signed off", closure: existing }); return; }

  const { feedback, permissionGranted, signatureDataUrl } = req.body as {
    feedback?: string;
    permissionGranted?: boolean;
    signatureDataUrl?: string;
  };

  const trimmedFeedback = feedback?.trim() ?? "";
  if (!trimmedFeedback) {
    res.status(422).json({ error: "Feedback is required" });
    return;
  }
  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/")) {
    res.status(422).json({ error: "A valid signature is required" });
    return;
  }

  const [updated] = await db.update(projectClosuresTable)
    .set({
      feedback: trimmedFeedback,
      permissionGranted: permissionGranted === true,
      signatureDataUrl,
      signedAt: new Date(),
      signerUserId: userId,
    })
    .where(eq(projectClosuresTable.id, existing.id))
    .returning();

  res.json(updated);
});

// ─── ADMIN: Admin messages (all clients) ────────────────────────────────────
router.get("/admin/messages/clients", requireAdmin, async (_req: Request, res: Response) => {
  const clients = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    company: usersTable.company,
    unread: sql<number>`(SELECT count(*) FROM messages WHERE client_user_id = ${usersTable.id} AND read_by_admin = false)`.mapWith(Number),
    lastMessage: sql<string>`(SELECT created_at FROM messages WHERE client_user_id = ${usersTable.id} ORDER BY created_at DESC LIMIT 1)`,
  }).from(usersTable).where(eq(usersTable.role, "client")).orderBy(desc(usersTable.createdAt));
  res.json(clients);
});

export default router;
