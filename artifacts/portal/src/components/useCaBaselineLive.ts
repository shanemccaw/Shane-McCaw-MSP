/**
 * useCaBaselineLive.ts — the real per-policy data seam for the Conditional
 * Access baseline drill-down (Git #1232).
 *
 * `PillarLiveSource.tsx`'s header previously documented the CA policy rows as
 * having "no per-item server producer" (#1204). That was true when written but
 * is no longer: `identity:ca-policy-count` (real `id`/`displayName`/`state`
 * per CA policy) and `license:sku-utilization` (real `subscribedSkus`, for the
 * Entra ID P2 badge) are both collected on every real scan by the item-detail
 * pass (#339/`item-detail-collector.ts`) and already reachable read-only via
 * `GET /api/portal/tenant-check-items` (#776) — the same route the Full
 * Remediation Guide's fillable scripts (#782) already read
 * `identity:ca-policy-count` through for its own s9 placeholder.
 *
 * This hook is a second, independent caller of that same route (batched, one
 * request for both check keys) — it does not touch or depend on
 * `useTenantCheckItems.ts`, which is scoped to the copilot-journey's five
 * fillable-script check keys.
 */
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const TENANT_CHECK_ITEMS_URL = "/api/portal/tenant-check-items";
const CA_POLICY_COUNT_CHECK_KEY = "identity:ca-policy-count";
const LICENSE_SKU_CHECK_KEY = "license:sku-utilization";

export interface LiveCaPolicy {
  readonly id: string;
  readonly displayName: string;
  readonly state: string;
}

interface WireCheckItemDetail {
  readonly status: string;
  readonly items: readonly unknown[] | null;
  readonly itemsOmitted: boolean;
}

interface WireTenantCheckItemsPayload {
  readonly items?: Readonly<Record<string, WireCheckItemDetail>>;
}

/**
 * Entra ID P2 ships as the `AAD_PREMIUM_P2` SERVICE PLAN, bundled inside many
 * skuPartNumbers (standalone AAD_PREMIUM_P2, EMS E5, Microsoft 365 E5, and
 * every E5-family/EDU/GOV variant of those) — a skuPartNumber allowlist can
 * never enumerate them all and drifts the moment Microsoft ships a new SKU
 * name for the same bundle (Git #4548, same defect class as #4512/#4534/#4535
 * fixed server-side in license-gate.ts's getProvisionedServicePlanNamesForTenant).
 */
const ENTRA_P2_SERVICE_PLAN_NAME = "AAD_PREMIUM_P2";

/** Mirrors license-gate.ts's USABLE_SKU_CAPABILITY_STATUSES: `Warning` is the post-expiry grace period, during which every feature still works. */
const USABLE_SKU_CAPABILITY_STATUSES = new Set(["Enabled", "Warning"]);

function usableItems(detail: WireCheckItemDetail | undefined): readonly Record<string, unknown>[] | null {
  if (!detail || detail.status !== "ok" || detail.itemsOmitted || !Array.isArray(detail.items)) return null;
  return detail.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

/**
 * True iff this raw `subscribedSkus` row's own SKU is usable and it provisions
 * the Entra ID P2 service plan — the same rule as license-gate.ts's
 * getProvisionedServicePlanNamesForTenant, applied to one row instead of
 * accumulating a tenant-wide set.
 */
function skuProvisionsEntraP2(row: Record<string, unknown>): boolean {
  const capabilityStatus = typeof row["capabilityStatus"] === "string" ? row["capabilityStatus"] : "";
  if (!USABLE_SKU_CAPABILITY_STATUSES.has(capabilityStatus)) return false;
  const servicePlans = Array.isArray(row["servicePlans"]) ? row["servicePlans"] : [];
  return servicePlans.some(
    (plan) =>
      !!plan &&
      typeof plan === "object" &&
      (plan as Record<string, unknown>)["servicePlanName"] === ENTRA_P2_SERVICE_PLAN_NAME &&
      (plan as Record<string, unknown>)["provisioningStatus"] === "Success",
  );
}

function toLivePolicy(row: Record<string, unknown>): LiveCaPolicy | null {
  const id = typeof row["id"] === "string" ? row["id"] : null;
  const displayName = typeof row["displayName"] === "string" ? row["displayName"] : null;
  const state = typeof row["state"] === "string" ? row["state"] : null;
  if (!id || !displayName || !state) return null;
  return { id, displayName, state };
}

export interface CaBaselineLiveState {
  /** Null until the check has genuinely run for this tenant and returned usable rows. */
  readonly policies: readonly LiveCaPolicy[] | null;
  /** Null until the SKU check has genuinely run and returned usable rows. */
  readonly hasEntraP2: boolean | null;
  /** True once a first response (success or failure) has arrived. */
  readonly loaded: boolean;
}

export function useCaBaselineLive(): CaBaselineLiveState {
  const { fetchWithAuth } = useAuth();
  const [policies, setPolicies] = useState<readonly LiveCaPolicy[] | null>(null);
  const [hasEntraP2, setHasEntraP2] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const checkKeys = [CA_POLICY_COUNT_CHECK_KEY, LICENSE_SKU_CHECK_KEY].join(",");
        const res = await fetchRef.current(
          `${TENANT_CHECK_ITEMS_URL}?checkKeys=${encodeURIComponent(checkKeys)}`,
          undefined,
          { silent: true },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as WireTenantCheckItemsPayload;
        if (cancelled) return;

        const rawPolicies = usableItems(body.items?.[CA_POLICY_COUNT_CHECK_KEY]);
        if (rawPolicies) {
          setPolicies(rawPolicies.map(toLivePolicy).filter((p): p is LiveCaPolicy => p !== null));
        }

        const rawSkus = usableItems(body.items?.[LICENSE_SKU_CHECK_KEY]);
        if (rawSkus) {
          setHasEntraP2(rawSkus.some(skuProvisionsEntraP2));
        }
      } catch {
        // best-effort — stays null; the page renders an honest empty state (Git #1439)
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { policies, hasEntraP2, loaded };
}
