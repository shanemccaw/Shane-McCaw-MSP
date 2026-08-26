/**
 * useHltObjectsLive.ts — the real-data seam for the Health pillar's "Stale
 * object inventory" summary card and itemized drill-down (Git #1340).
 *
 * `hltDashboardData.ts`'s `HLT_OBJECTS` is a 9-row fixture; #1260 built 4 real
 * checks against 3 of those rows (stale/duplicate device records, empty
 * security groups, unassigned Intune profiles) but nothing wired the summary
 * total or the itemized rows to them. Shane's own follow-up comment on #1340
 * additionally scoped the drill-down's 5 itemized line items (`HLT_OBJECTS`
 * rows 1-5) against 2 more `appgov:*` checks not part of #1260's original
 * scope. See `hltDashboardData.ts`'s own comment above `hltObjectsWithLive`
 * for which of those 5 rows actually got wired here and which stayed fixture
 * after semantic verification found a name-match-only mismatch.
 *
 * Same generic customer-safe batch resolver pattern as
 * `useSecEvidenceOauthLive.ts` (#1233) / `useAdpWorkloadsLive.ts` (#1252) —
 * `POST /api/dashboard/resolve`, parameterized by a fixed metric-key list,
 * best-effort with a fixture fallback on any failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

const METRIC_KEYS = [
  "intune.staleDeviceRecordCount",
  "intune.duplicateDeviceRecordCount",
  "governance.expiredPasswordCredentialCount",
  "governance.expiredKeyCredentialCount",
] as const;

export interface HltObjectsLiveCounts {
  staleDeviceRecordCount: number | null;
  duplicateDeviceRecordCount: number | null;
  /** Sum of expired secrets + expired certs (appgov:cert-secret-expiration) —
   * the fixture's single "Credentials already expired" row does not split by
   * credential type, so neither does this. Left null unless BOTH halves
   * resolve, so a partial resolver failure never understates the real count. */
  expiredCredentialCount: number | null;
}

export const HLT_OBJECTS_LIVE_EMPTY: HltObjectsLiveCounts = {
  staleDeviceRecordCount: null,
  duplicateDeviceRecordCount: null,
  expiredCredentialCount: null,
};

export interface HltObjectsLiveState {
  readonly live: HltObjectsLiveCounts;
  readonly loaded: boolean;
}

export function useHltObjectsLive(enabled = true): HltObjectsLiveState {
  const { fetchWithAuth } = useAuth();
  const [metrics, setMetrics] = useState<Record<string, ResolvedMetric>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
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
  }, [fetchWithAuth, enabled]);

  const expiredPassword = resolvedValue(metrics["governance.expiredPasswordCredentialCount"]);
  const expiredKey = resolvedValue(metrics["governance.expiredKeyCredentialCount"]);

  const live: HltObjectsLiveCounts = {
    staleDeviceRecordCount: resolvedValue(metrics["intune.staleDeviceRecordCount"]),
    duplicateDeviceRecordCount: resolvedValue(metrics["intune.duplicateDeviceRecordCount"]),
    expiredCredentialCount: expiredPassword != null && expiredKey != null ? expiredPassword + expiredKey : null,
  };

  return { live, loaded };
}
