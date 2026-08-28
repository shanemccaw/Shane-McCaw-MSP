/**
 * useHltDriftLive.ts — the real-data seam for the Health pillar's Configuration
 * Drift table (Git #1282).
 *
 * #1442's strict pass tagged this table `NO-BACKEND-TO-WIRE:` because the real
 * `drift_events` store (then only fed by #1283's Conditional-Access-only inline
 * hook) had no shape matching the fixture's "N of 47 tracked settings, including
 * clean/accepted rows" inventory, and the verdict-taxonomy mapping was a real
 * product decision this pass would not make unilaterally. #1287 has since landed
 * a general, executor-agnostic drift-spec registry (`drift-check-specs.ts`)
 * feeding `drift_events` for real across five domains, plus an honest
 * `drift_collection_status` record when a domain genuinely can't be diffed this
 * run — so this hook wires the table to that real data, on the terms the real
 * store actually supports:
 *
 *   - `drift_events` stores one row per DETECTED deviation, never a full
 *     settings inventory — there is no "clean" or "accepted position" row to
 *     serve, because the real engine doesn't track settings that already match
 *     baseline. The table now renders exactly what's real: the events that
 *     exist, honestly labelled, not an invented "of 47" count.
 *   - `DRIFT_EVENT_VERDICTS` (approved / attributed_unapproved / unattributed /
 *     informational — msp.ts) is a 4-value taxonomy, not the fixture's 6-value
 *     `HltVerdict`. Rather than force-fit `informational` into "accepted" (which
 *     implies a recorded decision the real engine doesn't capture) or "clean"
 *     (which the real engine never emits), `hltDashboardData.ts`'s
 *     `HLT_LIVE_DRIFT_VERDICT` gives the real taxonomy its own honest labels —
 *     the taxonomy-mapping decision #1442 deferred, made explicitly rather than
 *     guessed.
 *
 * Every `drift.*DriftCount` metric key in the registry (`lib/dashboard-
 * registry/src/metrics.ts`) is resolved, not just the domains #1287 gave a real
 * spec to — a domain with no spec yet (e.g. `directory-settings`,
 * `mailbox-config`) honestly resolves `no_data` via the same `resolveDriftEvents`
 * path, same as a spec'd domain nobody has scanned yet. That means widening
 * `drift-check-specs.ts` to a new domain lights this table up automatically,
 * with no frontend change required.
 *
 * Same generic customer-safe batch resolver pattern as `useHltObjectsLive.ts`
 * (#1442) / `useSecEvidenceOauthLive.ts` (#1233) — `POST /api/dashboard/resolve`,
 * best-effort with an honest empty state on any failure or unresolved key.
 */
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { resolvedEvents, resolvedReason, resolvedDetail, type ResolvedMetric } from "@/components/health-suite/useTopicHealthLive";

/**
 * Bare drift domain slug -> human label. Spans all 18 `drift:*` metric
 * sourceKeys currently declared in the registry (`lib/dashboard-registry/src/
 * metrics.ts`), not just the 5 with a real spec (#1287) — see this file's own
 * header for why that's deliberate. Labels for the 5 spec'd domains match
 * `drift-check-specs.ts`'s own `label` field verbatim; the rest are plain-
 * English readings of their registry metric key.
 */
export const HLT_DRIFT_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  "ca-policy": "Conditional Access policy",
  "directory-settings": "Directory settings",
  "license-assignment": "License assignment",
  "mailbox-config": "Mailbox configuration",
  "role-assignment": "Role assignment",
  "security-defaults": "Security defaults",
  "sharepoint-admin": "SharePoint admin settings",
  "teams-policy": "Teams policy",
  "app-config": "App configuration",
  "redirect-uri": "App redirect URI",
  secret: "App client secret",
  certificate: "App certificate",
  permission: "App permission",
  "tenant-config": "Tenant configuration",
  "eeeu-site-sharing": "SharePoint external site sharing",
  "public-teams-discoverable": "Public / discoverable Teams",
  "tenant-sharing-capability": "SharePoint tenant sharing capability",
  "email-authentication": "Email authentication (SPF / DKIM / DMARC)",
};

const DOMAIN_KEYS = Object.keys(HLT_DRIFT_DOMAIN_LABELS);
const METRIC_KEYS = DOMAIN_KEYS.map((d) => `drift:${d}`);

/** A real, id-keyed setting change (`drift_events` row) surfaced via `resolveDriftEvents`. */
export interface HltDriftLiveEvent {
  readonly domainKey: string;
  readonly domainLabel: string;
  readonly t: string;
  readonly label: string;
  readonly setting: string;
  readonly op: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly changedBy: string | null;
  /** Real 4-value verdict from `DRIFT_EVENT_VERDICTS` (msp.ts) — approved /
   * attributed_unapproved / unattributed / informational. */
  readonly verdict: string;
  readonly crRef: string | null;
}

/** Per-domain honest resolve outcome — what the table's footer notes read from. */
export interface HltDriftDomainStatus {
  readonly domainKey: string;
  readonly domainLabel: string;
  readonly status: "ok" | "not_available" | "error";
  /** Resolver's machine-stable reason (no_data / not_comparable / collection_error / …). */
  readonly reason: string | null;
  /** The specific human reason the collector recorded, when the resolver carried one. */
  readonly detail: string | null;
  readonly eventCount: number;
  readonly zeroRows: boolean;
}

export interface HltDriftLiveState {
  readonly loaded: boolean;
  /** Every real event across every domain that resolved with events. */
  readonly events: readonly HltDriftLiveEvent[];
  readonly domainStatuses: readonly HltDriftDomainStatus[];
  /** Domains with a captured baseline (genuinely being diffed), regardless of event count. */
  readonly trackedDomainCount: number;
  readonly totalDomainCount: number;
  /** "live" once a real response has landed (even if every domain is genuinely untracked). */
  readonly dataState: "live" | "fixture";
}

export function useHltDriftLive(enabled = true): HltDriftLiveState {
  const { fetchWithAuth } = useAuth();
  const [metrics, setMetrics] = useState<Record<string, ResolvedMetric>>({});
  const [loaded, setLoaded] = useState(false);
  const [dataState, setDataState] = useState<"live" | "fixture">("fixture");

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
          setDataState("live");
        }
      } catch {
        // best-effort — the page renders its honest no-live-data state
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, enabled]);

  const events: HltDriftLiveEvent[] = [];
  const domainStatuses: HltDriftDomainStatus[] = [];
  let trackedDomainCount = 0;

  for (const domainKey of DOMAIN_KEYS) {
    const domainLabel = HLT_DRIFT_DOMAIN_LABELS[domainKey];
    const metric = metrics[`drift:${domainKey}`];
    const rawEvents = resolvedEvents(metric);
    const status = metric?.status ?? null;

    if (status === "ok") {
      trackedDomainCount += 1;
      for (const e of rawEvents) {
        events.push({
          domainKey,
          domainLabel,
          t: e.t,
          label: e.label,
          setting: typeof e.setting === "string" ? e.setting : e.label,
          op: typeof e.op === "string" ? e.op : "replace",
          oldValue: "oldValue" in e ? e.oldValue : null,
          newValue: "newValue" in e ? e.newValue : null,
          changedBy: typeof e.changedBy === "string" ? e.changedBy : null,
          verdict: typeof e.verdict === "string" ? e.verdict : "unattributed",
          crRef: typeof e.crRef === "string" ? e.crRef : null,
        });
      }
    }

    domainStatuses.push({
      domainKey,
      domainLabel,
      status: status === "ok" ? "ok" : status === "error" ? "error" : "not_available",
      reason: resolvedReason(metric),
      detail: resolvedDetail(metric),
      eventCount: rawEvents.length,
      zeroRows: status === "ok" && rawEvents.length === 0,
    });
  }

  return {
    loaded,
    events,
    domainStatuses,
    trackedDomainCount,
    totalDomainCount: DOMAIN_KEYS.length,
    dataState,
  };
}
