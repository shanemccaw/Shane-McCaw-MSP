/**
 * MSP Plan Self-Service — lets an MSPAdmin change their own platform tier
 * and/or billing interval (monthly ⟷ yearly).
 *
 * NOT the PlatformAdmin repricing tool (that is msp-plan-management.ts).
 *
 * All changes take effect at the START of the next billing cycle — never
 * mid-cycle, never prorated — via a Stripe Subscription Schedule (see
 * lib/msp-plan-pricing.ts for the schedule mechanics). The DB flip happens
 * when the schedule transitions, handled in msp-billing-webhook.ts.
 *
 * GET  /api/msp/plan/current               — current tier, interval, pending change
 * GET  /api/msp/plan/available             — all tiers with monthly + yearly pricing
 * POST /api/msp/plan/change                — schedule a tier/interval change
 * POST /api/msp/plan/cancel-pending-change — release the schedule, clear pending state
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  mspSubscriptionsTable,
  mspAuditLogsTable,
  type MspBillingInterval,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspId } from "../lib/resolve-msp-id.ts";
import { countActiveTenants } from "../lib/msp-entitlement.ts";
import {
  getOrCreatePlanPrice,
  monthlyPriceCentsOf,
  schedulePlanChangeAtPeriodEnd,
  PlanPricingError,
} from "../lib/msp-plan-pricing.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { randomUUID } from "crypto";
import { z } from "zod";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function writeAuditLog(params: {
  req: Request;
  actionType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const user = params.req.user!;
  return db.insert(mspAuditLogsTable).values({
    actorUserId: user.id,
    actorRole: user.mspRole ?? user.role,
    actionType: params.actionType,
    entityType: "msp_subscription",
    entityId: params.entityId,
    correlationId: getRequestContext()?.traceId ?? randomUUID(),
    ipAddress: params.req.ip,
    userAgent: params.req.get("user-agent"),
    outcome: "success",
    metadata: params.metadata,
  });
}

function tenantAllowanceOf(typeAttributes: unknown): number | null {
  const attrs = (typeAttributes ?? {}) as Record<string, unknown>;
  return typeof attrs.tenantAllowance === "number" ? attrs.tenantAllowance : null;
}

/**
 * Downgrade guardrail. Mirrors checkTenantAllowance() semantics: allowance 0 or
 * null = unlimited, hard cap = allowance × 2 (overage headroom). Returns a
 * human-readable block reason, or null when the change is allowed.
 * Pure — exported for unit testing.
 */
export function downgradeBlockReason(params: {
  currentAllowance: number | null;
  targetAllowance: number | null;
  activeTenantCount: number;
}): string | null {
  const target = params.targetAllowance ?? 0;
  if (!target) return null; // target tier is unlimited — never a blocking downgrade

  const current = params.currentAllowance ?? 0;
  const isDowngrade = current === 0 || target < current;
  if (!isDowngrade) return null;

  const hardCap = target * 2;
  if (params.activeTenantCount >= hardCap) {
    return (
      `You have ${params.activeTenantCount} active tenants, which exceeds the target tier's ` +
      `allowance of ${target} (with overage headroom up to ${hardCap - 1}). ` +
      `Archive tenants before downgrading.`
    );
  }
  return null;
}

// ── GET /api/msp/plan/current ─────────────────────────────────────────────────

router.get("/msp/plan/current", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiError(res, 400, "No MSP context"); return; }

    const [row] = await db
      .select({
        serviceId: mspSubscriptionsTable.serviceId,
        status: mspSubscriptionsTable.status,
        dunningState: mspSubscriptionsTable.dunningState,
        billingInterval: mspSubscriptionsTable.billingInterval,
        stripeScheduleId: mspSubscriptionsTable.stripeScheduleId,
        pendingServiceId: mspSubscriptionsTable.pendingServiceId,
        pendingBillingInterval: mspSubscriptionsTable.pendingBillingInterval,
        currentPeriodEnd: mspSubscriptionsTable.currentPeriodEnd,
        tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
        tierName: servicesTable.name,
        tierSlug: servicesTable.slug,
        tierPrice: servicesTable.price,
        tierAnnualPriceCents: servicesTable.annualPriceCents,
        tierTypeAttributes: servicesTable.typeAttributes,
      })
      .from(mspSubscriptionsTable)
      .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
      .where(eq(mspSubscriptionsTable.mspId, mspId))
      .limit(1);

    if (!row) { res.json(null); return; }

    // The pending change takes effect when the current period ends (the
    // schedule's phase boundary is anchored to current_period_end).
    let pendingChange: {
      serviceId: number;
      serviceName: string;
      billingInterval: MspBillingInterval;
      effectiveAt: Date | null;
    } | null = null;

    if (row.stripeScheduleId && (row.pendingServiceId != null || row.pendingBillingInterval != null)) {
      const pendingServiceId = row.pendingServiceId ?? row.serviceId;
      let pendingName = row.tierName;
      if (pendingServiceId !== row.serviceId) {
        const [pendingSvc] = await db
          .select({ name: servicesTable.name })
          .from(servicesTable)
          .where(eq(servicesTable.id, pendingServiceId))
          .limit(1);
        pendingName = pendingSvc?.name ?? pendingName;
      }
      pendingChange = {
        serviceId: pendingServiceId,
        serviceName: pendingName,
        billingInterval: row.pendingBillingInterval ?? row.billingInterval,
        effectiveAt: row.currentPeriodEnd,
      };
    }

    res.json({
      tier: {
        id: row.serviceId,
        name: row.tierName,
        slug: row.tierSlug,
        monthlyPriceCents: monthlyPriceCentsOf(row.tierPrice),
        annualPriceCents: row.tierAnnualPriceCents,
        tenantAllowance: tenantAllowanceOf(row.tierTypeAttributes),
      },
      billingInterval: row.billingInterval,
      status: row.status,
      dunningState: row.dunningState,
      currentPeriodEnd: row.currentPeriodEnd,
      tenantCountSnapshot: row.tenantCountSnapshot,
      pendingChange,
    });
  } catch (err) {
    log.error({ err }, "msp-plan-self-service: get current plan failed");
    apiError(res, 500, "Failed to load current plan");
  }
});

// ── GET /api/msp/plan/available ───────────────────────────────────────────────

router.get("/msp/plan/available", requireRole("MSPAdmin"), async (_req: Request, res: Response) => {
  try {
    const tiers = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        slug: servicesTable.slug,
        description: servicesTable.description,
        price: servicesTable.price,
        annualPriceCents: servicesTable.annualPriceCents,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(and(
        eq(servicesTable.fulfillmentType, "msp_monthly_subscription"),
        eq(servicesTable.isPublic, true),
      ))
      .orderBy(servicesTable.price);

    res.json(tiers.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      monthlyPriceCents: monthlyPriceCentsOf(t.price),
      annualPriceCents: t.annualPriceCents,
      tenantAllowance: tenantAllowanceOf(t.typeAttributes),
    })));
  } catch (err) {
    log.error({ err }, "msp-plan-self-service: list available tiers failed");
    apiError(res, 500, "Failed to load available tiers");
  }
});

// ── POST /api/msp/plan/change ─────────────────────────────────────────────────

const changeSchema = z.object({
  targetServiceId: z.number().int(),
  targetInterval: z.enum(["month", "year"]),
});

router.post("/msp/plan/change", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiError(res, 400, "No MSP context"); return; }

    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    const { targetServiceId, targetInterval } = parsed.data;

    const [sub] = await db
      .select({
        serviceId: mspSubscriptionsTable.serviceId,
        status: mspSubscriptionsTable.status,
        dunningState: mspSubscriptionsTable.dunningState,
        billingInterval: mspSubscriptionsTable.billingInterval,
        stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
        stripeScheduleId: mspSubscriptionsTable.stripeScheduleId,
        pendingServiceId: mspSubscriptionsTable.pendingServiceId,
        currentTierAttributes: servicesTable.typeAttributes,
      })
      .from(mspSubscriptionsTable)
      .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
      .where(eq(mspSubscriptionsTable.mspId, mspId))
      .limit(1);

    if (!sub?.stripeSubscriptionId) {
      apiError(res, 404, "No platform subscription found for this MSP");
      return;
    }
    if (sub.status !== "active" && sub.status !== "trialing") {
      apiError(res, 409, "Plan changes require an active subscription. Please resolve billing issues first.");
      return;
    }

    const hasPendingChange = sub.stripeScheduleId != null;
    if (
      targetServiceId === sub.serviceId &&
      targetInterval === sub.billingInterval &&
      !hasPendingChange
    ) {
      apiError(res, 400, "You are already on this plan and interval");
      return;
    }

    const [target] = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        isPublic: servicesTable.isPublic,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(and(
        eq(servicesTable.id, targetServiceId),
        eq(servicesTable.fulfillmentType, "msp_monthly_subscription"),
      ))
      .limit(1);

    if (!target || (!target.isPublic && target.id !== sub.serviceId)) {
      apiError(res, 404, "Target tier not found");
      return;
    }

    // Downgrade guardrail — same tenant-count query checkTenantAllowance() uses.
    const activeTenantCount = await countActiveTenants(mspId);
    const blockReason = downgradeBlockReason({
      currentAllowance: tenantAllowanceOf(sub.currentTierAttributes),
      targetAllowance: tenantAllowanceOf(target.typeAttributes),
      activeTenantCount,
    });
    if (blockReason) {
      apiError(res, 409, blockReason);
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      apiError(res, 503, "Stripe not configured");
      return;
    }

    let targetPriceId: string;
    try {
      targetPriceId = await getOrCreatePlanPrice(targetServiceId, targetInterval);
    } catch (err) {
      if (err instanceof PlanPricingError) { apiError(res, 400, err.message); return; }
      throw err;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const { scheduleId, effectiveAt } = await schedulePlanChangeAtPeriodEnd(stripe, {
      stripeSubscriptionId: sub.stripeSubscriptionId,
      existingScheduleId: sub.stripeScheduleId,
      targetPriceId,
    });

    await db
      .update(mspSubscriptionsTable)
      .set({
        stripeScheduleId: scheduleId,
        pendingServiceId: targetServiceId,
        pendingBillingInterval: targetInterval,
        updatedAt: new Date(),
      })
      .where(eq(mspSubscriptionsTable.mspId, mspId));

    await writeAuditLog({
      req,
      actionType: "plan.self_service_change.scheduled",
      entityId: String(mspId),
      metadata: {
        fromServiceId: sub.serviceId,
        toServiceId: targetServiceId,
        fromInterval: sub.billingInterval,
        toInterval: targetInterval,
        stripeScheduleId: scheduleId,
        targetPriceId,
        effectiveAt: effectiveAt.toISOString(),
      },
    });

    log.info(
      { mspId, targetServiceId, targetInterval, scheduleId, effectiveAt },
      "msp-plan-self-service: plan change scheduled",
    );

    res.json({
      ok: true,
      effectiveAt: effectiveAt.toISOString(),
      pendingChange: {
        serviceId: targetServiceId,
        serviceName: target.name,
        billingInterval: targetInterval,
        effectiveAt: effectiveAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof PlanPricingError) { apiError(res, 400, err.message); return; }
    log.error({ err }, "msp-plan-self-service: change plan failed");
    apiError(res, 500, "Failed to schedule plan change");
  }
});

// ── POST /api/msp/plan/cancel-pending-change ──────────────────────────────────

router.post("/msp/plan/cancel-pending-change", requireRole("MSPAdmin"), async (req: Request, res: Response) => {
  try {
    const mspId = await resolveMspId(req);
    if (!mspId) { apiError(res, 400, "No MSP context"); return; }

    const [sub] = await db
      .select({
        stripeScheduleId: mspSubscriptionsTable.stripeScheduleId,
        pendingServiceId: mspSubscriptionsTable.pendingServiceId,
        pendingBillingInterval: mspSubscriptionsTable.pendingBillingInterval,
      })
      .from(mspSubscriptionsTable)
      .where(eq(mspSubscriptionsTable.mspId, mspId))
      .limit(1);

    if (!sub?.stripeScheduleId) {
      apiError(res, 404, "No pending plan change to cancel");
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

    // release() hands control back to the plain subscription, which keeps
    // renewing on its current (phase 1) price — the pending change never happens.
    try {
      await stripe.subscriptionSchedules.release(sub.stripeScheduleId);
    } catch (err) {
      // Schedule already released/canceled outside the app — still clear our
      // pending state below so it doesn't dangle.
      log.warn(
        { err, mspId, scheduleId: sub.stripeScheduleId },
        "msp-plan-self-service: schedule release failed (already released?), clearing pending state",
      );
    }

    await db
      .update(mspSubscriptionsTable)
      .set({
        stripeScheduleId: null,
        pendingServiceId: null,
        pendingBillingInterval: null,
        updatedAt: new Date(),
      })
      .where(eq(mspSubscriptionsTable.mspId, mspId));

    await writeAuditLog({
      req,
      actionType: "plan.self_service_change.canceled",
      entityId: String(mspId),
      metadata: {
        stripeScheduleId: sub.stripeScheduleId,
        canceledPendingServiceId: sub.pendingServiceId,
        canceledPendingInterval: sub.pendingBillingInterval,
      },
    });

    log.info({ mspId, scheduleId: sub.stripeScheduleId }, "msp-plan-self-service: pending plan change canceled");

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "msp-plan-self-service: cancel pending change failed");
    apiError(res, 500, "Failed to cancel pending plan change");
  }
});

export default router;
