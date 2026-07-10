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
 *   driftScore = sum(trendValue + governanceImpact) over drift:* category
 *                rules/groups that (a) belong to a currently-fired, enabled
 *                signal, and (b) themselves evaluated true against the
 *                tenant's profile/findings.
 *
 * Categorization is per rule/group (matching the schema), not per signal key:
 * a signal can fire via a non-drift rule while a separate drift-tagged rule
 * for the same signal key evaluates false — that drift rule must NOT
 * contribute just because the signal happens to be fired overall. Each
 * drift-tagged rule/group is independently re-evaluated so only conditions
 * that are literally true contribute to the score.
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

  const breakdown: DriftBreakdownEntry[] = [];

  // Drift-tagged groups: only count a group if it belongs to a fired,
  // enabled signal AND its own AND/OR logic actually evaluates true against
  // this tenant's data — never just because the signal fired via some other
  // path.
  for (const group of groups) {
    if (!group.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    if (!firedSignals.has(group.signalKey)) continue;
    if (disabledSignalKeys.has(group.signalKey)) continue;

    const groupRules = rulesByGroupId.get(group.id) ?? [];
    if (groupRules.length === 0) continue;

    const groupResult =
      group.logic === "AND"
        ? groupRules.every(rule => evaluateRule(rule, mergedProfile, parsedFindings).result)
        : groupRules.some(rule => evaluateRule(rule, mergedProfile, parsedFindings).result);

    if (!groupResult) continue;

    breakdown.push({
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
  // enabled signal AND independently evaluate true.
  for (const rule of rules) {
    if (rule.groupId !== null && rule.groupId !== undefined) continue; // attributed via its group above
    if (!rule.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    if (!firedSignals.has(rule.signalKey)) continue;
    if (disabledSignalKeys.has(rule.signalKey)) continue;

    const { result } = evaluateRule(rule, mergedProfile, parsedFindings);
    if (!result) continue;

    breakdown.push({
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
