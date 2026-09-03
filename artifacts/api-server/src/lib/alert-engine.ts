/**
 * MSP Platform Alert Engine
 *
 * Evaluates configurable alert rules against live DB state on a polling
 * interval and delivers alerts via Exchange Online email and browser push.
 *
 * Alert conditions:
 *   dlq_backlog          — unresolved DLQ items ≥ threshold
 *   billing_failure      — MSP subscriptions with active payment_failed_at
 *   sla_breach           — fulfillment_queue rows overdue past window
 *   event_bus_backlog    — webhook delivery failures in last N minutes
 *   job_failure_rate     — background jobs in failed state in last N minutes
 *   risk_review_overdue  — msp_risk_decisions rows whose review clock (#1507)
 *                          has lapsed (#1513). Distinct "review_lapsed"
 *                          severity — a lapsed review is not a threshold
 *                          breach, it means a customer believes a risk is
 *                          being actively managed and nobody has looked.
 *   policy_clearance_resolved — policy_decisions rows whose dependency-based
 *                          clearance (#1526) just resolved because a watched
 *                          licence SKU appeared in the tenant. "info"
 *                          severity — this is good news, not a failure.
 *   policy_review_overdue — policy_decisions (Git #2024) rows whose review
 *                          clock has lapsed — same contract as
 *                          risk_review_overdue, extended to Policy
 *                          Decisions' own table (#1527). Mutually exclusive
 *                          with policy_clearance_resolved on any one row: a
 *                          dependency-based row (#1526) always has
 *                          review_due_at NULL, so it is never touched here.
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
const log = logger.child({ channel: "engine.alert" });
import { sendWebPushToAdmins } from "./web-push";
import { sendMailViaGraph, graphCredentialsPresent } from "./graph";
import { SUBSCRIBED_SKU_CHECK_KEYS } from "./service-availability";

// ── Admin Panel base URL for deep-links ──────────────────────────────────────

function getAdminPanelBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/admin-panel`;
  }
  return "http://localhost:80/admin-panel";
}

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

// The lead time before a scheduled review counts as "due" rather than
// "on_track" — an operational reminder window, not a legal deadline (only
// `overdue`, i.e. past `review_due_at`, is what this rule alerts the MSP on).
const RISK_REVIEW_DUE_LEAD_DAYS = 14;

/**
 * Advances `msp_risk_decisions.review_state` (#1507's review clock) for every
 * still-`active` acceptance with a scheduled `review_due_at`, then returns the
 * count currently `overdue` — the value `risk_review_overdue` alerts on.
 *
 * This is the operational writer #1507 explicitly left unbuilt ("the
 * operational writer belongs to later sub-issues... #1513 overdue-review
 * alerting"). Three transitions, all idempotent (`IS DISTINCT FROM` guards so
 * re-running never touches `updated_at` on a row already in the right state):
 *   - past `review_due_at`                      → overdue
 *   - within RISK_REVIEW_DUE_LEAD_DAYS of it     → due
 *   - further out than that lead window          → on_track (covers a review
 *     pushed back out after being due/overdue)
 *
 * The acceptance's own `status` is never touched here — a lapsed review is a
 * flag on a still-active acceptance, never a lapsed acceptance (#1507).
 *
 * Also syncs `decision_state` (Policy Decisions' own lane, on rows where it is
 * already set — most `msp_risk_decisions` rows are plain risk acceptances and
 * leave it NULL, untouched) off the same clock, per #1527's design sentence:
 * "overdue reviews surface as an operational flag on a decision that remains
 * LIVE" — `due` mirrors a due review, `overdue` COLLAPSES back to `live`
 * (there is no fourth `overdue` value in POLICY_DECISION_STATES; that is the
 * point of #1527 — the decision never shows as lapsed, only the review does).
 */
async function advanceRiskReviewClock(): Promise<number> {
  await pool.query(
    `UPDATE msp_risk_decisions
        SET review_state = 'overdue', updated_at = NOW()
      WHERE status = 'active'
        AND review_due_at IS NOT NULL
        AND review_due_at < NOW()
        AND review_state IS DISTINCT FROM 'overdue'`,
  );
  await pool.query(
    `UPDATE msp_risk_decisions
        SET review_state = 'due', updated_at = NOW()
      WHERE status = 'active'
        AND review_due_at IS NOT NULL
        AND review_due_at >= NOW()
        AND review_due_at < NOW() + ($1 * INTERVAL '1 day')
        AND review_state IS DISTINCT FROM 'due'`,
    [RISK_REVIEW_DUE_LEAD_DAYS],
  );
  await pool.query(
    `UPDATE msp_risk_decisions
        SET review_state = 'on_track', updated_at = NOW()
      WHERE status = 'active'
        AND review_due_at IS NOT NULL
        AND review_due_at >= NOW() + ($1 * INTERVAL '1 day')
        AND review_state IS DISTINCT FROM 'on_track'`,
    [RISK_REVIEW_DUE_LEAD_DAYS],
  );
  await pool.query(
    `UPDATE msp_risk_decisions
        SET decision_state = 'due', updated_at = NOW()
      WHERE status = 'active'
        AND decision_state IS NOT NULL
        AND review_state = 'due'
        AND decision_state IS DISTINCT FROM 'due'`,
  );
  await pool.query(
    `UPDATE msp_risk_decisions
        SET decision_state = 'live', updated_at = NOW()
      WHERE status = 'active'
        AND decision_state IS NOT NULL
        AND review_state IN ('overdue', 'on_track')
        AND decision_state IS DISTINCT FROM 'live'`,
  );

  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM msp_risk_decisions
      WHERE status = 'active' AND review_state = 'overdue'`,
  );
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

/**
 * The observable half of #1526's dependency-based policy clearance: for every
 * still-unresolved `policy_decisions` row whose dependency IS something the
 * platform can watch (`clearance_trigger_type = 'license_sku'`), check the
 * tenant's most recently collected `/subscribedSkus` snapshot
 * (`tenant_check_item_details`, same source `readIntuneEntitlement()` in
 * `service-availability.ts` reads — no new Graph call) for the watched
 * `skuPartNumber`. The moment it is present, the decision resolves
 * immediately (#1526: "actionable immediately... rather than waiting for the
 * next scheduled review") rather than sitting until someone happens to look.
 *
 * `manual`-triggered rows are untouched here — they can only be cleared by a
 * human via `PATCH /api/portal/policy-register/:id/clearance/resolve`.
 *
 * Returns the count of decisions resolved in THIS run (not the total
 * outstanding) — a resolution is a one-off event to alert on, not a standing
 * backlog like `risk_review_overdue`'s count of currently-overdue rows.
 */
async function advancePolicyClearances(): Promise<number> {
  const pending = await pool.query<{
    id: number;
    tenant_id: string;
    clearance_trigger_sku_part_number: string;
  }>(
    `SELECT id, tenant_id, clearance_trigger_sku_part_number
       FROM policy_decisions
      WHERE clearance_trigger_type = 'license_sku'
        AND clearance_resolved_at IS NULL
        AND clearance_trigger_sku_part_number IS NOT NULL`,
  );

  let resolvedCount = 0;
  for (const row of pending.rows) {
    let items: unknown;
    let collectedAt: Date | null = null;
    try {
      const snapshot = await pool.query<{ items: unknown; collected_at: Date }>(
        `SELECT items, collected_at
           FROM tenant_check_item_details
          WHERE tenant_id = $1
            AND status = 'ok'
            AND items_omitted = false
            AND check_key = ANY($2::text[])
          ORDER BY collected_at DESC
          LIMIT 1`,
        [row.tenant_id, SUBSCRIBED_SKU_CHECK_KEYS as readonly string[]],
      );
      items = snapshot.rows[0]?.items;
      collectedAt = snapshot.rows[0]?.collected_at ?? null;
    } catch (err) {
      log.warn({ err, tenantId: row.tenant_id }, "alert-engine: policy clearance SKU lookup failed");
      continue;
    }
    if (!Array.isArray(items)) continue;

    const present = (items as Array<Record<string, unknown>>).some(
      (raw) => raw?.skuPartNumber === row.clearance_trigger_sku_part_number,
    );
    if (!present) continue;

    const note = `Auto-detected: ${row.clearance_trigger_sku_part_number} present in tenant` +
      (collectedAt ? `, collected ${collectedAt.toISOString()}.` : ".");

    const result = await pool.query(
      `UPDATE policy_decisions
          SET clearance_resolved_at = NOW(), clearance_resolved_note = $1, updated_at = NOW()
        WHERE id = $2
          AND clearance_resolved_at IS NULL`,
      [note, row.id],
    );
    if ((result.rowCount ?? 0) > 0) {
      resolvedCount++;
      log.info({ policyDecisionId: row.id, tenantId: row.tenant_id, sku: row.clearance_trigger_sku_part_number }, "policy decision dependency clearance auto-resolved");
    }
  }

  return resolvedCount;
}

/**
 * Same operational writer as `advanceRiskReviewClock`, applied to
 * `policy_decisions` (Git #2024) — Policy Decisions' own table, extending
 * #1513's overdue-review alerting to it (#1527's third "to build" bullet,
 * unsatisfied until now: #2024's own table post-dates #1513 in the commit
 * graph and was never wired into this evaluator).
 *
 * No `status = 'active'` filter — unlike `msp_risk_decisions`, a
 * `policy_decisions` row has no unsigned intermediate state; it is signed and
 * live the moment it exists (see the table's own schema comment), so every
 * row is eligible once it has a `review_due_at`.
 *
 * `review_due_at` is computed at create time (#2518) from `review_cadence` +
 * `created_at` as the anchor (`portal-policy-decisions.ts`'s create route) —
 * still NULL for a dependency-based row (#1526), which this evaluator
 * correctly skips.
 */
async function advancePolicyReviewClock(): Promise<number> {
  await pool.query(
    `UPDATE policy_decisions
        SET review_state = 'overdue', updated_at = NOW()
      WHERE review_due_at IS NOT NULL
        AND review_due_at < NOW()
        AND review_state IS DISTINCT FROM 'overdue'`,
  );
  await pool.query(
    `UPDATE policy_decisions
        SET review_state = 'due', updated_at = NOW()
      WHERE review_due_at IS NOT NULL
        AND review_due_at >= NOW()
        AND review_due_at < NOW() + ($1 * INTERVAL '1 day')
        AND review_state IS DISTINCT FROM 'due'`,
    [RISK_REVIEW_DUE_LEAD_DAYS],
  );
  await pool.query(
    `UPDATE policy_decisions
        SET review_state = 'on_track', updated_at = NOW()
      WHERE review_due_at IS NOT NULL
        AND review_due_at >= NOW() + ($1 * INTERVAL '1 day')
        AND review_state IS DISTINCT FROM 'on_track'`,
    [RISK_REVIEW_DUE_LEAD_DAYS],
  );
  await pool.query(
    `UPDATE policy_decisions
        SET decision_state = 'due', updated_at = NOW()
      WHERE review_state = 'due'
        AND decision_state IS DISTINCT FROM 'due'`,
  );
  await pool.query(
    `UPDATE policy_decisions
        SET decision_state = 'live', updated_at = NOW()
      WHERE review_state IN ('overdue', 'on_track')
        AND decision_state IS DISTINCT FROM 'live'`,
  );

  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM policy_decisions WHERE review_state = 'overdue'`,
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
      case "risk_review_overdue": return await advanceRiskReviewClock();
      case "policy_clearance_resolved": return await advancePolicyClearances();
      case "policy_review_overdue": return await advancePolicyReviewClock();
      default:                   return 0;
    }
  } catch (err) {
    log.warn({ err, conditionType }, "alert-engine: condition eval failed");
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
  // "review_lapsed" gets its own color (violet) rather than sharing critical's
  // red or warning's/info's amber — it is a deliberately distinct severity
  // (#1513), not a graver or lesser ordinary alert.
  const color =
    opts.severity === "critical" ? "#DC2626" :
    opts.severity === "review_lapsed" ? "#7C3AED" :
    "#D97706";
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
        log.warn({ err, ruleKey: opts.ruleKey }, "alert-engine: email delivery failed");
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
      log.warn({ err, ruleKey: opts.ruleKey }, "alert-engine: push delivery failed");
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

export async function evaluateRules(): Promise<void> {
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

      log.warn(
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

      log.info(
        { ruleKey: rule.rule_key, eventId, email, push },
        "alert-engine: alert delivered",
      );
    } catch (err) {
      log.error({ err, ruleKey: rule.rule_key }, "alert-engine: rule evaluation error");
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
    case "risk_review_overdue":
      return `${value} risk acceptance review${value !== 1 ? "s are" : " is"} overdue. The acceptance${value !== 1 ? "s remain" : " remains"} active — only the review has lapsed.`;
    case "policy_clearance_resolved":
      return `${value} policy decision${value !== 1 ? "s" : ""} just had ${value !== 1 ? "their" : "its"} dependency clear and ${value !== 1 ? "are" : "is"} now actionable.`;
    case "policy_review_overdue":
      return `${value} policy decision review${value !== 1 ? "s are" : " is"} overdue. The decision${value !== 1 ? "s remain" : " remains"} LIVE — only the review has lapsed.`;
    default:
      return `Alert condition "${conditionType}" triggered with value ${value}.`;
  }
}

// ── Event-triggered rules (#665) ──────────────────────────────────────────────

/**
 * Fire a single alert rule immediately in response to a discrete event, rather
 * than waiting for the polling evaluateRules() loop to detect a threshold
 * breach. Used for event-shaped conditions like "purchase_completed" that are a
 * one-off occurrence, not a count-over-threshold — the rule's condition_type is
 * never evaluated by getConditionValue(); this direct-fire path is the only way
 * it ever produces an event.
 *
 * Reuses isInCooldown and deliverAlert verbatim, so cooldown/dedup and the
 * email+push delivery machinery behave exactly like every polled rule. If the
 * rule is disabled or not configured, this is a deliberate no-op — the admin's
 * config is the single source of truth, with no hardcoded fallback.
 */
export async function fireEventRule(ruleKey: string, summary: string): Promise<void> {
  try {
    const ruleRes = await pool.query<{
      id: number;
      rule_key: string;
      label: string;
      severity: string;
      delivery_email: boolean;
      delivery_push: boolean;
      cooldown_minutes: number;
      deep_link_path: string | null;
    }>(
      `SELECT id, rule_key, label, severity, delivery_email, delivery_push, cooldown_minutes, deep_link_path
       FROM msp_alert_rules WHERE rule_key = $1 AND enabled = true`,
      [ruleKey],
    );
    const rule = ruleRes.rows[0];
    if (!rule) return; // disabled or not configured — admin's call, no fallback

    const inCooldown = await isInCooldown(rule.id, rule.cooldown_minutes);
    if (inCooldown) return;

    const evtRes = await pool.query<{ id: number }>(
      `INSERT INTO msp_alert_events
         (rule_id, rule_key, severity, condition_value, summary, deep_link_path,
          delivered_email, delivered_push)
       VALUES ($1,$2,$3,1,$4,$5,false,false)
       RETURNING id`,
      [rule.id, rule.rule_key, rule.severity, summary, rule.deep_link_path],
    );
    const eventId = evtRes.rows[0]?.id;
    if (!eventId) return;

    log.info(
      { ruleKey: rule.rule_key, severity: rule.severity, eventId },
      "alert-engine: event rule fired",
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

    log.info(
      { ruleKey: rule.rule_key, eventId, email, push },
      "alert-engine: event rule delivered",
    );
  } catch (err) {
    log.error({ err, ruleKey }, "alert-engine: event rule fire error");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure alert tables exist. Called once at server startup. Does NOT seed any
 * default rules — all msp_alert_rules configuration must be created deliberately
 * (admin UI or direct SQL), never auto-populated. Does NOT start any polling loop
 * either — evaluation is triggered by the "__system__: Alert Rule Evaluation"
 * seeded Workflow (see seed-system-workflows.ts), which fires evaluateRules() via
 * the alert_evaluate_rules workflow node every 5 minutes on its own schedule trigger.
 */
export async function ensureAlertEngineReady(): Promise<void> {
  try {
    await ensureAlertTables();
    log.info("alert-engine: tables ensured");
  } catch (err) {
    log.warn({ err }, "alert-engine: startup init failed (non-fatal)");
  }
}
