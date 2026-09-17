/**
 * portal-tier-features.ts — customer-scoped MONITORING TIER feature gating
 * (Git #1168's "creation unconditional, tier only gates visibility" rule).
 *
 * ── Why this is a third axis, not a duplicate of the other two ─────────────
 * There are now three separate, real gating mechanisms in this codebase and
 * confusing them is how a tenant gets the wrong screen:
 *
 *   - `middlewares/requireAuth.ts`'s `requireRole(...)` — the coarse
 *     Free/Customer/MSP* ROLE floor. It answers "is this login
 *     a paying customer at all", not "which operational modules does this
 *     customer's PURCHASED MONITORING TIER include". Every route below still
 *     keeps its existing role floor; this module is an ADDITIONAL check.
 *   - `lib/msp-entitlement.ts` — the MSP's OWN platform-subscription
 *     capability gate (keyed on `mspId`). Unrelated axis: that is Shane's own
 *     plan, this is a customer's purchased monitoring tier.
 *   - `lib/portal-addon-entitlements.ts` — a per-tenant, separately-priced
 *     ADD-ON purchase (`tenant_add_on_entitlements`), used by Change Control
 *     per #1173/#1168's own comment thread (2026-08-21). A Premier tenant passes
 *     every add-on gate by tier (#4462, Shane's decision on #4463): that module
 *     asks `resolveCustomerTierEntitlement` below for the tier label and never
 *     reads `includedFeatures`. Do NOT route Change Control's gate through this
 *     module — it already has the right one.
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
 * There is no Change Control key: it is an add-on, not a tier module, and
 * Premier's inclusion of it (and of every other add-on) is enforced by tier in
 * `portal-addon-entitlements.ts` (#4462), not by an `includedFeatures` entry.
 *
 * #4191 moved the vocabulary itself to `@workspace/db/rbac/tier-modules` — one key
 * at a time, unchanged — because the composed RBAC + tier decision function
 * (`evaluateAccess`, `@workspace/db/rbac/access`) is pure and lives in lib/db, and
 * types its tier input against these keys. Re-exported here so every route's
 * existing `import { PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features.ts"`
 * and every test that mocks this module keep working unchanged.
 */
export { PORTAL_TIER_MODULE_KEYS, type PortalTierModuleKey } from "@workspace/db/rbac/tier-modules";
import type { PortalTierModuleKey } from "@workspace/db/rbac/tier-modules";
import type { TierCatalogEntry } from "@workspace/db/rbac/access";

import type { Request, Response, NextFunction } from "express";
import { db, clientServicesTable, servicesTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import { resolveCustomerId } from "./portal-customer-scope.ts";
import { resolveCustomerUserIds } from "./tenant-signals.ts";
import { logger } from "./logger.ts";

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
  return decodeIncludedFeatures(row.typeAttributes);
}

/** `services.type_attributes.includedFeatures`, strings only. Never throws on a hand-edited row. */
function decodeIncludedFeatures(typeAttributes: unknown): string[] {
  const attrs = (typeAttributes ?? {}) as Record<string, unknown>;
  const included = attrs.includedFeatures;
  return Array.isArray(included) ? included.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The customer's active Monitoring tier, as `evaluateAccess()`'s tier half needs it
 * (#4192): `includedFeatures` AND the `services.tier` label, so a denial's audit line
 * can name the tier the customer is actually on.
 *
 * The same join chain, filter and `orderBy(asc(id))` tie-break as
 * `resolveCustomerIncludedFeatures` above — one extra column selected, nothing else.
 * `includedFeatures` is `[]` and `currentTier` is `null` on no active subscription.
 */
export async function resolveCustomerTierEntitlement(
  customerId: number,
): Promise<{ includedFeatures: string[]; currentTier: string | null }> {
  const customerUserIds = await resolveCustomerUserIds(customerId);
  if (customerUserIds.length === 0) return { includedFeatures: [], currentTier: null };

  const [row] = await db
    .select({ typeAttributes: servicesTable.typeAttributes, tier: servicesTable.tier })
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

  if (!row) return { includedFeatures: [], currentTier: null };
  return { includedFeatures: decodeIncludedFeatures(row.typeAttributes), currentTier: row.tier ?? null };
}

/**
 * Every `monitoring_tier` catalog row, decoded into `evaluateAccess()`'s
 * `TierCatalogEntry` shape, so an entitlement denial can name the lowest tier that
 * bundles the module (#4191 reads the ladder from `sort_order`, not from a compiled
 * tier list).
 *
 * Rows with no `services.tier` are skipped: they name no tier, so they cannot be the
 * answer to "which tier includes this", and a nameless row must not surface as an
 * upgrade target.
 */
export async function readMonitoringTierCatalog(): Promise<TierCatalogEntry[]> {
  const rows = await db
    .select({ tier: servicesTable.tier, sortOrder: servicesTable.sortOrder, typeAttributes: servicesTable.typeAttributes })
    .from(servicesTable)
    .where(eq(servicesTable.serviceType, "monitoring_tier"));

  const catalog: TierCatalogEntry[] = [];
  for (const row of rows) {
    if (!row.tier) continue;
    catalog.push({ tier: row.tier, sortOrder: row.sortOrder, includedFeatures: decodeIncludedFeatures(row.typeAttributes) });
  }
  return catalog;
}

/**
 * The 402 body a tier miss answers with. `requireTierFeature` and #4192's
 * `requireAccess` both build it here, so the `TIER_UPGRADE_REQUIRED` shape every
 * portal client already handles has exactly one definition.
 */
export function tierUpgradeRequiredBody(moduleKey: string): { error: string; code: "TIER_UPGRADE_REQUIRED"; feature: string } {
  return {
    error: `Your current plan does not include "${moduleKey}"`,
    code: "TIER_UPGRADE_REQUIRED",
    feature: moduleKey,
  };
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
        res.status(402).json(tierUpgradeRequiredBody(moduleKey));
        return;
      }
      next();
    } catch (err) {
      log.error({ err, customerId, moduleKey }, "requireTierFeature: check failed");
      res.status(500).json({ error: "Tier entitlement check failed" });
    }
  };
}
