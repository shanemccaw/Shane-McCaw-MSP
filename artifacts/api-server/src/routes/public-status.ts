/**
 * Public Status Page — platform's-own-uptime.
 *
 * GET /api/status — unauthenticated. Derives a sanitized overall state from
 * the same underlying signals admin-observability.ts's heartbeats use (cron
 * loop health, API heartbeat), but returns ONLY the boolean/enum state —
 * never raw internals like queue depths, DB stats, or tenant-identifying
 * data. Also returns the last 90 days of platform_incidents, most recent
 * first.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool, platformIncidentsTable } from "@workspace/db";
import { and, desc, gte } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "system.core" });

router.get("/status", async (_req: Request, res: Response) => {
  try {
    // API engine heartbeat is healthy because we successfully process this request
    // (same reasoning admin-observability.ts's apiEngineHeartbeat uses).
    const apiHealthy = true;

    const cronHealthStats = await pool
      .query<{ max_delay_seconds: number }>(`
        SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) as max_delay_seconds
        FROM msp_job_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .catch(() => ({ rows: [] as { max_delay_seconds: number }[] }));

    const maxQueueDelay = cronHealthStats.rows[0]?.max_delay_seconds ?? 0;
    const cronHealthy = maxQueueDelay <= 300;

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const incidents = await db
      .select({
        id: platformIncidentsTable.id,
        title: platformIncidentsTable.title,
        description: platformIncidentsTable.description,
        severity: platformIncidentsTable.severity,
        status: platformIncidentsTable.status,
        startedAt: platformIncidentsTable.startedAt,
        resolvedAt: platformIncidentsTable.resolvedAt,
      })
      .from(platformIncidentsTable)
      .where(and(gte(platformIncidentsTable.startedAt, ninetyDaysAgo)))
      .orderBy(desc(platformIncidentsTable.startedAt));

    const hasUnresolvedCritical = incidents.some(
      (i) => i.status !== "resolved" && i.severity === "critical",
    );
    const hasUnresolved = incidents.some((i) => i.status !== "resolved");

    let overall: "operational" | "degraded" | "outage" = "operational";
    if (!apiHealthy || hasUnresolvedCritical) {
      overall = "outage";
    } else if (!cronHealthy || hasUnresolved) {
      overall = "degraded";
    }

    res.json({
      status: overall,
      incidents,
    });
  } catch (err) {
    log.error({ err }, "GET /status failed");
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

export default router;
