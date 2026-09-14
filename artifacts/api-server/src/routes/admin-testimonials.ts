import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  projectClosuresTable,
  projectsTable,
  usersTable,
  customerTestimonialsTable,
  customerBillingCreditsTable,
  tenantsTable,
  type CustomerBillingCredit,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { createAuditLog } from "../lib/audit.ts";
import { issueCreditToNextInvoice, validateCreditDiscount } from "../lib/testimonial-credit.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.testimonials" });

const router: IRouter = Router();

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

/** The credit fields the admin page shows. Stripe ids stay server-side. */
function serializeCredit(credit: CustomerBillingCredit) {
  return {
    id: credit.id,
    status: credit.status,
    discountType: credit.discountType,
    discountValue: credit.discountValue,
    currency: credit.currency,
    failureReason: credit.failureReason,
    issuedAt: credit.issuedAt,
    appliedAt: credit.appliedAt,
    appliedAmountCents: credit.appliedAmountCents,
  };
}

// ─── ADMIN: List ALL customer testimonials — BOTH real sources in one view ────
// (Git #3891) — project_closures.feedback (captured only at project sign-off,
// unchanged above) and customer_testimonials (the new standing any-time
// submission surface). Distinguished by `source`. Portal rows also carry their
// review decision and the credit that approval issued (Git #4032).
router.get("/admin/testimonials/all", requireAdmin, async (_req: Request, res: Response) => {
  const reviewer = alias(usersTable, "reviewer");
  const [closureRows, standingRows] = await Promise.all([
    db
      .select({
        id: projectClosuresTable.id,
        projectId: projectClosuresTable.projectId,
        projectTitle: projectsTable.title,
        projectType: projectsTable.projectType,
        body: projectClosuresTable.feedback,
        permissionToPublish: projectClosuresTable.permissionGranted,
        createdAt: projectClosuresTable.signedAt,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
      })
      .from(projectClosuresTable)
      .innerJoin(projectsTable, eq(projectClosuresTable.projectId, projectsTable.id))
      .leftJoin(usersTable, eq(projectClosuresTable.signerUserId, usersTable.id))
      .where(
        and(
          sql`${projectClosuresTable.signedAt} IS NOT NULL`,
          sql`${projectClosuresTable.feedback} IS NOT NULL AND trim(${projectClosuresTable.feedback}) <> ''`,
        ),
      ),
    db
      .select({
        id: customerTestimonialsTable.id,
        customerId: customerTestimonialsTable.customerId,
        customerName: tenantsTable.customerName,
        kind: customerTestimonialsTable.kind,
        body: customerTestimonialsTable.body,
        permissionToPublish: customerTestimonialsTable.permissionToPublish,
        status: customerTestimonialsTable.status,
        reviewedAt: customerTestimonialsTable.reviewedAt,
        reviewerName: reviewer.name,
        reviewerEmail: reviewer.email,
        createdAt: customerTestimonialsTable.createdAt,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
        credit: customerBillingCreditsTable,
      })
      .from(customerTestimonialsTable)
      .innerJoin(tenantsTable, eq(customerTestimonialsTable.customerId, tenantsTable.id))
      .leftJoin(usersTable, eq(customerTestimonialsTable.authorUserId, usersTable.id))
      .leftJoin(reviewer, eq(customerTestimonialsTable.reviewedByUserId, reviewer.id))
      .leftJoin(customerBillingCreditsTable, eq(customerBillingCreditsTable.sourceTestimonialId, customerTestimonialsTable.id)),
  ]);

  const out = [
    ...closureRows.map((r) => ({
      source: "project_closure" as const,
      id: r.id,
      projectId: r.projectId,
      projectTitle: r.projectTitle,
      projectType: r.projectType,
      kind: "testimonial" as const,
      body: r.body,
      permissionToPublish: r.permissionToPublish,
      createdAt: r.createdAt,
      clientName: r.clientName,
      clientEmail: r.clientEmail,
    })),
    ...standingRows.map((r) => ({
      source: "customer_testimonial" as const,
      id: r.id,
      customerId: r.customerId,
      customerName: r.customerName,
      kind: r.kind,
      body: r.body,
      permissionToPublish: r.permissionToPublish,
      status: r.status,
      reviewedAt: r.reviewedAt,
      reviewerName: r.reviewerName ?? r.reviewerEmail,
      credit: r.credit ? serializeCredit(r.credit) : null,
      createdAt: r.createdAt,
      clientName: r.authorName,
      clientEmail: r.authorEmail,
    })),
  ].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bt - at;
  });

  res.json(out);
});

// ─── ADMIN: Approve a portal testimonial → one-time next-invoice credit ──────
// (Git #4032, decision settled on #3436 2026-09-14.) Approval is the only thing
// that grants the credit. The review decision and the credit row commit together;
// Stripe is called after commit, so a Stripe outage never un-approves anything — the
// credit carries `failed` / `awaiting_subscription` and can be retried below.
router.post("/admin/testimonials/:id/approve", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid testimonial ID" }); return; }

  const { discountType, discountValue } = (req.body ?? {}) as { discountType?: unknown; discountValue?: unknown };
  const discount = validateCreditDiscount(discountType, discountValue);
  if (!discount.ok) { res.status(400).json({ error: discount.error }); return; }

  const actor = req.user!;
  type Outcome =
    | { ok: true; creditId: number; customerId: number }
    | { ok: false; status: number; error: string };

  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [row] = await tx
        .select({
          customerId: customerTestimonialsTable.customerId,
          kind: customerTestimonialsTable.kind,
          permissionToPublish: customerTestimonialsTable.permissionToPublish,
          status: customerTestimonialsTable.status,
        })
        .from(customerTestimonialsTable)
        .where(eq(customerTestimonialsTable.id, id))
        .for("update");

      if (!row) return { ok: false, status: 404, error: "Testimonial not found" };
      if (row.status !== "pending") return { ok: false, status: 409, error: `This testimonial has already been ${row.status}` };
      if (row.kind !== "testimonial") return { ok: false, status: 422, error: "Only a testimonial can be approved — feedback and suggestions are not published" };
      if (!row.permissionToPublish) return { ok: false, status: 422, error: "The customer did not give permission to publish this testimonial" };

      await tx
        .update(customerTestimonialsTable)
        .set({ status: "approved", reviewedAt: new Date(), reviewedByUserId: actor.id })
        .where(eq(customerTestimonialsTable.id, id));

      const [credit] = await tx
        .insert(customerBillingCreditsTable)
        .values({
          tenantId: row.customerId,
          source: "testimonial_approval",
          sourceTestimonialId: id,
          discountType: discount.discountType,
          discountValue: discount.discountValue.toFixed(2),
          issuedByUserId: actor.id,
        })
        .returning({ id: customerBillingCreditsTable.id });

      return { ok: true, creditId: credit!.id, customerId: row.customerId };
    });
  } catch (err) {
    log.error({ err, testimonialId: id }, "admin-testimonials: approve failed");
    res.status(500).json({ error: "Failed to approve testimonial" });
    return;
  }

  if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.error }); return; }

  let credit: CustomerBillingCredit;
  try {
    credit = await issueCreditToNextInvoice(outcome.creditId);
  } catch (err) {
    log.error({ err, testimonialId: id, creditId: outcome.creditId }, "admin-testimonials: approved, but credit issuance errored");
    res.status(500).json({ error: "Testimonial approved, but issuing the credit errored — retry it from the testimonial", testimonialId: id, creditId: outcome.creditId });
    return;
  }

  void createAuditLog({
    actorUserId: actor.id,
    actorName: actor.name ?? actor.email,
    actorRole: "admin",
    actionType: "testimonial_approved",
    entityType: "customer_testimonial",
    entityId: id,
    metadata: {
      customerId: outcome.customerId,
      creditId: credit.id,
      creditStatus: credit.status,
      discountType: credit.discountType,
      discountValue: credit.discountValue,
    },
  });

  res.json({ id, status: "approved", credit: serializeCredit(credit) });
});

// ─── ADMIN: Reject a portal testimonial (no credit) ─────────────────────────
router.post("/admin/testimonials/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid testimonial ID" }); return; }

  const actor = req.user!;
  const [row] = await db
    .update(customerTestimonialsTable)
    .set({ status: "rejected", reviewedAt: new Date(), reviewedByUserId: actor.id })
    .where(and(eq(customerTestimonialsTable.id, id), eq(customerTestimonialsTable.status, "pending")))
    .returning({ id: customerTestimonialsTable.id, customerId: customerTestimonialsTable.customerId });

  if (!row) {
    const [existing] = await db
      .select({ status: customerTestimonialsTable.status })
      .from(customerTestimonialsTable)
      .where(eq(customerTestimonialsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Testimonial not found" }); return; }
    res.status(409).json({ error: `This testimonial has already been ${existing.status}` });
    return;
  }

  void createAuditLog({
    actorUserId: actor.id,
    actorName: actor.name ?? actor.email,
    actorRole: "admin",
    actionType: "testimonial_rejected",
    entityType: "customer_testimonial",
    entityId: id,
    metadata: { customerId: row.customerId },
  });

  res.json({ id, status: "rejected" });
});

// ─── ADMIN: Retry a credit that could not be attached yet ───────────────────
router.post("/admin/testimonial-credits/:id/retry", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid credit ID" }); return; }

  const [existing] = await db
    .select({ status: customerBillingCreditsTable.status })
    .from(customerBillingCreditsTable)
    .where(eq(customerBillingCreditsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Credit not found" }); return; }
  if (existing.status !== "failed" && existing.status !== "awaiting_subscription") {
    res.status(409).json({ error: `This credit is already ${existing.status}` });
    return;
  }

  try {
    const credit = await issueCreditToNextInvoice(id);
    res.json(serializeCredit(credit));
  } catch (err) {
    log.error({ err, creditId: id }, "admin-testimonials: credit retry errored");
    res.status(500).json({ error: "Retrying the credit errored" });
  }
});

export default router;
