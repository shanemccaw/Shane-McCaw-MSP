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
      tenantAllowance: servicesTable.tenantAllowance,
      aiCreditAllowance: servicesTable.aiCreditAllowance,
      overageRateCents: servicesTable.overageRateCents,
      tierCapabilities: servicesTable.tierCapabilities,
      tierName: servicesTable.name,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
    .where(eq(mspSubscriptionsTable.mspId, mspId))
    .limit(1);
  return sub ?? null;
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
      logger.error({ err, mspId, feature }, "msp-entitlement: requirePlanFeature failed");
      res.status(500).json({ error: "Entitlement check failed" });
    }
  };
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

  // No subscription or unlimited allowance (0 = unlimited) → always ok
  if (!tier || !tier.tenantAllowance) {
    const [row] = await db
      .select({ n: count() })
      .from(mspCustomersTable)
      .where(and(
        eq(mspCustomersTable.mspId, mspId),
        eq(mspCustomersTable.status, "active"),
      ));
    const current = Number(row?.n ?? 0);
    return { current, allowance: 0, isOverage: false, overageCount: 0 };
  }

  const [row] = await db
    .select({ n: count() })
    .from(mspCustomersTable)
    .where(and(
      eq(mspCustomersTable.mspId, mspId),
      eq(mspCustomersTable.status, "active"),
    ));
  const current = Number(row?.n ?? 0);
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
