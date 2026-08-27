/**
 * portal-governance-areas.ts — real per-card data for the Governance pillar
 * dashboard's area-link grid (Git #1333).
 *
 *   GET /api/portal/governance/areas
 *
 * Replaces the `GOV_AREA_LINKS` fixture's fabricated per-card scores/deltas/
 * sparklines with the tenant's real `tenant_monitor_profiles` counts for the
 * ten confirmed-real Governance checks. The card→check mapping and the
 * status/delta derivation are the DB-free `lib/portal-governance-areas.ts`
 * (unit-tested); this route only fetches rows and hands them over.
 *
 * ── The previous scan ───────────────────────────────────────────────────────
 * For each check the two most-recent `collected_at` rows are read: the latest
 * is the card's value, the one before it is the delta baseline. A check with no
 * collection at all is returned as honest no-data (value null), never dropped —
 * so the page can render every card's true state.
 *
 * ── Role floor ──────────────────────────────────────────────────────────────
 * `Assessment` — same floor as the sibling `portal-oversharing-sites.ts` and
 * the pillar-hero seam this grid sits beside.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantMonitorProfilesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import {
  GOV_AREA_CHECK_DEFS,
  buildGovArea,
  type GovProfileRow,
  type WireGovArea,
} from "../lib/portal-governance-areas";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

router.get(
  "/portal/governance/areas",
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
        // No resolvable M365 tenant ⇒ nothing has ever been scanned. Every card
        // is honest no-data rather than a fixture number.
        res.json({ areas: emptyAreas(), hasData: false });
        return;
      }

      // One small, index-served read per check (tenant+check idx): the two most
      // recent scans, newest first — latest value + its delta baseline.
      const areas: WireGovArea[] = await Promise.all(
        GOV_AREA_CHECK_DEFS.map(async (def) => {
          const rows = await db
            .select({
              extractedProperties: tenantMonitorProfilesTable.extractedProperties,
              severityMatched: tenantMonitorProfilesTable.severityMatched,
              severityLabel: tenantMonitorProfilesTable.severityLabel,
              collectedAt: tenantMonitorProfilesTable.collectedAt,
            })
            .from(tenantMonitorProfilesTable)
            .where(
              and(
                eq(tenantMonitorProfilesTable.tenantId, tenantScope.tenantId),
                eq(tenantMonitorProfilesTable.checkKey, def.checkKey),
              ),
            )
            .orderBy(desc(tenantMonitorProfilesTable.collectedAt), desc(tenantMonitorProfilesTable.id))
            .limit(2);

          const [latest, previous] = rows as GovProfileRow[];
          return buildGovArea(def, latest, previous);
        }),
      );

      res.json({ areas, hasData: areas.some((a) => a.hasData) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/governance/areas failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** Every card as honest no-data — for a tenant with no resolvable scan scope. */
function emptyAreas(): WireGovArea[] {
  return GOV_AREA_CHECK_DEFS.map((def) => buildGovArea(def, undefined, undefined));
}

export default router;
