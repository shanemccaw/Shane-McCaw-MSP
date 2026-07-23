/**
 * useTopicHealthLive.ts — shared real-data hook for the six M365 Health topic
 * pages (/governance, /compliance, /adoption, /copilot, /architecture,
 * /licensing).
 *
 * Deliberately NOT a new mechanism — the exact same three already-proven,
 * portal-reachable surfaces the completed /m365-health wiring uses (no new
 * server endpoints; see useM365HealthLive.ts for the full rationale):
 *
 *   1. GET  /api/portal/assessment/status
 *        — real package-aware pillar radar (radar.pillars, pillar-coverage.ts).
 *          The pillar keys are exactly this suite's page topics (governance,
 *          compliance, adoption, copilot, architecture, licensing), so each
 *          page's hero score is its own real pillar score. Also carries the
 *          Cost Engine's real license-waste summary and the real
 *          Copilot-readiness block. Auth floor: Assessment (all roles).
 *
 *   2. GET  /api/portal/mission-control/overview
 *        — the real diagnostics findings feed (msp_diagnostic_findings from the
 *          last completed run) with server-linked sales offers (incl. the hard
 *          testbed-gated `instant` flag). Auth floor: CustomerUser — an
 *          Assessment-role viewer gets 403 → honest empty state.
 *
 *   3. POST /api/dashboard/resolve
 *        — the generic customer-safe batch metric resolver, parameterized by
 *          each page's metric key list. Metric keys are plain strings resolved
 *          server-side; an unknown/unavailable key resolves to a per-key
 *          error/not_available status and the page renders its honest empty
 *          state — never a fabricated number. Pages opt specific smart-eligible
 *          scalar metrics into `includeHistory` for real {t,value} series from
 *          tenant_engine_snapshots / tenant_monitor_profiles (the seeded
 *          5-minute Live Activity Monitor workflow accumulates these genuinely;
 *          a brand-new tenant honestly has none yet).
 *
 * This module is self-contained (types + band helpers duplicated from
 * useM365HealthLive.ts rather than imported) so it has zero coupling to files
 * a concurrent session currently holds dirty in the working tree.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { CopilotReadinessLive, LicenseWasteSummary } from "@/components/assessment-test/types";

// ── Slice 1: assessment status (radar + cost engine + copilot readiness) ──────

export interface TopicRadarPillar {
  pillar: string;
  label: string;
  score: number;
}

export interface TopicStatusSlice {
  scan: {
    active: boolean;
    everScanned: boolean;
    lastScanAt: string | null;
  };
  radar: { packageKey: string | null; pillars: TopicRadarPillar[] };
  stats: {
    genuineFindings: number | null;
    licenseWasteMonthlyCents: number | null;
    licenseWaste: LicenseWasteSummary | null;
  };
  copilotReadiness: CopilotReadinessLive | null;
}

// ── Slice 2: mission-control overview (real findings + linked offers) ─────────

export type TopicFindingSeverity = "critical" | "warning" | "info";

export interface TopicFindingOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number | null;
  state: string;
  /** True only for testbed tenants whose offer maps to an instant config pack —
   * the server enforces this again on execute. For everyone else, automated
   * execution is genuinely blocked (pending the customer's Azure app
   * registration), and the UI must say so rather than pretend. */
  instant: boolean;
}

export interface TopicFinding {
  id: number;
  checkLabel: string | null;
  severity: TopicFindingSeverity;
  title: string;
  description: string | null;
  effort: string | null;
  category: string | null;
  action: string | null;
  createdAt: string;
  offer: TopicFindingOffer | null;
}

export interface TopicOverviewSlice {
  scan: { active: boolean; lastScanAt: string | null };
  summary: {
    critical: number;
    warning: number;
    info: number;
    checksOk: number | null;
    checksTotal: number | null;
  };
  findings: TopicFinding[];
}

// ── Slice 3: dashboard metric resolve results ─────────────────────────────────

export interface ResolvedMetricOk {
  metricKey: string;
  status: "ok";
  shape: string;
  valueType: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** Real {t,value} history (oldest→newest), present ONLY for metrics opted
   * into `includeHistory`. Served from tenant_engine_snapshots /
   * tenant_monitor_profiles rows — never synthesized. */
  history?: { t: string; value: number }[];
}
export interface ResolvedMetricUnavailable {
  metricKey: string;
  status: "not_available";
  reason: string;
  detail?: string;
}
export interface ResolvedMetricError {
  metricKey: string;
  status: "error";
  error: string;
}
export type ResolvedMetric = ResolvedMetricOk | ResolvedMetricUnavailable | ResolvedMetricError;

/** Extract the canonical numeric value from a resolved scalar/trend metric.
 * Returns null for not_available/error/non-numeric — the honest "no data". */
export function resolvedValue(r: ResolvedMetric | undefined): number | null {
  if (!r || r.status !== "ok") return null;
  const v = (r.data as { value?: unknown }).value;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // timeline/event-list metrics: the honest count is the number of real events.
  const events = (r.data as { events?: unknown }).events;
  if (Array.isArray(events)) return events.length;
  return null;
}

/** Extract a resolved metric's real {t,value} history series (oldest→newest).
 * Empty for not_available/error or when the metric wasn't opted into
 * includeHistory — the honest "no history yet". */
export function resolvedHistory(r: ResolvedMetric | undefined): { t: string; value: number }[] {
  if (!r || r.status !== "ok" || !Array.isArray(r.history)) return [];
  return r.history.filter(
    (p) => p && typeof p.t === "string" && typeof p.value === "number" && Number.isFinite(p.value),
  );
}

/** Extract a distribution metric's real buckets ({label,value}[]). Empty for
 * not_available/error/non-distribution — honest "no data". */
export function resolvedBuckets(r: ResolvedMetric | undefined): { label: string; value: number }[] {
  if (!r || r.status !== "ok") return [];
  const buckets = (r.data as { buckets?: unknown }).buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets.filter(
    (b): b is { label: string; value: number } =>
      !!b && typeof (b as { label?: unknown }).label === "string" && typeof (b as { value?: unknown }).value === "number",
  );
}

/** Extract a timeline metric's real events. Empty for not_available/error. */
export function resolvedEvents(
  r: ResolvedMetric | undefined,
): { t: string; label: string; [k: string]: unknown }[] {
  if (!r || r.status !== "ok") return [];
  const events = (r.data as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (e): e is { t: string; label: string } =>
      !!e && typeof (e as { t?: unknown }).t === "string" && typeof (e as { label?: unknown }).label === "string",
  );
}

// ── The hook ──────────────────────────────────────────────────────────────────

export interface TopicHealthLive {
  loaded: boolean;
  status: TopicStatusSlice | null;
  overview: TopicOverviewSlice | null;
  metrics: Record<string, ResolvedMetric>;
  /** This page's own real pillar score from the radar (null = honest em-dash:
   * the customer's scanned package doesn't cover this pillar yet, or no scan). */
  pillarScore: number | null;
  /** The full covered-pillar list (for cross-pillar context strips). */
  pillars: TopicRadarPillar[];
}

export interface TopicHealthLiveOptions {
  /** The page's pillar key in the radar (governance | compliance | adoption |
   * copilot | architecture | licensing). */
  pillar: string;
  /** Metric keys to batch-resolve via POST /api/dashboard/resolve. */
  metricKeys: string[];
  /** Subset of metricKeys to opt into real history series. Only smart-eligible
   * customer-scope scalars genuinely have history; others just come back with
   * no `history` field (honest empty). */
  historyKeys?: string[];
  /** Look-back window in days for trend/timeline metrics + history (default 30). */
  windowDays?: number;
}

export function useTopicHealthLive(options: TopicHealthLiveOptions): TopicHealthLive {
  const { fetchWithAuth } = useAuth();
  // Serialize the option arrays so effect identity is by-value, not by-reference
  // (callers pass fresh array literals each render).
  const metricKeysJson = JSON.stringify(options.metricKeys);
  const historyKeysJson = JSON.stringify(options.historyKeys ?? []);
  const windowDays = options.windowDays ?? 30;

  const [status, setStatus] = useState<TopicStatusSlice | null>(null);
  const [overview, setOverview] = useState<TopicOverviewSlice | null>(null);
  const [metrics, setMetrics] = useState<Record<string, ResolvedMetric>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/assessment/status", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as TopicStatusSlice;
        // Wire-boundary normalization — same guards as useAssessmentLiveStatus.
        if (!data.radar || typeof data.radar !== "object" || !Array.isArray(data.radar.pillars)) {
          data.radar = { packageKey: null, pillars: [] };
        }
        if (!data.stats || typeof data.stats !== "object") {
          data.stats = { genuineFindings: null, licenseWasteMonthlyCents: null, licenseWaste: null };
        }
        if (data.stats.licenseWaste === undefined) data.stats.licenseWaste = null;
        if (data.copilotReadiness === undefined) data.copilotReadiness = null;
        if (!cancelled) setStatus(data);
      } catch {
        // best-effort — the page renders honest empty states
      }
    };

    const loadOverview = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/mission-control/overview", undefined, { silent: true });
        if (!res.ok) return; // 403 for Assessment-role viewers → honest empty
        const data = (await res.json()) as TopicOverviewSlice;
        if (!Array.isArray(data.findings)) data.findings = [];
        if (!cancelled) setOverview(data);
      } catch {
        // best-effort
      }
    };

    const loadMetrics = async () => {
      const metricKeys = JSON.parse(metricKeysJson) as string[];
      const historyKeys = JSON.parse(historyKeysJson) as string[];
      if (metricKeys.length === 0) return;
      try {
        const res = await fetchWithAuth(
          "/api/dashboard/resolve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metrics: metricKeys,
              windowDays,
              ...(historyKeys.length > 0 ? { includeHistory: historyKeys } : {}),
            }),
          },
          { silent: true },
        );
        if (!res.ok) return; // 403 for Assessment-role viewers → honest empty
        const data = (await res.json()) as { results?: Record<string, ResolvedMetric> };
        if (!cancelled && data.results && typeof data.results === "object") {
          setMetrics(data.results);
        }
      } catch {
        // best-effort
      }
    };

    void Promise.allSettled([loadStatus(), loadOverview(), loadMetrics()]).then(() => {
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, metricKeysJson, historyKeysJson, windowDays]);

  const pillars = status?.radar.pillars ?? [];
  const own = pillars.find((p) => p.pillar === options.pillar);

  return { loaded, status, overview, metrics, pillarScore: own?.score ?? null, pillars };
}

/**
 * Cross-cutting finding categories (diagnostics-runner.ts's buildRecommendation)
 * that are never actually "about" a pillar topic, regardless of what the
 * short-circuited check's own checkLabel/title happen to contain — e.g. a
 * tenant-wide consent revocation short-circuits EVERY remaining check in a run,
 * producing one "consent" finding per check with that check's own topic-ish
 * label (an Overdue Access Reviews check that never got to run still reads
 * "access review" in its title). These are already correctly surfaced via the
 * real consent banner/reconsent pill — a pillar page's Top Risks list must
 * never re-show them as if they were genuine topic findings.
 */
const NON_TOPIC_CATEGORIES = new Set(['consent', 'reliability', 'script']);

/**
 * Topic-scope a findings feed by keyword match over the finding's REAL
 * checkLabel + title + description. The overview endpoint doesn't expose the
 * raw checkKey (and recommendation.category is largely severity-derived, not
 * topic-derived — see diagnostics-runner.ts), so a transparent display-layer
 * keyword filter is the honest option: it only ever narrows the real feed,
 * never invents membership. Pages pair it with a "view all findings" pointer
 * so nothing filtered out becomes invisible platform-wide. Findings in a
 * NON_TOPIC_CATEGORIES category are excluded before the keyword match, since
 * their category is a genuine platform-wide signal (not this pillar's).
 */
export function filterFindingsByTopic(findings: TopicFinding[], keywords: string[]): TopicFinding[] {
  const needles = keywords.map((k) => k.toLowerCase());
  return findings.filter((f) => {
    if (f.category && NON_TOPIC_CATEGORIES.has(f.category)) return false;
    const haystack = `${f.checkLabel ?? ''} ${f.title} ${f.description ?? ''}`.toLowerCase();
    return needles.some((n) => haystack.includes(n));
  });
}

// ── Shared display banding helpers (same thresholds as useM365HealthLive) ─────

export type StatusBand = "green" | "amber" | "red";

/** 0–100 score → status band. Same thresholds as the platform's shared
 * dashboard-canvas ScoreRing (≥70 good, ≥40 needs attention, else at risk). */
export function scoreBand(score: number): StatusBand {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

/** Risk-count → status band. Same bands as the metric registry's
 * RISK_COUNT_BANDS (at/below 1 acceptable, above 10 critical). */
export function riskCountBand(count: number): StatusBand {
  if (count <= 1) return "green";
  if (count <= 10) return "amber";
  return "red";
}

/** Status-token CSS color for a band (real design tokens, not mockup hex). */
export const BAND_COLOR_VAR: Record<StatusBand, string> = {
  green: "var(--color-status-green)",
  amber: "var(--color-status-amber)",
  red: "var(--color-status-red)",
};

export const BAND_TEXT_CLASS: Record<StatusBand, string> = {
  green: "text-status-green",
  amber: "text-status-amber",
  red: "text-status-red",
};

export const BAND_BADGE_CLASS: Record<StatusBand, string> = {
  green: "bg-status-green/15 text-status-green border-status-green/30",
  amber: "bg-status-amber/15 text-status-amber border-status-amber/30",
  red: "bg-status-red/15 text-status-red border-status-red/30",
};

/** Severity → status-token classes for findings chips. */
export const SEVERITY_BADGE_CLASS: Record<TopicFindingSeverity, string> = {
  critical: "bg-status-red/15 text-status-red border-status-red/30",
  warning: "bg-status-amber/15 text-status-amber border-status-amber/30",
  info: "bg-status-blue/15 text-status-blue border-status-blue/30",
};

export const SEVERITY_TEXT_CLASS: Record<TopicFindingSeverity, string> = {
  critical: "text-status-red",
  warning: "text-status-amber",
  info: "text-status-blue",
};
