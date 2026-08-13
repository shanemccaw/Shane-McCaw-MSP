/**
 * telemetry-comparison.ts
 *
 * Real backing for the Copilot Assessment telemetry page's right panel (#245,
 * parent epic #183) — the Score gauges, the Multi-Dimension Radar, the
 * Dimension Gap Analysis bars and Top Discrepancies. Every one of those four
 * used to be computed client-side from quiz answers × a synthetic
 * `engineProgressFactor`, or from hardcoded strings; none of it touched a real
 * scan. This module is the single server-side source that replaces all four.
 *
 * NO NEW SCORING FORMULA — Shane's explicit instruction on #245. Everything
 * here is the platform's existing, already-live health scoring path:
 *
 *   calculateArchitectureHealthScore(customerId)   (health-engine.ts)
 *     → real fired signals from the tenant's real merged profile + findings,
 *       summed into the raw per-pillar breakdown and `architectureHealthScore`.
 *       Its breakdown already includes the separately-computed security pillar.
 *   fetchTenantEvaluableSignalKeys(customerId, rules, …)  (pillar-coverage.ts)
 *     → the honest denominator restriction, scoped to the checks this tenant was
 *       actually scanned with.
 *   computePillarDisplayScore / computeOverallDisplayScore  (health-display.ts)
 *     → the existing 0–100 higher-is-healthier normalization, per pillar and
 *       (same expression, summed) overall.
 *
 * ── Denominator scope, corrected (#413) ──────────────────────────────────────
 * This module used to pass the CATALOG-WIDE `fetchEvaluableSignalKeys` set, on
 * the stated grounds that `getPillarCoverage`'s package-restricted denominator
 * needs a COMPLETED run's packageKey while this payload must be computable
 * mid-scan. The premise was right; the conclusion was not. The numerator can
 * only ever hold signals fed by the checks this tenant ran, so measuring the
 * denominator across the whole ~122-check catalog clamped every score above
 * "bad" — a tenant on `core:security-baseline` could not go below 76/100 with
 * every check it ran broken (#413, docs/weighted-scoring-investigation-413.md).
 *
 * `fetchTenantEvaluableSignalKeys` resolves the same package scope WITHOUT
 * needing a completed run: it reads the tenant's `msp_diagnostic_runs` package
 * keys at ANY status, so the run in flight right now is already counted. The
 * mid-scan requirement above is therefore still met, with the correct scope.
 *
 * ── Why this is genuinely live during a scan ─────────────────────────────────
 * `executeMonitoringPackage` awaits `executeMonitorCheck` per check, and that
 * function writes the check's own `tenant_monitor_profiles` row before the next
 * check starts. `buildTenantProfile` reads the LATEST row per check key
 * (`fetchLatestMonitorProfileRows`), so the engine's inputs genuinely grow as
 * the run progresses: recomputing mid-run returns real, progressively-updating
 * numbers, not an interpolation toward a known final value. On a re-scan the
 * starting point is the previous run's rows, each superseded as its check
 * re-runs — which is the truth, and is why the panel moves rather than jumping.
 *
 * ── What is NOT live, stated plainly ─────────────────────────────────────────
 * `msp_diagnostic_findings` rows are written in ONE batch AFTER every check has
 * finished (diagnostics-runner.ts step 4). So mid-run there are no finding rows
 * for the run in flight, and `findings` below belongs to the most recent run
 * that HAS them — reported with its own `findingsRunId`/`findingsRunStatus` so
 * the caller can label it honestly instead of passing a previous run's findings
 * off as this one's. The live, this-run view of the same data comes from the
 * per-check SSE stream on the client (see telemetryComparison.ts in msp-portal,
 * which mirrors this file's `classifyCheckSeverity` counterpart).
 */

import { db, mspDiagnosticRunsTable, mspDiagnosticFindingsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  calculateArchitectureHealthScore,
  getSignalHealthImpacts,
  type HealthEngineOutput,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import {
  computeOverallDisplayScore,
  evaluatePillarDisplay,
  type PillarEvaluation,
} from "./health-display.ts";
import { fetchTenantEvaluableSignalKeys, RADAR_PILLARS, PILLAR_LABELS, type RadarPillar } from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";

/** Severities the panel treats as a discrepancy worth surfacing (issue #245: "high/critical"). */
export const DISCREPANCY_SEVERITIES = ["critical", "warning"] as const;
export type DiscrepancySeverity = typeof DISCREPANCY_SEVERITIES[number];

/** Run statuses that mean a scan is in flight right now. */
const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

export interface TelemetryComparisonPillar {
  pillar: RadarPillar;
  label: string;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds this pillar — never fabricated. */
  displayScore: number | null;
  /** The engine's own raw pillar sum (risk accumulation, higher = worse). Exposed for provenance. */
  rawRiskScore: number;
  /**
   * WHY `displayScore` is (or is not) a number — `evaluatePillarDisplay`'s own
   * verdict, carried rather than re-derived (#517). `displayScore` is non-null
   * exactly when `evaluation.status === "scored"`; the other two states are the
   * distinction a bare null could never draw ("nothing feeds this pillar" vs
   * "one thing does, which is not enough to score it").
   */
  evaluation: PillarEvaluation;
}

export interface TelemetryComparisonFinding {
  findingId: string;
  checkKey: string;
  checkLabel: string;
  severity: DiscrepancySeverity;
  title: string;
  description: string | null;
  /** Real `recommendation.category` where the check's own recommendation carries one. */
  category: string | null;
}

export interface TelemetryComparisonPayload {
  /**
   * The engine's overall `architectureHealthScore` (raw, higher = worse) and
   * its 0–100 display normalization (higher = healthier) — the value the
   * "Actual Telemetry" gauge shows.
   */
  overall: { rawRiskScore: number; displayScore: number | null };
  /** All seven real pillars, in RADAR_PILLARS order. */
  pillars: TelemetryComparisonPillar[];
  /** Real critical/warning findings of the most recent run that has any. */
  findings: TelemetryComparisonFinding[];
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  /** The run in flight right now, if any — null when nothing is scanning. */
  activeRunId: string | null;
  /**
   * Deliberately null, and deliberately present rather than omitted.
   *
   * OPEN DESIGN QUESTION FOR SHANE (#245): there is no real quiz-answer →
   * pillar self-assessment mapping anywhere in this platform. `QuizProfile`
   * (msp-portal types.ts) collects role, department, industry, collaboration
   * patterns, data-sensitivity classes, workflow style, outcome priorities, four
   * 0–1 workload loads, tool usage and AI comfort — the quiz never asks the
   * customer to rate their own governance, compliance, architecture or
   * licensing posture, so nothing here can be derived without inventing a
   * mapping. Rather than fabricate a "Self" score per pillar, this stays null
   * and the client renders the real Actual series alone. Fill this in once
   * Shane decides either (a) which quiz answers legitimately stand in for which
   * pillar, or (b) that the quiz gains real per-pillar self-rating questions.
   */
  selfAssessment: null;
  generatedAt: string;
}

/**
 * Pure: turns one real engine output into the seven per-pillar display entries
 * plus the overall gauge value. No DB, no I/O — the whole scoring surface the
 * right panel renders, so a test can drive it with two different real engine
 * outputs and assert they genuinely differ.
 */
export function buildPillarViews(
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): { pillars: TelemetryComparisonPillar[]; overall: { rawRiskScore: number; displayScore: number | null } } {
  const pillars = RADAR_PILLARS.map((pillar) => {
    // One call, not two: `displayScore` is `evaluation.score`, so the number and
    // the reason it exists can never disagree about the same pillar (#517).
    const evaluation = evaluatePillarDisplay(pillar, output, impacts, evaluableSignalKeys);
    return {
      pillar,
      label: PILLAR_LABELS[pillar],
      displayScore: evaluation.score,
      rawRiskScore: output.breakdown.find((b) => b.pillar === pillar)?.score ?? 0,
      evaluation,
    };
  });

  return {
    pillars,
    overall: {
      rawRiskScore: output.score,
      displayScore: computeOverallDisplayScore(RADAR_PILLARS, output, impacts, evaluableSignalKeys),
    },
  };
}

/**
 * Pure: orders real findings the way the Top Discrepancies card shows them —
 * critical before warning, then by the check's own recommendation priority
 * where it has one (lower number = more urgent, as written by
 * `buildRecommendation` in diagnostics-runner.ts), then stably by check key so
 * two runs with identical findings can never disagree on order.
 */
export function rankDiscrepancies<T extends { severity: DiscrepancySeverity; checkKey: string; priority?: number | null }>(
  findings: T[],
  limit: number,
): T[] {
  const severityRank: Record<DiscrepancySeverity, number> = { critical: 0, warning: 1 };
  return [...findings]
    .sort((a, b) => {
      const bySeverity = severityRank[a.severity] - severityRank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      const byPriority = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER);
      if (byPriority !== 0) return byPriority;
      return a.checkKey.localeCompare(b.checkKey);
    })
    .slice(0, limit);
}

/** How many discrepancies the card shows. */
export const TOP_DISCREPANCY_LIMIT = 4;

/**
 * Assembles the full real payload for one customer. Every number traces to the
 * real engine or to a real persisted finding row; nothing is padded.
 */
export async function buildTelemetryComparison(customerId: number): Promise<TelemetryComparisonPayload> {
  const [output, { rules, groups }] = await Promise.all([
    calculateArchitectureHealthScore(customerId),
    fetchSignalRulesAndGroups(),
  ]);
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
    firedSignalKeys: output.rawSignals,
  });
  const impacts = getSignalHealthImpacts(rules, groups);

  const { pillars, overall } = buildPillarViews(output, impacts, evaluableSignalKeys);

  // The most recent run that actually OWNS findings — not simply the most
  // recent run, which mid-scan is the one still in flight and has none yet.
  const [latestFindingRun] = await db
    .select({ runId: mspDiagnosticFindingsTable.runId })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
    .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
    .limit(1);

  let findings: TelemetryComparisonFinding[] = [];
  let findingsRunStatus: string | null = null;

  if (latestFindingRun) {
    const rows = await db
      .select({
        findingId: mspDiagnosticFindingsTable.findingId,
        checkKey: mspDiagnosticFindingsTable.checkKey,
        checkLabel: mspDiagnosticFindingsTable.checkLabel,
        severity: mspDiagnosticFindingsTable.severity,
        title: mspDiagnosticFindingsTable.title,
        description: mspDiagnosticFindingsTable.description,
        recommendation: mspDiagnosticFindingsTable.recommendation,
      })
      .from(mspDiagnosticFindingsTable)
      .where(
        and(
          eq(mspDiagnosticFindingsTable.runId, latestFindingRun.runId),
          inArray(mspDiagnosticFindingsTable.severity, [...DISCREPANCY_SEVERITIES]),
        ),
      );

    findings = rankDiscrepancies(
      rows.map((r) => ({
        findingId: r.findingId,
        checkKey: r.checkKey,
        checkLabel: r.checkLabel,
        severity: r.severity as DiscrepancySeverity,
        title: r.title,
        description: r.description,
        category: r.recommendation?.category ?? null,
        priority: r.recommendation?.priority ?? null,
      })),
      TOP_DISCREPANCY_LIMIT,
    ).map(({ priority: _priority, ...finding }) => finding);

    const [runRow] = await db
      .select({ status: mspDiagnosticRunsTable.status })
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.runId, latestFindingRun.runId))
      .limit(1);
    findingsRunStatus = runRow?.status ?? null;
  }

  const [activeRun] = await db
    .select({ runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(
      and(
        eq(mspDiagnosticRunsTable.customerId, customerId),
        inArray(mspDiagnosticRunsTable.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .orderBy(desc(mspDiagnosticRunsTable.createdAt))
    .limit(1);

  return {
    overall,
    pillars,
    findings,
    findingsRunId: latestFindingRun?.runId ?? null,
    findingsRunStatus,
    activeRunId: activeRun?.runId ?? null,
    selfAssessment: null,
    generatedAt: new Date().toISOString(),
  };
}
