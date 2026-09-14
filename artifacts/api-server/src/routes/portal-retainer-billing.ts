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
 * GET  /api/portal/billing/retainer-intervals                       — interval + pending-switch + pending-proposal state per retainer
 * POST /api/portal/billing/subscriptions/:id/switch-interval        — schedule a monthly⟷yearly switch, self-service, effective immediately
 * POST /api/portal/billing/subscriptions/:id/cancel-interval-switch — release the schedule, clear pending state
 * POST /api/portal/billing/subscriptions/:id/approve-interval-proposal — approve an MSP-operator-proposed switch (#4112)
 * POST /api/portal/billing/subscriptions/:id/reject-interval-proposal  — reject an MSP-operator-proposed switch (#4112)
 *
 * #4112 — operator-proposed switch: an MSP-console operator can PROPOSE a
 * switch (msp-retainer-billing.ts, client_services.proposed_billing_interval)
 * that does nothing on its own — it only becomes a real Stripe Subscription
 * Schedule once the customer approves it here, via the exact same
 * `applyIntervalSwitch` mechanics the self-service switch-interval route uses.
 * A customer's own direct switch-interval remains immediate/self-service and
 * is entirely unaffected by a pending proposal (the two states coexist on
 * separate columns; approving/rejecting a proposal only ever touches the
 * proposed_* columns' own scheduling side-effects).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientServicesTable,
  servicesTable,
  usersTable,
  type ClientBillingInterval,
  type AuditActorRole,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { requireCustomerCapability } from "../middlewares/rbac-capability.ts";
import { billingScopeUserIds } from "../lib/portal-billing-scope.ts";
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
//
// #3648 (part of #1696): scoped by `billingScopeUserIds()`, not the caller's own id
// alone — a Customer Admin / Billing holder sees every client service under their
// tenant, matching GET /portal/billing/subscriptions. Same for the two writes below
// (switch-interval, cancel-interval-switch): the target row is looked up within that
// same scope, so a Billing holder can act on a colleague's retainer interval too.

router.get("/portal/billing/retainer-intervals", requireAuth, requireCustomerCapability("billing.view"), async (req: Request, res: Response) => {
  try {
    const scopeUserIds = await billingScopeUserIds(req.user!);

    const rows = await db
      .select({
        clientServiceId: clientServicesTable.id,
        billingInterval: clientServicesTable.billingInterval,
        pendingBillingInterval: clientServicesTable.pendingBillingInterval,
        stripeScheduleId: clientServicesTable.stripeScheduleId,
        proposedBillingInterval: clientServicesTable.proposedBillingInterval,
        proposedAt: clientServicesTable.proposedAt,
        proposedByName: usersTable.name,
        price: servicesTable.price,
        annualPriceCents: servicesTable.annualPriceCents,
      })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .leftJoin(usersTable, eq(usersTable.id, clientServicesTable.proposedByUserId))
      .where(
        and(
          inArray(clientServicesTable.clientUserId, scopeUserIds),
          eq(servicesTable.billingType, "recurring_monthly"),
        ),
      );

    res.json(rows.map((r) => ({
      clientServiceId: r.clientServiceId,
      billingInterval: r.billingInterval,
      pendingBillingInterval: r.stripeScheduleId ? r.pendingBillingInterval : null,
      hasPendingSwitch: r.stripeScheduleId != null && r.pendingBillingInterval != null,
      // #4112 — a pending MSP-console proposal, awaiting this customer's approve/reject.
      proposedBillingInterval: r.proposedBillingInterval,
      hasPendingProposal: r.proposedBillingInterval != null,
      proposedAt: r.proposedAt ? r.proposedAt.toISOString() : null,
      proposedByName: r.proposedByName,
      monthlyPriceCents: monthlyPriceCentsOf(r.price),
      annualPriceCents: r.annualPriceCents,
    })));
  } catch (err) {
    log.error({ err }, "portal-retainer-billing: list retainer intervals failed");
    apiError(res, 500, "Failed to load billing interval details");
  }
});

/**
 * The real interval-change mechanics, shared by the self-service switch-interval
 * route below and the approve-interval-proposal route (#4112) — one place that
 * ever calls `getOrCreateRetainerPrice` + `scheduleIntervalSwitchAtPeriodEnd` and
 * persists the result, so a proposal approval can never reimplement this math.
 * Always clears any pending operator proposal on the row (approving one IS the
 * transition out of the proposed state), which is a no-op for the self-service
 * caller since it never has one set.
 */
async function applyIntervalSwitch(
  stripe: import("stripe").Stripe,
  params: {
    cs: { id: number; clientUserId: number; serviceId: number; stripeSubscriptionId: string; stripeScheduleId: string | null };
    svcName: string;
    targetInterval: ClientBillingInterval;
    actorUserId: number;
    actorName: string;
    actorRole: AuditActorRole;
    actionType: string;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<{ scheduleId: string; effectiveAt: Date }> {
  const targetPriceId = await getOrCreateRetainerPrice(params.cs.serviceId, params.targetInterval);

  const { scheduleId, effectiveAt } = await scheduleIntervalSwitchAtPeriodEnd(stripe, {
    stripeSubscriptionId: params.cs.stripeSubscriptionId,
    existingScheduleId: params.cs.stripeScheduleId,
    targetPriceId,
  });

  await db
    .update(clientServicesTable)
    .set({
      stripeScheduleId: scheduleId,
      pendingBillingInterval: params.targetInterval,
      proposedBillingInterval: null,
      proposedByUserId: null,
      proposedAt: null,
    })
    .where(eq(clientServicesTable.id, params.cs.id));

  void createAuditLog({
    actorUserId: params.actorUserId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    actionType: params.actionType,
    entityType: "service",
    entityId: params.cs.id,
    entityLabel: params.svcName,
    clientId: params.cs.clientUserId,
    metadata: {
      toInterval: params.targetInterval,
      stripeScheduleId: scheduleId,
      targetPriceId,
      effectiveAt: effectiveAt.toISOString(),
      ...params.extraMetadata,
    },
  });

  return { scheduleId, effectiveAt };
}

// ── POST /api/portal/billing/subscriptions/:id/switch-interval ────────────────

const switchSchema = z.object({
  targetInterval: z.enum(["month", "year"]),
});

router.post("/portal/billing/subscriptions/:id/switch-interval", requireAuth, requireCustomerCapability("billing.manage"), async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user!.id;
    const scopeUserIds = await billingScopeUserIds(req.user!);
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
      .where(and(eq(clientServicesTable.id, id), inArray(clientServicesTable.clientUserId, scopeUserIds)))
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

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    let scheduleId: string, effectiveAt: Date;
    try {
      ({ scheduleId, effectiveAt } = await applyIntervalSwitch(stripe, {
        cs: { id: cs.id, clientUserId: cs.clientUserId, serviceId: cs.serviceId, stripeSubscriptionId: cs.stripeSubscriptionId, stripeScheduleId: cs.stripeScheduleId },
        svcName: svc.name,
        targetInterval,
        actorUserId,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: "client",
        actionType: "retainer_interval_switch_scheduled",
        extraMetadata: { fromInterval: cs.billingInterval },
      }));
    } catch (err) {
      if (err instanceof RetainerPricingError) { apiError(res, 400, err.message); return; }
      throw err;
    }

    const effectiveDateStr = effectiveAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    void sendAdminSms(
      `Retainer billing change: ${req.user!.name ?? req.user!.email} switched their ${svc.name} retainer to ${targetInterval === "year" ? "yearly" : "monthly"} billing, effective ${effectiveDateStr}.`,
    );

    log.info(
      { clientServiceId: cs.id, actorUserId, clientUserId: cs.clientUserId, targetInterval, scheduleId, effectiveAt },
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

router.post("/portal/billing/subscriptions/:id/cancel-interval-switch", requireAuth, requireCustomerCapability("billing.manage"), async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user!.id;
    const scopeUserIds = await billingScopeUserIds(req.user!);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { apiError(res, 400, "Invalid ID"); return; }

    const [cs] = await db
      .select({
        id: clientServicesTable.id,
        clientUserId: clientServicesTable.clientUserId,
        serviceId: clientServicesTable.serviceId,
        stripeScheduleId: clientServicesTable.stripeScheduleId,
        pendingBillingInterval: clientServicesTable.pendingBillingInterval,
      })
      .from(clientServicesTable)
      .where(and(eq(clientServicesTable.id, id), inArray(clientServicesTable.clientUserId, scopeUserIds)))
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
      actorUserId,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "client",
      actionType: "retainer_interval_switch_cancelled",
      entityType: "service",
      entityId: cs.id,
      entityLabel: String(cs.serviceId),
      clientId: cs.clientUserId,
      metadata: {
        stripeScheduleId: cs.stripeScheduleId,
        cancelledPendingInterval: cs.pendingBillingInterval,
      },
    });

    log.info(
      { clientServiceId: cs.id, actorUserId, clientUserId: cs.clientUserId, scheduleId: cs.stripeScheduleId },
      "portal-retainer-billing: pending interval switch cancelled",
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "portal-retainer-billing: cancel interval switch failed");
    apiError(res, 500, "Failed to cancel the pending billing interval change");
  }
});

// ── POST /api/portal/billing/subscriptions/:id/approve-interval-proposal ──────
// #4112 — the customer's approval of an MSP-console-proposed switch
// (msp-retainer-billing.ts). Nothing in Stripe exists for a proposal until
// this fires; approving runs the exact same `applyIntervalSwitch` mechanics
// switch-interval uses above, just triggered by the proposal instead of the
// customer's own free choice of target interval.

router.post("/portal/billing/subscriptions/:id/approve-interval-proposal", requireAuth, requireCustomerCapability("billing.manage"), async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user!.id;
    const scopeUserIds = await billingScopeUserIds(req.user!);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { apiError(res, 400, "Invalid ID"); return; }

    const [row] = await db
      .select({ cs: clientServicesTable, svc: servicesTable })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .where(and(eq(clientServicesTable.id, id), inArray(clientServicesTable.clientUserId, scopeUserIds)))
      .limit(1);

    if (!row) { apiError(res, 404, "Subscription not found"); return; }
    const { cs, svc } = row;

    if (!cs.proposedBillingInterval) {
      apiError(res, 404, "No pending billing interval proposal to approve");
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
    if (cs.stripeScheduleId) {
      apiError(res, 409, "A billing interval change is already scheduled. Cancel it before approving this proposal.");
      return;
    }

    let stripeKey: string;
    try {
      stripeKey = getStripeKey();
    } catch {
      apiError(res, 503, "Stripe not configured");
      return;
    }

    const targetInterval = cs.proposedBillingInterval;
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);

    let scheduleId: string, effectiveAt: Date;
    try {
      ({ scheduleId, effectiveAt } = await applyIntervalSwitch(stripe, {
        cs: { id: cs.id, clientUserId: cs.clientUserId, serviceId: cs.serviceId, stripeSubscriptionId: cs.stripeSubscriptionId, stripeScheduleId: cs.stripeScheduleId },
        svcName: svc.name,
        targetInterval,
        actorUserId,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: "client",
        actionType: "retainer_interval_switch_proposal_approved",
        extraMetadata: { fromInterval: cs.billingInterval, proposedByUserId: cs.proposedByUserId },
      }));
    } catch (err) {
      if (err instanceof RetainerPricingError) { apiError(res, 400, err.message); return; }
      throw err;
    }

    const effectiveDateStr = effectiveAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    void sendAdminSms(
      `Retainer billing change: ${req.user!.name ?? req.user!.email} approved the proposed ${svc.name} retainer switch to ${targetInterval === "year" ? "yearly" : "monthly"} billing, effective ${effectiveDateStr}.`,
    );

    log.info(
      { clientServiceId: cs.id, actorUserId, clientUserId: cs.clientUserId, targetInterval, scheduleId, effectiveAt },
      "portal-retainer-billing: interval switch proposal approved",
    );

    res.json({
      ok: true,
      effectiveAt: effectiveAt.toISOString(),
      pendingBillingInterval: targetInterval,
    });
  } catch (err) {
    if (err instanceof RetainerPricingError) { apiError(res, 400, err.message); return; }
    log.error({ err }, "portal-retainer-billing: approve interval proposal failed");
    apiError(res, 500, "Failed to approve the billing interval proposal");
  }
});

// ── POST /api/portal/billing/subscriptions/:id/reject-interval-proposal ───────
// #4112 — the customer declines an MSP-console-proposed switch. Nothing was
// ever created in Stripe for a proposal, so this only clears the proposed_*
// columns — the retainer's real billing interval is entirely unaffected.

router.post("/portal/billing/subscriptions/:id/reject-interval-proposal", requireAuth, requireCustomerCapability("billing.manage"), async (req: Request, res: Response) => {
  try {
    const actorUserId = req.user!.id;
    const scopeUserIds = await billingScopeUserIds(req.user!);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { apiError(res, 400, "Invalid ID"); return; }

    const [row] = await db
      .select({ cs: clientServicesTable, svc: servicesTable })
      .from(clientServicesTable)
      .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
      .where(and(eq(clientServicesTable.id, id), inArray(clientServicesTable.clientUserId, scopeUserIds)))
      .limit(1);

    if (!row) { apiError(res, 404, "Subscription not found"); return; }
    const { cs, svc } = row;

    if (!cs.proposedBillingInterval) {
      apiError(res, 404, "No pending billing interval proposal to reject");
      return;
    }

    const rejectedInterval = cs.proposedBillingInterval;

    await db
      .update(clientServicesTable)
      .set({ proposedBillingInterval: null, proposedByUserId: null, proposedAt: null })
      .where(eq(clientServicesTable.id, cs.id));

    void createAuditLog({
      actorUserId,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: "client",
      actionType: "retainer_interval_switch_proposal_rejected",
      entityType: "service",
      entityId: cs.id,
      entityLabel: svc.name,
      clientId: cs.clientUserId,
      metadata: { rejectedInterval, proposedByUserId: cs.proposedByUserId },
    });

    log.info(
      { clientServiceId: cs.id, actorUserId, clientUserId: cs.clientUserId, rejectedInterval },
      "portal-retainer-billing: interval switch proposal rejected",
    );

    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "portal-retainer-billing: reject interval proposal failed");
    apiError(res, 500, "Failed to reject the billing interval proposal");
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
