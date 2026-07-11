/**
 * MSP self-service signup routes — no authentication required.
 *
 * GET  /api/msp/signup/tiers           — list platform subscription tiers
 * POST /api/msp/signup/start           — create Stripe Checkout Session
 * GET  /api/msp/signup/success         — post-checkout success (provision pending)
 *
 * The Stripe webhook (msp-billing-webhook.ts) handles the actual MSP provisioning
 * once Stripe confirms payment — this file only creates the checkout session.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, mspSubscriptionsTable, mspsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();

// ── GET /api/msp/signup/tiers ──────────────────────────────────────────────────
// Returns all products where fulfillmentType = "msp_monthly_subscription".
// These are the platform subscription tiers an MSP can choose from.

router.get("/msp/signup/tiers", async (_req: Request, res: Response) => {
  try {
    const tiers = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        description: servicesTable.description,
        tagline: servicesTable.tagline,
        price: servicesTable.price,
        billingType: servicesTable.billingType,
        tenantAllowance: servicesTable.tenantAllowance,
        aiCreditAllowance: servicesTable.aiCreditAllowance,
        overageRateCents: servicesTable.overageRateCents,
        tierCapabilities: servicesTable.tierCapabilities,
        features: servicesTable.features,
        inclusions: servicesTable.inclusions,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        sortOrder: servicesTable.sortOrder,
      })
      .from(servicesTable)
      .where(eq(servicesTable.fulfillmentType, "msp_monthly_subscription"))
      .orderBy(servicesTable.sortOrder);

    res.json({ tiers });
  } catch (err) {
    logger.error({ err }, "msp-signup: tiers query failed");
    res.status(500).json({ error: "Failed to load subscription tiers" });
  }
});

// ── POST /api/msp/signup/start ─────────────────────────────────────────────────
// Creates a Stripe Checkout Session for the chosen MSP platform tier.
// The MSP record is NOT created here — it is provisioned by the webhook handler
// once Stripe confirms payment.

router.post("/msp/signup/start", async (req: Request, res: Response) => {
  const {
    companyName,
    domain,
    contactName,
    contactEmail,
    serviceId,
  } = (req.body ?? {}) as {
    companyName?: string;
    domain?: string;
    contactName?: string;
    contactEmail?: string;
    serviceId?: number;
  };

  // Validate required fields
  if (!companyName?.trim()) {
    res.status(400).json({ error: "companyName is required" });
    return;
  }
  if (!contactEmail?.trim() || !contactEmail.includes("@")) {
    res.status(400).json({ error: "A valid contactEmail is required" });
    return;
  }
  if (!serviceId || isNaN(Number(serviceId))) {
    res.status(400).json({ error: "serviceId is required" });
    return;
  }

  try {
    // Load the selected tier
    const [service] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        price: servicesTable.price,
        fulfillmentType: servicesTable.fulfillmentType,
        billingType: servicesTable.billingType,
      })
      .from(servicesTable)
      .where(eq(servicesTable.id, Number(serviceId)))
      .limit(1);

    if (!service || service.fulfillmentType !== "msp_monthly_subscription") {
      res.status(400).json({ error: "Invalid or non-MSP-subscription service tier" });
      return;
    }

    if (!service.price) {
      res.status(400).json({ error: "Service tier has no price configured" });
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      res.status(503).json({ error: "Payment processing is not configured" });
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    // Get the base URL for success/cancel redirects
    const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map(d => d.trim()).filter(Boolean);
    const primaryDomain = domains.find(d => !d.endsWith(".replit.dev")) ?? domains[0] ?? "localhost";
    const baseUrl = primaryDomain === "localhost"
      ? `http://localhost:${process.env.PORT ?? 8080}`
      : `https://${primaryDomain}`;
    const portalBase = `${baseUrl}/portal`;

    // Find or create a Stripe customer for this MSP contact email
    let customerId: string | undefined;
    try {
      const existing = await stripe.customers.search({ query: `email:"${contactEmail.trim()}"`, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const created = await stripe.customers.create({
          email: contactEmail.trim(),
          name: contactName?.trim() ?? companyName.trim(),
          metadata: {
            msp_company_name: companyName.trim(),
            msp_domain: domain?.trim() ?? "",
            msp_contact_name: contactName?.trim() ?? "",
            signup_source: "msp_platform",
          },
        });
        customerId = created.id;
      }
    } catch {
      // Non-fatal — checkout can proceed without pre-created customer
    }

    // Create a Stripe Price for this tier (recurring monthly) or reuse existing
    // For production, prices would be pre-created in Stripe Dashboard. For dev, we
    // create an ad-hoc price so the checkout works without manual Stripe setup.
    const priceCents = Math.round(parseFloat(String(service.price)) * 100);
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: priceCents,
      recurring: { interval: "month" },
      product_data: {
        name: `MSP Platform — ${service.name}`,
        metadata: { service_id: String(service.id), fulfillment_type: "msp_monthly_subscription" },
      },
    });

    // Build the Checkout Session
    const sessionParams: Record<string, unknown> = {
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      customer_email: customerId ? undefined : contactEmail.trim(),
      customer: customerId,
      success_url: `${portalBase}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${portalBase}/signup?cancelled=1`,
      subscription_data: {
        metadata: {
          msp_company_name: companyName.trim(),
          msp_domain: domain?.trim() ?? "",
          msp_contact_name: contactName?.trim() ?? "",
          msp_contact_email: contactEmail.trim(),
          service_id: String(service.id),
          fulfillment_type: "msp_monthly_subscription",
        },
      },
      metadata: {
        msp_company_name: companyName.trim(),
        msp_domain: domain?.trim() ?? "",
        msp_contact_email: contactEmail.trim(),
        msp_contact_name: contactName?.trim() ?? "",
        service_id: String(service.id),
        signup_source: "msp_platform",
      },
    };

    const session = await stripe.checkout.sessions.create(sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0]);

    logger.info(
      { sessionId: session.id, companyName: companyName.trim(), serviceId: service.id },
      "msp-signup: checkout session created",
    );

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err }, "msp-signup: start failed");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── GET /api/msp/signup/success ────────────────────────────────────────────────
// Called by the success redirect from Stripe Checkout.
// Returns the pending MSP provisioning state so the UI can show the right message.

router.get("/msp/signup/success", async (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? "");
  if (!sessionId) {
    res.status(400).json({ error: "session_id required" });
    return;
  }

  try {
    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      res.status(503).json({ error: "Payment processing is not configured" });
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (session.payment_status !== "paid") {
      res.json({ status: "pending", message: "Payment not yet confirmed" });
      return;
    }

    // Check if the MSP was already provisioned by the webhook
    const metadata = session.metadata ?? {};
    const companyName = metadata.msp_company_name ?? "";
    const slugBase = companyName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);

    const [existingMsp] = await db
      .select({ id: mspsTable.id, name: mspsTable.name, status: mspsTable.status })
      .from(mspsTable)
      .where(eq(mspsTable.slug, slugBase))
      .limit(1);

    if (existingMsp) {
      res.json({
        status: "provisioned",
        mspId: existingMsp.id,
        mspName: existingMsp.name,
        message: "Your MSP account is active. You can now sign in.",
      });
    } else {
      // Webhook hasn't fired yet — this is normal, advise polling or retry
      res.json({
        status: "provisioning",
        message: "Payment confirmed! Your account is being set up — this takes just a moment.",
        sessionId,
      });
    }
  } catch (err) {
    logger.error({ err, sessionId }, "msp-signup: success check failed");
    res.status(500).json({ error: "Failed to check provisioning status" });
  }
});

export default router;
