import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectClosuresTable, projectsTable, usersTable, customerTestimonialsTable, tenantsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
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

// ─── ADMIN: List ALL customer testimonials — BOTH real sources in one view ────
// (Git #3891) — project_closures.feedback (captured only at project sign-off,
// unchanged above) and customer_testimonials (the new standing any-time
// submission surface). Distinguished by `source`.
router.get("/admin/testimonials/all", requireAdmin, async (_req: Request, res: Response) => {
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
        createdAt: customerTestimonialsTable.createdAt,
        authorName: usersTable.name,
        authorEmail: usersTable.email,
      })
      .from(customerTestimonialsTable)
      .innerJoin(tenantsTable, eq(customerTestimonialsTable.customerId, tenantsTable.id))
      .leftJoin(usersTable, eq(customerTestimonialsTable.authorUserId, usersTable.id)),
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

export default router;
