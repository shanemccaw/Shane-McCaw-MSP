/**
 * useGovAreaLinksLive.ts — real-data seam for the Governance page's
 * `GOV_AREA_LINKS` cluster/area-card grid (Git #1333).
 *
 * `govDashboardData.ts` shipped all 14 area cards' score/prevScore/status as a
 * design fixture — confident fake numbers on a never-scanned tenant (#1330).
 * Ten of them have a real, active `monitor_checks` check behind them; this hook
 * reads the tenant's real counts (latest scan value + previous-scan delta +
 * derived severity) for those ten from
 *
 *   GET /api/portal/governance/areas
 *
 * served by `routes/portal-governance-areas.ts`. The page overlays the result
 * onto the fixture per card key, and renders an honest "—" for any card the
 * response has no live data for — the four with no backing check today
 * (External Sharing Drift, pending #1287; and the three Devices cards), plus
 * every card on an unscanned tenant.
 *
 * Same plain-fetch shape as `complianceObligationsLive.ts`: `fetchWithAuth`,
 * silent, best-effort. A 403 (Assessment-role gate) or any error leaves the map
 * empty and every card falls back to the honest no-data state.
 */

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import type { GovAreaStatus } from "./govDashboardData";

const AREAS_URL = "/api/portal/governance/areas";

/** One card's real values, mirroring the route's `WireGovArea`. */
export interface GovAreaLive {
  readonly key: string;
  readonly checkKey: string;
  readonly value: number | null;
  readonly prevValue: number | null;
  readonly status: GovAreaStatus | null;
  readonly hasData: boolean;
  readonly severityLabel: string | null;
  readonly collectedAt: string | null;
}

export interface GovAreaLinksLiveState {
  /** Real per-card data keyed by `GOV_AREA_LINKS` card key. Empty until loaded / on error. */
  readonly byKey: Record<string, GovAreaLive>;
  /** "live" once a real (possibly all-no-data) response has landed, else "fixture". */
  readonly dataState: "live" | "fixture";
  readonly loaded: boolean;
}

export function useGovAreaLinksLive(enabled = true): GovAreaLinksLiveState {
  const { fetchWithAuth } = useAuth();
  const [areas, setAreas] = useState<readonly GovAreaLive[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(AREAS_URL, undefined, { silent: true });
        if (!res.ok) return; // 403 for Assessment-role viewers → honest no-data fallback
        const body = (await res.json()) as { areas?: readonly GovAreaLive[] };
        if (!cancelled && Array.isArray(body?.areas)) {
          setAreas(body.areas);
        }
      } catch {
        // best-effort — the page renders its honest no-data fallback
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, enabled]);

  return useMemo(() => {
    const byKey: Record<string, GovAreaLive> = {};
    for (const a of areas ?? []) byKey[a.key] = a;
    return { byKey, dataState: areas !== null ? "live" : "fixture", loaded };
  }, [areas, loaded]);
}
