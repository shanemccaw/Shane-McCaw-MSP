/**
 * msp-customer-services.ts — read-only list of a customer's active `client_services`
 * rows, for the MSP Console (Git #3775, Feature #2568's Tenant Contracts screen).
 *
 * `client_services` is the real join table between a customer's portal login and the
 * services they have purchased/have active — the general shape `msp-retainer-billing.ts`
 * already reads from, but narrowed there to `billingType = "recurring_monthly"` for its
 * own retainer-only screen. This route is the general, unfiltered read: every active
 * client_services row for the customer, whatever its serviceClass/deliveryType/billingType,
 * joined to the catalog row for its name/tier/classification. No new schema — same tables
 * `msp-retainer-billing.ts` and `msp-sow.ts` already read.
 *
 *   GET /api/msp/:mspId/customers/:customerId/services
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, clientServicesTable, servicesTable, tenantsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

function parseId(val: string | string[] | undefined): number | null {
  const raw = Array.isArray(val) ? val[0] : val;
  const n = parseInt(String(raw ?? ""), 10);
  return isNaN(n) ? null : n;
}

// ── GET /msp/:mspId/customers/:customerId/services ────────────────────────────

router.get(
  "/msp/:mspId/customers/:customerId/services",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response) => {
    const mspId = parseId(req.params["mspId"]);
    const customerId = parseId(req.params["customerId"]);
    if (mspId == null || customerId == null) {
      res.status(400).json({ error: "Invalid mspId or customerId" });
      return;
    }

    try {
      const [customer] = await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
        .limit(1);
      if (!customer) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      const customerUserIds = await resolveCustomerUserIds(customerId);
      const rows = customerUserIds.length === 0 ? [] : await db
        .select({
          clientServiceId: clientServicesTable.id,
          status: clientServicesTable.status,
          billingInterval: clientServicesTable.billingInterval,
          purchasedAt: clientServicesTable.purchasedAt,
          serviceId: servicesTable.id,
          serviceName: servicesTable.name,
          serviceClass: servicesTable.serviceClass,
          deliveryType: servicesTable.deliveryType,
          billingType: servicesTable.billingType,
          tier: servicesTable.tier,
        })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(inArray(clientServicesTable.clientUserId, customerUserIds));

      // One client_services row can repeat per sibling login sharing the same
      // tenant (resolveCustomerUserIds returns every login on the account) —
      // de-dupe by the real row id so the screen doesn't show the same
      // subscription twice.
      const byId = new Map(rows.map((r) => [r.clientServiceId, r]));

      res.json({
        customerId,
        services: Array.from(byId.values()).map((r) => ({
          clientServiceId: r.clientServiceId,
          status: r.status,
          billingInterval: r.billingInterval,
          purchasedAt: r.purchasedAt ? r.purchasedAt.toISOString() : null,
          serviceId: r.serviceId,
          serviceName: r.serviceName,
          serviceClass: r.serviceClass,
          deliveryType: r.deliveryType,
          billingType: r.billingType,
          tier: r.tier,
        })),
      });
    } catch (err) {
      log.error({ err, mspId, customerId }, "msp-customer-services: list failed");
      res.status(500).json({ error: "Failed to load customer services" });
    }
  },
);

export default router;
