/**
 * msp-retainer-billing.ts — the MSP-console operator surface for PROPOSING a
 * direct-customer retainer billing-interval switch (#4112, part of #1692).
 *
 * Distinct from msp-retainer.ts (retainer HOURS — a completely different
 * `retainer_work_log` concept sharing only the English word "retainer"). This
 * file is the operator-side counterpart to `portal-retainer-billing.ts`'s
 * customer self-service switch-interval flow, for the SAME `client_services`
 * rows (mspId === 1 direct, platform-billed retainers).
 *
 * The self-service flow in portal-retainer-billing.ts takes effect
 * immediately (a Stripe Subscription Schedule is created the moment the
 * customer asks). This is a deliberately weaker write: an operator here can
 * only PROPOSE a switch — it is stored on `client_services.proposed_*` and
 * does nothing to Stripe until the customer approves it via
 * `POST /api/portal/billing/subscriptions/:id/approve-interval-proposal`.
 * Rejecting, or an operator withdrawing their own proposal here, simply
 * clears the `proposed_*` columns — no Stripe object is ever created for an
 * unapproved proposal.
 *
 *   GET  /api/msp/:mspId/customers/:customerId/retainer-billing
 *        — the customer's active recurring retainers, with self-service
 *          pending-switch state AND any pending operator proposal.
 *   POST /api/msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/propose-interval-switch
 *        — propose a month<->year switch; fires a real customer notification.
 *   POST /api/msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/cancel-proposal
 *        — operator withdraws their own not-yet-decided proposal.
 *
 * Auth: `requireCapability("ladder.msp-operator")` + `requireMspScope("params")`,
 * then the customer is re-resolved as a tenant of `:mspId` (IDOR guard, same
 * idiom as msp-retainer.ts/msp-launch-control.ts) before any client_services
 * row is touched.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientServicesTable,
  servicesTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals.ts";
import { createAuditLog } from "../lib/audit.ts";
import { createNotification } from "../lib/notification-center.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function parseId(val: string | string[] | undefined): number | null {
  const raw = Array.isArray(val) ? val[0] : val;
  const n = parseInt(String(raw ?? ""), 10);
  return isNaN(n) ? null : n;
}

/** Resolves :mspId/:customerId, confirms the customer is a real tenant of that MSP. Answers the response itself on failure. */
async function resolveMspCustomerOrRespond(req: Request, res: Response) {
  const mspId = parseId(req.params["mspId"]);
  const customerId = parseId(req.params["customerId"]);
  if (mspId == null || customerId == null) {
    res.status(400).json({ error: "Invalid mspId or customerId" });
    return null;
  }
  const [customer] = await db
    .select({ id: tenantsTable.id, name: tenantsTable.customerName })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return { mspId, customerId, customerName: customer.name };
}

// ── GET /msp/:mspId/customers/:customerId/retainer-billing ───────────────────

router.get(
  "/msp/:mspId/customers/:customerId/retainer-billing",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveMspCustomerOrRespond(req, res);
      if (!scope) return;

      const customerUserIds = await resolveCustomerUserIds(scope.customerId);
      const rows = customerUserIds.length === 0 ? [] : await db
        .select({
          clientServiceId: clientServicesTable.id,
          serviceName: servicesTable.name,
          status: clientServicesTable.status,
          billingInterval: clientServicesTable.billingInterval,
          pendingBillingInterval: clientServicesTable.pendingBillingInterval,
          stripeScheduleId: clientServicesTable.stripeScheduleId,
          proposedBillingInterval: clientServicesTable.proposedBillingInterval,
          proposedAt: clientServicesTable.proposedAt,
          price: servicesTable.price,
          annualPriceCents: servicesTable.annualPriceCents,
        })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(
          and(
            inArray(clientServicesTable.clientUserId, customerUserIds),
            eq(servicesTable.billingType, "recurring_monthly"),
            eq(clientServicesTable.status, "active"),
          ),
        );

      res.json({
        customerId: scope.customerId,
        customerName: scope.customerName,
        retainers: rows.map((r) => ({
          clientServiceId: r.clientServiceId,
          serviceName: r.serviceName,
          billingInterval: r.billingInterval,
          hasPendingSwitch: r.stripeScheduleId != null && r.pendingBillingInterval != null,
          pendingBillingInterval: r.stripeScheduleId ? r.pendingBillingInterval : null,
          hasPendingProposal: r.proposedBillingInterval != null,
          proposedBillingInterval: r.proposedBillingInterval,
          proposedAt: r.proposedAt ? r.proposedAt.toISOString() : null,
        })),
      });
    } catch (err) {
      log.error({ err }, "msp-retainer-billing: list failed");
      res.status(500).json({ error: "Failed to load retainer billing details" });
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/propose-interval-switch ──

const proposeSchema = z.object({
  targetInterval: z.enum(["month", "year"]),
});

router.post(
  "/msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/propose-interval-switch",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveMspCustomerOrRespond(req, res);
      if (!scope) return;

      const clientServiceId = parseId(req.params["clientServiceId"]);
      if (clientServiceId == null) { res.status(400).json({ error: "Invalid clientServiceId" }); return; }

      const parsed = proposeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
        return;
      }
      const { targetInterval } = parsed.data;

      const customerUserIds = await resolveCustomerUserIds(scope.customerId);
      const [row] = await db
        .select({ cs: clientServicesTable, svc: servicesTable })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(and(eq(clientServicesTable.id, clientServiceId), inArray(clientServicesTable.clientUserId, customerUserIds)))
        .limit(1);
      if (!row) { res.status(404).json({ error: "Retainer not found for this customer" }); return; }
      const { cs, svc } = row;

      if (svc.billingType !== "recurring_monthly") {
        res.status(400).json({ error: "This service is not a recurring subscription" });
        return;
      }
      if (cs.status !== "active") {
        res.status(409).json({ error: "Billing interval can only be proposed on an active subscription" });
        return;
      }
      if (cs.stripeScheduleId != null) {
        res.status(409).json({ error: "The customer already has a self-service billing interval switch scheduled" });
        return;
      }
      if (cs.proposedBillingInterval != null) {
        res.status(409).json({ error: "A proposal is already pending the customer's decision. Cancel it before proposing a new one." });
        return;
      }
      if (targetInterval === cs.billingInterval) {
        res.status(400).json({ error: `This retainer is already billed ${targetInterval === "year" ? "yearly" : "monthly"}` });
        return;
      }

      const actorUserId = req.user!.id;
      const actorName = req.user!.name ?? req.user!.email;
      const proposedAt = new Date();

      await db
        .update(clientServicesTable)
        .set({
          proposedBillingInterval: targetInterval,
          proposedByUserId: actorUserId,
          proposedAt,
        })
        .where(eq(clientServicesTable.id, cs.id));

      void createAuditLog({
        actorUserId,
        actorName,
        actorRole: "msp",
        actionType: "retainer_interval_switch_proposed",
        entityType: "service",
        entityId: cs.id,
        entityLabel: svc.name,
        clientId: cs.clientUserId,
        metadata: {
          fromInterval: cs.billingInterval,
          proposedInterval: targetInterval,
          customerId: scope.customerId,
        },
      });

      // Real portal notification (#4112) — fanned out to every user under this
      // customer's tenant, same recipient set switch-interval's own SMS reaches
      // for a self-service switch (there is no per-category billing-only user
      // list to narrow to yet; every tenant user gets the in-app row, same as
      // any other billing event today).
      for (const userId of customerUserIds) {
        void createNotification({
          title: "Your MSP proposed a billing interval change",
          body: `${svc.name} — switch to ${targetInterval === "year" ? "yearly" : "monthly"} billing. Review and approve or reject it on your Billing page.`,
          category: "billing",
          severity: "info",
          linkPath: "/billing",
          notifType: "invoice",
          recipient: { type: "customer_user", userId },
        });
      }

      log.info(
        { mspId: scope.mspId, customerId: scope.customerId, clientServiceId: cs.id, targetInterval, actorUserId },
        "msp-retainer-billing: interval switch proposed",
      );

      res.json({ ok: true, proposedBillingInterval: targetInterval, proposedAt: proposedAt.toISOString() });
    } catch (err) {
      log.error({ err }, "msp-retainer-billing: propose interval switch failed");
      res.status(500).json({ error: "Failed to propose the billing interval change" });
    }
  },
);

// ── POST /msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/cancel-proposal ──

router.post(
  "/msp/:mspId/customers/:customerId/retainer-billing/:clientServiceId/cancel-proposal",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveMspCustomerOrRespond(req, res);
      if (!scope) return;

      const clientServiceId = parseId(req.params["clientServiceId"]);
      if (clientServiceId == null) { res.status(400).json({ error: "Invalid clientServiceId" }); return; }

      const customerUserIds = await resolveCustomerUserIds(scope.customerId);
      const [row] = await db
        .select({ cs: clientServicesTable, svc: servicesTable })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(and(eq(clientServicesTable.id, clientServiceId), inArray(clientServicesTable.clientUserId, customerUserIds)))
        .limit(1);
      if (!row) { res.status(404).json({ error: "Retainer not found for this customer" }); return; }
      const { cs, svc } = row;

      if (cs.proposedBillingInterval == null) {
        res.status(404).json({ error: "No pending proposal to cancel" });
        return;
      }

      const actorUserId = req.user!.id;
      const actorName = req.user!.name ?? req.user!.email;
      const withdrawnInterval = cs.proposedBillingInterval;

      await db
        .update(clientServicesTable)
        .set({ proposedBillingInterval: null, proposedByUserId: null, proposedAt: null })
        .where(eq(clientServicesTable.id, cs.id));

      void createAuditLog({
        actorUserId,
        actorName,
        actorRole: "msp",
        actionType: "retainer_interval_switch_proposal_withdrawn",
        entityType: "service",
        entityId: cs.id,
        entityLabel: svc.name,
        clientId: cs.clientUserId,
        metadata: { withdrawnInterval, customerId: scope.customerId },
      });

      log.info(
        { mspId: scope.mspId, customerId: scope.customerId, clientServiceId: cs.id, actorUserId },
        "msp-retainer-billing: proposal withdrawn",
      );

      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "msp-retainer-billing: cancel proposal failed");
      res.status(500).json({ error: "Failed to cancel the pending proposal" });
    }
  },
);

export default router;
