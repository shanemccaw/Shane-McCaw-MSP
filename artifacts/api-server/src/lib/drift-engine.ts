/**
 * drift-engine.ts
 *
 * Governance-drift scoring engine. Reuses `computeTenantSignals` to determine
 * which signals are currently fired for a tenant, then reduces the subset of
 * those signals whose `category` starts with `"drift:"` to a single
 * deterministic `driftScore` and `trendDirection`.
 *
 * Scoring is intentionally pure arithmetic — no conditional logic, weighting,
 * clamping, or thresholds:
 *
 *   driftScore = sum(trendValue + governanceImpact) over fired, enabled,
 *                drift:* category signals
 *
 * `trendDirection` is never derived from a formula — it is read directly off
 * the `trendDirection` field of whichever contributing signal has the
 * largest-magnitude `(trendValue + governanceImpact)` contribution.
 *
 * Out of scope (see task spec): priority/pricing/health/forecasting/CRM/MSP
 * engines, admin UI, workflow nodes, SOW wiring.
 */

import {
  computeTenantSignals,
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
 * A single fired signal can be governed by either a rule group (AND/OR of
 * several rules) or one or more ungrouped rules. Each carries its own
 * independent `SignalIntelligenceFields` (category, trendValue,
 * governanceImpact, trendDirection, ...). This picks every group/rule
 * attached to a signal key whose category starts with `drift:*`, so a signal
 * driven by a drift-tagged group (or drift-tagged ungrouped rule) contributes
 * its intelligence fields to the drift score.
 */
function collectDriftContributors(
  signalKey: string,
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
): DriftBreakdownEntry[] {
  const entries: DriftBreakdownEntry[] = [];

  for (const group of groups) {
    if (group.signalKey !== signalKey) continue;
    if (!group.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    entries.push({
      signalKey,
      category: group.category,
      trendValue: group.trendValue,
      governanceImpact: group.governanceImpact,
      trendDirection: group.trendDirection,
      contribution: group.trendValue + group.governanceImpact,
    });
  }

  for (const rule of rules) {
    if (rule.signalKey !== signalKey) continue;
    if (rule.groupId !== null && rule.groupId !== undefined) continue; // grouped rules attribute via their group above
    if (!rule.category.startsWith(DRIFT_CATEGORY_PREFIX)) continue;
    entries.push({
      signalKey,
      category: rule.category,
      trendValue: rule.trendValue,
      governanceImpact: rule.governanceImpact,
      trendDirection: rule.trendDirection,
      contribution: rule.trendValue + rule.governanceImpact,
    });
  }

  return entries;
}

/**
 * Computes the governance drift score for a tenant.
 *
 * @param mergedProfile        Tenant profile data, as passed to computeTenantSignals.
 * @param parsedFindings       Script finding strings, as passed to computeTenantSignals.
 * @param rules                All signal derivation rules (any category — filtering happens internally).
 * @param groups                All signal rule groups (any category — filtering happens internally).
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

  const breakdown: DriftBreakdownEntry[] = [];
  for (const signalKey of firedSignals) {
    breakdown.push(...collectDriftContributors(signalKey, rules, groups));
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
