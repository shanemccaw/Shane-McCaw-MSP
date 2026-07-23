/**
 * useM365HealthLive.ts
 *
 * Real live-data wiring for the /m365-health page. Deliberately NOT a new
 * mechanism — every byte comes from three already-proven, portal-reachable
 * surfaces (no new server endpoints were added for this page):
 *
 *   1. GET  /api/portal/assessment/status
 *        — the same status payload the /assessment page reads
 *          (useAssessmentLiveStatus): real package-aware pillar radar
 *          (radar.pillars — the honest source for the M365 Health score),
 *          the Cost Engine's real license-waste summary
 *          (stats.licenseWaste — monthlyCents/annualCents from
 *          computeSkuCostBreakdown), and the real Copilot-readiness block.
 *          Auth floor: Assessment (lowest) — every portal role can read it.
 *
 *   2. GET  /api/portal/mission-control/overview
 *        — the real diagnostics findings feed (msp_diagnostic_findings from
 *          the last completed run) with server-side linked sales offers
 *          (incl. the `instant` remediation flag, which is hard testbed-gated
 *          server-side). Auth floor: CustomerUser — an Assessment-role viewer
 *          gets 403, which this hook treats as the honest empty state.
 *
 *   3. POST /api/dashboard/resolve
 *        — the generic customer-safe batch metric resolver
 *          (dashboard-data.ts / dashboard-resolvers.ts) for the registry
 *          metrics this page renders: the 14 drift.* Configuration Drift
 *          metrics, the identity.* / policy-family risk counts backing the
 *          risk heatmap, the usage.* adoption counts, and
 *          licensing.wasteEstimateBreakdown (the Cost Engine's real per-SKU
 *          waste distribution). The three SECURITY_TREND_METRICS additionally
 *          opt into `includeHistory`, returning real {t,value} series from
 *          tenant_engine_snapshots / tenant_monitor_profiles for the Security
 *          Trends chart. Auth floor: CustomerUser — same honest-empty
 *          degradation for lower roles.
 *
 * Every fetch is best-effort: a failed/forbidden call leaves its slice null
 * and the page renders the honest "no data" state for that element — never a
 * fabricated number. All requests are one-shot on mount: this is an overview
 * page, not a live wizard, and the underlying data changes on scan cadence,
 * not by the second.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { CopilotReadinessLive, LicenseWasteSummary } from "@/components/assessment-test/types";

// ── Slice 1: assessment status (radar + cost engine + copilot readiness) ──────

export interface HealthRadarPillar {
  pillar: string;
  label: string;
  score: number;
}

export interface HealthStatusSlice {
  scan: {
    active: boolean;
    everScanned: boolean;
    lastScanAt: string | null;
  };
  radar: { packageKey: string | null; pillars: HealthRadarPillar[] };
  stats: {
    genuineFindings: number | null;
    licenseWasteMonthlyCents: number | null;
    licenseWaste: LicenseWasteSummary | null;
  };
  copilotReadiness: CopilotReadinessLive | null;
}

// ── Slice 2: mission-control overview (real findings + linked offers) ─────────

export type LiveFindingSeverity = "critical" | "warning" | "info";

export interface LiveFindingOffer {
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

export interface LiveFinding {
  id: number;
  checkLabel: string | null;
  severity: LiveFindingSeverity;
  title: string;
  description: string | null;
  effort: string | null;
  category: string | null;
  action: string | null;
  createdAt: string;
  offer: LiveFindingOffer | null;
}

export interface OverviewSlice {
  scan: { active: boolean; lastScanAt: string | null };
  summary: {
    critical: number;
    warning: number;
    info: number;
    checksOk: number | null;
    checksTotal: number | null;
  };
  findings: LiveFinding[];
}

// ── Slice 3: dashboard metric resolve results ─────────────────────────────────

export interface ResolvedMetricOk {
  metricKey: string;
  status: "ok";
  shape: string;
  valueType: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** Real {t,value} history (oldest→newest), present ONLY for metrics this
   * hook opts into `includeHistory` (the security-trend series). Served by
   * resolveMetricHistory from tenant_engine_snapshots (engine metrics) /
   * tenant_monitor_profiles rows (monitor checks) — never synthesized. */
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

/** Extract a resolved metric's real {t,value} history series (oldest→newest).
 * Empty for not_available/error or when the metric wasn't opted into
 * includeHistory — the honest "no history yet". */
export function resolvedHistory(r: ResolvedMetric | undefined): { t: string; value: number }[] {
  if (!r || r.status !== "ok" || !Array.isArray(r.history)) return [];
  return r.history.filter(
    (p) => p && typeof p.t === "string" && typeof p.value === "number" && Number.isFinite(p.value),
  );
}

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

// ── Metric key sets (labels mirror lib/dashboard-registry/src/metrics.ts) ─────

export interface HeatmapMetricDef {
  key: string;
  label: string;
}

/** IDENTITY row — real identity-risk counts from the monitor check catalog. */
export const IDENTITY_HEATMAP_METRICS: HeatmapMetricDef[] = [
  { key: "identity.riskyUserCount", label: "Risky Users" },
  { key: "identity.highRiskSigninCount", label: "High-Risk Sign-ins" },
  { key: "identity.legacyAuthCount", label: "Legacy Auth Users" },
  { key: "identity.staleAccountCount", label: "Stale Accounts" },
  { key: "identity.impossibleTravelCount", label: "Impossible Travel" },
  { key: "identity.privilegedRoleChangeCount", label: "Privileged Role Changes" },
];

/** POLICIES row — real policy-posture counts (CA / DLP / labels / retention /
 * access reviews / secure-score controls). */
export const POLICY_HEATMAP_METRICS: HeatmapMetricDef[] = [
  { key: "identity.caFailureCount", label: "CA Policy Failures" },
  { key: "compliance.weakDlpPolicyCount", label: "Weak DLP Policies" },
  { key: "compliance.labelPolicyDriftCount", label: "Label Policy Drift" },
  { key: "compliance.retentionDriftCount", label: "Retention Policy Drift" },
  { key: "governance.overdueAccessReviewCount", label: "Overdue Access Reviews" },
  { key: "security.lowScoreControlCount", label: "Low-Score Controls" },
];

/** DRIFT row — the full 14-metric Configuration Drift engine set (the
 * "Configuration Drift (dedicated engine)" section of the metric registry). */
export const DRIFT_HEATMAP_METRICS: HeatmapMetricDef[] = [
  { key: "drift.caPolicyDriftCount", label: "CA Policy Drift" },
  { key: "drift.directorySettingsDriftCount", label: "Directory Settings Drift" },
  { key: "drift.licenseAssignmentDriftCount", label: "License Assignment Drift" },
  { key: "drift.mailboxConfigDriftCount", label: "Mailbox Config Drift" },
  { key: "drift.roleAssignmentDriftCount", label: "Role Assignment Drift" },
  { key: "drift.securityDefaultsDriftCount", label: "Security Defaults Drift" },
  { key: "drift.sharePointAdminDriftCount", label: "SharePoint Admin Drift" },
  { key: "drift.teamsPolicyDriftCount", label: "Teams Policy Drift" },
  { key: "drift.appConfigDriftCount", label: "App Registration Drift" },
  { key: "drift.redirectUriDriftCount", label: "Redirect URI Drift" },
  { key: "drift.secretDriftCount", label: "App Secret Drift" },
  { key: "drift.certificateDriftCount", label: "Certificate Drift" },
  { key: "drift.permissionDriftCount", label: "Graph Permission Drift" },
  { key: "drift.tenantConfigDriftCount", label: "Tenant Baseline Drift" },
];

/** Adoption — real usage.* active-user counts per workload. */
export const USAGE_METRICS: HeatmapMetricDef[] = [
  { key: "usage.teamsActiveCount", label: "Teams" },
  { key: "usage.exchangeActiveCount", label: "Exchange" },
  { key: "usage.sharePointActiveCount", label: "SharePoint" },
  { key: "usage.oneDriveActiveCount", label: "OneDrive" },
];

/** Cost Engine per-SKU waste distribution (real dollars/mo per SKU). */
export const COST_BREAKDOWN_METRIC = "licensing.wasteEstimateBreakdown";

/** Security Trends series — the real, history-capable security scalars.
 * resolveMetricHistory only serves customer-scope smart-eligible SCALAR
 * metrics, which constrains this set:
 *   • engine.securityScore          → tenant_engine_snapshots ("security" engine
 *     rows — the same table engine_score_daily_rollup summarizes)
 *   • security.highSeverityAlertCount / identity.impossibleTravelCount
 *     → tenant_monitor_profiles history (the Live Activity Monitor's 5-minute
 *       collection cadence writes these rows for consented tenants)
 * A brand-new customer genuinely has no rows yet → honest empty state. */
export const SECURITY_TREND_METRICS: HeatmapMetricDef[] = [
  { key: "engine.securityScore", label: "Security Score" },
  { key: "security.highSeverityAlertCount", label: "High-Severity Alerts" },
  { key: "identity.impossibleTravelCount", label: "Impossible Travel" },
];

const ALL_METRIC_KEYS: string[] = [
  ...new Set(
    [
      ...IDENTITY_HEATMAP_METRICS,
      ...POLICY_HEATMAP_METRICS,
      ...DRIFT_HEATMAP_METRICS,
      ...USAGE_METRICS,
      // impossibleTravelCount also sits in the IDENTITY heatmap row — the Set
      // dedupes it so the resolve batch stays one-key-per-metric.
      ...SECURITY_TREND_METRICS,
    ].map((m) => m.key),
  ),
].concat([COST_BREAKDOWN_METRIC]);

// ── The hook ──────────────────────────────────────────────────────────────────

export interface M365HealthLive {
  loaded: boolean;
  status: HealthStatusSlice | null;
  overview: OverviewSlice | null;
  metrics: Record<string, ResolvedMetric>;
  /** Overall M365 Health — same derivation as the /assessment page: average of
   * ALL covered pillars' real scores; null (honest em-dash) when no pillar is
   * covered yet. */
  healthScore: number | null;
}

export function useM365HealthLive(): M365HealthLive {
  const { fetchWithAuth } = useAuth();

  const [status, setStatus] = useState<HealthStatusSlice | null>(null);
  const [overview, setOverview] = useState<OverviewSlice | null>(null);
  const [metrics, setMetrics] = useState<Record<string, ResolvedMetric>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/assessment/status", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as HealthStatusSlice;
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
        const data = (await res.json()) as OverviewSlice;
        if (!Array.isArray(data.findings)) data.findings = [];
        if (!cancelled) setOverview(data);
      } catch {
        // best-effort
      }
    };

    const loadMetrics = async () => {
      try {
        const res = await fetchWithAuth(
          "/api/dashboard/resolve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metrics: ALL_METRIC_KEYS,
              // 30-day lookback for the Security Trends history series.
              windowDays: 30,
              includeHistory: SECURITY_TREND_METRICS.map((m) => m.key),
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
  }, [fetchWithAuth]);

  const pillars = status?.radar.pillars ?? [];
  const healthScore =
    pillars.length > 0
      ? Math.round(pillars.reduce((sum, p) => sum + p.score, 0) / pillars.length)
      : null;

  return { loaded, status, overview, metrics, healthScore };
}

// ── Shared display banding helpers ────────────────────────────────────────────

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
