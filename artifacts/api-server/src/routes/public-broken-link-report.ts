/**
 * Public Broken-Link Report (marketing 404 page)
 *
 * Unauthenticated counterpart to portal-404-events.ts's pattern — a marketing visitor hitting
 * the 404 page is always logged out, so there is no user/tenant to attribute an audit-log row
 * to. Fire-and-forget from the client; rate-limited by IP via mspMutatingRateLimit (its
 * key-generator already falls back to IP when req.user is absent).
 *
 *   POST /api/public/broken-link-report
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { mspMutatingRateLimit } from "../middlewares/mspRateLimit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "system.core" });

const brokenLinkReportSchema = z.object({
  attemptedPath: z.string().min(1).max(500),
  referrer: z.string().max(500).nullable(),
});

router.post(
  "/public/broken-link-report",
  mspMutatingRateLimit,
  (req: Request, res: Response) => {
    const parsed = brokenLinkReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const { attemptedPath, referrer } = parsed.data;
    log.info(
      { attemptedPath, referrer, ip: req.ip, userAgent: req.get("user-agent") },
      "broken-link-report: report received",
    );

    res.status(204).end();
  },
);

export default router;
