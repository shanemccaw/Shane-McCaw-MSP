/**
 * health-display.ts
 *
 * Pure normalization layer that converts raw per-pillar risk scores from the
 * Health Engine into a 0–100 display scale where HIGHER means HEALTHIER.
 *
 * The raw engine scores are "risk accumulation" values — they grow as more
 * signals fire. The display layer flips this so the customer sees a positive,
 * percentage-style health score (matching the progress-bar metaphor used in
 * the customer portal).
 *
 * Algorithm (per pillar):
 *   theoreticalMax = sum over ALL signals of the MAX configured impact value
 *                    for that pillar (regardless of whether the signal fired).
 *   displayScore   = round(100 − min(100, (pillarRawScore / theoreticalMax) × 100))
 *                    clamped to [0, 100].
 *
 * If theoreticalMax is 0 (no rules have any impact configured for a pillar),
 * displayScore is returned as null and the UI should render "Not enough data yet".
 *
 * Pure — no DB access. Callers are responsible for fetching rules/groups.
 */

import {
  HEALTH_PILLARS,
  PILLAR_FIELD,
  getSignalHealthImpacts,
  type HealthPillar,
  type HealthEngineOutput,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

type PillarImpactField = keyof Omit<SignalHealthImpactConfig, "signalKey">;

/**
 * Single-pillar core of the normalization above, shared so the separately
 * computed security pillar (Security Engine — its breakdown entry is combined
 * into `HealthEngineOutput.breakdown` by `calculateArchitectureHealthScore`)
 * gets the exact same honest normalization as the six health pillars, without
 * a second normalization path. Returns null when no rules anywhere configure
 * an impact for the pillar (theoreticalMax = 0 — never fabricate), and also
 * when the output's breakdown carries no entry for the pillar at all (a
 * pure `computeHealthEngine` output has no security entry — treating that as
 * rawScore 0 would fabricate a perfect 100).
 */
export function computePillarDisplayScore(
  pillar: HealthPillar | "security",
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
): number | null {
  const field = PILLAR_FIELD[pillar] as PillarImpactField;

  let theoreticalMax = 0;
  for (const config of impacts.values()) {
    theoreticalMax += config[field] as number;
  }

  if (theoreticalMax === 0) return null;

  const pillarBreakdown = output.breakdown.find(b => b.pillar === pillar);
  if (!pillarBreakdown) return null;

  return Math.max(
    0,
    Math.min(100, Math.round(100 - (pillarBreakdown.score / theoreticalMax) * 100)),
  );
}

/**
 * Converts a `HealthEngineOutput` into a customer-facing display score for
 * each pillar. Returns an array in the same order as `HEALTH_PILLARS`.
 */
export function computeDisplayHealth(
  output: HealthEngineOutput,
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
): { pillar: HealthPillar; displayScore: number | null }[] {
  const impacts = getSignalHealthImpacts(rules, groups);

  return HEALTH_PILLARS.map(pillar => ({
    pillar,
    displayScore: computePillarDisplayScore(pillar, output, impacts),
  }));
}
