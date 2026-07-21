/**
 * msp-engine-history.ts
 *
 * MSP-facing engine trend history — GET /api/msp/engines/:key/history.
 *
 * Mirrors the response shape of the admin route
 * (GET /api/admin/engines/:key/history in admin-engines.ts) against the same
 * lib/engine-history.ts helpers. mspId is resolved exclusively from the
 * session via resolveMspIdStrict (req.user.mspId — no ?mspId= override, even
 * for PlatformAdmin, same rule every other /msp/... route without a :mspId
 * param follows, e.g. msp-alerts.ts/msp-customer-timeline.ts).
 *
 * ?customerId= is optional and, when present, must belong to the caller's
 * own MSP book — validated via assertCustomerAccess (the same chokepoint
 * every other single-customer MSP route uses) before any history is queried,
 * and further narrowed by per-staff customer-access scoping. A caller
 * outside their scope, or a customerId belonging to a different MSP, gets a
 * 404 (matches the "customer detail 404 fence" convention used elsewhere,
 * e.g. msp-portal.ts's customer detail routes — never disclose whether the
 * id exists at all).
 *
 * When ?customerId= is omitted, the route returns the list of the MSP's own
 * customers that actually have snapshot rows for this engine, rather than
 * silently blending every customer's series into one — that would be
 * misleading data (a single "MSP average" line has no coherent meaning for
 * a per-tenant risk score).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspCustomersTable, tenantEngineSnapshotsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireRole, assertCustomerAccess, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { getEngineDef } from "../lib/engine-registry";
import { getEngineHistoryMerged, getBaselineEvents, getSignalDeltasForRange } from "../lib/engine-history";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.signals" });

const router: IRouter = Router();

router.get(
  "/msp/engines/:key/history",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const { key } = req.params;

    const def = getEngineDef(String(key));
    if (!def) {
      res.status(404).json({ error: "Unknown engine" });
      return;
    }

    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const rawCustomerId = req.query.customerId;
    const customerId = rawCustomerId !== undefined ? Number(rawCustomerId) : undefined;
    if (rawCustomerId !== undefined && (Number.isNaN(customerId) || customerId === undefined)) {
      res.status(400).json({ error: "customerId must be numeric" });
      return;
    }

    try {
      if (customerId === undefined) {
        const scopedIds = await resolveStaffScopedCustomerIds(req.user!);
        const conditions = [
          eq(mspCustomersTable.mspId, mspId),
          eq(tenantEngineSnapshotsTable.engineKey, String(key)),
        ];
        if (scopedIds !== null) conditions.push(inArray(mspCustomersTable.id, scopedIds));

        const rows = await db
          .selectDistinct({ id: mspCustomersTable.id, name: mspCustomersTable.name })
          .from(tenantEngineSnapshotsTable)
          .innerJoin(mspCustomersTable, eq(tenantEngineSnapshotsTable.customerId, mspCustomersTable.id))
          .where(and(...conditions))
          .orderBy(mspCustomersTable.name)
          .limit(200);

        res.json({ engineKey: key, customers: rows });
        return;
      }

      const ok = await assertCustomerAccess(req.user!, customerId);
      if (!ok) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }

      const start = req.query.start ? new Date(String(req.query.start)) : undefined;
      const end = req.query.end ? new Date(String(req.query.end)) : undefined;

      const [series, baselineEvents, signalDeltas] = await Promise.all([
        getEngineHistoryMerged(customerId, String(key), start, end),
        getBaselineEvents(customerId, String(key)),
        getSignalDeltasForRange(customerId, String(key), start, end),
      ]);
      res.json({ engineKey: key, customerId, series, baselineEvents, signalDeltas });
    } catch (err) {
      log.error({ err, engineKey: key, mspId, customerId }, "msp-engine-history: history failed");
      res.status(500).json({ error: "Failed to load engine history" });
    }
  },
);

export default router;
