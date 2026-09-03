/**
 * platform-tier.ts
 *
 * Shared discriminator for "is this services row a real MSP platform subscription
 * tier" (Free/Growth/Pro), used everywhere a route needs to list or look up
 * platform tiers rather than the full product catalog.
 *
 * Extracted from msp-signup.ts (Git #2509) after the identical gap was found
 * duplicated — and left unfixed — in msp-plan-self-service.ts and
 * msp-plan-management.ts (Git #2701). Those two files filtered on the legacy
 * `fulfillmentType` column alone, which the real seeded tiers do NOT carry
 * ("manual", not "msp_monthly_subscription") — so both surfaces returned zero
 * tiers against live data. Import from here instead of re-deriving this logic
 * in a fourth place.
 */

import { and, eq, or, type SQL } from "drizzle-orm";
import { servicesTable } from "@workspace/db";

/**
 * A genuine platform tier's fulfillmentType/fulfillmentTypeKey lifecycle value is
 * "msp_monthly_subscription" — but that value alone isn't sufficient (Git #2509):
 * an add-on row (e.g. launch-control-plus-addon) can carry it too, either directly
 * on the legacy fulfillmentType column or by future miscategorization. Add-on rows
 * are distinguished by typeAttributes carrying addOnType / grantsCapabilityKey —
 * a real platform tier never has either. Excluding on that shape, rather than on
 * `tier IS NOT NULL`, is deliberate: the three real seeded tiers (msp-platform-free/
 * -growth/-pro) also have a NULL `tier` column, so gating on it would 400 them too.
 */
export function isGenuinePlatformTier(typeAttributes: unknown): boolean {
  const attrs = (typeAttributes ?? {}) as Record<string, unknown>;
  return attrs["addOnType"] == null && attrs["grantsCapabilityKey"] == null;
}

/**
 * SQL predicate for "this row's fulfillment lifecycle is msp_monthly_subscription".
 *
 * The fulfillmentTypeKey OR-arm is a safety net for tier rows whose enum column
 * silently defaulted to "standard" (e.g. the admin bulk-import path inserts
 * fulfillmentType ?? "standard") — the lifecycle key "msp_monthly_subscription"
 * is only ever assigned to platform tiers, so widening on it can't pull in
 * non-tier rows. This is a SQL-level filter only — callers still need to apply
 * `isGenuinePlatformTier()` to the fetched rows' `typeAttributes` to exclude
 * add-on grants that share the same lifecycle key.
 */
export function platformTierFulfillmentPredicate(): SQL {
  return or(
    eq(servicesTable.fulfillmentType, "msp_monthly_subscription"),
    eq(servicesTable.fulfillmentTypeKey, "msp_monthly_subscription"),
  )!;
}

/** Combines the fulfillment predicate above with additional AND-ed conditions. */
export function platformTierWhere(...extra: SQL[]): SQL {
  return and(platformTierFulfillmentPredicate(), ...extra)!;
}
