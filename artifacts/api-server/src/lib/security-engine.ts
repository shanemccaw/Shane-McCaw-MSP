/**
 * security-engine.ts
 *
 * Security scoring engine. Reuses `computeTenantSignals` to determine
 * which signals are currently fired for a tenant, then reduces them
 * to a deterministic score and breakdown based on securityImpact.
 */

import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups, buildTenantProfileAndFindings } from "./priority-engine.ts";
import { getSignalHealthImpacts, PILLAR_FIELD } from "./health-engine.ts";

export interface SecurityEngineOutput {
  engine: "security";
  score: number;
  breakdown: { pillar: "security"; score: number; contributions: { signalKey: string; value: number }[] };
  rawSignals: string[];
  timestamp: string;
}

export function computeSecurityEngine(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
  ctx?: { evaluationTimestamp?: Date },
): SecurityEngineOutput {
  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);
  const firedSignalKeys = [...firedSignals];

  const impacts = getSignalHealthImpacts(rules, groups);
  const field = PILLAR_FIELD.security;

  const contributions = firedSignalKeys.map(signalKey => {
    const cfg = impacts.get(signalKey) as unknown as Record<string, number> | undefined;
    return { signalKey, value: cfg?.[field] ?? 0 };
  });

  const score = contributions.reduce((sum, c) => sum + c.value, 0);

  return {
    engine: "security",
    score,
    breakdown: {
      pillar: "security",
      score,
      contributions,
    },
    rawSignals: firedSignalKeys,
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

export async function runSecurityEngineForTenant(customerId: number, ctx?: { evaluationTimestamp?: Date }): Promise<SecurityEngineOutput> {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }

  return computeSecurityEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}
