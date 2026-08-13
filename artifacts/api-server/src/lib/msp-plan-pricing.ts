/**
 * MSP Plan Pricing — Stripe Price + Subscription Schedule mechanics for
 * self-service platform tier changes (msp-plan-self-service.ts).
 *
 * Price resolution mirrors the product-lookup-or-create pattern from
 * msp-plan-management.ts's new-price handler: products are found by
 * metadata['serviceId'], prices are searched before creation to avoid
 * duplicates. Nothing is cached — Stripe Price objects are immutable and
 * cheap to look up each time.
 *
 * Units note: servicesTable.price is a legacy numeric(10,2) in DOLLARS
 * (monthly). annualPriceCents is integer CENTS. Everything returned from and
 * computed in this module is integer cents.
 */

import { db, servicesTable, type MspBillingInterval } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getStripeKey } from "./stripe.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

/** Raised for tier/price configuration problems the caller should surface as a 400. */
export class PlanPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPricingError";
  }
}

type StripeClient = import("stripe").Stripe;

async function getStripe(): Promise<StripeClient> {
  const { default: Stripe } = await import("stripe");
  return new Stripe(getStripeKey());
}

/** Monthly price of a tier row in integer cents (from the legacy dollars column). */
export function monthlyPriceCentsOf(price: string | null): number | null {
  if (price == null) return null;
  const parsed = Math.round(parseFloat(String(price)) * 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolves the unit amount (integer cents) a tier should be billed at for the
 * given interval. Exported for unit testing.
 */
export function resolveUnitAmountCents(
  service: { name: string; price: string | null; annualPriceCents: number | null },
  interval: MspBillingInterval,
): number {
  if (interval === "year") {
    if (service.annualPriceCents == null) {
      throw new PlanPricingError(
        `Tier "${service.name}" has no annual price configured. Set it in Plan Management first.`,
      );
    }
    return service.annualPriceCents;
  }
  const cents = monthlyPriceCentsOf(service.price);
  if (cents == null) {
    throw new PlanPricingError(`Tier "${service.name}" has no monthly price configured.`);
  }
  return cents;
}

/**
 * Finds or creates the Stripe Price for a platform tier at the given interval.
 * Returns the Stripe Price ID.
 *
 * - Product: found by metadata['serviceId'] (same pattern as msp-plan-management.ts),
 *   created with that metadata if missing.
 * - Price: active prices on the product are searched for a matching
 *   (interval, unit_amount, currency) before a new one is created.
 */
export async function getOrCreatePlanPrice(
  serviceId: number,
  interval: MspBillingInterval,
): Promise<string> {
  const [service] = await db
    .select({
      id: servicesTable.id,
      name: servicesTable.name,
      slug: servicesTable.slug,
      price: servicesTable.price,
      annualPriceCents: servicesTable.annualPriceCents,
      fulfillmentType: servicesTable.fulfillmentType,
    })
    .from(servicesTable)
    .where(eq(servicesTable.id, serviceId))
    .limit(1);

  if (!service || service.fulfillmentType !== "msp_monthly_subscription") {
    throw new PlanPricingError("Tier product not found");
  }

  const unitAmount = resolveUnitAmountCents(service, interval);
  const stripe = await getStripe();

  // Find or create the Stripe product for this tier
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
    metadata: { serviceId: String(serviceId), interval, createdBy: "msp-plan-self-service" },
  });

  log.info(
    { serviceId, interval, unitAmount, priceId: price.id },
    "msp-plan-pricing: created Stripe price",
  );
  return price.id;
}

/**
 * Finds or creates the yearly Stripe Price for a platform tier.
 * Errors if the tier has no annualPriceCents set (admin must set it first).
 */
export function getOrCreateYearlyPrice(serviceId: number): Promise<string> {
  return getOrCreatePlanPrice(serviceId, "year");
}

// ── Subscription Schedule mechanics ───────────────────────────────────────────

interface SchedulePhaseInput {
  /** Stripe Price the subscription is on right now. */
  currentPriceId: string;
  /** Start of the in-progress phase (unix seconds) — Stripe requires it preserved on update. */
  currentPhaseStartUnix: number;
  /** End of the current billing period (unix seconds) — the change takes effect here. */
  periodEndUnix: number;
  /** Stripe Price to switch to at the period boundary. */
  targetPriceId: string;
}

/**
 * Builds the two-phase schedule that changes plan at the start of the next
 * billing cycle with no proration. Pure — exported for unit testing.
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
export function buildSchedulePhases(input: SchedulePhaseInput) {
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
 * Schedules a plan (tier and/or interval) change to take effect at the start
 * of the next billing cycle, never mid-cycle and never prorated.
 *
 * If the subscription has no schedule yet, one is created from the live
 * subscription; if one exists (e.g. the MSP already scheduled a change and is
 * changing their mind), its phases are replaced — not stacked.
 *
 * Returns the schedule ID and the effective date of the change.
 */
export async function schedulePlanChangeAtPeriodEnd(
  stripe: StripeClient,
  params: {
    stripeSubscriptionId: string;
    /** Schedule ID already stored on the subscription row, if any. */
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
  if (!rawSub.current_period_end) {
    throw new PlanPricingError("Stripe subscription has no current period end");
  }
  const currentPriceId = subscription.items.data[0]?.price?.id;
  if (!currentPriceId) {
    throw new PlanPricingError("Stripe subscription has no line items");
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
    throw new PlanPricingError("Could not determine current phase start for schedule");
  }

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: buildSchedulePhases({
      currentPriceId,
      currentPhaseStartUnix: currentPhaseStart,
      periodEndUnix: rawSub.current_period_end,
      targetPriceId: params.targetPriceId,
    }),
  });

  return { scheduleId: schedule.id, effectiveAt: new Date(rawSub.current_period_end * 1000) };
}
