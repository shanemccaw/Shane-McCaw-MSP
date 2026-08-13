/**
 * cost-engine.ts
 *
 * Turns real per-SKU seat counts (already-computed `{ [skuPartNumber]: count }`
 * data — e.g. the groupByCount output behind licensing.wasteEstimateBreakdown)
 * into real dollar figures, priced against sku_price_reference list prices.
 *
 * Deliberately NOT the same thing as engine-registry.ts's computePricingEngine
 * ("pricing" engine key) — that sums flat, pre-configured pricingImpact weights
 * per fired signal, unrelated to seat-count × price math. This module is kept
 * separate (and separately named) to avoid confusion with that registered
 * engine key.
 *
 * Five responsibilities only:
 *   1. Price lookup   — list price only, safe fallback for unknown SKUs.
 *   2. Multiplication — count × price only.
 *   3. Aggregation    — per-SKU totals only.
 *   4. Formatting     — cents → dollars.
 *   5. Safety         — warn + null/0 for unknown/missing prices, never throw,
 *                        never guess a price.
 *
 * Explicitly deferred (do not build here): region/promo pricing, CSP discount
 * multipliers, bundle × SKU math, tenant × bundle rollups, drift/before-after
 * delta computation. `region`/`mspId` are accepted on the lookup signature now,
 * unused, so that per-region or per-MSP override pricing can slot in later
 * without a signature change.
 */

import { db, skuPriceReferenceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

export interface SkuPriceLookupParams {
  skuPartNumber: string;
  /** Unused today — accepted so region-based pricing can slot in without a signature change. */
  region?: string;
  /** Unused today — accepted so per-MSP negotiated pricing can slot in without a signature change. */
  mspId?: number;
}

export interface SkuCostLine {
  skuPartNumber: string;
  displayName: string;
  count: number;
  /** null when no price is on file for this SKU — never a guessed number. */
  unitMonthlyPriceCents: number | null;
  /** count * unitMonthlyPriceCents, or null when the price is unknown. */
  totalMonthlyPriceCents: number | null;
  priceKnown: boolean;
}

export interface SkuCostBreakdown {
  lines: SkuCostLine[];
  totalMonthlyCents: number;
  totalAnnualCents: number;
  /** SKUs with a count but no price on file — surfaced so callers can show "price unknown" rather than silently underselling the total. */
  unknownSkus: string[];
}

/**
 * 1. Price lookup — list price only. Returns null (and logs a warning) for a
 * SKU with no sku_price_reference row, or a row with monthly_price_cents left
 * NULL (e.g. retired products). Never fabricates a price.
 */
export async function lookupSkuMonthlyPriceCents(
  params: SkuPriceLookupParams,
): Promise<{ priceCents: number | null; displayName: string }> {
  const { skuPartNumber } = params;
  const [row] = await db
    .select({
      displayName: skuPriceReferenceTable.displayName,
      monthlyPriceCents: skuPriceReferenceTable.monthlyPriceCents,
    })
    .from(skuPriceReferenceTable)
    .where(eq(skuPriceReferenceTable.skuPartNumber, skuPartNumber))
    .limit(1);

  if (!row) {
    log.warn({ skuPartNumber }, "cost-engine: no sku_price_reference row for SKU — price unknown");
    return { priceCents: null, displayName: skuPartNumber };
  }
  if (row.monthlyPriceCents == null) {
    log.warn({ skuPartNumber }, "cost-engine: sku_price_reference row has no monthly_price_cents — price unknown");
    return { priceCents: null, displayName: row.displayName ?? skuPartNumber };
  }
  return { priceCents: row.monthlyPriceCents, displayName: row.displayName ?? skuPartNumber };
}

/**
 * 2 & 3. Multiplication + aggregation — count × price per SKU, no further
 * rollup (no bundle × SKU, no tenant × bundle math). `counts` is the raw
 * `{ skuPartNumber: count }` map already produced by the groupByCount transform.
 */
export async function computeSkuCostBreakdown(
  counts: Record<string, number>,
  opts: { region?: string; mspId?: number } = {},
): Promise<SkuCostBreakdown> {
  const lines: SkuCostLine[] = [];
  const unknownSkus: string[] = [];
  let totalMonthlyCents = 0;

  for (const [skuPartNumber, count] of Object.entries(counts)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const { priceCents, displayName } = await lookupSkuMonthlyPriceCents({
      skuPartNumber,
      region: opts.region,
      mspId: opts.mspId,
    });
    const totalForSku = priceCents == null ? null : priceCents * count;
    if (totalForSku != null) totalMonthlyCents += totalForSku;
    else unknownSkus.push(skuPartNumber);

    lines.push({
      skuPartNumber,
      displayName,
      count,
      unitMonthlyPriceCents: priceCents,
      totalMonthlyPriceCents: totalForSku,
      priceKnown: priceCents != null,
    });
  }

  return {
    lines,
    totalMonthlyCents,
    totalAnnualCents: totalMonthlyCents * 12,
    unknownSkus,
  };
}

/**
 * 4. Formatting — cents → dollars, sensible rounding. Whole-dollar display
 * (no cents shown) since seat-price data is not precise to the cent in the UI.
 */
export function formatCentsAsDollars(cents: number): string {
  const dollars = Math.round(cents) / 100;
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}
