import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, usersTable } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";
import { createNotification } from "../lib/notification-center";
import { uploadInvoiceToSharePoint } from "../lib/invoice-sharepoint";
import multer from "multer";
import path from "path";
import fs from "fs";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.invoices" });

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

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

const uploadInvoice = multer({ storage: invoiceStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── ADMIN: Invoices ─────────────────────────────────────────────────────────
router.get("/admin/invoices", requireAdmin, async (req: Request, res: Response) => {
  const { type, status, sortBy = "createdAt", sortDir = "desc" } = req.query as {
    type?: string; status?: string; sortBy?: string; sortDir?: string;
  };

  const conditions: ReturnType<typeof eq>[] = [];
  if (type && type !== "all") conditions.push(eq(invoicesTable.invoiceType, type as "instant" | "retainer"));
  if (status && status !== "all") conditions.push(eq(invoicesTable.status, status as "draft" | "due" | "paid" | "overdue"));

  const sortColumnMap = {
    createdAt: invoicesTable.createdAt,
    amount: invoicesTable.amount,
    dueDate: invoicesTable.dueDate,
    status: invoicesTable.status,
    invoiceNumber: invoicesTable.invoiceNumber,
  } as const;
  const sortColumn = sortColumnMap[sortBy as keyof typeof sortColumnMap] ?? invoicesTable.createdAt;
  const orderFn = sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);

  const rows = await db.select({
    id: invoicesTable.id,
    clientUserId: invoicesTable.clientUserId,
    projectId: invoicesTable.projectId,
    invoiceNumber: invoicesTable.invoiceNumber,
    description: invoicesTable.description,
    amount: invoicesTable.amount,
    currency: invoicesTable.currency,
    status: invoicesTable.status,
    dueDate: invoicesTable.dueDate,
    paidAt: invoicesTable.paidAt,
    pdfFilename: invoicesTable.pdfFilename,
    stripeSessionId: invoicesTable.stripeSessionId,
    sharepointFileUrl: invoicesTable.sharepointFileUrl,
    couponCode: invoicesTable.couponCode,
    discountAmount: invoicesTable.discountAmount,
    invoiceType: invoicesTable.invoiceType,
    stripeInvoiceId: invoicesTable.stripeInvoiceId,
    billingCycleStart: invoicesTable.billingCycleStart,
    billingCycleEnd: invoicesTable.billingCycleEnd,
    stripeSubscriptionId: invoicesTable.stripeSubscriptionId,
    createdAt: invoicesTable.createdAt,
    updatedAt: invoicesTable.updatedAt,
    clientName: usersTable.name,
    clientEmail: usersTable.email,
    clientCompany: usersTable.company,
  })
  .from(invoicesTable)
  .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
  .where(conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions))
  .orderBy(orderFn);

  // amount is integer cents in the DB (Git #1610), but admin-panel (out of the
  // sweep scope) still reads a dollar string — convert at this boundary.
  res.json(rows.map((r) => ({ ...r, amount: (r.amount / 100).toFixed(2) })));
});

router.post("/admin/invoices", requireAdmin, uploadInvoice.single("pdf"), async (req: Request, res: Response) => {
  const { clientUserId, projectId, invoiceNumber, description, amount, currency, dueDate } = req.body as {
    clientUserId?: string; projectId?: string; invoiceNumber?: string; description?: string; amount?: string; currency?: string; dueDate?: string;
  };
  if (!clientUserId || !invoiceNumber || !amount) { res.status(400).json({ error: "clientUserId, invoiceNumber, and amount are required" }); return; }

  // The admin form submits amount as a dollar string (step="0.01"); the column
  // is integer cents now (Git #1610), so convert on write.
  const amountCents = Math.round(parseFloat(amount) * 100);
  if (!Number.isFinite(amountCents)) { res.status(400).json({ error: "amount must be a valid number" }); return; }

  const [invoice] = await db.insert(invoicesTable).values({
    clientUserId: parseInt(clientUserId, 10),
    projectId: projectId ? parseInt(projectId, 10) : null,
    invoiceNumber,
    description: description ?? null,
    amount: amountCents,
    currency: currency ?? "usd",
    status: "due",
    dueDate: dueDate ? new Date(dueDate) : null,
    pdfFilename: req.file?.filename ?? null,
  }).returning();
  void uploadInvoiceToSharePoint(invoice.id);

  await createNotification({
    title: `New invoice: ${invoiceNumber}`,
    body: `Amount: $${amount}`,
    notifType: "invoice",
    category: "invoice",
    linkPath: "/portal/billing",
    recipient: { type: "customer_user", userId: parseInt(clientUserId, 10) },
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
    // Audit log renders this as a dollar string ($${meta.amount}); keep dollars.
    metadata: { amount: (invoice.amount / 100).toFixed(2) },
  });

  // Preserve the dollar-string wire contract admin-panel consumes (out of the
  // #1610 sweep scope) — the DB column is cents, the wire stays dollars.
  res.status(201).json({ ...invoice, amount: (invoice.amount / 100).toFixed(2) });
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

router.delete("/admin/invoices/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [deleted] = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Invoice not found" }); return; }

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "invoice_deleted",
    entityType: "invoice",
    entityId: deleted.id,
    entityLabel: deleted.invoiceNumber,
    clientId: deleted.clientUserId,
    metadata: { stripeInvoiceId: deleted.stripeInvoiceId ?? null },
  });

  res.status(204).end();
});

export default router;
