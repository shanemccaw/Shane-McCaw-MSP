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
 *   - The amount. It is resolved server-side from HARDCODED_RETAINER_TIERS below —
 *     there is no price field on either request; a client that posts one is
 *     ignored.
 *   - The success claim. /payment-confirmed does not believe the browser: it
 *     re-reads the Subscription (and its first PaymentIntent) from Stripe and
 *     requires the subscription to be active/trialing AND its metadata to name
 *     this exact order key before it records anything.
 *
 * A tier is sellable here only when its slug is one of the four fixed tiers in
 * HARDCODED_RETAINER_TIERS below; the two discovery-call "scoped" retainers
 * (vCISO / Governance, Copilot Governance) are priced in a call and are never
 * transacted through here.
 *
 * ── #2964 — pricing is HARDCODED, not read from the `services` table ──────────
 * Deliberate, explicit, temporary exception to this project's standing "no
 * fixture data" rule — Shane's direction (see #2964), scoped ONLY to these four
 * retainer prices, for this release. Staging/Production's `services` table has
 * drifted to stale values (different tiers, different hours) and reconciling that
 * across environments is out of scope for this push; the values below are the
 * correct, intended ones, confirmed against every other doc in the project.
 * HARDCODED_RETAINER_TIERS is the ONE source both the displayed price
 * (WorkWithMe.tsx / RetainerCheckout.tsx carry their own identical copy) and the
 * actual Stripe-charged amount here read from — never query `services` for these
 * four slugs, and never let the two copies drift out of sync.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { getStripeKey, getStripePublishableKey } from "../lib/stripe.ts";
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
 * The four fixed, hours-based Architect Retainer tiers — the ONLY retainers sold
 * self-serve through this public route — HARDCODED per #2964 (see the file-header
 * note above). `serviceId`/`serviceName` mirror the real `services` rows
 * (confirmed against local Postgres) purely for receipt/audit-log continuity;
 * `amountCents` and `hoursPerMonth` are the two values this issue exists to pin,
 * and are never read from the DB. The two "scoped" retainers (vCISO / Governance,
 * Copilot Governance) are discovery-call engagements priced in a call, not here —
 * absence from this map IS their exclusion. Mirrors the frontend's TIER_ORDER.
 */
const HARDCODED_RETAINER_TIERS: Record<
  string,
  { serviceId: number; serviceName: string; amountCents: number; hoursPerMonth: string }
> = {
  "architect-advisory-retainer": { serviceId: 168, serviceName: "Architect Advisory Retainer", amountCents: 90_000, hoursPerMonth: "5" },
  "architect-essentials-retainer": { serviceId: 115, serviceName: "Architect Essentials Retainer", amountCents: 150_000, hoursPerMonth: "8" },
  "architect-growth-retainer": { serviceId: 116, serviceName: "Architect Growth Retainer", amountCents: 300_000, hoursPerMonth: "16" },
  "architect-enterprise-retainer": { serviceId: 117, serviceName: "Architect Enterprise Retainer", amountCents: 550_000, hoursPerMonth: "30" },
};

type ResolvedRetainer = {
  serviceId: number;
  serviceName: string;
  slug: string;
  amountCents: number;
  hoursPerMonth: string | null;
};

/**
 * Resolve the tier the posted slug names, or respond and return null. The four
 * fixed tiers above are the only ones this route ever transacts — a slug outside
 * that map (a one-time service, a discovery-call scoped retainer, a typo) is
 * refused here rather than allowed to reach Stripe at all.
 */
async function resolveRetainer(rawSlug: unknown, res: Response): Promise<ResolvedRetainer | null> {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) {
    res.status(400).json({ error: "slug_required" });
    return null;
  }

  const tier = HARDCODED_RETAINER_TIERS[slug];
  if (!tier) {
    log.warn({ slug }, "retainer payment: slug is not a self-serve tier");
    res.status(409).json({ error: "not_self_serve" });
    return null;
  }

  return {
    serviceId: tier.serviceId,
    serviceName: tier.serviceName,
    slug,
    amountCents: tier.amountCents,
    hoursPerMonth: tier.hoursPerMonth,
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

    // Re-resolve the tier for its authoritative name (never trust a
    // client-supplied figure) from the same HARDCODED_RETAINER_TIERS source of
    // truth used to create the subscription — not a fresh DB read.
    const slug = subscription.metadata?.["slug"] ?? "";
    const email = subscription.metadata?.["email"] ?? "";
    const serviceName = HARDCODED_RETAINER_TIERS[slug]?.serviceName ?? "Architect Retainer";

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
