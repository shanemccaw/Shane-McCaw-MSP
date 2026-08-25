/**
 * useAdpWorkloadsLive.ts — the real-data seam for the Adoption pillar's
 * workload-utilisation list (#1252).
 *
 * Same generic customer-safe batch resolver `useTopicHealthLive.ts` already
 * proved out for the /adoption topic page — `POST /api/dashboard/resolve`,
 * parameterized by a fixed metric-key list. Kept as its own tiny hook rather
 * than reusing `useTopicHealthLive` wholesale: that hook also fetches
 * assessment status + mission-control overview, neither of which this page
 * needs (the hero score already comes from `useLivePillarHero`, and this
 * page's plays/findings are fixture, not the diagnostics feed).
 *
 * Every metric key resolves via `sourceType: "monitor_profile"` against a
 * real `monitor_checks` row already running on the normal cadence — see
 * lib/dashboard-registry/src/metrics.ts's usage.exchangeActiveCount /
 * usage.teamsActiveCount / usage.sharePointActiveCount /
 * usage.oneDriveActiveCount and their denominator/sync-error siblings added
 * alongside this hook. An unresolved key (tenant hasn't scanned yet) comes
 * back `not_available` and `resolvedValue` turns that into `null` — the
 * caller overlays only the rows that genuinely resolved.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";
import { ADP_WORKLOAD_LIVE_EMPTY, type AdpWorkloadLiveCounts } from "./adpDashboardData";

const METRIC_KEYS = [
  "usage.exchangeActiveCount",
  "usage.exchangeLicensedUserCount",
  "usage.teamsActiveCount",
  "usage.teamsLicensedUserCount",
  "usage.sharePointActiveCount",
  "usage.sharePointSitesScannedCount",
  "usage.oneDriveActiveCount",
  "usage.oneDriveAccountsScannedCount",
  "usage.oneDriveSyncErrorCount",
] as const;

export interface AdpWorkloadsLiveState {
  readonly live: AdpWorkloadLiveCounts;
  /** True once a first real response (success or failure) has arrived. */
  readonly loaded: boolean;
}

export function useAdpWorkloadsLive(): AdpWorkloadsLiveState {
  const { fetchWithAuth } = useAuth();
  const [metrics, setMetrics] = useState<Record<string, ResolvedMetric>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          "/api/dashboard/resolve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metrics: METRIC_KEYS }),
          },
          { silent: true },
        );
        if (!res.ok) return; // 403 for Assessment-role viewers → honest fixture fallback
        const data = (await res.json()) as { results?: Record<string, ResolvedMetric> };
        if (!cancelled && data.results && typeof data.results === "object") {
          setMetrics(data.results);
        }
      } catch {
        // best-effort — the page renders its honest fixture fallback
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const live: AdpWorkloadLiveCounts = {
    ...ADP_WORKLOAD_LIVE_EMPTY,
    exchangeActive: resolvedValue(metrics["usage.exchangeActiveCount"]),
    exchangeLicensed: resolvedValue(metrics["usage.exchangeLicensedUserCount"]),
    teamsActive: resolvedValue(metrics["usage.teamsActiveCount"]),
    teamsLicensed: resolvedValue(metrics["usage.teamsLicensedUserCount"]),
    sharePointActive: resolvedValue(metrics["usage.sharePointActiveCount"]),
    sharePointScanned: resolvedValue(metrics["usage.sharePointSitesScannedCount"]),
    oneDriveActive: resolvedValue(metrics["usage.oneDriveActiveCount"]),
    oneDriveScanned: resolvedValue(metrics["usage.oneDriveAccountsScannedCount"]),
    oneDriveStaleSync: resolvedValue(metrics["usage.oneDriveSyncErrorCount"]),
  };

  return { live, loaded };
}
