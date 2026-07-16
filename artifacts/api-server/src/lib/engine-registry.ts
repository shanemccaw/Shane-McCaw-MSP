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
import { eq, and, desc, sql } from "drizzle-orm";
import { mspUsersTable, mspCustomersTable, tenantEngineSnapshotsTable, engineBaselineHistoryTable, signalRuleAuditLogTable, engineScoreSignalDeltasTable, db } from "@workspace/db";
import { logger } from "./logger.ts";
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { runSlaEngineForTenant } from "./sla-engine.ts";
import { runScopeCreepEngineForTenant } from "./scope-creep-engine.ts";
import { computeMonitoringEngine } from "./monitor-executor.ts";
import { runSalesOfferEngineForTenant } from "./sales-offer-engine.ts";
import {
  fetchSignalRulesAndGroups,
  buildTenantProfileAndFindings,
  getSignalWeights,
  calculatePriorityScore,
  getFiredSignalKeysForTenant,
} from "./priority-engine.ts";
import { calculateArchitectureHealthScore } from "./health-engine.ts";
import { runSecurityEngineForTenant } from "./security-engine.ts";
import { computeDriftEngine } from "./drift-engine.ts";
import { computeForecastingEngine } from "./forecasting-engine.ts";
import { getCrmSignalWeights, calculateCrmScore } from "./crm-engine.ts";
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
  /** Keys of other ENGINE_DEFS entries that must complete before this one runs. Empty array = no dependencies beyond get_tenant_signals. */
  dependsOn: string[];
  /** Runs the engine for a real tenant. This is the ONLY execution path —
   *  fake-payload/parallel-simulation testing (runForPayload) was retired
   *  platform-wide; every test/preview call must go through a real
   *  (testbed-flagged, where applicable) tenant. */
  runForTenant(tenantId: number, ctx?: EngineContext): Promise<unknown>;
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

export const ENGINE_DEFS: EngineDef[] = [
  {
    key: "priority",
    label: "Priority Engine",
    description: "Ranks tenants by summing priorityScoreContribution across currently-fired, enabled signals.",
    categoryPrefix: "priority",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculatePriorityScore(tenantId, ctx),
  },
  {
    key: "pricing",
    label: "Pricing Engine",
    description: "Sums pricingImpact / pricingValueContribution across currently-fired, enabled signals.",
    categoryPrefix: "pricing",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculatePricingImpact(tenantId, ctx),
  },
  {
    key: "health",
    label: "Architecture Health Engine",
    description: "Sums governance/compliance/adoption/copilot/architecture/licensing impact into an overall health score (security is computed by the standalone Security Engine and combined into the total).",
    categoryPrefix: "governance",
    dependsOn: ["security"],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateArchitectureHealthScore(tenantId, ctx),
  },
  {
    key: "security",
    label: "Security Engine",
    description: "Sums securityImpact across currently-fired, enabled signals into a standalone security posture score.",
    categoryPrefix: "security",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => runSecurityEngineForTenant(tenantId, ctx),
  },
  {
    key: "drift",
    label: "Drift Engine",
    description: "Reduces drift-tagged rules/groups that evaluated true into a driftScore + trendDirection.",
    categoryPrefix: "drift",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateDriftForTenant(tenantId, ctx),
  },
  {
    key: "forecasting",
    label: "Forecasting Engine",
    description: "Sums trendValue * decayFactor across fired signals with a non-zero trend.",
    categoryPrefix: "forecasting",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateForecastForTenant(tenantId, ctx),
  },
  {
    key: "crm",
    label: "CRM Engine",
    description: "Sums the five CRM contribution fields (fit/pain/maturity/intent/urgency) across fired crm:* signals.",
    categoryPrefix: "crm",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateCrmScore(tenantId, ctx),
  },
  {
    key: "msp",
    label: "MSP Portfolio Engine",
    description: "Aggregates health + drift + priority scores per tenant into a portfolio-wide risk roll-up.",
    categoryPrefix: "msp",
    dependsOn: ["health", "drift", "priority"],
    tenantScoped: false,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => calculateMspForTenant(tenantId, ctx),
  },
  {
    key: "sla",
    label: "SLA Engine",
    description: "Tracks SLA timers per customer, detects warnings and breaches, and computes compliance scores across MSP-managed tenants.",
    categoryPrefix: "sla",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runSlaEngineForTenant(tenantId, ctx),
  },
  {
    key: "scope_creep",
    label: "Scope Creep Engine",
    description: "Detects deliverable/requirement/ticket/timeline drift and SOW expansion, scores scope-creep risk, raises violations, escalates with SOW amendment and pricing review recommendations, and tracks monthly compliance.",
    categoryPrefix: "scope_creep",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runScopeCreepEngineForTenant(tenantId, ctx),
  },
  {
    key: "monitoring",
    label: "Monitoring Engine",
    description: "Executes platform-authored Monitor Checks against customer tenants via Graph API, writes tenant_monitor_profile rows, and classifies severity. Output: {results, breakdown: coverage/failures, logs, debug}.",
    categoryPrefix: "monitoring",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (tenantId, ctx) => computeMonitoringEngine(tenantId),
  },
  {
    key: "sales_offer",
    label: "Sales Offer Engine",
    description: "Converts diagnostics findings (fired signals + product catalog) into priced, scored, lifecycle-managed candidate offers via configurable rule groups. Outputs offer candidates ranked by relevance score.",
    categoryPrefix: "sales_offer",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (tenantId, ctx) => runSalesOfferEngineForTenant(tenantId, null, ctx),
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

    const [auditRow] = await db
      .select({ id: signalRuleAuditLogTable.id })
      .from(signalRuleAuditLogTable)
      .orderBy(desc(signalRuleAuditLogTable.id))
      .limit(1);
    const currentRuleVersion = auditRow?.id ?? null;

    const r = result as { score?: number; breakdown?: unknown } | null | undefined;
    const score = typeof r?.score === "number" ? r.score : 0;
    const breakdown = Array.isArray(r?.breakdown) ? r.breakdown : (r?.breakdown ? [r.breakdown] : []);

    const rr = result as { rawSignals?: unknown; firedSignals?: unknown } | null | undefined;
    const rawSignalsSource = Array.isArray(rr?.rawSignals) ? rr.rawSignals : (Array.isArray(rr?.firedSignals) ? rr.firedSignals : []);
    const rawSignals: string[] = rawSignalsSource.filter((s): s is string => typeof s === "string");

    const [prior] = await db
      .select({ score: tenantEngineSnapshotsTable.score, rawSignals: tenantEngineSnapshotsTable.rawSignals })
      .from(tenantEngineSnapshotsTable)
      .where(and(eq(tenantEngineSnapshotsTable.customerId, customerId), eq(tenantEngineSnapshotsTable.engineKey, engineKey)))
      .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
      .limit(1);
    const previousScore = prior?.score ?? null;
    const priorRawSignals: string[] = Array.isArray(prior?.rawSignals) ? prior.rawSignals : [];
    const delta = previousScore != null ? score - previousScore : null;

    const [insertedSnapshot] = await db.insert(tenantEngineSnapshotsTable).values({
      customerId,
      mspId,
      engineKey,
      score,
      previousScore,
      delta,
      breakdown,
      rawSignals,
      runId: randomUUID(),
      ruleVersion: currentRuleVersion,
    }).returning({ id: tenantEngineSnapshotsTable.id });
    const historyId = insertedSnapshot?.id;

    if (historyId != null) {
      const priorSet = new Set(priorRawSignals);
      const currentSet = new Set(rawSignals);
      const newlyFired = rawSignals.filter(s => !priorSet.has(s));
      const newlyResolved = priorRawSignals.filter(s => !currentSet.has(s));
      const deltaRows = [
        ...newlyFired.map(signalKey => ({ historyId, signalKey, direction: "fired" as const })),
        ...newlyResolved.map(signalKey => ({ historyId, signalKey, direction: "resolved" as const })),
      ];
      if (deltaRows.length > 0) {
        await db.insert(engineScoreSignalDeltasTable).values(deltaRows);
      }
    }

    const [priorBaseline] = await db
      .select({ ruleVersion: engineBaselineHistoryTable.ruleVersion, baselineScore: engineBaselineHistoryTable.baselineScore })
      .from(engineBaselineHistoryTable)
      .where(and(eq(engineBaselineHistoryTable.customerId, customerId), eq(engineBaselineHistoryTable.engineKey, engineKey)))
      .orderBy(desc(engineBaselineHistoryTable.createdAt))
      .limit(1);

    if (previousScore == null) {
      await db.insert(engineBaselineHistoryTable).values({
        customerId,
        mspId,
        engineKey,
        baselineScore: score,
        resetTriggerType: "initial",
        resetTriggerRef: null,
        ruleVersion: currentRuleVersion,
      });
    } else if (
      priorBaseline &&
      priorBaseline.ruleVersion !== null &&
      currentRuleVersion !== null &&
      priorBaseline.ruleVersion !== currentRuleVersion
    ) {
      await db.insert(engineBaselineHistoryTable).values({
        customerId,
        mspId,
        engineKey,
        baselineScore: score,
        resetTriggerType: "rule_version_change",
        resetTriggerRef: String(currentRuleVersion),
        ruleVersion: currentRuleVersion,
      });
    }

    if (engineKey === "drift" && priorBaseline && priorBaseline.baselineScore != null && priorBaseline.baselineScore !== 0) {
      try {
        const changePct = ((score - priorBaseline.baselineScore) / priorBaseline.baselineScore) * 100;

        const assignment = await db.execute(sql`
          SELECT policy_id AS "policyId" FROM scope_creep_assignments
          WHERE customer_id = ${customerId} LIMIT 1
        `);
        const policyId = (assignment.rows[0] as { policyId: number } | undefined)?.policyId;

        if (policyId != null) {
          const policy = await db.execute(sql`
            SELECT drift_threshold_pct AS "driftThresholdPct" FROM scope_creep_policies
            WHERE id = ${policyId} LIMIT 1
          `);
          const driftThresholdPct = (policy.rows[0] as { driftThresholdPct: number } | undefined)?.driftThresholdPct;

          if (driftThresholdPct != null && Math.abs(changePct) >= driftThresholdPct) {
            const { recordScopeCreepDetection } = await import("./scope-creep-engine.ts");
            await recordScopeCreepDetection({
              mspId: mspId ?? 0,
              customerId,
              policyId,
              detectionType: "drift",
              ref: `engine_baseline:${engineKey}`,
              baselineValue: priorBaseline.baselineScore,
              currentValue: score,
              changePct,
              idempotencyKey: `drift-baseline:${customerId}:${priorBaseline.baselineScore}`,
            });
          }
        }
      } catch (err) {
        logger.warn({ err, customerId, engineKey }, "writeEngineSnapshot: drift-based scope creep detection failed (non-fatal)");
      }
    }
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

/**
 * Validates ENGINE_DEFS's dependency graph and returns a topological
 * execution order (engines with no unmet dependencies first). Throws if
 * any dependsOn key references a nonexistent engine, or if a cycle exists.
 * This is a synchronous, in-memory check — no DB access, safe to run at
 * server boot before any request is served.
 */
export function validateEngineManifest(): string[] {
  const keys = new Set(ENGINE_DEFS.map(e => e.key));

  for (const def of ENGINE_DEFS) {
    for (const dep of def.dependsOn) {
      if (!keys.has(dep)) {
        throw new Error(`Engine manifest invalid: "${def.key}" depends on unknown engine "${dep}"`);
      }
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const def of ENGINE_DEFS) color.set(def.key, WHITE);

  const order: string[] = [];
  const stack: string[] = [];

  function visit(key: string): void {
    const c = color.get(key);
    if (c === BLACK) return;
    if (c === GRAY) {
      const cycleStart = stack.indexOf(key);
      const cycle = stack.slice(cycleStart).concat(key);
      throw new Error(`Engine manifest invalid: dependency cycle detected: ${cycle.join(" -> ")}`);
    }
    color.set(key, GRAY);
    stack.push(key);
    const def = ENGINE_DEFS.find(e => e.key === key);
    if (def) {
      for (const dep of def.dependsOn) visit(dep);
    }
    stack.pop();
    color.set(key, BLACK);
    order.push(key);
  }

  for (const def of ENGINE_DEFS) visit(def.key);

  return order;
}

/**
 * Runs some or all engines for a tenant, strictly in the order computed by
 * validateEngineManifest() — this is the actual consumer of the manifest's
 * dependency graph, not just a validator. Each engine's own runForTenant is
 * called in turn; a failure in one engine is logged and does not prevent
 * the remaining engines from running. Returns a map of engineKey -> result
 * (or null if that engine failed).
 *
 * If engineKeys is provided, only those engines run (still in manifest
 * order relative to each other) — useful for running a single engine plus
 * whatever it transitively depends on, without running the full set.
 */
export async function runEngineManifestForTenant(
  tenantId: number,
  ctx?: EngineContext,
  engineKeys?: string[],
): Promise<Record<string, unknown>> {
  const order = validateEngineManifest();
  const targetKeys = engineKeys ? order.filter(k => engineKeys.includes(k)) : order;
  const results: Record<string, unknown> = {};

  for (const key of targetKeys) {
    const def = getEngineDef(key);
    if (!def) {
      logger.warn({ engineKey: key, tenantId }, "runEngineManifestForTenant: unknown engine key in manifest order, skipping");
      continue;
    }
    try {
      results[key] = await def.runForTenant(tenantId, ctx);
    } catch (err) {
      logger.warn({ err, engineKey: key, tenantId }, "runEngineManifestForTenant: engine run failed — continuing with remaining engines in manifest order");
      results[key] = null;
    }
  }

  return results;
}

export async function buildEngineTestInputForTenant(tenantId: number): Promise<EngineTestInput> {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(tenantId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return { mergedProfile, parsedFindings: findings, rules, groups, disabledSignalKeys };
}

export { getFiredSignalKeysForTenant, getSignalWeights, getCrmSignalWeights, calculateMspPortfolioRisk };
