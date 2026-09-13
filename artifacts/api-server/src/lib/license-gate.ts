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
 * The live SKU read follows the same pattern already proven in
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

interface GraphSubscribedSku {
  skuPartNumber?: string;
  capabilityStatus?: string;
}

interface GraphSubscribedSkusPage {
  value?: GraphSubscribedSku[];
}

export interface TenantLicenseSkuResult {
  /** The tenant's currently-enabled skuPartNumber values, lowercased-free (Graph's own casing). Empty on error. */
  skuPartNumbers: Set<string>;
  /** Set only when the read failed — callers should treat this as "unknown," not "no licenses," when deciding how to render it. */
  error: string | null;
}

const SUBSCRIBED_SKU_CACHE_TTL_MS = 60_000;
const subscribedSkuCache = new Map<string, { value: TenantLicenseSkuResult; expiresAt: number }>();

/**
 * The tenant's real, live, currently-enabled `skuPartNumber` set, read
 * straight from Microsoft Graph `/subscribedSkus` (never from a stored
 * monitoring snapshot, which can be stale or entirely absent for a
 * never-scanned tenant — not acceptable for an execute-time precondition
 * gate). Never throws: a read failure comes back on `.error` so a caller
 * fails closed (treats the requirement as unsatisfied) rather than rendering
 * a falsely-green "included" state it can't actually back up.
 */
export async function getSubscribedSkuPartNumbersForTenant(tenantId: string): Promise<TenantLicenseSkuResult> {
  const cached = subscribedSkuCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  try {
    const res = await graphFetchForTenant(tenantId, "/subscribedSkus?$select=skuPartNumber,capabilityStatus");
    if (!res.ok) {
      const text = await res.text();
      log.warn({ tenantId, status: res.status, body: text.slice(0, 400) }, "license-gate: /subscribedSkus call failed");
      return { skuPartNumbers: new Set(), error: `Graph /subscribedSkus returned ${res.status}` };
    }
    const body = (await res.json()) as GraphSubscribedSkusPage;
    const skuPartNumbers = new Set(
      (body.value ?? [])
        .filter((sku) => sku.capabilityStatus === "Enabled" && typeof sku.skuPartNumber === "string")
        .map((sku) => sku.skuPartNumber as string),
    );
    const value: TenantLicenseSkuResult = { skuPartNumbers, error: null };
    subscribedSkuCache.set(tenantId, { value, expiresAt: Date.now() + SUBSCRIBED_SKU_CACHE_TTL_MS });
    return value;
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      return { skuPartNumbers: new Set(), error: "Admin consent for this tenant has been revoked or was never granted" };
    }
    if (err instanceof LicenseGapError) {
      // A license gap on reading /subscribedSkus itself would be unusual —
      // that read requires only Organization.Read.All — but handle it the
      // same honest way rather than letting it propagate as an unhandled 500.
      return { skuPartNumbers: new Set(), error: `Graph reported a license gap reading /subscribedSkus: ${err.feature}` };
    }
    log.warn({ err, tenantId }, "license-gate: getSubscribedSkuPartNumbersForTenant unexpected error");
    return { skuPartNumbers: new Set(), error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The single clean membership check, shared by server-side execute
 * enforcement and the GET listing's availability computation — ANY ONE of
 * `requiredSkus` present (and Enabled) in `tenantSkuPartNumbers` satisfies
 * the gate. No requirement at all (null/empty) always passes.
 */
export function tenantHasRequiredLicense(
  requiredSkus: readonly string[] | null | undefined,
  tenantSkuPartNumbers: ReadonlySet<string>,
): boolean {
  if (!requiredSkus || requiredSkus.length === 0) return true;
  return requiredSkus.some((sku) => tenantSkuPartNumbers.has(sku));
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
  const known = requiredSkus.map((sku) => LICENSE_SKU_DISPLAY[sku]);
  const allKnown = known.every((k): k is { family: string; label: string } => Boolean(k));
  if (allKnown && new Set(known.map((k) => k!.family)).size === 1) {
    return `Requires ${known[0]!.family} ${known.map((k) => k!.label).join(" or ")}`;
  }
  return `Requires ${requiredSkus.join(" or ")}`;
}
