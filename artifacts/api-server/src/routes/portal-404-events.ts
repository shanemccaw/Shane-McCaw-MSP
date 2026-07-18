/**
 * Portal 404 Event Logging
 *
 * Frontend-to-backend door for the msp-portal's NotFound page. Distinct from
 * client-events.ts (which feeds the exception tracker) — this writes to
 * msp_audit_logs so dead links surface in the Audit Log UI, since that's the
 * explicit ask for #6. Unauthenticated top-level 404s still render the styled
 * page but are not logged here, since there's no meaningful actor/tenant to
 * attribute them to.
 *
 *   POST /api/portal-404-events
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db, mspAuditLogsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { mspMutatingRateLimit } from "../middlewares/mspRateLimit";
import { getRequestContext } from "../lib/request-context";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "client.frontend" });

const portal404EventSchema = z.object({
  attemptedPath: z.string().min(1).max(500),
  referrer: z.string().max(500).nullable(),
  linkPath: z.string().max(500).nullable(),
});

router.post(
  "/portal-404-events",
  requireAuth,
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const parsed = portal404EventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const { attemptedPath, referrer, linkPath } = parsed.data;

    log.info(
      { userId: req.user!.id, attemptedPath, referrer, linkPath },
      "portal-404-events: report received",
    );

    await db.insert(mspAuditLogsTable).values({
      actorUserId: req.user!.id,
      actorRole: req.user!.mspRole ?? req.user!.role,
      mspId: req.user!.mspId ?? null,
      customerId: req.user!.customerId ?? null,
      actionType: "portal.route.not_found",
      entityType: "route",
      entityId: attemptedPath,
      entityLabel: attemptedPath,
      correlationId: getRequestContext()?.traceId ?? randomUUID(),
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      outcome: "failure",
      metadata: { attemptedPath, referrer, linkPath },
    });

    res.status(204).end();
  },
);

export default router;
