/**
 * MSP Platform Billing Webhook — handles Stripe events for platform subscription billing.
 *
 * This webhook is ENTIRELY SEPARATE from the per-offer/per-project billing webhook
 * at /api/portal/stripe/webhook. They share the same Stripe account but different
 * webhook endpoint registrations and signing secrets.
 *
 * Stripe webhook path: POST /api/msp/stripe/webhook
 * Signing secret env var: MSP_STRIPE_WEBHOOK_SECRET (or falls back to STRIPE_WEBHOOK_SECRET)
 *
 * Events handled:
 *   checkout.session.completed         — payment confirmed → provision MSP
 *   customer.subscription.updated      — sync status
 *   customer.subscription.deleted      — cancel subscription, suspend MSP
 *   invoice.payment_succeeded          — clear dunning, update period
 *   invoice.payment_failed             — start dunning clock
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspSubscriptionsTable, mspUsersTable, usersTable, mspEventStoreTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

// ── POST /api/msp/stripe/webhook ──────────────────────────────────────────────
// Raw body is parsed by app.ts middleware registration.

router.post("/msp/stripe/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const webhookSecret =
    process.env.MSP_STRIPE_WEBHOOK_SECRET ??
    process.env.STRIPE_WEBHOOK_SECRET ??
    "";

  if (!webhookSecret) {
    logger.warn({}, "msp-billing-webhook: no webhook secret configured — skipping signature verification");
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    logger.warn({ err }, "msp-billing-webhook: Stripe not configured, ignoring event");
    res.status(200).json({ received: true });
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let event: import("stripe").Stripe.Event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
    } else {
      event = JSON.parse((req.body as Buffer).toString()) as import("stripe").Stripe.Event;
    }
  } catch (err) {
    logger.warn({ err }, "msp-billing-webhook: signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  logger.info({ eventType: event.type, eventId: event.id }, "msp-billing-webhook: received event");

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, event.data.object as import("stripe").Stripe.Checkout.Session);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as import("stripe").Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as import("stripe").Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event.data.object as import("stripe").Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as import("stripe").Stripe.Invoice);
        break;

      default:
        logger.info({ eventType: event.type }, "msp-billing-webhook: unhandled event type (ok)");
    }
  } catch (err) {
    logger.error({ err, eventType: event.type }, "msp-billing-webhook: event handler failed");
    // Return 200 to prevent Stripe from retrying indefinitely for transient errors.
    // Idempotent re-processing on retry is safe for all handlers below.
  }

  res.json({ received: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Slugify a company name to a URL-safe MSP slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Ensures slug uniqueness by appending a numeric suffix if needed. */
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (true) {
    const [existing] = await db
      .select({ id: mspsTable.id })
      .from(mspsTable)
      .where(eq(mspsTable.slug, slug))
      .limit(1);
    if (!existing) return slug;
    slug = `${base}-${suffix++}`;
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────

async function handleCheckoutCompleted(
  stripe: import("stripe").Stripe,
  session: import("stripe").Stripe.Checkout.Session,
): Promise<void> {
  if (session.mode !== "subscription" || session.payment_status !== "paid") return;

  const metadata = session.metadata ?? {};
  const fulfillmentType = metadata.fulfillment_type ?? metadata.signup_source ?? "";
  if (fulfillmentType !== "msp_monthly_subscription" && metadata.signup_source !== "msp_platform") {
    // Not a platform subscription checkout — ignore
    return;
  }

  const companyName = metadata.msp_company_name ?? "Unnamed MSP";
  const domain = metadata.msp_domain ?? undefined;
  const contactEmail = metadata.msp_contact_email ?? "";
  const contactName = metadata.msp_contact_name ?? "";
  const serviceId = parseInt(metadata.service_id ?? "", 10);

  if (isNaN(serviceId)) {
    logger.error({ sessionId: session.id }, "msp-billing-webhook: missing service_id in checkout metadata");
    return;
  }

  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id;
  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (!subscriptionId) {
    logger.error({ sessionId: session.id }, "msp-billing-webhook: no subscription in completed session");
    return;
  }

  // Fetch the subscription to get period dates and price
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price?.id;
  // current_period_start/end exist at runtime but types vary across Stripe SDK versions
  const rawSub = subscription as unknown as { current_period_start?: number; current_period_end?: number };
  const periodStart = rawSub.current_period_start ? new Date(rawSub.current_period_start * 1000) : null;
  const periodEnd = rawSub.current_period_end ? new Date(rawSub.current_period_end * 1000) : null;

  // Idempotent — check if MSP already provisioned for this subscription
  const [existingSub] = await db
    .select({ id: mspSubscriptionsTable.id })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (existingSub) {
    logger.info({ subscriptionId }, "msp-billing-webhook: MSP already provisioned for this subscription (idempotent)");
    return;
  }

  // Create the MSP record
  const baseSlug = slugify(companyName);
  const slug = await uniqueSlug(baseSlug);

  const [msp] = await db
    .insert(mspsTable)
    .values({
      name: companyName,
      slug,
      domain: domain || undefined,
      status: "active",
    })
    .returning({ id: mspsTable.id, name: mspsTable.name });

  if (!msp) {
    logger.error({ companyName, slug }, "msp-billing-webhook: failed to insert MSP row");
    return;
  }

  // Create the subscription row
  await db.insert(mspSubscriptionsTable).values({
    mspId: msp.id,
    serviceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    contactEmail: contactEmail || undefined,
  });

  // If we have a contact email, create or link the MSP admin user
  if (contactEmail) {
    await provisionMspAdminUser(msp.id, contactEmail, contactName, customerId);
  }

  // Emit provisioning event to the MSP event store
  await db.insert(mspEventStoreTable).values({
    eventType: "msp.subscription.provisioned",
    source: "msp-billing-webhook",
    actor: { id: "system", role: "system", type: "system" },
    meta: { tenant: { mspId: msp.id, customerId: null } },
    payload: {
      companyName,
      domain: domain ?? null,
      contactEmail,
      serviceId,
      subscriptionId,
    },
    mspId: msp.id,
    ownerType: "platform",
  });

  logger.info(
    { mspId: msp.id, slug, subscriptionId, serviceId },
    "msp-billing-webhook: MSP provisioned successfully",
  );
}

/** Creates or links the MSP admin user account. */
async function provisionMspAdminUser(
  mspId: number,
  email: string,
  name: string,
  _stripeCustomerId: string | undefined,
): Promise<void> {
  try {
    // Upsert user account
    const normalizedEmail = email.toLowerCase().trim();
    const [user] = await db
      .insert(usersTable)
      .values({ email: normalizedEmail, role: "client", name: name.trim() || undefined })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: { email: sql`EXCLUDED.email` }, // no-op — forces RETURNING to yield the existing row
      })
      .returning({ id: usersTable.id });

    if (!user) return;

    // Upsert msp_users row with MSPAdmin role
    const [existingMspUser] = await db
      .select({ id: mspUsersTable.id })
      .from(mspUsersTable)
      .where(eq(mspUsersTable.userId, user.id))
      .limit(1);

    if (!existingMspUser) {
      await db.insert(mspUsersTable).values({
        userId: user.id,
        mspId,
        mspRole: "MSPAdmin",
        isActive: true,
      });
    }

    logger.info({ mspId, userId: user.id, email: normalizedEmail }, "msp-billing-webhook: MSPAdmin user provisioned");
  } catch (err) {
    logger.warn({ err, mspId, email }, "msp-billing-webhook: admin user provisioning failed (non-fatal)");
  }
}

// ── customer.subscription.updated ─────────────────────────────────────────────

async function handleSubscriptionUpdated(subscription: import("stripe").Stripe.Subscription): Promise<void> {
  const [sub] = await db
    .select({ id: mspSubscriptionsTable.id, mspId: mspSubscriptionsTable.mspId })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscription.id))
    .limit(1);

  if (!sub) return;

  const now = new Date();
  const rawUpdSub = subscription as unknown as { current_period_start?: number; current_period_end?: number };
  await db.update(mspSubscriptionsTable).set({
    status: subscription.status as "active" | "past_due" | "canceled" | "unpaid" | "trialing",
    currentPeriodStart: rawUpdSub.current_period_start ? new Date(rawUpdSub.current_period_start * 1000) : undefined,
    currentPeriodEnd: rawUpdSub.current_period_end ? new Date(rawUpdSub.current_period_end * 1000) : undefined,
    updatedAt: now,
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  logger.info({ subscriptionId: subscription.id, status: subscription.status, mspId: sub.mspId }, "msp-billing-webhook: subscription updated");
}

// ── customer.subscription.deleted ─────────────────────────────────────────────

async function handleSubscriptionDeleted(subscription: import("stripe").Stripe.Subscription): Promise<void> {
  const [sub] = await db
    .select({ id: mspSubscriptionsTable.id, mspId: mspSubscriptionsTable.mspId })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscription.id))
    .limit(1);

  if (!sub) return;

  const now = new Date();
  await db.update(mspSubscriptionsTable).set({
    status: "canceled",
    updatedAt: now,
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  // Also suspend the MSP
  await db.update(mspsTable).set({
    status: "suspended",
    updatedAt: now,
  }).where(eq(mspsTable.id, sub.mspId));

  await db.insert(mspEventStoreTable).values({
    eventType: "msp.subscription.canceled",
    source: "msp-billing-webhook",
    actor: { id: "system", role: "system", type: "system" },
    meta: { tenant: { mspId: sub.mspId, customerId: null } },
    payload: { subscriptionId: subscription.id },
    mspId: sub.mspId,
    ownerType: "platform",
  });

  logger.info({ subscriptionId: subscription.id, mspId: sub.mspId }, "msp-billing-webhook: subscription deleted, MSP suspended");
}

// ── invoice.payment_succeeded ─────────────────────────────────────────────────

async function handlePaymentSucceeded(invoice: import("stripe").Stripe.Invoice): Promise<void> {
  const rawInvoiceSub = (invoice as unknown as { subscription?: string | { id?: string } | null }).subscription;
  const subscriptionId = typeof rawInvoiceSub === "string"
    ? rawInvoiceSub
    : (rawInvoiceSub as { id?: string } | null | undefined)?.id ?? null;
  if (!subscriptionId) return;

  const [sub] = await db
    .select({ id: mspSubscriptionsTable.id, mspId: mspSubscriptionsTable.mspId, dunningState: mspSubscriptionsTable.dunningState })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (!sub) return;

  const now = new Date();

  // Clear dunning state and restore MSP to active
  await db.update(mspSubscriptionsTable).set({
    status: "active",
    dunningState: null,
    paymentFailedAt: null,
    updatedAt: now,
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  if (sub.dunningState) {
    // Also restore MSP status if it was suspended
    await db.update(mspsTable).set({
      status: "active",
      updatedAt: now,
    }).where(and(eq(mspsTable.id, sub.mspId), eq(mspsTable.status, "suspended")));

    await db.insert(mspEventStoreTable).values({
      eventType: "msp.subscription.dunning_cleared",
      source: "msp-billing-webhook",
      actor: { id: "system", role: "system", type: "system" },
      meta: { tenant: { mspId: sub.mspId, customerId: null } },
      payload: { subscriptionId, previousDunningState: sub.dunningState },
      mspId: sub.mspId,
      ownerType: "platform",
    });

    logger.info({ subscriptionId, mspId: sub.mspId, clearedDunningState: sub.dunningState }, "msp-billing-webhook: dunning cleared on payment success");
  }
}

// ── invoice.payment_failed ────────────────────────────────────────────────────

async function handlePaymentFailed(invoice: import("stripe").Stripe.Invoice): Promise<void> {
  const rawFailedInvSub = (invoice as unknown as { subscription?: string | { id?: string } | null }).subscription;
  const subscriptionId = typeof rawFailedInvSub === "string"
    ? rawFailedInvSub
    : (rawFailedInvSub as { id?: string } | null | undefined)?.id ?? null;
  if (!subscriptionId) return;

  const [sub] = await db
    .select({
      id: mspSubscriptionsTable.id,
      mspId: mspSubscriptionsTable.mspId,
      paymentFailedAt: mspSubscriptionsTable.paymentFailedAt,
      dunningState: mspSubscriptionsTable.dunningState,
    })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (!sub) return;

  const now = new Date();
  const failedAt = sub.paymentFailedAt ?? now;

  await db.update(mspSubscriptionsTable).set({
    status: "past_due",
    // Only set paymentFailedAt if not already set — preserve the original failure date
    // so dunning day-count is accurate across multiple retry failures.
    paymentFailedAt: sub.paymentFailedAt ?? now,
    updatedAt: now,
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  await db.insert(mspEventStoreTable).values({
    eventType: "msp.subscription.payment_failed",
    source: "msp-billing-webhook",
    actor: { id: "system", role: "system", type: "system" },
    meta: { tenant: { mspId: sub.mspId, customerId: null } },
    payload: {
      subscriptionId,
      invoiceId: invoice.id,
      paymentFailedAt: failedAt.toISOString(),
      attemptCount: invoice.attempt_count ?? 1,
    },
    mspId: sub.mspId,
    ownerType: "platform",
  });

  logger.info(
    { subscriptionId, mspId: sub.mspId, paymentFailedAt: failedAt.toISOString() },
    "msp-billing-webhook: payment failed — dunning clock started",
  );
}

export default router;
