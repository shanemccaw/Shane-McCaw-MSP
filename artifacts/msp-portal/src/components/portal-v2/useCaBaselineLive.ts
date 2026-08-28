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

/** Entra ID P2 ships standalone as AAD_PREMIUM_P2, or bundled into higher SKUs that also carry P2 rights. */
const P2_SKU_PART_NUMBERS = ["AAD_PREMIUM_P2", "EMSPREMIUM", "SPE_E5", "M365_E5", "IDENTITY_THREAT_PROTECTION"];

function usableItems(detail: WireCheckItemDetail | undefined): readonly Record<string, unknown>[] | null {
  if (!detail || detail.status !== "ok" || detail.itemsOmitted || !Array.isArray(detail.items)) return null;
  return detail.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
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
          const skuPartNumbers = rawSkus.map((r) => (typeof r["skuPartNumber"] === "string" ? r["skuPartNumber"] : ""));
          setHasEntraP2(skuPartNumbers.some((s) => P2_SKU_PART_NUMBERS.includes(s)));
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
