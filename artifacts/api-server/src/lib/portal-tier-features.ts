/**
 * portal-tier-features.ts — customer-scoped MONITORING TIER feature gating
 * (Git #1168's "creation unconditional, tier only gates visibility" rule).
 *
 * ── Why this is a third axis, not a duplicate of the other two ─────────────
 * There are now three separate, real gating mechanisms in this codebase and
 * confusing them is how a tenant gets the wrong screen:
 *
 *   - `middlewares/requireAuth.ts`'s `requireRole(...)` — the coarse
 *     Free/Assessment/CustomerUser/MSP* ROLE floor. It answers "is this login
 *     a paying customer at all", not "which operational modules does this
 *     customer's PURCHASED MONITORING TIER include". Every route below still
 *     keeps its existing role floor; this module is an ADDITIONAL check.
 *   - `lib/msp-entitlement.ts` — the MSP's OWN platform-subscription
 *     capability gate (keyed on `mspId`). Unrelated axis: that is Shane's own
 *     plan, this is a customer's purchased monitoring tier.
 *   - `lib/portal-addon-entitlements.ts` — a per-tenant, separately-priced
 *     ADD-ON purchase (`tenant_add_on_entitlements`), used by Change Control
 *     per #1173/#1168's own comment thread (2026-08-21): Change Control is
 *     real add-on, not a tier-bundled feature, precisely because a customer's
 *     need for the customer-FACING approval UI (vs. their own mature ITSM
 *     process) doesn't track their monitoring tier. Do NOT route Change
 *     Control's gate through this module — it already has the right one.
 *
 * This module is the fourth: **does the customer's purchased Monitoring tier
 * (Foundation/Growth/Premier, `services.tier`) bundle module X**, per the real
 * `services.type_attributes.includedFeatures` array on their active
 * `client_services` row. That is the literal mechanism #1168 asks for.
 *
 * ── The rule (#1168), restated ──────────────────────────────────────────────
 * Creation and tracking are ALWAYS unconditional — nothing upstream of a
 * customer-facing READ route may import this module. Every finding, CR, risk
 * entry, and SOP run gets recorded for every customer, every tier, always.
 * ONLY the customer-facing visibility layer (the GET routes customers browse)
 * checks tier inclusion, exactly the way `requireAddOnEntitlement` is already
 * scoped to Change Control's READ route and nowhere near its POST.
 *
 * ── Module keys ──────────────────────────────────────────────────────────────
 * Canonical strings written into `services.type_attributes.includedFeatures`
 * by `lib/db/migrations/manual/2026-09-05-portal-tier-included-features-1168.sql`.
 * `changeControl` is listed here for documentation completeness only (Premier
 * "functionally gets both", per #1168's structural-dependency note) — it is
 * NEVER read by `hasTierFeature`/`requireTierFeature` below; its real gate is
 * `requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY)`.
 */
export const PORTAL_TIER_MODULE_KEYS = {
  policyDecisions: "policy_decisions",
  riskRegister: "risk_register",
  runbooks: "runbooks",
  remediationTracking: "remediation_tracking",
  sopsRunbooks: "sops_runbooks",
  messageCenter: "message_center",
  changeControl: "change_control", // documentation only — see header. Real gate: portal-addon-entitlements.ts
  ownership: "ownership",
  securityPlan: "security_plan",
  piiGovernance: "pii_governance",
} as const;

export type PortalTierModuleKey =
  (typeof PORTAL_TIER_MODULE_KEYS)[keyof typeof PORTAL_TIER_MODULE_KEYS];

import type { Request, Response, NextFunction } from "express";
import { db, clientServicesTable, servicesTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { resolveCustomerId } from "./portal-customer-scope";
import { resolveCustomerUserIds } from "./tenant-signals";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.portal" });

/**
 * The real `includedFeatures` array off the customer's active Monitoring tier
 * purchase, resolved via the real join chain also used by
 * `msp-launch-control.ts`'s `resolveCustomerMonitoringTier`:
 *
 *     tenants.id -> every users row carrying that tenantId -> client_services
 *     (status = active) -> services (service_type = monitoring_tier)
 *
 * CUSTOMER-scoped (spans every linked login), not user-scoped. Returns an
 * empty array — never null/undefined — on no active subscription, so a caller
 * doing `includes()` fails closed without a null check. Order: earliest
 * active row wins if a customer somehow carries more than one (matches
 * `resolveCustomerMonitoringTier`'s own `orderBy(asc(id))` tie-break).
 */
export async function resolveCustomerIncludedFeatures(customerId: number): Promise<string[]> {
  const customerUserIds = await resolveCustomerUserIds(customerId);
  if (customerUserIds.length === 0) return [];

  const [row] = await db
    .select({ typeAttributes: servicesTable.typeAttributes })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
    .where(
      and(
        inArray(clientServicesTable.clientUserId, customerUserIds),
        eq(clientServicesTable.status, "active"),
        eq(servicesTable.serviceType, "monitoring_tier"),
      ),
    )
    .orderBy(asc(clientServicesTable.id))
    .limit(1);

  if (!row) return [];
  const attrs = (row.typeAttributes ?? {}) as Record<string, unknown>;
  const included = attrs.includedFeatures;
  return Array.isArray(included) ? included.filter((v): v is string => typeof v === "string") : [];
}

/** One-shot check: does this customer's active Monitoring tier bundle `moduleKey`. */
export async function hasTierFeature(customerId: number, moduleKey: PortalTierModuleKey): Promise<boolean> {
  const included = await resolveCustomerIncludedFeatures(customerId);
  return included.includes(moduleKey);
}

/**
 * Express middleware: require the caller's own tenant's active Monitoring
 * tier to bundle `moduleKey`. 402 (not 403) — a billing/tier gate, not a
 * role/permission failure, matching the shape `requirePlanFeature` and
 * `requireAddOnEntitlement` already use for the same reason. Fails closed: no
 * active monitoring subscription resolves to an empty `includedFeatures`
 * list, which never includes anything.
 */
export function requireTierFeature(moduleKey: PortalTierModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const included = await resolveCustomerIncludedFeatures(customerId);
      if (!included.includes(moduleKey)) {
        res.status(402).json({
          error: `Your current plan does not include "${moduleKey}"`,
          code: "TIER_UPGRADE_REQUIRED",
          feature: moduleKey,
        });
        return;
      }
      next();
    } catch (err) {
      log.error({ err, customerId, moduleKey }, "requireTierFeature: check failed");
      res.status(500).json({ error: "Tier entitlement check failed" });
    }
  };
}
