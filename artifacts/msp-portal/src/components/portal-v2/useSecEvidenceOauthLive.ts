/**
 * useSecEvidenceOauthLive.ts — the real-data seam for the OAuth Apps &
 * Consent Grants evidence drill-down's stat cards (Git #1233).
 *
 * Investigated all three `secEvidenceData.ts` evidence pages (OAuth, Legacy
 * Authentication, Email Security) for real backing data. Only two of the
 * OAuth page's five stat cards have a live check whose mapping is both real
 * AND semantically matches what the card claims:
 *
 *   - "Enterprise apps"      -> appgov:enterprise-app-count.enterpriseAppCount
 *     (a plain count of the tenant's /servicePrincipals — matches exactly).
 *   - "Tenant-wide consent"  -> appgov:risky-permission-grants.riskyPermissionGrantCount
 *     (oauth2PermissionGrants filtered to consentType == 'AllPrincipals',
 *     confirmed correct by the #551 Phase 3 migration — matches exactly).
 *
 * The other three OAuth cards (App-only permissions, Unverified publisher,
 * Dormant apps) and every stat/row on the Legacy Authentication and Email
 * Security pages have NO safe live equivalent today — either no check exists
 * at all, or the check that superficially matches the label is a shallow
 * `exists`/unfiltered-count check that does not actually measure what the
 * card claims (e.g. `identity:ca-legacy-auth-block` fires `true` the moment
 * ANY Conditional Access policy exists, not specifically a legacy-auth block
 * policy — see the #1233 issue comment for the full per-check breakdown).
 * Wiring those would trade an honest fixture number for a dishonest live one,
 * which is worse. This hook resolves only the two genuinely safe fields.
 *
 * Same generic customer-safe batch resolver pattern as
 * `useAdpWorkloadsLive.ts` (#1252) — `POST /api/dashboard/resolve`,
 * parameterized by a fixed metric-key list, best-effort with a fixture
 * fallback on any failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

const METRIC_KEYS = ["governance.enterpriseAppCount", "governance.riskyPermissionGrantCount"] as const;

export interface SecEvidenceOauthLiveCounts {
  enterpriseAppCount: number | null;
  riskyPermissionGrantCount: number | null;
}

export const SEC_EVIDENCE_OAUTH_LIVE_EMPTY: SecEvidenceOauthLiveCounts = {
  enterpriseAppCount: null,
  riskyPermissionGrantCount: null,
};

export interface SecEvidenceOauthLiveState {
  readonly live: SecEvidenceOauthLiveCounts;
  readonly loaded: boolean;
}

export function useSecEvidenceOauthLive(enabled = true): SecEvidenceOauthLiveState {
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

  const live: SecEvidenceOauthLiveCounts = {
    enterpriseAppCount: resolvedValue(metrics["governance.enterpriseAppCount"]),
    riskyPermissionGrantCount: resolvedValue(metrics["governance.riskyPermissionGrantCount"]),
  };

  return { live, loaded };
}
