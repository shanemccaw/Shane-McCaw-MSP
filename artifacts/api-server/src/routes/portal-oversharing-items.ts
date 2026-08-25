/**
 * portal-oversharing-items.ts — the real, paginated/searchable read behind
 * the Overshared SharePoint pages (#1275, decisions signed off on #1262).
 *
 *   GET /api/portal/oversharing/items
 *
 * Reads `overshared_items` (one row per site x grant), populated by
 * `item-detail-collector.ts` on every real scan and backfilled from history
 * by `lib/db/migrations/manual/2026-08-25-overshared-items-1275.sql`. Today
 * every row is scope='site' (no per-file descent yet — #1262's deferred
 * follow-up #1), so this reads as "which sites have a broad grant and who
 * holds it", not yet a 23k-row per-file register. The pagination/search shape
 * below is sized for that eventual scale per #1275's decision 3, even though
 * v1 data is the real ~93 site-level rows.
 *
 * ── Scoping to "the current picture" ────────────────────────────────────────
 * A tenant can have MULTIPLE historical runs retained (decision 2). Absent an
 * explicit `runId`, this reads only the most recent run for the requested
 * `checkKey` — "what does oversharing look like right now" — never a mix of
 * runs. `runId` is accepted for a future trend/history view to read an older
 * snapshot explicitly; nothing here yet diffs two runs (that's the "newly
 * overshared since last scan" follow-up, not built here).
 *
 * ── Pagination: keyset on `id`, not OFFSET/LIMIT ────────────────────────────
 * Per #1262's sign-off — OFFSET at page 400 of a future 23k-row table would
 * re-scan every skipped row; keyset on the indexed `id` column stays flat
 * regardless of table size. `cursor` is the last-seen row's `id`, opaque to
 * the caller (a decimal string).
 *
 * ── Search ───────────────────────────────────────────────────────────────
 * `q` is a trigram-indexed ILIKE substring match (see the migration's
 * `overshared_items_search_trgm_idx`) over site/item name, item path, and
 * principal — real indexed search, not a jsonb scan.
 *
 * ── Role floor ───────────────────────────────────────────────────────────
 * `Assessment` — same floor as `portal-tenant-check-items.ts`, the table's
 * previous only reader.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  oversharedItemsTable,
  OVERSHARED_ITEM_GRANT_KINDS,
  OVERSHARED_ITEM_SEVERITIES,
  OVERSHARED_ITEM_REMEDIATION_STATES,
  type OversharedItemGrantKind,
  type OversharedItemSeverity,
  type OversharedItemRemediationState,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

const DEFAULT_CHECK_KEY = "compliance:eeeu-site-sharing";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** One row, in the shape the Overshared SharePoint pages consume. */
interface WireOversharedItem {
  readonly itemId: string;
  readonly checkKey: string;
  readonly scope: string;
  readonly site: {
    readonly id: string;
    readonly name: string | null;
    readonly url: string | null;
    readonly visibility: string | null;
    readonly isPersonalSite: boolean;
  };
  readonly item: { readonly path: string | null; readonly webUrl: string | null; readonly name: string | null } | null;
  readonly grant: {
    readonly kind: string;
    readonly principal: string | null;
    readonly upn: string | null;
    readonly loginName: string | null;
    readonly roles: string[];
    readonly linkScope: string | null;
    readonly inherited: boolean;
  };
  readonly severity: string | null;
  readonly sharingLevel: string | null;
  readonly remediationState: string;
  readonly collectedAt: string;
}

function parseCsvFilter<T extends string>(raw: unknown, allowed: readonly T[]): T[] | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const values = raw.split(",").map((v) => v.trim()).filter((v): v is T => (allowed as readonly string[]).includes(v));
  return values.length > 0 ? values : undefined;
}

router.get(
  "/portal/oversharing/items",
  requireRole("Assessment"),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const tenantScope = await resolveTenantScope(customerId);
      if (!tenantScope) {
        // No resolvable M365 tenant yet — genuinely no oversharing data, not an error.
        res.json({ items: [], nextCursor: null, total: 0, runId: null });
        return;
      }

      const checkKey = typeof req.query.checkKey === "string" && req.query.checkKey.trim() ? req.query.checkKey.trim() : DEFAULT_CHECK_KEY;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const grantKinds = parseCsvFilter<OversharedItemGrantKind>(req.query.grantKind, OVERSHARED_ITEM_GRANT_KINDS);
      const severities = parseCsvFilter<OversharedItemSeverity>(req.query.severity, OVERSHARED_ITEM_SEVERITIES);
      const states = parseCsvFilter<OversharedItemRemediationState>(req.query.state, OVERSHARED_ITEM_REMEDIATION_STATES);
      const explicitRunId = typeof req.query.runId === "string" && req.query.runId.trim() ? req.query.runId.trim() : null;

      const limitRaw = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
      const limit = Math.min(MAX_LIMIT, Math.max(1, isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw));

      const cursorRaw = typeof req.query.cursor === "string" ? parseInt(req.query.cursor, 10) : NaN;
      const cursorId = !isNaN(cursorRaw) && cursorRaw > 0 ? cursorRaw : null;

      let runId = explicitRunId;
      if (!runId) {
        const [latest] = await db
          .select({ runId: oversharedItemsTable.runId })
          .from(oversharedItemsTable)
          .where(and(eq(oversharedItemsTable.tenantId, tenantScope.tenantId), eq(oversharedItemsTable.checkKey, checkKey)))
          .orderBy(desc(oversharedItemsTable.collectedAt), desc(oversharedItemsTable.id))
          .limit(1);
        runId = latest?.runId ?? null;
      }

      if (!runId) {
        res.json({ items: [], nextCursor: null, total: 0, runId: null });
        return;
      }

      const conditions: SQL[] = [
        eq(oversharedItemsTable.tenantId, tenantScope.tenantId),
        eq(oversharedItemsTable.checkKey, checkKey),
        eq(oversharedItemsTable.runId, runId),
      ];
      if (grantKinds) conditions.push(inArray(oversharedItemsTable.grantKind, grantKinds));
      if (severities) conditions.push(inArray(oversharedItemsTable.severity, severities));
      if (states) conditions.push(inArray(oversharedItemsTable.remediationState, states));
      if (q) {
        // Trigram-indexed ILIKE — see overshared_items_search_trgm_idx.
        conditions.push(
          sql`(
            coalesce(${oversharedItemsTable.siteName}, '') || ' ' ||
            coalesce(${oversharedItemsTable.itemName}, '') || ' ' ||
            coalesce(${oversharedItemsTable.itemPath}, '') || ' ' ||
            coalesce(${oversharedItemsTable.principalLabel}, '') || ' ' ||
            coalesce(${oversharedItemsTable.principalUpn}, '') || ' ' ||
            coalesce(${oversharedItemsTable.loginName}, '')
          ) ILIKE ${`%${q}%`}`,
        );
      }

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(oversharedItemsTable)
        .where(and(...conditions));

      const pageConditions = cursorId ? [...conditions, gt(oversharedItemsTable.id, cursorId)] : conditions;

      const rows = await db
        .select()
        .from(oversharedItemsTable)
        .where(and(...pageConditions))
        .orderBy(asc(oversharedItemsTable.id))
        .limit(limit);

      const items: WireOversharedItem[] = rows.map((r) => ({
        itemId: r.itemId,
        checkKey: r.checkKey,
        scope: r.scope,
        site: {
          id: r.siteId,
          name: r.siteName,
          url: r.siteUrl,
          visibility: r.siteVisibility,
          isPersonalSite: r.isPersonalSite,
        },
        item: r.scope === "site" ? null : { path: r.itemPath, webUrl: r.itemWebUrl, name: r.itemName },
        grant: {
          kind: r.grantKind,
          principal: r.principalLabel,
          upn: r.principalUpn,
          loginName: r.loginName,
          roles: r.roles,
          linkScope: r.linkScope,
          inherited: r.inherited,
        },
        severity: r.severity,
        sharingLevel: r.sharingLevel,
        remediationState: r.remediationState,
        collectedAt: r.collectedAt.toISOString(),
      }));

      const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;

      res.json({ items, nextCursor, total, runId });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/oversharing/items failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
