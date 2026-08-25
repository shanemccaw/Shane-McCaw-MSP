/**
 * Admin — Customer-Tenant Alert Rules (Git #1278)
 *
 * The admin rule-definition surface for CUSTOMER-tenant alert conditions — the
 * catalog that determines "what even raises a customer-facing alert", which
 * #1276's customer Alert Preferences page then filters delivery against. Sibling
 * of admin-observability.ts's /alert-rules endpoints (which manage the MSP-ops
 * catalog); this one drives `customer_tenant_alert_rules` / `_events` and the
 * per-tenant customer-tenant-alert-engine.ts.
 *
 *   GET    /api/admin/customer-alert-rules            — list the catalog
 *   POST   /api/admin/customer-alert-rules            — create a rule
 *   PATCH  /api/admin/customer-alert-rules/:id        — update a rule
 *   DELETE /api/admin/customer-alert-rules/:id        — delete a rule
 *   GET    /api/admin/customer-alert-events           — recent firings (newest first)
 *   PATCH  /api/admin/customer-alert-events/:id/resolve — acknowledge/resolve
 *   POST   /api/admin/customer-alert-rules/:id/test   — synthetic admin test alert
 *   POST   /api/admin/customer-alert-rules/evaluate   — run one evaluation pass now
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();
const log = logger.child({ channel: "notification" });

// ── GET /api/admin/customer-alert-rules ───────────────────────────────────────

router.get("/admin/customer-alert-rules", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, rule_key, label, description, condition_type, alert_category, threshold,
             window_minutes, severity, enabled, delivery_admin_email, delivery_admin_push,
             notify_customer, cooldown_minutes, deep_link_path, admin_deep_link_path,
             detector_status, source, updated_at
      FROM customer_tenant_alert_rules
      ORDER BY alert_category ASC, severity DESC, rule_key ASC
    `);
    res.json({
      rules: result.rows.map((r) => ({
        id:                r.id,
        ruleKey:           r.rule_key,
        label:             r.label,
        description:       r.description,
        conditionType:     r.condition_type,
        alertCategory:     r.alert_category,
        threshold:         r.threshold,
        windowMinutes:     r.window_minutes,
        severity:          r.severity,
        enabled:           r.enabled,
        deliveryAdminEmail: r.delivery_admin_email,
        deliveryAdminPush:  r.delivery_admin_push,
        notifyCustomer:     r.notify_customer,
        cooldownMinutes:   r.cooldown_minutes,
        deepLinkPath:      r.deep_link_path,
        adminDeepLinkPath: r.admin_deep_link_path,
        detectorStatus:    r.detector_status,
        source:            r.source,
        updatedAt:         r.updated_at,
      })),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/customer-alert-rules failed");
    res.status(500).json({ error: "Failed to fetch customer alert rules" });
  }
});

// ── POST /api/admin/customer-alert-rules ──────────────────────────────────────

router.post("/admin/customer-alert-rules", requireAdmin, async (req: Request, res: Response) => {
  const {
    ruleKey, label, description, conditionType, alertCategory, threshold, windowMinutes,
    severity, deliveryAdminEmail, deliveryAdminPush, notifyCustomer, cooldownMinutes,
    deepLinkPath, adminDeepLinkPath, detectorStatus, source,
  } = req.body as Record<string, unknown>;

  if (!ruleKey || !label || !conditionType || !alertCategory || !severity) {
    res.status(400).json({ error: "ruleKey, label, conditionType, alertCategory, severity are required" });
    return;
  }

  try {
    const result = await pool.query<{ id: number }>(`
      INSERT INTO customer_tenant_alert_rules
        (rule_key, label, description, condition_type, alert_category, threshold, window_minutes,
         severity, enabled, delivery_admin_email, delivery_admin_push, notify_customer,
         cooldown_minutes, deep_link_path, admin_deep_link_path, detector_status, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
    `, [
      ruleKey, label, description ?? null, conditionType, alertCategory,
      Number(threshold ?? 1), Number(windowMinutes ?? 1440), severity,
      deliveryAdminEmail !== false, deliveryAdminPush !== false, notifyCustomer !== false,
      Number(cooldownMinutes ?? 1440), deepLinkPath ?? null, adminDeepLinkPath ?? null,
      (detectorStatus as string) ?? "live", source ?? null,
    ]);
    res.status(201).json({ id: result.rows[0]?.id });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") {
      res.status(409).json({ error: "A customer alert rule with that key already exists" });
      return;
    }
    log.error({ err }, "POST /admin/customer-alert-rules failed");
    res.status(500).json({ error: "Failed to create customer alert rule" });
  }
});

// ── PATCH /api/admin/customer-alert-rules/:id ─────────────────────────────────

router.patch("/admin/customer-alert-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const fields = req.body as Record<string, unknown>;
  const keyMap: Record<string, string> = {
    label: "label", description: "description", threshold: "threshold",
    windowMinutes: "window_minutes", severity: "severity", enabled: "enabled",
    alertCategory: "alert_category",
    deliveryAdminEmail: "delivery_admin_email", deliveryAdminPush: "delivery_admin_push",
    notifyCustomer: "notify_customer", cooldownMinutes: "cooldown_minutes",
    deepLinkPath: "deep_link_path", adminDeepLinkPath: "admin_deep_link_path",
    detectorStatus: "detector_status", source: "source",
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  for (const [camel, pg] of Object.entries(keyMap)) {
    if (camel in fields) { sets.push(`${pg} = $${idx}`); vals.push(fields[camel]); idx++; }
  }
  if (sets.length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const result = await pool.query(
      `UPDATE customer_tenant_alert_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id`,
      vals,
    );
    if (!result.rows.length) { res.status(404).json({ error: "Customer alert rule not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "PATCH /admin/customer-alert-rules/:id failed");
    res.status(500).json({ error: "Failed to update customer alert rule" });
  }
});

// ── DELETE /api/admin/customer-alert-rules/:id ────────────────────────────────

router.delete("/admin/customer-alert-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await pool.query(`DELETE FROM customer_tenant_alert_rules WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows.length) { res.status(404).json({ error: "Customer alert rule not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "DELETE /admin/customer-alert-rules/:id failed");
    res.status(500).json({ error: "Failed to delete customer alert rule" });
  }
});

// ── GET /api/admin/customer-alert-events ──────────────────────────────────────

router.get("/admin/customer-alert-events", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
    const unresolvedOnly = req.query["unresolvedOnly"] === "true";
    const whereClause = unresolvedOnly ? "WHERE ae.resolved_at IS NULL" : "";
    const result = await pool.query(`
      SELECT ae.id, ae.alert_event_id, ae.rule_id, ae.rule_key, ae.alert_category,
             ae.severity, ae.customer_id, ae.msp_id, ae.tenant_id, ae.condition_value,
             ae.summary, ae.deep_link_path, ae.admin_deep_link_path,
             ae.delivered_admin_email, ae.delivered_admin_push, ae.customer_delivery_status,
             ae.customer_delivered_at, ae.resolved_at, ae.resolved_by, ae.fired_at,
             ar.label AS rule_label, t.customer_name
      FROM customer_tenant_alert_events ae
      LEFT JOIN customer_tenant_alert_rules ar ON ar.id = ae.rule_id
      LEFT JOIN tenants t ON t.id = ae.customer_id
      ${whereClause}
      ORDER BY ae.fired_at DESC
      LIMIT $1
    `, [limit]);
    res.json({
      events: result.rows.map((r) => ({
        id:                r.id,
        alertEventId:      r.alert_event_id,
        ruleId:            r.rule_id,
        ruleKey:           r.rule_key,
        ruleLabel:         r.rule_label,
        alertCategory:     r.alert_category,
        severity:          r.severity,
        customerId:        r.customer_id,
        customerName:      r.customer_name,
        mspId:             r.msp_id,
        tenantId:          r.tenant_id,
        conditionValue:    r.condition_value,
        summary:           r.summary,
        deepLinkPath:      r.deep_link_path,
        adminDeepLinkPath: r.admin_deep_link_path,
        deliveredAdminEmail: r.delivered_admin_email,
        deliveredAdminPush:  r.delivered_admin_push,
        customerDeliveryStatus: r.customer_delivery_status,
        customerDeliveredAt: r.customer_delivered_at,
        resolvedAt:        r.resolved_at,
        resolvedBy:        r.resolved_by,
        firedAt:           r.fired_at,
      })),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/customer-alert-events failed");
    res.status(500).json({ error: "Failed to fetch customer alert events" });
  }
});

// ── PATCH /api/admin/customer-alert-events/:id/resolve ────────────────────────

router.patch("/admin/customer-alert-events/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await pool.query(
      `UPDATE customer_tenant_alert_events
       SET resolved_at = NOW(), resolved_by = $2
       WHERE id = $1 AND resolved_at IS NULL RETURNING id`,
      [id, (req as unknown as Record<string, unknown>)["userId"] ?? null],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Customer alert event not found or already resolved" }); return; }
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "PATCH /admin/customer-alert-events/:id/resolve failed");
    res.status(500).json({ error: "Failed to resolve customer alert event" });
  }
});

// ── POST /api/admin/customer-alert-rules/:id/test ─────────────────────────────
// Fires a synthetic admin test alert for a rule (no cooldown, no real condition)
// to verify admin email/push delivery. Does NOT touch the customer seam.

router.post("/admin/customer-alert-rules/:id/test", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const ruleRes = await pool.query<{
      rule_key: string; label: string; alert_category: string; severity: string;
      delivery_admin_email: boolean; delivery_admin_push: boolean; admin_deep_link_path: string | null;
    }>(
      `SELECT rule_key, label, alert_category, severity, delivery_admin_email,
              delivery_admin_push, admin_deep_link_path
       FROM customer_tenant_alert_rules WHERE id = $1`,
      [id],
    );
    const rule = ruleRes.rows[0];
    if (!rule) { res.status(404).json({ error: "Customer alert rule not found" }); return; }

    const summary = `[TEST] Synthetic test alert for "${rule.label}". No real tenant condition fired.`;
    const evtRes = await pool.query<{ id: number }>(
      `INSERT INTO customer_tenant_alert_events
         (rule_id, rule_key, alert_category, severity, customer_id, condition_value, summary,
          admin_deep_link_path, customer_delivery_status)
       VALUES ($1,$2,$3,$4,0,0,$5,$6,'skipped')
       RETURNING id`,
      [id, rule.rule_key, rule.alert_category, rule.severity, summary, rule.admin_deep_link_path],
    );
    const eventId = evtRes.rows[0]?.id;
    if (!eventId) { res.status(500).json({ error: "Failed to create test event" }); return; }

    const { sendMailViaGraph, graphCredentialsPresent } = await import("../lib/graph");
    const { sendWebPushToAdmins } = await import("../lib/web-push");
    let emailOk = false;
    let pushOk = false;

    const mailUserId = process.env.GRAPH_MAIL_USER_ID;
    if (rule.delivery_admin_email && graphCredentialsPresent() && mailUserId) {
      try {
        await sendMailViaGraph({
          fromUserId: mailUserId,
          to: mailUserId,
          subject: `[TEST ${rule.severity.toUpperCase()}] Customer Alert: ${rule.label}`,
          htmlBody: `<p>${summary}</p>`,
        });
        emailOk = true;
      } catch (err) { log.warn({ err }, "customer-alert test: email delivery failed"); }
    }
    if (rule.delivery_admin_push) {
      try {
        await sendWebPushToAdmins({ title: `[TEST] ${rule.label}`, body: summary, linkPath: rule.admin_deep_link_path ?? undefined });
        pushOk = true;
      } catch (err) { log.warn({ err }, "customer-alert test: push delivery failed"); }
    }

    await pool.query(
      `UPDATE customer_tenant_alert_events SET delivered_admin_email=$1, delivered_admin_push=$2 WHERE id=$3`,
      [emailOk, pushOk, eventId],
    );
    res.json({ ok: true, eventId, emailOk, pushOk });
  } catch (err) {
    log.error({ err }, "POST /admin/customer-alert-rules/:id/test failed");
    res.status(500).json({ error: "Failed to send test alert" });
  }
});

// ── POST /api/admin/customer-alert-rules/evaluate ─────────────────────────────
// Run one evaluation pass immediately (also runs every 5 min on the schedule).

router.post("/admin/customer-alert-rules/evaluate", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { evaluateCustomerTenantRules } = await import("../lib/customer-tenant-alert-engine");
    await evaluateCustomerTenantRules();
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "POST /admin/customer-alert-rules/evaluate failed");
    res.status(500).json({ error: "Failed to run evaluation" });
  }
});

export default router;
