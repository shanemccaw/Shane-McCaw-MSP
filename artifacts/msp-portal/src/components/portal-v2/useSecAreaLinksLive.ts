/**
 * useSecAreaLinksLive.ts — real-data seam for four of the Security page's
 * five `SEC_AREA_LINKS` category cards (Git #1258, extended by #1337).
 *
 * `secDashboardData.ts` documents ALL FIVE `SEC_AREA_LINKS` scores as fixture
 * ("no per-category score feed exists server-side"). #1258 found two of the
 * five already have a real, correctly-shaped check behind them, and #1337
 * added a third:
 *
 *   - "OAuth Apps"      -> governance.riskyPermissionGrantCount
 *     (appgov:risky-permission-grants, registered by #1233 — tenant-wide
 *     OAuth consent grants, the same concept the fixture's "1 flagged grant"
 *     claims).
 *   - "Email Security"  -> security.emailAuthFindingCount
 *     (exchange:dkim-spf-dmarc-status, registered by #1258 — count of
 *     SPF/DMARC/DKIM-at-default-selectors NOT configured, the same concept
 *     the fixture's "3 open findings" claims).
 *   - "MFA Gaps"        -> identity.mfaGapCount
 *     (identity:privileged-mfa-gap, registered by #1337 — real count of
 *     Member accounts without a registered MFA method, the same concept the
 *     fixture's "8 users without MFA" claims).
 *   - "Legacy Auth"     -> identity.legacyAuthCount
 *     (identity:legacy-auth-usage, registered by #1337 — the metric already
 *     existed in the registry from earlier work but was never overlaid onto
 *     this card).
 *
 * Conditional Access stays out of this hook — #1337 confirmed
 * `useCaBaselineLive` (#1232) is directly reusable for that card's "N
 * baseline policies missing" claim (see portal-v2-security.tsx), so it does
 * not need a `/api/dashboard/resolve` metric of its own.
 *
 * Same generic customer-safe batch resolver pattern as
 * `useSecEvidenceOauthLive.ts` (#1233) — `POST /api/dashboard/resolve`, best-
 * effort with a fixture fallback on any failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

const METRIC_KEYS = [
  "governance.riskyPermissionGrantCount",
  "security.emailAuthFindingCount",
  "identity.mfaGapCount",
  "identity.legacyAuthCount",
] as const;

export interface SecAreaLinksLiveCounts {
  oauthFlaggedGrantCount: number | null;
  emailAuthFindingCount: number | null;
  mfaGapCount: number | null;
  legacyAuthCount: number | null;
}

export const SEC_AREA_LINKS_LIVE_EMPTY: SecAreaLinksLiveCounts = {
  oauthFlaggedGrantCount: null,
  emailAuthFindingCount: null,
  mfaGapCount: null,
  legacyAuthCount: null,
};

export interface SecAreaLinksLiveState {
  readonly live: SecAreaLinksLiveCounts;
  readonly loaded: boolean;
}

export function useSecAreaLinksLive(enabled = true): SecAreaLinksLiveState {
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

  const live: SecAreaLinksLiveCounts = {
    oauthFlaggedGrantCount: resolvedValue(metrics["governance.riskyPermissionGrantCount"]),
    emailAuthFindingCount: resolvedValue(metrics["security.emailAuthFindingCount"]),
    mfaGapCount: resolvedValue(metrics["identity.mfaGapCount"]),
    legacyAuthCount: resolvedValue(metrics["identity.legacyAuthCount"]),
  };

  return { live, loaded };
}
