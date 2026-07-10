/**
 * forecasting-engine.ts
 *
 * Trend-forecasting engine. Reuses `computeTenantSignals` to determine which
 * signals are currently fired (and enabled) for a tenant, then sums the
 * `trendValue` field already stored on each fired signal that defines a
 * non-zero trend, optionally scaled by that signal's own `decayRate`.
 *
 * Scoring is intentionally pure arithmetic — no formula is invented in code:
 *
 *   forecastScore = sum(trendValue * decayFactor) over currently-fired,
 *                   enabled signals whose contributing rule/group defines a
 *                   non-zero trendValue.
 *
 *   decayFactor = (1 - decayRate) when the contributing rule/group defines a
 *                 non-zero decayRate, otherwise 1 (no decay applied). This
 *                 mirrors the drift-engine convention of reading every
 *                 number straight off the admin-editable rule/group row —
 *                 never computing a rate from `ttlDays` or any other formula.
 *
 * Like `drift-engine.ts`, the score/breakdown is per SIGNAL, not per rule: a
 * signal contributes at most once. When a signal has more than one
 * trend-defining rule/group, a single representative contributor is chosen
 * deterministically using the same precedence `computeTenantSignals` itself
 * uses to decide a signal fired (rule groups first in declaration order,
 * then ungrouped rules in declaration order; first-true wins), and — among
 * those that are actually true — the entry is only claimed once so the score
 * never double-counts a signal.
 *
 * `trendDirection` is never derived from a formula — it is read directly off
 * the `trendDirection` field of whichever contributing rule/group has the
 * largest-magnitude `(trendValue * decayFactor)` contribution.
 *
 * Out of scope (see task spec): priority/pricing/health/CRM/MSP engines,
 * admin UI, workflow nodes, SOW wiring.
 */

import {
  computeTenantSignals,
  evaluateRule,
  type SignalDerivationRule,
  type SignalRuleGroup,
  type SignalTrendDirection,
} from "./tenant-signals.ts";

export interface ForecastBreakdownEntry {
  signalKey: string;
  trendValue: number;
  decayRate: number;
  decayFactor: number;
  trendDirection: SignalTrendDirection;
  contribution: number;
  source: "group" | "rule";
  sourceId: number;
}

export interface ForecastEngineOutput {
  engine: "forecast";
  score: number;
  trendDirection: SignalTrendDirection;
  breakdown: ForecastBreakdownEntry[];
  forecastBreakdown: ForecastBreakdownEntry[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  rawRuleGroups: SignalRuleGroup[];
  workflowVariables: {
    forecastScore: number;
    forecastTrendDirection: SignalTrendDirection;
    forecastSignalCount: number;
  };
  timestamp: string;
}

/** decayFactor = (1 - decayRate) when decayRate is non-zero, otherwise 1 (no decay). */
function decayFactorFor(decayRate: number): number {
  return decayRate !== 0 ? 1 - decayRate : 1;
}

/**
 * Computes the trend forecast score for a tenant.
 *
 * @param mergedProfile        Tenant profile data, as passed to computeTenantSignals.
 * @param parsedFindings       Script finding strings, as passed to computeTenantSignals.
 * @param rules                All signal derivation rules (any category — filtering happens internally).
 * @param groups               All signal rule groups (any category — filtering happens internally).
 * @param disabledSignalKeys   Signals disabled by an admin — excluded from firing entirely.
 */
export function computeForecastingEngine(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
): ForecastEngineOutput {
  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);

  const rulesByGroupId = new Map<number, SignalDerivationRule[]>();
  for (const rule of rules) {
    if (rule.groupId === null || rule.groupId === undefined) continue;
    if (!rulesByGroupId.has(rule.groupId)) rulesByGroupId.set(rule.groupId, []);
    rulesByGroupId.get(rule.groupId)!.push(rule);
  }

  // At most ONE breakdown entry per signal key — same precedence and
  // single-claim convention as drift-engine.ts, so the score never
  // double-counts a signal and stays consistent with "how this signal fired".
  const winnerBySignal = new Map<string, ForecastBreakdownEntry>();

  const claimSignal = (signalKey: string) => {
    if (!firedSignals.has(signalKey)) return false;
    if (disabledSignalKeys.has(signalKey)) return false;
    if (winnerBySignal.has(signalKey)) return false; // already has a winning contributor
    return true;
  };

  // Rule groups whose own AND/OR logic evaluates true and which define a
  // non-zero trendValue — only these contribute to the forecast.
  for (const group of groups) {
    if (group.trendValue === 0) continue;
    if (!claimSignal(group.signalKey)) continue;

    const groupRules = rulesByGroupId.get(group.id) ?? [];
    if (groupRules.length === 0) continue;

    const groupResult =
      group.logic === "AND"
        ? groupRules.every(rule => evaluateRule(rule, mergedProfile, parsedFindings).result)
        : groupRules.some(rule => evaluateRule(rule, mergedProfile, parsedFindings).result);

    if (!groupResult) continue;

    const decayFactor = decayFactorFor(group.decayRate);
    winnerBySignal.set(group.signalKey, {
      signalKey: group.signalKey,
      trendValue: group.trendValue,
      decayRate: group.decayRate,
      decayFactor,
      trendDirection: group.trendDirection,
      contribution: group.trendValue * decayFactor,
      source: "group",
      sourceId: group.id,
    });
  }

  // Ungrouped rules that independently evaluate true and define a non-zero
  // trendValue, not already claimed via a group.
  for (const rule of rules) {
    if (rule.groupId !== null && rule.groupId !== undefined) continue; // attributed via its group above
    if (rule.trendValue === 0) continue;
    if (!claimSignal(rule.signalKey)) continue;

    const { result } = evaluateRule(rule, mergedProfile, parsedFindings);
    if (!result) continue;

    const decayFactor = decayFactorFor(rule.decayRate);
    winnerBySignal.set(rule.signalKey, {
      signalKey: rule.signalKey,
      trendValue: rule.trendValue,
      decayRate: rule.decayRate,
      decayFactor,
      trendDirection: rule.trendDirection,
      contribution: rule.trendValue * decayFactor,
      source: "rule",
      sourceId: rule.id,
    });
  }

  const breakdown = [...winnerBySignal.values()];
  const score = breakdown.reduce((sum, entry) => sum + entry.contribution, 0);

  let trendDirection: SignalTrendDirection = "flat";
  if (breakdown.length > 0) {
    const top = breakdown.reduce((max, entry) =>
      Math.abs(entry.contribution) > Math.abs(max.contribution) ? entry : max,
    );
    trendDirection = top.trendDirection;
  }

  return {
    engine: "forecast",
    score,
    trendDirection,
    breakdown,
    forecastBreakdown: breakdown,
    rawSignals: [...firedSignals],
    rawRules: rules,
    rawRuleGroups: groups,
    workflowVariables: {
      forecastScore: score,
      forecastTrendDirection: trendDirection,
      forecastSignalCount: breakdown.length,
    },
    timestamp: new Date().toISOString(),
  };
}
