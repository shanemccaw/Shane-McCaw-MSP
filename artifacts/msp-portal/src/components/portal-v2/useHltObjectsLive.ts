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
 * ── Git #1442 — the remaining 4 rows now have real checks too ───────────────
 * #1260's own migration added `devices:unassigned-intune-profiles`,
 * `governance:empty-security-groups` and `appgov:dormant-service-principals`
 * (plus the already-wired `devices:stale-duplicate-records`), and its own
 * comment states plainly that #1229 had already found `identity:disabled-
 * accounts` backing "Disabled accounts never removed". All 4 have real
 * dashboard-registry metric keys (`lib/dashboard-registry/src/metrics.ts`) —
 * `intune.unassignedProfileCount`, `governance.emptySecurityGroupCount`,
 * `governance.dormantServicePrincipalCount`, `identity.disabledAccountCount` —
 * so this strict pass wires all 4 through the SAME resolver seam, closing the
 * gap #1260 deliberately left open. That leaves exactly 2 of the 9 rows
 * genuinely unbacked ("App registrations with no owner", "Credentials
 * expiring in 30 days") — see `hltDashboardData.ts`'s own comment above
 * `hltObjectsWithLive` for why no check can answer either one; both are
 * tagged `NO-BACKEND-TO-WIRE:` there.
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
  "intune.unassignedProfileCount",
  "governance.emptySecurityGroupCount",
  "governance.dormantServicePrincipalCount",
  "identity.disabledAccountCount",
] as const;

export interface HltObjectsLiveCounts {
  staleDeviceRecordCount: number | null;
  duplicateDeviceRecordCount: number | null;
  /** Sum of expired secrets + expired certs (appgov:cert-secret-expiration) —
   * the fixture's single "Credentials already expired" row does not split by
   * credential type, so neither does this. Left null unless BOTH halves
   * resolve, so a partial resolver failure never understates the real count. */
  expiredCredentialCount: number | null;
  /** `devices:unassigned-intune-profiles` (#1260). */
  unassignedIntuneProfileCount: number | null;
  /** `governance:empty-security-groups` (#1260). */
  emptySecurityGroupCount: number | null;
  /** `appgov:dormant-service-principals` (#1260) — a provisioning-state proxy,
   * not an observed-sign-in-activity signal; see that migration's own HONESTY
   * NOTE before treating this as literal "no sign-in event observed". */
  dormantServicePrincipalCount: number | null;
  /** `identity:disabled-accounts`. */
  disabledAccountCount: number | null;
}

export const HLT_OBJECTS_LIVE_EMPTY: HltObjectsLiveCounts = {
  staleDeviceRecordCount: null,
  duplicateDeviceRecordCount: null,
  expiredCredentialCount: null,
  unassignedIntuneProfileCount: null,
  emptySecurityGroupCount: null,
  dormantServicePrincipalCount: null,
  disabledAccountCount: null,
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
    unassignedIntuneProfileCount: resolvedValue(metrics["intune.unassignedProfileCount"]),
    emptySecurityGroupCount: resolvedValue(metrics["governance.emptySecurityGroupCount"]),
    dormantServicePrincipalCount: resolvedValue(metrics["governance.dormantServicePrincipalCount"]),
    disabledAccountCount: resolvedValue(metrics["identity.disabledAccountCount"]),
  };

  return { live, loaded };
}
