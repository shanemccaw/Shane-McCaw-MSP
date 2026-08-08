/**
 * finding-point-impact.ts — the real per-finding point value, Git #555.
 *
 * `copilot_readiness` and `remediation_plan` were both designed around ranking
 * findings by point impact and citing "the specific score increase each fix
 * would produce". Confirmed live (2026-08-08): the model correctly declined to
 * state one — "The platform did not supply individual point values for these
 * findings" — because nothing ever computed or injected one. `document-engine.ts`
 * had zero references to any per-finding point value. The anti-fabrication
 * behaviour was working; the data promise was never built. This module builds it.
 *
 * ── STEP 1: IS THE RAW `signal_derivation_rules` IMPACT COLUMN THE POINT VALUE? ──
 * No. It is a raw risk weight on an unbounded scale, and presenting it as
 * "fixing this adds N points" would be wrong by an order of magnitude. Traced
 * through the real scoring chain rather than assumed:
 *
 *   health-engine.ts   `sumArchitectureHealth` — a fired signal contributes
 *                      EXACTLY `impacts[signalKey][pillarField]` to that
 *                      pillar's raw score. A plain per-pillar reduce, nothing
 *                      multiplied or conditionally applied. The per-signal
 *                      value is the MAX configured across that signal's rules
 *                      and groups (`getSignalHealthImpacts`), not their sum.
 *   health-display.ts  `evaluatePillarDisplay` — the customer-facing number is
 *                        displayScore = round(100 − rawScore / theoreticalMax × 100)
 *                      where theoreticalMax sums that same impact field over the
 *                      tenant's EVALUABLE signals (#413's package-scoped set).
 *   copilot-gate.ts    `computeCopilotPillarEvaluation` — the Copilot Gate score
 *                      IS that expression for the `copilot` pillar. No further
 *                      weighting, banding or post-processing anywhere.
 *
 * So resolving a finding's signal and stopping it firing removes exactly its
 * impact from `rawScore`, and the score moves by:
 *
 *     points = impact / theoreticalMax × 100
 *
 * That normalization is the whole difference between honest and nonsense here.
 * On the live corpus `signal.copilot.data-exposure-risk` carries a raw
 * `copilot_impact` of 90 against a catalog-wide Copilot theoreticalMax of 260:
 * the real movement is ~34.6 points out of 100, not "90 points" on a 100-point
 * scale. The denominator is per-tenant (#413), so the same rule is worth
 * different real points to different tenants — which is exactly why this cannot
 * be precomputed into the rules table and has to be resolved per generation.
 *
 * ── WHICH PILLAR, AND WHY ONLY ONE ───────────────────────────────────────────
 * The Copilot pillar, for BOTH document types, because both prompts already say
 * so in their own words: `copilot_readiness` ranks findings by "their point
 * impact on the score" — the Gate score — and `remediation_plan` ranks by
 * "point impact on the readiness score ... using the same basis as the score
 * report". Two documents, one basis, one number, reconcilable against the one
 * gap the customer is shown. Reporting each finding against its own pillar
 * instead would produce values that cannot be summed and cannot be checked
 * against the Gate gap the reader is looking at.
 *
 * Note this is only defensible because `copilot_impact` is no longer flat 0
 * outside the Copilot pillar (the state #414 measured): 97 of the 195 live
 * signals now carry a positive `copilot_impact`, spanning security, governance,
 * architecture, compliance, adoption and cost pillars. A security finding
 * genuinely does move the Copilot score today, so quoting it a Copilot point
 * value is a real statement rather than a category error.
 *
 * ── ONLY FIRING SIGNALS ARE WORTH POINTS ─────────────────────────────────────
 * `rawScore` accumulates from signals that FIRED. A finding whose signals are
 * not currently firing is costing this tenant nothing, so fixing it recovers
 * nothing, and the honest value is a real measured 0 — not a blank and not a
 * guess. A finding no signal resolves to at all is reported NOT ATTRIBUTABLE,
 * which is a different statement and is kept distinguishable.
 *
 * ── NO DOUBLE COUNTING ───────────────────────────────────────────────────────
 * A signal can be reachable from more than one check (its rules can read
 * sourceKeys owned by different checks). Each firing signal's points are
 * therefore CLAIMED by the first finding that resolves to it, in the order the
 * findings are presented, and never counted again. Without that, the cited
 * values would sum past the real gap and the reconciliation the whole feature
 * rests on would be false.
 *
 * ── CHECK → RULE RESOLUTION ──────────────────────────────────────────────────
 * Reuses `pillar-coverage.ts`'s `computeRuleFedStatus`, whose `checkKeyByRuleId`
 * is the platform's existing per-ruleType resolution (direct `source_key =
 * monitor_checks.key` for `threshold`, `mapping[].targetField` / raw-property /
 * synthetic-itemCount / bridged-key for `profile_key_*`, unambiguous keyword
 * match for `findings_keyword`). A second implementation of that join is
 * exactly the kind of drift #481 and #413 were both caused by, so there isn't
 * one here — the inverse index is built from its output.
 */

import { calculateArchitectureHealthScore, getSignalHealthImpacts } from "./health-engine.ts";
import { evaluatePillarDisplay, type PillarEvaluation } from "./health-display.ts";
import { computeRuleFedStatus, fetchTenantEvaluableSignalKeys } from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { COPILOT_GATE_THRESHOLD } from "./copilot-gate.ts";
// Shapes and prompt wording live in a sibling with no runtime imports at all, so
// anything that only RENDERS a result does not drag this module's engine graph
// (health-engine -> priority-engine -> tenant-signals -> the DB client) with it.
// Re-exported here so `finding-point-impact` stays the one name a caller needs.
import { roundPoints } from "./finding-point-impact-format.ts";
import type { FindingPointImpact, FindingPointImpactResult } from "./finding-point-impact-format.ts";
export {
  buildFindingPointImpactPreamble,
  formatFindingPointImpactLine,
  roundPoints,
} from "./finding-point-impact-format.ts";
export type {
  FindingPointImpact,
  FindingPointImpactResult,
  FindingPointImpactStatus,
} from "./finding-point-impact-format.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.document-generator" });

/**
 * Pure core: given the resolved engine materials, the point value of each finding
 * in the order presented. Exported for tests — no DB, no clock.
 *
 * `theoreticalMax` must be the SAME denominator `evaluatePillarDisplay` used for
 * the score being quoted; callers pass `evaluation.theoreticalMax` rather than
 * recomputing one, so the two can never disagree.
 */
export function resolveFindingPointImpacts(args: {
  checkKeysInOrder: readonly (string | null)[];
  checkKeyByRuleId: ReadonlyMap<number, string | null>;
  rules: readonly Pick<SignalDerivationRule, "id" | "signalKey">[];
  firedSignalKeys: ReadonlySet<string>;
  copilotImpactBySignalKey: ReadonlyMap<string, number>;
  theoreticalMax: number;
}): FindingPointImpact[] {
  const { checkKeysInOrder, checkKeyByRuleId, rules, firedSignalKeys, copilotImpactBySignalKey, theoreticalMax } = args;

  // Inverse of `checkKeyByRuleId`: which signals a check can reach at all.
  const signalKeysByCheckKey = new Map<string, Set<string>>();
  for (const rule of rules) {
    const checkKey = checkKeyByRuleId.get(rule.id);
    if (!checkKey) continue;
    let bucket = signalKeysByCheckKey.get(checkKey);
    if (!bucket) signalKeysByCheckKey.set(checkKey, (bucket = new Set()));
    bucket.add(rule.signalKey);
  }

  const claimed = new Set<string>();
  return checkKeysInOrder.map((checkKey) => {
    if (!checkKey) return { checkKey, status: "unattributed" as const, points: 0, signalKeys: [] };
    const reachable = signalKeysByCheckKey.get(checkKey);
    if (!reachable || reachable.size === 0) {
      return { checkKey, status: "unattributed" as const, points: 0, signalKeys: [] };
    }

    const signalKeys: string[] = [];
    let impactSum = 0;
    for (const signalKey of reachable) {
      if (!firedSignalKeys.has(signalKey)) continue;
      if (claimed.has(signalKey)) continue; // already attributed to an earlier finding
      const impact = copilotImpactBySignalKey.get(signalKey) ?? 0;
      if (impact <= 0) continue;
      claimed.add(signalKey);
      signalKeys.push(signalKey);
      impactSum += impact;
    }

    if (signalKeys.length === 0) {
      return { checkKey, status: "no_points" as const, points: 0, signalKeys: [] };
    }
    return {
      checkKey,
      status: "scored" as const,
      points: roundPoints((impactSum / theoreticalMax) * 100),
      signalKeys,
    };
  });
}

/**
 * The real per-finding point values for one tenant, or `null` when the platform
 * is not entitled to state any.
 *
 * Returns null — never a fabricated or partial set — when:
 *   • the Copilot pillar did not score (#517's insufficient-coverage guard, a
 *     pillar nothing feeds, or no breakdown entry). There is no score for the
 *     points to be points OF.
 *   • the raw score exceeds the denominator, so `displayScore` is clamped at 0.
 *     Per-finding movement is real arithmetic on an unclamped ratio; quoting it
 *     against a clamped score would promise movement the customer would not see.
 *
 * Never throws: document generation must not die because the scoring engine is
 * unreachable, and the callers' existing "no point value was supplied" wording
 * is the correct behaviour in that case.
 */
export async function computeFindingPointImpacts(
  customerId: number,
  checkKeysInOrder: readonly (string | null)[],
): Promise<FindingPointImpactResult | null> {
  try {
    const [output, { rules, groups }] = await Promise.all([
      calculateArchitectureHealthScore(customerId),
      fetchSignalRulesAndGroups(),
    ]);
    const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
      firedSignalKeys: output.rawSignals,
    });
    const impacts = getSignalHealthImpacts(rules, groups);
    const evaluation = evaluatePillarDisplay("copilot", output, impacts, evaluableSignalKeys);

    if (evaluation.status !== "scored" || evaluation.score === null) {
      log.info(
        { customerId, evaluationStatus: evaluation.status, reason: evaluation.reason },
        "finding-point-impact: no Copilot score to state point values against — findings go out unpriced (Git #555)",
      );
      return null;
    }

    const rawScore = output.breakdown.find((b) => b.pillar === "copilot")?.score ?? 0;
    if (rawScore > evaluation.theoreticalMax) {
      log.warn(
        { customerId, rawScore, theoreticalMax: evaluation.theoreticalMax },
        "finding-point-impact: Copilot raw score exceeds its denominator — the display score is clamped, so per-finding movement would overstate what the customer will see; withholding point values (Git #555)",
      );
      return null;
    }

    const { checkKeyByRuleId } = await computeRuleFedStatus(rules);
    const copilotImpactBySignalKey = new Map<string, number>();
    for (const [signalKey, config] of impacts.entries()) {
      copilotImpactBySignalKey.set(signalKey, config.copilotImpact);
    }

    const perFinding = resolveFindingPointImpacts({
      checkKeysInOrder,
      checkKeyByRuleId,
      rules,
      firedSignalKeys: new Set(output.rawSignals),
      copilotImpactBySignalKey,
      theoreticalMax: evaluation.theoreticalMax,
    });

    const result: FindingPointImpactResult = {
      pillar: "copilot",
      evaluation,
      score: evaluation.score,
      threshold: COPILOT_GATE_THRESHOLD,
      totalRecoverablePoints: roundPoints((rawScore / evaluation.theoreticalMax) * 100),
      perFinding,
    };

    log.info(
      {
        customerId,
        score: result.score,
        theoreticalMax: evaluation.theoreticalMax,
        totalRecoverablePoints: result.totalRecoverablePoints,
        findingsPriced: perFinding.filter((f) => f.status === "scored").length,
        findingsUnattributed: perFinding.filter((f) => f.status === "unattributed").length,
        pointsShown: roundPoints(perFinding.reduce((s, f) => s + f.points, 0)),
      },
      "finding-point-impact: resolved real per-finding point values (Git #555)",
    );
    return result;
  } catch (err) {
    log.warn(
      { err, customerId },
      "finding-point-impact: could not compute per-finding point values — findings go out unpriced (Git #555)",
    );
    return null;
  }
}
