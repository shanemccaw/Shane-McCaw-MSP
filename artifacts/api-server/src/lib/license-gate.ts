/**
 * license-gate.ts
 *
 * Git #3947 — the proactive counterpart to #3937's reactive fix. #3937 made a
 * license-gated Graph WRITE that already fired classify cleanly as
 * `errorType: "license_gap"` instead of a raw 403; this module lets a caller
 * check BEFORE ever attempting that write (or before showing an action as
 * available at all) whether the customer's tenant actually holds one of a
 * catalog row's `required_license_skus`.
 *
 * Git #4535 — that check is made against the tenant's provisioned SERVICE
 * PLANS, never its skuPartNumbers. The first version of this gate compared
 * `required_license_skus` against skuPartNumbers, so a tenant holding Entra ID
 * P1 through a bundle (Microsoft 365 E3/E5, Business Premium, EMS) read as
 * unlicensed and every Conditional Access write was blocked. The catalog's
 * values (`AAD_PREMIUM`, `AAD_PREMIUM_P2`) are real servicePlanNames as well as
 * standalone skuPartNumbers, so the plan set answers for both.
 *
 * The live read follows the same pattern already proven in
 * `account-security-graph.ts`'s `getDeviceComplianceSignal` (a real-time
 * `/subscribedSkus` precondition check before a Graph call that would
 * otherwise fail with an unhelpful error) — reused here rather than
 * duplicated, and built on `graphFetchForTenant` (graph.ts) so it inherits
 * that transport's consent-revocation and retry handling for free.
 *
 * Cached per tenant with the same short-TTL `Map` pattern as
 * `getGrantedWriteAppPermissionsForTenant` (graph.ts) — Launch Control's own
 * dispatch note calls for "fetch once per session/tenant-load, not once per
 * action, don't hammer Graph per action-picker render." A short TTL (rather
 * than no expiry) means a license purchased mid-session is reflected on the
 * technician's very next action, not just the next full page load.
 */

import { graphFetchForTenant, ConsentRevokedError, LicenseGapError } from "./graph.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "integration.azure" });

const SUBSCRIBED_SKU_CACHE_TTL_MS = 60_000;

interface GraphServicePlan {
  servicePlanName?: string;
  provisioningStatus?: string;
}

interface GraphSubscribedSkuWithPlans {
  capabilityStatus?: string;
  servicePlans?: GraphServicePlan[];
}

interface GraphSubscribedSkusWithPlansPage {
  value?: GraphSubscribedSkuWithPlans[];
  "@odata.nextLink"?: string;
}

export interface TenantServicePlanResult {
  /** `servicePlanName` of every provisioned plan across the tenant's usable SKUs. Empty on error. */
  servicePlanNames: Set<string>;
  /** Set only when the read failed — callers must treat this as "unknown," never as "unlicensed". */
  error: string | null;
}

/**
 * SKU states whose service plans the tenant can actually use. `Warning` is the
 * post-expiry grace period, during which every feature still works.
 */
const USABLE_SKU_CAPABILITY_STATUSES = new Set(["Enabled", "Warning"]);

const servicePlanCache = new Map<string, { value: TenantServicePlanResult; expiresAt: number }>();

/**
 * Git #4512 — the tenant's live, provisioned service plan names.
 *
 * A capability like Entra ID P1 ships as a SERVICE PLAN (`AAD_PREMIUM`) bundled
 * inside many SKUs — Microsoft 365 E3/E5 (`SPE_E3`/`SPE_E5`), Business Premium
 * (`SPB`), EMS — not only as the standalone `AAD_PREMIUM` SKU. A skuPartNumber
 * membership test reads every one of those bundles as unlicensed, so a monitor
 * check's license prerequisite (#4512), Launch Control's action gate and a
 * Config Pack's license precondition (#4535) are all tested against service
 * plans instead.
 *
 * "Provisioned" is the one condition settled on #1516 and already used by
 * tenant-workloads.ts and account-security-graph.ts: `provisioningStatus ===
 * "Success"`. Read straight from Graph, never from a stored monitoring
 * snapshot, which can be stale or entirely absent for a never-scanned tenant —
 * not acceptable for an execute-time precondition. Cached per tenant for a
 * short TTL so a listing render or package run makes one call. Never throws: a
 * failed or paged read comes back on `.error`, and callers fail closed on it
 * rather than rendering a smaller, falsely unlicensed (or falsely included)
 * estate.
 */
export async function getProvisionedServicePlanNamesForTenant(tenantId: string): Promise<TenantServicePlanResult> {
  const cached = servicePlanCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const res = await graphFetchForTenant(tenantId, "/subscribedSkus?$select=capabilityStatus,servicePlans");
    if (!res.ok) {
      const text = await res.text();
      log.warn({ tenantId, status: res.status, body: text.slice(0, 400) }, "license-gate: /subscribedSkus service plan read failed");
      return { servicePlanNames: new Set(), error: `Graph /subscribedSkus returned ${res.status}` };
    }
    const body = (await res.json()) as GraphSubscribedSkusWithPlansPage;
    if (typeof body["@odata.nextLink"] === "string" && body["@odata.nextLink"].length > 0) {
      return { servicePlanNames: new Set(), error: "Graph /subscribedSkus returned a paged response, so its service plan estate would be incomplete" };
    }
    const servicePlanNames = new Set<string>();
    for (const sku of body.value ?? []) {
      if (!USABLE_SKU_CAPABILITY_STATUSES.has(sku.capabilityStatus ?? "")) continue;
      for (const plan of sku.servicePlans ?? []) {
        if (plan.provisioningStatus === "Success" && typeof plan.servicePlanName === "string") {
          servicePlanNames.add(plan.servicePlanName);
        }
      }
    }
    const value: TenantServicePlanResult = { servicePlanNames, error: null };
    servicePlanCache.set(tenantId, { value, expiresAt: Date.now() + SUBSCRIBED_SKU_CACHE_TTL_MS });
    return value;
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      return { servicePlanNames: new Set(), error: "Admin consent for this tenant has been revoked or was never granted" };
    }
    if (err instanceof LicenseGapError) {
      return { servicePlanNames: new Set(), error: `Graph reported a license gap reading /subscribedSkus: ${err.feature}` };
    }
    log.warn({ err, tenantId }, "license-gate: getProvisionedServicePlanNamesForTenant unexpected error");
    return { servicePlanNames: new Set(), error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The single clean membership check, shared by server-side execute
 * enforcement and the GET listing's availability computation — ANY ONE of
 * `requiredSkus` present in `tenantServicePlanNames` (from
 * getProvisionedServicePlanNamesForTenant) satisfies the gate. No requirement
 * at all (null/empty) always passes.
 */
export function tenantHasRequiredLicense(
  requiredSkus: readonly string[] | null | undefined,
  tenantServicePlanNames: ReadonlySet<string>,
): boolean {
  if (!requiredSkus || requiredSkus.length === 0) return true;
  return requiredSkus.some((sku) => tenantServicePlanNames.has(sku));
}

// Known display names for the SKU part numbers this platform actually gates
// on today. An unrecognized skuPartNumber falls back to its raw string
// rather than guessing a label — never invent a display name for a SKU this
// wasn't told about.
const LICENSE_SKU_DISPLAY: Record<string, { family: string; label: string }> = {
  AAD_PREMIUM: { family: "Microsoft Entra ID", label: "P1" },
  AAD_PREMIUM_P2: { family: "Microsoft Entra ID", label: "P2" },
};

/**
 * A customer-safe, human-readable description of a license requirement, e.g.
 * `["AAD_PREMIUM", "AAD_PREMIUM_P2"]` → "Requires Microsoft Entra ID P1 or P2".
 * Used both for the UI's "License required" reason text and the server's
 * 409 error message on the execute route, so the two always say the same
 * thing.
 */
export function describeRequiredLicense(requiredSkus: readonly string[]): string {
  return `Requires ${licenseFeatureName(requiredSkus)}`;
}

/**
 * The bare feature name behind describeRequiredLicense, e.g. "Microsoft Entra
 * ID P1 or P2" — for callers that supply their own verb, such as a
 * LicenseGapError's `feature` (executeMonitorCheck prefixes "Requires "). The
 * Entra ID keys above are both real skuPartNumbers and real servicePlanNames,
 * so this reads either vocabulary.
 */
export function licenseFeatureName(requiredSkus: readonly string[]): string {
  const known = requiredSkus.map((sku) => LICENSE_SKU_DISPLAY[sku]);
  const allKnown = known.every((k): k is { family: string; label: string } => Boolean(k));
  if (allKnown && new Set(known.map((k) => k!.family)).size === 1) {
    return `${known[0]!.family} ${known.map((k) => k!.label).join(" or ")}`;
  }
  return requiredSkus.join(" or ");
}
