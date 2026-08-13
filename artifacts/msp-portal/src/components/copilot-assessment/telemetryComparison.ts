/**
 * telemetryComparison.ts
 *
 * Pure projection layer for the Copilot Assessment telemetry page's right panel
 * (#245, parent epic #183): Score gauges, Multi-Dimension Radar, Dimension Gap
 * Analysis and Top Discrepancies.
 *
 * Every one of those four used to be computed in TelemetryScreen.tsx from quiz
 * answers × a synthetic `engineProgressFactor`, or from the hardcoded strings in
 * `generateTop3Mismatches` ("Unlabeled files (62%)", "14 SharePoint sites",
 * "CA01 policy disabled") — none of which touched a real scan. This module owns
 * the replacement, and does no fetching and holds no state so it can be tested
 * directly against real payload shapes.
 *
 * Two real sources, joined here:
 *
 *   1. GET /api/portal/assessment/telemetry-comparison — the real health engine
 *      (computeHealthEngine via calculateArchitectureHealthScore) reduced to the
 *      real seven pillars and the real overall score, plus the real
 *      critical/warning `msp_diagnostic_findings` rows of the most recent run
 *      that has any. See api-server's lib/telemetry-comparison.ts.
 *
 *   2. The run's own per-check SSE stream (`scanCheckResults` on
 *      scan-status-context) — the ONLY real, this-run view of findings while a
 *      scan is in flight, because the run's finding rows are written in one
 *      batch after its last check finishes. `classifyLiveCheckSeverity` below
 *      mirrors diagnostics-runner's `classifyCheckSeverity` exactly, so a live
 *      discrepancy carries the same severity the persisted finding will.
 *
 * ── Self-assessment: deliberately absent, not forgotten ──────────────────────
 * OPEN DESIGN QUESTION FOR SHANE. There is no real quiz-answer → pillar
 * self-score mapping in this platform: `QuizProfile` (types.ts) collects role,
 * department, industry, collaboration patterns, sensitivity classes, workflow
 * style, outcome priorities, four 0–1 workload loads, tool usage and AI comfort,
 * and never asks the customer to rate their own governance / compliance /
 * architecture / licensing posture. The old radar's "Self" series (75/30/40/
 * 80/65/85) and the old gap bars' baselines were literals, not self-reports.
 * Rather than invent a mapping, the radar renders the real Actual series alone
 * and the gap bars measure each real pillar against full health. Restore a Self
 * series here once Shane decides which quiz answers legitimately stand in for
 * which pillar, or the quiz gains real per-pillar self-rating questions.
 */

/** The seven real pillars, in the server's RADAR_PILLARS order. */
export type RadarPillarKey =
  | 'governance'
  | 'compliance'
  | 'adoption'
  | 'copilot'
  | 'architecture'
  | 'licensing'
  | 'security';

export type DiscrepancySeverity = 'critical' | 'warning';

export interface TelemetryComparisonPillar {
  pillar: RadarPillarKey;
  label: string;
  /** 0–100, higher = healthier. Null = no evaluable rule feeds this pillar (never fabricated). */
  displayScore: number | null;
  rawRiskScore: number;
}

export interface TelemetryComparisonFinding {
  findingId: string;
  checkKey: string;
  checkLabel: string;
  severity: DiscrepancySeverity;
  title: string;
  description: string | null;
  category: string | null;
}

/** Exact shape of GET /api/portal/assessment/telemetry-comparison. */
export interface TelemetryComparisonPayload {
  overall: { rawRiskScore: number; displayScore: number | null };
  pillars: TelemetryComparisonPillar[];
  findings: TelemetryComparisonFinding[];
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  activeRunId: string | null;
  selfAssessment: null;
  generatedAt: string;
}

/** One real per-check result off the run's SSE stream (scan-status-context). */
export interface LiveCheckResult {
  checkKey: string;
  checkLabel: string;
  status: string;
  severityMatched?: string | null;
  /** The matched severity rule's already-interpolated finding sentence (#528). */
  severityLabel?: string | null;
  errorMessage?: string;
  index: number;
  total: number;
}

/**
 * Mirrors `classifyCheckSeverity` in api-server's diagnostics-runner.ts — the
 * function that decides the severity of the finding row this check will produce.
 * Kept deliberately literal (same order, same branches) so the live panel and
 * the persisted findings can never disagree about what a check means.
 *
 * Returns null for anything that will not become a critical/warning finding.
 */
export function classifyLiveCheckSeverity(result: LiveCheckResult): DiscrepancySeverity | null {
  if (result.status === 'consent_revoked') return 'critical';
  // requires_script / license_gap / error are informational in the runner — a
  // license gap is a known SKU limitation and a check-execution error (#522) is
  // a technical failure, never a red item the customer must "fix".
  if (result.status === 'requires_script' || result.status === 'license_gap' || result.status === 'error') return null;
  if (result.severityMatched) {
    const s = result.severityMatched.toLowerCase();
    if (s === 'critical' || s === 'high') return 'critical';
    if (s === 'warning' || s === 'medium') return 'warning';
  }
  return null;
}

/** A discrepancy as the card renders it, whichever of the two real sources it came from. */
export interface TelemetryDiscrepancy {
  id: string;
  severity: DiscrepancySeverity;
  /** Real check label — what was actually looked at. */
  title: string;
  /** Real detail: the finding's description, or the live check's real error/status line. */
  detail: string;
  checkKey: string;
  /** True when this came from the run currently streaming, i.e. it is happening right now. */
  live: boolean;
}

const SEVERITY_RANK: Record<DiscrepancySeverity, number> = { critical: 0, warning: 1 };

/** How many discrepancies the card shows — matches the server's TOP_DISCREPANCY_LIMIT. */
export const TOP_DISCREPANCY_LIMIT = 4;

/**
 * Real discrepancies observed so far in the run currently streaming. Ordered
 * critical-first, then by the order the checks actually ran, so the card reads
 * as a live log rather than reshuffling on every event.
 */
export function deriveLiveDiscrepancies(checkResults: LiveCheckResult[]): TelemetryDiscrepancy[] {
  // Keyed by checkKey, last result wins: the run's SSE stream replays its cached
  // state to every connector, so the same check can legitimately arrive twice —
  // and a re-run check's newer result supersedes its older one. One real check
  // must never appear as two discrepancies.
  const byCheckKey = new Map<string, LiveCheckResult>();
  for (const result of checkResults) byCheckKey.set(result.checkKey, result);

  const discrepancies: TelemetryDiscrepancy[] = [];

  for (const result of byCheckKey.values()) {
    const severity = classifyLiveCheckSeverity(result);
    if (!severity) continue;
    discrepancies.push({
      id: `live:${result.checkKey}`,
      severity,
      title: result.checkLabel || result.checkKey,
      detail:
        result.errorMessage ||
        (result.severityMatched
          ? `${result.severityMatched} severity condition matched on this check.`
          : `Check reported status "${result.status}".`),
      checkKey: result.checkKey,
      live: true,
    });
  }

  return discrepancies
    .map((d, order) => ({ d, order }))
    .sort((a, b) => SEVERITY_RANK[a.d.severity] - SEVERITY_RANK[b.d.severity] || a.order - b.order)
    .map(({ d }) => d)
    .slice(0, TOP_DISCREPANCY_LIMIT);
}

/** Persisted findings of a completed run, in the same card shape. */
export function toPersistedDiscrepancies(findings: TelemetryComparisonFinding[]): TelemetryDiscrepancy[] {
  return findings.slice(0, TOP_DISCREPANCY_LIMIT).map((f) => ({
    id: f.findingId,
    severity: f.severity,
    title: f.checkLabel || f.checkKey,
    detail: f.description ?? f.title,
    checkKey: f.checkKey,
    live: false,
  }));
}

/**
 * Which of the two real sources the card should show, and why.
 *
 * While a run streams, its own live check results are the only data that is
 * genuinely THIS run's — the persisted findings still belong to the previous
 * run, and presenting them as current is exactly the kind of thing #245 exists
 * to remove. So: stream results win whenever a stream is attached AND has
 * produced at least one real result; otherwise the persisted findings show,
 * labelled with the run they belong to.
 */
export function selectDiscrepancies(args: {
  payload: TelemetryComparisonPayload | null;
  liveCheckResults: LiveCheckResult[];
  streaming: boolean;
}): { items: TelemetryDiscrepancy[]; source: 'live' | 'persisted' | 'none'; runId: string | null } {
  const live = args.streaming ? deriveLiveDiscrepancies(args.liveCheckResults) : [];
  if (args.streaming && args.liveCheckResults.length > 0) {
    return { items: live, source: 'live', runId: args.payload?.activeRunId ?? null };
  }
  const persisted = toPersistedDiscrepancies(args.payload?.findings ?? []);
  if (persisted.length > 0) {
    return { items: persisted, source: 'persisted', runId: args.payload?.findingsRunId ?? null };
  }
  return { items: [], source: 'none', runId: null };
}

/** One radar axis / one gap bar — the same real per-pillar number behind both. */
export interface PillarView {
  pillar: RadarPillarKey;
  /** Short axis label for the radar (the server's own PILLAR_LABELS). */
  axis: string;
  /** 0–100, higher = healthier. */
  actual: number;
  /** 100 − actual: how far this real pillar sits from full health. */
  gap: number;
}

/**
 * Real per-pillar view for BOTH the radar and the gap bars — the same
 * `displayScore` from the same engine breakdown, so the two elements can never
 * disagree (they were separate invented formulas before). Pillars the engine
 * has no real data for (`displayScore: null`) are dropped, never zero-filled:
 * a zero would read as "totally unhealthy" rather than "not measured".
 */
export function toPillarViews(payload: TelemetryComparisonPayload | null): PillarView[] {
  if (!payload) return [];
  return payload.pillars
    .filter((p): p is TelemetryComparisonPillar & { displayScore: number } => p.displayScore !== null)
    .map((p) => ({
      pillar: p.pillar,
      axis: p.label,
      actual: p.displayScore,
      gap: Math.max(0, 100 - p.displayScore),
    }));
}

/**
 * The "Actual Telemetry" gauge value: the real overall score, normalized to the
 * 0–100 display scale by the engine's own normalization (server side). Null
 * whenever there is genuinely no real data — the gauge then reads 0 with a
 * "no data" caption rather than a made-up number.
 */
export function actualGaugeScore(payload: TelemetryComparisonPayload | null): number | null {
  return payload?.overall.displayScore ?? null;
}

/** Gap bars, worst-first — the pillars with the most real exposure lead. */
export function toGapBars(payload: TelemetryComparisonPayload | null, limit = 4): PillarView[] {
  return [...toPillarViews(payload)]
    .sort((a, b) => b.gap - a.gap || a.axis.localeCompare(b.axis))
    .slice(0, limit);
}
