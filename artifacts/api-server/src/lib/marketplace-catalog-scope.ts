/**
 * Which slice of the purchasable catalog a caller may browse (#3590, part of #1696).
 *
 * `portal-marketplace.ts` and `portal-customer-search.ts` each carried their own copy of
 * `role === "Assessment" ? ASSESSMENT_SERVICE_TYPES : CUSTOMER_SERVICE_TYPES` — a raw
 * role-string comparison deciding what a customer can see, which is exactly the shape
 * #1696 exists to remove. #3590 folded `Assessment` into `Free` (one pre-payment tier)
 * and, rather than swap the string, moved the decision onto the capability model:
 * holding `customer:marketplace.browse-full` is what unlocks the full catalog.
 *
 * The platform mapping row grants it to the paid `Customer` rung and every rung above
 * it, so a prospect gains it the moment payment promotes them from `Free` to `Customer`
 * (`promoteMspUserToCustomer`) — no code path has to remember to grant it. A customer
 * org can narrow it for its own roles like any other customer capability.
 */

import { userHasCapability } from "../middlewares/rbac-capability";
import type { AuthUser } from "../middlewares/requireAuth";

/** The customer-system capability that unlocks the full catalog. */
export const FULL_CATALOG_CAPABILITY = "marketplace.browse-full";

/** What a caller without the capability browses: the assessment family + the monitoring upsell. */
export const PRE_PAYMENT_SERVICE_TYPES = ["assessment", "monitoring_tier"] as const;

/** What a caller holding the capability browses: the pre-payment set plus micro-offers/projects and retainers. */
export const CUSTOMER_SERVICE_TYPES = [
  "assessment",
  "monitoring_tier",
  "micro_offer",
  "retainer",
] as const;

export type CatalogScope =
  | { readonly kind: "full"; readonly serviceTypes: readonly string[] }
  | { readonly kind: "pre-payment"; readonly serviceTypes: readonly string[] }
  /** The RBAC model could not be consulted — not a denial, so the caller decides how to fail. */
  | { readonly kind: "unavailable"; readonly reason: string };

/** Resolve the caller's catalog scope from the capability model, read live. */
export async function resolveCatalogScope(
  user: Pick<AuthUser, "id" | "role" | "mspRole" | "mspId" | "customerId">,
): Promise<CatalogScope> {
  const outcome = await userHasCapability(user, "customer", FULL_CATALOG_CAPABILITY);
  if (outcome.kind === "allow") return { kind: "full", serviceTypes: CUSTOMER_SERVICE_TYPES };
  if (outcome.kind === "deny") return { kind: "pre-payment", serviceTypes: PRE_PAYMENT_SERVICE_TYPES };
  return { kind: "unavailable", reason: outcome.reason };
}
