/**
 * copilot-gate.ts — the Copilot Gate: one score, one threshold, one verdict.
 *
 * #358 / #359. Before this file there were two unreconciled answers to "how
 * ready is this tenant for Copilot":
 *
 *   1. `copilot-readiness.ts` — a narrow three-indicator formula (SharePoint
 *      oversharing 50%, sensitivity labels 30%, DLP 20%), all Compliance-adjacent.
 *      No Security, Licensing, Adoption, Health or Governance-ownership signal
 *      anywhere in it. This is what `/portal/diagnostics/status` returned as
 *      `copilotReadiness.overall.score`, and therefore what the Reveal's headline
 *      verdict number has been reading.
 *   2. The unified health engine — `health-engine.ts`'s `HEALTH_PILLARS`, which
 *      has ALWAYS carried `copilot` as a native pillar with its own
 *      `copilotImpact` field, normalized by `health-display.ts`'s
 *      `computePillarDisplayScore` exactly like every other pillar. This is what
 *      `/portal/pillars` already serves, and therefore what the Reveal's six
 *      pillar scenes have been reading.
 *
 * So the Reveal's headline number was not mathematically derived from the pillar
 * scores shown alongside it, even though the whole "six findings, one number"
 * framing asserts that it is. Shane's call (#358): the engine's Copilot pillar
 * is the real number, and the 82 Gate applies directly to it.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is NOT a third scoring model. `computeCopilotPillarScore` runs the exact
 * same five-step chain `buildPillarSummary` runs for its copilot card —
 * same engine output, same impacts map, same evaluable-signal-key denominator
 * guard, same `computePillarDisplayScore` call. Two callers, one definition; a
 * test asserts the two agree for the same engine input. Nothing here re-weights,
 * re-bands or post-processes what the engine returns.
 *
 * `copilot-readiness.ts` is deliberately still alive and still called: its three
 * sub-indicators are real, separately useful, and read by six components
 * (CopilotUsage, DlpEffectivenessCard, LabelCoverageCard, EnablementControls,
 * LabelAndDlpSection, SneakPeekInsights) for their own detail. What #358 retires
 * is its claim to be the OVERALL number, not the module.
 */

import { calculateArchitectureHealthScore, getSignalHealthImpacts } from "./health-engine.ts";
import {
  evaluatePillarDisplay,
  MIN_EVALUABLE_SIGNALS_PER_PILLAR,
  type PillarEvaluation,
  type PillarEvaluationStatus,
} from "./health-display.ts";
import { fetchTenantEvaluableSignalKeys } from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * The real Copilot Gate threshold, confirmed by Shane (#359).
 *
 * At or above 82 = Go. Below 82 = No-Go. The boundary case was raised explicitly
 * and answered explicitly: 82 itself is a Go.
 *
 * This is a fixed real number, not a configuration surface — #359 is blunt about
 * that ("a single constant plus a comparison — do not build a separate scoring
 * model or configuration system around it"). msp-portal holds the client-side
 * mirror in `journeyTokens.ts`'s `COPILOT_GATE_TARGET`; the two are asserted
 * equal by a test on each side, since the apps cannot import across each other.
 */
export const COPILOT_GATE_THRESHOLD = 82;

/** Go / No-Go. `null` when there is no score to gate on — never a default verdict. */
export type CopilotGateStatus = "go" | "no_go";

/**
 * The Gate verdict for a score.
 *
 * `null` in, `null` out, deliberately: a tenant whose scan could not evaluate a
 * single Copilot-impacting rule has no readiness figure, and calling that
 * "No-Go" would state a finding the platform has not made. The UI renders an
 * unavailable state for null, never a red verdict.
 */
export function copilotGateStatus(score: number | null): CopilotGateStatus | null {
  if (score === null) return null;
  return score >= COPILOT_GATE_THRESHOLD ? "go" : "no_go";
}

/**
 * WHY there is (or is not) a score — the explicit real-coverage status #517
 * requires on the wire.
 *
 * A bare `score: null` told every client the same thing about three genuinely
 * different tenants: one whose Copilot pillar nothing feeds, one whose scan
 * covered a single Copilot-impacting signal, and one whose engine call failed
 * outright. Each deserves different copy, and a client cannot write it from a
 * null. This carries the distinction rather than making the frontend infer it.
 *
 * `theoreticalMax` is deliberately NOT re-exported here: it is a scoring
 * internal, and putting a raw denominator on a customer-facing wire invites
 * exactly the sort of derived arithmetic this file exists to centralise.
 */
export interface CopilotGateEvaluation {
  readonly status: PillarEvaluationStatus;
  /** Evaluable signals genuinely carrying a Copilot impact for this tenant. */
  readonly evaluableSignalCount: number;
  /** Echo of the floor, so no client hardcodes its own copy of it. */
  readonly minRequiredSignals: number;
  /** Short, machine-stable, safe to log and to surface as copy. */
  readonly reason: string;
}

export interface CopilotGateResult {
  /**
   * The engine's Copilot pillar display score, 0-100, higher = healthier.
   * Non-null only when `evaluation.status === "scored"` (#517) — a tenant below
   * the real-coverage floor gets no number at all rather than the clean-looking
   * 100 that "zero bad things found out of one thing checked" produces.
   */
  readonly score: number | null;
  readonly threshold: number;
  readonly status: CopilotGateStatus | null;
  /**
   * Provenance, so no consumer has to guess which of the two historical scoring
   * systems produced the number it is rendering.
   */
  readonly source: "health_engine:copilot";
  /** Whether the platform is entitled to show a number here at all (#517). */
  readonly evaluation: CopilotGateEvaluation;
}

/**
 * Wraps a score in its Gate verdict. Pure — the shape every surface renders.
 *
 * `evaluation` is optional so the many pure call sites that only care about the
 * verdict boundary stay one argument long. Omitting it on a null score yields
 * `"not_evaluated"`, which is the honest reading of "somebody handed us no
 * score and no reason" — never `"scored"`, and never a fabricated count.
 */
export function copilotGate(
  score: number | null,
  evaluation?: CopilotGateEvaluation,
): CopilotGateResult {
  return {
    score,
    threshold: COPILOT_GATE_THRESHOLD,
    status: copilotGateStatus(score),
    source: "health_engine:copilot",
    evaluation:
      evaluation ??
      (score === null
        ? {
            status: "not_evaluated",
            evaluableSignalCount: 0,
            minRequiredSignals: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
            reason: "no Copilot pillar evaluation was performed for this tenant",
          }
        : {
            status: "scored",
            evaluableSignalCount: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
            minRequiredSignals: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
            reason: "scored",
          }),
  };
}

/**
 * The Gate for a tenant the platform has not measured yet, with the real reason
 * why. Distinct from `copilotGate(null)` only in that the caller gets to say
 * WHAT it could not measure — used by the status route before a completed scan
 * exists, and by the engine-failure path below.
 */
export function copilotGateNotEvaluated(reason: string): CopilotGateResult {
  return copilotGate(null, {
    status: "not_evaluated",
    evaluableSignalCount: 0,
    minRequiredSignals: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
    reason,
  });
}

/**
 * The Copilot pillar's display score for one customer, straight from the unified
 * engine.
 *
 * Identical chain to `buildPillarSummary`, deliberately:
 *   calculateArchitectureHealthScore → fetchSignalRulesAndGroups →
 *   fetchTenantEvaluableSignalKeys → getSignalHealthImpacts → computePillarDisplayScore
 *
 * The denominator is the tenant-scoped one since #413. That matters more here
 * than anywhere else in the platform: `assess:copilot-readiness` curates SEVEN
 * checks, so scoring it against the ~122-check catalog put a 95/100 floor under
 * the Gate — the 82 threshold was unreachable from below and every tenant was a
 * Go by construction.
 *
 * Not scored when the engine has no evaluable rule configuring a `copilotImpact`
 * (theoreticalMax 0), when there is no breakdown entry for the pillar, or —
 * since #517 — when fewer than `MIN_EVALUABLE_SIGNALS_PER_PILLAR` evaluable
 * signals genuinely carry one. All three are `evaluatePillarDisplay`'s own
 * never-fabricate guards, not re-implemented here.
 */
export async function computeCopilotPillarEvaluation(
  customerId: number,
): Promise<PillarEvaluation> {
  const [output, { rules, groups }] = await Promise.all([
    calculateArchitectureHealthScore(customerId),
    fetchSignalRulesAndGroups(),
  ]);
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
    firedSignalKeys: output.rawSignals,
  });
  const impacts = getSignalHealthImpacts(rules, groups);
  return evaluatePillarDisplay("copilot", output, impacts, evaluableSignalKeys);
}

/**
 * The score half of the above, for callers that genuinely only want the number.
 * Kept so nothing that already reads a Copilot score has to learn a new shape.
 */
export async function computeCopilotPillarScore(customerId: number): Promise<number | null> {
  return (await computeCopilotPillarEvaluation(customerId)).score;
}

/**
 * The full Gate result for one customer. Never throws: a failure to reach the
 * engine degrades to "no score", which every surface already renders honestly,
 * rather than taking down the status route that carries the scan and document
 * state alongside it. That degradation now says so in `evaluation.reason`
 * instead of being indistinguishable from a tenant nothing feeds (#517).
 *
 * `opts.evaluation` (Git #555) lets a caller that has ALREADY run this exact
 * chain for the same customer in the same request hand the result back rather
 * than pay for a second full engine run — document generation now resolves the
 * Copilot pillar once for its per-finding point values and reuses it here. It is
 * not a way to inject a score: the only thing that produces a `PillarEvaluation`
 * is `evaluatePillarDisplay`, and every honesty guard in this file applies to it
 * identically whether it arrived by argument or by call. Passing one also
 * removes a real failure mode — two engine runs milliseconds apart could in
 * principle disagree, putting a cited point value and a stated score in the same
 * document on different footings.
 */
export async function computeCopilotGate(
  customerId: number,
  opts?: { evaluation?: PillarEvaluation },
): Promise<CopilotGateResult> {
  try {
    const evaluation = opts?.evaluation ?? (await computeCopilotPillarEvaluation(customerId));
    if (evaluation.status !== "scored") {
      log.info(
        { customerId, status: evaluation.status, evaluableSignalCount: evaluation.evaluableSignalCount },
        "copilot-gate: withholding a Copilot score — insufficient real coverage",
      );
    }
    return copilotGate(evaluation.score, {
      status: evaluation.status,
      evaluableSignalCount: evaluation.evaluableSignalCount,
      minRequiredSignals: evaluation.minRequiredSignals,
      reason: evaluation.reason,
    });
  } catch (err) {
    log.warn({ err, customerId }, "copilot-gate: pillar score computation failed — reporting no score");
    return copilotGateNotEvaluated(
      "the readiness engine could not be reached for this tenant — no score was computed",
    );
  }
}
