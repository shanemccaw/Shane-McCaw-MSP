/**
 * remediation-fix-route.ts — the first-class fix-route resolver (#1539).
 *
 * WHAT A FIX ROUTE IS
 * ───────────────────
 * The Remediation Tracker turns findings into a worked list. The one dimension
 * that governs how every item behaves — the affordance it shows, whether a
 * Change Control can be armed with a runnable pack, what closing it proves — is
 * HOW the fix is actually made. #1539 makes that a first-class value with
 * exactly three shapes (`REMEDIATION_FIX_ROUTE` in @workspace/db):
 *
 *   we_can_run        — the platform executes it (via CR → orchestrator).
 *   you_must_run      — the customer runs the PowerShell themselves.
 *   admin_center_only — no script exists; link out to the admin centre.
 *
 * THE RESOLUTION RULE (the architecture resolved on #1539)
 * ────────────────────────────────────────────────────────
 *   shape = min( what the finding supports , what the tenant permits )
 *
 * The two inputs are independent and neither dominates:
 *
 *   FINDING side — a per-check ceiling. `remediation_knowledge_base.
 *     fix_route_capability` is the authored floor; a LIVE config pack mapping
 *     the check RAISES it to `we_can_run` even if the column lags (so the column
 *     can never be a false cap). A check with no script at all is
 *     `admin_center_only` and no tenant consent can lift it — there is nothing
 *     to run.
 *
 *   TENANT side — a ceiling from `tenants.consent.writeBack.status`. `granted`
 *     permits `we_can_run`; anything else caps at `you_must_run`. A write-denied
 *     tenant is a FIRST-CLASS posture, not a degraded one: a fully-automatable
 *     finding legitimately renders as "you run it" for a tenant that follows
 *     step-by-step instructions instead of granting write (the "NASA" posture).
 *
 * `min` over the rank (we_can_run 2 > you_must_run 1 > admin_center_only 0) is
 * what makes "automatable finding + write-denied tenant = you_must_run" and
 * "admin-centre-only finding + any tenant = admin_center_only" both fall out of
 * one rule.
 *
 * NOTE ON THE CHANGE CONTROL. Route determines EVIDENCE, never whether a CR is
 * required — the CR is constant across all three shapes. This module resolves
 * the shape only; it does not decide, arm, or skip a Change Control.
 */

import { REMEDIATION_FIX_ROUTE, type RemediationFixRoute, type TenantConsentMap } from "@workspace/db";

/**
 * Rank, most-automated first. Load-bearing: the whole model is a `min()` over
 * this order, so the array's order in @workspace/db and this map must agree.
 */
const FIX_ROUTE_RANK: Record<RemediationFixRoute, number> = {
  we_can_run: 2,
  you_must_run: 1,
  admin_center_only: 0,
};

/** Numeric rank of a shape (2 = most automated). */
export function fixRouteRank(route: RemediationFixRoute): number {
  return FIX_ROUTE_RANK[route];
}

/** The less-automated of two shapes — the core of the resolution rule. */
export function minFixRoute(a: RemediationFixRoute, b: RemediationFixRoute): RemediationFixRoute {
  return FIX_ROUTE_RANK[a] <= FIX_ROUTE_RANK[b] ? a : b;
}

/** The more-automated of two shapes — used to RAISE the authored floor with a live pack. */
export function maxFixRoute(a: RemediationFixRoute, b: RemediationFixRoute): RemediationFixRoute {
  return FIX_ROUTE_RANK[a] >= FIX_ROUTE_RANK[b] ? a : b;
}

/**
 * The tenant-side ceiling. `granted` is the ONLY write-back status that permits
 * the platform to run a fix on the customer's behalf — pending / declined /
 * revoked / absent all cap at `you_must_run`, matching the fail-closed gate in
 * `graph.ts` (`WriteConsentRequiredError`) and the orchestrator's
 * `customer_write_consent_missing`. A denied tenant is never dropped below
 * `you_must_run`: they can always run the script themselves.
 */
export function resolveTenantWriteCeiling(consent: TenantConsentMap | null | undefined): RemediationFixRoute {
  return consent?.writeBack?.status === "granted" ? "we_can_run" : "you_must_run";
}

/**
 * The finding-side ceiling for one check. The authored capability is the floor;
 * a live config pack that maps the check raises it to `we_can_run`. An
 * admin-centre-only check with no live pack stays `admin_center_only` — nothing
 * to run means no tenant consent can lift it.
 */
export function resolveFindingCeiling(input: {
  /** `remediation_knowledge_base.fix_route_capability`, or null when no KB row exists. */
  capability: RemediationFixRoute | null | undefined;
  /** A live, execution-ready config pack maps this check (see `config_pack_templates`). */
  writePackAvailable: boolean;
}): RemediationFixRoute {
  const authored: RemediationFixRoute = input.capability ?? "admin_center_only";
  return input.writePackAvailable ? maxFixRoute(authored, "we_can_run") : authored;
}

/**
 * Resolve one item's shape: `min(findingCeiling, tenantCeiling)`. This is the
 * single entry point the wire contract and every downstream module use to learn
 * "what kind of item is this, for this tenant".
 */
export function resolveFixRoute(input: {
  capability: RemediationFixRoute | null | undefined;
  writePackAvailable: boolean;
  consent: TenantConsentMap | null | undefined;
}): RemediationFixRoute {
  const findingCeiling = resolveFindingCeiling({ capability: input.capability, writePackAvailable: input.writePackAvailable });
  const tenantCeiling = resolveTenantWriteCeiling(input.consent);
  return minFixRoute(findingCeiling, tenantCeiling);
}

/**
 * The affordance a shape maps to — the single fact a downstream surface needs to
 * know how the item's primary control behaves. Kept here, next to the shapes, so
 * the button's meaning is defined once rather than re-derived per surface.
 *
 *   execute — the platform runs the fix (button DOES it, through a CR).
 *   copy    — the customer runs the script (button COPIES the PowerShell).
 *   link    — no script; open the admin-centre screen with instructions.
 */
export const FIX_ROUTE_AFFORDANCE: Record<RemediationFixRoute, "execute" | "copy" | "link"> = {
  we_can_run: "execute",
  you_must_run: "copy",
  admin_center_only: "link",
};

/** Every shape, in rank order — for exhaustiveness checks and stable wire enumeration. */
export const FIX_ROUTES: readonly RemediationFixRoute[] = REMEDIATION_FIX_ROUTE;
