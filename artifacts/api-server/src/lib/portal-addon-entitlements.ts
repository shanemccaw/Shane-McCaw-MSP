/**
 * portal-addon-entitlements.ts — customer/tenant-scoped add-on entitlement
 * gating (Git #1173, applying #1168's rule; Premier bypass #4462).
 *
 * ── Why this is not msp-entitlement.ts ───────────────────────────────────────
 * `../lib/msp-entitlement.ts` gates on the MSP's own platform-tier subscription
 * (`mspSubscriptionsTable`, keyed by `mspId`) — "can this MSP operator use
 * feature X across their whole console". This file gates a DIFFERENT axis: "has
 * THIS ONE TENANT bought the Change Control add-on", which is a per-customer
 * purchase, not an MSP-wide plan feature. Confusing the two would let one
 * tenant's purchase unlock the page for every other tenant on the same MSP.
 *
 * ── Premier includes every add-on (#4462, Shane's decision on #4463) ─────────
 * "Premier gets everything — Premier tier bypasses every add-on entitlement gate
 * platform-wide." So a tenant whose active Monitoring tier is Premier is
 * entitled to EVERY add-on key, with no `tenant_add_on_entitlements` row and no
 * per-key list to consult. The tier comes from the one real resolver,
 * `resolveCustomerTierEntitlement` (portal-tier-features.ts, #4192) — the same
 * `services.tier` label `requireAccess` audits against. It is a blanket bypass
 * by tier identity, deliberately NOT a lookup of `includedFeatures`: that list
 * is the tier-MODULE vocabulary, and the old doc-only `change_control` entry in
 * it was removed by lib/db/migrations/manual/2026-09-17-premier-includes-all-add-ons-4462.sql.
 *
 * Every other tier (Foundation, Growth, or no active tier) still needs a real
 * purchase: an active `tenant_add_on_entitlements` row, written on payment by
 * `addon-entitlement-provisioning.ts`.
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

import { resolveCustomerId } from "./portal-customer-scope.ts";
import { resolveCustomerTierEntitlement } from "./portal-tier-features.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.portal" });

/** The `services.tier` label whose holders are entitled to every add-on (#4463). */
export const ALL_ADD_ONS_TIER = "premier";

export type AddOnEntitlementSource = "tier" | "purchase";

export type AddOnEntitlementResolution =
  | { entitled: true; source: AddOnEntitlementSource; currentTier: string | null }
  | { entitled: false; source: null; currentTier: string | null };

/** Whether a tenant has purchased `featureKey` — the row alone, ignoring tier. */
async function hasPurchasedAddOn(tenantId: number, featureKey: string): Promise<boolean> {
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
 * Whether `tenantId` (a `tenants.id`) is entitled to `featureKey`, and why:
 * `"tier"` when its active Monitoring tier is Premier, `"purchase"` when it holds
 * an active `tenant_add_on_entitlements` row. The tier is checked first, so a
 * Premier tenant never needs the row.
 */
export async function resolveAddOnEntitlement(tenantId: number, featureKey: string): Promise<AddOnEntitlementResolution> {
  const { currentTier } = await resolveCustomerTierEntitlement(tenantId);
  if (currentTier === ALL_ADD_ONS_TIER) return { entitled: true, source: "tier", currentTier };
  if (await hasPurchasedAddOn(tenantId, featureKey)) return { entitled: true, source: "purchase", currentTier };
  return { entitled: false, source: null, currentTier };
}

/** Whether `tenantId` (a `tenants.id`) is entitled to `featureKey` — by Premier tier or by purchase. */
export async function hasAddOnEntitlement(tenantId: number, featureKey: string): Promise<boolean> {
  return (await resolveAddOnEntitlement(tenantId, featureKey)).entitled;
}

/**
 * Express middleware: require the caller's own tenant to be entitled to
 * `featureKey` (Premier tier, or an active purchase). 402 (not 403) on a miss —
 * this is a billing gate, not a role/permission failure, matching the shape
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
