/**
 * Portal Retainer Billing — lets a direct customer (mspId === 1, platform-billed)
 * switch an active retainer between monthly and yearly billing, self-service.
 *
 * Direct-customer channel ONLY. The MSP platform-tier equivalent is
 * msp-plan-self-service.ts / msp-billing-webhook.ts — entirely separate system.
 *
 * All switches take effect at the START of the next billing cycle — never
 * mid-cycle, never prorated — via a two-phase Stripe Subscription Schedule
 * (see lib/retainer-pricing.ts for the schedule mechanics). The DB flip
 * happens when the schedule transitions, driven by the subscription_schedule.*
 * events that portal.ts's processStripeEvent() delegates to the handlers
 * exported at the bottom of this file.
 *
 * GET  /api/portal/billing/retainer-intervals                     — interval + pending-switch state per retainer
 * POST /api/portal/billing/subscriptions/:id/switch-interval      — schedule a monthly⟷yearly switch
 * POST /api/portal/billing/subscriptions/:id/cancel-interval-switch — release the schedule, clear pending state
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientServicesTable,
  servicesTable,
  type ClientBillingInterval,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import {
  getOrCreateRetainerPrice,
  monthlyPriceCentsOf,
  scheduleIntervalSwitchAtPeriodEnd,
  RetainerPricingError,
} from "../lib/retainer-pricing.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { createAuditLog } from "../lib/audit.ts";
import { sendAdminSms } from "../lib/sms.ts";
import { z } from "zod";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function apiError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

// ── GET /api/portal/billing/retainer-intervals ────────────────────────────────
// Companion to GET /portal/billing/subscriptions (portal.ts): keyed by the same
// clientServiceId so the billing page can merge interval + pending-switch state
// into each subscription card without touching the existing endpoint.

router.get("/portal/billing/retainer-intervals", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const rows = await db
      .select({
        clientServiceId: clientServicesTable.id,
        billingInterval: clientServicesTable.billingInterval,
        pendingBillingInterval: clientServicesTable.pendingBillingInterval,
        stripeScheduleId: clientServicesTable.stripeScheduleId,
        price: servicesTable.price,
        annualPriceCents: servicesTable.annualPriceCents,
      })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .where(
        and(
          eq(clientServicesTable.clientUserId, userId),
          eq(servicesTable.billingType, "recurring_monthly"),
        ),
      );

    res.json(rows.map((r) => ({
      clientServiceId: r.clientServiceId,
      billingInterval: r.billingInterval,
      pendingBillingInterval: r.stripeScheduleId ? r.pendingBillingInterval : null,
      hasPendingSwitch: r.stripeScheduleId != null && r.pendingBillingInterval != null,
      monthlyPriceCents: monthlyPriceCentsOf(r.price),
      annualPriceCents: r.annualPriceCents,
    })));
  } catch (err) {
    log.error({ err }, "portal-retainer-billing: list retainer intervals failed");
    apiError(res, 500, "Failed to load billing interval details");
  }
});

// ── POST /api/portal/billing/subscriptions/:id/switch-interval ────────────────

const switchSchema = z.object({
  targetInterval: z.enum(["month", "year"]),
});

router.post("/portal/billing/subscriptions/:id/switch-interval", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { apiError(res, 400, "Invalid ID"); return; }

    const parsed = switchSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    const { targetInterval } = parsed.data;

    const [row] = await db
      .select({ cs: clientServicesTable, svc: servicesTable })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)))
      .limit(1);

    if (!row) { apiError(res, 404, "Subscription not found"); return; }
    const { cs, svc } = row;

    if (svc.billingType !== "recurring_monthly") {
      apiError(res, 400, "This service is not a recurring subscription");
      return;
    }
    if (!cs.stripeSubscriptionId) {
      apiError(res, 400, "No Stripe subscription linked to this service. Please contact support.");
      return;
    }
    if (cs.status !== "active") {
      apiError(res, 409, "Billing interval can only be changed on an active subscription");
      return;
    }

    const hasPendingSwitch = cs.stripeScheduleId != null;
    if (targetInterval === cs.billingInterval && !hasPendingSwitch) {
      apiError(res, 400, `You are already billed ${targetInterval === "year" ? "yearly" : "monthly"}`);
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
      targetPriceId = await getOrCreateRetainerPrice(cs.serviceId, targetInterval);
    } catch (err) {
      if (err instanceof RetainerPricingError) { apiError(res, 400, err.message); return; }
      throw err;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    const { scheduleId, effectiveAt } = await scheduleIntervalSwitchAtPeriodEnd(stripe, {
      stripeSubscriptionId: cs.stripeSubscriptionId,
      existingScheduleId: cs.stripeScheduleId,
      targetPriceId,
    });

    await db
      .update(clientServicesTable)
      .set({
        stripeScheduleId: scheduleId,
        pendingBillingInterval: targetInterval,
      })
      .where(eq(clientServicesTable.id, cs.id));

    void createAuditLog({
      actorUserId: userId,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "client",
      actionType: "retainer_interval_switch_scheduled",
      entityType: "service",
      entityId: cs.id,
      entityLabel: svc.name,
      clientId: userId,
      metadata: {
        fromInterval: cs.billingInterval,
        toInterval: targetInterval,
        stripeScheduleId: scheduleId,
        targetPriceId,
        effectiveAt: effectiveAt.toISOString(),
      },
    });

    const effectiveDateStr = effectiveAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    void sendAdminSms(
      `Retainer billing change: ${req.user!.name ?? req.user!.email} switched their ${svc.name} retainer to ${targetInterval === "year" ? "yearly" : "monthly"} billing, effective ${effectiveDateStr}.`,
    );

    log.info(
      { clientServiceId: cs.id, userId, targetInterval, scheduleId, effectiveAt },
      "portal-retainer-billing: interval switch scheduled",
    );

    res.json({
      ok: true,
      effectiveAt: effectiveAt.toISOString(),
      pendingBillingInterval: targetInterval,
    });
  } catch (err) {
    if (err instanceof RetainerPricingError) { apiError(res, 400, err.message); return; }
    log.error({ err }, "portal-retainer-billing: switch interval failed");
    apiError(res, 500, "Failed to schedule the billing interval change");
  }
});

// ── POST /api/portal/billing/subscriptions/:id/cancel-interval-switch ─────────

router.post("/portal/billing/subscriptions/:id/cancel-interval-switch", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { apiError(res, 400, "Invalid ID"); return; }

    const [cs] = await db
      .select({
        id: clientServicesTable.id,
        serviceId: clientServicesTable.serviceId,
        stripeScheduleId: clientServicesTable.stripeScheduleId,
        pendingBillingInterval: clientServicesTable.pendingBillingInterval,
      })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.id, id), eq(clientServicesTable.clientUserId, userId)))
      .limit(1);

    if (!cs) { apiError(res, 404, "Subscription not found"); return; }
    if (!cs.stripeScheduleId) {
      apiError(res, 404, "No pending billing interval change to cancel");
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
    // renewing on its current (phase 1) price — the pending switch never happens.
    try {
      await stripe.subscriptionSchedules.release(cs.stripeScheduleId);
    } catch (err) {
      // Schedule already released/canceled outside the app — still clear our
      // pending state below so it doesn't dangle.
      log.warn(
        { err, clientServiceId: cs.id, scheduleId: cs.stripeScheduleId },
        "portal-retainer-billing: schedule release failed (already released?), clearing pending state",
      );
    }

    await db
      .update(clientServicesTable)
      .set({
        stripeScheduleId: null,
        pendingBillingInterval: null,
      })
      .where(eq(clientServicesTable.id, cs.id));

    void createAuditLog({
      actorUserId: userId,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "client",
      actionType: "retainer_interval_switch_cancelled",
      entityType: "service",
      entityId: cs.id,
      entityLabel: String(cs.serviceId),
      clientId: userId,
      metadata: {
        stripeScheduleId: cs.stripeScheduleId,
        cancelledPendingInterval: cs.pendingBillingInterval,
      },
    });

    log.info(
      { clientServiceId: cs.id, userId, scheduleId: cs.stripeScheduleId },
      "portal-retainer-billing: pending interval switch cancelled",
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "portal-retainer-billing: cancel interval switch failed");
    apiError(res, 500, "Failed to cancel the pending billing interval change");
  }
});

// ── Webhook: schedule transition handling ─────────────────────────────────────
//
// Called from portal.ts's processStripeEvent() for subscription_schedule.*
// events on the per-offer/per-project webhook endpoint. Mechanism mirrors
// msp-billing-webhook.ts exactly, but operates on client_services rows:
//
//   subscription_schedule.updated   — Stripe advances phases at the period
//     boundary. When the FINAL phase (the target interval) has become the
//     current phase, the switch is live → finalize. Updates fired by our own
//     phase edits at scheduling time are ignored (phase 1 is still current).
//   subscription_schedule.completed — all phases done → backstop finalize.
//   subscription_schedule.released  — the schedule detached from the
//     subscription. Our own cancel endpoint clears the row before this event
//     arrives (lookup finds nothing → no-op). If pending state remains, the
//     release happened outside the app: finalize when the target phase already
//     started (switch took effect), otherwise clear the stale pending state.
//   subscription_schedule.canceled  — canceled outside the app before taking
//     effect → clear the stale pending state, log a warning.
//
// Each handler is idempotent: a client_services row is only found while its
// stripeScheduleId is still set. Schedules belonging to the MSP platform
// channel (msp_subscriptions) never match a client_services row → no-op.

type StripeSchedule = import("stripe").Stripe.SubscriptionSchedule;

/** True once the schedule's final phase (the target interval) has begun. */
function finalPhaseStarted(schedule: StripeSchedule): boolean {
  const lastPhase = schedule.phases[schedule.phases.length - 1];
  if (!lastPhase?.start_date) return false;
  if (schedule.current_phase) {
    return schedule.current_phase.start_date === lastPhase.start_date;
  }
  // No current phase (completed/released schedules) — compare against now.
  return lastPhase.start_date * 1000 <= Date.now();
}

/** Looks up the client_services row that owns this schedule, or null. */
async function findClientServiceBySchedule(scheduleId: string) {
  const [cs] = await db
    .select({
      id: clientServicesTable.id,
      clientUserId: clientServicesTable.clientUserId,
      serviceId: clientServicesTable.serviceId,
      billingInterval: clientServicesTable.billingInterval,
      pendingBillingInterval: clientServicesTable.pendingBillingInterval,
    })
    .from(clientServicesTable)
    .where(eq(clientServicesTable.stripeScheduleId, scheduleId))
    .limit(1);
  return cs ?? null;
}

/**
 * The scheduled switch has taken effect: move pendingBillingInterval onto the
 * live column and clear all pending state.
 */
async function applyScheduledIntervalSwitch(schedule: StripeSchedule): Promise<void> {
  const cs = await findClientServiceBySchedule(schedule.id);
  if (!cs) return; // not a retainer schedule, or already finalized/cancelled

  const newInterval: ClientBillingInterval = cs.pendingBillingInterval ?? cs.billingInterval;

  await db.update(clientServicesTable).set({
    billingInterval: newInterval,
    stripeScheduleId: null,
    pendingBillingInterval: null,
  }).where(eq(clientServicesTable.id, cs.id));

  void createAuditLog({
    actorUserId: null,
    actorName: "system:stripe-webhook",
    actorRole: "admin",
    actionType: "retainer_interval_switched",
    entityType: "service",
    entityId: cs.id,
    entityLabel: String(cs.serviceId),
    clientId: cs.clientUserId,
    metadata: {
      scheduleId: schedule.id,
      fromInterval: cs.billingInterval,
      toInterval: newInterval,
    },
  });

  log.info(
    { scheduleId: schedule.id, clientServiceId: cs.id, clientUserId: cs.clientUserId, newInterval },
    "portal-retainer-billing: scheduled interval switch applied",
  );
}

/** The schedule went away without the switch taking effect — clear pending state. */
async function clearStaleIntervalSwitch(schedule: StripeSchedule, reason: string): Promise<void> {
  const cs = await findClientServiceBySchedule(schedule.id);
  if (!cs) return;

  await db.update(clientServicesTable).set({
    stripeScheduleId: null,
    pendingBillingInterval: null,
  }).where(eq(clientServicesTable.id, cs.id));

  log.warn(
    {
      scheduleId: schedule.id,
      clientServiceId: cs.id,
      droppedPendingInterval: cs.pendingBillingInterval,
      reason,
    },
    "portal-retainer-billing: schedule ended outside the app — pending interval switch cleared",
  );
}

export async function handleRetainerScheduleUpdated(schedule: StripeSchedule): Promise<void> {
  // Only act when Stripe has advanced into the final (target) phase. Updates
  // fired by our own scheduling edits arrive while phase 1 is still current.
  if (!schedule.current_phase || !finalPhaseStarted(schedule)) return;
  await applyScheduledIntervalSwitch(schedule);
}

export async function handleRetainerScheduleCompleted(schedule: StripeSchedule): Promise<void> {
  await applyScheduledIntervalSwitch(schedule);
}

export async function handleRetainerScheduleReleased(schedule: StripeSchedule): Promise<void> {
  if (finalPhaseStarted(schedule)) {
    // Natural release after the target phase ran (end_behavior: "release"),
    // or a manual release after the transition — the switch is live.
    await applyScheduledIntervalSwitch(schedule);
  } else {
    await clearStaleIntervalSwitch(schedule, "released before the target phase started");
  }
}

export async function handleRetainerScheduleCanceled(schedule: StripeSchedule): Promise<void> {
  await clearStaleIntervalSwitch(schedule, "schedule canceled");
}

export default router;
