/**
 * Retainer Pricing — Stripe Price + Subscription Schedule mechanics for
 * direct-customer retainer billing-interval switches (portal-retainer-billing.ts).
 *
 * Generalized sibling of msp-plan-pricing.ts: that module is filtered to
 * platform tiers (fulfillmentType = "msp_monthly_subscription"); this one works
 * on any recurring direct-customer service (billingType = "recurring_monthly").
 * The two billing channels are intentionally kept independent — do not import
 * from msp-plan-pricing.ts here or vice versa.
 *
 * Price resolution follows the same lookup-or-create pattern: products are
 * found by metadata['serviceId'], active prices are searched for a matching
 * (interval, unit_amount, currency) before creation. Nothing is cached —
 * Stripe Price objects are immutable and cheap to look up each time.
 *
 * Units note: servicesTable.price is a legacy numeric(10,2) in DOLLARS
 * (monthly). annualPriceCents is integer CENTS. Everything returned from and
 * computed in this module is integer cents.
 */

import { db, servicesTable, type ClientBillingInterval } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getStripeKey } from "./stripe.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

/** Raised for service/price configuration problems the caller should surface as a 400. */
export class RetainerPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetainerPricingError";
  }
}

type StripeClient = import("stripe").Stripe;

async function getStripe(): Promise<StripeClient> {
  const { default: Stripe } = await import("stripe");
  return new Stripe(getStripeKey());
}

/** Monthly price of a service row in integer cents (from the legacy dollars column). */
export function monthlyPriceCentsOf(price: string | null): number | null {
  if (price == null) return null;
  const parsed = Math.round(parseFloat(String(price)) * 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolves the unit amount (integer cents) a retainer should be billed at for
 * the given interval. Exported for unit testing.
 */
export function resolveRetainerUnitAmountCents(
  service: { name: string; price: string | null; annualPriceCents: number | null },
  interval: ClientBillingInterval,
): number {
  if (interval === "year") {
    if (service.annualPriceCents == null) {
      throw new RetainerPricingError(
        `"${service.name}" has no annual price configured. Yearly billing is not available for this service.`,
      );
    }
    return service.annualPriceCents;
  }
  const cents = monthlyPriceCentsOf(service.price);
  if (cents == null) {
    throw new RetainerPricingError(`"${service.name}" has no monthly price configured.`);
  }
  return cents;
}

/**
 * Finds or creates the Stripe Price for a recurring retainer service at the
 * given interval. Returns the Stripe Price ID.
 *
 * - Product: found by metadata['serviceId'], created with that metadata if missing.
 * - Price: active prices on the product are searched for a matching
 *   (interval, unit_amount, currency) before a new one is created.
 */
export async function getOrCreateRetainerPrice(
  serviceId: number,
  interval: ClientBillingInterval,
): Promise<string> {
  const [service] = await db
    .select({
      id: servicesTable.id,
      name: servicesTable.name,
      slug: servicesTable.slug,
      price: servicesTable.price,
      annualPriceCents: servicesTable.annualPriceCents,
      billingType: servicesTable.billingType,
    })
    .from(servicesTable)
    .where(eq(servicesTable.id, serviceId))
    .limit(1);

  if (!service || service.billingType !== "recurring_monthly") {
    throw new RetainerPricingError("Recurring service not found");
  }

  const unitAmount = resolveRetainerUnitAmountCents(service, interval);
  const stripe = await getStripe();

  // Find or create the Stripe product for this service
  const existingProducts = await stripe.products.search({
    query: `metadata['serviceId']:'${serviceId}'`,
  });
  let stripeProductId: string;
  if (existingProducts.data.length > 0) {
    stripeProductId = existingProducts.data[0]!.id;
  } else {
    const product = await stripe.products.create({
      name: service.name,
      metadata: { serviceId: String(serviceId), slug: service.slug ?? "" },
    });
    stripeProductId = product.id;
  }

  // Reuse an existing active price with the same interval + amount if present
  const prices = await stripe.prices.list({ product: stripeProductId, active: true, limit: 100 });
  const match = prices.data.find(
    (p) =>
      p.recurring?.interval === interval &&
      p.unit_amount === unitAmount &&
      p.currency === "usd",
  );
  if (match) return match.id;

  const price = await stripe.prices.create({
    product: stripeProductId,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval },
    nickname: `${service.name} — ${interval === "year" ? "yearly" : "monthly"}`,
    metadata: { serviceId: String(serviceId), interval, createdBy: "portal-retainer-billing" },
  });

  log.info(
    { serviceId, interval, unitAmount, priceId: price.id },
    "retainer-pricing: created Stripe price",
  );
  return price.id;
}

// ── Subscription Schedule mechanics ───────────────────────────────────────────

interface SchedulePhaseInput {
  /** Stripe Price the subscription is on right now. */
  currentPriceId: string;
  /** Start of the in-progress phase (unix seconds) — Stripe requires it preserved on update. */
  currentPhaseStartUnix: number;
  /** End of the current billing period (unix seconds) — the switch takes effect here. */
  periodEndUnix: number;
  /** Stripe Price to switch to at the period boundary. */
  targetPriceId: string;
}

/**
 * Builds the two-phase schedule that switches the billing interval at the
 * start of the next billing cycle with no proration. Pure — exported for unit
 * testing.
 *
 * Phase 1: current price, unchanged, until the current period end.
 * Phase 2: target price for one iteration. The schedule's end_behavior is
 * "release", so after phase 2's first cycle Stripe hands control back to the
 * plain subscription, which keeps renewing on the target price indefinitely.
 * (Stripe requires every phase to have a determinate end — an open-ended
 * final phase is expressed as iterations: 1 + release.)
 *
 * Calling this again before the transition REPLACES both phases wholesale, so
 * a change-of-mind never stacks pending phases.
 */
export function buildIntervalSwitchPhases(input: SchedulePhaseInput) {
  return [
    {
      items: [{ price: input.currentPriceId, quantity: 1 }],
      start_date: input.currentPhaseStartUnix,
      end_date: input.periodEndUnix,
      proration_behavior: "none" as const,
    },
    {
      items: [{ price: input.targetPriceId, quantity: 1 }],
      iterations: 1,
      proration_behavior: "none" as const,
    },
  ];
}

/**
 * Schedules a billing-interval switch to take effect at the start of the next
 * billing cycle, never mid-cycle and never prorated.
 *
 * If the subscription has no schedule yet, one is created from the live
 * subscription; if one exists (e.g. the customer already scheduled a switch
 * and is changing their mind), its phases are replaced — not stacked.
 *
 * Returns the schedule ID and the effective date of the switch.
 */
export async function scheduleIntervalSwitchAtPeriodEnd(
  stripe: StripeClient,
  params: {
    stripeSubscriptionId: string;
    /** Schedule ID already stored on the client_services row, if any. */
    existingScheduleId: string | null;
    targetPriceId: string;
  },
): Promise<{ scheduleId: string; effectiveAt: Date }> {
  const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

  // current_period_* exist at runtime but types vary across Stripe SDK versions
  const rawSub = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    schedule?: string | { id: string } | null;
  };
  if (subscription.cancel_at_period_end) {
    throw new RetainerPricingError(
      "This subscription is set to cancel at the end of the billing period. Resume it before switching billing interval.",
    );
  }
  const periodEnd = rawSub.current_period_end
    ?? (subscription.items.data[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  if (!periodEnd) {
    throw new RetainerPricingError("Stripe subscription has no current period end");
  }
  const currentPriceId = subscription.items.data[0]?.price?.id;
  if (!currentPriceId) {
    throw new RetainerPricingError("Stripe subscription has no line items");
  }

  // Prefer the schedule Stripe says is attached, then our stored one.
  const attachedScheduleId =
    typeof rawSub.schedule === "string" ? rawSub.schedule : rawSub.schedule?.id ?? null;

  let schedule: import("stripe").Stripe.SubscriptionSchedule;
  if (attachedScheduleId ?? params.existingScheduleId) {
    schedule = await stripe.subscriptionSchedules.retrieve(
      (attachedScheduleId ?? params.existingScheduleId)!,
    );
  } else {
    schedule = await stripe.subscriptionSchedules.create({
      from_subscription: params.stripeSubscriptionId,
    });
  }

  const currentPhaseStart =
    schedule.current_phase?.start_date ??
    schedule.phases[0]?.start_date ??
    rawSub.current_period_start;
  if (!currentPhaseStart) {
    throw new RetainerPricingError("Could not determine current phase start for schedule");
  }

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: buildIntervalSwitchPhases({
      currentPriceId,
      currentPhaseStartUnix: currentPhaseStart,
      periodEndUnix: periodEnd,
      targetPriceId: params.targetPriceId,
    }),
  });

  return { scheduleId: schedule.id, effectiveAt: new Date(periodEnd * 1000) };
}
