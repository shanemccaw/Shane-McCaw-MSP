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
  tenantsTable,
  type MonitorCheck,
  type MonitoringPackage,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError, LicenseGapError, markTenantConsentRevoked, getInitialDomainForTenant } from "./graph";
import { callPsExecution, PsExecutionError } from "./ps-execution-client";
import {
  getTenantSharingCapability,
  sharePointAdminCredentialsPresent,
  SharingCapability,
  type SharePointTenantRef,
} from "./sharepoint-admin";
import { normalizeSiteSharing, SHAREPOINT_SITE_SHARING_NORMALIZER } from "./sharepoint-sharing";
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

/**
 * Reshapes ONE enumerated source item's per-item results before they join the
 * fan-out's flattened union.
 *
 * The default fan-out flattens every per-item response into one anonymous bag,
 * which is right when the aggregate IS the answer (PIM's total eligible
 * assignments across all groups). It is wrong when the answer is per-source-item
 * — "which SharePoint sites are overshared, by name and URL" — because the bag
 * has thrown away which site each child object came from. A normalizer receives
 * the source item alongside its results and can emit one row per source item
 * instead, so the check's ordinary mapping rules count SOURCE ITEMS and the
 * full-item detail collector persists a list that can actually be read back.
 */
export type FanOutItemNormalizer = (
  sourceItem: Record<string, unknown>,
  perItemResults: unknown[],
) => unknown[];

/**
 * The code-owned normalizer registry. `monitor_checks.fan_out_item_normalizer`
 * stores a KEY into this table and nothing else — never a script, never an
 * expression — the same contract `ps_cmdlet_key` follows against the ps
 * container's own cmdlet allowlist. An unknown key is a hard error at execution
 * time rather than a silent fall-back to raw flattening, because the two
 * produce completely different item shapes and a silent fall-back would hand a
 * document a bag of permission objects while every count read zero.
 */
export const FAN_OUT_ITEM_NORMALIZERS: Record<string, FanOutItemNormalizer> = {
  [SHAREPOINT_SITE_SHARING_NORMALIZER]: normalizeSiteSharing,
};

function resolveFanOutItemNormalizer(key: string | null | undefined): FanOutItemNormalizer | null {
  if (!key) return null;
  const normalizer = FAN_OUT_ITEM_NORMALIZERS[key];
  if (!normalizer) {
    throw new Error(
      `monitor check declares fan_out_item_normalizer "${key}", which is not in the code-owned registry ` +
      `(${Object.keys(FAN_OUT_ITEM_NORMALIZERS).join(", ") || "empty"})`,
    );
  }
  return normalizer;
}

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
   * "count" | "exists" | "first" | "join" | "none" | "raw" | "countTruthy"
   * | "countFalse" | "countEmptyArray" | "groupByCount" | "countDuplicates"
   * | "countEquals('value')" | "countIfLastSignInOlderThan(N)"
   * | "valueWhere('matchField','matchValue'[,'extractField'])"
   * | "flattenValues('field')" | "countDuplicatesBy('field')"
   * | "countWhere('<condition expression>')" — the
   * parameterised forms carry their argument inline in the string since
   * MappingRule is stored as jsonb; parsed at runtime.
   *
   * Anything NOT in this list falls through to the default branch and produces a
   * raw array of values, which no numeric signal rule can read. That failure is
   * silent by construction (the vocabulary is data, not a TS union), so the
   * default branch warns — see KNOWN_TRANSFORMS.
   */
  transform?: string;
}

/**
 * The real transform vocabulary `applyMapping` implements, used ONLY to warn
 * when a stored check names something outside it.
 *
 * This exists because `monitor_checks.mapping` is authored as jsonb data: a typo
 * or an aspirational transform name ("countEmpty" when the implemented name is
 * "countEmptyArray") does not fail — it lands in the default branch, emits a raw
 * array, and the downstream resolver quietly drops to `_itemCount`. That is the
 * exact silent-and-plausible failure this platform's audits keep rediscovering
 * by hand. The set is deliberately not enforced (no throw): an unknown transform
 * still produces the same value it produces today, so this adds a diagnostic
 * without changing any currently-working check's behaviour.
 */
const KNOWN_TRANSFORMS = new Set([
  "none", "count", "exists", "first", "join", "raw",
  "countTruthy", "countFalse", "countEmptyArray",
  "countEquals", "countIfLastSignInOlderThan",
  "groupByCount", "countDuplicates",
  "valueWhere", "flattenValues", "countDuplicatesBy",
  "countWhere",
]);

/**
 * sourceField spellings that mean "the fetched item itself, whole" rather than
 * a property to read off it.
 *
 * `raw` and `countWhere` are the only transforms that can operate on the WHOLE
 * item, and a jsonb mapping rule has nowhere to say so except in sourceField.
 * These are the spellings real stored rules use for that: an empty/absent
 * sourceField, the OData envelope key the items were already unwrapped out of
 * ("value"), or an explicit self-reference.
 */
const WHOLE_ITEM_SOURCE_FIELDS = new Set(["", ".", "*", "item", "items", "value", "value[]"]);

/**
 * Item count above which a whole-item `raw` pass-through warns.
 *
 * Nothing is truncated — `raw` exists to carry the real objects, and silently
 * dropping some of them would be exactly the plausible-but-wrong result this
 * platform keeps rediscovering. But `extractedProperties` is persisted as jsonb
 * per tenant per run, so a `raw` over every user in a large tenant writes a very
 * large row on every scan. That is worth saying out loud once per run rather
 * than discovering from a table size.
 */
const RAW_WHOLE_ITEM_WARN_THRESHOLD = 500;

/**
 * Internal sentinel for "a parameterised transform this file implements, named
 * with arguments it cannot parse". Deliberately not a shape any stored jsonb
 * rule would ever author, so it can never collide with a real transform name.
 */
const MALFORMED_PARAMS = "__malformedParams__";

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
  /**
   * The severity band this check's own configured severity_rules matched, if
   * any — the second half of what `classifyCheckSeverity` (diagnostics-runner)
   * needs to know a check's finding severity (#245). Without it a live
   * consumer can only see checks that outright failed, and a check that
   * returned status "ok" while matching a real critical severity rule — a
   * genuine finding — is invisible until the run's findings are persisted at
   * the very end. Carried through to the run's SSE stream so the telemetry
   * page's Top Discrepancies can reflect real findings AS they happen.
   */
  severityMatched?: string | null;
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

/**
 * The tenant-identity placeholders a PowerShell-backed check's `psParams` may
 * contain. Mirrors `resolveEndpointPlaceholders`'s identity-token idea, but
 * applied to a params object instead of a URL string, per #209's design.
 * `{organization}` resolves to the tenant's onmicrosoft.com/verified domain
 * (`tenants.domain`) — the value Connect-IPPSSession's `-Organization`
 * parameter expects — falling back to the AAD tenant GUID when no domain is
 * on file, rather than silently substituting an empty string.
 */
const PS_PARAM_PLACEHOLDER_RE = /\{(organization|tenantId)\}/g;

/**
 * Reuses the same `{NDaysAgo}` relative-date token `resolveEndpointPlaceholders`
 * already resolves for Graph endpoint strings (#212). Some cmdlets behind the
 * PS execution path — e.g. `Export-ActivityExplorerData` for
 * `compliance:dlp-incidents` — take mandatory literal `StartTime`/`EndTime`
 * values with no relative-date syntax of their own, so `psParams` needs the
 * same substitution `endpoint` already gets, applied to a params object
 * instead of a URL string.
 */
const PS_PARAM_DATE_PLACEHOLDER_RE = /\{(\d+)DaysAgo\}/g;

export function resolvePsParamsPlaceholders(
  params: Record<string, unknown> | null | undefined,
  organization: string,
  tenantId: string,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value !== "string") {
      resolved[key] = value;
      continue;
    }
    const withDates = value.replace(PS_PARAM_DATE_PLACEHOLDER_RE, (_match, days: string) => {
      const n = Number(days);
      return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
    });
    resolved[key] = withDates.replace(
      PS_PARAM_PLACEHOLDER_RE,
      (_match, token: string) => (token === "organization" ? organization : tenantId),
    );
  }
  return resolved;
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

/**
 * The ONE place a monitor expression is allowed to touch the clock.
 *
 * Parses a value that is supposed to be a real Graph timestamp into epoch ms,
 * returning null for anything it cannot vouch for. The ISO-prefix guard is not
 * decoration: `new Date("5")` is a VALID date in V8 (2001-05-01), so a bare
 * `new Date(x)` on a malformed or wrong-typed nested field would silently
 * manufacture a timestamp and fire — or fail to fire — a severity rule against
 * a date the tenant never reported. Every date Graph emits is ISO 8601, so
 * requiring that shape costs nothing real and makes garbage fail closed.
 *
 * Bare numbers are deliberately rejected rather than treated as epoch values:
 * a number in a date field is ambiguous (epoch ms? epoch s? a year?) and
 * guessing is exactly the plausible-but-wrong behaviour this rejects.
 */
const ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function parseTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!ISO_DATE_PREFIX_RE.test(s)) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Upper bound on the `N` in `olderThanDays N` / `newerThanDays N`, in days
 * (~274 years). Not a business rule — a sanity bound so a fat-fingered window
 * in a stored rule reads as malformed (rule fails closed) rather than as a
 * cutoff so far in the past or future that the clause is a constant.
 */
const MAX_RELATIVE_DAYS = 100000;

function evalClause(clause: string, data: Record<string, unknown>): boolean {
  const c = clause.trim();
  // Order matters: multi-char/word operators must precede their single-char prefixes
  // e.g. " length>=" before " length>" before ">="  before ">"
  // The word operators (contains / olderThanDays / newerThanDays) contain none of
  // the symbol operators as substrings, so their position among themselves is
  // free — but they must stay AHEAD of the symbols for the same reason.
  const OPS = [
    " length>=", " length<=", " length==", " length>", " length<",
    " contains ", " olderThanDays ", " newerThanDays ",
    ">=", "<=", "!=", "==", ">", "<",
  ];
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
    if (op2 === "olderThanDays" || op2 === "newerThanDays") {
      // The window is read from the RAW clause text, never from `right`/the
      // data, so the number of days is always authored in the platform-owned
      // rule string itself. A stored expression can compare a tenant's real
      // timestamp against a fixed window; it can never let fetched (or
      // request-influenced) data decide how far back the window reaches.
      const rawDays = rhs.trim();
      if (!/^\d+$/.test(rawDays)) return false;
      const days = Number(rawDays);
      if (!Number.isFinite(days) || days > MAX_RELATIVE_DAYS) return false;
      const ts = parseTimestampMs(left);
      // Null/absent/malformed timestamps fail closed. A missing date is
      // indistinguishable from a field the check forgot to $select, and firing
      // a finding on that would report a fabricated one. Where "never happened"
      // is itself the alarm, the stored rule says so explicitly and composes
      // with the existing grammar:
      //   {{lastSync}} == null || {{lastSync}} olderThanDays 30
      if (ts === null) return false;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      return op2 === "olderThanDays" ? ts < cutoff : ts >= cutoff;
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

// ── Nested-array helpers (shared by the array-shaped transforms) ──────────────

/**
 * Counts how many entries of `flatVals` are part of a duplicate group.
 *
 * This is `countDuplicates`' own logic, lifted verbatim in intent so that
 * `countDuplicatesBy` composes with it rather than growing a second, subtly
 * different notion of "duplicate". Note the semantics it preserves: THREE
 * copies of a value contribute 3, not 2 and not 1 — it counts duplicated
 * OCCURRENCES, not duplicated distinct values.
 *
 * The tally is a Map rather than a plain object on purpose. Keys here come
 * straight from fetched Graph data, and a value spelled `__proto__` or
 * `constructor` on a plain object reads back an inherited member instead of
 * `undefined`, so `(seen[v] ?? 0) + 1` yields NaN and poisons the count. Real
 * skuIds are GUIDs and never hit that, but the helper is now generic over any
 * flattened field, so the hazard is removed rather than inherited.
 */
function countDuplicateValues(flatVals: string[]): number {
  const seen = new Map<string, number>();
  for (const v of flatVals) seen.set(v, (seen.get(v) ?? 0) + 1);
  return flatVals.filter(v => (seen.get(v) ?? 0) > 1).length;
}

interface FlattenResult {
  /** Every non-null `field` value found, in document order, across all items. */
  values: unknown[];
  /** True if at least one item really had an array at the mapping's sourceField. */
  sawArray: boolean;
  /**
   * True if at least one of those arrays contained an object at all — the guard
   * that separates "the field name is wrong" from "every array is legitimately
   * empty". An unlicensed tenant returns `assignedLicenses: []` on every user,
   * which is a real answer, not a misconfigured check.
   */
  sawEntry: boolean;
  /** True if at least one entry inside those arrays was an object carrying `field`. */
  sawField: boolean;
}

/**
 * Flattens one field out of the nested arrays sitting at a mapping rule's
 * sourceField, across every fetched item.
 *
 * The reason this cannot be expressed with the existing dot-path is structural:
 * `resolvePathInData` walks named properties only. On a real user,
 * `assignedLicenses.skuId` steps into the ARRAY (an object, so the walk
 * continues) and then asks it for a `skuId` property it does not have —
 * yielding `undefined`, silently, for every user in the tenant. Arrays need a
 * flat-map step, and giving one to `resolvePathInData` itself would change the
 * meaning of every stored check's paths at once, so this stays opt-in behind
 * the transforms that name it.
 *
 * Non-array values and non-object array entries are skipped rather than
 * coerced. `String({skuId})` is `"[object Object]"` — a value that is equal to
 * every other object's stringification, which is exactly how a duplicate count
 * over un-flattened licence objects reports a tenant's ENTIRE licence estate as
 * duplicated. Skipping keeps a wrong shape at zero instead of at "alarming".
 */
function flattenNestedField(vals: unknown[], field: string): FlattenResult {
  const values: unknown[] = [];
  let sawArray = false;
  let sawEntry = false;
  let sawField = false;
  for (const val of vals) {
    if (!Array.isArray(val)) continue;
    sawArray = true;
    for (const entry of val) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      sawEntry = true;
      const v = (entry as Record<string, unknown>)[field];
      if (v === undefined) continue;
      sawField = true;
      if (v !== null) values.push(v);
    }
  }
  return { values, sawArray, sawEntry, sawField };
}

/**
 * The distinct top-level field names a stored condition expression reads.
 *
 * Used ONLY as a diagnostic by `countWhere`: a predicate whose fields exist on
 * nothing it was evaluated against counts 0 for a reason that has nothing to do
 * with the tenant, and 0 is the most believable wrong answer there is. Quoted
 * literals are stripped first so `{{dept}} == 'Sales Team'` contributes `dept`
 * and not `Sales`/`Team`, and the grammar's own operator words are excluded.
 */
const GRAMMAR_WORDS = new Set(["true", "false", "null", "contains", "olderThanDays", "newerThanDays", "length"]);

function expressionTopLevelPaths(expression: string): string[] {
  const withoutLiterals = expression.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ");
  const out = new Set<string>();
  for (const m of withoutLiterals.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*/g)) {
    const head = m[0].split(".")[0];
    if (!GRAMMAR_WORDS.has(head)) out.add(head);
  }
  return [...out];
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
    // valueWhere('matchField', 'matchValue') or valueWhere('matchField', 'matchValue', 'extractField').
    // Args are non-greedy and quote-free so a missing quote reads as malformed
    // (falls through to the default branch, which warns) rather than as a
    // silently mis-parsed field name.
    const valueWhereMatch =
      /^valueWhere\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*(?:,\s*['"]([^'"]*)['"]\s*)?\)$/.exec(rawTransform);
    const flattenValuesMatch = /^flattenValues\(\s*['"]([^'"]*)['"]\s*\)$/.exec(rawTransform);
    const countDuplicatesByMatch = /^countDuplicatesBy\(\s*['"]([^'"]*)['"]\s*\)$/.exec(rawTransform);
    // countWhere('<expression>') — the argument is a CONDITION EXPRESSION, not a
    // field name, so it routinely contains the other quote character
    // ({{department}} == 'Sales'). Each quote style is therefore matched
    // separately with its own character excluded, rather than with the
    // ['"]([^'"]*)['"] form the field-name transforms use: that form would
    // reject every predicate carrying a string literal.
    const countWhereMatch =
      /^countWhere\(\s*'([^']*)'\s*\)$/.exec(rawTransform)
      ?? /^countWhere\(\s*"([^"]*)"\s*\)$/.exec(rawTransform);
    // An EMPTY predicate is treated as malformed, not as a predicate: the
    // grammar reads "" as false, so countWhere('') would report a confident 0
    // for every tenant forever.
    const countWhereExpr = countWhereMatch?.[1].trim() || undefined;
    // A parameterised name written without parsable arguments — "valueWhere",
    // or "flattenValues(skuId)" with the quotes dropped — must NOT reach its
    // case, which assumes its regex matched. Route it to the default branch so
    // an authoring slip warns and degrades, rather than throwing and failing the
    // whole check for the tenant. Deliberately scoped to the three names added
    // here: the two older parameterised transforms have always had their own
    // (garbage-but-non-throwing) behaviour for a bare name, and changing it is
    // not this change's business.
    //
    // `raw` is parameterless, so only its ARGUMENT-BEARING misspellings
    // ("raw('value')") are malformed — a bare "raw" is the real transform.
    // "countWhere" with no parsable expression joins the same branch: an empty
    // or unquoted predicate must warn, never silently count 0 (or, worse, count
    // every item, since an empty expression is falsy to the grammar).
    const malformedParams = !valueWhereMatch && !flattenValuesMatch && !countDuplicatesByMatch && !countWhereExpr
      && (["valueWhere", "flattenValues", "countDuplicatesBy", "countWhere"]
        .some(p => rawTransform === p || rawTransform.startsWith(`${p}(`))
        || rawTransform.startsWith("raw("));
    const transform = countEqualsMatch ? "countEquals"
      : staleSignInMatch ? "countIfLastSignInOlderThan"
      : valueWhereMatch ? "valueWhere"
      : flattenValuesMatch ? "flattenValues"
      : countDuplicatesByMatch ? "countDuplicatesBy"
      : countWhereExpr ? "countWhere"
      : malformedParams ? MALFORMED_PARAMS
      : rawTransform;
    const compareValue = countEqualsMatch ? countEqualsMatch[1] : undefined;
    const staleDays = staleSignInMatch ? Number(staleSignInMatch[1]) : undefined;
    const nestedField = flattenValuesMatch ? flattenValuesMatch[1]
      : countDuplicatesByMatch ? countDuplicatesByMatch[1]
      : undefined;

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
      case "countEmptyArray": {
        // Counts items whose nested array field is present but EMPTY — the real
        // shape of "this group has no owners" from
        // GET /groups?$expand=owners($select=id), where an ownerless group comes
        // back with `owners: []` rather than with the key absent.
        //
        // A missing/null/non-array value is NOT counted, on purpose. If the
        // check's endpoint forgets the $expand, every item lacks the key, and
        // counting absence as emptiness would report the tenant's ENTIRE group
        // estate as ownerless — a maximally alarming number that is pure
        // artefact. Under-reporting to 0 and warning loudly is the honest
        // failure; the warning names the fix.
        let sawArray = false;
        let empty = 0;
        for (const v of vals) {
          if (!Array.isArray(v)) continue;
          sawArray = true;
          if (v.length === 0) empty++;
        }
        result[targetField] = empty;
        if (!sawArray && items.length > 0) {
          log.warn(
            { targetField, sourceField },
            `monitor-executor: countEmptyArray found no array at "${sourceField}" on any item — check may be missing $expand=${sourceField} on its Graph endpoint, so the count is 0 rather than the real number`,
          );
        }
        break;
      }
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
        result[targetField] = countDuplicateValues(flatVals);
        break;
      }
      case "valueWhere": {
        // Named-key lookup inside an array of {name, value}-shaped objects — the
        // real shape of GET /groupSettings, whose `values` is a settingValue
        // collection of literal {"name": "...", "value": "..."} pairs (every
        // value a STRING, including booleans and the unset "").
        //
        // The distinction this exists to preserve: Graph returns the FULL
        // template for any settings object the tenant has created, so a setting
        // being present says nothing — an unconfigured one is present with
        // `value: ""`. `exists` on the array cannot tell those apart. Here
        // "not present at all" comes back as null and "present but unset" comes
        // back as "", so a stored rule can say which one it means:
        //   {{groupNaming}} == null || {{groupNaming}} == ''
        const matchField = valueWhereMatch![1];
        const matchValue = valueWhereMatch![2];
        const extractField = valueWhereMatch![3] ?? "value";

        let sawArray = false;
        let found = false;
        let extracted: unknown = null;
        let matchCount = 0;
        const distinctExtracted = new Set<string>();
        const nearMisses = new Set<string>();

        for (const val of vals) {
          if (!Array.isArray(val)) continue;
          sawArray = true;
          for (const entry of val) {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
            const name = (entry as Record<string, unknown>)[matchField];
            if (name == null) continue;
            const nameStr = String(name);
            if (nameStr !== matchValue) {
              if (nameStr.toLowerCase() === matchValue.toLowerCase()) nearMisses.add(nameStr);
              continue;
            }
            matchCount++;
            const v = (entry as Record<string, unknown>)[extractField] ?? null;
            distinctExtracted.add(JSON.stringify(v ?? null));
            // First match wins, matching `first`'s document-order semantics.
            if (!found) { found = true; extracted = v; }
          }
        }
        result[targetField] = extracted;

        if (!sawArray && items.length > 0) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: valueWhere found no array at "${sourceField}" on any item — the mapping's sourceField must point at the ARRAY of name/value pairs (e.g. "values"), so the result is null rather than the real setting`,
          );
        } else if (!found && nearMisses.size > 0) {
          log.warn(
            { targetField, sourceField, transform: rawTransform, nearMisses: [...nearMisses] },
            `monitor-executor: valueWhere found no "${matchField}" exactly equal to "${matchValue}", but did find ${[...nearMisses].map(n => `"${n}"`).join(", ")} differing only in case — the stored rule's spelling is almost certainly wrong, and it currently reads as "setting absent"`,
          );
        } else if (found && matchCount > 1 && distinctExtracted.size > 1) {
          log.warn(
            { targetField, sourceField, transform: rawTransform, matchCount },
            `monitor-executor: valueWhere matched "${matchValue}" ${matchCount} times with DIFFERENT ${extractField}s across the fetched items (e.g. the same setting in both Group.Unified and Group.Unified.Guest) — the first in document order was used, so this check is reporting one of several real answers`,
          );
        } else if (found && extracted === null) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: valueWhere matched "${matchValue}" but that entry carries no usable "${extractField}" (absent or null) — the result is null, which is indistinguishable downstream from the setting being absent`,
          );
        }
        break;
      }
      case "flattenValues": {
        // Every `nestedField` value across every item's nested array, as one
        // flat list — e.g. `assignedLicenses[].skuId` over all users. Readable
        // by the existing grammar as an array (`contains`, `length>`), which
        // neither `join` nor a dot-path can produce over nested arrays.
        const flat = flattenNestedField(vals, nestedField!);
        result[targetField] = flat.values;
        if (!flat.sawArray && items.length > 0) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: flattenValues found no array at "${sourceField}" on any item — check may be missing $select=${sourceField} on its Graph endpoint, so the list is empty rather than the real values`,
          );
        } else if (flat.sawArray && flat.sawEntry && !flat.sawField) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: flattenValues found arrays at "${sourceField}" but no entry inside them carries "${nestedField}" — the field name is wrong for this Graph shape, so the list is empty rather than the real values`,
          );
        }
        break;
      }
      case "raw": {
        // Pass-through: the REAL objects, unmodified, for the checks that need
        // the whole thing rather than a number derived from it (a SKU list with
        // its consumed/prepaid units, a usage report's rows). No count/first/
        // exists combination can produce that, which is why the transform was
        // authored before it existed.
        //
        // Two readings of one transform, decided by sourceField, because that is
        // the only place a jsonb mapping rule can say which it meant:
        //   • sourceField names the item itself (absent, ".", "*", "item",
        //     "items", "value", "value[]") -> the FULL fetched item array.
        //   • sourceField names a property -> that property off every item, in
        //     document order, nulls dropped (the same shape `join` counts and
        //     `flattenValues` emits, just unaggregated).
        //
        // The fallback in between is the one that matters in practice: a
        // sourceField that resolves on NO item is what every currently-broken
        // stored `raw` rule looks like (it produced [] via the default branch,
        // which is how #402 was found). Emitting [] again would be a faithful
        // reproduction of the bug, so it falls back to the whole item array —
        // the reading the issue names — and says so, loudly, because "I guessed
        // which of two things you meant" is not something to do silently.
        const isWholeItem = WHOLE_ITEM_SOURCE_FIELDS.has(sourceField?.trim() ?? "");
        const resolved = vals.filter(v => v !== undefined && v !== null);
        const usedFallback = !isWholeItem && resolved.length === 0 && items.length > 0;
        result[targetField] = isWholeItem || usedFallback ? [...items] : resolved;

        if (usedFallback) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: raw found nothing at "${sourceField}" on any of the ${items.length} fetched items, so it passed through the WHOLE items instead. If that is what the check wants, set sourceField to "value" (or "*") to say so; if it wants one property, "${sourceField}" is the wrong path for this Graph shape.`,
          );
        }
        if ((isWholeItem || usedFallback) && items.length > RAW_WHOLE_ITEM_WARN_THRESHOLD) {
          log.warn(
            { targetField, sourceField, transform: rawTransform, itemCount: items.length },
            `monitor-executor: raw is passing ${items.length} whole items through to "${targetField}", which is persisted verbatim into tenant_monitor_profiles.extracted_properties on every run. Nothing was dropped — but a derived transform is almost certainly what this check wants at this volume.`,
          );
        }
        break;
      }
      case "countWhere": {
        // Counts the things a real predicate matches. The predicate is the
        // EXISTING condition grammar — the same evalConditionGrammar that
        // severity_rules and the workflow engine already run — so `contains`,
        // `length>`, `olderThanDays`, `&&`/`||` and `{{path.to.field}}` mean here
        // exactly what they mean everywhere else in the platform. A second
        // expression language would be a second set of edge cases to get wrong.
        //
        // What is counted, decided by sourceField (as with `raw`):
        //   • sourceField resolves to an ARRAY on at least one item -> the
        //     matching ENTRIES inside those arrays, across all items.
        //   • otherwise -> the matching ITEMS, with the item itself as the data
        //     the expression reads.
        const isWholeItem = WHOLE_ITEM_SOURCE_FIELDS.has(sourceField?.trim() ?? "");
        const arrays: unknown[][] = isWholeItem ? [] : vals.filter((v): v is unknown[] => Array.isArray(v));
        const overEntries = arrays.length > 0;

        const scopes: Record<string, unknown>[] = [];
        let skippedNonObjects = 0;
        const candidates: unknown[] = overEntries
          ? arrays.flat()
          : items;
        for (const scope of candidates) {
          if (typeof scope !== "object" || scope === null || Array.isArray(scope)) { skippedNonObjects++; continue; }
          scopes.push(scope as Record<string, unknown>);
        }

        result[targetField] = scopes.filter(s => evalConditionGrammar(countWhereExpr!, s)).length;

        // Diagnostics. Each of these describes a way the count is 0 (or wrong)
        // for a reason that is about the stored rule, not about the tenant.
        const fields = expressionTopLevelPaths(countWhereExpr!);
        const anyFieldPresent = fields.length === 0
          || scopes.some(s => fields.some(f => Object.prototype.hasOwnProperty.call(s, f)));
        if (!isWholeItem && !overEntries && items.length > 0 && vals.every(v => v == null)) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: countWhere found nothing at "${sourceField}" on any item, so the predicate was evaluated against the WHOLE items. Set sourceField to "value" (or "*") if that is the intent; if the check meant to count entries inside an array, "${sourceField}" is the wrong path for this Graph shape.`,
          );
        }
        if (scopes.length > 0 && !anyFieldPresent) {
          log.warn(
            { targetField, sourceField, transform: rawTransform, fields },
            `monitor-executor: countWhere's predicate reads ${fields.map(f => `"${f}"`).join(", ")}, which ${fields.length === 1 ? "is" : "are"} present on none of the ${scopes.length} ${overEntries ? "array entries" : "items"} it was evaluated against — the count is ${String(result[targetField])} because the field name is wrong or the endpoint is missing a $select, not because the tenant is clean.`,
          );
        }
        if (skippedNonObjects > 0 && scopes.length === 0) {
          log.warn(
            { targetField, sourceField, transform: rawTransform, skipped: skippedNonObjects },
            `monitor-executor: countWhere had nothing object-shaped to evaluate — all ${skippedNonObjects} ${overEntries ? "array entries" : "items"} were scalars, which the condition grammar cannot read fields off. The count is 0.`,
          );
        }
        break;
      }
      case "countDuplicatesBy": {
        // countDuplicates, but over a field flattened out of each item's nested
        // array rather than over the array entries themselves. Duplicate
        // detection is NOT reimplemented — the flattened list goes through the
        // same countDuplicateValues() that `countDuplicates` uses, so both
        // transforms can only ever agree on what "duplicate" means.
        const flat = flattenNestedField(vals, nestedField!);
        result[targetField] = countDuplicateValues(flat.values.map(v => String(v)));
        if (!flat.sawArray && items.length > 0) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: countDuplicatesBy found no array at "${sourceField}" on any item — check may be missing $select=${sourceField} on its Graph endpoint, so the count is 0 rather than the real number`,
          );
        } else if (flat.sawArray && flat.sawEntry && !flat.sawField) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: countDuplicatesBy found arrays at "${sourceField}" but no entry inside them carries "${nestedField}" — the field name is wrong for this Graph shape, so the count is 0 rather than the real number`,
          );
        }
        break;
      }
      default:
        if (transform === MALFORMED_PARAMS) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: mapping rule names transform "${rawTransform}", which is implemented but was written with unparsable arguments — every argument must be a quoted string, e.g. valueWhere('name', 'AllowToAddGuests'), flattenValues('skuId'), countDuplicatesBy('skuId'), countWhere('{{accountEnabled}} == false') — and "raw" takes no arguments at all (it reads sourceField). Falling through to a raw array of values, which no numeric signal rule can read.`,
          );
        } else if (!KNOWN_TRANSFORMS.has(transform)) {
          log.warn(
            { targetField, sourceField, transform: rawTransform },
            `monitor-executor: mapping rule names transform "${rawTransform}", which is not implemented — falling through to a raw array of values. A numeric signal rule cannot read that, so this check's real signal is silently lost. Implemented: ${[...KNOWN_TRANSFORMS].join(", ")}`,
          );
        }
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

/**
 * #250: the customer-safe feature name stamped into `_licenseGapFeature` when
 * a PS-backed check hits "cmdlet_unavailable" — deliberately named after the
 * Purview capability area, not a specific cmdlet, since the same missing-
 * cmdlet symptom can mean either a licensing gap or a role-group provisioning
 * gap (see the "cmdlet_unavailable" branch's own comment). Keyed off
 * check.psCmdletKey, not the check's `key`, since the cmdlet identity is what
 * determines which Purview area is actually gated.
 */
function purviewFeatureForCmdletKey(cmdletKey: string | null): string {
  switch (cmdletKey) {
    case "get-dlp-policies":
    case "get-dlp-incidents":
      return "Microsoft Purview Data Loss Prevention (DLP)";
    case "get-labels":
    case "get-label-policies":
      return "Microsoft Purview sensitivity labels";
    default:
      return "Microsoft Purview compliance features";
  }
}

// ── PowerShell-backed check executor ──────────────────────────────────────────
//
// Runs a check whose data can only be read via Connect-IPPSSession (DLP/Label
// policies, #208) — no Graph REST equivalent exists. Modeled on
// runFanOutCheck's precedent (a distinct execution path alongside the normal
// Graph fetch, sharing everything downstream of `items`), but deliberately
// does NOT call graphFetchForTenant/graphFetchPaginated at all: per #209's
// design, a PS execution failure has nothing to do with a customer's Graph
// consent state, so it must be structurally unable to throw
// ConsentRevokedError/LicenseGapError, not merely conventionally unlikely to.
async function runPowerShellCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;

  if (!check.psCmdletKey) {
    throw new Error(`monitor check ${check.key} has executorType "powershell" but no psCmdletKey configured`);
  }

  // Organization is the reserved tenant-identity field Connect-IPPSSession
  // needs (entrypoint.ps1) — resolved from the tenant's own domain, not
  // stored as a literal in psParams, so one check definition works for every
  // tenant it's assigned to.
  const [tenantRow] = await db
    .select({ domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);
  const organization = tenantRow?.domain || tenantId;

  const resolvedParams = resolvePsParamsPlaceholders(
    check.psParams as Record<string, unknown> | null,
    organization,
    tenantId,
  );
  resolvedParams.Organization ??= organization;

  const { items, rawResponse } = await callPsExecution(check.psCmdletKey, resolvedParams);

  // Same downstream contract as the Graph path: mapping/properties -> schema
  // validation -> severity classification -> persistence, all unmodified.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(items, mapping, properties);

  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: PowerShell check output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatched = classifySeverity(severityRules, extracted);

  // The container's contract (#210) is one synchronous request/response — no
  // @odata.nextLink, no CSV — so pageCount is always 1.
  const pageCount = 1;

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

  log.info(
    { checkKey: check.key, tenantId, itemCount: items.length, cmdletKey: check.psCmdletKey },
    "monitor-executor: PowerShell-backed check completed",
  );

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
}

// ── SharePoint-admin-backed check executor (#394) ─────────────────────────────
//
// Runs a check whose data lives on the SharePoint Online TENANT administration
// surface, which Microsoft Graph does not expose at all — tenant-wide external
// sharing capability is read via CSOM ProcessQuery against
// `{prefix}-admin.sharepoint.com` with a certificate-based app-only token, all
// of which sharepoint-admin.ts already implements and this branch only calls.
//
// Modeled on runPowerShellCheck exactly: a distinct execution path that shares
// everything downstream of `items` (mapping -> schema -> severity ->
// persistence) and deliberately never touches graphFetchForTenant, so it is
// structurally unable to throw ConsentRevokedError. That matters more here than
// it does for PowerShell: SharePoint consent (Sites.FullControl.All on the
// "Office 365 SharePoint Online" resource) is granted and tracked SEPARATELY
// from Graph consent, so a SharePoint 401 must never be allowed to flip a
// tenant's Graph consent state — sharepoint-admin.ts's SharePointAuthError is
// non-DB-mutating by design and reaches the generic "error" branch below.

/**
 * A code-owned SharePoint-admin operation: receives the resolved tenant ref and
 * returns items in the same shape the Graph path produces, so applyMapping and
 * everything after it runs unmodified.
 */
export type SharePointAdminOperation = (ref: SharePointTenantRef) => Promise<Record<string, unknown>[]>;

/** Human-readable names for the SharingCapability enum, kept explicit rather than relying on TS reverse-mapping so an unrecognised value degrades to its number instead of `undefined`. */
const SHARING_CAPABILITY_NAMES: Record<number, string> = {
  [SharingCapability.Disabled]: "Disabled",
  [SharingCapability.ExternalUserSharingOnly]: "ExternalUserSharingOnly",
  [SharingCapability.ExternalUserAndGuestSharing]: "ExternalUserAndGuestSharing",
  [SharingCapability.ExistingExternalUserSharingOnly]: "ExistingExternalUserSharingOnly",
};

/**
 * The code-owned operation registry. `monitor_checks.sp_operation` stores a KEY
 * into this table and nothing else — never a URL, never a script — the same
 * contract `ps_cmdlet_key` and `fan_out_item_normalizer` follow. An unknown key
 * is a hard error at execution time, not a silent no-op.
 *
 * Each operation returns a ONE-item array rather than a bare value, because a
 * tenant-wide setting IS a single fact and applyMapping/properties are written
 * against an item list. The derived booleans are computed here, next to the
 * enum they come from, rather than left to condition-grammar arithmetic over a
 * bare number in a stored severity rule.
 */
export const SHAREPOINT_ADMIN_OPERATIONS: Record<string, SharePointAdminOperation> = {
  "tenant-sharing-capability": async (ref) => {
    const capability = await getTenantSharingCapability(ref);
    return [{
      sharingCapability: capability,
      sharingCapabilityName: SHARING_CAPABILITY_NAMES[capability] ?? String(capability),
      // Anything other than Disabled permits sharing with people outside the tenant.
      externalSharingEnabled: capability !== SharingCapability.Disabled,
      // Only ExternalUserAndGuestSharing ("Anyone") permits sign-in-free anonymous links.
      anonymousSharingEnabled: capability === SharingCapability.ExternalUserAndGuestSharing,
    }];
  },
};

function resolveSharePointAdminOperation(key: string | null | undefined): SharePointAdminOperation {
  const operation = key ? SHAREPOINT_ADMIN_OPERATIONS[key] : undefined;
  if (!operation) {
    throw new Error(
      `monitor check declares sp_operation "${key ?? "(null)"}", which is not in the code-owned registry ` +
      `(${Object.keys(SHAREPOINT_ADMIN_OPERATIONS).join(", ") || "empty"})`,
    );
  }
  return operation;
}

/**
 * The tenant's SharePoint name prefix (the `contoso` in contoso.sharepoint.com),
 * derived from its INITIAL `.onmicrosoft.com` domain — which is exactly what
 * `tenants.domain` holds: consent.ts stamps it from Graph's
 * `/organization` verifiedDomains entry with `isInitial: true` (#238), and
 * scripts/backfill-tenant-domain.ts backfills the same value. Microsoft derives
 * `{prefix}.sharepoint.com` from that same initial prefix when a tenant is
 * created, so the two agree.
 *
 * A custom/vanity domain (contoso.com) is deliberately NOT accepted: its prefix
 * is not the SharePoint hostname, and guessing would build a plausible-looking
 * host for a tenant that never had one — the same fail-loud-not-silent rule the
 * endpoint placeholders follow.
 */
const INITIAL_DOMAIN_RE = /^([a-z0-9][a-z0-9-]*)\.onmicrosoft\.com$/i;

export function sharePointPrefixFromDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const match = INITIAL_DOMAIN_RE.exec(domain.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Builds the SharePointTenantRef sharepoint-admin.ts needs from the tenant's own
 * stored identity. `tenants.domain` is the primary source; when it is missing or
 * is a vanity domain, one best-effort Graph `/organization` lookup fills it in
 * (getInitialDomainForTenant swallows every failure and returns null, so this
 * cannot throw ConsentRevokedError into the SharePoint path). When neither
 * source yields a real initial domain this fails explicitly, naming what it
 * found, rather than fabricating a host.
 */
async function resolveSharePointTenantRef(tenantId: string): Promise<SharePointTenantRef> {
  const [tenantRow] = await db
    .select({ domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);

  let prefix = sharePointPrefixFromDomain(tenantRow?.domain);
  if (!prefix) {
    prefix = sharePointPrefixFromDomain(await getInitialDomainForTenant(tenantId));
  }
  if (!prefix) {
    throw new Error(
      `cannot resolve a SharePoint tenant prefix for tenant ${tenantId}: ` +
      `tenants.domain is ${tenantRow?.domain ? `"${tenantRow.domain}" (not an .onmicrosoft.com initial domain)` : "not set"} ` +
      `and the Graph /organization lookup returned no initial domain`,
    );
  }
  return { aadTenantId: tenantId, sharePointTenantPrefix: prefix };
}

async function runSharePointAdminCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;

  const operation = resolveSharePointAdminOperation(check.spOperation);

  // Platform-wide credential guard, checked before any tenant work: the
  // SharePoint resource requires a CERTIFICATE on the MT app registration (a
  // client secret is rejected outright), so a missing cert is a platform
  // configuration fault, not a customer's tenant being misconfigured. Named
  // explicitly so the persisted errorMessage says which env vars are absent
  // instead of surfacing an opaque 401 later.
  if (!sharePointAdminCredentialsPresent()) {
    throw new Error(
      `monitor check ${check.key} needs SharePoint app-only credentials — set MT_APP_CLIENT_ID, ` +
      `MT_APP_CERT_PRIVATE_KEY and MT_APP_CERT_THUMBPRINT (a certificate on the multi-tenant app registration)`,
    );
  }

  const ref = await resolveSharePointTenantRef(tenantId);
  const items = await operation(ref);

  // Same downstream contract as the Graph path: mapping/properties -> schema
  // validation -> severity classification -> persistence, all unmodified.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(items, mapping, properties);

  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: SharePoint-admin check output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatched = classifySeverity(severityRules, extracted);

  // One CSOM round trip, one answer — there is no paging concept here, so
  // pageCount is always 1 (same reasoning as the PowerShell path).
  const pageCount = 1;

  // rawResponse is the operation's own returned items, NOT the CSOM envelope:
  // sharepoint-admin.ts parses ProcessQuery's array internally and returns the
  // typed value, so the items ARE the rawest thing this layer legitimately has.
  // Recording the operation and host alongside them keeps the profile row
  // self-describing rather than implying a wire capture it doesn't hold.
  const rawResponse: Record<string, unknown> = {
    spOperation: check.spOperation,
    sharePointTenantPrefix: ref.sharePointTenantPrefix,
    items,
  };

  const [row] = await db
    .insert(tenantMonitorProfilesTable)
    .values({
      tenantId,
      checkKey: check.key,
      checkSchemaVersion: check.schemaVersion,
      triggerId,
      idempotencyKey,
      status: "ok",
      rawResponse,
      extractedProperties: extracted,
      severityMatched,
      itemCount: items.length,
      pageCount,
    })
    .onConflictDoNothing()
    .returning({ profileId: tenantMonitorProfilesTable.profileId });

  log.info(
    { checkKey: check.key, tenantId, spOperation: check.spOperation, itemCount: items.length },
    "monitor-executor: SharePoint-admin-backed check completed",
  );

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
//   1b. OPTIONAL, opt-in via `fanOutItemFilter`: drop enumerated items that fail a
//      condition-grammar expression BEFORE the item cap is applied, so a source
//      that returns a superset (`/sites/getAllSites` includes every OneDrive)
//      can't spend the budget on items the check isn't about. NULL = keep all.
//   2. Issue the check's own `endpoint` once per item, substituting the item id
//      into `{itemId}`, with bounded concurrency + per-request 429 backoff.
//   2b. OPTIONAL, opt-in via `fanOutItemNormalizer`: reshape ONE source item's
//      results before they join the union — a code-owned function keyed by name,
//      never a stored script. This is what lets a fan-out answer a PER-SOURCE-ITEM
//      question ("which sites are overshared, by name and URL") rather than only
//      a cross-item rollup: the normalizer emits one row per source item, so
//      `combinedItems` becomes the site list and the mapping counts SITES. NULL =
//      flatten raw results, i.e. every pre-existing check, unchanged.
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
  // Resolved BEFORE any Graph call: a misconfigured normalizer key must fail
  // before the run spends hundreds of per-item requests it would then discard.
  const normalizer = resolveFanOutItemNormalizer(check.fanOutItemNormalizer);

  // 1. Enumerate the source list. Any throw here (consent/license/generic) is
  //    deliberately allowed to propagate to executeMonitorCheck's catch.
  const enumResult = await graphFetchPaginated(
    tenantId,
    check.fanOutSource!,
    "GET",
    undefined,
    { throttleRetry },
  );

  // The whole source object is retained, not just its id: an opt-in item filter
  // reads its fields, and a normalizer needs it to stamp real identity (a site's
  // name and URL) onto the row it emits.
  const allEntries = enumResult.items
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null && !Array.isArray(it))
    .map((source) => ({ source, id: source[idField] }))
    .filter((e): e is { source: Record<string, unknown>; id: string } =>
      typeof e.id === "string" && e.id.length > 0);

  // 1b. Opt-in per-item filter (same condition grammar as severity_rules). This
  //     runs BEFORE the cap on purpose: filtering after would let excluded items
  //     consume the budget and silently truncate the ones the check is about.
  const filterExpr = check.fanOutItemFilter?.trim();
  let excludedByFilter = 0;
  const eligible = filterExpr
    ? allEntries.filter((e) => {
        let keep: boolean;
        try {
          keep = evalConditionGrammar(filterExpr, e.source);
        } catch {
          // A malformed filter must not silently drop the tenant's entire
          // estate — keep the item and let the run report real coverage.
          keep = true;
        }
        if (!keep) excludedByFilter++;
        return keep;
      })
    : allEntries;

  const truncated = eligible.length > maxItems;
  const entries = truncated ? eligible.slice(0, maxItems) : eligible;
  if (truncated) {
    log.warn(
      { checkKey: check.key, tenantId, enumerated: allEntries.length, eligible: eligible.length, cap: maxItems },
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
    i < entries.length && !consentErr && !(licenseErr && succeeded === 0);
    i += FAN_OUT_CONCURRENCY
  ) {
    const batch = entries.slice(i, i + FAN_OUT_CONCURRENCY);
    const outcomes = await Promise.all(batch.map(async ({ id, source }) => {
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
        return { id, source, ok: true as const, items: r.items, pageCount: r.pageCount };
      } catch (e) {
        return { id, source, ok: false as const, error: e };
      }
    }));

    for (const o of outcomes) {
      if (o.ok) {
        succeeded++;
        perItemPageTotal += o.pageCount;
        // Coverage is measured on the RAW results, before any normalizer: this
        // metric answers "how many enumerated items returned anything at all",
        // which must not change shape just because a check reshapes its rows.
        if (o.items.length > 0) withResults++;
        combinedItems.push(...(normalizer ? normalizer(o.source, o.items) : o.items));
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
    sourceItemsTotal: allEntries.length,
    // Present on every fan-out result, 0/equal-to-total when no filter is
    // configured, so a reader never has to guess whether filtering happened.
    sourceItemsExcludedByFilter: excludedByFilter,
    sourceItemsEligible: eligible.length,
    itemFilter: filterExpr ?? null,
    itemNormalizer: check.fanOutItemNormalizer ?? null,
    sourceItemsScanned: entries.length,
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
  if (entries.length === 0) {
    status = "ok"; // zero eligible items — an honest empty tenant, not a fault
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
        : `Fan-out coverage: ${succeeded}/${entries.length} ${idField === "id" ? "items" : idField} succeeded, ${failed} failed${licenseGapCount ? `, ${licenseGapCount} license-gapped` : ""}${excludedByFilter ? `, ${excludedByFilter} excluded by filter` : ""}${truncated ? ` (capped at ${maxItems})` : ""}`,
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
    errorMessage: status === "ok" ? undefined : `${succeeded}/${entries.length} items succeeded, ${failed} failed`,
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
    // PowerShell-backed checks (executorType = 'powershell', #209/#211) take an
    // entirely separate path that never touches Graph at all — checked first,
    // ahead of the fan-out/Graph branches below, which are Graph-only by
    // construction (executorType defaults to 'graph' for every existing check).
    if (check.executorType === "powershell") {
      return await runPowerShellCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems });
    }

    // SharePoint-admin-backed checks (executorType = 'sharepoint-admin', #394)
    // take the same kind of separate, Graph-free path, for the same reason: the
    // SharePoint Online tenant-administration surface has no Graph equivalent.
    // Only a check whose row explicitly carries this executorType can reach it —
    // every 'graph' (the column default, i.e. every pre-existing check) and
    // 'powershell' check falls through exactly as before.
    if (check.executorType === "sharepoint-admin") {
      return await runSharePointAdminCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems });
    }

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

    // PsExecutionError with kind "cmdlet_unavailable" (#250): the ps-execution
    // container caught a real CommandNotFoundException resolving the check's
    // cmdlet — see ps-execution-client.ts's PsExecutionError doc comment for
    // why this can ONLY mean the tenant's Security & Compliance session never
    // got this cmdlet registered (a Purview licensing gap OR the app not yet
    // being in the right Purview role group — the two are indistinguishable
    // from the error text alone, confirmed by inspecting
    // dlp-role-group-provisioning.ts's own problem statement). Reuses the
    // EXISTING "license_gap" status/shape (not a new status value) so this
    // slides into every consumer that already treats license_gap as an
    // honest, non-alarming "couldn't evaluate" state — dashboard-resolvers.ts's
    // customer-safe message, copilot-readiness.ts's collectedCount (already
    // nulls a score rather than scoring it as 0), diagnostics-runner.ts's
    // narrative branch, telemetryComparison.ts's non-scored treatment — none
    // of which need to change for this to work. `_licenseGapFeature` names
    // BOTH possible causes rather than asserting "not licensed" specifically,
    // per the ambiguity above.
    if (err instanceof PsExecutionError && err.kind === "cmdlet_unavailable") {
      const feature = purviewFeatureForCmdletKey(check.psCmdletKey);
      const licenseFlags = licenseGapProfileFlags(feature);
      const extracted: Record<string, unknown> = {
        _licenseGap: true,
        _licenseGapFeature: feature,
        _licenseGapCode: "cmdlet_unavailable",
        ...licenseFlags,
      };
      log.info(
        { checkKey: check.key, tenantId, cmdletKey: check.psCmdletKey, feature },
        "monitor-executor: check unavailable — cmdlet not registered in this tenant's Security & Compliance session (license or role-group gap)",
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
          errorMessage: `Requires ${feature}`,
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
        errorMessage: `Requires ${feature}`,
        itemCount: 0,
        pageCount: 0,
        profileId: row?.profileId,
        licenseFeature: feature,
      };
    }

    // PsExecutionError (ps-execution container failures — network, cert/auth,
    // or a cmdlet-level error) falls through to this same generic path by
    // design: per #209, it deliberately gets no new run-status semantics —
    // it's a plain "error", same as any other unrecognized failure. Its
    // `kind` is attached to the log line only, for ops diagnosis; it must
    // NEVER route to markTenantConsentRevoked() the way ConsentRevokedError
    // does above — a PS execution auth failure is not a customer's Graph
    // consent state changing.
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error(
      { err, checkKey: check.key, tenantId, psExecutionKind: err instanceof PsExecutionError ? err.kind : undefined },
      "monitor-executor: check failed",
    );

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

/**
 * Resolves an active package to its ordered, active check list.
 *
 * Extracted verbatim out of `executeMonitoringPackage` so a second package
 * runner — the full-item detail collector (#339), which runs its own package in
 * parallel with the scoring scan — resolves "which checks are in this package"
 * through the exact same query rather than a second copy that could drift.
 *
 * `linkedCheckCount` is returned alongside `checks` because the two are NOT the
 * same question and the caller's "no_checks" answer depends on the first:
 * a package with junction rows whose checks are all inactive has
 * linkedCheckCount > 0 and checks.length === 0, and that is a package that ran
 * and found nothing to do, not a package that doesn't exist.
 */
export async function loadOrderedPackageChecks(packageKey: string): Promise<{
  pkg: MonitoringPackage | null;
  linkedCheckCount: number;
  checks: MonitorCheck[];
}> {
  const [pkg] = await db
    .select()
    .from(monitoringPackagesTable)
    .where(and(
      eq(monitoringPackagesTable.key, packageKey),
      eq(monitoringPackagesTable.status, "active"),
    ))
    .limit(1);

  if (!pkg) return { pkg: null, linkedCheckCount: 0, checks: [] };

  // Load checks for this package in order
  const packageChecks = await db
    .select({ checkKey: monitoringPackageChecksTable.checkKey, sortOrder: monitoringPackageChecksTable.sortOrder })
    .from(monitoringPackageChecksTable)
    .where(eq(monitoringPackageChecksTable.packageKey, packageKey))
    .orderBy(monitoringPackageChecksTable.sortOrder);

  if (packageChecks.length === 0) return { pkg, linkedCheckCount: 0, checks: [] };

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

  return { pkg, linkedCheckCount: packageChecks.length, checks: orderedChecks };
}

export async function executeMonitoringPackage(opts: {
  packageKey: string;
  tenantId: string;
  triggerId: string;
  onProgress?: ProgressCallback;
}): Promise<PackageRunResult> {
  const { packageKey, tenantId, triggerId, onProgress } = opts;
  const startedAt = new Date().toISOString();

  const { pkg, linkedCheckCount, checks: orderedChecks } = await loadOrderedPackageChecks(packageKey);

  // Unchanged semantics: "no_checks" means the package is missing/inactive or
  // has no junction rows at all. A package whose linked checks are all inactive
  // still runs (to completion, over zero checks) — it is not "no_checks".
  if (!pkg || linkedCheckCount === 0) {
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
        severityMatched: errResult.severityMatched,
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
      severityMatched: result.severityMatched,
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
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
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
