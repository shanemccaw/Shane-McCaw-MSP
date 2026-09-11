/**
 * msp-marketplace-purchase.ts
 *
 * MSP-initiated marketplace purchase — closes the gap flagged in
 * portal-marketplace.ts / marketplace.tsx: the real Marketplace catalog is
 * floored at requireCapability("ladder.free"), so only the customer themselves can
 * browse/buy. MSP staff had no path to purchase or assign a catalog item on a
 * specific customer's behalf.
 *
 * Reuses, does not fork:
 *   - Catalog data: CUSTOMER_SERVICE_TYPES + toMarketplaceService from
 *     portal-marketplace.ts (same customer-safe shape, same visibility="public"
 *     convention). MSP staff always sees the fuller catalog (not narrowed by
 *     the target customer's own role tier) since staff act on the customer's
 *     behalf, not as the customer.
 *   - Checkout mechanics: the same Stripe Card-on-File wholesale-charge path
 *     proven in portal-checkout.ts (branch 3: add_on/subscription →
 *     resolveCatalogPricing → charge the MSP's saved stripeCustomerId →
 *     resolveFulfillment). The free ($0) path reuses resolveFulfillment
 *     directly, without portal-checkout's public-abuse rate limiting (this is
 *     an authenticated staff action, not an anonymous/public one).
 *   - Staff scoping: assertCustomerAccess (requireAuth.ts) — the same
 *     chokepoint every other single-customer MSP route uses. A scoped staff
 *     member cannot purchase for a customer outside their assigned set.
 *
 * Not built (explicit boundary, not a silent gap): serviceClass "project"
 * items go through a signature-gated SOW pipeline in portal-checkout.ts that
 * is bound to the *customer's own* acceptance flow — an MSP staffer cannot
 * sign on the customer's behalf, so those catalog items are rejected here
 * with a clear 422 rather than fabricating a skip-the-signature purchase.
 *
 * The purchase is recorded as a real sales_offers row (state "accepted",
 * engineSnapshot.initiatedBy = "msp_staff") so it shows up through the exact
 * same customer-facing surfaces (GET /api/portal/offers, /customer-offers)
 * a customer's own self-serve purchase would — no parallel "MSP order" table.
 *
 * Routes:
 *   GET  /api/msp/customers/:customerId/marketplace/catalog
 *   POST /api/msp/customers/:customerId/marketplace/checkout
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  salesOffersTable,
  tenantsTable,
  mspSubscriptionsTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth";
import { getStripeKey, getMspDefaultPaymentMethod } from "../lib/stripe";
import { resolveFulfillment } from "../lib/resolve-fulfillment";
import { resolveCatalogPricing } from "../lib/catalog-pricing";
import { recordTenantSubscription } from "../lib/tenant-billing-state";
import { createAuditLog } from "../lib/audit";
import { broadcastCustomerOfferChange, broadcastMspOfferChange } from "../lib/sse-channels";
import { logger } from "../lib/logger";
import { CUSTOMER_SERVICE_TYPES, toMarketplaceService, type MarketplaceService } from "./portal-marketplace";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function apiErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/** Resolve the target customer + its owning mspId, gated by staff scoping. Returns null (404 already sent) on failure. */
async function resolveScopedCustomer(
  req: Request,
  res: Response,
  customerId: number,
): Promise<{ id: number; mspId: number } | null> {
  const [customer] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  if (!customer) {
    apiErr(res, 404, "Customer not found");
    return null;
  }

  if (!(await assertCustomerAccess(req.user!, customerId))) {
    apiErr(res, 404, "Customer not found");
    return null;
  }

  return customer;
}

// ── GET /api/msp/customers/:customerId/marketplace/catalog ───────────────────
// Same customer-safe catalog shape as portal-marketplace.ts, always the fuller
// (Customer+) allow-set — staff act on the customer's behalf, not scoped
// down to whatever role tier that customer happens to be.

router.get(
  "/msp/customers/:customerId/marketplace/catalog",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const customerId = parseInt(req.params["customerId"] as string, 10);
      if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }

      const customer = await resolveScopedCustomer(req, res, customerId);
      if (!customer) return;

      const rows = await db
        .select()
        .from(servicesTable)
        .where(
          and(
            eq(servicesTable.visibility, "public"),
            inArray(servicesTable.serviceType, [...CUSTOMER_SERVICE_TYPES]),
          ),
        )
        .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.name));

      const services: MarketplaceService[] = rows.map(toMarketplaceService);
      res.json({ services });
    } catch (err) {
      log.error({ err }, "GET /msp/customers/:customerId/marketplace/catalog failed");
      apiErr(res, 500, "Failed to load catalog");
    }
  },
);

// ── POST /api/msp/customers/:customerId/marketplace/checkout ─────────────────
// MSP-staff-initiated purchase of a catalog item on a specific customer's
// behalf. Body: { serviceId: number }.

router.post(
  "/msp/customers/:customerId/marketplace/checkout",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = parseInt(req.params["customerId"] as string, 10);
    if (isNaN(customerId)) { apiErr(res, 400, "Invalid customerId"); return; }

    const serviceId = parseInt(String((req.body as { serviceId?: unknown })?.serviceId ?? ""), 10);
    if (isNaN(serviceId)) { apiErr(res, 400, "serviceId is required"); return; }

    const customer = await resolveScopedCustomer(req, res, customerId);
    if (!customer) return;
    const targetMspId = customer.mspId;

    const [svc] = await db
      .select()
      .from(servicesTable)
      .where(
        and(
          eq(servicesTable.id, serviceId),
          eq(servicesTable.visibility, "public"),
          inArray(servicesTable.serviceType, [...CUSTOMER_SERVICE_TYPES]),
        ),
      )
      .limit(1);

    if (!svc) { apiErr(res, 404, "Catalog service not found"); return; }

    const serviceClass = svc.serviceClass ?? "add_on";
    if (serviceClass === "project") {
      apiErr(
        res,
        422,
        "This item requires a signed Statement of Work from the customer and can't be purchased on their behalf. Ask the customer to complete this from their own portal.",
      );
      return;
    }

    const marketplaceShape = toMarketplaceService(svc);
    if (marketplaceShape.priceCents === null) {
      apiErr(res, 422, "This item is priced on consultation and has no fixed checkout price.");
      return;
    }
    // Per-seat-priced items (monitoring tiers): marketplaceShape.priceCents is
    // the per-user/month RATE, not a chargeable total — this seat-less checkout
    // would charge e.g. $8.00/mo for an entire 2000-seat monitoring subscription.
    // Reject rather than silently undercharge; these products must be purchased
    // through the seat-aware monitoring checkout flow.
    if (marketplaceShape.perSeat) {
      apiErr(
        res,
        422,
        "This item is priced per licensed user and requires a seat count. Purchase it through the monitoring checkout flow instead.",
      );
      return;
    }
    const amountCents = marketplaceShape.priceCents;

    const actorId = (req.user as { id?: number } | undefined)?.id ?? null;
    const actorEmail = (req.user as { email?: string } | undefined)?.email ?? "";

    // ── Record the purchase as a real sales offer ────────────────────────────
    // Mirrors the shape a customer's own accepted offer would have, so the
    // customer sees this reflected via the exact same GET /api/portal/offers /
    // /customer-offers surfaces their own purchases use — no parallel table.
    //
    // #3400 — this insert (and the SSE broadcast that follows it) used to happen
    // unconditionally, before the paid path below ever touched Stripe. Every
    // failure exit in that path (Stripe not configured, no saved card, no
    // default payment method, a non-active/trialing subscription, a
    // non-succeeded PaymentIntent, any thrown exception) left this row
    // permanently "accepted" — a terminal state per VALID_TRANSITIONS in
    // sales-offer-engine.ts — with zero money collected and zero audit trail.
    // The free path can't hit that failure class (no Stripe call at all), so it
    // still records immediately below; the paid path now only records after
    // Stripe has actually confirmed the charge.
    async function recordAcceptedOffer(): Promise<number | null> {
      const now = new Date();
      const [offer] = await db
        .insert(salesOffersTable)
        .values({
          customerId,
          serviceId: svc.id,
          mspId: targetMspId,
          title: svc.name,
          rationale: "Purchased on your behalf by your MSP.",
          basePriceCents: amountCents,
          adjustedPriceCents: amountCents,
          priceCents: amountCents,
          internalCostCents: svc.internalCostCents,
          trialPeriodDays: svc.trialPeriodDays,
          state: "accepted",
          sentAt: now,
          acceptedAt: now,
          engineSnapshot: {
            initiatedBy: "msp_staff",
            staffUserId: actorId,
            staffEmail: actorEmail,
          },
        })
        .returning({ id: salesOffersTable.id });

      if (!offer) return null;
      broadcastCustomerOfferChange(customerId, { offerId: offer.id, state: "accepted" });
      broadcastMspOfferChange(targetMspId, { offerId: offer.id, state: "accepted", tenantId: customerId });
      return offer.id;
    }

    // ── Free ($0) path — skip Stripe entirely ─────────────────────────────────
    if (amountCents === 0) {
      const offerId = await recordAcceptedOffer();
      if (offerId === null) {
        apiErr(res, 500, "Failed to record purchase");
        return;
      }

      if (svc.fulfillmentTypeKey) {
        await resolveFulfillment({
          fulfillmentTypeKey: svc.fulfillmentTypeKey,
          idempotencyKey: `msp_staff_purchase:offer:${offerId}:free`,
          trigger: "purchase",
          payload: {
            offerId, customerId, mspId: targetMspId,
            serviceId: svc.id,
            amountCents: 0, serviceName: svc.name, serviceClass,
            initiatedBy: "msp_staff", staffUserId: actorId, staffEmail: actorEmail,
          },
        });
      }

      await createAuditLog({
        actorUserId: actorId,
        actorName: actorEmail || "MSP staff",
        actorRole: "admin",
        actionType: "msp.marketplace.purchase_for_customer",
        entityType: "sales_offer",
        entityId: offerId,
        entityLabel: svc.name,
        clientId: customerId,
        metadata: { serviceId: svc.id, mspId: targetMspId, amountCents: 0 },
      });

      log.info({ offerId, customerId, targetMspId, serviceId: svc.id }, "msp-marketplace-purchase: free item activated");
      res.status(201).json({ outcome: "free_activated", offerId, message: `${svc.name} has been activated for this customer.` });
      return;
    }

    // ── Paid path — Stripe Card-on-File billing, MSP's saved card ─────────────
    // Nothing is written to sales_offers until the charge below actually
    // succeeds (see #3400 note above).
    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      log.warn({ customerId, serviceId: svc.id }, "msp-marketplace-purchase: Stripe not configured");
      apiErr(res, 503, "Payment service not configured. Please contact support.");
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    try {
      const [subRow] = await db
        .select({ stripeCustomerId: mspSubscriptionsTable.stripeCustomerId })
        .from(mspSubscriptionsTable)
        .where(eq(mspSubscriptionsTable.mspId, targetMspId))
        .limit(1);

      const stripeCustomerId = subRow?.stripeCustomerId;
      if (!stripeCustomerId) {
        apiErr(res, 400, "No saved Stripe Customer ID found for this MSP");
        return;
      }

      const defaultPaymentMethod = await getMspDefaultPaymentMethod(stripe, stripeCustomerId);
      if (!defaultPaymentMethod) {
        apiErr(res, 400, "No default payment method found on file for this MSP");
        return;
      }

      const pricing = resolveCatalogPricing({ priceCents: amountCents, internalCostCents: svc.internalCostCents });
      const wholesaleCostCents = pricing.wholesaleCostCents;
      const retailPriceCents = pricing.retailPriceCents;

      let subscriptionId: string | null = null;
      let stripePaymentIntentId: string | null = null;
      let stripeSubStatus: "active" | "trialing" | null = null;
      let stripeSubPeriod: { start: Date | null; end: Date | null; cancelAtPeriodEnd: boolean } | null = null;
      let stripeSubPriceId: string | null = null;

      if (serviceClass === "subscription") {
        const product = await stripe.products.create({
          name: svc.name,
          description: svc.description ?? undefined,
        });

        const stripeSub = await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{
            price_data: {
              currency: "usd",
              product: product.id,
              recurring: { interval: "month" },
              unit_amount: wholesaleCostCents,
            },
          }],
          default_payment_method: defaultPaymentMethod,
          ...(svc.trialPeriodDays && svc.trialPeriodDays > 0 ? { trial_period_days: svc.trialPeriodDays } : {}),
        });

        if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
          apiErr(res, 402, `Subscription creation failed with status: ${stripeSub.status}`);
          return;
        }
        subscriptionId = stripeSub.id;
        stripeSubStatus = stripeSub.status;
        stripeSubPriceId = stripeSub.items.data[0]?.price?.id ?? null;

        const rawStripeSub = stripeSub as unknown as {
          current_period_start?: number;
          current_period_end?: number;
        };
        stripeSubPeriod = {
          start: rawStripeSub.current_period_start ? new Date(rawStripeSub.current_period_start * 1000) : null,
          end: rawStripeSub.current_period_end ? new Date(rawStripeSub.current_period_end * 1000) : null,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        };
      } else {
        const pi = await stripe.paymentIntents.create({
          amount: wholesaleCostCents,
          currency: "usd",
          customer: stripeCustomerId,
          payment_method: defaultPaymentMethod,
          confirm: true,
          off_session: true,
          description: `Wholesale charge: ${svc.name} (MSP: ${targetMspId}, staff-initiated for customer ${customerId})`,
          metadata: {
            customerId: String(customerId),
            mspId: String(targetMspId),
            serviceId: String(svc.id),
            serviceClass,
            initiatedBy: "msp_staff",
          },
        });

        if (pi.status !== "succeeded") {
          apiErr(res, 402, `Payment failed with status: ${pi.status}`);
          return;
        }
        stripePaymentIntentId = pi.id;
      }

      // ── Charge confirmed successful — only now record the sales offer ──────
      const offerId = await recordAcceptedOffer();
      if (offerId === null) {
        // Real money has already moved; telling the client the purchase
        // "failed" here would invite a retry and a double charge. Log loud
        // enough to reconcile by hand instead.
        log.error(
          { customerId, targetMspId, serviceId: svc.id, subscriptionId, stripePaymentIntentId },
          "msp-marketplace-purchase: CRITICAL — Stripe charge succeeded but sales_offers insert failed; needs manual reconciliation",
        );
        res.status(201).json({
          outcome: "payment_processed",
          offerId: null,
          message: `${svc.name} has been purchased and charged to the MSP's card on file. (There was an issue recording this purchase — contact support to confirm it shows up.)`,
          subscriptionId,
          paymentIntentId: stripePaymentIntentId,
        });
        return;
      }

      if (serviceClass === "subscription" && subscriptionId && stripeSubStatus && stripeSubPeriod) {
        // #2847 — RECORD IT. Until this landed, the Stripe Subscription created
        // above was returned to the caller, copied into an audit-log metadata
        // blob, and persisted in no table at all. The platform therefore had no
        // per-customer answer to "is this customer paying", which is precisely the fact
        // #1944 part 8 gates the entire customer portal on and #2765's retention clock
        // freezes on. `billingParty: "msp"` is not a guess — the subscription is created
        // against the MSP's own `stripeCustomerId` at the wholesale price, and the MSP
        // bills the customer retail outside this platform.
        //
        // Non-fatal on failure: the money has already moved and the fulfillment is about
        // to run, so throwing here would fail a request that actually succeeded. The
        // consequence of a miss is a customer whose portal stays open on the
        // `tenants.status` fallback — the pre-#2847 behaviour — not a wrong charge.
        try {
          await recordTenantSubscription({
            tenantId: customerId,
            mspId: targetMspId,
            billingParty: "msp",
            source: "msp_marketplace",
            status: stripeSubStatus === "trialing" ? "trialing" : "active",
            serviceId: svc.id,
            planName: svc.name,
            stripeCustomerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: stripeSubPriceId,
            billingInterval: "month",
            unitAmountCents: wholesaleCostCents,
            currentPeriodStart: stripeSubPeriod.start,
            currentPeriodEnd: stripeSubPeriod.end,
            cancelAtPeriodEnd: stripeSubPeriod.cancelAtPeriodEnd,
          });
        } catch (err) {
          log.error(
            { err, customerId, targetMspId, subscriptionId },
            "msp-marketplace-purchase: failed to record tenant_subscriptions row (charge succeeded; billing state not updated)",
          );
        }
      }

      if (svc.fulfillmentTypeKey) {
        await resolveFulfillment({
          fulfillmentTypeKey: svc.fulfillmentTypeKey,
          idempotencyKey: `msp_staff_purchase:offer:${offerId}:${subscriptionId ?? stripePaymentIntentId}`,
          trigger: "purchase",
          payload: {
            offerId, customerId, mspId: targetMspId,
            serviceId: svc.id,
            stripePaymentIntentId, subscriptionId,
            amountCents: retailPriceCents,
            wholesaleChargedCents: wholesaleCostCents,
            customerQuoteCents: retailPriceCents,
            serviceName: svc.name, serviceClass,
            initiatedBy: "msp_staff", staffUserId: actorId, staffEmail: actorEmail,
          },
        });
      }

      await createAuditLog({
        actorUserId: actorId,
        actorName: actorEmail || "MSP staff",
        actorRole: "admin",
        actionType: "msp.marketplace.purchase_for_customer",
        entityType: "sales_offer",
        entityId: offerId,
        entityLabel: svc.name,
        clientId: customerId,
        metadata: { serviceId: svc.id, mspId: targetMspId, wholesaleCostCents, retailPriceCents, subscriptionId, stripePaymentIntentId },
      });

      log.info(
        { offerId, customerId, targetMspId, serviceId: svc.id, serviceClass, wholesaleCostCents },
        "msp-marketplace-purchase: Card-on-File billing completed",
      );

      res.status(201).json({
        outcome: "payment_processed",
        offerId,
        message: `${svc.name} has been purchased and charged to the MSP's card on file.`,
        subscriptionId,
        paymentIntentId: stripePaymentIntentId,
      });
    } catch (err) {
      log.error({ err, customerId, serviceId: svc.id }, "msp-marketplace-purchase: billing failed");
      apiErr(res, 500, `Failed to process card-on-file charge: ${(err as Error).message}`);
    }
  },
);

export default router;
