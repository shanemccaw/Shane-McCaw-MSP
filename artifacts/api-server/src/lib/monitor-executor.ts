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

import { promises as dnsPromises } from "node:dns";
import { db } from "@workspace/db";
import {
  monitorChecksTable,
  monitoringPackagesTable,
  monitoringPackageChecksTable,
  tenantMonitorProfilesTable,
  tenantAzureReachTable,
  tenantsTable,
  mspChangeRequestsTable,
  type MonitorCheck,
  type MonitoringPackage,
} from "@workspace/db";
import { eq, and, inArray, desc, gte } from "drizzle-orm";
import { graphFetchForTenant, ConsentRevokedError, LicenseGapError, markTenantConsentRevoked, getInitialDomainForTenant } from "./graph";
import {
  ServiceNotConfiguredError,
  matchIntuneWireSignature,
  readIntuneEntitlement,
  resolveIntuneServiceState,
  recordTenantServiceState,
  serviceDisplayName,
} from "./service-availability";
import { maybeCollectDriftForCheck, type DriftAttribution } from "./drift-collector.ts";
import { driftSpecForCheck } from "./drift-check-specs.ts";
import { callPsExecution, PsExecutionError } from "./ps-execution-client";
import {
  getTenantSharingCapability,
  sharePointAdminCredentialsPresent,
  SharingCapability,
  type SharePointTenantRef,
} from "./sharepoint-admin";
import {
  listDlpPolicies,
  listEnvironments,
  getTenantSettings,
  powerPlatformCredentialsPresent,
  PowerPlatformNotRegisteredError,
  type PowerPlatformDlpPolicy,
} from "./power-platform-admin";
import {
  probeAzureRmReach,
  resolveAzureRmOperation,
  getArmAccessTokenForTenant,
  armCredentialsPresent,
  AZURE_RM_LEAST_PRIVILEGE_ROLE,
  type AzureRmContext,
  type AzureRmReach,
} from "./azure-rm";
import { normalizeSiteSharing, SHAREPOINT_SITE_SHARING_NORMALIZER } from "./sharepoint-sharing";
import { normalizeDriveSharing, ONEDRIVE_DRIVE_SHARING_NORMALIZER } from "./onedrive-sharing";
import { syncTenantServicePlans } from "./tenant-workloads.ts";
import { formatChangeRequestCode } from "./portal-change-control";
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

// ── Configuration Drift attribution (#1270/#1283) ──────────────────────────────

/**
 * How far back a completed Conditional Access change request stays eligible to
 * attribute freshly-detected drift. Without a bound, a single ancient completed
 * CR would perpetually mark EVERY future CA drift `approved` (crRef set →
 * `deriveVerdict` returns `approved`), silently whitewashing genuinely
 * unapproved drift out of the `drift.unapproved` alert path
 * (customer-tenant-alert-engine counts only `attributed_unapproved`/
 * `unattributed`). Drift is deviation from an approved baseline, and a CR only
 * plausibly explains a change that landed near it in time, so only recent
 * completed CRs attribute — older drift falls through to `unattributed`, the
 * honest, floated-up state.
 */
const CA_CR_ATTRIBUTION_WINDOW_DAYS = 30;

/**
 * Best-effort drift attribution for Conditional Access changes: the most
 * recent completed change request against this tenant's ConditionalAccess
 * category within the last {@link CA_CR_ATTRIBUTION_WINDOW_DAYS} days, if one
 * exists. `msp_change_requests` is the platform's real "tenant audit log" for
 * MSP-initiated changes — unlike `audit_logs` (keyed to a platform user id),
 * it's keyed directly to the M365 tenant GUID and already carries a
 * ConditionalAccess category, a requester, and an approver.
 *
 * A CR describes an intended change, not a JSON path, so this cannot attribute
 * per-setting the way `planDriftEvents`'s `attributionFor` is shaped for —
 * when a qualifying CR exists, every drifted setting in this scan is
 * attributed to it the same way.
 */
async function buildCaChangeRequestAttribution(
  tenantId: string,
): Promise<((setting: string) => DriftAttribution | undefined) | undefined> {
  const cutoff = new Date(Date.now() - CA_CR_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [cr] = await db
    .select({
      id: mspChangeRequestsTable.id,
      requestedBy: mspChangeRequestsTable.requestedBy,
      approvedBy: mspChangeRequestsTable.approvedBy,
    })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.tenantId, tenantId),
        eq(mspChangeRequestsTable.category, "ConditionalAccess"),
        eq(mspChangeRequestsTable.status, "completed"),
        gte(mspChangeRequestsTable.updatedAt, cutoff),
      ),
    )
    .orderBy(desc(mspChangeRequestsTable.updatedAt))
    .limit(1);

  if (!cr) return undefined;

  // #1505 — was a hand-rolled `CR-${cr.id}` that never matched
  // `parseChangeRequestCode`'s `CR-2026-\d+` format (portal-change-control.ts),
  // so a drift event attributed here could never actually be resolved back to
  // its CR by anything that parses the code. Every other writer in this
  // codebase uses `formatChangeRequestCode`; this now does too.
  const attribution: DriftAttribution = {
    changedBy: cr.approvedBy ?? cr.requestedBy,
    crRef: formatChangeRequestCode(cr.id),
    changeRequestId: cr.id,
  };
  return () => attribution;
}

/**
 * The universal drift hook every executor path calls once its scan is complete
 * (#1287). #1283 hard-coded a single inline collectDrift for Conditional Access
 * in the graph path; this generalises it: a check is drift-tracked iff it has a
 * spec in drift-check-specs.ts, and the spec (not this function) knows how to
 * turn that check's `items`/`extracted`/`status` into a stable comparable config
 * — or an honest reason it can't. Kept deliberately non-fatal: a monitoring scan
 * must never fail because drift bookkeeping did, so every failure is caught and
 * logged, never propagated.
 *
 * `items` is whatever that path treats as the collected configuration — the raw
 * Graph items for graph/powershell/sharepoint-admin/dns, or the NORMALISED
 * per-source-item rows (`combinedItems`) for a fan-out, which is the shape the
 * fan-out's own mapping already counts.
 */
async function collectDriftForCompletedCheck(
  check: MonitorCheck,
  tenantId: string,
  items: unknown[],
  extracted: Record<string, unknown>,
  status: CheckResult["status"],
): Promise<void> {
  try {
    const spec = driftSpecForCheck(check.key);
    if (!spec) return; // not a drift-tracked check — an intended no-op, not a gap
    const attributionFor =
      spec.attribution === "ca-change-request"
        ? await buildCaChangeRequestAttribution(tenantId)
        : undefined;
    await maybeCollectDriftForCheck({
      checkKey: check.key,
      tenantId,
      scan: { items, extracted, status },
      attributionFor,
    });
  } catch (err) {
    log.warn({ err, tenantId, checkKey: check.key }, "monitor-executor: drift collection failed (non-fatal)");
  }
}

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
  [ONEDRIVE_DRIVE_SHARING_NORMALIZER]: normalizeDriveSharing,
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
  status: "ok" | "error" | "consent_revoked" | "requires_script" | "license_gap" | "partial" | "service_not_configured" | "azure_no_rbac" | "azure_no_subscriptions" | "power_platform_not_registered";
  extractedProperties: Record<string, unknown>;
  severityMatched: string | null;
  /**
   * The matched severity rule's own label — the specific sentence that rule was
   * written to say — or null when the rule carries none (or nothing matched).
   *
   * Carried alongside `severityMatched` rather than replacing it because they
   * answer different questions: the band drives scoring/colour, the label is
   * the customer-facing text. Before #408 only the band survived
   * `classifySeverity`, so every finding this check produced was titled
   * "{severity} finding detected" no matter how specific its rule was.
   */
  severityLabel?: string | null;
  errorMessage?: string;
  itemCount: number;
  pageCount: number;
  profileId?: string;
  /** For status "license_gap": the customer-safe name of the missing M365 add-on. */
  licenseFeature?: string;
  /**
   * For status "service_not_configured" (#1847): which Microsoft service refused, and
   * which of the real service states it is in. The full sentence and the evidence live
   * on the single tenant-level `tenant_service_availability` row, not repeated here.
   */
  serviceKey?: string;
  serviceState?: string;
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
  /**
   * #1847 — checks that couldn't run because the Microsoft SERVICE behind them does
   * not answer for this tenant. Not a failure, and not zero rows.
   */
  serviceNotConfiguredCount: number;
  /**
   * The DISTINCT tenant-level service states this run hit — one entry per service,
   * not one per check. Ten `devices:*` checks meeting the same Intune condition
   * produce ONE entry here, which is what reporting the fact at tenant level means.
   */
  serviceStates: Array<{ serviceKey: string; state: string }>;
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
  /**
   * The matched severity rule's already-interpolated finding sentence
   * (`classifySeverity()`'s `.label`, e.g. "No Conditional Access policy
   * requires MFA") — carried alongside `severityMatched` so a live consumer
   * can show the real finding text instead of the generic static check label
   * (#528). Absent when no rule matched (a rarer case — falls back to
   * `checkLabel`/`checkKey` downstream, per #418).
   */
  severityLabel?: string | null;
}) => void;

// ── Grammar: deterministic condition evaluator ────────────────────────────────
// Reuses the same grammar rules as the workflow-executor's evalCondition but as
// a standalone function so the monitor-executor has no circular dep on workflow-executor.

function resolvePathInData(p: string, data: Record<string, unknown>): unknown {
  const key = p.replace(/^\{\{|\}\}$/g, "").trim();

  // LITERAL KEY FIRST, then the dot-path walk (#551).
  //
  // Graph's polymorphic directoryObject collections discriminate their entries
  // with `@odata.type` ("#microsoft.graph.user" / ".group" / ".servicePrincipal")
  // — a field name that CONTAINS A DOT but is not a path. Splitting it
  // unconditionally asks each item for `item["@odata"]["type"]`, which is
  // undefined on every real Graph object, so a mapping rule keyed on it silently
  // resolved to nothing for every item. That is exactly the failure mode
  // identity:global-admin-count needs to avoid: its whole job after the #551 fix
  // is telling human admins apart from role-assignable groups and service
  // principals, and `@odata.type` is the only field that reliably says which.
  //
  // Safe by construction rather than by luck: a literal key holding a real value
  // is strictly more specific than a nested walk of the same string, and any key
  // that resolved through the dot-walk before still does — `data["status.errorCode"]`
  // is undefined for a nested {status:{errorCode}} payload, so it falls straight
  // through to the walk below, unchanged. The check is on the VALUE, not
  // hasOwnProperty, so a literal key explicitly set to undefined also falls
  // through instead of shadowing a path that would have resolved.
  const literal = data?.[key];
  if (literal !== undefined) return literal;

  const parts = key.split(".");
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

/**
 * What a matched severity rule actually says: its band AND its own label.
 *
 * This is an object rather than the bare severity string it used to be (#408).
 * `severity_rules[].label` is where every specific, researched sentence about
 * what a match MEANS is authored ("No sensitivity labels configured — Copilot
 * responses can surface unclassified content"), and returning only
 * `rule.severity` discarded all of it at the one point where the matching rule
 * is still known. Downstream had nothing left to say but a generic
 * "{severity} finding detected", which is what every customer saw.
 *
 * `label` is `null` when the matched rule genuinely has none — `label` is
 * optional in the stored jsonb, so "matched, but says nothing beyond its band"
 * is a real state and callers must still be able to fall back honestly.
 */
export interface SeverityMatch {
  severity: string;
  label: string | null;
}

/**
 * The `{{path}}` token family severity_rules[].label interpolates against the
 * finding's own extracted data (#418) — deliberately the SAME syntax and
 * nested-path walk (`resolvePathInData`) severity_rules[].expression already
 * uses (e.g. `"{{eeeuSiteCount}} > 0"`), so an author who already writes that
 * token in `expression` can reuse it verbatim in `label` rather than learning
 * a second templating grammar.
 */
const LABEL_PLACEHOLDER_RE = /\{\{([\w.]+)\}\}/g;

/**
 * Renders a label's `{{path}}` placeholders against `data`.
 *
 * Fallback decision (#418): a placeholder whose field is missing or null is
 * NEVER rendered as a broken literal like "{{eeeuSiteCount}}" in front of a
 * customer. Instead the whole label is discarded — this function returns
 * `null` — so the caller falls back to the existing generic
 * "${severity} finding detected" text, the same honest fallback #408 already
 * uses for a rule authored with no label at all. A half-templated sentence
 * with the fact missing is worse than the generic sentence, so there is no
 * partial-render path.
 */
function interpolateLabel(label: string, data: Record<string, unknown>): string | null {
  let unresolved = false;
  const rendered = label.replace(LABEL_PLACEHOLDER_RE, (match) => {
    const value = resolvePathInData(match, data);
    if (value == null) {
      unresolved = true;
      return "";
    }
    return String(value);
  });
  return unresolved ? null : rendered;
}

export function classifySeverity(
  severityRules: SeverityRule[],
  data: Record<string, unknown>,
): SeverityMatch | null {
  for (const rule of severityRules) {
    try {
      if (evalConditionGrammar(rule.expression, data)) {
        const rawLabel = rule.label?.trim() || null;
        const label = rawLabel ? interpolateLabel(rawLabel, data) : null;
        return { severity: rule.severity, label };
      }
    } catch {
      // skip malformed rules
    }
  }
  return null;
}

/**
 * Recovers the label behind an ALREADY-PERSISTED severity band.
 *
 * `tenant_monitor_profiles` stores the band a check matched and the extracted
 * properties it was matched against, but not the label. A result served from
 * the idempotency cache (a re-run under the same triggerId — #339 showed that
 * really happens) would therefore lose the label the fresh path now carries and
 * silently fall back to the generic finding title #408 exists to kill.
 *
 * Re-running the check's own rules over the row's own extracted properties is
 * deterministic, so this needs no new column. The band guard is what keeps it
 * honest: if the stored band and the re-derived one disagree, the rules have
 * been edited since the row was written, and the label in front of us is NOT
 * the one that actually matched — so say nothing rather than re-title a
 * historical result with newer text.
 */
function labelForStoredSeverity(
  severityRules: SeverityRule[],
  extracted: Record<string, unknown>,
  storedSeverity: string | null,
): string | null {
  if (!storedSeverity) return null;
  const match = classifySeverity(severityRules, extracted);
  return match && match.severity === storedSeverity ? match.label : null;
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
  // {{...}} tokens are read as field paths VERBATIM (mirroring
  // resolvePathInData's literal-key-first lookup, #753) before the generic
  // identifier regex below ever sees them. A CSV usage-report header like
  // "Last Activity Date" is a real, single object key containing spaces — the
  // identifier regex alone would tokenize it into "Last"/"Activity"/"Date",
  // none of which are ever present on the data, so `anyFieldPresent` always
  // failed and countWhere logged "the field name is wrong" on every run of a
  // check whose predicate reads report-style headers, even though the
  // predicate itself (evalConditionGrammar) resolves the whole spaced key
  // correctly. Consuming the {{...}} span here — keeping everything before
  // its first "." as one head, same as the plain-identifier case below —
  // fixes the false positive without changing behavior for any existing
  // dot-path or bare-identifier expression.
  const withoutMustache = withoutLiterals.replace(/\{\{([^{}]*)\}\}/g, (_match, inner: string) => {
    const head = inner.trim().split(".")[0].trim();
    if (head && !GRAMMAR_WORDS.has(head)) out.add(head);
    return " ";
  });
  for (const m of withoutMustache.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*/g)) {
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
        //
        // #2187 second reading: sourceField as a WHOLE_ITEM_SOURCE_FIELDS
        // sentinel (e.g. "value") means matchField/extractField apply directly
        // to the fetched ITEMS themselves, not to a nested array inside each
        // one. This is what a flat top-level list needs — /subscribedSkus'
        // items already ARE {skuPartNumber, consumedUnits} objects, there is
        // no nested array to descend into, so the original array-only reading
        // could never select "the Copilot SKU's consumedUnits" out of a list
        // of every SKU the tenant owns. No existing stored rule used
        // valueWhere before this, so this widening changes no live behavior.
        const matchField = valueWhereMatch![1];
        const matchValue = valueWhereMatch![2];
        const extractField = valueWhereMatch![3] ?? "value";
        const isWholeItem = WHOLE_ITEM_SOURCE_FIELDS.has(sourceField?.trim() ?? "");

        let sawArray = false;
        let found = false;
        let extracted: unknown = null;
        let matchCount = 0;
        const distinctExtracted = new Set<string>();
        const nearMisses = new Set<string>();

        const entryLists: unknown[][] = isWholeItem && items.length > 0
          ? [items]
          : vals.filter((v): v is unknown[] => Array.isArray(v));

        for (const val of entryLists) {
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

/**
 * The generic non-2xx failure `graphFetchPaginated` raises, carrying the wire
 * evidence as FIELDS rather than only inside the message string (Git #1796).
 *
 * `message` is byte-for-byte the string this used to throw
 * (`Graph API error <status>: <body-prefix>`), so every existing catcher —
 * monitor-executor's own `executeCheck`, monitor-failure-classifier, the
 * simulator — behaves exactly as before. The only thing that changed is that a
 * caller which WANTS the status code, the endpoint and the verbatim body no
 * longer has to regex them back out of a sentence.
 *
 * #1796's snapshot collector needs precisely that: each per-resource row in
 * `tenant_config_snapshot_resource_status` records the real `http_status`,
 * `error_code` and `error_message`, and a reason parsed out of prose would be a
 * summary of the evidence rather than the evidence itself.
 */
export class GraphPaginatedError extends Error {
  readonly status: number;
  readonly endpoint: string;
  /** Verbatim response body, truncated to the same cap the message uses. */
  readonly body: string;

  constructor(status: number, endpoint: string, body: string) {
    super(`Graph API error ${status}: ${body.slice(0, GRAPH_ERROR_BODY_CAPTURE_CHARS)}`);
    this.name = "GraphPaginatedError";
    this.status = status;
    this.endpoint = endpoint;
    this.body = body.slice(0, GRAPH_ERROR_BODY_CAPTURE_CHARS);
  }
}

// ── Intune service-level reachability (#487, re-scoped by #1847) ──────────────
// The signature matching, the entitlement read and the combined tenant-level
// verdict all live in service-availability.ts now. What changed in #1847 is what
// happens on a match: this file used to return `{ value: [], _intuneNotConfigured:
// true }` and let the check land as `status: 'ok', item_count: 0` — a measured zero
// reported for something that was never measured, indistinguishable downstream from
// a tenant that genuinely manages zero devices. It now throws
// ServiceNotConfiguredError, which executeCheck classifies as its own status and
// records ONCE at tenant level in `tenant_service_availability`.
//
// The historical detection notes below are kept because they are the evidence the
// signature list was built from.
//
// ── Intune "MDM never configured" detection (#487) ─────────────────────────────
// Devices/Intune checks (encryption-status, os-patch-compliance,
// autopilot-coverage, enrollment-status, app-protection-coverage,
// compliance-policy-coverage, update-rings-config, compliant-vs-noncompliant)
// were landing as status: 'error' at up to 100% platform-wide. The raw error
// bodies (pulled via sqloutput.json's statement-1 query, grouped and
// normalized past their per-request noise — Activity IDs, request IDs,
// TargetServer hosts) resolve to exactly THREE distinct wire signatures, not
// one, and none of them is a license/SKU signal:
//   1. 401, the four `managedDevices`-backed checks — a legacy Intune backend
//      proxy (`DeviceFE/StatelessDeviceFEService`) answers with a wrapped,
//      truncated "Forbidden" body.
//   2. 400 BadRequest, `windowsAutopilotDeploymentProfiles` — Graph's OData
//      router reports the navigation property itself doesn't resolve
//      ("Resource not found for the segment").
//   3. 503, the `deviceAppManagement`/`deviceCompliancePolicies`/
//      `deviceConfigurations`-backed checks — a raw IIS "Service Unavailable"
//      HTML page, not a Graph JSON error at all.
// All three mean the Intune backend will not answer. The endpoints themselves
// are NOT wrong — all three match docs/endpoints.json's existing v1.0 paths —
// and a genuine missing-permission-scope error looks nothing like any of them
// (contrast devices:bitlocker-key-escrow's clean 403 `authorization_error` /
// "token doesn't have the required permissions" in the same sample pull, an
// unrelated real permission bug left untouched here).
//
// CORRECTED BY #1847 — this block used to assert "Intune IS licensed (bundled
// in this test tenant's Microsoft 365 E3) but has never been enrolled". That is
// wrong on its facts, and the error is instructive enough to leave recorded
// rather than quietly delete: the testbed does NOT have Microsoft 365 E3. Its
// only user SKU is ENTERPRISEPACK — Office 365 E3 — whose sole Intune-family
// service plan is INTUNE_O365 (Mobile Device Management for Office 365, a basic
// MDM capability that is not Intune), and that plan is the ONLY one of the
// SKU's 46 service plans not provisioned Success. There is no INTUNE_A. Read
// live from the tenant's own /subscribedSkus on 2026-08-30.
//
// So the wire signature alone could never have settled the cause: a tenant that
// never licensed Intune and a tenant that licensed it and never enrolled fail
// identically here. `service-availability.ts` combines the signature with the
// tenant's real service-plan entitlement and reports whichever it actually is,
// rather than this file asserting one for every tenant.
//
// Deliberately gated on Intune's own endpoint prefixes: the 503 IIS page in
// particular has no Intune-specific text of its own, and firing on it
// endpoint-agnostically would risk silently swallowing a genuine outage on
// an unrelated workload as "no MDM configured".
/**
 * Kept as the boolean predicate this module has always exported. The signature list
 * itself now lives in service-availability.ts so the classifier, the resource model
 * and this executor cannot drift apart on what "not configured" looks like on the
 * wire.
 *
 * Note the widened path gate: #1847's own evidence includes a 503 from the BARE
 * `/deviceManagement` root, which the old `"/deviceManagement/"` prefix (trailing
 * slash) did not match — so the root's refusal fell through to a generic error.
 */
export function isIntuneServiceNotConfiguredError(endpoint: string, status: number, body: string): boolean {
  return matchIntuneWireSignature(endpoint, status, body) !== null;
}

// ── "No company branding configured" detection (Git #1786) ─────────────────────
// GET /organization/{id}/branding 404s with Request_ResourceNotFound when the
// tenant has never set up Company Branding under Entra ID — a documented
// Microsoft Graph quirk, not a permission or endpoint bug: the org itself
// exists (that's the same {id} in the error body), the branding NAVIGATION
// PROPERTY just has nothing behind it yet. Confirmed live on the testbed
// (run 6083e510, platform:branding-config, 2026-08-30) — the exact error is
// `Request_ResourceNotFound` naming the tenant's own GUID as the missing
// resource. Same shape as the existing Intune "never configured" precedent
// above: an honest, renderable "not configured" state, not a fault.
const BRANDING_ENDPOINT_PREFIX = "/organization/";

export function isBrandingNotConfiguredError(endpoint: string, status: number, body: string): boolean {
  if (!endpoint.startsWith(BRANDING_ENDPOINT_PREFIX) || !endpoint.endsWith("/branding")) return false;
  if (status !== 404) return false;
  return body.includes('"code":"Request_ResourceNotFound"');
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
      // #1847: a documented never-configured signature is a real, reportable STATE,
      // not zero rows. Resolve the tenant-level verdict (signature + the tenant's own
      // /subscribedSkus entitlement, which is the only thing that can separate "never
      // enrolled" from "never licensed") and throw it for executeCheck to classify.
      const intuneSignature = matchIntuneWireSignature(resolvedEndpoint, res.status, text);
      if (intuneSignature) {
        const entitlement = await readIntuneEntitlement(tenantId);
        const verdict = resolveIntuneServiceState(intuneSignature, entitlement);
        log.info(
          {
            tenantId,
            endpoint: resolvedEndpoint,
            status: res.status,
            signature: intuneSignature,
            state: verdict.state,
            entitlement: entitlement.verdict,
          },
          "monitor-executor: Intune is not answering for this tenant (#1847) — resolving to a tenant-level service state, not zero rows",
        );
        throw new ServiceNotConfiguredError(tenantId, verdict, resolvedEndpoint, res.status, text);
      }
      if (isBrandingNotConfiguredError(resolvedEndpoint, res.status, text)) {
        log.info(
          { tenantId, endpoint: resolvedEndpoint, status: res.status },
          "monitor-executor: tenant has no company branding configured (Git #1786) — treating as a real ok result with zero branding, not an error",
        );
        if (pageCount === 0) rawResponse = { value: [], _brandingNotConfigured: true };
        pageCount++;
        url = "";
        continue;
      }
      throw new GraphPaginatedError(res.status, resolvedEndpoint, text);
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
      //
      // Git #2115: this used to `throw new Error(...)` — a plain Error, not a
      // GraphPaginatedError, so nothing downstream could pull `status`/`body`
      // back off it. A caught config-snapshot run recorded this failure with
      // NO http_status and NO error_code at all (a real, confirmed instance of
      // the 32 no-wire-evidence rows). `res.status` and the body are both sitting
      // right here, so carry them the same way the `!res.ok` branch above does.
      throw new GraphPaginatedError(
        res.status,
        resolvedEndpoint,
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
 * #250 (renamed #491): the customer-safe feature name stamped into
 * `_licenseGapFeature` when a PS-backed check hits "cmdlet_unavailable" —
 * deliberately named after the specific capability area, not a specific
 * cmdlet, since the same missing-cmdlet symptom can mean either a licensing
 * gap or a role-group/RBAC provisioning gap (see the "cmdlet_unavailable"
 * branch's own comment). Keyed off check.psCmdletKey, not the check's `key`,
 * since the cmdlet identity is what determines which capability area is
 * actually gated. Originally Purview-only (#250); #491 added Exchange Online
 * admin cmdlets (a different product/RBAC surface entirely — Exchange
 * Online's role groups, not a Purview role group), so the default case can
 * no longer assume "Purview" without being actively misleading to a
 * customer reading `_licenseGapFeature`.
 */
function licenseGapFeatureForCmdletKey(cmdletKey: string | null): string {
  switch (cmdletKey) {
    case "get-dlp-policies":
    case "get-dlp-incidents":
      return "Microsoft Purview Data Loss Prevention (DLP)";
    case "get-labels":
    case "get-label-policies":
      return "Microsoft Purview sensitivity labels";
    // #491: Exchange Online admin cmdlets — gated by Exchange RBAC role
    // assignment (or, in principle, an Exchange Online license gap), not a
    // Purview capability. See entrypoint.ps1's #491 catalog comment for the
    // exact prerequisite (Exchange.ManageAsApp + an Exchange RBAC role group
    // on the same app-only cert already used for Graph/Purview).
    case "get-antispam-policies":
    case "get-shared-mailboxes":
    case "get-litigation-hold-gap":
    case "get-archive-mailbox-gap":
    case "get-transport-rules":
    case "get-inbound-connector-tls-gap":
    case "get-auto-forward-risk-policies":
    case "get-dkim-disabled-domains":
    case "get-mailbox-quota-utilization":
      return "Exchange Online admin data (requires the app's Exchange Online role assignment)";
    default:
      return "Microsoft Purview compliance features";
  }
}

/**
 * The single write into `tenant_monitor_profiles` — shared by every executor
 * branch (Graph, PowerShell, SharePoint-admin, DNS, fan-out, and each of the
 * requires-script / consent-revoked / license-gap / error paths).
 *
 * WHY `persist:false` EXISTS (#543)
 *   `tenant_monitor_profiles` is not a log. It IS the scoring surface:
 *   `fetchLatestMonitorProfileRows()` (tenant-signals.ts) reads it as
 *   DISTINCT ON (check_key) ORDER BY collected_at DESC, with no package, run or
 *   trigger scoping whatsoever. So ANY row written for a check becomes that
 *   check's live signal for the tenant, forever, until something newer lands.
 *
 *   That makes "additive, honestly recorded second collection" an impossible
 *   position: a non-scoring pass that writes here does not sit ALONGSIDE the
 *   scan's rows, it silently replaces them (it finishes later, so it wins the
 *   DISTINCT ON) — and for a check the scan deliberately never ran, it
 *   manufactures a scoring signal out of nothing. That is exactly how checks
 *   excluded from a package kept turning up with fresh rows after a scan.
 *
 *   Any caller that is not the scoring scan therefore passes `persist:false`.
 */
async function persistCheckProfile(
  persist: boolean,
  values: typeof tenantMonitorProfilesTable.$inferInsert,
): Promise<string | undefined> {
  if (!persist) return undefined;
  const [row] = await db
    .insert(tenantMonitorProfilesTable)
    .values(values)
    .onConflictDoNothing()
    .returning({ profileId: tenantMonitorProfilesTable.profileId });
  return row?.profileId;
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
  persistProfile: boolean;
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
  const severityMatch = classifySeverity(severityRules, extracted);

  // Configuration Drift (#1287) — the hook is present on the PowerShell path so
  // any deterministic-config PS check (DLP/label/transport-rule definitions) can
  // be drift-tracked with a one-line drift-check-specs.ts entry once its cmdlet
  // output shape is confirmed stable. No PS check has a spec yet (see the
  // registry's note on non-deterministic operational readings), so this is a
  // no-op today — but the executor type is wired, not skipped.
  await collectDriftForCompletedCheck(check, tenantId, items, extracted, "ok");

  // The container's contract (#210) is one synchronous request/response — no
  // @odata.nextLink, no CSV — so pageCount is always 1.
  const pageCount = 1;

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status: "ok",
    rawResponse: rawResponse as Record<string, unknown>,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
  });

  log.info(
    { checkKey: check.key, tenantId, itemCount: items.length, cmdletKey: check.psCmdletKey },
    "monitor-executor: PowerShell-backed check completed",
  );

  return {
    checkKey: check.key,
    status: "ok",
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
    profileId,
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
  persistProfile: boolean;
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
  const severityMatch = classifySeverity(severityRules, extracted);

  // Configuration Drift (#1287) — sharepoint:tenant-sharing-capability is
  // drift-tracked: the tenant-wide sharing-capability enum is the most stable
  // drift signal there is, and a change to it is a single `replace` at
  // /sharingCapability. Non-fatal, opt-in per check via drift-check-specs.ts.
  await collectDriftForCompletedCheck(check, tenantId, items, extracted, "ok");

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

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status: "ok",
    rawResponse,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
  });

  log.info(
    { checkKey: check.key, tenantId, spOperation: check.spOperation, itemCount: items.length },
    "monitor-executor: SharePoint-admin-backed check completed",
  );

  return {
    checkKey: check.key,
    status: "ok",
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
    profileId,
    ...(opts.includeItems ? { items } : {}),
  };
}

// ── Power-Platform-backed check executor (#1869) ──────────────────────────────
//
// Runs a check whose data lives on the Power Platform TENANT administration
// surface — DLP ("data") policies, environments and tenant settings — which
// Microsoft Graph does not expose at all. These are read from the Business
// Application Platform (BAP) admin API with an app-only token on the
// `https://service.powerapps.com/` resource, all of which
// power-platform-admin.ts already implements and this branch only calls.
//
// Modeled on runSharePointAdminCheck exactly: a distinct execution path that
// shares everything downstream of `items` (mapping -> schema -> severity ->
// persistence) and deliberately never touches graphFetchForTenant, so it is
// structurally unable to throw ConsentRevokedError. That matters here for the
// same reason it does for SharePoint, and more sharply: Power Platform access is
// granted by a one-time management-app REGISTRATION that is entirely separate
// from Graph admin consent, so a Power Platform 403 must never be allowed to
// flip a tenant's Graph consent state. power-platform-admin.ts's
// PowerPlatformAuthError / PowerPlatformNotRegisteredError are non-DB-mutating
// by design and reach the generic "error" branch below.
//
// READ-ONLY: every operation in the registry below is a GET. #1869 is explicitly
// scoped to making the surface visible, not to changing anything on it.

/**
 * A code-owned Power Platform operation: receives the tenant's AAD tenant GUID
 * and returns items in the same shape the Graph path produces, so applyMapping
 * and everything after it runs unmodified.
 *
 * Note this takes the bare tenant id rather than a resolved ref: unlike
 * SharePoint (which needs the `{prefix}.sharepoint.com` host derived from the
 * initial domain) the BAP admin API is a single global host and the AAD tenant
 * GUID is the only tenant identifier involved. There is nothing to resolve, so
 * there is no resolver.
 */
export type PowerPlatformOperation = (aadTenantId: string) => Promise<Record<string, unknown>[]>;

/**
 * The code-owned operation registry. `monitor_checks.pp_operation` stores a KEY
 * into this table and nothing else — never a URL, never a script — the same
 * contract `ps_cmdlet_key` and `sp_operation` follow. An unknown key is a hard
 * error at execution time, not a silent no-op.
 */
export const POWER_PLATFORM_OPERATIONS: Record<string, PowerPlatformOperation> = {
  /**
   * Every DLP policy in the tenant, one item per policy.
   *
   * An EMPTY result is a real answer, not a failure: a tenant with no Power
   * Platform DLP policy at all is precisely the governance finding this surface
   * exists to make visible. It is returned as a zero-length item list and
   * recorded with status "ok", exactly as an empty Graph collection would be —
   * never substituted with a placeholder row.
   */
  "dlp-policies": async (aadTenantId) => {
    const policies = await listDlpPolicies(aadTenantId);
    return policies.map((p: PowerPlatformDlpPolicy) => {
      const envFilter = p.properties?.definition?.constraints?.environmentFilter1?.parameters;
      const environments = envFilter?.environments ?? p.properties?.environments ?? [];
      return {
        policyName: p.name,
        displayName: p.properties?.displayName ?? null,
        createdTime: p.properties?.createdTime ?? null,
        lastModifiedTime: p.properties?.lastModifiedTime ?? null,
        // "AllEnvironments" | "ExcludeEnvironments" | "IncludeEnvironments" — the
        // wire vocabulary, passed through rather than remapped to a display one.
        environmentFilterType: envFilter?.filterType ?? null,
        environmentCount: Array.isArray(environments) ? environments.length : 0,
        environmentNames: Array.isArray(environments)
          ? environments.map((e) => e?.name ?? e?.id).filter(Boolean)
          : [],
        defaultApiGroup: p.properties?.definition?.defaultApiGroup ?? null,
      };
    });
  },

  /** Every Power Platform environment in the tenant, one item per environment. */
  "environments": async (aadTenantId) => {
    const environments = await listEnvironments(aadTenantId);
    return environments.map((e) => ({
      environmentName: e.name,
      displayName: e.properties?.displayName ?? null,
      environmentSku: e.properties?.environmentSku ?? null,
      isDefault: e.properties?.isDefault ?? null,
      location: e.location ?? null,
      createdTime: e.properties?.createdTime ?? null,
    }));
  },

  /**
   * Tenant-wide Power Platform settings. Returns a ONE-item array rather than a
   * bare value, for the same reason the SharePoint operations do: a tenant-wide
   * setting IS a single fact, and applyMapping/properties are written against an
   * item list.
   */
  "tenant-settings": async (aadTenantId) => {
    const settings = await getTenantSettings(aadTenantId);
    return [settings];
  },
};

function resolvePowerPlatformOperation(key: string | null | undefined): PowerPlatformOperation {
  const operation = key ? POWER_PLATFORM_OPERATIONS[key] : undefined;
  if (!operation) {
    throw new Error(
      `monitor check declares pp_operation "${key ?? "(null)"}", which is not in the code-owned registry ` +
      `(${Object.keys(POWER_PLATFORM_OPERATIONS).join(", ") || "empty"})`,
    );
  }
  return operation;
}

async function runPowerPlatformCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
  persistProfile: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;

  const operation = resolvePowerPlatformOperation(check.ppOperation);

  // Platform-wide credential guard, checked before any tenant work. Unlike the
  // SharePoint path this needs only the client SECRET — the Power Platform
  // resource accepts secret-based app-only tokens (see power-platform-admin.ts's
  // header), so demanding the certificate here would gate the surface on a
  // credential it does not use. Named explicitly so the persisted errorMessage
  // says which env vars are absent instead of surfacing an opaque 401 later.
  if (!powerPlatformCredentialsPresent()) {
    throw new Error(
      `monitor check ${check.key} needs Power Platform app-only credentials — set MT_APP_CLIENT_ID ` +
      `and MT_APP_CLIENT_SECRET (the same multi-tenant app registration Graph uses)`,
    );
  }

  const items = await operation(tenantId);

  // Same downstream contract as the Graph path: mapping/properties -> schema
  // validation -> severity classification -> persistence, all unmodified.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(items, mapping, properties);

  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: Power Platform check output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatch = classifySeverity(severityRules, extracted);

  // Configuration Drift (#1287) — opt-in per check via drift-check-specs.ts, so
  // this is an intended no-op until a Power Platform check is registered there.
  await collectDriftForCompletedCheck(check, tenantId, items, extracted, "ok");

  // One BAP round trip, one answer — the admin endpoints used here return a
  // whole collection in a single response, so there is no paging concept and
  // pageCount is always 1 (same reasoning as the PowerShell/SharePoint paths).
  const pageCount = 1;

  // rawResponse is the operation's own returned items, NOT the BAP envelope:
  // power-platform-admin.ts unwraps `value` internally and returns the typed
  // list, so the items ARE the rawest thing this layer legitimately has.
  // Recording the operation alongside them keeps the profile row self-describing
  // rather than implying a wire capture it doesn't hold.
  const rawResponse: Record<string, unknown> = {
    ppOperation: check.ppOperation,
    items,
  };

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status: "ok",
    rawResponse,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
  });

  log.info(
    { checkKey: check.key, tenantId, ppOperation: check.ppOperation, itemCount: items.length },
    "monitor-executor: Power-Platform-backed check completed",
  );

  return {
    checkKey: check.key,
    status: "ok",
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
    profileId,
    ...(opts.includeItems ? { items } : {}),
  };
}

// ── DNS-backed check executor (#496) ───────────────────────────────────────────
//
// Runs a check whose data is entirely PUBLIC DNS — SPF and DMARC are TXT
// records anyone can query with no tenant auth at all, and DKIM is checkable
// the same way against Microsoft 365's default key-rotation selector names.
// Modeled on runSharePointAdminCheck exactly: a distinct execution path that
// shares everything downstream of `items` (mapping -> schema -> severity ->
// persistence) and never touches graphFetchForTenant, so — like the
// SharePoint-admin path — it is structurally unable to throw
// ConsentRevokedError. No Graph, no PowerShell, no tenant credential of any
// kind is involved anywhere in this path.

/** Node dns error codes meaning "no records of this type exist" — the honest, expected shape of an unconfigured SPF/DMARC/DKIM record, not a failure. Any other error (e.g. a real resolver/network fault) is left to propagate to the generic "error" branch below. */
const DNS_NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA"]);

async function queryTxtRecords(hostname: string): Promise<string[]> {
  try {
    const records = await dnsPromises.resolveTxt(hostname);
    return records.map((chunks) => chunks.join(""));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code && DNS_NO_RECORD_CODES.has(code)) return [];
    throw err;
  }
}

/**
 * Microsoft 365's default DKIM selector names (Get-DkimSigningConfig's
 * Selector1/Selector2). A tenant that has rotated keys onto custom selector
 * names will not be found here — that is a real false-negative this check
 * cannot see past, not something it claims to rule out (see
 * dkimConfiguredAtDefaultSelectors below).
 */
const DKIM_DEFAULT_SELECTORS = ["selector1", "selector2"] as const;

/**
 * The tenant's real mail domain, reused as-is from whatever consent.ts's
 * domain-capture logic (#238) already stamped onto tenants.domain — the same
 * source resolveSharePointTenantRef reads. Unlike the SharePoint path this
 * does not require the value to be an *.onmicrosoft.com initial domain: any
 * real domain is a valid thing to run public DNS lookups against.
 */
async function resolveTenantDnsDomain(tenantId: string): Promise<string> {
  const [tenantRow] = await db
    .select({ domain: tenantsTable.domain })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);

  const domain = tenantRow?.domain ?? (await getInitialDomainForTenant(tenantId));
  if (!domain) {
    throw new Error(
      `cannot resolve a domain for tenant ${tenantId} to run DNS-backed checks against: ` +
      `tenants.domain is not set and the Graph /organization lookup returned no initial domain`,
    );
  }
  return domain;
}

async function runDnsCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
  persistProfile: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;

  const domain = await resolveTenantDnsDomain(tenantId);

  const [spfRecords, dmarcRecords, dkimSelectorRecords] = await Promise.all([
    queryTxtRecords(domain),
    queryTxtRecords(`_dmarc.${domain}`),
    Promise.all(DKIM_DEFAULT_SELECTORS.map((selector) => queryTxtRecords(`${selector}._domainkey.${domain}`))),
  ]);

  const spfRecord = spfRecords.find((r) => r.startsWith("v=spf1")) ?? null;
  const dmarcRecord = dmarcRecords.find((r) => r.startsWith("v=DMARC1")) ?? null;
  const dkimFoundAtSelectors = DKIM_DEFAULT_SELECTORS.filter((_selector, i) => dkimSelectorRecords[i]!.length > 0);

  // One item per run — a domain's DNS posture is a single fact, same reasoning
  // as the SharePoint-admin tenant-wide-setting operations.
  const item: Record<string, unknown> = {
    domain,
    spfRecord,
    spfConfigured: spfRecord !== null,
    dmarcRecord,
    dmarcConfigured: dmarcRecord !== null,
    dkimCheckedSelectors: [...DKIM_DEFAULT_SELECTORS],
    dkimFoundAtDefaultSelectors: dkimFoundAtSelectors,
    // Deliberately named "AtDefaultSelectors", not "dkimConfigured": a tenant
    // using custom/rotated selector names could have a real DKIM record this
    // check cannot see, so `false` here means "not found at the default
    // selectors checked", not "DKIM is not configured".
    dkimConfiguredAtDefaultSelectors: dkimFoundAtSelectors.length > 0,
  };
  const items = [item];

  // Same downstream contract as the Graph and SharePoint-admin paths:
  // mapping/properties -> schema validation -> severity classification ->
  // persistence, all unmodified.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(items, mapping, properties);

  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: DNS-backed check output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatch = classifySeverity(severityRules, extracted);

  // Configuration Drift (#1287) — exchange:dkim-spf-dmarc-status is drift-tracked:
  // the SPF/DMARC record strings and the DKIM selectors found are a deterministic
  // public-DNS posture, so an edited record or a vanished DKIM key is a `replace`.
  // Non-fatal, opt-in per check via drift-check-specs.ts.
  await collectDriftForCompletedCheck(check, tenantId, items, extracted, "ok");

  // One DNS lookup set, one answer — no paging concept here either.
  const pageCount = 1;

  const rawResponse: Record<string, unknown> = { domain, items };

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status: "ok",
    rawResponse,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
  });

  log.info(
    { checkKey: check.key, tenantId, domain, itemCount: items.length },
    "monitor-executor: DNS-backed check completed",
  );

  return {
    checkKey: check.key,
    status: "ok",
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
    profileId,
    ...(opts.includeItems ? { items } : {}),
  };
}

// ── Azure Resource Manager check executor (#1871) ─────────────────────────────
//
// Runs a check whose data lives on Azure Resource Manager
// (https://management.azure.com) rather than on Graph, PowerShell, SharePoint or
// DNS. Like the three transports above it never touches graphFetchForTenant, and
// for the same structural reason: an ARM authorization failure has nothing to do
// with a customer's Graph consent, so this path must be UNABLE to throw
// ConsentRevokedError, not merely unlikely to.
//
// What is different here, and why this executor is longer than runDnsCheck: on
// every other transport, "the platform is authorized" is a tenant-level fact
// settled at consent time. On ARM it is not. Azure RBAC is scoped to management
// groups, subscriptions and resource groups, and a tenant that has granted the
// platform every Graph permission Microsoft publishes may still expose zero
// Azure. So this executor runs a reach probe first and treats its outcome as a
// first-class result state, persisted alongside the check's own row.
//
// The three no-data outcomes are deliberately NOT collapsed into one:
//
//   error (unreachable)     — no ARM token could be acquired at all. Nothing is
//                             known about this tenant's Azure.
//   azure_no_rbac           — a valid ARM token, and an RBAC-filtered listing
//                             that came back empty. We hold no Azure role here.
//                             This says nothing about whether the customer HAS
//                             Azure, and must never be reported as if it did.
//   azure_no_subscriptions  — the same empty listing, corroborated by a readable
//                             management-group scope that would have covered
//                             every subscription in the tenant. The tenant
//                             genuinely has no Azure. A complete, normal answer
//                             for an M365 governance customer — not a failure.
async function runAzureRmCheck(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
  persistProfile: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey } = opts;

  // Resolved before any network call so a check pointing at a non-existent
  // operation fails loudly on its own definition rather than after a live probe.
  const operation = resolveAzureRmOperation(check.armOperation);

  // Platform-wide credential guard, checked before any tenant work: a missing
  // ARM principal is a platform configuration fault, not a customer's tenant
  // being un-onboarded, and the two must not read the same. Same precedent as
  // runSharePointAdminCheck's sharePointAdminCredentialsPresent() guard.
  if (!armCredentialsPresent()) {
    throw new Error(
      `monitor check ${check.key} needs an ARM principal — set AZURE_RM_CLIENT_ID/AZURE_RM_CLIENT_SECRET, ` +
      `or MT_APP_CLIENT_ID/MT_APP_CLIENT_SECRET for the multi-tenant app`,
    );
  }

  const reach = await probeAzureRmReach(tenantId);
  await persistAzureRmReach(opts.persistProfile, tenantId, reach);

  if (reach.state !== "ok") {
    return await persistAzureRmNoDataResult({ ...opts, reach });
  }

  const { token } = await getArmAccessTokenForTenant(tenantId);
  const ctx: AzureRmContext = { tenantId, accessToken: token, reach, scopeOutcomes: [] };
  const items = await operation(ctx);

  // Same downstream contract as every other transport: mapping/properties ->
  // schema validation -> severity classification -> persistence, all unmodified.
  const mapping = (check.mapping ?? []) as MappingRule[];
  const properties = (check.properties ?? []) as string[];
  const extracted = applyMapping(items, mapping, properties);

  // Coverage is a first-class part of an ARM answer, not a footnote: a run that
  // read 2 of a customer's 5 subscriptions and got 403 on the rest produced real
  // data whose denominator is wrong, and the raw per-scope HTTP outcomes are the
  // only honest record of that. Written under a reserved `_azure` key alongside
  // the check's own extracted properties, the same way the fan-out path reports
  // `_fanOut`.
  extracted._azure = azureCoverageSummary(reach, ctx);

  if (check.outputSchema) {
    const { valid, errors } = validateOutputShape(extracted, check.outputSchema as Record<string, unknown>);
    extracted._schemaValid = valid;
    if (!valid) {
      log.warn({ checkKey: check.key, errors }, "monitor-executor: azure-rm check output schema validation failed");
      extracted._schemaErrors = errors;
    }
  }

  const severityRules = (check.severityRules ?? []) as SeverityRule[];
  const severityMatch = classifySeverity(severityRules, extracted);

  // A scope that answered 403 means this run's item list is incomplete. That is
  // exactly what "partial" was added for on the fan-out path (real data, known
  // incomplete coverage), so it is reused rather than a new near-synonym invented.
  const unauthorizedScopes = ctx.scopeOutcomes.filter((o) => !o.ok && o.httpStatus === 403);
  const status: CheckResult["status"] = unauthorizedScopes.length > 0 ? "partial" : "ok";

  await collectDriftForCompletedCheck(check, tenantId, items, extracted, status);

  // One GET per scope, and armGetAll already exhausted nextLink within each —
  // there is no per-check paging concept left to report, the same as the
  // SharePoint-admin and DNS paths.
  const pageCount = 1;

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status,
    rawResponse: { armOperation: check.armOperation, scopeOutcomes: ctx.scopeOutcomes, items },
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
  });

  log.info(
    {
      checkKey: check.key,
      tenantId,
      armOperation: check.armOperation,
      subscriptionCount: reach.subscriptions.length,
      itemCount: items.length,
      unauthorizedScopeCount: unauthorizedScopes.length,
      status,
    },
    "monitor-executor: azure-rm check completed",
  );

  return {
    checkKey: check.key,
    status,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    itemCount: items.length,
    pageCount,
    profileId,
    ...(opts.includeItems ? { items } : {}),
  };
}

/** The observed coverage of one azure-rm run — every field a real HTTP result, none inferred. */
function azureCoverageSummary(reach: AzureRmReach, ctx: AzureRmContext): Record<string, unknown> {
  const readable = ctx.scopeOutcomes.filter((o) => o.ok).length;
  return {
    reachState: reach.state,
    principalClientId: reach.principalClientId,
    subscriptionsVisible: reach.subscriptions.length,
    lighthouseDelegatedSubscriptions: reach.subscriptions.filter((s) => s.managedByTenantIds.length > 0).length,
    scopesAttempted: ctx.scopeOutcomes.length,
    scopesReadable: readable,
    scopeOutcomes: ctx.scopeOutcomes,
  };
}

/**
 * Persist the reach probe's real result. Upserted per tenant rather than
 * appended, because "what can we see in this tenant's Azure right now" is a
 * current-state fact; the per-run history lives on tenant_monitor_profiles.
 */
async function persistAzureRmReach(persist: boolean, tenantId: string, reach: AzureRmReach): Promise<void> {
  if (!persist) return;
  const now = new Date();
  await db
    .insert(tenantAzureReachTable)
    .values({
      tenantId,
      state: reach.state,
      tokenAcquired: reach.tokenAcquired,
      subscriptionsHttpStatus: reach.subscriptionsHttpStatus,
      managementGroupsHttpStatus: reach.managementGroupsHttpStatus,
      subscriptions: reach.subscriptions,
      principalClientId: reach.principalClientId,
      principalObjectId: reach.principalObjectId,
      errorMessage: reach.errorMessage,
      probedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantAzureReachTable.tenantId,
      set: {
        state: reach.state,
        tokenAcquired: reach.tokenAcquired,
        subscriptionsHttpStatus: reach.subscriptionsHttpStatus,
        managementGroupsHttpStatus: reach.managementGroupsHttpStatus,
        subscriptions: reach.subscriptions,
        principalClientId: reach.principalClientId,
        principalObjectId: reach.principalObjectId,
        errorMessage: reach.errorMessage,
        probedAt: now,
        updatedAt: now,
      },
    });
}

/**
 * Persist the honest no-data outcome of an azure-rm check. No items are
 * fabricated and no severity rule is evaluated — there is nothing to evaluate —
 * so the row records WHY there is no data, in a form a later reader can act on.
 */
async function persistAzureRmNoDataResult(opts: {
  check: MonitorCheck;
  tenantId: string;
  triggerId: string;
  idempotencyKey: string;
  includeItems?: boolean;
  persistProfile: boolean;
  reach: AzureRmReach;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId, idempotencyKey, reach } = opts;

  const status: CheckResult["status"] =
    reach.state === "no_subscriptions" ? "azure_no_subscriptions"
      : reach.state === "no_rbac" ? "azure_no_rbac"
        : "error";

  const extracted: Record<string, unknown> = {
    _azure: {
      reachState: reach.state,
      principalClientId: reach.principalClientId,
      subscriptionsVisible: 0,
      subscriptionsHttpStatus: reach.subscriptionsHttpStatus,
      managementGroupsHttpStatus: reach.managementGroupsHttpStatus,
      // The concrete next action, named on the row rather than left to be
      // rediscovered. Only ever set for no_rbac — a tenant that genuinely has no
      // Azure needs nothing granted.
      requiredGrant: reach.state === "no_rbac"
        ? `Azure RBAC "${AZURE_RM_LEAST_PRIVILEGE_ROLE}" on the customer's subscription(s), granted by the customer ` +
          `(Azure Lighthouse delegation, or a direct role assignment) to principal ${reach.principalClientId ?? "(unknown)"}`
        : null,
    },
  };

  const errorMessage =
    reach.state === "unreachable"
      ? `Azure Resource Manager is unreachable for this tenant: ${reach.errorMessage ?? "no ARM token could be acquired"}`
      : undefined;

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status,
    rawResponse: { armOperation: check.armOperation, reach },
    extractedProperties: extracted,
    severityMatched: null,
    severityLabel: null,
    errorMessage,
    itemCount: 0,
    pageCount: 0,
  });

  log.info(
    { checkKey: check.key, tenantId, reachState: reach.state, status },
    "monitor-executor: azure-rm check produced no data — recording the reach state, not an empty result",
  );

  return {
    checkKey: check.key,
    status,
    extractedProperties: extracted,
    severityMatched: null,
    severityLabel: null,
    ...(errorMessage ? { errorMessage } : {}),
    itemCount: 0,
    pageCount: 0,
    profileId,
    ...(opts.includeItems ? { items: [] } : {}),
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
  persistProfile: boolean;
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

  // Stop early on consent (auth-level, tenant-fatal) or on a PURE license gap
  // signal — every outcome so far is a license gap, none are a generic
  // failure — while nothing has succeeded yet (a tenant-wide missing SKU, no
  // point hammering every remaining group to re-learn it). Git #1786: this
  // used to bail on `licenseErr && succeeded === 0` alone, which also fires
  // on a MIXED first batch (e.g. 1 real license_gap + 3 unrelated transient
  // "fetch failed" errors) — confirmed live on identity:pim-groups, where it
  // silently abandoned 100 of 104 groups after one bad batch and reported the
  // whole check as `error` even though the license-gap signal was not clean.
  // Requiring `failed === 0` matches the "pure" signal the post-loop
  // short-circuit throw below already uses, so the two conditions agree.
  for (
    let i = 0;
    i < entries.length && !consentErr && !(licenseErr && succeeded === 0 && failed === 0);
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
  const severityMatch = classifySeverity(severityRules, extracted);

  // Configuration Drift (#1287) — fan-out checks diff the NORMALISED per-site
  // rows (`combinedItems`), keyed by site id, so a newly overshared site is an
  // `add` and a revoked share a `replace`. Crucially the REAL run `status` is
  // passed: an incomplete/truncated fan-out is refused by the spec's coverage
  // guard (recorded as not_comparable with a specific reason) rather than
  // diffing a partial site set and fabricating "shares were revoked". Today:
  // compliance:eeeu-site-sharing (External Sharing Drift, #1333).
  await collectDriftForCompletedCheck(check, tenantId, combinedItems, extracted, status);

  const pageCount = enumResult.pageCount + perItemPageTotal;
  const rawResponse = {
    _format: "fanOut",
    _fanOut: extracted._fanOut,
    sourceSample: enumResult.items.slice(0, 5),
  };

  const profileId = await persistCheckProfile(opts.persistProfile, {
    tenantId,
    checkKey: check.key,
    checkSchemaVersion: check.schemaVersion,
    triggerId,
    idempotencyKey,
    status,
    rawResponse: rawResponse as Record<string, unknown>,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    errorMessage: status === "ok"
      ? undefined
      : `Fan-out coverage: ${succeeded}/${entries.length} ${idField === "id" ? "items" : idField} succeeded, ${failed} failed${licenseGapCount ? `, ${licenseGapCount} license-gapped` : ""}${excludedByFilter ? `, ${excludedByFilter} excluded by filter` : ""}${truncated ? ` (capped at ${maxItems})` : ""}`,
    itemCount: combinedItems.length,
    pageCount,
  });

  log.info(
    { checkKey: check.key, tenantId, status, ...extracted._fanOut as Record<string, unknown> },
    "monitor-executor: fan-out check completed",
  );

  return {
    checkKey: check.key,
    status,
    extractedProperties: extracted,
    severityMatched: severityMatch?.severity ?? null,
    severityLabel: severityMatch?.label ?? null,
    errorMessage: status === "ok" ? undefined : `${succeeded}/${entries.length} items succeeded, ${failed} failed`,
    itemCount: combinedItems.length,
    pageCount,
    profileId,
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
  /**
   * Write this check's result into `tenant_monitor_profiles` (default true).
   *
   * FALSE IS NOT AN OPTIMISATION — it is a correctness requirement for any
   * caller that is not the scoring scan. See `persistCheckProfile`'s comment:
   * that table is read unscoped as the tenant's live per-check signal, so a
   * non-scoring pass writing to it silently becomes the score. #543.
   */
  persistProfile?: boolean;
}): Promise<CheckResult> {
  const { check, tenantId, triggerId } = opts;
  const persistProfile = opts.persistProfile !== false;
  const idempotencyKey = `${tenantId}:${check.key}:${triggerId}`;

  // Idempotency guard — return cached result if already collected
  if (!opts.skipIdempotency) {
    const [existing] = await db
      .select({
        profileId: tenantMonitorProfilesTable.profileId,
        status: tenantMonitorProfilesTable.status,
        extractedProperties: tenantMonitorProfilesTable.extractedProperties,
        severityMatched: tenantMonitorProfilesTable.severityMatched,
        severityLabel: tenantMonitorProfilesTable.severityLabel,
        errorMessage: tenantMonitorProfilesTable.errorMessage,
        itemCount: tenantMonitorProfilesTable.itemCount,
        pageCount: tenantMonitorProfilesTable.pageCount,
      })
      .from(tenantMonitorProfilesTable)
      .where(eq(tenantMonitorProfilesTable.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      const cachedExtracted = (existing.extractedProperties ?? {}) as Record<string, unknown>;
      return {
        checkKey: check.key,
        status: existing.status as CheckResult["status"],
        extractedProperties: cachedExtracted,
        severityMatched: existing.severityMatched ?? null,
        // Git #549: the row now records the label that ACTUALLY fired, so prefer
        // it outright — it was rendered against this very run's data and against
        // the rules as they stood then. `labelForStoredSeverity` stays as the
        // fallback for rows written before that column existed; it re-derives,
        // which is the strictly weaker answer (see its own doc comment) but is
        // still better than the generic title for a pre-#549 cache hit.
        severityLabel:
          existing.severityLabel ??
          labelForStoredSeverity(
            (check.severityRules ?? []) as SeverityRule[],
            cachedExtracted,
            existing.severityMatched ?? null,
          ),
        errorMessage: existing.errorMessage ?? undefined,
        itemCount: existing.itemCount ?? 0,
        pageCount: existing.pageCount ?? 0,
        profileId: existing.profileId,
      };
    }
  }

  // Air-gapped / customer-script mode: flag as requires_script, don't attempt Graph fetch
  if (check.requiresCustomerScript) {
    const profileId = await persistCheckProfile(persistProfile, {
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
    });

    return {
      checkKey: check.key,
      status: "requires_script",
      extractedProperties: {},
      severityMatched: null,
      itemCount: 0,
      pageCount: 0,
      profileId,
    };
  }

  try {
    // PowerShell-backed checks (executorType = 'powershell', #209/#211) take an
    // entirely separate path that never touches Graph at all — checked first,
    // ahead of the fan-out/Graph branches below, which are Graph-only by
    // construction (executorType defaults to 'graph' for every existing check).
    if (check.executorType === "powershell") {
      return await runPowerShellCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
    }

    // SharePoint-admin-backed checks (executorType = 'sharepoint-admin', #394)
    // take the same kind of separate, Graph-free path, for the same reason: the
    // SharePoint Online tenant-administration surface has no Graph equivalent.
    // Only a check whose row explicitly carries this executorType can reach it —
    // every 'graph' (the column default, i.e. every pre-existing check) and
    // 'powershell' check falls through exactly as before.
    if (check.executorType === "sharepoint-admin") {
      return await runSharePointAdminCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
    }

    // Power-Platform-backed checks (executorType = 'power-platform', #1869)
    // take the same kind of separate, Graph-free path, for the same reason: DLP
    // policies, environments and Power Platform tenant settings have no Graph
    // equivalent — they live on the BAP admin API under a different resource
    // audience. Only a check whose row explicitly carries this executorType can
    // reach it — every 'graph' (the column default, i.e. every pre-existing
    // check) and 'powershell'/'sharepoint-admin'/'dns' check falls through
    // exactly as before.
    if (check.executorType === "power-platform") {
      return await runPowerPlatformCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
    }

    // DNS-backed checks (executorType = 'dns', #496) take the same kind of
    // separate, Graph-free path, for the same reason: SPF/DMARC/DKIM live in
    // public DNS, not on any Microsoft Graph or Exchange surface — no Graph,
    // no PowerShell, no tenant credential of any kind. Only a check whose row
    // explicitly carries this executorType can reach it — every 'graph' and
    // 'powershell'/'sharepoint-admin' check falls through exactly as before.
    if (check.executorType === "dns") {
      return await runDnsCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
    }

    // Azure Resource Manager-backed checks (executorType = 'azure-rm', #1871)
    // take the same kind of separate, Graph-free path, for the same reason: the
    // 22 modelled azure-rm config resources live on management.azure.com behind
    // Azure RBAC, which is a different control plane from Graph consent
    // entirely. Only a check whose row explicitly carries this executorType can
    // reach it — every 'graph'/'powershell'/'sharepoint-admin'/'dns' check falls
    // through exactly as before.
    if (check.executorType === "azure-rm") {
      return await runAzureRmCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
    }

    // Fan-out (group-scoped) checks take an entirely separate, additive path.
    // Enumeration-level consent/license/generic errors it throws are caught by
    // this same try/catch below, so the auto-revoke + license_gap persistence
    // contract is shared, not duplicated. Non-fan-out checks (fanOutSource NULL —
    // every existing check) fall straight through to the unchanged path.
    if (check.fanOutSource) {
      return await runFanOutCheck({ check, tenantId, triggerId, idempotencyKey, includeItems: opts.includeItems, persistProfile });
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
    const severityMatch = classifySeverity(severityRules, extracted);

    // 4b. Configuration Drift (#1270/#1283/#1287) — additive, non-fatal, opt-in
    // per check via drift-check-specs.ts. Diffs the RAW `items` (the real config)
    // not the lossy mapped `extracted`. Graph checks with a spec today:
    // identity:ca-policy-count and governance:public-teams-discoverable.
    await collectDriftForCompletedCheck(check, tenantId, items, extracted, "ok");

    // 5. Persist result
    const profileId = await persistCheckProfile(persistProfile, {
      tenantId,
      checkKey: check.key,
      checkSchemaVersion: check.schemaVersion,
      triggerId,
      idempotencyKey,
      status: "ok",
      rawResponse: rawResponse as Record<string, unknown>,
      extractedProperties: extracted,
      severityMatched: severityMatch?.severity ?? null,
      severityLabel: severityMatch?.label ?? null,
      itemCount: items.length,
      pageCount,
    });

    return {
      checkKey: check.key,
      status: "ok",
      extractedProperties: extracted,
      severityMatched: severityMatch?.severity ?? null,
      severityLabel: severityMatch?.label ?? null,
      itemCount: items.length,
      pageCount,
      profileId,
      ...(opts.includeItems ? { items } : {}),
    };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      await markTenantConsentRevoked(tenantId);
      const profileId = await persistCheckProfile(persistProfile, {
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "consent_revoked",
        errorMessage: err.message,
        itemCount: 0,
        pageCount: 0,
      });

      return {
        checkKey: check.key,
        status: "consent_revoked",
        extractedProperties: {},
        severityMatched: null,
        errorMessage: err.message,
        itemCount: 0,
        pageCount: 0,
        profileId,
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
      const profileId = await persistCheckProfile(persistProfile, {
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
      });

      return {
        checkKey: check.key,
        status: "license_gap",
        extractedProperties: extracted,
        severityMatched: null,
        errorMessage: `Requires ${err.feature}`,
        itemCount: 0,
        pageCount: 0,
        profileId,
        licenseFeature: err.feature,
      };
    }

    // #1847 — the Microsoft SERVICE behind this check will not answer for this
    // tenant, and we know from real signals why. This is a state, not a failure and
    // not zero rows: `_serviceState` names which of the five conditions it is, so no
    // consumer has to infer it, and no numeric value is extracted at all — a check
    // that resolves here has NO measured value, and every resolver treats a missing
    // value as unavailable rather than as 0.
    //
    // The tenant-level fact is recorded ONCE, keyed (tenantId, serviceKey), so the
    // ten devices:* checks hitting this in a single run leave one row rather than ten
    // independent announcements of the same tenant-wide condition.
    if (err instanceof ServiceNotConfiguredError) {
      await recordTenantServiceState({
        tenantId,
        verdict: err.verdict,
        observedEndpoint: err.endpoint,
        observedHttpStatus: err.httpStatus,
        responseBody: err.responseBody,
        detectedByCheckKey: check.key,
      });

      const service = serviceDisplayName(err.serviceKey);
      const extracted: Record<string, unknown> = {
        _serviceUnavailable: true,
        _serviceKey: err.serviceKey,
        _serviceState: err.state,
        _serviceName: service,
        _serviceDetectionSignature: err.detectionSignature,
      };
      log.info(
        { checkKey: check.key, tenantId, serviceKey: err.serviceKey, state: err.state },
        "monitor-executor: check unavailable — the Microsoft service behind it is not answering for this tenant",
      );
      const profileId = await persistCheckProfile(persistProfile, {
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "service_not_configured",
        extractedProperties: extracted,
        errorMessage: err.reason,
        itemCount: 0,
        pageCount: 0,
      });

      return {
        checkKey: check.key,
        status: "service_not_configured",
        extractedProperties: extracted,
        severityMatched: null,
        errorMessage: err.reason,
        itemCount: 0,
        pageCount: 0,
        profileId,
        serviceKey: err.serviceKey,
        serviceState: err.state,
      };
    }

    // Power Platform management-app not yet enrolled for this tenant (#1972).
    // Known cause, known one-time remediation (the customer's own tenant admin
    // runs the device-code enrolment — see power-platform-admin.ts), so this
    // is persisted as its own status rather than falling into generic "error":
    // an onboarding gap the portal can point the customer at, not a fault to
    // retry. Never routes through markTenantConsentRevoked — Power Platform
    // enrolment is entirely independent of Graph consent (see
    // power-platform-admin.ts's file header for why the two must never mix).
    if (err instanceof PowerPlatformNotRegisteredError) {
      log.info(
        { checkKey: check.key, tenantId, clientId: err.clientId },
        "monitor-executor: check unavailable — Power Platform management app not yet enrolled for this tenant",
      );
      const profileId = await persistCheckProfile(persistProfile, {
        tenantId,
        checkKey: check.key,
        checkSchemaVersion: check.schemaVersion,
        triggerId,
        idempotencyKey,
        status: "power_platform_not_registered",
        errorMessage: err.message,
        itemCount: 0,
        pageCount: 0,
      });

      return {
        checkKey: check.key,
        status: "power_platform_not_registered",
        extractedProperties: {},
        severityMatched: null,
        errorMessage: err.message,
        itemCount: 0,
        pageCount: 0,
        profileId,
      };
    }

    // PsExecutionError with kind "cmdlet_unavailable" (#250, #491): the
    // ps-execution container caught a real CommandNotFoundException
    // resolving the check's cmdlet — see ps-execution-client.ts's
    // PsExecutionError doc comment for why this can ONLY mean the tenant's
    // Security & Compliance (or, #491, Exchange Online) session never got
    // this cmdlet registered (a licensing gap OR the app not yet being in
    // the right role group — Purview role group for the #250 checks,
    // Exchange RBAC role for #491's — the two are indistinguishable from the
    // error text alone, confirmed by inspecting
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
      const feature = licenseGapFeatureForCmdletKey(check.psCmdletKey);
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
      const profileId = await persistCheckProfile(persistProfile, {
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
      });

      return {
        checkKey: check.key,
        status: "license_gap",
        extractedProperties: extracted,
        severityMatched: null,
        errorMessage: `Requires ${feature}`,
        itemCount: 0,
        pageCount: 0,
        profileId,
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

    const profileId = await persistCheckProfile(persistProfile, {
      tenantId,
      checkKey: check.key,
      checkSchemaVersion: check.schemaVersion,
      triggerId,
      idempotencyKey,
      status: "error",
      errorMessage: errorMessage.slice(0, 1000),
      itemCount: 0,
      pageCount: 0,
    });

    return {
      checkKey: check.key,
      status: "error",
      extractedProperties: {},
      severityMatched: null,
      errorMessage,
      itemCount: 0,
      pageCount: 0,
      profileId,
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
      serviceNotConfiguredCount: 0,
      serviceStates: [],
      enginesRecomputed: [],
      licenseGapCount: 0,
      licenseGapFeatures: [],
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // The resolved check list, logged in full before the first check runs (#543).
  //
  // This exists because "is check X actually in this package's run?" was, until
  // now, unanswerable from the logs — the only observable was rows appearing in
  // tenant_monitor_profiles afterwards, which several different code paths can
  // write. That ambiguity is what turned a one-line answer into a multi-night
  // investigation. `checkKeys` is the definitive, pre-execution answer for this
  // run: if a key is absent here, THIS package run did not execute it, and any
  // row that shows up for it came from somewhere else.
  log.info(
    {
      packageKey,
      tenantId,
      triggerId,
      linkedCheckCount,
      resolvedCheckCount: orderedChecks.length,
      checkKeys: orderedChecks.map(c => c.key),
    },
    "monitor-executor: resolved package check list — these and ONLY these will execute in this run",
  );

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
        severityLabel: errResult.severityLabel,
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
      severityLabel: result.severityLabel,
    });
  }

  // Tenant workload estate (Git #2008) — refreshed only when this run actually
  // included a check hitting /subscribedSkus, so an unrelated package doesn't
  // pay for a pointless lookup. syncTenantServicePlans reads the page this run
  // just persisted to tenant_monitor_profiles (no extra Graph call) and is
  // never allowed to fail a monitor run — this is a secondary derived table,
  // not the check result itself.
  if (orderedChecks.some((c) => c.endpoint.toLowerCase().includes("subscribedskus"))) {
    try {
      const workloadSync = await syncTenantServicePlans(tenantId);
      log.info({ tenantId, packageKey, ...workloadSync }, "executeMonitoringPackage: tenant workload estate synced");
    } catch (err) {
      log.warn(
        { tenantId, packageKey, err: err instanceof Error ? err.message : String(err) },
        "executeMonitoringPackage: tenant workload estate sync failed (non-fatal)",
      );
    }
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

  // #1847 — collapse the per-check results down to the DISTINCT tenant-level
  // service states. Ten devices:* checks hitting the same Intune condition are one
  // fact about the tenant, and the run summary says it once.
  const serviceNotConfiguredResults = results.filter(r => r.status === "service_not_configured");
  const serviceStates = [
    ...new Map(
      serviceNotConfiguredResults
        .filter(r => r.serviceKey && r.serviceState)
        .map(r => [r.serviceKey!, { serviceKey: r.serviceKey!, state: r.serviceState! }]),
    ).values(),
  ];

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
    serviceNotConfiguredCount: serviceNotConfiguredResults.length,
    serviceStates,
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
