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
 *   theoreticalMax = sum over the GENUINELY EVALUABLE signals of the MAX
 *                    configured impact value for that pillar (regardless of
 *                    whether the signal actually fired). "Evaluable" is supplied
 *                    by the caller, and WHICH SET IT SUPPLIES IS THE WHOLE
 *                    CORRECTNESS QUESTION — see below. A rule that can never
 *                    fire — orphaned, miswired, or reading a key no check
 *                    produces — is EXCLUDED from the denominator. Otherwise its
 *                    weight silently inflates theoreticalMax the instant it is
 *                    created, shrinking (rawScore / theoreticalMax) and pushing
 *                    the pillar's score artificially HEALTHIER even though the
 *                    rule protects no one: the real, live-reproduced exploit
 *                    this guards against (a test rule with an extreme weight
 *                    that never fired still moved a pillar toward 100%).
 *   displayScore   = round(100 − min(100, (pillarRawScore / theoreticalMax) × 100))
 *                    clamped to [0, 100].
 *
 * The numerator (`pillarRawScore`) already excludes non-fed rules — a rule can
 * only contribute there by firing, which requires its sourceKey be present in
 * the tenant's profile, which only a producing check can put there. This layer
 * brings the DENOMINATOR into the same alignment; the numerator is untouched.
 *
 * ── The two sides must be measured over the SAME population (#413) ────────────
 * That alignment is not a nicety, it is the formula's precondition. The
 * numerator can only ever contain signals fed by checks THE TENANT ACTUALLY
 * RAN. If the caller supplies a denominator measured over a wider population,
 * the ratio is bounded above by the population ratio and the score is clamped
 * before any weight is considered:
 *
 *   catalog-wide denominator, tenant scanned with core:security-baseline
 *     100 − 29/122 × 100 = 76  ← the BEST-CASE-FOR-THE-TENANT floor: this is
 *                               what a tenant scores with EVERY check it ran
 *                               broken. On assess:copilot-readiness (7 checks)
 *                               the same floor is 95.
 *
 * That was the live customer-facing behaviour until #413, and it is why manual
 * weight patching (flattening 92 rows to 1, a lone 300, a 5000 on
 * globalAdminCount) never moved the number where it needed to go — the range
 * had already been clamped somewhere above "bad". Callers scoring A TENANT must
 * pass `fetchTenantEvaluableSignalKeys` (package-scoped). `fetchEvaluableSignalKeys`
 * (catalog-wide) remains correct for rule-authoring surfaces reasoning about the
 * corpus rather than about one tenant. Full analysis:
 * docs/weighted-scoring-investigation-413.md.
 *
 * If theoreticalMax is 0 (no EVALUABLE rule configures any impact for a
 * pillar), displayScore is returned as null and the UI should render "Not
 * enough data yet".
 *
 * Pure — no DB access. Callers are responsible for fetching rules/groups AND
 * the evaluable-signal-key set.
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
 * a second normalization path. Returns null when no EVALUABLE rule configures
 * an impact for the pillar (theoreticalMax = 0 — never fabricate), and also
 * when the output's breakdown carries no entry for the pillar at all (a
 * pure `computeHealthEngine` output has no security entry — treating that as
 * rawScore 0 would fabricate a perfect 100).
 *
 * `evaluableSignalKeys` is the set of signal keys whose rules read a sourceKey
 * some real monitor check can genuinely produce (see file header). Only their
 * impacts count toward theoreticalMax; a rule reading a non-producible key can
 * never fire and so must not inflate the denominator.
 */
export function computePillarDisplayScore(
  pillar: HealthPillar | "security",
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): number | null {
  const field = PILLAR_FIELD[pillar] as PillarImpactField;

  let theoreticalMax = 0;
  for (const [signalKey, config] of impacts.entries()) {
    if (!evaluableSignalKeys.has(signalKey)) continue; // non-producible → can never fire → must not dilute the denominator
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
 * The SAME normalization as `computePillarDisplayScore`, applied one level up —
 * to the whole-engine score rather than to a single pillar.
 *
 * This is deliberately NOT a second scoring model, and deliberately NOT an
 * average of the per-pillar display scores (which would silently weight a
 * pillar carrying one tiny rule equally with one carrying twenty, i.e. a new
 * formula). It is the identical `100 − raw/theoreticalMax × 100` expression
 * with both sides summed over the caller's pillar list — the same aggregation
 * `calculateArchitectureHealthScore` itself performs when it reports one
 * `score` for the tenant (`healthResult.score + securityResult.score`).
 *
 * The pillar list is a parameter rather than `HEALTH_PILLARS`, so the caller
 * can pass the security-inclusive radar set (`RADAR_PILLARS`, which lives in
 * pillar-coverage.ts and imports THIS module) without creating an import cycle.
 *
 * Returns null when no evaluable rule configures any impact across the given
 * pillars — the same "never fabricate a score with no data behind it" guard the
 * per-pillar function applies.
 */
export function computeOverallDisplayScore(
  pillars: readonly (HealthPillar | "security")[],
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): number | null {
  let theoreticalMax = 0;
  let rawScore = 0;

  for (const pillar of pillars) {
    const field = PILLAR_FIELD[pillar] as PillarImpactField;
    for (const [signalKey, config] of impacts.entries()) {
      if (!evaluableSignalKeys.has(signalKey)) continue;
      theoreticalMax += config[field] as number;
    }
    // A pillar with no breakdown entry contributes no raw score — and, unlike
    // the per-pillar function, that is safe here: its weights are still in the
    // denominator, so a missing pillar can only make the overall look worse,
    // never fabricate a better one.
    rawScore += output.breakdown.find(b => b.pillar === pillar)?.score ?? 0;
  }

  if (theoreticalMax === 0) return null;

  return Math.max(0, Math.min(100, Math.round(100 - (rawScore / theoreticalMax) * 100)));
}

/**
 * Converts a `HealthEngineOutput` into a customer-facing display score for
 * each pillar. Returns an array in the same order as `HEALTH_PILLARS`.
 *
 * `evaluableSignalKeys` restricts each pillar's theoreticalMax denominator to
 * genuinely evaluable rules (see `computePillarDisplayScore` / the file
 * header). Callers scoring a TENANT build it once via
 * `fetchTenantEvaluableSignalKeys` (pillar-coverage.ts) — package-scoped, per
 * #413 — and pass it in, keeping this function pure.
 */
export function computeDisplayHealth(
  output: HealthEngineOutput,
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  evaluableSignalKeys: ReadonlySet<string>,
): { pillar: HealthPillar; displayScore: number | null }[] {
  const impacts = getSignalHealthImpacts(rules, groups);

  return HEALTH_PILLARS.map(pillar => ({
    pillar,
    displayScore: computePillarDisplayScore(pillar, output, impacts, evaluableSignalKeys),
  }));
}
