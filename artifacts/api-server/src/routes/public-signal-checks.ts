/**
 * Public Signal Check Count (marketing site)
 *
 * Marketing copy ("158 checks", "150+ signals evaluated" etc.) needs a single real number for
 * how many platform signal-derivation rules the free scan actually evaluates. Previously that
 * figure was hardcoded as a literal in 9+ marketing files and silently drifted from the real
 * rule count (Git #1351) -- this is the one live source they should all read from instead.
 *
 *   GET /api/public/signal-check-count
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "system.core" });

router.get("/public/signal-check-count", async (_req: Request, res: Response) => {
  try {
    // Same scope as admin-signal-rules.ts's getAllRules() -- platform-owned rows only
    // (msp_id IS NULL), counted live rather than off a point-in-time snapshot.
    const result = await db.execute(sql`
      SELECT count(*)::int AS count FROM signal_derivation_rules WHERE msp_id IS NULL
    `);
    const count = (result.rows[0] as { count: number }).count;
    res.json({ count });
  } catch (err) {
    log.error({ err }, "GET /public/signal-check-count failed");
    res.status(500).json({ error: "Failed to fetch signal check count" });
  }
});

export default router;
