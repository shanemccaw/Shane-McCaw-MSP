/**
 * assessment-flow-rescan-addon.ts — the recurring rescan add-on sold on the
 * Home-page assessment flow (#490, epic #427), and the Stripe Customer that
 * makes selling it possible at all.
 *
 * ── Why a Stripe Customer had to be introduced ────────────────────────────────
 * Until #490 this flow was fully anonymous on Stripe's side. public-assessment-
 * payment.ts created a bare PaymentIntent with no `customer`, and nothing in
 * consent.ts created one either — the "customerId" that flows through consent.ts
 * and the portal routes is `tenants.id`, a local row id, not a `cus_…`.
 *
 * A Subscription cannot be created without a customer, and the payment method
 * that funds it has to be attached to that customer during the one card-entry
 * step the buyer ever sees. So the flow now resolves a real Stripe Customer
 * against the `tenants` row that consent time already created, and BOTH the
 * one-time assessment charge (#435) and this add-on's subscription hang off it.
 *
 * ── Why the price is never in code ────────────────────────────────────────────
 * The monthly price comes from a Product Catalog row and nowhere else, resolved
 * through the same `resolveEffectiveChargeCents` the rest of checkout uses — so
 * a row that prices itself through `type_attributes.flatMonthlyPrice` (which is
 * how every existing `recurring_addon` row in this catalog is priced) resolves
 * correctly rather than reading as free. When the row does not exist, or exists
 * without a positive price, the add-on reports itself UNAVAILABLE and the flow
 * skips the step entirely. No placeholder number is ever charged or displayed:
 * an invented price on a real card charge is worse than not offering the add-on.
 */

import { db, servicesTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { resolveEffectiveChargeCents } from "./catalog-pricing.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

/**
 * The Product Catalog slug this add-on is sold from.
 *
 * As of #490 this row DOES NOT EXIST in the catalog — Shane creates it in
 * admin-panel with a real monthly price. It is named here, in the API, for the
 * same reason `COPILOT_ASSESSMENT_SLUG` is named in Home.tsx: the slug is an
 * identifier, not pricing, and pricing is what may not be hardcoded.
 */
export const RESCAN_ADDON_SLUG = "copilot-assessment-recurring-rescan";

/**
 * Billing cadence. Monthly, matching the weekly rescan's natural cycle — four
 * or five scans per invoice — and matching every other recurring product in
 * this catalog (`billingType: "recurring_monthly"`), so the add-on lands on the
 * same Stripe/`client_services` shape as retainers rather than inventing a
 * second cadence for one line item.
 */
export const RESCAN_ADDON_INTERVAL = "month" as const;

export type RescanAddonOffer =
  | {
      available: true;
      serviceId: number;
      slug: string;
      name: string;
      description: string | null;
      priceCents: number;
      interval: typeof RESCAN_ADDON_INTERVAL;
      /** Catalog-authored bullets, empty when the row carries none. */
      included: string[];
    }
  | {
      available: false;
      /** "not_in_catalog" — no row; "unpriced" — a row with no positive price. */
      reason: "not_in_catalog" | "unpriced";
    };

/**
 * Reads the add-on's catalog row and resolves its real monthly price.
 *
 * Returns `available: false` rather than throwing: a missing or unpriced row is
 * a configuration state the flow renders honestly (the step is skipped), not a
 * server error that should break a purchase already in progress.
 */
export async function loadRescanAddonOffer(): Promise<RescanAddonOffer> {
  const [service] = await db
    .select({
      id: servicesTable.id,
      slug: servicesTable.slug,
      name: servicesTable.name,
      description: servicesTable.description,
      priceCents: servicesTable.priceCents,
      price: servicesTable.price,
      basePrice: servicesTable.basePrice,
      typeAttributes: servicesTable.typeAttributes,
      inclusions: servicesTable.inclusions,
      features: servicesTable.features,
      deliverables: servicesTable.deliverables,
      isFreeOffering: servicesTable.isFreeOffering,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, RESCAN_ADDON_SLUG))
    .limit(1);

  if (!service) {
    log.warn(
      { slug: RESCAN_ADDON_SLUG },
      "rescan add-on: no catalog row — the add-on step is skipped until one is created in admin-panel with a real price",
    );
    return { available: false, reason: "not_in_catalog" };
  }

  // Same resolver checkout uses everywhere else, so a row priced only through
  // type_attributes.flatMonthlyPrice (how every existing recurring_addon row in
  // this catalog is priced) is read correctly instead of judged free.
  const priceCents = service.isFreeOffering ? 0 : resolveEffectiveChargeCents(service, 1);
  if (priceCents <= 0) {
    log.warn(
      { slug: RESCAN_ADDON_SLUG, serviceId: service.id },
      "rescan add-on: catalog row carries no positive price — the add-on step is skipped rather than offered at an invented price",
    );
    return { available: false, reason: "unpriced" };
  }

  const included = service.inclusions ?? service.features ?? service.deliverables ?? [];

  return {
    available: true,
    serviceId: service.id,
    slug: service.slug ?? RESCAN_ADDON_SLUG,
    name: service.name,
    description: service.description,
    priceCents,
    interval: RESCAN_ADDON_INTERVAL,
    included: Array.isArray(included) ? included : [],
  };
}

/**
 * Resolves the Stripe Customer for a tenant, creating it exactly once.
 *
 * Two independent guards against duplicate customers, because a duplicate here
 * is not cosmetic — it silently splits one buyer's one-time charge and their
 * subscription across two Stripe objects:
 *
 *   1. `tenants.stripe_customer_id` is read first and reused when present.
 *   2. Creation carries an idempotency key derived from the tenant row id, so
 *      two concurrent requests (a reload racing the original, a retry after a
 *      declined card) resolve to the SAME customer even before the column has
 *      been written. Stripe retains idempotency keys for 24h — the same window
 *      a checkout session lives for, which is the same property the existing
 *      PaymentIntent creation already relies on.
 *
 * Throws only on a genuine Stripe failure. A failure to PERSIST the id is
 * logged and swallowed: the customer exists and the charge in flight can use
 * it, and the idempotency key means the next request recovers the same one
 * rather than minting a second.
 */
export async function ensureFlowStripeCustomer(
  stripe: Stripe,
  params: {
    /** `tenants.id` — the local row, not a Stripe id. */
    tenantRowId: number;
    /** The Entra tenant GUID, recorded on the customer for support lookups. */
    tenantGuid: string | null;
    email: string;
    fullName: string;
    company: string | null;
  },
): Promise<string> {
  const [row] = await db
    .select({ stripeCustomerId: tenantsTable.stripeCustomerId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, params.tenantRowId))
    .limit(1);

  const existing = row?.stripeCustomerId?.trim();
  if (existing) return existing;

  const customer = await stripe.customers.create(
    {
      email: params.email,
      name: params.company?.trim() || params.fullName,
      description: `Direct customer — tenants.id ${params.tenantRowId}`,
      metadata: {
        source: "home_assessment_flow",
        tenantRowId: String(params.tenantRowId),
        tenantGuid: params.tenantGuid ?? "",
      },
    },
    { idempotencyKey: `home-assessment-flow:customer:tenant:${params.tenantRowId}` },
  );

  try {
    await db
      .update(tenantsTable)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(tenantsTable.id, params.tenantRowId));
  } catch (err) {
    // The customer is real and usable; only the local pointer failed to save.
    // The idempotency key above recovers the same one next time, so this
    // degrades to an extra Stripe read rather than a duplicate customer.
    log.error(
      { err, tenantRowId: params.tenantRowId, stripeCustomerId: customer.id },
      "rescan add-on: Stripe customer created but tenants.stripe_customer_id could not be saved (has the #490 migration run?)",
    );
  }

  log.info(
    { tenantRowId: params.tenantRowId, stripeCustomerId: customer.id },
    "rescan add-on: Stripe customer created for the assessment flow",
  );

  return customer.id;
}
