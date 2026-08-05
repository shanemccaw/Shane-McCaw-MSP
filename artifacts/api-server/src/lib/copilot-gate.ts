/**
 * copilot-gate.ts — the Copilot Gate: one score, one threshold, one verdict.
 *
 * #358 / #359. Before this file there were two unreconciled answers to "how
 * ready is this tenant for Copilot":
 *
 *   1. `copilot-readiness.ts` — a narrow three-indicator formula (SharePoint
 *      oversharing 50%, sensitivity labels 30%, DLP 20%), all Compliance-adjacent.
 *      No Security, Licensing, Adoption, Health or Governance-ownership signal
 *      anywhere in it. This is what `/portal/assessment/status` returned as
 *      `copilotReadiness.overall.score`, and therefore what the Reveal's headline
 *      verdict number has been reading.
 *   2. The unified health engine — `health-engine.ts`'s `HEALTH_PILLARS`, which
 *      has ALWAYS carried `copilot` as a native pillar with its own
 *      `copilotImpact` field, normalized by `health-display.ts`'s
 *      `computePillarDisplayScore` exactly like every other pillar. This is what
 *      `war-room-pillars` already serves, and therefore what the Reveal's six
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
 * same five-step chain `buildWarRoomPillarStats` runs for its copilot card —
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
import { computePillarDisplayScore } from "./health-display.ts";
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

export interface CopilotGateResult {
  /** The engine's Copilot pillar display score, 0-100, higher = healthier. */
  readonly score: number | null;
  readonly threshold: number;
  readonly status: CopilotGateStatus | null;
  /**
   * Provenance, so no consumer has to guess which of the two historical scoring
   * systems produced the number it is rendering.
   */
  readonly source: "health_engine:copilot";
}

/** Wraps a score in its Gate verdict. Pure — the shape every surface renders. */
export function copilotGate(score: number | null): CopilotGateResult {
  return {
    score,
    threshold: COPILOT_GATE_THRESHOLD,
    status: copilotGateStatus(score),
    source: "health_engine:copilot",
  };
}

/**
 * The Copilot pillar's display score for one customer, straight from the unified
 * engine.
 *
 * Identical chain to `buildWarRoomPillarStats`, deliberately:
 *   calculateArchitectureHealthScore → fetchSignalRulesAndGroups →
 *   fetchTenantEvaluableSignalKeys → getSignalHealthImpacts → computePillarDisplayScore
 *
 * The denominator is the tenant-scoped one since #413. That matters more here
 * than anywhere else in the platform: `assess:copilot-readiness` curates SEVEN
 * checks, so scoring it against the ~122-check catalog put a 95/100 floor under
 * the Gate — the 82 threshold was unreachable from below and every tenant was a
 * Go by construction.
 *
 * `null` when the engine has no evaluable rule configuring a `copilotImpact`
 * (theoreticalMax 0) or no breakdown entry for the pillar — `computePillarDisplayScore`'s
 * own never-fabricate guards, not re-implemented here.
 */
export async function computeCopilotPillarScore(customerId: number): Promise<number | null> {
  const [output, { rules, groups }] = await Promise.all([
    calculateArchitectureHealthScore(customerId),
    fetchSignalRulesAndGroups(),
  ]);
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
    firedSignalKeys: output.rawSignals,
  });
  const impacts = getSignalHealthImpacts(rules, groups);
  return computePillarDisplayScore("copilot", output, impacts, evaluableSignalKeys);
}

/**
 * The full Gate result for one customer. Never throws: a failure to reach the
 * engine degrades to "no score", which every surface already renders honestly,
 * rather than taking down the status route that carries the scan and document
 * state alongside it.
 */
export async function computeCopilotGate(customerId: number): Promise<CopilotGateResult> {
  try {
    return copilotGate(await computeCopilotPillarScore(customerId));
  } catch (err) {
    log.warn({ err, customerId }, "copilot-gate: pillar score computation failed — reporting no score");
    return copilotGate(null);
  }
}
