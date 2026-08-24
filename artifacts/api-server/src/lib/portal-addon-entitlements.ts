/**
 * portal-addon-entitlements.ts — customer/tenant-scoped add-on entitlement
 * gating (Git #1173, applying #1168's rule).
 *
 * ── Why this is not msp-entitlement.ts ───────────────────────────────────────
 * `../lib/msp-entitlement.ts` gates on the MSP's own platform-tier subscription
 * (`mspSubscriptionsTable`, keyed by `mspId`) — "can this MSP operator use
 * feature X across their whole console". This file gates a DIFFERENT axis: "has
 * THIS ONE TENANT bought the Change Control add-on", which is a per-customer
 * purchase, not an MSP-wide plan feature. Confusing the two would let one
 * tenant's purchase unlock the page for every other tenant on the same MSP.
 *
 * ── The rule this implements (#1168) ─────────────────────────────────────────
 * "Creation and tracking are always unconditional. Tier only gates what the
 * customer can see." So this module is deliberately never imported by anything
 * that WRITES a change request — only by the customer-facing READ route that
 * exposes the approval-experience UI.
 */

import type { Request, Response, NextFunction } from "express";
import { db, tenantAddOnEntitlementsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { resolveCustomerId } from "./portal-customer-scope";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.portal" });

/** Whether `tenantId` (a `tenants.id`) holds an active entitlement for `featureKey`. */
export async function hasAddOnEntitlement(tenantId: number, featureKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantAddOnEntitlementsTable.id })
    .from(tenantAddOnEntitlementsTable)
    .where(
      and(
        eq(tenantAddOnEntitlementsTable.tenantId, tenantId),
        eq(tenantAddOnEntitlementsTable.featureKey, featureKey),
        eq(tenantAddOnEntitlementsTable.status, "active"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Express middleware: require the caller's own tenant to hold an active
 * entitlement for `featureKey`. 402 (not 403) on a missing entitlement — this
 * is a billing gate, not a role/permission failure, matching the shape
 * `msp-entitlement.ts`'s `requirePlanFeature` already uses for the same reason.
 */
export function requireAddOnEntitlement(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const entitled = await hasAddOnEntitlement(customerId, featureKey);
      if (!entitled) {
        res.status(402).json({
          error: `This tenant has not purchased the "${featureKey}" add-on`,
          code: "ADD_ON_REQUIRED",
          feature: featureKey,
        });
        return;
      }
      next();
    } catch (err) {
      log.error({ err, customerId, featureKey }, "requireAddOnEntitlement: check failed");
      res.status(500).json({ error: "Entitlement check failed" });
    }
  };
}
