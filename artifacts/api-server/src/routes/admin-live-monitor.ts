/**
 * admin-live-monitor.ts
 *
 * Admin routes for the Live Monitor Engine (Mode B) — subscription health
 * and recent critical-change events from the O365 Management Activity API.
 *
 * Routes:
 *   GET  /api/admin/live-monitor/subscriptions
 *   GET  /api/admin/live-monitor/subscriptions/:tenantId/:contentType
 *   POST /api/admin/live-monitor/subscriptions/:tenantId/:contentType/reset-watermark
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool } from "@workspace/db";
import { activitySubscriptionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── List all activity subscriptions ───────────────────────────────────────────

router.get("/admin/live-monitor/subscriptions", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(activitySubscriptionsTable)
      .orderBy(desc(activitySubscriptionsTable.updatedAt));

    // Enrich with tenant display names where available
    const tenantIds = [...new Set(rows.map(r => r.tenantId))];
    let tenantNames: Record<string, string> = {};

    if (tenantIds.length > 0) {
      try {
        const nameRows = await pool.query<{ tenant_id: string; tenant_display_name: string }>(
          `SELECT tenant_id, COALESCE(tenant_display_name, tenant_id) AS tenant_display_name
           FROM tenant_consent
           WHERE tenant_id = ANY($1)`,
          [tenantIds],
        );
        for (const r of nameRows.rows) {
          tenantNames[r.tenant_id] = r.tenant_display_name;
        }
      } catch {
        // tenant_consent may not have display names — non-fatal
      }
    }

    const enriched = rows.map(r => ({
      ...r,
      tenantDisplayName: tenantNames[r.tenantId] ?? r.tenantId,
      // Compute expires-in (seconds) when expiresAt is present
      expiresInSeconds: r.expiresAt ? Math.floor((r.expiresAt.getTime() - Date.now()) / 1000) : null,
    }));

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "admin-live-monitor: list subscriptions failed");
    res.status(500).json({ error: "Failed to load subscriptions" });
  }
});

// ── Get single subscription detail ────────────────────────────────────────────

router.get(
  "/admin/live-monitor/subscriptions/:tenantId/:contentType",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const tenantId    = String(req.params["tenantId"]);
    const contentType = String(req.params["contentType"]);
    try {
      const rows = await db
        .select()
        .from(activitySubscriptionsTable)
        .where(
          and(
            eq(activitySubscriptionsTable.tenantId, tenantId),
            eq(activitySubscriptionsTable.contentType, contentType),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        res.status(404).json({ error: "Subscription not found" });
        return;
      }

      res.json(rows[0]);
    } catch (err) {
      logger.error({ err, tenantId, contentType }, "admin-live-monitor: get subscription failed");
      res.status(500).json({ error: "Failed to load subscription" });
    }
  },
);

// ── Reset watermark — forces next poll cycle to fetch all events from now-6h ──

router.post(
  "/admin/live-monitor/subscriptions/:tenantId/:contentType/reset-watermark",
  requireAdmin,
  async (req: Request, res: Response) => {
    const tenantId    = String(req.params["tenantId"]);
    const contentType = String(req.params["contentType"]);
    const lookbackHours = Number((req.body as { lookbackHours?: unknown }).lookbackHours) || 1;
    try {
      const newWatermark = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const updated = await db
        .update(activitySubscriptionsTable)
        .set({ pollWatermark: newWatermark, updatedAt: new Date() })
        .where(
          and(
            eq(activitySubscriptionsTable.tenantId, tenantId),
            eq(activitySubscriptionsTable.contentType, contentType),
          ),
        );

      const count = updated.rowCount ?? 0;
      logger.info({ tenantId, contentType, newWatermark, lookbackHours }, "admin-live-monitor: watermark reset");
      res.json({ ok: true, newWatermark: newWatermark.toISOString(), rowsUpdated: count });
    } catch (err) {
      logger.error({ err, tenantId, contentType }, "admin-live-monitor: watermark reset failed");
      res.status(500).json({ error: "Failed to reset watermark" });
    }
  },
);

export default router;
