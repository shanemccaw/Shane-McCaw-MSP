/**
 * doc-gate-coverage.ts
 *
 * Single source of truth for the "is this diagnostics run evaluable enough to
 * generate client documents?" decision — the graded replacement for the old
 * hard `msp_diagnostic_runs.status = 'completed'` gate.
 *
 * WHY THIS EXISTS (confirmed live, not hypothetical): a tenant whose scan
 * produced 9 real passing checks + 10 real license-gap findings (~65% of the
 * package genuinely evaluable, real signal) was permanently blocked from ever
 * getting documents because 2 checks hit a genuine technical error, dragging the
 * run's overall `status` to `'partial'` forever. All-or-nothing discarded real,
 * meaningful signal. This helper grades the run instead.
 *
 * ── The coverage formula ──────────────────────────────────────────────────────
 *   evaluableChecks = checksOk + checksLicenseGap
 *   coverage        = evaluableChecks / checksTotal
 *
 * License gaps count as COVERAGE, not as failures, on purpose: a license gap is
 * a real, honest, reportable outcome ("this check couldn't run because the
 * tenant lacks the Microsoft 365 add-on — here's the upsell", per the landed
 * License-Gap Sales Offer wiring), NOT a failure to evaluate. Only `checksError`
 * (genuine technical failures + consent revocations) and un-run `requiresScript`
 * checks are absent from the numerator, so a Graph-only assessment that could
 * not run script-only checks scores honestly on what it actually covered.
 *
 * ── The threshold: 50% (DOC_GATE_MIN_COVERAGE_PCT) ────────────────────────────
 * A run proceeds to document generation when at least HALF the package's checks
 * produced a real, reportable result (a pass or an honest license-gap upsell).
 *
 * Reasoning (this is a real product decision — tune DOC_GATE_MIN_COVERAGE_PCT to
 * change it, it is the only knob):
 *   - At >= 50%, the majority of the assessed surface produced real signal, so
 *     the CIO narrative / SOW is grounded in genuine data for the bulk of what
 *     was checked. The confirmed-live 65%-coverage tenant clears this and gets
 *     its documents — the exact case this work exists to unblock.
 *   - Below 50%, most of the package is dark. A narrative written over mostly-
 *     absent data is dominated by what could NOT be evaluated, which is both a
 *     thin deliverable and a real fabrication risk — so we do NOT generate, and
 *     the caller reports honestly WHY (see reason) rather than silently hanging.
 *   - Genuine technical errors (`checksError`) never block a run that has already
 *     cleared 50% — they are surfaced honestly inside the documents as "couldn't
 *     verify this, here's why", never hidden and never treated as blocking.
 *
 * This helper is intentionally pure (no DB, no logging) so both the workflow
 * gate (workflow-executor.ts `assessment_doc_gate`) and the fire-and-forget CIO
 * narrative trigger (diagnostics-runner.ts) share ONE definition of "enough".
 */

/** The single tunable knob: minimum evaluable-check coverage (percent) required
 *  to generate client documents. See the reasoning block above before changing. */
export const DOC_GATE_MIN_COVERAGE_PCT = 50;

export interface CoverageCounts {
  /** Checks that ran and returned a real "ok" result. */
  checksOk: number;
  /** Checks that could not run because the tenant lacks the required M365 SKU —
   *  a real, reportable outcome (upsell), counted as coverage. */
  checksLicenseGap: number;
  /** Genuine technical errors + consent revocations — NOT coverage. */
  checksError: number;
  /** Total checks in the package (includes un-run requiresScript checks). */
  checksTotal: number;
}

export type CoverageBand =
  /** No checks ran at all — nothing to report, never generate. */
  | "no_data"
  /** Some checks ran but coverage is below the bar — do NOT generate, report why. */
  | "insufficient"
  /** Coverage cleared the bar — proceed with real document generation. */
  | "sufficient";

export interface CoverageDecision {
  band: CoverageBand;
  /** checksOk + checksLicenseGap */
  evaluableChecks: number;
  /** echo of checksTotal */
  totalChecks: number;
  /** integer 0–100; 0 when totalChecks is 0 */
  coveragePct: number;
  /** true only for the "sufficient" band */
  proceed: boolean;
  /** short machine-stable reason string, safe to log and to surface as a status */
  reason: string;
}

/**
 * Grade a diagnostics run's real check counts into a coverage band + decision.
 * Pure and total — never throws; missing/NaN counts are treated as 0.
 */
export function evaluateDocGateCoverage(counts: CoverageCounts): CoverageDecision {
  const ok = Number.isFinite(counts.checksOk) ? counts.checksOk : 0;
  const gap = Number.isFinite(counts.checksLicenseGap) ? counts.checksLicenseGap : 0;
  const total = Number.isFinite(counts.checksTotal) ? counts.checksTotal : 0;

  const evaluableChecks = ok + gap;

  if (total <= 0) {
    return {
      band: "no_data",
      evaluableChecks,
      totalChecks: 0,
      coveragePct: 0,
      proceed: false,
      reason: "no checks ran — nothing to evaluate",
    };
  }

  const coveragePct = Math.round((evaluableChecks / total) * 100);

  if (coveragePct >= DOC_GATE_MIN_COVERAGE_PCT) {
    return {
      band: "sufficient",
      evaluableChecks,
      totalChecks: total,
      coveragePct,
      proceed: true,
      reason: `coverage ${coveragePct}% >= ${DOC_GATE_MIN_COVERAGE_PCT}% — sufficient real signal to generate documents`,
    };
  }

  return {
    band: "insufficient",
    evaluableChecks,
    totalChecks: total,
    coveragePct,
    proceed: false,
    reason: `coverage ${coveragePct}% < ${DOC_GATE_MIN_COVERAGE_PCT}% — too few checks produced a real result to generate documents (likely a permissions or connectivity problem blocking evaluation)`,
  };
}
