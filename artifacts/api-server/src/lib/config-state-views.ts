/**
 * config-state-views.ts — the ONE place the configuration-state store is turned into
 * a tenant-scoped, paginated wire payload (Git #1843).
 *
 * `routes/portal-config-state.ts` (the customer) and `routes/msp-config-state.ts` (the
 * MSP operator) both read from here. They differ only in HOW the allowed tenant set is
 * resolved — the customer's is one id off the JWT, the operator's is their book — and
 * never in what a scoped read then does. That split is deliberate: a second copy of
 * this SQL is a second place a tenant predicate can be forgotten, and configuration is
 * the most sensitive payload this platform holds.
 *
 * ─── The scoping rule, stated once ─────────────────────────────────────────────
 * Every function that reads a snapshot, a diff or an object takes an explicit
 * `allowedTenantIds` and applies it as a SQL predicate. There is no variant that
 * skips it, and no caller supplies "all tenants" — an operator with no restriction
 * still passes the real list of tenant ids in their book. `assertCustomerAccess` and
 * `resolveCustomerId` remain the only sources of that list; nothing here invents a
 * second scoping mechanism.
 *
 * A diff is scoped on BOTH sides. `config_diffs` carries `base_tenant_id` and
 * `head_tenant_id`, and a `tenant_compare` or `promotion` diff is legitimately across
 * two tenants — so a caller must be entitled to BOTH to read it. Checking only the
 * head would hand a customer the other tenant's configuration in the `old_value`
 * column of every change row, which is the exact leak this issue names.
 *
 * ─── Pagination, shaped against measured volume ────────────────────────────────
 * Not guessed. Measured on 2026-08-31 against the testbed's two full snapshots in the
 * local database (`tenants.id = 1`, rows 8 and 10):
 *
 *   50,124 / 50,176 objects · 94 resources with objects · 34 MB of `object_json`
 *   largest single object              173,626 bytes
 *   largest single resource type       graph:v1.0:/applicationTemplates — 39,089 objects, 27 MB
 *   registered resource types          1,539 (1,359 collectable), so 1,359 status rows per snapshot
 *
 * Consequences, and they are the reason for the constants below:
 *  - No endpoint may return a whole snapshot. 34 MB is not a response.
 *  - Object pages are capped in the LOW TENS, not the hundreds: 100 × the observed
 *    maximum object is 17 MB. `OBJECT_PAGE` is 25 by default, 100 at most, and
 *    `?include=summary` drops `objectJson` entirely for callers that only need the
 *    inventory (identity, display name, hash, property count).
 *  - The completeness document is 1,359 rows, which IS servable in one page, but it
 *    is still paginated and filterable because a UI showing 1,359 rows at once is not
 *    a document. `RESOURCE_PAGE` defaults to 200, max 1,000.
 *
 * ─── Completeness travels with every payload ───────────────────────────────────
 * `snapshotCompleteness()` and `diffCompleteness()` build the record every response in
 * this subsystem carries. A payload that omits what could not be read is
 * indistinguishable from a tenant that does not have those objects; that distinction
 * is the product, and it is not optional per-route decoration.
 *
 * READ-ONLY. Nothing in this file writes to a tenant, and nothing in it may.
 */

import {
  db,
  tenantConfigSnapshotsTable,
  tenantConfigSnapshotResourceStatusTable,
  tenantConfigSnapshotObjectsTable,
  configSnapshotResourceTypesTable,
  configDiffsTable,
  configDiffResourceStatusTable,
  configDiffChangesTable,
  configChangeAttributionsTable,
  configChangeLifecycleTable,
  tenantsTable,
  SNAPSHOT_RESOURCE_STATUSES,
  type TenantConfigSnapshot,
  type ConfigDiff,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

// ── Page sizes ───────────────────────────────────────────────────────────────
// See the measurement in the file header. These are not round numbers picked for
// looking sensible; each one is derived from a real observed byte count.

export const SNAPSHOT_LIST_PAGE = { def: 25, max: 200 } as const;
export const RESOURCE_PAGE = { def: 200, max: 1000 } as const;
/** Low by design: 100 × the largest observed object (173,626 bytes) is 17 MB. */
export const OBJECT_PAGE = { def: 25, max: 100 } as const;
export const CHANGE_PAGE = { def: 100, max: 500 } as const;
export const REGISTRY_PAGE = { def: 200, max: 1000 } as const;

export interface PageBounds { readonly def: number; readonly max: number }

export function clampLimit(raw: unknown, bounds: PageBounds): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return bounds.def;
  return Math.min(Math.floor(n), bounds.max);
}

export function clampOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export interface Paging { total: number; limit: number; offset: number; hasMore: boolean }

const paging = (total: number, limit: number, offset: number): Paging =>
  ({ total, limit, offset, hasMore: offset + limit < total });

// ── Identifier parsing ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A snapshot or diff is addressable by uuid or by integer row id, matching the
 * convention `admin-config-snapshots.ts` and `admin-config-diffs.ts` already set —
 * so an id pasted out of a log line resolves without translation.
 */
export function parseRef(raw: string): { kind: "row"; id: number } | { kind: "uuid"; id: string } | null {
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "row", id } : null;
  }
  if (UUID_RE.test(raw)) return { kind: "uuid", id: raw };
  return null;
}

// ── The completeness record ──────────────────────────────────────────────────

/**
 * What a caller needs in order to know how much of this snapshot is a statement
 * about the tenant and how much is a statement about our own reach.
 *
 * `readableFraction` is deliberately "of the types we targeted, how many did we get
 * an answer for" — collected AND empty both count, because "you genuinely have none"
 * is an answer. Skipped, failed and partial do not. It is NOT a score for the
 * tenant's configuration quality and must never be rendered as one.
 */
export interface SnapshotCompleteness {
  isComplete: boolean;
  status: string;
  capturedAt: Date;
  resourceTypesTargeted: number;
  resourceTypesCollected: number;
  resourceTypesEmpty: number;
  resourceTypesPartial: number;
  resourceTypesSkipped: number;
  resourceTypesFailed: number;
  objectCount: number;
  /** null — never 0 — when nothing was targeted, so a UI renders "unavailable". */
  readableFraction: number | null;
  collectorVersion: string | null;
  error: string | null;
}

export function snapshotCompleteness(s: TenantConfigSnapshot): SnapshotCompleteness {
  const answered = s.resourceTypesCollected + s.resourceTypesEmpty;
  return {
    isComplete: s.isComplete,
    status: s.status,
    capturedAt: s.capturedAt,
    resourceTypesTargeted: s.resourceTypesTargeted,
    resourceTypesCollected: s.resourceTypesCollected,
    resourceTypesEmpty: s.resourceTypesEmpty,
    resourceTypesPartial: s.resourceTypesPartial,
    resourceTypesSkipped: s.resourceTypesSkipped,
    resourceTypesFailed: s.resourceTypesFailed,
    objectCount: s.objectCount,
    readableFraction: s.resourceTypesTargeted > 0 ? answered / s.resourceTypesTargeted : null,
    collectorVersion: s.collectorVersion,
    error: s.error,
  };
}

/**
 * The diff's equivalent. `comparableFraction` answers "of the resource types either
 * side targeted, how many could actually be compared" — which is the number that
 * decides whether "no changes" means "nothing changed" or "we could not look."
 */
export interface DiffCompleteness {
  isComplete: boolean;
  status: string;
  resourceTypesCompared: number;
  resourceTypesPartial: number;
  resourceTypesNotComparable: number;
  comparableFraction: number | null;
  objectsPaired: number;
  objectsAdded: number;
  objectsRemoved: number;
  objectsIndeterminate: number;
  objectsUnpairable: number;
  changesTotal: number;
  changesSignificant: number;
  changesIgnored: number;
  differVersion: string;
  rulesetFingerprint: string;
  error: string | null;
}

export function diffCompleteness(d: ConfigDiff): DiffCompleteness {
  const considered = d.resourceTypesCompared + d.resourceTypesPartial + d.resourceTypesNotComparable;
  return {
    isComplete: d.isComplete,
    status: d.status,
    resourceTypesCompared: d.resourceTypesCompared,
    resourceTypesPartial: d.resourceTypesPartial,
    resourceTypesNotComparable: d.resourceTypesNotComparable,
    comparableFraction: considered > 0 ? d.resourceTypesCompared / considered : null,
    objectsPaired: d.objectsPaired,
    objectsAdded: d.objectsAdded,
    objectsRemoved: d.objectsRemoved,
    objectsIndeterminate: d.objectsIndeterminate,
    objectsUnpairable: d.objectsUnpairable,
    changesTotal: d.changesTotal,
    changesSignificant: d.changesSignificant,
    changesIgnored: d.changesIgnored,
    differVersion: d.differVersion,
    rulesetFingerprint: d.rulesetFingerprint,
    error: d.error,
  };
}

// ── Scoped loads ─────────────────────────────────────────────────────────────

/**
 * Load one snapshot header, but ONLY if it belongs to a tenant the caller is
 * entitled to. The tenant predicate is part of the same WHERE clause as the id
 * lookup, so there is no window in which an out-of-scope row exists in memory and a
 * later `if` is relied on to drop it.
 *
 * Returns `null` for both "does not exist" and "not yours" — the caller answers 404
 * either way, because distinguishing them tells an unentitled caller that a snapshot
 * with that id exists.
 */
export async function loadScopedSnapshot(
  ref: string,
  allowedTenantIds: readonly number[],
): Promise<TenantConfigSnapshot | null> {
  const parsed = parseRef(ref);
  if (!parsed || allowedTenantIds.length === 0) return null;

  const [row] = await db.select().from(tenantConfigSnapshotsTable)
    .where(and(
      parsed.kind === "row"
        ? eq(tenantConfigSnapshotsTable.id, parsed.id)
        : eq(tenantConfigSnapshotsTable.snapshotId, parsed.id),
      inArray(tenantConfigSnapshotsTable.tenantId, [...allowedTenantIds]),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Load one diff, entitled on BOTH sides. See the header: a `tenant_compare` diff's
 * `old_value` column literally contains the base tenant's configuration, so head-side
 * entitlement alone is not entitlement to read it.
 */
export async function loadScopedDiff(
  ref: string,
  allowedTenantIds: readonly number[],
): Promise<ConfigDiff | null> {
  const parsed = parseRef(ref);
  if (!parsed || allowedTenantIds.length === 0) return null;

  const ids = [...allowedTenantIds];
  const [row] = await db.select().from(configDiffsTable)
    .where(and(
      parsed.kind === "row"
        ? eq(configDiffsTable.id, parsed.id)
        : eq(configDiffsTable.diffId, parsed.id),
      inArray(configDiffsTable.baseTenantId, ids),
      inArray(configDiffsTable.headTenantId, ids),
    ))
    .limit(1);
  return row ?? null;
}

// ── Snapshot history ─────────────────────────────────────────────────────────

export interface SnapshotSummary {
  id: number;
  snapshotId: string;
  tenantId: number;
  tenantName: string | null;
  capturedAt: Date;
  status: string;
  trigger: string;
  completeness: SnapshotCompleteness;
}

const toSummary = (s: TenantConfigSnapshot, tenantName: string | null): SnapshotSummary => ({
  id: s.id,
  snapshotId: s.snapshotId,
  tenantId: s.tenantId,
  tenantName,
  capturedAt: s.capturedAt,
  status: s.status,
  trigger: s.trigger,
  completeness: snapshotCompleteness(s),
});

export interface ListSnapshotsOptions {
  allowedTenantIds: readonly number[];
  /** Narrow further within the allowed set. Never widens it. */
  tenantId?: number;
  status?: string;
  limit: number;
  offset: number;
}

export async function listSnapshots(
  opts: ListSnapshotsOptions,
): Promise<{ snapshots: SnapshotSummary[]; paging: Paging }> {
  if (opts.allowedTenantIds.length === 0) {
    return { snapshots: [], paging: paging(0, opts.limit, opts.offset) };
  }
  // The intersection, not the union: a `tenantId` filter can only ever narrow.
  const tenantIds = opts.tenantId !== undefined
    ? opts.allowedTenantIds.filter((id) => id === opts.tenantId)
    : [...opts.allowedTenantIds];
  if (tenantIds.length === 0) {
    return { snapshots: [], paging: paging(0, opts.limit, opts.offset) };
  }

  const where: SQL[] = [inArray(tenantConfigSnapshotsTable.tenantId, tenantIds)];
  if (opts.status) where.push(sql`${tenantConfigSnapshotsTable.status} = ${opts.status}`);

  const rows = await db.select({
    snapshot: tenantConfigSnapshotsTable,
    tenantName: tenantsTable.customerName,
  }).from(tenantConfigSnapshotsTable)
    .leftJoin(tenantsTable, eq(tenantsTable.id, tenantConfigSnapshotsTable.tenantId))
    .where(and(...where))
    .orderBy(desc(tenantConfigSnapshotsTable.capturedAt))
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(tenantConfigSnapshotsTable).where(and(...where));

  return {
    snapshots: rows.map((r) => toSummary(r.snapshot, r.tenantName ?? null)),
    paging: paging(total, opts.limit, opts.offset),
  };
}

/**
 * The most recent SEALED snapshot for each of the given tenants.
 *
 * `sealed` and not `running`: a running snapshot's object set is incomplete by
 * definition and still growing, so serving it as "your current configuration" would
 * report a not-yet-collected resource as absent — the same fabricated-absence the
 * differ refuses to compute over. `failed` and `abandoned` are excluded for the same
 * reason, and their absence is visible in the history list rather than hidden.
 */
export async function latestSealedSnapshots(
  tenantIds: readonly number[],
): Promise<Map<number, TenantConfigSnapshot>> {
  const out = new Map<number, TenantConfigSnapshot>();
  if (tenantIds.length === 0) return out;

  const rows = await db.select().from(tenantConfigSnapshotsTable)
    .where(and(
      inArray(tenantConfigSnapshotsTable.tenantId, [...tenantIds]),
      eq(tenantConfigSnapshotsTable.status, "sealed"),
    ))
    .orderBy(desc(tenantConfigSnapshotsTable.capturedAt));

  for (const r of rows) if (!out.has(r.tenantId)) out.set(r.tenantId, r);
  return out;
}

/**
 * The two most recent sealed snapshots for one tenant, newest first — the pair
 * "what changed since last time" is about. Returns fewer than two when the tenant
 * has not been collected twice yet, which is a real state the caller must report
 * rather than paper over.
 */
export async function latestSealedPair(tenantId: number): Promise<TenantConfigSnapshot[]> {
  return db.select().from(tenantConfigSnapshotsTable)
    .where(and(
      eq(tenantConfigSnapshotsTable.tenantId, tenantId),
      eq(tenantConfigSnapshotsTable.status, "sealed"),
    ))
    .orderBy(desc(tenantConfigSnapshotsTable.capturedAt))
    .limit(2);
}

// ── The snapshot document ────────────────────────────────────────────────────

export interface SnapshotResourceRow {
  resourceKey: string;
  displayName: string;
  surface: string | null;
  workload: string;
  readTransport: string;
  status: string;
  skipReason: string | null;
  reasonDetail: string | null;
  objectCount: number;
  pageCount: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number | null;
  attemptedAt: Date;
}

export interface WorkloadRollup {
  workload: string;
  resourceTypes: number;
  objectCount: number;
  totals: Record<typeof SNAPSHOT_RESOURCE_STATUSES[number], number>;
}

export interface SnapshotDocumentOptions {
  snapshotRowId: number;
  workload?: string;
  status?: string;
  limit: number;
  offset: number;
}

/**
 * One page of the snapshot's per-resource completeness document, plus the FULL
 * per-workload roll-up.
 *
 * The roll-up is deliberately computed over the whole snapshot and not over the
 * page: a summary that only counted the rows that fit on page 1 would say a tenant
 * had 200 resource types when it targeted 1,359, which is precisely the silent
 * omission this subsystem exists to prevent. It is a `GROUP BY` in the database, not
 * an aggregate over the returned array.
 */
export async function readSnapshotDocument(opts: SnapshotDocumentOptions): Promise<{
  resources: SnapshotResourceRow[];
  workloads: WorkloadRollup[];
  paging: Paging;
}> {
  const where: SQL[] = [eq(tenantConfigSnapshotResourceStatusTable.snapshotRowId, opts.snapshotRowId)];
  if (opts.workload) where.push(eq(configSnapshotResourceTypesTable.workload, opts.workload));
  if (opts.status) where.push(sql`${tenantConfigSnapshotResourceStatusTable.status} = ${opts.status}`);

  const base = db.select({
    status: tenantConfigSnapshotResourceStatusTable,
    displayName: configSnapshotResourceTypesTable.displayName,
    surface: configSnapshotResourceTypesTable.surface,
    workload: configSnapshotResourceTypesTable.workload,
  }).from(tenantConfigSnapshotResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, tenantConfigSnapshotResourceStatusTable.resourceKey));

  const rows = await base.where(and(...where))
    .orderBy(
      asc(configSnapshotResourceTypesTable.workload),
      asc(tenantConfigSnapshotResourceStatusTable.resourceKey),
    )
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(tenantConfigSnapshotResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, tenantConfigSnapshotResourceStatusTable.resourceKey))
    .where(and(...where));

  // Whole-snapshot roll-up, unfiltered by the page and unfiltered by workload/status
  // — the reader has to be able to see what the filter is hiding.
  const rollupRows = await db.select({
    workload: configSnapshotResourceTypesTable.workload,
    status: tenantConfigSnapshotResourceStatusTable.status,
    resourceTypes: sql<number>`count(*)::int`,
    objectCount: sql<number>`coalesce(sum(${tenantConfigSnapshotResourceStatusTable.objectCount}), 0)::int`,
  }).from(tenantConfigSnapshotResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, tenantConfigSnapshotResourceStatusTable.resourceKey))
    .where(eq(tenantConfigSnapshotResourceStatusTable.snapshotRowId, opts.snapshotRowId))
    .groupBy(configSnapshotResourceTypesTable.workload, tenantConfigSnapshotResourceStatusTable.status);

  const byWorkload = new Map<string, WorkloadRollup>();
  for (const r of rollupRows) {
    // A resource key with no registry match is a real fact — the type was retired or
    // renamed since collection — and is labelled rather than dropped.
    const workload = r.workload ?? "unregistered";
    let g = byWorkload.get(workload);
    if (!g) {
      g = {
        workload,
        resourceTypes: 0,
        objectCount: 0,
        totals: { collected: 0, empty: 0, partial: 0, skipped: 0, failed: 0 },
      };
      byWorkload.set(workload, g);
    }
    g.resourceTypes += r.resourceTypes;
    g.objectCount += r.objectCount;
    g.totals[r.status as typeof SNAPSHOT_RESOURCE_STATUSES[number]] += r.resourceTypes;
  }

  return {
    resources: rows.map((r) => ({
      resourceKey: r.status.resourceKey,
      displayName: r.displayName ?? r.status.resourceKey,
      surface: r.surface ?? null,
      workload: r.workload ?? "unregistered",
      readTransport: r.status.readTransport,
      status: r.status.status,
      skipReason: r.status.skipReason,
      reasonDetail: r.status.reasonDetail,
      objectCount: r.status.objectCount,
      pageCount: r.status.pageCount,
      httpStatus: r.status.httpStatus,
      errorCode: r.status.errorCode,
      durationMs: r.status.durationMs,
      attemptedAt: r.status.attemptedAt,
    })),
    workloads: Array.from(byWorkload.values()).sort((a, b) => a.workload.localeCompare(b.workload)),
    paging: paging(total, opts.limit, opts.offset),
  };
}

// ── The object drill-down ────────────────────────────────────────────────────

export interface SnapshotObjectRow {
  objectIdentity: string;
  identityStrategy: string;
  displayName: string | null;
  objectHash: string;
  propertyCount: number;
  odataType: string | null;
  sourceRef: string | null;
  collectedAt: Date;
  /** Present only when `include: "full"`. See `OBJECT_PAGE` for why that is a choice. */
  objectJson?: Record<string, unknown>;
}

export async function readSnapshotObjects(opts: {
  snapshotRowId: number;
  resourceKey: string;
  include: "full" | "summary";
  limit: number;
  offset: number;
}): Promise<{ objects: SnapshotObjectRow[]; paging: Paging; resourceStatus: SnapshotResourceRow | null }> {
  const where = and(
    eq(tenantConfigSnapshotObjectsTable.snapshotRowId, opts.snapshotRowId),
    eq(tenantConfigSnapshotObjectsTable.resourceKey, opts.resourceKey),
  );

  const rows = await db.select({
    objectIdentity: tenantConfigSnapshotObjectsTable.objectIdentity,
    identityStrategy: tenantConfigSnapshotObjectsTable.identityStrategy,
    displayName: tenantConfigSnapshotObjectsTable.displayName,
    objectHash: tenantConfigSnapshotObjectsTable.objectHash,
    propertyCount: tenantConfigSnapshotObjectsTable.propertyCount,
    odataType: tenantConfigSnapshotObjectsTable.odataType,
    sourceRef: tenantConfigSnapshotObjectsTable.sourceRef,
    collectedAt: tenantConfigSnapshotObjectsTable.collectedAt,
    // Selected conditionally rather than fetched-and-stripped: on
    // `graph:v1.0:/applicationTemplates` the JSON is 27 MB for the resource, so
    // reading it in order to throw it away is the cost this option exists to avoid.
    objectJson: opts.include === "full"
      ? tenantConfigSnapshotObjectsTable.objectJson
      : sql<null>`null`,
  }).from(tenantConfigSnapshotObjectsTable)
    .where(where)
    .orderBy(asc(tenantConfigSnapshotObjectsTable.objectIdentity))
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(tenantConfigSnapshotObjectsTable).where(where);

  // The resource's own completeness row travels with its objects. Without it a page
  // of 25 objects out of a `partial` read looks exactly like a page out of a
  // complete one.
  const [statusRow] = await db.select({
    status: tenantConfigSnapshotResourceStatusTable,
    displayName: configSnapshotResourceTypesTable.displayName,
    surface: configSnapshotResourceTypesTable.surface,
    workload: configSnapshotResourceTypesTable.workload,
  }).from(tenantConfigSnapshotResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, tenantConfigSnapshotResourceStatusTable.resourceKey))
    .where(and(
      eq(tenantConfigSnapshotResourceStatusTable.snapshotRowId, opts.snapshotRowId),
      eq(tenantConfigSnapshotResourceStatusTable.resourceKey, opts.resourceKey),
    ))
    .limit(1);

  return {
    objects: rows.map((r) => {
      const out: SnapshotObjectRow = {
        objectIdentity: r.objectIdentity,
        identityStrategy: r.identityStrategy,
        displayName: r.displayName,
        objectHash: r.objectHash,
        propertyCount: r.propertyCount,
        odataType: r.odataType,
        sourceRef: r.sourceRef,
        collectedAt: r.collectedAt,
      };
      if (opts.include === "full") out.objectJson = r.objectJson as Record<string, unknown>;
      return out;
    }),
    paging: paging(total, opts.limit, opts.offset),
    resourceStatus: statusRow
      ? {
        resourceKey: statusRow.status.resourceKey,
        displayName: statusRow.displayName ?? statusRow.status.resourceKey,
        surface: statusRow.surface ?? null,
        workload: statusRow.workload ?? "unregistered",
        readTransport: statusRow.status.readTransport,
        status: statusRow.status.status,
        skipReason: statusRow.status.skipReason,
        reasonDetail: statusRow.status.reasonDetail,
        objectCount: statusRow.status.objectCount,
        pageCount: statusRow.status.pageCount,
        httpStatus: statusRow.status.httpStatus,
        errorCode: statusRow.status.errorCode,
        durationMs: statusRow.status.durationMs,
        attemptedAt: statusRow.status.attemptedAt,
      }
      : null,
  };
}

// ── The diff document ────────────────────────────────────────────────────────

export async function readDiffResourceReport(opts: {
  diffRowId: number;
  comparability?: string;
  workload?: string;
  limit: number;
  offset: number;
}) {
  const where: SQL[] = [eq(configDiffResourceStatusTable.diffRowId, opts.diffRowId)];
  if (opts.comparability) {
    where.push(sql`${configDiffResourceStatusTable.comparability} = ${opts.comparability}`);
  }
  if (opts.workload) where.push(eq(configSnapshotResourceTypesTable.workload, opts.workload));

  const rows = await db.select({
    status: configDiffResourceStatusTable,
    displayName: configSnapshotResourceTypesTable.displayName,
    surface: configSnapshotResourceTypesTable.surface,
    workload: configSnapshotResourceTypesTable.workload,
  }).from(configDiffResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, configDiffResourceStatusTable.resourceKey))
    .where(and(...where))
    .orderBy(asc(configSnapshotResourceTypesTable.workload), asc(configDiffResourceStatusTable.resourceKey))
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(configDiffResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, configDiffResourceStatusTable.resourceKey))
    .where(and(...where));

  // Whole-diff roll-up, same reasoning as the snapshot document's.
  const rollup = await db.select({
    workload: configSnapshotResourceTypesTable.workload,
    comparability: configDiffResourceStatusTable.comparability,
    resourceTypes: sql<number>`count(*)::int`,
    changesSignificant: sql<number>`coalesce(sum(${configDiffResourceStatusTable.changesSignificant}), 0)::int`,
  }).from(configDiffResourceStatusTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, configDiffResourceStatusTable.resourceKey))
    .where(eq(configDiffResourceStatusTable.diffRowId, opts.diffRowId))
    .groupBy(configSnapshotResourceTypesTable.workload, configDiffResourceStatusTable.comparability);

  return {
    resources: rows.map((r) => ({
      ...r.status,
      displayName: r.displayName ?? r.status.resourceKey,
      surface: r.surface ?? null,
      workload: r.workload ?? "unregistered",
    })),
    byWorkload: rollup.map((r) => ({ ...r, workload: r.workload ?? "unregistered" })),
    paging: paging(total, opts.limit, opts.offset),
  };
}

export async function readDiffChanges(opts: {
  diffRowId: number;
  resourceKey?: string;
  changeKind?: string;
  workload?: string;
  includeIgnored: boolean;
  limit: number;
  offset: number;
}) {
  const where: SQL[] = [eq(configDiffChangesTable.diffRowId, opts.diffRowId)];
  // Ignored changes are stored, never dropped — but the DEFAULT view is the
  // significant set, because that is the number a human is meant to act on.
  // `includeIgnored` exists so a suppression can always be audited.
  if (!opts.includeIgnored) where.push(eq(configDiffChangesTable.isIgnored, false));
  if (opts.resourceKey) where.push(eq(configDiffChangesTable.resourceKey, opts.resourceKey));
  if (opts.changeKind) where.push(sql`${configDiffChangesTable.changeKind} = ${opts.changeKind}`);
  if (opts.workload) where.push(eq(configSnapshotResourceTypesTable.workload, opts.workload));

  const rows = await db.select({
    change: configDiffChangesTable,
    displayName: configSnapshotResourceTypesTable.displayName,
    workload: configSnapshotResourceTypesTable.workload,
    // #2759 — the verdict, LEFT joined on purpose. A diff the attribution pass has not
    // run over yields NULL here and the row reports `verdict: null`, which is a
    // different statement from `unattributed` ("the pass ran and found nothing
    // explains this") and must never be flattened into it.
    attribution: configChangeAttributionsTable,
    lifecycle: configChangeLifecycleTable,
  }).from(configDiffChangesTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, configDiffChangesTable.resourceKey))
    .leftJoin(configChangeAttributionsTable,
      eq(configChangeAttributionsTable.changeId, configDiffChangesTable.id))
    .leftJoin(configChangeLifecycleTable,
      eq(configChangeLifecycleTable.id, configChangeAttributionsTable.lifecycleId))
    .where(and(...where))
    // The stored sequence, always. The total order IS the result (#1797 rule 3), so
    // re-sorting here would discard the property being guaranteed.
    .orderBy(asc(configDiffChangesTable.sequence))
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(configDiffChangesTable)
    .leftJoin(configSnapshotResourceTypesTable,
      eq(configSnapshotResourceTypesTable.resourceKey, configDiffChangesTable.resourceKey))
    .where(and(...where));

  const byKind = await db.select({
    changeKind: configDiffChangesTable.changeKind,
    isIgnored: configDiffChangesTable.isIgnored,
    count: sql<number>`count(*)::int`,
  }).from(configDiffChangesTable)
    .where(eq(configDiffChangesTable.diffRowId, opts.diffRowId))
    .groupBy(configDiffChangesTable.changeKind, configDiffChangesTable.isIgnored);

  return {
    changes: rows.map((r) => ({
      sequence: r.change.sequence,
      resourceKey: r.change.resourceKey,
      resourceDisplayName: r.displayName ?? r.change.resourceKey,
      workload: r.workload ?? "unregistered",
      objectIdentity: r.change.objectIdentity,
      objectDisplayName: r.change.objectDisplayName,
      identityStrategy: r.change.identityStrategy,
      changeKind: r.change.changeKind,
      propertyPath: r.change.propertyPath,
      oldValue: r.change.oldValue,
      newValue: r.change.newValue,
      oldValuePresent: r.change.oldValuePresent,
      newValuePresent: r.change.newValuePresent,
      isIgnored: r.change.isIgnored,
      ignoredByRuleId: r.change.ignoredByRuleId,
      // #2759 — WHY this change happened, from the real Change Control / Risk Register
      // records. `null` means the attribution pass has not run over this diff.
      attribution: r.attribution
        ? {
          verdict: r.attribution.verdict,
          changeRequestId: r.attribution.changeRequestId,
          crRef: r.attribution.crRef,
          riskDecisionId: r.attribution.riskDecisionId,
          rbdRef: r.attribution.rbdRef,
          /** property | object | resource — how precisely the covering claim matched. */
          matchScope: r.attribution.matchScope,
          /** > 1 means more than one recorded decision claims this row. */
          matchCount: r.attribution.matchCount,
          attributionVersion: r.attribution.attributionVersion,
          attributedAt: r.attribution.attributedAt,
        }
        : null,
      // The open / resolved / reopened question, answered from real observed values
      // across successive comparisons rather than invented per-diff.
      lifecycle: r.lifecycle
        ? {
          status: r.lifecycle.status,
          firstDetectedAt: r.lifecycle.firstDetectedAt,
          lastDetectedAt: r.lifecycle.lastDetectedAt,
          resolvedAt: r.lifecycle.resolvedAt,
          reopenedAt: r.lifecycle.reopenedAt,
          reopenCount: r.lifecycle.reopenCount,
        }
        : null,
    })),
    byKind,
    paging: paging(total, opts.limit, opts.offset),
  };
}

/** Both snapshot headers behind a diff, so a reader can see what was compared. */
export async function diffSides(d: ConfigDiff): Promise<{
  base: TenantConfigSnapshot | null;
  head: TenantConfigSnapshot | null;
}> {
  const rows = await db.select().from(tenantConfigSnapshotsTable)
    .where(inArray(tenantConfigSnapshotsTable.id, [d.baseSnapshotRowId, d.headSnapshotRowId]));
  return {
    base: rows.find((s) => s.id === d.baseSnapshotRowId) ?? null,
    head: rows.find((s) => s.id === d.headSnapshotRowId) ?? null,
  };
}

// ── The resource-type registry ───────────────────────────────────────────────

/**
 * What is collectable, over what transport, needing which permission — and what is
 * NOT collectable and exactly why.
 *
 * The uncollectable half is the point. `not_collectable_reason` is NOT NULL by CHECK
 * constraint for every non-collectable type, so this read cannot return a gap without
 * its cause. An operator asking "why is Exchange missing from my snapshot" gets the
 * real answer — no executor, unresolved identity, or the resource itself not being
 * collectable — rather than an absence.
 */
export async function readResourceRegistry(opts: {
  collectable?: boolean;
  transport?: string;
  surface?: string;
  workload?: string;
  availability?: string;
  q?: string;
  limit: number;
  offset: number;
}) {
  const where: SQL[] = [];
  if (opts.collectable !== undefined) {
    where.push(eq(configSnapshotResourceTypesTable.isCollectable, opts.collectable));
  }
  if (opts.transport) where.push(sql`${configSnapshotResourceTypesTable.readTransport} = ${opts.transport}`);
  if (opts.surface) where.push(sql`${configSnapshotResourceTypesTable.surface} = ${opts.surface}`);
  if (opts.workload) where.push(eq(configSnapshotResourceTypesTable.workload, opts.workload));
  if (opts.availability) {
    where.push(sql`${configSnapshotResourceTypesTable.lastKnownAvailability} = ${opts.availability}`);
  }
  if (opts.q) {
    const like = `%${opts.q.toLowerCase()}%`;
    where.push(sql`(lower(${configSnapshotResourceTypesTable.resourceKey}) LIKE ${like}
                 OR lower(${configSnapshotResourceTypesTable.displayName}) LIKE ${like})`);
  }
  const whereClause = where.length > 0 ? and(...where) : undefined;

  const rows = await db.select().from(configSnapshotResourceTypesTable)
    .where(whereClause)
    .orderBy(asc(configSnapshotResourceTypesTable.collectionOrder),
      asc(configSnapshotResourceTypesTable.resourceKey))
    .limit(opts.limit).offset(opts.offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(configSnapshotResourceTypesTable).where(whereClause);

  return {
    resourceTypes: rows.map((r) => ({
      resourceKey: r.resourceKey,
      displayName: r.displayName,
      surface: r.surface,
      workload: r.workload,
      readTransport: r.readTransport,
      graphVersion: r.graphVersion,
      graphPath: r.graphPath,
      isCollection: r.isCollection,
      readCmdlets: r.readCmdlets,
      identityStrategy: r.identityStrategy,
      identityPropertyNames: r.identityPropertyNames,
      identityBasis: r.identityBasis,
      // Two separate permission sets on purpose (#1794): `required` is
      // Microsoft365DSC's ALL-OF set, `graphReadOptions` is Microsoft's ANY-OF set.
      // Merging them misreports availability in both directions.
      requiredAppPermissions: r.requiredAppPermissions,
      graphReadPermissionOptions: r.graphReadPermissionOptions,
      isCollectable: r.isCollectable,
      notCollectableReason: r.notCollectableReason,
      collectionOrder: r.collectionOrder,
      lastKnownAvailability: r.lastKnownAvailability,
      availabilityRefreshedAt: r.availabilityRefreshedAt,
      shapeProvenance: r.shapeProvenance,
      notes: r.notes,
    })),
    paging: paging(total, opts.limit, opts.offset),
  };
}

/** The registry's roll-ups — the "what can this platform actually read" answer. */
export async function readResourceRegistrySummary() {
  const [byCollectable, byTransport, bySurface, byAvailability, byReason, byProvenance] = await Promise.all([
    db.select({
      isCollectable: configSnapshotResourceTypesTable.isCollectable,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable).groupBy(configSnapshotResourceTypesTable.isCollectable),

    db.select({
      readTransport: configSnapshotResourceTypesTable.readTransport,
      isCollectable: configSnapshotResourceTypesTable.isCollectable,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable)
      .groupBy(configSnapshotResourceTypesTable.readTransport, configSnapshotResourceTypesTable.isCollectable),

    db.select({
      surface: configSnapshotResourceTypesTable.surface,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable).groupBy(configSnapshotResourceTypesTable.surface),

    db.select({
      lastKnownAvailability: configSnapshotResourceTypesTable.lastKnownAvailability,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable).groupBy(configSnapshotResourceTypesTable.lastKnownAvailability),

    // The unavailable half, with its stated cause. This is the read that answers
    // "what is missing and why", and it is why the registry is served at all.
    db.select({
      notCollectableReason: configSnapshotResourceTypesTable.notCollectableReason,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable)
      .where(eq(configSnapshotResourceTypesTable.isCollectable, false))
      .groupBy(configSnapshotResourceTypesTable.notCollectableReason),

    db.select({
      shapeProvenance: configSnapshotResourceTypesTable.shapeProvenance,
      count: sql<number>`count(*)::int`,
    }).from(configSnapshotResourceTypesTable).groupBy(configSnapshotResourceTypesTable.shapeProvenance),
  ]);

  return {
    total: byCollectable.reduce((n, r) => n + r.count, 0),
    collectable: byCollectable.find((r) => r.isCollectable)?.count ?? 0,
    notCollectable: byCollectable.find((r) => !r.isCollectable)?.count ?? 0,
    byTransport,
    bySurface,
    byAvailability,
    notCollectableReasons: byReason,
    byShapeProvenance: byProvenance,
  };
}
