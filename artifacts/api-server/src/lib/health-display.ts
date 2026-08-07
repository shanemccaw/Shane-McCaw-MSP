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
 * ── The insufficient-data gate (#517 / #503) ──────────────────────────────────
 * theoreticalMax === 0 was, until #517, the ONLY thing standing between a tenant
 * with no real data and a confident number. It is not enough, and the reason is
 * arithmetic rather than opinion: the formula is
 * `100 − rawScore/theoreticalMax × 100`, and rawScore can only accumulate from
 * signals that FIRED. A pillar backed by ONE evaluable signal therefore has a
 * two-valued "percentage" — 100 if that single signal stayed quiet, or whatever
 * one weight over itself gives if it fired. The clean case renders as a flawless
 * 100 and a "CLEARED FOR ROLLOUT" verdict that is indistinguishable on screen
 * from a genuinely well-covered, genuinely clean tenant. Shane's framing, which
 * this module now implements rather than merely documents: "I would rather an
 * error message on the Scanner than display a lie."
 *
 * So evaluability is now measured as well as summed. Alongside theoreticalMax
 * this counts HOW MANY evaluable signals genuinely carry a nonzero impact for
 * the pillar, and a pillar below `MIN_EVALUABLE_SIGNALS_PER_PILLAR` gets a
 * null score and an explicit `"insufficient_data"` status — never a computed
 * number. `evaluatePillarDisplay` is the full answer (status, count, reason);
 * `computePillarDisplayScore` is the score half of it, unchanged for every
 * caller that only wants the number.
 *
 * WHY A COUNT AND NOT A COVERAGE RATIO. The obvious shape — evaluable signals as
 * a PERCENTAGE of the catalog's signals for that pillar, mirroring
 * `DOC_GATE_MIN_COVERAGE_PCT` — is wrong here, and wrong in a way that would
 * have broken the flagship product. #413 established that a tenant's denominator
 * is deliberately PACKAGE-scoped: `assess:copilot-readiness` curates seven
 * checks out of a ~122-check catalog, so a correctly-scored Copilot tenant sits
 * at a single-digit percentage of the catalog BY DESIGN. A ratio floor would
 * mark every such tenant "insufficient" — the exact opposite of what #517 wants,
 * which is to catch the tenant whose data is genuinely missing, not the one
 * whose package is genuinely narrow. An absolute count asks the question that
 * actually matters: how many independent real things did we look at before
 * putting a number on this pillar.
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
 * THE knob (#517). How many evaluable signals must genuinely carry a nonzero
 * impact for a pillar before the platform will put a number on it.
 *
 * Set to 2, and the reasoning is deliberately conservative in BOTH directions:
 *
 *   - Below 2 there is nothing to gate. One signal gives a score that can take
 *     exactly two values; calling that a percentage out of 100 is the lie this
 *     constant exists to stop. Two is the smallest floor that rules out the
 *     mathematically degenerate case.
 *   - Not higher than 2, because the Copilot pillar — the one the headline Gate
 *     verdict reads — is genuinely narrow TODAY. `copilot_impact` is flat 0
 *     outside the Copilot pillar itself (measured, #414), and widening it across
 *     the catalog is separate in-flight work (#516). A floor of 4 or 5 chosen on
 *     aesthetics would null the headline score for every real tenant, which is
 *     not honesty, it is an outage.
 *
 * Tune it here and nowhere else — every surface reads this one constant.
 *
 * This value was chosen from code, not measured: no database is reachable from
 * the environment it was written in, so no live per-pillar count informed it.
 * `lib/db/migrations/manual/archive/diagnostics/2026-08-07-517-pillar-evaluable-signal-counts.sql`
 * reports the real counts per pillar and per monitoring package — run it before
 * raising this, and especially before raising it past what the Copilot pillar
 * genuinely carries.
 */
export const MIN_EVALUABLE_SIGNALS_PER_PILLAR = 2;

/**
 * What the platform is entitled to SAY about a pillar, distinct from what it
 * computed. Deliberately three states rather than a nullable number, so no
 * consumer has to infer which kind of nothing a `null` score is (#517 asked for
 * exactly this: "an explicit distinct status rather than a bare null the
 * frontend has to correctly interpret on its own").
 */
export type PillarEvaluationStatus =
  /** Enough real coverage to state a number. `score` is non-null. */
  | "scored"
  /** Real coverage exists but is below the floor — a number here would be a
   *  guess dressed as a measurement. `score` is null. */
  | "insufficient_data"
  /** Nothing evaluable at all: no signal carries an impact for this pillar, or
   *  the engine produced no breakdown entry for it. `score` is null. */
  | "not_evaluated";

export interface PillarEvaluation {
  readonly status: PillarEvaluationStatus;
  /** 0–100, higher = healthier. Non-null ONLY when `status === "scored"`. */
  readonly score: number | null;
  /** Evaluable signals carrying a nonzero impact for this pillar. */
  readonly evaluableSignalCount: number;
  /** Echo of `MIN_EVALUABLE_SIGNALS_PER_PILLAR`, so a client never hardcodes it. */
  readonly minRequiredSignals: number;
  /** The denominator that was (or would have been) used. Provenance, not display. */
  readonly theoreticalMax: number;
  /** Short machine-stable explanation, safe to log and to surface as copy. */
  readonly reason: string;
}

/**
 * The full honest answer for one pillar: the score AND whether the platform is
 * entitled to show it (#517).
 *
 * Same normalization `computePillarDisplayScore` has always performed — the
 * arithmetic below is untouched, and a pillar that clears the floor scores
 * exactly what it scored before. What is new is that the denominator is now
 * COUNTED as well as summed, and a pillar with too few genuinely evaluable
 * signals returns a null score with `"insufficient_data"` instead of the clean-
 * looking 100 that "zero bad things found out of one thing checked" produces.
 *
 * `theoreticalMax` still sums EVERY evaluable signal's impact field, including
 * any non-positive one, so the ratio is bit-for-bit what it was. Only signals
 * with a genuinely positive impact count toward `evaluableSignalCount` — a
 * signal weighted 0 for this pillar contributes nothing to the denominator and
 * is therefore not coverage of it, which is the same test `getPillarCoverage`
 * has always used to decide whether a pillar belongs on the radar at all.
 */
export function evaluatePillarDisplay(
  pillar: HealthPillar | "security",
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): PillarEvaluation {
  const field = PILLAR_FIELD[pillar] as PillarImpactField;

  let theoreticalMax = 0;
  let evaluableSignalCount = 0;
  for (const [signalKey, config] of impacts.entries()) {
    if (!evaluableSignalKeys.has(signalKey)) continue; // non-producible → can never fire → must not dilute the denominator
    const impact = config[field] as number;
    theoreticalMax += impact;
    if (impact > 0) evaluableSignalCount++;
  }

  const base = {
    score: null,
    evaluableSignalCount,
    minRequiredSignals: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
    theoreticalMax,
  } as const;

  if (theoreticalMax <= 0 || evaluableSignalCount === 0) {
    return {
      ...base,
      status: "not_evaluated",
      reason: `no evaluable signal configures a ${pillar} impact — nothing was measured for this pillar`,
    };
  }

  const pillarBreakdown = output.breakdown.find(b => b.pillar === pillar);
  if (!pillarBreakdown) {
    // A pure `computeHealthEngine` output carries no security entry; treating
    // that as rawScore 0 would fabricate a perfect 100.
    return {
      ...base,
      status: "not_evaluated",
      reason: `the engine produced no ${pillar} breakdown entry — this pillar was not run`,
    };
  }

  if (evaluableSignalCount < MIN_EVALUABLE_SIGNALS_PER_PILLAR) {
    return {
      ...base,
      status: "insufficient_data",
      reason:
        `only ${evaluableSignalCount} evaluable signal${evaluableSignalCount === 1 ? "" : "s"} ` +
        `carries a ${pillar} impact (minimum ${MIN_EVALUABLE_SIGNALS_PER_PILLAR}) — too little real ` +
        `coverage to state a score`,
    };
  }

  return {
    ...base,
    status: "scored",
    score: Math.max(
      0,
      Math.min(100, Math.round(100 - (pillarBreakdown.score / theoreticalMax) * 100)),
    ),
    reason: `scored from ${evaluableSignalCount} evaluable ${pillar} signals`,
  };
}

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
 *
 * Since #517 this ALSO returns null for a pillar backed by fewer than
 * `MIN_EVALUABLE_SIGNALS_PER_PILLAR` genuinely evaluable signals. It is the
 * score half of `evaluatePillarDisplay` and nothing more — deliberately, so the
 * gate lands on every caller that has ever asked this module for a number
 * (the radar, the War Room cards, the Copilot Gate, the trend replay) without
 * each one having to remember to ask a second question first. A caller that
 * needs to tell "insufficient" from "never evaluated" — anything rendering copy
 * about WHY there is no number — calls `evaluatePillarDisplay` instead.
 */
export function computePillarDisplayScore(
  pillar: HealthPillar | "security",
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): number | null {
  return evaluatePillarDisplay(pillar, output, impacts, evaluableSignalKeys).score;
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
 * per-pillar function applies — and, since #517, when fewer than
 * `MIN_EVALUABLE_SIGNALS_PER_PILLAR` distinct evaluable signals carry a positive
 * impact anywhere across them. The count is of DISTINCT signals rather than
 * per-pillar sums: one signal weighted across six pillars is one real thing
 * observed, and counting it six times would let a single check unlock the
 * headline gauge — precisely the fabrication the per-pillar floor exists to
 * stop, re-created one level up.
 */
export function computeOverallDisplayScore(
  pillars: readonly (HealthPillar | "security")[],
  output: HealthEngineOutput,
  impacts: Map<string, SignalHealthImpactConfig>,
  evaluableSignalKeys: ReadonlySet<string>,
): number | null {
  let theoreticalMax = 0;
  let rawScore = 0;
  const contributingSignals = new Set<string>();

  for (const pillar of pillars) {
    const field = PILLAR_FIELD[pillar] as PillarImpactField;
    for (const [signalKey, config] of impacts.entries()) {
      if (!evaluableSignalKeys.has(signalKey)) continue;
      const impact = config[field] as number;
      theoreticalMax += impact;
      if (impact > 0) contributingSignals.add(signalKey);
    }
    // A pillar with no breakdown entry contributes no raw score — and, unlike
    // the per-pillar function, that is safe here: its weights are still in the
    // denominator, so a missing pillar can only make the overall look worse,
    // never fabricate a better one.
    rawScore += output.breakdown.find(b => b.pillar === pillar)?.score ?? 0;
  }

  if (theoreticalMax <= 0) return null;
  if (contributingSignals.size < MIN_EVALUABLE_SIGNALS_PER_PILLAR) return null;

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
