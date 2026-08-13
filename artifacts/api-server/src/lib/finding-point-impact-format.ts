/**
 * finding-point-impact-format.ts — the shapes and the prompt-facing wording for
 * Git #555's real per-finding point values.
 *
 * Split from `finding-point-impact.ts` (which owns the computation and the full
 * reasoning about why the raw `signal_derivation_rules` impact column is NOT the
 * point value) for one structural reason: this half must stay reachable without
 * loading the scoring engine. `finding-point-impact.ts` pulls in health-engine →
 * priority-engine → tenant-signals → the DB client, so anything that only needs
 * to RENDER a result — `document-engine.ts`'s findings-block assembly, and the
 * tests that assert what the model is handed — would otherwise drag the whole
 * engine graph behind it.
 *
 * Pure. No DB, no clock, no imports that survive type erasure.
 */

import type { PillarEvaluation } from "./health-display.ts";

/** What the platform can honestly say about ONE finding's point value. */
export type FindingPointImpactStatus =
  /** Real firing signals resolve to this check; `points` is their recovered movement. */
  | "scored"
  /** Signals resolve, but none is currently firing with a positive Copilot impact —
   *  a real measured zero, not a missing value. */
  | "no_points"
  /** No signal in the engine resolves to this check (or the finding has no check
   *  key at all — every script-run finding). Nothing to state. */
  | "unattributed";

export interface FindingPointImpact {
  /** The `monitor_checks.key` this was resolved for, or null for a check-less finding. */
  readonly checkKey: string | null;
  readonly status: FindingPointImpactStatus;
  /** Points (of 100) the Copilot score recovers. Rounded to 1dp. 0 unless `scored`. */
  readonly points: number;
  /** The firing signals this finding claimed. Provenance, and the dedupe receipt. */
  readonly signalKeys: readonly string[];
}

export interface FindingPointImpactResult {
  readonly pillar: "copilot";
  /** The Copilot pillar evaluation this was measured against — the SAME object the
   *  Gate is built from, so a document can never quote points against one score and
   *  a verdict against another. */
  readonly evaluation: PillarEvaluation;
  /** Non-null by construction (the result is null unless the pillar scored). */
  readonly score: number;
  readonly threshold: number;
  /** Points the score recovers if EVERY currently-firing Copilot-impacting signal
   *  is cleared — `rawScore / theoreticalMax × 100`, i.e. the whole distance to 100. */
  readonly totalRecoverablePoints: number;
  /** 1:1 with the finding list handed in, same order. */
  readonly perFinding: readonly FindingPointImpact[];
}

/**
 * Rounds to one decimal — the granularity the values genuinely carry. The live
 * corpus's baseline weight is 1 against a Copilot denominator around 260, i.e.
 * 0.4 points; reported as an integer that is 0, which tells the reader the fix
 * is free of consequence when it is not.
 */
export function roundPoints(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The per-finding line appended under each numbered finding. Pure. */
export function formatFindingPointImpactLine(impact: FindingPointImpact | undefined): string {
  const notAttributable =
    "   POINT IMPACT IF FIXED: NOT ATTRIBUTABLE — the platform resolved no scored signal for this finding.";
  if (!impact) return notAttributable;
  switch (impact.status) {
    case "scored":
      return `   POINT IMPACT IF FIXED: ${impact.points.toFixed(1)} points`;
    case "no_points":
      return "   POINT IMPACT IF FIXED: 0.0 points — this finding is not currently costing this tenant any readiness points.";
    default:
      return notAttributable;
  }
}

/**
 * The ground-truth preamble that heads the findings block once real values are
 * available. Given the same `pricingFormula`/`{{copilotGate}}` treatment #547
 * established: a computed platform result the model restates, explicitly not
 * telemetry it interprets.
 *
 * The reconciliation figures are stated FOR the model rather than left to it —
 * "82 minus 53" and "sum these fifteen decimals" are both exactly the arithmetic
 * every one of these prompts forbids it from doing.
 */
export function buildFindingPointImpactPreamble(result: FindingPointImpactResult): string {
  const pointsShown = roundPoints(result.perFinding.reduce((s, f) => s + f.points, 0));
  const gap = result.score >= result.threshold ? null : result.threshold - result.score;
  return [
    "POINT IMPACT — PLATFORM GROUND TRUTH, DO NOT RECALCULATE",
    "Every finding below carries its own \"POINT IMPACT IF FIXED\" line. That number is",
    "computed by the platform's health engine on exactly the same basis as the Copilot",
    "go-live score itself: it is how many points, out of 100, this tenant's readiness",
    "score recovers when that finding is fully resolved and the signal behind it stops",
    "firing. These are real measured values, not estimates. Cite them as given — do not",
    "round them, re-derive them, average them, scale them, or hedge them, and never",
    "state that no point value was supplied for a finding that carries one.",
    "",
    `  Current readiness score: ${result.score} out of 100`,
    `  Copilot Gate: ${result.threshold}`
      + (gap === null ? "  (already cleared)" : `  —  points needed to clear it: ${gap}`),
    `  Points recoverable across every finding currently costing this tenant points: ${result.totalRecoverablePoints.toFixed(1)}`,
    `  Points shown in the list below: ${pointsShown.toFixed(1)}`,
    "",
    "The values are per finding and additive — two fixes worth 6.5 and 4.0 together",
    "recover 10.5 points. A line reading \"NOT ATTRIBUTABLE\" means the platform resolved",
    "no scored signal behind that finding: say exactly that for it, and never put a",
    "number of your own in its place. A line reading 0.0 points is a real measured zero,",
    "not a missing value.",
    "",
    "This whole block, and the \"POINT IMPACT IF FIXED\" line under each finding, are for your",
    "own internal calculation only — they are how you know what number to cite, not text meant",
    "to reach the reader. Never print, quote, or reproduce this block's own labels anywhere in",
    "the document (\"POINT IMPACT IF FIXED:\", \"PLATFORM GROUND TRUTH\", \"NOT ATTRIBUTABLE\" as",
    "a heading, or similar). State the point values themselves, in your own sentences, exactly",
    "as given.",
  ].join("\n");
}
