/**
 * health-engine.ts
 *
 * Architecture-health scoring engine. Reuses `computeTenantSignals` to
 * determine which signals are currently fired (and enabled) for a tenant,
 * then sums the six impact fields already stored on each fired signal's
 * rules/groups — `governanceImpact`, `securityImpact`, `complianceImpact`,
 * `adoptionImpact`, `copilotImpact`, `architectureImpact` — into an overall
 * `architectureHealthScore` plus a per-pillar breakdown.
 *
 * Scoring is intentionally a pure sum with zero conditional business logic:
 *
 *   architectureHealthScore =
 *     sum(governanceImpact + securityImpact + complianceImpact +
 *         adoptionImpact + copilotImpact + architectureImpact)
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

import { db, clientM365ProfilesTable, scriptRunResultsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";

/** The six architecture-health pillars, in the order the task spec lists them. */
export const HEALTH_PILLARS = [
  "governance",
  "security",
  "compliance",
  "adoption",
  "copilot",
  "architecture",
] as const;
export type HealthPillar = typeof HEALTH_PILLARS[number];

/** Maps each pillar to the intelligence field that carries its impact value. */
const PILLAR_FIELD = {
  governance: "governanceImpact",
  security: "securityImpact",
  compliance: "complianceImpact",
  adoption: "adoptionImpact",
  copilot: "copilotImpact",
  architecture: "architectureImpact",
} as const satisfies Record<HealthPillar, keyof SignalDerivationRule>;

export interface HealthPillarContribution {
  signalKey: string;
  value: number;
}

export interface HealthPillarBreakdown {
  pillar: HealthPillar;
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

/** Per-signal impact configuration across all six pillars, as set by an admin. */
export interface SignalHealthImpactConfig {
  signalKey: string;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
}

/**
 * Derives, per fired signal, the representative value for each of the six
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
    const existing = bySignal.get(signalKey);
    if (!existing) {
      bySignal.set(signalKey, {
        signalKey,
        governanceImpact: source.governanceImpact,
        securityImpact: source.securityImpact,
        complianceImpact: source.complianceImpact,
        adoptionImpact: source.adoptionImpact,
        copilotImpact: source.copilotImpact,
        architectureImpact: source.architectureImpact,
      });
      return;
    }
    existing.governanceImpact = Math.max(existing.governanceImpact, source.governanceImpact);
    existing.securityImpact = Math.max(existing.securityImpact, source.securityImpact);
    existing.complianceImpact = Math.max(existing.complianceImpact, source.complianceImpact);
    existing.adoptionImpact = Math.max(existing.adoptionImpact, source.adoptionImpact);
    existing.copilotImpact = Math.max(existing.copilotImpact, source.copilotImpact);
    existing.architectureImpact = Math.max(existing.architectureImpact, source.architectureImpact);
  };

  for (const rule of rules) consider(rule.signalKey, rule);
  for (const group of groups) consider(group.signalKey, group);

  return bySignal;
}

/**
 * Pure core of the engine: given a set of currently-fired (and already
 * enabled-filtered) signal keys and the per-signal health impact
 * configuration, sums each of the six pillar fields independently plus the
 * overall score. Nothing else is added, multiplied, or conditionally
 * applied — this is a plain per-pillar `reduce`.
 */
export function sumArchitectureHealth(
  firedSignalKeys: string[],
  impacts: Map<string, SignalHealthImpactConfig>,
): { score: number; breakdown: HealthPillarBreakdown[] } {
  const breakdown: HealthPillarBreakdown[] = HEALTH_PILLARS.map(pillar => {
    const field = PILLAR_FIELD[pillar];
    const contributions: HealthPillarContribution[] = firedSignalKeys.map(signalKey => ({
      signalKey,
      value: impacts.get(signalKey)?.[field] ?? 0,
    }));
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
    timestamp: new Date().toISOString(),
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
 * Calculates a tenant's architecture health score by fetching its profile,
 * findings, and the live signal rule/group configuration from the DB, then
 * delegating to the pure `computeHealthEngine`.
 */
export async function calculateArchitectureHealthScore(tenantId: number): Promise<HealthEngineOutput> {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  return computeHealthEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
}
