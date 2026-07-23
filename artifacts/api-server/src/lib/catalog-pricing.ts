/**
 * catalog-pricing.ts
 *
 * Central pricing resolver for catalog products (services, sales offers, invoices).
 *
 * Billing model:
 *   - The MSP is always charged the *wholesale* cost (platform's internal cost to
 *     deliver the service).
 *   - The end customer is quoted the *retail* price (what the MSP marks it up to).
 *   - The difference is the MSP's margin.
 *
 * When no explicit `internalCostCents` is set on a service or offer, the wholesale
 * cost defaults to DEFAULT_WHOLESALE_MARGIN × retailPriceCents, rounded to the
 * nearest cent.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Default platform wholesale margin applied when no explicit `internalCostCents`
 * is provided. 0.70 = the platform charges the MSP 70% of the retail price.
 */
export const DEFAULT_WHOLESALE_MARGIN = 0.70;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input to the catalog pricing resolver. */
export interface CatalogPricingInput {
  /** The retail price (what the customer is quoted), in cents. */
  priceCents: number;
  /**
   * The platform's explicit internal/wholesale cost, in cents.
   * When null or undefined, falls back to DEFAULT_WHOLESALE_MARGIN × priceCents.
   */
  internalCostCents?: number | null;
}

/** Resolved pricing breakdown returned by the pricing helpers. */
export interface CatalogPricingResult {
  /** The amount charged to the MSP (wholesale/platform cost), in cents. */
  wholesaleCostCents: number;
  /** The retail price quoted to the end customer, in cents. */
  retailPriceCents: number;
  /** The MSP's gross margin (retailPriceCents − wholesaleCostCents), in cents. */
  mspMarginCents: number;
}

/** Human-readable pricing strings for display, e.g. in admin UIs or reports. */
export interface CatalogPricingDisplay extends CatalogPricingResult {
  wholesaleCostDisplay: string;
  retailPriceDisplay: string;
  mspMarginDisplay: string;
  /** Effective margin percentage rounded to 1 decimal place, e.g. "30.0%" */
  mspMarginPct: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

/**
 * Resolves catalog pricing for a service, invoice, or bundle entry.
 *
 * @example
 * // Service with explicit internal cost set by a Platform Admin:
 * resolveCatalogPricing({ priceCents: 10000, internalCostCents: 5000 });
 * // → { wholesaleCostCents: 5000, retailPriceCents: 10000, mspMarginCents: 5000 }
 *
 * @example
 * // Invoice with no internal cost — falls back to 70% wholesale default:
 * resolveCatalogPricing({ priceCents: 15000 });
 * // → { wholesaleCostCents: 10500, retailPriceCents: 15000, mspMarginCents: 4500 }
 */
export function resolveCatalogPricing(item: CatalogPricingInput): CatalogPricingResult {
  const retailPriceCents = item.priceCents;
  const wholesaleCostCents =
    item.internalCostCents != null
      ? item.internalCostCents
      : Math.round(retailPriceCents * DEFAULT_WHOLESALE_MARGIN);
  const mspMarginCents = retailPriceCents - wholesaleCostCents;

  return {
    wholesaleCostCents,
    retailPriceCents,
    mspMarginCents,
  };
}

/**
 * Effective retail price of a catalog service in integer cents.
 *
 * The catalog carries TWO price representations: the canonical integer
 * `priceCents` (what the modern admin "create service" API writes) and the
 * legacy decimal `price` / `basePrice` columns (dollars, written only by the
 * older update path). A service created the modern way has `price`/`basePrice`
 * NULL with the real price living ONLY in `priceCents`. Any "is this free?"
 * decision that reads only the legacy columns therefore treats a paid,
 * modern-created service as free — the exact defect behind the Stripe-bypass
 * bug where a paid assessment reached the free-checkout endpoint. Every
 * free/paid gate MUST resolve price through this helper so the canonical
 * `priceCents` is never ignored.
 *
 * Precedence: a positive `priceCents` wins; otherwise the legacy decimal
 * `price` ?? `basePrice` (dollars, converted to cents). Returns 0 only when no
 * field carries a positive price.
 */
export function resolveServicePriceCents(s: {
  priceCents?: number | null;
  price?: string | number | null;
  basePrice?: string | number | null;
}): number {
  const cents = s.priceCents != null ? Number(s.priceCents) : NaN;
  if (!isNaN(cents) && cents > 0) return Math.round(cents);
  const legacy = s.price ?? s.basePrice;
  if (legacy != null) {
    const dollars = parseFloat(String(legacy));
    if (!isNaN(dollars) && dollars > 0) return Math.round(dollars * 100);
  }
  return 0;
}

/**
 * Pricing carried inside `services.type_attributes` for per-type-priced
 * products. Monitoring tiers price per seat (`pricePerUserMonth` ×
 * max(seats, `seatCountFloor`) + optional `flatMonthlySurcharge`) and the
 * admin monitoring-tier editor writes NO flat price at all (`priceFixed:
 * false`) — a real monitoring tier row has `price`/`basePrice`/`priceCents`
 * all NULL with its entire price living here. Recurring add-ons similarly
 * carry `flatMonthlyPrice`. Any free-vs-paid decision that only reads the
 * flat columns therefore judges every monitoring tier "free" — the second
 * live Stripe-bypass bug (a real Enhanced Monitoring purchase provisioned
 * for $0 via the consent-success inline finalize + free-checkout guard,
 * both blind to this pricing model).
 */
interface TypeAttributesPricing {
  pricePerUserMonth?: string | number | null;
  seatCountFloor?: string | number | null;
  flatMonthlySurcharge?: string | number | null;
  flatMonthlyPrice?: string | number | null;
}

function toPositiveNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v));
  return !isNaN(n) && n > 0 ? n : 0;
}

/**
 * Effective monthly price in integer cents of the `type_attributes` pricing
 * model (see {@link TypeAttributesPricing}) at a given seat count. Seats are
 * clamped to ≥1 and to the tier's `seatCountFloor` (minimum billable seats),
 * matching how create-session computes the real Stripe charge. Returns 0 when
 * the service carries no type-attribute pricing (flat-priced or free products).
 */
export function resolveTypeAttributesMonthlyPriceCents(
  s: { typeAttributes?: unknown },
  seats = 1,
): number {
  const ta = (s.typeAttributes ?? {}) as TypeAttributesPricing;
  const ppu = toPositiveNumber(ta.pricePerUserMonth);
  const floor = Math.trunc(toPositiveNumber(ta.seatCountFloor));
  const billableSeats = Math.max(1, Math.trunc(seats) || 1, floor);
  const perSeatTotal = ppu > 0 ? ppu * billableSeats : 0;
  const surcharge = toPositiveNumber(ta.flatMonthlySurcharge);
  const flatMonthly = toPositiveNumber(ta.flatMonthlyPrice);
  return Math.round((perSeatTotal + surcharge + flatMonthly) * 100);
}

/**
 * A catalog service is genuinely free only when it is explicitly flagged
 * `isFreeOffering` OR carries no positive price via ANY pricing field — the
 * flat columns (see {@link resolveServicePriceCents}) AND the per-seat /
 * type-attribute pricing model (see
 * {@link resolveTypeAttributesMonthlyPriceCents}). This is the single source
 * of truth for the free-vs-paid decision that routes checkout to the
 * Stripe-free path — kept here rather than duplicated per call site so the
 * frontend routing gates and the server-side provisioning guard can never
 * drift apart again, which is what allowed a paid item to reach the
 * free-checkout endpoint (first a modern-priced assessment whose price lived
 * only in priceCents, then a monitoring tier whose price lived only in
 * typeAttributes.pricePerUserMonth).
 *
 * Pass `typeAttributes` whenever the caller has it (full DB rows always do) —
 * omitting it silently reverts to flat-columns-only and re-opens the
 * monitoring-tier hole.
 */
export function isServiceFree(s: {
  isFreeOffering?: boolean | null;
  priceCents?: number | null;
  price?: string | number | null;
  basePrice?: string | number | null;
  typeAttributes?: unknown;
}): boolean {
  if (s.isFreeOffering) return true;
  return (
    resolveServicePriceCents(s) === 0 &&
    resolveTypeAttributesMonthlyPriceCents(s) === 0
  );
}

/**
 * Resolves catalog pricing for a **sales offer**, using the offer's
 * `adjustedPriceCents` as the retail price (MSPs may customise the price
 * per customer) and the service's `internalCostCents` as the wholesale base.
 *
 * @param adjustedPriceCents - The offer's final retail price to quote the customer.
 * @param internalCostCents  - The service's platform wholesale cost (may be null).
 */
export function resolveSalesOfferPricing(
  adjustedPriceCents: number,
  internalCostCents?: number | null,
): CatalogPricingResult {
  return resolveCatalogPricing({
    priceCents: adjustedPriceCents,
    internalCostCents,
  });
}

/**
 * Resolves catalog pricing and augments the result with human-readable display
 * strings and margin percentage. Useful for admin UIs, reports, and CSV exports.
 *
 * @example
 * formatCatalogPricingDisplay({ priceCents: 10000, internalCostCents: 6000 });
 * // → { wholesaleCostCents: 6000, retailPriceCents: 10000, mspMarginCents: 4000,
 * //     wholesaleCostDisplay: "$60.00", retailPriceDisplay: "$100.00",
 * //     mspMarginDisplay: "$40.00", mspMarginPct: "40.0%" }
 */
export function formatCatalogPricingDisplay(item: CatalogPricingInput): CatalogPricingDisplay {
  const result = resolveCatalogPricing(item);
  const marginPct =
    result.retailPriceCents > 0
      ? ((result.mspMarginCents / result.retailPriceCents) * 100).toFixed(1)
      : "0.0";

  return {
    ...result,
    wholesaleCostDisplay: centsToDollars(result.wholesaleCostCents),
    retailPriceDisplay: centsToDollars(result.retailPriceCents),
    mspMarginDisplay: centsToDollars(result.mspMarginCents),
    mspMarginPct: `${marginPct}%`,
  };
}
