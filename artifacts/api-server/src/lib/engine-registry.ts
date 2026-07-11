/**
 * engine-registry.ts
 *
 * Single lookup table describing every intelligence engine (priority, pricing,
 * health, drift, forecasting, CRM, MSP) in a shape the generic admin routes
 * (`routes/admin-engines.ts`) can drive without engine-specific branching.
 *
 * Each engine already computes a pure sum over `computeTenantSignals()` output
 * (see priority-engine.ts / health-engine.ts / drift-engine.ts /
 * forecasting-engine.ts / crm-engine.ts / msp-engine.ts) — this file does not
 * reimplement any scoring logic, it only adapts each engine's existing
 * tenant-scoped and payload-scoped entry points to one shared contract.
 */

import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { runSlaEngineForTenant, computeSlaEngine, type SlaTimer, type SlaPolicy } from "./sla-engine.ts";
import { runScopeCreepEngineForTenant, computeScopeCreepEngine } from "./scope-creep-engine.ts";
import {
  fetchSignalRulesAndGroups,
  buildTenantProfileAndFindings,
  getSignalWeights,
  rankFiredSignals,
  sumPriorityScore,
  calculatePriorityScore,
  getFiredSignalKeysForTenant,
} from "./priority-engine.ts";
import { computeHealthEngine, calculateArchitectureHealthScore } from "./health-engine.ts";
import { computeDriftEngine } from "./drift-engine.ts";
import { computeForecastingEngine } from "./forecasting-engine.ts";
import { getCrmSignalWeights, filterCrmSignals, sumCrmScore, calculateCrmScore } from "./crm-engine.ts";
import { computeTenantEngineScores, calculateMspPortfolioRisk } from "./msp-engine.ts";

export interface EngineTestInput {
  mergedProfile: Record<string, unknown>;
  parsedFindings: string[];
  rules: SignalDerivationRule[];
  groups: SignalRuleGroup[];
  disabledSignalKeys: Set<string>;
}

export interface EngineDef {
  key: string;
  label: string;
  description: string;
  /** category prefix used to scope the Configuration tab's rule/group list */
  categoryPrefix: string;
  /** Runs the engine for a real tenant. */
  runForTenant(tenantId: number): Promise<unknown>;
  /** Runs the engine for a supplied sample payload (test-against-payload). */
  runForPayload(input: EngineTestInput): unknown;
  /** true for engines that operate per-tenant (all but MSP, which is portfolio-wide). */
  tenantScoped: boolean;
  /**
   * "platform" — rules owned and edited only by Shane/PlatformAdmin.
   * "msp"      — MSP operators can add/override rules for their own organisation.
   * Defaults to "platform" when absent.
   */
  ruleOwnership?: "platform" | "msp";
}

// ── pricing engine ──────────────────────────────────────────────────────────
// No standalone lib file exists for pricing yet (sow-pricing.ts covers SOW
// HTML parsing/validation, not scoring) — this is a pure sum over the
// `pricingImpact` / `pricingValueContribution` fields already stored on each
// fired signal's rules/groups, following the exact representative-value
// convention every other engine uses (max across a signal's contributing
// rows, summed across fired signals).
export interface PricingBreakdownEntry {
  signalKey: string;
  pricingImpact: number;
  pricingValueContribution: number;
}
export interface PricingEngineOutput {
  engine: "pricing";
  score: { totalPricingImpact: number; totalPricingValueContribution: number };
  breakdown: PricingBreakdownEntry[];
  rawSignals: string[];
  timestamp: string;
}

export function computePricingEngine(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string>,
): PricingEngineOutput {
  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);
  const breakdown: PricingBreakdownEntry[] = [];
  for (const signalKey of firedSignals) {
    const contributors = [
      ...groups.filter(g => g.signalKey === signalKey),
      ...rules.filter(r => r.signalKey === signalKey),
    ];
    if (contributors.length === 0) continue;
    const pricingImpact = Math.max(0, ...contributors.map(c => c.pricingImpact ?? 0));
    const pricingValueContribution = Math.max(0, ...contributors.map(c => c.pricingValueContribution ?? 0));
    if (pricingImpact === 0 && pricingValueContribution === 0) continue;
    breakdown.push({ signalKey, pricingImpact, pricingValueContribution });
  }
  return {
    engine: "pricing",
    score: {
      totalPricingImpact: breakdown.reduce((s, b) => s + b.pricingImpact, 0),
      totalPricingValueContribution: breakdown.reduce((s, b) => s + b.pricingValueContribution, 0),
    },
    breakdown,
    rawSignals: [...firedSignals],
    timestamp: new Date().toISOString(),
  };
}

async function calculatePricingImpact(tenantId: number): Promise<PricingEngineOutput> {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return computePricingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
}

// ── shared tenant-scoped payload wrapper for drift/forecasting (no lib wrapper exists) ──

async function calculateDriftForTenant(tenantId: number) {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return computeDriftEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
}

async function calculateForecastForTenant(tenantId: number) {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return computeForecastingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
}

async function calculateMspForTenant(tenantId: number) {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return computeTenantEngineScores(tenantId, null, mergedProfile, findings, rules, groups, disabledSignalKeys);
}

function crmForPayload(input: EngineTestInput, weights: Array<{ signalKey: string; category: string; crmFitContribution: number; crmPainContribution: number; crmMaturityContribution: number; crmIntentContribution: number; crmUrgencyContribution: number }>) {
  const { firedSignals } = computeTenantSignals(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys);
  const breakdown = filterCrmSignals([...firedSignals], weights);
  const score = sumCrmScore(breakdown);
  return { engine: "crm" as const, score, breakdown, rawSignals: [...firedSignals], timestamp: new Date().toISOString() };
}

export const ENGINE_DEFS: EngineDef[] = [
  {
    key: "priority",
    label: "Priority Engine",
    description: "Ranks tenants by summing priorityScoreContribution across currently-fired, enabled signals.",
    categoryPrefix: "priority",
    tenantScoped: true,
    runForTenant: (tenantId) => calculatePriorityScore(tenantId),
    runForPayload: (input) => {
      const { firedSignals } = computeTenantSignals(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys);
      // getSignalWeights() is async and DB-backed; for payload tests we derive
      // weights directly from the supplied rules/groups instead, so a sample
      // payload can be tested without depending on live DB rule weights.
      const weights = [...input.groups, ...input.rules].map(r => ({
        signalKey: r.signalKey,
        weight: r.weight ?? 0,
        priority: r.priority ?? 0,
        priorityScoreContribution: r.priorityScoreContribution ?? 0,
      }));
      const ranked = rankFiredSignals([...firedSignals], weights);
      const { score, breakdown } = sumPriorityScore(ranked);
      return { engine: "priority", score, breakdown, rawSignals: [...firedSignals], timestamp: new Date().toISOString() };
    },
  },
  {
    key: "pricing",
    label: "Pricing Engine",
    description: "Sums pricingImpact / pricingValueContribution across currently-fired, enabled signals.",
    categoryPrefix: "pricing",
    tenantScoped: true,
    runForTenant: (tenantId) => calculatePricingImpact(tenantId),
    runForPayload: (input) => computePricingEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys),
  },
  {
    key: "health",
    label: "Architecture Health Engine",
    description: "Sums governance/security/compliance/adoption/copilot/architecture impact into an overall health score.",
    categoryPrefix: "governance",
    tenantScoped: true,
    runForTenant: (tenantId) => calculateArchitectureHealthScore(tenantId),
    runForPayload: (input) => computeHealthEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys),
  },
  {
    key: "drift",
    label: "Drift Engine",
    description: "Reduces drift-tagged rules/groups that evaluated true into a driftScore + trendDirection.",
    categoryPrefix: "drift",
    tenantScoped: true,
    runForTenant: (tenantId) => calculateDriftForTenant(tenantId),
    runForPayload: (input) => computeDriftEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys),
  },
  {
    key: "forecasting",
    label: "Forecasting Engine",
    description: "Sums trendValue * decayFactor across fired signals with a non-zero trend.",
    categoryPrefix: "forecasting",
    tenantScoped: true,
    runForTenant: (tenantId) => calculateForecastForTenant(tenantId),
    runForPayload: (input) => computeForecastingEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys),
  },
  {
    key: "crm",
    label: "CRM Engine",
    description: "Sums the five CRM contribution fields (fit/pain/maturity/intent/urgency) across fired crm:* signals.",
    categoryPrefix: "crm",
    tenantScoped: true,
    runForTenant: (tenantId) => calculateCrmScore(tenantId),
    runForPayload: (input) => {
      const weights = [...input.groups, ...input.rules].map(r => ({
        signalKey: r.signalKey,
        category: r.category ?? "",
        crmFitContribution: r.crmFitContribution ?? 0,
        crmPainContribution: r.crmPainContribution ?? 0,
        crmMaturityContribution: r.crmMaturityContribution ?? 0,
        crmIntentContribution: r.crmIntentContribution ?? 0,
        crmUrgencyContribution: r.crmUrgencyContribution ?? 0,
      }));
      return crmForPayload(input, weights);
    },
  },
  {
    key: "msp",
    label: "MSP Portfolio Engine",
    description: "Aggregates health + drift + priority scores per tenant into a portfolio-wide risk roll-up.",
    categoryPrefix: "msp",
    tenantScoped: false,
    ruleOwnership: "platform",
    runForTenant: (tenantId) => calculateMspForTenant(tenantId),
    runForPayload: (input) => {
      const { mergedProfile, parsedFindings, rules, groups, disabledSignalKeys } = input;
      return computeTenantEngineScores(0, "Sample Payload", mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);
    },
  },
  {
    key: "sla",
    label: "SLA Engine",
    description: "Tracks SLA timers per customer, detects warnings and breaches, and computes compliance scores across MSP-managed tenants.",
    categoryPrefix: "sla",
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId) => runSlaEngineForTenant(tenantId),
    runForPayload: (_input) => {
      const sampleTimers: SlaTimer[] = [];
      const samplePolicies: SlaPolicy[] = [];
      return computeSlaEngine(sampleTimers, samplePolicies);
    },
  },
  {
    key: "scope_creep",
    label: "Scope Creep Engine",
    description: "Detects deliverable/requirement/ticket/timeline drift and SOW expansion, scores scope-creep risk, raises violations, escalates with SOW amendment and pricing review recommendations, and tracks monthly compliance.",
    categoryPrefix: "scope_creep",
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId) => runScopeCreepEngineForTenant(tenantId),
    runForPayload: (_input) => {
      return computeScopeCreepEngine([], []);
    },
  },
];

export function getEngineDef(key: string): EngineDef | undefined {
  return ENGINE_DEFS.find(e => e.key === key);
}

export async function buildEngineTestInputForTenant(tenantId: number): Promise<EngineTestInput> {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return { mergedProfile, parsedFindings: findings, rules, groups, disabledSignalKeys };
}

export async function buildEngineTestInputForPayload(
  profileUpdates: Record<string, unknown>,
  parsedFindings: string[],
): Promise<EngineTestInput> {
  const [{ rules, groups }, disabledSignalKeys] = await Promise.all([
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return { mergedProfile: profileUpdates, parsedFindings, rules, groups, disabledSignalKeys };
}

export { getFiredSignalKeysForTenant, getSignalWeights, getCrmSignalWeights, calculateMspPortfolioRisk };
