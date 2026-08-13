/**
 * useTenantCheckItems.ts — Git #782 (Phase 2 of 2, epic #647).
 *
 * Fetches the raw per-item detail behind the Full Remediation Guide's five
 * fillable scripts (#776's `GET /api/portal/tenant-check-items`), so
 * `remediationScriptParams.ts::applyLiveScriptParams()` has real data to read
 * a placeholder's value off. One batched call for all five check keys — the
 * route was built batched for exactly this caller (see its own header).
 *
 * Same shape as `useRemediationTracker.ts`: loads once, exposes `loaded`/
 * `error`, never throws into the render tree. Unlike the tracker this is
 * read-only — there is nothing here to write back.
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";
import { FILLABLE_STEP_CHECK_KEYS, type CheckItemDetail, type CheckItemsByKey } from "./remediationScriptParams.ts";

const TENANT_CHECK_ITEMS_URL = "/api/portal/tenant-check-items";

/** Same channel the rest of the journey beacons on (see useCopilotJourney.ts). */
const JOURNEY_CHANNEL = "engine.dashboard";

/** The five check keys #782 confirmed fillable — one batched call covers all of them. */
const FILLABLE_CHECK_KEYS: readonly string[] = Array.from(new Set(Object.values(FILLABLE_STEP_CHECK_KEYS)));

interface WireTenantCheckItemsPayload {
  readonly items?: Readonly<Record<string, CheckItemDetail>>;
}

export interface TenantCheckItemsState {
  /** Keyed by check key. Empty until the first response lands. */
  readonly items: CheckItemsByKey;
  /** True once a first payload has arrived — success or failure. */
  readonly loaded: boolean;
  /** Set when the fetch failed outright; `items` stays whatever it last held (empty on a first-load failure). */
  readonly error: string | null;
}

const EMPTY_ITEMS: CheckItemsByKey = {};

export function useTenantCheckItems(options?: { readonly enabled?: boolean }): TenantCheckItemsState {
  const enabled = options?.enabled !== false;
  const { fetchWithAuth, accessToken } = useAuth();

  const [items, setItems] = useState<CheckItemsByKey>(EMPTY_ITEMS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same ref discipline as useRemediationTracker.ts: `fetchWithAuth` is rebuilt
  // on every access-token refresh, and reading it through a ref keeps a
  // refresh from re-firing the load.
  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const url = `${TENANT_CHECK_ITEMS_URL}?checkKeys=${FILLABLE_CHECK_KEYS.map(encodeURIComponent).join(",")}`;
        // `silent`: a script staying as a placeholder is a graceful degrade,
        // not a failure worth a global toast — the guide renders correctly
        // either way, same reasoning useRemediationTracker.ts's own load uses.
        const res = await fetchRef.current(url, undefined, { silent: true });
        if (!res.ok) throw new Error(`tenant-check-items ${res.status}`);
        const body = (await res.json()) as WireTenantCheckItemsPayload;
        if (cancelled) return;
        setItems(body?.items ?? EMPTY_ITEMS);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        reportClientEvent(tokenRef.current, "TenantCheckItemsLoadFailed", message, JOURNEY_CHANNEL);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { items, loaded, error };
}
