/**
 * public-retainer-payment.ts — embedded Stripe Payment Element for the marketing
 * site's Work With Me (home) page Architect Retainer tiers (#2955, parent Feature
 * #2953).
 *
 * Shane's requirement is the same one that shaped the assessment flow: the buyer
 * NEVER leaves the site to pay. This is the retainer-scoped sibling of
 * public-assessment-payment.ts — it shares that file's embedded-Payment-Element
 * shape (create the intent server-side, hand the browser a client secret,
 * stripe.js collects and confirms the card in-page, redirect: "if_required") but
 * NOT its assessment-specific plumbing:
 *
 *   - No Microsoft admin consent, no tenant GUID, no checkout_sessions row, no
 *     rescan add-on, no compliance branch. A retainer buyer picks a tier and
 *     pays; there is no scan to authorise.
 *   - Retainers are `recurring_monthly`, so the charge is a Stripe Subscription
 *     created with `payment_behavior: "default_incomplete"` — its first invoice's
 *     PaymentIntent is what the in-page Payment Element confirms. Confirming that
 *     PaymentIntent activates the subscription without a hosted redirect. This is
 *     Stripe's canonical embedded-subscription integration, not the assessment's
 *     one-time PaymentIntent.
 *
 * Two routes, both unauthenticated and both keyed on a client-minted opaque order
 * key (a UUID the browser stores in sessionStorage exactly like the assessment
 * flow's session id) so a reload or a retry-after-decline recovers the SAME
 * subscription rather than minting a second one:
 *
 *   POST /api/public/retainers/payment-intent      create (or recover) the sub
 *   POST /api/public/retainers/payment-confirmed   server-verified success
 *
 * ── What is NOT trusted from the client ───────────────────────────────────────
 *   - The amount. It is resolved server-side from the `services` row named by the
 *     posted slug, via the shared resolveServicePriceCents / isServiceFree
 *     helpers — the same single source of truth the assessment flow and the
 *     free-checkout guard use. There is no price field on either request; a
 *     client that posts one is ignored.
 *   - The success claim. /payment-confirmed does not believe the browser: it
 *     re-reads the Subscription (and its first PaymentIntent) from Stripe and
 *     requires the subscription to be active/trialing AND its metadata to name
 *     this exact order key before it records anything.
 *
 * A tier is sellable here only when its catalog row is public, `serviceType =
 * "retainer"`, `billingType = "recurring_monthly"`, not free, and carries a
 * positive resolved price. The four fixed tiers (Advisory / Essentials / Growth /
 * Enterprise) satisfy that; the two discovery-call "scoped" retainers do not have
 * a self-serve price and are never transacted through here.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
import { isServiceFree } from "../lib/catalog-pricing.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { sendEmail, purchaseConfirmationEmail } from "../lib/mailer.ts";
import { ensureLeadStagingForEmail } from "../lib/lead-intent.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const FLOW = "work_with_me_retainer" as const;
const INTERVAL = "month" as const;

/**
 * The four fixed, hours-based Architect Retainer tiers are the ONLY retainers
 * sold self-serve through this public route. The two "scoped" retainers
 * (vCISO / Governance, Copilot Governance) carry a catalog price but are
 * positioned as discovery-call engagements ("Request scoping" → Contact) whose
 * final price is set in a call, so they are deliberately excluded here — a
 * direct POST of their slug is refused. Prices still come from the catalog; this
 * is an allowlist of WHICH tiers transact, not a price. Mirrors the frontend's
 * TIER_ORDER.
 */
const SELF_SERVE_TIER_SLUGS = new Set([
  "architect-advisory-retainer",
  "architect-essentials-retainer",
  "architect-growth-retainer",
  "architect-enterprise-retainer",
]);

type ResolvedRetainer = {
  serviceId: number;
  serviceName: string;
  slug: string;
  amountCents: number;
  hoursPerMonth: string | null;
};

/**
 * Resolve the tier the posted slug names, or respond and return null. Enforces —
 * on the server, not just in the UI — every condition that makes a tier sellable
 * self-serve: public, a retainer, monthly-recurring, not free, and a positive
 * resolved price. Anything else (a one-time service, a discovery-call scoped
 * retainer with no price, a hidden row) is refused here rather than allowed to
 * reach Stripe with an amount of zero.
 */
async function resolveRetainer(rawSlug: unknown, res: Response): Promise<ResolvedRetainer | null> {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) {
    res.status(400).json({ error: "slug_required" });
    return null;
  }

  // Only the four fixed self-serve tiers transact here — scoped/discovery-call
  // retainers are priced in a call, not bought through this route.
  if (!SELF_SERVE_TIER_SLUGS.has(slug)) {
    log.warn({ slug }, "retainer payment: slug is not a self-serve tier");
    res.status(409).json({ error: "not_self_serve" });
    return null;
  }

  const [service] = await db
    .select({
      id: servicesTable.id,
      name: servicesTable.name,
      slug: servicesTable.slug,
      priceCents: servicesTable.priceCents,
      price: servicesTable.price,
      basePrice: servicesTable.basePrice,
      isFreeOffering: servicesTable.isFreeOffering,
      typeAttributes: servicesTable.typeAttributes,
      serviceType: servicesTable.serviceType,
      billingType: servicesTable.billingType,
      visibility: servicesTable.visibility,
      hoursPerMonth: servicesTable.hoursPerMonth,
    })
    .from(servicesTable)
    .where(and(eq(servicesTable.slug, slug), eq(servicesTable.visibility, "public")))
    .limit(1);

  if (!service) {
    res.status(404).json({ error: "retainer_not_found" });
    return null;
  }

  if (service.serviceType !== "retainer" || service.billingType !== "recurring_monthly") {
    log.warn(
      { slug, serviceType: service.serviceType, billingType: service.billingType },
      "retainer payment: slug names a service that is not a monthly retainer",
    );
    res.status(409).json({ error: "not_a_retainer" });
    return null;
  }

  // A free product can never reach a card charge — mirrors the assessment flow's
  // guard, using the same isServiceFree source of truth so the two agree.
  if (isServiceFree(service)) {
    res.status(409).json({ error: "service_is_free" });
    return null;
  }

  // Self-serve checkout uses the CANONICAL integer-cents price only — not the
  // legacy decimal fallback. The four fixed tiers carry `priceCents`; the two
  // discovery-call scoped retainers carry only a `base_price` "from" figure and
  // are deliberately excluded from self-serve here (they're priced in a call,
  // via "Request scoping" → Contact), so a direct POST cannot buy one at its
  // "from" price.
  const amountCents = service.priceCents != null && Number(service.priceCents) > 0 ? Math.round(Number(service.priceCents)) : 0;
  if (amountCents <= 0) {
    log.warn({ slug, serviceId: service.id }, "retainer payment: tier has no fixed self-serve price (scoped/discovery-call retainer?)");
    res.status(409).json({ error: "price_unresolved" });
    return null;
  }

  return {
    serviceId: service.id,
    serviceName: service.name,
    slug: service.slug ?? slug,
    amountCents,
    hoursPerMonth: service.hoursPerMonth ?? null,
  };
}

/**
 * Find-or-create the Stripe Customer both the subscription and its receipt hang
 * off, keyed on the buyer's email. A duplicate customer is low-harm, so a lookup
 * failure falls through to creating one rather than blocking the sale.
 */
async function resolveCustomer(
  stripe: import("stripe").Stripe,
  email: string,
): Promise<import("stripe").Stripe.Customer> {
  try {
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data[0]) return existing.data[0];
  } catch (err) {
    log.warn({ err }, "retainer payment: customer lookup failed — creating a fresh customer");
  }
  return stripe.customers.create({ email });
}

// ── POST /api/public/retainers/payment-intent ──────────────────────────────────
// Creates (or, via the idempotency key, recovers) the default_incomplete
// Subscription whose first invoice's PaymentIntent the in-page Payment Element
// confirms, and returns the publishable key stripe.js needs to boot.

const paymentIntentSchema = z.object({
  slug: z.string(),
  email: z.string(),
  orderKey: z.string(),
});

router.post("/public/retainers/payment-intent", async (req: Request, res: Response) => {
  const parsed = paymentIntentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "slug, email and orderKey are required" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "email_invalid" });
    return;
  }
  if (!UUID_RE.test(parsed.data.orderKey)) {
    res.status(400).json({ error: "order_key_invalid" });
    return;
  }
  const orderKey = parsed.data.orderKey;

  const retainer = await resolveRetainer(parsed.data.slug, res);
  if (!retainer) return;

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    log.error({}, "retainer payment: STRIPE_PUBLISHABLE_KEY not configured — the in-page Payment Element cannot boot");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.error({ err }, "retainer payment: Stripe secret key not configured");
    res.status(503).json({ error: "payment_unavailable" });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const customer = await resolveCustomer(stripe, email);

    // The product carries the tier's name so it reads correctly on the buyer's
    // Stripe receipt and in the dashboard. Idempotent on the order key so a
    // reload does not orphan a second product.
    const product = await stripe.products.create(
      {
        name: retainer.serviceName,
        metadata: { slug: retainer.slug, flow: FLOW, orderKey },
      },
      { idempotencyKey: `${FLOW}:product:${orderKey}` },
    );

    // default_incomplete: the subscription is created but not yet paid; its first
    // invoice's PaymentIntent is what the Payment Element confirms in-page. The
    // idempotency key is the order key, so a reload / retry returns the SAME
    // subscription (and therefore the same PaymentIntent) instead of a duplicate.
    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [
          {
            price_data: {
              currency: "usd",
              product: product.id,
              recurring: { interval: INTERVAL },
              unit_amount: retainer.amountCents,
            },
          },
        ],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        // Stripe SDK 22 / API 2025+ removed `invoice.payment_intent`; the
        // in-page client secret now comes from the invoice's confirmation_secret.
        expand: ["latest_invoice.confirmation_secret"],
        metadata: {
          flow: FLOW,
          orderKey,
          slug: retainer.slug,
          serviceId: String(retainer.serviceId),
          email,
        },
      },
      { idempotencyKey: `${FLOW}:sub:${orderKey}` },
    );

    const invoice = subscription.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== "string" ? (invoice.confirmation_secret?.client_secret ?? null) : null;

    // An already-active subscription recovered on reload (paid, then the page
    // reloaded before the confirm callback landed) has no outstanding secret to
    // confirm against — the client is told to skip straight to confirm.
    const alreadyActive = subscription.status === "active" || subscription.status === "trialing";

    if (!clientSecret && !alreadyActive) {
      log.error(
        { orderKey, subscriptionId: subscription.id, status: subscription.status },
        "retainer payment: subscription created but exposes no confirmation secret",
      );
      res.status(500).json({ error: "payment_intent_missing" });
      return;
    }

    log.info(
      {
        orderKey,
        subscriptionId: subscription.id,
        hasClientSecret: !!clientSecret,
        amountCents: retainer.amountCents,
        status: subscription.status,
        stripeCustomerId: customer.id,
      },
      "retainer payment: subscription ready for in-page confirmation",
    );

    res.json({
      clientSecret,
      publishableKey,
      subscriptionId: subscription.id,
      amountCents: retainer.amountCents,
      productName: retainer.serviceName,
      hoursPerMonth: retainer.hoursPerMonth,
      interval: INTERVAL,
      alreadyActive,
    });
  } catch (err) {
    log.error({ err, orderKey }, "retainer payment: subscription creation failed");
    res.status(500).json({ error: "subscription_create_failed" });
  }
});

// ── POST /api/public/retainers/payment-confirmed ───────────────────────────────
// The success callback stripe.js's confirmPayment resolves into. The client's
// word is not evidence: the subscription is re-read from Stripe and must be
// active/trialing AND carry this exact order key in its metadata before anything
// is recorded.

const paymentConfirmedSchema = z.object({
  subscriptionId: z.string().min(1),
  orderKey: z.string(),
});

router.post("/public/retainers/payment-confirmed", async (req: Request, res: Response) => {
  const parsed = paymentConfirmedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "subscriptionId and orderKey are required" });
    return;
  }
  if (!UUID_RE.test(parsed.data.orderKey)) {
    res.status(400).json({ error: "order_key_invalid" });
    return;
  }

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
    const subscription = await stripe.subscriptions.retrieve(parsed.data.subscriptionId, {
      expand: ["latest_invoice"],
    });

    if (subscription.metadata?.["orderKey"] !== parsed.data.orderKey || subscription.metadata?.["flow"] !== FLOW) {
      log.warn(
        { orderKey: parsed.data.orderKey, subscriptionId: subscription.id, metaOrderKey: subscription.metadata?.["orderKey"] },
        "retainer payment: REFUSED — subscription does not belong to this order",
      );
      res.status(403).json({ error: "subscription_order_mismatch" });
      return;
    }

    const active = subscription.status === "active" || subscription.status === "trialing";
    if (!active) {
      log.info(
        { orderKey: parsed.data.orderKey, subscriptionId: subscription.id, status: subscription.status },
        "retainer payment: confirm callback for a subscription that has not activated",
      );
      res.status(409).json({ error: "subscription_not_active", status: subscription.status });
      return;
    }

    // Re-resolve the tier for its authoritative name/amount (never trust a
    // client-supplied figure) rather than reading the Stripe line item back.
    const slug = subscription.metadata?.["slug"] ?? "";
    const email = subscription.metadata?.["email"] ?? "";
    const [service] = slug
      ? await db.select({ name: servicesTable.name }).from(servicesTable).where(eq(servicesTable.slug, slug)).limit(1)
      : [];
    const serviceName = service?.name ?? "Architect Retainer";

    const invoice = subscription.latest_invoice;
    const amountCents =
      invoice && typeof invoice !== "string" && typeof invoice.amount_paid === "number"
        ? invoice.amount_paid
        : null;

    await createAuditLog({
      actorUserId: null,
      actorName: "public:work-with-me-retainer",
      actorRole: "client",
      actionType: "retainer_subscription_created",
      entityType: "stripe_subscription",
      entityId: subscription.id,
      metadata: {
        orderKey: parsed.data.orderKey,
        slug,
        email,
        monthlyPriceCents: amountCents,
        interval: INTERVAL,
        stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
      },
    });

    log.info(
      { orderKey: parsed.data.orderKey, subscriptionId: subscription.id, slug, amountCents },
      "retainer payment: subscription active — recorded",
    );

    // A retainer buyer is a real lead Shane follows up with directly (the done
    // state promises exactly that). Non-fatal: a CRM hiccup must never fail the
    // payment response the buyer is waiting on.
    if (email) {
      void ensureLeadStagingForEmail(email, { source: "purchase" }).catch(() => {});
    }

    // Receipt / confirmation email. Fire-and-forget for the same reason.
    if (email && amountCents != null) {
      void sendEmail(
        email,
        `Retainer started — ${serviceName}`,
        purchaseConfirmationEmail({
          clientName: email,
          serviceName,
          amountDollars: (amountCents / 100).toFixed(2),
        }),
        { templateName: "purchase-confirmation-retainer" },
      );
    }

    res.json({ ok: true, status: subscription.status, amountCents, serviceName, interval: INTERVAL });
  } catch (err) {
    log.error({ err, orderKey: parsed.data.orderKey }, "retainer payment: confirm failed");
    res.status(500).json({ error: "confirm_failed" });
  }
});

export default router;
