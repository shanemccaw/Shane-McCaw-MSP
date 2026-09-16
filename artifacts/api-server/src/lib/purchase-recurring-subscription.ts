/**
 * purchase-recurring-subscription.ts — the recurring Stripe Subscription behind a
 * paid Buy.tsx Monitoring or Retainer purchase (Git #4431, Feature #4401).
 *
 * /api/public/purchase/payment-confirmed charges month 1 as a one-time
 * PaymentIntent with `setup_future_usage: "off_session"` (card attached to the
 * resolved Stripe customer). Until #4431 nothing ever created the subscription,
 * so month 2 was never billed. This module creates it, on the same card, with
 * the proven shape from public-assessment-payment.ts's #490 rescan add-on — a
 * product, then `subscriptions.create` with inline `price_data` — and mirrors its
 * id onto the client_services row #4403/#4404 provisioned for the purchase.
 *
 * ── No double charge for month 1 ──────────────────────────────────────────────
 * The subscription is created with `billing_cycle_anchor` = one calendar month
 * after the PaymentIntent was created, and `proration_behavior: "none"`. Stripe
 * then raises no invoice at creation (the stub period up to the anchor is not
 * billed — month 1 was already paid by the intent) and bills the first full
 * month ON the anchor, monthly thereafter. Status is `active`, not `trialing`:
 * this customer paid, it is not a trial. An anchor that has already elapsed is
 * refused rather than created, since Stripe would bill the new period at once
 * with no human having looked (a checkout session lives 24h, so this is a
 * safety net, not a path).
 *
 * The monthly amount is the intent's own charged amount — the server-priced
 * number the buyer agreed to and paid — never re-derived from the catalog here.
 *
 * ── Idempotency (per checkout session) ────────────────────────────────────────
 * payment-confirmed is legitimately hit more than once (reload, retry, a lost
 * response) and set-password / portal-handoff re-run this as backstops. In order:
 *   1. `checkout_sessions.purchase_subscription_id` already set → nothing created.
 *   2. The (checkout_session_id, service_id) client_services row already carries
 *      a subscription id → adopted onto the session, nothing created.
 *   3. The customer already has a Stripe subscription whose server-written
 *      metadata names this checkout session (DB write lost after a create) →
 *      adopted, nothing created.
 *   4. Otherwise create, with a per-session Stripe idempotency key so two
 *      confirms racing past 1–3 still get ONE subscription.
 *
 * NEVER throws. The money for month 1 has moved by the time this runs; a failed
 * subscription is a loud fact to report (and a backstop to retry), not a reason
 * to fail the buyer's confirm.
 */

import type Stripe from "stripe";
import { db, checkoutSessionsTable, clientServicesTable, servicesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getStripeKey } from "./stripe.ts";
import { createAuditLog } from "./audit.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "billing" });

/** Server-written intent tag the Buy.tsx purchase pair stamps and every confirm requires back verbatim. */
export const PURCHASE_FLOW_TAG = "buy_purchase_flow";

const RECURRING_PRODUCT_TYPES = new Set(["monitoring", "retainer"]);

export type PurchaseSubscriptionResult =
  | { status: "not_recurring" }
  | { status: "created"; subscriptionId: string; monthlyAmountCents: number; billingCycleAnchor: number }
  | { status: "already"; subscriptionId: string }
  | {
      status: "failed";
      reason:
        | "session_not_found"
        | "no_payment_intent"
        | "intent_mismatch"
        | "no_customer"
        | "no_payment_method"
        | "amount_unresolved"
        | "anchor_elapsed"
        | "stripe_unavailable"
        | "stripe_error"
        | `subscription_${string}`;
    };

/**
 * One calendar month after `epochSeconds`, in UTC, with the day clamped to the
 * target month's length (Jan 31 → Feb 28/29), same wall-clock time. Stripe keeps
 * later cycles on the anchor's day-of-month, clamping short months itself.
 */
export function oneMonthAfterUtc(epochSeconds: number): number {
  const d = new Date(epochSeconds * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), daysInTarget);
  return Math.floor(
    Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000,
  );
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function loadSession(sessionId: string) {
  const [row] = await db
    .select({
      id: checkoutSessionsTable.id,
      productSlug: checkoutSessionsTable.productSlug,
      tenantId: checkoutSessionsTable.tenantId,
      purchasePaymentIntentId: checkoutSessionsTable.purchasePaymentIntentId,
      purchaseSubscriptionId: checkoutSessionsTable.purchaseSubscriptionId,
    })
    .from(checkoutSessionsTable)
    .where(eq(checkoutSessionsTable.id, sessionId))
    .limit(1);
  return row ?? null;
}

/**
 * Record the confirmed, verified intent on the session so a backstop can finish
 * subscription creation later. First writer wins — a session's recorded intent
 * never moves once set.
 */
export async function recordPurchasePaymentIntent(sessionId: string, paymentIntentId: string): Promise<void> {
  await db
    .update(checkoutSessionsTable)
    .set({ purchasePaymentIntentId: paymentIntentId, updatedAt: new Date() })
    .where(and(eq(checkoutSessionsTable.id, sessionId), isNull(checkoutSessionsTable.purchasePaymentIntentId)));
}

/**
 * Mirror the session's subscription id onto the client_services row this
 * purchase provisioned. Only fills an empty column — an id an operator or a
 * later interval switch already put there is never overwritten. Returns the
 * number of rows linked (0 when the entitlement row does not exist yet, e.g. a
 * legacy pay-then-account order before set-password; that caller links it then).
 */
async function linkSubscriptionToClientService(
  sessionId: string,
  productSlug: string,
  subscriptionId: string,
): Promise<number> {
  const [svc] = await db
    .select({ id: servicesTable.id })
    .from(servicesTable)
    .where(eq(servicesTable.slug, productSlug))
    .limit(1);
  if (!svc) return 0;
  const linked = await db
    .update(clientServicesTable)
    .set({ stripeSubscriptionId: subscriptionId })
    .where(
      and(
        eq(clientServicesTable.checkoutSessionId, sessionId),
        eq(clientServicesTable.serviceId, svc.id),
        isNull(clientServicesTable.stripeSubscriptionId),
      ),
    )
    .returning({ id: clientServicesTable.id });
  if (linked.length > 0) {
    log.info(
      { checkoutSessionId: sessionId, subscriptionId, clientServiceIds: linked.map((r) => r.id) },
      "purchase subscription: subscription id linked to client_services row",
    );
  }
  return linked.length;
}

/** True only for the caller whose write actually recorded the id (first writer wins). */
async function saveSessionSubscription(sessionId: string, subscriptionId: string): Promise<boolean> {
  const saved = await db
    .update(checkoutSessionsTable)
    .set({ purchaseSubscriptionId: subscriptionId, updatedAt: new Date() })
    .where(and(eq(checkoutSessionsTable.id, sessionId), isNull(checkoutSessionsTable.purchaseSubscriptionId)))
    .returning({ id: checkoutSessionsTable.id });
  return saved.length > 0;
}

/**
 * Stripe answers 409 to a request whose idempotency key is still in flight from
 * a concurrent caller (two confirms racing). Once that caller's request lands,
 * replaying the key returns its saved result — the same object, never a second.
 */
async function withConcurrentKeyRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 409 || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }
}

/**
 * Ensure the paid purchase on `sessionId` has its recurring subscription, and
 * that its id is on the provisioned client_services row.
 *
 * `opts.intent` is the already-verified PaymentIntent payment-confirmed just
 * retrieved; backstops omit it and the recorded intent is re-read and re-verified.
 * `opts.stripe` is optional — a Stripe client is only built when one is needed.
 */
export async function ensurePurchaseSubscription(
  sessionId: string,
  opts: { stripe?: Stripe; intent?: Stripe.PaymentIntent } = {},
): Promise<PurchaseSubscriptionResult> {
  try {
    return await ensurePurchaseSubscriptionInner(sessionId, opts);
  } catch (err) {
    log.error(
      { err, checkoutSessionId: sessionId },
      "purchase subscription: unexpected failure — month 1 is paid, the recurring subscription is NOT confirmed",
    );
    return { status: "failed", reason: "stripe_error" };
  }
}

async function ensurePurchaseSubscriptionInner(
  sessionId: string,
  opts: { stripe?: Stripe; intent?: Stripe.PaymentIntent },
): Promise<PurchaseSubscriptionResult> {
  const session = await loadSession(sessionId);
  if (!session) return { status: "failed", reason: "session_not_found" };

  // 1. Already created for this session — make sure the entitlement row carries it.
  if (session.purchaseSubscriptionId) {
    await linkSubscriptionToClientService(session.id, session.productSlug, session.purchaseSubscriptionId);
    return { status: "already", subscriptionId: session.purchaseSubscriptionId };
  }

  // 2. The entitlement row already carries one for this session (adopt it).
  const [svc] = await db
    .select({ id: servicesTable.id, name: servicesTable.name, category: servicesTable.category })
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);
  if (svc) {
    const [row] = await db
      .select({ stripeSubscriptionId: clientServicesTable.stripeSubscriptionId })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.checkoutSessionId, session.id), eq(clientServicesTable.serviceId, svc.id)))
      .limit(1);
    if (row?.stripeSubscriptionId) {
      await saveSessionSubscription(session.id, row.stripeSubscriptionId);
      return { status: "already", subscriptionId: row.stripeSubscriptionId };
    }
  }

  // Cheap pre-filter off the catalog before any Stripe call: a pack (or any
  // non-recurring product) never has a subscription. The intent's own
  // server-written metadata stays authoritative below.
  if (!svc || !RECURRING_PRODUCT_TYPES.has(svc.category ?? "")) {
    return { status: "not_recurring" };
  }

  let stripe = opts.stripe;
  if (!stripe) {
    try {
      const { default: StripeCtor } = await import("stripe");
      stripe = new StripeCtor(getStripeKey());
    } catch (err) {
      log.error({ err, checkoutSessionId: session.id }, "purchase subscription: Stripe is not configured");
      return { status: "failed", reason: "stripe_unavailable" };
    }
  }

  let intent = opts.intent;
  if (!intent) {
    if (!session.purchasePaymentIntentId) {
      // Not yet confirmed through payment-confirmed — nothing to fund a subscription from.
      return { status: "failed", reason: "no_payment_intent" };
    }
    intent = await stripe.paymentIntents.retrieve(session.purchasePaymentIntentId);
  }

  // Same three-part proof payment-confirmed requires, re-checked here so a
  // backstop can never subscribe off an intent this flow did not price.
  if (
    intent.metadata?.["checkoutSessionId"] !== session.id ||
    intent.metadata?.["flow"] !== PURCHASE_FLOW_TAG ||
    intent.status !== "succeeded"
  ) {
    log.error(
      { checkoutSessionId: session.id, paymentIntentId: intent.id, status: intent.status },
      "purchase subscription: REFUSED — intent is not a succeeded intent for this session and flow",
    );
    return { status: "failed", reason: "intent_mismatch" };
  }

  const productType = intent.metadata?.["productType"] ?? "";
  if (!RECURRING_PRODUCT_TYPES.has(productType) || intent.metadata?.["billingInterval"] !== "month") {
    return { status: "not_recurring" };
  }

  const customerId = idOf(intent.customer);
  if (!customerId) {
    // A tenant-less (skipped-consent) Retainer is charged as an anonymous intent
    // with no card kept on file — there is nothing a subscription can bill.
    log.error(
      { checkoutSessionId: session.id, paymentIntentId: intent.id, productType },
      "purchase subscription: the paid intent has no Stripe customer — recurring subscription CANNOT be created; month 2 will not bill",
    );
    return { status: "failed", reason: "no_customer" };
  }

  const paymentMethodId = idOf(intent.payment_method);
  if (!paymentMethodId) {
    log.error(
      { checkoutSessionId: session.id, paymentIntentId: intent.id },
      "purchase subscription: the paid intent exposes no payment method — cannot fund a subscription",
    );
    return { status: "failed", reason: "no_payment_method" };
  }

  const monthlyAmountCents = intent.amount_received || intent.amount;
  if (!monthlyAmountCents || monthlyAmountCents <= 0) {
    return { status: "failed", reason: "amount_unresolved" };
  }

  // 3. Created at Stripe but never recorded locally (DB write lost) — adopt it.
  const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  const adopted = existing.data.find(
    (s) => s.metadata?.["checkoutSessionId"] === session.id && s.metadata?.["flow"] === PURCHASE_FLOW_TAG,
  );
  if (adopted) {
    await saveSessionSubscription(session.id, adopted.id);
    await linkSubscriptionToClientService(session.id, session.productSlug, adopted.id);
    log.warn(
      { checkoutSessionId: session.id, subscriptionId: adopted.id, status: adopted.status },
      "purchase subscription: adopted an existing Stripe subscription for this session that was never recorded locally",
    );
    return { status: "already", subscriptionId: adopted.id };
  }

  const billingCycleAnchor = oneMonthAfterUtc(intent.created);
  if (billingCycleAnchor <= Math.floor(Date.now() / 1000) + 60) {
    log.error(
      { checkoutSessionId: session.id, paymentIntentId: intent.id, intentCreated: intent.created, billingCycleAnchor },
      "purchase subscription: REFUSED — a month has already elapsed since the month-1 charge; creating now would bill immediately. Needs a human.",
    );
    return { status: "failed", reason: "anchor_elapsed" };
  }

  const serviceId = intent.metadata?.["serviceIds"] ?? String(svc.id);

  let subscription: Stripe.Subscription;
  try {
    const product = await withConcurrentKeyRetry(() =>
      stripe.products.create(
        {
          name: svc.name,
          metadata: { slug: session.productSlug, serviceId, checkoutSessionId: session.id },
        },
        { idempotencyKey: `buy-purchase-flow:sub-product:${session.id}` },
      ),
    );

    subscription = await withConcurrentKeyRetry(() =>
      stripe.subscriptions.create(
        {
          customer: customerId,
          items: [
            {
              price_data: {
                currency: intent.currency || "usd",
                product: product.id,
                recurring: { interval: "month" },
                unit_amount: monthlyAmountCents,
              },
            },
          ],
          default_payment_method: paymentMethodId,
          billing_cycle_anchor: billingCycleAnchor,
          proration_behavior: "none",
          metadata: {
            flow: PURCHASE_FLOW_TAG,
            checkoutSessionId: session.id,
            productType,
            productSlug: intent.metadata?.["productSlug"] ?? session.productSlug,
            serviceId,
            seats: intent.metadata?.["seats"] ?? "",
            tenantId: intent.metadata?.["tenantId"] ?? session.tenantId ?? "",
            firstMonthPaymentIntentId: intent.id,
          },
        },
        { idempotencyKey: `buy-purchase-flow:sub:${session.id}` },
      ),
    );
  } catch (err) {
    log.error(
      { err, checkoutSessionId: session.id, customerId },
      "purchase subscription: subscription creation FAILED — month 1 is paid, month 2 will not bill until a backstop succeeds",
    );
    return { status: "failed", reason: "stripe_error" };
  }

  // Recorded whatever its status — the object exists at Stripe and must never be
  // orphaned. A racing confirm that replayed the same idempotency key gets the
  // same subscription back but did not record it; it reports "already".
  const recordedHere = await saveSessionSubscription(session.id, subscription.id);
  const linked = await linkSubscriptionToClientService(session.id, session.productSlug, subscription.id);
  if (!recordedHere) {
    const current = await loadSession(session.id);
    return { status: "already", subscriptionId: current?.purchaseSubscriptionId ?? subscription.id };
  }

  if (subscription.status !== "active" && subscription.status !== "trialing") {
    log.error(
      { checkoutSessionId: session.id, subscriptionId: subscription.id, status: subscription.status },
      "purchase subscription: subscription created but did not activate",
    );
    return { status: "failed", reason: `subscription_${subscription.status}` };
  }

  await createAuditLog({
    actorUserId: null,
    actorName: "public:purchase-flow",
    actorRole: "client",
    actionType: "purchase_flow_subscription_created",
    entityType: "checkout_session",
    entityId: session.id,
    metadata: {
      subscriptionId: subscription.id,
      firstMonthPaymentIntentId: intent.id,
      monthlyAmountCents,
      billingCycleAnchor: new Date(billingCycleAnchor * 1000).toISOString(),
      productType,
      productSlug: session.productSlug,
      clientServiceRowsLinked: linked,
      tenantId: session.tenantId,
    },
  });

  log.info(
    {
      checkoutSessionId: session.id,
      subscriptionId: subscription.id,
      customerId,
      monthlyAmountCents,
      billingCycleAnchor,
      clientServiceRowsLinked: linked,
    },
    "purchase subscription: recurring subscription active, first renewal on the anchor",
  );

  return { status: "created", subscriptionId: subscription.id, monthlyAmountCents, billingCycleAnchor };
}
