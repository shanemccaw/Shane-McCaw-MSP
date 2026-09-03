/**
 * msp-remediation-bypass-resolutions.ts — Git #2670, Feature #1684
 * (Remediation Tracking, MSP Console). MSP-side mirror of
 * `portal-remediation-bypass-resolutions.ts` (#1543) — the CR-bypass-but-
 * resolved dual state. That route's own header already says who this is
 * for: "this route only joins the two so an MSP can see both" — until this
 * file, no MSP-scoped route actually reached it.
 *
 *   GET /api/msp/customers/:customerId/remediation/bypass-resolutions
 *     — every remediation-tracker step that verified against a re-scan in
 *       the same run a drift event was recorded on that step's domain with
 *       no linked change request. Purely observational, same as the portal
 *       route — no enforcement, no blocking, no naming a person, no scoring.
 */

import { Router, type IRouter, type Request, type Response } from "express";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveBypassResolutionsForCustomer } from "../lib/remediation-bypass-resolutions";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

router.get(
  "/msp/customers/:customerId/remediation/bypass-resolutions",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const items = await resolveBypassResolutionsForCustomer(customerId);
      res.json({ items });
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation/bypass-resolutions failed");
      res.status(500).json({ error: "Failed to resolve remediation bypass resolutions" });
    }
  },
);

export default router;
