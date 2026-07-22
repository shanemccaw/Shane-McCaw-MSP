import {
  db,
  clientM365ProfilesTable,
  scriptRunResultsTable,
  mspCustomersTable,
  mspUsersTable,
  tenantMonitorProfilesTable,
  signalDerivationRulesTable,
  monitorChecksTable,
  type MonitorCheckFrequency,
} from "@workspace/db";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.signals" });
import { startSlaTimer } from "./sla-engine";

/**
 * Flat fallback stabilization window — used for legacy signals that predate
 * the rule engine and have no `signal_derivation_rules` rows (e.g.
 * `hasLicensingWaste`, `copilotLicenseCount`), and as the per-frequency
 * window for "live" sources. See getSignalStabilizationWindowHours for the
 * per-signal, check-frequency-aware window.
 */
const STABILIZATION_WINDOW_HOURS = 4;

/**
 * How long a signal must stay continuously fired before it's trusted, per
 * the frequency of the monitor check(s) it derives from. Longer for slower
 * checks — a signal that only refreshes daily needs ~2 confirmations before
 * a single day's reading can be ruled out as a one-off blip; an hourly
 * signal needs several; a live/near-real-time source is fine with the same
 * flat default used everywhere else.
 */
const STABILIZATION_WINDOW_HOURS_BY_FREQUENCY: Record<MonitorCheckFrequency, number> = {
  live: STABILIZATION_WINDOW_HOURS,
  hourly: 6,
  daily: 48,
};

/** Slowest (most conservative) window among a signal's derivation-rule check frequencies. */
function slowestStabilizationWindowHours(frequencies: MonitorCheckFrequency[]): number {
  if (frequencies.length === 0) return STABILIZATION_WINDOW_HOURS;
  return frequencies.reduce(
    (slowest, frequency) => Math.max(slowest, STABILIZATION_WINDOW_HOURS_BY_FREQUENCY[frequency] ?? STABILIZATION_WINDOW_HOURS),
    STABILIZATION_WINDOW_HOURS_BY_FREQUENCY.live,
  );
}

/**
 * Resolves the stabilization window for a single signal key by joining its
 * `signal_derivation_rules` rows to the `monitor_checks` they derive from
 * (via `sourceKey` → `monitor_checks.key`) and picking the slowest frequency
 * among them. Signals with no rule rows (legacy, pre-rule-engine signals)
 * fall back to the flat STABILIZATION_WINDOW_HOURS default unchanged.
 */
export async function getSignalStabilizationWindowHours(signalKey: string): Promise<number> {
  try {
    const rows = await db
      .select({ frequency: monitorChecksTable.frequency })
      .from(signalDerivationRulesTable)
      .innerJoin(monitorChecksTable, eq(signalDerivationRulesTable.sourceKey, monitorChecksTable.key))
      .where(eq(signalDerivationRulesTable.signalKey, signalKey));
    return slowestStabilizationWindowHours(rows.map(r => r.frequency));
  } catch (err) {
    log.warn({ err, signalKey }, "getSignalStabilizationWindowHours: failed to resolve per-signal window — using flat default");
    return STABILIZATION_WINDOW_HOURS;
  }
}

// ─── Signal enabled/disabled state ────────────────────────────────────────────
//
// Shared lookup used by every computeTenantSignals call site (admin routes,
// workflow-executor, consolidated-sow-generator, portal pricing adjustments)
// so disabled signals are gated consistently everywhere signals are evaluated.
// A missing row means "enabled" — existing signals are unaffected until an
// admin explicitly disables one.
export async function getDisabledSignalKeys(): Promise<Set<string>> {
  const rows = await db.execute(sql`
    SELECT signal_key AS "signalKey" FROM signal_enabled_state WHERE enabled = false
  `);
  return new Set((rows.rows as Array<{ signalKey: string }>).map(r => r.signalKey));
}

/**
 * Resolve the active portal user (`usersTable.id`) for an engine customerId
 * (`mspCustomersTable.id`) via the `msp_users` bridge. Returns null when the
 * customer has no active portal user — a valid state for an unclaimed customer,
 * not an error.
 *
 * This is the single canonical customer→portal-user resolver. It lives here
 * (rather than per-engine) because `buildTenantProfile` needs it to key the
 * two `users.id`-scoped data tables, and every other consumer (e.g. sales-offer
 * notification routing) should resolve the recipient the exact same way.
 */
export async function resolveCustomerPortalUserId(customerId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: mspUsersTable.userId })
    .from(mspUsersTable)
    .where(and(eq(mspUsersTable.customerId, customerId), eq(mspUsersTable.isActive, true)))
    .limit(1);
  return row?.userId ?? null;
}

// ─── Tenant profile builder (single source of truth for signal evaluation) ────
//
// Builds the merged M365 profile + findings list a tenant's signals are
// evaluated against. This is the ONE place that assembles this profile — every
// engine (priority, pricing, drift, forecasting, security, sales_offer, health,
// crm) and the SOW generator call this so they can never drift.
//
// The input is a *customer id* (`mspCustomersTable.id`) — the id every real
// engine caller already carries (runForTenant / admin-engines testbed flow).
//
// Two independent id spaces are in play, and this function bridges them
// explicitly rather than assuming they coincide (the old per-engine copies
// assumed they did, which is what silently zeroed signals in production):
//
//   • tenantId / mspId live on `msp_customers`, keyed by the customer id
//     directly — resolved with one `WHERE id = customerId` lookup.
//   • `client_m365_profiles` and `script_run_results` are keyed by
//     `users.id` (a *portal user* id), NOT the customer id. So we first
//     resolve the customer's active portal user via `msp_users`
//     (`resolveCustomerPortalUserId`) and key those two tables by that id.
//
// A customer with no active portal user (unclaimed) is valid: the profile /
// script-run half simply contributes nothing, but tenant/msp resolution and
// the monitor merge still proceed off the customer id.
export async function buildTenantProfile(customerId: number): Promise<{
  mergedProfile: Record<string, unknown>;
  findings: string[];
  customerId: number;
  mspId: number | null;
  tenantId: string | null;
}> {
  // tenant/msp — keyed directly by the customer id (no user involved).
  const [customerRow] = await db
    .select({ tenantId: mspCustomersTable.tenantId, mspId: mspCustomersTable.mspId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);
  const tenantId = customerRow?.tenantId ?? null;
  const mspId = customerRow?.mspId ?? null;

  // profile + script-run findings — keyed by the customer's active *portal user*
  // id, since both those tables FK to users.id. Null portal user = unclaimed
  // customer: contribute an empty profile/findings rather than error.
  const portalUserId = await resolveCustomerPortalUserId(customerId);

  let mergedProfile: Record<string, unknown> = {};
  let findings: string[] = [];
  if (portalUserId != null) {
    const [profileRow] = await db
      .select({ profile: clientM365ProfilesTable.profile })
      .from(clientM365ProfilesTable)
      .where(eq(clientM365ProfilesTable.clientId, portalUserId))
      .limit(1);

    const scriptRuns = await db
      .select({
        parsedFindings: scriptRunResultsTable.parsedFindings,
        profileUpdates: scriptRunResultsTable.profileUpdates,
      })
      .from(scriptRunResultsTable)
      .where(and(eq(scriptRunResultsTable.customerId, portalUserId), eq(scriptRunResultsTable.status, "completed")))
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(50);

    mergedProfile = { ...((profileRow?.profile as Record<string, unknown> | null) ?? {}) };
    for (const run of [...scriptRuns].reverse()) Object.assign(mergedProfile, run.profileUpdates ?? {});
    findings = [...new Set(scriptRuns.flatMap(r => r.parsedFindings ?? []))];
  } else {
    log.warn(
      { customerId },
      "buildTenantProfile: customer has no active portal user — profile/script-run signals contribute nothing (unclaimed customer)",
    );
  }

  // monitor-derived threshold inputs — keyed by tenantId off the customer row.
  if (tenantId) {
    const monitorRows = await db.selectDistinctOn([tenantMonitorProfilesTable.checkKey], {
      checkKey: tenantMonitorProfilesTable.checkKey,
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
    })
      .from(tenantMonitorProfilesTable)
      .where(eq(tenantMonitorProfilesTable.tenantId, tenantId))
      .orderBy(tenantMonitorProfilesTable.checkKey, desc(tenantMonitorProfilesTable.collectedAt));

    for (const row of monitorRows) {
      const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
      Object.assign(mergedProfile, props);
      mergedProfile[`${row.checkKey}__itemCount`] = props["_itemCount"] ?? 0;
    }
  } else {
    log.warn(
      { customerId },
      "buildTenantProfile: no tenantId on msp_customers row — monitor-derived threshold signals cannot fire for this customer",
    );
  }

  return { mergedProfile, findings, customerId, mspId, tenantId };
}

// ─── Tenant health block vars (used by email templates) ──────────────────────
//
// Single source of truth for turning a client's latest per-category health
// scores into the string vars consumed by the `tenant-health-block` email
// template. Category keys match `clientHealthHistoryTable.category` /
// `ALL_CATEGORY_LABELS` in admin-clients.ts: security, compliance, copilot,
// governance, productivity (used here as "adoption").
export interface TenantHealthVars {
  tenantScore: string;
  tenantScoreBand: string;
  complianceScore: string;
  securityScore: string;
  governanceScore: string;
  adoptionScore: string;
  copilotScore: string;
  tenantHealthIsZero: string;
  tenantHealthIsLow: string;
  tenantHealthIsHigh: string;
}

/**
 * Pure computation — takes the client's latest score per category (as
 * produced by a DB lookup) and returns the vars for the tenant-health-block
 * template. Returns `null` when there is no usable score data at all, so
 * callers can skip rendering the block entirely rather than showing zeros.
 */
export function computeTenantHealthVars(
  categoryScores: Partial<Record<"security" | "compliance" | "copilot" | "governance" | "productivity", number>> | null | undefined,
): TenantHealthVars | null {
  if (!categoryScores) return null;

  const entries = Object.entries(categoryScores).filter(
    (e): e is [string, number] => typeof e[1] === "number" && !isNaN(e[1]),
  );
  if (entries.length === 0) return null;

  const scoreOf = (key: string): number | null => {
    const val = categoryScores[key as keyof typeof categoryScores];
    return typeof val === "number" && !isNaN(val) ? val : null;
  };

  const overall = Math.round(entries.reduce((sum, [, v]) => sum + v, 0) / entries.length);
  const band = overall === 0 ? "zero" : overall < 60 ? "low" : overall >= 80 ? "high" : "medium";

  const fmt = (v: number | null): string => (v === null ? "" : String(v));

  return {
    tenantScore: String(overall),
    tenantScoreBand: band,
    complianceScore: fmt(scoreOf("compliance")),
    securityScore: fmt(scoreOf("security")),
    governanceScore: fmt(scoreOf("governance")),
    adoptionScore: fmt(scoreOf("productivity")),
    copilotScore: fmt(scoreOf("copilot")),
    tenantHealthIsZero: band === "zero" ? "true" : "",
    tenantHealthIsLow: band === "low" ? "true" : "",
    tenantHealthIsHigh: band === "high" ? "true" : "",
  };
}

export interface RecommendedRule {
  ruleType: string;
  sourceKey: string;
  compareValue?: string;
  rationale: string;
}

export interface TenantSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: RecommendedRule[];
  isAdjustment: boolean;
  isBuiltin: boolean;
  sortOrder: number;
  enabled: boolean;
  exampleProfileKey?: string;
  exampleFindingKeyword?: string;
}

// ─── Unified signal catalog (custom_signals) ─────────────────────────────────
//
// The tenant signal catalog — the 13 "built-in" signals (9 project signals +
// 4 adjustment signals, is_builtin = true) AND any admin-created custom signals
// — lives ENTIRELY in the `custom_signals` table. There is no hardcoded array;
// adding, editing, or removing a signal is a data change, not a code deploy.
// The 13 built-ins were seeded by
// lib/db/migrations/manual/2026-07-21-unify-signal-catalog-custom-signals.sql.
//
// `is_builtin` (not membership in any code array) is what blocks deletion of a
// built-in signal — see the DELETE /admin/custom-signals/:key handler.

function parseRecommendedRules(value: unknown): RecommendedRule[] {
  if (Array.isArray(value)) return value as RecommendedRule[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as RecommendedRule[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface CustomSignalRow {
  key: string;
  label: string;
  description: string | null;
  expectedImpact: string | null;
  recommendedRules: unknown;
  isAdjustment: boolean;
  isBuiltin: boolean;
  sortOrder: number;
  enabled: boolean;
  exampleProfileKey: string | null;
  exampleFindingKeyword: string | null;
}

function mapCustomSignalRow(row: CustomSignalRow): TenantSignal {
  return {
    key: row.key,
    label: row.label,
    description: row.description ?? "",
    expectedImpact: row.expectedImpact ?? "",
    recommendedRules: parseRecommendedRules(row.recommendedRules),
    isAdjustment: Boolean(row.isAdjustment),
    isBuiltin: Boolean(row.isBuiltin),
    sortOrder: Number(row.sortOrder ?? 0),
    enabled: row.enabled !== false,
    exampleProfileKey: row.exampleProfileKey ?? undefined,
    exampleFindingKeyword: row.exampleFindingKeyword ?? undefined,
  };
}

/**
 * Canonical loader for the unified signal catalog. Returns EVERY signal —
 * built-in and custom, project and adjustment — ordered project-signals-first
 * then adjustment, each group by sort_order. This is the single source every
 * consumer reads instead of the old hardcoded TENANT_SIGNALS/ADJUSTMENT_SIGNALS
 * arrays.
 */
export async function getAllSignalDefinitions(): Promise<TenantSignal[]> {
  const rows = await db.execute(sql`
    SELECT key, label, description, expected_impact AS "expectedImpact",
           recommended_rules AS "recommendedRules", is_adjustment AS "isAdjustment",
           is_builtin AS "isBuiltin", sort_order AS "sortOrder", enabled,
           example_profile_key AS "exampleProfileKey",
           example_finding_keyword AS "exampleFindingKeyword"
    FROM custom_signals
    ORDER BY is_adjustment ASC, sort_order ASC, created_at ASC
  `);
  return (rows.rows as unknown as CustomSignalRow[]).map(mapCustomSignalRow);
}

/** Project (non-adjustment) signals only — replaces the old TENANT_SIGNALS array. */
export async function getProjectSignalDefinitions(): Promise<TenantSignal[]> {
  return (await getAllSignalDefinitions()).filter(s => !s.isAdjustment);
}

/** Adjustment (adj:*) signals only — replaces the old ADJUSTMENT_SIGNALS array. */
export async function getAdjustmentSignalDefinitions(): Promise<TenantSignal[]> {
  return (await getAllSignalDefinitions()).filter(s => s.isAdjustment);
}

/**
 * Keys of the built-in signals (is_builtin = true). Used by the custom-signal
 * create/delete routes to protect the built-ins from deletion and key collision
 * — replacing the old "is it in the hardcoded array?" membership check.
 */
export async function getBuiltinSignalKeys(): Promise<Set<string>> {
  const rows = await db.execute(sql`SELECT key FROM custom_signals WHERE is_builtin = true`);
  return new Set((rows.rows as Array<{ key: string }>).map(r => r.key));
}

// ─── Signal intelligence fields ────────────────────────────────────────────
//
// See the taxonomy comment near `signalRuleGroupsTable` in
// `lib/db/src/schema/index.ts` for the full `category` prefix list
// (pricing:*, priority:*, governance:*, security:*, compliance:*, adoption:*,
// copilot:*, architecture:*, drift:*, forecasting:*, crm:*, msp:*, workflow:*).
// These fields are pure data — no engine in this codebase reads them yet.
// computeTenantSignals() below does not consume them; they exist so future
// engine tasks (priority/pricing/health/drift/forecasting/CRM) can sum them
// off fired signals without ever hardcoding a formula.
export const SIGNAL_TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export type SignalTrendDirection = typeof SIGNAL_TREND_DIRECTIONS[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORY_PREFIXES = [
  "pricing", "priority", "governance", "security", "compliance", "adoption",
  "copilot", "architecture", "drift", "forecasting", "crm", "msp", "workflow",
] as const;
export type SignalCategoryPrefix = typeof SIGNAL_CATEGORY_PREFIXES[number];

export interface SignalIntelligenceFields {
  priority: number;
  weight: number;
  pricingImpact: number;
  priorityScoreContribution: number;
  pricingValueContribution: number;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  trendValue: number;
  trendDirection: SignalTrendDirection;
  decayRate: number;
  ttlDays: number;
  confidence: number;
  severity: SignalSeverity;
  category: string;
  pillar: string;
  crmFitContribution: number;
  crmPainContribution: number;
  crmMaturityContribution: number;
  crmIntentContribution: number;
  crmUrgencyContribution: number;
}

export interface SignalDerivationRule extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignalRuleGroup extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
  createdAt: Date;
}

/**
 * `decay_rate` is a `numeric(4,3)` column, which the `pg` driver returns as
 * a string. Every raw-SQL fetch site that casts DB rows to
 * `SignalDerivationRule[]`/`SignalRuleGroup[]` must run rows through this so
 * `decayRate` matches its `number` type contract (consumed as a fraction by
 * forecasting-engine.ts / drift-engine.ts's `1 - decayRate` formula).
 */
export function coerceDecayRate<T extends { decayRate?: unknown }>(rows: T[]): T[] {
  for (const row of rows) {
    if (row.decayRate !== undefined) (row as { decayRate: number }).decayRate = Number(row.decayRate);
  }
  return rows;
}

export interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

export function evaluateRule(
  rule: SignalDerivationRule,
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
): { result: boolean; reason: string } {
  const { ruleType, sourceKey, compareValue } = rule;

  switch (ruleType) {
    case "profile_key_truthy": {
      const val = mergedProfile[sourceKey];
      const result = Boolean(val) && val !== 0 && val !== "" && val !== "false";
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} → ${result ? "truthy" : "falsy"}` };
    }
    case "profile_key_falsy": {
      // Only fire when the key is explicitly present in the profile.
      // An absent key means "the script that writes this field hasn't run yet" —
      // not that the feature is unconfigured.  This keeps profile_key_falsy
      // symmetric with profile_key_truthy (which correctly does not fire when
      // the key is missing).
      if (!(sourceKey in mergedProfile)) {
        return { result: false, reason: `profile[${sourceKey}] absent — key not yet written by any script, treating as unknown (not falsy)` };
      }
      const val = mergedProfile[sourceKey];
      const result = !val || val === 0 || val === "" || val === "false" || val === false;
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} → ${result ? "falsy" : "truthy"}` };
    }
    case "profile_key_eq": {
      const val = mergedProfile[sourceKey];
      const result = String(val) === String(compareValue ?? "");
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} ${result ? "==" : "!="} ${compareValue}` };
    }
    case "profile_key_gt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `profile[${sourceKey}] = ${val} ${result ? ">" : "<="} ${threshold}` };
    }
    case "profile_key_lt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val < threshold;
      return { result, reason: `profile[${sourceKey}] = ${val} ${result ? "<" : ">="} ${threshold}` };
    }
    case "threshold": {
      const val = Number(mergedProfile[`${sourceKey}__itemCount`] ?? 0);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `monitor[${sourceKey}].itemCount = ${val} ${result ? ">" : "<="} ${threshold}` };
    }
    case "findings_keyword": {
      const keyword = (sourceKey ?? "").toLowerCase();
      const result = parsedFindings.some(f => f.toLowerCase().includes(keyword));
      return { result, reason: `findings ${result ? "contain" : "do not contain"} keyword "${sourceKey}"` };
    }
    default:
      return { result: false, reason: `unknown ruleType: ${ruleType}` };
  }
}

export function computeTenantSignals(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
  context?: { customerId: number; mspId: number },
): { firedSignals: Set<string>; trace: RuleTraceEntry[] } {
  const trace: RuleTraceEntry[] = [];
  const firedSignals = new Set<string>();
  if (disabledSignalKeys.has("alwaysInclude")) {
    trace.push({
      signalKey: "alwaysInclude",
      groupId: null,
      ruleId: -1,
      result: false,
      reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
    });
  } else {
    firedSignals.add("alwaysInclude");
  }

  const groupMap = new Map<number, SignalRuleGroup>();
  for (const g of groups) groupMap.set(g.id, g);

  const rulesByGroup = new Map<string, SignalDerivationRule[]>();
  const ungroupedRules: SignalDerivationRule[] = [];

  for (const rule of rules) {
    if (rule.groupId === null || rule.groupId === undefined) {
      ungroupedRules.push(rule);
    } else {
      const key = String(rule.groupId);
      if (!rulesByGroup.has(key)) rulesByGroup.set(key, []);
      rulesByGroup.get(key)!.push(rule);
    }
  }

  const signalKeys = [...new Set(rules.map(r => r.signalKey))];

  for (const signalKey of signalKeys) {
    if (disabledSignalKeys.has(signalKey)) {
      trace.push({
        signalKey,
        groupId: null,
        ruleId: -1,
        result: false,
        reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
      });
      continue;
    }

    let signalFired = false;

    const signalGroups = groups.filter(g => g.signalKey === signalKey);
    for (const group of signalGroups) {
      const groupRules = rulesByGroup.get(String(group.id)) ?? [];
      if (groupRules.length === 0) continue;

      let groupResult: boolean;
      if (group.logic === "AND") {
        groupResult = groupRules.every(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      } else {
        groupResult = groupRules.some(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      }

      if (groupResult) {
        signalFired = true;
        break;
      }
    }

    const signalUngrouped = ungroupedRules.filter(r => r.signalKey === signalKey);
    for (const rule of signalUngrouped) {
      const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
      trace.push({ signalKey, groupId: null, ruleId: rule.id, result, reason });
      if (result) {
        signalFired = true;
        break;
      }
    }

    if (signalFired) firedSignals.add(signalKey);
  }

  // ── Fire-and-forget: trigger SLA timers for any "sla:" signals ────────────
  if (context) {
    const slaSignalKeys = [...firedSignals].filter(k => k.startsWith("sla:"));
    if (slaSignalKeys.length > 0) {
      triggerSlaTimersForFiredSignals(context.customerId, context.mspId, slaSignalKeys)
        .catch(err => log.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget SLA timer trigger failed"));
    }
  }

  if (context) {
    recordSignalTransitions(context.customerId, context.mspId, firedSignals)
      .catch(err => log.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget signal transition recording failed"));
  }

  return { firedSignals, trace };
}

// ── SLA timer trigger helper (fire-and-forget, unexported) ──────────────────

async function triggerSlaTimersForFiredSignals(
  customerId: number,
  mspId: number,
  slaSignalKeys: string[],
): Promise<void> {
  for (const signalKey of slaSignalKeys) {
    try {
      const result = await db.execute(sql`
        SELECT policy_id AS "policyId" FROM sla_signal_policy_map
        WHERE signal_key = ${signalKey} AND is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)
        ORDER BY msp_id NULLS LAST LIMIT 1
      `);
      const row = result.rows[0] as { policyId: number } | undefined;
      if (!row) continue;

      const { timerId, alreadyExisted } = await startSlaTimer({
        mspId,
        customerId,
        policyId: row.policyId,
        phase: "resolution",
        ticketType: "signal_compliance",
        idempotencyKey: `sla-signal:${customerId}:${signalKey}`,
      });

      log.info(
        { signalKey, policyId: row.policyId, timerId, alreadyExisted },
        "computeTenantSignals: SLA timer triggered for fired signal",
      );
    } catch (err) {
      log.warn(
        { err, signalKey, customerId, mspId },
        "triggerSlaTimersForFiredSignals: failed to process signal key",
      );
    }
  }
}

async function recordSignalTransitions(
  customerId: number,
  mspId: number,
  firedSignals: Set<string>,
): Promise<void> {
  try {
    // tenant_signal_history.customer_id's live FK constraint actually targets
    // users.id (not mspCustomers.id, despite the column name) — see
    // resolveCustomerPortalUserId's doc comment for the same drift.
    const portalUserId = await resolveCustomerPortalUserId(customerId);
    if (portalUserId === null) {
      log.warn({ customerId, mspId }, "recordSignalTransitions: no active portal user for customer, skipping");
      return;
    }

    const openRows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM tenant_signal_history
      WHERE customer_id = ${portalUserId} AND resolved_at IS NULL
    `);
    const openSignalKeys = new Set((openRows.rows as { signalKey: string }[]).map(r => r.signalKey));

    const newlyFired = [...firedSignals].filter(k => !openSignalKeys.has(k));
    const newlyResolved = [...openSignalKeys].filter(k => !firedSignals.has(k));

    for (const signalKey of newlyFired) {
      try {
        await db.execute(sql`
          INSERT INTO tenant_signal_history (customer_id, msp_id, signal_key, fired_at)
          VALUES (${portalUserId}, ${mspId}, ${signalKey}, NOW())
        `);
      } catch (err) {
        log.warn({ err, customerId, portalUserId, mspId, signalKey }, "recordSignalTransitions: failed to insert newly-fired row");
      }
    }

    for (const signalKey of newlyResolved) {
      try {
        await db.execute(sql`
          UPDATE tenant_signal_history
          SET resolved_at = NOW()
          WHERE customer_id = ${portalUserId} AND signal_key = ${signalKey} AND resolved_at IS NULL
        `);
      } catch (err) {
        log.warn({ err, customerId, portalUserId, mspId, signalKey }, "recordSignalTransitions: failed to resolve row");
      }
    }
  } catch (err) {
    log.warn({ err, customerId, mspId }, "recordSignalTransitions: failed to fetch open signal rows");
  }
}

/**
 * Returns the subset of a customer's currently-fired signals that have
 * been continuously fired for at least their per-signal stabilization
 * window (see getSignalStabilizationWindowHours) — i.e., excludes signals
 * that only just fired and could still be flapping/noise. A signal is
 * "currently fired" if it has an open row (resolved_at IS NULL) in
 * tenant_signal_history; it's "stabilized" if that row's fired_at is old
 * enough for its own window.
 *
 * Windows are resolved in one batched query keyed off the customer's open
 * signal keys (not one query per signal) — this runs per customer inside
 * the Signal Policy Engine's 15-minute sweep (policy-engine.ts), not a
 * per-request hot path, but there's no reason to pay N+1 for it anyway.
 */
export async function getStabilizedSignals(customerId: number): Promise<Set<string>> {
  try {
    const openRows = await db.execute(sql`
      SELECT signal_key AS "signalKey", fired_at AS "firedAt" FROM tenant_signal_history
      WHERE customer_id = ${customerId} AND resolved_at IS NULL
    `);
    const openSignals = openRows.rows as { signalKey: string; firedAt: string }[];
    if (openSignals.length === 0) return new Set();

    const signalKeys = [...new Set(openSignals.map(r => r.signalKey))];
    const ruleRows = await db
      .select({ signalKey: signalDerivationRulesTable.signalKey, frequency: monitorChecksTable.frequency })
      .from(signalDerivationRulesTable)
      .innerJoin(monitorChecksTable, eq(signalDerivationRulesTable.sourceKey, monitorChecksTable.key))
      .where(inArray(signalDerivationRulesTable.signalKey, signalKeys));

    const frequenciesBySignalKey = new Map<string, MonitorCheckFrequency[]>();
    for (const { signalKey, frequency } of ruleRows) {
      const frequencies = frequenciesBySignalKey.get(signalKey) ?? [];
      frequencies.push(frequency);
      frequenciesBySignalKey.set(signalKey, frequencies);
    }

    const now = Date.now();
    const stabilized = new Set<string>();
    for (const { signalKey, firedAt } of openSignals) {
      const windowHours = slowestStabilizationWindowHours(frequenciesBySignalKey.get(signalKey) ?? []);
      if (now - new Date(firedAt).getTime() >= windowHours * 60 * 60 * 1000) {
        stabilized.add(signalKey);
      }
    }
    return stabilized;
  } catch (err) {
    log.warn({ err, customerId }, "getStabilizedSignals: failed to query stabilized signals");
    return new Set();
  }
}

/**
 * Single source of truth for project inclusion logic — used by the SOW generator,
 * dry-run, and preview endpoints so they all agree on the same semantics.
 *
 * Rules (applied in order):
 * 1. No triggeredBy values → EXCLUDED. Every project must declare at least one
 *    canonical signal key. Use "alwaysInclude" for projects that should appear in
 *    every SOW regardless of signals.
 * 2. All triggeredBy values are unrecognized legacy strings (old plan names) →
 *    excluded; migrate to canonical signal keys to re-enable.
 * 3. At least one recognized signal key present → include only if ≥1 of those
 *    recognized keys appears in firedSignals
 */
export function projectMatchesSignals(
  project: { title: string; triggeredBy: string[] },
  knownSignalKeys: Set<string>,
  firedSignals: Set<string>,
): { included: boolean; legacyFallback: boolean; reason?: string } {
  const triggers = Array.isArray(project.triggeredBy) ? project.triggeredBy : [];

  if (triggers.length === 0) {
    return {
      included: false,
      legacyFallback: false,
      reason: "No triggeredBy signal keys — excluded until at least one canonical key is set (use 'alwaysInclude' to always include)",
    };
  }

  const recognizedTriggers = triggers.filter(t => knownSignalKeys.has(t));
  if (recognizedTriggers.length === 0) {
    // All triggeredBy strings are unrecognized (old plan-name style or typos).
    // EXCLUDE deterministically rather than silently including — the SOW
    // should only contain projects whose signal gate has been satisfied.
    // Migrate trigger strings to canonical signal keys to re-enable the project.
    return {
      included: false,
      legacyFallback: false,
      reason: `Unrecognized trigger(s): ${triggers.join(", ")} — excluded until migrated to canonical signal keys`,
    };
  }

  const matched = recognizedTriggers.find(t => firedSignals.has(t));
  if (matched) {
    return { included: true, legacyFallback: false };
  }
  return {
    included: false,
    legacyFallback: false,
    reason: `Requires signal(s): ${recognizedTriggers.join(", ")} — none fired for this tenant`,
  };
}

/**
 * resolveSignalsOverride
 *
 * Pure extraction of the signalsOverride resolution path used by the
 * `generate_document(consolidated_sow)` executor node.
 *
 * When a workflow chains `get_tenant_signals → generate_document`, the
 * generate_document node config carries `signalsOverride: "{{signals}}"`.
 * At runtime the executor interpolates that template against the current
 * payload, producing a JSON-serialised string such as
 * `'["alwaysInclude","hasGovernanceGaps"]'`.  This function handles the
 * parse + fallback steps so they can be tested independently of the DB
 * and Claude dependencies of the executor.
 *
 * Resolution order:
 *  1. Interpolate `field` via `interpFn` → parse as JSON array → return Set
 *  2. Fallback: use `payload.signals` directly when interp doesn't yield a JSON array
 *  3. Return `undefined` when field is empty/absent
 *
 * @param field      The raw template string from `node.data.signalsOverride`
 *                   (e.g. `"{{signals}}"` or a literal JSON array).
 * @param payload    The live workflow payload (contains `signals` from a
 *                   prior `get_tenant_signals` node output).
 * @param interpFn   Template interpolator — matches the executor's `interp`
 *                   signature; in tests pass a simple mock.
 */
export function resolveSignalsOverride(
  field: string | undefined,
  payload: Record<string, unknown>,
  interpFn: (template: string, payload: Record<string, unknown>) => string | undefined,
): Set<string> | undefined {
  const overrideField = field?.trim();
  if (!overrideField) return undefined;
  try {
    const resolved = interpFn(overrideField, payload);
    if (resolved) {
      const parsed = JSON.parse(resolved) as unknown;
      if (Array.isArray(parsed)) return new Set<string>(parsed as string[]);
    }
  } catch { /* not a valid JSON array — fall through to payload.signals */ }
  if (Array.isArray(payload.signals)) return new Set<string>(payload.signals as string[]);
  return undefined;
}
