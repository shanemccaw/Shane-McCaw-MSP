/**
 * admin-config-diffs.ts — the surface over the configuration DIFF store (Git #1797).
 *
 * `admin-config-resources.ts` serves the resource MODEL (#1794). This file serves the
 * DIFFERENCE between two snapshots of a tenant's real configuration — the one engine
 * behind drift, baseline assessment, tenant compare and Dev→Test→Prod promotion.
 *
 *   GET  /api/admin/config-diffs
 *     Filterable list of computed diffs with their completeness roll-up.
 *   GET  /api/admin/config-diffs/:diffId
 *     One diff: the header, the per-resource comparability report, and a page of changes.
 *   GET  /api/admin/config-diffs/:diffId/resources
 *     The full comparability report on its own — every resource, whether it could be
 *     compared, and what each side actually said. The completeness evidence.
 *   POST /api/admin/config-diffs
 *     Compute (or return the stored) diff for a snapshot pair and a mode.
 *   GET  /api/admin/config-diffs/rules
 *     The noise ruleset, with each rule's basis and — for a measured one — its evidence.
 *
 * requireAdmin, matching the sibling `admin-config-resources` and `admin-drift` routes:
 * this is a PlatformAdmin/operator view of tenant configuration state.
 *
 * NO APPLY PATH, and none may be added here. `promotion` means COMPUTING the difference
 * between two environments. Applying configuration is the Config Pack write path with its
 * consent gates, break-glass gate and approval steps; #1797 puts joining the two
 * explicitly out of scope. The only write this file performs is computing and storing a
 * diff, which touches no tenant at all.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  configDiffsTable,
  configDiffChangesTable,
  configDiffResourceStatusTable,
  configDiffPropertyRulesTable,
  tenantConfigSnapshotsTable,
  configSnapshotResourceTypesTable,
  CONFIG_DIFF_MODES,
  CONFIG_DIFF_COMPARABILITY,
  CONFIG_DIFF_CHANGE_KINDS,
  type ConfigDiffMode,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { diffSnapshots, SnapshotNotDiffableError } from "../lib/config-snapshot-differ.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const clampLimit = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
};

/** `:diffId` accepts either the uuid or the integer row id, so a log line pastes straight in. */
function diffIdCondition(raw: string): SQL | null {
  if (/^\d+$/.test(raw)) return eq(configDiffsTable.id, Number(raw));
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return eq(configDiffsTable.diffId, raw);
  }
  return null;
}

// ── GET /api/admin/config-diffs ──────────────────────────────────────────────

router.get("/api/admin/config-diffs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const where: SQL[] = [];
    const { mode, tenantId, status } = req.query;

    if (typeof mode === "string") {
      if (!(CONFIG_DIFF_MODES as readonly string[]).includes(mode)) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `mode must be one of: ${CONFIG_DIFF_MODES.join(", ")}`);
      }
      where.push(eq(configDiffsTable.mode, mode as ConfigDiffMode));
    }
    if (typeof tenantId === "string" && /^\d+$/.test(tenantId)) {
      where.push(eq(configDiffsTable.headTenantId, Number(tenantId)));
    }
    if (typeof status === "string") {
      where.push(sql`${configDiffsTable.status} = ${status}`);
    }

    const rows = await db.select().from(configDiffsTable)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(configDiffsTable.createdAt))
      .limit(clampLimit(req.query.limit));

    res.json({
      diffs: rows.map((d) => ({
        diffId: d.diffId,
        diffRowId: d.id,
        mode: d.mode,
        baseSnapshotRowId: d.baseSnapshotRowId,
        headSnapshotRowId: d.headSnapshotRowId,
        baseTenantId: d.baseTenantId,
        headTenantId: d.headTenantId,
        status: d.status,
        // Deliberately surfaced next to the counts: a diff over a pair with
        // uncomparable resources is a real answer about what it COULD compare, and
        // must not be read as a statement about the whole tenant.
        isComplete: d.isComplete,
        resourceTypesCompared: d.resourceTypesCompared,
        resourceTypesPartial: d.resourceTypesPartial,
        resourceTypesNotComparable: d.resourceTypesNotComparable,
        changesTotal: d.changesTotal,
        changesSignificant: d.changesSignificant,
        changesIgnored: d.changesIgnored,
        objectsPaired: d.objectsPaired,
        objectsAdded: d.objectsAdded,
        objectsRemoved: d.objectsRemoved,
        objectsIndeterminate: d.objectsIndeterminate,
        objectsUnpairable: d.objectsUnpairable,
        differVersion: d.differVersion,
        rulesetFingerprint: d.rulesetFingerprint,
        durationMs: d.durationMs,
        createdAt: d.createdAt,
        sealedAt: d.sealedAt,
        notes: d.notes,
        error: d.error,
      })),
    });
  } catch (err) {
    log.error({ err }, "config-diffs: list failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list configuration diffs");
  }
});

// ── GET /api/admin/config-diffs/rules ────────────────────────────────────────
// Registered BEFORE `/:diffId` so the literal path is not swallowed by the param route.

router.get("/api/admin/config-diffs/rules", requireAdmin, async (req: Request, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const rows = await db.select().from(configDiffPropertyRulesTable)
      .where(includeInactive ? undefined : eq(configDiffPropertyRulesTable.isActive, true))
      .orderBy(desc(configDiffPropertyRulesTable.specificity),
        asc(configDiffPropertyRulesTable.resourceKey));

    res.json({
      rules: rows.map((r) => ({
        id: r.id,
        resourceKey: r.resourceKey,
        propertyPathPattern: r.propertyPathPattern,
        action: r.action,
        basis: r.basis,
        specificity: r.specificity,
        rationale: r.rationale,
        isActive: r.isActive,
        // The measurement behind an `observed_volatile` rule. A suppression whose
        // grounds are not readable is indistinguishable from hiding a real finding,
        // so the evidence travels with the rule.
        evidence: r.basis === "observed_volatile" ? {
          diffRowId: r.evidenceDiffId,
          objectCount: r.evidenceObjectCount,
          observedAt: r.evidenceObservedAt,
        } : null,
        declaredByUserId: r.declaredByUserId,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    log.error({ err }, "config-diffs: rules read failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the diff noise ruleset");
  }
});

// ── POST /api/admin/config-diffs ─────────────────────────────────────────────

router.post("/api/admin/config-diffs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { baseSnapshotRowId, headSnapshotRowId, mode, resourceKeys, triggerRef, recompute } =
      req.body ?? {};

    const base = Number(baseSnapshotRowId);
    const head = Number(headSnapshotRowId);
    if (!Number.isInteger(base) || base <= 0 || !Number.isInteger(head) || head <= 0) {
      return apiError(res, 400, ApiErrorCode.VALIDATION,
        "baseSnapshotRowId and headSnapshotRowId are required and must be "
        + "tenant_config_snapshots.id integers");
    }
    if (!(CONFIG_DIFF_MODES as readonly string[]).includes(mode)) {
      return apiError(res, 400, ApiErrorCode.VALIDATION,
        `mode is required and must be one of: ${CONFIG_DIFF_MODES.join(", ")}`);
    }
    if (resourceKeys !== undefined
        && (!Array.isArray(resourceKeys) || resourceKeys.some((k) => typeof k !== "string"))) {
      return apiError(res, 400, ApiErrorCode.VALIDATION,
        "resourceKeys, when supplied, must be an array of resource key strings");
    }

    const result = await diffSnapshots({
      mode: mode as ConfigDiffMode,
      baseSnapshotRowId: base,
      headSnapshotRowId: head,
      resourceKeys: resourceKeys as string[] | undefined,
      trigger: "api",
      triggerRef: typeof triggerRef === "string" ? triggerRef : null,
      requestedByUserId: (req as Request & { user?: { id?: number } }).user?.id ?? null,
      // `recompute: true` REPLACES the stored diff for this pair — see the differ's
      // `useCache` doc for why discarding a derived result is sound.
      useCache: recompute !== true,
    });

    res.json({ diff: result });
  } catch (err) {
    // A refused pair is the caller's mistake, not a server fault, and the message says
    // exactly which invariant it broke — a still-running snapshot, a self-comparison, or
    // a mode/tenant pairing that is a category error.
    if (err instanceof SnapshotNotDiffableError) {
      return apiError(res, 400, ApiErrorCode.VALIDATION, err.message);
    }
    log.error({ err }, "config-diffs: compute failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to compute the configuration diff");
  }
});

// ── GET /api/admin/config-diffs/:diffId/resources ────────────────────────────

router.get("/api/admin/config-diffs/:diffId/resources", requireAdmin, async (req: Request, res: Response) => {
  try {
    const cond = diffIdCondition(String(req.params.diffId));
    if (!cond) {
      return apiError(res, 400, ApiErrorCode.VALIDATION,
        "diffId must be a uuid or an integer row id");
    }
    const [diff] = await db.select().from(configDiffsTable).where(cond).limit(1);
    if (!diff) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration diff not found");

    const where: SQL[] = [eq(configDiffResourceStatusTable.diffRowId, diff.id)];
    const { comparability } = req.query;
    if (typeof comparability === "string") {
      if (!(CONFIG_DIFF_COMPARABILITY as readonly string[]).includes(comparability)) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `comparability must be one of: ${CONFIG_DIFF_COMPARABILITY.join(", ")}`);
      }
      where.push(sql`${configDiffResourceStatusTable.comparability} = ${comparability}`);
    }

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
      .limit(clampLimit(req.query.limit));

    res.json({
      diffId: diff.diffId,
      resources: rows.map((r) => ({
        ...r.status,
        // A resource key with no registry match is a real fact (retired/renamed since
        // collection), labelled rather than hidden — same convention as the snapshot
        // document route.
        displayName: r.displayName ?? r.status.resourceKey,
        surface: r.surface ?? null,
        workload: r.workload ?? "unregistered",
      })),
    });
  } catch (err) {
    log.error({ err }, "config-diffs: resource report failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL,
      "Failed to read the diff's resource comparability report");
  }
});

// ── GET /api/admin/config-diffs/:diffId ──────────────────────────────────────

router.get("/api/admin/config-diffs/:diffId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const cond = diffIdCondition(String(req.params.diffId));
    if (!cond) {
      return apiError(res, 400, ApiErrorCode.VALIDATION,
        "diffId must be a uuid or an integer row id");
    }
    const [diff] = await db.select().from(configDiffsTable).where(cond).limit(1);
    if (!diff) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration diff not found");

    const snapshots = await db.select().from(tenantConfigSnapshotsTable)
      .where(inArray(tenantConfigSnapshotsTable.id, [diff.baseSnapshotRowId, diff.headSnapshotRowId]));

    const where: SQL[] = [eq(configDiffChangesTable.diffRowId, diff.id)];
    // Ignored changes are stored, not dropped, but the DEFAULT view is the significant
    // set — that is the number a human is meant to act on. `includeIgnored=true` shows
    // the rest, so a suppression can always be audited.
    if (req.query.includeIgnored !== "true") {
      where.push(eq(configDiffChangesTable.isIgnored, false));
    }
    if (typeof req.query.resourceKey === "string") {
      where.push(eq(configDiffChangesTable.resourceKey, req.query.resourceKey));
    }
    if (typeof req.query.changeKind === "string") {
      if (!(CONFIG_DIFF_CHANGE_KINDS as readonly string[]).includes(req.query.changeKind)) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `changeKind must be one of: ${CONFIG_DIFF_CHANGE_KINDS.join(", ")}`);
      }
      where.push(sql`${configDiffChangesTable.changeKind} = ${req.query.changeKind}`);
    }

    const limit = clampLimit(req.query.limit);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const changeRows = await db.select({
      change: configDiffChangesTable,
      displayName: configSnapshotResourceTypesTable.displayName,
      workload: configSnapshotResourceTypesTable.workload,
    }).from(configDiffChangesTable)
      .leftJoin(configSnapshotResourceTypesTable,
        eq(configSnapshotResourceTypesTable.resourceKey, configDiffChangesTable.resourceKey))
      .where(and(...where))
      // Stored sequence, always — the total order IS the result (#1797 rule 3), so
      // re-sorting here would discard the property being guaranteed.
      .orderBy(asc(configDiffChangesTable.sequence))
      .limit(limit).offset(offset);

    const changes = changeRows.map((r) => ({
      ...r.change,
      resourceDisplayName: r.displayName ?? r.change.resourceKey,
      workload: r.workload ?? "unregistered",
    }));

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
      .from(configDiffChangesTable).where(and(...where));

    const byKind = await db.select({
      changeKind: configDiffChangesTable.changeKind,
      isIgnored: configDiffChangesTable.isIgnored,
      count: sql<number>`count(*)::int`,
    }).from(configDiffChangesTable)
      .where(eq(configDiffChangesTable.diffRowId, diff.id))
      .groupBy(configDiffChangesTable.changeKind, configDiffChangesTable.isIgnored);

    const byComparability = await db.select({
      comparability: configDiffResourceStatusTable.comparability,
      count: sql<number>`count(*)::int`,
    }).from(configDiffResourceStatusTable)
      .where(eq(configDiffResourceStatusTable.diffRowId, diff.id))
      .groupBy(configDiffResourceStatusTable.comparability);

    res.json({
      diff,
      snapshots: {
        base: snapshots.find((s) => s.id === diff.baseSnapshotRowId) ?? null,
        head: snapshots.find((s) => s.id === diff.headSnapshotRowId) ?? null,
      },
      summary: { byKind, byComparability },
      changes,
      paging: { total, limit, offset },
    });
  } catch (err) {
    log.error({ err }, "config-diffs: detail read failed");
    return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the configuration diff");
  }
});

export default router;
