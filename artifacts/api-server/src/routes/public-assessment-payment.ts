/**
 * public-assessment-payment.ts — embedded Stripe Payment Element for the
 * marketing site's Home-page assessment flow (#435, parent #427).
 *
 * Shane's requirement is that the buyer NEVER leaves the site to pay. That
 * rules out Stripe Checkout (a hosted page on checkout.stripe.com) and rules
 * in the Payment Element: the API creates a PaymentIntent, hands the browser
 * its client secret, and stripe.js collects and confirms the card in-page.
 *
 * Two routes, both unauthenticated and both keyed on the checkout-session UUID
 * exactly like the public consent-flow routes in consent.ts:
 *
 *   POST /api/public/flow/payment-intent     create (or recover) the intent
 *   POST /api/public/flow/payment-confirmed  server-verified success callback
 *
 * ── What is NOT trusted from the client ───────────────────────────────────────
 *   - The amount. It is resolved server-side from the services row named by the
 *     session's own productSlug, via the shared resolveServicePriceCents /
 *     isServiceFree helpers — the same single source of truth the free-checkout
 *     guard uses. A client that posts a price is ignored; there is no price
 *     field on either request.
 *   - The success claim. /payment-confirmed does not believe the browser: it
 *     retrieves the PaymentIntent from Stripe and requires status "succeeded"
 *     AND that its metadata names this exact checkout session.
 *
 * ── Why no CAPTCHA on these routes ────────────────────────────────────────────
 * Both require the session to have already completed Microsoft admin consent
 * (status "consented" + a tenant GUID stamped by the consent callback). A real
 * Global Administrator approving an app registration in their own tenant is a
 * far stronger bot gate than Turnstile, and it cannot be replayed by an
 * attacker who does not control a tenant.
 *
 * ── Known gap, deliberately out of scope for #435 ─────────────────────────────
 * A successful payment marks the checkout session "paid" and audits it. It does
 * NOT yet run paid-order provisioning (contract, project, invoice, account-setup
 * email) — there is no such endpoint in this API server today: the
 * /api/portal/checkout/create-session route the legacy (unrouted) Checkout.tsx
 * calls does not exist, and the only provisioning pipeline that does exist is
 * the $0 one in portal-checkout-free.ts. Wiring paid provisioning is its own
 * piece of work; nothing here pretends it has happened.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, checkoutSessionsTable, servicesTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
import { isServiceFree, resolveServicePriceCents } from "../lib/catalog-pricing.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedOrder = {
  sessionId: string;
  status: string;
  email: string;
  fullName: string;
  company: string | null;
  tenantId: string | null;
  serviceId: number;
  serviceName: string;
  productSlug: string;
  amountCents: number;
};

/**
 * Resolve a session + its priced service, or respond and return null.
 *
 * `requireConsented` is the gate described in the file header: payment is only
 * reachable once the buyer's own Global Admin has granted read consent, which
 * is what stamps status "consented" and the tenant GUID. It is also the flow's
 * real ordering guarantee (#434 puts consent before payment), enforced here on
 * the server rather than only in the step machine on the client.
 */
async function resolveOrder(
  rawSessionId: unknown,
  res: Response,
): Promise<ResolvedOrder | null> {
  const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
  if (!UUID_RE.test(sessionId)) {
    res.status(400).json({ error: "session_invalid" });
    return null;
  }

  const [session] = await db
    .select({
      id: checkoutSessionsTable.id,
      status: checkoutSessionsTable.status,
      email: checkoutSessionsTable.email,
      fullName: checkoutSessionsTable.fullName,
      company: checkoutSessionsTable.company,
      tenantId: checkoutSessionsTable.tenantId,
      productSlug: checkoutSessionsTable.productSlug,
    })
    .from(checkoutSessionsTable)
    .where(
      and(
        eq(checkoutSessionsTable.id, sessionId),
        gte(checkoutSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    res.status(404).json({ error: "session_expired" });
    return null;
  }

  if (!session.tenantId?.trim() || (session.status !== "consented" && session.status !== "paid")) {
    res.status(409).json({ error: "consent_required" });
    return null;
  }

  const [service] = await db
    .select({
      id: servicesTable.id,
      name: servicesTable.name,
      priceCents: servicesTable.priceCents,
      price: servicesTable.price,
      basePrice: servicesTable.basePrice,
      isFreeOffering: servicesTable.isFreeOffering,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(servicesTable)
    .where(eq(servicesTable.slug, session.productSlug))
    .limit(1);

  if (!service) {
    log.error({ sessionId, productSlug: session.productSlug }, "assessment-flow payment: session names a product with no catalog row");
    res.status(404).json({ error: "product_not_found" });
    return null;
  }

  // A free product must never reach a card charge — it belongs on the $0
  // provisioning path. This mirrors portal-checkout-free.ts's guard from the
  // opposite direction, using the same isServiceFree source of truth so the
  // two can never disagree about which path an order belongs on.
  if (isServiceFree(service)) {
    res.status(409).json({ error: "service_is_free" });
    return null;
  }

  const amountCents = resolveServicePriceCents(service);
  if (amountCents <= 0) {
    log.error({ sessionId, serviceId: service.id }, "assessment-flow payment: paid service resolved to a zero amount");
    res.status(409).json({ error: "price_unresolved" });
    return null;
  }

  return {
    sessionId: session.id,
    status: session.status,
    email: session.email,
    fullName: session.fullName,
    company: session.company,
    tenantId: session.tenantId,
    serviceId: service.id,
    serviceName: service.name,
    productSlug: session.productSlug,
    amountCents,
  };
}

// ── POST /api/public/flow/payment-intent ───────────────────────────────────────
// Creates the PaymentIntent the in-page Payment Element confirms against, and
// returns the publishable key the browser needs to boot stripe.js at all.
//
// Idempotent by construction: the Stripe idempotency key is derived from the
// checkout session id, so a reload, a retry after a declined card, or a double
// submit all recover the SAME intent rather than minting a second one against
// the same order. Stripe retains idempotency keys for 24h — the same window a
// checkout session lives for.

const paymentIntentSchema = z.object({ sessionId: z.string() });

router.post("/public/flow/payment-intent", async (req: Request, res: Response) => {
  const parsed = paymentIntentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const order = await resolveOrder(parsed.data.sessionId, res);
  if (!order) return;

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    log.error({}, "assessment-flow payment: STRIPE_PUBLISHABLE_KEY is not configured — the in-page Payment Element cannot be initialised");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.error({ err }, "assessment-flow payment: Stripe secret key is not configured");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amountCents,
        currency: "usd",
        // Lets Stripe offer whatever in-page methods are enabled on the
        // account (card, wallets) without a hosted page or a redirect.
        automatic_payment_methods: { enabled: true },
        receipt_email: order.email,
        description: `${order.serviceName}${order.company ? ` — ${order.company}` : ""}`,
        metadata: {
          flow: "home_assessment_flow",
          checkoutSessionId: order.sessionId,
          productSlug: order.productSlug,
          serviceId: String(order.serviceId),
          tenantId: order.tenantId ?? "",
        },
      },
      { idempotencyKey: `home-assessment-flow:pi:${order.sessionId}` },
    );

    log.info(
      { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, amountCents: order.amountCents, status: intent.status },
      "assessment-flow payment: PaymentIntent ready",
    );

    res.json({
      clientSecret: intent.client_secret,
      publishableKey,
      paymentIntentId: intent.id,
      amountCents: order.amountCents,
      productName: order.serviceName,
      // A recovered, already-succeeded intent (buyer paid, then reloaded before
      // the confirm callback landed) — the client skips straight to confirming.
      alreadyPaid: intent.status === "succeeded",
    });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow payment: PaymentIntent creation failed");
    res.status(500).json({ error: "payment_intent_failed" });
  }
});

// ── POST /api/public/flow/payment-confirmed ────────────────────────────────────
// The success callback stripe.js's confirmPayment resolves into. The client's
// word is not evidence: the intent is re-read from Stripe and must be
// "succeeded" AND carry this exact checkout session in its metadata before the
// session is marked paid.

const paymentConfirmedSchema = z.object({
  sessionId: z.string(),
  paymentIntentId: z.string().min(1),
});

router.post("/public/flow/payment-confirmed", async (req: Request, res: Response) => {
  const parsed = paymentConfirmedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId and paymentIntentId are required" });
    return;
  }

  const order = await resolveOrder(parsed.data.sessionId, res);
  if (!order) return;

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch {
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);
    const intent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);

    if (intent.metadata?.["checkoutSessionId"] !== order.sessionId) {
      log.warn(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, metaSessionId: intent.metadata?.["checkoutSessionId"] },
        "assessment-flow payment: REFUSED — PaymentIntent belongs to a different checkout session",
      );
      res.status(403).json({ error: "intent_session_mismatch" });
      return;
    }

    if (intent.status !== "succeeded") {
      log.info(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, status: intent.status },
        "assessment-flow payment: confirm callback for an intent that has not succeeded",
      );
      res.status(409).json({ error: "payment_not_succeeded", status: intent.status });
      return;
    }

    // Already "paid" from an earlier confirm — replaying is a no-op, not an error.
    if (order.status !== "paid") {
      await db
        .update(checkoutSessionsTable)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(checkoutSessionsTable.id, order.sessionId));

      await createAuditLog({
        actorUserId: null,
        actorName: "public:assessment-flow",
        actorRole: "client",
        actionType: "assessment_flow_payment_succeeded",
        entityType: "checkout_session",
        entityId: order.sessionId,
        metadata: {
          paymentIntentId: intent.id,
          amountCents: intent.amount_received || order.amountCents,
          productSlug: order.productSlug,
          serviceId: order.serviceId,
          tenantId: order.tenantId,
        },
      });

      log.info(
        { checkoutSessionId: order.sessionId, paymentIntentId: intent.id, amountCents: intent.amount_received },
        "assessment-flow payment: checkout session marked paid",
      );
    }

    res.json({ ok: true, amountCents: intent.amount_received || order.amountCents, email: order.email });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow payment: confirm failed");
    res.status(500).json({ error: "confirm_failed" });
  }
});

export default router;
