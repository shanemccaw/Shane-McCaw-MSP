import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, clientServicesTable, servicesTable, workflowStepsTable, kanbanTasksTable, documentsTable, reportsTable, invoicesTable, messagesTable, notificationsTable, projectUpdatesTable, usersTable, contractsTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/requireAuth";
import { sendEmail, purchaseConfirmationEmail, onboardingConfirmationEmail, adminPurchaseAlertEmail } from "../lib/mailer";
import multer from "multer";
import path from "path";
import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const router: IRouter = Router();

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
  res.json(projects);
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

  const documents = await db.select().from(documentsTable)
    .where(eq(documentsTable.projectId, id))
    .orderBy(desc(documentsTable.createdAt));

  const updates = await db.select().from(projectUpdatesTable)
    .where(eq(projectUpdatesTable.projectId, id))
    .orderBy(desc(projectUpdatesTable.createdAt));

  res.json({ project, steps, tasks, documents, updates });
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
}

async function generateContractPdf(opts: ContractPdfOptions): Promise<string> {
  const { contractId, signerName, serviceName, servicePrice, serviceDeliverables, serviceTurnaround, signedAt, signatureDataUrl } = opts;

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
    if (y < 80) { /* overflow guard — not expected for 10 short sections */ break; }
    drawText(page1, heading, margin, y, { font: helveticaBold, size: 10, color: blue });
    y -= 14;
    // Word-wrap body at ~75 chars
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
async function provisionOnboardingProject(
  req: Request,
  session: import("stripe").Stripe.Checkout.Session,
): Promise<void> {
  const { userId, serviceId, contractId } = session.metadata ?? {};
  const uid = parseInt(userId ?? "", 10);
  const sid = parseInt(serviceId ?? "", 10);
  const cid = parseInt(contractId ?? "", 10);

  if (isNaN(uid) || isNaN(sid)) {
    req.log.error({ userId, serviceId }, "provisionOnboardingProject: invalid metadata ids");
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

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, sid));
  const [buyer] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
  if (!service || !buyer) {
    req.log.error({ sid, uid }, "provisionOnboardingProject: service or buyer not found");
    return;
  }

  const amountDollars = service.price
    ? parseFloat(String(service.price)).toFixed(2)
    : "0.00";

  // Parse optional start date from checkout metadata; default to now
  const rawStart = session.metadata?.startDate;
  const parsedStart = rawStart ? new Date(rawStart) : new Date();
  const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;

  // ── Create project workspace ──────────────────────────────────────────────
  const [project] = await db.insert(projectsTable).values({
    title: `${buyer.name ?? buyer.company ?? buyer.email} — ${service.name}`,
    description: service.description ?? null,
    status: "active",
    phase: "Kickoff",
    progress: 0,
    clientUserId: uid,
    startDate,
  }).returning();

  // ── Seed workflow steps from per-service templates ────────────────────────
  const stepTemplates: Record<string, Array<{ title: string; description: string }>> = {
    "m365-health-check": [
      { title: "Kickoff Call", description: "30-minute video call to confirm scope, access requirements, and expected deliverables." },
      { title: "Tenant Access Setup", description: "Client provisions read-only admin access or provides required tenant data exports." },
      { title: "Assessment Scan", description: "Shane runs automated and manual checks across your M365 environment." },
      { title: "Findings Report Draft", description: "Draft Health Check Report shared for review — client provides any corrections." },
      { title: "Final Report Delivery", description: "Signed-off Health Check Report delivered with prioritised remediation roadmap." },
    ],
    "copilot-readiness": [
      { title: "Kickoff Call", description: "30-minute video call to confirm scope, users in scope, and key use cases." },
      { title: "Readiness Questionnaire", description: "Client completes structured questionnaire covering licensing, data governance, and training readiness." },
      { title: "Environment Review", description: "Shane reviews M365 tenant configuration, licensing posture, and data sensitivity." },
      { title: "Gap Analysis", description: "Gaps between current state and Copilot-ready state documented with effort estimates." },
      { title: "Readiness Report Delivery", description: "Final Copilot Readiness Assessment Report with 90-day activation roadmap delivered." },
    ],
    "sharepoint-blueprint": [
      { title: "Kickoff Call", description: "60-minute discovery call to capture requirements, stakeholders, and success criteria." },
      { title: "Requirements Workshop", description: "Structured workshop to capture navigation needs, content types, audience segments, and governance rules." },
      { title: "IA & Navigation Design", description: "Information architecture, site map, and global navigation design produced and shared for feedback." },
      { title: "Wireframe Review", description: "Low-fidelity wireframes for key page types reviewed with the client." },
      { title: "Blueprint Delivery", description: "Full SharePoint Intranet Blueprint document delivered — ready to hand to any implementation team." },
    ],
    "power-automate": [
      { title: "Kickoff Call", description: "30-minute call to identify the highest-value process to automate." },
      { title: "Process Discovery", description: "Shane maps the current manual process end-to-end and identifies automation touchpoints." },
      { title: "Flow Build & Test", description: "Power Automate flow built and tested in a staging environment." },
      { title: "Refinement", description: "Flow adjusted based on client feedback; edge cases and error handling added." },
      { title: "Handover & Training", description: "Live walkthrough of the finished flow, documentation, and 30-day support window." },
    ],
    "security-audit": [
      { title: "Kickoff Call", description: "30-minute call to confirm scope, tenant access requirements, and risk appetite." },
      { title: "Tenant Access & Scan", description: "Read-only admin access granted; automated and manual security scans run across the tenant." },
      { title: "Risk Assessment", description: "Findings categorised by severity (Critical / High / Medium / Low) with NIST alignment." },
      { title: "Audit Report Draft", description: "Draft M365 Security & Governance Audit Report shared for review." },
      { title: "Final Audit Report", description: "Final report delivered with a prioritised remediation plan and optional 60-minute debrief call." },
    ],
    "copilot-prompts": [
      { title: "Kickoff Call", description: "30-minute call to understand your team roles, workflows, and top productivity pain points." },
      { title: "Use-Case Discovery", description: "Client provides sample tasks and documents; Shane identifies the highest-value Copilot scenarios." },
      { title: "Prompt Engineering", description: "Shane writes, tests, and refines prompts across Word, Excel, Teams, Outlook, and Loop." },
      { title: "Prompt Library Build", description: "Structured prompt library built as a SharePoint page or Word document — role-organised and searchable." },
      { title: "Handover", description: "Library delivered with a short video walkthrough and guidance on prompt maintenance." },
    ],
  };
  const steps = (service.slug && stepTemplates[service.slug])
    ? stepTemplates[service.slug]
    : [
        { title: "Kickoff Call", description: "Initial call to align on scope and next steps." },
        { title: "Discovery", description: "Information gathering and requirements review." },
        { title: "Delivery", description: "Core deliverable produced and shared for review." },
        { title: "Sign-off", description: "Final approval and handover." },
      ];

  await db.insert(workflowStepsTable).values(
    steps.map((s, i) => ({
      projectId: project.id,
      title: s.title,
      description: s.description,
      status: "pending" as const,
      order: i + 1,
    }))
  );

  // ── Assign service to client ──────────────────────────────────────────────
  await db.insert(clientServicesTable).values({
    clientUserId: uid,
    serviceId: sid,
    projectId: project.id,
    status: "active",
    progress: 0,
    startDate,
  });

  // ── Link contract → project and attach pre-generated PDF as document ──────
  if (!isNaN(cid)) {
    const contractRecord = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, cid))
      .then(r => r[0]);

    await db.update(contractsTable)
      .set({ projectId: project.id, stripeSessionId: session.id })
      .where(eq(contractsTable.id, cid));

    // PDF was generated at signing time (POST /portal/onboarding/contract).
    // If the pdfFilename is present, create the documents row now that we have a projectId.
    const pdfFilename = contractRecord?.pdfFilename;
    if (pdfFilename) {
      await db.insert(documentsTable).values({
        projectId: project.id,
        name: `Signed Service Agreement — ${service.name}`,
        filename: pdfFilename,
        mimeType: "application/pdf",
        uploadedBy: uid,
      });
    }
  }

  // ── Create paid invoice (written first so idempotency guard catches replays) ─
  await db.insert(invoicesTable).values({
    clientUserId: uid,
    projectId: project.id,
    invoiceNumber: `ONB-${Date.now()}`,
    description: `${service.name} — self-service purchase`,
    amount: amountDollars,
    currency: "usd",
    status: "paid",
    paidAt: new Date(),
    stripeSessionId: session.id,
  });

  // ── Notify admins ─────────────────────────────────────────────────────────
  const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
  for (const admin of admins) {
    await db.insert(notificationsTable).values({
      userId: admin.id,
      title: `New onboarding purchase: ${service.name}`,
      body: `${buyer.name ?? buyer.email} purchased "${service.name}" ($${amountDollars}). Project #${project.id} auto-created.`,
      type: "general",
      linkPath: `/dashboard`,
    });
  }

  // ── Notify client ─────────────────────────────────────────────────────────
  await db.insert(notificationsTable).values({
    userId: uid,
    title: `Your project is ready: ${service.name}`,
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
    await db.insert(messagesTable).values({
      clientUserId: uid,
      senderUserId: adminUser.id,
      body: `Welcome to your ${service.name} project! 👋\n\nPayment confirmed and your project workspace is ready. I'll be in touch within 1 business day to schedule your kickoff call and confirm any access requirements.\n\nIf you have any questions in the meantime, feel free to message me here.\n\n— Shane`,
      readByClient: false,
      readByAdmin: true,
    });
  }

  // ── Confirmation email to client (fire-and-forget) ────────────────────────
  if (buyer.email) {
    sendEmail(
      buyer.email,
      `Your ${service.name} project is ready — next steps inside`,
      onboardingConfirmationEmail({
        clientName: buyer.name ?? "",
        serviceName: service.name,
        amountDollars,
        projectId: project.id,
      }),
    ).catch(() => null);
  }

  // ── Admin notification email (fire-and-forget) ─────────────────────────────
  const adminEmailAddr = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (adminEmailAddr) {
    sendEmail(
      adminEmailAddr,
      `New onboarding purchase: ${service.name} — $${amountDollars}`,
      adminPurchaseAlertEmail({
        clientName: buyer.name ?? "",
        clientEmail: buyer.email,
        serviceName: service.name,
        amountDollars,
        type: "onboarding_purchase",
        projectId: project.id,
      }),
    ).catch(() => null);
  }
}

// Stripe webhook to mark invoice paid
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
      await db.update(invoicesTable)
        .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
        .where(eq(invoicesTable.id, parseInt(invoiceId, 10)));
    }

    // Service purchase — notify admin, create invoice record
    if (session.metadata?.type === "service_purchase" && session.payment_status === "paid") {
      const { userId, serviceName, serviceCategory, servicePriceInCents } = session.metadata;
      const uid = parseInt(userId, 10);
      const amountDollars = (parseInt(servicePriceInCents, 10) / 100).toFixed(2);

      // Create a paid invoice so it shows in billing history
      await db.insert(invoicesTable).values({
        clientUserId: uid,
        invoiceNumber: `SVC-${Date.now()}`,
        description: `${serviceName} — purchased via portal`,
        amount: amountDollars,
        currency: "usd",
        status: "paid",
        paidAt: new Date(),
        stripeSessionId: session.id,
      });

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
    }

    // Onboarding purchase — auto-provision project + workflow steps
    if (session.metadata?.type === "onboarding_purchase" && session.payment_status === "paid") {
      await provisionOnboardingProject(req, session);
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

// ─── ADMIN: Projects ─────────────────────────────────────────────────────────
router.get("/admin/projects", requireAdmin, async (_req: Request, res: Response) => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

router.post("/admin/projects", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, status, phase, progress, clientUserId, startDate, endDate } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number; startDate?: string; endDate?: string;
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

  res.status(201).json(project);
});

router.patch("/admin/projects/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, description, status, phase, progress, clientUserId, startDate, endDate } = req.body as {
    title?: string; description?: string; status?: string; phase?: string; progress?: number; clientUserId?: number | null; startDate?: string; endDate?: string;
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

  const [updated] = await db.update(projectsTable).set(updates).where(eq(projectsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(updated);
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

router.post("/admin/workflow-steps", requireAdmin, async (req: Request, res: Response) => {
  const { projectId, clientServiceId, title, description, order, status } = req.body as {
    projectId?: number; clientServiceId?: number; title?: string; description?: string; order?: number; status?: string;
  };
  if (!title) { res.status(400).json({ error: "title is required" }); return; }

  const [step] = await db.insert(workflowStepsTable).values({
    projectId: projectId ?? null,
    clientServiceId: clientServiceId ?? null,
    title,
    description: description ?? null,
    order: order ?? 0,
    status: (status as "pending" | "in_progress" | "completed" | "blocked") ?? "pending",
  }).returning();
  res.status(201).json(step);
});

router.patch("/admin/workflow-steps/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, notes, title, description } = req.body as { status?: string; notes?: string; title?: string; description?: string };
  const updates: Partial<typeof workflowStepsTable.$inferInsert> = {};
  if (status !== undefined) {
    updates.status = status as "pending" | "in_progress" | "completed" | "blocked";
    if (status === "completed") updates.completedAt = new Date();
  }
  if (notes !== undefined) updates.notes = notes;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;

  const [updated] = await db.update(workflowStepsTable).set(updates).where(eq(workflowStepsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Step not found" }); return; }
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
  const { projectId, title, description, column, order, assignedTo, dueDate } = req.body as {
    projectId?: number; title?: string; description?: string; column?: string; order?: number; assignedTo?: string; dueDate?: string;
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
  }).returning();
  res.status(201).json(task);
});

router.patch("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { column, title, description, order, assignedTo, dueDate } = req.body as {
    column?: string; title?: string; description?: string; order?: number; assignedTo?: string; dueDate?: string;
  };
  const updates: Partial<typeof kanbanTasksTable.$inferInsert & { updatedAt: Date }> = { updatedAt: new Date() };
  if (column !== undefined) updates.column = column as "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (order !== undefined) updates.order = order;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;

  const [updated] = await db.update(kanbanTasksTable).set(updates).where(eq(kanbanTasksTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(updated);
});

router.delete("/admin/kanban-tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(kanbanTasksTable).where(eq(kanbanTasksTable.id, id));
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
  res.json(updated);
});

// ─── ADMIN: Services ─────────────────────────────────────────────────────────
router.get("/admin/services", requireAdmin, async (_req: Request, res: Response) => {
  const services = await db.select().from(servicesTable).orderBy(asc(servicesTable.name));
  res.json(services);
});

router.post("/admin/services", requireAdmin, async (req: Request, res: Response) => {
  const { name, description, category, deliverables, price, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string; price?: string; durationDays?: number;
  };
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [service] = await db.insert(servicesTable).values({
    name, description: description ?? null, category: category ?? null,
    deliverables: deliverables ?? null, price: price ?? null, durationDays: durationDays ?? null,
  }).returning();
  res.status(201).json(service);
});

router.patch("/admin/services/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { name, description, category, deliverables, price, durationDays } = req.body as {
    name?: string; description?: string; category?: string; deliverables?: string; price?: string; durationDays?: number;
  };
  const updates: Partial<typeof servicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (category !== undefined) updates.category = category;
  if (deliverables !== undefined) updates.deliverables = deliverables;
  if (price !== undefined) updates.price = price;
  if (durationDays !== undefined) updates.durationDays = durationDays;
  const [updated] = await db.update(servicesTable).set(updates).where(eq(servicesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
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
  }

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

// ─── ONBOARDING: Sign a contract ─────────────────────────────────────────────
router.post("/portal/onboarding/contract", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { serviceId, signatureData, signerName } = req.body as {
    serviceId?: number; signatureData?: string; signerName?: string;
  };

  if (!serviceId || !signerName?.trim()) {
    res.status(400).json({ error: "serviceId and signerName are required" });
    return;
  }

  // ── Enforce that a real signature was drawn (not an empty/absent payload) ──
  if (!signatureData || signatureData.trim().length < 100) {
    res.status(400).json({ error: "A drawn signature is required to sign the agreement" });
    return;
  }
  if (!signatureData.startsWith("data:image/")) {
    res.status(400).json({ error: "Invalid signature format" });
    return;
  }

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId));
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }

  // Fetch buyer name for the PDF (best-effort)
  const [buyer] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, userId));

  const [contract] = await db.insert(contractsTable).values({
    userId,
    serviceId,
    signatureData,
    signerName: signerName.trim(),
    ipAddress: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    contractVersion: "v1",
  }).returning();

  // ── Generate signed PDF immediately at signing time ──────────────────────
  // PDF is created here so the document artifact exists before payment occurs.
  // provisionOnboardingProject() reads pdfFilename to create the documents row.
  try {
    const pdfFilename = await generateContractPdf({
      contractId: contract.id,
      signerName: signerName.trim(),
      serviceName: service.name,
      servicePrice: service.price ? `$${parseFloat(String(service.price)).toLocaleString("en-US")}` : "—",
      serviceDeliverables: service.deliverables ?? "as described on the service page",
      serviceTurnaround: service.turnaround ?? "see service details",
      signedAt: contract.signedAt ?? new Date(),
      signatureDataUrl: signatureData,
    });
    await db.update(contractsTable)
      .set({ pdfFilename })
      .where(eq(contractsTable.id, contract.id));
    res.status(201).json({ ...contract, pdfFilename });
  } catch (pdfErr) {
    req.log.error({ err: pdfErr }, "contract signing: PDF generation failed (non-fatal)");
    res.status(201).json(contract);
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
    res.json({ status: session.payment_status, metadata: session.metadata });
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

// ─── ONBOARDING: Create Stripe checkout session ───────────────────────────────
router.post("/portal/checkout/create-session", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { serviceId, contractId, returnUrl, startDate } = req.body as {
    serviceId?: number; contractId?: number; returnUrl?: string; startDate?: string;
  };

  if (!serviceId || !contractId) {
    res.status(400).json({ error: "serviceId and contractId are required" });
    return;
  }

  // ── Security: verify the contract belongs to this user (IDOR prevention) ──
  const [contract] = await db.select().from(contractsTable)
    .where(and(eq(contractsTable.id, contractId), eq(contractsTable.userId, userId)));
  if (!contract) {
    res.status(403).json({ error: "Contract not found or does not belong to this account" });
    return;
  }
  // Also verify the contract is for the same service
  if (contract.serviceId !== serviceId) {
    res.status(403).json({ error: "Contract service mismatch" });
    return;
  }
  // Prevent duplicate checkout sessions for the same contract
  if (contract.stripeSessionId) {
    res.status(409).json({ error: "A checkout session already exists for this contract" });
    return;
  }

  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId));
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }
  if (!service.price) { res.status(400).json({ error: "Service has no price configured" }); return; }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "Online purchasing is not yet configured. Please contact us at info@shanemccaw.com to purchase this service." });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  const priceInCents = Math.round(parseFloat(String(service.price)) * 100);
  const baseUrl = returnUrl ?? `${req.protocol}://${req.hostname}`;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: service.name,
          description: service.description ?? undefined,
        },
        unit_amount: priceInCents,
      },
      quantity: 1,
    }],
    mode: "payment",
    automatic_tax: { enabled: true },
    success_url: `${baseUrl}/portal/onboarding/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/portal/onboarding/contract?serviceId=${serviceId}&cancelled=1`,
    metadata: {
      type: "onboarding_purchase",
      userId: String(userId),
      serviceId: String(serviceId),
      contractId: String(contractId),
      serviceName: service.name,
      startDate: startDate ?? new Date().toISOString(),
    },
  });

  res.json({ url: session.url });
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
