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
  runForTenant(customerId: number, ctx?: EngineContext): Promise<unknown>;
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

async function calculatePricingImpact(customerId: number, ctx?: EngineContext): Promise<PricingEngineOutput> {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }
  return computePricingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

// ── shared tenant-scoped payload wrapper for drift/forecasting (no lib wrapper exists) ──

async function calculateDriftForTenant(customerId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }
  return computeDriftEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

async function calculateForecastForTenant(customerId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }
  return computeForecastingEngine(mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
}

async function calculateMspForTenant(customerId: number, ctx?: EngineContext) {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  if (fetchedCustomerId != null && mspId != null) {
    computeTenantSignals(mergedProfile, findings, rules, groups, disabledSignalKeys, { customerId: fetchedCustomerId, mspId });
  }
  return computeTenantEngineScores(customerId, null, mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
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
    runForTenant: (customerId, ctx) => calculatePriorityScore(customerId, ctx),
  },
  {
    key: "pricing",
    label: "Pricing Engine",
    description: "Sums pricingImpact / pricingValueContribution across currently-fired, enabled signals.",
    categoryPrefix: "pricing",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculatePricingImpact(customerId, ctx),
  },
  {
    key: "health",
    label: "Architecture Health Engine",
    description: "Sums governance/compliance/adoption/copilot/architecture/licensing impact into an overall health score (security is computed by the standalone Security Engine and combined into the total).",
    categoryPrefix: "governance",
    dependsOn: ["security"],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculateArchitectureHealthScore(customerId, ctx),
  },
  {
    key: "security",
    label: "Security Engine",
    description: "Sums securityImpact across currently-fired, enabled signals into a standalone security posture score.",
    categoryPrefix: "security",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => runSecurityEngineForTenant(customerId, ctx),
  },
  {
    key: "drift",
    label: "Drift Engine",
    description: "Reduces drift-tagged rules/groups that evaluated true into a driftScore + trendDirection.",
    categoryPrefix: "drift",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculateDriftForTenant(customerId, ctx),
  },
  {
    key: "forecasting",
    label: "Forecasting Engine",
    description: "Sums trendValue * decayFactor across fired signals with a non-zero trend.",
    categoryPrefix: "forecasting",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculateForecastForTenant(customerId, ctx),
  },
  {
    key: "crm",
    label: "CRM Engine",
    description: "Sums the five CRM contribution fields (fit/pain/maturity/intent/urgency) across fired crm:* signals.",
    categoryPrefix: "crm",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculateCrmScore(customerId, ctx),
  },
  {
    key: "msp",
    label: "MSP Portfolio Engine",
    description: "Aggregates health + drift + priority scores per tenant into a portfolio-wide risk roll-up.",
    categoryPrefix: "msp",
    dependsOn: ["health", "drift", "priority"],
    tenantScoped: false,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => calculateMspForTenant(customerId, ctx),
  },
  {
    key: "sla",
    label: "SLA Engine",
    description: "Tracks SLA timers per customer, detects warnings and breaches, and computes compliance scores across MSP-managed tenants.",
    categoryPrefix: "sla",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (customerId, ctx) => runSlaEngineForTenant(customerId, ctx),
  },
  {
    key: "scope_creep",
    label: "Scope Creep Engine",
    description: "Detects deliverable/requirement/ticket/timeline drift and SOW expansion, scores scope-creep risk, raises violations, escalates with SOW amendment and pricing review recommendations, and tracks monthly compliance.",
    categoryPrefix: "scope_creep",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (customerId, ctx) => runScopeCreepEngineForTenant(customerId, ctx),
  },
  {
    key: "monitoring",
    label: "Monitoring Engine",
    description: "Executes platform-authored Monitor Checks against customer tenants via Graph API, writes tenant_monitor_profile rows, and classifies severity. Output: {results, breakdown: coverage/failures, logs, debug}.",
    categoryPrefix: "monitoring",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "platform",
    runForTenant: (customerId, ctx) => computeMonitoringEngine(customerId),
  },
  {
    key: "sales_offer",
    label: "Sales Offer Engine",
    description: "Converts diagnostics findings (fired signals + product catalog) into priced, scored, lifecycle-managed candidate offers via configurable rule groups. Outputs offer candidates ranked by relevance score.",
    categoryPrefix: "sales_offer",
    dependsOn: [],
    tenantScoped: true,
    ruleOwnership: "msp",
    runForTenant: (customerId, ctx) => runSalesOfferEngineForTenant(customerId, null, ctx),
  },
];

async function writeEngineSnapshot(
  engineKey: string,
  customerId: number,
  result: unknown,
): Promise<void> {
  try {
    const [customerRow] = await db
      .select({ customerId: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
      .from(mspUsersTable)
      .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
      .where(eq(mspUsersTable.userId, customerId))
      .limit(1);
    const resolvedCustomerId = customerRow?.customerId ?? null;
    const mspId = customerRow?.mspId ?? null;
    if (resolvedCustomerId == null) return;

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
      .where(and(eq(tenantEngineSnapshotsTable.customerId, resolvedCustomerId), eq(tenantEngineSnapshotsTable.engineKey, engineKey)))
      .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
      .limit(1);
    const previousScore = prior?.score ?? null;
    const priorRawSignals: string[] = Array.isArray(prior?.rawSignals) ? prior.rawSignals : [];
    const delta = previousScore != null ? score - previousScore : null;

    const [insertedSnapshot] = await db.insert(tenantEngineSnapshotsTable).values({
      customerId: resolvedCustomerId,
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
      .where(and(eq(engineBaselineHistoryTable.customerId, resolvedCustomerId), eq(engineBaselineHistoryTable.engineKey, engineKey)))
      .orderBy(desc(engineBaselineHistoryTable.createdAt))
      .limit(1);

    if (previousScore == null) {
      await db.insert(engineBaselineHistoryTable).values({
        customerId: resolvedCustomerId,
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
        customerId: resolvedCustomerId,
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
          WHERE customer_id = ${resolvedCustomerId} LIMIT 1
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
              customerId: resolvedCustomerId,
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
    logger.warn({ err, engineKey, customerId }, "writeEngineSnapshot: failed to record snapshot (non-fatal)");
  }
}

for (const def of ENGINE_DEFS) {
  const originalRunForTenant = def.runForTenant.bind(def);
  def.runForTenant = async (customerId: number, ctx?: EngineContext) => {
    const result = await originalRunForTenant(customerId, ctx);
    void writeEngineSnapshot(def.key, customerId, result);

    let trace: any[] = [];
    let rawInput: any = {};
    if (customerId > 0) {
      try {
        const testInput = await buildEngineTestInputForTenant(customerId);
        if (testInput) {
          rawInput = testInput.mergedProfile;
          const { trace: signalTrace } = computeTenantSignals(
            testInput.mergedProfile,
            testInput.parsedFindings,
            testInput.rules,
            testInput.groups,
            testInput.disabledSignalKeys
          );
          trace = signalTrace.map(t => ({
            ruleId: `${t.signalKey}${t.groupId ? ` (Group ${t.groupId})` : ""}${t.ruleId ? ` [Rule #${t.ruleId}]` : ""}`,
            outcome: t.result ? "FIRED" : "RESOLVED/SKIPPED",
            reasoning: t.reason,
          }));
        }
      } catch (err) {
        logger.warn({ err, customerId, engineKey: def.key }, "def.runForTenant wrapper: failed to generate signal trace");
      }
    }

    let scoreVal = 0;
    if (result && typeof result === "object") {
      if ("score" in result) {
        if (typeof (result as any).score === "number") {
          scoreVal = (result as any).score;
        } else if (typeof (result as any).score === "object" && (result as any).score !== null && "totalPricingImpact" in (result as any).score) {
          scoreVal = (result as any).score.totalPricingImpact;
        }
      }
    }

    let display = {
      title: def.label,
      status: "INFO",
      impact: "No active signals detected.",
      recommendation: "Review configuration baseline.",
    };

    switch (def.key) {
      case "priority": {
        const count = (result as any)?.breakdown?.length ?? 0;
        display = {
          title: "Priority Engine",
          status: scoreVal > 70 ? "CRITICAL_ATTENTION" : (scoreVal > 30 ? "WARNING" : "STABLE"),
          impact: `Active priority score at ${scoreVal} across ${count} signals.`,
          recommendation: count > 0 ? `Review top priority signals: ${(result as any)?.breakdown?.[0]?.signalKey || "none"}` : "No action required.",
        };
        break;
      }
      case "pricing": {
        const pricingImpact = (result as any)?.score?.totalPricingImpact ?? 0;
        const valueContribution = (result as any)?.score?.totalPricingValueContribution ?? 0;
        display = {
          title: "Pricing Engine",
          status: pricingImpact > 1000 ? "HIGH_REVENUE_IMPACT" : "OPTIMIZED",
          impact: `Pricing Impact: $${pricingImpact}. Value Contribution: $${valueContribution}.`,
          recommendation: "Optimize client scope and adjustments to capture potential revenue.",
        };
        break;
      }
      case "health": {
        display = {
          title: "Architecture Health",
          status: scoreVal < 60 ? "CRITICAL_RISK" : (scoreVal < 85 ? "NEEDS_ATTENTION" : "HEALTHY"),
          impact: `Tenant overall health index evaluated at ${scoreVal}%.`,
          recommendation: "Remediate open governance and licensing configuration items.",
        };
        break;
      }
      case "security": {
        display = {
          title: "Security Posture",
          status: scoreVal > 75 ? "CRITICAL_RISK" : (scoreVal > 30 ? "WARN" : "SECURE"),
          impact: `Security posture risk score of ${scoreVal} based on active vulnerability indicators.`,
          recommendation: "Enforce MFA and deploy Conditional Access baseline rules.",
        };
        break;
      }
      case "drift": {
        const trend = (result as any)?.trendDirection ?? "flat";
        display = {
          title: "Configuration Drift",
          status: scoreVal > 30 ? "DRIFT_DETECTED" : "STABLE",
          impact: `Configuration drift score is ${scoreVal} with a ${trend} trend.`,
          recommendation: "Sync tenant baseline configurations with the global MSP profile.",
        };
        break;
      }
      case "forecasting": {
        display = {
          title: "Forecasting Engine",
          status: scoreVal > 50 ? "ACCELERATING" : "STABLE",
          impact: `Forecasted metric trend score is ${scoreVal}.`,
          recommendation: "Resource allocation review recommended for upcoming period.",
        };
        break;
      }
      case "crm": {
        display = {
          title: "CRM Intent & Pain Score",
          status: "PROSPECT_ENGAGEMENT",
          impact: "Telemetry signals identify target buying and pain indicators.",
          recommendation: "Initiate outreach with tailored product upgrade offer packages.",
        };
        break;
      }
      case "msp": {
        display = {
          title: "MSP Portfolio Engine",
          status: "PORTFOLIO_SUMMARY",
          impact: "Aggregated portfolio health, drift, and risk metrics compiled.",
          recommendation: "Audit tenant level dashboards for specific anomalies.",
        };
        break;
      }
      case "sla": {
        display = {
          title: "SLA Compliance",
          status: "SLA_BREACH_RISK",
          impact: "Active SLA timer warnings detected for tenant workflows.",
          recommendation: "Prioritize overdue and high-impact support tickets.",
        };
        break;
      }
      case "scope_creep": {
        display = {
          title: "Scope Creep Engine",
          status: "SCOPE_EXPANSION",
          impact: "Unbilled work patterns detected exceeding the SOW baseline.",
          recommendation: "Initiate SOW amendment workflow and pricing adjustment.",
        };
        break;
      }
      case "monitoring": {
        display = {
          title: "Monitoring Engine",
          status: "MONITORING_ACTIVE",
          impact: "Telemetry monitors executed.",
          recommendation: "Review failed checks in monitoring tab.",
        };
        break;
      }
      case "sales_offer": {
        display = {
          title: "Sales Offer Engine",
          status: "OFFER_GENERATION",
          impact: "Diagnostic findings converted to offer candidates.",
          recommendation: "Finalize MSP billing consent and present checkout options.",
        };
        break;
      }
    }

    const wrappedResult = {
      ...(typeof result === "object" && result !== null ? result : {}),
      rawInput,
      trace,
      display,
      raw: result,
    };

    return wrappedResult;
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
  customerId: number,
  ctx?: EngineContext,
  engineKeys?: string[],
): Promise<Record<string, unknown>> {
  const order = validateEngineManifest();
  const targetKeys = engineKeys ? order.filter(k => engineKeys.includes(k)) : order;
  const results: Record<string, unknown> = {};

  for (const key of targetKeys) {
    const def = getEngineDef(key);
    if (!def) {
      logger.warn({ engineKey: key, customerId }, "runEngineManifestForTenant: unknown engine key in manifest order, skipping");
      continue;
    }
    try {
      results[key] = await def.runForTenant(customerId, ctx);
    } catch (err) {
      logger.warn({ err, engineKey: key, customerId }, "runEngineManifestForTenant: engine run failed — continuing with remaining engines in manifest order");
      results[key] = null;
    }
  }

  return results;
}

export async function buildEngineTestInputForTenant(customerId: number): Promise<EngineTestInput> {
  const [{ mergedProfile, findings }, { rules, groups }, disabledSignalKeys] = await Promise.all([
    buildTenantProfileAndFindings(customerId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);
  return { mergedProfile, parsedFindings: findings, rules, groups, disabledSignalKeys };
}

export { getFiredSignalKeysForTenant, getSignalWeights, getCrmSignalWeights, calculateMspPortfolioRisk };
