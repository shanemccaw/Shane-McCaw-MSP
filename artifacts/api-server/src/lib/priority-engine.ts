/**
 * priority-engine.ts
 *
 * Priority scoring engine — ranks a tenant by summing the
 * `priorityScoreContribution` field already stored on each of its
 * currently-fired, enabled signals (see `SIGNAL_INTELLIGENCE_FIELDS` in
 * `lib/db/src/schema/index.ts` and the `priority:*` category prefix).
 *
 * This engine is intentionally a pure sum/sort over data already produced by
 * `computeTenantSignals()` — it contains zero hand-coded business logic about
 * *which* signals matter or how much. All of that lives in the admin-editable
 * `signal_derivation_rules` / `signal_rule_groups` rows. Changing a rule's
 * `priorityScoreContribution` in the admin panel changes the score for every
 * tenant whose fired signals reference it, with no code changes required.
 *
 * Output shape matches the platform-wide engine contract so CRM, workflows,
 * and SOW generation can all consume it identically:
 *   { engine, score, breakdown, rawSignals, rawRules, workflowVariables, timestamp }
 */

import { db, clientM365ProfilesTable, scriptRunResultsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";

// ── Shared engine output contract ──────────────────────────────────────────

export interface EngineBreakdownEntry {
  signalKey: string;
  contribution: number;
}

export interface EngineOutput {
  engine: string;
  score: number;
  breakdown: EngineBreakdownEntry[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  workflowVariables: Record<string, string | number>;
  timestamp: string;
}

/** A fired signal ranked by its priority contribution. */
export interface RankedSignal {
  signalKey: string;
  priorityScoreContribution: number;
}

/** Per-signal weight configuration, as configured by an admin on its rules/groups. */
export interface SignalWeightConfig {
  signalKey: string;
  weight: number;
  priority: number;
  priorityScoreContribution: number;
}

const SIGNAL_INTELLIGENCE_COLUMNS_SQL = sql`
  priority, weight,
  pricing_impact AS "pricingImpact",
  priority_score_contribution AS "priorityScoreContribution",
  pricing_value_contribution AS "pricingValueContribution",
  governance_impact AS "governanceImpact",
  security_impact AS "securityImpact",
  compliance_impact AS "complianceImpact",
  adoption_impact AS "adoptionImpact",
  copilot_impact AS "copilotImpact",
  architecture_impact AS "architectureImpact",
  trend_value AS "trendValue",
  trend_direction AS "trendDirection",
  decay_rate AS "decayRate",
  ttl_days AS "ttlDays",
  confidence, severity, category, pillar,
  crm_fit_contribution AS "crmFitContribution",
  crm_pain_contribution AS "crmPainContribution",
  crm_maturity_contribution AS "crmMaturityContribution",
  crm_intent_contribution AS "crmIntentContribution",
  crm_urgency_contribution AS "crmUrgencyContribution"
`;

/**
 * Fetches the full signal rule + group configuration, including every
 * intelligence field (not just the subset `computeTenantSignals` itself
 * needs), so downstream engines like this one can read `priorityScoreContribution`,
 * `weight`, etc. without re-querying.
 *
 * Ownership scoping:
 * - When `mspId` is omitted or null → `WHERE msp_id IS NULL` (platform-owned rows only).
 *   This is the correct scope for all platform-level engine evaluation: priority, health,
 *   CRM, drift, forecasting, SOW generation, and portfolio risk.
 * - When `mspId` is a number → `WHERE msp_id IS NULL OR msp_id = <mspId>` (platform
 *   defaults + the specific MSP's override rows). Pass this when evaluating rules in the
 *   context of a specific MSP tenant whose overrides should take effect.
 */
export async function fetchSignalRulesAndGroups(mspId?: number | null): Promise<{
  rules: SignalDerivationRule[];
  groups: SignalRuleGroup[];
}> {
  const scopedMspId = typeof mspId === "number" ? mspId : null;
  const [rulesRes, groupsRes] = await Promise.all([
    scopedMspId != null
      ? db.execute(sql`
          SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                 source_key AS "sourceKey", compare_value AS "compareValue", description,
                 sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
                 ${SIGNAL_INTELLIGENCE_COLUMNS_SQL}
          FROM signal_derivation_rules
          WHERE msp_id IS NULL OR msp_id = ${scopedMspId}
          ORDER BY signal_key, sort_order, id
        `)
      : db.execute(sql`
          SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                 source_key AS "sourceKey", compare_value AS "compareValue", description,
                 sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
                 ${SIGNAL_INTELLIGENCE_COLUMNS_SQL}
          FROM signal_derivation_rules
          WHERE msp_id IS NULL
          ORDER BY signal_key, sort_order, id
        `),
    scopedMspId != null
      ? db.execute(sql`
          SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
                 ${SIGNAL_INTELLIGENCE_COLUMNS_SQL}
          FROM signal_rule_groups
          WHERE msp_id IS NULL OR msp_id = ${scopedMspId}
          ORDER BY signal_key, sort_order, id
        `)
      : db.execute(sql`
          SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
                 ${SIGNAL_INTELLIGENCE_COLUMNS_SQL}
          FROM signal_rule_groups
          WHERE msp_id IS NULL
          ORDER BY signal_key, sort_order, id
        `),
  ]);

  return {
    rules: rulesRes.rows as unknown as SignalDerivationRule[],
    groups: groupsRes.rows as unknown as SignalRuleGroup[],
  };
}

/**
 * Builds a merged M365 profile + findings list for a tenant, exactly the
 * same way `computeSignalDrivenAdjustments` does in `portal.ts` — the
 * client's stored profile overlaid with every completed script run's
 * `profileUpdates`, oldest-first so newer runs win on conflicting keys.
 */
export async function buildTenantProfileAndFindings(
  clientUserId: number,
): Promise<{ mergedProfile: Record<string, unknown>; findings: string[] }> {
  const [profileRow] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientUserId))
    .limit(1);

  const scriptRuns = await db
    .select({
      parsedFindings: scriptRunResultsTable.parsedFindings,
      profileUpdates: scriptRunResultsTable.profileUpdates,
    })
    .from(scriptRunResultsTable)
    .where(and(eq(scriptRunResultsTable.customerId, clientUserId), eq(scriptRunResultsTable.status, "completed")))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(50);

  const mergedProfile: Record<string, unknown> = { ...((profileRow?.profile as Record<string, unknown> | null) ?? {}) };
  for (const run of [...scriptRuns].reverse()) Object.assign(mergedProfile, run.profileUpdates ?? {});
  const findings = [...new Set(scriptRuns.flatMap(r => r.parsedFindings ?? []))];

  return { mergedProfile, findings };
}

/**
 * Computes the tenant's currently-fired, enabled signal keys using the same
 * evaluator every other call site uses (`computeTenantSignals`), so this
 * engine can never drift from what the SOW/CRM/workflow paths consider fired.
 */
export async function getFiredSignalKeysForTenant(tenantId: number): Promise<{
  firedSignalKeys: string[];
  rules: SignalDerivationRule[];
}> {
  const { mergedProfile, findings } = await buildTenantProfileAndFindings(tenantId);
  const [{ rules, groups }, disabledSignalKeys] = await Promise.all([
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  const { firedSignals } = computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys);

  return { firedSignalKeys: [...firedSignals], rules };
}

/**
 * Per-signal weight configuration, as currently set by an admin.
 *
 * A signal's rules/groups may repeat the same `weight` / `priority` /
 * `priorityScoreContribution` values across multiple rows (e.g. every rule in
 * an AND group). Rather than summing duplicates and inflating the score,
 * this takes the maximum value configured anywhere for that signal key —
 * the same representative-value convention used by the other intelligence
 * fields on this table. Admins set the value once on the row(s) that matter;
 * bumping any one of them changes the signal's effective contribution by
 * exactly that delta.
 *
 * Global — not tenant-scoped, since it reflects rule *configuration*, not
 * any particular tenant's fired state.
 */
export async function getSignalWeights(): Promise<SignalWeightConfig[]> {
  const { rules, groups } = await fetchSignalRulesAndGroups();

  const bySignal = new Map<string, SignalWeightConfig>();

  const consider = (signalKey: string, weight: number, priority: number, priorityScoreContribution: number) => {
    const existing = bySignal.get(signalKey);
    if (!existing) {
      bySignal.set(signalKey, { signalKey, weight, priority, priorityScoreContribution });
      return;
    }
    existing.weight = Math.max(existing.weight, weight);
    existing.priority = Math.max(existing.priority, priority);
    existing.priorityScoreContribution = Math.max(existing.priorityScoreContribution, priorityScoreContribution);
  };

  for (const rule of rules) consider(rule.signalKey, rule.weight, rule.priority, rule.priorityScoreContribution);
  for (const group of groups) consider(group.signalKey, group.weight, group.priority, group.priorityScoreContribution);

  return [...bySignal.values()].sort((a, b) => b.priorityScoreContribution - a.priorityScoreContribution);
}

/**
 * Pure core of the engine: given a set of currently-fired signal keys and
 * the (already-fetched) per-signal weight configuration, ranks the fired
 * signals descending by `priorityScoreContribution`. Signals with no
 * configured weight (e.g. `alwaysInclude`, which has no rules) contribute 0
 * and sort last.
 *
 * No DB access, no conditionals beyond the lookup itself, no embedded
 * business logic — this is the piece covered directly by unit tests.
 */
export function rankFiredSignals(firedSignalKeys: string[], weights: SignalWeightConfig[]): RankedSignal[] {
  const weightBySignal = new Map(weights.map(w => [w.signalKey, w.priorityScoreContribution]));

  return firedSignalKeys
    .map(signalKey => ({
      signalKey,
      priorityScoreContribution: weightBySignal.get(signalKey) ?? 0,
    }))
    .sort((a, b) => b.priorityScoreContribution - a.priorityScoreContribution);
}

/**
 * Pure core of the engine: sums `priorityScoreContribution` across a set of
 * ranked signals. Nothing else is added, multiplied, or conditionally
 * applied — this is a plain `reduce`.
 */
export function sumPriorityScore(rankedSignals: RankedSignal[]): { score: number; breakdown: EngineBreakdownEntry[] } {
  const breakdown: EngineBreakdownEntry[] = rankedSignals.map(s => ({
    signalKey: s.signalKey,
    contribution: s.priorityScoreContribution,
  }));
  const score = breakdown.reduce((sum, entry) => sum + entry.contribution, 0);
  return { score, breakdown };
}

/**
 * Returns the tenant's currently-fired signals, sorted descending by
 * `priorityScoreContribution`. Thin DB-fetching wrapper around the pure
 * `rankFiredSignals`.
 */
export async function getRankedSignals(tenantId: number): Promise<RankedSignal[]> {
  const [{ firedSignalKeys }, weights] = await Promise.all([
    getFiredSignalKeysForTenant(tenantId),
    getSignalWeights(),
  ]);

  return rankFiredSignals(firedSignalKeys, weights);
}

/**
 * Calculates the tenant's priority score: the exact sum of
 * `priorityScoreContribution` across its currently-fired, enabled signals.
 * Nothing else is added, multiplied, or conditionally applied — this is a
 * pure sum over the tenant's ranked signals (see `sumPriorityScore`).
 */
export async function calculatePriorityScore(tenantId: number): Promise<EngineOutput> {
  const { firedSignalKeys, rules } = await getFiredSignalKeysForTenant(tenantId);
  const weights = await getSignalWeights();
  const rankedSignals = rankFiredSignals(firedSignalKeys, weights);
  const { score, breakdown } = sumPriorityScore(rankedSignals);

  return {
    engine: "priority",
    score,
    breakdown,
    rawSignals: firedSignalKeys,
    rawRules: rules,
    workflowVariables: {
      priorityScore: score,
      priorityTopSignal: rankedSignals[0]?.signalKey ?? "",
    },
    timestamp: new Date().toISOString(),
  };
}
