/**
 * msp-communications-push.ts
 *
 * MSP console operator routes for the Communications Push tracker (Git #3769,
 * Feature roadmap #3768 — API first). A real project-management tracking
 * tool, not a delivery/send system: Shane initiates a "communications push"
 * (e.g. an upcoming change/release), assigns it to a customer, and this
 * tracks a cascade of checkpoint reminders (e.g. 60/45/30 days before the
 * effective date) so he doesn't forget to send each one. Who it goes out to
 * and how is entirely on him — no recipient list, no email/Teams
 * integration, no send mechanism of any kind. Backed by
 * `communications_pushes` + `communications_push_checkpoints` (see
 * `lib/db/migrations/manual/2026-09-12-communications-push-3769.sql`) — no
 * fixture data.
 *
 *   POST   /api/msp/customers/:customerId/communications-pushes
 *     — Create a push (title, description?, effectiveDate, offsetDays[]).
 *       Reminder offsets are not hardcoded to exactly 3 — 60/45/30 is only a
 *       default suggestion the caller passes explicitly; each offset
 *       resolves to its own checkpoint row (checkpointDate = effectiveDate -
 *       offsetDays, state "pending").
 *
 *   GET    /api/msp/customers/:customerId/communications-pushes
 *     — List a customer's pushes, newest effective date first, each with its
 *       checkpoints, real pagination via ?limit=&offset=.
 *
 *   GET    /api/msp/communications-pushes/:id
 *     — One push with its checkpoints.
 *
 *   PATCH  /api/msp/communications-pushes/:id
 *     — Edit title/description/effectiveDate. Editing effectiveDate
 *       recomputes every pending checkpoint's checkpointDate from its own
 *       offsetDays (done checkpoints are left alone — a reminder already
 *       sent doesn't un-send itself because the date moved).
 *
 *   DELETE /api/msp/communications-pushes/:id
 *     — Delete a push and its checkpoints (cascade).
 *
 *   POST   /api/msp/communications-pushes/:id/checkpoints
 *     — Add an additional checkpoint offset to an existing push.
 *
 *   PATCH  /api/msp/communications-pushes/checkpoints/:checkpointId/done
 *     — Mark a checkpoint done (idempotent — already-done is a no-op 200,
 *       not an error).
 *
 *   PATCH  /api/msp/communications-pushes/checkpoints/:checkpointId/pending
 *     — Revert a checkpoint back to pending (undo a mis-click).
 *
 *   DELETE /api/msp/communications-pushes/checkpoints/:checkpointId
 *     — Remove a single checkpoint offset from a push.
 *
 * Auth: requireCapability("ladder.msp-operator") on every route (admits
 * MSPOperator, MSPAdmin, PlatformAdmin) plus assertCustomerAccess on every
 * :customerId-scoped route — the same ownership-check pattern
 * msp-status-reports.ts uses. The :id/:checkpointId-only routes resolve the
 * row first, then run the exact same assertCustomerAccess check against its
 * push's stored customerId, so an id belonging to another MSP's customer
 * 404s rather than confirming existence.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  communicationsPushesTable,
  communicationsPushCheckpointsTable,
} from "@workspace/db";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

type PushRow = typeof communicationsPushesTable.$inferSelect;
type CheckpointRow = typeof communicationsPushCheckpointsTable.$inferSelect;

function checkpointToWire(row: CheckpointRow) {
  return {
    id: row.id,
    pushId: row.pushId,
    offsetDays: row.offsetDays,
    checkpointDate: row.checkpointDate.toISOString(),
    state: row.state,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pushToWire(row: PushRow, checkpoints: CheckpointRow[]) {
  return {
    id: row.id,
    customerId: row.customerId,
    title: row.title,
    description: row.description,
    effectiveDate: row.effectiveDate.toISOString(),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    checkpoints: checkpoints
      .slice()
      .sort((a, b) => b.offsetDays - a.offsetDays)
      .map(checkpointToWire),
  };
}

async function loadCheckpoints(pushIds: number[]): Promise<Map<number, CheckpointRow[]>> {
  if (pushIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(communicationsPushCheckpointsTable)
    .where(inArray(communicationsPushCheckpointsTable.pushId, pushIds));
  const byPush = new Map<number, CheckpointRow[]>();
  for (const row of rows) {
    const list = byPush.get(row.pushId) ?? [];
    list.push(row);
    byPush.set(row.pushId, list);
  }
  return byPush;
}

function resolveCheckpointDate(effectiveDate: Date, offsetDays: number): Date {
  const ms = effectiveDate.getTime() - offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/** Loads a push and confirms the caller may access its customer. Returns null
 * (already-responded) on not-found/not-yours so callers can early-return. */
async function loadOwnedPush(req: Request, res: Response, id: number): Promise<PushRow | null> {
  const [row] = await db.select().from(communicationsPushesTable).where(eq(communicationsPushesTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, row.customerId))) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return row;
}

const offsetDaysSchema = z.number().int().positive().max(3650);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  effectiveDate: z.string().datetime({ offset: true }),
  offsetDays: z.array(offsetDaysSchema).min(1).max(50),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  effectiveDate: z.string().datetime({ offset: true }).optional(),
});

const addCheckpointSchema = z.object({
  offsetDays: offsetDaysSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/customers/:customerId/communications-pushes — create a push
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/customers/:customerId/communications-pushes",
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

      const effectiveDate = new Date(parsed.data.effectiveDate);

      const [push] = await db
        .insert(communicationsPushesTable)
        .values({
          mspId,
          customerId,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          effectiveDate,
          createdByUserId: req.user!.id,
        })
        .returning();

      const checkpointRows = parsed.data.offsetDays.length
        ? await db
            .insert(communicationsPushCheckpointsTable)
            .values(
              parsed.data.offsetDays.map((offsetDays) => ({
                pushId: push.id,
                offsetDays,
                checkpointDate: resolveCheckpointDate(effectiveDate, offsetDays),
                state: "pending" as const,
              })),
            )
            .returning()
        : [];

      return res.status(201).json({ push: pushToWire(push, checkpointRows) });
    } catch (err) {
      log.error({ err, customerId }, "communications-push: POST create failed");
      return res.status(500).json({ error: "Failed to create communications push" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/communications-pushes — list, paginated
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/communications-pushes",
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
        .from(communicationsPushesTable)
        .where(eq(communicationsPushesTable.customerId, customerId))
        .orderBy(desc(communicationsPushesTable.effectiveDate))
        .limit(limit)
        .offset(offset);

      const checkpointsByPush = await loadCheckpoints(rows.map((r) => r.id));

      return res.json({
        pushes: rows.map((r) => pushToWire(r, checkpointsByPush.get(r.id) ?? [])),
        limit,
        offset,
      });
    } catch (err) {
      log.error({ err, customerId }, "communications-push: GET list failed");
      return res.status(500).json({ error: "Failed to load communications pushes" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/communications-pushes/:id — one push with checkpoints
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/communications-pushes/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const push = await loadOwnedPush(req, res, id);
      if (!push) return;

      const checkpointsByPush = await loadCheckpoints([push.id]);
      return res.json({ push: pushToWire(push, checkpointsByPush.get(push.id) ?? []) });
    } catch (err) {
      log.error({ err, id }, "communications-push: GET one failed");
      return res.status(500).json({ error: "Failed to load communications push" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/communications-pushes/:id — edit
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/communications-pushes/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const existing = await loadOwnedPush(req, res, id);
      if (!existing) return;

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const newEffectiveDate = parsed.data.effectiveDate !== undefined ? new Date(parsed.data.effectiveDate) : null;

      const [push] = await db
        .update(communicationsPushesTable)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(newEffectiveDate !== null ? { effectiveDate: newEffectiveDate } : {}),
          updatedAt: new Date(),
        })
        .where(eq(communicationsPushesTable.id, id))
        .returning();

      // Editing effectiveDate recomputes every still-pending checkpoint's
      // real resolved date from its own offsetDays. Done checkpoints are
      // left alone -- a reminder already sent doesn't un-send itself.
      if (newEffectiveDate !== null) {
        const pending = await db
          .select()
          .from(communicationsPushCheckpointsTable)
          .where(eq(communicationsPushCheckpointsTable.pushId, id));
        for (const cp of pending) {
          if (cp.state !== "pending") continue;
          await db
            .update(communicationsPushCheckpointsTable)
            .set({
              checkpointDate: resolveCheckpointDate(newEffectiveDate, cp.offsetDays),
              updatedAt: new Date(),
            })
            .where(eq(communicationsPushCheckpointsTable.id, cp.id));
        }
      }

      const checkpointsByPush = await loadCheckpoints([push.id]);
      return res.json({ push: pushToWire(push, checkpointsByPush.get(push.id) ?? []) });
    } catch (err) {
      log.error({ err, id }, "communications-push: PATCH failed");
      return res.status(500).json({ error: "Failed to update communications push" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /msp/communications-pushes/:id — delete push + checkpoints (cascade)
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/communications-pushes/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const existing = await loadOwnedPush(req, res, id);
      if (!existing) return;

      await db.delete(communicationsPushesTable).where(eq(communicationsPushesTable.id, id));
      return res.status(204).send();
    } catch (err) {
      log.error({ err, id }, "communications-push: DELETE failed");
      return res.status(500).json({ error: "Failed to delete communications push" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/communications-pushes/:id/checkpoints — add an offset
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/communications-pushes/:id/checkpoints",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const push = await loadOwnedPush(req, res, id);
      if (!push) return;

      const parsed = addCheckpointSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const [checkpoint] = await db
        .insert(communicationsPushCheckpointsTable)
        .values({
          pushId: push.id,
          offsetDays: parsed.data.offsetDays,
          checkpointDate: resolveCheckpointDate(push.effectiveDate, parsed.data.offsetDays),
          state: "pending",
        })
        .returning();

      return res.status(201).json({ checkpoint: checkpointToWire(checkpoint) });
    } catch (err) {
      log.error({ err, id }, "communications-push: POST checkpoint failed");
      return res.status(500).json({ error: "Failed to add checkpoint" });
    }
  },
);

async function setCheckpointState(req: Request, res: Response, state: "pending" | "done") {
  const checkpointId = parseInt(req.params.checkpointId as string, 10);
  if (isNaN(checkpointId)) return res.status(404).json({ error: "Not found" });

  try {
    const [checkpoint] = await db
      .select()
      .from(communicationsPushCheckpointsTable)
      .where(eq(communicationsPushCheckpointsTable.id, checkpointId))
      .limit(1);
    if (!checkpoint) return res.status(404).json({ error: "Not found" });

    const [push] = await db
      .select()
      .from(communicationsPushesTable)
      .where(eq(communicationsPushesTable.id, checkpoint.pushId))
      .limit(1);
    if (!push || !(await assertCustomerAccess(req.user!, push.customerId))) {
      return res.status(404).json({ error: "Not found" });
    }

    if (checkpoint.state === state) {
      // Idempotent -- already in the target state is a no-op 200, not an error.
      return res.json({ checkpoint: checkpointToWire(checkpoint) });
    }

    const [row] = await db
      .update(communicationsPushCheckpointsTable)
      .set({
        state,
        doneAt: state === "done" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(communicationsPushCheckpointsTable.id, checkpointId))
      .returning();

    return res.json({ checkpoint: checkpointToWire(row) });
  } catch (err) {
    log.error({ err, checkpointId, state }, "communications-push: PATCH checkpoint state failed");
    return res.status(500).json({ error: "Failed to update checkpoint" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/communications-pushes/checkpoints/:checkpointId/done
// PATCH /msp/communications-pushes/checkpoints/:checkpointId/pending
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/communications-pushes/checkpoints/:checkpointId/done",
  requireCapability("ladder.msp-operator"),
  (req: Request, res: Response) => setCheckpointState(req, res, "done"),
);

router.patch(
  "/msp/communications-pushes/checkpoints/:checkpointId/pending",
  requireCapability("ladder.msp-operator"),
  (req: Request, res: Response) => setCheckpointState(req, res, "pending"),
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /msp/communications-pushes/checkpoints/:checkpointId
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/communications-pushes/checkpoints/:checkpointId",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const checkpointId = parseInt(req.params.checkpointId as string, 10);
    if (isNaN(checkpointId)) return res.status(404).json({ error: "Not found" });

    try {
      const [checkpoint] = await db
        .select()
        .from(communicationsPushCheckpointsTable)
        .where(eq(communicationsPushCheckpointsTable.id, checkpointId))
        .limit(1);
      if (!checkpoint) return res.status(404).json({ error: "Not found" });

      const [push] = await db
        .select()
        .from(communicationsPushesTable)
        .where(eq(communicationsPushesTable.id, checkpoint.pushId))
        .limit(1);
      if (!push || !(await assertCustomerAccess(req.user!, push.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      await db.delete(communicationsPushCheckpointsTable).where(eq(communicationsPushCheckpointsTable.id, checkpointId));
      return res.status(204).send();
    } catch (err) {
      log.error({ err, checkpointId }, "communications-push: DELETE checkpoint failed");
      return res.status(500).json({ error: "Failed to delete checkpoint" });
    }
  },
);

export default router;
