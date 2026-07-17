/**
 * portal-checkout.ts
 *
 * Authenticated-only checkout for CustomerUser role — branches by serviceClass
 * so add_on / subscription offers go through instant Stripe checkout, $0 offers
 * skip Stripe entirely (rate-limited), and project offers create a SOW that flows
 * through the existing draft/signed/paid state machine.
 *
 * resolve_fulfillment is called on every purchase success — one shared node, no
 * duplicated logic per checkout path.
 *
 * Routes:
 *   POST /api/portal/offers/:id/checkout     — customer-initiated checkout
 *   POST /api/portal/stripe/webhook          — Stripe webhook for portal sessions
 *
 * Rate-limits (free/$0 path only):
 *   1 per email per rolling 90 days
 *   3 per IP per rolling 24 hours
 *   Per-MSP daily aggregate → soft PlatformAdmin alert (not a hard block)
 *
 * Trial terms:
 *   trialPeriodDays is resolved from the Offer first, then falls back to the
 *   Product. The same product can carry different trial terms per campaign.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import {
  db,
  salesOffersTable,
  servicesTable,
  mspSowsTable,
  mspSowEventsTable,
  mspConnectorConfigsTable,
  mspCustomersTable,
  mspEventStoreTable,
  freeCheckoutAttemptsTable,
  platformAgreementsTable,
  mspAgreementAcceptancesTable,
  mspSubscriptionsTable,
  mspUsersTable,
  mspsTable,
} from "@workspace/db";
import { eq, and, count, gte, or } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { getStripeKey, getMspDefaultPaymentMethod } from "../lib/stripe.ts";
import { resolveFulfillment } from "../lib/resolve-fulfillment.ts";
import { resolveCatalogPricing } from "../lib/catalog-pricing.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "billing" });
import { transitionOfferState } from "../lib/sales-offer-engine.ts";
import { broadcastCustomerOfferChange, broadcastMspOfferChange } from "../lib/sse-broadcast.ts";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { verifyCaptchaToken } from "../lib/captcha.ts";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

function getClientIp(req: Request): string | null {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    null
  );
}

/** Generate a secure random share token for SOW links. */
function generateShareToken(): string {
  return randomBytes(24).toString("hex");
}

/** Emit a SOW lifecycle event (non-fatal). */
async function emitSowEvent(
  sowId: string,
  eventName: string,
  actorUserId: number | null,
  actorRole: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(mspSowEventsTable).values({
      sowId,
      eventName,
      actorUserId: actorUserId ?? undefined,
      actorRole,
      payload,
    });
  } catch (err) {
    log.warn({ err, sowId, eventName }, "portal-checkout: failed to emit SOW event (non-fatal)");
  }
}

/** Emit an MSP event store entry (non-fatal). */
async function emitMspEvent(
  mspId: number,
  customerId: number | null,
  eventType: string,
  payload: Record<string, unknown>,
  actorUserId: number | null,
): Promise<void> {
  try {
    await db.insert(mspEventStoreTable).values({
      eventType,
      source: "portal-checkout",
      actor: {
        id: String(actorUserId ?? "system"),
        role: actorUserId ? ("CustomerUser" as const) : ("system" as const),
        type: actorUserId ? ("user" as const) : ("system" as const),
      },
      meta: { tenant: { mspId, customerId } },
      payload,
      mspId,
      ownerType: customerId ? "customer" : "msp",
    });
  } catch (err) {
    log.warn({ err, eventType }, "portal-checkout: failed to emit MSP event (non-fatal)");
  }
}

/** Minimal SOW HTML document (same generator as msp-sow.ts). */
function generateSowDocument(opts: {
  title: string;
  description: string | null;
  amountCents: number;
  customerAgreementText: string | null;
  mspId: number;
}): string {
  const amount = (opts.amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${opts.title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem;color:#111;}
h1{font-size:1.5rem;margin-bottom:0.5rem;}h2{font-size:1.1rem;margin-top:2rem;}
.price{font-size:1.25rem;font-weight:700;color:#0a2540;}
.section{border-top:1px solid #e5e7eb;margin-top:1.5rem;padding-top:1rem;}
</style></head>
<body>
<h1>Statement of Work</h1>
<p class="price">Project Total: ${amount}</p>
<div class="section">
  <h2>Scope</h2>
  <p><strong>${opts.title}</strong></p>
  ${opts.description ? `<p>${opts.description}</p>` : ""}
</div>
${opts.customerAgreementText ? `<div class="section"><h2>Customer Agreement</h2><p>${opts.customerAgreementText}</p></div>` : ""}
<div class="section">
  <h2>Signature</h2>
  <p>By signing below you agree to the scope and pricing described in this document.</p>
</div>
</body></html>`;
}

// ── POST /api/portal/offers/:id/checkout ─────────────────────────────────────
//
// Customer-initiated checkout. Branches by serviceClass:
//   add_on       → Stripe one-time payment checkout session
//   subscription → Stripe subscription checkout (trialPeriodDays from Offer)
//   price === 0  → skip Stripe, rate-limit, call resolveFulfillment directly
//   project      → create MSP SOW, return share link
//
// Marks the offer as "accepted" before branching so SSE listeners get the state
// change regardless of the checkout outcome.

router.post(
  "/portal/offers/:id/checkout",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      apiErr(res, 403, "No customer identity on token");
      return;
    }

    const captchaToken = req.body?.captchaToken;
    if (!captchaToken) {
      apiErr(res, 400, "CAPTCHA token is required");
      return;
    }

    const captchaRes = await verifyCaptchaToken(captchaToken);
    if (!captchaRes.success) {
      apiErr(res, 403, "CAPTCHA verification failed");
      return;
    }

    const offerId = parseInt(p(req.params["id"]), 10);
    if (isNaN(offerId)) {
      apiErr(res, 400, "Invalid offer id");
      return;
    }

    // ── Load offer ────────────────────────────────────────────────────────────
    const [offerRow] = await db
      .select({
        id: salesOffersTable.id,
        state: salesOffersTable.state,
        mspId: salesOffersTable.mspId,
        serviceId: salesOffersTable.serviceId,
        customerId: salesOffersTable.customerId,
        title: salesOffersTable.title,
        adjustedPriceCents: salesOffersTable.adjustedPriceCents,
        trialPeriodDays: salesOffersTable.trialPeriodDays,
        internalCostCents: salesOffersTable.internalCostCents,
        priceCents: salesOffersTable.priceCents,
      })
      .from(salesOffersTable)
      .where(and(eq(salesOffersTable.id, offerId), eq(salesOffersTable.customerId, customerId)))
      .limit(1);

    if (!offerRow) {
      apiErr(res, 404, "Offer not found");
      return;
    }
    if (offerRow.state !== "sent") {
      apiErr(res, 422, `Offer is not available for checkout (current state: ${offerRow.state})`);
      return;
    }

    // ── Resolve service metadata ──────────────────────────────────────────────
    let serviceClass: "project" | "add_on" | "subscription" = "add_on";
    let fulfillmentTypeKey: string | null = null;
    let serviceName = offerRow.title;
    let serviceDescription: string | null = null;
    let allowFreeCheckout = true;
    let productTrialDays: number | null = null;
    let internalCostCents: number | null = null;
    let priceCents: number | null = null;

    if (offerRow.serviceId) {
      const [svc] = await db
        .select({
          name: servicesTable.name,
          description: servicesTable.description,
          serviceClass: servicesTable.serviceClass,
          fulfillmentTypeKey: servicesTable.fulfillmentTypeKey,
          allowFreeCheckout: servicesTable.allowFreeCheckout,
          trialPeriodDays: servicesTable.trialPeriodDays,
          internalCostCents: servicesTable.internalCostCents,
          priceCents: servicesTable.priceCents,
        })
        .from(servicesTable)
        .where(eq(servicesTable.id, offerRow.serviceId))
        .limit(1);

      if (svc) {
        serviceClass = (svc.serviceClass as "project" | "add_on" | "subscription" | null) ?? "add_on";
        fulfillmentTypeKey = svc.fulfillmentTypeKey ?? null;
        serviceName = svc.name;
        serviceDescription = svc.description ?? null;
        allowFreeCheckout = svc.allowFreeCheckout;
        productTrialDays = svc.trialPeriodDays ?? null;
        internalCostCents = svc.internalCostCents ?? null;
        priceCents = svc.priceCents ?? null;
      }
    }

    // Offer-level trial overrides product-level trial
    const trialPeriodDays: number | null = offerRow.trialPeriodDays ?? productTrialDays;
    const amountCents = offerRow.adjustedPriceCents;

    // ── Mark offer accepted ──────────────────────────────────────────────────
    // Update state before branching so SSE subscribers see the transition.
    await db
      .update(salesOffersTable)
      .set({ state: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(salesOffersTable.id, offerId));

    // Broadcast state change
    broadcastCustomerOfferChange(customerId, { offerId, state: "accepted" });
    if (offerRow.mspId) {
      broadcastMspOfferChange(offerRow.mspId, { offerId, state: "accepted", tenantId: customerId });
    }

    const actorId = (req.user as { id?: number } | undefined)?.id ?? null;
    const actorEmail = (req.user as { email?: string } | undefined)?.email ?? "";
    const mspId = offerRow.mspId;

    let customCustomerAgreement: string | null = null;
    if (mspId) {
      const [parentMsp] = await db
        .select({ customCustomerAgreement: mspsTable.customCustomerAgreement })
        .from(mspsTable)
        .where(eq(mspsTable.id, mspId))
        .limit(1);
      customCustomerAgreement = parentMsp?.customCustomerAgreement ?? null;
    }

    // Fetch current agreement for legal snapshot logging
    const [platformAgreement] = await db
      .select({
        id: platformAgreementsTable.id,
        version: platformAgreementsTable.version,
        title: platformAgreementsTable.title,
        body: platformAgreementsTable.body,
      })
      .from(platformAgreementsTable)
      .where(eq(platformAgreementsTable.isCurrentVersion, true))
      .limit(1);

    const currentAgreement = customCustomerAgreement
      ? { id: null, version: "custom", title: "Customer Agreement", body: customCustomerAgreement }
      : platformAgreement;

    const legalAgreementText = currentAgreement?.body || "Customer agrees they will be billed directly by their Managed Service Provider (MSP) for this service.";
    const agreementVersionStr = currentAgreement?.version || "1.0";

    // ── Branch 1: price === 0 (free assessment) ───────────────────────────────
    if (amountCents === 0 && allowFreeCheckout) {
      const ip = getClientIp(req);
      const ninety = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const oneDay = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // 1 per email per 90 days
      const [emailCheck] = await db
        .select({ n: count() })
        .from(freeCheckoutAttemptsTable)
        .where(
          and(
            eq(freeCheckoutAttemptsTable.customerEmail, actorEmail.toLowerCase()),
            gte(freeCheckoutAttemptsTable.createdAt, ninety),
          ),
        );

      if ((emailCheck?.n ?? 0) >= 1) {
        apiErr(res, 429, "Free assessment limit reached. Only 1 free assessment per 90 days per account.");
        return;
      }

      // 3 per IP per 24 hours
      if (ip) {
        const [ipCheck] = await db
          .select({ n: count() })
          .from(freeCheckoutAttemptsTable)
          .where(
            and(
              eq(freeCheckoutAttemptsTable.ipAddress, ip),
              gte(freeCheckoutAttemptsTable.createdAt, oneDay),
            ),
          );

        if ((ipCheck?.n ?? 0) >= 3) {
          apiErr(res, 429, "Too many free assessments from this IP address. Please try again tomorrow.");
          return;
        }
      }

      // Record attempt
      await db.insert(freeCheckoutAttemptsTable).values({
        offerId,
        customerEmail: actorEmail.toLowerCase(),
        ipAddress: ip ?? undefined,
        mspId: mspId ?? undefined,
      });

      // Per-MSP daily aggregate soft alert (configurable via MSP_FREE_CHECKOUT_DAILY_ALERT_THRESHOLD)
      if (mspId) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const threshold = parseInt(process.env["MSP_FREE_CHECKOUT_DAILY_ALERT_THRESHOLD"] ?? "10", 10);
        const [mspCount] = await db
          .select({ n: count() })
          .from(freeCheckoutAttemptsTable)
          .where(
            and(
              eq(freeCheckoutAttemptsTable.mspId, mspId),
              gte(freeCheckoutAttemptsTable.createdAt, todayStart),
            ),
          );
        if ((mspCount?.n ?? 0) >= threshold) {
          void emitWorkflowEvent("alert.msp_free_checkout_threshold", {
            mspId,
            dailyCount: mspCount?.n ?? 0,
            threshold,
            date: todayStart.toISOString().slice(0, 10),
          }).catch((err) => {
            log.warn({ err, mspId }, "portal-checkout: failed to emit MSP free-checkout alert");
          });
        }
      }

      // Resolve fulfillment
      if (fulfillmentTypeKey) {
        const idempotencyKey = `portal_free:offer:${offerId}:customer:${customerId}`;
        await resolveFulfillment({
          fulfillmentTypeKey,
          idempotencyKey,
          trigger: "purchase",
          payload: {
            offerId,
            customerId,
            mspId,
            amountCents: 0,
            serviceName,
            customerEmail: actorEmail,
            serviceClass: "free",
            legalAgreementText,
            agreementVersion: agreementVersionStr,
            wholesalePriceCharged: 0,
          },
        });
      } else {
        log.warn({ offerId, serviceName }, "portal-checkout: free checkout — no fulfillmentTypeKey on service; event not emitted");
      }

      log.info({ offerId, customerId, mspId, serviceName }, "portal-checkout: free checkout completed");
      res.json({ outcome: "free_activated", message: "Your service has been activated." });
      return;
    }

    // ── Agreement gate (paid paths only) ─────────────────────────────────────
    // Validate clickwrap acceptance before creating any paid checkout (SOW or Stripe).
    // The frontend must supply agreementVersion + checkboxConfirmed from the clickwrap step.
    const body = req.body as {
      agreementVersion?: string;
      checkboxConfirmed?: boolean;
      acceptedAt?: string;
    };

    if (currentAgreement) {
      if (body.checkboxConfirmed !== true) {
        res.status(422).json({
          code: "agreement_required",
          error: "You must accept the platform agreement before proceeding to checkout.",
          requiredVersion: currentAgreement.version,
          agreementTitle: currentAgreement.title,
        });
        return;
      }
      if (!body.agreementVersion || body.agreementVersion !== currentAgreement.version) {
        log.warn(
          { customerId, offerId, providedVersion: body.agreementVersion ?? null, currentVersion: currentAgreement.version },
          "portal-checkout: agreement version mismatch — blocking checkout",
        );
        res.status(422).json({
          code: "agreement_version_mismatch",
          error: `You must accept the current platform agreement (version ${currentAgreement.version}) before proceeding.`,
          requiredVersion: currentAgreement.version,
        });
        return;
      }
    } else {
      log.warn({ offerId, customerId }, "portal-checkout: no current platform agreement published — proceeding without agreement gate");
    }

    const agreementMeta = currentAgreement
      ? {
          agreement_accepted: "true" as const,
          agreement_version: currentAgreement.version,
          agreement_id: currentAgreement.id ? String(currentAgreement.id) : "",
          agreement_accepted_at: body.acceptedAt ?? new Date().toISOString(),
          agreement_ip: getClientIp(req) ?? "",
          actor_user_id: String(actorId ?? ""),
        }
      : {
          agreement_accepted: "none" as const,
          agreement_version: "",
          agreement_id: "",
          agreement_accepted_at: "",
          agreement_ip: "",
          actor_user_id: String(actorId ?? ""),
        };

    // ── Branch 2: project → SOW pipeline ────────────────────────────────────
    if (serviceClass === "project") {
      // Resolve customer record
      let mspCustomerId: number | null = null;
      if (mspId && customerId) {
        const [customer] = await db
          .select({ id: mspCustomersTable.id })
          .from(mspCustomersTable)
          .where(
            and(
              eq(mspCustomersTable.mspId, mspId),
              or(
                eq(mspCustomersTable.id, customerId),
              ),
            ),
          )
          .limit(1);
        mspCustomerId = customer?.id ?? null;
      }

      // Get optional customer agreement template
      let customerAgreementText: string | null = null;
      if (mspId) {
        const [connConfig] = await db
          .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate })
          .from(mspConnectorConfigsTable)
          .where(eq(mspConnectorConfigsTable.mspId, mspId))
          .limit(1);
        if (connConfig?.customerAgreementTemplate) {
          customerAgreementText = connConfig.customerAgreementTemplate;
        }
      }

      // Generate share token (30-day expiry)
      const shareToken = generateShareToken();
      const shareTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Generate basic SOW document
      const documentHtml = generateSowDocument({
        title: serviceName,
        description: serviceDescription,
        amountCents,
        customerAgreementText,
        mspId: mspId ?? 0,
      });

      const [sow] = await db
        .insert(mspSowsTable)
        .values({
          offerId,
          mspId: mspId ?? 0,
          customerId: mspCustomerId ?? undefined,
          customerUserId: actorId ?? undefined,
          serviceId: offerRow.serviceId ?? undefined,
          title: serviceName,
          description: serviceDescription ?? undefined,
          amountCents,
          documentHtml,
          documentGeneratedAt: new Date(),
          shareToken,
          shareTokenExpiresAt,
          expiresAt,
          status: "sent",
          customerAgreementSnapshotText: customerAgreementText ?? undefined,
        })
        .returning({ sowId: mspSowsTable.sowId });

      if (!sow) {
        apiErr(res, 500, "Failed to create SOW");
        return;
      }

      await emitSowEvent(sow.sowId, "sow.created", actorId, "CustomerUser", {
        offerId, mspId, customerId, amountCents,
      });

      if (mspId) {
        await emitMspEvent(mspId, mspCustomerId, "msp.sow.created", {
          sowId: sow.sowId, offerId, amountCents, initiatedByCustomer: true,
        }, actorId);
      }

      log.info({ sowId: sow.sowId, offerId, customerId }, "portal-checkout: SOW created from customer offer acceptance");

      const baseUrl = process.env["REPLIT_DOMAINS"]
        ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]?.trim()}`
        : "http://localhost:3000";

      res.status(201).json({
        outcome: "sow_created",
        sowId: sow.sowId,
        shareToken,
        shareUrl: `${baseUrl}/portal/customer-sow/${sow.sowId}`,
        message: "Your Statement of Work is ready for review and signature.",
      });
      return;
    }

    // ── Branch 3: add_on / subscription → Stripe Card-on-File billing ────────
    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      log.warn({ offerId }, "portal-checkout: Stripe not configured");
      apiErr(res, 503, "Payment service not configured. Please contact support.");
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    try {
      // 1. Determine target mspId associated with customer or logged-in session
      let targetMspId = offerRow.mspId;
      if (!targetMspId && actorId) {
        const [mspUser] = await db
          .select({ mspId: mspUsersTable.mspId })
          .from(mspUsersTable)
          .where(eq(mspUsersTable.userId, actorId))
          .limit(1);
        if (mspUser?.mspId) {
          targetMspId = mspUser.mspId;
        }
      }
      if (!targetMspId && customerId) {
        const [cust] = await db
          .select({ mspId: mspCustomersTable.mspId })
          .from(mspCustomersTable)
          .where(eq(mspCustomersTable.id, customerId))
          .limit(1);
        if (cust?.mspId) {
          targetMspId = cust.mspId;
        }
      }

      if (!targetMspId) {
        apiErr(res, 400, "Could not determine target MSP ID for billing");
        return;
      }

      // 2. Query target MSP's saved stripeCustomerId and default payment method
      const [subRow] = await db
        .select({ stripeCustomerId: mspSubscriptionsTable.stripeCustomerId })
        .from(mspSubscriptionsTable)
        .where(eq(mspSubscriptionsTable.mspId, targetMspId))
        .limit(1);

      const stripeCustomerId = subRow?.stripeCustomerId;
      if (!stripeCustomerId) {
        apiErr(res, 400, `No saved Stripe Customer ID found for MSP ID: ${targetMspId}`);
        return;
      }

      const defaultPaymentMethod = await getMspDefaultPaymentMethod(stripe, stripeCustomerId);
      if (!defaultPaymentMethod) {
        apiErr(res, 400, `No default payment method found for MSP customer ID: ${stripeCustomerId}`);
        return;
      }

      // 3. Use resolveCatalogPricing to determine wholesaleCostCents
      const pricing = resolveCatalogPricing({
        priceCents: amountCents,
        internalCostCents: offerRow.internalCostCents ?? internalCostCents,
      });
      const wholesaleCostCents = pricing.wholesaleCostCents;
      const retailPriceCents = pricing.retailPriceCents;

      // 4. Enforce Charge Target: Always charge MSP's saved stripeCustomerId for wholesaleCostCents
      let subscriptionId: string | null = null;
      let stripePaymentIntentId: string | null = null;

      if (serviceClass === "subscription") {
        // Create product for subscription first
        const product = await stripe.products.create({
          name: serviceName,
          description: serviceDescription ?? undefined,
        });

        const stripeSub = await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{
            price_data: {
              currency: "usd",
              product: product.id,
              recurring: { interval: "month" },
              unit_amount: wholesaleCostCents,
            }
          }],
          default_payment_method: defaultPaymentMethod,
          ...(trialPeriodDays && trialPeriodDays > 0 ? { trial_period_days: trialPeriodDays } : {}),
        });

        if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
          apiErr(res, 402, `Direct subscription creation failed with status: ${stripeSub.status}`);
          return;
        }

        subscriptionId = stripeSub.id;
      } else {
        const pi = await stripe.paymentIntents.create({
          amount: wholesaleCostCents,
          currency: "usd",
          customer: stripeCustomerId,
          payment_method: defaultPaymentMethod,
          confirm: true,
          off_session: true,
          description: `Wholesale charge: ${serviceName} (MSP: ${targetMspId})`,
          metadata: {
            offerId: String(offerId),
            customerId: String(customerId),
            mspId: String(targetMspId),
            serviceClass,
          },
        });

        if (pi.status !== "succeeded") {
          apiErr(res, 402, `Direct PaymentIntent failed with status: ${pi.status}`);
          return;
        }

        stripePaymentIntentId = pi.id;
      }

      // 5. Mark purchase orders / fulfillment queue entries with wholesaleChargedCents and customerQuoteCents
      // Calling resolveFulfillment directly with the pricing values in the payload
      const idempotencyKey = `portal_offer_checkout:direct:${offerId}:${subscriptionId ?? stripePaymentIntentId}`;
      if (fulfillmentTypeKey) {
        await resolveFulfillment({
          fulfillmentTypeKey,
          idempotencyKey,
          trigger: "purchase",
          payload: {
            offerId,
            customerId,
            mspId: targetMspId,
            stripePaymentIntentId,
            subscriptionId,
            amountCents: retailPriceCents,
            wholesaleChargedCents: wholesaleCostCents,
            customerQuoteCents: retailPriceCents,
            serviceName,
            serviceClass,
            customerEmail: actorEmail,
            legalAgreementText,
            agreementVersion: agreementVersionStr,
            wholesalePriceCharged: wholesaleCostCents,
          },
        });
      }

      log.info(
        { offerId, customerId, targetMspId, serviceClass, wholesaleCostCents },
        "portal-checkout: programmatic Card-on-File billing completed successfully",
      );

      res.json({
        outcome: "payment_processed",
        message: "Your order has been successfully processed and charged to card on file.",
        subscriptionId,
        paymentIntentId: stripePaymentIntentId,
      });
    } catch (err) {
      log.error({ err, offerId, customerId }, "portal-checkout: direct billing failed");
      apiErr(res, 500, `Failed to process card-on-file charge: ${(err as Error).message}`);
    }
  },
);

// ── POST /api/portal/stripe/webhook ──────────────────────────────────────────
//
// Stripe webhook for portal offer checkout sessions.
// Separate from the MSP billing webhook (/api/msp/stripe/webhook) — different
// event set and fulfillment handler.
//
// Signing secret: PORTAL_STRIPE_WEBHOOK_SECRET (falls back to STRIPE_WEBHOOK_SECRET)
// Events handled:
//   checkout.session.completed — payment confirmed → resolve_fulfillment
//   checkout.session.async_payment_succeeded — delayed payment confirmed

router.post("/portal/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const webhookSecret =
    process.env["PORTAL_STRIPE_WEBHOOK_SECRET"] ??
    process.env["STRIPE_WEBHOOK_SECRET"] ??
    "";

  if (!webhookSecret) {
    log.warn({}, "portal-checkout: webhook secret not configured — skipping signature verification");
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    log.warn({ err }, "portal-checkout: Stripe not configured, ignoring webhook event");
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
    log.warn({ err }, "portal-checkout: webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  log.info({ eventType: event.type, eventId: event.id }, "portal-checkout: received Stripe event");

  // Acknowledge immediately — Stripe requires a quick 2xx
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as import("stripe").Stripe.Checkout.Session);
        break;
      default:
        // Unhandled event type — silently ignore
        break;
    }
  } catch (err) {
    log.error({ err, eventType: event.type, eventId: event.id }, "portal-checkout: webhook handler failed");
  }
});

async function handleCheckoutCompleted(
  session: import("stripe").Stripe.Checkout.Session,
): Promise<void> {
  const meta = session.metadata ?? {};

  // Only handle portal offer sessions
  if (meta["fulfillment_type"] !== "portal_offer") return;

  // Skip incomplete payments
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    log.info(
      { sessionId: session.id, paymentStatus: session.payment_status },
      "portal-checkout: checkout completed but payment not confirmed — skipping fulfillment",
    );
    return;
  }

  const offerId = parseInt(meta["offerId"] ?? "", 10);
  const customerId = parseInt(meta["customerId"] ?? "", 10);
  const fulfillmentTypeKey = meta["fulfillmentTypeKey"] ?? "";
  const serviceClass = meta["serviceClass"] ?? "add_on";
  const serviceName = meta["serviceName"] ?? "";
  const mspId = parseInt(meta["mspId"] ?? "", 10) || null;

  if (isNaN(offerId) || isNaN(customerId)) {
    log.warn({ sessionId: session.id, meta }, "portal-checkout: missing required metadata fields — skipping");
    return;
  }

  // ── Agreement acceptance record ─────────────────────────────────────────
  // Insert a clickwrap acceptance row matching the pattern in msp-billing-webhook.ts.
  // ON CONFLICT DO NOTHING makes this safe to replay.
  const agreementAccepted = meta["agreement_accepted"];
  const agreementVersion = meta["agreement_version"] ?? "";
  const agreementId = parseInt(meta["agreement_id"] ?? "", 10) || null;
  const agreementIp = meta["agreement_ip"] ?? null;
  const actorUserId = parseInt(meta["actor_user_id"] ?? "", 10) || null;

  if (agreementAccepted === "true" && agreementVersion && actorUserId) {
    try {
      await db.insert(mspAgreementAcceptancesTable).values({
        mspId: mspId ?? undefined,
        userId: actorUserId,
        agreementVersion,
        agreementId: agreementId ?? undefined,
        ipAddress: agreementIp ?? undefined,
        checkboxConfirmed: true,
      }).onConflictDoNothing();

      log.info(
        { actorUserId, agreementVersion, agreementId, mspId, sessionId: session.id },
        "portal-checkout: customer agreement acceptance recorded",
      );
    } catch (err) {
      log.warn({ err, sessionId: session.id }, "portal-checkout: failed to insert agreement acceptance (non-fatal)");
    }
  }

  const idempotencyKey = `portal_offer_checkout:session:${session.id}`;

  if (!fulfillmentTypeKey) {
    log.warn({ sessionId: session.id, offerId }, "portal-checkout: no fulfillmentTypeKey in metadata — skipping resolveFulfillment");
    return;
  }

  const pricing = resolveCatalogPricing({
    priceCents: session.amount_total ?? 0,
  });
  const wholesaleChargedCents = pricing.wholesaleCostCents;

  let customCustomerAgreement: string | null = null;
  if (mspId) {
    const [parentMsp] = await db
      .select({ customCustomerAgreement: mspsTable.customCustomerAgreement })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);
    customCustomerAgreement = parentMsp?.customCustomerAgreement ?? null;
  }

  const [platformAgreement] = await db
    .select({
      version: platformAgreementsTable.version,
      body: platformAgreementsTable.body,
    })
    .from(platformAgreementsTable)
    .where(eq(platformAgreementsTable.isCurrentVersion, true))
    .limit(1);

  const legalAgreementText = customCustomerAgreement || platformAgreement?.body || "Customer agrees they will be billed directly by their Managed Service Provider (MSP) for this service.";
  const agreementVersionToPass = customCustomerAgreement ? "custom" : (platformAgreement?.version ?? "1.0");

  const result = await resolveFulfillment({
    fulfillmentTypeKey,
    idempotencyKey,
    trigger: "purchase",
    payload: {
      offerId,
      customerId,
      mspId,
      stripeSessionId: session.id,
      amountCents: session.amount_total ?? 0,
      wholesaleChargedCents,
      customerQuoteCents: session.amount_total ?? 0,
      serviceName,
      serviceClass,
      customerEmail: session.customer_email ?? session.customer_details?.email ?? "",
      subscriptionId: (session as { subscription?: string | null }).subscription ?? null,
      legalAgreementText,
      agreementVersion: agreementVersionToPass,
    },
  });

  log.info(
    { result, offerId, customerId, sessionId: session.id },
    "portal-checkout: resolveFulfillment completed after Stripe checkout",
  );
}

export default router;
