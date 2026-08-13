/**
 * pillar-matrix.ts
 *
 * Pure core of the Simulator Studio Pillar Matrix (the cross-signal per-pillar
 * impact tuning view). Given the platform rules/groups, a pillar's intelligence
 * field, and the already-computed fed/evaluable status, it produces the matrix
 * rows and the summary numbers the header shows.
 *
 * Split out from the route handler (which does the DB reads) so this logic is
 * unit-testable with plain literals — matching the pure-helper convention used
 * by pillar-coverage.ts and health-display.ts.
 *
 * It reuses `getSignalHealthImpacts` (health-engine.ts) for the per-signal
 * effective value — the MAX across a signal's rules AND its group — so the
 * "Effective" column and the "source of record" note reflect exactly what the
 * scoring engine uses, not a rule-only view that pretends groups don't contribute.
 *
 * `theoreticalMax` here is the IDENTICAL formula `computePillarDisplayScore`
 * (health-display.ts) uses for its denominator: the sum, over the genuinely
 * EVALUABLE signals only, of each signal's MAX pillar impact. So the header
 * agrees with the live customer-facing dashboard.
 */

import { getSignalHealthImpacts } from "./health-engine.ts";
import type { SignalDerivationRule, SignalRuleGroup } from "./tenant-signals.ts";

export interface PillarMatrixRow {
  ruleId: number;
  signalKey: string;
  ruleType: string;
  sourceKey: string;
  groupId: number | null;
  description: string | null;
  /** This rule's OWN impact value for the pillar (the editable cell). */
  ruleImpact: number;
  /** The MAX pillar impact configured on this signal's group(s), for context. */
  groupImpact: number;
  /** The engine-effective value for this signal+pillar = MAX across its rules AND group. */
  effectiveSignalImpact: number;
  /** Whether this rule's own value holds the rule/group MAX (so it's the value the engine scores). */
  isWinningSource: boolean;
  /** Whether this specific rule can ever fire (its sourceKey is producible by a real check). */
  fed: boolean;
  /** Whether the signal as a whole is evaluable (some rule of it is fed) → counts toward theoreticalMax. */
  signalEvaluable: boolean;
  /** The real monitor check that owns/produces this rule's sourceKey, if resolvable — lets the UI jump to that check's real Engine Trace. */
  checkKey: string | null;
}

export interface PillarMatrixResult {
  theoreticalMax: number;
  contributingSignalCount: number;
  rows: PillarMatrixRow[];
}

/**
 * Builds the matrix for one pillar. `field` is the intelligence-field name for
 * the pillar (e.g. "governanceImpact"), as given by health-engine's PILLAR_FIELD.
 * `fedByRuleId` / `evaluableSignalKeys` come from pillar-coverage's
 * `computeRuleFedStatus` (the producible-key logic).
 *
 * Rows: every rule, sorted by its OWN `field` value descending (highest-impact
 * first — the retuning default), ties broken by signalKey for stable ordering.
 * A rule with a genuine 0 impact for this pillar still gets a row — hiding it
 * would be indistinguishable from a rule that was never configured for this
 * pillar at all, and an admin who deliberately zeroes a rule out needs to be
 * able to find it again to re-tune it (Git #515).
 */
export function buildPillarMatrix(
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  field: string,
  fedByRuleId: ReadonlyMap<number, boolean>,
  evaluableSignalKeys: ReadonlySet<string>,
  checkKeyByRuleId: ReadonlyMap<number, string | null> = new Map(),
): PillarMatrixResult {
  const impacts = getSignalHealthImpacts(rules, groups);

  // Each signal's group contribution for this pillar (MAX if multiple groups).
  const groupImpactBySignal = new Map<string, number>();
  for (const g of groups) {
    const v = Number((g as unknown as Record<string, unknown>)[field] ?? 0);
    groupImpactBySignal.set(g.signalKey, Math.max(groupImpactBySignal.get(g.signalKey) ?? 0, v));
  }

  // theoreticalMax — sum over EVALUABLE signals of the signal's MAX pillar impact.
  let theoreticalMax = 0;
  let contributingSignalCount = 0;
  for (const [signalKey, cfg] of impacts.entries()) {
    if (!evaluableSignalKeys.has(signalKey)) continue;
    const v = (cfg as unknown as Record<string, number>)[field] ?? 0;
    theoreticalMax += v;
    if (v > 0) contributingSignalCount++;
  }

  const rows: PillarMatrixRow[] = rules
    .map((r) => ({ r, ruleImpact: Number((r as unknown as Record<string, unknown>)[field] ?? 0) }))
    .filter(({ ruleImpact }) => ruleImpact >= 0)
    .map(({ r, ruleImpact }) => {
      const effectiveSignalImpact =
        (impacts.get(r.signalKey) as unknown as Record<string, number> | undefined)?.[field] ?? 0;
      return {
        ruleId: r.id,
        signalKey: r.signalKey,
        ruleType: r.ruleType,
        sourceKey: r.sourceKey,
        groupId: r.groupId,
        description: r.description ?? null,
        ruleImpact,
        groupImpact: groupImpactBySignal.get(r.signalKey) ?? 0,
        effectiveSignalImpact,
        isWinningSource: ruleImpact >= effectiveSignalImpact,
        fed: fedByRuleId.get(r.id) ?? false,
        signalEvaluable: evaluableSignalKeys.has(r.signalKey),
        checkKey: checkKeyByRuleId.get(r.id) ?? null,
      };
    })
    .sort((a, b) => b.ruleImpact - a.ruleImpact || a.signalKey.localeCompare(b.signalKey));

  return { theoreticalMax, contributingSignalCount, rows };
}
