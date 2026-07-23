/**
 * dashboard-resolvers.ts
 *
 * Phase 7 of the Dashboard / Web Part System — the resolver layer that turns a
 * `MetricDef` (declared in `@workspace/dashboard-registry`) into REAL data,
 * shaped according to the metric's `shape`.
 *
 * ── Core correctness principle ────────────────────────────────────────────────
 * A metric NEVER silently resolves to a fabricated value. Every resolver returns
 * a `MetricResult` discriminated union:
 *   - { status: "ok", ... }             — real data was fetched
 *   - { status: "not_available", ... }  — no source exists / no data collected yet
 *   - { status: "error", ... }          — the resolver threw (isolated per-metric)
 * A real zero (e.g. "0 non-compliant devices") is `status: "ok"` with `value: 0`
 * and `meta.zeroRows` set — it is deliberately distinguishable from "no data".
 *
 * ── The three sourceTypes ─────────────────────────────────────────────────────
 *   engine_snapshot  — tenant_engine_snapshots (via getRecentEngineSnapshots),
 *                      plus health-pillar breakdown extraction, plus live SLA /
 *                      scope-creep engine calls (their snapshots are lossy — see
 *                      resolveEngineSnapshot).
 *   monitor_profile  — tenant_monitor_profiles, keyed by TEXT tenantId (resolved
 *                      from the integer customerId via msp_customers.tenant_id).
 *                      Values live inside the extractedProperties jsonb; the
 *                      concrete field name is runtime data in monitor_checks.mapping,
 *                      so we look that up and fall back to the schema-stable
 *                      `_itemCount` auto-key.
 *   platform_table   — assorted platform/business tables. Several registry
 *                      sourceKeys don't match the real schema (documented inline);
 *                      those resolve to not_available rather than guessing.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 * There is no customer picker. Scope is derived from the request:
 *   scope:"customer" — a single customerId (int, msp_customers.id). For a
 *                      CustomerUser this is their own; for an MSPOperator it is an
 *                      explicit, ownership-verified customerId (checked upstream in
 *                      the route via assertCustomerAccess).
 *   scope:"msp"      — aggregate across every customer of req.user.mspId.
 *
 * ── MSP aggregation rules (scope:"msp") ───────────────────────────────────────
 * "How do you aggregate X across N tenants" has more than one defensible answer,
 * so each metric type documents its choice at the call site. The house rules are:
 *   - counts / currency  → SUM across tenants
 *   - scores / percents  → AVERAGE across tenants that have a value
 *   - point-in-time flags → MOST-RECENT wins
 * Platform-native MSP metrics (financial, ai, workflow-run, alert-rule) are
 * already MSP-scoped in their own tables and need no per-tenant fan-out.
 *
 * ── History (Step 5, Smart widget state) ──────────────────────────────────────
 * The Smart renderer needs recent history (for the remediation sparkline + the
 * stateless hysteresis lookback), not just a metric's current value.
 * `resolveMetricHistory` serves that as a `{ t, value }[]` series (oldest→newest)
 * for the two source types that can produce a per-point scalar over time:
 *   engine_snapshot  — reuses getRecentEngineSnapshots(N).
 *   monitor_profile  — reuses monitorHistoryForTenant(N), the last-N variant of
 *                      the single-latest-row scalar path (same mapping lookup).
 * It is only meaningful for customer-scope smart-eligible scalar metrics; every
 * other combination returns null and the route simply omits `history` for that
 * key. This is additive: a request that doesn't ask for history (the default)
 * never triggers any of this and its response is byte-for-byte unchanged.
 */

import { db } from "@workspace/db";
import {
  mspCustomersTable,
  tenantMonitorProfilesTable,
  monitorChecksTable,
  mspAlertEventsTable,
  mspAlertRulesTable,
  clientHealthHistoryTable,
  engineScoreDailyRollupTable,
  projectsTable,
  kanbanTasksTable,
  mspChargesTable,
  invoicesTable,
  salesOffersTable,
  salesOfferEventsTable,
  servicesTable,
  mspSalesBundleAssignmentsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  aiUsageEventsTable,
  aiBalanceLedgerTable,
  portalWfRunsTable,
  portalWfOperatorTasksTable,
  mspJobQueueTable,
  industryBenchmarkReferenceTable,
  tenantEngineSnapshotsTable,
} from "@workspace/db";
import { and, eq, desc, gte, inArray, sql, count } from "drizzle-orm";
import type { MetricDef, MetricShape, MetricScope, MetricValueType } from "@workspace/dashboard-registry";
import { getMetric } from "@workspace/dashboard-registry";
import { getRecentEngineSnapshots } from "./tenant-engine-snapshots.ts";
import { runSlaEngineForTenant } from "./sla-engine.ts";
import { runScopeCreepEngineForTenant } from "./scope-creep-engine.ts";
import { logger } from "./logger.ts";
import { computeSkuCostBreakdown, centsToDollars } from "./cost-engine.ts";
import { evaluateDocGateCoverage } from "./doc-gate-coverage";

const log = logger.child({ channel: "engine.dashboard" });

// ── Result types ──────────────────────────────────────────────────────────────

export type MetricResultStatus = "ok" | "not_available" | "error";

export interface MetricResultBase {
  metricKey: string;
  status: MetricResultStatus;
}

export interface MetricResultOk extends MetricResultBase {
  status: "ok";
  shape: MetricShape;
  valueType: MetricValueType;
  scope: MetricScope;
  /**
   * Shape-dependent payload:
   *   scalar        → { value: number | string | null }
   *   trend         → { series: { t: string; value: number }[] }
   *   distribution  → { buckets: { label: string; value: number }[] }
   *   heatmap       → { cells: { x: number | string; y: number | string; value: number }[] }
   *   timeline      → { events: { t: string; label: string; [k: string]: unknown }[] }
   * A percentage metric with a denominatorMetric also carries `percentage`.
   */
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /**
   * Recent `{ t, value }[]` history (oldest→newest), present ONLY when the
   * request opted this metric into `includeHistory` AND a history series exists
   * (see resolveMetricHistory). Feeds the Smart renderer's sparkline + the
   * stateless hysteresis lookback. Absent on every non-opted-in request, so the
   * default response shape is unchanged.
   */
  history?: { t: string; value: number }[];
}

export interface MetricResultNotAvailable extends MetricResultBase {
  status: "not_available";
  /** Machine-stable reason code + human note. */
  reason: string;
  detail?: string;
}

export interface MetricResultError extends MetricResultBase {
  status: "error";
  error: string;
}

export type MetricResult = MetricResultOk | MetricResultNotAvailable | MetricResultError;

// ── Scope context ─────────────────────────────────────────────────────────────

export interface ResolveContext {
  /** Resolved integer customer id (msp_customers.id). Present for customer-scope requests. */
  customerId?: number;
  /** The caller's MSP. Always present. */
  mspId: number;
  /** How many days of history trend/heatmap/timeline metrics look back. */
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 30;

// ── Small helpers ─────────────────────────────────────────────────────────────

function ok(
  def: MetricDef,
  data: Record<string, unknown>,
  meta?: Record<string, unknown>,
): MetricResultOk {
  return {
    metricKey: def.key,
    status: "ok",
    shape: def.shape,
    valueType: def.valueType,
    scope: def.scope,
    data,
    ...(meta ? { meta } : {}),
  };
}

function notAvailable(def: MetricDef, reason: string, detail?: string): MetricResultNotAvailable {
  return { metricKey: def.key, status: "not_available", reason, ...(detail ? { detail } : {}) };
}

/** scalar convenience */
function scalar(def: MetricDef, value: number | string | null, meta?: Record<string, unknown>): MetricResultOk {
  return ok(def, { value }, { ...(meta ?? {}), ...(value === 0 ? { zeroRows: true } : {}) });
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Resolve integer customerId → text M365 tenantId. Null when the customer has no tenant_id. */
async function resolveTenantId(customerId: number): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);
  // NB: do NOT fall back to String(customerId) — tenant_monitor_profiles is keyed
  // by the real GUID; a fabricated key silently returns zero rows and would look
  // like a legitimately-empty tenant.
  return row?.tenantId ?? null;
}

/** All active customer ids for an MSP — the fan-out set for scope:"msp" per-tenant aggregation. */
async function mspCustomerIds(mspId: number): Promise<number[]> {
  const rows = await db
    .select({ id: mspCustomersTable.id })
    .from(mspCustomersTable)
    .where(and(eq(mspCustomersTable.mspId, mspId), eq(mspCustomersTable.status, "active")));
  return rows.map((r) => r.id);
}

function windowStart(ctx: ResolveContext): Date {
  const days = ctx.windowDays ?? DEFAULT_WINDOW_DAYS;
  // Fixed-offset from now; callers pass this into gte() filters.
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// =============================================================================
// engine_snapshot resolvers
// =============================================================================

/** Engine keys that are written as real snapshot rows (see engine-registry.ts wrapper). */
const SNAPSHOT_ENGINE_KEYS = new Set([
  "priority", "pricing", "health", "security", "drift",
  "forecasting", "crm", "msp", "sla", "scope_creep", "monitoring", "sales_offer",
]);

/**
 * Pillars that are NOT their own snapshot rows — they live inside the latest
 * `health` snapshot's breakdown array as { pillar, score, contributions }.
 */
const HEALTH_PILLARS = new Set(["governance", "compliance", "adoption", "copilot", "architecture", "licensing"]);

async function latestHealthPillarScore(customerId: number, pillar: string): Promise<number | null> {
  const [snap] = await getRecentEngineSnapshots(customerId, "health", 1);
  if (!snap) return null;
  const breakdown = Array.isArray(snap.breakdown) ? (snap.breakdown as Record<string, unknown>[]) : [];
  const entry = breakdown.find((b) => b && typeof b === "object" && (b as { pillar?: string }).pillar === pillar);
  return entry ? toNumber((entry as { score?: unknown }).score) : null;
}

async function resolveEngineSnapshot(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) {
    // Every engine_snapshot metric in the registry is scope:"customer".
    return notAvailable(def, "missing_customer_scope", "engine_snapshot metrics require a customer context");
  }
  const customerId = ctx.customerId;
  const key = def.sourceKey;

  // ── SLA / scope-creep: snapshots are lossy, so compute live. ──
  // sla snapshot persists only the composite `score` (not compliancePct/activeBreaches);
  // scope_creep snapshot persists score=0 always (its engine score is an object, and
  // writeEngineSnapshot coerces non-number scores to 0). So we call the engines directly.
  if (key === "sla") {
    const out = await runSlaEngineForTenant(customerId);
    if (def.key === "sla.compliancePercent") return scalar(def, out.compliancePct, { unit: "percent" });
    if (def.key === "sla.activeBreachCount") return scalar(def, out.activeBreaches);
    return scalar(def, out.score);
  }
  if (key === "scope-creep" || key === "scope_creep") {
    const out = await runScopeCreepEngineForTenant(customerId);
    // sla.scopeCreepStatus has no direct backing field. Derive a categorical status
    // from the composite score + open violations (documented judgment call):
    //   open violations > 0        → "action_required"
    //   composite >= 50            → "attention_needed"
    //   otherwise                  → "on_track"
    const s = out.score;
    const status =
      s.openViolations > 0 ? "action_required" : s.compositeScore >= 50 ? "attention_needed" : "on_track";
    return scalar(def, status, { compositeScore: s.compositeScore, openViolations: s.openViolations, derived: true });
  }

  // ── Pillar sub-scores that live inside the health breakdown. ──
  if (HEALTH_PILLARS.has(key)) {
    const v = await latestHealthPillarScore(customerId, key);
    return v == null
      ? notAvailable(def, "no_snapshot", `no health snapshot / pillar "${key}" not present`)
      : scalar(def, v, { source: "health.breakdown.pillar" });
  }

  // ── msp-intelligence: no backing data. The `msp` snapshot stores score=0 and the
  //    TenantEngineScores output carries no per-pillar governance/etc. ──
  if (key === "msp-intelligence") {
    return notAvailable(
      def,
      "no_source",
      "msp-intelligence has no persisted score (msp snapshot stores score=0; no per-pillar output)",
    );
  }

  // ── Pillar snapshot (distribution over the latest health pillars). ──
  if (def.key === "engine.pillarSnapshot") {
    const [snap] = await getRecentEngineSnapshots(customerId, "health", 1);
    if (!snap) return notAvailable(def, "no_snapshot", "no health snapshot");
    const breakdown = Array.isArray(snap.breakdown) ? (snap.breakdown as Record<string, unknown>[]) : [];
    const buckets = breakdown
      .map((b) => ({ label: String((b as { pillar?: unknown }).pillar ?? "unknown"), value: toNumber((b as { score?: unknown }).score) ?? 0 }))
      .filter((b) => b.label !== "unknown");
    if (buckets.length === 0) return notAvailable(def, "empty_snapshot", "health snapshot has no pillar breakdown");
    return ok(def, { buckets }, { capturedAt: snap.capturedAt });
  }

  // ── Score trend (a real engine's score over the window). ──
  if (def.key === "engine.scoreTrend") {
    // Trend across ALL engines is ambiguous; default to the `health` engine's score
    // history as the headline trend (documented choice).
    const snaps = await getRecentEngineSnapshots(customerId, "health", 60);
    if (snaps.length === 0) return notAvailable(def, "no_snapshot", "no health snapshots");
    const series = snaps
      .slice()
      .reverse()
      .map((s) => ({ t: s.capturedAt.toISOString(), value: s.score ?? 0 }));
    return ok(def, { series }, { engineKey: "health" });
  }

  // ── Straightforward single-engine score. ──
  if (SNAPSHOT_ENGINE_KEYS.has(key)) {
    const [snap] = await getRecentEngineSnapshots(customerId, key, 1);
    if (!snap) return notAvailable(def, "no_snapshot", `no snapshot for engine "${key}"`);
    return scalar(def, snap.score ?? 0, { capturedAt: snap.capturedAt });
  }

  return notAvailable(def, "unknown_engine_key", `sourceKey "${key}" is not a known engine snapshot key`);
}

// =============================================================================
// monitor_profile resolvers
// =============================================================================

/**
 * Cache of checkKey → mapping targetField[] for the current batch. The concrete
 * field name a check writes into extractedProperties is runtime data in
 * monitor_checks.mapping; we look it up once per batch.
 */
type CheckMapping = { targetFields: string[] };

async function loadCheckMapping(checkKey: string): Promise<CheckMapping | null> {
  const [row] = await db
    .select({ mapping: monitorChecksTable.mapping })
    .from(monitorChecksTable)
    .where(eq(monitorChecksTable.key, checkKey))
    .limit(1);
  if (!row) return null;
  const mapping = Array.isArray(row.mapping) ? (row.mapping as Array<{ targetField?: string }>) : [];
  const targetFields = mapping.map((m) => m?.targetField).filter((f): f is string => typeof f === "string");
  return { targetFields };
}

/** Fetch the latest extractedProperties for a single check on a tenant. Exported for reuse by cio-narrative-generator.ts (real license-waste cost data). */
export async function latestCheckProps(
  tenantId: string,
  checkKey: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
      rawResponse: tenantMonitorProfilesTable.rawResponse,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
      status: tenantMonitorProfilesTable.status,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, tenantId),
        eq(tenantMonitorProfilesTable.checkKey, checkKey),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
    .limit(1);
  if (!row) return null;
  const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
  // Attach rawResponse + collectedAt under reserved keys so aggregation transforms
  // that need the raw page (secure-score controls, sign-in heatmap) can reach it.
  return { ...props, __rawResponse: row.rawResponse, __collectedAt: row.collectedAt, __status: row.status };
}

/**
 * Pull the canonical numeric value for a check out of its extractedProperties.
 * Preference order: the check's mapped targetField (if it holds a number) →
 * the schema-stable `_itemCount` auto-key. This mirrors priority-engine.ts,
 * which treats `_itemCount` as the per-check value.
 */
function checkNumericValue(props: Record<string, unknown>, mapping: CheckMapping | null): number | null {
  if (mapping) {
    for (const field of mapping.targetFields) {
      const n = toNumber(props[field]);
      if (n != null) return n;
    }
  }
  const itemCount = toNumber(props["_itemCount"]);
  return itemCount;
}

/** Resolve a single tenant's numeric value for a check (or null if no data). */
async function monitorScalarForTenant(tenantId: string, checkKey: string): Promise<number | null> {
  const props = await latestCheckProps(tenantId, checkKey);
  if (!props) return null;
  const mapping = await loadCheckMapping(checkKey);
  return checkNumericValue(props, mapping);
}

/**
 * Fetch the last N (tenantId, checkKey) rows by collectedAt and reduce each to
 * its canonical numeric value — the history variant of monitorScalarForTenant.
 * Reuses the same mapping-lookup + checkNumericValue path per row so a history
 * point means exactly what the single-value scalar means. Returned oldest→newest
 * so it plugs straight into a sparkline; rows with no numeric value are dropped.
 */
async function monitorHistoryForTenant(
  tenantId: string,
  checkKey: string,
  limit: number,
  since: Date,
): Promise<{ t: string; value: number }[]> {
  const rows = await db
    .select({
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, tenantId),
        eq(tenantMonitorProfilesTable.checkKey, checkKey),
        gte(tenantMonitorProfilesTable.collectedAt, since),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
    .limit(limit);
  if (rows.length === 0) return [];
  // One mapping lookup for the whole check (mapping is per-check, not per-row).
  const mapping = await loadCheckMapping(checkKey);
  const points: { t: string; value: number }[] = [];
  // rows come newest→oldest; walk in reverse to emit oldest→newest.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
    const value = checkNumericValue(props, mapping);
    if (value == null || row.collectedAt == null) continue;
    points.push({ t: row.collectedAt.toISOString(), value });
  }
  return points;
}

async function resolveMonitorProfile(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // not_collected sentinel sourceKeys never have data.
  if (def.status === "not_collected" || def.sourceKey.startsWith("not_collected:")) {
    return notAvailable(def, "not_collected", `${def.sourceKey} is not collected yet`);
  }

  if (def.scope === "msp") {
    return resolveMonitorProfileMspScope(def, ctx);
  }

  if (ctx.customerId == null) {
    return notAvailable(def, "missing_customer_scope", "monitor_profile customer metric requires a customer context");
  }
  const tenantId = await resolveTenantId(ctx.customerId);
  if (!tenantId) {
    return notAvailable(def, "no_tenant_id", "customer has no M365 tenant_id — monitor data cannot be keyed");
  }

  // needs_aggregation metrics get their own transform.
  if (def.status === "needs_aggregation") {
    return resolveMonitorAggregation(def, tenantId);
  }

  const value = await monitorScalarForTenant(tenantId, def.sourceKey);
  if (value == null) {
    return notAvailable(def, "no_data", `no monitor profile rows for check "${def.sourceKey}"`);
  }

  // Percentage metric with a denominator → also compute percent.
  if (def.denominatorMetric) {
    const denomDef = getMetric(def.denominatorMetric);
    if (denomDef) {
      const denom = await monitorScalarForTenant(tenantId, denomDef.sourceKey);
      if (denom != null && denom > 0) {
        return ok(
          def,
          { value, percentage: Math.round((value / denom) * 1000) / 10 },
          { denominator: denom, denominatorMetric: def.denominatorMetric },
        );
      }
    }
  }

  return scalar(def, value);
}

/**
 * MSP-scoped monitor_profile metrics (platform.* — Graph API health, expiring
 * tokens, etc.). These describe the PLATFORM's own Graph plumbing, aggregated as
 * a SUM of the per-tenant counts across the MSP's active customers.
 */
async function resolveMonitorProfileMspScope(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const customerIds = await mspCustomerIds(ctx.mspId);
  if (customerIds.length === 0) return notAvailable(def, "no_customers", "MSP has no active customers");

  let sum = 0;
  let contributing = 0;
  for (const cid of customerIds) {
    const tid = await resolveTenantId(cid);
    if (!tid) continue;
    const v = await monitorScalarForTenant(tid, def.sourceKey);
    if (v != null) {
      sum += v;
      contributing++;
    }
  }
  if (contributing === 0) return notAvailable(def, "no_data", `no monitor data for check "${def.sourceKey}" across MSP`);
  // AGGREGATION RULE: counts → SUM across tenants.
  return scalar(def, sum, { aggregation: "sum", tenantsContributing: contributing, tenantsTotal: customerIds.length });
}

// ── needs_aggregation transforms (monitor_profile) ────────────────────────────

async function resolveMonitorAggregation(def: MetricDef, tenantId: string): Promise<MetricResult> {
  const props = await latestCheckProps(tenantId, def.sourceKey);
  if (!props) return notAvailable(def, "no_data", `no monitor profile rows for check "${def.sourceKey}"`);

  switch (def.key) {
    // License waste, priced: real per-SKU seat counts (groupByCount transform on
    // the cost:license-waste-estimate check) × real sku_price_reference list
    // price, via cost-engine.ts. Counts with no price on file surface as
    // meta.unknownSkus rather than a guessed dollar figure.
    case "licensing.wasteEstimateBreakdown": {
      const counts = extractGroupByCountCounts(props);
      if (!counts) return notAvailable(def, "no_data", "no groupByCount seat data for license waste estimate");
      const breakdown = await computeSkuCostBreakdown(counts);
      const buckets = breakdown.lines.map((l) => ({
        label: l.displayName,
        value: l.priceKnown ? centsToDollars(l.totalMonthlyPriceCents as number) : 0,
      }));
      return ok(def, { buckets }, {
        source: "cost-engine",
        unit: "usd_monthly",
        totalMonthlyDollars: centsToDollars(breakdown.totalMonthlyCents),
        totalAnnualDollars: centsToDollars(breakdown.totalAnnualCents),
        unknownSkus: breakdown.unknownSkus,
      });
    }

    // Secure score control breakdown, grouped by controlCategory.
    case "security.secureScoreControls":
      return aggregateGroupBy(def, props, "controlCategory");

    // Alerts by severity — group the raw alert list by severity.
    case "security.alertsBySeverity":
      return aggregateGroupBy(def, props, "severity");

    // Risk detections by type.
    case "security.riskDetectionCount":
      return aggregateGroupBy(def, props, "riskEventType", "detectionType", "riskType");

    // Secure score scalar: percentage of currentScore / maxScore.
    case "security.secureScore": {
      const current = firstNumber(props, ["currentScore", "secureScore", "current"]);
      const max = firstNumber(props, ["maxScore", "maxSecureScore", "max"]);
      if (current != null && max != null && max > 0) {
        return ok(def, { value: Math.round((current / max) * 1000) / 10 }, { current, max, unit: "percent" });
      }
      // Fall back to a stored percentage if present.
      const pct = firstNumber(props, ["percentage", "scorePct"]);
      if (pct != null) return scalar(def, pct, { unit: "percent" });
      return notAvailable(def, "unshaped", "secure score raw fields (currentScore/maxScore) not found");
    }

    // Sign-in activity heatmap: bucket raw sign-in createdDateTime into day×hour.
    case "identity.signinActivity":
      return aggregateSigninHeatmap(def, props);

    // Meetings organized: needs a teams-activity sub-field; not schema-stable.
    case "collaboration.meetingsOrganized": {
      const v = firstNumber(props, ["meetingsOrganized", "meetingCount", "_itemCount"]);
      return v == null ? notAvailable(def, "unshaped", "meetings-organized field not found in teams activity") : scalar(def, v);
    }

    // File activity heatmap.
    case "collaboration.fileActivity":
      return aggregateSigninHeatmap(def, props); // same day×hour bucketing over activity events

    default:
      return notAvailable(def, "no_transform", `no needs_aggregation transform for ${def.key}`);
  }
}

/** Extract the array of raw items from either extractedProperties or the raw Graph page. */
function rawItems(props: Record<string, unknown>): Record<string, unknown>[] {
  // Prefer an explicit values array if the mapping exposed one.
  for (const k of Object.keys(props)) {
    if (k.endsWith("_values") && Array.isArray(props[k])) return props[k] as Record<string, unknown>[];
  }
  const raw = props["__rawResponse"] as { value?: unknown } | null | undefined;
  if (raw && Array.isArray(raw.value)) return raw.value as Record<string, unknown>[];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  return [];
}

function firstNumber(props: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNumber(props[k]);
    if (n != null) return n;
  }
  return null;
}

/**
 * Extracts a pre-computed groupByCount map (a Record<string, number> under some
 * targetField) from monitor check props, e.g. `{ skuPartNumber: { SPE_E3: 12 } }`.
 * Returns null if no such object-valued field is present.
 */
export function extractGroupByCountCounts(props: Record<string, unknown>): Record<string, number> | null {
  for (const k of Object.keys(props)) {
    if (k.startsWith("__") || k.startsWith("_")) continue;
    const v = props[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const counts: Record<string, number> = {};
      let found = false;
      for (const [label, val] of Object.entries(v as Record<string, unknown>)) {
        const n = toNumber(val);
        if (n != null) {
          counts[label] = n;
          found = true;
        }
      }
      if (found) return counts;
    }
  }
  return null;
}

/**
 * Group-by-count transform. If the mapping already produced a groupByCount map
 * (a Record<string, number> under some targetField), use it directly. Otherwise
 * group the raw item list by the first present field name.
 */
function aggregateGroupBy(def: MetricDef, props: Record<string, unknown>, ...fieldNames: string[]): MetricResult {
  // 1. Pre-computed groupByCount map on any targetField.
  for (const k of Object.keys(props)) {
    if (k.startsWith("__") || k.startsWith("_")) continue;
    const v = props[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>)
        .map(([label, val]) => ({ label, value: toNumber(val) ?? 0 }))
        .filter((e) => Number.isFinite(e.value));
      if (entries.length > 0) return ok(def, { buckets: entries }, { source: "groupByCount", field: k });
    }
  }
  // 2. Group the raw item list ourselves.
  const items = rawItems(props);
  if (items.length === 0) return notAvailable(def, "no_data", "no raw items to group");
  const counts = new Map<string, number>();
  for (const item of items) {
    let label: string | undefined;
    for (const f of fieldNames) {
      if (item[f] != null) {
        label = String(item[f]);
        break;
      }
    }
    label = label ?? "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const buckets = [...counts.entries()].map(([label, value]) => ({ label, value }));
  return ok(def, { buckets }, { source: "rawGroupBy", groupedBy: fieldNames });
}

/**
 * Day×hour heatmap: bucket raw events by their createdDateTime timestamp into a
 * 7 (day-of-week) × 24 (hour) grid.
 */
function aggregateSigninHeatmap(def: MetricDef, props: Record<string, unknown>): MetricResult {
  const items = rawItems(props);
  if (items.length === 0) return notAvailable(def, "no_data", "no raw events to bucket");
  const grid = new Map<string, number>();
  let bucketed = 0;
  for (const item of items) {
    const ts = item["createdDateTime"] ?? item["activityDateTime"] ?? item["auditDateTime"];
    if (typeof ts !== "string") continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getUTCDay(); // 0..6
    const hour = d.getUTCHours(); // 0..23
    const k = `${day}:${hour}`;
    grid.set(k, (grid.get(k) ?? 0) + 1);
    bucketed++;
  }
  if (bucketed === 0) return notAvailable(def, "unshaped", "no parseable createdDateTime timestamps");
  const cells = [...grid.entries()].map(([k, value]) => {
    const [day, hour] = k.split(":").map(Number);
    return { x: hour, y: day, value };
  });
  return ok(def, { cells }, { bucketed, dimensions: { x: "hourOfDayUTC", y: "dayOfWeekUTC" } });
}

// =============================================================================
// platform_table resolvers
// =============================================================================

async function resolvePlatformTable(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (def.status === "not_collected" || def.sourceKey.startsWith("not_collected:")) {
    return notAvailable(def, "not_collected", `${def.sourceKey} is not collected yet`);
  }
  switch (def.key) {
    // ── Alerts ──
    case "alerts.recentAlerts":
      return platformRecentAlerts(def, ctx);
    case "alerts.alertVolume":
      return platformAlertVolume(def, ctx);
    case "alerts.ruleCoverage":
      return platformRuleCoverage(def);

    // ── Health history ──
    case "health.clientHealthHistory":
      return platformClientHealthHistory(def, ctx);
    case "health.clientHealthHeatmap":
      return platformClientHealthHeatmap(def, ctx);

    // ── Projects ──
    case "projects.activeProjectCount":
      return platformActiveProjects(def, ctx);
    case "projects.openTaskCount":
      return platformOpenTasks(def, ctx);
    case "projects.projectVelocity":
      return platformProjectVelocity(def, ctx);
    case "projects.tasksByColumn":
      return platformTasksByColumn(def, ctx);

    // ── Financial ──
    case "financial.totalRevenue":
      return platformTotalRevenue(def, ctx);
    case "financial.outstandingRevenue":
      return platformOutstandingRevenue(def, ctx);
    case "financial.revenueTrend":
      return platformRevenueTrend(def, ctx);
    case "financial.revenueByServiceType":
      // msp_charges has no serviceType/category column, and no customer join for it.
      return notAvailable(def, "schema_gap", "msp_charges has no serviceType/category column");
    case "financial.pipelineValue":
      // opportunities has no monetary value/amount column. Use sales_offers instead.
      return platformPipelineValue(def, ctx);

    // ── Sales offers ──
    case "offers.activeOfferCount":
      return platformActiveOffers(def, ctx);
    case "offers.offerFunnel":
      return platformOfferFunnel(def, ctx);
    case "offers.remediationOffers":
      return platformRemediationOffers(def, ctx);

    // ── Packages ──
    case "packages.activePackageCount":
      return platformActivePackages(def, ctx);
    case "packages.packageCoverage":
      return platformPackageCoverage(def, ctx);
    case "packages.assessmentCoverage":
      return platformAssessmentCoverage(def, ctx);

    // ── AI ──
    case "ai.tokenBurn":
      return platformTokenBurn(def, ctx);
    case "ai.currentBalance":
      return platformAiBalance(def, ctx);
    case "ai.costByFeature":
      return platformAiCostByFeature(def, ctx);

    // ── Workflow runs ──
    case "portalWf.failedWorkflowCount":
      return platformFailedWorkflows(def, ctx);
    case "portalWf.approvalsWaiting":
      return platformApprovalsWaiting(def, ctx);
    case "portalWf.jobQueueDepth":
      return platformJobQueueDepth(def, ctx);
    case "portalWf.successRate":
      return platformWorkflowSuccessRate(def, ctx);

    // ── Diagnostics ──
    case "diagnostics.recentScans":
      return platformRecentScans(def, ctx);
    case "diagnostics.findingsBySeverity":
      return platformFindingsBySeverity(def, ctx);

    // ── Benchmark ──
    case "benchmark.scoreVsIndustry":
      return platformScoreVsIndustry(def, ctx);

    default:
      return notAvailable(def, "no_resolver", `no platform_table resolver for ${def.key}`);
  }
}

// ── Alerts (mspId-scoped; no customerId column on msp_alert_events) ────────────

async function platformRecentAlerts(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const rows = await db
    .select({
      firedAt: mspAlertEventsTable.firedAt,
      severity: mspAlertEventsTable.severity,
      summary: mspAlertEventsTable.summary,
      ruleKey: mspAlertEventsTable.ruleKey,
      deepLinkPath: mspAlertEventsTable.deepLinkPath,
    })
    .from(mspAlertEventsTable)
    .where(eq(mspAlertEventsTable.mspId, ctx.mspId))
    .orderBy(desc(mspAlertEventsTable.firedAt))
    .limit(50);
  const events = rows.map((r) => ({
    t: r.firedAt?.toISOString() ?? "",
    label: r.summary ?? r.ruleKey ?? "alert",
    severity: r.severity,
    deepLinkPath: r.deepLinkPath,
  }));
  return ok(def, { events }, { scopeNote: "msp_alert_events is mspId-scoped (no customerId column)", count: events.length });
}

async function platformAlertVolume(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const rows = await db
    .select({ day: sql<string>`date_trunc('day', ${mspAlertEventsTable.firedAt})`, n: count() })
    .from(mspAlertEventsTable)
    .where(and(eq(mspAlertEventsTable.mspId, ctx.mspId), gte(mspAlertEventsTable.firedAt, since)))
    .groupBy(sql`date_trunc('day', ${mspAlertEventsTable.firedAt})`)
    .orderBy(sql`date_trunc('day', ${mspAlertEventsTable.firedAt})`);
  const series = rows.map((r) => ({ t: new Date(r.day).toISOString(), value: Number(r.n) }));
  return ok(def, { series }, { windowDays: ctx.windowDays ?? DEFAULT_WINDOW_DAYS });
}

async function platformRuleCoverage(def: MetricDef): Promise<MetricResult> {
  // msp_alert_rules are global (no mspId column) — count enabled platform-wide.
  const [row] = await db
    .select({ n: count() })
    .from(mspAlertRulesTable)
    .where(eq(mspAlertRulesTable.enabled, true));
  return scalar(def, Number(row?.n ?? 0), { scopeNote: "msp_alert_rules are global/platform-scoped" });
}

// ── Health history ────────────────────────────────────────────────────────────

async function platformClientHealthHistory(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // client_health_history is keyed by clientId → users.id, not customerId. Without a
  // reliable customerId→userId bridge here we resolve MSP-agnostically only when the
  // caller is a customer whose user id equals clientId. Prefer the engine rollup as
  // the customer health trend, which IS keyed by customerId.
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  const rows = await db
    .select({ day: engineScoreDailyRollupTable.day, score: engineScoreDailyRollupTable.score })
    .from(engineScoreDailyRollupTable)
    .where(and(eq(engineScoreDailyRollupTable.customerId, ctx.customerId), eq(engineScoreDailyRollupTable.engineKey, "health")))
    .orderBy(engineScoreDailyRollupTable.day);
  if (rows.length === 0) return notAvailable(def, "no_data", "no health rollup history for customer");
  const series = rows.map((r) => ({ t: String(r.day), value: r.score }));
  return ok(def, { series }, { source: "engine_score_daily_rollup(health)", note: "client_health_history is user-keyed; using customer-keyed rollup" });
}

async function platformClientHealthHeatmap(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // Per-customer × day heatmap of the health score. msp_score_history has no
  // customerId, so we use engine_score_daily_rollup (customerId + engineKey + day).
  const rows = await db
    .select({ customerId: engineScoreDailyRollupTable.customerId, day: engineScoreDailyRollupTable.day, score: engineScoreDailyRollupTable.score })
    .from(engineScoreDailyRollupTable)
    .where(and(eq(engineScoreDailyRollupTable.mspId, ctx.mspId), eq(engineScoreDailyRollupTable.engineKey, "health")))
    .orderBy(engineScoreDailyRollupTable.day);
  if (rows.length === 0) return notAvailable(def, "no_data", "no health rollup history for MSP");
  const cells = rows.map((r) => ({ x: String(r.day), y: r.customerId ?? 0, value: r.score }));
  return ok(def, { cells }, { source: "engine_score_daily_rollup(health)", dimensions: { x: "day", y: "customerId" } });
}

// ── Projects ──────────────────────────────────────────────────────────────────

/** projects.clientUserId → users.id. For a customer scope we don't have the userId here;
 *  projects are user-keyed, not customer-keyed. We scope by the customer's users via a
 *  subquery join is not available (no customer→user table here), so customer-scoped
 *  project metrics resolve against the caller-provided customer only when a userId bridge
 *  exists. To stay correct we treat these as MSP-level where the registry says msp, and
 *  for customer scope we filter projects whose clientUserId maps to this customer — which
 *  we cannot do reliably, so we return the active/open counts scoped by the customer's
 *  own user set is out of reach. We therefore compute customer-scoped project metrics from
 *  projects joined via clientUserId only when ctx carries it. */
async function platformActiveProjects(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  // NOTE: projects are keyed by clientUserId (a users.id), and there is no
  // customer→user mapping table available to this resolver. We count active
  // projects for the whole MSP's customers is not the intent; the honest scope we
  // can serve is "active projects" filtered by the customer's linked user, which we
  // do not have. Flagged as a schema bridge gap.
  return notAvailable(def, "schema_gap", "projects are user-keyed (clientUserId); no customer→user bridge available in this resolver");
}

async function platformOpenTasks(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  return notAvailable(def, "schema_gap", "kanban_tasks join to customer goes through user-keyed projects; no customer→user bridge available");
}

async function platformProjectVelocity(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // MSP-scope velocity: tasks completed per day across the MSP. kanban_tasks has no
  // mspId; velocity across the whole platform is the only honest read without a
  // customer→user bridge. Count tasks moved to "completed" per day in the window.
  const since = windowStart(ctx);
  const rows = await db
    .select({ day: sql<string>`date_trunc('day', ${kanbanTasksTable.updatedAt})`, n: count() })
    .from(kanbanTasksTable)
    .where(and(eq(kanbanTasksTable.column, "completed"), gte(kanbanTasksTable.updatedAt, since)))
    .groupBy(sql`date_trunc('day', ${kanbanTasksTable.updatedAt})`)
    .orderBy(sql`date_trunc('day', ${kanbanTasksTable.updatedAt})`);
  const series = rows.map((r) => ({ t: new Date(r.day).toISOString(), value: Number(r.n) }));
  return ok(def, { series }, { scopeNote: "kanban_tasks has no mspId; velocity is platform-wide", windowDays: ctx.windowDays ?? DEFAULT_WINDOW_DAYS });
}

async function platformTasksByColumn(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  return notAvailable(def, "schema_gap", "tasks-by-column needs a customer→user→project bridge not available here");
}

// ── Financial (mspId-scoped) ──────────────────────────────────────────────────

async function platformTotalRevenue(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // msp_charges.amountCents (integer cents). Total realised revenue = SUM of succeeded charges.
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${mspChargesTable.amountCents}), 0)` })
    .from(mspChargesTable)
    .where(and(eq(mspChargesTable.mspId, ctx.mspId), eq(mspChargesTable.status, "succeeded")));
  const cents = Number(row?.cents ?? 0);
  return scalar(def, cents / 100, { unit: "usd", aggregation: "sum", source: "msp_charges.amountCents" });
}

async function platformOutstandingRevenue(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // invoices.amount is numeric DOLLARS (string at runtime); status due/overdue = outstanding.
  // invoices have no mspId — they are keyed by clientUserId. Without a customer→user bridge
  // an MSP-wide outstanding total is not reliably attributable. Flagged.
  return notAvailable(def, "schema_gap", "invoices are clientUserId-keyed with no mspId; MSP-scope outstanding total not attributable");
}

async function platformRevenueTrend(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const rows = await db
    .select({ day: sql<string>`date_trunc('day', ${mspChargesTable.chargedAt})`, cents: sql<number>`coalesce(sum(${mspChargesTable.amountCents}), 0)` })
    .from(mspChargesTable)
    .where(and(eq(mspChargesTable.mspId, ctx.mspId), eq(mspChargesTable.status, "succeeded"), gte(mspChargesTable.chargedAt, since)))
    .groupBy(sql`date_trunc('day', ${mspChargesTable.chargedAt})`)
    .orderBy(sql`date_trunc('day', ${mspChargesTable.chargedAt})`);
  const series = rows.map((r) => ({ t: new Date(r.day).toISOString(), value: Number(r.cents) / 100 }));
  return ok(def, { series }, { unit: "usd", windowDays: ctx.windowDays ?? DEFAULT_WINDOW_DAYS });
}

async function platformPipelineValue(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // Registry sourceKey "opportunities" has no monetary column. The nearest real
  // pipeline dollars are open sales_offers (state "sent"), adjustedPriceCents.
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${salesOffersTable.adjustedPriceCents}), 0)` })
    .from(salesOffersTable)
    .where(and(eq(salesOffersTable.mspId, ctx.mspId), eq(salesOffersTable.state, "sent")));
  const cents = Number(row?.cents ?? 0);
  return scalar(def, cents / 100, { unit: "usd", source: "sales_offers(sent).adjustedPriceCents", note: "opportunities table has no monetary column; using open sales_offers" });
}

// ── Sales offers ──────────────────────────────────────────────────────────────

async function platformActiveOffers(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // sales_offers.customerId → users.id. Active/live = state "sent". For an MSP the
  // honest scope is mspId; for a customer we'd need the user bridge, so scope by mspId.
  const [row] = await db
    .select({ n: count() })
    .from(salesOffersTable)
    .where(and(eq(salesOffersTable.mspId, ctx.mspId), eq(salesOffersTable.state, "sent")));
  return scalar(def, Number(row?.n ?? 0), { scopeNote: "scoped by mspId (sales_offers.customerId is user-keyed)" });
}

async function platformOfferFunnel(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // sales_offer_events.eventName: offer.generated → offer.sent → offer.accepted.
  const rows = await db
    .select({ eventName: salesOfferEventsTable.eventName, n: count() })
    .from(salesOfferEventsTable)
    .innerJoin(salesOffersTable, eq(salesOfferEventsTable.offerId, salesOffersTable.id))
    .where(eq(salesOffersTable.mspId, ctx.mspId))
    .groupBy(salesOfferEventsTable.eventName);
  const byName = new Map(rows.map((r) => [r.eventName, Number(r.n)]));
  const buckets = [
    { label: "generated", value: byName.get("offer.generated") ?? 0 },
    { label: "sent", value: byName.get("offer.sent") ?? 0 },
    { label: "accepted", value: byName.get("offer.accepted") ?? 0 },
  ];
  return ok(def, { buckets }, { note: "sales_offer_events has no 'viewed' stage" });
}

async function platformRemediationOffers(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // Remediation offers are the customer's sales_offers whose product is a
  // micro-remediation service. The offer type lives on the joined service's
  // `category` column ('micro_remediation'), NOT a phantom msp_sales_offers table.
  // sales_offers.customerId is user-keyed; scope by ctx.customerId directly.
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  const rows = await db
    .select({
      id: salesOffersTable.id,
      title: salesOffersTable.title,
      state: salesOffersTable.state,
      adjustedPriceCents: salesOffersTable.adjustedPriceCents,
      priceCents: salesOffersTable.priceCents,
      expiresAt: salesOffersTable.expiresAt,
      sentAt: salesOffersTable.sentAt,
      createdAt: salesOffersTable.createdAt,
      firedSignalKeys: salesOffersTable.firedSignalKeys,
    })
    .from(salesOffersTable)
    .innerJoin(servicesTable, eq(salesOffersTable.serviceId, servicesTable.id))
    .where(and(eq(servicesTable.category, "micro_remediation"), eq(salesOffersTable.customerId, ctx.customerId)))
    // Newest first by send time, falling back to createdAt for un-sent offers.
    .orderBy(desc(sql`coalesce(${salesOffersTable.sentAt}, ${salesOffersTable.createdAt})`));
  const events = rows.map((r) => ({
    // timeline entries key off `t` (the ISO timestamp) + `label`; the rest is
    // passthrough metadata the renderer can surface.
    t: (r.sentAt ?? r.createdAt)?.toISOString() ?? "",
    label: r.title,
    id: r.id,
    state: r.state,
    // adjustedPriceCents is the engine-adjusted price other resolvers prefer
    // (see platformPipelineValue); fall back to priceCents when unset.
    priceCents: r.adjustedPriceCents ?? r.priceCents ?? 0,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
    firedSignalKeys: r.firedSignalKeys ?? [],
  }));
  return ok(def, { events }, { count: events.length, source: "sales_offers⋈services(category=micro_remediation)" });
}

// ── Packages ──────────────────────────────────────────────────────────────────

async function platformActivePackages(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  // Per-customer active packages come from msp_sales_bundle_assignments (customerId + status).
  const [row] = await db
    .select({ n: count() })
    .from(mspSalesBundleAssignmentsTable)
    .where(and(eq(mspSalesBundleAssignmentsTable.customerId, ctx.customerId), eq(mspSalesBundleAssignmentsTable.status, "active")));
  return scalar(def, Number(row?.n ?? 0), { source: "msp_sales_bundle_assignments(active)" });
}

async function platformPackageCoverage(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // Distribution of active bundle assignments across the MSP's customers, by status.
  const rows = await db
    .select({ status: mspSalesBundleAssignmentsTable.status, n: count() })
    .from(mspSalesBundleAssignmentsTable)
    .where(eq(mspSalesBundleAssignmentsTable.mspId, ctx.mspId))
    .groupBy(mspSalesBundleAssignmentsTable.status);
  const buckets = rows.map((r) => ({ label: r.status, value: Number(r.n) }));
  if (buckets.length === 0) return notAvailable(def, "no_data", "no bundle assignments for MSP");
  return ok(def, { buckets }, { source: "msp_sales_bundle_assignments" });
}

async function platformAssessmentCoverage(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // No assessment column on msp_customers — derive coverage from diagnostic runs:
  // (# active customers with a coverage-sufficient diagnostic run) / (# active customers) * 100.
  // Graded gate (evaluateDocGateCoverage, see doc-gate-coverage.ts): a strictly
  // status="completed" filter counted tenants whose runs are permanently "partial"
  // (real majority signal, a couple of unrunnable checks) as never-assessed.
  // A run counts as coverage when its real evaluable-check coverage clears the bar.
  // AGGREGATION RULE: coverage percent across the book = averaged as a ratio of covered/total.
  const customerIds = await mspCustomerIds(ctx.mspId);
  if (customerIds.length === 0) return notAvailable(def, "no_customers", "MSP has no active customers");
  const runRows = await db
    .select({
      customerId: mspDiagnosticRunsTable.customerId,
      checksOk: mspDiagnosticRunsTable.checksOk,
      checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
      checksError: mspDiagnosticRunsTable.checksError,
      checksTotal: mspDiagnosticRunsTable.checksTotal,
    })
    .from(mspDiagnosticRunsTable)
    .where(and(eq(mspDiagnosticRunsTable.mspId, ctx.mspId), inArray(mspDiagnosticRunsTable.status, ["completed", "partial"]), inArray(mspDiagnosticRunsTable.customerId, customerIds)));
  const coveredIds = new Set<number>();
  for (const row of runRows) {
    if (row.customerId == null || coveredIds.has(row.customerId)) continue;
    const cov = evaluateDocGateCoverage({
      checksOk: row.checksOk ?? 0,
      checksLicenseGap: row.checksLicenseGap ?? 0,
      checksError: row.checksError ?? 0,
      checksTotal: row.checksTotal ?? 0,
    });
    if (cov.proceed) coveredIds.add(row.customerId);
  }
  const coveredCount = coveredIds.size;
  const pct = Math.round((coveredCount / customerIds.length) * 1000) / 10;
  return scalar(def, pct, { unit: "percent", covered: coveredCount, total: customerIds.length, source: "msp_diagnostic_runs(coverage-sufficient)" });
}

// ── AI (mspId-scoped) ─────────────────────────────────────────────────────────

async function platformTokenBurn(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const rows = await db
    .select({ day: sql<string>`date_trunc('day', ${aiUsageEventsTable.occurredAt})`, tokens: sql<number>`coalesce(sum(${aiUsageEventsTable.totalTokens}), 0)` })
    .from(aiUsageEventsTable)
    .where(and(eq(aiUsageEventsTable.mspId, ctx.mspId), gte(aiUsageEventsTable.occurredAt, since)))
    .groupBy(sql`date_trunc('day', ${aiUsageEventsTable.occurredAt})`)
    .orderBy(sql`date_trunc('day', ${aiUsageEventsTable.occurredAt})`);
  const series = rows.map((r) => ({ t: new Date(r.day).toISOString(), value: Number(r.tokens) }));
  return ok(def, { series }, { unit: "tokens", windowDays: ctx.windowDays ?? DEFAULT_WINDOW_DAYS });
}

async function platformAiBalance(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  // Latest ledger row's balanceAfterCents for the MSP.
  const [row] = await db
    .select({ balanceAfterCents: aiBalanceLedgerTable.balanceAfterCents })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, ctx.mspId))
    .orderBy(desc(aiBalanceLedgerTable.createdAt))
    .limit(1);
  if (!row || row.balanceAfterCents == null) {
    // Fall back to SUM(amountCents) if no running balance snapshot.
    const [sum] = await db
      .select({ cents: sql<number>`coalesce(sum(${aiBalanceLedgerTable.amountCents}), 0)` })
      .from(aiBalanceLedgerTable)
      .where(eq(aiBalanceLedgerTable.mspId, ctx.mspId));
    if (!sum) return notAvailable(def, "no_data", "no AI ledger rows for MSP");
    return scalar(def, Number(sum.cents) / 100, { unit: "usd", source: "sum(amountCents)" });
  }
  return scalar(def, Number(row.balanceAfterCents) / 100, { unit: "usd", source: "balanceAfterCents" });
}

async function platformAiCostByFeature(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const rows = await db
    .select({ feature: sql<string>`coalesce(${aiUsageEventsTable.feature}, ${aiUsageEventsTable.nodeType})`, cents: sql<number>`coalesce(sum(${aiUsageEventsTable.costCents}), 0)` })
    .from(aiUsageEventsTable)
    .where(and(eq(aiUsageEventsTable.mspId, ctx.mspId), gte(aiUsageEventsTable.occurredAt, since)))
    .groupBy(sql`coalesce(${aiUsageEventsTable.feature}, ${aiUsageEventsTable.nodeType})`);
  const buckets = rows.map((r) => ({ label: r.feature ?? "unknown", value: Number(r.cents) / 100 }));
  if (buckets.length === 0) return notAvailable(def, "no_data", "no AI usage in window");
  return ok(def, { buckets }, { unit: "usd" });
}

// ── Workflow runs (mspId-scoped) ──────────────────────────────────────────────

async function platformFailedWorkflows(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const [row] = await db
    .select({ n: count() })
    .from(portalWfRunsTable)
    .where(and(eq(portalWfRunsTable.mspId, ctx.mspId), eq(portalWfRunsTable.status, "failed"), gte(portalWfRunsTable.createdAt, since)));
  return scalar(def, Number(row?.n ?? 0), { windowDays: ctx.windowDays ?? DEFAULT_WINDOW_DAYS });
}

async function platformApprovalsWaiting(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const [row] = await db
    .select({ n: count() })
    .from(portalWfOperatorTasksTable)
    .where(and(eq(portalWfOperatorTasksTable.mspId, ctx.mspId), eq(portalWfOperatorTasksTable.status, "open")));
  return scalar(def, Number(row?.n ?? 0), { source: "portal_wf_operator_tasks(open)" });
}

async function platformJobQueueDepth(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const [row] = await db
    .select({ n: count() })
    .from(mspJobQueueTable)
    .where(and(eq(mspJobQueueTable.mspId, ctx.mspId), eq(mspJobQueueTable.status, "pending")));
  return scalar(def, Number(row?.n ?? 0), { source: "msp_job_queue(pending)" });
}

async function platformWorkflowSuccessRate(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  const since = windowStart(ctx);
  const [row] = await db
    .select({
      total: count(),
      completed: sql<number>`sum(case when ${portalWfRunsTable.status} = 'completed' then 1 else 0 end)`,
    })
    .from(portalWfRunsTable)
    .where(and(eq(portalWfRunsTable.mspId, ctx.mspId), gte(portalWfRunsTable.createdAt, since)));
  const total = Number(row?.total ?? 0);
  if (total === 0) return notAvailable(def, "no_data", "no workflow runs in window");
  const completed = Number(row?.completed ?? 0);
  // AGGREGATION RULE: success rate is a percentage of completed/total runs.
  return scalar(def, Math.round((completed / total) * 1000) / 10, { unit: "percent", completed, total });
}

// ── Diagnostics (customer-scoped) ─────────────────────────────────────────────

async function platformRecentScans(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  const rows = await db
    .select({ createdAt: mspDiagnosticRunsTable.createdAt, status: mspDiagnosticRunsTable.status, packageKey: mspDiagnosticRunsTable.packageKey, runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, ctx.customerId))
    .orderBy(desc(mspDiagnosticRunsTable.createdAt))
    .limit(20);
  const events = rows.map((r) => ({ t: r.createdAt?.toISOString() ?? "", label: r.packageKey ?? "scan", status: r.status, runId: r.runId }));
  return ok(def, { events }, { count: events.length });
}

async function platformFindingsBySeverity(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  const rows = await db
    .select({ severity: mspDiagnosticFindingsTable.severity, n: count() })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.customerId, ctx.customerId))
    .groupBy(mspDiagnosticFindingsTable.severity);
  const buckets = rows.map((r) => ({ label: r.severity, value: Number(r.n) }));
  if (buckets.length === 0) return notAvailable(def, "no_data", "no diagnostic findings for customer");
  return ok(def, { buckets });
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

async function platformScoreVsIndustry(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  if (ctx.customerId == null) return notAvailable(def, "missing_customer_scope", "requires customer context");
  // industry_benchmark_reference is keyed by PILLAR only (no industry dimension).
  // Compare the customer's latest per-engine scores to the per-pillar industry average.
  const benchmarks = await db
    .select({ pillar: industryBenchmarkReferenceTable.pillar, industryAvgPct: industryBenchmarkReferenceTable.industryAvgPct })
    .from(industryBenchmarkReferenceTable);
  if (benchmarks.length === 0) return notAvailable(def, "no_data", "no benchmark reference rows");
  const snaps = await db
    .selectDistinctOn([tenantEngineSnapshotsTable.engineKey], {
      engineKey: tenantEngineSnapshotsTable.engineKey,
      score: tenantEngineSnapshotsTable.score,
    })
    .from(tenantEngineSnapshotsTable)
    .where(eq(tenantEngineSnapshotsTable.customerId, ctx.customerId))
    .orderBy(tenantEngineSnapshotsTable.engineKey, desc(tenantEngineSnapshotsTable.capturedAt));
  const scoreByKey = new Map(snaps.map((s) => [s.engineKey, s.score]));
  const buckets = benchmarks
    .filter((b) => b.industryAvgPct != null)
    .map((b) => ({
      label: b.pillar,
      value: scoreByKey.get(b.pillar) ?? 0,
      industryAvg: b.industryAvgPct as number,
    }));
  if (buckets.length === 0) return notAvailable(def, "no_data", "no comparable pillar scores");
  return ok(def, { buckets }, { note: "benchmark keyed by pillar (no industry segmentation)" });
}

// =============================================================================
// History (Smart widget sparkline + hysteresis lookback)
// =============================================================================

/** Max history points fetched per metric (a generous cap over the default window). */
const MAX_HISTORY_ROWS = 90;

/**
 * Recent `{ t, value }[]` history (oldest→newest) for a metric, for the Smart
 * renderer. Only customer-scope smart-eligible SCALAR metrics backed by an
 * engine_snapshot or monitor_profile can produce a per-point value over time;
 * anything else returns null (the route omits `history` for that key).
 *
 * Never throws — a history fetch failing must not fail the metric's own resolve
 * (the value still comes back; the widget just falls back to no-sparkline).
 */
export async function resolveMetricHistory(
  def: MetricDef,
  ctx: ResolveContext,
): Promise<{ t: string; value: number }[] | null> {
  // Only smart-eligible scalar/trend customer metrics get a sparkline history.
  // "trend"-shaped monitor_profile metrics (risky users, high-risk sign-ins)
  // resolve their current value as a scalar through the same
  // monitorScalarForTenant path, so their per-row history means exactly what
  // the scalar means — same honesty contract as the "scalar" shape.
  if (!def.smartEligible || (def.shape !== "scalar" && def.shape !== "trend") || def.scope !== "customer") return null;
  if (def.status === "not_collected" || def.sourceKey.startsWith("not_collected:")) return null;
  if (ctx.customerId == null) return null;

  const since = windowStart(ctx);
  try {
    if (def.sourceType === "engine_snapshot") {
      // SLA / scope-creep snapshots are lossy (they store only a composite/zero
      // score), so their live-computed scalars have no trustworthy per-point
      // history to draw — skip rather than plot a misleading line.
      if (!SNAPSHOT_ENGINE_KEYS.has(def.sourceKey) || def.sourceKey === "sla" || def.sourceKey === "scope_creep" || def.sourceKey === "scope-creep") {
        return null;
      }
      const snaps = await getRecentEngineSnapshots(ctx.customerId, def.sourceKey, MAX_HISTORY_ROWS);
      const points = snaps
        .filter((s) => s.capturedAt >= since)
        .slice()
        .reverse() // getRecentEngineSnapshots returns newest→oldest
        .map((s) => ({ t: s.capturedAt.toISOString(), value: s.score ?? 0 }));
      return points.length > 0 ? points : null;
    }

    if (def.sourceType === "monitor_profile") {
      const tenantId = await resolveTenantId(ctx.customerId);
      if (!tenantId) return null;
      const points = await monitorHistoryForTenant(tenantId, def.sourceKey, MAX_HISTORY_ROWS, since);
      return points.length > 0 ? points : null;
    }

    return null; // platform_table smart scalars have no per-point history path here
  } catch (err) {
    log.warn({ err, metricKey: def.key }, "dashboard: history fetch failed (metric value unaffected)");
    return null;
  }
}

// =============================================================================
// Top-level dispatch
// =============================================================================

/**
 * Resolve a single metric. Never throws — any resolver error is caught and
 * returned as { status: "error" } so one bad metric can't fail a batch.
 */
export async function resolveMetric(def: MetricDef, ctx: ResolveContext): Promise<MetricResult> {
  try {
    let result: MetricResult;
    switch (def.sourceType) {
      case "engine_snapshot":
        result = await resolveEngineSnapshot(def, ctx);
        break;
      case "monitor_profile":
        result = await resolveMonitorProfile(def, ctx);
        break;
      case "platform_table":
        result = await resolvePlatformTable(def, ctx);
        break;
      default:
        result = notAvailable(def, "unknown_source_type", `unknown sourceType "${(def as MetricDef).sourceType}"`);
    }
    if (result.status === "not_available") {
      log.info({ metricKey: def.key, reason: result.reason }, "dashboard: metric not available");
    } else if (result.status === "ok" && result.meta?.zeroRows) {
      log.info({ metricKey: def.key }, "dashboard: metric resolved to zero");
    }
    return result;
  } catch (err) {
    log.error({ err, metricKey: def.key }, "dashboard: resolver threw");
    return { metricKey: def.key, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
