/**
 * Testimonial approval credit (Git #4032, decision settled on #3436 2026-09-14).
 *
 * When Admin Panel approves a customer's portal testimonial, that customer gets a
 * one-time credit against their NEXT month of service. Never on submission, never
 * recurring.
 *
 * ─── Why this is not a `coupons` row ─────────────────────────────────────────
 * `coupons` / `coupon_redemptions` is the admin-managed promo-code feature
 * (admin-coupons.ts, admin-panel Coupons.tsx). Its shape does not fit a credit:
 *   - A coupon is a global code (`code` UNIQUE) with no customer binding. Anyone
 *     holding the code could redeem a per-customer reward.
 *   - Redemption is keyed on a checkout session (`coupon_redemptions.
 *     checkout_session_id` NOT NULL UNIQUE). A monthly service invoice is generated
 *     by Stripe from a subscription, not a checkout, so there is nothing to key on.
 *   - No code path redeems a coupon against an invoice at all. Nothing writes
 *     `coupon_redemptions` or increments `coupons.uses_count`, so issuing the reward
 *     as a coupon would record it without it ever reaching a bill.
 * What IS reused: the coupon discount shape (fixed dollars | percentage 0–100, with
 * the same validation as admin-coupons.ts), and the Stripe `duration: "once"` coupon
 * primitive copilot-assessment-checkout.ts already uses for a one-time credit.
 *
 * ─── Delivery ────────────────────────────────────────────────────────────────
 * The credit is attached to the tenant's active Stripe subscription (the
 * `tenant_subscriptions` row #2847 made the per-customer billing fact) as a
 * `duration: "once"`, `max_redemptions: 1` coupon. Stripe applies a once-duration
 * discount to the subscription's next invoice and then drops it, which is exactly the
 * one-time credit #3436 settled on. `invoice.paid` (msp-billing-webhook.ts) marks the
 * credit `applied` when an invoice actually carries the discount.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, customerBillingCreditsTable, tenantSubscriptionsTable, type CustomerBillingCredit } from "@workspace/db";
import { TENANT_SUBSCRIPTION_ACTIVE_STATUSES, type TenantSubscriptionStatus } from "@workspace/db/schema";
import { getStripeKey } from "./stripe.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

const ACTIVE_SUBSCRIPTION_STATUSES: TenantSubscriptionStatus[] = [...TENANT_SUBSCRIPTION_ACTIVE_STATUSES];

/** `metadata.flow` on every Stripe coupon this module creates. */
export const TESTIMONIAL_CREDIT_STRIPE_FLOW = "testimonial_credit";

export type CreditDiscountType = "fixed" | "percentage";

export type CreditDiscountValidation =
  | { ok: true; discountType: CreditDiscountType; discountValue: number }
  | { ok: false; error: string };

/** The same rules admin-coupons.ts applies to a coupon's discount, so the two admin forms agree. */
export function validateCreditDiscount(discountType: unknown, discountValue: unknown): CreditDiscountValidation {
  if (discountType !== "fixed" && discountType !== "percentage") {
    return { ok: false, error: "discountType must be 'fixed' or 'percentage'" };
  }
  const value = typeof discountValue === "number" ? discountValue : typeof discountValue === "string" && discountValue.trim() ? Number(discountValue) : NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "discountValue must be a positive number" };
  }
  if (discountType === "percentage" && value > 100) {
    return { ok: false, error: "percentage discountValue must be 0–100" };
  }
  if (Number(value.toFixed(2)) !== value) {
    return { ok: false, error: "discountValue may have at most 2 decimal places" };
  }
  return { ok: true, discountType, discountValue: value };
}

/** Stripe coupon amount params for one credit. Fixed values are stored in dollars, as coupons are. */
export function stripeCouponAmount(
  discountType: CreditDiscountType,
  discountValue: number,
  currency: string,
): { amount_off: number; currency: string } | { percent_off: number } {
  return discountType === "fixed"
    ? { amount_off: Math.round(discountValue * 100), currency }
    : { percent_off: discountValue };
}

/** The coupon id a Stripe Discount was created from — `source.coupon` on current API versions, `coupon` on older ones. */
export function discountCouponId(discount: unknown): string | null {
  if (!discount || typeof discount !== "object") return null;
  const d = discount as { source?: { coupon?: unknown } | null; coupon?: unknown };
  const coupon = d.source?.coupon ?? d.coupon;
  if (typeof coupon === "string") return coupon;
  if (coupon && typeof coupon === "object" && typeof (coupon as { id?: unknown }).id === "string") {
    return (coupon as { id: string }).id;
  }
  return null;
}

function refId(ref: string | { id: string }): string {
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * The tenant subscription a credit lands on: active, Stripe-backed, latest-ending first
 * (the same tie-break `resolveTenantBillingState` uses for the subscription keeping a
 * customer open). A manual row with no Stripe id has no invoice to credit.
 */
export async function findCreditableSubscription(
  tenantId: number,
): Promise<{ id: number; stripeSubscriptionId: string } | null> {
  const [row] = await db
    .select({ id: tenantSubscriptionsTable.id, stripeSubscriptionId: tenantSubscriptionsTable.stripeSubscriptionId })
    .from(tenantSubscriptionsTable)
    .where(
      and(
        eq(tenantSubscriptionsTable.tenantId, tenantId),
        inArray(tenantSubscriptionsTable.status, ACTIVE_SUBSCRIPTION_STATUSES),
        isNotNull(tenantSubscriptionsTable.stripeSubscriptionId),
      ),
    )
    .orderBy(sql`${tenantSubscriptionsTable.currentPeriodEnd} DESC NULLS LAST`, desc(tenantSubscriptionsTable.id))
    .limit(1);
  return row?.stripeSubscriptionId ? { id: row.id, stripeSubscriptionId: row.stripeSubscriptionId } : null;
}

const ISSUABLE_STATUSES = new Set<string>(["pending", "awaiting_subscription", "failed"]);

/**
 * Attach one credit to its tenant's next invoice. Safe to call again: a credit that is
 * already issued/applied is returned untouched, a coupon already created for it is
 * reused, and a discount already on the subscription from that coupon is adopted rather
 * than attached twice. Never throws for a Stripe failure — the outcome is the row's
 * status and failure_reason.
 */
export async function issueCreditToNextInvoice(creditId: number): Promise<CustomerBillingCredit> {
  const [credit] = await db
    .select()
    .from(customerBillingCreditsTable)
    .where(eq(customerBillingCreditsTable.id, creditId))
    .limit(1);
  if (!credit) throw new Error(`customer billing credit ${creditId} not found`);
  if (!ISSUABLE_STATUSES.has(credit.status)) return credit;

  const update = async (set: Partial<typeof customerBillingCreditsTable.$inferInsert>): Promise<CustomerBillingCredit> => {
    const [row] = await db
      .update(customerBillingCreditsTable)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(customerBillingCreditsTable.id, creditId))
      .returning();
    return row!;
  };

  const subscription = await findCreditableSubscription(credit.tenantId);
  if (!subscription) {
    log.info({ creditId, tenantId: credit.tenantId }, "testimonial-credit: no active Stripe subscription — credit awaiting one");
    return update({
      status: "awaiting_subscription",
      failureReason: "No active Stripe subscription is recorded for this customer, so there is no next invoice to credit yet.",
    });
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    return update({ status: "failed", failureReason: err instanceof Error ? err.message : String(err) });
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);
  const target = { tenantSubscriptionId: subscription.id, stripeSubscriptionId: subscription.stripeSubscriptionId };

  try {
    let couponId = credit.stripeCouponId;
    if (!couponId) {
      const coupon = await stripe.coupons.create(
        {
          duration: "once",
          max_redemptions: 1,
          name: "Testimonial credit",
          ...stripeCouponAmount(credit.discountType, Number(credit.discountValue), credit.currency),
          metadata: {
            flow: TESTIMONIAL_CREDIT_STRIPE_FLOW,
            creditId: String(credit.id),
            tenantId: String(credit.tenantId),
            testimonialId: credit.sourceTestimonialId != null ? String(credit.sourceTestimonialId) : "",
          },
        },
        { idempotencyKey: `testimonial-credit-coupon-${credit.id}` },
      );
      couponId = coupon.id;
      await update({ stripeCouponId: couponId, ...target });
    }

    const current = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, { expand: ["discounts"] });
    let attached = (current.discounts ?? []).find((d) => discountCouponId(d) === couponId);

    if (!attached) {
      const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        // Existing discounts are passed back by id: `discounts` replaces the whole set.
        discounts: [...(current.discounts ?? []).map((d) => ({ discount: refId(d) })), { coupon: couponId }],
        expand: ["discounts"],
      });
      attached = (updated.discounts ?? []).find((d) => discountCouponId(d) === couponId);
    }

    if (!attached) {
      throw new Error(`Stripe accepted the update but subscription ${subscription.stripeSubscriptionId} carries no discount from coupon ${couponId}`);
    }

    const issued = await update({
      status: "issued",
      failureReason: null,
      stripeDiscountId: refId(attached),
      issuedAt: new Date(),
      ...target,
    });
    log.info(
      { creditId, tenantId: credit.tenantId, stripeSubscriptionId: subscription.stripeSubscriptionId, couponId, discountId: issued.stripeDiscountId },
      "testimonial-credit: one-time credit attached to next invoice",
    );
    return issued;
  } catch (err) {
    log.error({ err, creditId, tenantId: credit.tenantId }, "testimonial-credit: Stripe issuance failed");
    return update({ status: "failed", failureReason: err instanceof Error ? err.message : String(err), ...target });
  }
}

/**
 * Called from `invoice.paid`: any issued credit whose discount this invoice actually
 * carried is marked applied, with the real amount Stripe took off. Returns how many.
 */
export async function markCreditsAppliedFromInvoice(invoice: {
  id?: string | null;
  total_discount_amounts?: Array<{ amount: number; discount: string | { id: string } }> | null;
}): Promise<number> {
  if (!invoice.id) return 0;
  let applied = 0;
  for (const entry of invoice.total_discount_amounts ?? []) {
    if (entry.amount <= 0) continue;
    const rows = await db
      .update(customerBillingCreditsTable)
      .set({
        status: "applied",
        appliedStripeInvoiceId: invoice.id,
        appliedAmountCents: entry.amount,
        appliedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerBillingCreditsTable.stripeDiscountId, refId(entry.discount)),
          eq(customerBillingCreditsTable.status, "issued"),
        ),
      )
      .returning({ id: customerBillingCreditsTable.id, tenantId: customerBillingCreditsTable.tenantId });
    for (const row of rows) {
      log.info({ creditId: row.id, tenantId: row.tenantId, invoiceId: invoice.id, amountCents: entry.amount }, "testimonial-credit: credit applied on paid invoice");
      applied++;
    }
  }
  return applied;
}
