/**
 * portal-config-state.ts — the CUSTOMER-facing read surface over their own tenant's
 * configuration state (Git #1843).
 *
 *   GET /api/portal/config-state/snapshots
 *     Snapshot history for this customer's tenant — headers and completeness only.
 *   GET /api/portal/config-state/snapshots/current
 *     The most recent SEALED snapshot, as the document header plus its per-workload
 *     roll-up. "What my configuration is, right now, and how much of it we could read."
 *   GET /api/portal/config-state/snapshots/:id
 *     Any of their own snapshots as that same document, paginated.
 *   GET /api/portal/config-state/snapshots/:id/objects?resourceKey=…
 *     The real stored objects behind one resource type. Paginated hard — see
 *     `config-state-views.ts` for the measured byte counts that set the caps.
 *   GET /api/portal/config-state/changes
 *     What changed since the previous snapshot: the drift comparison of this tenant's
 *     two most recent sealed snapshots.
 *   GET /api/portal/config-state/changes/:diffId
 *     One comparison's change list, paginated and filterable.
 *
 * ─── Scoping ───────────────────────────────────────────────────────────────────
 * `resolveCustomerId(req)` — the JWT's own `customerId` claim, which IS `tenants.id`
 * and is the only id this store is keyed on. That single value is the entire allowed
 * tenant set passed into every read in `config-state-views.ts`, and those reads apply
 * it as a SQL predicate rather than as a post-filter. There is no `?tenantId=`
 * parameter on this router and there must never be one: the only tenant a customer may
 * name is their own, and the way to express that is not to let them name one at all.
 *
 * Diffs are entitled on BOTH sides (`loadScopedDiff`). A `tenant_compare` diff's
 * `oldValue` column contains the base tenant's real configuration, so head-side
 * entitlement alone would leak it — and in practice a customer is never entitled to
 * both sides of a cross-tenant diff, so those simply do not resolve here. That is
 * correct: cross-tenant comparison is an operator capability, served on
 * `/api/msp/config-state/*`.
 *
 * ─── Role floor ────────────────────────────────────────────────────────────────
 * `requireRole("CustomerUser")` — which admits CustomerUser and every MSP/admin role
 * above it, and excludes `Free` and `Assessment`. This is a HIGHER floor than the
 * neighbouring `portal-change-control.ts` / `portal-remediation-tracker.ts`, and
 * deliberately so: those serve findings ABOUT a tenant, this serves the tenant's
 * actual configuration — every conditional access policy, every service principal,
 * every transport rule. It is not a surface to hand a free assessment lead.
 *
 * The cross-tenant guard is the `customerId`-from-JWT scoping, not the role floor;
 * the floor is a product decision about who gets the capability at all.
 *
 * ─── Read-only, and structurally so ────────────────────────────────────────────
 * Nothing here writes to a tenant, and nothing here may. Applying configuration is
 * the Config Pack path with its consent gates, break-glass gate and approval steps.
 * The one thing on this router that is not a pure SELECT is the drift comparison on
 * `GET /changes`, which is a read-through over two IMMUTABLE snapshots — see the
 * comment on that handler for why that is a read and not a write, and for the
 * stampede guard.
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
  CONFIG_DIFF_CHANGE_KINDS,
  CONFIG_DIFF_COMPARABILITY,
  SNAPSHOT_RESOURCE_STATUSES,
  SNAPSHOT_STATUSES,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import {
  CHANGE_PAGE,
  OBJECT_PAGE,
  RESOURCE_PAGE,
  SNAPSHOT_LIST_PAGE,
  clampLimit,
  clampOffset,
  diffCompleteness,
  diffSides,
  latestSealedPair,
  listSnapshots,
  loadScopedDiff,
  loadScopedSnapshot,
  readDiffChanges,
  readDiffResourceReport,
  readSnapshotDocument,
  readSnapshotObjects,
  snapshotCompleteness,
} from "../lib/config-state-views.ts";
import {
  SnapshotNotDiffableError,
  diffDrift,
} from "../lib/config-snapshot-differ.ts";
import {
  ensureDiffAttributed,
  readDiffVerdictRollup,
} from "../lib/config-change-attribution.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** One member of a locked vocabulary, or `undefined`. Anything else is a 400. */
function pickEnum(raw: unknown, allowed: readonly string[]): string | undefined | null {
  const v = str(raw);
  if (v === undefined) return undefined;
  return allowed.includes(v) ? v : null;
}

// ── GET /api/portal/config-state/snapshots ───────────────────────────────────

router.get("/portal/config-state/snapshots", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      const status = pickEnum(req.query.status, SNAPSHOT_STATUSES);
      if (status === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `status must be one of: ${SNAPSHOT_STATUSES.join(", ")}`);
      }

      const result = await listSnapshots({
        allowedTenantIds: [customerId],
        status,
        limit: clampLimit(req.query.limit, SNAPSHOT_LIST_PAGE),
        offset: clampOffset(req.query.offset),
      });
      res.json(result);
    } catch (err) {
      log.error({ err, customerId }, "portal-config-state: snapshot history failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to read your configuration snapshot history");
    }
  });

// ── GET /api/portal/config-state/snapshots/current ───────────────────────────
// Registered BEFORE `/:id` so the literal path is not swallowed by the param route.

router.get("/portal/config-state/snapshots/current", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      const [current] = await latestSealedPair(customerId);
      if (!current) {
        // NOT an empty document. "Nobody has collected your configuration yet" and
        // "your configuration is empty" are different facts, and conflating them is
        // the exact failure this whole subsystem was built to make impossible.
        res.json({
          snapshot: null,
          collected: false,
          reason: "no_sealed_snapshot",
          detail: "No sealed configuration snapshot exists for this tenant yet. A snapshot "
            + "is captured by the Tenant Configuration Snapshot workflow; until one has run "
            + "and sealed, there is nothing to report — which is not the same as reporting "
            + "that the tenant has no configuration.",
        });
        return;
      }

      const doc = await readSnapshotDocument({
        snapshotRowId: current.id,
        limit: clampLimit(req.query.limit, RESOURCE_PAGE),
        offset: clampOffset(req.query.offset),
      });

      res.json({
        snapshot: {
          id: current.id,
          snapshotId: current.snapshotId,
          tenantId: current.tenantId,
          capturedAt: current.capturedAt,
          status: current.status,
          trigger: current.trigger,
        },
        collected: true,
        completeness: snapshotCompleteness(current),
        workloads: doc.workloads,
        resources: doc.resources,
        paging: doc.paging,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-config-state: current snapshot failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to read your current configuration snapshot");
    }
  });

// ── GET /api/portal/config-state/snapshots/:id ───────────────────────────────

router.get("/portal/config-state/snapshots/:id", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      const snapshot = await loadScopedSnapshot(String(req.params.id), [customerId]);
      // 404, not 403, for a snapshot belonging to another tenant — a 403 would confirm
      // that the id names a real snapshot, which is itself information about another
      // customer.
      if (!snapshot) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");
      }

      const workload = str(req.query.workload);
      const status = pickEnum(req.query.status, SNAPSHOT_RESOURCE_STATUSES);
      if (status === null) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          `status must be one of: ${SNAPSHOT_RESOURCE_STATUSES.join(", ")}`);
      }

      const doc = await readSnapshotDocument({
        snapshotRowId: snapshot.id,
        workload,
        status,
        limit: clampLimit(req.query.limit, RESOURCE_PAGE),
        offset: clampOffset(req.query.offset),
      });

      res.json({
        snapshot: {
          id: snapshot.id,
          snapshotId: snapshot.snapshotId,
          tenantId: snapshot.tenantId,
          capturedAt: snapshot.capturedAt,
          status: snapshot.status,
          trigger: snapshot.trigger,
        },
        completeness: snapshotCompleteness(snapshot),
        workloads: doc.workloads,
        resources: doc.resources,
        paging: doc.paging,
        // The roll-up is over the WHOLE snapshot; the rows are one filtered page of
        // it. Saying so is not decoration — without it the two numbers look
        // inconsistent.
        filtered: workload !== undefined || status !== undefined,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-config-state: snapshot document failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read that configuration snapshot");
    }
  });

// ── GET /api/portal/config-state/snapshots/:id/objects ───────────────────────

router.get("/portal/config-state/snapshots/:id/objects", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      const snapshot = await loadScopedSnapshot(String(req.params.id), [customerId]);
      if (!snapshot) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration snapshot not found");
      }

      const resourceKey = str(req.query.resourceKey);
      if (!resourceKey) {
        return apiError(res, 400, ApiErrorCode.VALIDATION,
          "resourceKey is required — a snapshot holds tens of thousands of objects across "
          + "the whole tenant and is not servable in one response");
      }
      const include = req.query.include === "summary" ? "summary" : "full";

      const result = await readSnapshotObjects({
        snapshotRowId: snapshot.id,
        resourceKey,
        include,
        limit: clampLimit(req.query.limit, OBJECT_PAGE),
        offset: clampOffset(req.query.offset),
      });

      res.json({
        snapshotId: snapshot.snapshotId,
        resourceKey,
        include,
        // The resource's own completeness row travels with its objects: a page of 25
        // out of a `partial` read looks identical to a page out of a complete one
        // without it.
        resourceStatus: result.resourceStatus,
        objects: result.objects,
        paging: result.paging,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-config-state: object drill-down failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to read the stored objects for that resource type");
    }
  });

// ── GET /api/portal/config-state/changes ─────────────────────────────────────

/**
 * Per-tenant in-flight comparisons, so a page that mounts three components does not
 * start three full-tenant diffs. The measured cost of one is 3.5–4.7 s over ~50,000
 * objects (#1797's own live run), which is exactly long enough for a stampede to
 * matter and short enough that a queue is the wrong shape.
 */
const inFlightDrift = new Map<number, Promise<{ diffRowId: number }>>();

/**
 * "What changed since the previous snapshot."
 *
 * Resolves this tenant's two most recent SEALED snapshots and returns the drift
 * comparison between them.
 *
 * ─── Why computing here is a READ, not a write ────────────────────────────────
 * The two snapshots are immutable by database trigger and the active ruleset is part
 * of the differ's cache key, so `diffSnapshots` over a given pair is a pure function:
 * the first call materialises the answer, every later call returns the same stored
 * row. Nothing about it can reach a tenant — the differ reads the snapshot store and
 * writes the diff store, and has no transport at all. This is a read-through cache
 * over derived data, not a mutation of anything the customer owns.
 *
 * `resourceKeys` is deliberately NOT accepted here. Git #2032 found that a
 * resource-scoped recompute silently overwrites a full diff, because `resourceKeys`
 * is not part of the cache key `(base, head, mode, rulesetFingerprint)` — so a
 * narrowed request would replace the whole-tenant evidence with a fragment of it.
 * Until that is fixed, no route this session adds exposes the parameter.
 *
 * `?compute=false` returns only an already-stored comparison, for a caller that would
 * rather render "not computed yet" than wait.
 */
router.get("/portal/config-state/changes", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      const pair = await latestSealedPair(customerId);
      const head = pair[0];
      const base = pair[1];

      if (!head) {
        res.json({
          comparison: null,
          available: false,
          reason: "no_sealed_snapshot",
          detail: "No sealed configuration snapshot exists for this tenant yet, so there is "
            + "no 'before' or 'after' to compare.",
        });
        return;
      }
      if (!base) {
        res.json({
          comparison: null,
          available: false,
          reason: "only_one_snapshot",
          detail: "Only one sealed configuration snapshot exists for this tenant. A change "
            + "report needs two points in time; there is nothing to compare this one against "
            + "yet.",
          currentSnapshot: {
            id: head.id, snapshotId: head.snapshotId, capturedAt: head.capturedAt,
            completeness: snapshotCompleteness(head),
          },
        });
        return;
      }

      const computeAllowed = req.query.compute !== "false";

      // Cache-only path first — the common case once a comparison exists.
      const [stored] = await db.select().from(configDiffsTable)
        .where(and(
          eq(configDiffsTable.baseSnapshotRowId, base.id),
          eq(configDiffsTable.headSnapshotRowId, head.id),
          eq(configDiffsTable.mode, "drift"),
          eq(configDiffsTable.status, "sealed"),
        ))
        .orderBy(desc(configDiffsTable.createdAt))
        .limit(1);

      let diffRowId = stored?.id ?? null;

      if (diffRowId === null) {
        if (!computeAllowed) {
          res.json({
            comparison: null,
            available: false,
            reason: "not_yet_computed",
            detail: "The comparison between these two snapshots has not been computed yet. "
              + "Request this endpoint without compute=false to compute it.",
            base: { id: base.id, snapshotId: base.snapshotId, capturedAt: base.capturedAt },
            head: { id: head.id, snapshotId: head.snapshotId, capturedAt: head.capturedAt },
          });
          return;
        }

        let run = inFlightDrift.get(customerId);
        if (!run) {
          run = diffDrift({
            baselineSnapshotRowId: base.id,
            currentSnapshotRowId: head.id,
            trigger: "api",
            triggerRef: `portal:config-state:changes:tenant=${customerId}`,
            requestedByUserId: (req.user as { id?: number } | undefined)?.id ?? null,
            useCache: true,
          }).then((r) => ({ diffRowId: r.diffRowId }));
          inFlightDrift.set(customerId, run);
          run.finally(() => { inFlightDrift.delete(customerId); }).catch(() => {});
        }
        diffRowId = (await run).diffRowId;
      }

      const [diff] = await db.select().from(configDiffsTable)
        .where(eq(configDiffsTable.id, diffRowId)).limit(1);
      if (!diff) {
        return apiError(res, 500, ApiErrorCode.INTERNAL,
          "The comparison was computed but could not be read back");
      }

      const report = await readDiffResourceReport({
        diffRowId: diff.id,
        comparability: "not_comparable",
        limit: clampLimit(req.query.limit, RESOURCE_PAGE),
        offset: 0,
      });

      // #2759 — same reasoning as `notComparable` below: a change count read without
      // "how many of these did anyone authorise" is a summary that invites the wrong
      // conclusion. Attribution is lazy and non-fatal, so this never fails the report.
      await ensureDiffAttributed(diff.id);
      const attribution = await readDiffVerdictRollup(diff.id);

      res.json({
        comparison: {
          diffId: diff.diffId,
          diffRowId: diff.id,
          mode: diff.mode,
          base: {
            id: base.id, snapshotId: base.snapshotId, capturedAt: base.capturedAt,
            completeness: snapshotCompleteness(base),
          },
          head: {
            id: head.id, snapshotId: head.snapshotId, capturedAt: head.capturedAt,
            completeness: snapshotCompleteness(head),
          },
        },
        available: true,
        completeness: diffCompleteness(diff),
        // What we could NOT compare, and why — carried at the top level rather than
        // behind a second request, because "340 changes" read without "1,203 resource
        // types could not be compared" is a confidently wrong summary of the tenant.
        notComparable: {
          count: diff.resourceTypesNotComparable,
          resources: report.resources,
          paging: report.paging,
        },
        byWorkload: report.byWorkload,
        attribution,
      });
    } catch (err) {
      if (err instanceof SnapshotNotDiffableError) {
        // A refused pair is a real, statable fact about the snapshots, not a fault.
        res.json({ comparison: null, available: false, reason: "not_diffable", detail: err.message });
        return;
      }
      log.error({ err, customerId }, "portal-config-state: change report failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL,
        "Failed to build your configuration change report");
    }
  });

// ── GET /api/portal/config-state/changes/:diffId ─────────────────────────────

router.get("/portal/config-state/changes/:diffId", requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      return apiError(res, 403, ApiErrorCode.FORBIDDEN, "No customer context on this session");
    }
    try {
      // Entitled on BOTH sides — see the file header.
      const diff = await loadScopedDiff(String(req.params.diffId), [customerId]);
      if (!diff) {
        return apiError(res, 404, ApiErrorCode.NOT_FOUND, "Configuration comparison not found");
      }

      const view = str(req.query.view) ?? "changes";
      if (view !== "changes" && view !== "resources") {
        return apiError(res, 400, ApiErrorCode.VALIDATION, "view must be 'changes' or 'resources'");
      }

      const sides = await diffSides(diff);
      const shared = {
        diffId: diff.diffId,
        diffRowId: diff.id,
        mode: diff.mode,
        completeness: diffCompleteness(diff),
        snapshots: {
          base: sides.base
            ? { id: sides.base.id, snapshotId: sides.base.snapshotId, capturedAt: sides.base.capturedAt, completeness: snapshotCompleteness(sides.base) }
            : null,
          head: sides.head
            ? { id: sides.head.id, snapshotId: sides.head.snapshotId, capturedAt: sides.head.capturedAt, completeness: snapshotCompleteness(sides.head) }
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

      // Attribute lazily, once per comparison, before the page is read — so the first
      // customer to open a fresh comparison sees verdicts rather than a column of
      // nulls. Non-fatal by contract: a failure leaves `attribution: null` on every
      // row, which is the honest "not attributed yet" state, and never fails the read.
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

      // #2759 — the verdict roll-up. A customer reading "340 things changed" needs to
      // know which of them their MSP did on purpose, which they themselves accepted as
      // a risk, and which nobody can account for. `attributed: false` means the pass
      // has not run over this comparison yet, and reads differently from all of those.
      const attribution = await readDiffVerdictRollup(diff.id);

      res.json({ ...shared, ...result, attribution });
    } catch (err) {
      log.error({ err, customerId }, "portal-config-state: comparison detail failed");
      return apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read that configuration comparison");
    }
  });

export default router;
