import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, clientServicesTable, servicesTable, workflowStepsTable, kanbanTasksTable, documentsTable, reportsTable, invoicesTable, messagesTable, notificationsTable, projectUpdatesTable, usersTable, contractsTable, passwordResetTokensTable, projectTemplatesTable, projectTemplateTasksTable, workflowTemplateStepsTable, contractTemplatesTable, impersonationTokensTable } from "@workspace/db";
import { eq, and, desc, asc, count, sql, inArray } from "drizzle-orm";
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
  const { userId, serviceId, serviceIds: serviceIdsStr, contractId, contractIds: contractIdsStr } = session.metadata ?? {};
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
  const totalAmountDollars = orderedServices
    .reduce((sum, s) => sum + (s.price ? parseFloat(String(s.price)) : 0), 0)
    .toFixed(2);

  // Parse optional start date from checkout metadata; default to now
  const rawStart = session.metadata?.startDate;
  const parsedStart = rawStart ? new Date(rawStart) : new Date();
  const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;

  const buyerLabel = buyer.name ?? buyer.company ?? buyer.email;

  // ── Create one project workspace covering all services in this session ─────
  const projectTitle = `${buyerLabel} — ${serviceNames.join(" + ")}`;
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

  // ── Look up project template for the primary service (used in step seeding below) ──
  const primaryServiceId = orderedServices[0]?.id;
  const [projTemplate] = primaryServiceId
    ? await db.select().from(projectTemplatesTable)
        .where(eq(projectTemplatesTable.serviceId, primaryServiceId))
        .limit(1)
    : [undefined];

  let primaryTemplateTasks: Array<{ title: string; description: string | null }> = [];
  if (projTemplate) {
    primaryTemplateTasks = await db
      .select()
      .from(projectTemplateTasksTable)
      .where(eq(projectTemplateTasksTable.projectTemplateId, projTemplate.id))
      .orderBy(asc(projectTemplateTasksTable.order));
  }

  // ── Loop over every service: assign clientService, link contract, create invoice ──
  for (let i = 0; i < orderedServices.length; i++) {
    const svc = orderedServices[i];
    const cid = cids[i] ?? NaN;
    const svcAmount = svc.price ? parseFloat(String(svc.price)).toFixed(2) : "0.00";

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
    // Primary service: prefer admin-authored template tasks, then slug-based defaults.
    // Secondary services: always use slug-based defaults.
    if (i === 0 && primaryTemplateTasks.length > 0) {
      await db.insert(workflowStepsTable).values(
        primaryTemplateTasks.map((t, idx) => ({
          clientServiceId: newCs.id,
          projectId: project.id,
          title: t.title,
          description: t.description ?? "",
          status: "pending" as const,
          order: idx + 1,
        }))
      );
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
      body: `${buyerLabel} purchased ${serviceNames.length > 1 ? serviceNames.join(" + ") : `"${serviceNames[0]}"`} ($${totalAmountDollars}). Project #${project.id} auto-created.`,
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
      const subId = typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription as { id?: string } | null)?.id ?? null;
      await provisionOnboardingProject(req, session, subId);
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

  res.json({ token, client: { id: client.id, email: client.email, name: client.name } });
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

    // Auto-generate project from linked project template (if any)
    const [projTemplate] = await db
      .select()
      .from(projectTemplatesTable)
      .where(eq(projectTemplatesTable.serviceId, serviceId))
      .limit(1);

    let resolvedProjectId: number | null = projectId ?? null;
    let templateStepsSeeded = false;

    if (projTemplate) {
      const [autoProject] = await db.insert(projectsTable).values({
        title: projTemplate.name,
        description: `Auto-generated from service: ${service.name}`,
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

      // Create workflow_steps from project template tasks (the deliverable task list)
      const templateTasks = await db
        .select()
        .from(projectTemplateTasksTable)
        .where(eq(projectTemplateTasksTable.projectTemplateId, projTemplate.id))
        .orderBy(asc(projectTemplateTasksTable.order));

      if (templateTasks.length > 0) {
        await db.insert(workflowStepsTable).values(
          templateTasks.map((t, idx) => ({
            clientServiceId: cs.id,
            projectId: autoProject.id,
            title: t.title,
            description: t.description,
            status: "pending" as const,
            order: idx,
          }))
        );
        templateStepsSeeded = true;
      }

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
    wizardSelections?: Record<string, { stepId: string; optionId: string }[]>;
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
