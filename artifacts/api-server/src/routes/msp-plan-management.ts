/**
 * MSP Plan Management Routes — PlatformAdmin surface for tier capability rules
 * and Stripe price migration.
 *
 * GET  /api/admin/plan-management/tiers              — list MSP tier services
 * GET  /api/admin/plan-management/tiers/:id/migrations — list pending subscriber migrations
 * POST /api/admin/plan-management/tiers/:id/new-price — create new Stripe price (no retroactive change)
 * POST /api/admin/plan-management/tiers/:id/migrate-subscriber — move one MSP to the new price
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  mspSubscriptionsTable,
  mspsTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getStripeKey } from "../lib/stripe.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function writeAuditLog(params: {
  req: Request;
  actionType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const user = params.req.user!;
  return db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.role,
    actionType: params.actionType,
    entityType: params.entityType,
    entityId: params.entityId,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: params.req.ip,
    userAgent: params.req.get("user-agent"),
    outcome: "success",
    metadata: params.metadata,
  });
}

// ── List MSP tier products ─────────────────────────────────────────────────────

router.get("/admin/plan-management/tiers", requireAdmin, async (_req: Request, res: Response) => {
  const tiers = await db
    .select({
      id: servicesTable.id,
      name: servicesTable.name,
      slug: servicesTable.slug,
      price: servicesTable.price,
      typeAttributes: servicesTable.typeAttributes,
      isPublic: servicesTable.isPublic,
    })
    .from(servicesTable)
    .where(eq(servicesTable.fulfillmentType, "msp_monthly_subscription"))
    .orderBy(servicesTable.price);

  // Attach subscriber counts
  const subscriberCounts = await db
    .select({
      serviceId: mspSubscriptionsTable.serviceId,
      n: sql<number>`count(*)`,
    })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.status, "active"))
    .groupBy(mspSubscriptionsTable.serviceId);

  const countMap = new Map(subscriberCounts.map((r) => [r.serviceId, Number(r.n)]));

  res.json(tiers.map((t) => ({ ...t, subscriberCount: countMap.get(t.id) ?? 0 })));
});

// ── Create new Stripe Price for a tier (no retroactive changes) ────────────────

const newPriceSchema = z.object({
  priceCents: z.number().int().min(100),
  currency: z.string().length(3).default("usd"),
  nickname: z.string().max(100).optional(),
});

router.post(
  "/admin/plan-management/tiers/:id/new-price",
  requireAdmin,
  async (req: Request, res: Response) => {
    const serviceId = parseInt(p(req.params["id"]), 10);
    if (isNaN(serviceId)) { apiError(res, 400, "id must be a number"); return; }

    const parsed = newPriceSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }

    const [service] = await db
      .select({ id: servicesTable.id, name: servicesTable.name, slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.id, serviceId), eq(servicesTable.fulfillmentType, "msp_monthly_subscription")))
      .limit(1);

    if (!service) { apiError(res, 404, "Tier product not found"); return; }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      apiError(res, 503, "Stripe not configured");
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    // Find or create a Stripe product for this tier
    const existingProducts = await stripe.products.search({
      query: `metadata['serviceId']:'${serviceId}'`,
    });
    let stripeProductId: string;
    if (existingProducts.data.length > 0) {
      stripeProductId = existingProducts.data[0]!.id;
    } else {
      const product = await stripe.products.create({
        name: service.name,
        metadata: { serviceId: String(serviceId), slug: service.slug ?? "" },
      });
      stripeProductId = product.id;
    }

    // Create new Price — existing subscriptions keep their current price
    const price = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: parsed.data.priceCents,
      currency: parsed.data.currency,
      recurring: { interval: "month" },
      nickname: parsed.data.nickname ?? `${service.name} — updated pricing`,
      metadata: { serviceId: String(serviceId), createdBy: "plan-management-ui" },
    });

    await writeAuditLog({
      req,
      actionType: "plan.new_price.create",
      entityType: "service",
      entityId: String(serviceId),
      metadata: { stripePriceId: price.id, priceCents: parsed.data.priceCents },
    });

    log.info({ serviceId, priceId: price.id, priceCents: parsed.data.priceCents }, "plan-management: new Stripe price created");

    res.json({
      ok: true,
      newPriceId: price.id,
      priceCents: parsed.data.priceCents,
      note: "Existing subscribers are on their original price until migrated individually.",
    });
  },
);

// ── List subscribers grouped by stripePriceId (pending migration view) ────────

router.get(
  "/admin/plan-management/tiers/:id/migrations",
  requireAdmin,
  async (req: Request, res: Response) => {
    const serviceId = parseInt(p(req.params["id"]), 10);
    if (isNaN(serviceId)) { apiError(res, 400, "id must be a number"); return; }

    const [service] = await db
      .select({ id: servicesTable.id, name: servicesTable.name })
      .from(servicesTable)
      .where(eq(servicesTable.id, serviceId))
      .limit(1);

    if (!service) { apiError(res, 404, "Tier product not found"); return; }

    // List all subscriptions for this tier with their current Stripe price IDs
    const subs = await db
      .select({
        mspId: mspSubscriptionsTable.mspId,
        stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
        stripePriceId: mspSubscriptionsTable.stripePriceId,
        status: mspSubscriptionsTable.status,
        mspName: mspsTable.name,
        mspSlug: mspsTable.slug,
      })
      .from(mspSubscriptionsTable)
      .innerJoin(mspsTable, eq(mspsTable.id, mspSubscriptionsTable.mspId))
      .where(eq(mspSubscriptionsTable.serviceId, serviceId))
      .orderBy(desc(mspSubscriptionsTable.mspId));

    // Group by stripePriceId — each unique value is a "price cohort"
    const priceGroups = new Map<string, typeof subs>();
    for (const sub of subs) {
      const key = sub.stripePriceId ?? "none";
      const group = priceGroups.get(key) ?? [];
      group.push(sub);
      priceGroups.set(key, group);
    }

    res.json({
      serviceName: service.name,
      totalSubscribers: subs.length,
      priceGroups: Object.fromEntries(
        [...priceGroups.entries()].map(([priceId, members]) => [priceId, { count: members.length, subscribers: members }]),
      ),
    });
  },
);

// ── Migrate a single subscriber to a target price ─────────────────────────────

router.post(
  "/admin/plan-management/tiers/:id/migrate-subscriber",
  requireAdmin,
  async (req: Request, res: Response) => {
    const serviceId = parseInt(p(req.params["id"]), 10);
    if (isNaN(serviceId)) { apiError(res, 400, "id must be a number"); return; }

    const body = z.object({
      mspId: z.number().int(),
      targetStripePriceId: z.string().min(5),
    }).safeParse(req.body);

    if (!body.success) {
      apiError(res, 400, body.error.issues.map((i) => i.message).join("; "));
      return;
    }

    const [sub] = await db
      .select({
        stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
        stripePriceId: mspSubscriptionsTable.stripePriceId,
      })
      .from(mspSubscriptionsTable)
      .where(and(eq(mspSubscriptionsTable.serviceId, serviceId), eq(mspSubscriptionsTable.mspId, body.data.mspId)))
      .limit(1);

    if (!sub?.stripeSubscriptionId) {
      apiError(res, 404, "Subscription not found");
      return;
    }

    if (sub.stripePriceId === body.data.targetStripePriceId) {
      res.json({ ok: true, alreadyCurrent: true });
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      apiError(res, 503, "Stripe not configured");
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const itemId = stripeSub.items.data[0]?.id;

    if (!itemId) {
      apiError(res, 500, "Stripe subscription has no line items");
      return;
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, price: body.data.targetStripePriceId }],
      proration_behavior: "create_prorations",
    });

    await db
      .update(mspSubscriptionsTable)
      .set({ stripePriceId: body.data.targetStripePriceId, updatedAt: new Date() })
      .where(eq(mspSubscriptionsTable.mspId, body.data.mspId));

    await writeAuditLog({
      req,
      actionType: "plan.subscriber.migrate",
      entityType: "msp_subscription",
      entityId: String(body.data.mspId),
      metadata: {
        serviceId,
        oldPriceId: sub.stripePriceId,
        newPriceId: body.data.targetStripePriceId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      },
    });

    log.info({ mspId: body.data.mspId, serviceId, newPriceId: body.data.targetStripePriceId }, "plan-management: subscriber migrated");

    res.json({ ok: true, newPriceId: body.data.targetStripePriceId });
  },
);

export default router;
