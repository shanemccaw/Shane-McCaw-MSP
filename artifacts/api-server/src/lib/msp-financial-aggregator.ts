import {
  db,
  mspSubscriptionsTable,
  invoicesTable,
  kanbanTasksTable,
  salesOffersTable,
  tenantSignalHistoryTable,
  servicesTable,
  projectsTable,
  mspUsersTable,
  workflowStepsTable,
  clientServicesTable,
} from "@workspace/db";
import { eq, and, gte, isNull, inArray, count } from "drizzle-orm";
import { resolveCatalogPricing } from "./catalog-pricing.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "billing" });

export interface FinancialBreakdown {
  grossRevenueUsd: string;
  wholesaleCostUsd: string;
  mspMarginUsd: string;
  mspMarginPct: string;
}

export interface TelemetryPayload {
  financials: {
    monitoringMrr: FinancialBreakdown;
    projectRevenue: FinancialBreakdown;
    remediationRevenue: FinancialBreakdown;
    offerRevenue: FinancialBreakdown;
    total: FinancialBreakdown;
  };
  metrics: {
    activeSignalsCount: number;
    offerAcceptanceRate: number;
    openFulfillmentTasksCount: number;
  };
}

function formatFinancials(retailCents: number, wholesaleCents: number): FinancialBreakdown {
  const marginCents = retailCents - wholesaleCents;
  const marginPct = retailCents > 0
    ? ((marginCents / retailCents) * 100).toFixed(1)
    : "0.0";
  return {
    grossRevenueUsd: (retailCents / 100).toFixed(2),
    wholesaleCostUsd: (wholesaleCents / 100).toFixed(2),
    mspMarginUsd: (marginCents / 100).toFixed(2),
    mspMarginPct: `${marginPct}%`,
  };
}

/**
 * Aggregates unified full-catalog revenue and performance telemetry for a specific MSP.
 */
export async function aggregateMspTelemetry(
  mspId: number,
  startDate?: Date,
): Promise<TelemetryPayload> {
  // ── 1. Financial Aggregation ──

  // Category A: monitoringMrr (Active/trialing/past_due subscriptions of the MSP)
  const subs = await db
    .select({
      priceCents: servicesTable.priceCents,
      internalCostCents: servicesTable.internalCostCents,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(mspSubscriptionsTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(mspSubscriptionsTable.mspId, mspId),
        inArray(mspSubscriptionsTable.status, ["active", "trialing", "past_due"]),
        startDate ? gte(mspSubscriptionsTable.createdAt, startDate) : undefined,
      )
    );

  let monitoringMrrRetailCents = 0;
  let monitoringMrrWholesaleCents = 0;
  for (const sub of subs) {
    const pricing = resolveCatalogPricing({
      priceCents: sub.priceCents ?? 0,
      internalCostCents: sub.internalCostCents,
    });
    monitoringMrrRetailCents += pricing.retailPriceCents;
    monitoringMrrWholesaleCents += pricing.wholesaleCostCents;
  }
  log.debug(
    { mspId, startDate: startDate?.toISOString() ?? null, subscriptionCount: subs.length, monitoringMrrRetailCents },
    "monitoringMrr scoped to startDate",
  );

  // Category B: projectRevenue (Paid invoices for this MSP's customers)
  const invoices = await db
    .select({
      amount: invoicesTable.amount,
    })
    .from(invoicesTable)
    .innerJoin(mspUsersTable, eq(invoicesTable.clientUserId, mspUsersTable.userId))
    .where(
      and(
        eq(mspUsersTable.mspId, mspId),
        eq(invoicesTable.status, "paid"),
        startDate ? gte(invoicesTable.paidAt, startDate) : undefined,
      )
    );

  let projectRetailCents = 0;
  let projectWholesaleCents = 0;
  for (const inv of invoices) {
    const amountCents = Math.round(Number(inv.amount) * 100);
    const pricing = resolveCatalogPricing({
      priceCents: amountCents,
    });
    projectRetailCents += pricing.retailPriceCents;
    projectWholesaleCents += pricing.wholesaleCostCents;
  }

  // Category C: remediationRevenue (Completed kanban tasks linked to a catalog product)
  const tasks = await db
    .select({
      priceCents: servicesTable.priceCents,
      internalCostCents: servicesTable.internalCostCents,
    })
    .from(kanbanTasksTable)
    .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
    .innerJoin(mspUsersTable, eq(projectsTable.clientUserId, mspUsersTable.userId))
    .innerJoin(workflowStepsTable, eq(kanbanTasksTable.workflowStepId, workflowStepsTable.id))
    .innerJoin(clientServicesTable, eq(workflowStepsTable.clientServiceId, clientServicesTable.id))
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(
      and(
        eq(mspUsersTable.mspId, mspId),
        eq(kanbanTasksTable.column, "completed"),
        startDate ? gte(kanbanTasksTable.updatedAt, startDate) : undefined,
      )
    );

  let remediationRetailCents = 0;
  let remediationWholesaleCents = 0;
  for (const task of tasks) {
    const pricing = resolveCatalogPricing({
      priceCents: task.priceCents ?? 0,
      internalCostCents: task.internalCostCents,
    });
    remediationRetailCents += pricing.retailPriceCents;
    remediationWholesaleCents += pricing.wholesaleCostCents;
  }

  // Category D: offerRevenue (Accepted sales offers)
  const offers = await db
    .select({
      adjustedPriceCents: salesOffersTable.adjustedPriceCents,
      internalCostCents: salesOffersTable.internalCostCents,
    })
    .from(salesOffersTable)
    .where(
      and(
        eq(salesOffersTable.mspId, mspId),
        eq(salesOffersTable.state, "accepted"),
        startDate ? gte(salesOffersTable.acceptedAt, startDate) : undefined,
      )
    );

  let offerRetailCents = 0;
  let offerWholesaleCents = 0;
  for (const offer of offers) {
    const pricing = resolveCatalogPricing({
      priceCents: offer.adjustedPriceCents,
      internalCostCents: offer.internalCostCents,
    });
    offerRetailCents += pricing.retailPriceCents;
    offerWholesaleCents += pricing.wholesaleCostCents;
  }

  // Total
  const totalRetailCents =
    monitoringMrrRetailCents +
    projectRetailCents +
    remediationRetailCents +
    offerRetailCents;

  const totalWholesaleCents =
    monitoringMrrWholesaleCents +
    projectWholesaleCents +
    remediationWholesaleCents +
    offerWholesaleCents;

  // ── 2. Operational Metrics ──

  // 1. Active signals count (unresolved signals in current month)
  const activeSignalsRes = await db
    .select({ count: count() })
    .from(tenantSignalHistoryTable)
    .where(
      and(
        eq(tenantSignalHistoryTable.mspId, mspId),
        isNull(tenantSignalHistoryTable.resolvedAt),
        startDate ? gte(tenantSignalHistoryTable.firedAt, startDate) : undefined,
      )
    );
  const activeSignalsCount = Number(activeSignalsRes[0]?.count ?? 0);

  // 2. Offer acceptance rate (%) (accepted / total generated * 100)
  const offerStats = await db
    .select({
      state: salesOffersTable.state,
      count: count(),
    })
    .from(salesOffersTable)
    .where(eq(salesOffersTable.mspId, mspId))
    .groupBy(salesOffersTable.state);

  let totalGenerated = 0;
  let acceptedCount = 0;
  for (const row of offerStats) {
    const n = Number(row.count);
    totalGenerated += n;
    if (row.state === "accepted") {
      acceptedCount = n;
    }
  }
  const offerAcceptanceRate = totalGenerated > 0
    ? Math.round((acceptedCount / totalGenerated) * 100)
    : 0;

  // 3. Open fulfillment tasks in portal_kanban_tasks assigned to the MSP
  const openTasksRes = await db
    .select({ count: count() })
    .from(kanbanTasksTable)
    .innerJoin(projectsTable, eq(kanbanTasksTable.projectId, projectsTable.id))
    .innerJoin(mspUsersTable, eq(projectsTable.clientUserId, mspUsersTable.userId))
    .where(
      and(
        eq(mspUsersTable.mspId, mspId),
        inArray(kanbanTasksTable.column, ["backlog", "in_progress", "review"]),
      )
    );
  const openFulfillmentTasksCount = Number(openTasksRes[0]?.count ?? 0);

  return {
    financials: {
      monitoringMrr: formatFinancials(monitoringMrrRetailCents, monitoringMrrWholesaleCents),
      projectRevenue: formatFinancials(projectRetailCents, projectWholesaleCents),
      remediationRevenue: formatFinancials(remediationRetailCents, remediationWholesaleCents),
      offerRevenue: formatFinancials(offerRetailCents, offerWholesaleCents),
      total: formatFinancials(totalRetailCents, totalWholesaleCents),
    },
    metrics: {
      activeSignalsCount,
      offerAcceptanceRate,
      openFulfillmentTasksCount,
    },
  };
}

/**
 * Platform-wide monitoring MRR, summed across every MSP.
 *
 * Re-runs Category A of aggregateMspTelemetry() above (same
 * mspSubscriptionsTable ⋈ servicesTable join, same active/trialing/past_due
 * status filter, same resolveCatalogPricing() split) with no mspId filter,
 * so this stays reconcilable to Σ(monitoringMrr) across all MSPs — do not
 * diverge this calculation from aggregateMspTelemetry()'s Category A.
 */
export async function aggregatePlatformMonitoringMrr(startDate?: Date): Promise<FinancialBreakdown> {
  const subs = await db
    .select({
      priceCents: servicesTable.priceCents,
      internalCostCents: servicesTable.internalCostCents,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(mspSubscriptionsTable.serviceId, servicesTable.id))
    .where(
      and(
        inArray(mspSubscriptionsTable.status, ["active", "trialing", "past_due"]),
        startDate ? gte(mspSubscriptionsTable.createdAt, startDate) : undefined,
      )
    );

  let retailCents = 0;
  let wholesaleCents = 0;
  for (const sub of subs) {
    const pricing = resolveCatalogPricing({
      priceCents: sub.priceCents ?? 0,
      internalCostCents: sub.internalCostCents,
    });
    retailCents += pricing.retailPriceCents;
    wholesaleCents += pricing.wholesaleCostCents;
  }

  log.debug(
    { startDate: startDate?.toISOString() ?? null, subscriptionCount: subs.length, retailCents },
    "platform-wide monitoringMrr aggregated",
  );

  return formatFinancials(retailCents, wholesaleCents);
}

export interface ColonyCompositeScore {
  score: number;
  momentumBonusApplied: boolean;
  currentMonthRevenueUsd: number;
  trailingThreeMonthAvgRevenueUsd: number;
}

function startOfCurrentMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfTrailingThreeMonths(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
}

/**
 * Factory Floor composite score (locked formula):
 *   Score = (Subscriptions/Retainers revenue × 1.0)
 *         + (Consulting revenue × 0.6)
 *         + (Documents/Quick Fixes revenue × 0.4)
 *         + Momentum Bonus
 *   Momentum Bonus = +10% to the score if current month's revenue exceeds
 *   the trailing 3-month average, else +0%.
 *
 * Category mapping (reuses aggregateMspTelemetry()'s existing categories —
 * no new tables):
 *   Subscriptions/Retainers → financials.monitoringMrr
 *   Consulting              → financials.projectRevenue
 *   Documents/Quick Fixes   → financials.remediationRevenue + financials.offerRevenue (one-time items)
 */
export async function calculateColonyCompositeScore(mspId: number): Promise<ColonyCompositeScore> {
  const lifetime = await aggregateMspTelemetry(mspId);

  const subscriptionsRetainersUsd = Number(lifetime.financials.monitoringMrr.grossRevenueUsd);
  const consultingUsd = Number(lifetime.financials.projectRevenue.grossRevenueUsd);
  const documentsQuickFixesUsd =
    Number(lifetime.financials.remediationRevenue.grossRevenueUsd) +
    Number(lifetime.financials.offerRevenue.grossRevenueUsd);

  const baseScore =
    subscriptionsRetainersUsd * 1.0 +
    consultingUsd * 0.6 +
    documentsQuickFixesUsd * 0.4;

  const currentMonth = await aggregateMspTelemetry(mspId, startOfCurrentMonth());
  const trailingThreeMonths = await aggregateMspTelemetry(mspId, startOfTrailingThreeMonths());

  const currentMonthRevenueUsd = Number(currentMonth.financials.total.grossRevenueUsd);
  const trailingThreeMonthAvgRevenueUsd = Number(trailingThreeMonths.financials.total.grossRevenueUsd) / 3;

  const momentumBonusApplied = currentMonthRevenueUsd > trailingThreeMonthAvgRevenueUsd;
  const score = momentumBonusApplied ? baseScore * 1.1 : baseScore;

  log.debug(
    {
      mspId,
      subscriptionsRetainersUsd,
      consultingUsd,
      documentsQuickFixesUsd,
      baseScore,
      currentMonthRevenueUsd,
      trailingThreeMonthAvgRevenueUsd,
      momentumBonusApplied,
      score,
    },
    "colony composite score calculated",
  );

  return {
    score,
    momentumBonusApplied,
    currentMonthRevenueUsd,
    trailingThreeMonthAvgRevenueUsd,
  };
}
