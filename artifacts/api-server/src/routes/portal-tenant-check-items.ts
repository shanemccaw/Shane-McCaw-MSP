/**
 * portal-tenant-check-items.ts — Git #776 (Phase 1 of 2, sub-issue of epic
 * #647). Read-only access to `tenant_check_item_details` (#339), the table
 * `runItemDetailCollection()` (item-detail-collector.ts) populates alongside
 * every real scan (msp-diagnostics.ts) and post-consent (consent.ts) with the
 * FULL, uncapped item list per check. Zero GET routes read this table before
 * this one.
 *
 *   GET /api/portal/tenant-check-items?checkKeys=key1,key2,...
 *     — the most recent item-detail row per requested check key, for the
 *       calling customer's own tenant only.
 *
 * WHY BATCH, NOT ONE CHECK KEY PER CALL
 * --------------------------------------
 * Phase 2 (#782) wires up to 5 check keys' worth of real values into one
 * remediation script render. Five sequential round-trips per document view
 * would be five times the latency for data this route can return in one
 * indexed query. A single checkKey is just a one-element `checkKeys` list, so
 * this doesn't cost single-key callers anything.
 *
 * WHY THE LOOKUP GOES THROUGH `tenants.tenantId`, NOT `customerId` DIRECTLY
 * --------------------------------------------------------------------------
 * `tenant_check_item_details.tenantId` is the M365 tenant identifier
 * (`customer.tenantId` in msp-diagnostics.ts / `tenant` in consent.ts) — NOT
 * `tenants.id` (the `customerId` JWT claim). The table's own
 * `tenant_check_item_details_tenant_check_collected_idx` index is built on
 * (tenantId, checkKey, collectedAt), so the real scoping+performance path is:
 * resolve the caller's `tenants.id` → `tenants.tenantId` (one indexed PK
 * lookup, itself scoped to the JWT's own customerId), then query the item-
 * detail table by that resolved tenantId. `customerId` on the item-detail
 * rows is nullable (pre-customer/orphaned collections use it), so filtering
 * on it directly would silently miss real rows the resolved-tenantId path
 * does not.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable, tenantCheckItemDetailsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { sharePointPrefixFromDomain } from "../lib/monitor-executor";
import { getInitialDomainForTenant } from "../lib/graph";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

const MAX_CHECK_KEYS_PER_CALL = 25;

/** The wire shape of one check's most recent item-detail collection. */
interface WireCheckItemDetail {
  readonly checkKey: string;
  readonly status: string;
  readonly itemCount: number;
  readonly items: unknown[] | null;
  readonly itemsOmitted: boolean;
  readonly itemsOmittedReason: string | null;
  readonly collectedAt: string;
}

/**
 * The tenant's SharePoint admin prefix (the `contoso` in `contoso.sharepoint.com`
 * / `contoso-admin.sharepoint.com`) — Git #1042. Reuses `sharePointPrefixFromDomain`
 * (the same pure derivation `resolveSharePointTenantRef` in monitor-executor.ts
 * applies for the live SharePoint-admin check path), fed by the same
 * `tenants.domain` primary + Graph `/organization` fallback that path uses.
 * Returns `null` — never a guess — when neither source yields a real initial
 * domain, matching #782's own "only substitute a value that is really there"
 * discipline.
 */
async function resolveSharePointTenantPrefix(tenantId: string, storedDomain: string | null): Promise<string | null> {
  let prefix = sharePointPrefixFromDomain(storedDomain);
  if (!prefix) {
    const initialDomain = await getInitialDomainForTenant(tenantId);
    prefix = sharePointPrefixFromDomain(initialDomain);
  }
  if (!prefix) {
    log.debug({ tenantId }, "resolveSharePointTenantPrefix: no resolvable SharePoint prefix, leaving <your-tenant> placeholder");
  }
  return prefix;
}

/** tenants.id, off the JWT's `customerId` claim — same resolution every other route on this journey uses. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

function toWire(row: {
  checkKey: string;
  status: string;
  itemCount: number;
  items: unknown[] | null;
  itemsOmitted: boolean;
  itemsOmittedReason: string | null;
  collectedAt: Date;
}): WireCheckItemDetail {
  return {
    checkKey: row.checkKey,
    status: row.status,
    itemCount: row.itemCount,
    items: row.items,
    itemsOmitted: row.itemsOmitted,
    itemsOmittedReason: row.itemsOmittedReason,
    collectedAt: row.collectedAt.toISOString(),
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────
//
// A check key with no collection ever run for this tenant is simply absent
// from the response `items` map — never an error. A never-scanned tenant, or
// one whose scoring package never covered a requested check, both look
// exactly like "nothing collected yet" to the caller.
router.get(
  "/portal/tenant-check-items",
  // Same floor as the rest of the Copilot Readiness/Remediation journey (see
  // portal-remediation-tracker.ts): Assessment is the lowest role carrying a
  // customerId.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const rawCheckKeys = typeof req.query["checkKeys"] === "string" ? req.query["checkKeys"] : "";
    const checkKeys = Array.from(
      new Set(
        rawCheckKeys
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0),
      ),
    );

    if (checkKeys.length === 0) {
      res.status(400).json({ error: "checkKeys query parameter is required (comma-separated check keys)" });
      return;
    }
    if (checkKeys.length > MAX_CHECK_KEYS_PER_CALL) {
      res.status(400).json({ error: `checkKeys accepts at most ${MAX_CHECK_KEYS_PER_CALL} keys per call` });
      return;
    }

    try {
      // tenants.id -> tenants.tenantId (the M365 tenant identifier the item-
      // detail rows are actually keyed on — see the header). Scoped to this
      // caller's own customerId, so a resolved tenantId can never belong to
      // another tenant.
      const [tenantRow] = await db
        .select({ tenantId: tenantsTable.tenantId, domain: tenantsTable.domain })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!tenantRow) {
        res.json({ items: {}, sharePointTenantPrefix: null });
        return;
      }

      const sharePointTenantPrefix = await resolveSharePointTenantPrefix(tenantRow.tenantId, tenantRow.domain);

      const rows = await db
        .selectDistinctOn(
          [tenantCheckItemDetailsTable.checkKey],
          {
            checkKey: tenantCheckItemDetailsTable.checkKey,
            status: tenantCheckItemDetailsTable.status,
            itemCount: tenantCheckItemDetailsTable.itemCount,
            items: tenantCheckItemDetailsTable.items,
            itemsOmitted: tenantCheckItemDetailsTable.itemsOmitted,
            itemsOmittedReason: tenantCheckItemDetailsTable.itemsOmittedReason,
            collectedAt: tenantCheckItemDetailsTable.collectedAt,
          },
        )
        .from(tenantCheckItemDetailsTable)
        .where(
          and(
            eq(tenantCheckItemDetailsTable.tenantId, tenantRow.tenantId),
            inArray(tenantCheckItemDetailsTable.checkKey, checkKeys),
          ),
        )
        .orderBy(tenantCheckItemDetailsTable.checkKey, desc(tenantCheckItemDetailsTable.collectedAt));

      const items: Record<string, WireCheckItemDetail> = {};
      for (const row of rows) items[row.checkKey] = toWire(row);

      res.json({ items, sharePointTenantPrefix });
    } catch (err) {
      log.error({ err, customerId, checkKeys }, "GET /portal/tenant-check-items failed");
      res.status(500).json({ error: "Failed to load tenant check item details" });
    }
  },
);

export default router;
