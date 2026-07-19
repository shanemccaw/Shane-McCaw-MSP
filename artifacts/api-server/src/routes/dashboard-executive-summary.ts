/**
 * dashboard-executive-summary.ts
 *
 * GET /api/dashboard/executive-summary — the AI Executive Summary tile for the
 * customer_default monitoring dashboard. Cached generation logic lives in
 * ../lib/dashboard-executive-summary.ts; this route is just auth/scope
 * resolution, mirroring dashboard-data.ts's POST /resolve pattern.
 *
 * Same auth/scope rules as POST /api/dashboard/resolve:
 *   CustomerUser  → always their own req.user.customerId.
 *   MSPOperator+  → an explicit ?customerId=, ownership-verified via assertCustomerAccess.
 *
 * ?refresh=true forces regeneration past the cache TTL (manual "Regenerate" button).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { getOrGenerateExecutiveSummary } from "../lib/dashboard-executive-summary.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

router.get(
  "/dashboard/executive-summary",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const user = req.user!;
    const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
    const isCustomerUser = effectiveRole === "CustomerUser" || effectiveRole === "Free" || effectiveRole === "Assessment";
    const mspId = user.mspId;

    if (mspId == null) {
      res.status(400).json({ error: "No MSP association on this session" });
      return;
    }

    let customerId: number | undefined;
    if (isCustomerUser) {
      customerId = user.customerId;
    } else {
      const requested = typeof req.query.customerId === "string" ? Number(req.query.customerId) : undefined;
      if (requested == null || !Number.isInteger(requested)) {
        res.status(400).json({ error: "customerId query param is required" });
        return;
      }
      const owns = await assertCustomerAccess(user, requested);
      if (!owns) {
        res.status(403).json({ error: "Access to this customer is not permitted" });
        return;
      }
      customerId = requested;
    }

    if (customerId == null) {
      res.json({ summary: null });
      return;
    }

    const force = req.query.refresh === "true";

    try {
      const summary = await getOrGenerateExecutiveSummary(customerId, mspId, { force });
      res.json({ summary });
    } catch (err) {
      log.error({ err, customerId, mspId }, "dashboard-executive-summary: request failed");
      res.status(500).json({ error: "Failed to load executive summary" });
    }
  },
);

export default router;
