/**
 * dev-scan-pause.ts (Git #4449)
 *
 * Dev-only endpoint for pausing/resuming SCHEDULED monitoring scans. Registered
 * in the router ONLY when NODE_ENV !== 'production' (see routes/index.ts) — the
 * same conditional-import pattern as admin-dev-seed.ts. Outside dev, these paths
 * 404 because the router is never mounted, not because of an in-handler check.
 *
 * The pause is a single in-memory process flag (monitor-executor.ts). It only
 * ever short-circuits a "scheduled" (Workflow Engine cron) run — a manual
 * "Scan Now" always executes, paused or not.
 *
 * POST /api/dev/scans/pause  → { paused: true }
 * POST /api/dev/scans/resume → { paused: false }
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { isScheduledScansPaused, setScheduledScansPaused } from "../lib/monitor-executor.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "engine.monitor" });

const router: IRouter = Router();

router.post("/dev/scans/pause", (_req: Request, res: Response) => {
  setScheduledScansPaused(true);
  log.info({}, "dev-scan-pause: scheduled scans paused");
  res.json({ paused: isScheduledScansPaused() });
});

router.post("/dev/scans/resume", (_req: Request, res: Response) => {
  setScheduledScansPaused(false);
  log.info({}, "dev-scan-pause: scheduled scans resumed");
  res.json({ paused: isScheduledScansPaused() });
});

router.get("/dev/scans/pause-state", (_req: Request, res: Response) => {
  res.json({ paused: isScheduledScansPaused() });
});

export default router;
