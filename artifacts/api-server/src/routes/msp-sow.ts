/**
 * MSP SOW Routes
 *
 * Manages project Statements of Work generated from accepted sales offers.
 * Only services with serviceClass = "project" produce a SOW. add_on and
 * subscription purchases go through a simpler direct-checkout path.
 *
 * Billing model: platform bills the MSP (not the end-customer).
 * Charge flows: SOW signed → charge MSP's Stripe card on file → fulfillment unlocked.
 *
 * Routes:
 *   POST   /api/msp/sows                        — create SOW from accepted offer
 *   GET    /api/msp/sows                        — list SOWs for an MSP/customer
 *   GET    /api/msp/sows/:sowId                 — get SOW detail (MSP-authenticated)
 *   POST   /api/msp/sows/:sowId/sign            — customer signs the SOW
 *   POST   /api/msp/sows/:sowId/charge          — trigger MSP card charge post-signature
 *   POST   /api/msp/sows/:sowId/expire          — manually expire a SOW (operator)
 *   GET    /api/msp/sows/:sowId/document        — get SOW HTML document (authenticated)
 *   GET    /api/public/sows/:shareToken         — public SOW viewer (unauthenticated, read-only)
 *   POST   /api/public/sows/:shareToken/sign    — public sign (customer signs via share link)
 *
 *   POST   /api/msp/offers/:offerId/accept      — accept offer → branch by serviceClass
 *   POST   /api/msp/checkout/add-on             — direct Stripe checkout (add_on / subscription)
 *
 *   GET    /api/msp/customers/:customerId/clickwrap  — get MSP customer-agreement status
 *   POST   /api/msp/customers/:customerId/clickwrap  — record clickwrap acceptance
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import {
  db,
  mspSowsTable,
  mspSowEventsTable,
  mspChargesTable,
  mspCustomerClickwrapsTable,
  mspSubscriptionsTable,
  mspConnectorConfigsTable,
  mspsTable,
  mspCustomersTable,
  salesOffersTable,
  servicesTable,
  mspEventStoreTable,
} from "@workspace/db";
import { eq, and, desc, count, or } from "drizzle-orm";
import { requireRole, requireAuth } from "../middlewares/requireAuth.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";
import { checkMspMinTierSatisfied } from "../lib/msp-entitlement.ts";
import { detectProductType } from "../lib/productTypeConfig.ts";
import { z } from "zod";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiErr(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function getMspIdFromRequest(req: Request): number | null {
  const user = req.user!;
  if (user.role === "admin" || user.mspRole === "PlatformAdmin") {
    const q = parseInt(p(req.query["mspId"] as string | undefined), 10);
    return isNaN(q) ? null : q;
  }
  return user.mspId ?? null;
}

/** Generate a secure random share token */
function generateShareToken(): string {
  return randomBytes(24).toString("hex");
}

/** Emit a SOW lifecycle event */
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
    logger.warn({ err, sowId, eventName }, "msp-sow: failed to emit SOW event (non-fatal)");
  }
}

/** Emit an MSP event store entry */
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
      source: "msp-sow",
      actor: { id: String(actorUserId ?? "system"), role: actorUserId ? ("MSPAdmin" as const) : ("system" as const), type: actorUserId ? ("user" as const) : ("system" as const) },
      meta: { tenant: { mspId, customerId } },
      payload,
      mspId,
      ownerType: customerId ? "customer" : "msp",
    });
  } catch (err) {
    logger.warn({ err, eventType }, "msp-sow: failed to emit MSP event (non-fatal)");
  }
}

/** Resolve the MSP's saved Stripe customer ID for charging */
async function getMspStripeCustomerId(mspId: number): Promise<string | null> {
  const [sub] = await db
    .select({ stripeCustomerId: mspSubscriptionsTable.stripeCustomerId })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);
  return sub?.stripeCustomerId ?? null;
}

// ── POST /api/msp/offers/:offerId/accept ──────────────────────────────────────
// Accept a sales offer. Branches by serviceClass:
//   project      → create SOW (draft), return sowId for customer review + sign
//   add_on       → return Stripe checkout URL for direct purchase
//   subscription → return Stripe subscription checkout URL
//   price === 0  → skip Stripe, immediately mark as fulfilled (free)

router.post(
  "/msp/offers/:offerId/accept",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const offerId = parseInt(p(req.params["offerId"]), 10);
    if (isNaN(offerId)) { apiErr(res, 400, "offerId must be a number"); return; }

    const mspId = getMspIdFromRequest(req);
    if (!mspId) { apiErr(res, 403, "MSP scope required"); return; }

    const [offer] = await db
      .select({
        id: salesOffersTable.id,
        state: salesOffersTable.state,
        mspId: salesOffersTable.mspId,
        serviceId: salesOffersTable.serviceId,
        tenantId: salesOffersTable.tenantId,
        title: salesOffersTable.title,
        adjustedPriceCents: salesOffersTable.adjustedPriceCents,
      })
      .from(salesOffersTable)
      .where(and(eq(salesOffersTable.id, offerId), eq(salesOffersTable.mspId, mspId)))
      .limit(1);

    if (!offer) { apiErr(res, 404, "Offer not found"); return; }
    if (offer.state !== "sent" && offer.state !== "draft") {
      apiErr(res, 409, `Offer is in state "${offer.state}" — only sent or draft offers can be accepted`);
      return;
    }

    // Resolve service to determine checkout path
    let serviceClass: "project" | "add_on" | "subscription" | null = null;
    let serviceName = offer.title;
    let serviceDescription: string | null = null;
    let trialPeriodDays: number | null = null;
    let allowFreeCheckout = true;

    if (offer.serviceId) {
      const [svc] = await db
        .select({
          name: servicesTable.name,
          description: servicesTable.description,
          serviceClass: servicesTable.serviceClass,
          deliveryType: servicesTable.deliveryType,
          allowFreeCheckout: servicesTable.allowFreeCheckout,
          trialPeriodDays: servicesTable.trialPeriodDays,
          minMspPlanTier: servicesTable.minMspPlanTier,
        })
        .from(servicesTable)
        .where(eq(servicesTable.id, offer.serviceId))
        .limit(1);

      if (svc) {
        serviceClass = (svc.serviceClass as "project" | "add_on" | "subscription" | null) ?? "add_on";
        serviceName = svc.name;
        serviceDescription = svc.description ?? null;
        trialPeriodDays = svc.trialPeriodDays ?? null;
        allowFreeCheckout = svc.allowFreeCheckout;

        // Gate Monitoring Tier services on minMspPlanTier
        const pType = detectProductType(svc.serviceClass, svc.deliveryType);
        if (pType === "monitoring_tier" && svc.minMspPlanTier) {
          const tierCheck = await checkMspMinTierSatisfied(mspId, svc.minMspPlanTier);
          if (!tierCheck.ok) {
            apiErr(res, 402, `This Monitoring Tier service requires a "${tierCheck.requiredTier}" platform subscription or higher. Your current tier is "${tierCheck.currentTier}". Please upgrade to continue.`);
            return;
          }
        }
      }
    }

    // Default: add_on if no serviceClass configured
    if (!serviceClass) serviceClass = "add_on";

    // Mark offer as accepted
    await db.update(salesOffersTable).set({
      state: "accepted",
      acceptedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(salesOffersTable.id, offerId));

    // ── Branch by serviceClass ──────────────────────────────────────────────

    if (serviceClass === "project") {
      // Resolve customer context
      let customerId: number | null = null;
      if (offer.tenantId) {
        const [customer] = await db
          .select({ id: mspCustomersTable.id })
          .from(mspCustomersTable)
          .where(and(
            eq(mspCustomersTable.mspId, mspId),
            or(
              eq(mspCustomersTable.tenantId, offer.tenantId.toString()),
              eq(mspCustomersTable.id, offer.tenantId),
            ),
          ))
          .limit(1);
        customerId = customer?.id ?? null;
      }

      // Get optional MSP customer agreement template
      let customerAgreementText: string | null = null;
      const [connConfig] = await db
        .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate })
        .from(mspConnectorConfigsTable)
        .where(eq(mspConnectorConfigsTable.mspId, mspId))
        .limit(1);
      if (connConfig?.customerAgreementTemplate) {
        customerAgreementText = connConfig.customerAgreementTemplate;
      }

      // Generate share token (30-day expiry)
      const shareToken = generateShareToken();
      const shareTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Generate basic SOW HTML document
      const documentHtml = generateSowDocument({
        title: serviceName,
        description: serviceDescription,
        amountCents: offer.adjustedPriceCents,
        customerAgreementText,
        mspId,
      });

      const [sow] = await db
        .insert(mspSowsTable)
        .values({
          offerId,
          mspId,
          customerId: customerId ?? undefined,
          serviceId: offer.serviceId ?? undefined,
          title: serviceName,
          description: serviceDescription ?? undefined,
          amountCents: offer.adjustedPriceCents,
          documentHtml,
          documentGeneratedAt: new Date(),
          shareToken,
          shareTokenExpiresAt,
          expiresAt,
          status: "sent",
          customerAgreementSnapshotText: customerAgreementText ?? undefined,
        })
        .returning({
          sowId: mspSowsTable.sowId,
          status: mspSowsTable.status,
        });

      if (!sow) { apiErr(res, 500, "Failed to create SOW"); return; }

      await emitSowEvent(sow.sowId, "sow.created", req.user!.id, req.user!.mspRole ?? req.user!.role, {
        offerId, mspId, customerId, amountCents: offer.adjustedPriceCents,
      });

      await emitMspEvent(mspId, customerId, "msp.sow.created", {
        sowId: sow.sowId, offerId, amountCents: offer.adjustedPriceCents,
      }, req.user!.id);

      logger.info({ sowId: sow.sowId, offerId, mspId }, "msp-sow: SOW created from offer acceptance");

      res.status(201).json({
        outcome: "sow_created",
        sowId: sow.sowId,
        shareToken,
        message: "SOW created. Share the link with the customer for review and signature.",
      });
      return;
    }

    // ── add_on / subscription — direct Stripe checkout ─────────────────────
    const amountCents = offer.adjustedPriceCents;

    // Free checkout: skip Stripe entirely
    if (amountCents === 0 && allowFreeCheckout) {
      await emitMspEvent(mspId, null, "msp.offer.free_activated", {
        offerId, serviceClass,
      }, req.user!.id);

      res.json({
        outcome: "free_activated",
        message: "Free service activated — no charge required.",
      });
      return;
    }

    // Stripe checkout
    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch (err) {
      logger.warn({ err }, "msp-sow: Stripe not configured for offer checkout");
      apiErr(res, 503, "Payment service not configured. Contact support.");
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const [mspRow] = await db
      .select({ name: mspsTable.name, slug: mspsTable.slug })
      .from(mspsTable)
      .where(eq(mspsTable.id, mspId))
      .limit(1);

    const baseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]?.trim()}`
      : "http://localhost:3000";
    const portalBase = `${baseUrl}/portal`;

    try {
      const mode = serviceClass === "subscription" ? "subscription" : "payment";
      const sessionParams: Record<string, unknown> = {
        mode,
        customer_email: req.user!.email,
        metadata: {
          offerId: String(offerId),
          mspId: String(mspId),
          serviceClass,
          fulfillment_type: "msp_offer",
        },
        success_url: `${portalBase}/customer-home?offer_accepted=1`,
        cancel_url: `${portalBase}/customer-home?offer_cancelled=1`,
      };

      if (mode === "payment") {
        sessionParams["line_items"] = [{
          price_data: {
            currency: "usd",
            product_data: { name: serviceName, description: serviceDescription ?? undefined },
            unit_amount: amountCents,
          },
          quantity: 1,
        }];
      } else {
        // subscription mode: need a price ID from the catalog
        // Fall back to payment mode if no Stripe price ID available
        sessionParams["mode"] = "payment";
        sessionParams["line_items"] = [{
          price_data: {
            currency: "usd",
            product_data: { name: serviceName },
            unit_amount: amountCents,
            ...(trialPeriodDays ? { recurring: { interval: "month" } } : {}),
          },
          quantity: 1,
        }];
      }

      const session = await stripe.checkout.sessions.create(sessionParams as Parameters<typeof stripe.checkout.sessions.create>[0]);

      logger.info({ sessionId: session.id, offerId, mspId, serviceClass }, "msp-sow: Stripe checkout session created");

      res.json({
        outcome: "checkout_required",
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } catch (err) {
      logger.error({ err, offerId, mspId }, "msp-sow: Stripe checkout session creation failed");
      apiErr(res, 500, "Failed to create checkout session");
    }
  },
);

// ── POST /api/msp/sows ────────────────────────────────────────────────────────
// Create a standalone SOW (not tied to an offer). Used for manual project SOWs.

const createSowSchema = z.object({
  mspId: z.number().int().positive(),
  customerId: z.number().int().positive().optional(),
  serviceId: z.number().int().positive().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  amountCents: z.number().int().min(0),
});

router.post(
  "/msp/sows",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const parsed = createSowSchema.safeParse(req.body);
    if (!parsed.success) { apiErr(res, 400, parsed.error.message); return; }

    const data = parsed.data;
    const mspId = getMspIdFromRequest(req) ?? data.mspId;

    // Get optional customer agreement template
    let customerAgreementText: string | null = null;
    const [connConfig] = await db
      .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate })
      .from(mspConnectorConfigsTable)
      .where(eq(mspConnectorConfigsTable.mspId, mspId))
      .limit(1);
    if (connConfig?.customerAgreementTemplate) {
      customerAgreementText = connConfig.customerAgreementTemplate;
    }

    const shareToken = generateShareToken();
    const shareTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const documentHtml = generateSowDocument({
      title: data.title,
      description: data.description ?? null,
      amountCents: data.amountCents,
      customerAgreementText,
      mspId,
    });

    const [sow] = await db
      .insert(mspSowsTable)
      .values({
        mspId,
        customerId: data.customerId,
        serviceId: data.serviceId,
        title: data.title,
        description: data.description,
        amountCents: data.amountCents,
        documentHtml,
        documentGeneratedAt: new Date(),
        shareToken,
        shareTokenExpiresAt,
        expiresAt,
        status: "draft",
        customerAgreementSnapshotText: customerAgreementText ?? undefined,
      })
      .returning();

    if (!sow) { apiErr(res, 500, "Failed to create SOW"); return; }

    await emitSowEvent(sow.sowId, "sow.created", req.user!.id, req.user!.mspRole ?? req.user!.role);

    logger.info({ sowId: sow.sowId, mspId }, "msp-sow: standalone SOW created");
    res.status(201).json(sow);
  },
);

// ── GET /api/msp/sows ─────────────────────────────────────────────────────────
// List SOWs for an MSP (paginated).

router.get(
  "/msp/sows",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = getMspIdFromRequest(req);
    if (!mspId) { apiErr(res, 403, "MSP scope required"); return; }

    const limit = Math.min(parseInt(p(req.query["limit"] as string | undefined) || "20", 10), 100);
    const offset = parseInt(p(req.query["offset"] as string | undefined) || "0", 10);
    const statusFilter = p(req.query["status"] as string | undefined) || null;
    const customerIdFilter = parseInt(p(req.query["customerId"] as string | undefined) || "", 10) || null;

    const conditions = [eq(mspSowsTable.mspId, mspId)];
    if (statusFilter) {
      conditions.push(eq(mspSowsTable.status, statusFilter as "draft" | "sent" | "signed" | "paid" | "failed" | "expired"));
    }
    if (customerIdFilter) {
      conditions.push(eq(mspSowsTable.customerId, customerIdFilter));
    }

    const [rows, [total]] = await Promise.all([
      db.select({
        sowId: mspSowsTable.sowId,
        title: mspSowsTable.title,
        amountCents: mspSowsTable.amountCents,
        status: mspSowsTable.status,
        customerId: mspSowsTable.customerId,
        signedAt: mspSowsTable.signedAt,
        signerName: mspSowsTable.signerName,
        expiresAt: mspSowsTable.expiresAt,
        createdAt: mspSowsTable.createdAt,
      })
        .from(mspSowsTable)
        .where(and(...conditions))
        .orderBy(desc(mspSowsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(mspSowsTable).where(and(...conditions)),
    ]);

    res.json({ items: rows, total: total?.n ?? 0, limit, offset });
  },
);

// ── GET /api/msp/sows/:sowId ──────────────────────────────────────────────────
// Get SOW detail (MSP-authenticated).

router.get(
  "/msp/sows/:sowId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const sowId = p(req.params["sowId"]);
    const mspId = getMspIdFromRequest(req);
    if (!mspId) { apiErr(res, 403, "MSP scope required"); return; }

    const [sow] = await db
      .select()
      .from(mspSowsTable)
      .where(and(eq(mspSowsTable.sowId, sowId), eq(mspSowsTable.mspId, mspId)))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }
    res.json(sow);
  },
);

// ── GET /api/msp/sows/:sowId/document ─────────────────────────────────────────
// Return the SOW HTML document (authenticated).

router.get(
  "/msp/sows/:sowId/document",
  requireAuth,
  async (req: Request, res: Response) => {
    const sowId = p(req.params["sowId"]);
    const user = req.user!;

    const [sow] = await db
      .select({
        mspId: mspSowsTable.mspId,
        documentHtml: mspSowsTable.documentHtml,
        customerUserId: mspSowsTable.customerUserId,
        status: mspSowsTable.status,
      })
      .from(mspSowsTable)
      .where(eq(mspSowsTable.sowId, sowId))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }

    // Access control: MSP users OR the specific customer user
    const isMspUser = user.mspId === sow.mspId || user.role === "admin";
    const isCustomerUser = user.id === sow.customerUserId;
    if (!isMspUser && !isCustomerUser) {
      apiErr(res, 403, "Access denied"); return;
    }

    if (!sow.documentHtml) {
      apiErr(res, 404, "SOW document not yet generated"); return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(sow.documentHtml);
  },
);

// ── POST /api/msp/sows/:sowId/sign ────────────────────────────────────────────
// Customer signs the SOW. Only valid for project-type SOWs in "sent" status.
// After signing, auto-trigger MSP card charge.

const signSowSchema = z.object({
  signerName: z.string().min(1).max(200),
  signatureData: z.string().min(10),  // base64 PNG
});

router.post(
  "/msp/sows/:sowId/sign",
  requireAuth,
  async (req: Request, res: Response) => {
    const sowId = p(req.params["sowId"]);
    const parsed = signSowSchema.safeParse(req.body);
    if (!parsed.success) { apiErr(res, 400, parsed.error.message); return; }

    const { signerName, signatureData } = parsed.data;
    const user = req.user!;

    const [sow] = await db
      .select()
      .from(mspSowsTable)
      .where(eq(mspSowsTable.sowId, sowId))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }

    if (sow.status !== "sent" && sow.status !== "draft") {
      apiErr(res, 409, `SOW is in status "${sow.status}" — only sent SOWs can be signed`);
      return;
    }

    // Access control: MSP user, or the customer user assigned to this SOW
    const isMspUser = user.mspId === sow.mspId || user.role === "admin";
    const isAssignedCustomer = sow.customerUserId === user.id;
    if (!isMspUser && !isAssignedCustomer) {
      apiErr(res, 403, "Only the assigned customer or an MSP operator can sign this SOW");
      return;
    }

    // Check expiry
    if (sow.expiresAt && new Date() > sow.expiresAt) {
      await db.update(mspSowsTable).set({ status: "expired", updatedAt: new Date() })
        .where(eq(mspSowsTable.sowId, sowId));
      apiErr(res, 410, "This SOW has expired and can no longer be signed");
      return;
    }

    const now = new Date();
    const signerIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? null;

    // Mark as signed
    await db.update(mspSowsTable).set({
      status: "signed",
      signerName,
      signatureData,
      signedAt: now,
      signedIp: signerIp,
      // Auto-expire 30 days from signing if not paid
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    }).where(eq(mspSowsTable.sowId, sowId));

    await emitSowEvent(sowId, "sow.signed", user.id, user.mspRole ?? user.role, {
      signerName, signedAt: now.toISOString(),
    });

    await emitMspEvent(sow.mspId, sow.customerId ?? null, "msp.sow.signed", {
      sowId, signerName, amountCents: sow.amountCents,
    }, user.id);

    logger.info({ sowId, mspId: sow.mspId, signerName }, "msp-sow: SOW signed");

    // Auto-trigger MSP charge after signature
    void triggerMspCharge(sowId, sow.mspId, sow.amountCents, user.id).catch((err) => {
      logger.warn({ err, sowId }, "msp-sow: auto-charge failed after signing (will retry on manual trigger)");
    });

    res.json({ ok: true, status: "signed", message: "SOW signed successfully. Initiating payment." });
  },
);

// ── POST /api/msp/sows/:sowId/charge ──────────────────────────────────────────
// Manually trigger MSP card charge (operator action, e.g. after a failed auto-charge).

router.post(
  "/msp/sows/:sowId/charge",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const sowId = p(req.params["sowId"]);
    const mspId = getMspIdFromRequest(req);
    if (!mspId) { apiErr(res, 403, "MSP scope required"); return; }

    const [sow] = await db
      .select({
        sowId: mspSowsTable.sowId,
        status: mspSowsTable.status,
        mspId: mspSowsTable.mspId,
        amountCents: mspSowsTable.amountCents,
        title: mspSowsTable.title,
      })
      .from(mspSowsTable)
      .where(and(eq(mspSowsTable.sowId, sowId), eq(mspSowsTable.mspId, mspId)))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }
    if (sow.status !== "signed" && sow.status !== "failed") {
      apiErr(res, 409, `SOW must be signed or in failed state to charge. Current status: "${sow.status}"`);
      return;
    }

    try {
      await triggerMspCharge(sowId, mspId, sow.amountCents, req.user!.id);
      res.json({ ok: true, message: "Charge initiated" });
    } catch (err) {
      logger.error({ err, sowId }, "msp-sow: manual charge trigger failed");
      apiErr(res, 500, "Failed to initiate charge. Check Stripe configuration.");
    }
  },
);

// ── POST /api/msp/sows/:sowId/expire ─────────────────────────────────────────
// Manually expire a SOW (operator action).

router.post(
  "/msp/sows/:sowId/expire",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const sowId = p(req.params["sowId"]);
    const mspId = getMspIdFromRequest(req);
    if (!mspId) { apiErr(res, 403, "MSP scope required"); return; }

    const [sow] = await db
      .select({ status: mspSowsTable.status, mspId: mspSowsTable.mspId })
      .from(mspSowsTable)
      .where(and(eq(mspSowsTable.sowId, sowId), eq(mspSowsTable.mspId, mspId)))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }
    if (sow.status === "paid") { apiErr(res, 409, "Cannot expire a paid SOW"); return; }

    await db.update(mspSowsTable).set({
      status: "expired",
      updatedAt: new Date(),
    }).where(eq(mspSowsTable.sowId, sowId));

    await emitSowEvent(sowId, "sow.expired", req.user!.id, req.user!.mspRole ?? req.user!.role, { manual: true });

    res.json({ ok: true });
  },
);

// ── GET /api/public/sows/:shareToken ─────────────────────────────────────────
// Public SOW viewer — unauthenticated, read-only.

router.get(
  "/public/sows/:shareToken",
  async (req: Request, res: Response) => {
    const shareToken = p(req.params["shareToken"]);

    const [sow] = await db
      .select({
        sowId: mspSowsTable.sowId,
        title: mspSowsTable.title,
        description: mspSowsTable.description,
        amountCents: mspSowsTable.amountCents,
        currency: mspSowsTable.currency,
        status: mspSowsTable.status,
        documentHtml: mspSowsTable.documentHtml,
        shareTokenExpiresAt: mspSowsTable.shareTokenExpiresAt,
        expiresAt: mspSowsTable.expiresAt,
        signedAt: mspSowsTable.signedAt,
        signerName: mspSowsTable.signerName,
        customerAgreementSnapshotText: mspSowsTable.customerAgreementSnapshotText,
      })
      .from(mspSowsTable)
      .where(eq(mspSowsTable.shareToken, shareToken))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found or link has expired"); return; }

    // Check share token expiry
    if (sow.shareTokenExpiresAt && new Date() > sow.shareTokenExpiresAt) {
      apiErr(res, 410, "This share link has expired"); return;
    }

    // Don't expose signature data in public view
    res.json({
      sowId: sow.sowId,
      title: sow.title,
      description: sow.description,
      amountCents: sow.amountCents,
      currency: sow.currency,
      status: sow.status,
      documentHtml: sow.documentHtml,
      expiresAt: sow.expiresAt,
      signedAt: sow.signedAt,
      signerName: sow.signerName,
      customerAgreementText: sow.customerAgreementSnapshotText,
    });
  },
);

// ── POST /api/public/sows/:shareToken/sign ────────────────────────────────────
// Public sign — customer signs via share link (no auth required).
// Rate-limited to prevent abuse.

import rateLimit from "express-rate-limit";

const publicSignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV !== "production" ? 500 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many signing attempts. Please wait before trying again." },
});

router.post(
  "/public/sows/:shareToken/sign",
  publicSignLimiter,
  async (req: Request, res: Response) => {
    const shareToken = p(req.params["shareToken"]);
    const parsed = signSowSchema.safeParse(req.body);
    if (!parsed.success) { apiErr(res, 400, parsed.error.message); return; }

    const { signerName, signatureData } = parsed.data;

    const [sow] = await db
      .select({
        sowId: mspSowsTable.sowId,
        status: mspSowsTable.status,
        mspId: mspSowsTable.mspId,
        customerId: mspSowsTable.customerId,
        amountCents: mspSowsTable.amountCents,
        shareTokenExpiresAt: mspSowsTable.shareTokenExpiresAt,
        expiresAt: mspSowsTable.expiresAt,
      })
      .from(mspSowsTable)
      .where(eq(mspSowsTable.shareToken, shareToken))
      .limit(1);

    if (!sow) { apiErr(res, 404, "SOW not found"); return; }

    if (sow.shareTokenExpiresAt && new Date() > sow.shareTokenExpiresAt) {
      apiErr(res, 410, "This share link has expired"); return;
    }
    if (sow.status !== "sent" && sow.status !== "draft") {
      if (sow.status === "signed" || sow.status === "paid") {
        apiErr(res, 409, "This SOW has already been signed"); return;
      }
      apiErr(res, 409, `SOW cannot be signed in its current status: "${sow.status}"`); return;
    }
    if (sow.expiresAt && new Date() > sow.expiresAt) {
      await db.update(mspSowsTable).set({ status: "expired", updatedAt: new Date() })
        .where(eq(mspSowsTable.sowId, sow.sowId));
      apiErr(res, 410, "This SOW has expired"); return;
    }

    const now = new Date();
    const signerIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? null;

    await db.update(mspSowsTable).set({
      status: "signed",
      signerName,
      signatureData,
      signedAt: now,
      signedIp: signerIp,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      updatedAt: now,
    }).where(eq(mspSowsTable.sowId, sow.sowId));

    await emitSowEvent(sow.sowId, "sow.signed", null, "customer_via_share_link", {
      signerName, signedAt: now.toISOString(),
    });

    await emitMspEvent(sow.mspId, sow.customerId ?? null, "msp.sow.signed", {
      sowId: sow.sowId, signerName, amountCents: sow.amountCents, viaShareLink: true,
    }, null);

    logger.info({ sowId: sow.sowId, signerName }, "msp-sow: SOW signed via public share link");

    // Auto-trigger MSP charge
    void triggerMspCharge(sow.sowId, sow.mspId, sow.amountCents, null).catch((err) => {
      logger.warn({ err, sowId: sow.sowId }, "msp-sow: auto-charge after public sign failed");
    });

    res.json({ ok: true, status: "signed" });
  },
);

// ── GET/POST /api/msp/customers/:customerId/clickwrap ─────────────────────────
// Check and record customer agreement clickwrap acceptance.

router.get(
  "/msp/customers/:customerId/clickwrap",
  requireAuth,
  async (req: Request, res: Response) => {
    const customerId = parseInt(p(req.params["customerId"]), 10);
    if (isNaN(customerId)) { apiErr(res, 400, "customerId must be a number"); return; }

    const user = req.user!;
    const mspId = user.mspId ?? getMspIdFromRequest(req);

    // Resolve MSP from customer
    const [customer] = await db
      .select({ mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);

    if (!customer) { apiErr(res, 404, "Customer not found"); return; }
    if (mspId && customer.mspId !== mspId && user.role !== "admin") {
      apiErr(res, 403, "Access denied"); return;
    }

    // Check if MSP has a customer agreement template
    const [connConfig] = await db
      .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate })
      .from(mspConnectorConfigsTable)
      .where(eq(mspConnectorConfigsTable.mspId, customer.mspId))
      .limit(1);

    if (!connConfig?.customerAgreementTemplate) {
      res.json({ required: false, accepted: true });
      return;
    }

    // Check if user has already accepted
    const [acceptance] = await db
      .select({ id: mspCustomerClickwrapsTable.id, acceptedAt: mspCustomerClickwrapsTable.acceptedAt })
      .from(mspCustomerClickwrapsTable)
      .where(and(
        eq(mspCustomerClickwrapsTable.mspId, customer.mspId),
        eq(mspCustomerClickwrapsTable.customerUserId, user.id),
      ))
      .limit(1);

    res.json({
      required: true,
      accepted: !!acceptance,
      acceptedAt: acceptance?.acceptedAt ?? null,
      agreementText: connConfig.customerAgreementTemplate,
    });
  },
);

router.post(
  "/msp/customers/:customerId/clickwrap",
  requireAuth,
  async (req: Request, res: Response) => {
    const customerId = parseInt(p(req.params["customerId"]), 10);
    if (isNaN(customerId)) { apiErr(res, 400, "customerId must be a number"); return; }

    const user = req.user!;

    const [customer] = await db
      .select({ mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);

    if (!customer) { apiErr(res, 404, "Customer not found"); return; }

    // Get the current agreement template to snapshot
    const [connConfig] = await db
      .select({ customerAgreementTemplate: mspConnectorConfigsTable.customerAgreementTemplate })
      .from(mspConnectorConfigsTable)
      .where(eq(mspConnectorConfigsTable.mspId, customer.mspId))
      .limit(1);

    if (!connConfig?.customerAgreementTemplate) {
      res.json({ ok: true, message: "No agreement required for this MSP" });
      return;
    }

    const signerIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? null;

    // Upsert clickwrap record
    await db
      .insert(mspCustomerClickwrapsTable)
      .values({
        mspId: customer.mspId,
        customerId,
        customerUserId: user.id,
        agreementTextSnapshot: connConfig.customerAgreementTemplate,
        ipAddress: signerIp ?? undefined,
        userAgent: req.headers["user-agent"] ?? undefined,
      })
      .onConflictDoNothing();

    logger.info({ mspId: customer.mspId, customerId, userId: user.id }, "msp-sow: clickwrap accepted");
    res.json({ ok: true });
  },
);

// ── Internal: trigger MSP Stripe charge ───────────────────────────────────────

async function triggerMspCharge(
  sowId: string,
  mspId: number,
  amountCents: number,
  actorUserId: number | null,
): Promise<void> {
  // Skip charge for free SOWs
  if (amountCents === 0) {
    await db.update(mspSowsTable).set({
      status: "paid",
      chargeConfirmedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(mspSowsTable.sowId, sowId));

    await emitSowEvent(sowId, "sow.paid", actorUserId, "system", { amountCents: 0, free: true });
    await emitMspEvent(mspId, null, "msp.sow.paid", { sowId, amountCents: 0, free: true }, actorUserId);

    // Unlock fulfillment queue
    await unlockFulfillment(sowId, mspId);
    return;
  }

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch {
    logger.warn({ sowId }, "msp-sow: Stripe not configured — cannot charge MSP");
    await db.update(mspSowsTable).set({
      status: "failed",
      failureReason: "Stripe not configured",
      updatedAt: new Date(),
    }).where(eq(mspSowsTable.sowId, sowId));
    return;
  }

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  // Get MSP's Stripe customer ID (from platform subscription)
  const stripeCustomerId = await getMspStripeCustomerId(mspId);

  await db.update(mspSowsTable).set({
    chargeAttemptedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(mspSowsTable.sowId, sowId));

  try {
    const [sow] = await db
      .select({ title: mspSowsTable.title })
      .from(mspSowsTable)
      .where(eq(mspSowsTable.sowId, sowId))
      .limit(1);

    // Create PaymentIntent
    const piParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
      amount: amountCents,
      currency: "usd",
      metadata: { sowId, mspId: String(mspId), platform: "msp_sow" },
      description: `MSP project SOW: ${sow?.title ?? sowId}`,
      confirm: false,
    };

    if (stripeCustomerId) {
      piParams.customer = stripeCustomerId;
      piParams.confirm = true;
      piParams.payment_method = await getMspDefaultPaymentMethod(stripe, stripeCustomerId);
    }

    const pi = await stripe.paymentIntents.create(piParams);

    // Record the charge
    await db.insert(mspChargesTable).values({
      sowId,
      mspId,
      amountCents,
      stripeCustomerId: stripeCustomerId ?? undefined,
      stripePaymentIntentId: pi.id,
      status: pi.status === "succeeded" ? "succeeded" : "pending",
      chargedAt: new Date(),
      confirmedAt: pi.status === "succeeded" ? new Date() : undefined,
    });

    // Update SOW with PI id
    await db.update(mspSowsTable).set({
      stripePaymentIntentId: pi.id,
      ...(pi.status === "succeeded" ? {
        status: "paid",
        chargeConfirmedAt: new Date(),
      } : {}),
      updatedAt: new Date(),
    }).where(eq(mspSowsTable.sowId, sowId));

    if (pi.status === "succeeded") {
      await emitSowEvent(sowId, "sow.paid", actorUserId, "system", { stripePaymentIntentId: pi.id, amountCents });
      await emitMspEvent(mspId, null, "msp.sow.paid", { sowId, stripePaymentIntentId: pi.id, amountCents }, actorUserId);
      await unlockFulfillment(sowId, mspId);
    } else {
      // Requires further action (3DS, etc.) — surface as operator task
      await emitSowEvent(sowId, "sow.charge_pending", actorUserId, "system", {
        stripePaymentIntentId: pi.id, status: pi.status,
      });
      logger.warn({ sowId, piStatus: pi.status }, "msp-sow: charge requires action — operator task needed");
    }

    logger.info({ sowId, piId: pi.id, mspId, status: pi.status }, "msp-sow: charge attempt completed");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, sowId, mspId }, "msp-sow: Stripe charge failed");

    await db.update(mspSowsTable).set({
      status: "failed",
      failureReason: errMsg,
      updatedAt: new Date(),
    }).where(eq(mspSowsTable.sowId, sowId));

    await db.insert(mspChargesTable).values({
      sowId,
      mspId,
      amountCents,
      stripeCustomerId: stripeCustomerId ?? undefined,
      status: "failed",
      failureCode: "stripe_error",
      failureMessage: errMsg,
      chargedAt: new Date(),
    }).catch(() => {});

    await emitSowEvent(sowId, "sow.failed", actorUserId, "system", { error: errMsg });
    await emitMspEvent(mspId, null, "msp.sow.payment_failed", { sowId, error: errMsg }, actorUserId);
  }
}

/** Get the MSP's default payment method from Stripe */
async function getMspDefaultPaymentMethod(
  stripe: import("stripe").Stripe,
  stripeCustomerId: string,
): Promise<string | undefined> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId) as import("stripe").Stripe.Customer;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (typeof defaultPm === "string") return defaultPm;
    if (defaultPm && typeof defaultPm === "object") return defaultPm.id;

    // Fall back to listing payment methods
    const pms = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 1 });
    return pms.data[0]?.id;
  } catch {
    return undefined;
  }
}

/** Unlock fulfillment queue entry for this SOW */
async function unlockFulfillment(sowId: string, mspId: number): Promise<void> {
  try {
    const { fulfillmentQueueTable } = await import("@workspace/db");
    await db.update(fulfillmentQueueTable).set({
      deliveryStatus: "not_started",
      statusUpdatedAt: new Date(),
      statusNote: "Payment confirmed — fulfillment unlocked",
      updatedAt: new Date(),
    })
      .where(and(
        eq(fulfillmentQueueTable.sourceType, "sow"),
        eq(fulfillmentQueueTable.sourceId, sowId),
      ));
  } catch (err) {
    logger.warn({ err, sowId, mspId }, "msp-sow: failed to unlock fulfillment queue (non-fatal)");
  }
}

// ── SOW document generation ───────────────────────────────────────────────────

function generateSowDocument(opts: {
  title: string;
  description: string | null;
  amountCents: number;
  customerAgreementText: string | null;
  mspId: number;
}): string {
  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Statement of Work — ${opts.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e; font-size: 14px; line-height: 1.6; }
    h1 { font-size: 22px; font-weight: 800; color: #0A2540; margin-bottom: 4px; }
    .subtitle { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0078D4; margin-bottom: 24px; }
    .meta { background: #f7f9fc; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; font-size: 13px; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #0A2540; margin: 20px 0 8px; }
    .scope-box { background: #f0f7ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; }
    .price-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .price-table td { padding: 8px 4px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    .price-table .total td { border-top: 2px solid #374151; border-bottom: none; font-weight: 700; font-size: 14px; }
    .terms { font-size: 12px; color: #4b5563; background: #f9fafb; border-radius: 6px; padding: 14px 16px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
    .sig-block { margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
  </style>
</head>
<body>
  <h1>Statement of Work</h1>
  <div class="subtitle">Managed Services Platform — Project Agreement</div>

  <div class="meta">
    <strong>Project:</strong> ${opts.title}<br>
    <strong>Date:</strong> ${today}
  </div>

  ${opts.description ? `
  <div class="section-title">Scope of Work</div>
  <div class="scope-box">${opts.description}</div>
  ` : ""}

  <div class="section-title">Investment</div>
  <table class="price-table">
    <tr><td>Project Fee</td><td style="text-align:right">${formatCurrency(opts.amountCents)}</td></tr>
    <tr class="total"><td>Total</td><td style="text-align:right">${formatCurrency(opts.amountCents)}</td></tr>
  </table>

  ${opts.customerAgreementText ? `
  <div class="section-title">Customer Agreement</div>
  <div class="terms">${opts.customerAgreementText}</div>
  ` : `
  <div class="section-title">Standard Terms</div>
  <div class="terms">1. SCOPE
The services described above will be performed as specified.

2. PAYMENT
Fees are charged to the MSP's payment method on file after customer signature. Work begins upon payment confirmation.

3. CONFIDENTIALITY
Both parties agree to keep confidential all non-public information.

4. LIMITATION OF LIABILITY
Maximum liability is limited to the fees paid under this SOW.

5. GOVERNING LAW
This agreement is governed by applicable law.</div>
  `}

  <div class="sig-block">
    <div class="section-title">Signature</div>
    <p style="font-size:12px;color:#6b7280;">By signing this document, you acknowledge the scope of work and investment above.</p>
  </div>
</body>
</html>`;
}

export default router;
