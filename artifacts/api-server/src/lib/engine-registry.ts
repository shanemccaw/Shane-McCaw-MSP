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

import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { mspUsersTable, mspCustomersTable, tenantEngineSnapshotsTable, db } from "@workspace/db";
import { logger } from "./logger.ts";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { runSlaEngineForTenant, computeSlaEngine, type SlaTimer, type SlaPolicy } from "./sla-engine.ts";
import { runScopeCreepEngineForTenant, computeScopeCreepEngine } from "./scope-creep-engine.ts";
import { computeMonitoringEngine, computeMonitoringEngineForPayload } from "./monitor-executor.ts";
import {
  runSalesOfferEngineForTenant,
  computeSalesOfferEngine,
  loadSalesOfferRuleGroups,
  loadSalesOfferConfig,
} from "./sales-offer-engine.ts";
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
import { computeSecurityEngine, runSecurityEngineForTenant } from "./security-engine.ts";
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

export interface EngineContext {
  evaluationTimestamp?: Date;
}

export interface EngineDef {
  key: string;
  label: string;
  description: string;
  /** category prefix used to scope the Configuration tab's rule/group list */
  categoryPrefix: string;
  /** Runs the engine for a real tenant. */
  runForTenant(tenantId: number, ctx?: EngineContext): Promise<unknown>;
  /** Runs the engine for a supplied sample payload (test-against-payload). */
  runForPayload(input: EngineTestInput, ctx?: EngineContext): unknown;
  /** true for engines that operate per-tenant (all but MSP, which is portfolio-wide). */
  tenantScoped: boolean;
  /**
   * "platform" — rules owned and edited only by Shane/PlatformAdmin.
   * "msp"      — MSP operators can add/override rules for their own organisation.
   */
  ruleOwnership: "platform" | "msp";
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
  ctx?: EngineContext,
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
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

async function calculatePricingImpact(tenantId: number, ctx?: EngineContext): Promise<PricingEngineOutput> {
  const [{ mergedProfile, findings, customerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (customerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId, mspId });
  }
  return computePricingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

// ── shared tenant-scoped payload wrapper for drift/forecasting (no lib wrapper exists) ──

async function calculateDriftForTenant(tenantId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (customerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId, mspId });
  }
  return computeDriftEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

async function calculateForecastForTenant(tenantId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (customerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId, mspId });
  }
  return computeForecastingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

async function calculateMspForTenant(tenantId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (customerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId, mspId });
  }
  return computeTenantEngineScores(tenantId, null, mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

function crmForPayload(input: EngineTestInput, weights: Array<{ signalKey: string; category: string; crmFitContribution: number; crmPainContribution: number; crmMaturityContribution: number; crmIntentContribution: number; crmUrgencyContribution: number }>, ctx?: EngineContext) {
  const { firedSignals } = computeTenantSignals(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys);
  const breakdown = filterCrmSignals([...firedSignals], weights);
  const score = sumCrmScore(breakdown);
  return { engine: "crm" as const, score, breakdown, rawSignals: [...firedSignals], timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString() };
}

export const ENGINE_DEFS: EngineDef[] = [
  {
    key: "priority",
    label: "Priority Engine",
    description: "Ranks tenants by summing priorityScoreContribution across currently-fired, enabled signals.",
    categoryPrefix: "priority",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculatePriorityScore(tenantId, ctx),
    runForPayload: (input, ctx) => {
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
      return { engine: "priority", score, breakdown, rawSignals: [...firedSignals], timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString() };
    },
  },
  {
    key: "pricing",
    label: "Pricing Engine",
    description: "Sums pricingImpact / pricingValueContribution across currently-fired, enabled signals.",
    categoryPrefix: "pricing",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculatePricingImpact(tenantId, ctx),
    runForPayload: (input, ctx) => computePricingEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys, ctx),
  },
  {
    key: "health",
    label: "Architecture Health Engine",
    description: "Sums governance/compliance/adoption/copilot/architecture/licensing impact into an overall health score (security is computed by the standalone Security Engine and combined into the total).",
    categoryPrefix: "governance",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateArchitectureHealthScore(tenantId, ctx),
    runForPayload: (input, ctx) => computeHealthEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys, ctx),
  },
  {
    key: "security",
    label: "Security Engine",
    description: "Sums securityImpact across currently-fired, enabled signals into a standalone security posture score.",
    categoryPrefix: "security",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => runSecurityEngineForTenant(tenantId, ctx),
    runForPayload: (input, ctx) => computeSecurityEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys, ctx),
  },
  {
    key: "drift",
    label: "Drift Engine",
    description: "Reduces drift-tagged rules/groups that evaluated true into a driftScore + trendDirection.",
    categoryPrefix: "drift",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateDriftForTenant(tenantId, ctx),
    runForPayload: (input, ctx) => computeDriftEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys, ctx),
  },
  {
    key: "forecasting",
    label: "Forecasting Engine",
    description: "Sums trendValue * decayFactor across fired signals with a non-zero trend.",
    categoryPrefix: "forecasting",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateForecastForTenant(tenantId, ctx),
    runForPayload: (input, ctx) => computeForecastingEngine(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys, ctx),
  },
  {
    key: "crm",
    label: "CRM Engine",
    description: "Sums the five CRM contribution fields (fit/pain/maturity/intent/urgency) across fired crm:* signals.",
    categoryPrefix: "crm",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateCrmScore(tenantId, ctx),
    runForPayload: (input, ctx) => {
      const weights = [...input.groups, ...input.rules].map(r => ({
        signalKey: r.signalKey,
        category: r.category ?? "",
        crmFitContribution: r.crmFitContribution ?? 0,
        crmPainContribution: r.crmPainContribution ?? 0,
        crmMaturityContribution: r.crmMaturityContribution ?? 0,
        crmIntentContribution: r.crmIntentContribution ?? 0,
        crmUrgencyContribution: r.crmUrgencyContribution ?? 0,
      }));
      return crmForPayload(input, weights, ctx);
    },
  },
  {
    key: "msp",
    label: "MSP Portfolio Engine",
    description: "Aggregates health + drift + priority scores per tenant into a portfolio-wide risk roll-up.",
    categoryPrefix: "msp",
    tenantScoped: false,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateMspForTenant(tenantId, ctx),
    runForPayload: (input, ctx) => {
      const { mergedProfile, parsedFindings, rules, groups, disabledSignalKeys } = input;
      return computeTenantEngineScores(0, "Sample Payload", mergedProfile, parsedFindings, rules, groups, disabledSignalKeys, ctx);
    },
  },
  {
    key: "sla",
    label: "SLA Engine",
    description: "Tracks SLA timers per customer, detects warnings and breaches, and computes compliance scores across MSP-managed tenants.",
    categoryPrefix: "sla",
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runSlaEngineForTenant(tenantId, ctx),
    runForPayload: (_input, ctx) => {
      const sampleTimers: SlaTimer[] = [];
      const samplePolicies: SlaPolicy[] = [];
      return computeSlaEngine(sampleTimers, samplePolicies, ctx?.evaluationTimestamp || new Date());
    },
  },
  {
    key: "scope_creep",
    label: "Scope Creep Engine",
    description: "Detects deliverable/requirement/ticket/timeline drift and SOW expansion, scores scope-creep risk, raises violations, escalates with SOW amendment and pricing review recommendations, and tracks monthly compliance.",
    categoryPrefix: "scope_creep",
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runScopeCreepEngineForTenant(tenantId, ctx),
    runForPayload: (_input, ctx) => {
      return computeScopeCreepEngine([], [], 0, ctx?.evaluationTimestamp);
    },
  },
  {
    key: "monitoring",
    label: "Monitoring Engine",
    description: "Executes platform-authored Monitor Checks against customer tenants via Graph API, writes tenant_monitor_profile rows, and classifies severity. Output: {results, breakdown: coverage/failures, logs, debug}.",
    categoryPrefix: "monitoring",
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => computeMonitoringEngine(tenantId),
    runForPayload: (_input, ctx) => computeMonitoringEngineForPayload(),
  },
  {
    key: "sales_offer",
    label: "Sales Offer Engine",
    description: "Converts diagnostics findings (fired signals + product catalog) into priced, scored, lifecycle-managed candidate offers via configurable rule groups. Outputs offer candidates ranked by relevance score.",
    categoryPrefix: "sales_offer",
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runSalesOfferEngineForTenant(tenantId, null, ctx),
    runForPayload: async (input, ctx) => {
      const { firedSignals } = computeTenantSignals(input.mergedProfile, input.parsedFindings, input.rules, input.groups, input.disabledSignalKeys);
      const [ruleGroups, services, config] = await Promise.all([
        loadSalesOfferRuleGroups(),
        (async () => {
          const { db: soDb } = await import("@workspace/db");
          const { servicesTable: soSvcTable } = await import("@workspace/db");
          return soDb.select({ id: soSvcTable.id, name: soSvcTable.name, price: soSvcTable.price, basePrice: soSvcTable.basePrice }).from(soSvcTable);
        })(),
        loadSalesOfferConfig(null),
      ]);
      return computeSalesOfferEngine(null, firedSignals, ruleGroups, services, config, ctx);
    },
  },
];

async function writeEngineSnapshot(
  engineKey: string,
  tenantId: number,
  result: unknown,
): Promise<void> {
  try {
    const [customerRow] = await db
      .select({ customerId: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
      .from(mspUsersTable)
      .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
      .where(eq(mspUsersTable.userId, tenantId))
      .limit(1);
    const customerId = customerRow?.customerId ?? null;
    const mspId = customerRow?.mspId ?? null;
    if (customerId == null) return;

    const r = result as { score?: number; breakdown?: unknown } | null | undefined;
    const score = typeof r?.score === "number" ? r.score : 0;
    const breakdown = Array.isArray(r?.breakdown) ? r.breakdown : (r?.breakdown ? [r.breakdown] : []);

    const [prior] = await db
      .select({ score: tenantEngineSnapshotsTable.score })
      .from(tenantEngineSnapshotsTable)
      .where(and(eq(tenantEngineSnapshotsTable.customerId, customerId), eq(tenantEngineSnapshotsTable.engineKey, engineKey)))
      .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
      .limit(1);
    const previousScore = prior?.score ?? null;
    const delta = previousScore != null ? score - previousScore : null;

    await db.insert(tenantEngineSnapshotsTable).values({
      customerId,
      mspId,
      engineKey,
      score,
      previousScore,
      delta,
      breakdown,
      runId: randomUUID(),
    });
  } catch (err) {
    logger.warn({ err, engineKey, tenantId }, "writeEngineSnapshot: failed to record snapshot (non-fatal)");
  }
}

for (const def of ENGINE_DEFS) {
  const originalRunForTenant = def.runForTenant.bind(def);
  def.runForTenant = async (tenantId: number, ctx?: EngineContext) => {
    const result = await originalRunForTenant(tenantId, ctx);
    void writeEngineSnapshot(def.key, tenantId, result);
    return result;
  };
}

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
