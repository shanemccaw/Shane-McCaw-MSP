/**
 * drift-change-attribution.ts — real per-setting change-request attribution for
 * `drift_events` (Git #2819).
 *
 * ─── What this replaces ───────────────────────────────────────────────────────
 * `monitor-executor.ts`'s `buildCaChangeRequestAttribution` (#1283, refined by
 * #1505) attributed on CATEGORY ALONE. It looked for the most recent completed
 * `msp_change_requests` row with `category = 'ConditionalAccess'` in the last 30
 * days and, if one existed, returned a closure that ignored its `setting`
 * argument entirely — so EVERY drifted Conditional Access setting in that scan
 * got the same `crRef`. `deriveVerdict` returns `approved` whenever `crRef` is
 * set, and `customer-tenant-alert-engine.ts` counts only
 * `attributed_unapproved` / `unattributed` toward the `drift.unapproved` alert.
 * Net effect: one unrelated approved CA change silently suppressed the
 * unapproved-drift alert for every genuinely unauthorised Conditional Access
 * change in that tenant for a month. That is a false negative on the exact
 * signal the drift engine exists to raise.
 *
 * ─── The model this uses instead ──────────────────────────────────────────────
 * Not a new mechanism: the SAME one #2759 already built for
 * `config_diff_changes`, reused rather than re-invented
 * (`config-change-attribution.ts`). A change request is walked down to the real
 * Graph endpoint it wrote — `cr_executions` → `baseline_action_templates.endpoint`
 * → `config_snapshot_resource_types` — producing `config_change_scopes` rows keyed
 * by `(resource_key, object_identity, property_path_normalized)`. This file's job
 * is the one piece #2759 does not have: turning a drift event's `setting` — a
 * JSON-pointer path into the domain's comparable config, e.g.
 * `/policies/<policyId>/conditions/users/includeUsers/1` — into that same triple, so
 * `matchScopeFor` can decide per setting whether a given CR actually explains it.
 *
 * ─── What honest failure looks like here ──────────────────────────────────────
 * Nothing falls back to the category blanket. If the check's endpoint does not
 * resolve to a registered resource type, if no scope matches the setting, or if
 * the CR that matched is not in a status that actually touched the tenant, the
 * answer is `undefined` — the drift event carries no `crRef` and no `changedBy`
 * and lands as `unattributed`, which is the state that DOES reach the alert path.
 * An unexplained security-relevant change marked "approved" is strictly worse
 * than one honestly marked "needs review", because only the second gets looked at.
 *
 * ─── Two deliberate limits, stated rather than papered over ───────────────────
 * 1. THE WINDOW IS WIDER THAN #2759's. A sealed diff knows the change happened
 *    between two snapshot captures. A drift baseline is a REFERENCE that stays
 *    put until re-captured, so all this layer can honestly say is "somewhere
 *    between the baseline capture and this scan". A CR whose scope matches the
 *    same object anywhere in that interval attributes. That is still bounded by
 *    a real object match, which is the whole difference from the blanket: an
 *    old CR against policy A can no longer absorb today's unapproved change to
 *    policy B.
 * 2. RISK DECISIONS DO NOT PARTICIPATE. `drift_events.verdict` has no
 *    `accepted_risk` value (it is `approved` / `attributed_unapproved` /
 *    `unattributed` / `informational`), and folding an accepted risk into
 *    `approved` would claim a change request exists where none does. Accepted
 *    risk is represented on the `config_diff_changes` side, which has a verdict
 *    for it.
 */

import { db } from "@workspace/db";
import {
  configChangeScopesTable,
  mspChangeRequestsTable,
  type ConfigChangeMatchScope,
  type ConfigChangeScopeBasis,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  ATTRIBUTING_CR_STATUSES,
  WINDOW_TOLERANCE_MS,
  compareMatches,
  deriveScopesForChangeRequest,
  matchScopeFor,
  resolveEndpointToResource,
  resolveTenantRowId,
} from "./config-change-attribution.ts";
import { normalizePropertyPath } from "./config-snapshot-differ.ts";
import { formatChangeRequestCode } from "./portal-change-control.ts";
import type { DriftAttribution } from "./drift-collector.ts";
import type { DriftSettingIdentity } from "./drift-check-specs.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.monitor" });

// ── Setting path → the object/property a scope can be matched against ────────

/**
 * What a drift `setting` path resolves to, in the terms `config_change_scopes`
 * is keyed by.
 *
 * `objectIdentity: null` means "this change is about the collection as a whole,
 * not one identifiable object". It is NOT "unknown"; it deliberately restricts
 * matching to resource-level scopes below.
 *
 * #3089 made that case rare rather than routine. It used to be the NORMAL outcome
 * of a Conditional Access policy being created or deleted: the config was a
 * positional array, so a length change collapsed into one whole-array `replace`
 * at `/policies` — the single most security-relevant CA change, arriving with no
 * object to match and therefore matchable only by a resource-level scope, which
 * is how an unapproved deletion could be absorbed by an unrelated approved edit.
 * With the config keyed by policy id, a creation is an `add` at `/policies/<id>`
 * and a deletion a `remove`, each naming its object. The branch stays because a
 * config whose collection is missing or was captured in another shape can still
 * produce it, and answering `null` there is right.
 */
export interface DriftSettingTarget {
  objectIdentity: string | null;
  propertyPathNormalized: string | null;
}

/**
 * Convert the tail of a drift setting path to the differ's own normalized
 * property-path form, so the two stores speak one dialect.
 *
 * `config-snapshot-differ.ts` writes dot notation with bracketed array indices
 * (`conditions.users.includeUsers[0]`) and `normalizePropertyPath` collapses the
 * index to `[]`. `detectDrift` writes JSON-pointer segments
 * (`conditions/users/includeUsers/1`). This maps the second onto the first
 * directly — a numeric segment becomes `[]` on the segment before it, never its
 * own path element, because an index is not a property name.
 *
 * Returns null when there is no property tail at all (the whole object changed),
 * which matches at `object` precision rather than `property`.
 */
export function driftPropertyPath(segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  let out = "";
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      // A leading index with nothing to attach to is not a property path at all.
      if (out === "") return null;
      out += "[]";
      continue;
    }
    out = out === "" ? seg : `${out}.${seg}`;
  }
  return out === "" ? null : normalizePropertyPath(out);
}

/**
 * Resolve one drift `setting` path to the object + property it touched.
 *
 * `identity` says which top-level property of the domain's comparable config
 * carries the objects (see `DriftCheckSpec.identity`); the builder keys that
 * collection by each object's own stable id, so the path segment after the
 * collection IS the object identity — `/policies/<policyId>/state` is about
 * `<policyId>`, whatever order Graph happened to return the policies in.
 *
 * #3089 removed the positional machinery this used to need. While Conditional
 * Access was stored as an array the path said `/policies/3/state`, so resolving it
 * meant reading index 3 out of the scan's own item list AND checking the baseline
 * agreed index 3 was the same object — because `detectDrift` walks arrays
 * positionally and Graph promises no stable order, and reading the current side
 * alone would credit a change request with a change to a policy it never touched.
 * A keyed config has no position to be wrong about, so neither the scan items nor
 * the guard exist any more.
 *
 * Returns null when the path does not belong to that collection (e.g. a
 * whole-config `/` replace), which attributes nothing.
 */
export function resolveDriftSettingTarget(
  setting: string,
  identity: DriftSettingIdentity,
): DriftSettingTarget | null {
  const segments = setting.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments[0] !== identity.collection) return null;

  // `/policies` — the collection as a whole, with no object named. See the note on
  // DriftSettingTarget: for a keyed domain this only happens when the collection is
  // missing or was captured in a different shape, never for an ordinary create or
  // delete. Guessing which object it is about is exactly the blanket #2819 removed.
  if (segments.length === 1) return { objectIdentity: null, propertyPathNormalized: null };

  const objectIdentity = segments[1];
  if (objectIdentity.length === 0) return { objectIdentity: null, propertyPathNormalized: null };

  return { objectIdentity, propertyPathNormalized: driftPropertyPath(segments.slice(2)) };
}

/**
 * Does this scope cover this drift target, and how precisely?
 *
 * A thin widening of #2759's `matchScopeFor` for the one shape a diff row can
 * never have and a drift setting can: an unidentifiable object. A scope that
 * claims one specific object cannot explain a change we cannot tie to that
 * object, so it does not match; a resource-level scope (`object_identity IS
 * NULL`, e.g. a CR whose template endpoint targets
 * `/identity/conditionalAccess/policies/{{policyId}}`) legitimately does —
 * creating or deleting a policy IS a collection-level change.
 */
export function matchDriftScope(
  scope: { resourceKey: string; objectIdentity: string | null; propertyPathNormalized: string | null },
  change: { resourceKey: string } & DriftSettingTarget,
): ConfigChangeMatchScope | null {
  if (scope.resourceKey !== change.resourceKey) return null;
  if (scope.objectIdentity === null) return "resource";
  if (change.objectIdentity === null) return null;
  return matchScopeFor(scope, {
    resourceKey: change.resourceKey,
    objectIdentity: change.objectIdentity,
    propertyPathNormalized: change.propertyPathNormalized,
  });
}

// ── The live builder ─────────────────────────────────────────────────────────

/** A change-request scope eligible to explain drift in this domain, this window. */
export interface EligibleDriftScope {
  scopeId: number;
  changeRequestId: number;
  riskDecisionId: null;
  sourceKind: "change_request";
  /**
   * Present only to satisfy the shape `compareMatches` (#2759) ranks — a drift
   * event's display reference is derived from `changeRequestId` at the point of
   * use, and `rbdRef` is structurally null because risk decisions never reach
   * here (see limit 2 in the file header).
   */
  crRef: string | null;
  rbdRef: null;
  resourceKey: string;
  objectIdentity: string | null;
  propertyPathNormalized: string | null;
  basis: ConfigChangeScopeBasis;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  sourceUpdatedAt: Date | null;
  /** The CR's approver, else its requester — the actor recorded on the drift event. */
  changedBy: string | null;
}

export interface BuildDriftAttributionParams {
  /** `tenants.tenant_id` — the TEXT M365 tenant GUID drift rows are keyed by. */
  tenantId: string;
  /** The monitor check's Graph endpoint; resolved to the domain's registry resource. */
  endpoint: string;
  /** Where object identity lives in this domain's comparable config. */
  identity: DriftSettingIdentity;
  /** When the baseline this scan is diffed against was captured. */
  baselineCapturedAt: Date | null;
  /** When this scan observed the current state. Defaults to now. */
  observedAt?: Date;
  /** For logs. */
  checkKey?: string;
  domainKey?: string;
}

/**
 * Build the per-setting attribution function `collectDrift` consumes.
 *
 * Returns `undefined` when nothing in this tenant can attribute anything — an
 * unresolvable endpoint, a tenant that is not an onboarded `tenants` row, or no
 * eligible scope at all. `undefined` is not a failure to report; it is the honest
 * answer, and it leaves every drift event `unattributed`.
 */
export async function buildDriftScopeAttribution(
  params: BuildDriftAttributionParams,
): Promise<((setting: string) => DriftAttribution | undefined) | undefined> {
  const { tenantId, endpoint, identity, baselineCapturedAt, checkKey, domainKey } = params;
  const observedAt = params.observedAt ?? new Date();

  const resolved = await resolveEndpointToResource(endpoint);
  if (!resolved) {
    log.info(
      { tenantId, checkKey, domainKey, endpoint },
      "drift attribution: check endpoint does not resolve to a registered resource type — every drift event stays unattributed (#2819)",
    );
    return undefined;
  }
  const resourceKey = resolved.resourceKey;

  const tenantRowId = await resolveTenantRowId(tenantId);
  if (tenantRowId === null) {
    log.info(
      { tenantId, checkKey, domainKey },
      "drift attribution: tenant is not an onboarded tenants row — no scopes to match (#2819)",
    );
    return undefined;
  }

  // Refresh the scope bridge for this tenant's change requests, exactly as
  // `attributeDiff` does. The upserts are idempotent against the scope table's
  // natural key, so a monitoring scan re-deriving them rewrites rows already
  // present rather than duplicating them — and without this the bridge is empty
  // for any tenant that has never had a config diff attributed.
  const crs = await db
    .select({ id: mspChangeRequestsTable.id })
    .from(mspChangeRequestsTable)
    .where(and(
      eq(mspChangeRequestsTable.tenantId, tenantId),
      inArray(mspChangeRequestsTable.status, [...ATTRIBUTING_CR_STATUSES]),
    ));
  for (const cr of crs) await deriveScopesForChangeRequest(cr.id);

  // The interval this drift could have happened in: from the baseline capture to
  // this scan, widened for clock skew. See limit 1 in the file header.
  const windowFrom = baselineCapturedAt ? new Date(baselineCapturedAt.getTime() - WINDOW_TOLERANCE_MS) : null;
  const windowTo = new Date(observedAt.getTime() + WINDOW_TOLERANCE_MS);

  const rows = await db
    .select({
      scope: configChangeScopesTable,
      crStatus: mspChangeRequestsTable.status,
      crUpdatedAt: mspChangeRequestsTable.updatedAt,
      crRequestedBy: mspChangeRequestsTable.requestedBy,
      crApprovedBy: mspChangeRequestsTable.approvedBy,
    })
    .from(configChangeScopesTable)
    .innerJoin(mspChangeRequestsTable, eq(mspChangeRequestsTable.id, configChangeScopesTable.changeRequestId))
    .where(and(
      eq(configChangeScopesTable.tenantId, tenantRowId),
      eq(configChangeScopesTable.resourceKey, resourceKey),
      eq(configChangeScopesTable.sourceKind, "change_request"),
    ));

  const eligible: EligibleDriftScope[] = [];
  for (const r of rows) {
    if (!r.crStatus || !ATTRIBUTING_CR_STATUSES.includes(r.crStatus)) continue;
    const s = r.scope;
    if (s.changeRequestId === null) continue;
    if (windowFrom && s.effectiveTo && s.effectiveTo < windowFrom) continue;
    if (s.effectiveFrom && s.effectiveFrom > windowTo) continue;
    eligible.push({
      scopeId: s.id,
      changeRequestId: s.changeRequestId,
      riskDecisionId: null,
      sourceKind: "change_request",
      crRef: formatChangeRequestCode(s.changeRequestId),
      rbdRef: null,
      resourceKey: s.resourceKey,
      objectIdentity: s.objectIdentity,
      propertyPathNormalized: s.propertyPathNormalized,
      basis: s.basis,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      sourceUpdatedAt: r.crUpdatedAt ?? null,
      changedBy: r.crApprovedBy ?? r.crRequestedBy ?? null,
    });
  }

  if (eligible.length === 0) {
    log.info(
      { tenantId, checkKey, domainKey, resourceKey, changeRequests: crs.length },
      "drift attribution: no change-request scope covers this resource in this window — drift stays unattributed (#2819)",
    );
    return undefined;
  }

  return makeDriftAttributionResolver({ resourceKey, identity, eligible });
}

/**
 * The pure half: given already-loaded eligible scopes, answer per setting.
 * Split out so the matching + ranking is unit-testable without a database, the
 * same way `planDriftEvents` is.
 */
export function makeDriftAttributionResolver(args: {
  resourceKey: string;
  identity: DriftSettingIdentity;
  eligible: readonly EligibleDriftScope[];
}): (setting: string) => DriftAttribution | undefined {
  const { resourceKey, identity, eligible } = args;
  const cache = new Map<string, DriftAttribution | undefined>();

  return (setting: string): DriftAttribution | undefined => {
    if (cache.has(setting)) return cache.get(setting);
    let answer: DriftAttribution | undefined;

    const target = resolveDriftSettingTarget(setting, identity);
    if (target) {
      const change = { resourceKey, ...target };
      const matches = eligible
        .map((scope) => ({ scope, matchScope: matchDriftScope(scope, change) }))
        .filter((m): m is { scope: EligibleDriftScope; matchScope: ConfigChangeMatchScope } => m.matchScope !== null)
        // `compareMatches` is #2759's own total order — precision, then narrower
        // claimed window, then evidence-of-what-happened over statement-of-intent,
        // then recency. Reused verbatim so a drift verdict and a diff verdict rank
        // the same competing change requests the same way.
        .sort(compareMatches);
      const best = matches[0];
      if (best) {
        answer = {
          changedBy: best.scope.changedBy,
          crRef: formatChangeRequestCode(best.scope.changeRequestId),
          changeRequestId: best.scope.changeRequestId,
        };
      }
    }

    cache.set(setting, answer);
    return answer;
  };
}
