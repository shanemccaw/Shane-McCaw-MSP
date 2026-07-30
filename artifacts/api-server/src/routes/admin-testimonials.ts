import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectClosuresTable, projectsTable, usersTable } from "@workspace/db";
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

export default router;
