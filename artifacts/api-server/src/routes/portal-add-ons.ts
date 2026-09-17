/**
 * portal-add-ons.ts — a signed-in customer buys a tenant add-on (Git #4462,
 * Feature #1486).
 *
 * `requireAddOnEntitlement` gates Change Control's reads on an active
 * `tenant_add_on_entitlements` row, the four `change-control-*` services rows are
 * priced and public, and yet nothing sold them and nothing wrote the row on
 * payment. A Premier tenant now passes every add-on gate by tier (#4463); this is
 * the path for everyone else — Foundation, Growth, or no tier yet.
 *
 *   GET  /api/portal/add-ons                     what the caller's tenant holds, and the real offers
 *   POST /api/portal/add-ons/checkout-session    start a Stripe Checkout for one add-on row
 *   POST /api/portal/add-ons/checkout-confirmed  server-verified success callback → provision
 *
 * ── Why a signed-in route and not Buy.tsx ────────────────────────────────────
 * An add-on is bought for a tenant that already exists. The public purchase
 * flow creates accounts, and `POST /public/checkout-session` refuses an email
 * that already has one (`already_has_account`), so it cannot sell to the very
 * customer who needs this. The tenant here is the caller's own JWT `customerId`
 * — never a request field — so a purchase can only ever entitle the buyer's own
 * organisation.
 *
 * ── Provisioning, the #4403 way ──────────────────────────────────────────────
 * Same shape as the Monitoring/Retainer provisioning on payment-confirmed: the
 * client's word is not evidence, so the confirm callback re-reads the Checkout
 * Session from Stripe and requires it paid AND carrying this flow's
 * server-written metadata for the caller's own tenant, then calls one idempotent
 * writer (`ensureAddOnEntitlement`). The signed `checkout.session.completed`
 * webhook (portal-checkout.ts) dispatches the same session to the same
 * `provisionPortalAddOnPurchase`, so a buyer who never returns from Stripe is
 * still entitled, and the two arriving together write one row.
 *
 * Nothing is priced from the client: the charge is the services row's own
 * price, the feature key is that row's own `type_attributes.featureKey`. The
 * caller chooses WHICH public add-on row (for Change Control, which seat
 * bracket) — the same buyer-declared bracket the Monitoring purchase takes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, usersTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type Stripe from "stripe";

import { requireAuth, requireCapability } from "../middlewares/requireAuth.ts";
import { requireCustomerCapability } from "../middlewares/rbac-capability.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { ALL_ADD_ONS_TIER, resolveAddOnEntitlement } from "../lib/portal-addon-entitlements.ts";
import { resolveCustomerTierEntitlement } from "../lib/portal-tier-features.ts";
import {
  addOnFeatureKey,
  ensureAddOnEntitlement,
  type AddOnEntitlementResult,
} from "../lib/addon-entitlement-provisioning.ts";
import { isServiceFree, resolveServicePriceCents } from "../lib/catalog-pricing.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { getMspPortalBaseUrl } from "../lib/portal-url.ts";
import { PORTAL_ADD_ON_CHECKOUT_KIND } from "../lib/addon-checkout-kind.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

const addOnServiceColumns = {
  id: servicesTable.id,
  slug: servicesTable.slug,
  name: servicesTable.name,
  serviceClass: servicesTable.serviceClass,
  billingType: servicesTable.billingType,
  visibility: servicesTable.visibility,
  priceCents: servicesTable.priceCents,
  price: servicesTable.price,
  basePrice: servicesTable.basePrice,
  isFreeOffering: servicesTable.isFreeOffering,
  typeAttributes: servicesTable.typeAttributes,
  sortOrder: servicesTable.sortOrder,
};

type AddOnServiceRow = {
  id: number;
  slug: string | null;
  name: string;
  serviceClass: string | null;
  billingType: string;
  visibility: string;
  priceCents: number | null;
  price: string | null;
  basePrice: string | null;
  isFreeOffering: boolean;
  typeAttributes: unknown;
  sortOrder: number;
};

/** A public, positively priced add-on row carrying a feature key — the only thing this route sells. */
function sellableFeatureKey(row: AddOnServiceRow): string | null {
  if (row.serviceClass !== "add_on" || row.visibility !== "public") return null;
  if (isServiceFree(row) || resolveServicePriceCents(row) <= 0) return null;
  return addOnFeatureKey(row.typeAttributes);
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── GET /api/portal/add-ons ───────────────────────────────────────────────────

router.get("/portal/add-ons", requireCapability("ladder.customer-user"), async (req: Request, res: Response): Promise<void> => {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    res.status(403).json({ error: "No customer identity on token" });
    return;
  }

  try {
    const rows = await db
      .select(addOnServiceColumns)
      .from(servicesTable)
      .where(and(eq(servicesTable.serviceClass, "add_on"), eq(servicesTable.visibility, "public")))
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.id));

    const offersByKey = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const featureKey = sellableFeatureKey(row);
      if (!featureKey) continue;
      const attrs = (row.typeAttributes ?? {}) as Record<string, unknown>;
      const offers = offersByKey.get(featureKey) ?? [];
      offers.push({
        serviceId: row.id,
        slug: row.slug,
        name: row.name,
        priceCents: resolveServicePriceCents(row),
        billingType: row.billingType,
        bracketLabel: typeof attrs.bracketLabel === "string" ? attrs.bracketLabel : null,
        seatMin: numberOrNull(attrs.seatMin),
        seatMax: numberOrNull(attrs.seatMax),
      });
      offersByKey.set(featureKey, offers);
    }

    const { currentTier } = await resolveCustomerTierEntitlement(customerId);
    const addOns = [];
    for (const [featureKey, offers] of offersByKey) {
      const resolution = await resolveAddOnEntitlement(customerId, featureKey);
      addOns.push({ featureKey, entitled: resolution.entitled, source: resolution.source, offers });
    }

    res.json({ currentTier, includesAllAddOns: currentTier === ALL_ADD_ONS_TIER, addOns });
  } catch (err) {
    log.error({ err, customerId }, "portal add-ons: read failed");
    res.status(500).json({ error: "Failed to load add-ons" });
  }
});

// ── POST /api/portal/add-ons/checkout-session ─────────────────────────────────

const checkoutSessionSchema = z.object({
  serviceSlug: z.string().trim().min(1).max(120),
  // Portal path to land back on, e.g. "/change-control". A path only — never a
  // URL — so a return can't be pointed off the portal.
  returnPath: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(200).optional(),
});

router.post(
  "/portal/add-ons/checkout-session",
  requireAuth,
  requireCustomerCapability("billing.manage"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    const parsed = checkoutSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "serviceSlug is required" });
      return;
    }
    const returnPath = parsed.data.returnPath ?? "/billing";

    const [service] = await db
      .select(addOnServiceColumns)
      .from(servicesTable)
      .where(eq(servicesTable.slug, parsed.data.serviceSlug))
      .limit(1);
    const featureKey = service ? sellableFeatureKey(service) : null;
    if (!service || !featureKey) {
      res.status(404).json({ error: "add_on_not_found" });
      return;
    }

    // Never sell what the tenant already has — including by tier: a Premier
    // tenant paying for an add-on its tier already includes is a charge for nothing.
    const resolution = await resolveAddOnEntitlement(customerId, featureKey);
    if (resolution.entitled) {
      res.status(409).json({ error: "already_entitled", featureKey, source: resolution.source, currentTier: resolution.currentTier });
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      log.warn({}, "portal add-ons: Stripe not configured");
      res.status(503).json({ error: "payment_unavailable" });
      return;
    }

    const [buyer] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id))
      .limit(1);

    const amountCents = resolveServicePriceCents(service);
    const mode: "subscription" | "payment" = service.billingType === "recurring_monthly" ? "subscription" : "payment";
    const metadata: Record<string, string> = {
      checkout_kind: PORTAL_ADD_ON_CHECKOUT_KIND,
      tenantId: String(customerId),
      serviceId: String(service.id),
      featureKey,
      buyerUserId: String(req.user!.id),
      amountCents: String(amountCents),
    };
    const portalBase = getMspPortalBaseUrl();

    try {
      const { default: StripeCtor } = await import("stripe");
      const stripe = new StripeCtor(stripeKey);
      const session = await stripe.checkout.sessions.create({
        mode,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: { name: service.name },
              ...(mode === "subscription" ? { recurring: { interval: "month" as const } } : {}),
            },
          },
        ],
        success_url: `${portalBase}${returnPath}?addOnCheckout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${portalBase}${returnPath}?addOnCheckout=cancelled`,
        ...(buyer?.email ? { customer_email: buyer.email } : {}),
        metadata,
        ...(mode === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      });

      log.info(
        { stripeCheckoutSessionId: session.id, customerId, serviceId: service.id, featureKey, amountCents, mode },
        "portal add-ons: Stripe Checkout Session created",
      );
      res.json({ url: session.url, stripeSessionId: session.id, amountCents, featureKey });
    } catch (err) {
      log.error({ err, customerId, serviceId: service.id }, "portal add-ons: Stripe Checkout Session creation failed");
      res.status(500).json({ error: "checkout_session_failed" });
    }
  },
);

// ── Provisioning (confirm callback + webhook) ─────────────────────────────────

export type PortalAddOnProvisionOutcome =
  | { outcome: "entitlement"; result: AddOnEntitlementResult }
  | { outcome: "not_add_on_checkout" | "payment_not_complete" | "metadata_invalid" };

/**
 * Provision the entitlement a paid add-on Checkout Session bought. Shared by
 * `/checkout-confirmed` and portal-checkout.ts's signed webhook; idempotent
 * through `ensureAddOnEntitlement`, so either may run first, twice, or both.
 * Trusts only the session's own server-written metadata.
 */
export async function provisionPortalAddOnPurchase(session: Stripe.Checkout.Session): Promise<PortalAddOnProvisionOutcome> {
  const meta = session.metadata ?? {};
  if (meta["checkout_kind"] !== PORTAL_ADD_ON_CHECKOUT_KIND) return { outcome: "not_add_on_checkout" };

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    log.info(
      { stripeCheckoutSessionId: session.id, paymentStatus: session.payment_status },
      "portal add-ons: checkout not paid — nothing provisioned",
    );
    return { outcome: "payment_not_complete" };
  }

  const tenantId = parseInt(meta["tenantId"] ?? "", 10);
  const serviceId = parseInt(meta["serviceId"] ?? "", 10);
  if (isNaN(tenantId) || isNaN(serviceId)) {
    log.error({ stripeCheckoutSessionId: session.id, meta }, "portal add-ons: paid session missing tenantId/serviceId — cannot provision");
    return { outcome: "metadata_invalid" };
  }

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
  const result = await ensureAddOnEntitlement({
    tenantId,
    serviceId,
    stripeCheckoutSessionId: session.id,
    stripeSubscriptionId: subscriptionId,
  });

  if (result.provisioned) {
    const buyerUserId = parseInt(meta["buyerUserId"] ?? "", 10);
    await createAuditLog({
      actorUserId: isNaN(buyerUserId) ? null : buyerUserId,
      actorName: "portal:add-on-checkout",
      actorRole: "client",
      actionType: "portal_add_on_purchased",
      entityType: "tenant_add_on_entitlement",
      entityId: result.entitlementId,
      tenantId,
      metadata: {
        featureKey: result.featureKey,
        serviceId,
        reason: result.reason,
        stripeCheckoutSessionId: session.id,
        stripeSubscriptionId: subscriptionId,
        amountCents: session.amount_total ?? null,
      },
    });
  } else if (result.reason !== "already_active") {
    log.error(
      { stripeCheckoutSessionId: session.id, tenantId, serviceId, reason: result.reason },
      "portal add-ons: paid session names a service that is not a provisionable add-on",
    );
  }
  return { outcome: "entitlement", result };
}

// ── POST /api/portal/add-ons/checkout-confirmed ───────────────────────────────

const checkoutConfirmedSchema = z.object({
  stripeSessionId: z.string().trim().regex(/^cs_[A-Za-z0-9_]+$/),
});

router.post(
  "/portal/add-ons/checkout-confirmed",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    const parsed = checkoutConfirmedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "stripeSessionId is required" });
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
      const { default: StripeCtor } = await import("stripe");
      const stripe = new StripeCtor(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(parsed.data.stripeSessionId);
      const meta = session.metadata ?? {};

      // Only this flow's sessions, and only for the caller's own tenant: a session
      // id is not a secret, so another tenant's paid session must not be replayable here.
      if (meta["checkout_kind"] !== PORTAL_ADD_ON_CHECKOUT_KIND || meta["tenantId"] !== String(customerId)) {
        log.warn(
          { stripeCheckoutSessionId: session.id, customerId, metaKind: meta["checkout_kind"], metaTenantId: meta["tenantId"] },
          "portal add-ons: REFUSED — checkout session is not this tenant's add-on purchase",
        );
        res.status(403).json({ error: "session_not_yours" });
        return;
      }

      const provisioned = await provisionPortalAddOnPurchase(session);
      if (provisioned.outcome === "payment_not_complete") {
        res.status(409).json({ error: "payment_not_complete", paymentStatus: session.payment_status });
        return;
      }
      if (provisioned.outcome !== "entitlement" || !("featureKey" in provisioned.result)) {
        res.status(422).json({ error: "not_provisionable" });
        return;
      }
      res.json({ ok: true, featureKey: provisioned.result.featureKey, reason: provisioned.result.reason });
    } catch (err) {
      log.error({ err, customerId, stripeSessionId: parsed.data.stripeSessionId }, "portal add-ons: confirm failed");
      res.status(500).json({ error: "confirm_failed" });
    }
  },
);

export default router;
