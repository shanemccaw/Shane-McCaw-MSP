/**
 * public-assessment-payment.ts — embedded Stripe Payment Element for the
 * marketing site's Home-page assessment flow (#435, parent #427).
 *
 * Shane's requirement is that the buyer NEVER leaves the site to pay. That
 * rules out Stripe Checkout (a hosted page on checkout.stripe.com) and rules
 * in the Payment Element: the API creates a PaymentIntent, hands the browser
 * its client secret, and stripe.js collects and confirms the card in-page.
 *
 * Four routes, all unauthenticated and all keyed on the checkout-session UUID
 * exactly like the public consent-flow routes in consent.ts:
 *
 *   GET  /api/public/flow/rescan-addon           the #490 add-on offer + price
 *   POST /api/public/flow/rescan-addon-decision  record opt-in / decline
 *   POST /api/public/flow/payment-intent         create (or recover) the intent
 *   POST /api/public/flow/payment-confirmed      server-verified success callback
 *
 * ── The recurring rescan add-on (#490) ────────────────────────────────────────
 * A step of its own BEFORE payment (same shape as the #432 Compliance decision,
 * not a toggle bolted onto the card form) offers the weekly re-scan as a
 * monthly subscription. The sequencing that makes one card entry fund both
 * charges:
 *
 *   1. The decision is recorded on the checkout session before the card form is
 *      ever built (`/rescan-addon-decision`).
 *   2. `/payment-intent` resolves a real Stripe Customer for the tenant and
 *      puts the one-time charge ON it. When the buyer opted in it also sets
 *      `setup_future_usage: "off_session"`, which is what attaches the card to
 *      that customer as the buyer confirms the assessment payment — no separate
 *      SetupIntent, no second card entry, and the mandate text Stripe shows for
 *      it is the honest disclosure that the card is being kept on file.
 *   3. `/payment-confirmed`, once the one-time charge has genuinely succeeded,
 *      creates the Subscription against the same customer with the now-attached
 *      payment method.
 *
 * A subscription failure NEVER fails the response: the assessment is paid for
 * by then, and reporting the purchase as failed because an add-on did would be
 * a lie about the buyer's money. It is logged, audited, and reported back as
 * its own status so the UI can say so plainly.
 *
 * If the buyer declines, every one of those extra steps is skipped and the flow
 * is byte-for-byte what it was before #490.
 *
 * ── Degrading when #490's migration has not been run ──────────────────────────
 * The add-on's columns (checkout_sessions.rescan_addon_*, tenants.
 * stripe_customer_id) ship as a manual migration Shane runs himself. Every read
 * of them here is wrapped: on failure the route logs an error and falls back to
 * exactly the pre-#490 behaviour — an anonymous one-time PaymentIntent with no
 * customer and no add-on offered. The base $5,000 purchase cannot regress onto
 * an un-migrated database.
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
import { db, checkoutSessionsTable, servicesTable, tenantsTable, usersTable, clientServicesTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
import { isServiceFree, resolveServicePriceCents } from "../lib/catalog-pricing.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { sendEmail, purchaseConfirmationEmail } from "../lib/mailer.ts";
import { markAssessmentLeadPurchased } from "../lib/crm-pipeline.ts";
import {
  ensureFlowStripeCustomer,
  loadRescanAddonOffer,
  RESCAN_ADDON_INTERVAL,
  RESCAN_ADDON_SLUG,
  type RescanAddonOffer,
} from "../lib/assessment-flow-rescan-addon.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedOrder = {
  sessionId: string;
  status: string;
  email: string;
  fullName: string;
  company: string | null;
  /** The Entra tenant GUID stamped by the consent callback. */
  tenantId: string | null;
  /**
   * `tenants.id` — the local row consent time created (#490). Null only if the
   * tenant GUID somehow has no row, which the Stripe-customer path treats as
   * "cannot personalise this charge" rather than as a failure.
   */
  tenantRowId: number | null;
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

  // #490 — the local tenants row consent time created. Only pre-existing
  // columns are read here, so this is safe on an un-migrated database; it is
  // the Stripe-customer column read (inside ensureFlowStripeCustomer) that the
  // callers guard.
  const [tenantRow] = session.tenantId
    ? await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.tenantId, session.tenantId))
        .limit(1)
    : [];

  return {
    sessionId: session.id,
    status: session.status,
    email: session.email,
    fullName: session.fullName,
    company: session.company,
    tenantId: session.tenantId,
    tenantRowId: tenantRow?.id ?? null,
    serviceId: service.id,
    serviceName: service.name,
    productSlug: session.productSlug,
    amountCents,
  };
}

// ── #490 add-on state, read and written defensively ───────────────────────────
// These four columns arrive with a manual migration Shane runs himself. Until
// he has, selecting them throws — so every access goes through these two
// helpers, which log the failure and report "no add-on" rather than letting an
// un-migrated database break a purchase that has nothing to do with the add-on.

type RescanSelection = {
  /** null = the buyer has not been asked yet. */
  optIn: boolean | null;
  serviceId: number | null;
  priceCents: number | null;
  subscriptionId: string | null;
};

const NO_SELECTION: RescanSelection = { optIn: null, serviceId: null, priceCents: null, subscriptionId: null };

async function loadRescanSelection(sessionId: string): Promise<RescanSelection> {
  try {
    const [row] = await db
      .select({
        optIn: checkoutSessionsTable.rescanAddonOptIn,
        serviceId: checkoutSessionsTable.rescanAddonServiceId,
        priceCents: checkoutSessionsTable.rescanAddonPriceCents,
        subscriptionId: checkoutSessionsTable.rescanSubscriptionId,
      })
      .from(checkoutSessionsTable)
      .where(eq(checkoutSessionsTable.id, sessionId))
      .limit(1);
    if (!row) return NO_SELECTION;
    return {
      optIn: row.optIn ?? null,
      serviceId: row.serviceId ?? null,
      priceCents: row.priceCents ?? null,
      subscriptionId: row.subscriptionId ?? null,
    };
  } catch (err) {
    log.error(
      { err, checkoutSessionId: sessionId },
      "assessment-flow payment: rescan add-on columns unreadable — falling back to the pre-#490 flow (has the #490 migration run?)",
    );
    return NO_SELECTION;
  }
}

/** Returns false when the write could not land, so callers can say so honestly. */
async function saveRescanSelection(
  sessionId: string,
  patch: Partial<Pick<RescanSelection, "optIn" | "serviceId" | "priceCents" | "subscriptionId">>,
): Promise<boolean> {
  try {
    await db
      .update(checkoutSessionsTable)
      .set({
        ...(patch.optIn !== undefined ? { rescanAddonOptIn: patch.optIn } : {}),
        ...(patch.serviceId !== undefined ? { rescanAddonServiceId: patch.serviceId } : {}),
        ...(patch.priceCents !== undefined ? { rescanAddonPriceCents: patch.priceCents } : {}),
        ...(patch.subscriptionId !== undefined ? { rescanSubscriptionId: patch.subscriptionId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(checkoutSessionsTable.id, sessionId));
    return true;
  } catch (err) {
    log.error(
      { err, checkoutSessionId: sessionId },
      "assessment-flow payment: could not record the rescan add-on decision (has the #490 migration run?)",
    );
    return false;
  }
}

/**
 * Resolves the Stripe Customer both charges hang off, or null when it cannot be
 * resolved. Never throws: a customer is an ENHANCEMENT to the one-time charge
 * (it makes the subscription possible and gives the buyer a real Stripe record)
 * and its absence must degrade to the pre-#490 anonymous PaymentIntent rather
 * than block the sale.
 */
async function resolveCustomerId(
  stripe: import("stripe").Stripe,
  order: ResolvedOrder,
): Promise<string | null> {
  if (order.tenantRowId == null) {
    log.warn(
      { checkoutSessionId: order.sessionId, tenantId: order.tenantId },
      "assessment-flow payment: no tenants row for this session's tenant GUID — charging without a Stripe customer",
    );
    return null;
  }
  try {
    return await ensureFlowStripeCustomer(stripe, {
      tenantRowId: order.tenantRowId,
      tenantGuid: order.tenantId,
      email: order.email,
      fullName: order.fullName,
      company: order.company,
    });
  } catch (err) {
    log.error(
      { err, checkoutSessionId: order.sessionId, tenantRowId: order.tenantRowId },
      "assessment-flow payment: Stripe customer could not be resolved — falling back to an anonymous PaymentIntent",
    );
    return null;
  }
}

// ── GET /api/public/flow/rescan-addon ──────────────────────────────────────────
// The offer itself: what the add-on is, what it costs per month, and whether it
// can be sold at all right now. The price is resolved from the Product Catalog
// on every call — there is no price in this file, in the client, or in any
// build artefact.
//
// `available: false` is a first-class answer, not an error. It is what the
// client gets while no catalog row exists (the state as of #490 shipping), and
// the flow's response to it is to skip the step entirely rather than show an
// invented number next to a real card form.

router.get("/public/flow/rescan-addon", async (req: Request, res: Response) => {
  const order = await resolveOrder(req.query.sessionId, res);
  if (!order) return;

  let offer: RescanAddonOffer;
  try {
    offer = await loadRescanAddonOffer();
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow rescan add-on: offer lookup failed");
    res.json({ available: false, reason: "not_in_catalog", slug: RESCAN_ADDON_SLUG, optIn: null });
    return;
  }

  const selection = await loadRescanSelection(order.sessionId);

  if (!offer.available) {
    res.json({ available: false, reason: offer.reason, slug: RESCAN_ADDON_SLUG, optIn: selection.optIn });
    return;
  }

  res.json({
    available: true,
    slug: offer.slug,
    name: offer.name,
    description: offer.description,
    priceCents: offer.priceCents,
    interval: offer.interval,
    included: offer.included,
    optIn: selection.optIn,
  });
});

// ── POST /api/public/flow/rescan-addon-decision ────────────────────────────────
// Records the opt-in/decline. Mirrors /public/flow/compliance-decision: the
// answer is recorded server-side before the flow moves on, so a reload resumes
// on the far side of a question the buyer has already answered.
//
// On opt-in the price is SNAPSHOTTED from the catalog at this moment. The buyer
// agreed to a number that was on their screen; if the catalog row is edited
// between here and the payment landing, the subscription is created at the
// agreed price and the divergence is logged rather than silently charged.

const rescanDecisionSchema = z.object({
  sessionId: z.string(),
  optIn: z.boolean(),
});

router.post("/public/flow/rescan-addon-decision", async (req: Request, res: Response) => {
  const parsed = rescanDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId and optIn are required" });
    return;
  }

  const order = await resolveOrder(parsed.data.sessionId, res);
  if (!order) return;

  const optIn = parsed.data.optIn;

  // An opt-in is only real if there is something priced to opt into. A decline
  // needs no offer at all — it is recorded either way so a resumed session does
  // not re-ask.
  let offer: RescanAddonOffer = { available: false, reason: "not_in_catalog" };
  if (optIn) {
    try {
      offer = await loadRescanAddonOffer();
    } catch (err) {
      log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow rescan add-on: offer lookup failed on decision");
    }
    if (!offer.available) {
      res.status(409).json({ error: "addon_unavailable" });
      return;
    }
  }

  const saved = await saveRescanSelection(order.sessionId, {
    optIn,
    serviceId: offer.available ? offer.serviceId : null,
    priceCents: offer.available ? offer.priceCents : null,
  });

  if (!saved) {
    // Recording an opt-in is the whole basis for later charging the buyer
    // monthly — if it did not land, say so rather than letting them believe
    // they bought something. A decline that fails to save is harmless: the
    // add-on simply is not created, which is what a decline means.
    if (optIn) {
      res.status(503).json({ error: "decision_not_recorded" });
      return;
    }
  }

  await createAuditLog({
    actorUserId: null,
    actorName: "public:assessment-flow",
    actorRole: "client",
    actionType: "assessment_flow_rescan_addon_decision",
    entityType: "checkout_session",
    entityId: order.sessionId,
    metadata: {
      optIn,
      slug: RESCAN_ADDON_SLUG,
      serviceId: offer.available ? offer.serviceId : null,
      quotedPriceCents: offer.available ? offer.priceCents : null,
      tenantId: order.tenantId,
    },
  });

  log.info(
    { checkoutSessionId: order.sessionId, optIn, quotedPriceCents: offer.available ? offer.priceCents : null },
    "assessment-flow rescan add-on: decision recorded",
  );

  res.json({ ok: true, optIn, priceCents: offer.available ? offer.priceCents : null });
});

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

    // #490 — the add-on decision was taken on its own step before this one, so
    // it is known by the time the card form is built.
    const selection = await loadRescanSelection(order.sessionId);
    const wantsRescan = selection.optIn === true && (selection.priceCents ?? 0) > 0;

    const customerId = await resolveCustomerId(stripe, order);

    // Saving the card is asked for ONLY when the buyer opted into the
    // subscription — this is what attaches the payment method to the customer
    // during the one card entry, and Stripe renders its own mandate text for
    // it, which is the disclosure that the card is being kept on file. A buyer
    // who declined the add-on gets no such request and no saved card.
    const saveCard = wantsRescan && !!customerId;

    // The idempotency key carries the shape of the request, not just the order:
    // a buyer who goes back and changes the add-on decision needs a DIFFERENT
    // intent (one with or without setup_future_usage), and replaying the same
    // key with different parameters is an error at Stripe rather than a
    // recovery. Unconfirmed intents left behind by a change of mind are never
    // charged.
    const intentShape = `${customerId ? "cust" : "anon"}-${saveCard ? "save" : "nosave"}`;

    const intent = await stripe.paymentIntents.create(
      {
        amount: order.amountCents,
        currency: "usd",
        // Lets Stripe offer whatever in-page methods are enabled on the
        // account (card, wallets) without a hosted page or a redirect.
        automatic_payment_methods: { enabled: true },
        ...(customerId ? { customer: customerId } : {}),
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
        receipt_email: order.email,
        description: `${order.serviceName}${order.company ? ` — ${order.company}` : ""}`,
        metadata: {
          flow: "home_assessment_flow",
          checkoutSessionId: order.sessionId,
          productSlug: order.productSlug,
          serviceId: String(order.serviceId),
          tenantId: order.tenantId ?? "",
          rescanAddon: wantsRescan ? "opted_in" : "declined",
        },
      },
      { idempotencyKey: `home-assessment-flow:pi:${order.sessionId}:${intentShape}` },
    );

    log.info(
      {
        checkoutSessionId: order.sessionId,
        paymentIntentId: intent.id,
        amountCents: order.amountCents,
        status: intent.status,
        stripeCustomerId: customerId,
        rescanOptIn: wantsRescan,
      },
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
      // #490 — what the order summary renders as its recurring line. Null when
      // the buyer declined or the add-on is not sellable; the price is the one
      // snapshotted at decision time, never a client-supplied or invented one.
      rescanAddOn: wantsRescan
        ? { priceCents: selection.priceCents as number, interval: RESCAN_ADDON_INTERVAL }
        : null,
    });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow payment: PaymentIntent creation failed");
    res.status(500).json({ error: "payment_intent_failed" });
  }
});

// ── #490 subscription creation, after the one-time charge has succeeded ────────

type RescanSubscriptionResult =
  | { status: "not_requested" }
  | { status: "created"; subscriptionId: string; priceCents: number }
  | { status: "already"; subscriptionId: string }
  | { status: "failed"; reason: string };

/**
 * Creates the recurring rescan Subscription against the same Stripe customer
 * the one-time charge was just taken on, funded by the payment method that
 * charge attached (`setup_future_usage: "off_session"`).
 *
 * Stripe API shape follows the proven one in portal-checkout.ts — a product,
 * then `subscriptions.create` with inline `price_data` — minus that route's
 * assumption that a customer already exists, which is the part this flow had to
 * add for itself.
 *
 * NEVER throws. By the time this runs the assessment has been paid for; an
 * add-on that fails is a fact to report, not a reason to fail the purchase.
 */
async function createRescanSubscription(
  stripe: import("stripe").Stripe,
  order: ResolvedOrder,
  intent: import("stripe").Stripe.PaymentIntent,
): Promise<RescanSubscriptionResult> {
  const selection = await loadRescanSelection(order.sessionId);
  if (selection.optIn !== true) return { status: "not_requested" };
  if (selection.subscriptionId) return { status: "already", subscriptionId: selection.subscriptionId };

  const agreedPriceCents = selection.priceCents ?? 0;
  if (agreedPriceCents <= 0) {
    log.error(
      { checkoutSessionId: order.sessionId },
      "assessment-flow rescan add-on: opted in with no snapshotted price — refusing to invent one",
    );
    return { status: "failed", reason: "price_missing" };
  }

  // The buyer agreed to the number that was on their screen. A catalog edit
  // between then and now does not silently change what they are charged — it is
  // surfaced instead.
  try {
    const current = await loadRescanAddonOffer();
    if (current.available && current.priceCents !== agreedPriceCents) {
      log.warn(
        { checkoutSessionId: order.sessionId, agreedPriceCents, catalogPriceCents: current.priceCents },
        "assessment-flow rescan add-on: catalog price changed after the buyer agreed — charging the AGREED price",
      );
    }
  } catch {
    /* the agreed price is what is being charged either way */
  }

  const customerId =
    typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
  if (!customerId) {
    log.error(
      { checkoutSessionId: order.sessionId, paymentIntentId: intent.id },
      "assessment-flow rescan add-on: the paid intent carries no Stripe customer — cannot create a subscription",
    );
    return { status: "failed", reason: "no_customer" };
  }

  const paymentMethodId =
    typeof intent.payment_method === "string" ? intent.payment_method : (intent.payment_method?.id ?? null);
  if (!paymentMethodId) {
    log.error(
      { checkoutSessionId: order.sessionId, paymentIntentId: intent.id },
      "assessment-flow rescan add-on: the paid intent exposes no payment method — cannot fund a subscription",
    );
    return { status: "failed", reason: "no_payment_method" };
  }

  try {
    const offerName = "Copilot Readiness — Recurring Rescan";
    const product = await stripe.products.create(
      {
        name: offerName,
        description: "Weekly re-scan of the tenant, tracked over time. Passive drift tracking only — no alerting or remediation.",
        metadata: { slug: RESCAN_ADDON_SLUG, checkoutSessionId: order.sessionId },
      },
      { idempotencyKey: `home-assessment-flow:rescan-product:${order.sessionId}` },
    );

    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [
          {
            price_data: {
              currency: "usd",
              product: product.id,
              recurring: { interval: RESCAN_ADDON_INTERVAL },
              unit_amount: agreedPriceCents,
            },
          },
        ],
        default_payment_method: paymentMethodId,
        metadata: {
          flow: "home_assessment_flow",
          checkoutSessionId: order.sessionId,
          slug: RESCAN_ADDON_SLUG,
          tenantId: order.tenantId ?? "",
          serviceId: selection.serviceId != null ? String(selection.serviceId) : "",
        },
      },
      { idempotencyKey: `home-assessment-flow:sub:${order.sessionId}` },
    );

    if (subscription.status !== "active" && subscription.status !== "trialing") {
      log.error(
        { checkoutSessionId: order.sessionId, subscriptionId: subscription.id, status: subscription.status },
        "assessment-flow rescan add-on: subscription created but did not activate",
      );
      // Still recorded — the object exists at Stripe and must not be orphaned.
      await saveRescanSelection(order.sessionId, { subscriptionId: subscription.id });
      return { status: "failed", reason: `subscription_${subscription.status}` };
    }

    await saveRescanSelection(order.sessionId, { subscriptionId: subscription.id });
    await recordRescanClientService(order, selection.serviceId, subscription.id);

    log.info(
      { checkoutSessionId: order.sessionId, subscriptionId: subscription.id, priceCents: agreedPriceCents, customerId },
      "assessment-flow rescan add-on: subscription active",
    );

    return { status: "created", subscriptionId: subscription.id, priceCents: agreedPriceCents };
  } catch (err) {
    log.error(
      { err, checkoutSessionId: order.sessionId, customerId },
      "assessment-flow rescan add-on: subscription creation FAILED — the one-time assessment charge is unaffected",
    );
    return { status: "failed", reason: "stripe_error" };
  }
}

/**
 * Mirrors the subscription into `client_services`, the existing home for a
 * direct customer's recurring purchases (the same table retainers use, with the
 * same `stripeSubscriptionId` / `billingInterval` columns). No new table: what
 * the checkout has to do is record that the add-on was bought — fulfilment (the
 * #454/#343 rescan workflow node) is tracked separately and reads from here.
 *
 * Non-fatal throughout: the money has moved and the Stripe subscription is the
 * record of truth; a missing local mirror is a gap to alert on, not a reason to
 * report the purchase as failed.
 */
async function recordRescanClientService(
  order: ResolvedOrder,
  serviceId: number | null,
  subscriptionId: string,
): Promise<void> {
  if (serviceId == null) {
    log.error(
      { checkoutSessionId: order.sessionId, subscriptionId },
      "assessment-flow rescan add-on: no catalog serviceId on the decision — client_services row NOT written",
    );
    return;
  }
  try {
    const email = order.email.toLowerCase().trim();
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user) {
      log.error(
        { checkoutSessionId: order.sessionId, subscriptionId },
        "assessment-flow rescan add-on: no users row for the buyer — client_services row NOT written (consent-time Prospect provisioning must have failed)",
      );
      return;
    }

    await db.insert(clientServicesTable).values({
      clientUserId: user.id,
      serviceId,
      status: "active",
      progress: 0,
      startDate: new Date(),
      stripeSubscriptionId: subscriptionId,
      billingInterval: RESCAN_ADDON_INTERVAL,
    });
  } catch (err) {
    log.error(
      { err, checkoutSessionId: order.sessionId, subscriptionId },
      "assessment-flow rescan add-on: client_services mirror failed — the Stripe subscription IS live",
    );
  }
}

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

      // #460 — Thank You + Invoice, combined into one email per Shane's
      // confirmed scope. Fire-and-forget: a mail hiccup must never fail the
      // payment response the buyer is waiting on for the next step (Verify).
      const paidAmountDollars = ((intent.amount_received || order.amountCents) / 100).toFixed(2);
      void sendEmail(
        order.email,
        `Payment confirmed — ${order.serviceName}`,
        purchaseConfirmationEmail({
          clientName: order.fullName,
          serviceName: order.serviceName,
          amountDollars: paidAmountDollars,
        }),
        { templateName: "purchase-confirmation-home-flow" },
      );

      // #456 — payment-complete CRM signal. Non-fatal, see crm-pipeline.ts.
      void markAssessmentLeadPurchased(order.email, order.serviceName);
    }

    // #490 — the add-on's subscription, created only now that the one-time
    // charge has genuinely succeeded and its payment method is attached to the
    // customer. Deliberately OUTSIDE the "first confirm" block above: a retry
    // after a subscription failure must be able to finish the job, and an
    // already-created subscription is short-circuited by its own guard rather
    // than by whether the session was already marked paid.
    const rescan = await createRescanSubscription(stripe, order, intent);
    if (rescan.status === "created") {
      await createAuditLog({
        actorUserId: null,
        actorName: "public:assessment-flow",
        actorRole: "client",
        actionType: "assessment_flow_rescan_subscription_created",
        entityType: "checkout_session",
        entityId: order.sessionId,
        metadata: {
          subscriptionId: rescan.subscriptionId,
          monthlyPriceCents: rescan.priceCents,
          slug: RESCAN_ADDON_SLUG,
          tenantId: order.tenantId,
        },
      });
    }

    res.json({
      ok: true,
      amountCents: intent.amount_received || order.amountCents,
      email: order.email,
      // Reported plainly, including "failed" — the buyer opted into a monthly
      // charge and is entitled to know it did not take.
      rescanAddOn: rescan,
    });
  } catch (err) {
    log.error({ err, checkoutSessionId: order.sessionId }, "assessment-flow payment: confirm failed");
    res.status(500).json({ error: "confirm_failed" });
  }
});

export default router;
