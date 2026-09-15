/**
 * msp-invoices.ts
 *
 * MSP-Console-scoped invoice CRUD (#4109, part of #1692). AdminV2's
 * `admin-invoices.ts` is the platform-admin view; this is the technician-side
 * mirror, gated `requireCapability("ladder.msp-operator")` +
 * `requireMspScope("params")` instead of `requireAdmin`, and filtered to the
 * operator's own MSP's clients only.
 *
 * Real ownership join, same pattern as #3967's `msp-azure-credentials.ts`
 * (confirmed against the live schema, not assumed):
 *   invoices.client_user_id → users.id   (FK, schema/index.ts:793)
 *   users.msp_id            → msps.id    (FK, schema/index.ts:108)
 * so an MSP owns an invoice iff its `clientUserId` names a user carrying that
 * MSP's msp_id. A client user belonging to a different MSP (or none) is
 * treated as not found — no cross-MSP read or write is possible.
 *
 * Shane's decision (2026-09-14, #4109 issue body): a DRAFT invoice
 * (status='draft') can be created/updated/deleted freely by the MSP operator.
 * Once SENT (status in due/paid/overdue) it is never edited or deleted in
 * place — the only path forward is POST .../revise, which requires a
 * non-empty `reason`, creates a NEW row (a new version of the same logical
 * invoice, `version` incremented, `supersedesInvoiceId` pointing at the row it
 * replaces), and marks the prior row `status: "superseded"`. Every revision
 * writes a real audit log entry citing the reason.
 *
 * A new DRAFT always starts life as a draft (POST forces `status: "draft"`
 * regardless of what the caller sends) — the operator then PATCHes it forward
 * to `due` (or further) to "send" it, at which point it locks. This keeps the
 * unsent/sent boundary exactly where Shane drew it: the CREATE step never
 * bypasses it.
 *
 * What the customer sees when an invoice is revised was answered by #4116
 * (Shane's decision, dispatch 2026-09-14): the customer's default invoice
 * view (`GET /portal/invoices`) shows only the latest non-superseded version,
 * a real notification links straight to the revised invoice, and a real
 * version-history view (`GET /portal/invoices/:id/versions`) shows each prior
 * version's reason and field-level diff. See `routes/portal-billing.ts`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, usersTable, INVOICE_STATUSES } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { createAuditLog } from "../lib/audit.ts";
import { createNotification } from "../lib/notification-center.ts";
import { uploadInvoiceToSharePoint } from "../lib/invoice-sharepoint.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "billing" });

/** Statuses PATCH may set directly. `superseded` is system-managed only — never a direct write. */
const DIRECT_SETTABLE_STATUSES = ["draft", "due", "paid", "overdue"] as const;
const SENT_STATUSES = ["due", "paid", "overdue"] as const;

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

/** Confirm `clientUserId` names a user that belongs to `mspId` — the ownership gate every handler below runs first. */
async function clientBelongsToMsp(clientUserId: number, mspId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, clientUserId), eq(usersTable.mspId, mspId)))
    .limit(1);
  return Boolean(row);
}

/** Fetch an invoice, only if it belongs to a client of `mspId`. */
async function findMspInvoice(mspId: number, invoiceId: number) {
  const [row] = await db
    .select({ invoice: invoicesTable, clientMspId: usersTable.mspId })
    .from(invoicesTable)
    .innerJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .where(and(eq(invoicesTable.id, invoiceId), eq(usersTable.mspId, mspId)))
    .limit(1);
  return row?.invoice ?? null;
}

function toWire(row: typeof invoicesTable.$inferSelect) {
  // Preserve the dollar-string wire contract the invoice UI consumes (Git
  // #1610) — the DB column is cents, the wire stays dollars.
  return { ...row, amount: (row.amount / 100).toFixed(2) };
}

const createSchema = z.object({
  clientUserId: z.number().int().positive(),
  projectId: z.number().int().positive().nullable().optional(),
  invoiceNumber: z.string().trim().min(1),
  description: z.string().trim().max(4000).nullable().optional(),
  amount: z.number().positive(),
  currency: z.string().trim().min(1).max(10).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  invoiceType: z.enum(["instant", "retainer"]).optional(),
  couponCode: z.string().trim().max(100).nullable().optional(),
  discountAmount: z.number().nonnegative().nullable().optional(),
});

const updateSchema = z.object({
  invoiceNumber: z.string().trim().min(1).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  invoiceType: z.enum(["instant", "retainer"]).optional(),
  couponCode: z.string().trim().max(100).nullable().optional(),
  discountAmount: z.number().nonnegative().nullable().optional(),
  status: z.enum(DIRECT_SETTABLE_STATUSES).optional(),
});

const reviseSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to revise a sent invoice"),
  amount: z.number().positive().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  invoiceType: z.enum(["instant", "retainer"]).optional(),
  couponCode: z.string().trim().max(100).nullable().optional(),
  discountAmount: z.number().nonnegative().nullable().optional(),
  projectId: z.number().int().positive().nullable().optional(),
});

// ── GET /msp/:mspId/clients ──────────────────────────────────────────────────
// The billed-party picker for invoice creation (#2609, wiring this route
// surface into the MSP Console UI). `usersTable`/`clientUserId` is the legacy
// client-portal-user axis `invoicesTable` is keyed on — NOT `tenantsTable`
// (see this file's own header). There is no FK between the two, so a
// tenant-scoped page cannot infer which client user "is" the selected tenant;
// this route lists all of an MSP's client-portal users for an honest, manual
// pick.
router.get(
  "/msp/:mspId/clients",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    if (isNaN(mspId)) { res.status(400).json({ error: "Invalid mspId" }); return; }

    try {
      const rows = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
        .from(usersTable)
        .where(and(eq(usersTable.mspId, mspId), eq(usersTable.role, "client")))
        .orderBy(asc(usersTable.name));

      res.json(rows);
    } catch (err) {
      log.error({ err, mspId }, "GET msp clients failed");
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  },
);

// ── GET /msp/:mspId/invoices ─────────────────────────────────────────────────
router.get(
  "/msp/:mspId/invoices",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    if (isNaN(mspId)) { res.status(400).json({ error: "Invalid mspId" }); return; }

    const { clientUserId, status, sortDir = "desc" } = req.query as {
      clientUserId?: string; status?: string; sortDir?: string;
    };

    const conditions = [eq(usersTable.mspId, mspId)];
    if (clientUserId) {
      const id = parseInt(clientUserId, 10);
      if (!isNaN(id)) conditions.push(eq(invoicesTable.clientUserId, id));
    }
    if (status && status !== "all" && (INVOICE_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(invoicesTable.status, status as (typeof INVOICE_STATUSES)[number]));
    }

    try {
      const rows = await db
        .select({ invoice: invoicesTable, clientName: usersTable.name, clientEmail: usersTable.email })
        .from(invoicesTable)
        .innerJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
        .where(and(...conditions))
        .orderBy(sortDir === "asc" ? asc(invoicesTable.createdAt) : desc(invoicesTable.createdAt));

      res.json(rows.map((r) => ({ ...toWire(r.invoice), clientName: r.clientName, clientEmail: r.clientEmail })));
    } catch (err) {
      log.error({ err, mspId }, "GET msp invoices failed");
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  },
);

// ── GET /msp/:mspId/invoices/:id ─────────────────────────────────────────────
router.get(
  "/msp/:mspId/invoices/:id",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(mspId) || isNaN(id)) { res.status(400).json({ error: "Invalid mspId or id" }); return; }

    try {
      const invoice = await findMspInvoice(mspId, id);
      if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
      res.json(toWire(invoice));
    } catch (err) {
      log.error({ err, mspId, id }, "GET msp invoice failed");
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  },
);

// ── POST /msp/:mspId/invoices ────────────────────────────────────────────────
// Always creates a DRAFT — the unsent/sent boundary starts at creation.
router.post(
  "/msp/:mspId/invoices",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    if (isNaN(mspId)) { res.status(400).json({ error: "Invalid mspId" }); return; }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: zodMessage(parsed.error) }); return; }
    const d = parsed.data;

    try {
      if (!(await clientBelongsToMsp(d.clientUserId, mspId))) {
        res.status(404).json({ error: "Client not found for this MSP" });
        return;
      }

      const [invoice] = await db.insert(invoicesTable).values({
        clientUserId: d.clientUserId,
        projectId: d.projectId ?? null,
        invoiceNumber: d.invoiceNumber,
        description: d.description ?? null,
        amount: Math.round(d.amount * 100),
        currency: d.currency ?? "usd",
        status: "draft",
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        invoiceType: d.invoiceType ?? "instant",
        couponCode: d.couponCode ?? null,
        discountAmount: d.discountAmount != null ? String(d.discountAmount) : null,
        version: 1,
      }).returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: "invoice_created",
        entityType: "invoice",
        entityId: invoice.id,
        entityLabel: invoice.invoiceNumber,
        clientId: invoice.clientUserId,
        metadata: { amount: (invoice.amount / 100).toFixed(2), actorSurface: "msp", mspId },
      });

      res.status(201).json(toWire(invoice));
    } catch (err) {
      log.error({ err, mspId }, "POST msp invoice failed");
      res.status(500).json({ error: "Failed to create invoice" });
    }
  },
);

// ── PATCH /msp/:mspId/invoices/:id ───────────────────────────────────────────
// Draft only. A sent invoice (due/paid/overdue) answers 409 — use .../revise.
router.patch(
  "/msp/:mspId/invoices/:id",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(mspId) || isNaN(id)) { res.status(400).json({ error: "Invalid mspId or id" }); return; }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: zodMessage(parsed.error) }); return; }
    const d = parsed.data;

    try {
      const existing = await findMspInvoice(mspId, id);
      if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
      if (existing.status !== "draft") {
        res.status(409).json({ error: "Invoice has been sent and can no longer be edited directly — use revise instead" });
        return;
      }

      const updates: Partial<typeof invoicesTable.$inferInsert> = { updatedAt: new Date() };
      if (d.invoiceNumber !== undefined) updates.invoiceNumber = d.invoiceNumber;
      if (d.description !== undefined) updates.description = d.description;
      if (d.amount !== undefined) updates.amount = Math.round(d.amount * 100);
      if (d.currency !== undefined) updates.currency = d.currency;
      if (d.dueDate !== undefined) updates.dueDate = d.dueDate ? new Date(d.dueDate) : null;
      if (d.invoiceType !== undefined) updates.invoiceType = d.invoiceType;
      if (d.couponCode !== undefined) updates.couponCode = d.couponCode;
      if (d.discountAmount !== undefined) updates.discountAmount = d.discountAmount != null ? String(d.discountAmount) : null;
      const wasSent = d.status !== undefined && d.status !== "draft";
      if (d.status !== undefined) {
        updates.status = d.status;
        if (d.status === "paid") updates.paidAt = new Date();
      }

      const [updated] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: wasSent ? "invoice_sent" : "invoice_updated",
        entityType: "invoice",
        entityId: updated.id,
        entityLabel: updated.invoiceNumber,
        clientId: updated.clientUserId,
        metadata: { status: updated.status, actorSurface: "msp", mspId },
      });

      if (wasSent) {
        void uploadInvoiceToSharePoint(updated.id);
        void createNotification({
          title: `New invoice: ${updated.invoiceNumber}`,
          body: `Amount: $${(updated.amount / 100).toFixed(2)}`,
          notifType: "invoice",
          category: "invoice",
          linkPath: "/portal/billing",
          recipient: { type: "customer_user", userId: updated.clientUserId },
        });
      }

      res.json(toWire(updated));
    } catch (err) {
      log.error({ err, mspId, id }, "PATCH msp invoice failed");
      res.status(500).json({ error: "Failed to update invoice" });
    }
  },
);

// ── DELETE /msp/:mspId/invoices/:id ──────────────────────────────────────────
// Draft only. A sent invoice answers 409 — it is never deleted, only revised.
router.delete(
  "/msp/:mspId/invoices/:id",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(mspId) || isNaN(id)) { res.status(400).json({ error: "Invalid mspId or id" }); return; }

    try {
      const existing = await findMspInvoice(mspId, id);
      if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
      if (existing.status !== "draft") {
        res.status(409).json({ error: "Only a draft invoice can be deleted — a sent invoice must be revised, not deleted" });
        return;
      }

      const [deleted] = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: "invoice_deleted",
        entityType: "invoice",
        entityId: deleted.id,
        entityLabel: deleted.invoiceNumber,
        clientId: deleted.clientUserId,
        metadata: { actorSurface: "msp", mspId },
      });

      res.status(204).end();
    } catch (err) {
      log.error({ err, mspId, id }, "DELETE msp invoice failed");
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  },
);

// ── POST /msp/:mspId/invoices/:id/revise ─────────────────────────────────────
// Sent (due/paid/overdue) only. Requires a reason. Creates a new version row,
// marks the prior row superseded. 409 on a draft — use PATCH/DELETE for those.
router.post(
  "/msp/:mspId/invoices/:id/revise",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = Number(req.params.mspId);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(mspId) || isNaN(id)) { res.status(400).json({ error: "Invalid mspId or id" }); return; }

    const parsed = reviseSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: zodMessage(parsed.error) }); return; }
    const d = parsed.data;

    try {
      const existing = await findMspInvoice(mspId, id);
      if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
      if (!(SENT_STATUSES as readonly string[]).includes(existing.status)) {
        res.status(409).json({ error: "Only a sent invoice (due/paid/overdue) can be revised — a draft should be updated directly" });
        return;
      }

      const [superseded] = await db
        .update(invoicesTable)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(eq(invoicesTable.id, existing.id))
        .returning();

      const [revised] = await db.insert(invoicesTable).values({
        clientUserId: existing.clientUserId,
        projectId: d.projectId !== undefined ? d.projectId : existing.projectId,
        invoiceNumber: existing.invoiceNumber,
        description: d.description !== undefined ? d.description : existing.description,
        amount: d.amount !== undefined ? Math.round(d.amount * 100) : existing.amount,
        currency: d.currency ?? existing.currency,
        status: "due",
        dueDate: d.dueDate !== undefined ? (d.dueDate ? new Date(d.dueDate) : null) : existing.dueDate,
        invoiceType: d.invoiceType ?? existing.invoiceType,
        couponCode: d.couponCode !== undefined ? d.couponCode : existing.couponCode,
        discountAmount: d.discountAmount !== undefined
          ? (d.discountAmount != null ? String(d.discountAmount) : null)
          : existing.discountAmount,
        version: existing.version + 1,
        supersedesInvoiceId: existing.id,
        revisionReason: d.reason,
      }).returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: "invoice_revised",
        entityType: "invoice",
        entityId: revised.id,
        entityLabel: revised.invoiceNumber,
        clientId: revised.clientUserId,
        metadata: {
          reason: d.reason,
          supersedesInvoiceId: superseded.id,
          previousVersion: superseded.version,
          newVersion: revised.version,
          amount: (revised.amount / 100).toFixed(2),
          actorSurface: "msp",
          mspId,
        },
      });

      void uploadInvoiceToSharePoint(revised.id);
      // Shane's decision (#4116, dispatch 2026-09-14): the customer sees a real
      // notification when a sent invoice is revised, linking straight to the
      // revised invoice's own detail/version-history page — not the bare
      // billing list — so "see what changed" is one click away, not a search.
      void createNotification({
        title: "Your invoice was updated, see what changed",
        body: `Invoice ${revised.invoiceNumber}. Reason: ${d.reason}`,
        notifType: "invoice",
        category: "invoice",
        linkPath: `/billing/invoices/${revised.id}`,
        recipient: { type: "customer_user", userId: revised.clientUserId },
      });

      log.info({ mspId, invoiceId: id, revisedId: revised.id, version: revised.version }, "msp invoice revised");
      res.status(201).json({ superseded: toWire(superseded), revised: toWire(revised) });
    } catch (err) {
      log.error({ err, mspId, id }, "POST msp invoice revise failed");
      res.status(500).json({ error: "Failed to revise invoice" });
    }
  },
);

export default router;
