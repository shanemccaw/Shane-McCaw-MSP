/**
 * MSP Entitlement — platform tier capability gating.
 *
 * Usage:
 *   import { requirePlanFeature, checkTenantAllowance } from "../lib/msp-entitlement";
 *
 *   router.post("/customers", requireAuth, requirePlanFeature("advanced_signals"), handler);
 *   await checkTenantAllowance(mspId); // throws OverageError if at hard cap
 */

import type { Request, Response, NextFunction } from "express";
import { db, servicesTable, mspSubscriptionsTable, mspCustomersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "tenant.msp-admin" });

export class UpgradeRequiredError extends Error {
  constructor(
    public readonly feature: string,
    public readonly currentTier: string,
  ) {
    super(`Feature "${feature}" is not available on the "${currentTier}" tier`);
    this.name = "UpgradeRequiredError";
  }
}

export class OverageError extends Error {
  constructor(
    public readonly mspId: number,
    public readonly current: number,
    public readonly allowance: number,
  ) {
    super(`Tenant count (${current}) has reached hard cap for this tier (allowance: ${allowance})`);
    this.name = "OverageError";
  }
}

/** Loads the subscription + service tier for an MSP, or null if none. */
async function loadTier(mspId: number) {
  const [sub] = await db
    .select({
      serviceId: mspSubscriptionsTable.serviceId,
      status: mspSubscriptionsTable.status,
      dunningState: mspSubscriptionsTable.dunningState,
      typeAttributes: servicesTable.typeAttributes,
      tierName: servicesTable.name,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);
  if (!sub) return null;

  // Extract MSP platform tier fields from typeAttributes jsonb
  const attrs = (sub.typeAttributes ?? {}) as Record<string, unknown>;
  return {
    ...sub,
    tenantAllowance: typeof attrs.tenantAllowance === "number" ? attrs.tenantAllowance : null,
    aiCreditAllowance: typeof attrs.aiCreditAllowancePlatformValue === "number"
      ? attrs.aiCreditAllowancePlatformValue
      : (typeof attrs.aiCreditAllowance === "number" ? attrs.aiCreditAllowance : null),
    overageRateCents: typeof attrs.overageRateCents === "number" ? attrs.overageRateCents : null,
    tierCapabilities: (attrs.tierCapabilities ?? {}) as Record<string, boolean>,
  };
}

/**
 * Express middleware: require the authenticated MSP's tier to have the given
 * capability enabled. Responds with 402 and a structured upgrade prompt on failure.
 *
 * Usage:
 *   router.post("/some-feature", requireRole("MSPOperator"), requirePlanFeature("custom_workflows"), handler);
 */
export function requirePlanFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const mspId = req.user?.mspId;

    // PlatformAdmins and legacy admin role bypass tier gating
    if (req.user?.role === "admin" || req.user?.mspRole === "PlatformAdmin") {
      next();
      return;
    }

    if (!mspId) {
      res.status(403).json({ error: "MSP context required for tier gating" });
      return;
    }

    try {
      const tier = await loadTier(mspId);

      if (!tier) {
        // No subscription row → treat as free/unsubscribed, deny gated features
        res.status(402).json({
          error: "No active platform subscription",
          code: "NO_SUBSCRIPTION",
          upgradeUrl: "/portal/signup",
        });
        return;
      }

      // If subscription is suspended or revoked, deny all gated features
      if (tier.dunningState === "access_revoked" || tier.dunningState === "archival_flagged") {
        res.status(402).json({
          error: "Platform access revoked due to non-payment. Please update your billing details.",
          code: "ACCESS_REVOKED",
        });
        return;
      }

      const capabilities = (tier.tierCapabilities ?? {}) as Record<string, boolean>;

      // A feature is gated only if explicitly set to false in the tier map.
      // Missing key = not gated (available on all tiers).
      if (capabilities[feature] === false) {
        res.status(402).json({
          error: `Feature "${feature}" requires a higher tier`,
          code: "UPGRADE_REQUIRED",
          feature,
          currentTier: tier.tierName,
          upgradeUrl: "/portal/billing/upgrade",
        });
        return;
      }

      next();
    } catch (err) {
      log.error({ err, mspId, feature }, "msp-entitlement: requirePlanFeature failed");
      res.status(500).json({ error: "Entitlement check failed" });
    }
  };
}

/**
 * Counts the MSP's active customer tenants. Single source of truth for the
 * tenant-count query used by allowance checks (including the self-service
 * plan-change downgrade guardrail in msp-plan-self-service.ts).
 */
export async function countActiveTenants(mspId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(mspCustomersTable)
    .where(and(
      eq(mspCustomersTable.mspId, mspId),
      eq(mspCustomersTable.status, "active"),
    ));
  return Number(row?.n ?? 0);
}

/**
 * Checks whether the MSP has exceeded their tenant allowance (hard cap = allowance × 2).
 * Overage is metered — it never hard-blocks onboarding unless the MSP is 2× over.
 *
 * Throws OverageError if the hard cap is hit.
 * Returns { current, allowance, isOverage, overageCount } otherwise.
 */
export async function checkTenantAllowance(mspId: number): Promise<{
  current: number;
  allowance: number;
  isOverage: boolean;
  overageCount: number;
}> {
  const tier = await loadTier(mspId);
  const current = await countActiveTenants(mspId);

  // No subscription or unlimited allowance (0 = unlimited) → always ok
  if (!tier || !tier.tenantAllowance) {
    return { current, allowance: 0, isOverage: false, overageCount: 0 };
  }
  const allowance = tier.tenantAllowance;
  const hardCap = allowance * 2;

  if (current >= hardCap) {
    throw new OverageError(mspId, current, allowance);
  }

  const isOverage = current > allowance;
  const overageCount = isOverage ? current - allowance : 0;
  return { current, allowance, isOverage, overageCount };
}

/**
 * Plan-feature registry.
 *
 * This is the single source of truth for every feature key that can be passed
 * to requirePlanFeature(). Expose via GET /api/admin/plan-features so the
 * Admin Panel can populate the Monitoring Tier "Included Features" multiselect
 * from live data rather than hard-coded constants.
 */
export const PLAN_FEATURE_DEFS: { key: string; label: string; description: string }[] = [
  {
    key: "advanced_signals",
    label: "Advanced Signals",
    description: "Access to advanced tenant signal rules and priority scoring.",
  },
  {
    key: "custom_workflows",
    label: "Custom Workflows",
    description: "Create and manage custom automation workflows.",
  },
  {
    key: "sla_scope_creep_custom_rules",
    label: "SLA / Scope-Creep Custom Rules",
    description: "MSP-authored override rules for the SLA and Scope-Creep engines.",
  },
  {
    key: "sales_offers",
    label: "Sales Offers",
    description: "Sales Offer Engine — rule-driven candidate offer generation.",
  },
  {
    key: "custom_bundle_composition",
    label: "Custom Bundle Composition",
    description: "Compose custom multi-package monitoring bundles.",
  },
];

/**
 * Canonical numeric rank for MSP platform tier names (case-insensitive).
 * Higher number = higher tier.
 *
 * IMPORTANT: only names present here are considered valid required tiers.
 * An unknown required tier name causes compareTierRank() to fail closed.
 */
export const TIER_RANK: Record<string, number> = {
  starter:      0,
  basic:        0,
  pro:          1,
  professional: 1,
  business:     2,
  enterprise:   3,
};

/**
 * Pure comparison of two tier name strings. Exported for unit testing.
 *
 * - `requiredTier` absent/null → ok: true (no gate).
 * - `requiredTier` not in TIER_RANK → ok: false (fail closed — unknown tiers
 *   must not silently pass; add the name to TIER_RANK when a new tier is
 *   introduced to the platform).
 * - `currentTierName` not in TIER_RANK → treated as "starter" (rank 0).
 */
export function compareTierRank(
  currentTierName: string | null | undefined,
  requiredTier: string | null | undefined,
): { ok: true } | { ok: false; currentTier: string; requiredTier: string } {
  if (!requiredTier) return { ok: true };

  const normReq = requiredTier.toLowerCase();
  const currentName = currentTierName ?? "starter";

  if (!(normReq in TIER_RANK)) {
    return { ok: false, currentTier: currentName, requiredTier };
  }

  const current = TIER_RANK[currentName.toLowerCase()] ?? 0;
  const required = TIER_RANK[normReq];

  if (current >= required) return { ok: true };
  return { ok: false, currentTier: currentName, requiredTier };
}

/**
 * Checks whether an MSP's current subscription tier satisfies a minimum
 * tier requirement stored on a service record (`minMspPlanTier`).
 *
 * Returns { ok: true } when satisfied.
 * Returns { ok: false, currentTier, requiredTier } when the MSP must upgrade
 * or when requiredTier names an unrecognised tier (fail closed).
 * Returns { ok: true } when there is no active subscription (no tier = treat as
 * starter, but the caller can separately enforce subscription existence).
 */
export async function checkMspMinTierSatisfied(
  mspId: number,
  requiredTier: string | null | undefined,
): Promise<{ ok: true } | { ok: false; currentTier: string; requiredTier: string }> {
  if (!requiredTier) return { ok: true };

  const tier = await loadTier(mspId);
  return compareTierRank(tier?.tierName, requiredTier);
}

/**
 * Returns the dunning state for an MSP's subscription.
 * Returns null if no subscription or no dunning state is active.
 */
export async function getMspDunningState(mspId: number): Promise<string | null> {
  const [sub] = await db
    .select({ dunningState: mspSubscriptionsTable.dunningState })
    .from(mspSubscriptionsTable)
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);
  return sub?.dunningState ?? null;
}
