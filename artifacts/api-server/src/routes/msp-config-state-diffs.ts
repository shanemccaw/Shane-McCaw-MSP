/**
 * msp-config-state-diffs.ts — the MSP OPERATOR comparison surface (Git #1843).
 *
 * `msp-config-state.ts` serves snapshots, collection and the registry. This file
 * serves everything that compares two of them, plus the baseline registry that makes
 * "assess against a baseline" a named operation rather than "diff two row ids you
 * happened to remember".
 *
 *   GET   /api/msp/config-state/diffs
 *     Comparison history across the book.
 *   POST  /api/msp/config-state/diffs
 *     Compute (or fetch) a comparison. One route, FOUR named capabilities — see the
 *     mode table below.
 *   GET   /api/msp/config-state/diffs/rules
 *     The noise ruleset, with the measurement behind every `observed_volatile` rule.
 *   GET   /api/msp/config-state/diffs/:diffId
 *     One comparison: the changes, or (view=resources) the comparability report. Each
 *     change carries its VERDICT (#2759) — which real change request or accepted risk
 *     explains it, or nothing — plus a roll-up of those verdicts for the whole diff.
 *   POST  /api/msp/config-state/diffs/:diffId/attribution
 *     Run or re-run that attribution pass. Reads Change Control and the Risk Register;
 *     writes only its own tables, never a CR, a risk decision or the sealed diff.
 *   GET   /api/msp/config-state/baselines
 *   POST  /api/msp/config-state/baselines
 *   PATCH /api/msp/config-state/baselines/:baselineId
 *     The baseline registry — declare, list and retire.
 *
 * ─── The four modes, and why they are one route ────────────────────────────────
 * #1797 built four entry points over ONE engine — `diffDrift`, `diffAgainstBaseline`,
 * `diffTenants`, `diffPromotion` — so that a caller states WHICH capability it is
 * invoking, which is what a consumer needs in order to interpret the result. This
 * route mirrors that exactly: `mode` is required, it dispatches to the correspondingly
 * named entry point, and there is no comparison logic here at all.
 *
 *   | mode                 | means                                    | entry point          |
 *   |----------------------|------------------------------------------|----------------------|
 *   | drift                | one tenant now, vs its own earlier state | diffDrift            |
 *   | baseline_assessment  | one tenant vs a known-good reference     | diffAgainstBaseline  |
 *   | tenant_compare       | tenant A vs tenant B                     | diffTenants          |
 *   | promotion            | Dev/Test source vs the target it promotes to | diffPromotion    |
 *
 * The differ validates the mode/tenant pairing itself and `config_diffs` carries a
 * CHECK constraint enforcing it, so a `drift` across two tenants is rejected by the
 * database as well as by the engine.
 *
 * ─── Scoping, on BOTH sides ────────────────────────────────────────────────────
 * Every snapshot named in a compute request is loaded through `loadScopedSnapshot`
 * against the caller's book BEFORE the differ is called, and every stored diff is read
 * through `loadScopedDiff`, which requires entitlement to base AND head. A
 * `tenant_compare` diff's `oldValue` column literally contains the base tenant's
 * configuration; head-side entitlement alone would leak it.
 *
 * ─── `resourceKeys` narrowing (Git #2901) ──────────────────────────────────────
 * Git #2032 (a resource-scoped recompute silently overwriting a full-tenant diff,
 * because `resourceKeys` was not part of the differ's cache key) was fixed
 * 2026-09-04 (commit `501c9139e`): `config_diffs` now carries
 * `resource_keys_fingerprint` as part of both the cache key and the unique
 * constraint, so a narrowed request and a full-tenant one land in distinct rows
 * instead of colliding. `POST /diffs` below now accepts `resourceKeys`, same as the
 * sibling `admin-config-diffs.ts` route.
 *
 * ─── No apply path ─────────────────────────────────────────────────────────────
 * `promotion` COMPUTES THE DIFFERENCE ONLY, and nothing here may ever apply it.
 * Applying configuration is the Config Pack write path with its consent gates,
 * break-glass gate and approval steps; joining the two is a separate product
 * decision, recorded as an explicit non-goal on both #1797 and #1843.
 *
 * ─── Path convention, and a live trap ──────────────────────────────────────────
 * `app.ts` mounts the whole route tree at `app.use("/api", router)`, so a path
 * registered here must NOT repeat the `/api` prefix. The sibling
 * `admin-config-snapshots.ts` / `admin-config-diffs.ts` do repeat it and are
 * therefore served at `/api/api/admin/config-*`, unreachable at the path their own
 * admin-panel pages fetch — confirmed live on 2026-08-31 and filed separately. The
 * externally-visible paths in the list above are what a caller uses; the strings
 * below are those paths minus the mount prefix.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  configDiffsTable,
  configDiffPropertyRulesTable,
  configSnapshotBaselinesTable,
  tenantsTable,
  tenantConfigSnapshotsTable,
  CONFIG_BASELINE_PURPOSES,
  CONFIG_DIFF_CHANGE_KINDS,
  CONFIG_DIFF_COMPARABILITY,
  CONFIG_DIFF_MODES,
  type ConfigBaselinePurpose,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { resolveConfigStateBook } from "../lib/msp-config-state-scope.ts";
import {
  CHANGE_PAGE,
  RESOURCE_PAGE,
  SNAPSHOT_LIST_PAGE,
  clampLimit,
  clampOffset,
  diffCompleteness,
  diffSides,
  loadScopedDiff,
  loadScopedSnapshot,
  readDiffChanges,
  readDiffResourceReport,
  snapshotCompleteness,
} from "../lib/config-state-views.ts";
import {
  SnapshotNotDiffableError,
  diffAgainstBaseline,
  diffDrift,
  diffPromotion,
  diffTenants,
  type DiffSnapshotsResult,
} from "../lib/config-snapshot-differ.ts";
import {
  DiffNotAttributableError,
  attributeDiff,
  ensureDiffAttributed,
  readDiffVerdictRollup,
} from "../lib/config-change-attribution.ts";

const log = logger.child({ channel: "tenant.config-state" });

const router: IRouter = Router();

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

function pickEnum(raw: unknown, allowed: readonly string[]): string | undefined | null {
  const v = str(raw);
  if (v === undefined) return undefined;
  return allowed.includes(v) ? v : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does this rejection come from violating a named constraint?
 *
 * Walks the `cause` chain, which is required rather than tidy: Drizzle wraps the
 * driver error in a `_DrizzleQueryError` whose own `message` is only the SQL text and
 * bound parameters — the constraint name lives on the pg error underneath. Matching
 * on the wrapper's message alone silently never matches, which is exactly how the
 * duplicate-name case returned a 500 instead of a 409 on its first live run.
 */
function violatesConstraint(err: unknown, constraint: string): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 6; depth++) {
    const rec = e as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (rec.constraint === constraint) return true;
    if (typeof rec.message === "string" && rec.message.includes(constraint)) return true;
    e = rec.cause;
  }
  return false;
}

// ── GET /api/msp/config-state/diffs ──────────────────────────────────────────

router.get("/msp/config-state/diffs", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      if (book.tenantIds.length === 0) {
        res.json({ diffs: [], paging: { total: 0, limit: 0, offset: 0, hasMore: false } });
        return;
      }

      const mode = pickEnum(req.query.mode, CONFIG_DIFF_MODES);
      if (mode === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `mode must be one of: ${CONFIG_DIFF_MODES.join(", ")}`);
      }

      const ids = [...book.tenantIds];
      // Both sides in the book — the same two-sided rule `loadScopedDiff` applies to a
      // single read, applied to the list so a cross-tenant diff never appears in a
      // book that only contains one of its tenants.
      const where: SQL[] = [
        inArray(configDiffsTable.baseTenantId, ids),
        inArray(configDiffsTable.headTenantId, ids),
      ];
      if (mode) where.push(sql`${configDiffsTable.mode} = ${mode}`);
      if (typeof req.query.tenantId === "string" && /^\d+$/.test(req.query.tenantId)) {
        where.push(eq(configDiffsTable.headTenantId, Number(req.query.tenantId)));
      }

      const limit = clampLimit(req.query.limit, SNAPSHOT_LIST_PAGE);
      const offset = clampOffset(req.query.offset);

      const rows = await db.select().from(configDiffsTable)
        .where(and(...where))
        .orderBy(desc(configDiffsTable.createdAt))
        .limit(limit).offset(offset);

      const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(configDiffsTable).where(and(...where));

      res.json({
        diffs: rows.map((d) => ({
          diffId: d.diffId,
          diffRowId: d.id,
          mode: d.mode,
          baseSnapshotRowId: d.baseSnapshotRowId,
          headSnapshotRowId: d.headSnapshotRowId,
          baseTenantId: d.baseTenantId,
          headTenantId: d.headTenantId,
          trigger: d.trigger,
          triggerRef: d.triggerRef,
          createdAt: d.createdAt,
          sealedAt: d.sealedAt,
          durationMs: d.durationMs,
          completeness: diffCompleteness(d),
        })),
        paging: { total, limit, offset, hasMore: offset + limit < total },
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: diff list failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list configuration comparisons");
    }
  });

// ── GET /api/msp/config-state/diffs/rules ────────────────────────────────────
// Registered BEFORE `/:diffId` so the literal path is not swallowed by the param route.

router.get("/msp/config-state/diffs/rules", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
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
          // The measurement behind an `observed_volatile` rule travels with it: a
          // suppression whose grounds are not readable is indistinguishable from
          // hiding a real finding.
          evidence: r.basis === "observed_volatile"
            ? {
              diffRowId: r.evidenceDiffId,
              objectCount: r.evidenceObjectCount,
              observedAt: r.evidenceObservedAt,
            }
            : null,
          declaredByUserId: r.declaredByUserId,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: rules read failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read the comparison noise ruleset");
    }
  });

// ── POST /api/msp/config-state/diffs ─────────────────────────────────────────

interface ComputeBody {
  mode?: unknown;
  baseSnapshotRowId?: unknown;
  headSnapshotRowId?: unknown;
  baselineId?: unknown;
  recompute?: unknown;
  triggerRef?: unknown;
  resourceKeys?: unknown;
}

router.post("/msp/config-state/diffs", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as ComputeBody;

      const mode = pickEnum(body.mode, CONFIG_DIFF_MODES);
      if (mode === null || mode === undefined) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `mode is required and must be one of: ${CONFIG_DIFF_MODES.join(", ")}. It names `
          + "which capability you are invoking, and the answer is not interpretable without it.");
      }

      const book = await resolveConfigStateBook(req);
      const userId = (req.user as { id?: number } | undefined)?.id ?? null;

      // ── Resolve the BASE side ──────────────────────────────────────────────
      // For a baseline assessment the base may be named by registry id instead of by
      // snapshot row — that is the whole reason the registry exists.
      let baseRowId: number | null = null;
      let baselineName: string | null = null;

      const rawBaselineId = str(body.baselineId);
      if (rawBaselineId !== undefined) {
        if (mode !== "baseline_assessment" && mode !== "promotion") {
          return apiError(res, 400, ApiErrorCode.VALIDATION,
            "baselineId applies only to mode 'baseline_assessment' or 'promotion'");
        }
        if (!UUID_RE.test(rawBaselineId)) {
          return apiError(res, 400, ApiErrorCode.VALIDATION, "baselineId must be a uuid");
        }
        const [baseline] = await db.select().from(configSnapshotBaselinesTable)
          .where(and(
            eq(configSnapshotBaselinesTable.baselineId, rawBaselineId),
            inArray(configSnapshotBaselinesTable.tenantId, [...book.tenantIds, -1]),
          ))
          .limit(1);
        if (!baseline) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Baseline not found");
        if (!baseline.isActive) {
          return apiError(res, 409, ApiErrorCode.CONFLICT,
            `Baseline '${baseline.name}' was retired (${baseline.retiredReason}). Past `
            + "assessments against it remain readable; new ones are not started against a "
            + "retired reference.");
        }
        baseRowId = baseline.snapshotRowId;
        baselineName = baseline.name;
      } else {
        const raw = Number(body.baseSnapshotRowId);
        if (!Number.isSafeInteger(raw) || raw <= 0) {
          return apiError(res, 400, ApiErrorCode.VALIDATION,
            "baseSnapshotRowId is required (or baselineId, for a baseline assessment) and "
            + "must be a tenant_config_snapshots.id integer");
        }
        baseRowId = raw;
      }

      const headRowIdRaw = Number(body.headSnapshotRowId);
      if (!Number.isSafeInteger(headRowIdRaw) || headRowIdRaw <= 0) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "headSnapshotRowId is required and must be a tenant_config_snapshots.id integer");
      }

      // `resourceKeys` narrows the comparison to specific resource types. Safe since
      // Git #2032 (see the doc header): the fingerprint is now part of the cache key,
      // so a narrowed request and a full-tenant one never collide.
      const rawResourceKeys = body.resourceKeys;
      if (rawResourceKeys !== undefined
          && (!Array.isArray(rawResourceKeys)
              || rawResourceKeys.some((k) => typeof k !== "string"))) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "resourceKeys, when supplied, must be an array of resource key strings");
      }
      const resourceKeys = rawResourceKeys as string[] | undefined;

      // ── Entitlement, on both sides, BEFORE the differ is reached ───────────
      const base = await loadScopedSnapshot(String(baseRowId), book.tenantIds);
      const head = await loadScopedSnapshot(String(headRowIdRaw), book.tenantIds);
      if (!base || !head) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND,
          "One or both snapshots were not found in your customer book");
      }

      const shared = {
        trigger: "api" as const,
        triggerRef: str(body.triggerRef)
          ?? `msp:config-state:${mode}${baselineName ? `:baseline=${baselineName}` : ""}`,
        requestedByUserId: userId,
        // `recompute: true` REPLACES the stored diff for this pair. Sound because a
        // diff is DERIVED from two immutable snapshots under a recorded ruleset — see
        // the differ's `useCache` doc.
        useCache: body.recompute !== true,
        resourceKeys,
      };

      let result: DiffSnapshotsResult;
      switch (mode) {
        case "drift":
          result = await diffDrift({
            baselineSnapshotRowId: base.id, currentSnapshotRowId: head.id, ...shared,
          });
          break;
        case "baseline_assessment":
          result = await diffAgainstBaseline({
            knownGoodSnapshotRowId: base.id, currentSnapshotRowId: head.id, ...shared,
          });
          break;
        case "tenant_compare":
          result = await diffTenants({
            tenantASnapshotRowId: base.id, tenantBSnapshotRowId: head.id, ...shared,
          });
          break;
        case "promotion":
          result = await diffPromotion({
            sourceSnapshotRowId: base.id, targetSnapshotRowId: head.id, ...shared,
          });
          break;
        default:
          return apiError(res, 400, ApiErrorCode.VALIDATION, `Unsupported mode: ${mode}`);
      }

      log.info({ mode, baseRowId: base.id, headRowId: head.id, diffRowId: result.diffRowId, userId },
        "msp-config-state: comparison computed");

      res.json({
        diff: result,
        baseline: baselineName,
        base: {
          id: base.id, snapshotId: base.snapshotId, tenantId: base.tenantId,
          capturedAt: base.capturedAt, completeness: snapshotCompleteness(base),
        },
        head: {
          id: head.id, snapshotId: head.snapshotId, tenantId: head.tenantId,
          capturedAt: head.capturedAt, completeness: snapshotCompleteness(head),
        },
      });
    } catch (err) {
      if (err instanceof SnapshotNotDiffableError) {
        // A refused pair is the caller's mistake, and the message names exactly which
        // invariant it broke — a still-running snapshot, a self-comparison, or a
        // mode/tenant pairing that is a category error.
        return apiError(res, 400, ApiErrorCode.VALIDATION, err.message);
      }
      log.error({ err }, "msp-config-state: comparison compute failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to compute the configuration comparison");
    }
  });

// ── GET /api/msp/config-state/diffs/:diffId ──────────────────────────────────

router.get("/msp/config-state/diffs/:diffId", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      const diff = await loadScopedDiff(String(req.params.diffId), book.tenantIds);
      if (!diff) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration comparison not found");

      const view = str(req.query.view) ?? "changes";
      if (view !== "changes" && view !== "resources") {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "view must be 'changes' or 'resources'");
      }

      const sides = await diffSides(diff);
      const shared = {
        diffId: diff.diffId,
        diffRowId: diff.id,
        mode: diff.mode,
        trigger: diff.trigger,
        triggerRef: diff.triggerRef,
        completeness: diffCompleteness(diff),
        snapshots: {
          base: sides.base
            ? {
              id: sides.base.id, snapshotId: sides.base.snapshotId,
              tenantId: sides.base.tenantId, capturedAt: sides.base.capturedAt,
              completeness: snapshotCompleteness(sides.base),
            }
            : null,
          head: sides.head
            ? {
              id: sides.head.id, snapshotId: sides.head.snapshotId,
              tenantId: sides.head.tenantId, capturedAt: sides.head.capturedAt,
              completeness: snapshotCompleteness(sides.head),
            }
            : null,
        },
      };

      if (view === "resources") {
        const comparability = pickEnum(req.query.comparability, CONFIG_DIFF_COMPARABILITY);
        if (comparability === null) {
          return apiError(res, 400, ApiErrorCode.VALIDATION,
            `comparability must be one of: ${CONFIG_DIFF_COMPARABILITY.join(", ")}`);
        }
        const report = await readDiffResourceReport({
          diffRowId: diff.id,
          comparability,
          workload: str(req.query.workload),
          limit: clampLimit(req.query.limit, RESOURCE_PAGE),
          offset: clampOffset(req.query.offset),
        });
        res.json({ ...shared, ...report });
        return;
      }

      const changeKind = pickEnum(req.query.changeKind, CONFIG_DIFF_CHANGE_KINDS);
      if (changeKind === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `changeKind must be one of: ${CONFIG_DIFF_CHANGE_KINDS.join(", ")}`);
      }

      // Lazy, once per comparison — see `ensureDiffAttributed`. Non-fatal.
      await ensureDiffAttributed(diff.id);

      const result = await readDiffChanges({
        diffRowId: diff.id,
        resourceKey: str(req.query.resourceKey),
        changeKind,
        workload: str(req.query.workload),
        includeIgnored: req.query.includeIgnored === "true",
        limit: clampLimit(req.query.limit, CHANGE_PAGE),
        offset: clampOffset(req.query.offset),
      });

      // #2759 — the verdict roll-up travels with the change page for the same reason
      // `notComparable` travels with the portal's: "340 changes" read without "312 of
      // them are unexplained" is a confidently incomplete summary.
      const attribution = await readDiffVerdictRollup(diff.id);

      res.json({ ...shared, ...result, attribution });
    } catch (err) {
      log.error({ err }, "msp-config-state: comparison detail failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read that configuration comparison");
    }
  });

// ── POST /api/msp/config-state/diffs/:diffId/attribution ─────────────────────
//
// Run (or re-run) the attribution pass over one sealed comparison: refresh the
// CR/risk-decision scope bridge for the tenant, write a verdict for every change row,
// and advance the open/resolved/reopened lifecycle.
//
// A POST, not a GET, because it WRITES — and it is explicitly re-runnable rather than
// once-only, because its inputs move underneath it: a change request approved after the
// diff was computed legitimately turns unattributed rows into attributed ones, and a
// revoked risk acceptance legitimately turns them back. The pass is idempotent; a second
// run over an unchanged world produces the same verdicts and cannot manufacture a
// lifecycle transition (see `advanceLifecycle`).
//
// No apply path is added here, and none may be: this reads Change Control and the Risk
// Register and writes only its own tables. It never modifies a change request, never
// modifies a risk decision, and never touches the sealed diff.

router.post("/msp/config-state/diffs/:diffId/attribution", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      const diff = await loadScopedDiff(String(req.params.diffId), book.tenantIds);
      if (!diff) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration comparison not found");

      const result = await attributeDiff(diff.id);
      res.json({ diffId: diff.diffId, ...result });
    } catch (err) {
      if (err instanceof DiffNotAttributableError) {
        return apiError(res, 409, ApiErrorCode.VALIDATION, err.message);
      }
      log.error({ err }, "msp-config-state: attribution pass failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to attribute that configuration comparison");
    }
  });

// ── GET /api/msp/config-state/baselines ──────────────────────────────────────

router.get("/msp/config-state/baselines", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const book = await resolveConfigStateBook(req);
      if (book.tenantIds.length === 0) {
        res.json({ baselines: [] });
        return;
      }

      const where: SQL[] = [inArray(configSnapshotBaselinesTable.tenantId, [...book.tenantIds])];
      if (req.query.includeRetired !== "true") {
        where.push(eq(configSnapshotBaselinesTable.isActive, true));
      }
      const purpose = pickEnum(req.query.purpose, CONFIG_BASELINE_PURPOSES);
      if (purpose === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `purpose must be one of: ${CONFIG_BASELINE_PURPOSES.join(", ")}`);
      }
      if (purpose) where.push(sql`${configSnapshotBaselinesTable.purpose} = ${purpose}`);

      const rows = await db.select({
        baseline: configSnapshotBaselinesTable,
        tenantName: tenantsTable.customerName,
        snapshot: tenantConfigSnapshotsTable,
      }).from(configSnapshotBaselinesTable)
        .leftJoin(tenantsTable, eq(tenantsTable.id, configSnapshotBaselinesTable.tenantId))
        .leftJoin(tenantConfigSnapshotsTable,
          eq(tenantConfigSnapshotsTable.id, configSnapshotBaselinesTable.snapshotRowId))
        .where(and(...where))
        .orderBy(asc(configSnapshotBaselinesTable.name));

      res.json({
        baselines: rows.map((r) => ({
          baselineId: r.baseline.baselineId,
          name: r.baseline.name,
          description: r.baseline.description,
          purpose: r.baseline.purpose,
          tenantId: r.baseline.tenantId,
          tenantName: r.tenantName ?? null,
          snapshotRowId: r.baseline.snapshotRowId,
          isActive: r.baseline.isActive,
          retiredAt: r.baseline.retiredAt,
          retiredReason: r.baseline.retiredReason,
          declaredByUserId: r.baseline.declaredByUserId,
          createdAt: r.baseline.createdAt,
          // The referenced snapshot's OWN completeness. A baseline is only as
          // authoritative as the snapshot behind it, and assessing against a
          // half-readable reference is a thing an operator must be able to see before
          // doing it — not discover afterwards in the comparability report.
          snapshot: r.snapshot
            ? {
              snapshotId: r.snapshot.snapshotId,
              capturedAt: r.snapshot.capturedAt,
              status: r.snapshot.status,
              completeness: snapshotCompleteness(r.snapshot),
            }
            : null,
        })),
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: baseline list failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to list configuration baselines");
    }
  });

// ── POST /api/msp/config-state/baselines ─────────────────────────────────────

/**
 * Declare an already-collected snapshot as a baseline.
 *
 * Writes a POINTER, nothing else. No configuration is copied, and the snapshot it
 * names is immutable by database trigger — so a baseline cannot drift away from what
 * was actually observed. This is not a write to a tenant; it does not touch Microsoft
 * at all.
 *
 * `mspId` is taken from the tenant's own `tenants.msp_id` rather than from the
 * caller's claim, so a PlatformAdmin declaring a baseline for someone else's customer
 * records the right owner instead of a null.
 */
router.post("/msp/config-state/baselines", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const name = str(body.name)?.trim();
      if (!name) {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "name is required and must not be blank");
      }
      const purpose = pickEnum(body.purpose, CONFIG_BASELINE_PURPOSES);
      if (purpose === null || purpose === undefined) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `purpose is required and must be one of: ${CONFIG_BASELINE_PURPOSES.join(", ")}`);
      }

      const snapshotRowId = Number(body.snapshotRowId);
      if (!Number.isSafeInteger(snapshotRowId) || snapshotRowId <= 0) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "snapshotRowId is required and must be a tenant_config_snapshots.id integer");
      }

      const book = await resolveConfigStateBook(req);
      const snapshot = await loadScopedSnapshot(String(snapshotRowId), book.tenantIds);
      if (!snapshot) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");
      }
      if (snapshot.status !== "sealed") {
        // A `running` snapshot's object set is still growing and a `failed` one is a
        // record of not having read the tenant. Neither is a reference anything can be
        // assessed against, and saying so here is better than letting the differ
        // refuse it later on every assessment.
        return apiError(res, 409, ApiErrorCode.CONFLICT,
          `Snapshot ${snapshot.id} is '${snapshot.status}', not 'sealed'. Only a sealed `
          + "snapshot is immutable, and a baseline that can still change is not a baseline.");
      }

      const [tenant] = await db.select({ mspId: tenantsTable.mspId })
        .from(tenantsTable).where(eq(tenantsTable.id, snapshot.tenantId)).limit(1);
      if (!tenant) return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");

      const [created] = await db.insert(configSnapshotBaselinesTable).values({
        mspId: tenant.mspId,
        tenantId: snapshot.tenantId,
        snapshotRowId: snapshot.id,
        name,
        description: str(body.description) ?? null,
        purpose: purpose as ConfigBaselinePurpose,
        declaredByUserId: (req.user as { id?: number } | undefined)?.id ?? null,
      }).returning();

      log.info({ baselineId: created.baselineId, tenantId: snapshot.tenantId, snapshotRowId: snapshot.id, purpose },
        "msp-config-state: baseline declared");

      res.status(201).json({
        baseline: {
          baselineId: created.baselineId,
          name: created.name,
          purpose: created.purpose,
          tenantId: created.tenantId,
          snapshotRowId: created.snapshotRowId,
          isActive: created.isActive,
          createdAt: created.createdAt,
        },
        snapshot: {
          snapshotId: snapshot.snapshotId,
          capturedAt: snapshot.capturedAt,
          completeness: snapshotCompleteness(snapshot),
        },
      });
    } catch (err) {
      if (violatesConstraint(err, "config_snapshot_baselines_msp_name_uidx")) {
        return apiError(res, 409, ApiErrorCode.CONFLICT,
          "A baseline with that name already exists for this MSP. Names are the way a "
          + "baseline is referred to, so they are unique within a book.");
      }
      log.error({ err }, "msp-config-state: baseline declaration failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to declare that baseline");
    }
  });

// ── PATCH /api/msp/config-state/baselines/:baselineId ────────────────────────

/**
 * Retire a baseline. Retired, never deleted — an assessment run months ago against a
 * baseline nobody uses now still has to be explainable, and a deleted row explains
 * nothing. A retired baseline MUST carry its reason; the database enforces that with a
 * CHECK constraint, and so does this handler.
 */
router.patch("/msp/config-state/baselines/:baselineId", requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const baselineId = String(req.params.baselineId);
      if (!UUID_RE.test(baselineId)) {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "baselineId must be a uuid");
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.isActive !== false) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "The only supported change is retirement: { isActive: false, retiredReason: '…' }. "
          + "A baseline's snapshot is immutable evidence, so repointing one at different "
          + "evidence under the same name would rewrite history — declare a new baseline "
          + "instead.");
      }
      const retiredReason = str(body.retiredReason)?.trim();
      if (!retiredReason) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "retiredReason is required — a retired baseline that does not say why is a gap "
          + "with no stated cause");
      }

      const book = await resolveConfigStateBook(req);
      if (book.tenantIds.length === 0) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Baseline not found");
      }

      const [updated] = await db.update(configSnapshotBaselinesTable)
        .set({
          isActive: false,
          retiredAt: new Date(),
          retiredReason,
          updatedAt: new Date(),
        })
        .where(and(
          eq(configSnapshotBaselinesTable.baselineId, baselineId),
          eq(configSnapshotBaselinesTable.isActive, true),
          inArray(configSnapshotBaselinesTable.tenantId, [...book.tenantIds]),
        ))
        .returning();

      if (!updated) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND,
          "Baseline not found, or it is already retired");
      }

      log.info({ baselineId, retiredReason }, "msp-config-state: baseline retired");
      res.json({
        baseline: {
          baselineId: updated.baselineId,
          name: updated.name,
          isActive: updated.isActive,
          retiredAt: updated.retiredAt,
          retiredReason: updated.retiredReason,
        },
      });
    } catch (err) {
      log.error({ err }, "msp-config-state: baseline retirement failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to retire that baseline");
    }
  });

export default router;
