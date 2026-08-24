/**
 * portal-checkout-direct.ts — the DIRECT CUSTOMER paid checkout for the
 * marketing site (Git #1165, Blocker B3 of #1045).
 *
 * The marketing Checkout page (shane-mccaw-consulting/src/pages/Checkout.tsx)
 * `handlePay()` POSTs `/api/portal/checkout/create-session` and expects back a
 * `{ url }` to redirect the buyer to Stripe. That endpoint did not exist — it
 * was documented as unrouted legacy code in public-assessment-payment.ts, so a
 * direct customer literally could not complete a paid monitoring purchase. This
 * file builds it.
 *
 * It is the PAID twin of portal-checkout-free.ts's `/portal/checkout/free`:
 *   - same guest, consent-first shape (the buyer's account was provisioned at
 *     M365 admin-consent time; a guest email can only RESOLVE it, never create
 *     one — an email with no account means consent was skipped upstream);
 *   - same server-side free-vs-paid guard using isServiceFree, from the opposite
 *     direction (this path REJECTS a free service — it belongs on /checkout/free);
 *   - same Turnstile CAPTCHA gate (verifyCaptchaToken).
 *
 * Where free provisions inline, paid provisions on Stripe's word:
 *   1. create-session builds a redirect Stripe Checkout Session — `subscription`
 *      mode for the recurring monitoring tiers (#1163: all `recurring_monthly`,
 *      per-seat priced in `type_attributes`), `payment` mode for a one-time paid
 *      service — with dynamic inline price_data (no pre-created Stripe price),
 *      matching portal-checkout.ts's proven dynamic product/price pattern.
 *   2. On `checkout.session.completed` (dispatched here from portal-checkout.ts's
 *      existing signed `/api/portal/stripe/webhook`), `provisionDirectMarketingPurchase`
 *      resolves the buyer, links their signed contracts, and drives provisioning
 *      through resolveFulfillment('monitoring_subscription', …) — the #1164 (B1)
 *      fix that writes the active `client_services` row every downstream
 *      monitoring reader keys on. Without that row a completed purchase is
 *      invisible; that is the whole point of wiring B1 in here.
 *
 * Nothing is trusted from the client: the charged amount is resolved server-side
 * from the catalog rows named by serviceIds (resolveEffectiveChargeCents at the
 * posted seat count), and seat counts are validated against each per-seat tier's
 * band (seatBandViolationMessage) so a dropped `?seats=` cannot silently
 * undercharge a large tenant.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  usersTable,
  contractsTable,
} from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getStripeKey } from "../lib/stripe.ts";
import {
  isServiceFree,
  resolveEffectiveChargeCents,
  seatBandViolationMessage,
} from "../lib/catalog-pricing.ts";
import { resolveFulfillment } from "../lib/resolve-fulfillment.ts";
import { resolveCustomerIdForPortalUser } from "../lib/tenant-signals.ts";
import { verifyCaptchaToken } from "../lib/captcha.ts";
import { createAuditLog } from "../lib/audit.ts";
import { sendEmail, purchaseConfirmationEmail } from "../lib/mailer.ts";
import { markAssessmentLeadPurchased } from "../lib/crm-pipeline.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

/** Marker that routes a completed Stripe session to this file's handler. */
export const DIRECT_MARKETING_CHECKOUT_KIND = "direct_marketing";

const createSessionSchema = z.object({
  serviceIds: z.array(z.union([z.number(), z.string()])).min(1),
  contractIds: z.array(z.union([z.number(), z.string()])).optional().default([]),
  guestEmail: z.string().email(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  seats: z.union([z.number(), z.string()]).optional(),
  captchaToken: z.string().optional(),
});

function toIntArray(vals: Array<number | string>): number[] {
  return vals.map((v) => Number(v)).filter((n) => Number.isFinite(n) && !isNaN(n));
}

// ── POST /portal/checkout/create-session ──────────────────────────────────────
// Public, guest, consent-first paid checkout. Returns { url } for the browser to
// redirect to Stripe, or a typed 4xx the marketing Checkout page surfaces inline.
router.post("/portal/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checkout request." });
    return;
  }
  const { guestEmail, successUrl, cancelUrl } = parsed.data;
  const serviceIds = toIntArray(parsed.data.serviceIds);
  const contractIds = toIntArray(parsed.data.contractIds ?? []);
  const seats = Math.max(1, Math.trunc(Number(parsed.data.seats ?? 1)) || 1);

  if (serviceIds.length === 0) {
    res.status(400).json({ error: "No service selected." });
    return;
  }

  // CAPTCHA gate — same verifyCaptchaToken as the free path, which transparently
  // bypasses when TURNSTILE_SECRET_KEY is unset (dev/preview) and enforces
  // against Cloudflare when configured. Do not weaken.
  const captchaToken = typeof parsed.data.captchaToken === "string" ? parsed.data.captchaToken : "";
  if (!captchaToken) {
    res.status(400).json({ error: "CAPTCHA verification is required to complete checkout." });
    return;
  }
  const captchaRes = await verifyCaptchaToken(captchaToken);
  if (!captchaRes.success) {
    res.status(403).json({ error: "CAPTCHA verification failed. Please refresh the page and try again." });
    return;
  }

  // ── Resolve + validate services (server-side price/seat guard) ──────────────
  const fetched = await db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds));
  const svcMap = new Map(fetched.map((s) => [s.id, s]));
  const ordered = serviceIds.map((id) => svcMap.get(id)).filter(Boolean) as typeof fetched;
  if (ordered.length !== serviceIds.length) {
    res.status(400).json({ error: "One or more selected services could not be found." });
    return;
  }

  // A free service must NEVER reach a card charge — it belongs on the $0 path.
  // Mirrors portal-checkout-free.ts's guard from the opposite direction, using
  // the same isServiceFree source of truth so the two can never disagree.
  const freeSvc = ordered.find((s) => isServiceFree(s));
  if (freeSvc) {
    res.status(409).json({ error: "This service is free — use the standard registration, not paid checkout." });
    return;
  }

  // Per-seat tiers (monitoring) are one catalog row per seat band: a seat count
  // outside the purchased row's band means the wrong band was selected or the
  // seat count was lost upstream. Fail loudly rather than silently charging a
  // floor-clamped price.
  for (const s of ordered) {
    const seatMsg = seatBandViolationMessage(s, seats);
    if (seatMsg) {
      res.status(409).json({ error: seatMsg });
      return;
    }
  }

  // Amount is resolved server-side, never taken from the client.
  const priced = ordered.map((s) => ({ svc: s, amountCents: resolveEffectiveChargeCents(s, seats) }));
  const zeroPriced = priced.find((p) => p.amountCents <= 0);
  if (zeroPriced) {
    log.error(
      { serviceId: zeroPriced.svc.id, slug: zeroPriced.svc.slug },
      "direct-checkout: paid service resolved to a zero amount — refusing to create a $0 Stripe session",
    );
    res.status(409).json({ error: "We couldn't determine the price for this service. Please contact support." });
    return;
  }

  // Mode: recurring monitoring tiers → subscription; a one-time paid service →
  // payment. Stripe forbids mixing recurring and one-time line items in one
  // session, so a mixed cart is rejected (the marketing flow buys one service).
  const isRecurring = (s: (typeof ordered)[number]): boolean =>
    s.billingType === "recurring_monthly" || s.serviceClass === "subscription";
  const recurringCount = ordered.filter(isRecurring).length;
  if (recurringCount !== 0 && recurringCount !== ordered.length) {
    res.status(400).json({ error: "Recurring and one-time services can't be purchased together. Please check out one at a time." });
    return;
  }
  const mode: "subscription" | "payment" = recurringCount === ordered.length ? "subscription" : "payment";

  // ── Resolve the buyer — consent-first, never create ─────────────────────────
  const email = guestEmail.toLowerCase().trim();
  const [buyer] = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (!buyer) {
    log.error(
      { guestEmail: email },
      "direct-checkout: paid order for an email with NO consent-provisioned account — the consent-first flow was skipped upstream",
    );
    res.status(409).json({
      error:
        "Your Microsoft 365 connection hasn't been set up yet. Please complete the connection step first so your order can be linked to your organization.",
    });
    return;
  }

  // ── Stripe ──────────────────────────────────────────────────────────────────
  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch {
    log.warn({}, "direct-checkout: Stripe not configured");
    res.status(503).json({ error: "Payment service is not configured. Please contact support." });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const lineItems = priced.map((p) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: p.amountCents,
        product_data: {
          name: p.svc.name,
          ...(p.svc.description ? { description: p.svc.description } : {}),
        },
        ...(mode === "subscription" ? { recurring: { interval: "month" as const } } : {}),
      },
    }));

    const metadata: Record<string, string> = {
      checkout_kind: DIRECT_MARKETING_CHECKOUT_KIND,
      serviceIds: serviceIds.join(","),
      contractIds: contractIds.join(","),
      guestEmail: email,
      buyerUserId: String(buyer.id),
      seats: String(seats),
      amountCents: String(priced.reduce((sum, p) => sum + p.amountCents, 0)),
    };

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata,
      // Mirror the marker onto the subscription so a subscription-lifecycle
      // webhook can also recognise it later if needed.
      ...(mode === "subscription" ? { subscription_data: { metadata } } : {}),
      ...(mode === "payment" ? { payment_intent_data: { metadata } } : {}),
    });

    log.info(
      { checkoutSessionId: session.id, mode, serviceIds, seats, buyerUserId: buyer.id },
      "direct-checkout: created Stripe Checkout Session",
    );

    res.json({ url: session.url });
  } catch (err) {
    log.error({ err, serviceIds, buyerUserId: buyer.id }, "direct-checkout: failed to create Stripe Checkout Session");
    res.status(500).json({ error: "We couldn't start your payment. Please try again in a moment." });
  }
});

/**
 * Completion handler for a DIRECT_MARKETING_CHECKOUT_KIND Stripe Checkout
 * Session, dispatched from portal-checkout.ts's signed webhook on
 * `checkout.session.completed` / `checkout.session.async_payment_succeeded`.
 *
 * Provisioning is driven through resolveFulfillment('monitoring_subscription'),
 * the #1164 (B1) path that writes the active `client_services` row every
 * downstream monitoring reader keys on. Idempotent by construction: the
 * fulfillment idempotency key is session+service scoped, contract linking only
 * touches still-unlinked rows, and the confirmation email fires only on the
 * FIRST delivery (when at least one fulfillment newly emitted).
 *
 * Never throws — a webhook that 500s is retried by Stripe; this logs and returns.
 */
export async function provisionDirectMarketingPurchase(
  session: import("stripe").Stripe.Checkout.Session,
): Promise<void> {
  const meta = session.metadata ?? {};

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    log.info(
      { checkoutSessionId: session.id, paymentStatus: session.payment_status },
      "direct-checkout: session completed but payment not confirmed — skipping provisioning",
    );
    return;
  }

  const serviceIds = (meta["serviceIds"] ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const contractIds = (meta["contractIds"] ?? "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const guestEmail = (meta["guestEmail"] ?? session.customer_email ?? session.customer_details?.email ?? "").toLowerCase().trim();
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);

  if (serviceIds.length === 0 || !guestEmail) {
    log.warn({ checkoutSessionId: session.id, meta }, "direct-checkout: session missing serviceIds/guestEmail — cannot provision");
    return;
  }

  // Resolve the buyer — consent-first, never create (same guard as create-session).
  const [buyer] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, guestEmail))
    .limit(1);
  if (!buyer) {
    log.error(
      { checkoutSessionId: session.id, guestEmail },
      "direct-checkout: paid session for an email with NO account — cannot provision (consent-first flow was skipped upstream)",
    );
    return;
  }

  // Link any pre-signed guest contracts to the resolved account (idempotent —
  // only still-unlinked rows are touched).
  if (contractIds.length > 0) {
    try {
      await db
        .update(contractsTable)
        .set({ userId: buyer.id })
        .where(and(inArray(contractsTable.id, contractIds), isNull(contractsTable.userId)));
    } catch (err) {
      log.warn({ err, checkoutSessionId: session.id }, "direct-checkout: contract linking failed (non-fatal)");
    }
  }

  const customerId = await resolveCustomerIdForPortalUser(buyer.id);

  let anyEmitted = false;
  const serviceNames: string[] = [];
  for (const serviceId of serviceIds) {
    const [svc] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        serviceClass: servicesTable.serviceClass,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
      })
      .from(servicesTable)
      .where(eq(servicesTable.id, serviceId))
      .limit(1);
    if (!svc) {
      log.error({ checkoutSessionId: session.id, serviceId }, "direct-checkout: paid session names a service with no catalog row");
      continue;
    }
    serviceNames.push(svc.name);

    if (!svc.fulfillmentTypeKey) {
      log.warn(
        { checkoutSessionId: session.id, serviceId },
        "direct-checkout: service has no fulfillmentTypeKey — cannot resolve fulfillment / provision",
      );
      continue;
    }

    const result = await resolveFulfillment({
      fulfillmentTypeKey: svc.fulfillmentTypeKey,
      idempotencyKey: `direct_checkout:session:${session.id}:svc:${serviceId}`,
      trigger: "purchase",
      payload: {
        // Pass the buyer's users.id directly (the direct path already resolved
        // it) AND the engine customerId when available, so B1's provisioning
        // writes client_services regardless of which the reader keys on.
        clientUserId: buyer.id,
        customerId,
        serviceId,
        subscriptionId,
        amountCents: session.amount_total ?? 0,
        serviceName: svc.name,
        serviceClass: svc.serviceClass ?? "subscription",
        customerEmail: buyer.email,
        stripeSessionId: session.id,
      },
    });
    if (result.status === "emitted") anyEmitted = true;
  }

  if (!anyEmitted) {
    // Every service was a duplicate (webhook replay) or unresolvable — nothing
    // newly provisioned, so no confirmation email and no audit noise.
    log.info({ checkoutSessionId: session.id }, "direct-checkout: no new fulfillment emitted (replay or unresolved) — provisioning already done");
    return;
  }

  const amountDollars = ((session.amount_total ?? 0) / 100).toFixed(2);
  const serviceLabel = serviceNames.join(", ") || "your service";

  await createAuditLog({
    actorUserId: null,
    actorName: "public:direct-checkout",
    actorRole: "client",
    actionType: "direct_checkout_payment_succeeded",
    entityType: "checkout_session",
    entityId: session.id,
    metadata: {
      serviceIds,
      subscriptionId,
      amountCents: session.amount_total ?? 0,
      buyerUserId: buyer.id,
      customerId,
    },
  });

  // Confirmation email — Graph/Exchange only (never Resend). Fire-and-forget:
  // a mail hiccup must never fail the webhook Stripe is waiting on.
  if (buyer.email) {
    void sendEmail(
      buyer.email,
      `Payment confirmed — ${serviceLabel}`,
      purchaseConfirmationEmail({
        clientName: buyer.name ?? buyer.email,
        serviceName: serviceLabel,
        amountDollars,
      }),
      { templateName: "purchase-confirmation-direct-checkout" },
    ).catch((err) => log.warn({ err, checkoutSessionId: session.id }, "direct-checkout: confirmation email failed (non-fatal)"));
  }

  // Payment-complete CRM signal. Non-fatal, see crm-pipeline.ts.
  void markAssessmentLeadPurchased(buyer.email, serviceLabel);

  log.info(
    { checkoutSessionId: session.id, serviceIds, buyerUserId: buyer.id, customerId, subscriptionId },
    "direct-checkout: paid monitoring purchase provisioned",
  );
}

export default router;
