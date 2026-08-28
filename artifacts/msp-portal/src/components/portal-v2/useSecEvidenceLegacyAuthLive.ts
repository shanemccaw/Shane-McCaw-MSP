/**
 * useSecEvidenceLegacyAuthLive.ts — the real-data seam for the Legacy
 * Authentication evidence drill-down's "Legacy sign-ins" stat card (Git #1429).
 *
 * Follow-up from #1414's audit, which found `/portal-v2/security/legacy-auth`
 * entirely unconditional fixture with no live-data hook at all. A real backing
 * metric already exists and is proven live-reachable — `identity.legacyAuthCount`
 * (`identity:legacy-auth-usage`) is already consumed on the Security overview
 * page via `useSecAreaLinksLive` (#1258/#1337). It maps to a genuine 30-day
 * legacy-protocol sign-in count (`docs/signals.json`'s
 * `signal.identity.legacy-auth-usage` names its source field
 * `legacyAuthSignInCount`), which is exactly what this page's "Legacy sign-ins"
 * stat card claims — so only that one card is safe to overlay.
 *
 * The other four stat cards ("Protocols reachable", "Accounts using legacy",
 * "CA block policy", "Legacy from odd geos") and the entire evidence-row list
 * have no per-account/per-protocol producer today — same documented-gap
 * treatment `useSecEvidenceOauthLive.ts` already uses for its three unbacked
 * OAuth cards. `securityLegacyAuthPageWithLive` (secEvidenceData.ts) leaves
 * those stat cards on their fixture values and strips the fabricated
 * evidence rows outright rather than presenting fictional accounts as fact.
 *
 * Same generic customer-safe batch resolver pattern as
 * `useSecEvidenceOauthLive.ts` (#1233) / `useSecAreaLinksLive.ts` (#1258) —
 * `POST /api/dashboard/resolve`, best-effort with a fixture fallback on any
 * failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

const METRIC_KEYS = ["identity.legacyAuthCount"] as const;

export interface SecEvidenceLegacyAuthLiveCounts {
  legacyAuthCount: number | null;
}

export const SEC_EVIDENCE_LEGACY_AUTH_LIVE_EMPTY: SecEvidenceLegacyAuthLiveCounts = {
  legacyAuthCount: null,
};

export interface SecEvidenceLegacyAuthLiveState {
  readonly live: SecEvidenceLegacyAuthLiveCounts;
  readonly loaded: boolean;
}

export function useSecEvidenceLegacyAuthLive(enabled = true): SecEvidenceLegacyAuthLiveState {
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

  const live: SecEvidenceLegacyAuthLiveCounts = {
    legacyAuthCount: resolvedValue(metrics["identity.legacyAuthCount"]),
  };

  return { live, loaded };
}
