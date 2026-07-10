/**
 * crm-engine.ts
 *
 * CRM scoring engine — scores a lead/client by summing the five CRM
 * contribution fields (`crmFitContribution`, `crmPainContribution`,
 * `crmMaturityContribution`, `crmIntentContribution`, `crmUrgencyContribution`)
 * already stored on each of the tenant's currently-fired, enabled signals
 * whose `category` starts with `crm:` (see `SIGNAL_INTELLIGENCE_FIELDS` in
 * `lib/db/src/schema/index.ts`).
 *
 * Like the other engines (`priority-engine.ts`, `health-engine.ts`,
 * `drift-engine.ts`, `forecasting-engine.ts`), this is intentionally a pure
 * sum over data already produced by `computeTenantSignals()` — it contains
 * zero hand-coded business logic about *which* signals matter or how much.
 * All of that lives in the admin-editable `signal_derivation_rules` /
 * `signal_rule_groups` rows. Changing a rule's `crmFitContribution` in the
 * admin panel changes every lead's CRM score with no code changes required.
 *
 * Output shape matches the platform-wide engine contract:
 *   { engine, score, breakdown, rawSignals, rawRules, workflowVariables, timestamp }
 *
 * `score` here is a `CrmScoreBreakdown` object (fit/pain/maturity/intent/
 * urgency + total) rather than a single number, since the CRM engine tracks
 * five independent dimensions plus a combined total.
 */

import { db, clientM365ProfilesTable, scriptRunResultsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";

// ── CRM engine output contract ─────────────────────────────────────────────

/** The five independent CRM contribution dimensions, plus a combined total. */
export interface CrmScoreBreakdown {
  fit: number;
  pain: number;
  maturity: number;
  intent: number;
  urgency: number;
  total: number;
}

export interface CrmBreakdownEntry {
  signalKey: string;
  fit: number;
  pain: number;
  maturity: number;
  intent: number;
  urgency: number;
}

export interface CrmEngineOutput {
  engine: "crm";
  score: CrmScoreBreakdown;
  breakdown: CrmBreakdownEntry[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  workflowVariables: Record<string, string | number>;
  timestamp: string;
}

/** Per-signal CRM weight configuration, as configured by an admin. */
export interface CrmSignalWeightConfig {
  signalKey: string;
  category: string;
  crmFitContribution: number;
  crmPainContribution: number;
  crmMaturityContribution: number;
  crmIntentContribution: number;
  crmUrgencyContribution: number;
}

const CRM_CATEGORY_PREFIX = "crm:";

/**
 * Per-signal CRM weight configuration, as currently set by an admin,
 * restricted to signals tagged with a `crm:*` category. Mirrors
 * `getSignalWeights()` in `priority-engine.ts`: a signal's rules/groups may
 * repeat the same contribution values across multiple rows (e.g. every rule
 * in an AND group), so this takes the maximum value configured anywhere for
 * that signal key rather than summing duplicates.
 *
 * Global — not tenant-scoped, since it reflects rule *configuration*, not
 * any particular tenant's fired state.
 */
export async function getCrmSignalWeights(): Promise<CrmSignalWeightConfig[]> {
  const { rules, groups } = await fetchSignalRulesAndGroups();

  const bySignal = new Map<string, CrmSignalWeightConfig>();

  const consider = (
    signalKey: string,
    category: string,
    crmFitContribution: number,
    crmPainContribution: number,
    crmMaturityContribution: number,
    crmIntentContribution: number,
    crmUrgencyContribution: number,
  ) => {
    if (!category.startsWith(CRM_CATEGORY_PREFIX)) return;
    const existing = bySignal.get(signalKey);
    if (!existing) {
      bySignal.set(signalKey, {
        signalKey,
        category,
        crmFitContribution,
        crmPainContribution,
        crmMaturityContribution,
        crmIntentContribution,
        crmUrgencyContribution,
      });
      return;
    }
    existing.crmFitContribution = Math.max(existing.crmFitContribution, crmFitContribution);
    existing.crmPainContribution = Math.max(existing.crmPainContribution, crmPainContribution);
    existing.crmMaturityContribution = Math.max(existing.crmMaturityContribution, crmMaturityContribution);
    existing.crmIntentContribution = Math.max(existing.crmIntentContribution, crmIntentContribution);
    existing.crmUrgencyContribution = Math.max(existing.crmUrgencyContribution, crmUrgencyContribution);
  };

  for (const rule of rules) {
    consider(
      rule.signalKey, rule.category,
      rule.crmFitContribution, rule.crmPainContribution, rule.crmMaturityContribution,
      rule.crmIntentContribution, rule.crmUrgencyContribution,
    );
  }
  for (const group of groups) {
    consider(
      group.signalKey, group.category,
      group.crmFitContribution, group.crmPainContribution, group.crmMaturityContribution,
      group.crmIntentContribution, group.crmUrgencyContribution,
    );
  }

  return [...bySignal.values()];
}

/**
 * Pure core of the engine: filters the tenant's currently-fired signal keys
 * down to only those with a configured `crm:*` weight, then attaches each
 * signal's five contribution values. Signals with no `crm:*` configuration
 * (i.e. not present in `weights`) are excluded entirely — this is the
 * "filter to crm:* category" step described in the task.
 *
 * No DB access, no conditionals beyond the lookup itself.
 */
export function filterCrmSignals(
  firedSignalKeys: string[],
  weights: CrmSignalWeightConfig[],
): CrmBreakdownEntry[] {
  const weightBySignal = new Map(weights.map(w => [w.signalKey, w]));

  return firedSignalKeys
    .filter(signalKey => weightBySignal.has(signalKey))
    .map(signalKey => {
      const w = weightBySignal.get(signalKey)!;
      return {
        signalKey,
        fit: w.crmFitContribution,
        pain: w.crmPainContribution,
        maturity: w.crmMaturityContribution,
        intent: w.crmIntentContribution,
        urgency: w.crmUrgencyContribution,
      };
    });
}

/**
 * Pure core of the engine: sums each of the five CRM contribution fields
 * independently across the filtered breakdown entries, plus a combined
 * total. Nothing else is added, multiplied, or conditionally applied —
 * this is a plain per-field `reduce`.
 */
export function sumCrmScore(entries: CrmBreakdownEntry[]): CrmScoreBreakdown {
  const fit = entries.reduce((sum, e) => sum + e.fit, 0);
  const pain = entries.reduce((sum, e) => sum + e.pain, 0);
  const maturity = entries.reduce((sum, e) => sum + e.maturity, 0);
  const intent = entries.reduce((sum, e) => sum + e.intent, 0);
  const urgency = entries.reduce((sum, e) => sum + e.urgency, 0);
  const total = fit + pain + maturity + intent + urgency;
  return { fit, pain, maturity, intent, urgency, total };
}

/**
 * Builds a merged M365 profile + findings list for a tenant, exactly the
 * same way `buildTenantProfileAndFindings` does in `priority-engine.ts`.
 */
async function buildTenantProfileAndFindings(
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
 * engine can never drift from what the SOW/priority/CRM/workflow paths
 * consider fired.
 */
async function getFiredSignalKeysForTenant(tenantId: number): Promise<{
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
 * Calculates the tenant/lead's CRM score: independent sums of each of the
 * five `crm:*` contribution fields (plus a combined total) across the
 * tenant's currently-fired, enabled `crm:*` signals. Returns the unified
 * engine output shape shared by every scoring engine in this codebase.
 */
export async function calculateCrmScore(tenantId: number): Promise<CrmEngineOutput> {
  const [{ firedSignalKeys, rules }, weights] = await Promise.all([
    getFiredSignalKeysForTenant(tenantId),
    getCrmSignalWeights(),
  ]);

  const breakdown = filterCrmSignals(firedSignalKeys, weights);
  const score = sumCrmScore(breakdown);

  return {
    engine: "crm",
    score,
    breakdown,
    rawSignals: firedSignalKeys,
    rawRules: rules,
    workflowVariables: {
      crmScoreTotal: score.total,
      crmScoreFit: score.fit,
      crmScorePain: score.pain,
      crmScoreMaturity: score.maturity,
      crmScoreIntent: score.intent,
      crmScoreUrgency: score.urgency,
    },
    timestamp: new Date().toISOString(),
  };
}
