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

// ── Fan-out (group-scoped) execution tuning ───────────────────────────────────
// These govern the ADDITIVE fan-out path only (checks with a `fanOutSource`);
// no non-fan-out check ever reaches this code.

/**
 * Default cap on how many enumerated items (e.g. groups) a single fan-out check
 * will scan. A large tenant can have hundreds of groups; iterating every one is
 * real, sustained Graph load, so the fan-out is bounded by default. When the cap
 * is hit the result records `_fanOut.truncated = true` and logs a warning — the
 * coverage is never silently curtailed. Overridable per check via
 * `monitor_checks.fan_out_max_items`.
 */
const FAN_OUT_MAX_ITEMS_DEFAULT = 500;

/**
 * How many per-item requests run concurrently. Kept deliberately small: fanning
 * 500 groups out all at once would guarantee Graph 429s. Four in flight is a
 * sustainable trickle that still finishes a large tenant in reasonable time, and
 * each request additionally backs off on its own 429 (see throttleRetry below).
 */
const FAN_OUT_CONCURRENCY = 4;

/** Per-item 429 retry budget and base backoff. Honors Graph's Retry-After header. */
const FAN_OUT_MAX_RETRIES_ON_429 = 4;
const FAN_OUT_RETRY_BASE_DELAY_MS = 1000;

/** Max distinct per-item failure messages retained on the result for diagnosis. */
const FAN_OUT_SAMPLE_ERROR_LIMIT = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How much of a failed Graph response body is kept in the error message.
 *
 * Raised from 400 during the Phase 4 audit of what is actually available to
 * classify against. The classifier's single most valuable output is the REAL
 * named permission out of a 403 ("Required permission: SecurityEvents.Read.All"),
 * and the workloads that nest their error JSON inside an outer Graph error —
 * Intune and the Defender/security endpoints do exactly this — push that phrase
 * past 400 characters, where it was being cut off. The message is stored in a
 * plain `text` column on simulator_check_runs, so there is no storage reason for
 * the tighter bound. (The separate 1000-char slice on the tenant_monitor_profiles
 * row below is unchanged — that is the production monitoring record, not the
 * simulator's diagnostic copy.)
 */
const GRAPH_ERROR_BODY_CAPTURE_CHARS = 1200;

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
  status: "ok" | "error" | "consent_revoked" | "requires_script" | "license_gap" | "partial";
  extractedProperties: Record<string, unknown>;
  severityMatched: string | null;
  errorMessage?: string;
  itemCount: number;
  pageCount: number;
  profileId?: string;
  /** For status "license_gap": the customer-safe name of the missing M365 add-on. */
  licenseFeature?: string;
  /**
   * The FULL fetched item list, returned only when the caller passes
   * `includeItems: true` (the Simulator Studio's engine trace).
   *
   * This exists because the persisted `tenant_monitor_profiles.rawResponse` is
   * NOT a faithful basis for re-running `applyMapping`: `graphFetchPaginated`
   * stores only the FIRST page (`if (pageCount === 0) rawResponse = page`), and
   * for a CSV usage report only the first five rows
   * (`value: csvRows.slice(0, 5)`). Re-applying a mapping to that truncated
   * snapshot would silently produce wrong counts on every paginated or CSV
   * check — exactly the kind of plausible-but-wrong number the trace view
   * exists to eliminate. Scheduled package runs leave this undefined, so no
   * extra memory is retained on the hot path.
   */
  items?: unknown[];
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

/**
 * Identity placeholders a check endpoint may contain. Unlike {NDaysAgo} these
 * can't be resolved from the clock — they need the tenant GUID, which is only
 * known at execution time. `{id}`/`{tenantId}`/`{organizationId}` all resolve to
 * the same value: Graph's organization id IS the AAD tenant id.
 *
 * This exists because endpoints are authored as DATA in monitor_checks.endpoint,
 * so an endpoint like `/organization/{id}/branding` (the documented v1.0 shape —
 * the {id} segment is mandatory, there is no `me`/`default` alias) previously
 * went to Graph with the literal braces still in it and came back
 * "Invalid object identifier '{id}'".
 */
const IDENTITY_PLACEHOLDER_RE = /\{(id|tenantId|organizationId)\}/g;

/**
 * The per-item placeholder used ONLY by the fan-out execution path. It is
 * deliberately a distinct token from the tenant-identity `{id}`/`{tenantId}`:
 * `{itemId}` is substituted with the id of the CURRENT enumerated item (e.g. one
 * group's GUID), which changes on every per-item request, whereas the identity
 * placeholders resolve once to the fixed tenant GUID. Keeping them separate is
 * what lets a fan-out endpoint carry both — e.g. a template scoped to one group
 * within one tenant — without the two substitutions colliding.
 */
const ITEM_ID_PLACEHOLDER_RE = /\{itemId\}/g;

/**
 * Resolves the placeholder tokens a monitor check's stored endpoint may contain.
 *
 * `tenantId` is optional so existing callers (and the date-only tests) are
 * unaffected; when it's absent, identity placeholders are deliberately left
 * as-is rather than substituted with an empty string, which would silently
 * produce a wrong-but-plausible URL like `/organization//branding`.
 *
 * `itemId` is the fan-out per-item id. It's optional and independent of tenantId:
 * when present, `{itemId}` tokens are substituted with it. Absent (every
 * non-fan-out call), `{itemId}` is left as-is — the same fail-loud-not-silent
 * rule the identity placeholders follow, so a fan-out template accidentally run
 * through the normal path produces a visibly-wrong URL rather than a plausible one.
 */
export function resolveEndpointPlaceholders(endpoint: string, tenantId?: string, itemId?: string): string {
  const withDates = endpoint.replace(DATE_PLACEHOLDER_RE, (_match, days: string) => {
    const n = Number(days);
    const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    return d.toISOString();
  });
  const withItem = itemId != null
    ? withDates.replace(ITEM_ID_PLACEHOLDER_RE, itemId)
    : withDates;
  if (!tenantId) return withItem;
  return withItem.replace(IDENTITY_PLACEHOLDER_RE, tenantId);
}

function stripParam(url: string, prefixRegex: RegExp): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const kept = query.split("&").filter((part) => !prefixRegex.test(part));
  if (kept.length === 0) return base;
  return `${base}?${kept.join("&")}`;
}

export function appendQueryParams(url: string, selectParams?: string | null, filterParams?: string | null): string {
  let finalUrl = url;
  if (selectParams !== undefined && selectParams !== null && selectParams.trim() !== "") {
    finalUrl = stripParam(finalUrl, /^\$select=/i);
    const trimmed = selectParams.trim().replace(/^[?&]/, "").replace(/^\$select=/i, "");
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl += `${sep}$select=${trimmed}`;
  }
  if (filterParams !== undefined && filterParams !== null && filterParams.trim() !== "") {
    finalUrl = stripParam(finalUrl, /^\$filter=/i);
    let trimmed = filterParams.trim().replace(/^[?&]/, "").replace(/^\$filter=/i, "");
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {}
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl += `${sep}$filter=${encodeURIComponent(trimmed)}`;
  }
  return finalUrl;
}

// ── Microsoft 365 usage-report (CSV) responses ────────────────────────────────
// The /reports/getXxx(period='D7') family does NOT return JSON. Per Microsoft's
// documented contract it returns 302 → a short-lived, pre-authenticated
// reports.office.com download URL whose body is CSV. Node's fetch follows that
// redirect transparently, so the executor sees a 200 whose body is CSV text and
// blindly called res.json() on it — producing the real observed failure
// `Unexpected token 'R', "Report Ref"... is not valid JSON` ("Report Refresh
// Date" is the first CSV column header). Parsing it as CSV is the fix; the rows
// then flow through applyMapping exactly like Graph JSON items.

/** True when a Graph response is a usage-report CSV rather than JSON. */
export function isCsvReportResponse(contentType: string | null, body: string): boolean {
  if (contentType && /text\/csv|application\/octet-stream/i.test(contentType)) return true;
  // Content-Type isn't always trustworthy on the redirected download; fall back
  // to the report's own signature first column.
  return /^﻿?"?Report Refresh Date"?,/i.test(body.trimStart());
}

/**
 * Minimal RFC-4180 CSV → array-of-objects parser (quoted fields, embedded commas,
 * doubled "" escapes, CRLF). Deliberately local and dependency-free: the only
 * CSV this platform ingests is Microsoft's own well-formed report output.
 */
export function parseCsvReport(csv: string): Record<string, string>[] {
  const text = csv.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const [header, ...dataRows] = rows;
  if (!header) return [];
  return dataRows
    .filter(r => r.some(c => c.trim() !== ""))
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
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

/**
 * Opt-in throttle handling for a single paginated fetch. ONLY the fan-out path
 * passes this. When absent (every existing caller — scheduled package runs,
 * simulator runs, the date-only tests), the loop below is byte-for-byte the same
 * as before: a 429 falls straight through to the generic `!res.ok` throw. When
 * present, a 429 is retried up to `maxRetries` times, waiting the server's
 * Retry-After (seconds) if given, otherwise an exponential backoff off
 * `baseDelayMs`. This keeps the shared one-check-one-URL semantics untouched
 * while giving the fan-out the throttle resilience its per-group hammering needs.
 */
export interface ThrottleRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export async function graphFetchPaginated(
  tenantId: string,
  endpoint: string,
  method: string,
  requestBody?: unknown,
  fetchOpts?: { throttleRetry?: ThrottleRetryOptions },
): Promise<PaginatedResult> {
  const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
  const items: unknown[] = [];
  let pageCount = 0;
  let rawResponse: unknown = null;
  const throttleRetry = fetchOpts?.throttleRetry;
  let throttleAttempts = 0;

  // Resolve placeholders before building the URL: relative dates (e.g.
  // {30DaysAgo}) because Graph's $filter requires a literal ISO 8601 date rather
  // than a relative expression, and identity tokens ({id}/{tenantId}) because
  // paths like /organization/{id}/branding require the real tenant GUID inline.
  const resolvedEndpoint = resolveEndpointPlaceholders(endpoint, tenantId);

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
    // /security/alerts_v2's detectionSource/serviceSource are evolvable enums —
    // newer members (e.g. microsoftInsiderRiskManagement) come back as
    // unknownFutureValue unless the request opts in via this header. Scoped to
    // this one endpoint rather than sent on every GET, since it's only meaningful
    // there; safe to always include on it, Graph ignores it for older members.
    if (method.toUpperCase() === "GET" && url.includes("/security/alerts_v2")) {
      options.headers = { ...(options.headers ?? {}), Prefer: "include-unknown-enum-members" };
    }

    // graphFetchForTenant handles auth and consent-revoked detection
    const fullPath = url.startsWith(GRAPH_BASE) ? url.slice(GRAPH_BASE.length) : url;
    const res = await graphFetchForTenant(tenantId, fullPath, options);

    // Throttle handling — opt-in (fan-out only). A 429 with retries remaining is
    // waited-out and retried against the SAME url (pageCount/url not advanced), so
    // pagination resumes exactly where it throttled. Default callers never set
    // throttleRetry, so this whole block is skipped and a 429 hits the generic
    // throw below, preserving the pre-existing behavior for every other check.
    if (res.status === 429 && throttleRetry && throttleAttempts < throttleRetry.maxRetries) {
      throttleAttempts++;
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterSec = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
      const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec >= 0
        ? retryAfterSec * 1000
        : throttleRetry.baseDelayMs * Math.pow(2, throttleAttempts - 1);
      await res.text().catch(() => "");
      log.warn(
        { tenantId, endpoint, attempt: throttleAttempts, delayMs, retryAfter: retryAfterHeader },
        "monitor-executor: Graph 429 throttled — backing off and retrying (fan-out)",
      );
      await sleep(delayMs);
      continue; // retry same url
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Graph API error ${res.status}: ${text.slice(0, GRAPH_ERROR_BODY_CAPTURE_CHARS)}`);
    }

    // Usage-report endpoints answer with CSV (via a followed 302), not JSON.
    // Read the body as text once and decide, so a CSV body is never handed to
    // JSON.parse. CSV reports are single-shot — they have no @odata.nextLink —
    // so this terminates the pagination loop.
    const bodyText = await res.text();
    if (isCsvReportResponse(res.headers.get("content-type"), bodyText)) {
      const csvRows = parseCsvReport(bodyText);
      pageCount++;
      if (rawResponse == null) {
        rawResponse = { _format: "csv", _rowCount: csvRows.length, value: csvRows.slice(0, 5) };
      }
      items.push(...csvRows);
      break;
    }

    type GraphPage = {
      value?: unknown[];
      "@odata.nextLink"?: string;
      [k: string]: unknown;
    };
    let page: GraphPage;
    try {
      page = JSON.parse(bodyText) as GraphPage;
    } catch {
      // A non-JSON, non-CSV 200 body is a real anomaly worth surfacing verbatim
      // rather than crashing with a bare JSON.parse SyntaxError — e.g. the raw
      // IIS "Service Unavailable" HTML some Intune endpoints return.
      throw new Error(
        `Graph API returned a non-JSON body (content-type: ${res.headers.get("content-type") ?? "none"}): ${bodyText.slice(0, GRAPH_ERROR_BODY_CAPTURE_CHARS)}`,
      );
    }

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

/**
 * Every merged-profile key `licenseGapProfileFlags` can stamp — the runtime
 * (non-mapping) profile-key producer that any Graph check in a package can
 * trigger by hitting a LicenseGapError. `licenseGapProfileFlags` builds its
 * returns FROM this constant so the two can never drift; pillar-coverage.ts
 * imports it to count these keys as producible by any package containing at
 * least one Graph (non-script) check.
 */
export const LICENSE_GAP_PROFILE_FLAG_KEYS = ["hasAADP1orP2", "hasDefender"] as const;

export function licenseGapProfileFlags(feature: string): Record<string, boolean> {
  const [ENTRA_KEY, DEFENDER_KEY] = LICENSE_GAP_PROFILE_FLAG_KEYS;
  const f = feature.toLowerCase();
  if (f.includes("entra") || f.includes("premium") || f.includes("p1") || f.includes("p2") || f.includes("azure ad")) {
    return { [ENTRA_KEY]: false };
  }
  if (f.includes("defender")) {
    return { [DEFENDER_KEY]: false };
  }
  return {};
}

// ── Fan-out (group-scoped) check executor ─────────────────────────────────────
//
// Runs a check whose target endpoint has no tenant-wide form and must instead be
// issued once per enumerated entity (PIM for Groups eligibilitySchedules needs a
// groupId $filter; Planner /plans needs an owner group id). The shape deliberately
// GENERALISES across both real use cases rather than hard-coding either:
//
//   1. Enumerate `fanOutSource` (e.g. /groups) with full @odata.nextLink paging —
//      a large tenant's hundreds of groups are NOT assumed to fit one page.
//   2. Issue the check's own `endpoint` once per item, substituting the item id
//      into `{itemId}`, with bounded concurrency + per-request 429 backoff.
//   3. Aggregate:
//        • the check's normal `mapping`/`properties` run over the FLATTENED union
//          of every per-item response — this yields the cross-group ROLLUP totals
//          (Planner's "total plans/tasks across the tenant"); and
//        • `_fanOut.sourceItemsWithResults` yields the count of ENUMERATED ITEMS
//          that returned ≥1 result (PIM's "groups with eligible assignments").
//      Both metrics are always present; each check's severity rules read whichever
//      one is its primary signal. This is why the two use cases share one path.
//   4. Report partial coverage honestly (see the `partial` status).
//
// Consent revocation and license gaps are tenant-wide conditions, so a per-item
// occurrence THROWS out to executeMonitorCheck's existing catch, which owns the
// auto-revoke + license_gap persistence — this path never duplicates that logic.
async function runFanOutCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;
  const throttleRetry: ThrottleRetryOptions = {
    maxRetries: FAN_OUT_MAX_RETRIES_ON_429,
    baseDelayMs: FAN_OUT_RETRY_BASE_DELAY_MS,
  };
  const idField = check.fanOutItemIdField ?? "id";
  const maxItems = check.fanOutMaxItems ?? FAN_OUT_MAX_ITEMS_DEFAULT;

  // 1. Enumerate the source list. Any throw here (consent/license/generic) is
  //    deliberately allowed to propagate to executeMonitorCheck's catch.
  const enumResult = await graphFetchPaginated(
    tenantId,
    check.fanOutSource!,
    "GET",
    undefined,
    { throttleRetry },
  );

  const allIds = enumResult.items
    .map((it) => (typeof it === "object" && it !== null
      ? (it as Record<string, unknown>)[idField]
      : undefined))
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const truncated = allIds.length > maxItems;
  const ids = truncated ? allIds.slice(0, maxItems) : allIds;
  if (truncated) {
    log.warn(
      { checkKey: check.key, tenantId, enumerated: allIds.length, cap: maxItems },
      "monitor-executor: fan-out item cap reached — scanning first N, coverage truncated (recorded in _fanOut.truncated)",
    );
  }

  // 2. Per-item fan-out, bounded concurrency. Each worker NEVER rejects — it tags
  //    its outcome — so one item's failure can't take the batch down.
  const combinedItems: unknown[] = [];
  let succeeded = 0;
  let failed = 0;
  let withResults = 0;
  let perItemPageTotal = 0;
  let licenseGapCount = 0;
  const sampleErrors: Array<{ itemId: string; message: string }> = [];
  let consentErr: ConsentRevokedError | null = null;
  let licenseErr: LicenseGapError | null = null;

  const recordError = (itemId: string, message: string) => {
    failed++;
    if (sampleErrors.length < FAN_OUT_SAMPLE_ERROR_LIMIT) sampleErrors.push({ itemId, message });
  };

  // Stop early on consent (auth-level, tenant-fatal) or on a license gap while
  // nothing has succeeded yet (a tenant-wide missing SKU — no point hammering
  // every remaining group to re-learn the tenant lacks the add-on).
  for (
    let i = 0;
    i < ids.length && !consentErr && !(licenseErr && succeeded === 0);
    i += FAN_OUT_CONCURRENCY
  ) {
    const batch = ids.slice(i, i + FAN_OUT_CONCURRENCY);
    const outcomes = await Promise.all(batch.map(async (id) => {
      try {
        // Substitute {itemId} here; graphFetchPaginated still resolves the tenant
        // identity + date placeholders and prepends the Graph base.
        const perItemEndpoint = appendQueryParams(
          resolveEndpointPlaceholders(check.endpoint, undefined, id),
          check.selectParams,
          check.filterParams,
        );
        const r = await graphFetchPaginated(
          tenantId,
          perItemEndpoint,
          check.method ?? "GET",
          check.requestBody as unknown,
          { throttleRetry },
        );
        return { id, ok: true as const, items: r.items, pageCount: r.pageCount };
      } catch (e) {
        return { id, ok: false as const, error: e };
      }
    }));

    for (const o of outcomes) {
      if (o.ok) {
        succeeded++;
        perItemPageTotal += o.pageCount;
        if (o.items.length > 0) withResults++;
        combinedItems.push(...o.items);
        continue;
      }
      const e = o.error;
      if (e instanceof ConsentRevokedError) { consentErr = e; continue; }
      if (e instanceof LicenseGapError) {
        licenseErr ??= e;
        licenseGapCount++;
        // Only counted as a hard failure once we know it isn't the pure-SKU-wall
        // case (handled by the throw below); recorded for transparency regardless.
        if (sampleErrors.length < FAN_OUT_SAMPLE_ERROR_LIMIT) {
          sampleErrors.push({ itemId: o.id, message: `license_gap: ${e.feature}` });
        }
        continue;
      }
      recordError(o.id, e instanceof Error ? e.message : String(e));
    }
  }

  // Tenant-wide conditions → hand back to the shared catch, which owns auto-revoke
  // and the license_gap persistence contract.
  if (consentErr) throw consentErr;
  if (licenseErr && succeeded === 0 && failed === 0) throw licenseErr;

  // 3. Aggregate. Mapping/properties run over the flattened union (cross-item
  //    rollup); _fanOut carries the per-source-item coverage picture.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(combinedItems, mapping, properties);
  extracted._fanOut = {
    source: check.fanOutSource,
    itemIdField: idField,
    sourceItemsTotal: allIds.length,
    sourceItemsScanned: ids.length,
    sourceItemsSucceeded: succeeded,
    sourceItemsFailed: failed,
    sourceItemsWithResults: withResults,
    combinedItemCount: combinedItems.length,
    licenseGapCount,
    truncated,
    sourcePageCount: enumResult.pageCount,
    perItemPageCount: perItemPageTotal,
    sampleErrors,
  };

  // 4. Honest status. Never "ok" over real per-item failures; never "error" when
  //    real aggregate data WAS collected.
  let status: CheckResult["status"];
  if (ids.length === 0) {
    status = "ok"; // zero enumerated items — an honest empty tenant, not a fault
  } else if (succeeded === 0) {
    status = "error"; // scanned items, none yielded data (and not the pure-SKU case)
  } else if (failed === 0 && licenseGapCount === 0) {
    status = "ok";
  } else {
    status = "partial"; // real data collected, but coverage was incomplete
  }

  // Schema validation (same contract as the normal path).
  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: fan-out output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatched = classifySeverity(severityRules, extracted);

  const pageCount = enumResult.pageCount + perItemPageTotal;
  const rawResponse = {
    _format: "fanOut",
    _fanOut: extracted._fanOut,
    sourceSample: enumResult.items.slice(0, 5),
  };

  const [row] = await db
    .insert(tenantMonitorProfilesTable)
    .values({
      tenantId,
      checkKey: check.key,
      checkSchemaVersion: check.schemaVersion,
      triggerId,
      idempotencyKey,
      status,
      rawResponse: rawResponse as Record<string, unknown>,
      extractedProperties: extracted,
      severityMatched,
      errorMessage: status === "ok"
        ? undefined
        : `Fan-out coverage: ${succeeded}/${ids.length} ${idField === "id" ? "items" : idField} succeeded, ${failed} failed${licenseGapCount ? `, ${licenseGapCount} license-gapped` : ""}${truncated ? ` (capped at ${maxItems})` : ""}`,
      itemCount: combinedItems.length,
      pageCount,
    })
    .onConflictDoNothing()
    .returning({ profileId: tenantMonitorProfilesTable.profileId });

  log.info(
    { checkKey: check.key, tenantId, status, ...extracted._fanOut as Record<string, unknown> },
    "monitor-executor: fan-out check completed",
  );

  return {
    checkKey: check.key,
    status,
    extractedProperties: extracted,
    severityMatched,
    errorMessage: status === "ok" ? undefined : `${succeeded}/${ids.length} items succeeded, ${failed} failed`,
    itemCount: combinedItems.length,
    pageCount,
    profileId: row?.profileId,
    ...(opts.includeItems ? { items: combinedItems } : {}),
  };
}

// ── Single check executor ─────────────────────────────────────────────────────

export async function executeMonitorCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  skipIdempotency?: boolean;
  /**
   * Return the full fetched item list on the result (see `CheckResult.items`).
   * Off by default so scheduled package runs keep their current memory profile;
   * the Simulator Studio's engine trace opts in because it must re-apply the
   * real mapping to the real, untruncated response.
   */
  includeItems?: boolean;
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
    // Fan-out (group-scoped) checks take an entirely separate, additive path.
    // Enumeration-level consent/license/generic errors it throws are caught by
    // this same try/catch below, so the auto-revoke + license_gap persistence
    // contract is shared, not duplicated. Non-fan-out checks (fanOutSource NULL —
    // every existing check) fall straight through to the unchanged path.
    if (check.fanOutSource) {
      return await runFanOutCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems });
    }

    const finalEndpoint = appendQueryParams(check.endpoint, check.selectParams, check.filterParams);

    // 1. Paginated Graph API fetch
    const { items, pageCount, rawResponse } = await graphFetchPaginated(
      tenantId,
      finalEndpoint,
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
      ...(opts.includeItems ? { items } : {}),
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
  // A fan-out check that returned status "partial" collected real data but had
  // per-item failures — it counts toward the run's partial_failure state exactly
  // like a hard "error", so the run never reads as a clean "completed" over it.
  const hasConsentRevoked = results.some(r => r.status === "consent_revoked");
  const hasErrors = results.some(r => r.status === "error" || r.status === "partial");
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
    /** Fan-out checks that returned real data but with incomplete per-item coverage. */
    partial: number;
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
  const partial = results.filter(r => r.status === "partial").length;
  // A "partial" fan-out produced real data but with incomplete coverage, so it is
  // deliberately NOT counted toward full coverage (that would overstate it) yet
  // also NOT a full failure (real data was collected). It surfaces as its own line.
  const covered = ok + requiresScript;
  const coverage = total > 0 ? Math.round((covered / total) * 100) : 0;
  // license_gap is NOT a failure — it's a known SKU limitation, so it stays out
  // of the failures list (only genuine errors + consent revocations are failures).
  const failures = results.filter(r => r.status === "error" || r.status === "consent_revoked").map(r => r.checkKey);

  return {
    engine: "monitoring",
    results,
    breakdown: { total, ok, error, requiresScript, consentRevoked, licenseGap, partial, coverage, failures },
    logs: [],
    debug: { customerId, checksEvaluated: total },
    timestamp: new Date().toISOString(),
  };
}

export function computeMonitoringEngineForPayload(): MonitoringEngineOutput {
  return {
    engine: "monitoring",
    results: [],
    breakdown: { total: 0, ok: 0, error: 0, requiresScript: 0, consentRevoked: 0, licenseGap: 0, partial: 0, coverage: 0, failures: [] },
    logs: ["Payload mode: no historical monitor profiles to evaluate"],
    debug: { payloadMode: true },
    timestamp: new Date().toISOString(),
  };
}
