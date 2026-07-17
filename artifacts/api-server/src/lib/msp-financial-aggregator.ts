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
