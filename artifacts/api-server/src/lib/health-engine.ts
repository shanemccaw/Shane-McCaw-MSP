/**
 * health-engine.ts
 *
 * Architecture-health scoring engine. Reuses `computeTenantSignals` to
 * determine which signals are currently fired (and enabled) for a tenant,
 * then sums the seven impact fields already stored on each fired signal's
 * rules/groups — `governanceImpact`, `securityImpact`, `complianceImpact`,
 * `adoptionImpact`, `copilotImpact`, `architectureImpact`, `licensingImpact`
 * — into an overall `architectureHealthScore` plus a per-pillar breakdown.
 *
 * Scoring is intentionally a pure sum with zero conditional business logic:
 *
 *   architectureHealthScore =
 *     sum(governanceImpact + securityImpact + complianceImpact +
 *         adoptionImpact + copilotImpact + architectureImpact + licensingImpact)
 *     over the tenant's currently-fired, enabled signals.
 *
 * Per-pillar values live on individual rule/group rows in the schema (not on
 * the signal itself), so — mirroring the representative-value convention
 * `getSignalWeights` uses in `priority-engine.ts` — each fired signal's
 * contribution to a given pillar is the MAX value configured anywhere across
 * that signal's rules/groups for that pillar's field. This avoids double
 * counting when a signal has multiple rules (e.g. every rule in an AND
 * group) that repeat the same impact value, while still letting an admin
 * change a signal's effective contribution by changing any one of its rows.
 *
 * Out of scope (see task spec): priority/pricing/drift/forecasting/CRM/MSP
 * engines, admin UI, workflow nodes, SOW wiring.
 */

import { db, clientM365ProfilesTable, scriptRunResultsTable, mspUsersTable, mspCustomersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { computeSecurityEngine } from "./security-engine.ts";

/** The seven architecture-health pillars, in the order the task spec lists them. */
export const HEALTH_PILLARS = [
  "governance",
  "compliance",
  "adoption",
  "copilot",
  "architecture",
  "licensing",
] as const;
export type HealthPillar = typeof HEALTH_PILLARS[number];

/** Maps each pillar to the intelligence field that carries its impact value. */
export const PILLAR_FIELD: Record<HealthPillar | "security", string> = {
  governance: "governanceImpact",
  security: "securityImpact",
  compliance: "complianceImpact",
  adoption: "adoptionImpact",
  copilot: "copilotImpact",
  architecture: "architectureImpact",
  licensing: "licensingImpact",
} as const;

export interface HealthPillarContribution {
  signalKey: string;
  value: number;
}

export interface HealthPillarBreakdown {
  pillar: HealthPillar | "security";
  score: number;
  contributions: HealthPillarContribution[];
}

export interface HealthEngineOutput {
  engine: "health";
  score: number;
  breakdown: HealthPillarBreakdown[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  workflowVariables: Record<string, number>;
  timestamp: string;
}

/** Per-signal impact configuration across all seven pillars, as set by an admin. */
export interface SignalHealthImpactConfig {
  signalKey: string;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  licensingImpact: number;
}

/**
 * Derives, per fired signal, the representative value for each of the seven
 * health pillars — the MAX configured anywhere across that signal's rules
 * and groups (see file header for why max, not sum-of-duplicates).
 *
 * Pure — no DB access, no conditionals beyond the lookup itself.
 */
export function getSignalHealthImpacts(
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
): Map<string, SignalHealthImpactConfig> {
  const bySignal = new Map<string, SignalHealthImpactConfig>();

  const consider = (signalKey: string, source: SignalDerivationRule | SignalRuleGroup) => {
    const s = source as unknown as Record<string, number>;
    const existing = bySignal.get(signalKey);
    if (!existing) {
      bySignal.set(signalKey, {
        signalKey,
        governanceImpact: s["governanceImpact"] ?? 0,
        securityImpact: s["securityImpact"] ?? 0,
        complianceImpact: s["complianceImpact"] ?? 0,
        adoptionImpact: s["adoptionImpact"] ?? 0,
        copilotImpact: s["copilotImpact"] ?? 0,
        architectureImpact: s["architectureImpact"] ?? 0,
        licensingImpact: s["licensingImpact"] ?? 0,
      });
      return;
    }
    existing.governanceImpact = Math.max(existing.governanceImpact, s["governanceImpact"] ?? 0);
    existing.securityImpact = Math.max(existing.securityImpact, s["securityImpact"] ?? 0);
    existing.complianceImpact = Math.max(existing.complianceImpact, s["complianceImpact"] ?? 0);
    existing.adoptionImpact = Math.max(existing.adoptionImpact, s["adoptionImpact"] ?? 0);
    existing.copilotImpact = Math.max(existing.copilotImpact, s["copilotImpact"] ?? 0);
    existing.architectureImpact = Math.max(existing.architectureImpact, s["architectureImpact"] ?? 0);
    existing.licensingImpact = Math.max(existing.licensingImpact, s["licensingImpact"] ?? 0);
  };

  for (const rule of rules) consider(rule.signalKey, rule);
  for (const group of groups) consider(group.signalKey, group);

  return bySignal;
}

/**
 * Pure core of the engine: given a set of currently-fired (and already
 * enabled-filtered) signal keys and the per-signal health impact
 * configuration, sums each of the seven pillar fields independently plus the
 * overall score. Nothing else is added, multiplied, or conditionally
 * applied — this is a plain per-pillar `reduce`.
 */
export function sumArchitectureHealth(
  firedSignalKeys: string[],
  impacts: Map<string, SignalHealthImpactConfig>,
): { score: number; breakdown: HealthPillarBreakdown[] } {
  const breakdown: HealthPillarBreakdown[] = HEALTH_PILLARS.map(pillar => {
    const field = PILLAR_FIELD[pillar];
    const contributions: HealthPillarContribution[] = firedSignalKeys.map(signalKey => {
      const cfg = impacts.get(signalKey) as unknown as Record<string, number> | undefined;
      return { signalKey, value: cfg?.[field] ?? 0 };
    });
    const score = contributions.reduce((sum, c) => sum + c.value, 0);
    return { pillar, score, contributions };
  });

  const score = breakdown.reduce((sum, p) => sum + p.score, 0);
  return { score, breakdown };
}

/**
 * Computes the architecture health engine output for a tenant, given
 * already-fetched signal data. Pure — no DB access.
 */
export function computeHealthEngine(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
  ctx?: { evaluationTimestamp?: Date },
): HealthEngineOutput {
  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);
  const firedSignalKeys = [...firedSignals];

  const impacts = getSignalHealthImpacts(rules, groups);
  const { score, breakdown } = sumArchitectureHealth(firedSignalKeys, impacts);

  const workflowVariables: Record<string, number> = { architectureHealthScore: score };
  for (const pillarBreakdown of breakdown) {
    workflowVariables[`${pillarBreakdown.pillar}HealthContribution`] = pillarBreakdown.score;
  }

  return {
    engine: "health",
    score,
    breakdown,
    rawSignals: firedSignalKeys,
    rawRules: rules,
    workflowVariables,
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

/**
 * Builds a merged M365 profile + findings list for a tenant, exactly the
 * same way `priority-engine.ts` does — the client's stored profile overlaid
 * with every completed script run's `profileUpdates`, oldest-first so newer
 * runs win on conflicting keys.
 */
async function buildTenantProfileAndFindings(
  clientUserId: number,
): Promise<{ mergedProfile: Record<string, unknown>; findings: string[]; customerId: number | null; mspId: number | null }> {
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

  const [customerRow] = await db
    .select({ customerId: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
    .from(mspUsersTable)
    .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(eq(mspUsersTable.userId, clientUserId))
    .limit(1);
  const customerId = customerRow?.customerId ?? null;
  const mspId = customerRow?.mspId ?? null;

  return { mergedProfile, findings, customerId, mspId };
}

/**
 * Calculates a tenant's architecture health score by fetching its profile,
 * findings, and the live signal rule/group configuration from the DB, then
 * delegating to the pure `computeHealthEngine`.
 */
export async function calculateArchitectureHealthScore(customerId: number, ctx?: { evaluationTimestamp?: Date }): Promise<HealthEngineOutput> {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }

  const healthResult = computeHealthEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
  const securityResult = computeSecurityEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);

  return {
    ...healthResult,
    score: healthResult.score + securityResult.score,
    breakdown: [...healthResult.breakdown, securityResult.breakdown],
  };
}
