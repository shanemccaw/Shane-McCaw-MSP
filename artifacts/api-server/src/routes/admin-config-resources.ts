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
  CONFIG_SURFACES,
  CONFIG_READ_TRANSPORTS,
  CONFIG_AVAILABILITY,
  CONFIG_VERIFICATION_STATUS,
} from "@workspace/db";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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
      covered: sql<number>`count(*) filter (where ${configResourcesTable.checkCoverageCount} > 0)::int`,
      uncovered: sql<number>`count(*) filter (where ${configResourcesTable.checkCoverageCount} = 0)::int`,
      totalProperties: sql<number>`coalesce(sum(${configResourcesTable.propertyCount}), 0)::int`,
    }).from(configResourcesTable),
    db.select().from(configModelExtractionsTable)
      .orderBy(desc(configModelExtractionsTable.startedAt)).limit(1),
  ]);

  const tally = (rows: Array<{ key: string | null; n: number }>) =>
    Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key as string, r.n]));

  const latest = extraction[0] ?? null;
  const c = coverage[0] ?? { totalResources: 0, covered: 0, uncovered: 0, totalProperties: 0 };

  return {
    totals: {
      resources: c.totalResources,
      properties: c.totalProperties,
      // The coverage measurement this issue exists to replace a guess with.
      resourcesCoveredByAtLeastOneCheck: c.covered,
      resourcesEntirelyUncovered: c.uncovered,
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

    // coverage=covered | uncovered — the two halves of the measurement.
    const coverage = String(q["coverage"] ?? "").trim();
    if (coverage === "covered") conditions.push(sql`${configResourcesTable.checkCoverageCount} > 0`);
    if (coverage === "uncovered") conditions.push(sql`${configResourcesTable.checkCoverageCount} = 0`);

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
        availability: r.availability,
        availabilityReason: r.availabilityReason,
        missingPermissions: r.missingPermissions,
        verificationStatus: r.verificationStatus,
        propertyCount: r.propertyCount,
        checkCoverageCount: r.checkCoverageCount,
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

    const [properties, checks, samples] = await Promise.all([
      db.select().from(configResourcePropertiesTable)
        .where(eq(configResourcePropertiesTable.configResourceId, id))
        .orderBy(asc(configResourcePropertiesTable.source), asc(configResourcePropertiesTable.ordinal)),
      db.select().from(configResourceCheckCoverageTable)
        .where(eq(configResourceCheckCoverageTable.configResourceId, id))
        .orderBy(asc(configResourceCheckCoverageTable.checkKey)),
      db.select().from(configResourceSamplesTable)
        .where(eq(configResourceSamplesTable.configResourceId, id))
        .orderBy(desc(configResourceSamplesTable.observedAt)).limit(10),
    ]);

    res.json({
      resource: {
        ...resource,
        createdAt: resource.createdAt instanceof Date ? resource.createdAt.toISOString() : resource.createdAt,
        updatedAt: resource.updatedAt instanceof Date ? resource.updatedAt.toISOString() : resource.updatedAt,
      },
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
