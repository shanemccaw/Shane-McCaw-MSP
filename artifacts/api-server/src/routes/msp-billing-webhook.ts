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
 *   subscription_schedule.updated      — self-service plan change: finalize when the target phase becomes current
 *   subscription_schedule.completed    — self-service plan change: backstop finalize
 *   subscription_schedule.released     — self-service plan change: finalize or clear stale pending state
 *   subscription_schedule.canceled     — self-service plan change: clear stale pending state
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspSubscriptionsTable, mspUsersTable, usersTable, mspEventStoreTable, mspAgreementAcceptancesTable, platformAgreementsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "billing" });

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
    log.warn({}, "msp-billing-webhook: no webhook secret configured — skipping signature verification");
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.warn({ err }, "msp-billing-webhook: Stripe not configured, ignoring event");
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
    log.warn({ err }, "msp-billing-webhook: signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  log.info({ eventType: event.type, eventId: event.id }, "msp-billing-webhook: received event");

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

      case "subscription_schedule.updated":
        await handleScheduleUpdated(event.data.object as import("stripe").Stripe.SubscriptionSchedule);
        break;

      case "subscription_schedule.completed":
        await handleScheduleCompleted(event.data.object as import("stripe").Stripe.SubscriptionSchedule);
        break;

      case "subscription_schedule.released":
        await handleScheduleReleased(event.data.object as import("stripe").Stripe.SubscriptionSchedule);
        break;

      case "subscription_schedule.canceled":
        await handleScheduleCanceled(event.data.object as import("stripe").Stripe.SubscriptionSchedule);
        break;

      default:
        log.info({ eventType: event.type }, "msp-billing-webhook: unhandled event type (ok)");
    }
  } catch (err) {
    log.error({ err, eventType: event.type }, "msp-billing-webhook: event handler failed");
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
    log.error({ sessionId: session.id }, "msp-billing-webhook: missing service_id in checkout metadata");
    return;
  }

  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id;
  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (!subscriptionId) {
    log.error({ sessionId: session.id }, "msp-billing-webhook: no subscription in completed session");
    return;
  }

  // Fetch the subscription to get period dates and price
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price?.id;
  // current_period_start/end exist at runtime but types vary across Stripe SDK versions
  const rawSub = subscription as unknown as { current_period_start?: number; current_period_end?: number };
  const periodStart = rawSub.current_period_start ? new Date(rawSub.current_period_start * 1000) : null;
  const periodEnd = rawSub.current_period_end ? new Date(rawSub.current_period_end * 1000) : null;

  // ── Agreement gate (activation prerequisite) ────────────────────────────────
  // Query the current active platform agreement. If one exists, the session MUST
  // carry agreement_accepted="true" — otherwise this signup bypassed the clickwrap
  // step and we must not activate the account.
  const [currentAgreement] = await db
    .select({
      id: platformAgreementsTable.id,
      version: platformAgreementsTable.version,
    })
    .from(platformAgreementsTable)
    .where(eq(platformAgreementsTable.isCurrentVersion, true))
    .limit(1);

  const agreementAccepted = metadata.agreement_accepted === "true";
  const agreementVersion = metadata.agreement_version ?? "";
  const agreementId = parseInt(metadata.agreement_id ?? "", 10) || null;
  const signupIp = metadata.signup_ip ?? null;
  const signupUa = metadata.signup_ua ?? null;

  if (currentAgreement && !agreementAccepted) {
    // Hard block: a current agreement exists but the session does not carry a
    // valid acceptance flag. Provisioning is refused. Return 200 to Stripe so
    // it does not retry — this is a data integrity issue on our side, not a
    // transient failure.
    log.error(
      {
        sessionId: session.id,
        currentAgreementVersion: currentAgreement.version,
        metadataAgreementAccepted: metadata.agreement_accepted ?? "(missing)",
      },
      "msp-billing-webhook: BLOCKED — current platform agreement not accepted; MSP will not be activated",
    );
    return;
  }

  if (currentAgreement && agreementVersion !== currentAgreement.version) {
    // Accepted flag is set but for a stale version — also a hard block.
    log.error(
      {
        sessionId: session.id,
        currentVersion: currentAgreement.version,
        acceptedVersion: agreementVersion,
      },
      "msp-billing-webhook: BLOCKED — accepted agreement version does not match current version; MSP will not be activated",
    );
    return;
  }

  // Idempotent — check if MSP already provisioned for this subscription
  const [existingSub] = await db
    .select({ id: mspSubscriptionsTable.id })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (existingSub) {
    log.info({ subscriptionId }, "msp-billing-webhook: MSP already provisioned for this subscription (idempotent)");
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
    log.error({ companyName, slug }, "msp-billing-webhook: failed to insert MSP row");
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
  let provisionedUserId: number | null = null;
  if (contactEmail) {
    provisionedUserId = await provisionMspAdminUser(msp.id, contactEmail, contactName, customerId);
  }

  // ── Acceptance row (required prerequisite for event emission) ────────────────
  // Insert the clickwrap record now that we have both mspId and userId.
  // If a current agreement exists and the insert fails we treat it as a hard
  // failure — do not emit the "provisioned" event so operators can investigate.
  if (currentAgreement && provisionedUserId !== null) {
    await db.insert(mspAgreementAcceptancesTable).values({
      mspId: msp.id,
      userId: provisionedUserId,
      agreementVersion,
      agreementId,
      ipAddress: signupIp,
      userAgent: signupUa,
      checkboxConfirmed: true,
    }).onConflictDoNothing();

    // Activation guard: verify the row exists before emitting the provisioned event
    const [verifiedAcceptance] = await db
      .select({ id: mspAgreementAcceptancesTable.id })
      .from(mspAgreementAcceptancesTable)
      .where(
        and(
          eq(mspAgreementAcceptancesTable.userId, provisionedUserId),
          eq(mspAgreementAcceptancesTable.agreementVersion, agreementVersion),
        ),
      )
      .limit(1);

    if (!verifiedAcceptance) {
      log.error(
        { mspId: msp.id, userId: provisionedUserId, agreementVersion },
        "msp-billing-webhook: BLOCKED — acceptance row could not be verified; provisioned event will NOT be emitted",
      );
      return;
    }

    log.info(
      { mspId: msp.id, userId: provisionedUserId, agreementVersion },
      "msp-billing-webhook: MSA acceptance row recorded and verified",
    );
  } else if (currentAgreement && provisionedUserId === null) {
    // Agreement required but no user was provisioned — can't write acceptance row
    log.error(
      { mspId: msp.id, contactEmail, agreementVersion },
      "msp-billing-webhook: BLOCKED — agreement required but no userId was provisioned; provisioned event will NOT be emitted",
    );
    return;
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
      agreementVersion: agreementVersion || null,
    },
    mspId: msp.id,
    ownerType: "platform",
  });

  log.info(
    { mspId: msp.id, slug, subscriptionId, serviceId, agreementVersion: agreementVersion || null },
    "msp-billing-webhook: MSP provisioned successfully",
  );
}

/** Creates or links the MSP admin user account. Returns the userId, or null on failure. */
async function provisionMspAdminUser(
  mspId: number,
  email: string,
  name: string,
  _stripeCustomerId: string | undefined,
): Promise<number | null> {
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

    if (!user) return null;

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

    log.info({ mspId, userId: user.id, email: normalizedEmail }, "msp-billing-webhook: MSPAdmin user provisioned");
    return user.id;
  } catch (err) {
    log.warn({ err, mspId, email }, "msp-billing-webhook: admin user provisioning failed (non-fatal)");
    return null;
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

  log.info({ subscriptionId: subscription.id, status: subscription.status, mspId: sub.mspId }, "msp-billing-webhook: subscription updated");
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
    suspendedAt: now,
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

  log.info({ subscriptionId: subscription.id, mspId: sub.mspId }, "msp-billing-webhook: subscription deleted, MSP suspended");
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
      suspendedAt: null,
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

    log.info({ subscriptionId, mspId: sub.mspId, clearedDunningState: sub.dunningState }, "msp-billing-webhook: dunning cleared on payment success");
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

  log.info(
    { subscriptionId, mspId: sub.mspId, paymentFailedAt: failedAt.toISOString() },
    "msp-billing-webhook: payment failed — dunning clock started",
  );
}

// ── Self-service plan change: schedule transition handling ────────────────────
//
// Mechanism (see msp-plan-self-service.ts / lib/msp-plan-pricing.ts): a plan
// change is a two-phase Stripe Subscription Schedule — phase 1 = current price
// until current_period_end, phase 2 = target price for one iteration, with
// end_behavior "release". The msp_subscriptions row stores the schedule ID and
// the pending target (pendingServiceId / pendingBillingInterval) until the
// change actually takes effect. The DB flip is driven entirely by the events
// below — each handler is idempotent (a row is only found while its
// stripeScheduleId is still set):
//
//   subscription_schedule.updated   — Stripe advances phases at the period
//     boundary. When the FINAL phase (the target plan) has become the current
//     phase, the change is live → finalize. Updates fired by our own phase
//     edits at scheduling time are ignored (phase 1 is still current).
//   subscription_schedule.completed — all phases done → backstop finalize.
//   subscription_schedule.released  — the schedule detached from the
//     subscription. Our own cancel endpoint clears the row before this event
//     arrives (lookup finds nothing → no-op). If pending state remains, the
//     release happened outside the app: finalize when the target phase already
//     started (change took effect), otherwise clear the stale pending state.
//   subscription_schedule.canceled  — canceled outside the app before taking
//     effect → clear the stale pending state, log a warning.

type StripeSchedule = import("stripe").Stripe.SubscriptionSchedule;

/** Extracts the price ID from a schedule phase item (string or expanded object). */
function phasePriceId(phase: import("stripe").Stripe.SubscriptionSchedule.Phase | undefined): string | null {
  const price = phase?.items?.[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

/** True once the schedule's final phase (the target plan) has begun. */
function finalPhaseStarted(schedule: StripeSchedule): boolean {
  const lastPhase = schedule.phases[schedule.phases.length - 1];
  if (!lastPhase?.start_date) return false;
  if (schedule.current_phase) {
    return schedule.current_phase.start_date === lastPhase.start_date;
  }
  // No current phase (completed/released schedules) — compare against now.
  return lastPhase.start_date * 1000 <= Date.now();
}

/** Looks up the subscription row that owns this schedule, or null. */
async function findSubscriptionBySchedule(scheduleId: string) {
  const [sub] = await db
    .select({
      id: mspSubscriptionsTable.id,
      mspId: mspSubscriptionsTable.mspId,
      serviceId: mspSubscriptionsTable.serviceId,
      billingInterval: mspSubscriptionsTable.billingInterval,
      pendingServiceId: mspSubscriptionsTable.pendingServiceId,
      pendingBillingInterval: mspSubscriptionsTable.pendingBillingInterval,
    })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.stripeScheduleId, scheduleId))
    .limit(1);
  return sub ?? null;
}

/**
 * The scheduled change has taken effect: move pendingServiceId /
 * pendingBillingInterval onto the live columns, sync stripePriceId to the
 * target phase's price, and clear all pending state.
 */
async function applyScheduledPlanChange(schedule: StripeSchedule): Promise<void> {
  const sub = await findSubscriptionBySchedule(schedule.id);
  if (!sub) return; // not a self-service schedule, or already finalized/canceled

  const newServiceId = sub.pendingServiceId ?? sub.serviceId;
  const newInterval = sub.pendingBillingInterval ?? sub.billingInterval;
  const newPriceId = phasePriceId(schedule.phases[schedule.phases.length - 1]);

  await db.update(mspSubscriptionsTable).set({
    serviceId: newServiceId,
    billingInterval: newInterval,
    ...(newPriceId ? { stripePriceId: newPriceId } : {}),
    stripeScheduleId: null,
    pendingServiceId: null,
    pendingBillingInterval: null,
    updatedAt: new Date(),
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  await db.insert(mspEventStoreTable).values({
    eventType: "msp.subscription.plan_changed",
    source: "msp-billing-webhook",
    actor: { id: "system", role: "system", type: "system" },
    meta: { tenant: { mspId: sub.mspId, customerId: null } },
    payload: {
      scheduleId: schedule.id,
      fromServiceId: sub.serviceId,
      toServiceId: newServiceId,
      fromInterval: sub.billingInterval,
      toInterval: newInterval,
      newPriceId,
    },
    mspId: sub.mspId,
    ownerType: "platform",
  });

  log.info(
    { scheduleId: schedule.id, mspId: sub.mspId, newServiceId, newInterval, newPriceId },
    "msp-billing-webhook: scheduled plan change applied",
  );
}

/** The schedule went away without the change taking effect — clear pending state. */
async function clearStalePendingPlanChange(schedule: StripeSchedule, reason: string): Promise<void> {
  const sub = await findSubscriptionBySchedule(schedule.id);
  if (!sub) return;

  await db.update(mspSubscriptionsTable).set({
    stripeScheduleId: null,
    pendingServiceId: null,
    pendingBillingInterval: null,
    updatedAt: new Date(),
  }).where(eq(mspSubscriptionsTable.id, sub.id));

  log.warn(
    {
      scheduleId: schedule.id,
      mspId: sub.mspId,
      droppedPendingServiceId: sub.pendingServiceId,
      droppedPendingInterval: sub.pendingBillingInterval,
      reason,
    },
    "msp-billing-webhook: schedule ended outside the app — pending plan change cleared",
  );
}

export async function handleScheduleUpdated(schedule: StripeSchedule): Promise<void> {
  // Only act when Stripe has advanced into the final (target) phase. Updates
  // fired by our own scheduling edits arrive while phase 1 is still current.
  if (!schedule.current_phase || !finalPhaseStarted(schedule)) return;
  await applyScheduledPlanChange(schedule);
}

export async function handleScheduleCompleted(schedule: StripeSchedule): Promise<void> {
  await applyScheduledPlanChange(schedule);
}

export async function handleScheduleReleased(schedule: StripeSchedule): Promise<void> {
  if (finalPhaseStarted(schedule)) {
    // Natural release after the target phase ran (end_behavior: "release"),
    // or a manual release after the transition — the change is live.
    await applyScheduledPlanChange(schedule);
  } else {
    await clearStalePendingPlanChange(schedule, "released before the target phase started");
  }
}

export async function handleScheduleCanceled(schedule: StripeSchedule): Promise<void> {
  await clearStalePendingPlanChange(schedule, "schedule canceled");
}

export default router;
