/**
 * portal-engine-history.ts
 *
 * Customer-facing engine trend history — GET /api/portal/engines/:key/history.
 *
 * Mirrors the response shape of the admin route
 * (GET /api/admin/engines/:key/history in admin-engines.ts) against the same
 * lib/engine-history.ts helpers, but customerId is resolved exclusively from
 * the authenticated session (req.user.customerId), never from a query param
 * or any other client-supplied value — see resolveMspIdStrict in
 * lib/resolve-msp-id.ts for the precedent this follows (a prior bug allowed a
 * client-settable param to override tenant context).
 *
 * Only the customer-safe engine subset (CUSTOMER_SAFE_ENGINE_KEYS, the same
 * set portal-mission-control.ts's engine status strip exposes) is queryable
 * here — internal-only engines (priority, pricing, crm, forecasting,
 * sales_offer, msp) are rejected as "Unknown engine", identical to a truly
 * unknown key, so their existence isn't disclosed to a customer session
 * either.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import { getEngineDef } from "../lib/engine-registry";
import { getEngineHistoryMerged, getBaselineEvents, getSignalDeltasForRange } from "../lib/engine-history";
import { logger } from "../lib/logger";
import { CUSTOMER_SAFE_ENGINE_KEYS } from "../lib/customer-safe-engines";

const log = logger.child({ channel: "engine.signals" });

const router: IRouter = Router();

router.get(
  "/portal/engines/:key/history",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const { key } = req.params;

    const def = getEngineDef(String(key));
    if (!def || !CUSTOMER_SAFE_ENGINE_KEYS.includes(String(key))) {
      res.status(404).json({ error: "Unknown engine" });
      return;
    }

    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const end = req.query.end ? new Date(String(req.query.end)) : undefined;

    try {
      const [series, baselineEvents, signalDeltas] = await Promise.all([
        getEngineHistoryMerged(customerId, String(key), start, end),
        getBaselineEvents(customerId, String(key)),
        getSignalDeltasForRange(customerId, String(key), start, end),
      ]);
      res.json({ engineKey: key, customerId, series, baselineEvents, signalDeltas });
    } catch (err) {
      log.error({ err, engineKey: key, customerId }, "portal-engine-history: history failed");
      res.status(500).json({ error: "Failed to load engine history" });
    }
  },
);

export default router;
