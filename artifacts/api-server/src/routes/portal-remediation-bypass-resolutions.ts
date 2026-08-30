/**
 * portal-remediation-bypass-resolutions.ts — the CR-bypass-but-resolved dual
 * state over the wire (#1543).
 *
 *   GET /api/portal/remediation/bypass-resolutions
 *     — for the calling customer, every remediation-tracker step that verified
 *       against a re-scan in the SAME run a drift event was recorded on that
 *       step's domain with no linked change request (`attributed_unapproved`
 *       or `unattributed`). Neither fact is edited to produce this: the step
 *       genuinely verified, and the drift event genuinely fell outside change
 *       control. This route only joins the two so an MSP can see both.
 *
 * Purely observational. No enforcement, no blocking, no naming a person, no
 * scoring — see ../lib/remediation-bypass-resolutions.ts for the full
 * rationale. SCOPE STOP: ends at the wire contract, no `artifacts/portal` page.
 */

import { Router, type IRouter, type Request, type Response } from "express";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveBypassResolutionsForCustomer } from "../lib/remediation-bypass-resolutions";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/** tenants.id off the JWT's `customerId` claim — same resolution as the rest of this journey. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

router.get(
  "/portal/remediation/bypass-resolutions",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const items = await resolveBypassResolutionsForCustomer(customerId);
      res.json({ items });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation/bypass-resolutions failed");
      res.status(500).json({ error: "Failed to resolve remediation bypass resolutions" });
    }
  },
);

export default router;
