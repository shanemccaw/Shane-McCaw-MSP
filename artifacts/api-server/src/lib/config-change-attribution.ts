/**
 * config-change-attribution.ts — the verdict/lifecycle layer over `config_diff_changes`
 * (Git #2759).
 *
 * `config-snapshot-differ.ts` says WHAT changed and seals it. This says WHY, and it
 * gets the answer from two real, populated stores rather than from a heuristic:
 * `msp_change_requests` (#1486) and `msp_risk_decisions` (#1487). The store's own
 * shape and the reasoning behind each table are documented on
 * `lib/db/src/schema/config-attribution.ts`; this file is the engine that fills it.
 *
 * ─── What this replaces, and why it is not the same thing ──────────────────────
 * `monitor-executor.ts`'s `buildCaChangeRequestAttribution` (#1283/#1505) is the
 * existing attribution path, and its own comment states its limit plainly: "A CR
 * describes an intended change, not a JSON path, so this cannot attribute per-setting
 * … when a qualifying CR exists, every drifted setting in this scan is attributed to
 * it the same way." One completed Conditional Access CR in the last 30 days therefore
 * marks EVERY Conditional Access drift `approved`, including drift it had nothing to
 * do with.
 *
 * This layer does not widen that; it replaces the guess with a join. A change request
 * is walked down to the real Graph endpoint it writes — `change_catalog_items` →
 * `config_packs` → `config_pack_templates` → `baseline_action_templates.endpoint`, or
 * better, the `cr_executions` record of what it ACTUALLY wrote — and that endpoint is
 * resolved against the real resource registry (`config_snapshot_resource_types`, which
 * carries `graph_version` + `graph_path` for 1,539 registered types). The result is a
 * scope that joins `config_diff_changes.resource_key` exactly.
 *
 * Nothing here falls back to the category-wide blanket when that walk finds nothing. A
 * change request with no derivable endpoint attributes NOTHING, and every change under
 * it stays `unattributed`. That is the correct answer: an unexplained configuration
 * change wrongly marked "approved" is strictly worse than one honestly marked "needs
 * review", because only the second one gets looked at.
 *
 * ─── The three real time questions, answered separately ────────────────────────
 * 1. WHEN COULD THE CHANGE HAVE HAPPENED? Between the two snapshots the diff compares:
 *    `(base.captured_at, head.captured_at]`. That is the only interval the evidence
 *    supports; the differ cannot say where inside it the change landed.
 * 2. WHEN DID THE CHANGE REQUEST ACT? `cr_executions.executed_at` when a real execution
 *    record exists, its scheduled window when it does not. A CR attributes only if that
 *    overlaps (1), widened by {@link WINDOW_TOLERANCE_MS} for clock skew between the
 *    executing service and the collector.
 * 3. WHEN IS A RISK ACCEPTANCE IN FORCE? From `accepted_at` onward, with NO upper
 *    bound — deliberately. #1507 settled this: an acceptance is a signed fact and does
 *    not expire; `expiration_date` / `review_due_at` lapse the REVIEW, not the
 *    acceptance, and a past-due review surfaces as an operational flag on a decision
 *    that stays `active`. Bounding attribution by `expiration_date` would silently
 *    reclassify accepted risk as unexplained drift the day a review went overdue.
 *    What DOES end it is `status` leaving `'active'` (revoked), and that is checked
 *    live on every pass rather than frozen into a stored window.
 */

import {
  db,
  pool,
  configDiffsTable,
  configDiffChangesTable,
  configChangeScopesTable,
  configChangeAttributionsTable,
  configChangeAttributionMatchesTable,
  configChangeLifecycleTable,
  configSnapshotResourceTypesTable,
  tenantConfigSnapshotsTable,
  tenantsTable,
  mspChangeRequestsTable,
  mspRiskDecisionsTable,
  type ConfigChangeMatchScope,
  type ConfigChangeScopeBasis,
  type ConfigChangeVerdict,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";
import { normalizePropertyPath } from "./config-snapshot-differ";
import { formatChangeRequestCode, type ChangeRequestStoredStatus } from "./portal-change-control";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * Bumped whenever the matching or ranking rules below change. Stored on every
 * attribution row so a verdict computed under old rules is identifiable and
 * re-judgeable — the same reason `config_diffs` carries `differ_version`.
 */
export const ATTRIBUTION_VERSION = "attribution-1";

/**
 * Clock-skew allowance when testing a change request's action against the snapshot
 * window. The executing service, the Graph API and the snapshot collector are three
 * different clocks, and a CR executed four minutes before a snapshot was captured
 * plainly still explains what that snapshot found.
 *
 * One hour, and deliberately small. The value this replaces was THIRTY DAYS
 * (`CA_CR_ATTRIBUTION_WINDOW_DAYS`), which had to be that wide precisely because it
 * was attributing on category alone with no idea what the CR touched. Once the scope
 * is a real endpoint match, a wide window buys nothing and costs correctness: it lets
 * a month-old change request absorb a change it could not have caused.
 */
export const WINDOW_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * Change-request statuses that represent a change that ACTUALLY TOUCHED the tenant, and
 * can therefore explain a configuration difference.
 *
 * `pending_approval` and `scheduled` are excluded on purpose: those CRs have not
 * written anything, so a change matching their scope is drift that PRE-EMPTED an
 * approval, which is a materially different — and more serious — finding than an
 * approved change. `rejected` likewise. `rolled_back` IS included: a rolled-back change
 * was applied and then reverted, and both movements are real configuration changes it
 * genuinely explains.
 */
export const ATTRIBUTING_CR_STATUSES: readonly ChangeRequestStoredStatus[] =
  ["in_progress", "completed", "rolled_back"];

// ── Graph endpoint → resource key ────────────────────────────────────────────

/** Leading HTTP verb on a stored endpoint string, e.g. "GET /v1.0/users". */
const METHOD_PREFIX_RE = /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s+/i;
/** A template variable segment, e.g. `{{policyId}}` — a target not known until run time. */
const TEMPLATE_VAR_RE = /^\{\{.*\}\}$/;
/**
 * Trailing Graph segments that are ACTIONS or navigation, never an object identity.
 * `/groups/{{groupId}}/members/$ref` targets the group, not an object called `$ref`.
 */
const NON_IDENTITY_SEGMENTS = new Set([
  "$ref", "$count", "$value", "assign", "assignLicense", "requirements",
  "windowsDefenderScan", "members", "owners",
]);

export interface ResolvedEndpointScope {
  readonly resourceKey: string;
  /** The concrete object the endpoint targets, or null when it is a template variable. */
  readonly objectIdentity: string | null;
  /** The registry row's graph path that matched, for the audit trail. */
  readonly matchedGraphPath: string;
}

interface RegistryEntry {
  readonly resourceKey: string;
  readonly graphVersion: string | null;
  readonly graphPath: string | null;
  readonly readCmdlets: unknown;
}

let registryCache: { at: number; rows: RegistryEntry[] } | null = null;
const REGISTRY_CACHE_MS = 5 * 60 * 1000;

async function loadRegistry(): Promise<RegistryEntry[]> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_CACHE_MS) return registryCache.rows;
  const rows = await db.select({
    resourceKey: configSnapshotResourceTypesTable.resourceKey,
    graphVersion: configSnapshotResourceTypesTable.graphVersion,
    graphPath: configSnapshotResourceTypesTable.graphPath,
    readCmdlets: configSnapshotResourceTypesTable.readCmdlets,
  }).from(configSnapshotResourceTypesTable);
  registryCache = { at: Date.now(), rows };
  return rows;
}

/** Test seam: drop the memoised registry so a test can change it mid-run. */
export function clearResourceRegistryCache(): void {
  registryCache = null;
}

/**
 * Resolve a stored endpoint string to a real `config_snapshot_resource_types` row.
 *
 * This is a REGISTRY LOOKUP, not a string-munging heuristic: the answer is whichever
 * registered resource type has the LONGEST `graph_path` that is a prefix of the
 * endpoint's own path. If no registered type matches, the answer is null and the caller
 * writes no scope — an endpoint the snapshot collector does not collect cannot possibly
 * explain a row in a diff of what it collected.
 *
 * Handles the three real endpoint shapes in the store:
 *   `GET /v1.0/identity/conditionalAccess/policies/custom-exemption`  (risk decisions)
 *   `/identity/conditionalAccess/policies/{{policyId}}`               (action templates)
 *   `exchange-online://Set-Mailbox`                                   (PowerShell templates)
 */
export async function resolveEndpointToResource(rawEndpoint: string): Promise<ResolvedEndpointScope | null> {
  const registry = await loadRegistry();
  const endpoint = rawEndpoint.trim().replace(METHOD_PREFIX_RE, "");
  if (!endpoint) return null;

  // PowerShell transport: match on the registry's own read cmdlets, which is the only
  // link between a cmdlet and a resource type that exists in real data.
  const psMatch = endpoint.match(/^([a-z-]+):\/\/(.+)$/i);
  if (psMatch) {
    const cmdlet = (psMatch[2] ?? "").split(/\s+/)[0] ?? "";
    // A WRITE cmdlet (Set-Mailbox) is not a read cmdlet, so compare on the noun: the
    // registry registers `Get-Mailbox`, and Set-/New-/Remove- act on the same resource.
    const noun = cmdlet.includes("-") ? cmdlet.slice(cmdlet.indexOf("-") + 1) : cmdlet;
    if (!noun) return null;
    const hits: { resourceKey: string; via: string }[] = [];
    for (const r of registry) {
      const cmdlets = Array.isArray(r.readCmdlets) ? r.readCmdlets : [];
      for (const c of cmdlets) {
        if (typeof c !== "string") continue;
        const cNoun = c.includes("-") ? c.slice(c.indexOf("-") + 1) : c;
        if (cNoun.toLowerCase() === noun.toLowerCase()) hits.push({ resourceKey: r.resourceKey, via: c });
      }
    }
    // AMBIGUOUS RESOLVES TO NOTHING. One cmdlet noun legitimately feeds many registered
    // resource types — `Get-Mailbox` is a read cmdlet for a long list of `m365dsc:EXO*`
    // types — and taking the first row back is picking one of them at random. Measured
    // live on 2026-09-04: `exchange-online://Set-Mailbox` resolved to
    // `m365dsc:EXOCalendarProcessing` purely on registry order. A scope pointing at the
    // wrong resource is worse than no scope, because it attributes real unexplained
    // drift to a change request that never touched it.
    if (hits.length !== 1) return null;
    return { resourceKey: hits[0]!.resourceKey, objectIdentity: null, matchedGraphPath: hits[0]!.via };
  }

  let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  let version: string | null = null;
  const versionMatch = path.match(/^\/(v1\.0|beta)(\/.*)?$/i);
  if (versionMatch) {
    version = versionMatch[1]!.toLowerCase() === "beta" ? "beta" : "v1.0";
    path = versionMatch[2] ?? "/";
  }
  // Query string and OData filters describe a read, never the resource's identity.
  path = path.split("?")[0]!.replace(/\/+$/, "");
  if (!path) return null;

  const segments = path.split("/").filter(Boolean);

  for (let take = segments.length; take >= 1; take--) {
    const candidate = `/${segments.slice(0, take).join("/")}`;
    const hits = registry.filter((r) =>
      r.graphPath === candidate && (version === null || r.graphVersion === version));
    if (hits.length === 0) continue;
    // Prefer v1.0 when the endpoint did not state a version: an unversioned action
    // template targets the production surface, not the preview one. If that STILL
    // leaves more than one registered type on the same path and version, the endpoint
    // does not identify a resource and nothing is resolved — same rule as the cmdlet
    // branch above, and for the same reason.
    const atVersion = hits.filter((r) => r.graphVersion === (version ?? "v1.0"));
    const narrowed = atVersion.length > 0 ? atVersion : hits;
    if (narrowed.length !== 1) return null;
    const hit = narrowed[0]!;

    const rest = segments.slice(take);
    let objectIdentity: string | null = null;
    if (rest.length >= 1) {
      const first = rest[0]!;
      if (!TEMPLATE_VAR_RE.test(first) && !NON_IDENTITY_SEGMENTS.has(first) && !first.startsWith("$")) {
        objectIdentity = first;
      }
    }
    return { resourceKey: hit.resourceKey, objectIdentity, matchedGraphPath: candidate };
  }
  return null;
}

// ── Scope derivation ─────────────────────────────────────────────────────────

interface ScopeDraft {
  resourceKey: string;
  objectIdentity: string | null;
  propertyPathNormalized: string | null;
  basis: ConfigChangeScopeBasis;
  basisRef: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  notes: string | null;
}

/** `tenants.tenant_id` (the TEXT M365 GUID) → `tenants.id`. Null when not onboarded. */
async function resolveTenantRowId(textTenantId: string): Promise<number | null> {
  const [row] = await db.select({ id: tenantsTable.id })
    .from(tenantsTable).where(eq(tenantsTable.tenantId, textTenantId)).limit(1);
  return row?.id ?? null;
}

async function upsertScopes(
  source: { kind: "change_request"; id: number } | { kind: "risk_decision"; id: number },
  tenantRowId: number,
  drafts: readonly ScopeDraft[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const d of drafts) {
    // ON CONFLICT against the expression-based natural key (see the migration): raw SQL
    // because the index is over COALESCE(...) and Drizzle's onConflictDoUpdate takes
    // columns, not expressions.
    const res = await pool.query<{ id: number }>(
      `INSERT INTO config_change_scopes
         (source_kind, change_request_id, risk_decision_id, tenant_id, resource_key,
          object_identity, property_path_normalized, basis, basis_ref,
          effective_from, effective_to, notes, derived_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source_kind, COALESCE(change_request_id, 0), COALESCE(risk_decision_id, 0),
                    resource_key, COALESCE(object_identity, ''),
                    COALESCE(property_path_normalized, ''), basis)
       DO UPDATE SET effective_from = EXCLUDED.effective_from,
                     effective_to   = EXCLUDED.effective_to,
                     basis_ref      = EXCLUDED.basis_ref,
                     notes          = EXCLUDED.notes,
                     derived_by     = EXCLUDED.derived_by,
                     updated_at     = now()
       RETURNING id`,
      [
        source.kind,
        source.kind === "change_request" ? source.id : null,
        source.kind === "risk_decision" ? source.id : null,
        tenantRowId,
        d.resourceKey,
        d.objectIdentity,
        d.propertyPathNormalized,
        d.basis,
        d.basisRef,
        d.effectiveFrom,
        d.effectiveTo,
        d.notes,
        ATTRIBUTION_VERSION,
      ],
    );
    const id = res.rows[0]?.id;
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/**
 * Derive every configuration scope a change request genuinely claims.
 *
 * Two bases, tried in that order and BOTH kept when both exist — the execution record
 * is stronger evidence, but the template walk covers the endpoints an execution record
 * summarises away, and keeping both means a later audit can see the intent and the
 * outcome side by side rather than only whichever one this function preferred.
 *
 * Returns the number of scope rows written. ZERO IS A NORMAL, CORRECT RESULT for a CR
 * that names no catalog item and has no execution record: it targets nothing this
 * platform can match against a snapshot, so it explains nothing.
 */
export async function deriveScopesForChangeRequest(changeRequestId: number): Promise<number> {
  const [cr] = await db.select({
    id: mspChangeRequestsTable.id,
    tenantId: mspChangeRequestsTable.tenantId,
    catalogItemId: mspChangeRequestsTable.catalogItemId,
    scheduledStart: mspChangeRequestsTable.scheduledStart,
    scheduledEnd: mspChangeRequestsTable.scheduledEnd,
    createdAt: mspChangeRequestsTable.createdAt,
    updatedAt: mspChangeRequestsTable.updatedAt,
  }).from(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, changeRequestId)).limit(1);
  if (!cr) return 0;

  const tenantRowId = await resolveTenantRowId(cr.tenantId);
  if (tenantRowId === null) {
    log.info({ changeRequestId, tenantId: cr.tenantId },
      "config-change-attribution: CR tenant is not an onboarded tenants row — no scope derived (#2759)");
    return 0;
  }

  const drafts: ScopeDraft[] = [];

  // ── Basis 1: what it ACTUALLY wrote ────────────────────────────────────────
  const execs = await pool.query<{ id: number; executed_at: Date | null; planned_plan: unknown; actual_outcome: unknown }>(
    `SELECT id, executed_at, planned_plan, actual_outcome
       FROM cr_executions WHERE change_request_id = $1 ORDER BY id`,
    [changeRequestId],
  );
  for (const row of execs.rows) {
    if (!row.executed_at) continue;
    for (const endpoint of collectEndpointStrings(row.actual_outcome).concat(collectEndpointStrings(row.planned_plan))) {
      const resolved = await resolveEndpointToResource(endpoint);
      if (!resolved) continue;
      drafts.push({
        resourceKey: resolved.resourceKey,
        objectIdentity: resolved.objectIdentity,
        propertyPathNormalized: null,
        basis: "execution_record",
        basisRef: endpoint,
        effectiveFrom: row.executed_at,
        effectiveTo: row.executed_at,
        notes: `cr_executions#${row.id} wrote ${endpoint}; matched registry path ${resolved.matchedGraphPath}`,
      });
    }
  }

  // ── Basis 2: what its catalog pack targets ─────────────────────────────────
  if (cr.catalogItemId !== null) {
    const templates = await pool.query<{ template_id: string; endpoint: string; method: string }>(
      `SELECT t.template_id, t.endpoint, t.method
         FROM change_catalog_items ci
         JOIN config_packs p            ON p.pack_key = ci.pack_key
         JOIN config_pack_templates cpt ON cpt.pack_id = p.id
         JOIN baseline_action_templates t ON t.template_id = cpt.template_id
        WHERE ci.id = $1`,
      [cr.catalogItemId],
    );
    const from = cr.scheduledStart ?? cr.createdAt;
    const to = cr.scheduledEnd ?? cr.updatedAt;
    for (const t of templates.rows) {
      const resolved = await resolveEndpointToResource(t.endpoint);
      if (!resolved) continue;
      drafts.push({
        resourceKey: resolved.resourceKey,
        objectIdentity: resolved.objectIdentity,
        propertyPathNormalized: null,
        basis: "template_endpoint",
        basisRef: `${t.template_id}:${t.method} ${t.endpoint}`,
        effectiveFrom: from,
        effectiveTo: to && from && to >= from ? to : from,
        notes: `catalog item ${cr.catalogItemId} → ${t.template_id}; matched registry path ${resolved.matchedGraphPath}`,
      });
    }
  }

  if (drafts.length === 0) return 0;
  const ids = await upsertScopes({ kind: "change_request", id: changeRequestId }, tenantRowId, drafts);
  return ids.length;
}

/**
 * Derive the configuration scope of a risk decision.
 *
 * `graph_endpoint` is the one structured configuration pointer the table carries, and
 * it is required and non-null, so every decision gets a real attempt. Free-text
 * `control_violated` / `hazard_description` are deliberately NOT parsed — a scope
 * guessed out of prose is exactly the invented attribution this whole layer exists to
 * avoid.
 *
 * See the file header for why `effective_to` is left NULL rather than set from
 * `expiration_date` (#1507: an acceptance does not expire; the review does).
 */
export async function deriveScopesForRiskDecision(riskDecisionId: number): Promise<number> {
  const [rd] = await db.select({
    id: mspRiskDecisionsTable.id,
    tenantId: mspRiskDecisionsTable.tenantId,
    graphEndpoint: mspRiskDecisionsTable.graphEndpoint,
    acceptedAt: mspRiskDecisionsTable.acceptedAt,
    createdAt: mspRiskDecisionsTable.createdAt,
  }).from(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.id, riskDecisionId)).limit(1);
  if (!rd) return 0;

  const tenantRowId = await resolveTenantRowId(rd.tenantId);
  if (tenantRowId === null) {
    log.info({ riskDecisionId, tenantId: rd.tenantId },
      "config-change-attribution: risk-decision tenant is not an onboarded tenants row — no scope derived (#2759)");
    return 0;
  }

  const endpoint = (rd.graphEndpoint ?? "").trim();
  if (!endpoint) return 0;
  const resolved = await resolveEndpointToResource(endpoint);
  if (!resolved) return 0;

  const ids = await upsertScopes({ kind: "risk_decision", id: riskDecisionId }, tenantRowId, [{
    resourceKey: resolved.resourceKey,
    objectIdentity: resolved.objectIdentity,
    propertyPathNormalized: null,
    basis: "graph_endpoint",
    basisRef: endpoint,
    effectiveFrom: rd.acceptedAt ?? rd.createdAt,
    // Deliberately unbounded — see the file header (#1507).
    effectiveTo: null,
    notes: `msp_risk_decisions.graph_endpoint matched registry path ${resolved.matchedGraphPath}`,
  }]);
  return ids.length;
}

/**
 * Pull every endpoint-looking string out of a `cr_executions` plan/outcome document.
 *
 * `planned_plan` and `actual_outcome` are free-shaped jsonb written by several
 * executors, so this reads the keys those executors actually use rather than assuming
 * one schema — and it reads ONLY those keys. A blind walk over every string in the
 * document would pick up prose and turn it into a scope.
 */
export function collectEndpointStrings(doc: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const ENDPOINT_KEYS = new Set(["endpoint", "graphEndpoint", "graph_endpoint", "url", "uri", "path", "cmdlet"]);

  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object" || depth > 8) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && ENDPOINT_KEYS.has(k) && v.trim()) out.push(v.trim());
      else walk(v, depth + 1);
    }
  };
  walk(doc, 0);
  return [...new Set(out)];
}

// ── Matching ─────────────────────────────────────────────────────────────────

interface EligibleScope {
  scopeId: number;
  sourceKind: "change_request" | "risk_decision";
  changeRequestId: number | null;
  riskDecisionId: number | null;
  crRef: string | null;
  rbdRef: string | null;
  resourceKey: string;
  objectIdentity: string | null;
  propertyPathNormalized: string | null;
  basis: ConfigChangeScopeBasis;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  /** Source recency, for the final tie-break. */
  sourceUpdatedAt: Date | null;
}

const PRECISION_RANK: Record<ConfigChangeMatchScope, number> = { property: 3, object: 2, resource: 1 };

/**
 * Does this scope cover this change row, and if so how precisely?
 *
 * A NULL on the scope means "everything at this level", never "unknown" — the scope
 * writer only stores a level it can actually stand behind, so the widening is
 * deliberate rather than a missing value being read as a wildcard.
 */
export function matchScopeFor(
  scope: Pick<EligibleScope, "resourceKey" | "objectIdentity" | "propertyPathNormalized">,
  change: { resourceKey: string; objectIdentity: string; propertyPathNormalized: string | null },
): ConfigChangeMatchScope | null {
  if (scope.resourceKey !== change.resourceKey) return null;
  if (scope.objectIdentity === null) return "resource";
  if (scope.objectIdentity !== change.objectIdentity) return null;
  if (scope.propertyPathNormalized === null) return "object";
  if (scope.propertyPathNormalized !== change.propertyPathNormalized) return null;
  return "property";
}

/**
 * The total order that decides which matching scope becomes the verdict's edge.
 * Deterministic all the way down, so the same inputs always name the same winner —
 * a verdict whose edge depends on the planner's row order is not evidence.
 */
export function compareMatches(
  a: { matchScope: ConfigChangeMatchScope; scope: EligibleScope },
  b: { matchScope: ConfigChangeMatchScope; scope: EligibleScope },
): number {
  const byPrecision = PRECISION_RANK[b.matchScope] - PRECISION_RANK[a.matchScope];
  if (byPrecision !== 0) return byPrecision;
  // A narrower claimed window is a more specific claim about when it acted.
  const width = (s: EligibleScope): number =>
    s.effectiveFrom && s.effectiveTo ? s.effectiveTo.getTime() - s.effectiveFrom.getTime() : Number.MAX_SAFE_INTEGER;
  const byWidth = width(a.scope) - width(b.scope);
  if (byWidth !== 0) return byWidth;
  // Evidence of what happened beats evidence of what was intended.
  const basisRank: Record<ConfigChangeScopeBasis, number> = {
    execution_record: 5, template_endpoint: 4, graph_endpoint: 3, check_key: 2, declared: 1,
  };
  const byBasis = basisRank[b.scope.basis] - basisRank[a.scope.basis];
  if (byBasis !== 0) return byBasis;
  const byRecency = (b.scope.sourceUpdatedAt?.getTime() ?? 0) - (a.scope.sourceUpdatedAt?.getTime() ?? 0);
  if (byRecency !== 0) return byRecency;
  return a.scope.scopeId - b.scope.scopeId;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Order-insensitive JSON equality, so `{a:1,b:2}` and `{b:2,a:1}` are the same value. */
export function stableEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(norm);
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = norm(o[k]);
      return acc;
    }, {});
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// ── The pass ─────────────────────────────────────────────────────────────────

export interface AttributionResult {
  readonly diffRowId: number;
  readonly tenantId: number;
  readonly changesAttributed: number;
  readonly scopesDerived: number;
  readonly scopesEligible: number;
  readonly verdicts: Readonly<Record<ConfigChangeVerdict, number>>;
  readonly lifecycleOpened: number;
  readonly lifecycleResolved: number;
  readonly lifecycleReopened: number;
  readonly window: { readonly from: string | null; readonly to: string | null };
}

export class DiffNotAttributableError extends Error {}

/**
 * Refresh the scope bridge for one tenant, then compute a verdict for EVERY change row
 * in one sealed diff and advance the lifecycle.
 *
 * Idempotent. Re-running it re-derives scopes, replaces the diff's attribution rows,
 * and — importantly — does NOT re-advance the lifecycle for a change row it has already
 * applied, so a second run can never manufacture a reopen out of nothing.
 */
export async function attributeDiff(diffRowId: number): Promise<AttributionResult> {
  const [diff] = await db.select().from(configDiffsTable).where(eq(configDiffsTable.id, diffRowId)).limit(1);
  if (!diff) throw new DiffNotAttributableError(`No diff with row id ${diffRowId}`);
  if (diff.status !== "sealed") {
    throw new DiffNotAttributableError(
      `Diff ${diffRowId} is '${diff.status}', not 'sealed' — a verdict over an unfinished comparison would be a verdict over an incomplete set of changes`);
  }

  const tenantId = diff.headTenantId;
  const [baseSnap] = await db.select({ capturedAt: tenantConfigSnapshotsTable.capturedAt })
    .from(tenantConfigSnapshotsTable).where(eq(tenantConfigSnapshotsTable.id, diff.baseSnapshotRowId)).limit(1);
  const [headSnap] = await db.select({ capturedAt: tenantConfigSnapshotsTable.capturedAt })
    .from(tenantConfigSnapshotsTable).where(eq(tenantConfigSnapshotsTable.id, diff.headSnapshotRowId)).limit(1);

  /**
   * The interval the change could have happened in. Ordered by TIME, not by which side
   * is called `base` — for a `drift` diff base is always the earlier snapshot, but
   * `baseline_assessment` compares against a reference snapshot that is frequently
   * NEWER than the subject (live on the testbed: diff row 11's base was captured
   * 11 hours after its head), and an inverted interval matches nothing at all, silently
   * turning every change in it into `unattributed`.
   */
  const bounds = [baseSnap?.capturedAt, headSnap?.capturedAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  const windowFrom = bounds[0] ? new Date(bounds[0].getTime() - WINDOW_TOLERANCE_MS) : null;
  const windowTo = bounds[bounds.length - 1]
    ? new Date(bounds[bounds.length - 1]!.getTime() + WINDOW_TOLERANCE_MS)
    : null;
  /** When the head state was observed — the honest timestamp for a lifecycle event. */
  const observedAt = headSnap?.capturedAt ?? new Date();

  // ── 1. Refresh the bridge for every source that could plausibly speak to this diff ──
  const [tenantRow] = await db.select({ textId: tenantsTable.tenantId })
    .from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  let scopesDerived = 0;
  if (tenantRow) {
    const crs = await db.select({ id: mspChangeRequestsTable.id })
      .from(mspChangeRequestsTable)
      .where(and(
        eq(mspChangeRequestsTable.tenantId, tenantRow.textId),
        inArray(mspChangeRequestsTable.status, ATTRIBUTING_CR_STATUSES),
      ));
    for (const cr of crs) scopesDerived += await deriveScopesForChangeRequest(cr.id);

    const rds = await db.select({ id: mspRiskDecisionsTable.id })
      .from(mspRiskDecisionsTable)
      .where(and(
        eq(mspRiskDecisionsTable.tenantId, tenantRow.textId),
        eq(mspRiskDecisionsTable.status, "active"),
      ));
    for (const rd of rds) scopesDerived += await deriveScopesForRiskDecision(rd.id);
  }

  // ── 2. Load the eligible scopes ────────────────────────────────────────────
  const scopeRows = await db.select({
    scope: configChangeScopesTable,
    crStatus: mspChangeRequestsTable.status,
    crUpdatedAt: mspChangeRequestsTable.updatedAt,
    rdStatus: mspRiskDecisionsTable.status,
    rdRef: mspRiskDecisionsTable.rbdId,
    rdUpdatedAt: mspRiskDecisionsTable.updatedAt,
  }).from(configChangeScopesTable)
    .leftJoin(mspChangeRequestsTable, eq(mspChangeRequestsTable.id, configChangeScopesTable.changeRequestId))
    .leftJoin(mspRiskDecisionsTable, eq(mspRiskDecisionsTable.id, configChangeScopesTable.riskDecisionId))
    .where(eq(configChangeScopesTable.tenantId, tenantId));

  const eligible: EligibleScope[] = [];
  for (const r of scopeRows) {
    const s = r.scope;
    if (s.sourceKind === "change_request") {
      if (!r.crStatus || !ATTRIBUTING_CR_STATUSES.includes(r.crStatus)) continue;
      // The CR must have acted inside the interval the change could have happened in.
      if (windowFrom && s.effectiveTo && s.effectiveTo < windowFrom) continue;
      if (windowTo && s.effectiveFrom && s.effectiveFrom > windowTo) continue;
      eligible.push({
        scopeId: s.id, sourceKind: "change_request",
        changeRequestId: s.changeRequestId, riskDecisionId: null,
        crRef: s.changeRequestId !== null ? formatChangeRequestCode(s.changeRequestId) : null,
        rbdRef: null,
        resourceKey: s.resourceKey, objectIdentity: s.objectIdentity,
        propertyPathNormalized: s.propertyPathNormalized, basis: s.basis,
        effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo,
        sourceUpdatedAt: r.crUpdatedAt ?? null,
      });
    } else {
      // Live status, never a stored window — see the file header (#1507).
      if (r.rdStatus !== "active") continue;
      if (windowTo && s.effectiveFrom && s.effectiveFrom > windowTo) continue;
      eligible.push({
        scopeId: s.id, sourceKind: "risk_decision",
        changeRequestId: null, riskDecisionId: s.riskDecisionId,
        crRef: null, rbdRef: r.rdRef ?? null,
        resourceKey: s.resourceKey, objectIdentity: s.objectIdentity,
        propertyPathNormalized: s.propertyPathNormalized, basis: s.basis,
        effectiveFrom: s.effectiveFrom, effectiveTo: s.effectiveTo,
        sourceUpdatedAt: r.rdUpdatedAt ?? null,
      });
    }
  }

  // ── 3. Verdict per change row ──────────────────────────────────────────────
  const changes = await db.select().from(configDiffChangesTable)
    .where(eq(configDiffChangesTable.diffRowId, diffRowId))
    .orderBy(configDiffChangesTable.sequence);

  // Replacing wholesale is what makes the pass idempotent. The lifecycle table is NOT
  // cleared: it is cross-diff history and re-running one diff must not erase it.
  await db.delete(configChangeAttributionsTable)
    .where(eq(configChangeAttributionsTable.diffRowId, diffRowId));

  const verdicts: Record<ConfigChangeVerdict, number> = {
    attributed_change: 0, accepted_risk: 0, contested: 0, unattributed: 0, ignored: 0,
  };
  let lifecycleOpened = 0, lifecycleResolved = 0, lifecycleReopened = 0;

  for (const c of changes) {
    const changeView = {
      resourceKey: c.resourceKey,
      objectIdentity: c.objectIdentity,
      propertyPathNormalized: c.propertyPathNormalized,
    };
    const matches = eligible
      .map((scope) => ({ scope, matchScope: matchScopeFor(scope, changeView) }))
      .filter((m): m is { scope: EligibleScope; matchScope: ConfigChangeMatchScope } => m.matchScope !== null)
      .sort(compareMatches);

    const crMatch = matches.find((m) => m.scope.sourceKind === "change_request") ?? null;
    const rdMatch = matches.find((m) => m.scope.sourceKind === "risk_decision") ?? null;

    let verdict: ConfigChangeVerdict;
    let matchScope: ConfigChangeMatchScope | null = null;
    let changeRequestId: number | null = null;
    let crRef: string | null = null;
    let riskDecisionId: number | null = null;
    let rbdRef: string | null = null;
    let scopeId: number | null = null;

    if (c.isIgnored) {
      // A rule suppressed this row as noise. It gets no intent verdict at all — folding
      // it into `unattributed` would put suppressed churn in the same count as genuinely
      // unexplained change. Matches are still recorded, so the suppression is auditable.
      verdict = "ignored";
    } else if (crMatch && rdMatch) {
      verdict = "contested";
      matchScope = matches[0]!.matchScope;
      changeRequestId = crMatch.scope.changeRequestId;
      crRef = crMatch.scope.crRef;
      riskDecisionId = rdMatch.scope.riskDecisionId;
      rbdRef = rdMatch.scope.rbdRef;
      scopeId = matches[0]!.scope.scopeId;
    } else if (crMatch) {
      verdict = "attributed_change";
      matchScope = crMatch.matchScope;
      changeRequestId = crMatch.scope.changeRequestId;
      crRef = crMatch.scope.crRef;
      scopeId = crMatch.scope.scopeId;
    } else if (rdMatch) {
      verdict = "accepted_risk";
      matchScope = rdMatch.matchScope;
      riskDecisionId = rdMatch.scope.riskDecisionId;
      rbdRef = rdMatch.scope.rbdRef;
      scopeId = rdMatch.scope.scopeId;
    } else {
      verdict = "unattributed";
    }
    verdicts[verdict] += 1;

    // ── Lifecycle. Two exclusions, both deliberate:
    //  - Ignored rows: a path a noise rule suppresses is volatility, and opening a
    //    lifecycle row for it would fill the table with the very churn the ruleset
    //    exists to keep out of a human's view.
    //  - Non-`drift` modes: a lifecycle is a claim about one tenant over TIME, and a
    //    baseline assessment or a cross-tenant comparison is not a time series. See the
    //    `config_change_lifecycle` table comment. Verdicts are still computed for every
    //    mode; only the lifecycle is restricted.
    let lifecycleId: number | null = null;
    if (!c.isIgnored && diff.mode === "drift") {
      const r = await advanceLifecycle({
        tenantId,
        change: c,
        diffRowId,
        observedAt,
      });
      lifecycleId = r.id;
      if (r.transition === "opened") lifecycleOpened += 1;
      if (r.transition === "resolved") lifecycleResolved += 1;
      if (r.transition === "reopened") lifecycleReopened += 1;
    }

    const [attribution] = await db.insert(configChangeAttributionsTable).values({
      changeId: c.id,
      diffRowId,
      tenantId,
      verdict,
      changeRequestId,
      crRef,
      riskDecisionId,
      rbdRef,
      matchScope,
      scopeId,
      matchCount: matches.length,
      lifecycleId,
      attributionVersion: ATTRIBUTION_VERSION,
    }).returning({ id: configChangeAttributionsTable.id });

    if (attribution && matches.length > 0) {
      await db.insert(configChangeAttributionMatchesTable).values(matches.map((m, i) => ({
        attributionId: attribution.id,
        scopeId: m.scope.scopeId,
        sourceKind: m.scope.sourceKind,
        changeRequestId: m.scope.changeRequestId,
        riskDecisionId: m.scope.riskDecisionId,
        matchScope: m.matchScope,
        rank: i + 1,
        reason: `${m.matchScope}-precision match on ${m.scope.basis} scope #${m.scope.scopeId}`,
      })));
    }
  }

  log.info({
    diffRowId, tenantId, changes: changes.length, scopesDerived, scopesEligible: eligible.length, verdicts,
  }, "config-change-attribution: diff attributed (#2759)");

  return {
    diffRowId,
    tenantId,
    changesAttributed: changes.length,
    scopesDerived,
    scopesEligible: eligible.length,
    verdicts,
    lifecycleOpened,
    lifecycleResolved,
    lifecycleReopened,
    window: { from: windowFrom?.toISOString() ?? null, to: windowTo?.toISOString() ?? null },
  };
}

/**
 * Attribute a diff if — and only if — it has not already been attributed at the current
 * {@link ATTRIBUTION_VERSION}. Non-fatal by contract: it returns `null` on any failure
 * rather than throwing, so a read path can call it without a bookkeeping problem being
 * able to take down the answer the caller actually asked for. Same discipline
 * `monitor-executor.ts` applies to drift collection, and for the same reason.
 *
 * This is the lazy, once-per-diff entry point a READ path uses. It deliberately does
 * not re-run on an already-attributed diff: a verdict does move as change requests and
 * risk acceptances move, but refreshing it on every page view would put hundreds of
 * writes behind a GET. Re-running is an explicit operator action
 * (`POST …/diffs/:diffId/attribution`).
 */
export async function ensureDiffAttributed(diffRowId: number): Promise<AttributionResult | null> {
  try {
    const [existing] = await db.select({ n: sql<number>`count(*)::int` })
      .from(configChangeAttributionsTable)
      .where(and(
        eq(configChangeAttributionsTable.diffRowId, diffRowId),
        eq(configChangeAttributionsTable.attributionVersion, ATTRIBUTION_VERSION),
      ));
    if ((existing?.n ?? 0) > 0) return null;
    return await attributeDiff(diffRowId);
  } catch (err) {
    log.warn({ err, diffRowId },
      "config-change-attribution: lazy attribution failed (non-fatal) (#2759)");
    return null;
  }
}

/**
 * Advance the open/resolved/reopened record for one changed setting.
 *
 * The resolution rule and what it refuses to infer are documented on
 * `config_change_lifecycle` itself. In short: only an OBSERVED return to the value the
 * setting held when first detected resolves a row, and absence from a later diff never
 * does — a `drift` diff compares consecutive snapshots, so an unfixed drift emits no row
 * on the next scan and closing on absence would silently mark it fixed.
 */
async function advanceLifecycle(opts: {
  tenantId: number;
  change: typeof configDiffChangesTable.$inferSelect;
  diffRowId: number;
  observedAt: Date;
}): Promise<{ id: number | null; transition: "opened" | "resolved" | "reopened" | "unchanged" }> {
  const { tenantId, change: c, diffRowId, observedAt } = opts;
  // The RAW path is the setting's identity — see the table comment for the measurement.
  const pathKey = c.propertyPath ?? "";
  const normalizedKey = c.propertyPathNormalized ?? "";

  const [existing] = await db.select().from(configChangeLifecycleTable).where(and(
    eq(configChangeLifecycleTable.tenantId, tenantId),
    eq(configChangeLifecycleTable.resourceKey, c.resourceKey),
    eq(configChangeLifecycleTable.objectIdentity, c.objectIdentity),
    eq(configChangeLifecycleTable.propertyPath, pathKey),
  )).limit(1);

  if (!existing) {
    const [row] = await db.insert(configChangeLifecycleTable).values({
      tenantId,
      resourceKey: c.resourceKey,
      objectIdentity: c.objectIdentity,
      propertyPath: pathKey,
      propertyPathNormalized: normalizedKey,
      status: "open",
      baselineValue: c.oldValue,
      baselineValuePresent: c.oldValuePresent ? "true" : "false",
      currentValue: c.newValue,
      currentValuePresent: c.newValuePresent ? "true" : "false",
      firstChangeId: c.id,
      lastChangeId: c.id,
      lastDiffRowId: diffRowId,
      firstDetectedAt: observedAt,
      lastDetectedAt: observedAt,
    }).returning({ id: configChangeLifecycleTable.id });
    return { id: row?.id ?? null, transition: "opened" };
  }

  // Already applied — a re-run of the same diff must not manufacture a transition.
  if (existing.lastChangeId === c.id) return { id: existing.id, transition: "unchanged" };

  const baselinePresent = existing.baselineValuePresent === "true";
  const backAtBaseline = baselinePresent === c.newValuePresent
    && (!baselinePresent || stableEqual(existing.baselineValue, c.newValue));

  let status = existing.status;
  let transition: "resolved" | "reopened" | "unchanged" = "unchanged";
  const patch: Record<string, unknown> = {
    currentValue: c.newValue,
    currentValuePresent: c.newValuePresent ? "true" : "false",
    lastChangeId: c.id,
    lastDiffRowId: diffRowId,
    lastDetectedAt: observedAt,
    updatedAt: new Date(),
  };

  if (backAtBaseline) {
    if (existing.status !== "resolved") {
      status = "resolved";
      transition = "resolved";
      patch.resolvedAt = observedAt;
    }
  } else if (existing.status === "resolved") {
    status = "reopened";
    transition = "reopened";
    patch.reopenedAt = observedAt;
    patch.reopenCount = existing.reopenCount + 1;
    patch.resolvedAt = null;
  }
  patch.status = status;

  await db.update(configChangeLifecycleTable).set(patch)
    .where(eq(configChangeLifecycleTable.id, existing.id));
  return { id: existing.id, transition };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface DiffVerdictRollup {
  readonly attributed: boolean;
  readonly attributionVersion: string | null;
  readonly attributedAt: string | null;
  readonly counts: Readonly<Record<ConfigChangeVerdict, number>>;
  /** Distinct change requests and risk decisions that explain any part of this diff. */
  readonly changeRequests: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  readonly riskDecisions: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  /**
   * Rows whose verdict is `contested`. Called out on its own because it is the one
   * verdict that names a decision a human still has to make — see the schema header.
   */
  readonly contestedCount: number;
}

/**
 * The verdict roll-up for one diff. `attributed: false` means the pass has not run over
 * this diff, which is a genuinely different statement from "it ran and found nothing",
 * and the two must never render the same.
 */
export async function readDiffVerdictRollup(diffRowId: number): Promise<DiffVerdictRollup> {
  const rows = await db.select({
    verdict: configChangeAttributionsTable.verdict,
    count: sql<number>`count(*)::int`,
    version: sql<string | null>`max(${configChangeAttributionsTable.attributionVersion})`,
    at: sql<string | null>`max(${configChangeAttributionsTable.attributedAt})::text`,
  }).from(configChangeAttributionsTable)
    .where(eq(configChangeAttributionsTable.diffRowId, diffRowId))
    .groupBy(configChangeAttributionsTable.verdict);

  const counts: Record<ConfigChangeVerdict, number> = {
    attributed_change: 0, accepted_risk: 0, contested: 0, unattributed: 0, ignored: 0,
  };
  let version: string | null = null;
  let at: string | null = null;
  for (const r of rows) {
    counts[r.verdict] = r.count;
    version = version ?? r.version;
    at = at ?? r.at;
  }

  const crRows = await db.select({
    id: configChangeAttributionsTable.changeRequestId,
    ref: sql<string | null>`max(${configChangeAttributionsTable.crRef})`,
    changes: sql<number>`count(*)::int`,
  }).from(configChangeAttributionsTable)
    .where(and(
      eq(configChangeAttributionsTable.diffRowId, diffRowId),
      sql`${configChangeAttributionsTable.changeRequestId} IS NOT NULL`,
    ))
    .groupBy(configChangeAttributionsTable.changeRequestId);

  const rdRows = await db.select({
    id: configChangeAttributionsTable.riskDecisionId,
    ref: sql<string | null>`max(${configChangeAttributionsTable.rbdRef})`,
    changes: sql<number>`count(*)::int`,
  }).from(configChangeAttributionsTable)
    .where(and(
      eq(configChangeAttributionsTable.diffRowId, diffRowId),
      sql`${configChangeAttributionsTable.riskDecisionId} IS NOT NULL`,
    ))
    .groupBy(configChangeAttributionsTable.riskDecisionId);

  return {
    attributed: rows.length > 0,
    attributionVersion: version,
    attributedAt: at,
    counts,
    changeRequests: crRows.filter((r) => r.id !== null).map((r) => ({ id: r.id as number, ref: r.ref, changes: r.changes })),
    riskDecisions: rdRows.filter((r) => r.id !== null).map((r) => ({ id: r.id as number, ref: r.ref, changes: r.changes })),
    contestedCount: counts.contested,
  };
}

/** Re-exported so a caller normalising a declared scope uses the differ's own rule. */
export { normalizePropertyPath };
