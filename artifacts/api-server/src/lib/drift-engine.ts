/**
 * drift-engine.ts
 *
 * Governance-drift scoring engine. Reuses `computeTenantSignals` to determine
 * which signals are currently fired for a tenant, then reduces the subset of
 * drift-tagged rules/groups that *themselves actually evaluated true* to a
 * single deterministic `driftScore` and `trendDirection`.
 *
 * Scoring is intentionally pure arithmetic — no conditional logic, weighting,
 * clamping, or thresholds:
 *
 *   driftScore = sum(trendValue + governanceImpact) over currently-fired,
 *                enabled SIGNALS whose contributing drift:* rule/group
 *                actually evaluated true.
 *
 * The score/breakdown is per SIGNAL, not per rule/group: `category`,
 * `trendValue`, and `governanceImpact` live on individual rules/groups in
 * the schema, but a signal contributes at most once to the drift score.
 * When a signal has more than one true drift-tagged rule/group, a single
 * representative contributor is chosen deterministically — using the same
 * precedence computeTenantSignals itself uses to decide a signal fired
 * (rule groups first in declaration order, then ungrouped rules in
 * declaration order; first true wins) — so the score never double-counts a
 * signal and stays consistent with "how did this signal actually fire".
 *
 * Categorization is per rule/group (matching the schema), not per signal key:
 * a signal can fire via a non-drift rule while a separate drift-tagged rule
 * for the same signal key evaluates false — that drift rule must NOT
 * contribute just because the signal happens to be fired overall. Each
 * drift-tagged rule/group is independently re-evaluated so only conditions
 * that are literally true are eligible to contribute.
 *
 * `trendDirection` is never derived from a formula — it is read directly off
 * the `trendDirection` field of whichever contributing rule/group has the
 * largest-magnitude `(trendValue + governanceImpact)` contribution.
 *
 * Out of scope (see task spec): priority/pricing/health/forecasting/CRM/MSP
 * engines, admin UI, workflow nodes, SOW wiring.
 */

import {
  computeTenantSignals,
  evaluateRule,
  type SignalDerivationRule,
  type SignalRuleGroup,
  type SignalTrendDirection,
} from "./tenant-signals.ts";

const DRIFT_CATEGORY_PREFIX = "drift:";

export interface DriftBreakdownEntry {
  signalKey: string;
  category: string;
  trendValue: number;
  governanceImpact: number;
  trendDirection: SignalTrendDirection;
  contribution: number;
  source: "group" | "rule";
  sourceId: number;
}

export interface DriftEngineOutput {
  engine: "drift";
  score: number;
  trendDirection: SignalTrendDirection;
  breakdown: DriftBreakdownEntry[];
  driftBreakdown: DriftBreakdownEntry[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  rawRuleGroups: SignalRuleGroup[];
  workflowVariables: {
    driftScore: number;
    driftTrendDirection: SignalTrendDirection;
    driftSignalCount: number;
  };
  timestamp: string;
}

/**
 * Computes the governance drift score for a tenant.
 *
 * @param mergedProfile        Tenant profile data, as passed to computeTenantSignals.
 * @param parsedFindings       Script finding strings, as passed to computeTenantSignals.
 * @param rules                All signal derivation rules (any category — filtering happens internally).
 * @param groups               All signal rule groups (any category — filtering happens internally).
 * @param disabledSignalKeys   Signals disabled by an admin — excluded from firing entirely.
 */
export function computeDriftEngine(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
): DriftEngineOutput {
  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);

  const rulesByGroupId = new Map<number, SignalDerivationRule[]>();
  for (const rule of rules) {
    if (rule.groupId === null || rule.groupId === undefined) continue;
    if (!rulesByGroupId.has(rule.groupId)) rulesByGroupId.set(rule.groupId, []);
    rulesByGroupId.get(rule.groupId)!.push(rule);
  }

  // At most ONE breakdown entry per signal key. When a signal has multiple
  // true drift-tagged contributors, the winner is chosen with the same
  // precedence computeTenantSignals uses internally to decide firing: rule
  // groups in declaration order, then ungrouped rules in declaration order,
  // first-true wins. This keeps the score signal-scoped (never double-counts
  // one signal) and consistent with "how this signal actually fired".
  const winnerBySignal = new Map<string, DriftBreakdownEntry>();

  const claimSignal = (signalKey: string) => {
    if (!firedSignals.has(signalKey)) return false;
    if (disabledSignalKeys.has(signalKey)) return false;
    if (winnerBySignal.has(signalKey)) return false; // already has a winning contributor
    return true;
  };

  // Drift-tagged groups: only count a group if it belongs to a fired,
  // enabled signal (not already claimed) AND its own AND/OR logic actually
  // evaluates true against this tenant's data — never just because the
  // signal fired via some other path.
  for (const group of groups) {
    if (!group.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    if (!claimSignal(group.signalKey)) continue;

    const groupRules = rulesByGroupId.get(group.id) ?? [];
    if (groupRules.length === 0) continue;

    const groupResult =
      group.logic === "AND"
        ? groupRules.every(rule => evaluateRule(rule, mergedProfile, parsedFindings).result)
        : groupRules.some(rule => evaluateRule(rule, mergedProfile, parsedFindings).result);

    if (!groupResult) continue;

    winnerBySignal.set(group.signalKey, {
      signalKey: group.signalKey,
      category: group.category,
      trendValue: group.trendValue,
      governanceImpact: group.governanceImpact,
      trendDirection: group.trendDirection,
      contribution: group.trendValue + group.governanceImpact,
      source: "group",
      sourceId: group.id,
    });
  }

  // Drift-tagged ungrouped rules: same requirement — must belong to a fired,
  // enabled signal not already claimed by a group, AND independently
  // evaluate true.
  for (const rule of rules) {
    if (rule.groupId !== null && rule.groupId !== undefined) continue; // attributed via its group above
    if (!rule.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    if (!claimSignal(rule.signalKey)) continue;

    const { result } = evaluateRule(rule, mergedProfile, parsedFindings);
    if (!result) continue;

    winnerBySignal.set(rule.signalKey, {
      signalKey: rule.signalKey,
      category: rule.category,
      trendValue: rule.trendValue,
      governanceImpact: rule.governanceImpact,
      trendDirection: rule.trendDirection,
      contribution: rule.trendValue + rule.governanceImpact,
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
    engine: "drift",
    score,
    trendDirection,
    breakdown,
    driftBreakdown: breakdown,
    rawSignals: [...firedSignals],
    rawRules: rules,
    rawRuleGroups: groups,
    workflowVariables: {
      driftScore: score,
      driftTrendDirection: trendDirection,
      driftSignalCount: breakdown.length,
    },
    timestamp: new Date().toISOString(),
  };
}
