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
 * Converts a `HealthEngineOutput` into a customer-facing display score for
 * each pillar. Returns an array in the same order as `HEALTH_PILLARS`.
 */
export function computeDisplayHealth(
  output: HealthEngineOutput,
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
): { pillar: HealthPillar; displayScore: number | null }[] {
  const impacts = getSignalHealthImpacts(rules, groups);

  return HEALTH_PILLARS.map(pillar => {
    const field = PILLAR_FIELD[pillar] as PillarImpactField;

    let theoreticalMax = 0;
    for (const config of impacts.values()) {
      theoreticalMax += config[field] as number;
    }

    if (theoreticalMax === 0) {
      return { pillar, displayScore: null };
    }

    const pillarBreakdown = output.breakdown.find(b => b.pillar === pillar);
    const rawScore = pillarBreakdown?.score ?? 0;

    const displayScore = Math.max(
      0,
      Math.min(100, Math.round(100 - (rawScore / theoreticalMax) * 100)),
    );

    return { pillar, displayScore };
  });
}
