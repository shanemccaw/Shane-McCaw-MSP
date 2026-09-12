/**
 * msp-training-sessions.ts
 *
 * MSP console operator routes for the Training Session Log (Git #3770, Feature
 * roadmap #3768). Real per-customer log of training Shane delivers -- Lunch &
 * Learns, How-To sessions, Prompt-A-Thons, Ask Me Anythings -- backed by
 * `training_sessions` (see
 * `lib/db/migrations/manual/2026-09-12-training-sessions-3770.sql`) -- no
 * fixture data. Same shape family as #3762's status reports.
 *
 *   POST   /api/msp/customers/:customerId/training-sessions
 *     — Log a new training session for a customer.
 *
 *   GET    /api/msp/customers/:customerId/training-sessions
 *     — List a customer's sessions, newest-session-date first, real
 *       pagination via ?limit=&offset=.
 *
 *   GET    /api/msp/training-sessions/:id
 *     — One session.
 *
 *   PATCH  /api/msp/training-sessions/:id
 *     — Edit any field.
 *
 *   DELETE /api/msp/training-sessions/:id
 *     — Delete a session.
 *
 * Auth: requireCapability("ladder.msp-operator") on every route (admits
 * MSPOperator, MSPAdmin, PlatformAdmin) plus assertCustomerAccess on every
 * :customerId-scoped route — the same ownership-check pattern msp-kanban.ts
 * and msp-status-reports.ts use. The :id-only routes resolve the row first,
 * then run the same assertCustomerAccess check against its stored
 * customerId, so a session id belonging to another MSP's customer 404s
 * rather than confirming existence.
 *
 * No MSP Console UI screen yet -- blocked on #3768's real nav placement
 * (separate Feature). Backend/data-model only per #3770's own scope.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, trainingSessionsTable, usersTable, TRAINING_SESSION_TYPES } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function sessionToWire(row: typeof trainingSessionsTable.$inferSelect, loggedByName: string | null) {
  return {
    id: row.id,
    customerId: row.customerId,
    sessionType: row.sessionType,
    sessionDate: row.sessionDate.toISOString(),
    topic: row.topic,
    notes: row.notes,
    loggedByUserId: row.loggedByUserId,
    loggedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  sessionType: z.enum(TRAINING_SESSION_TYPES),
  sessionDate: z.string().datetime({ offset: true }),
  topic: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(10000).optional(),
});

const patchSchema = z.object({
  sessionType: z.enum(TRAINING_SESSION_TYPES).optional(),
  sessionDate: z.string().datetime({ offset: true }).optional(),
  topic: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(10000).nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/customers/:customerId/training-sessions — log a session
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/customers/:customerId/training-sessions",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) return res.status(403).json({ error: "MSP context required" });

      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const [row] = await db
        .insert(trainingSessionsTable)
        .values({
          mspId,
          customerId,
          sessionType: parsed.data.sessionType,
          sessionDate: new Date(parsed.data.sessionDate),
          topic: parsed.data.topic,
          notes: parsed.data.notes ?? null,
          loggedByUserId: req.user!.id,
        })
        .returning();

      return res.status(201).json({ session: sessionToWire(row, req.user!.name ?? null) });
    } catch (err) {
      log.error({ err, customerId }, "msp-training-sessions: POST create failed");
      return res.status(500).json({ error: "Failed to log training session" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/training-sessions — list, paginated
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/training-sessions",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

      const rows = await db
        .select()
        .from(trainingSessionsTable)
        .where(eq(trainingSessionsTable.customerId, customerId))
        .orderBy(desc(trainingSessionsTable.sessionDate))
        .limit(limit)
        .offset(offset);

      const loggedByIds = [...new Set(rows.map((r) => r.loggedByUserId))];
      const loggedByRows = loggedByIds.length
        ? await db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(inArray(usersTable.id, loggedByIds))
        : [];
      const nameById = new Map(loggedByRows.map((u) => [u.id, u.name]));

      return res.json({
        sessions: rows.map((r) => sessionToWire(r, nameById.get(r.loggedByUserId) ?? null)),
        limit,
        offset,
      });
    } catch (err) {
      log.error({ err, customerId }, "msp-training-sessions: GET list failed");
      return res.status(500).json({ error: "Failed to load training sessions" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/training-sessions/:id — one session
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/training-sessions/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [row] = await db.select().from(trainingSessionsTable).where(eq(trainingSessionsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });

      // "not found" and "not yours" both 404 — never confirm a session id
      // belonging to another MSP's customer exists.
      if (!(await assertCustomerAccess(req.user!, row.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const [loggedBy] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.loggedByUserId)).limit(1);

      return res.json({ session: sessionToWire(row, loggedBy?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-training-sessions: GET one failed");
      return res.status(500).json({ error: "Failed to load training session" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/training-sessions/:id — edit
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/training-sessions/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(trainingSessionsTable).where(eq(trainingSessionsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const [row] = await db
        .update(trainingSessionsTable)
        .set({
          ...(parsed.data.sessionType !== undefined ? { sessionType: parsed.data.sessionType } : {}),
          ...(parsed.data.sessionDate !== undefined ? { sessionDate: new Date(parsed.data.sessionDate) } : {}),
          ...(parsed.data.topic !== undefined ? { topic: parsed.data.topic } : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(trainingSessionsTable.id, id))
        .returning();

      const [loggedBy] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.loggedByUserId)).limit(1);

      return res.json({ session: sessionToWire(row, loggedBy?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-training-sessions: PATCH failed");
      return res.status(500).json({ error: "Failed to update training session" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /msp/training-sessions/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/training-sessions/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(trainingSessionsTable).where(eq(trainingSessionsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      await db.delete(trainingSessionsTable).where(eq(trainingSessionsTable.id, id));

      return res.status(204).send();
    } catch (err) {
      log.error({ err, id }, "msp-training-sessions: DELETE failed");
      return res.status(500).json({ error: "Failed to delete training session" });
    }
  },
);

export default router;
