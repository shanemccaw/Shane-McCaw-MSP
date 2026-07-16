/**
 * Resolves catalog pricing details by calculating wholesale cost, retail price, and MSP margin.
 */
export function resolveCatalogPricing(item: {
  priceCents: number;
  internalCostCents?: number | null;
}) {
  const retailPriceCents = item.priceCents;
  const wholesaleCostCents =
    item.internalCostCents ?? Math.round(retailPriceCents * 0.70);
  const mspMarginCents = retailPriceCents - wholesaleCostCents;

  return {
    wholesaleCostCents,
    retailPriceCents,
    mspMarginCents,
  };
}
