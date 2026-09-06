/**
 * Auth Core (#2991, Feature #1648) — unauthenticated data reads the sign-in-
 * help screen needs. Kept out of auth-context.tsx because it doesn't touch
 * identity/session state — auth-context owns login/session lifecycle, this
 * owns a content read a logged-out visitor can make.
 *
 * Note on GET /api/portal/branding (msp-custom-domain.ts:40): it's real and
 * listed in docs/auth-core-contract-pack.md §1, but deliberately unused by
 * all 6 screens here — every `Design/portal/design_handoff_full_site/screens/
 * Auth *.dc.html` header hardcodes "Shane McCaw Consulting" as literal copy,
 * not a template binding, and CLAUDE.md's copy-is-final rule forbids
 * substituting that for dynamic branding. A per-tenant custom-domain login
 * would be a distinct, separately-designed surface, not a gap in this one.
 *
 * fetchPlatformStatus returns `null` on any failure (network, non-2xx, bad
 * JSON) rather than throwing — the caller renders an honest fallback/absent
 * state (contract pack §4's "declared available or not before anything is
 * drawn"), never a fabricated value.
 */

// ── /api/status (public-status.ts:298) ──────────────────────────────────────

export type M365ServiceStatus = "healthy" | "degraded" | "interruption";

export interface M365ServiceHealthEntry {
  service: string;
  status: M365ServiceStatus;
}

export type M365HealthSection =
  | { available: true; services: M365ServiceHealthEntry[] }
  | { available: false; reason: string };

export interface M365UptimeServiceEntry {
  service: string;
  uptimePercent: number | null;
  breached: boolean;
  coverage: number;
  sampleCount: number;
}

export type M365UptimeSection =
  | { available: true; target: number; services: M365UptimeServiceEntry[]; overallUptimePercent: number | null }
  | { available: false; reason: string };

export interface DailyHistoryEntry {
  date: string;
  status: "operational" | "degraded" | "outage";
  title: string | null;
  description: string | null;
}

export interface PlatformIncident {
  id: number;
  title: string;
  description: string;
  severity: "minor" | "major" | "critical";
  status: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface PlatformStatus {
  status: "operational" | "degraded" | "outage";
  incidents: PlatformIncident[];
  m365Health: M365HealthSection;
  m365Uptime: M365UptimeSection;
  dailyHistory: DailyHistoryEntry[];
}

/** GET /api/status (public-status.ts:298) — unauthenticated, always public. */
export async function fetchPlatformStatus(): Promise<PlatformStatus | null> {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return null;
    return (await res.json()) as PlatformStatus;
  } catch {
    return null;
  }
}

/** Honest, real prose for each real `available:false` reason the backend can emit. */
export const M365_UNAVAILABLE_REASONS: Record<string, string> = {
  not_configured: "No Graph credentials are configured for the testbed tenant, so there is nothing to ask Microsoft with.",
  no_tenant: "No tenant is attached to read service health from.",
  fetch_failed: "Microsoft's service-health endpoint did not answer. This says nothing about whether your own services are healthy.",
  consent_revoked: "Access to the testbed tenant's Graph data was revoked. This says nothing about whether your own services are healthy.",
  no_samples: "No uptime samples have been recorded for this tenant yet.",
  error: "The read failed in a way we did not anticipate. It is logged on our side.",
};
