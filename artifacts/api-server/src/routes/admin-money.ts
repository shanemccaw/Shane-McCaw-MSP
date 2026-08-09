/**
 * admin-money.ts — backend for the adminv2 Money screen (SHELL.md).
 *
 * This is Shane's own book of business, not an MSP tenant's dashboard. The
 * platform's `msps` table holds one row per MSP that uses this SaaS, and per
 * `msp.ts`'s own comment, `isDirectBusiness` "marks Shane's own MSP row" —
 * that row's id is the scope for every query here, resolved once via
 * `getDirectBusinessMspId()` rather than trusting `req.user.mspId` (this is
 * an admin-only screen, not an MSP operator's own portal).
 *
 * Every number below is real or explicitly marked as unavailable — never
 * fabricated. Two real gaps in the schema, disclosed rather than guessed:
 *   - No infrastructure or payment-processor fee tracking exists anywhere.
 *     "Cost" here is AI usage only (`ai_usage_events.costCents`); the summary
 *     response says so in `cost.note`.
 *   - "The business" benchmarks are static reference points (commonly cited
 *     targets for a healthy MSP book), not a live industry-benchmark feed —
 *     `benchmarkNote` says so in the response.
 */

import { Router, type Request, type Response } from "express";
import {
  db,
  mspsTable,
  mspChargesTable,
  mspSowsTable,
  tenantsTable,
  usersTable,
  clientServicesTable,
  servicesTable,
  aiUsageEventsTable,
  settingsTable,
} from "@workspace/db";
import { and, eq, gte, sql, desc, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "billing" });
const router = Router();

// ── Shane's own MSP row ─────────────────────────────────────────────────────

let cachedShaneMspId: number | null | undefined;

async function getDirectBusinessMspId(): Promise<number | null> {
  if (cachedShaneMspId !== undefined) return cachedShaneMspId;
  const [row] = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.isDirectBusiness, true))
    .limit(1);
  cachedShaneMspId = row?.id ?? null;
  return cachedShaneMspId;
}

/** Test seam. Not used by the app. */
export function __resetMoneyCacheForTests(): void {
  cachedShaneMspId = undefined;
}

// ── Goals (stored in the generic settingsTable — see admin-sharepoint.ts for the same upsert pattern) ──

const GOALS_SETTINGS_KEY = "admin.money.goals";

interface MoneyGoals {
  goalSales: number;
  mrrGoalCents: number;
  /** Explicit per-month sales targets, keyed "YYYY-MM". Months with no entry fall back to goalSales. */
  ramp: { month: string; target: number }[];
}

function defaultGoals(): MoneyGoals {
  return { goalSales: 3, mrrGoalCents: 600_000, ramp: [] };
}

async function readGoals(): Promise<MoneyGoals> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, GOALS_SETTINGS_KEY));
  if (!row?.value) return defaultGoals();
  try {
    const parsed = JSON.parse(row.value);
    return {
      goalSales: Number.isFinite(parsed.goalSales) ? parsed.goalSales : defaultGoals().goalSales,
      mrrGoalCents: Number.isFinite(parsed.mrrGoalCents) ? parsed.mrrGoalCents : defaultGoals().mrrGoalCents,
      ramp: Array.isArray(parsed.ramp) ? parsed.ramp : [],
    };
  } catch {
    return defaultGoals();
  }
}

async function writeGoals(goals: MoneyGoals): Promise<void> {
  const value = JSON.stringify(goals);
  await db
    .insert(settingsTable)
    .values({ key: GOALS_SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

// ── Month helpers (UTC throughout, so "this month" doesn't drift with server TZ) ──

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function computeAvgSaleCents(mspId: number): Promise<number> {
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [row90] = await db
    .select({ cents: sql<number>`coalesce(avg(${mspChargesTable.amountCents}), 0)`, n: count() })
    .from(mspChargesTable)
    .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, since90)));
  if (row90 && Number(row90.n) > 0) return Math.round(Number(row90.cents));

  const [rowAll] = await db
    .select({ cents: sql<number>`coalesce(avg(${mspChargesTable.amountCents}), 0)` })
    .from(mspChargesTable)
    .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded")));
  return Math.round(Number(rowAll?.cents ?? 0));
}

/** Active retainers for this MSP's own end-clients, normalised to a monthly cents figure. */
async function loadRetainers(mspId: number) {
  const rows = await db
    .select({
      id: clientServicesTable.id,
      customerName: tenantsTable.customerName,
      serviceName: servicesTable.name,
      priceCents: servicesTable.priceCents,
      billingInterval: clientServicesTable.billingInterval,
    })
    .from(clientServicesTable)
    .innerJoin(usersTable, eq(clientServicesTable.clientUserId, usersTable.id))
    .innerJoin(tenantsTable, eq(usersTable.tenantId, tenantsTable.id))
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(and(eq(tenantsTable.mspId, mspId), eq(clientServicesTable.status, "active")));

  return rows.map((r) => ({
    id: String(r.id),
    who: r.customerName ?? "Unknown",
    what: r.serviceName ?? "Service",
    monthlyCents: r.billingInterval === "year" ? Math.round((r.priceCents ?? 0) / 12) : r.priceCents ?? 0,
  }));
}

// ── GET /api/admin/money/summary — "This month" ─────────────────────────────

router.get("/admin/money/summary", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const mspId = await getDirectBusinessMspId();
    if (mspId == null) {
      res.status(404).json({ ok: false, error: "No direct-business MSP row found (msps.is_direct_business)" });
      return;
    }

    const now = new Date();
    const thisMonthStart = monthStart(now);

    const salesRows = await db
      .select({
        id: mspChargesTable.id,
        amountCents: mspChargesTable.amountCents,
        chargedAt: mspChargesTable.chargedAt,
        sowTitle: mspSowsTable.title,
        customerName: tenantsTable.customerName,
      })
      .from(mspChargesTable)
      .leftJoin(mspSowsTable, eq(mspChargesTable.sowId, mspSowsTable.sowId))
      .leftJoin(tenantsTable, eq(mspSowsTable.customerId, tenantsTable.id))
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, thisMonthStart)))
      .orderBy(desc(mspChargesTable.chargedAt));

    const revenueCents = salesRows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

    const [lifetimeRow] = await db
      .select({ cents: sql<number>`coalesce(sum(${mspChargesTable.amountCents}), 0)` })
      .from(mspChargesTable)
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded")));
    const lifetimeCents = Number(lifetimeRow?.cents ?? 0);

    const aiRows = await db
      .select({
        feature: sql<string>`coalesce(${aiUsageEventsTable.feature}, ${aiUsageEventsTable.nodeType})`,
        cents: sql<number>`coalesce(sum(${aiUsageEventsTable.costCents}), 0)`,
      })
      .from(aiUsageEventsTable)
      .where(and(eq(aiUsageEventsTable.mspId, mspId), gte(aiUsageEventsTable.occurredAt, thisMonthStart)))
      .groupBy(sql`coalesce(${aiUsageEventsTable.feature}, ${aiUsageEventsTable.nodeType})`);
    const aiCostCents = aiRows.reduce((sum, r) => sum + Number(r.cents ?? 0), 0);

    const profitCents = revenueCents - aiCostCents;

    const retainers = await loadRetainers(mspId);
    const mrrCents = retainers.reduce((sum, r) => sum + r.monthlyCents, 0);

    // Revenue trend, last 6 months.
    const trendStart = addMonths(thisMonthStart, -5);
    const trendRowsRaw = await db
      .select({
        monthTrunc: sql<string>`date_trunc('month', ${mspChargesTable.chargedAt})`,
        cents: sql<number>`coalesce(sum(${mspChargesTable.amountCents}), 0)`,
      })
      .from(mspChargesTable)
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, trendStart)))
      .groupBy(sql`date_trunc('month', ${mspChargesTable.chargedAt})`);
    const trendByKey = new Map(trendRowsRaw.map((r) => [monthKey(new Date(r.monthTrunc)), Number(r.cents)]));
    const trend = Array.from({ length: 6 }, (_, i) => 5 - i).map((i) => {
      const d = addMonths(thisMonthStart, -i);
      return { month: monthKey(d), label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), cents: trendByKey.get(monthKey(d)) ?? 0 };
    });

    // Trailing 12 months of sale counts, for the streak.
    const streakStart = addMonths(thisMonthStart, -11);
    const countRowsRaw = await db
      .select({ monthTrunc: sql<string>`date_trunc('month', ${mspChargesTable.chargedAt})`, n: count() })
      .from(mspChargesTable)
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, streakStart)))
      .groupBy(sql`date_trunc('month', ${mspChargesTable.chargedAt})`);
    const countByKey = new Map(countRowsRaw.map((r) => [monthKey(new Date(r.monthTrunc)), Number(r.n)]));

    const goals = await readGoals();
    const rampByMonth = new Map(goals.ramp.map((r) => [r.month, r.target]));

    // Consecutive complete months, most recent first, meeting that month's target
    // (its own ramp entry if set, else the current flat goal — target HISTORY
    // isn't tracked, so a changed goal is judged against past months too).
    let streak = 0;
    for (let i = 1; i <= 11; i++) {
      const d = addMonths(thisMonthStart, -i);
      const key = monthKey(d);
      const target = rampByMonth.get(key) ?? goals.goalSales;
      if ((countByKey.get(key) ?? 0) >= target) streak++;
      else break;
    }

    res.json({
      ok: true,
      mspId,
      month: monthLabel(thisMonthStart),
      monthKey: monthKey(thisMonthStart),
      revenue: { cents: revenueCents },
      cost: {
        cents: aiCostCents,
        byFeature: aiRows.map((r) => ({ label: r.feature ?? "unknown", cents: Number(r.cents ?? 0) })),
        note: "Only AI usage cost is tracked here — infrastructure and payment-processor fees are not captured anywhere in the schema yet, so they are left out rather than estimated.",
      },
      profit: { cents: profitCents },
      lifetimeRevenue: { cents: lifetimeCents },
      sales: {
        count: salesRows.length,
        goal: goals.goalSales,
        items: salesRows.map((r) => ({
          id: String(r.id),
          when: r.chargedAt ? r.chargedAt.toISOString() : null,
          who: r.customerName ?? "Unknown",
          what: r.sowTitle ?? "Sale",
          amountCents: r.amountCents ?? 0,
        })),
      },
      retainers,
      mrr: { cents: mrrCents, goalCents: goals.mrrGoalCents },
      streak,
      trend,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Money summary failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET/PUT /api/admin/money/goals ──────────────────────────────────────────

router.get("/admin/money/goals", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const goals = await readGoals();
    res.json({ ok: true, ...goals });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Money goals read failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/admin/money/goals", requireAdmin, async (req: Request, res: Response) => {
  try {
    const current = await readGoals();
    const body = req.body ?? {};
    const next: MoneyGoals = {
      goalSales: Number.isFinite(body.goalSales) ? Math.max(0, Math.round(body.goalSales)) : current.goalSales,
      mrrGoalCents: Number.isFinite(body.mrrGoalCents) ? Math.max(0, Math.round(body.mrrGoalCents)) : current.mrrGoalCents,
      ramp: Array.isArray(body.ramp)
        ? body.ramp
            .filter((r: unknown): r is { month: unknown; target: unknown } => !!r && typeof r === "object")
            .map((r: { month: unknown; target: unknown }) => ({ month: String(r.month), target: Math.max(0, Math.round(Number(r.target) || 0)) }))
        : current.ramp,
    };
    await writeGoals(next);
    log.info({ userId: req.user?.id, goals: next }, "Money goals updated");
    res.json({ ok: true, ...next });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Money goals write failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/admin/money/ramp — "The ramp" ──────────────────────────────────

router.get("/admin/money/ramp", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const mspId = await getDirectBusinessMspId();
    if (mspId == null) {
      res.status(404).json({ ok: false, error: "No direct-business MSP row found (msps.is_direct_business)" });
      return;
    }

    const goals = await readGoals();
    const now = new Date();
    const thisMonthStart = monthStart(now);

    const start = addMonths(thisMonthStart, -11);
    const countRowsRaw = await db
      .select({ monthTrunc: sql<string>`date_trunc('month', ${mspChargesTable.chargedAt})`, n: count() })
      .from(mspChargesTable)
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, start)))
      .groupBy(sql`date_trunc('month', ${mspChargesTable.chargedAt})`);
    const countByKey = new Map(countRowsRaw.map((r) => [monthKey(new Date(r.monthTrunc)), Number(r.n)]));

    const avgSaleCents = await computeAvgSaleCents(mspId);
    const rampByMonth = new Map(goals.ramp.map((r) => [r.month, r.target]));

    // This month plus the next 5 — undefined targets default to a gentle
    // +1-per-month step up from the current goal, mirroring the design's ramp shape.
    const rows = Array.from({ length: 6 }, (_, i) => {
      const d = addMonths(thisMonthStart, i);
      const key = monthKey(d);
      const target = rampByMonth.get(key) ?? goals.goalSales + i;
      return {
        month: key,
        label: monthLabel(d),
        target,
        actual: i === 0 ? countByKey.get(key) ?? 0 : null,
        worthCents: target * avgSaleCents,
      };
    });

    res.json({
      ok: true,
      mspId,
      goalSales: goals.goalSales,
      avgSaleCents,
      projectedYearCents: rows.reduce((s, r) => s + r.worthCents, 0),
      rows,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Money ramp view failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/admin/money/business — "The business" ──────────────────────────

const BENCHMARKS = [
  {
    key: "recurringShare",
    label: "Recurring revenue share of monthly total",
    targetPct: 60,
    direction: "atLeast" as const,
  },
  {
    key: "marginAfterAiCost",
    label: "Margin after AI cost (trailing 3 months)",
    targetPct: 50,
    direction: "atLeast" as const,
  },
  {
    key: "clientConcentration",
    label: "Largest client's share of one-time revenue (trailing 3 months)",
    targetPct: 20,
    direction: "atMost" as const,
  },
];

router.get("/admin/money/business", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const mspId = await getDirectBusinessMspId();
    if (mspId == null) {
      res.status(404).json({ ok: false, error: "No direct-business MSP row found (msps.is_direct_business)" });
      return;
    }

    const now = new Date();
    const windowStart = addMonths(monthStart(now), -2); // this month + trailing 2 = 3 months

    const byClientRows = await db
      .select({
        customerName: tenantsTable.customerName,
        cents: sql<number>`coalesce(sum(${mspChargesTable.amountCents}), 0)`,
      })
      .from(mspChargesTable)
      .leftJoin(mspSowsTable, eq(mspChargesTable.sowId, mspSowsTable.sowId))
      .leftJoin(tenantsTable, eq(mspSowsTable.customerId, tenantsTable.id))
      .where(and(eq(mspChargesTable.mspId, mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, windowStart)))
      .groupBy(tenantsTable.customerName);

    const totalOneTimeCents = byClientRows.reduce((s, r) => s + Number(r.cents ?? 0), 0);
    const topClientCents = byClientRows.reduce((m, r) => Math.max(m, Number(r.cents ?? 0)), 0);
    const clientConcentrationPct = totalOneTimeCents > 0 ? Math.round((topClientCents / totalOneTimeCents) * 1000) / 10 : 0;

    const retainers = await loadRetainers(mspId);
    const clientMrr = new Map<string, number>();
    for (const r of retainers) clientMrr.set(r.who, (clientMrr.get(r.who) ?? 0) + r.monthlyCents);
    const mrrCents = Array.from(clientMrr.values()).reduce((s, v) => s + v, 0);

    const avgMonthlyOneTimeCents = Math.round(totalOneTimeCents / 3);
    const totalMonthlyCents = mrrCents + avgMonthlyOneTimeCents;
    const recurringSharePct = totalMonthlyCents > 0 ? Math.round((mrrCents / totalMonthlyCents) * 1000) / 10 : 0;

    const [aiRow] = await db
      .select({ cents: sql<number>`coalesce(sum(${aiUsageEventsTable.costCents}), 0)` })
      .from(aiUsageEventsTable)
      .where(and(eq(aiUsageEventsTable.mspId, mspId), gte(aiUsageEventsTable.occurredAt, windowStart)));
    const aiCostCents = Number(aiRow?.cents ?? 0);
    const threeMonthGrossCents = totalOneTimeCents + mrrCents * 3;
    const marginAfterAiCostPct = threeMonthGrossCents > 0 ? Math.round(((threeMonthGrossCents - aiCostCents) / threeMonthGrossCents) * 1000) / 10 : 0;

    const actuals: Record<string, number> = {
      recurringShare: recurringSharePct,
      marginAfterAiCost: marginAfterAiCostPct,
      clientConcentration: clientConcentrationPct,
    };
    const benchmarks = BENCHMARKS.map((b) => {
      const actualPct = actuals[b.key] ?? 0;
      const meets = b.direction === "atLeast" ? actualPct >= b.targetPct : actualPct <= b.targetPct;
      return { ...b, actualPct, verdict: meets ? "meets" : "below" as const };
    });

    const clients = Array.from(clientMrr.entries())
      .map(([who, cents]) => ({ who, mrrCents: cents, sharePct: mrrCents > 0 ? Math.round((cents / mrrCents) * 1000) / 10 : 0 }))
      .sort((a, b) => b.mrrCents - a.mrrCents);

    res.json({
      ok: true,
      mspId,
      windowMonths: 3,
      recurringSharePct,
      marginAfterAiCostPct,
      clientConcentrationPct,
      mrrCents,
      benchmarks,
      benchmarkNote:
        "Targets are commonly cited reference points for a healthy MSP book of business, not a live industry-benchmark feed — treat them as a rule of thumb.",
      clients,
    });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "Money business view failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
