/**
 * msp-retainer.ts — the MSP Console operator surface for retainer hours (Git #4020).
 *
 * AdminV2 (`routes/admin-retainer.ts`, Git #1293) is the platform-admin view of
 * the retainer ledger and the customer portal (`routes/portal-retainer.ts`) is
 * the customer's read of their own. Neither is reachable by an MSP operator.
 * This is that operator's write surface, scoped to the operator's own MSP:
 *
 *   GET    /api/msp/:mspId/retainer/customers                                       — this MSP's customers + current bucket
 *   GET    /api/msp/:mspId/customers/:customerId/retainer                           — settings, current bucket, per-period summary, ledger
 *   POST   /api/msp/:mspId/customers/:customerId/retainer/entries                   — log hours
 *   PATCH  /api/msp/:mspId/customers/:customerId/retainer/entries/:entryId          — adjust one entry
 *   DELETE /api/msp/:mspId/customers/:customerId/retainer/entries/:entryId          — remove one entry
 *   POST   /api/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/close       — close an ended period
 *   POST   /api/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/reopen      — reopen a closed period (MSP admin)
 *   POST   /api/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/adjustments — adjust a CLOSED period, with a mandatory reason (#4026)
 *   GET    /api/msp/:mspId/retainer/pending                                         — the tracker byproduct hook's approval queue (#4098)
 *   POST   /api/msp/:mspId/retainer/pending/:entryId/approve                        — approve a queued entry into the ledger, with a mandatory reason (#4098)
 *   POST   /api/msp/:mspId/retainer/pending/:entryId/reject                         — reject a queued entry, with a mandatory reason (#4098)
 *
 * Auth: `requireCapability("ladder.msp-operator")` + `requireMspScope("params")`;
 * reopen and adjustments require `ladder.msp-admin` — reopen undoes a lock
 * another operator set, and adjustments deliberately bypass that lock. The
 * pending-entry approve/reject routes are `ladder.msp-admin` too, for the same
 * reason: approving a queued entry writes into a CLOSED period, the same
 * deliberate-override shape as `.../adjustments`.
 * Every route then confirms the customer is a tenant of `:mspId` (IDOR guard,
 * same as msp-staff.ts), and every entry lookup matches customer AND MSP.
 *
 * Deliberately NOT here: writing `retainer_settings` (allotment, hourly rate,
 * architect). Those are the retainer's commercial terms and stay in AdminV2.
 *
 * Math: all bucket/period arithmetic comes from `lib/retainer-hours.ts` and the
 * anchor from `lib/retainer-period-anchor.ts`; close rules from
 * `lib/retainer-period-close.ts`. Wire shapes reuse admin-retainer.ts's own
 * `entryToWire`/`bucketToWire`, so all three surfaces render one shape.
 *
 * Period close: writes `retainer_period_closes` with a frozen bucket snapshot.
 * While closed, log/adjust/delete into that period answer 409 — same lock,
 * shared via `lib/retainer-ledger-lock.ts`, also honored by AdminV2's own
 * writers (`routes/admin-retainer.ts`, Git #4026, no bypass) AND by the tracker
 * byproduct hook (`lib/retainer-work-logger.ts`, Git #4098 — its own gap: it
 * fires outside any route, so it was never wired into the lock at all). The
 * ways to change a closed period's hours are the `.../adjustments` route above
 * (a direct, reasoned MSP-admin override) and the pending-entry approve route
 * below (a reasoned MSP-admin approval of a byproduct the hook queued instead
 * of writing past the lock) — both write a `retainer_adjustment_notes` row.
 * Every ledger write runs under a per-customer transaction-scoped advisory
 * lock, so a write can't slip into a period between the closed-check and a
 * concurrent close. Closing has no billing side effect — it records and locks,
 * nothing is charged.
 *
 * Hours cross the wire as decimal HOURS (1.5), stored as integer MINUTES.
 */

import { randomUUID } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  retainerSettingsTable,
  retainerWorkLogTable,
  retainerPeriodClosesTable,
  retainerAdjustmentNotesTable,
  retainerPendingEntriesTable,
  tenantsTable,
  tenantSubscriptionsTable,
  mspAuditLogsTable,
  RETAINER_WORK_STATES,
  RETAINER_ADJUSTMENT_ACTIONS,
  RETAINER_PENDING_ENTRY_STATUSES,
  type RetainerPendingEntryStatus,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { logger } from "../lib/logger.ts";
import { auditPrivilegedRead, resolveAuditActorRole } from "../lib/audit.ts";
import {
  minutesToHours,
  hoursToMinutes,
  periodKeyOf,
  isoWeekLabel,
  computeMonthBucket,
  usedMinutesByPeriod,
} from "../lib/retainer-hours.ts";
import {
  resolveRetainerAnchorDay,
  anchorDayFromRows,
  type AnchorSubscriptionRow,
} from "../lib/retainer-period-anchor.ts";
import {
  isPeriodKeyForAnchor,
  periodEndsAt,
  periodHasEnded,
  summaryPeriodKeys,
  bucketFromCloseSnapshot,
} from "../lib/retainer-period-close.ts";
import {
  DEFAULT_RETAINED_MINUTES,
  DEFAULT_RATE_CENTS,
  entryToWire,
  bucketToWire,
  adjustmentNoteToWire,
  type SettingsWire,
} from "./admin-retainer.ts";
import {
  withLedgerLock,
  assertPeriodOpen,
  findClose,
  sendLedgerError,
  LedgerConflict,
  type Tx,
  type CloseRow,
} from "../lib/retainer-ledger-lock.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

/** The customer, only if it is a tenant of this MSP. */
async function findMspCustomer(mspId: number, customerId: number) {
  const [customer] = await db
    .select({ id: tenantsTable.id, name: tenantsTable.customerName })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  return customer ?? null;
}

/** Parse :mspId/:customerId and resolve the customer; answers the response itself on failure. */
async function resolveCustomerOrRespond(req: Request, res: Response) {
  const mspId = parseId(req.params.mspId);
  const customerId = parseId(req.params.customerId);
  if (mspId == null || customerId == null) {
    res.status(400).json({ error: "Invalid mspId or customerId" });
    return null;
  }
  const customer = await findMspCustomer(mspId, customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return { mspId, customerId, customerName: customer.name };
}

/**
 * A `retainer_pending_entries` row → wire (Git #4098). Local to this router —
 * the pending-entry review surface is MSP Console-only, unlike
 * `entryToWire`/`bucketToWire`/`adjustmentNoteToWire`, which AdminV2 and the
 * customer portal also render.
 */
function pendingEntryToWire(row: typeof retainerPendingEntriesTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    periodKey: row.periodKey,
    week: row.weekLabel,
    item: row.item,
    hours: minutesToHours(row.minutes),
    minutes: row.minutes,
    pillar: row.pillar,
    finding: row.finding,
    outcome: row.outcome,
    source: row.source,
    sourceRefId: row.sourceRefId,
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
    status: row.status,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : row.reviewedAt,
    reviewReason: row.reviewReason,
    workLogEntryId: row.workLogEntryId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function closeToWire(row: CloseRow) {
  return {
    periodKey: row.periodKey,
    anchorDay: row.anchorDay,
    hourlyRateCents: row.hourlyRateCents,
    entryCount: row.entryCount,
    note: row.note,
    closedByUserId: row.closedByUserId,
    closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : row.closedAt,
    bucket: bucketToWire(bucketFromCloseSnapshot(row)),
  };
}

/** Non-fatal: the ledger write already committed; an audit failure is logged, not surfaced. */
async function audit(
  req: Request,
  scope: { mspId: number; customerId: number; customerName: string },
  actionType: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(mspAuditLogsTable).values({
      actorUserId: req.user?.id ?? null,
      actorRole: req.user?.mspRole ?? null,
      mspId: scope.mspId,
      customerId: scope.customerId,
      actionType,
      entityType,
      entityId,
      entityLabel: scope.customerName,
      correlationId: getRequestContext()?.traceId ?? randomUUID(),
      ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      outcome: "success",
      metadata,
    });
  } catch (err) {
    log.warn({ err, actionType, entityId }, "msp-retainer: audit write failed (non-fatal)");
  }
}

// ── GET /msp/:mspId/retainer/customers ────────────────────────────────────────
router.get(
  "/msp/:mspId/retainer/customers",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const mspId = parseId(req.params.mspId);
      if (mspId == null) {
        res.status(400).json({ error: "Invalid mspId" });
        return;
      }

      const tenants = await db
        .select({ id: tenantsTable.id, name: tenantsTable.customerName })
        .from(tenantsTable)
        .where(eq(tenantsTable.mspId, mspId))
        .orderBy(tenantsTable.customerName);
      if (tenants.length === 0) {
        res.json({ customers: [] });
        return;
      }
      const ids = tenants.map((t) => t.id);

      const [settingsRows, logRows, subRows, closeRows] = await Promise.all([
        db.select().from(retainerSettingsTable).where(inArray(retainerSettingsTable.customerId, ids)),
        db
          .select({
            customerId: retainerWorkLogTable.customerId,
            periodMonth: retainerWorkLogTable.periodMonth,
            minutes: retainerWorkLogTable.minutes,
          })
          .from(retainerWorkLogTable)
          .where(inArray(retainerWorkLogTable.customerId, ids)),
        // Most-recent-first per tenant, matching anchorDayFromRows's "already ordered" contract.
        db
          .select({
            tenantId: tenantSubscriptionsTable.tenantId,
            status: tenantSubscriptionsTable.status,
            currentPeriodStart: tenantSubscriptionsTable.currentPeriodStart,
          })
          .from(tenantSubscriptionsTable)
          .where(inArray(tenantSubscriptionsTable.tenantId, ids))
          .orderBy(desc(tenantSubscriptionsTable.startedAt), desc(tenantSubscriptionsTable.id)),
        db
          .select({ customerId: retainerPeriodClosesTable.customerId, periodKey: retainerPeriodClosesTable.periodKey })
          .from(retainerPeriodClosesTable)
          .where(inArray(retainerPeriodClosesTable.customerId, ids)),
      ]);

      const settingsByCustomer = new Map(settingsRows.map((s) => [s.customerId, s]));
      const logByCustomer = new Map<number, { periodMonth: string; minutes: number }[]>();
      for (const r of logRows) {
        const arr = logByCustomer.get(r.customerId) ?? [];
        arr.push({ periodMonth: r.periodMonth, minutes: r.minutes });
        logByCustomer.set(r.customerId, arr);
      }
      const subsByCustomer = new Map<number, AnchorSubscriptionRow[]>();
      for (const r of subRows) {
        const arr = subsByCustomer.get(r.tenantId) ?? [];
        arr.push({ status: r.status, currentPeriodStart: r.currentPeriodStart });
        subsByCustomer.set(r.tenantId, arr);
      }
      const latestCloseByCustomer = new Map<number, string>();
      for (const r of closeRows) {
        const prev = latestCloseByCustomer.get(r.customerId);
        if (!prev || r.periodKey > prev) latestCloseByCustomer.set(r.customerId, r.periodKey);
      }

      const now = new Date();
      const customers = tenants.map((t) => {
        const settings = settingsByCustomer.get(t.id);
        const entries = logByCustomer.get(t.id) ?? [];
        const retainedMinutes = settings?.retainedMinutesPerMonth ?? DEFAULT_RETAINED_MINUTES;
        const anchorDay = anchorDayFromRows(subsByCustomer.get(t.id) ?? [], settings?.createdAt ?? null);
        const period = periodKeyOf(anchorDay, now);
        const bucket = computeMonthBucket(anchorDay, period, retainedMinutes, usedMinutesByPeriod(entries));
        return {
          customerId: t.id,
          name: t.name,
          onRetainer: !!settings && settings.active,
          configured: !!settings,
          architectName: settings?.architectName ?? null,
          entryCount: entries.length,
          latestClosedPeriod: latestCloseByCustomer.get(t.id) ?? null,
          bucket: bucketToWire(bucket),
        };
      });

      res.json({ customers });
    } catch (err) {
      log.error({ err }, "GET /msp/:mspId/retainer/customers failed");
      res.status(500).json({ error: "Failed to load retainer customers" });
    }
  },
);

// ── GET /msp/:mspId/customers/:customerId/retainer ────────────────────────────
router.get(
  "/msp/:mspId/customers/:customerId/retainer",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { customerId } = scope;

      const [settings] = await db
        .select()
        .from(retainerSettingsTable)
        .where(eq(retainerSettingsTable.customerId, customerId))
        .limit(1);
      const entries = await db
        .select()
        .from(retainerWorkLogTable)
        .where(eq(retainerWorkLogTable.customerId, customerId))
        .orderBy(desc(retainerWorkLogTable.occurredAt));
      const closes = await db
        .select()
        .from(retainerPeriodClosesTable)
        .where(eq(retainerPeriodClosesTable.customerId, customerId));
      const adjustmentNotes = await db
        .select()
        .from(retainerAdjustmentNotesTable)
        .where(eq(retainerAdjustmentNotesTable.customerId, customerId))
        .orderBy(desc(retainerAdjustmentNotesTable.createdAt));

      const retainedMinutes = settings?.retainedMinutesPerMonth ?? DEFAULT_RETAINED_MINUTES;
      const usedByPeriod = usedMinutesByPeriod(entries);
      const anchorDay = await resolveRetainerAnchorDay(customerId, { settingsCreatedAt: settings?.createdAt ?? null });
      const now = new Date();
      const currentPeriod = periodKeyOf(anchorDay, now);
      const closeByKey = new Map(closes.map((c) => [c.periodKey, c]));
      const entryCountByKey = new Map<string, number>();
      for (const e of entries) entryCountByKey.set(e.periodMonth, (entryCountByKey.get(e.periodMonth) ?? 0) + 1);
      const notesByKey = new Map<string, (typeof adjustmentNotes)>();
      for (const n of adjustmentNotes) {
        const arr = notesByKey.get(n.periodKey) ?? [];
        arr.push(n);
        notesByKey.set(n.periodKey, arr);
      }

      const periods = summaryPeriodKeys(currentPeriod, usedByPeriod.keys(), closeByKey.keys()).map((key) => {
        const close = closeByKey.get(key);
        return {
          periodKey: key,
          endsAt: periodEndsAt(anchorDay, key).toISOString(),
          isCurrent: key === currentPeriod,
          hasEnded: periodHasEnded(anchorDay, key, now),
          entryCount: entryCountByKey.get(key) ?? 0,
          // The live bucket from today's ledger; for a closed period, `close.bucket` is what was frozen.
          bucket: bucketToWire(computeMonthBucket(anchorDay, key, retainedMinutes, usedByPeriod)),
          closed: !!close,
          close: close ? closeToWire(close) : null,
          adjustmentNotes: (notesByKey.get(key) ?? []).map(adjustmentNoteToWire),
        };
      });

      const settingsWire: SettingsWire = {
        customerId,
        retainedHours: minutesToHours(retainedMinutes),
        hourlyRateCents: settings?.hourlyRateCents ?? DEFAULT_RATE_CENTS,
        architectName: settings?.architectName ?? null,
        active: settings?.active ?? false,
        configured: !!settings,
      };

      await auditPrivilegedRead({
        actorUserId: req.user!.id,
        actorName: req.user!.email,
        actorRole: resolveAuditActorRole(req.user!),
        actionType: "retainer.viewed",
        entityType: "retainer",
        tenantId: customerId,
        metadata: { entryCount: entries.length },
      });

      res.json({
        customer: { customerId, name: scope.customerName },
        settings: settingsWire,
        anchorDay,
        currentPeriod,
        bucket: bucketToWire(computeMonthBucket(anchorDay, currentPeriod, retainedMinutes, usedByPeriod)),
        periods,
        entries: entries.map((e) => ({ ...entryToWire(e), periodClosed: closeByKey.has(e.periodMonth) })),
      });
    } catch (err) {
      log.error({ err }, "GET /msp/:mspId/customers/:customerId/retainer failed");
      res.status(500).json({ error: "Failed to load retainer" });
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer/entries ───────────────────
const createEntrySchema = z.object({
  item: z.string().trim().min(1).max(1000),
  hours: z.number().min(0).max(1000),
  pillar: z.string().max(100).nullable().optional(),
  finding: z.string().max(100).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  state: z.enum(RETAINER_WORK_STATES).optional(),
  occurredAt: z.string().datetime().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/retainer/entries",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = createEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;

      const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
      const anchorDay = await resolveRetainerAnchorDay(customerId);
      const periodMonth = periodKeyOf(anchorDay, occurredAt);

      const inserted = await withLedgerLock(customerId, async (tx) => {
        await assertPeriodOpen(tx, customerId, periodMonth);
        const [row] = await tx
          .insert(retainerWorkLogTable)
          .values({
            customerId,
            mspId,
            periodMonth,
            weekLabel: isoWeekLabel(occurredAt),
            item: parsed.data.item,
            minutes: hoursToMinutes(parsed.data.hours),
            pillar: parsed.data.pillar ?? null,
            finding: parsed.data.finding ?? null,
            outcome: parsed.data.outcome ?? null,
            state: parsed.data.state ?? "in_progress",
            source: "unscoped",
            sourceRefId: null,
            loggedByUserId: req.user?.id ?? null,
            occurredAt,
          })
          .returning();
        return row;
      });

      await audit(req, scope, "RETAINER_HOURS_LOGGED", "retainer_work_log", String(inserted.id), {
        periodKey: periodMonth,
        minutes: inserted.minutes,
      });
      log.info({ mspId, customerId, entryId: inserted.id, minutes: inserted.minutes }, "msp retainer hours logged");
      res.status(201).json({ entry: { ...entryToWire(inserted), periodClosed: false } });
    } catch (err) {
      sendLedgerError(res, err, log, "POST /msp/:mspId/customers/:customerId/retainer/entries failed", "Failed to log hours");
    }
  },
);

// ── PATCH /msp/:mspId/customers/:customerId/retainer/entries/:entryId ─────────
const patchEntrySchema = z
  .object({
    item: z.string().trim().min(1).max(1000).optional(),
    hours: z.number().min(0).max(1000).optional(),
    pillar: z.string().max(100).nullable().optional(),
    finding: z.string().max(100).nullable().optional(),
    outcome: z.string().max(4000).nullable().optional(),
    state: z.enum(RETAINER_WORK_STATES).optional(),
    week: z.string().max(20).nullable().optional(),
    occurredAt: z.string().datetime().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "No fields to update" });

router.patch(
  "/msp/:mspId/customers/:customerId/retainer/entries/:entryId",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const entryId = parseId(req.params.entryId);
      if (entryId == null) {
        res.status(400).json({ error: "Invalid entry id" });
        return;
      }
      const parsed = patchEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;
      const anchorDay = parsed.data.occurredAt ? await resolveRetainerAnchorDay(customerId) : null;

      const result = await withLedgerLock(customerId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(retainerWorkLogTable)
          .where(and(
            eq(retainerWorkLogTable.id, entryId),
            eq(retainerWorkLogTable.customerId, customerId),
            eq(retainerWorkLogTable.mspId, mspId),
          ))
          .limit(1);
        if (!existing) throw new LedgerConflict(404, "Entry not found");
        await assertPeriodOpen(tx, customerId, existing.periodMonth);

        const patch: Partial<typeof retainerWorkLogTable.$inferInsert> = { updatedAt: new Date() };
        const d = parsed.data;
        if (d.item !== undefined) patch.item = d.item;
        if (d.hours !== undefined) patch.minutes = hoursToMinutes(d.hours);
        if (d.pillar !== undefined) patch.pillar = d.pillar;
        if (d.finding !== undefined) patch.finding = d.finding;
        if (d.outcome !== undefined) patch.outcome = d.outcome;
        if (d.state !== undefined) patch.state = d.state;
        if (d.occurredAt !== undefined && anchorDay != null) {
          // Moving an entry in time can move it into another period — which must be open too.
          const occurredAt = new Date(d.occurredAt);
          const targetPeriod = periodKeyOf(anchorDay, occurredAt);
          if (targetPeriod !== existing.periodMonth) await assertPeriodOpen(tx, customerId, targetPeriod);
          patch.occurredAt = occurredAt;
          patch.periodMonth = targetPeriod;
          patch.weekLabel = isoWeekLabel(occurredAt);
        }
        if (d.week !== undefined) patch.weekLabel = d.week;

        const [updated] = await tx
          .update(retainerWorkLogTable)
          .set(patch)
          .where(eq(retainerWorkLogTable.id, existing.id))
          .returning();
        return { existing, updated };
      });

      await audit(req, scope, "RETAINER_HOURS_ADJUSTED", "retainer_work_log", String(entryId), {
        fromPeriodKey: result.existing.periodMonth,
        toPeriodKey: result.updated.periodMonth,
        fromMinutes: result.existing.minutes,
        toMinutes: result.updated.minutes,
        fields: Object.keys(parsed.data).filter((k) => (parsed.data as Record<string, unknown>)[k] !== undefined),
      });
      log.info(
        { mspId, customerId, entryId, fromMinutes: result.existing.minutes, toMinutes: result.updated.minutes },
        "msp retainer entry adjusted",
      );
      res.json({ entry: { ...entryToWire(result.updated), periodClosed: false } });
    } catch (err) {
      sendLedgerError(res, err, log, "PATCH /msp/:mspId/customers/:customerId/retainer/entries/:entryId failed", "Failed to update entry");
    }
  },
);

// ── DELETE /msp/:mspId/customers/:customerId/retainer/entries/:entryId ────────
router.delete(
  "/msp/:mspId/customers/:customerId/retainer/entries/:entryId",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const entryId = parseId(req.params.entryId);
      if (entryId == null) {
        res.status(400).json({ error: "Invalid entry id" });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;

      const deleted = await withLedgerLock(customerId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(retainerWorkLogTable)
          .where(and(
            eq(retainerWorkLogTable.id, entryId),
            eq(retainerWorkLogTable.customerId, customerId),
            eq(retainerWorkLogTable.mspId, mspId),
          ))
          .limit(1);
        if (!existing) throw new LedgerConflict(404, "Entry not found");
        await assertPeriodOpen(tx, customerId, existing.periodMonth);
        await tx.delete(retainerWorkLogTable).where(eq(retainerWorkLogTable.id, existing.id));
        return existing;
      });

      await audit(req, scope, "RETAINER_HOURS_DELETED", "retainer_work_log", String(entryId), {
        periodKey: deleted.periodMonth,
        minutes: deleted.minutes,
        item: deleted.item,
        source: deleted.source,
      });
      log.info({ mspId, customerId, entryId, minutes: deleted.minutes }, "msp retainer entry deleted");
      res.json({ ok: true, id: entryId });
    } catch (err) {
      sendLedgerError(res, err, log, "DELETE /msp/:mspId/customers/:customerId/retainer/entries/:entryId failed", "Failed to delete entry");
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/close ──
const closeSchema = z.object({
  note: z.string().max(4000).nullable().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/close",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = closeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;
      const periodKey = String(req.params.periodKey ?? "");

      const [settings] = await db
        .select()
        .from(retainerSettingsTable)
        .where(eq(retainerSettingsTable.customerId, customerId))
        .limit(1);
      if (!settings) {
        // A close snapshot of a default allotment the customer never bought would be invented figures.
        res.status(409).json({ error: "This customer has no retainer configured, so there is no period to close." });
        return;
      }

      const anchorDay = await resolveRetainerAnchorDay(customerId, { settingsCreatedAt: settings.createdAt });
      if (!isPeriodKeyForAnchor(anchorDay, periodKey)) {
        res.status(400).json({
          error: `"${periodKey}" is not a billing period for this customer. Periods start on day ${anchorDay} of the month.`,
        });
        return;
      }
      const now = new Date();
      if (!periodHasEnded(anchorDay, periodKey, now)) {
        res.status(409).json({
          error: `Period ${periodKey} has not ended yet. It can be closed from ${periodEndsAt(anchorDay, periodKey).toISOString()}.`,
        });
        return;
      }

      const close = await withLedgerLock(customerId, async (tx) => {
        if (await findClose(tx, customerId, periodKey)) {
          throw new LedgerConflict(409, `Period ${periodKey} is already closed.`);
        }
        const entries = await tx
          .select({ periodMonth: retainerWorkLogTable.periodMonth, minutes: retainerWorkLogTable.minutes })
          .from(retainerWorkLogTable)
          .where(eq(retainerWorkLogTable.customerId, customerId));
        const bucket = computeMonthBucket(
          anchorDay,
          periodKey,
          settings.retainedMinutesPerMonth,
          usedMinutesByPeriod(entries),
        );
        const [row] = await tx
          .insert(retainerPeriodClosesTable)
          .values({
            customerId,
            mspId,
            periodKey,
            anchorDay,
            retainedMinutes: bucket.retainedMinutes,
            rolledMinutes: bucket.rolledMinutes,
            usedMinutes: bucket.usedMinutes,
            remainingMinutes: bucket.remainingMinutes,
            overMinutes: bucket.overMinutes,
            hourlyRateCents: settings.hourlyRateCents,
            entryCount: entries.filter((e) => e.periodMonth === periodKey).length,
            note: parsed.data.note ?? null,
            closedByUserId: req.user?.id ?? null,
          })
          .returning();
        return row;
      });

      await audit(req, scope, "RETAINER_PERIOD_CLOSED", "retainer_period", periodKey, {
        closeId: close.id,
        usedMinutes: close.usedMinutes,
        remainingMinutes: close.remainingMinutes,
        overMinutes: close.overMinutes,
        entryCount: close.entryCount,
      });
      log.info({ mspId, customerId, periodKey, closeId: close.id }, "msp retainer period closed");
      res.status(201).json({ close: closeToWire(close) });
    } catch (err) {
      sendLedgerError(res, err, log, "POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/close failed", "Failed to close period");
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/reopen ─
router.post(
  "/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/reopen",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;
      const periodKey = String(req.params.periodKey ?? "");

      const removed = await withLedgerLock(customerId, async (tx) => {
        const [row] = await tx
          .delete(retainerPeriodClosesTable)
          .where(and(
            eq(retainerPeriodClosesTable.customerId, customerId),
            eq(retainerPeriodClosesTable.mspId, mspId),
            eq(retainerPeriodClosesTable.periodKey, periodKey),
          ))
          .returning();
        if (!row) throw new LedgerConflict(404, `Period ${periodKey} is not closed.`);
        return row;
      });

      await audit(req, scope, "RETAINER_PERIOD_REOPENED", "retainer_period", periodKey, {
        closedAt: removed.closedAt instanceof Date ? removed.closedAt.toISOString() : removed.closedAt,
        closedByUserId: removed.closedByUserId,
        snapshot: closeToWire(removed).bucket,
      });
      log.info({ mspId, customerId, periodKey }, "msp retainer period reopened");
      res.json({ ok: true, periodKey });
    } catch (err) {
      sendLedgerError(res, err, log, "POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/reopen failed", "Failed to reopen period");
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/adjustments ─
// "Adjust after close" (#4026, Shane's 2026-09-14 decision): the normal
// log/adjust/delete endpoints above stay hard-blocked (409) once a period is
// closed — AdminV2 too, no bypass flag. This is the ONE deliberate override,
// MSP Console only, and it requires a real reason on every call. Every use
// writes a `retainer_adjustment_notes` row (a real, customer-visible revision
// note — see `routes/portal-retainer.ts`) plus an `msp_audit_logs` entry, same
// as every other write on this router.
const adjustmentSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to adjust a closed period"),
  action: z.enum(RETAINER_ADJUSTMENT_ACTIONS),
  entryId: z.number().int().positive().optional(),
  item: z.string().trim().min(1).max(1000).optional(),
  hours: z.number().min(0).max(1000).optional(),
  pillar: z.string().max(100).nullable().optional(),
  finding: z.string().max(100).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  state: z.enum(RETAINER_WORK_STATES).optional(),
  occurredAt: z.string().datetime().optional(),
});

router.post(
  "/msp/:mspId/customers/:customerId/retainer/periods/:periodKey/adjustments",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const parsed = adjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const { action, reason } = parsed.data;
      if (action === "create" && (!parsed.data.item || parsed.data.hours === undefined)) {
        res.status(400).json({ error: "item and hours are required to create an entry" });
        return;
      }
      if ((action === "update" || action === "delete") && parsed.data.entryId == null) {
        res.status(400).json({ error: "entryId is required to update or delete an entry" });
        return;
      }

      const scope = await resolveCustomerOrRespond(req, res);
      if (!scope) return;
      const { mspId, customerId } = scope;
      const periodKey = String(req.params.periodKey ?? "");

      const result = await withLedgerLock(customerId, async (tx) => {
        const close = await findClose(tx, customerId, periodKey);
        if (!close) {
          throw new LedgerConflict(400, `Period ${periodKey} is not closed. Use the normal entry endpoints to change an open period.`);
        }

        let entry: typeof retainerWorkLogTable.$inferSelect;
        let beforeMinutes: number | null = null;

        if (action === "create") {
          // No entry to derive occurredAt from — default to the start of the
          // closed period itself, since periodMonth is set explicitly below
          // rather than derived from occurredAt via periodKeyOf.
          const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(`${periodKey}T12:00:00Z`);
          const [row] = await tx
            .insert(retainerWorkLogTable)
            .values({
              customerId,
              mspId,
              periodMonth: periodKey,
              weekLabel: isoWeekLabel(occurredAt),
              item: parsed.data.item!,
              minutes: hoursToMinutes(parsed.data.hours!),
              pillar: parsed.data.pillar ?? null,
              finding: parsed.data.finding ?? null,
              outcome: parsed.data.outcome ?? null,
              state: parsed.data.state ?? "in_progress",
              source: "unscoped",
              sourceRefId: null,
              loggedByUserId: req.user?.id ?? null,
              occurredAt,
            })
            .returning();
          entry = row;
        } else {
          const [existing] = await tx
            .select()
            .from(retainerWorkLogTable)
            .where(and(
              eq(retainerWorkLogTable.id, parsed.data.entryId!),
              eq(retainerWorkLogTable.customerId, customerId),
              eq(retainerWorkLogTable.mspId, mspId),
            ))
            .limit(1);
          if (!existing) throw new LedgerConflict(404, "Entry not found");
          if (existing.periodMonth !== periodKey) {
            throw new LedgerConflict(400, `Entry ${existing.id} is not in period ${periodKey}`);
          }
          beforeMinutes = existing.minutes;

          if (action === "delete") {
            await tx.delete(retainerWorkLogTable).where(eq(retainerWorkLogTable.id, existing.id));
            entry = existing;
          } else {
            const patch: Partial<typeof retainerWorkLogTable.$inferInsert> = { updatedAt: new Date() };
            const d = parsed.data;
            if (d.item !== undefined) patch.item = d.item;
            if (d.hours !== undefined) patch.minutes = hoursToMinutes(d.hours);
            if (d.pillar !== undefined) patch.pillar = d.pillar;
            if (d.finding !== undefined) patch.finding = d.finding;
            if (d.outcome !== undefined) patch.outcome = d.outcome;
            if (d.state !== undefined) patch.state = d.state;
            const [updated] = await tx
              .update(retainerWorkLogTable)
              .set(patch)
              .where(eq(retainerWorkLogTable.id, existing.id))
              .returning();
            entry = updated;
          }
        }

        const [note] = await tx
          .insert(retainerAdjustmentNotesTable)
          .values({
            customerId,
            mspId,
            periodKey,
            workLogEntryId: entry.id,
            action,
            reason,
            item: entry.item,
            beforeMinutes,
            afterMinutes: action === "delete" ? null : entry.minutes,
            createdByUserId: req.user?.id ?? null,
          })
          .returning();

        return { entry, note, wasDeleted: action === "delete" };
      });

      await audit(req, scope, "RETAINER_PERIOD_ADJUSTED_AFTER_CLOSE", "retainer_work_log", String(result.entry.id), {
        periodKey,
        action,
        reason,
        beforeMinutes: result.note.beforeMinutes,
        afterMinutes: result.note.afterMinutes,
      });
      log.info({ mspId, customerId, periodKey, action, entryId: result.entry.id }, "msp retainer period adjusted after close");
      res.status(201).json({
        note: adjustmentNoteToWire(result.note),
        entry: result.wasDeleted ? null : { ...entryToWire(result.entry), periodClosed: true },
      });
    } catch (err) {
      sendLedgerError(res, err, log, "POST /msp/:mspId/customers/:customerId/retainer/periods/:periodKey/adjustments failed", "Failed to adjust closed period");
    }
  },
);

// ── GET /msp/:mspId/retainer/pending ───────────────────────────────────────────
// The tracker byproduct hook's approval queue (Git #4098, follow-up to #4026):
// logRetainerWorkFromTracker queues here instead of silently writing past the
// period-close lock, or silently skipping, when its target period is closed.
// MSP-wide by default; `?customerId=` narrows to one customer. `?status=`
// defaults to "pending" (the review queue's normal shape) but accepts
// "approved"/"rejected" to read the decided history.
router.get(
  "/msp/:mspId/retainer/pending",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const mspId = parseId(req.params.mspId);
      if (mspId == null) {
        res.status(400).json({ error: "Invalid mspId" });
        return;
      }
      let customerIdParam: number | null = null;
      if (req.query.customerId != null) {
        customerIdParam = parseId(req.query.customerId);
        if (customerIdParam == null) {
          res.status(400).json({ error: "Invalid customerId" });
          return;
        }
      }
      const statusParam = typeof req.query.status === "string" ? req.query.status : "pending";
      if (!(RETAINER_PENDING_ENTRY_STATUSES as readonly string[]).includes(statusParam)) {
        res.status(400).json({ error: `Invalid status filter. One of: ${RETAINER_PENDING_ENTRY_STATUSES.join(", ")}` });
        return;
      }

      const conditions = [
        eq(retainerPendingEntriesTable.mspId, mspId),
        eq(retainerPendingEntriesTable.status, statusParam as RetainerPendingEntryStatus),
      ];
      if (customerIdParam != null) conditions.push(eq(retainerPendingEntriesTable.customerId, customerIdParam));

      const rows = await db
        .select()
        .from(retainerPendingEntriesTable)
        .where(and(...conditions))
        .orderBy(desc(retainerPendingEntriesTable.createdAt));

      const customerIds = [...new Set(rows.map((r) => r.customerId))];
      const names = customerIds.length
        ? await db.select({ id: tenantsTable.id, name: tenantsTable.customerName }).from(tenantsTable).where(inArray(tenantsTable.id, customerIds))
        : [];
      const nameById = new Map(names.map((n) => [n.id, n.name]));

      res.json({ entries: rows.map((r) => ({ ...pendingEntryToWire(r), customerName: nameById.get(r.customerId) ?? null })) });
    } catch (err) {
      log.error({ err }, "GET /msp/:mspId/retainer/pending failed");
      res.status(500).json({ error: "Failed to load pending retainer entries" });
    }
  },
);

// ── POST /msp/:mspId/retainer/pending/:entryId/approve|reject (ladder.msp-admin, #4098) ─
const reviewSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required"),
});

async function loadPendingForReview(mspId: number, entryId: number, res: Response) {
  const [pending] = await db
    .select()
    .from(retainerPendingEntriesTable)
    .where(and(eq(retainerPendingEntriesTable.id, entryId), eq(retainerPendingEntriesTable.mspId, mspId)))
    .limit(1);
  if (!pending) {
    res.status(404).json({ error: "Pending entry not found" });
    return null;
  }
  if (pending.status !== "pending") {
    res.status(409).json({ error: `Entry is already ${pending.status}.` });
    return null;
  }
  const customer = await findMspCustomer(mspId, pending.customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return { pending, customer };
}

router.post(
  "/msp/:mspId/retainer/pending/:entryId/approve",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const mspId = parseId(req.params.mspId);
      const entryId = parseId(req.params.entryId);
      if (mspId == null || entryId == null) {
        res.status(400).json({ error: "Invalid mspId or entry id" });
        return;
      }
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const { reason } = parsed.data;

      const loaded = await loadPendingForReview(mspId, entryId, res);
      if (!loaded) return;
      const { pending, customer } = loaded;

      const result = await withLedgerLock(pending.customerId, async (tx) => {
        // Approval writes the same real row the tracker hook would have
        // written directly, had the period been open — landing now under a
        // human's explicit, reasoned decision instead. Whether the period is
        // still closed at approval time doesn't matter: the reason IS the
        // deliberate override, same shape as the `.../adjustments` route.
        const [entry] = await tx
          .insert(retainerWorkLogTable)
          .values({
            customerId: pending.customerId,
            mspId: pending.mspId,
            periodMonth: pending.periodKey,
            weekLabel: pending.weekLabel,
            item: pending.item,
            minutes: pending.minutes,
            pillar: pending.pillar,
            finding: pending.finding,
            outcome: pending.outcome,
            state: "closed",
            source: pending.source,
            sourceRefId: pending.sourceRefId,
            loggedByUserId: pending.loggedByUserId,
            occurredAt: pending.occurredAt,
          })
          .onConflictDoNothing({
            target: [retainerWorkLogTable.source, retainerWorkLogTable.sourceRefId],
          })
          .returning();

        const workLogEntryId = entry?.id ?? null;

        await tx.insert(retainerAdjustmentNotesTable).values({
          customerId: pending.customerId,
          mspId: pending.mspId,
          periodKey: pending.periodKey,
          workLogEntryId,
          action: "create",
          reason,
          item: pending.item,
          beforeMinutes: null,
          afterMinutes: pending.minutes,
          createdByUserId: req.user?.id ?? null,
        });

        const [updated] = await tx
          .update(retainerPendingEntriesTable)
          .set({
            status: "approved",
            reviewedByUserId: req.user?.id ?? null,
            reviewedAt: new Date(),
            reviewReason: reason,
            workLogEntryId,
          })
          .where(and(eq(retainerPendingEntriesTable.id, pending.id), eq(retainerPendingEntriesTable.status, "pending")))
          .returning();
        if (!updated) throw new LedgerConflict(409, "Entry was already reviewed by someone else.");

        return { updated, entry };
      });

      await audit(req, { mspId, customerId: pending.customerId, customerName: customer.name }, "RETAINER_PENDING_ENTRY_APPROVED", "retainer_pending_entry", String(pending.id), {
        periodKey: pending.periodKey,
        reason,
        workLogEntryId: result.updated.workLogEntryId,
      });
      log.info({ mspId, customerId: pending.customerId, entryId: pending.id }, "msp retainer pending entry approved");
      res.json({
        entry: { ...pendingEntryToWire(result.updated), customerName: customer.name },
        ledgerEntry: result.entry ? { ...entryToWire(result.entry), periodClosed: true } : null,
      });
    } catch (err) {
      sendLedgerError(res, err, log, "POST /msp/:mspId/retainer/pending/:entryId/approve failed", "Failed to approve entry");
    }
  },
);

router.post(
  "/msp/:mspId/retainer/pending/:entryId/reject",
  requireCapability("ladder.msp-admin"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const mspId = parseId(req.params.mspId);
      const entryId = parseId(req.params.entryId);
      if (mspId == null || entryId == null) {
        res.status(400).json({ error: "Invalid mspId or entry id" });
        return;
      }
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const { reason } = parsed.data;

      const loaded = await loadPendingForReview(mspId, entryId, res);
      if (!loaded) return;
      const { pending, customer } = loaded;

      const [updated] = await db
        .update(retainerPendingEntriesTable)
        .set({
          status: "rejected",
          reviewedByUserId: req.user?.id ?? null,
          reviewedAt: new Date(),
          reviewReason: reason,
        })
        .where(and(eq(retainerPendingEntriesTable.id, pending.id), eq(retainerPendingEntriesTable.status, "pending")))
        .returning();
      if (!updated) {
        res.status(409).json({ error: "Entry was already reviewed by someone else." });
        return;
      }

      await audit(req, { mspId, customerId: pending.customerId, customerName: customer.name }, "RETAINER_PENDING_ENTRY_REJECTED", "retainer_pending_entry", String(pending.id), {
        periodKey: pending.periodKey,
        reason,
      });
      log.info({ mspId, customerId: pending.customerId, entryId: pending.id }, "msp retainer pending entry rejected");
      res.json({ entry: { ...pendingEntryToWire(updated), customerName: customer.name } });
    } catch (err) {
      log.error({ err }, "POST /msp/:mspId/retainer/pending/:entryId/reject failed");
      res.status(500).json({ error: "Failed to reject entry" });
    }
  },
);

export default router;
