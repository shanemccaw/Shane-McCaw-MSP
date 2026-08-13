/**
 * useSecurityOverviewLive.ts
 *
 * Real live-data wiring for the /security-overview (Security Intelligence)
 * page. Deliberately NOT a new mechanism — the same three proven portal
 * surfaces useM365HealthLive.ts reads, plus the customer engine-history
 * route for the two real historical trend elements:
 *
 *   1. POST /api/dashboard/resolve
 *        — the customer-safe batch metric resolver, for the identity/security
 *          monitor-check metrics this page renders: global admin count, PIM
 *          standing roles, risky users, high-risk sign-ins, failed sign-ins,
 *          impossible travel, and the active Defender alert count. The
 *          high-risk sign-in metric opts into `includeHistory` — its real
 *          per-collection history (tenant_monitor_profiles rows, accumulated
 *          by the 5-minute Live Activity Monitor workflow) backs the Sign-In
 *          Risk Trend sparkline.
 *          NOTE: identity.pimPermanentRoleCount's backing check currently
 *          needs a Graph scope the multi-tenant app doesn't have yet (known,
 *          backlogged) — until then it resolves not_available and the UI
 *          shows the honest "not collected" state. Wired correctly so it
 *          lights up the moment the scope lands; never faked around.
 *
 *   2. GET  /api/portal/mission-control/overview
 *        — the real diagnostics findings feed (msp_diagnostic_findings, last
 *          completed run) with server-linked sales offers: Top Security
 *          Risks + the Security Automation offer list + the hero's
 *          critical/warning/info summary.
 *
 *   3. GET  /api/portal/mission-control/engines
 *        — the customer-safe engine strip; this page reads only the
 *          `security` entry's severity/statusLabel for the hero badge.
 *          Calling it is also what materialises a fresh security snapshot
 *          (server-side 5-min TTL cache prevents snapshot spam).
 *
 *   4. GET  /api/portal/engines/security/history
 *        — real score history from tenant_engine_snapshots (≤90d) +
 *          engine_score_daily_rollup (beyond), plus per-date signal
 *          fired/resolved deltas. Backs the hero Risk Index (latest real
 *          score + delta) and the Daily Alert Volume chart (signals fired vs
 *          resolved per day). A brand-new tenant genuinely has no rows yet —
 *          the page renders the honest "not enough history" state, never a
 *          fabricated series; history accumulates naturally within the first
 *          days of monitoring.
 *
 * Every fetch is best-effort: a failed/forbidden call leaves its slice
 * null/empty and the page renders the honest "no data" state for that
 * element — never a fabricated number.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { LiveFinding, LiveFindingSeverity, OverviewSlice, ResolvedMetric } from "@/components/m365-health/useM365HealthLive";
import { resolvedValue } from "@/components/m365-health/useM365HealthLive";

export type TimeFrame = "24h" | "7d" | "30d";

const WINDOW_DAYS: Record<TimeFrame, number> = { "24h": 1, "7d": 7, "30d": 30 };

// ── Metric keys (labels mirror lib/dashboard-registry/src/metrics.ts) ─────────

const METRIC_KEYS = [
  "identity.globalAdminCount",
  "identity.pimPermanentRoleCount",
  "identity.riskyUserCount",
  "identity.highRiskSigninCount",
  "identity.failedSigninCount",
  "identity.impossibleTravelCount",
  "security.activeAlertCount",
] as const;

/** The one metric whose real per-collection history backs the sign-in sparkline. */
const SIGNIN_TREND_METRIC = "identity.highRiskSigninCount";

type HistoryPoint = { t: string; value: number };
type MetricWithHistory = ResolvedMetric & { history?: HistoryPoint[] };

// ── Wire shapes ───────────────────────────────────────────────────────────────

interface EngineStripEntry {
  key: string;
  label: string;
  severity: "good" | "watch" | "high" | "info";
  statusLabel: string;
  detail: string;
}

interface EngineHistoryWire {
  series: Array<{
    date: string;
    score: number | null;
    previousScore: number | null;
    delta: number | null;
    trendDirection: string | null;
    source: string;
  }>;
  signalDeltas: Array<{ label: string; direction: "fired" | "resolved"; date: string }>;
}

// ── Derived presentation types ────────────────────────────────────────────────

/** A single resolved count with an honest "was this actually collected" flag. */
export interface LiveMetric {
  value: number | null;
  collected: boolean;
}

export interface RiskIndexLive {
  /** Latest real security engine score — HIGHER IS WORSE (risk index). */
  score: number;
  /** Change vs the previous snapshot; positive = risk went up. */
  delta: number | null;
  capturedAt: string;
}

export interface IdentityRiskBucket {
  count: number;
  /** Which real signals this severity bucket is composed of. */
  sources: string;
}

/**
 * Severity-categorised identity risk distribution, composed entirely of real
 * monitor-check counts. Categorisation (documented judgment call):
 *   high   — Identity Protection risky users + high-risk sign-ins (confirmed
 *            identity-protection risk signals)
 *   medium — impossible-travel events (anomalous, not confirmed risk)
 *   low    — failed sign-ins (noise-level events)
 */
export interface IdentityRiskDistributionLive {
  collected: boolean;
  total: number;
  high: IdentityRiskBucket;
  medium: IdentityRiskBucket;
  low: IdentityRiskBucket;
}

export interface TrendBucket {
  label: string;
  value: number;
  isCurrent: boolean;
}

export interface SignInTrendLive {
  /** Real, bucketed history (hourly for 24h, daily otherwise). */
  buckets: TrendBucket[];
  /** True once the metric has resolved at all (even with thin history). */
  collected: boolean;
  /** ≥2 real buckets — below this the honest empty state renders instead. */
  enoughHistory: boolean;
}

export interface AlertVolumeDay {
  day: string;
  fired: number;
  resolved: number;
  isToday: boolean;
}

export interface AlertVolumeLive {
  days: AlertVolumeDay[];
  /** Any engine history exists at all for this tenant. */
  historyAvailable: boolean;
}

export interface AutomationOfferLive {
  id: number;
  title: string;
  rationale: string | null;
  priceCents: number | null;
  /** Testbed-gated instant-pack flag from the server — display-only here. */
  instant: boolean;
  relatedFindingCount: number;
  worstSeverity: LiveFindingSeverity;
}

export interface SecurityOverviewLive {
  loaded: boolean;
  refreshing: boolean;
  refresh: () => void;
  timeframe: TimeFrame;
  setTimeframe: (tf: TimeFrame) => void;

  // Hero
  riskIndex: RiskIndexLive | null;
  securityStatus: { severity: EngineStripEntry["severity"]; statusLabel: string } | null;
  riskyUsers: LiveMetric;
  summary: OverviewSlice["summary"] | null;
  lastScanAt: string | null;
  scanActive: boolean;
  everScanned: boolean;

  // Privileged exposure
  globalAdmins: LiveMetric;
  pimStandingRoles: LiveMetric;
  highRiskSignins: LiveMetric;

  // Identity risk distribution + sign-in trend
  identityRisk: IdentityRiskDistributionLive;
  signInTrend: SignInTrendLive;

  // Daily alert volume
  alertVolume: AlertVolumeLive;
  activeAlerts: LiveMetric;

  // Findings + automation
  findings: LiveFinding[];
  automationOffers: AutomationOfferLive[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLiveMetric(r: MetricWithHistory | undefined): LiveMetric {
  const value = resolvedValue(r);
  return { value, collected: value != null };
}

/** Bucket raw history points hourly (24h view) or daily. Value per bucket is
 * the MAX reading — these are point-in-time gauge counts, so the honest
 * per-bucket summary is the peak, not a sum of re-readings. */
function bucketHistory(points: HistoryPoint[], timeframe: TimeFrame): TrendBucket[] {
  if (points.length === 0) return [];
  const hourly = timeframe === "24h";
  const buckets = new Map<string, { label: string; value: number; sortKey: number }>();
  for (const p of points) {
    const d = new Date(p.t);
    if (Number.isNaN(d.getTime())) continue;
    const key = hourly
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const label = hourly
      ? `${String(d.getHours()).padStart(2, "0")}:00`
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sortKey = hourly
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
      : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const existing = buckets.get(key);
    if (existing) {
      existing.value = Math.max(existing.value, p.value);
    } else {
      buckets.set(key, { label, value: p.value, sortKey });
    }
  }
  const now = new Date();
  const currentKey = hourly
    ? `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`
    : `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  return [...buckets.entries()]
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([key, b]) => ({ label: b.label, value: b.value, isCurrent: key === currentKey }));
}

/** Group engine-history signal deltas into per-day fired/resolved counts. */
function bucketSignalDeltas(deltas: EngineHistoryWire["signalDeltas"]): AlertVolumeDay[] {
  const byDay = new Map<string, { fired: number; resolved: number; sortKey: number }>();
  for (const d of deltas) {
    const date = new Date(d.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const entry = byDay.get(key) ?? {
      fired: 0,
      resolved: 0,
      sortKey: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    };
    if (d.direction === "resolved") entry.resolved += 1;
    else entry.fired += 1;
    byDay.set(key, entry);
  }
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  return [...byDay.entries()]
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([key, e]) => ({
      day: new Date(e.sortKey).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      fired: e.fired,
      resolved: e.resolved,
      isToday: key === todayKey,
    }));
}

const SEVERITY_RANK: Record<LiveFindingSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Dedupe the findings feed's server-linked offers into automation cards. */
function deriveAutomationOffers(findings: LiveFinding[]): AutomationOfferLive[] {
  const byId = new Map<number, AutomationOfferLive>();
  for (const f of findings) {
    if (!f.offer) continue;
    const existing = byId.get(f.offer.id);
    if (existing) {
      existing.relatedFindingCount += 1;
      if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[existing.worstSeverity]) {
        existing.worstSeverity = f.severity;
      }
    } else {
      byId.set(f.offer.id, {
        id: f.offer.id,
        title: f.offer.title,
        rationale: f.offer.rationale,
        priceCents: f.offer.adjustedPriceCents,
        instant: f.offer.instant,
        relatedFindingCount: 1,
        worstSeverity: f.severity,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => SEVERITY_RANK[a.worstSeverity] - SEVERITY_RANK[b.worstSeverity],
  );
}

// ── The hook ──────────────────────────────────────────────────────────────────

export function useSecurityOverviewLive(): SecurityOverviewLive {
  const { fetchWithAuth } = useAuth();

  const [timeframe, setTimeframe] = useState<TimeFrame>("7d");
  const [metrics, setMetrics] = useState<Record<string, MetricWithHistory>>({});
  const [overview, setOverview] = useState<OverviewSlice | null>(null);
  const [engineStrip, setEngineStrip] = useState<EngineStripEntry[] | null>(null);
  const [engineHistory, setEngineHistory] = useState<EngineHistoryWire | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const windowDays = WINDOW_DAYS[timeframe];

    const loadMetrics = async () => {
      try {
        const res = await fetchWithAuth(
          "/api/dashboard/resolve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              metrics: [...METRIC_KEYS],
              includeHistory: [SIGNIN_TREND_METRIC],
              windowDays,
            }),
          },
          { silent: true },
        );
        if (!res.ok) return; // 403 for Assessment-role viewers → honest empty
        const data = (await res.json()) as { results?: Record<string, MetricWithHistory> };
        if (!cancelled && data.results && typeof data.results === "object") {
          setMetrics(data.results);
        }
      } catch {
        // best-effort — honest empty states downstream
      }
    };

    const loadOverview = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/mission-control/overview", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as OverviewSlice;
        if (!Array.isArray(data.findings)) data.findings = [];
        if (!cancelled) setOverview(data);
      } catch {
        // best-effort
      }
    };

    const loadEngines = async () => {
      try {
        const res = await fetchWithAuth("/api/portal/mission-control/engines", undefined, { silent: true });
        if (!res.ok) return;
        const data = (await res.json()) as { engines?: EngineStripEntry[] };
        if (!cancelled && Array.isArray(data.engines)) setEngineStrip(data.engines);
      } catch {
        // best-effort
      }
    };

    const loadEngineHistory = async () => {
      try {
        const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
        const res = await fetchWithAuth(
          `/api/portal/engines/security/history?start=${encodeURIComponent(start)}`,
          undefined,
          { silent: true },
        );
        if (!res.ok) return;
        const data = (await res.json()) as EngineHistoryWire;
        if (!Array.isArray(data.series)) data.series = [];
        if (!Array.isArray(data.signalDeltas)) data.signalDeltas = [];
        if (!cancelled) setEngineHistory(data);
      } catch {
        // best-effort
      }
    };

    setRefreshing(true);
    void Promise.allSettled([loadMetrics(), loadOverview(), loadEngines(), loadEngineHistory()]).then(() => {
      if (!cancelled) {
        setLoaded(true);
        setRefreshing(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth, timeframe, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // ── Derivations ─────────────────────────────────────────────────────────────

  const riskyUsers = toLiveMetric(metrics["identity.riskyUserCount"]);
  const highRiskSignins = toLiveMetric(metrics["identity.highRiskSigninCount"]);
  const failedSignins = toLiveMetric(metrics["identity.failedSigninCount"]);
  const impossibleTravel = toLiveMetric(metrics["identity.impossibleTravelCount"]);
  const globalAdmins = toLiveMetric(metrics["identity.globalAdminCount"]);
  const pimStandingRoles = toLiveMetric(metrics["identity.pimPermanentRoleCount"]);
  const activeAlerts = toLiveMetric(metrics["security.activeAlertCount"]);

  const identityRisk: IdentityRiskDistributionLive = useMemo(() => {
    const collected =
      riskyUsers.collected || highRiskSignins.collected || impossibleTravel.collected || failedSignins.collected;
    const high = (riskyUsers.value ?? 0) + (highRiskSignins.value ?? 0);
    const medium = impossibleTravel.value ?? 0;
    const low = failedSignins.value ?? 0;
    return {
      collected,
      total: high + medium + low,
      high: { count: high, sources: "Risky users + high-risk sign-ins" },
      medium: { count: medium, sources: "Impossible-travel events" },
      low: { count: low, sources: "Failed sign-ins" },
    };
  }, [riskyUsers, highRiskSignins, impossibleTravel, failedSignins]);

  const signInTrend: SignInTrendLive = useMemo(() => {
    const history = metrics[SIGNIN_TREND_METRIC]?.status === "ok" ? (metrics[SIGNIN_TREND_METRIC].history ?? []) : [];
    const buckets = bucketHistory(history, timeframe);
    return {
      buckets,
      collected: highRiskSignins.collected,
      enoughHistory: buckets.length >= 2,
    };
  }, [metrics, timeframe, highRiskSignins.collected]);

  const alertVolume: AlertVolumeLive = useMemo(
    () => ({
      days: bucketSignalDeltas(engineHistory?.signalDeltas ?? []),
      historyAvailable: (engineHistory?.series.length ?? 0) > 0,
    }),
    [engineHistory],
  );

  const riskIndex: RiskIndexLive | null = useMemo(() => {
    const series = engineHistory?.series ?? [];
    const latest = [...series].reverse().find((s) => s.score != null);
    if (!latest || latest.score == null) return null;
    return { score: latest.score, delta: latest.delta, capturedAt: latest.date };
  }, [engineHistory]);

  const securityEntry = engineStrip?.find((e) => e.key === "security") ?? null;

  const findings = overview?.findings ?? [];

  return {
    loaded,
    refreshing,
    refresh,
    timeframe,
    setTimeframe,

    riskIndex,
    securityStatus: securityEntry
      ? { severity: securityEntry.severity, statusLabel: securityEntry.statusLabel }
      : null,
    riskyUsers,
    summary: overview?.summary ?? null,
    lastScanAt: overview?.scan.lastScanAt ?? null,
    scanActive: Boolean(overview?.scan.active),
    everScanned: overview?.scan.lastScanAt != null,

    globalAdmins,
    pimStandingRoles,
    highRiskSignins,

    identityRisk,
    signInTrend,

    alertVolume,
    activeAlerts,

    findings,
    automationOffers: deriveAutomationOffers(findings),
  };
}
