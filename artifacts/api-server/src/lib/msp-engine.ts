/**
 * msp-engine.ts
 *
 * MSP portfolio-risk roll-up engine. This is the aggregation layer on top of
 * the per-tenant health, drift, and priority engines — it does not recompute
 * any tenant scoring itself. For every active client/tenant it calls:
 *   - calculateArchitectureHealthScore(customerId) from health-engine.ts
 *   - computeDriftEngine(...)                    from drift-engine.ts
 *   - calculatePriorityScore(customerId)            from priority-engine.ts
 * and sums the three resulting `score` fields into that tenant's
 * `combinedScore`. `portfolioRisk` is exactly the sum of every tenant's
 * `combinedScore` across the whole client base — no weighting, no
 * conditional logic, no clamping.
 *
 * Out of scope (see task spec): the health/drift/priority engines
 * themselves, admin UI (MSP console dashboard), workflow nodes, SOW wiring.
 */

import { db, usersTable, mspUsersTable, mspCustomersTable, mspsTable, mspScoreHistoryTable, mspEventStoreTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.msp-admin" });
import {
  computeTenantSignals,
  getDisabledSignalKeys,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "./tenant-signals.ts";
import { computeHealthEngine, type HealthPillarBreakdown } from "./health-engine.ts";
import { computeDriftEngine, type DriftBreakdownEntry } from "./drift-engine.ts";
import {
  fetchSignalRulesAndGroups,
  buildTenantProfileAndFindings,
  rankFiredSignals,
  sumPriorityScore,
  getSignalWeights,
  type EngineBreakdownEntry,
} from "./priority-engine.ts";

// ── Shared engine output contract (mirrors priority-engine.ts / health-engine.ts) ──

export interface TenantEngineScores {
  customerId: number;
  tenantName: string | null;
  architectureHealthScore: number;
  driftScore: number;
  priorityScore: number;
  /** Pure sum of the three scores above — nothing else. */
  combinedScore: number;
  firedSignals: string[];
  /**
   * The per-engine breakdowns that produced the three scores above. Threaded
   * straight through from the underlying health/drift/priority engines (no
   * recomputation) so downstream consumers — e.g. the Simulator Studio
   * Portal Snapshot explain dialog — can show how each score was reached.
   */
  breakdown: {
    health: HealthPillarBreakdown[];
    drift: DriftBreakdownEntry[];
    priority: EngineBreakdownEntry[];
  };
}

export interface MspEngineOutput {
  engine: "msp";
  score: number;
  /** Per-tenant breakdown, in the order tenants were fetched. */
  breakdown: TenantEngineScores[];
  /** Tenants sorted descending by combinedScore. */
  rankedTenants: TenantEngineScores[];
  rawSignals: string[];
  rawRules: SignalDerivationRule[];
  workflowVariables: Record<string, number>;
  timestamp: string;
}

/**
 * Pure core of the engine: given every tenant's already-computed
 * `combinedScore` (from the health/drift/priority engines), sums them into
 * `portfolioRisk` and sorts tenants descending by `combinedScore` into
 * `rankedTenants`. No DB access, no conditionals, no weighting — a plain
 * sum + sort over data the per-tenant engines already produced.
 */
export function aggregatePortfolioRisk(
  tenantScores: TenantEngineScores[],
): { portfolioRisk: number; rankedTenants: TenantEngineScores[] } {
  const portfolioRisk = tenantScores.reduce((sum, t) => sum + t.combinedScore, 0);
  const rankedTenants = [...tenantScores].sort((a, b) => b.combinedScore - a.combinedScore);
  return { portfolioRisk, rankedTenants };
}

/**
 * Pure per-tenant computation: given the tenant's merged profile/findings
 * and the (already-fetched) global signal rule/group configuration, calls
 * each of the three existing engines' pure compute functions directly
 * (never re-implementing their scoring) and sums the three `score` fields
 * into `combinedScore`.
 */
export function computeTenantEngineScores(
  customerId: number,
  tenantName: string | null,
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string>,
  ctx?: { evaluationTimestamp?: Date },
): TenantEngineScores {
  const health = computeHealthEngine(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys, ctx);
  const drift = computeDriftEngine(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys, ctx);

  const { firedSignals } = computeTenantSignals(mergedProfile, parsedFindings, rules, groups, disabledSignalKeys);
  const firedSignalKeys = [...firedSignals];
  const weights = getSignalWeightsFromRulesAndGroups(rules, groups);
  const rankedSignals = rankFiredSignals(firedSignalKeys, weights);
  const { score: priorityScore, breakdown: priorityBreakdown } = sumPriorityScore(rankedSignals);

  const combinedScore = health.score + drift.score + priorityScore;

  log.debug(
    {
      customerId,
      healthScore: health.score,
      driftScore: drift.score,
      priorityScore,
      combinedScore,
      healthPillars: health.breakdown.length,
      driftEntries: drift.breakdown.length,
      priorityEntries: priorityBreakdown.length,
    },
    "computeTenantEngineScores: threaded per-engine breakdowns through roll-up",
  );

  return {
    customerId,
    tenantName,
    architectureHealthScore: health.score,
    driftScore: drift.score,
    priorityScore,
    combinedScore,
    firedSignals: firedSignalKeys,
    breakdown: {
      health: health.breakdown,
      drift: drift.breakdown,
      priority: priorityBreakdown,
    },
  };
}

/**
 * Derives per-signal `priorityScoreContribution` weight configuration from
 * already-fetched rules/groups — the same "max across rows for that signal
 * key" convention `getSignalWeights()` uses in priority-engine.ts, kept
 * local here so this module can batch-fetch rules/groups once for the whole
 * portfolio instead of once per tenant.
 */
function getSignalWeightsFromRulesAndGroups(
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
): { signalKey: string; weight: number; priority: number; priorityScoreContribution: number }[] {
  const bySignal = new Map<string, { signalKey: string; weight: number; priority: number; priorityScoreContribution: number }>();

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

  return [...bySignal.values()];
}

/**
 * Fetches every active client/tenant record managed by a specific MSP.
 * The canonical path is: usersTable -> mspUsersTable -> mspCustomersTable
 */
async function fetchActiveTenants(mspId: number): Promise<{ id: number; name: string | null }[]> {
  return db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .innerJoin(mspUsersTable, eq(usersTable.id, mspUsersTable.userId))
    .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
    .where(
      and(
        eq(usersTable.role, "client"),
        eq(mspCustomersTable.mspId, mspId)
      )
    );
}

/**
 * Fetches every active client/tenant record the platform manages.
 */
async function fetchAllActiveTenantsPlatformWide(): Promise<{ id: number; name: string | null }[]> {
  return db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.role, "client"));
}

/**
 * Calculates the MSP portfolio-risk view: for every active tenant, computes
 * its architecture health, drift, and priority scores (by delegating to the
 * existing engines — never recomputing them), sums them into a per-tenant
 * `combinedScore`, then sums all tenants' combined scores into
 * `portfolioRisk` and ranks tenants descending by risk.
 *
 * The per-tenant engines' pure compute functions (`computeHealthEngine`,
 * `computeDriftEngine`, and the priority-engine's rank/sum helpers) are
 * called directly — the same functions the health/drift/priority engines'
 * own DB-fetching entry points delegate to — so this engine reuses a single
 * batched rules/groups/disabledSignalKeys fetch across the whole portfolio
 * instead of re-fetching per tenant, without duplicating any scoring logic.
 */
export async function calculateMspPortfolioRisk(mspId: number, ctx?: { evaluationTimestamp?: Date }): Promise<MspEngineOutput> {
  const [tenants, { rules, groups }, disabledSignalKeys] = await Promise.all([
    fetchActiveTenants(mspId),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  const tenantScores = await Promise.all(
    tenants.map(async tenant => {
      const { mergedProfile, findings } = await buildTenantProfileAndFindings(tenant.id);
      return computeTenantEngineScores(tenant.id, tenant.name, mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
    }),
  );

  const { portfolioRisk, rankedTenants } = aggregatePortfolioRisk(tenantScores);

  const rawSignals = [...new Set(tenantScores.flatMap(t => t.firedSignals))];

  const workflowVariables: Record<string, number> = {
    portfolioRisk,
    tenantCount: tenantScores.length,
    topRiskTenantId: rankedTenants[0]?.customerId ?? 0,
    topRiskCombinedScore: rankedTenants[0]?.combinedScore ?? 0,
  };

  return {
    engine: "msp",
    score: portfolioRisk,
    breakdown: tenantScores,
    rankedTenants,
    rawSignals,
    rawRules: rules,
    workflowVariables,
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

/**
 * Calculates the MSP portfolio-risk view across the entire platform.
 */
export async function calculatePlatformPortfolioRisk(ctx?: { evaluationTimestamp?: Date }): Promise<MspEngineOutput> {
  const [tenants, { rules, groups }, disabledSignalKeys] = await Promise.all([
    fetchAllActiveTenantsPlatformWide(),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  const tenantScores = await Promise.all(
    tenants.map(async tenant => {
      const { mergedProfile, findings } = await buildTenantProfileAndFindings(tenant.id);
      return computeTenantEngineScores(tenant.id, tenant.name, mergedProfile, findings, rules, groups, disabledSignalKeys, ctx);
    }),
  );

  const { portfolioRisk, rankedTenants } = aggregatePortfolioRisk(tenantScores);

  const rawSignals = [...new Set(tenantScores.flatMap(t => t.firedSignals))];

  const workflowVariables: Record<string, number> = {
    portfolioRisk,
    tenantCount: tenantScores.length,
    topRiskTenantId: rankedTenants[0]?.customerId ?? 0,
    topRiskCombinedScore: rankedTenants[0]?.combinedScore ?? 0,
  };

  return {
    engine: "msp",
    score: portfolioRisk,
    breakdown: tenantScores,
    rankedTenants,
    rawSignals,
    rawRules: rules,
    workflowVariables,
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

/**
 * System workflow node handler: computes calculateMspPortfolioRisk for every active MSP
 * and records the total portfolio risk score into msp_score_history.
 */
export async function handleMspScoreSnapshot(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  void payload;
  const activeMsps = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.status, "active"));

  let mspCount = 0;
  let successCount = 0;

  for (const msp of activeMsps) {
    mspCount++;
    try {
      const output = await calculateMspPortfolioRisk(msp.id);
      await db.insert(mspScoreHistoryTable).values({
        mspId: msp.id,
        score: output.score,
        breakdown: output.breakdown as unknown as Record<string, unknown>[],
        createdAt: new Date(),
      });

      await db.insert(mspEventStoreTable).values({
        eventType: "msp.portfolio_risk.snapshot_created",
        source: "msp-score-snapshot-workflow",
        actor: { id: "system", role: "system", type: "system" },
        meta: { tenant: { mspId: msp.id, customerId: null } },
        payload: {
          mspId: msp.id,
          score: output.score,
        },
        mspId: msp.id,
        ownerType: "platform",
      }).catch((err: unknown) => {
        log.warn({ err, mspId: msp.id }, "handleMspScoreSnapshot: failed to insert canonical event");
      });

      successCount++;
    } catch (err: unknown) {
      // Log the error but continue executing for other MSPs
      log.warn({ err, mspId: msp.id }, "handleMspScoreSnapshot: failed to compute/record risk");
    }
  }

  return { mspCount, successCount };
}
