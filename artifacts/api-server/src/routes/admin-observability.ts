/**
 * Admin Observability Routes
 *
 * Provides dashboard data endpoints for the Admin Panel observability section:
 *   GET  /api/admin/observability/service-health    — job queue, DLQ, webhook stats
 *   GET  /api/admin/observability/event-bus         — event store counts by type/window
 *   GET  /api/admin/observability/platform-revenue  — MRR, churn, per-MSP revenue
 *   GET  /api/admin/observability/alert-rules       — list alert rules
 *   POST /api/admin/observability/alert-rules       — create alert rule
 *   PATCH /api/admin/observability/alert-rules/:id  — update alert rule
 *   DELETE /api/admin/observability/alert-rules/:id — delete alert rule
 *   GET  /api/admin/observability/alert-events      — recent alert events (newest first)
 *   PATCH /api/admin/observability/alert-events/:id/resolve — resolve alert
 *   POST /api/admin/observability/alert-rules/:id/test — trigger a synthetic test alert
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── GET /api/admin/observability/service-health ───────────────────────────────

router.get("/admin/observability/service-health", requireAdmin, async (req: Request, res: Response) => {
  try {
    const [jobStats, dlqStats, webhookStats, portalWfStats] = await Promise.all([
      // Background job queue stats
      pool.query<{ status: string; n: string }>(`
        SELECT status, COUNT(*)::text AS n
        FROM msp_job_queue
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
      `),
      // DLQ stats
      pool.query<{ resolved: boolean; n: string }>(`
        SELECT (resolved_at IS NOT NULL) AS resolved, COUNT(*)::text AS n
        FROM msp_dlq_store
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY resolved
      `),
      // Webhook delivery stats
      pool.query<{ status: string; n: string }>(`
        SELECT status, COUNT(*)::text AS n
        FROM outbound_webhook_deliveries
        WHERE attempted_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
      `),
      // Portal workflow run stats (last 24h)
      pool.query<{ status: string; n: string }>(`
        SELECT status, COUNT(*)::text AS n
        FROM portal_wf_runs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
      `).catch(() => ({ rows: [] })),
    ]);

    const jobMap: Record<string, number> = {};
    for (const row of jobStats.rows) jobMap[row.status] = parseInt(row.n, 10);

    const dlqUnresolved = parseInt(
      dlqStats.rows.find((r) => !r.resolved)?.n ?? "0",
      10,
    );
    const dlqResolved = parseInt(
      dlqStats.rows.find((r) => r.resolved)?.n ?? "0",
      10,
    );

    const webhookMap: Record<string, number> = {};
    for (const row of webhookStats.rows) webhookMap[row.status] = parseInt(row.n, 10);

    const portalMap: Record<string, number> = {};
    for (const row of (portalWfStats as { rows: Array<{ status: string; n: string }> }).rows) {
      portalMap[row.status] = parseInt(row.n, 10);
    }

    res.json({
      jobQueue: {
        pending:   jobMap["pending"]   ?? 0,
        running:   jobMap["running"]   ?? 0,
        completed: jobMap["completed"] ?? 0,
        failed:    jobMap["failed"]    ?? 0,
        cancelled: jobMap["cancelled"] ?? 0,
      },
      dlq: {
        unresolved: dlqUnresolved,
        resolvedLast7d: dlqResolved,
      },
      webhooks: {
        succeeded: webhookMap["succeeded"] ?? 0,
        failed:    webhookMap["failed"]    ?? 0,
        pending:   webhookMap["pending"]   ?? 0,
      },
      portalWorkflows: {
        running:   portalMap["running"]   ?? 0,
        completed: portalMap["completed"] ?? 0,
        failed:    portalMap["failed"]    ?? 0,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/observability/service-health failed");
    res.status(500).json({ error: "Failed to fetch service health" });
  }
});

// ── GET /api/admin/observability/event-bus ────────────────────────────────────

router.get("/admin/observability/event-bus", requireAdmin, async (req: Request, res: Response) => {
  try {
    const windowHours = parseInt(String(req.query["hours"] ?? "24"), 10);

    const [totalRes, byTypeRes, timeSeriesRes] = await Promise.all([
      pool.query<{ n: string }>(`
        SELECT COUNT(*)::text AS n
        FROM msp_event_store
        WHERE occurred_at > NOW() - ($1 * INTERVAL '1 hour')
      `, [windowHours]),
      pool.query<{ event_type: string; n: string }>(`
        SELECT event_type, COUNT(*)::text AS n
        FROM msp_event_store
        WHERE occurred_at > NOW() - ($1 * INTERVAL '1 hour')
        GROUP BY event_type
        ORDER BY COUNT(*) DESC
        LIMIT 20
      `, [windowHours]),
      // Hourly event counts for the last 24 hours
      pool.query<{ hour: string; n: string }>(`
        SELECT DATE_TRUNC('hour', occurred_at) AS hour, COUNT(*)::text AS n
        FROM msp_event_store
        WHERE occurred_at > NOW() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour ASC
      `),
    ]);

    res.json({
      windowHours,
      totalEvents: parseInt(totalRes.rows[0]?.n ?? "0", 10),
      byType: byTypeRes.rows.map((r) => ({
        eventType: r.event_type,
        count: parseInt(r.n, 10),
      })),
      hourly: timeSeriesRes.rows.map((r) => ({
        hour: r.hour,
        count: parseInt(r.n, 10),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/observability/event-bus failed");
    res.status(500).json({ error: "Failed to fetch event bus stats" });
  }
});

// ── GET /api/admin/observability/platform-revenue ─────────────────────────────

router.get("/admin/observability/platform-revenue", requireAdmin, async (req: Request, res: Response) => {
  try {
    const [subStatsRes, mspCountRes, churned30dRes, mspRevenueRes] = await Promise.all([
      // Subscription status breakdown
      pool.query<{ status: string; n: string; total_cents: string }>(`
        SELECT
          ms.status,
          COUNT(*)::text AS n,
          COALESCE(SUM(s.price_cents), 0)::text AS total_cents
        FROM msp_subscriptions ms
        JOIN services s ON s.id = ms.service_id
        WHERE ms.status NOT IN ('canceled')
        GROUP BY ms.status
      `).catch(() => ({ rows: [] })),

      // Total MSP count by status
      pool.query<{ status: string; n: string }>(`
        SELECT status, COUNT(*)::text AS n FROM msps GROUP BY status
      `),

      // MSPs that went from active -> canceled in the last 30 days (churn)
      pool.query<{ n: string }>(`
        SELECT COUNT(DISTINCT ms.msp_id)::text AS n
        FROM msp_subscriptions ms
        WHERE ms.status = 'canceled'
          AND ms.updated_at > NOW() - INTERVAL '30 days'
      `).catch(() => ({ rows: [{ n: "0" }] })),

      // Per-MSP revenue snapshot
      pool.query<{ msp_name: string; plan_name: string; status: string; price_cents: string }>(`
        SELECT
          m.name AS msp_name,
          s.name AS plan_name,
          ms.status,
          COALESCE(s.price_cents, 0)::text AS price_cents
        FROM msp_subscriptions ms
        JOIN msps m ON m.id = ms.msp_id
        JOIN services s ON s.id = ms.service_id
        WHERE ms.status NOT IN ('canceled')
        ORDER BY COALESCE(s.price_cents, 0) DESC
        LIMIT 50
      `).catch(() => ({ rows: [] })),
    ]);

    // Compute MRR as sum of active subscription prices
    const activeSubs = (subStatsRes as { rows: Array<{ status: string; n: string; total_cents: string }> }).rows;
    const mrrCents = activeSubs
      .filter((r) => ["active", "trialing", "past_due"].includes(r.status))
      .reduce((sum, r) => sum + parseInt(r.total_cents, 10), 0);

    const mspMap: Record<string, number> = {};
    for (const row of mspCountRes.rows) mspMap[row.status] = parseInt(row.n, 10);

    res.json({
      mrrCents,
      mrrUsd: (mrrCents / 100).toFixed(2),
      churned30d: parseInt((churned30dRes as { rows: Array<{ n: string }> }).rows[0]?.n ?? "0", 10),
      subscriptionsByStatus: activeSubs.map((r) => ({
        status: r.status,
        count: parseInt(r.n, 10),
        totalCents: parseInt(r.total_cents, 10),
      })),
      mspsByStatus: mspMap,
      perMsp: (mspRevenueRes as { rows: Array<{ msp_name: string; plan_name: string; status: string; price_cents: string }> }).rows.map((r) => ({
        mspName: r.msp_name,
        planName: r.plan_name,
        status: r.status,
        priceCents: parseInt(r.price_cents, 10),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/observability/platform-revenue failed");
    res.status(500).json({ error: "Failed to fetch platform revenue" });
  }
});

// ── GET /api/admin/observability/alert-rules ──────────────────────────────────

router.get("/admin/observability/alert-rules", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<{
      id: number; rule_key: string; label: string; description: string | null;
      condition_type: string; threshold: number; window_minutes: number;
      severity: string; enabled: boolean; delivery_email: boolean;
      delivery_push: boolean; cooldown_minutes: number; deep_link_path: string | null;
      updated_at: string;
    }>(`
      SELECT id, rule_key, label, description, condition_type, threshold,
             window_minutes, severity, enabled, delivery_email, delivery_push,
             cooldown_minutes, deep_link_path, updated_at
      FROM msp_alert_rules
      ORDER BY severity DESC, rule_key ASC
    `);
    res.json({
      rules: result.rows.map((r) => ({
        id:              r.id,
        ruleKey:         r.rule_key,
        label:           r.label,
        description:     r.description,
        conditionType:   r.condition_type,
        threshold:       r.threshold,
        windowMinutes:   r.window_minutes,
        severity:        r.severity,
        enabled:         r.enabled,
        deliveryEmail:   r.delivery_email,
        deliveryPush:    r.delivery_push,
        cooldownMinutes: r.cooldown_minutes,
        deepLinkPath:    r.deep_link_path,
        updatedAt:       r.updated_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/observability/alert-rules failed");
    res.status(500).json({ error: "Failed to fetch alert rules" });
  }
});

// ── POST /api/admin/observability/alert-rules ─────────────────────────────────

router.post("/admin/observability/alert-rules", requireAdmin, async (req: Request, res: Response) => {
  const {
    ruleKey, label, description, conditionType, threshold,
    windowMinutes, severity, deliveryEmail, deliveryPush,
    cooldownMinutes, deepLinkPath,
  } = req.body as Record<string, unknown>;

  if (!ruleKey || !label || !conditionType || !severity) {
    res.status(400).json({ error: "ruleKey, label, conditionType, severity are required" });
    return;
  }

  try {
    const result = await pool.query<{ id: number }>(`
      INSERT INTO msp_alert_rules
        (rule_key, label, description, condition_type, threshold, window_minutes,
         severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11)
      RETURNING id
    `, [
      ruleKey, label, description ?? null, conditionType,
      Number(threshold ?? 5), Number(windowMinutes ?? 60),
      severity, deliveryEmail !== false, deliveryPush !== false,
      Number(cooldownMinutes ?? 60), deepLinkPath ?? null,
    ]);
    res.status(201).json({ id: result.rows[0]?.id });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "An alert rule with that key already exists" });
      return;
    }
    logger.error({ err }, "POST /admin/observability/alert-rules failed");
    res.status(500).json({ error: "Failed to create alert rule" });
  }
});

// ── PATCH /api/admin/observability/alert-rules/:id ────────────────────────────

router.patch("/admin/observability/alert-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const fields = req.body as Record<string, unknown>;
  const allowedKeys = [
    "label", "description", "threshold", "window_minutes", "severity",
    "enabled", "delivery_email", "delivery_push", "cooldown_minutes", "deep_link_path",
  ];

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  const keyMap: Record<string, string> = {
    label: "label", description: "description", threshold: "threshold",
    windowMinutes: "window_minutes", severity: "severity", enabled: "enabled",
    deliveryEmail: "delivery_email", deliveryPush: "delivery_push",
    cooldownMinutes: "cooldown_minutes", deepLinkPath: "deep_link_path",
  };

  for (const [camel, pg] of Object.entries(keyMap)) {
    if (camel in fields) {
      sets.push(`${pg} = $${idx}`);
      vals.push(fields[camel]);
      idx++;
    }
  }

  if (sets.length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const result = await pool.query(
      `UPDATE msp_alert_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id`,
      vals,
    );
    if (!result.rows.length) { res.status(404).json({ error: "Alert rule not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/observability/alert-rules/:id failed");
    res.status(500).json({ error: "Failed to update alert rule" });
  }
});

// ── DELETE /api/admin/observability/alert-rules/:id ───────────────────────────

router.delete("/admin/observability/alert-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await pool.query(
      `DELETE FROM msp_alert_rules WHERE id = $1 RETURNING id`, [id],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Alert rule not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/observability/alert-rules/:id failed");
    res.status(500).json({ error: "Failed to delete alert rule" });
  }
});

// ── GET /api/admin/observability/alert-events ─────────────────────────────────

router.get("/admin/observability/alert-events", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
    const unresolvedOnly = req.query["unresolvedOnly"] === "true";

    const whereClause = unresolvedOnly ? "WHERE ae.resolved_at IS NULL" : "";

    const result = await pool.query<{
      id: number; alert_event_id: string; rule_id: number; rule_key: string;
      severity: string; condition_value: number; summary: string;
      deep_link_path: string | null; msp_id: number | null;
      delivered_email: boolean; delivered_push: boolean;
      resolved_at: string | null; resolved_by: string | null;
      fired_at: string; rule_label: string | null; condition_type: string | null;
    }>(`
      SELECT ae.id, ae.alert_event_id, ae.rule_id, ae.rule_key,
             ae.severity, ae.condition_value, ae.summary, ae.deep_link_path,
             ae.msp_id, ae.delivered_email, ae.delivered_push,
             ae.resolved_at, ae.resolved_by, ae.fired_at,
             ar.label AS rule_label, ar.condition_type
      FROM msp_alert_events ae
      LEFT JOIN msp_alert_rules ar ON ar.id = ae.rule_id
      ${whereClause}
      ORDER BY ae.fired_at DESC
      LIMIT $1
    `, [limit]);

    res.json({
      events: result.rows.map((r) => ({
        id:             r.id,
        alertEventId:   r.alert_event_id,
        ruleId:         r.rule_id,
        ruleKey:        r.rule_key,
        ruleLabel:      r.rule_label,
        conditionType:  r.condition_type,
        severity:       r.severity,
        conditionValue: r.condition_value,
        summary:        r.summary,
        deepLinkPath:   r.deep_link_path,
        mspId:          r.msp_id,
        deliveredEmail: r.delivered_email,
        deliveredPush:  r.delivered_push,
        resolvedAt:     r.resolved_at,
        resolvedBy:     r.resolved_by,
        firedAt:        r.fired_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/observability/alert-events failed");
    res.status(500).json({ error: "Failed to fetch alert events" });
  }
});

// ── PATCH /api/admin/observability/alert-events/:id/resolve ───────────────────

router.patch("/admin/observability/alert-events/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await pool.query(
      `UPDATE msp_alert_events
       SET resolved_at = NOW(), resolved_by = $2
       WHERE id = $1 AND resolved_at IS NULL
       RETURNING id`,
      [id, (req as unknown as Record<string, unknown>)["userId"] ?? null],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Alert event not found or already resolved" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/observability/alert-events/:id/resolve failed");
    res.status(500).json({ error: "Failed to resolve alert event" });
  }
});

// ── POST /api/admin/observability/alert-rules/:id/test ────────────────────────
// Fires a synthetic test alert for a specific rule without checking the cooldown
// or the real condition value — used to verify email/push delivery is working.

router.post("/admin/observability/alert-rules/:id/test", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const ruleRes = await pool.query<{
      rule_key: string; label: string; severity: string;
      delivery_email: boolean; delivery_push: boolean; deep_link_path: string | null;
    }>(
      `SELECT rule_key, label, severity, delivery_email, delivery_push, deep_link_path
       FROM msp_alert_rules WHERE id = $1`,
      [id],
    );
    const rule = ruleRes.rows[0];
    if (!rule) { res.status(404).json({ error: "Alert rule not found" }); return; }

    const summary = `[TEST] This is a synthetic test alert for "${rule.label}". No real condition fired.`;

    const evtRes = await pool.query<{ id: number }>(
      `INSERT INTO msp_alert_events
         (rule_id, rule_key, severity, condition_value, summary, deep_link_path, delivered_email, delivered_push)
       VALUES ($1,$2,$3,0,$4,$5,false,false)
       RETURNING id`,
      [id, rule.rule_key, rule.severity, summary, rule.deep_link_path],
    );
    const eventId = evtRes.rows[0]?.id;
    if (!eventId) { res.status(500).json({ error: "Failed to create test event" }); return; }

    const { sendMailViaGraph, graphCredentialsPresent } = await import("../lib/graph");
    const { sendWebPushToAdmins } = await import("../lib/web-push");

    let emailOk = false;
    let pushOk = false;

    const mailUserId = process.env.GRAPH_MAIL_USER_ID;
    if (rule.delivery_email && graphCredentialsPresent() && mailUserId) {
      try {
        await sendMailViaGraph({
          fromUserId: mailUserId,
          to: mailUserId,
          subject: `[TEST ${rule.severity.toUpperCase()}] MSP Alert: ${rule.label}`,
          htmlBody: `<p>${summary}</p>`,
        });
        emailOk = true;
      } catch (err) {
        logger.warn({ err }, "alert test: email delivery failed");
      }
    }

    if (rule.delivery_push) {
      try {
        await sendWebPushToAdmins({
          title: `[TEST] ${rule.label}`,
          body: summary,
          linkPath: rule.deep_link_path ?? undefined,
        });
        pushOk = true;
      } catch (err) {
        logger.warn({ err }, "alert test: push delivery failed");
      }
    }

    await pool.query(
      `UPDATE msp_alert_events SET delivered_email=$1, delivered_push=$2 WHERE id=$3`,
      [emailOk, pushOk, eventId],
    );

    res.json({ ok: true, eventId, emailOk, pushOk });
  } catch (err) {
    logger.error({ err }, "POST /admin/observability/alert-rules/:id/test failed");
    res.status(500).json({ error: "Failed to send test alert" });
  }
});

export default router;
