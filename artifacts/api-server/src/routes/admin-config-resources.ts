/**
 * admin-config-resources.ts — the READ surface over the tenant configuration
 * RESOURCE MODEL (#1794).
 *
 * The model answers, as queryable data rather than prose, what a tenant
 * configuration resource IS: its properties and their types, the transport that
 * reads it (a Graph path or a cmdlet), and the permission that read requires —
 * reconciled against the scopes a tenant has actually granted. It is the schema
 * input for the configuration snapshot store (#1795), and it is the measured
 * answer to "are we missing checks": every `monitor_checks` row is mapped onto a
 * resource, so uncovered resources are counted rather than guessed at.
 *
 *   GET /api/admin/config-resources
 *     Filterable list with a roll-up: surface, workload, transport, availability,
 *     verification status, and check coverage.
 *   GET /api/admin/config-resources/summary
 *     Just the roll-up plus the coverage measurement and the latest extraction's
 *     provenance — what the admin overview needs without pulling 1,500 rows.
 *   GET /api/admin/config-resources/:id
 *     One resource with its full property model, the checks mapped onto it, and
 *     every live sample recorded against it.
 *
 * requireAdmin: this is a PlatformAdmin/operator view of the platform's own
 * capability model — it is not customer data and is not customer-scoped, the same
 * gate the sibling admin-drift read route sits behind.
 *
 * READ-ONLY. Rows here are written only by the extraction pipeline
 * (scripts/config-state/); nothing in this file mutates the model.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  configResourcesTable,
  configResourcePropertiesTable,
  configResourceCheckCoverageTable,
  configResourceSamplesTable,
  configModelExtractionsTable,
  tenantServiceAvailabilityTable,
  tenantsTable,
  CONFIG_SURFACES,
  CONFIG_READ_TRANSPORTS,
  CONFIG_AVAILABILITY,
  CONFIG_VERIFICATION_STATUS,
  CONFIG_COVERAGE_STATES,
  EXECUTOR_BACKED_TRANSPORTS,
  coverageStateFor,
  TENANT_SERVICE_KEYS,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * The transports this platform has an executor for, as a SQL `in (...)` list.
 * Built from EXECUTOR_BACKED_TRANSPORTS (which is itself derived from
 * MONITOR_CHECK_EXECUTOR_TYPES) so the measurement follows the monitor catalog
 * automatically — adding a sixth executor moves these numbers with no edit here.
 */
const EXECUTOR_BACKED_SQL = sql`(${sql.join(
  EXECUTOR_BACKED_TRANSPORTS.map((t) => sql`${t}`),
  sql`, `,
)})`;

/**
 * Git #2821 — a row resolved onto another row is not an independent resource, so it must
 * not appear in ANY coverage bucket: two extraction pipelines describe some of the same
 * real tenant objects, and counting both halves reports one object as two (and, before the
 * link existed, as one covered resource and one permanently un-closable gap).
 */
const NOT_DUPLICATE_SQL = sql`${configResourcesTable.canonicalResourceId} is null`;

/**
 * The rows a coverage question applies to at all: real configuration state (not a bound
 * Function), on a transport this platform can execute, whose own scope is reachable, and
 * that is its own canonical record.
 */
const COVERAGE_ELIGIBLE_SQL = sql`${configResourcesTable.graphContainerKind} is distinct from 'function' and ${NOT_DUPLICATE_SQL} and ${configResourcesTable.readTransport} in ${EXECUTOR_BACKED_SQL} and ${configResourcesTable.availability} != 'unavailable'`;

/**
 * Git #1847 — the per-tenant SERVICE-availability half of the model, and the number
 * that measures the contradiction between the two halves.
 *
 * `config_resources.availability` is a PERMISSION fact. On the tenant the model was
 * reconciled against, 189 `/deviceManagement*` rows read `available_now` while Intune
 * itself answers nothing. Both statements are true, and the model was only carrying
 * the first — so it claimed availability that live evidence contradicts.
 *
 * This resolves the model's own reconciliation tenant (never an arbitrary one), reads
 * its recorded service states, and counts the resources whose permission-availability
 * is contradicted by their service's state. When nothing has been observed the
 * counts are simply absent rather than assumed to be zero.
 */
async function loadServiceAvailability(reconciledAgainstTenantId: number | null) {
  if (reconciledAgainstTenantId == null) {
    return { tenantId: null, reconciledAgainstTenantId: null, services: [], contradictedByService: {} as Record<string, number> };
  }

  const [tenant] = await db
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, reconciledAgainstTenantId))
    .limit(1);

  const graphTenantId = tenant?.tenantId ?? null;
  if (!graphTenantId) {
    return { tenantId: null, reconciledAgainstTenantId, services: [], contradictedByService: {} as Record<string, number> };
  }

  const states = await db
    .select()
    .from(tenantServiceAvailabilityTable)
    .where(eq(tenantServiceAvailabilityTable.tenantId, graphTenantId));

  const contradictedByService: Record<string, number> = {};
  for (const s of states) {
    if (s.state === "available" || s.state === "unknown") continue;
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(configResourcesTable)
      .where(
        and(
          eq(configResourcesTable.serviceKey, s.serviceKey),
          eq(configResourcesTable.availability, "available_now"),
        ),
      );
    contradictedByService[s.serviceKey] = row?.n ?? 0;
  }

  return {
    tenantId: graphTenantId,
    reconciledAgainstTenantId,
    services: states.map((s) => ({
      serviceKey: s.serviceKey,
      state: s.state,
      evidenceBasis: s.evidenceBasis,
      reason: s.reason,
      detectionSignature: s.detectionSignature,
      observedEndpoint: s.observedEndpoint,
      observedHttpStatus: s.observedHttpStatus,
      evidence: s.evidence,
      detectedByCheckKey: s.detectedByCheckKey,
      firstObservedAt: s.firstObservedAt instanceof Date ? s.firstObservedAt.toISOString() : s.firstObservedAt,
      lastObservedAt: s.lastObservedAt instanceof Date ? s.lastObservedAt.toISOString() : s.lastObservedAt,
    })),
    /**
     * Per service: how many resources the model still classifies `available_now` on
     * permissions while that service does not answer for this tenant. This is the
     * measurement, not an assertion — the permission verdict stays as it is, because
     * it is separately true.
     */
    contradictedByService,
  };
}

/** Shared roll-up so the list and the summary endpoints cannot drift apart. */
async function loadSummary() {
  const [bySurface, byTransport, byAvailability, byVerification, coverage, extraction] = await Promise.all([
    db.select({ key: configResourcesTable.surface, n: sql<number>`count(*)::int` })
      .from(configResourcesTable).groupBy(configResourcesTable.surface),
    db.select({ key: configResourcesTable.readTransport, n: sql<number>`count(*)::int` })
      .from(configResourcesTable).groupBy(configResourcesTable.readTransport),
    db.select({ key: configResourcesTable.availability, n: sql<number>`count(*)::int` })
      .from(configResourcesTable).groupBy(configResourcesTable.availability),
    db.select({ key: configResourcesTable.verificationStatus, n: sql<number>`count(*)::int` })
      .from(configResourcesTable).groupBy(configResourcesTable.verificationStatus),
    db.select({
      totalResources: sql<number>`count(*)::int`,
      // Five states, not two (#1849 point 3, built in #1869; `unavailable`
      // added in #1917; `operation` added in #1929). `operation` (bound Graph
      // Functions — an operation, not config state) is excluded from every
      // other bucket below: it is not a coverage gap of any kind, so folding
      // it into `uncovered`/`unavailable`/`noExecutor` would misreport it the
      // same way #1849 asked to stop conflating "no check yet" with "no
      // executor". `no_executor` is evaluated next and wins: a resource whose
      // transport this platform has no executor for is UNREACHABLE by any
      // code path. `unavailable` wins next: a resource on an executor-backed
      // transport whose own scope this platform's principal can never be
      // granted (billing-account, tenant-root microsoft.aadiam) is just as
      // unreachable, even though its transport IS executor-backed — reporting
      // either as ordinary "uncovered" is the exact conflation #1849 asked to
      // end, restated for #1917.
      operations: sql<number>`count(*) filter (where ${configResourcesTable.graphContainerKind} = 'function')::int`,
      // Git #2821 — `duplicates` is evaluated right after `operations` and before every
      // reachability bucket, matching `coverageStateFor`'s precedence: a row that is
      // another row's object seen through the second extraction pipeline has no coverage
      // question of its own, whatever its transport or scope says.
      duplicates: sql<number>`count(*) filter (where ${configResourcesTable.graphContainerKind} is distinct from 'function' and ${configResourcesTable.canonicalResourceId} is not null)::int`,
      // Coverage reads `effective_check_coverage_count` — the canonical GROUP's count —
      // not the per-row one, so a canonical resource whose duplicate half a check happened
      // to be credited to still reads as covered (#2821).
      covered: sql<number>`count(*) filter (where ${COVERAGE_ELIGIBLE_SQL} and ${configResourcesTable.effectiveCheckCoverageCount} > 0)::int`,
      uncovered: sql<number>`count(*) filter (where ${COVERAGE_ELIGIBLE_SQL} and ${configResourcesTable.effectiveCheckCoverageCount} = 0)::int`,
      noExecutor: sql<number>`count(*) filter (where ${configResourcesTable.graphContainerKind} is distinct from 'function' and ${NOT_DUPLICATE_SQL} and ${configResourcesTable.readTransport} not in ${EXECUTOR_BACKED_SQL})::int`,
      unavailable: sql<number>`count(*) filter (where ${configResourcesTable.graphContainerKind} is distinct from 'function' and ${NOT_DUPLICATE_SQL} and ${configResourcesTable.readTransport} in ${EXECUTOR_BACKED_SQL} and ${configResourcesTable.availability} = 'unavailable')::int`,
      // Git #1929 — the property-count roll-up excludes bound-Function rows:
      // 44 of them carry zero property rows at all (an operation has no
      // property SHAPE to model), so folding them in quietly averaged the
      // per-resource property count over rows that describe nothing.
      totalProperties: sql<number>`coalesce(sum(${configResourcesTable.propertyCount}) filter (where ${configResourcesTable.graphContainerKind} is distinct from 'function'), 0)::int`,
      operationProperties: sql<number>`coalesce(sum(${configResourcesTable.propertyCount}) filter (where ${configResourcesTable.graphContainerKind} = 'function'), 0)::int`,
    }).from(configResourcesTable),
    db.select().from(configModelExtractionsTable)
      .orderBy(desc(configModelExtractionsTable.startedAt)).limit(1),
  ]);

  const tally = (rows: Array<{ key: string | null; n: number }>) =>
    Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key as string, r.n]));

  const latest = extraction[0] ?? null;
  const c = coverage[0] ?? {
    totalResources: 0,
    operations: 0,
    duplicates: 0,
    covered: 0,
    uncovered: 0,
    noExecutor: 0,
    unavailable: 0,
    totalProperties: 0,
    operationProperties: 0,
  };
  const serviceAvailability = await loadServiceAvailability(latest?.reconciledAgainstTenantId ?? null);

  return {
    serviceAvailability,
    totals: {
      // Raw model size, including bound-Function rows — they stay real,
      // discoverable rows in `config_resources` (#1929).
      resources: c.totalResources,
      properties: c.totalProperties,
      /**
       * Bound Graph Functions (`graph_container_kind = 'function'`) — an
       * operation, not persistent config state. Kept in the model as
       * reachable read endpoints, but excluded from every count below:
       * `resourcesCoverageEligible`, coverage percentages and
       * `properties` (#1929). `operationProperties` is the property total
       * those excluded rows carry, reported separately rather than silently
       * dropped.
       */
      resourcesOperations: c.operations,
      operationProperties: c.operationProperties,
      /**
       * Rows that are not independent resources at all: the same real tenant
       * object as another row, seen through the second extraction pipeline and
       * resolved onto it via `canonicalResourceId` (#2821). Excluded from every
       * coverage bucket and from the denominator, because counting a duplicate
       * separately reported one object as two — and, before the link existed,
       * as one covered resource plus one gap no check could ever close.
       */
      resourcesDuplicates: c.duplicates,
      /**
       * The honest coverage denominator: total resources minus operations
       * (#1929) minus duplicate rows (#2821).
       */
      resourcesCoverageEligible: c.totalResources - c.operations - c.duplicates,
      // The coverage measurement this issue exists to replace a guess with.
      resourcesCoveredByAtLeastOneCheck: c.covered,
      // NOTE: as of #1869 this counts only resources on a transport that HAS an
      // executor — i.e. gaps a check author could actually close. Resources on a
      // transport with no executor are counted separately below, not folded in
      // here, so the two are never conflated again.
      resourcesEntirelyUncovered: c.uncovered,
      /**
       * Resources unreachable by ANY code path because this platform has no
       * executor for their transport (#1849 point 3). Writing a check for one
       * of these would not make it readable — the transport itself is missing.
       */
      resourcesWithNoExecutor: c.noExecutor,
      /**
       * Resources on an executor-backed transport that are still unreachable,
       * because the resource's OWN scope sits above anything this platform's
       * principal can ever be granted — e.g. the 7 `azure-rm` resources #1917
       * found at billing-account / tenant-root `microsoft.aadiam` scope, above
       * anything Azure Lighthouse can delegate. Distinct from `resourcesWithNoExecutor`:
       * the transport itself IS executor-backed here; it is this specific
       * resource that is out of reach.
       */
      resourcesUnavailable: c.unavailable,
      // NOTE: resourcesOperations (#1929) is deliberately not folded into
      // resourcesUnavailable — an operation isn't unreachable, it simply
      // isn't config state, a different fact.
      /** Which transports those resources are on, so the number is actionable rather than just alarming. */
      transportsWithNoExecutor: (CONFIG_READ_TRANSPORTS as readonly string[]).filter(
        (t) => !(EXECUTOR_BACKED_TRANSPORTS as readonly string[]).includes(t),
      ),
      checksMapped: latest?.checksMapped ?? 0,
      checksUnmatched: latest?.checksUnmatched ?? 0,
    },
    bySurface: tally(bySurface),
    byTransport: tally(byTransport),
    byAvailability: tally(byAvailability),
    byVerificationStatus: tally(byVerification),
    extraction: latest
      ? {
          runId: latest.runId,
          m365dscCommit: latest.m365dscCommit,
          m365dscResourceCount: latest.m365dscResourceCount,
          graphV1TypeCount: latest.graphV1TypeCount,
          graphBetaTypeCount: latest.graphBetaTypeCount,
          graphConfigPathCount: latest.graphConfigPathCount,
          graphPermissionCount: latest.graphPermissionCount,
          reconciledAgainstTenantId: latest.reconciledAgainstTenantId,
          grantedScopes: latest.grantedScopes,
          status: latest.status,
          startedAt: latest.startedAt instanceof Date ? latest.startedAt.toISOString() : latest.startedAt,
          finishedAt: latest.finishedAt instanceof Date ? latest.finishedAt.toISOString() : (latest.finishedAt ?? null),
        }
      : null,
  };
}

// GET /api/admin/config-resources/summary
router.get("/admin/config-resources/summary", requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await loadSummary());
  } catch (err: unknown) {
    log.error({ err }, "GET /api/admin/config-resources/summary failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
  }
});

// GET /api/admin/config-resources
router.get("/admin/config-resources", requireAdmin, async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, unknown>;
    const conditions: SQL[] = [];

    const surface = String(q["surface"] ?? "").trim();
    if (surface && (CONFIG_SURFACES as readonly string[]).includes(surface)) {
      conditions.push(eq(configResourcesTable.surface, surface as (typeof CONFIG_SURFACES)[number]));
    }

    const transport = String(q["transport"] ?? "").trim();
    if (transport && (CONFIG_READ_TRANSPORTS as readonly string[]).includes(transport)) {
      conditions.push(eq(configResourcesTable.readTransport, transport as (typeof CONFIG_READ_TRANSPORTS)[number]));
    }

    const availability = String(q["availability"] ?? "").trim();
    if (availability && (CONFIG_AVAILABILITY as readonly string[]).includes(availability)) {
      conditions.push(eq(configResourcesTable.availability, availability as (typeof CONFIG_AVAILABILITY)[number]));
    }

    const verification = String(q["verificationStatus"] ?? "").trim();
    if (verification && (CONFIG_VERIFICATION_STATUS as readonly string[]).includes(verification)) {
      conditions.push(eq(configResourcesTable.verificationStatus, verification as (typeof CONFIG_VERIFICATION_STATUS)[number]));
    }

    const workload = String(q["workload"] ?? "").trim();
    if (workload) conditions.push(eq(configResourcesTable.workload, workload));

    // #1847 — filter by the Microsoft service a resource actually needs stood up, so
    // "everything blocked by Intune not being configured" is one query rather than a
    // guess from `workload` (which labels 226 of the 261 Intune paths MicrosoftGraph).
    const serviceKey = String(q["serviceKey"] ?? "").trim();
    if (serviceKey && (TENANT_SERVICE_KEYS as readonly string[]).includes(serviceKey)) {
      conditions.push(eq(configResourcesTable.serviceKey, serviceKey as (typeof TENANT_SERVICE_KEYS)[number]));
    }

    // coverage=covered | uncovered | no_executor | unavailable | operation |
    // duplicate — the six states of the measurement (#1849 point 3, built in
    // #1869; `unavailable` added in #1917; `operation` added in #1929;
    // `duplicate` added in #2821). `uncovered` excludes resources whose
    // transport has no executor, whose own scope is out of reach on an
    // executor-backed transport, bound-Function rows (an operation, not config
    // state), AND rows resolved onto another row as the same real object: each
    // is a separate, separately-filterable state, not an ordinary
    // check-authoring gap. The branch order mirrors `coverageStateFor`'s
    // precedence exactly, so a filter always returns the rows that render with
    // that badge.
    const coverage = String(q["coverage"] ?? "").trim();
    if ((CONFIG_COVERAGE_STATES as readonly string[]).includes(coverage)) {
      if (coverage === "operation") {
        conditions.push(sql`${configResourcesTable.graphContainerKind} = 'function'`);
      } else if (coverage === "duplicate") {
        conditions.push(sql`${configResourcesTable.graphContainerKind} is distinct from 'function' and ${configResourcesTable.canonicalResourceId} is not null`);
      } else if (coverage === "covered") {
        conditions.push(sql`${COVERAGE_ELIGIBLE_SQL} and ${configResourcesTable.effectiveCheckCoverageCount} > 0`);
      } else if (coverage === "uncovered") {
        conditions.push(sql`${COVERAGE_ELIGIBLE_SQL} and ${configResourcesTable.effectiveCheckCoverageCount} = 0`);
      } else if (coverage === "unavailable") {
        conditions.push(sql`${configResourcesTable.graphContainerKind} is distinct from 'function' and ${NOT_DUPLICATE_SQL} and ${configResourcesTable.readTransport} in ${EXECUTOR_BACKED_SQL} and ${configResourcesTable.availability} = 'unavailable'`);
      } else {
        conditions.push(sql`${configResourcesTable.graphContainerKind} is distinct from 'function' and ${NOT_DUPLICATE_SQL} and ${configResourcesTable.readTransport} not in ${EXECUTOR_BACKED_SQL}`);
      }
    }

    const search = String(q["q"] ?? "").trim();
    if (search) {
      const like = `%${search}%`;
      const term = or(
        ilike(configResourcesTable.displayName, like),
        ilike(configResourcesTable.resourceKey, like),
        ilike(configResourcesTable.graphPath, like),
        ilike(configResourcesTable.m365dscResource, like),
      );
      if (term) conditions.push(term);
    }

    const limit = q["limit"]
      ? Math.min(MAX_LIMIT, Math.max(1, parseInt(String(q["limit"]), 10) || DEFAULT_LIMIT))
      : DEFAULT_LIMIT;
    const offset = Math.max(0, parseInt(String(q["offset"] ?? "0"), 10) || 0);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db.select().from(configResourcesTable).where(where)
        .orderBy(desc(configResourcesTable.checkCoverageCount), asc(configResourcesTable.resourceKey))
        .limit(limit).offset(offset),
      db.select({ n: sql<number>`count(*)::int` }).from(configResourcesTable).where(where),
    ]);

    res.json({
      total: totalRow[0]?.n ?? 0,
      limit,
      offset,
      resources: rows.map((r) => ({
        id: r.id,
        resourceKey: r.resourceKey,
        displayName: r.displayName,
        description: r.description,
        surface: r.surface,
        workload: r.workload,
        origin: r.origin,
        readTransport: r.readTransport,
        graphVersion: r.graphVersion,
        graphPath: r.graphPath,
        graphIsCollection: r.graphIsCollection,
        graphContainerKind: r.graphContainerKind,
        graphEntityType: r.graphEntityType,
        alsoInBeta: r.alsoInBeta,
        readCmdlets: r.readCmdlets,
        m365dscResource: r.m365dscResource,
        m365dscMode: r.m365dscMode,
        linkBasis: r.linkBasis,
        requiredAppPermissions: r.requiredAppPermissions,
        graphReadPermissionOptions: r.graphReadPermissionOptions,
        permissionSource: r.permissionSource,
        permissionPathMatched: r.permissionPathMatched,
        requiredRoles: r.requiredRoles,
        /** #1847 — which Microsoft service must be stood up for this to answer. */
        serviceKey: r.serviceKey,
        availability: r.availability,
        availabilityReason: r.availabilityReason,
        missingPermissions: r.missingPermissions,
        verificationStatus: r.verificationStatus,
        propertyCount: r.propertyCount,
        /** Checks credited to THIS row. See `effectiveCheckCoverageCount` for the real answer. */
        checkCoverageCount: r.checkCoverageCount,
        // ── Canonical-record resolution (#2821) ──────────────────────────────
        /** Non-null when this row duplicates another; that row is the real resource. */
        canonicalResourceId: r.canonicalResourceId,
        canonicalBasis: r.canonicalBasis,
        /** The exact string the resolution matched on — evidence, not assertion. */
        canonicalMatchedOn: r.canonicalMatchedOn,
        /** Why a Graph-backed Microsoft365DSC row could NOT be resolved, when it could not. */
        canonicalGapReason: r.canonicalGapReason,
        /**
         * Coverage of this row's whole canonical group. This is the number that
         * answers "is this covered": a duplicate row's own `checkCoverageCount`
         * is structurally 0 no matter how correct a check is, because a check is
         * credited to exactly one resource id (#2821).
         */
        effectiveCheckCoverageCount: r.effectiveCheckCoverageCount,
        /**
         * covered | uncovered | no_executor | unavailable | operation |
         * duplicate (#1849 point 3, built in #1869; `unavailable` added in
         * #1917 for resources whose transport has an executor but whose own
         * scope — e.g. billing-account or tenant-root `microsoft.aadiam` —
         * sits above anything this platform's principal can ever be granted;
         * `operation` added in #1929 for bound Graph Functions; `duplicate`
         * added in #2821 for rows that are another row's object seen through
         * the second extraction pipeline). Computed rather than stored: it is
         * a function of the row's transport, its own availability, its
         * container kind, its canonical link, and the executors that exist
         * right now, so it cannot go stale the way a persisted copy would
         * when a new executor ships.
         */
        coverageState: coverageStateFor(
          r.readTransport, r.effectiveCheckCoverageCount, r.availability,
          r.graphContainerKind, r.canonicalResourceId),
        sourceRef: r.sourceRef,
        notes: r.notes,
      })),
    });
  } catch (err: unknown) {
    log.error({ err }, "GET /api/admin/config-resources failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
  }
});

// GET /api/admin/config-resources/:id
router.get("/admin/config-resources/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params["id"]), 10);
    if (Number.isNaN(id)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "id must be an integer");
      return;
    }

    const [resource] = await db.select().from(configResourcesTable)
      .where(eq(configResourcesTable.id, id)).limit(1);
    if (!resource) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, `config resource ${id} not found`);
      return;
    }

    /**
     * Git #2821 — the canonical GROUP this row belongs to: the row that is the real
     * resource, plus every row resolved onto it. Checks are read across the whole group,
     * because a check credited to the canonical row is exactly what covers a duplicate,
     * and showing an empty check list on a duplicate is the misreading this issue exists
     * to end. The group is at most a handful of rows, so it is one small extra query.
     */
    const canonicalId = resource.canonicalResourceId ?? resource.id;
    const groupRows = await db.select({
      id: configResourcesTable.id,
      resourceKey: configResourcesTable.resourceKey,
      displayName: configResourcesTable.displayName,
      origin: configResourcesTable.origin,
      surface: configResourcesTable.surface,
      graphPath: configResourcesTable.graphPath,
      canonicalResourceId: configResourcesTable.canonicalResourceId,
      canonicalBasis: configResourcesTable.canonicalBasis,
      canonicalMatchedOn: configResourcesTable.canonicalMatchedOn,
      checkCoverageCount: configResourcesTable.checkCoverageCount,
    }).from(configResourcesTable).where(or(
      eq(configResourcesTable.id, canonicalId),
      eq(configResourcesTable.canonicalResourceId, canonicalId),
    ));
    const groupIds = groupRows.map((g) => g.id);

    const [properties, checks, samples] = await Promise.all([
      db.select().from(configResourcePropertiesTable)
        .where(eq(configResourcePropertiesTable.configResourceId, id))
        .orderBy(asc(configResourcePropertiesTable.source), asc(configResourcePropertiesTable.ordinal)),
      db.select().from(configResourceCheckCoverageTable)
        .where(inArray(configResourceCheckCoverageTable.configResourceId, groupIds))
        .orderBy(asc(configResourceCheckCoverageTable.checkKey)),
      db.select().from(configResourceSamplesTable)
        .where(eq(configResourceSamplesTable.configResourceId, id))
        .orderBy(desc(configResourceSamplesTable.observedAt)).limit(10),
    ]);

    res.json({
      resource: {
        ...resource,
        // Same computed coverage the list endpoint returns, so the detail
        // view cannot disagree with the row the operator clicked (#1869, #1917, #1929, #2821).
        coverageState: coverageStateFor(
          resource.readTransport, resource.effectiveCheckCoverageCount, resource.availability,
          resource.graphContainerKind, resource.canonicalResourceId),
        createdAt: resource.createdAt instanceof Date ? resource.createdAt.toISOString() : resource.createdAt,
        updatedAt: resource.updatedAt instanceof Date ? resource.updatedAt.toISOString() : resource.updatedAt,
      },
      /**
       * Git #2821 — when this row is a duplicate, the real resource it resolves to; null
       * when this row IS the canonical record.
       */
      canonical: resource.canonicalResourceId
        ? groupRows.find((g) => g.id === canonicalId) ?? null
        : null,
      /** The rows that resolve onto THIS one, when it is the canonical record. */
      duplicates: groupRows.filter((g) => g.id !== canonicalId),
      properties: properties.map((p) => ({
        name: p.name,
        source: p.source,
        dataType: p.dataType,
        isCollection: p.isCollection,
        isKey: p.isKey,
        isRequired: p.isRequired,
        isNullable: p.isNullable,
        allowedValues: p.allowedValues,
        nestedTypeRef: p.nestedTypeRef,
        isConnectionParameter: p.isConnectionParameter,
        description: p.description,
        ordinal: p.ordinal,
      })),
      checks: checks.map((c) => ({
        checkKey: c.checkKey,
        executorType: c.executorType,
        matchBasis: c.matchBasis,
        confidence: c.confidence,
        matchedOn: c.matchedOn,
      })),
      samples: samples.map((s) => ({
        sampleRunId: s.sampleRunId,
        tenantId: s.tenantId,
        graphVersion: s.graphVersion,
        requestPath: s.requestPath,
        httpStatus: s.httpStatus,
        ok: s.ok,
        errorCode: s.errorCode,
        errorMessage: s.errorMessage,
        itemCount: s.itemCount,
        // Shape only — property names and JSON types. No tenant values are stored.
        observedPropertyNames: s.observedPropertyNames,
        observedShape: s.observedShape,
        durationMs: s.durationMs,
        skippedReason: s.skippedReason,
        observedAt: s.observedAt instanceof Date ? s.observedAt.toISOString() : s.observedAt,
      })),
    });
  } catch (err: unknown) {
    log.error({ err }, "GET /api/admin/config-resources/:id failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
  }
});

export default router;
