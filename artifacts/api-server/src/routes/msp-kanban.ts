/**
 * msp-kanban.ts
 *
 * MSP Console operator routes for the Simple Kanban board — Phase 1 only
 * (Git #3773, Feature roadmap #3768). Real buckets (columns) + real cards
 * (tasks), backed by `kanban_buckets` / `kanban_cards` (see
 * `lib/db/migrations/manual/2026-09-12-kanban-buckets-cards-3773.sql`) — no
 * fixture data.
 *
 * Deliberately narrow per #3768's phased plan: no `type` field on cards, no
 * per-type forms/templates (Phase 2), no Project Templates (Phase 3), and no
 * connection to #3433 (Project Milestones), #3769 (Communications), #3770
 * (Training) or #3771 (Automation Registry) yet. Backend/data-model only —
 * no MSP Console UI screen (blocked on #3768's real nav placement).
 *
 *   POST   /api/msp/customers/:customerId/kanban/buckets
 *     — Create a bucket. `position` defaults to end-of-list if omitted.
 *
 *   GET    /api/msp/customers/:customerId/kanban/buckets
 *     — List a customer's buckets, each with its own cards, ordered by
 *       position (buckets by their own position, cards within a bucket by
 *       their own position) — the real board shape a UI would render.
 *
 *   PATCH  /api/msp/kanban/buckets/:id
 *     — Rename and/or reposition a bucket.
 *
 *   DELETE /api/msp/kanban/buckets/:id
 *     — Delete a bucket (cascades to its cards).
 *
 *   POST   /api/msp/kanban/buckets/:bucketId/cards
 *     — Create a card in a bucket. `position` defaults to end-of-list.
 *
 *   PATCH  /api/msp/kanban/cards/:id
 *     — Edit title/description, and/or move (bucketId + position). Moving to
 *       a bucket owned by a different customer/MSP is rejected with 400.
 *
 *   DELETE /api/msp/kanban/cards/:id
 *     — Delete a card.
 *
 * Auth: requireCapability("ladder.msp-operator") on every route (admits
 * MSPOperator, MSPAdmin, PlatformAdmin) plus assertCustomerAccess on every
 * :customerId-scoped route. The :id-only routes resolve the row first, then
 * run the same assertCustomerAccess check against its real owning
 * customerId, so a bucket/card id belonging to another MSP's customer 404s
 * rather than confirming existence — same pattern as msp-status-reports.ts.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  kanbanBucketsTable,
  kanbanCardsTable,
  communicationsPushesTable,
  communicationsPushCheckpointsTable,
  trainingSessionsTable,
  automationRegistryTable,
  KANBAN_CARD_TYPES,
  TRAINING_SESSION_TYPES,
} from "@workspace/db";
import { eq, asc, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger.ts";
import { auditPrivilegedRead, resolveAuditActorRole } from "../lib/audit.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function bucketToWire(row: typeof kanbanBucketsTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Phase 2 (Git #4240) — typed-card linked-entity summaries ────────────────
// A typed card surfaces real fields from the entity it links to (never a
// duplicated/fabricated copy) — batch-loaded per board read to avoid N+1.

type CommunicationsPushSummary = {
  id: number;
  title: string;
  effectiveDate: string;
  checkpointsTotal: number;
  checkpointsDone: number;
};
type TrainingSessionSummary = {
  id: number;
  sessionType: string;
  sessionDate: string;
  topic: string;
};
type AutomationRegistrySummary = {
  id: number;
  type: string;
  name: string;
  status: string;
};

interface LinkedSummaries {
  pushById: Map<number, CommunicationsPushSummary>;
  sessionById: Map<number, TrainingSessionSummary>;
  registryById: Map<number, AutomationRegistrySummary>;
}

async function loadLinkedSummaries(cards: (typeof kanbanCardsTable.$inferSelect)[]): Promise<LinkedSummaries> {
  const pushIds = [...new Set(cards.map((c) => c.communicationsPushId).filter((id): id is number => id != null))];
  const sessionIds = [...new Set(cards.map((c) => c.trainingSessionId).filter((id): id is number => id != null))];
  const registryIds = [...new Set(cards.map((c) => c.automationRegistryId).filter((id): id is number => id != null))];

  const [pushRows, checkpointRows, sessionRows, registryRows] = await Promise.all([
    pushIds.length ? db.select().from(communicationsPushesTable).where(inArray(communicationsPushesTable.id, pushIds)) : Promise.resolve([]),
    pushIds.length
      ? db.select().from(communicationsPushCheckpointsTable).where(inArray(communicationsPushCheckpointsTable.pushId, pushIds))
      : Promise.resolve([]),
    sessionIds.length ? db.select().from(trainingSessionsTable).where(inArray(trainingSessionsTable.id, sessionIds)) : Promise.resolve([]),
    registryIds.length ? db.select().from(automationRegistryTable).where(inArray(automationRegistryTable.id, registryIds)) : Promise.resolve([]),
  ]);

  const checkpointCountsByPush = new Map<number, { total: number; done: number }>();
  for (const cp of checkpointRows) {
    const cur = checkpointCountsByPush.get(cp.pushId) ?? { total: 0, done: 0 };
    cur.total += 1;
    if (cp.state === "done") cur.done += 1;
    checkpointCountsByPush.set(cp.pushId, cur);
  }

  return {
    pushById: new Map(
      pushRows.map((r) => [
        r.id,
        {
          id: r.id,
          title: r.title,
          effectiveDate: r.effectiveDate.toISOString(),
          checkpointsTotal: checkpointCountsByPush.get(r.id)?.total ?? 0,
          checkpointsDone: checkpointCountsByPush.get(r.id)?.done ?? 0,
        },
      ]),
    ),
    sessionById: new Map(
      sessionRows.map((r) => [r.id, { id: r.id, sessionType: r.sessionType, sessionDate: r.sessionDate.toISOString(), topic: r.topic }]),
    ),
    registryById: new Map(registryRows.map((r) => [r.id, { id: r.id, type: r.type, name: r.name, status: r.status }])),
  };
}

function cardToWire(row: typeof kanbanCardsTable.$inferSelect, linked: LinkedSummaries) {
  return {
    id: row.id,
    bucketId: row.bucketId,
    title: row.title,
    description: row.description,
    position: row.position,
    type: row.type,
    communicationsPushId: row.communicationsPushId,
    trainingSessionId: row.trainingSessionId,
    automationRegistryId: row.automationRegistryId,
    communicationsPush: row.communicationsPushId != null ? (linked.pushById.get(row.communicationsPushId) ?? null) : null,
    trainingSession: row.trainingSessionId != null ? (linked.sessionById.get(row.trainingSessionId) ?? null) : null,
    automationRegistry: row.automationRegistryId != null ? (linked.registryById.get(row.automationRegistryId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveCheckpointDate(effectiveDate: Date, offsetDays: number): Date {
  const ms = effectiveDate.getTime() - offsetDays * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

const createBucketSchema = z.object({
  name: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).optional(),
});

const patchBucketSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

// Phase 2 (Git #4240): a card is either plain (no `type`) or one of the three
// real linked types. A typed card links to an EXISTING row of that type
// (`communicationsPushId` / `trainingSessionId` / `automationRegistryId`) or,
// for the two types MSP operators can actually write
// (communications_push, training_session), creates a brand-new one inline
// (`newCommunicationsPush` / `newTrainingSession`) — automation_registry has
// no inline-create path because MSP operators have no write access to that
// table (admin/MyArchitect-only by design; see msp-automation-registry.ts).
const offsetDaysSchema = z.number().int().positive().max(3650);

const newCommunicationsPushSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  effectiveDate: z.string().datetime({ offset: true }),
  offsetDays: z.array(offsetDaysSchema).min(1).max(50),
});

const newTrainingSessionSchema = z.object({
  sessionType: z.enum(TRAINING_SESSION_TYPES),
  sessionDate: z.string().datetime({ offset: true }),
  topic: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(10000).optional(),
});

const createCardSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional(),
  position: z.number().int().min(0).optional(),
  type: z.enum(KANBAN_CARD_TYPES).optional(),
  communicationsPushId: z.number().int().positive().optional(),
  trainingSessionId: z.number().int().positive().optional(),
  automationRegistryId: z.number().int().positive().optional(),
  newCommunicationsPush: newCommunicationsPushSchema.optional(),
  newTrainingSession: newTrainingSessionSchema.optional(),
});

const patchCardSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  bucketId: z.number().int().optional(),
  position: z.number().int().min(0).optional(),
});

async function nextBucketPosition(customerId: number): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${kanbanBucketsTable.position})` })
    .from(kanbanBucketsTable)
    .where(eq(kanbanBucketsTable.customerId, customerId));
  return (row?.max ?? -1) + 1;
}

async function nextCardPosition(bucketId: number): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${kanbanCardsTable.position})` })
    .from(kanbanCardsTable)
    .where(eq(kanbanCardsTable.bucketId, bucketId));
  return (row?.max ?? -1) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/customers/:customerId/kanban/buckets — create a bucket
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/customers/:customerId/kanban/buckets",
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

      const parsed = createBucketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const position = parsed.data.position ?? (await nextBucketPosition(customerId));

      const [row] = await db
        .insert(kanbanBucketsTable)
        .values({ mspId, customerId, name: parsed.data.name, position })
        .returning();

      return res.status(201).json({ bucket: bucketToWire(row) });
    } catch (err) {
      log.error({ err, customerId }, "msp-kanban: POST bucket create failed");
      return res.status(500).json({ error: "Failed to create bucket" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/kanban/buckets — list board (buckets + cards)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/kanban/buckets",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const buckets = await db
        .select()
        .from(kanbanBucketsTable)
        .where(eq(kanbanBucketsTable.customerId, customerId))
        .orderBy(asc(kanbanBucketsTable.position));

      if (buckets.length === 0) {
        return res.json({ buckets: [] });
      }

      const bucketIds = buckets.map((b) => b.id);
      const cards = await db
        .select()
        .from(kanbanCardsTable)
        .where(sql`${kanbanCardsTable.bucketId} = ANY(${bucketIds})`)
        .orderBy(asc(kanbanCardsTable.position));

      const linked = await loadLinkedSummaries(cards);
      const cardsByBucket = new Map<number, ReturnType<typeof cardToWire>[]>();
      for (const card of cards) {
        const list = cardsByBucket.get(card.bucketId) ?? [];
        list.push(cardToWire(card, linked));
        cardsByBucket.set(card.bucketId, list);
      }

      await auditPrivilegedRead({
        actorUserId: req.user!.id,
        actorName: req.user!.email,
        actorRole: resolveAuditActorRole(req.user!),
        actionType: "kanban_board_viewed",
        entityType: "kanban_board",
        tenantId: customerId,
        metadata: { bucketCount: buckets.length, cardCount: cards.length },
      });

      return res.json({
        buckets: buckets.map((b) => ({ ...bucketToWire(b), cards: cardsByBucket.get(b.id) ?? [] })),
      });
    } catch (err) {
      log.error({ err, customerId }, "msp-kanban: GET buckets failed");
      return res.status(500).json({ error: "Failed to load kanban board" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/kanban/buckets/:id — rename / reposition
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/kanban/buckets/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(kanbanBucketsTable).where(eq(kanbanBucketsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const parsed = patchBucketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const [row] = await db
        .update(kanbanBucketsTable)
        .set({
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
          updatedAt: new Date(),
        })
        .where(eq(kanbanBucketsTable.id, id))
        .returning();

      return res.json({ bucket: bucketToWire(row) });
    } catch (err) {
      log.error({ err, id }, "msp-kanban: PATCH bucket failed");
      return res.status(500).json({ error: "Failed to update bucket" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /msp/kanban/buckets/:id — cascades to its cards
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/kanban/buckets/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(kanbanBucketsTable).where(eq(kanbanBucketsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      await db.delete(kanbanBucketsTable).where(eq(kanbanBucketsTable.id, id));

      return res.status(204).send();
    } catch (err) {
      log.error({ err, id }, "msp-kanban: DELETE bucket failed");
      return res.status(500).json({ error: "Failed to delete bucket" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/kanban/buckets/:bucketId/cards — create a card
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/kanban/buckets/:bucketId/cards",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const bucketId = parseInt(req.params.bucketId as string, 10);
    if (isNaN(bucketId)) return res.status(404).json({ error: "Not found" });

    try {
      const [bucket] = await db.select().from(kanbanBucketsTable).where(eq(kanbanBucketsTable.id, bucketId)).limit(1);
      if (!bucket) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, bucket.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const parsed = createCardSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const data = parsed.data;

      let type: (typeof KANBAN_CARD_TYPES)[number] | null = null;
      let communicationsPushId: number | null = null;
      let trainingSessionId: number | null = null;
      let automationRegistryId: number | null = null;

      if (data.type === "communications_push") {
        if (!!data.communicationsPushId === !!data.newCommunicationsPush) {
          return res.status(400).json({ error: "Provide exactly one of communicationsPushId or newCommunicationsPush" });
        }
        if (data.communicationsPushId !== undefined) {
          const [push] = await db
            .select()
            .from(communicationsPushesTable)
            .where(eq(communicationsPushesTable.id, data.communicationsPushId))
            .limit(1);
          if (!push || push.customerId !== bucket.customerId) {
            return res.status(400).json({ error: "communicationsPushId does not belong to this customer" });
          }
          communicationsPushId = push.id;
        } else {
          const mspId = resolveMspIdStrict(req);
          if (mspId === null) return res.status(403).json({ error: "MSP context required" });
          const effectiveDate = new Date(data.newCommunicationsPush!.effectiveDate);
          const [push] = await db
            .insert(communicationsPushesTable)
            .values({
              mspId,
              customerId: bucket.customerId,
              title: data.newCommunicationsPush!.title,
              description: data.newCommunicationsPush!.description ?? null,
              effectiveDate,
              createdByUserId: req.user!.id,
            })
            .returning();
          await db.insert(communicationsPushCheckpointsTable).values(
            data.newCommunicationsPush!.offsetDays.map((offsetDays) => ({
              pushId: push.id,
              offsetDays,
              checkpointDate: resolveCheckpointDate(effectiveDate, offsetDays),
              state: "pending" as const,
            })),
          );
          communicationsPushId = push.id;
        }
        type = "communications_push";
      } else if (data.type === "training_session") {
        if (!!data.trainingSessionId === !!data.newTrainingSession) {
          return res.status(400).json({ error: "Provide exactly one of trainingSessionId or newTrainingSession" });
        }
        if (data.trainingSessionId !== undefined) {
          const [session] = await db
            .select()
            .from(trainingSessionsTable)
            .where(eq(trainingSessionsTable.id, data.trainingSessionId))
            .limit(1);
          if (!session || session.customerId !== bucket.customerId) {
            return res.status(400).json({ error: "trainingSessionId does not belong to this customer" });
          }
          trainingSessionId = session.id;
        } else {
          const mspId = resolveMspIdStrict(req);
          if (mspId === null) return res.status(403).json({ error: "MSP context required" });
          const [session] = await db
            .insert(trainingSessionsTable)
            .values({
              mspId,
              customerId: bucket.customerId,
              sessionType: data.newTrainingSession!.sessionType,
              sessionDate: new Date(data.newTrainingSession!.sessionDate),
              topic: data.newTrainingSession!.topic,
              notes: data.newTrainingSession!.notes ?? null,
              loggedByUserId: req.user!.id,
            })
            .returning();
          trainingSessionId = session.id;
        }
        type = "training_session";
      } else if (data.type === "automation_registry") {
        // No inline-create path — MSP operators have no write access to
        // automation_registry (admin/MyArchitect-only), so a card can only
        // link to an entry that already exists (see msp-automation-registry.ts).
        if (data.automationRegistryId === undefined) {
          return res.status(400).json({ error: "automationRegistryId is required for type automation_registry" });
        }
        const [entry] = await db
          .select()
          .from(automationRegistryTable)
          .where(eq(automationRegistryTable.id, data.automationRegistryId))
          .limit(1);
        if (!entry || entry.customerId !== bucket.customerId) {
          return res.status(400).json({ error: "automationRegistryId does not belong to this customer" });
        }
        automationRegistryId = entry.id;
        type = "automation_registry";
      } else if (
        data.communicationsPushId !== undefined ||
        data.trainingSessionId !== undefined ||
        data.automationRegistryId !== undefined ||
        data.newCommunicationsPush !== undefined ||
        data.newTrainingSession !== undefined
      ) {
        return res.status(400).json({ error: "Linking fields require a type" });
      }

      const position = data.position ?? (await nextCardPosition(bucketId));

      const [row] = await db
        .insert(kanbanCardsTable)
        .values({
          bucketId,
          title: data.title,
          description: data.description ?? null,
          position,
          type,
          communicationsPushId,
          trainingSessionId,
          automationRegistryId,
        })
        .returning();

      const linked = await loadLinkedSummaries([row]);
      return res.status(201).json({ card: cardToWire(row, linked) });
    } catch (err) {
      log.error({ err, bucketId }, "msp-kanban: POST card create failed");
      return res.status(500).json({ error: "Failed to create card" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/kanban/cards/:id — edit and/or move (bucketId + position)
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/kanban/cards/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(kanbanCardsTable).where(eq(kanbanCardsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      const [currentBucket] = await db
        .select()
        .from(kanbanBucketsTable)
        .where(eq(kanbanBucketsTable.id, existing.bucketId))
        .limit(1);
      if (!currentBucket || !(await assertCustomerAccess(req.user!, currentBucket.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const parsed = patchCardSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      let targetBucketId = existing.bucketId;
      if (parsed.data.bucketId !== undefined && parsed.data.bucketId !== existing.bucketId) {
        const [targetBucket] = await db
          .select()
          .from(kanbanBucketsTable)
          .where(eq(kanbanBucketsTable.id, parsed.data.bucketId))
          .limit(1);
        if (!targetBucket || targetBucket.customerId !== currentBucket.customerId) {
          return res.status(400).json({ error: "Target bucket does not belong to this customer" });
        }
        targetBucketId = targetBucket.id;
      }

      const [row] = await db
        .update(kanbanCardsTable)
        .set({
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          bucketId: targetBucketId,
          ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
          updatedAt: new Date(),
        })
        .where(eq(kanbanCardsTable.id, id))
        .returning();

      const linked = await loadLinkedSummaries([row]);
      return res.json({ card: cardToWire(row, linked) });
    } catch (err) {
      log.error({ err, id }, "msp-kanban: PATCH card failed");
      return res.status(500).json({ error: "Failed to update card" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /msp/kanban/cards/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/kanban/cards/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(kanbanCardsTable).where(eq(kanbanCardsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      const [bucket] = await db
        .select()
        .from(kanbanBucketsTable)
        .where(eq(kanbanBucketsTable.id, existing.bucketId))
        .limit(1);
      if (!bucket || !(await assertCustomerAccess(req.user!, bucket.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      await db.delete(kanbanCardsTable).where(eq(kanbanCardsTable.id, id));

      return res.status(204).send();
    } catch (err) {
      log.error({ err, id }, "msp-kanban: DELETE card failed");
      return res.status(500).json({ error: "Failed to delete card" });
    }
  },
);

export default router;
