/**
 * useSecEvidenceEmailLive.ts — the real-data seam for the Email Security
 * evidence drill-down's stat cards (Git #1430, follow-up to #1414's audit).
 *
 * `secEvidenceData.ts`'s `security-email` page is 100% `EVIDENCE_PAGES`
 * fixture — five stat cards (domain count, SPF/DKIM/DMARC record strings) and
 * a "Domains" evidence-row list with a fabricated `tenant.com` and invented
 * per-domain SPF/DKIM/DMARC records. #1258 already registered a real,
 * live-reachable check for this page's subject — `exchange:dkim-spf-dmarc-status`,
 * surfaced through the dashboard registry as `security.emailAuthFindingCount`
 * (a count of how many of SPF/DKIM/DMARC are NOT configured on the tenant's
 * latest scan) — and already proved it reachable on the Security overview
 * page's "Email Security" card (`useSecAreaLinksLive.ts`).
 *
 * That metric is a single aggregate count, not a per-domain breakdown, so it
 * can only honestly back ONE new stat card ("Open findings" — see
 * `securityEmailPageWithLive` in `secEvidenceData.ts`). The five existing
 * per-record stat cards and the fabricated "Domains" row list have no
 * matching live producer through this seam and are left/cleared accordingly
 * — same non-fabrication contract `useSecEvidenceOauthLive.ts` (#1233)
 * documents for its own non-matching cards.
 *
 * (Note for a future issue: `GET /api/portal/email-auth-status` — the seam
 * `email-auth-setup.tsx` already reads — does carry real per-tenant SPF/
 * DKIM/DMARC booleans for the tenant's own primary domain. It's a different
 * shape than this page's 4-domain evidence-row fixture (one domain, three
 * booleans, no record strings) and out of scope for #1430, which calls for
 * an honest no-data row state rather than a reshape around it.)
 *
 * Same generic customer-safe batch resolver pattern as
 * `useSecEvidenceOauthLive.ts` / `useSecAreaLinksLive.ts` — `POST
 * /api/dashboard/resolve`, best-effort with a fixture fallback on any
 * failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedValue, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

const METRIC_KEYS = ["security.emailAuthFindingCount"] as const;

export interface SecEvidenceEmailLiveCounts {
  emailAuthFindingCount: number | null;
}

export const SEC_EVIDENCE_EMAIL_LIVE_EMPTY: SecEvidenceEmailLiveCounts = {
  emailAuthFindingCount: null,
};

export interface SecEvidenceEmailLiveState {
  readonly live: SecEvidenceEmailLiveCounts;
  readonly loaded: boolean;
}

export function useSecEvidenceEmailLive(enabled = true): SecEvidenceEmailLiveState {
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

  const live: SecEvidenceEmailLiveCounts = {
    emailAuthFindingCount: resolvedValue(metrics["security.emailAuthFindingCount"]),
  };

  return { live, loaded };
}
