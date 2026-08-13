/**
 * Admin Platform Incidents — PlatformAdmin-authored CRUD backing the Public
 * Status Page's incident history. Not auto-populated from health signals;
 * PlatformAdmin logs incidents manually.
 *
 *   GET    /api/admin/incidents      — list, most recent first
 *   POST   /api/admin/incidents      — create
 *   PATCH  /api/admin/incidents/:id  — update (title/description/severity/status/resolvedAt)
 *   DELETE /api/admin/incidents/:id  — delete
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, platformIncidentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();
const log = logger.child({ channel: "system.core" });

const SEVERITIES = ["minor", "major", "critical"] as const;
const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;

router.get("/admin/incidents", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const incidents = await db
      .select()
      .from(platformIncidentsTable)
      .orderBy(desc(platformIncidentsTable.startedAt));
    res.json(incidents);
  } catch (err) {
    log.error({ err }, "GET /admin/incidents failed");
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(SEVERITIES),
  status: z.enum(STATUSES).default("investigating"),
  startedAt: z.coerce.date().optional(),
});

router.post("/admin/incidents", requireAdmin, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const { title, description, severity, status, startedAt } = parsed.data;
    const [row] = await db
      .insert(platformIncidentsTable)
      .values({
        title,
        description,
        severity,
        status,
        ...(startedAt ? { startedAt } : {}),
        resolvedAt: status === "resolved" ? new Date() : null,
      })
      .returning();

    log.info({ incidentId: row.id, userId: req.user?.id }, "platform incident created");
    res.status(201).json(row);
  } catch (err) {
    log.error({ err }, "POST /admin/incidents failed");
    res.status(500).json({ error: "Failed to create incident" });
  }
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(STATUSES).optional(),
  startedAt: z.coerce.date().optional(),
  resolvedAt: z.coerce.date().nullable().optional(),
});

router.patch("/admin/incidents/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid incident id" });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  try {
    const updates = { ...parsed.data, updatedAt: new Date() };
    if (updates.status === "resolved" && updates.resolvedAt === undefined) {
      updates.resolvedAt = new Date();
    }

    const [row] = await db
      .update(platformIncidentsTable)
      .set(updates)
      .where(eq(platformIncidentsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    log.info({ incidentId: id, userId: req.user?.id }, "platform incident updated");
    res.json(row);
  } catch (err) {
    log.error({ err }, "PATCH /admin/incidents/:id failed");
    res.status(500).json({ error: "Failed to update incident" });
  }
});

router.delete("/admin/incidents/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid incident id" });
    return;
  }

  try {
    const [row] = await db
      .delete(platformIncidentsTable)
      .where(eq(platformIncidentsTable.id, id))
      .returning({ id: platformIncidentsTable.id });

    if (!row) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    log.info({ incidentId: id, userId: req.user?.id }, "platform incident deleted");
    res.status(204).send();
  } catch (err) {
    log.error({ err }, "DELETE /admin/incidents/:id failed");
    res.status(500).json({ error: "Failed to delete incident" });
  }
});

export default router;
