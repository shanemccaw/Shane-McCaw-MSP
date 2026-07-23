/**
 * MSP self-service signup routes — no authentication required.
 *
 * GET  /api/msp/signup/tiers           — list platform subscription tiers
 * POST /api/msp/signup/start           — create Stripe Checkout Session
 * GET  /api/msp/signup/success         — post-checkout success (provision pending)
 *
 * The Stripe webhook (msp-billing-webhook.ts) handles the actual MSP provisioning
 * once Stripe confirms payment — this file only creates the checkout session.
 *
 * Agreement gate (GAP-05):
 *   POST /api/msp/signup/start requires `agreementVersion` matching the current
 *   published platform agreement. Missing or mismatched version → HTTP 400.
 *   The accepted version + sign-up IP/UA are embedded in Stripe session metadata
 *   so the webhook can insert the mspAgreementAcceptancesTable row after provisioning.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, mspSubscriptionsTable, mspsTable, platformAgreementsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { getStripeKey } from "../lib/stripe.ts";
import { resolveEffectiveChargeCents } from "../lib/catalog-pricing.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });

const router: IRouter = Router();

// ── GET /api/msp/signup/tiers ──────────────────────────────────────────────────
// Returns all products where fulfillmentType = "msp_monthly_subscription".
// These are the platform subscription tiers an MSP can choose from.
//
// The fulfillmentTypeKey OR-arm is a safety net for tier rows whose enum column
// silently defaulted to "standard" (e.g. the admin bulk-import path inserts
// fulfillmentType ?? "standard") — the lifecycle key "msp_monthly_subscription"
// is only ever assigned to platform tiers (PRODUCT_TYPE_DEFAULT_FULFILLMENT_KEYS
// + the seed-portal backfills), so widening on it can't pull in non-tier rows.

router.get("/msp/signup/tiers", async (_req: Request, res: Response) => {
  try {
    const rawTiers = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        description: servicesTable.description,
        tagline: servicesTable.tagline,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        priceCents: servicesTable.priceCents,
        billingType: servicesTable.billingType,
        features: servicesTable.features,
        inclusions: servicesTable.inclusions,
        badge: servicesTable.badge,
        highlighted: servicesTable.highlighted,
        tier: servicesTable.tier,
        pageHref: servicesTable.pageHref,
        serviceType: servicesTable.serviceType,
        isFreeOffering: servicesTable.isFreeOffering,
        sortOrder: servicesTable.sortOrder,
        typeAttributes: servicesTable.typeAttributes,
        fulfillmentType: servicesTable.fulfillmentType,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
      })
      .from(servicesTable)
      .where(or(
        eq(servicesTable.fulfillmentType, "msp_monthly_subscription"),
        eq(servicesTable.fulfillmentTypeKey, "msp_monthly_subscription"),
      ))
      .orderBy(servicesTable.sortOrder);

    // Flatten typeAttributes into the response for backward compat with the signup UI
    const tiers = rawTiers.map(t => {
      const attrs = (t.typeAttributes ?? {}) as Record<string, unknown>;
      // Canonical price resolution (catalog-pricing.ts). Tier rows created via
      // the modern admin API carry their price ONLY in the integer priceCents
      // column — legacy decimal price/basePrice are NULL — so serving the raw
      // legacy column rendered every modern tier as "Contact for pricing" and
      // broke self-service checkout (the third legacy-price-only bug of this
      // class). The resolved price is serialized back into the legacy
      // string-dollars `price` shape both signup UIs already parse. A seeded
      // explicit "0.00" free tier keeps its legacy value (resolver returns 0).
      const effectiveCents = resolveEffectiveChargeCents(t, 1);
      return {
        ...t,
        price: effectiveCents > 0 ? (effectiveCents / 100).toFixed(2) : t.price,
        priceCents: effectiveCents,
        tenantAllowance: attrs.tenantAllowance ?? null,
        aiCreditAllowance: attrs.aiCreditAllowancePlatformValue ?? attrs.aiCreditAllowance ?? null,
      aiCreditAllowancePlatformValue: attrs.aiCreditAllowancePlatformValue ?? null,
      aiCreditAllowanceMspValue: attrs.aiCreditAllowanceMspValue ?? null,
      aiCreditOverageRateCents: attrs.aiCreditOverageRateCents ?? null,
        overageRateCents: attrs.overageRateCents ?? null,
        tierCapabilities: attrs.tierCapabilities ?? {},
      };
    });

    res.json({ tiers });
  } catch (err) {
    log.error({ err }, "msp-signup: tiers query failed");
    res.status(500).json({ error: "Failed to load subscription tiers" });
  }
});

// ── POST /api/msp/signup/start ─────────────────────────────────────────────────
// Creates a Stripe Checkout Session for the chosen MSP platform tier.
// The MSP record is NOT created here — it is provisioned by the webhook handler
// once Stripe confirms payment.
//
// Agreement gate: if a current platform agreement is published, `agreementVersion`
// in the request body must match it. A bypass attempt (missing / wrong version)
// returns HTTP 400 before any Stripe call is made.

router.post("/msp/signup/start", async (req: Request, res: Response) => {
  const {
    companyName,
    domain,
    contactName,
    contactEmail,
    serviceId,
    agreementVersion,
    agreementId,
    checkboxConfirmed,
  } = (req.body ?? {}) as {
    companyName?: string;
    domain?: string;
    contactName?: string;
    contactEmail?: string;
    serviceId?: number;
    agreementVersion?: string | null;
    agreementId?: number | null;
    checkboxConfirmed?: boolean;
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
    // ── Agreement gate ──────────────────────────────────────────────────────────
    // Fetch the current active platform agreement. If one exists, the caller MUST
    // supply a matching agreementVersion — this proves they went through the
    // clickwrap step and prevents a direct-POST bypass.
    const [currentAgreement] = await db
      .select({
        id: platformAgreementsTable.id,
        version: platformAgreementsTable.version,
        title: platformAgreementsTable.title,
      })
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.isCurrentVersion, true))
      .limit(1);

    if (currentAgreement) {
      // Require explicit checkbox confirmation — version match alone can be spoofed
      // by a direct POST with the correct version but no real acceptance.
      if (checkboxConfirmed !== true) {
        res.status(400).json({
          error: "You must check the agreement checkbox to confirm acceptance before proceeding.",
          code: "AGREEMENT_CHECKBOX_REQUIRED",
        });
        return;
      }
      if (!agreementVersion || agreementVersion !== currentAgreement.version) {
        log.warn(
          {
            contactEmail: contactEmail.trim(),
            providedVersion: agreementVersion ?? null,
            currentVersion: currentAgreement.version,
          },
          "msp-signup: agreement version mismatch — blocking checkout",
        );
        res.status(400).json({
          error: `You must accept the current platform agreement (version ${currentAgreement.version}) before proceeding.`,
          code: "AGREEMENT_REQUIRED",
          requiredVersion: currentAgreement.version,
        });
        return;
      }
    } else {
      // No published agreement yet — proceed but log a warning for visibility
      log.warn(
        { contactEmail: contactEmail.trim() },
        "msp-signup: no current platform agreement published — proceeding without agreement gate",
      );
    }

    // Load the selected tier
    const [service] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        priceCents: servicesTable.priceCents,
        typeAttributes: servicesTable.typeAttributes,
        fulfillmentType: servicesTable.fulfillmentType,
        fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
        billingType: servicesTable.billingType,
      })
      .from(servicesTable)
      .where(eq(servicesTable.id, Number(serviceId)))
      .limit(1);

    if (
      !service ||
      (service.fulfillmentType !== "msp_monthly_subscription" &&
        service.fulfillmentTypeKey !== "msp_monthly_subscription")
    ) {
      res.status(400).json({ error: "Invalid or non-MSP-subscription service tier" });
      return;
    }

    // Canonical price resolution — a modern-created tier row carries its price
    // ONLY in priceCents (legacy price/basePrice NULL), so gating on the legacy
    // column alone 400'd every modern tier. A tier is unpriced only when NO
    // pricing field is configured at all; an explicit 0 in any flat column
    // (e.g. the seeded free Starter's "0.00") still proceeds, exactly as before.
    const chargeCents = resolveEffectiveChargeCents(service, 1);
    const hasConfiguredPrice =
      chargeCents > 0 ||
      service.price != null ||
      service.basePrice != null ||
      service.priceCents != null;
    if (!hasConfiguredPrice) {
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
    // Unit amount comes from the canonical resolver above — never the raw legacy
    // decimal column, which is NULL on modern-created tier rows (NaN charge).
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: chargeCents,
      recurring: { interval: "month" },
      product_data: {
        name: `MSP Platform — ${service.name}`,
        metadata: { serviceId: String(service.id), fulfillment_type: "msp_monthly_subscription" },
      },
    });

    // Capture IP and User-Agent for the acceptance record.
    // Stripe metadata values are limited to 500 chars.
    const signupIp = (req.ip ?? req.socket?.remoteAddress ?? "").slice(0, 100);
    const signupUa = (req.headers["user-agent"] ?? "").slice(0, 500);

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
        // Agreement acceptance evidence — consumed by the billing webhook
        agreement_accepted: currentAgreement ? "true" : "none",
        agreement_version: currentAgreement ? currentAgreement.version : "",
        agreement_id: currentAgreement ? String(currentAgreement.id) : "",
        signup_ip: signupIp,
        signup_ua: signupUa,
      },
    };

    const session = await stripe.checkout.sessions.create(sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0]);

    log.info(
      {
        sessionId: session.id,
        companyName: companyName.trim(),
        serviceId: service.id,
        agreementVersion: currentAgreement?.version ?? null,
      },
      "msp-signup: checkout session created",
    );

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    log.error({ err }, "msp-signup: start failed");
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
    log.error({ err, sessionId }, "msp-signup: success check failed");
    res.status(500).json({ error: "Failed to check provisioning status" });
  }
});

export default router;
