/**
 * MSP Platform Alert Engine
 *
 * Evaluates configurable alert rules against live DB state on a polling
 * interval and delivers alerts via Exchange Online email and browser push.
 *
 * Alert conditions:
 *   dlq_backlog       — unresolved DLQ items ≥ threshold
 *   billing_failure   — MSP subscriptions with active payment_failed_at
 *   sla_breach        — fulfillment_queue rows overdue past window
 *   event_bus_backlog — webhook delivery failures in last N minutes
 *   job_failure_rate  — background jobs in failed state in last N minutes
 *
 * De-duplication: a rule will not re-fire within its cooldownMinutes window
 * (checked against the most recent msp_alert_events row for that ruleId).
 *
 * Delivery:
 *   Email  → sendMailViaGraph (Exchange Online)
 *   Push   → sendWebPushToAdmins (VAPID browser push)
 */

import { db, pool } from "@workspace/db";
import {
  mspAlertRulesTable,
  mspAlertEventsTable,
} from "@workspace/db";
import { eq, and, isNull, desc, sql, gt } from "drizzle-orm";
import { logger } from "./logger";
import { sendWebPushToAdmins } from "./web-push";
import { sendMailViaGraph, graphCredentialsPresent } from "./graph";

// ── Admin Panel base URL for deep-links ──────────────────────────────────────

function getAdminPanelBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/admin-panel`;
  }
  return "http://localhost:80/admin-panel";
}

// ── Default rules seeded on first startup ────────────────────────────────────

interface DefaultRule {
  ruleKey: string;
  label: string;
  description: string;
  conditionType: "dlq_backlog" | "billing_failure" | "sla_breach" | "event_bus_backlog" | "job_failure_rate";
  threshold: number;
  windowMinutes: number;
  severity: "warning" | "critical";
  cooldownMinutes: number;
  deepLinkPath: string;
}

const DEFAULT_RULES: DefaultRule[] = [
  {
    ruleKey: "dlq_backlog_warning",
    label: "DLQ Backlog Warning",
    description: "DLQ has more unresolved items than threshold",
    conditionType: "dlq_backlog",
    threshold: 5,
    windowMinutes: 60,
    severity: "warning",
    cooldownMinutes: 60,
    deepLinkPath: "/system/dlq",
  },
  {
    ruleKey: "dlq_backlog_critical",
    label: "DLQ Backlog Critical",
    description: "DLQ has critically many unresolved items",
    conditionType: "dlq_backlog",
    threshold: 20,
    windowMinutes: 60,
    severity: "critical",
    cooldownMinutes: 30,
    deepLinkPath: "/system/dlq",
  },
  {
    ruleKey: "billing_failure_warning",
    label: "MSP Billing Failure",
    description: "One or more MSP platform subscriptions have an unresolved payment failure",
    conditionType: "billing_failure",
    threshold: 1,
    windowMinutes: 60,
    severity: "warning",
    cooldownMinutes: 240,
    deepLinkPath: "/system/platform-revenue",
  },
  {
    ruleKey: "sla_breach_warning",
    label: "SLA Breach Warning",
    description: "Fulfilment items are past their SLA deadline",
    conditionType: "sla_breach",
    threshold: 1,
    windowMinutes: 60,
    severity: "warning",
    cooldownMinutes: 120,
    deepLinkPath: "/delivery/projects",
  },
  {
    ruleKey: "event_bus_backlog_warning",
    label: "Webhook Delivery Failures",
    description: "Outbound webhook deliveries are failing at an elevated rate",
    conditionType: "event_bus_backlog",
    threshold: 10,
    windowMinutes: 30,
    severity: "warning",
    cooldownMinutes: 60,
    deepLinkPath: "/system/observability",
  },
  {
    ruleKey: "job_failure_rate_warning",
    label: "Background Job Failures",
    description: "Background jobs are failing at an elevated rate",
    conditionType: "job_failure_rate",
    threshold: 5,
    windowMinutes: 30,
    severity: "warning",
    cooldownMinutes: 60,
    deepLinkPath: "/system/observability",
  },
];

// ── Table bootstrapping (idempotent via pool.query) ───────────────────────────

async function ensureAlertTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS msp_alert_rules (
      id                  SERIAL PRIMARY KEY,
      rule_key            TEXT NOT NULL UNIQUE,
      label               TEXT NOT NULL,
      description         TEXT,
      condition_type      TEXT NOT NULL,
      threshold           INTEGER NOT NULL DEFAULT 5,
      window_minutes      INTEGER NOT NULL DEFAULT 60,
      severity            TEXT NOT NULL DEFAULT 'warning',
      enabled             BOOLEAN NOT NULL DEFAULT true,
      delivery_email      BOOLEAN NOT NULL DEFAULT true,
      delivery_push       BOOLEAN NOT NULL DEFAULT true,
      cooldown_minutes    INTEGER NOT NULL DEFAULT 60,
      deep_link_path      TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS msp_alert_events (
      id                  SERIAL PRIMARY KEY,
      alert_event_id      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      rule_id             INTEGER NOT NULL REFERENCES msp_alert_rules(id) ON DELETE CASCADE,
      rule_key            TEXT NOT NULL,
      severity            TEXT NOT NULL,
      condition_value     INTEGER NOT NULL,
      summary             TEXT NOT NULL,
      deep_link_path      TEXT,
      msp_id              INTEGER,
      delivered_email     BOOLEAN NOT NULL DEFAULT false,
      delivered_push      BOOLEAN NOT NULL DEFAULT false,
      resolved_at         TIMESTAMPTZ,
      resolved_by         INTEGER,
      fired_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS msp_alert_events_rule_id_idx ON msp_alert_events (rule_id);
    CREATE INDEX IF NOT EXISTS msp_alert_events_fired_at_idx ON msp_alert_events (fired_at);
    CREATE INDEX IF NOT EXISTS msp_alert_rules_condition_type_idx ON msp_alert_rules (condition_type);
  `);
}

// ── Seed default rules ────────────────────────────────────────────────────────

async function seedDefaultRules(): Promise<void> {
  for (const rule of DEFAULT_RULES) {
    await pool.query(
      `INSERT INTO msp_alert_rules
         (rule_key, label, description, condition_type, threshold, window_minutes,
          severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,true,$8,$9)
       ON CONFLICT (rule_key) DO NOTHING`,
      [
        rule.ruleKey, rule.label, rule.description, rule.conditionType,
        rule.threshold, rule.windowMinutes, rule.severity,
        rule.cooldownMinutes, rule.deepLinkPath,
      ],
    );
  }
}

// ── Condition evaluators ──────────────────────────────────────────────────────

async function evalDlqBacklog(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM msp_dlq_store WHERE resolved_at IS NULL`,
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

async function evalBillingFailure(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM msp_subscriptions WHERE payment_failed_at IS NOT NULL AND dunning_state IS DISTINCT FROM 'archival_flagged'`,
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

async function evalSlaBreaches(): Promise<number> {
  // Count unresolved SLA breaches in the last 24 hours
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM sla_breaches
     WHERE resolved_at IS NULL
       AND created_at > NOW() - INTERVAL '24 hours'`,
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

async function evalEventBusBacklog(windowMinutes: number): Promise<number> {
  // Count failed outbound webhook deliveries as a proxy for event-bus backlog
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM outbound_webhook_deliveries
     WHERE status = 'failed'
       AND created_at > NOW() - ($1 * INTERVAL '1 minute')`,
    [windowMinutes],
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

async function evalJobFailureRate(windowMinutes: number): Promise<number> {
  // Count failed portal workflow runs as a proxy for background job failures
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM portal_wf_runs
     WHERE status = 'failed'
       AND created_at > NOW() - ($1 * INTERVAL '1 minute')`,
    [windowMinutes],
  ).catch(() => ({ rows: [{ n: "0" }] }));
  return parseInt((res as { rows: Array<{ n: string }> }).rows[0]?.n ?? "0", 10);
}

async function getConditionValue(
  conditionType: string,
  windowMinutes: number,
): Promise<number> {
  try {
    switch (conditionType) {
      case "dlq_backlog":        return await evalDlqBacklog();
      case "billing_failure":    return await evalBillingFailure();
      case "sla_breach":         return await evalSlaBreaches();
      case "event_bus_backlog":  return await evalEventBusBacklog(windowMinutes);
      case "job_failure_rate":   return await evalJobFailureRate(windowMinutes);
      default:                   return 0;
    }
  } catch (err) {
    logger.warn({ err, conditionType }, "alert-engine: condition eval failed");
    return 0;
  }
}

// ── Cooldown check ────────────────────────────────────────────────────────────

async function isInCooldown(ruleId: number, cooldownMinutes: number): Promise<boolean> {
  const res = await pool.query<{ fired_at: string }>(
    `SELECT fired_at FROM msp_alert_events
     WHERE rule_id = $1
       AND fired_at > NOW() - ($2 * INTERVAL '1 minute')
     ORDER BY fired_at DESC
     LIMIT 1`,
    [ruleId, cooldownMinutes],
  );
  return res.rows.length > 0;
}

// ── Alert delivery ────────────────────────────────────────────────────────────

function buildAlertEmailHtml(opts: {
  label: string;
  summary: string;
  severity: string;
  deepLinkPath: string | null;
  baseUrl: string;
}): string {
  const color = opts.severity === "critical" ? "#DC2626" : "#D97706";
  const badgeLabel = opts.severity.toUpperCase();
  const deepLink = opts.deepLinkPath
    ? `<p style="margin-top:16px"><a href="${opts.baseUrl}${opts.deepLinkPath}" style="background:#0078D4;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:14px">View in Admin Panel →</a></p>`
    : "";

  return `<!DOCTYPE html>
<html>
<body style="font-family:Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;padding:24px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;letter-spacing:.05em">${badgeLabel}</span>
      <h2 style="margin:0;font-size:16px;color:#0a2540">${opts.label}</h2>
    </div>
    <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px">${opts.summary}</p>
    ${deepLink}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0" />
    <p style="color:#a0aec0;font-size:12px;margin:0">
      MSP Platform Alert Engine &mdash; ${new Date().toUTCString()}
    </p>
  </div>
</body>
</html>`;
}

async function deliverAlert(opts: {
  eventId: number;
  ruleKey: string;
  label: string;
  summary: string;
  severity: string;
  deepLinkPath: string | null;
  deliveryEmail: boolean;
  deliveryPush: boolean;
}): Promise<{ email: boolean; push: boolean }> {
  const baseUrl = getAdminPanelBaseUrl();
  let emailOk = false;
  let pushOk = false;

  if (opts.deliveryEmail && graphCredentialsPresent()) {
    const mailUserId = process.env.GRAPH_MAIL_USER_ID;
    if (mailUserId) {
      try {
        await sendMailViaGraph({
          fromUserId: mailUserId,
          to: mailUserId,
          subject: `[${opts.severity.toUpperCase()}] MSP Alert: ${opts.label}`,
          htmlBody: buildAlertEmailHtml({
            label: opts.label,
            summary: opts.summary,
            severity: opts.severity,
            deepLinkPath: opts.deepLinkPath,
            baseUrl,
          }),
        });
        emailOk = true;
      } catch (err) {
        logger.warn({ err, ruleKey: opts.ruleKey }, "alert-engine: email delivery failed");
      }
    }
  }

  if (opts.deliveryPush) {
    try {
      await sendWebPushToAdmins({
        title: `[${opts.severity.toUpperCase()}] ${opts.label}`,
        body: opts.summary,
        linkPath: opts.deepLinkPath ?? undefined,
      });
      pushOk = true;
    } catch (err) {
      logger.warn({ err, ruleKey: opts.ruleKey }, "alert-engine: push delivery failed");
    }
  }

  // Update delivery tracking on the event row
  if (emailOk || pushOk) {
    await pool.query(
      `UPDATE msp_alert_events
       SET delivered_email = $1, delivered_push = $2
       WHERE id = $3`,
      [emailOk, pushOk, opts.eventId],
    );
  }

  return { email: emailOk, push: pushOk };
}

// ── Main evaluation loop ──────────────────────────────────────────────────────

async function evaluateRules(): Promise<void> {
  const rulesRes = await pool.query<{
    id: number;
    rule_key: string;
    label: string;
    condition_type: string;
    threshold: number;
    window_minutes: number;
    severity: string;
    delivery_email: boolean;
    delivery_push: boolean;
    cooldown_minutes: number;
    deep_link_path: string | null;
  }>(`SELECT id, rule_key, label, condition_type, threshold, window_minutes,
             severity, delivery_email, delivery_push, cooldown_minutes, deep_link_path
      FROM msp_alert_rules
      WHERE enabled = true`);

  for (const rule of rulesRes.rows) {
    try {
      const value = await getConditionValue(rule.condition_type, rule.window_minutes);
      if (value < rule.threshold) continue;

      const inCooldown = await isInCooldown(rule.id, rule.cooldown_minutes);
      if (inCooldown) continue;

      const summary = buildSummary(rule.condition_type, value, rule.window_minutes);

      const evtRes = await pool.query<{ id: number }>(
        `INSERT INTO msp_alert_events
           (rule_id, rule_key, severity, condition_value, summary, deep_link_path,
            delivered_email, delivered_push)
         VALUES ($1,$2,$3,$4,$5,$6,false,false)
         RETURNING id`,
        [rule.id, rule.rule_key, rule.severity, value, summary, rule.deep_link_path],
      );
      const eventId = evtRes.rows[0]?.id;
      if (!eventId) continue;

      logger.warn(
        { ruleKey: rule.rule_key, severity: rule.severity, value, threshold: rule.threshold },
        "alert-engine: alert fired",
      );

      const { email, push } = await deliverAlert({
        eventId,
        ruleKey: rule.rule_key,
        label: rule.label,
        summary,
        severity: rule.severity,
        deepLinkPath: rule.deep_link_path,
        deliveryEmail: rule.delivery_email,
        deliveryPush: rule.delivery_push,
      });

      logger.info(
        { ruleKey: rule.rule_key, eventId, email, push },
        "alert-engine: alert delivered",
      );
    } catch (err) {
      logger.error({ err, ruleKey: rule.rule_key }, "alert-engine: rule evaluation error");
    }
  }
}

function buildSummary(conditionType: string, value: number, windowMinutes: number): string {
  switch (conditionType) {
    case "dlq_backlog":
      return `DLQ has ${value} unresolved item${value !== 1 ? "s" : ""}.`;
    case "billing_failure":
      return `${value} MSP platform subscription${value !== 1 ? "s" : ""} have an unresolved payment failure.`;
    case "sla_breach":
      return `${value} fulfilment item${value !== 1 ? "s" : ""} are past their SLA deadline.`;
    case "event_bus_backlog":
      return `${value} outbound webhook deliveries failed in the last ${windowMinutes} minutes.`;
    case "job_failure_rate":
      return `${value} background job${value !== 1 ? "s" : ""} failed in the last ${windowMinutes} minutes.`;
    default:
      return `Alert condition "${conditionType}" triggered with value ${value}.`;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let alertInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the alert engine: ensure tables, seed default rules, start polling.
 * Safe to call multiple times — only one interval is started.
 */
export async function initAlertEngine(pollIntervalMs = 5 * 60 * 1000): Promise<void> {
  try {
    await ensureAlertTables();
    await seedDefaultRules();
    logger.info({ pollIntervalMs }, "alert-engine: initialized");
  } catch (err) {
    logger.warn({ err }, "alert-engine: init failed (non-fatal)");
    return;
  }

  if (alertInterval !== null) return;

  alertInterval = setInterval(() => {
    evaluateRules().catch((err: unknown) => {
      logger.warn({ err }, "alert-engine: evaluation cycle failed (non-fatal)");
    });
  }, pollIntervalMs);

  if (alertInterval.unref) alertInterval.unref();

  // Run once immediately after a short delay to let DB pool warm up
  setTimeout(() => {
    evaluateRules().catch((err: unknown) => {
      logger.warn({ err }, "alert-engine: initial evaluation failed (non-fatal)");
    });
  }, 15_000);
}

export function stopAlertEngine(): void {
  if (alertInterval !== null) {
    clearInterval(alertInterval);
    alertInterval = null;
  }
}
