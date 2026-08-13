import type { SignalDerivationRule } from "./tenant-signals";

export interface RuleConflict {
  ruleIds: number[];
  description: string;
}

export function detectRuleConflicts(rules: SignalDerivationRule[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const bySignalAndSource = new Map<string, SignalDerivationRule[]>();

  for (const rule of rules) {
    const key = `${rule.signalKey}::${rule.sourceKey}`;
    if (!bySignalAndSource.has(key)) bySignalAndSource.set(key, []);
    bySignalAndSource.get(key)!.push(rule);
  }

  for (const [, group] of bySignalAndSource) {
    if (group.length < 2) continue;

    const truthyRules = group.filter(r => r.ruleType === "profile_key_truthy");
    const falsyRules = group.filter(r => r.ruleType === "profile_key_falsy");

    if (truthyRules.length > 0 && falsyRules.length > 0) {
      const ids = [...truthyRules.map(r => r.id), ...falsyRules.map(r => r.id)];
      conflicts.push({
        ruleIds: ids,
        description:
          `Signal "${group[0].signalKey}", key "${group[0].sourceKey}": ` +
          `profile_key_truthy and profile_key_falsy rules on the same key are contradictory — they can never both evaluate to true simultaneously.`,
      });
    }

    const eqRules = group.filter(r => r.ruleType === "profile_key_eq");
    if (eqRules.length > 1) {
      const uniqueValues = [...new Set(eqRules.map(r => r.compareValue))];
      if (uniqueValues.length > 1) {
        conflicts.push({
          ruleIds: eqRules.map(r => r.id),
          description:
            `Signal "${group[0].signalKey}", key "${group[0].sourceKey}": ` +
            `Multiple profile_key_eq rules with different values (${uniqueValues.map(v => JSON.stringify(v)).join(", ")}) — a value can only equal one thing at a time.`,
        });
      }
    }
  }

  return conflicts;
}
