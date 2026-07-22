/**
 * monitor-executor.ts
 *
 * Executes platform-authored Monitor Checks against customer tenants via the
 * Microsoft Graph API (Application permissions / client credentials).
 *
 * Key design rules:
 * - Mandatory @odata.nextLink exhaustion with a safety cap (NEXT_LINK_MAX_PAGES).
 * - Deterministic validation — no AI calls, no token cost.
 * - Partial check failure never fails the whole run; failed checks are marked "error".
 * - Consent-revoked is surfaced as a distinct runStatus, never silently swallowed.
 * - idempotencyKey = "{tenantId}:{checkKey}:{triggerId}" prevents duplicate writes.
 */

import { db } from "@workspace/db";
import {
  monitorChecksTable,
  monitoringPackagesTable,
  monitoringPackageChecksTable,
  tenantMonitorProfilesTable,
  mspCustomersTable,
  type MonitorCheck,
  type MonitoringPackage,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError, LicenseGapError, markTenantConsentRevoked } from "./graph";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.monitor" });

// ── Constants ─────────────────────────────────────────────────────────────────

/** Hard cap on @odata.nextLink page fetches per check to prevent runaway loops. */
const NEXT_LINK_MAX_PAGES = 50;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SeverityRule {
  expression: string;
  severity: string;
  label?: string;
}

export interface MappingRule {
  sourceField: string;
  targetField: string;
  /**
   * "count" | "exists" | "first" | "join" | "none" | "countTruthy" | "countFalse"
   * | "countEquals('value')" — the countEquals form carries its comparison value
   * inline in the string since MappingRule is stored as jsonb; parsed at runtime.
   */
  transform?: string;
}

export interface CheckResult {
  checkKey: string;
  status: "ok" | "error" | "consent_revoked" | "requires_script" | "license_gap";
  extractedProperties: Record<string, unknown>;
  severityMatched: string | null;
  errorMessage?: string;
  itemCount: number;
  pageCount: number;
  profileId?: string;
  /** For status "license_gap": the customer-safe name of the missing M365 add-on. */
  licenseFeature?: string;
}

export interface PackageRunResult {
  packageKey: string;
  tenantId: string;
  triggerId: string;
  runStatus: "completed" | "partial_failure" | "consent_revoked" | "no_checks";
  checks: CheckResult[];
  enginesRecomputed: string[];
  /** Count of checks that couldn't run due to a missing M365 SKU/add-on (not a failure). */
  licenseGapCount: number;
  /** Distinct customer-safe names of the missing M365 add-ons this run detected. */
  licenseGapFeatures: string[];
  startedAt: string;
  completedAt: string;
}

export type ProgressCallback = (event: {
  checkKey: string;
  checkLabel: string;
  status: CheckResult["status"];
  index: number;
  total: number;
  requiresCustomerScript: boolean;
  errorMessage?: string;
}) => void;

// ── Grammar: deterministic condition evaluator ────────────────────────────────
// Reuses the same grammar rules as the workflow-executor's evalCondition but as
// a standalone function so the monitor-executor has no circular dep on workflow-executor.

function resolvePathInData(p: string, data: Record<string, unknown>): unknown {
  const parts = p.replace(/^\{\{|\}\}$/g, "").trim().split(".");
  let cur: unknown = data;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ── Relative date placeholder resolution ────────────────────────────────────
// Resolves {NDaysAgo} tokens in Graph endpoint strings to literal ISO 8601 UTC
// datetimes. Graph's $filter requires literal dates, not relative expressions,
// so this substitution was always structurally necessary.
const DATE_PLACEHOLDER_RE = /\{(\d+)DaysAgo\}/g;

export function resolveEndpointPlaceholders(endpoint: string): string {
  return endpoint.replace(DATE_PLACEHOLDER_RE, (_match, days: string) => {
    const n = Number(days);
    const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    return d.toISOString();
  });
}

function parseExprValue(s: string, data: Record<string, unknown>): unknown {
  const t = s.trim();
  if (t.startsWith("{{") && t.endsWith("}}")) return resolvePathInData(t, data);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
  return resolvePathInData(t, data);
}

function evalClause(clause: string, data: Record<string, unknown>): boolean {
  const c = clause.trim();
  // Order matters: multi-char/word operators must precede their single-char prefixes
  // e.g. " length>=" before " length>" before ">="  before ">"
  const OPS = [" length>=", " length<=", " length==", " length>", " length<", " contains ", ">=", "<=", "!=", "==", ">", "<"];
  for (const op of OPS) {
    const idx = c.indexOf(op);
    if (idx === -1) continue;
    const lhs = c.slice(0, idx).trim();
    const rhs = c.slice(idx + op.length).trim();
    const left = parseExprValue(lhs, data);
    const right = parseExprValue(rhs, data);
    const op2 = op.trim();
    if (op2.startsWith("length")) {
      const len = Array.isArray(left) ? left.length : typeof left === "string" ? left.length : 0;
      const n = Number(right !== undefined ? right : rhs);
      if (op2 === "length>")  return len > n;
      if (op2 === "length<")  return len < n;
      if (op2 === "length>=") return len >= n;
      if (op2 === "length<=") return len <= n;
      if (op2 === "length==") return len === n;
    }
    if (op2 === "contains") {
      const haystack = Array.isArray(left) ? left : String(left ?? "");
      // If right did not resolve to a data value, treat rhs as a literal string
      const needle = right !== undefined ? right : rhs;
      return Array.isArray(haystack)
        ? haystack.includes(needle)
        : String(haystack).includes(String(needle ?? ""));
    }
    if (op2 === "==") return left == right; // eslint-disable-line eqeqeq
    if (op2 === "!=") return left != right; // eslint-disable-line eqeqeq
    if (op2 === ">")  return Number(left) > Number(right);
    if (op2 === "<")  return Number(left) < Number(right);
    if (op2 === ">=") return Number(left) >= Number(right);
    if (op2 === "<=") return Number(left) <= Number(right);
  }
  // Boolean-truthy path
  const val = resolvePathInData(c, data);
  if (val == null) return false;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") return val.length > 0 && val !== "false" && val !== "0";
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

export function evalConditionGrammar(expression: string, data: Record<string, unknown>): boolean {
  if (!expression?.trim()) return false;
  // Split on || (lower precedence), then && within each OR segment
  const orParts = expression.split(/\|\|/);
  for (const orPart of orParts) {
    const andParts = orPart.split(/&&/);
    if (andParts.every(c => evalClause(c, data))) return true;
  }
  return false;
}

// ── JSON Schema shape validator (deterministic, no AI) ────────────────────────

export function validateOutputShape(
  data: unknown,
  schema: Record<string, unknown> | null | undefined,
): { valid: boolean; errors: string[] } {
  if (!schema) return { valid: true, errors: [] };
  const errors: string[] = [];

  function check(val: unknown, s: Record<string, unknown>, path: string) {
    const type = s.type as string | undefined;
    if (type) {
      const actualType = val === null ? "null" : Array.isArray(val) ? "array" : typeof val;
      if (actualType !== type) {
        errors.push(`${path}: expected ${type}, got ${actualType}`);
        return;
      }
    }
    if (s.required && Array.isArray(s.required) && typeof val === "object" && val !== null) {
      for (const req of s.required as string[]) {
        if (!Object.prototype.hasOwnProperty.call(val, req)) {
          errors.push(`${path}: missing required property "${req}"`);
        }
      }
    }
    if (s.properties && typeof val === "object" && val !== null && !Array.isArray(val)) {
      for (const [k, subSchema] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) {
        if (Object.prototype.hasOwnProperty.call(val, k)) {
          check((val as Record<string, unknown>)[k], subSchema, `${path}.${k}`);
        }
      }
    }
    if (s.items && Array.isArray(val)) {
      val.forEach((item, i) => check(item, s.items as Record<string, unknown>, `${path}[${i}]`));
    }
  }

  check(data, schema, "root");
  return { valid: errors.length === 0, errors };
}

// ── Severity classifier ───────────────────────────────────────────────────────

export function classifySeverity(
  severityRules: SeverityRule[],
  data: Record<string, unknown>,
): string | null {
  for (const rule of severityRules) {
    try {
      if (evalConditionGrammar(rule.expression, data)) return rule.severity;
    } catch {
      // skip malformed rules
    }
  }
  return null;
}

// ── Property extraction from Graph response items ─────────────────────────────

export function applyMapping(
  items: unknown[],
  mapping: MappingRule[],
  properties: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Raw property extraction (count, first value, etc.)
  for (const prop of properties) {
    const vals = items.map(item => (typeof item === "object" && item !== null
      ? (item as Record<string, unknown>)[prop]
      : undefined));
    result[`${prop}_count`] = vals.filter(v => v != null).length;
    result[`${prop}_first`] = vals.find(v => v != null) ?? null;
    result[`${prop}_values`] = vals.filter(v => v != null);
  }

  // Mapping rules
  for (const rule of mapping) {
    const { sourceField, targetField } = rule;
    const rawTransform = rule.transform ?? "none";
    const countEqualsMatch = /^countEquals\(\s*['"](.*)['"]\s*\)$/.exec(rawTransform);
    const staleSignInMatch = /^countIfLastSignInOlderThan\(\s*(\d+)\s*\)$/.exec(rawTransform);
    const transform = countEqualsMatch ? "countEquals"
      : staleSignInMatch ? "countIfLastSignInOlderThan"
      : rawTransform;
    const compareValue = countEqualsMatch ? countEqualsMatch[1] : undefined;
    const staleDays = staleSignInMatch ? Number(staleSignInMatch[1]) : undefined;

    // Resolve sourceField via the existing dot-path resolver (already used by
    // the condition grammar) instead of flat bracket access, so nested Graph
    // fields like "status.errorCode" resolve correctly.
    const vals = items.map(item => (typeof item === "object" && item !== null
      ? resolvePathInData(sourceField, item as Record<string, unknown>)
      : undefined));

    switch (transform) {
      case "count":
        result[targetField] = vals.filter(v => v != null).length;
        break;
      case "exists":
        result[targetField] = vals.some(v => v != null && v !== false && v !== "");
        break;
      case "first":
        result[targetField] = vals.find(v => v != null) ?? null;
        break;
      case "join":
        result[targetField] = vals.filter(v => v != null).join(", ");
        break;
      case "countTruthy":
        result[targetField] = vals.filter(v => v != null && v !== false && v !== "").length;
        break;
      case "countFalse":
        result[targetField] = vals.filter(v => v === false).length;
        break;
      case "countEquals":
        result[targetField] = vals.filter(v => String(v) === compareValue).length;
        break;
      case "countIfLastSignInOlderThan": {
        const cutoff = Date.now() - (staleDays! * 24 * 60 * 60 * 1000);
        let sawSignInActivity = false;
        result[targetField] = items.filter(item => {
          if (typeof item !== "object" || item === null) return false;
          const licenseVal = resolvePathInData(sourceField, item as Record<string, unknown>);
          if (licenseVal == null || (Array.isArray(licenseVal) && licenseVal.length === 0)) return false;
          const lastSignIn = resolvePathInData("signInActivity.lastSignInDateTime", item as Record<string, unknown>);
          if (lastSignIn != null) sawSignInActivity = true;
          if (lastSignIn == null) return true; // never signed in counts as stale
          const signInTime = new Date(lastSignIn as string).getTime();
          return !Number.isNaN(signInTime) && signInTime < cutoff;
        }).length;
        if (!sawSignInActivity) {
          log.warn({ targetField, sourceField }, "monitor-executor: countIfLastSignInOlderThan found no signInActivity data on any item — check may be missing $select=signInActivity on its Graph endpoint");
        }
        break;
      }
      case "groupByCount": {
        const grouped: Record<string, number> = {};
        for (const val of vals) {
          if (val == null) continue;
          const flatVals = Array.isArray(val) ? val : [val];
          for (const v of flatVals) {
            if (v == null) continue;
            const key = String(v);
            grouped[key] = (grouped[key] ?? 0) + 1;
          }
        }
        result[targetField] = grouped;
        break;
      }
      case "countDuplicates": {
        const flatVals: string[] = [];
        for (const val of vals) {
          if (val == null) continue;
          const items2 = Array.isArray(val) ? val : [val];
          for (const v of items2) {
            if (v != null) flatVals.push(String(v));
          }
        }
        const seen: Record<string, number> = {};
        for (const v of flatVals) seen[v] = (seen[v] ?? 0) + 1;
        result[targetField] = flatVals.filter(v => seen[v] > 1).length;
        break;
      }
      default:
        result[targetField] = vals.filter(v => v != null);
    }
  }

  result._itemCount = items.length;
  return result;
}

// ── Paginated Graph API fetch ─────────────────────────────────────────────────

interface PaginatedResult {
  items: unknown[];
  pageCount: number;
  rawResponse: unknown;
}

export async function graphFetchPaginated(
  tenantId: string,
  endpoint: string,
  method: string,
  requestBody?: unknown,
): Promise<PaginatedResult> {
  const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
  const items: unknown[] = [];
  let pageCount = 0;
  let rawResponse: unknown = null;

  // Resolve relative-date placeholders (e.g. {30DaysAgo}) before building the
  // URL — Graph's $filter requires a literal ISO 8601 date, not a relative
  // expression.
  const resolvedEndpoint = resolveEndpointPlaceholders(endpoint);

  // Build full URL if endpoint is a path
  let url: string = resolvedEndpoint.startsWith("http")
    ? resolvedEndpoint
    : `${GRAPH_BASE}${resolvedEndpoint.startsWith("/") ? "" : "/"}${resolvedEndpoint}`;

  while (url && pageCount < NEXT_LINK_MAX_PAGES) {
    const options: RequestInit = {
      method: method.toUpperCase(),
    };
    if (method.toUpperCase() !== "GET" && requestBody != null) {
      options.body = JSON.stringify(requestBody);
      options.headers = { "Content-Type": "application/json" };
    }
    // Advanced Graph queries (e.g. $filter against signInActivity) require this
    // header. Safe to always include on filtered GETs; Graph ignores it otherwise.
    if (method.toUpperCase() === "GET" && url.includes("$filter=")) {
      options.headers = { ...(options.headers ?? {}), ConsistencyLevel: "eventual" };
    }

    // graphFetchForTenant handles auth and consent-revoked detection
    const fullPath = url.startsWith(GRAPH_BASE) ? url.slice(GRAPH_BASE.length) : url;
    const res = await graphFetchForTenant(tenantId, fullPath, options);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Graph API error ${res.status}: ${text.slice(0, 400)}`);
    }

    type GraphPage = {
      value?: unknown[];
      "@odata.nextLink"?: string;
      [k: string]: unknown;
    };
    const page = await res.json() as GraphPage;

    if (pageCount === 0) rawResponse = page;
    pageCount++;

    if (Array.isArray(page.value)) {
      items.push(...page.value);
      url = page["@odata.nextLink"] ?? "";
    } else {
      // Non-collection response (e.g. single object): treat as one-item
      items.push(page);
      url = "";
    }
  }

  if (pageCount >= NEXT_LINK_MAX_PAGES) {
    log.warn({ tenantId, endpoint, pages: pageCount }, "monitor-executor: NEXT_LINK_MAX_PAGES safety cap reached — pagination truncated");
  }

  return { items, pageCount, rawResponse };
}

// ── License-gap → profile-flag mapping ────────────────────────────────────────
// When a Graph check fails because the tenant lacks a SKU, the tenant's own Graph
// response is definitive proof it doesn't have that feature. Emit the same falsy
// boolean flags the M365 script parser (parse-m365-script-output.ts) writes for
// script-based customers — hasAADP1orP2 / hasDefender — so buildTenantProfile()
// and the signal engine can derive a real "lacks X" upsell signal from a
// Graph-only scan (no customer-side PowerShell run required). Only definitive
// mappings are emitted; an unrecognized feature contributes no flag (the
// _licenseGapFeature marker still records what was missing).
export function licenseGapProfileFlags(feature: string): Record<string, boolean> {
  const f = feature.toLowerCase();
  if (f.includes("entra") || f.includes("premium") || f.includes("p1") || f.includes("p2") || f.includes("azure ad")) {
    return { hasAADP1orP2: false };
  }
  if (f.includes("defender")) {
    return { hasDefender: false };
  }
  return {};
}

// ── Single check executor ─────────────────────────────────────────────────────

export async function executeMonitorCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  skipIdempotency?: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId } = opts;
  const idempotencyKey = `${tenantId}:${check.key}:${triggerId}`;

  // Idempotency guard — return cached result if already collected
  if (!opts.skipIdempotency) {
    const [existing] = await db
      .select({
        profileId: tenantMonitorProfilesTable.profileId,
        status: tenantMonitorProfilesTable.status,
        extractedProperties: tenantMonitorProfilesTable.extractedProperties,
        severityMatched: tenantMonitorProfilesTable.severityMatched,
        errorMessage: tenantMonitorProfilesTable.errorMessage,
        itemCount: tenantMonitorProfilesTable.itemCount,
        pageCount: tenantMonitorProfilesTable.pageCount,
      })
      .from(tenantMonitorProfilesTable)
      .where(eq(tenantMonitorProfilesTable.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        checkKey: check.key,
        status: existing.status as CheckResult["status"],
        extractedProperties: (existing.extractedProperties ?? {}) as Record<string, unknown>,
        severityMatched: existing.severityMatched ?? null,
        errorMessage: existing.errorMessage ?? undefined,
        itemCount: existing.itemCount ?? 0,
        pageCount: existing.pageCount ?? 0,
        profileId: existing.profileId,
      };
    }
  }

  // Air-gapped / customer-script mode: flag as requires_script, don't attempt Graph fetch
  if (check.requiresCustomerScript) {
    const row = await db
      .insert(tenantMonitorProfilesTable)
      .values({
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "requires_script",
        rawResponse: null,
        extractedProperties: {},
        severityMatched: null,
        itemCount: 0,
        pageCount: 0,
      })
      .onConflictDoNothing()
      .returning({ profileId: tenantMonitorProfilesTable.profileId });

    return {
      checkKey: check.key,
      status: "requires_script",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 0,
      pageCount: 0,
      profileId: row[0]?.profileId,
    };
  }

  try {
    // 1. Paginated Graph API fetch
    const { items, pageCount, rawResponse } = await graphFetchPaginated(
      tenantId,
      check.endpoint,
      check.method ?? "GET",
      check.requestBody as unknown,
    );

    // 2. Property extraction + mapping
    const mapping = (check.mapping ?? []) as MappingRule[];
    const properties = (check.properties ?? []) as string[];
    const extracted = applyMapping(items, mapping, properties);

    // 3. Deterministic output schema validation
    if (check.outputSchema) {
      const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
      if (!valid) {
        log.warn({ checkKey: check.key, errors }, "monitor-executor: output schema validation failed");
        extracted._schemaErrors = errors;
        extracted._schemaValid = false;
      } else {
        extracted._schemaValid = true;
      }
    }

    // 4. Severity classification
    const severityRules = (check.severityRules ?? []) as SeverityRule[];
    const severityMatched = classifySeverity(severityRules, extracted);

    // 5. Persist result
    const [row] = await db
      .insert(tenantMonitorProfilesTable)
      .values({
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "ok",
        rawResponse: rawResponse as Record<string, unknown>,
        extractedProperties: extracted,
        severityMatched,
        itemCount: items.length,
        pageCount,
      })
      .onConflictDoNothing()
      .returning({ profileId: tenantMonitorProfilesTable.profileId });

    return {
      checkKey: check.key,
      status: "ok",
      extractedProperties: extracted,
      severityMatched,
      itemCount: items.length,
      pageCount,
      profileId: row?.profileId,
    };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      await markTenantConsentRevoked(tenantId);
      const [row] = await db
        .insert(tenantMonitorProfilesTable)
        .values({
          tenantId,
          checkKey: check.key,
          checkSchemaVersion: check.schemaVersion,
          triggerId,
          idempotencyKey,
          status: "consent_revoked",
          errorMessage: err.message,
          itemCount: 0,
          pageCount: 0,
        })
        .onConflictDoNothing()
        .returning({ profileId: tenantMonitorProfilesTable.profileId });

      return {
        checkKey: check.key,
        status: "consent_revoked",
        extractedProperties: {},
        severityMatched: null,
        errorMessage: err.message,
        itemCount: 0,
        pageCount: 0,
        profileId: row?.profileId,
      };
    }

    // License/feature gap — the tenant lacks the M365 SKU this check needs. This is
    // an accurate, known limitation, NOT a fault: persist it as its own status,
    // never call markTenantConsentRevoked (consent is intact), and record the
    // missing feature so downstream (findings, landing page, upsell signals) can
    // report it honestly. We also stamp the profile's extractedProperties with
    // definitive falsy license flags derived from the tenant's own Graph response
    // (e.g. hasAADP1orP2: false) — the same keys the M365 profile parser writes —
    // so buildTenantProfile()/the signal engine can key a real upsell signal off a
    // Graph-only scan without a customer-side PowerShell run.
    if (err instanceof LicenseGapError) {
      const licenseFlags = licenseGapProfileFlags(err.feature);
      const extracted: Record<string, unknown> = {
        _licenseGap: true,
        _licenseGapFeature: err.feature,
        _licenseGapCode: err.graphErrorCode ?? null,
        ...licenseFlags,
      };
      log.info(
        { checkKey: check.key, tenantId, feature: err.feature, code: err.graphErrorCode },
        "monitor-executor: check unavailable — tenant lacks required M365 license/add-on",
      );
      const [row] = await db
        .insert(tenantMonitorProfilesTable)
        .values({
          tenantId,
          checkKey: check.key,
          checkSchemaVersion: check.schemaVersion,
          triggerId,
          idempotencyKey,
          status: "license_gap",
          extractedProperties: extracted,
          errorMessage: `Requires ${err.feature}`,
          itemCount: 0,
          pageCount: 0,
        })
        .onConflictDoNothing()
        .returning({ profileId: tenantMonitorProfilesTable.profileId });

      return {
        checkKey: check.key,
        status: "license_gap",
        extractedProperties: extracted,
        severityMatched: null,
        errorMessage: `Requires ${err.feature}`,
        itemCount: 0,
        pageCount: 0,
        profileId: row?.profileId,
        licenseFeature: err.feature,
      };
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err, checkKey: check.key, tenantId }, "monitor-executor: check failed");

    const [row] = await db
      .insert(tenantMonitorProfilesTable)
      .values({
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "error",
        errorMessage: errorMessage.slice(0, 1000),
        itemCount: 0,
        pageCount: 0,
      })
      .onConflictDoNothing()
      .returning({ profileId: tenantMonitorProfilesTable.profileId });

    return {
      checkKey: check.key,
      status: "error",
      extractedProperties: {},
      severityMatched: null,
      errorMessage,
      itemCount: 0,
      pageCount: 0,
      profileId: row?.profileId,
    };
  }
}

// ── Monitoring Package executor ────────────────────────────────────────────────

export async function executeMonitoringPackage(opts: {
  packageKey: string;
  tenantId: string;
  triggerId: string;
  onProgress?: ProgressCallback;
}): Promise<PackageRunResult> {
  const { packageKey, tenantId, triggerId, onProgress } = opts;
  const startedAt = new Date().toISOString();

  // Load package
  const [pkg] = await db
    .select()
    .from(monitoringPackagesTable)
    .where(and(
      eq(monitoringPackagesTable.key, packageKey),
      eq(monitoringPackagesTable.status, "active"),
    ))
    .limit(1);

  if (!pkg) {
    return {
      packageKey,
      tenantId,
      triggerId,
      runStatus: "no_checks",
      checks: [],
      enginesRecomputed: [],
      licenseGapCount: 0,
      licenseGapFeatures: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Load checks for this package in order
  const packageChecks = await db
    .select({ checkKey: monitoringPackageChecksTable.checkKey, sortOrder: monitoringPackageChecksTable.sortOrder })
    .from(monitoringPackageChecksTable)
    .where(eq(monitoringPackageChecksTable.packageKey, packageKey))
    .orderBy(monitoringPackageChecksTable.sortOrder);

  if (packageChecks.length === 0) {
    return {
      packageKey,
      tenantId,
      triggerId,
      runStatus: "no_checks",
      checks: [],
      enginesRecomputed: [],
      licenseGapCount: 0,
      licenseGapFeatures: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const checkKeys = packageChecks.map(pc => pc.checkKey);
  const checks = await db
    .select()
    .from(monitorChecksTable)
    .where(and(
      inArray(monitorChecksTable.key, checkKeys),
      eq(monitorChecksTable.status, "active"),
    ));

  // Preserve package sort order
  const checkMap = new Map(checks.map(c => [c.key, c]));
  const orderedChecks = packageChecks
    .map(pc => checkMap.get(pc.checkKey))
    .filter((c): c is MonitorCheck => c != null);

  const results: CheckResult[] = [];
  let consentRevoked = false;
  const total = orderedChecks.length;

  for (let i = 0; i < orderedChecks.length; i++) {
    const check = orderedChecks[i]!;

    // Consent-revoked short-circuit — all remaining checks for this tenant will also fail
    if (consentRevoked) {
      const errResult: CheckResult = {
        checkKey: check.key,
        status: "consent_revoked",
        extractedProperties: {},
        severityMatched: null,
        errorMessage: "Skipped: consent was revoked on a prior check in this run",
        itemCount: 0,
        pageCount: 0,
      };
      results.push(errResult);
      onProgress?.({
        checkKey: check.key,
        checkLabel: check.label,
        status: "consent_revoked",
        index: i,
        total,
        requiresCustomerScript: check.requiresCustomerScript,
        errorMessage: errResult.errorMessage,
      });
      continue;
    }

    const result = await executeMonitorCheck({ check, tenantId, triggerId });
    results.push(result);

    if (result.status === "consent_revoked") {
      consentRevoked = true;
    }

    onProgress?.({
      checkKey: check.key,
      checkLabel: check.label,
      status: result.status,
      index: i,
      total,
      requiresCustomerScript: check.requiresCustomerScript,
      errorMessage: result.errorMessage,
    });
  }

  // Determine overall run status.
  // license_gap results are a known, accurate SKU limitation — NOT a technical
  // failure — so they never make a run "partial_failure". A run is only
  // partial_failure for genuinely-unresolved "error" results; a tenant whose only
  // non-ok results are license gaps completes honestly (unblocking doc generation).
  const hasConsentRevoked = results.some(r => r.status === "consent_revoked");
  const hasErrors = results.some(r => r.status === "error");
  const runStatus: PackageRunResult["runStatus"] = hasConsentRevoked
    ? "consent_revoked"
    : hasErrors
    ? "partial_failure"
    : "completed";

  const licenseGapResults = results.filter(r => r.status === "license_gap");
  const licenseGapFeatures = [...new Set(
    licenseGapResults.map(r => r.licenseFeature).filter((f): f is string => !!f),
  )];

  // Collect engines to recompute from both package and individual check definitions
  const enginesSet = new Set<string>();
  for (const e of (pkg.engines ?? []) as string[]) enginesSet.add(e);
  for (const check of orderedChecks) {
    for (const e of (check.engines ?? []) as string[]) enginesSet.add(e);
  }

  return {
    packageKey,
    tenantId,
    triggerId,
    runStatus,
    checks: results,
    enginesRecomputed: [...enginesSet],
    licenseGapCount: licenseGapResults.length,
    licenseGapFeatures,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

// ── Monitoring engine compute (for EngineDef contract) ────────────────────────

export interface MonitoringEngineOutput {
  engine: "monitoring";
  results: CheckResult[];
  breakdown: {
    total: number;
    ok: number;
    error: number;
    requiresScript: number;
    consentRevoked: number;
    licenseGap: number;
    coverage: number;
    failures: string[];
  };
  logs: string[];
  debug: Record<string, unknown>;
  timestamp: string;
}

export async function computeMonitoringEngine(customerId: number): Promise<MonitoringEngineOutput> {
  // Resolve tenant GUID from customer ID
  const [customer] = await db
    .select({ tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  const resolvedTenantId = customer?.tenantId ?? String(customerId);

  // Fetch recent profile rows for this tenant (last run per check key)
  const rows = await db
    .select({
      checkKey: tenantMonitorProfilesTable.checkKey,
      status: tenantMonitorProfilesTable.status,
      severityMatched: tenantMonitorProfilesTable.severityMatched,
      errorMessage: tenantMonitorProfilesTable.errorMessage,
      itemCount: tenantMonitorProfilesTable.itemCount,
      pageCount: tenantMonitorProfilesTable.pageCount,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(eq(tenantMonitorProfilesTable.tenantId, resolvedTenantId))
    .orderBy(tenantMonitorProfilesTable.collectedAt);

  const latestByCheck = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    latestByCheck.set(row.checkKey, row);
  }
  const results: CheckResult[] = [...latestByCheck.values()].map(r => ({
    checkKey: r.checkKey,
    status: r.status as CheckResult["status"],
    extractedProperties: {},
    severityMatched: r.severityMatched ?? null,
    errorMessage: r.errorMessage ?? undefined,
    itemCount: r.itemCount ?? 0,
    pageCount: r.pageCount ?? 0,
  }));

  const total = results.length;
  const ok = results.filter(r => r.status === "ok").length;
  const error = results.filter(r => r.status === "error").length;
  const requiresScript = results.filter(r => r.status === "requires_script").length;
  const consentRevoked = results.filter(r => r.status === "consent_revoked").length;
  const licenseGap = results.filter(r => r.status === "license_gap").length;
  const covered = ok + requiresScript;
  const coverage = total > 0 ? Math.round((covered / total) * 100) : 0;
  // license_gap is NOT a failure — it's a known SKU limitation, so it stays out
  // of the failures list (only genuine errors + consent revocations are failures).
  const failures = results.filter(r => r.status === "error" || r.status === "consent_revoked").map(r => r.checkKey);

  return {
    engine: "monitoring",
    results,
    breakdown: { total, ok, error, requiresScript, consentRevoked, licenseGap, coverage, failures },
    logs: [],
    debug: { customerId, checksEvaluated: total },
    timestamp: new Date().toISOString(),
  };
}

export function computeMonitoringEngineForPayload(): MonitoringEngineOutput {
  return {
    engine: "monitoring",
    results: [],
    breakdown: { total: 0, ok: 0, error: 0, requiresScript: 0, consentRevoked: 0, licenseGap: 0, coverage: 0, failures: [] },
    logs: ["Payload mode: no historical monitor profiles to evaluate"],
    debug: { payloadMode: true },
    timestamp: new Date().toISOString(),
  };
}
