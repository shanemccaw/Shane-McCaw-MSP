// EngageBay Tags Admin Panel route (#107).
//
//   GET /api/engagebay/tags — list all tags in the account (SYNCHRONOUS)
//
// Deliberately NOT folded into engagebay-crm.ts's ENTITIES table (#106): that
// shape assumes id-based detail/update/delete, none of which exist for tags.
// Per the #107 audit, EngageBay's REST reference (github.com/engagebay/restapi)
// confirms GET /dev/api/panel/tags (list, already wrapped by listTags() in
// engagebay-client.ts, #104) and the existing add-tag action (#105/#106) —
// nothing else. No create/remove/delete-tag endpoint is confirmed anywhere in
// that reference, so this phase ships list only; do not add write routes here
// without a confirmed path first.

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import {
  listTags,
  asRecordArray,
  EngageBayNotConnectedError,
  EngageBayApiError,
} from "../lib/engagebay-client.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.engagebay" });

const router: IRouter = Router();

router.get("/engagebay/tags", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const body = await listTags();
    res.json({ tags: asRecordArray(body) });
  } catch (err) {
    if (err instanceof EngageBayNotConnectedError) {
      log.warn("engagebay-tags route: EngageBay not connected");
      res.status(503).json({ error: err.message, code: "engagebay_not_connected" });
      return;
    }
    if (err instanceof EngageBayApiError) {
      log.warn({ status: err.status }, "engagebay-tags route: EngageBay API error");
      res.status(err.status >= 400 && err.status < 500 ? err.status : 502).json({
        error: `EngageBay API error (${err.status})`,
        code: "engagebay_api_error",
        details: err.body,
      });
      return;
    }
    log.error({ err }, "engagebay-tags route: unexpected failure");
    res.status(500).json({ error: "Unexpected failure talking to EngageBay" });
  }
});

export default router;
