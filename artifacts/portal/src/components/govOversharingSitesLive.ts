/**
 * govOversharingSitesLive.ts — the Overshared SharePoint drill-down's
 * "Affected Sites" list, off real per-site named-identity data (#1286).
 *
 *   GET /api/portal/oversharing/sites?checkKey=...
 *
 * served by `routes/portal-oversharing-sites.ts`, which groups the same
 * `overshared_items` rows the bulk page reads by site and resolves named
 * admins/guests off the `user`/`guest` grant rows #1286 landed.
 *
 * Same `dataState` convention as `oversharingItemsLive.ts` / `alertPrefsLive.ts`:
 * "live" once a real response has landed (even a genuinely empty list), never
 * on a request that failed. On failure the page falls back to the
 * `OVERSHARING_SITES` fixture, same as it always has.
 */

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const SITES_URL = "/api/portal/oversharing/sites";

export interface OversharingSitePerson {
  readonly name: string;
  readonly upn: string;
  readonly role?: string;
}

export interface OversharingSiteWire {
  readonly id: string;
  readonly name: string | null;
  readonly url: string | null;
  readonly visibility: string | null;
  readonly isPersonalSite: boolean;
  readonly context: string;
  readonly sharingLevels: readonly string[];
  readonly admins: readonly OversharingSitePerson[];
  readonly guests: readonly OversharingSitePerson[];
  readonly status: "open" | "accepted";
}

interface OversharingSitesResponse {
  readonly sites: readonly OversharingSiteWire[];
  readonly runId: string | null;
}

export interface OversharingSitesLiveState {
  readonly sites: readonly OversharingSiteWire[];
  readonly loading: boolean;
  /** "live" once a real response has landed (even if genuinely empty). */
  readonly dataState: "live" | "fixture";
}

export function useOversharingSitesLive(checkKey?: string): OversharingSitesLiveState {
  const { fetchWithAuth } = useAuth();
  const [sites, setSites] = useState<readonly OversharingSiteWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataState, setDataState] = useState<"live" | "fixture">("fixture");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = checkKey ? `?checkKey=${encodeURIComponent(checkKey)}` : "";
        const res = await fetchWithAuth(`${SITES_URL}${params}`, undefined, { silent: true });
        if (!res.ok) throw new Error(`oversharing sites ${res.status}`);
        const body = (await res.json()) as OversharingSitesResponse;
        if (cancelled) return;
        setSites(body.sites ?? []);
        setDataState("live");
      } catch {
        if (cancelled) return;
        setSites([]);
        setDataState("fixture");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  return { sites, loading, dataState };
}
