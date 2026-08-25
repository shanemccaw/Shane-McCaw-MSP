/**
 * admin-retainer.ts — the AdminV2 Retainer Hours module's API (Git #1293).
 *
 * Shane's admin console reads and writes the retainer ledger here. It is the
 * real source behind the customer-facing "My Architect" retainer page (#1285),
 * which shipped as a fixture only.
 *
 *   GET    /api/admin/retainer/customers            — every customer + retainer state
 *   GET    /api/admin/retainer/:customerId          — settings + month bucket + ledger
 *   PUT    /api/admin/retainer/:customerId/settings — set allotment / rate / architect
 *   POST   /api/admin/retainer/:customerId/unscoped — log ad-hoc (unscoped) hours
 *   PATCH  /api/admin/retainer/entry/:id            — edit one ledger entry
 *   DELETE /api/admin/retainer/entry/:id            — delete one ledger entry
 *
 * Auth: `requireAdmin` — the platform-admin session the AdminV2 console carries.
 * Every customer's rows are scoped by resolving its own tenant (mspId+tenantId),
 * so a stamped `msp_id` is always the customer's real MSP, never assumed.
 *
 * Hours cross the wire as decimal HOURS (1.5), stored as integer MINUTES.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  retainerSettingsTable,
  retainerWorkLogTable,
  tenantsTable,
  RETAINER_WORK_STATES,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope.ts";
import { logger } from "../lib/logger.ts";
import {
  minutesToHours,
  hoursToMinutes,
  periodMonthOf,
  isoWeekLabel,
  computeMonthBucket,
  usedMinutesByPeriod,
  pillarColor,
  RETAINER_STATE_DISPLAY,
} from "../lib/retainer-hours.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const DEFAULT_RETAINED_MINUTES = 480; // 8.0h
const DEFAULT_RATE_CENTS = 30000; // $300/hr

// ── Wire mappers ──────────────────────────────────────────────────────────────

interface SettingsWire {
  customerId: number;
  retainedHours: number;
  hourlyRateCents: number;
  architectName: string | null;
  active: boolean;
  configured: boolean;
}

function entryToWire(row: typeof retainerWorkLogTable.$inferSelect) {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    week: row.weekLabel,
    item: row.item,
    hours: minutesToHours(row.minutes),
    minutes: row.minutes,
    pillar: row.pillar,
    pillarColor: pillarColor(row.pillar),
    finding: row.finding,
    outcome: row.outcome,
    state: RETAINER_STATE_DISPLAY[row.state] ?? row.state,
    stateStored: row.state,
    source: row.source,
    sourceRefId: row.sourceRefId,
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : row.occurredAt,
  };
}

function bucketToWire(bucket: ReturnType<typeof computeMonthBucket>) {
  return {
    period: bucket.period,
    retainedHours: minutesToHours(bucket.retainedMinutes),
    rolledHours: minutesToHours(bucket.rolledMinutes),
    usedHours: minutesToHours(bucket.usedMinutes),
    remainingHours: minutesToHours(bucket.remainingMinutes),
  };
}

// ── GET /admin/retainer/customers ──────────────────────────────────────────────
// Every customer, with its retainer settings (if any) and current-month bucket,
// so the AdminV2 gallery can show who is on retainer and how much is left.
router.get("/admin/retainer/customers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const tenants = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.customerName,
        mspId: tenantsTable.mspId,
      })
      .from(tenantsTable)
      .orderBy(tenantsTable.customerName);

    const settingsRows = await db.select().from(retainerSettingsTable);
    const settingsByCustomer = new Map(settingsRows.map((s) => [s.customerId, s]));

    const logRows = await db
      .select({
        customerId: retainerWorkLogTable.customerId,
        periodMonth: retainerWorkLogTable.periodMonth,
        minutes: retainerWorkLogTable.minutes,
      })
      .from(retainerWorkLogTable);
    const logByCustomer = new Map<number, { periodMonth: string; minutes: number }[]>();
    for (const r of logRows) {
      const arr = logByCustomer.get(r.customerId) ?? [];
      arr.push({ periodMonth: r.periodMonth, minutes: r.minutes });
      logByCustomer.set(r.customerId, arr);
    }

    const currentPeriod = periodMonthOf(new Date());
    const customers = tenants.map((t) => {
      const settings = settingsByCustomer.get(t.id);
      const retainedMinutes = settings?.retainedMinutesPerMonth ?? DEFAULT_RETAINED_MINUTES;
      const usedByPeriod = usedMinutesByPeriod(logByCustomer.get(t.id) ?? []);
      const bucket = computeMonthBucket(currentPeriod, retainedMinutes, usedByPeriod);
      return {
        customerId: t.id,
        name: t.name,
        onRetainer: !!settings && settings.active,
        configured: !!settings,
        architectName: settings?.architectName ?? null,
        entryCount: (logByCustomer.get(t.id) ?? []).length,
        bucket: bucketToWire(bucket),
      };
    });

    res.json({ customers });
  } catch (err) {
    log.error({ err }, "GET /admin/retainer/customers failed");
    res.status(500).json({ error: "Failed to load retainer customers" });
  }
});

// ── GET /admin/retainer/:customerId ────────────────────────────────────────────
router.get("/admin/retainer/:customerId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

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

    const retainedMinutes = settings?.retainedMinutesPerMonth ?? DEFAULT_RETAINED_MINUTES;
    const usedByPeriod = usedMinutesByPeriod(entries);
    const period = periodMonthOf(new Date());
    const bucket = computeMonthBucket(period, retainedMinutes, usedByPeriod);

    const settingsWire: SettingsWire = {
      customerId,
      retainedHours: minutesToHours(retainedMinutes),
      hourlyRateCents: settings?.hourlyRateCents ?? DEFAULT_RATE_CENTS,
      architectName: settings?.architectName ?? null,
      active: settings?.active ?? false,
      configured: !!settings,
    };

    res.json({
      customer: { customerId, name: scope.tenantName },
      settings: settingsWire,
      bucket: bucketToWire(bucket),
      months: [...new Set(entries.map((e) => e.periodMonth))].sort().reverse(),
      entries: entries.map(entryToWire),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/retainer/:customerId failed");
    res.status(500).json({ error: "Failed to load retainer" });
  }
});

// ── PUT /admin/retainer/:customerId/settings ───────────────────────────────────
const settingsSchema = z.object({
  retainedHours: z.number().min(0).max(1000),
  hourlyRateCents: z.number().int().min(0).optional(),
  architectName: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
});

router.put("/admin/retainer/:customerId/settings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const now = new Date();
    const values = {
      customerId,
      mspId: scope.mspId,
      retainedMinutesPerMonth: hoursToMinutes(parsed.data.retainedHours),
      hourlyRateCents: parsed.data.hourlyRateCents ?? DEFAULT_RATE_CENTS,
      architectName: parsed.data.architectName ?? null,
      active: parsed.data.active ?? true,
      updatedAt: now,
    };

    await db
      .insert(retainerSettingsTable)
      .values(values)
      .onConflictDoUpdate({
        target: retainerSettingsTable.customerId,
        set: {
          retainedMinutesPerMonth: values.retainedMinutesPerMonth,
          hourlyRateCents: values.hourlyRateCents,
          architectName: values.architectName,
          active: values.active,
          updatedAt: now,
        },
      });

    log.info({ customerId, retainedHours: parsed.data.retainedHours }, "retainer settings saved");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "PUT /admin/retainer/:customerId/settings failed");
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// ── POST /admin/retainer/:customerId/unscoped ──────────────────────────────────
// The lightweight "log ad-hoc hours" path — work NOT tied to a tracked item.
const unscopedSchema = z.object({
  item: z.string().min(1).max(1000),
  hours: z.number().min(0).max(1000),
  pillar: z.string().max(100).nullable().optional(),
  finding: z.string().max(100).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  state: z.enum(RETAINER_WORK_STATES).optional(),
  occurredAt: z.string().datetime().optional(),
});

router.post("/admin/retainer/:customerId/unscoped", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const parsed = unscopedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
    const [inserted] = await db
      .insert(retainerWorkLogTable)
      .values({
        customerId,
        mspId: scope.mspId,
        periodMonth: periodMonthOf(occurredAt),
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

    log.info({ customerId, entryId: inserted.id, hours: parsed.data.hours }, "unscoped retainer hours logged");
    res.status(201).json({ entry: entryToWire(inserted) });
  } catch (err) {
    log.error({ err }, "POST /admin/retainer/:customerId/unscoped failed");
    res.status(500).json({ error: "Failed to log hours" });
  }
});

// ── PATCH /admin/retainer/entry/:id ────────────────────────────────────────────
const patchEntrySchema = z.object({
  item: z.string().min(1).max(1000).optional(),
  hours: z.number().min(0).max(1000).optional(),
  pillar: z.string().max(100).nullable().optional(),
  finding: z.string().max(100).nullable().optional(),
  outcome: z.string().max(4000).nullable().optional(),
  state: z.enum(RETAINER_WORK_STATES).optional(),
  week: z.string().max(20).nullable().optional(),
});

router.patch("/admin/retainer/entry/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entry id" });
      return;
    }
    const parsed = patchEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const patch: Partial<typeof retainerWorkLogTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.item !== undefined) patch.item = parsed.data.item;
    if (parsed.data.hours !== undefined) patch.minutes = hoursToMinutes(parsed.data.hours);
    if (parsed.data.pillar !== undefined) patch.pillar = parsed.data.pillar;
    if (parsed.data.finding !== undefined) patch.finding = parsed.data.finding;
    if (parsed.data.outcome !== undefined) patch.outcome = parsed.data.outcome;
    if (parsed.data.state !== undefined) patch.state = parsed.data.state;
    if (parsed.data.week !== undefined) patch.weekLabel = parsed.data.week;

    const [updated] = await db
      .update(retainerWorkLogTable)
      .set(patch)
      .where(eq(retainerWorkLogTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json({ entry: entryToWire(updated) });
  } catch (err) {
    log.error({ err }, "PATCH /admin/retainer/entry/:id failed");
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// ── DELETE /admin/retainer/entry/:id ───────────────────────────────────────────
router.delete("/admin/retainer/entry/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entry id" });
      return;
    }
    const [deleted] = await db
      .delete(retainerWorkLogTable)
      .where(eq(retainerWorkLogTable.id, id))
      .returning({ id: retainerWorkLogTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    log.error({ err }, "DELETE /admin/retainer/entry/:id failed");
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

export default router;
