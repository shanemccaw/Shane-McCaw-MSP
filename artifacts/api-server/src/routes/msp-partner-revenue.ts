/**
 * MSP Partner Revenue View — a single MSP's own real, per-MSP-scoped financial
 * picture.
 *
 * IMPORTANT scope limit (confirmed by investigation, not assumed): this platform's
 * locked architecture has MSPs invoice their own end customers entirely OUTSIDE
 * the platform. There is no Stripe-verified or invoiced record anywhere in this
 * codebase of what an MSP actually charges its customers. So this endpoint
 * returns two clearly separated things:
 *
 *   - wholesaleSpend: real, Stripe-verified — what THIS MSP pays the platform
 *     (mspSubscriptionsTable, scoped to the caller's own mspId only).
 *   - pricingWorksheet: the MSP's own self-declared resale prices on their Sales
 *     Bundles (mspSalesBundlesTable.resalePriceCents) — NEVER charged via this
 *     platform, NEVER reconciled against a real invoice. Returned only as a
 *     clearly-labeled worksheet, never presented as verified revenue.
 *
 * GET /api/msp/billing/revenue
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  mspSubscriptionsTable,
  mspSalesBundlesTable,
  mspSalesBundleAssignmentsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { monthlyPriceCentsOf } from "../lib/msp-plan-pricing.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

router.get("/msp/billing/revenue", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (!mspId) { apiError(res, 400, "No MSP context"); return; }

    // ── Wholesale spend: real, Stripe-verified subscription this MSP pays the platform ──
    const [sub] = await db
      .select({
        status: mspSubscriptionsTable.status,
        dunningState: mspSubscriptionsTable.dunningState,
        billingInterval: mspSubscriptionsTable.billingInterval,
        currentPeriodStart: mspSubscriptionsTable.currentPeriodStart,
        currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
        tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
        tierName: servicesTable.name,
        tierPrice: servicesTable.price,
        tierAnnualPriceCents: servicesTable.annualPriceCents,
      })
      .from(mspSubscriptionsTable)
      .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
      .where(eq(mspSubscriptionsTable.mspId, mspId))
      .limit(1);

    const monthlyCostCents = sub ? monthlyPriceCentsOf(sub.tierPrice) : null;
    const wholesaleSpend = sub
      ? {
          tierName: sub.tierName,
          status: sub.status,
          dunningState: sub.dunningState,
          billingInterval: sub.billingInterval,
          monthlyCostCents,
          annualPriceCents: sub.tierAnnualPriceCents,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          activeTenantCount: sub.tenantCountSnapshot,
        }
      : null;

    // ── Pricing worksheet: MSP's own self-declared resale prices, never charged via ──
    // this platform. Joined to active assignment counts so the MSP can see a
    // rough per-bundle picture — explicitly not verified or reconciled income.
    const bundles = await db
      .select({
        bundleId: mspSalesBundlesTable.bundleId,
        name: mspSalesBundlesTable.name,
        status: mspSalesBundlesTable.status,
        internalCostCents: mspSalesBundlesTable.internalCostCents,
        resalePriceCents: mspSalesBundlesTable.resalePriceCents,
        activeAssignmentCount: sql<number>`count(${mspSalesBundleAssignmentsTable.id}) filter (where ${mspSalesBundleAssignmentsTable.status} = 'active')`,
      })
      .from(mspSalesBundlesTable)
      .leftJoin(
        mspSalesBundleAssignmentsTable,
        eq(mspSalesBundleAssignmentsTable.bundleId, mspSalesBundlesTable.bundleId),
      )
      .where(and(
        eq(mspSalesBundlesTable.mspId, mspId),
        eq(mspSalesBundlesTable.status, "active"),
      ))
      .groupBy(mspSalesBundlesTable.id);

    const pricingWorksheet = {
      disclaimer:
        "Self-declared resale prices you set on your Sales Bundles. Not charged, " +
        "collected, or verified by this platform — your own invoicing to customers " +
        "happens entirely outside it. Shown only as a planning worksheet, not real revenue.",
      bundles: bundles.map((b) => {
        const count = Number(b.activeAssignmentCount);
        return {
          bundleId: b.bundleId,
          name: b.name,
          status: b.status,
          activeAssignmentCount: count,
          resalePriceCentsPerUnit: b.resalePriceCents,
          internalCostCentsPerUnit: b.internalCostCents,
          worksheetMonthlyResaleCents: b.resalePriceCents * count,
          worksheetMonthlyCostCents: b.internalCostCents * count,
          worksheetMonthlyMarginCents: (b.resalePriceCents - b.internalCostCents) * count,
        };
      }),
    };

    res.json({ wholesaleSpend, pricingWorksheet });
  } catch (err) {
    log.error({ err }, "msp-partner-revenue: get revenue failed");
    apiError(res, 500, "Failed to load partner revenue");
  }
});

export default router;
