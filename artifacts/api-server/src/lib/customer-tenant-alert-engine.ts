/**
 * Customer-Tenant Alert Engine (Git #1278)
 *
 * The sibling of alert-engine.ts (platform-ops), pointed at CUSTOMER-tenant risk
 * conditions instead of platform-ops ones. It evaluates the global catalog
 * (`customer_tenant_alert_rules`) PER monitored M365 tenant and writes one
 * `customer_tenant_alert_events` row per (rule × tenant) firing.
 *
 * Design (issue #1278 sign-off):
 *  - ONE global rule catalog; each customer customises delivery via #1276 (decision #1).
 *  - DUAL delivery: admin (Exchange Online email + admin web-push, reusing the
 *    platform engine's senders) AND the customer, via the #1276 seam in
 *    customer-alert-delivery.ts (decision #2).
 *  - FULLY LOADED catalog: all 23 conditions exist. Four whose upstream source
 *    subsystem does not exist yet are seeded detector_status='pending_detector'
 *    (enabled=false) and their evaluators return 0 here until their sub-issue
 *    lands — the hook is wired, nothing else to change (decision #4).
 *
 * Every condition is POLL-based (evaluated on the existing 5-minute
 * "__system__: Alert Rule Evaluation" schedule, alongside evaluateRules()): each
 * evaluator counts qualifying rows within the rule's `window_minutes` and the
 * engine fires when that count >= 1. `threshold` is a per-condition sensitivity
 * knob the evaluator bakes into its own query (a delta magnitude for
 * pillar_score_move, a forward lead-time is `window_minutes` for renewal/review),
 * not a generic count floor. De-dup is per (rule × tenant) via `cooldown_minutes`.
 *
 * Accepted-risk suppression (#1279): every `finding.*` evaluator excludes
 * items whose `check_key` has a `status='active'` `msp_risk_decisions` row for
 * that tenant with a matching `check_key` (see NOT_ACCEPTED_AS_RISK below).
 * `check_key` on msp_risk_decisions is optional and NULL by default — a
 * decision with no linked check never suppresses anything, so this never
 * guesses. Runs every eval cycle, so it covers both the first firing and any
 * re-firing after cooldown elapses.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendWebPushToAdmins } from "./web-push";
import { sendMailViaGraph, graphCredentialsPresent } from "./graph";
import {
  deliverCustomerTenantAlertToCustomer,
  type CustomerDeliveryStatus,
} from "./customer-alert-delivery";

const log = logger.child({ channel: "engine.alert" });

// ── Deep-link base URLs ───────────────────────────────────────────────────────

function getAdminPanelBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/admin-panel`;
  }
  return "http://localhost:80/admin-panel";
}

function getPortalBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/portal`;
  }
  return "http://localhost:80/portal";
}

// ── Table bootstrapping (idempotent; mirrors the manual migration) ─────────────

let tablesEnsured = false;
async function ensureCustomerTenantAlertTables(): Promise<void> {
  if (tablesEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_tenant_alert_rules (
      id                   SERIAL PRIMARY KEY,
      rule_key             TEXT NOT NULL UNIQUE,
      label                TEXT NOT NULL,
      description          TEXT,
      condition_type       TEXT NOT NULL,
      alert_category       TEXT NOT NULL,
      threshold            INTEGER NOT NULL DEFAULT 1,
      window_minutes       INTEGER NOT NULL DEFAULT 1440,
      severity             TEXT NOT NULL DEFAULT 'warning',
      enabled              BOOLEAN NOT NULL DEFAULT true,
      delivery_admin_email BOOLEAN NOT NULL DEFAULT true,
      delivery_admin_push  BOOLEAN NOT NULL DEFAULT true,
      notify_customer      BOOLEAN NOT NULL DEFAULT true,
      cooldown_minutes     INTEGER NOT NULL DEFAULT 1440,
      deep_link_path       TEXT,
      admin_deep_link_path TEXT,
      detector_status      TEXT NOT NULL DEFAULT 'live',
      source               TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS customer_tenant_alert_events (
      id                       SERIAL PRIMARY KEY,
      alert_event_id           UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      rule_id                  INTEGER NOT NULL REFERENCES customer_tenant_alert_rules(id) ON DELETE CASCADE,
      rule_key                 TEXT NOT NULL,
      alert_category           TEXT NOT NULL,
      severity                 TEXT NOT NULL,
      customer_id              INTEGER NOT NULL,
      msp_id                   INTEGER,
      tenant_id                TEXT,
      condition_value          INTEGER NOT NULL,
      summary                  TEXT NOT NULL,
      deep_link_path           TEXT,
      admin_deep_link_path     TEXT,
      delivered_admin_email    BOOLEAN NOT NULL DEFAULT false,
      delivered_admin_push     BOOLEAN NOT NULL DEFAULT false,
      customer_delivery_status TEXT NOT NULL DEFAULT 'pending_prefs',
      customer_delivered_at    TIMESTAMPTZ,
      resolved_at              TIMESTAMPTZ,
      resolved_by              INTEGER,
      fired_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS customer_tenant_alert_rules_condition_type_idx ON customer_tenant_alert_rules (condition_type);
    CREATE INDEX IF NOT EXISTS customer_tenant_alert_rules_enabled_idx ON customer_tenant_alert_rules (enabled);
    CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_rule_id_idx ON customer_tenant_alert_events (rule_id);
    CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_customer_fired_idx ON customer_tenant_alert_events (customer_id, fired_at);
    CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_fired_at_idx ON customer_tenant_alert_events (fired_at);
  `);
  tablesEnsured = true;
}

// ── Monitored-tenant enumeration ──────────────────────────────────────────────

export interface TenantContext {
  customerId: number; // tenants.id (JWT customerId)
  mspId: number | null;
  tenantId: string | null; // M365 tenant GUID
  customerName: string | null;
}

async function listMonitoredTenants(): Promise<TenantContext[]> {
  // Every tenant that has ever been scanned — the population that can hold
  // findings/drift/remediation. DISTINCT ON keeps the most recent run's
  // msp_id/tenant_id per customer.
  const res = await pool.query<{
    customer_id: number; msp_id: number | null; tenant_id: string | null; customer_name: string | null;
  }>(`
    SELECT DISTINCT ON (r.customer_id)
           r.customer_id, r.msp_id, r.tenant_id, t.customer_name
    FROM msp_diagnostic_runs r
    LEFT JOIN tenants t ON t.id = r.customer_id
    WHERE r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.created_at DESC
  `);
  return res.rows.map((r) => ({
    customerId: r.customer_id,
    mspId: r.msp_id,
    tenantId: r.tenant_id,
    customerName: r.customer_name,
  }));
}

// ── Condition evaluators (tenant-scoped) ──────────────────────────────────────
//
// Each returns the count of qualifying items in the rule's window; the engine
// fires when the count >= 1. A missing scoping key (e.g. no tenantId for a
// drift condition) returns 0 — never an error.

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const res = await pool.query<{ n: string }>(sqlText, params);
  return parseInt(res.rows[0]?.n ?? "0", 10);
}

// ── Accepted-risk suppression (#1279, widened #1957) ────────────────────────
//
// msp_risk_decisions has no structured link to any automated check by
// default (controlViolated/framework/obligation are all free text — see the
// table's own schema comment) — check_key is the one optional, EXACT link
// (#1279's own migration). A NULL check_key never matches anything here, so
// a free-text liability record with no linked check never suppresses a
// finding by accident. `$N` below is `tenantId ?? '__no_tenant__'`, a value
// that can never equal a real tenant_id, so the subquery is a safe no-op
// when the alert condition has no resolvable tenant.
//
// additional_check_keys (#1957) carries every check key BEYOND check_key that
// this same accepted risk also covers — several remediation_tracker_steps map
// to more than one check (REMEDIATION_TRACKER_STEP_CHECK_KEYS), and declining
// one such step accepts the risk on ALL of its mapped checks, not just the
// first. NULL/empty for every row that predates #1957 or was never given a
// second key, so this OR is a no-op for them.
const NOT_ACCEPTED_AS_RISK = (checkKeyExpr: string, tenantParam: string) => `
  NOT EXISTS (
    SELECT 1 FROM msp_risk_decisions rd
    WHERE rd.tenant_id = ${tenantParam} AND rd.status = 'active'
      AND (
        rd.check_key = ${checkKeyExpr}
        OR rd.additional_check_keys @> to_jsonb(${checkKeyExpr}::text)
      )
  )`;

// ── Which run statuses carry real findings (#1301) ─────────────────────────
//
// A msp_diagnostic_run is only 'completed' when EVERY check in the package
// ran clean; the moment even one check returns "error"/"partial" the whole
// run is persisted as 'partial' (monitor-executor's runStatus:
// hasErrors -> "partial_failure" -> diagnostics-runner "partial"). On any real
// tenant at least one PS-backed check (DLP, Exchange RBAC, ...) routinely
// errors, so real scans land 'partial' essentially always — diagnostics-runner
// itself calls this a "permanently-'partial' tenant". The findings on a partial
// run are just as real as on a completed one: the deliberately-broken tenant's
// genuine critical CA finding (identity:ca-policy-count, caPolicyCount == 0)
// lives on a 'partial' run today. Gating the finding.* evaluators on
// status = 'completed' therefore silently excluded EVERY real finding, so
// finding.new_critical / finding.new_high / finding.* never fired for a
// realistic tenant — traced end-to-end for #1301. Both real statuses count.
const REAL_RUN_STATUSES = `status IN ('completed', 'partial')`;

/** New findings at a severity on the latest real (completed or partial) run vs the prior one. */
async function evalNewFindings(customerId: number, tenantId: string | null, severity: string, windowMinutes: number): Promise<number> {
  return count(
    `
    WITH runs AS (
      SELECT run_id, COALESCE(completed_at, created_at) AS at,
             row_number() OVER (ORDER BY COALESCE(completed_at, created_at) DESC) AS rn
      FROM msp_diagnostic_runs
      WHERE customer_id = $1 AND ${REAL_RUN_STATUSES}
    ),
    latest AS (SELECT run_id, at FROM runs WHERE rn = 1),
    prior  AS (SELECT run_id FROM runs WHERE rn = 2)
    SELECT COUNT(*)::text AS n
    FROM msp_diagnostic_findings f
    WHERE f.run_id = (SELECT run_id FROM latest)
      AND (SELECT at FROM latest) > NOW() - ($3 * INTERVAL '1 minute')
      AND f.severity = $2
      AND f.check_key NOT IN (
        SELECT check_key FROM msp_diagnostic_findings
        WHERE run_id = (SELECT run_id FROM prior) AND severity = $2
      )
      AND ${NOT_ACCEPTED_AS_RISK("f.check_key", "$4")}
    `,
    [customerId, severity, windowMinutes, tenantId ?? "__no_tenant__"],
  );
}

/** Newly-overshared items (critical/high) on the latest run vs prior. */
async function evalOversharing(customerId: number, tenantId: string | null, windowMinutes: number): Promise<number> {
  return count(
    `
    WITH runs AS (
      SELECT run_id, MAX(collected_at) AS at
      FROM overshared_items WHERE customer_id = $1 GROUP BY run_id
    ),
    ordered AS (SELECT run_id, at, row_number() OVER (ORDER BY at DESC) AS rn FROM runs),
    latest AS (SELECT run_id, at FROM ordered WHERE rn = 1),
    prior  AS (SELECT run_id FROM ordered WHERE rn = 2)
    SELECT COUNT(*)::text AS n
    FROM overshared_items o
    WHERE o.run_id = (SELECT run_id FROM latest)
      AND (SELECT at FROM latest) > NOW() - ($2 * INTERVAL '1 minute')
      AND o.severity IN ('critical','high')
      AND o.natural_key NOT IN (
        SELECT natural_key FROM overshared_items WHERE run_id = (SELECT run_id FROM prior)
      )
      AND ${NOT_ACCEPTED_AS_RISK("o.check_key", "$3")}
    `,
    [customerId, windowMinutes, tenantId ?? "__no_tenant__"],
  );
}

/**
 * Newly-added Global Administrator (#1289): the latest `tenant_monitor_profiles`
 * collection of `identity:global-admin-count` vs the run before it, per tenant.
 * That table is the production monitoring record (populated on every regular
 * scoring scan, not the optional detail-collection package), so it already
 * historises the count per run without any new schema/migration — see the
 * issue's own option (a). A tenant with no prior collection never fires: its
 * existing admin baseline is not "prior" to compare against, so it can't be
 * mistaken for a newly-added admin on the very first scan.
 */
async function evalGlobalAdminAdded(tenantId: string | null, windowMinutes: number): Promise<number> {
  if (!tenantId) return 0;
  return count(
    `
    WITH runs AS (
      SELECT collected_at, (extracted_properties->>'globalAdminCount')::int AS ga_count,
             row_number() OVER (ORDER BY collected_at DESC) AS rn
      FROM tenant_monitor_profiles
      WHERE tenant_id = $1 AND check_key = 'identity:global-admin-count'
        AND extracted_properties ? 'globalAdminCount'
    ),
    latest AS (SELECT collected_at, ga_count FROM runs WHERE rn = 1),
    prior  AS (SELECT ga_count FROM runs WHERE rn = 2)
    SELECT GREATEST(latest.ga_count - COALESCE(prior.ga_count, latest.ga_count), 0)::text AS n
    FROM latest
    LEFT JOIN prior ON true
    WHERE latest.collected_at > NOW() - ($2 * INTERVAL '1 minute')
      AND ${NOT_ACCEPTED_AS_RISK("'identity:global-admin-count'", "$1")}
    `,
    [tenantId, windowMinutes],
  );
}

/** Latest-run finding at/above warning for a specific governance check key. */
async function evalLatestFindingByKey(customerId: number, tenantId: string | null, checkKey: string): Promise<number> {
  return count(
    `
    WITH latest AS (
      SELECT run_id FROM msp_diagnostic_runs
      WHERE customer_id = $1 AND ${REAL_RUN_STATUSES}
      ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 1
    )
    SELECT COUNT(*)::text AS n
    FROM msp_diagnostic_findings f
    WHERE f.run_id = (SELECT run_id FROM latest)
      AND f.check_key = $2
      AND f.severity IN ('warning','critical')
      AND ${NOT_ACCEPTED_AS_RISK("f.check_key", "$3")}
    `,
    [customerId, checkKey, tenantId ?? "__no_tenant__"],
  );
}

/**
 * Licence assignments added or removed since the prior snapshot (#1291),
 * mirroring evalOversharing's run-to-run diff shape over
 * license_assignment_snapshots (one row per user x SKU, natural_key =
 * tenant+user+sku independent of run_id — see item-detail-collector.ts /
 * license-assignment-snapshots.ts). Counts BOTH directions (newly assigned
 * and newly removed), unlike evalOversharing which only counts new
 * appearances — a licence removal is as real a billing-relevant change as an
 * addition. No accepted-risk suppression (#1279) here: that mechanism is
 * scoped to `finding.*` conditions, not billing ones.
 */
async function evalLicenseChange(customerId: number, windowMinutes: number): Promise<number> {
  return count(
    `
    WITH runs AS (
      SELECT run_id, MAX(collected_at) AS at
      FROM license_assignment_snapshots WHERE customer_id = $1 GROUP BY run_id
    ),
    ordered AS (SELECT run_id, at, row_number() OVER (ORDER BY at DESC) AS rn FROM runs),
    latest AS (SELECT run_id, at FROM ordered WHERE rn = 1),
    prior  AS (SELECT run_id FROM ordered WHERE rn = 2),
    latest_keys AS (SELECT natural_key FROM license_assignment_snapshots WHERE run_id = (SELECT run_id FROM latest)),
    prior_keys  AS (SELECT natural_key FROM license_assignment_snapshots WHERE run_id = (SELECT run_id FROM prior)),
    changed AS (
      -- Parens are load-bearing: EXCEPT/UNION ALL share precedence and are
      -- left-associative, so without them this silently collapses to
      -- ((latest EXCEPT prior) UNION ALL prior) EXCEPT latest — dropping the
      -- "added" half of the diff.
      (SELECT natural_key FROM latest_keys EXCEPT SELECT natural_key FROM prior_keys)
      UNION ALL
      (SELECT natural_key FROM prior_keys EXCEPT SELECT natural_key FROM latest_keys)
    )
    SELECT COUNT(*)::text AS n
    FROM changed
    WHERE (SELECT at FROM latest) > NOW() - ($2 * INTERVAL '1 minute')
    `,
    [customerId, windowMinutes],
  );
}

async function getConditionValue(
  rule: { condition_type: string; window_minutes: number; threshold: number },
  ctx: TenantContext,
): Promise<number> {
  const w = rule.window_minutes;
  const t = rule.threshold;
  const cid = ctx.customerId;
  const tid = ctx.tenantId;
  const mid = ctx.mspId;
  try {
    switch (rule.condition_type) {
      // ── findings (each excludes check_keys already accepted as risk, #1279) ─
      case "finding.new_critical": return await evalNewFindings(cid, tid, "critical", w);
      case "finding.new_high":     return await evalNewFindings(cid, tid, "warning", w);
      case "finding.oversharing":  return await evalOversharing(cid, tid, w);
      case "finding.ownerless_group":   return await evalLatestFindingByKey(cid, tid, "governance:ownerless-groups");
      case "finding.standing_priv_role": return await evalLatestFindingByKey(cid, tid, "identity:pim-permanent-roles");
      case "finding.mfa_gap":          return await evalLatestFindingByKey(cid, tid, "identity:privileged-mfa-gap");
      case "finding.global_admin_added": return await evalGlobalAdminAdded(tid, w);

      // ── drift (scoped by tenant_id text) ───────────────────────────────────
      case "drift.unapproved":
        if (!tid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM drift_events
           WHERE tenant_id = $1 AND verdict IN ('attributed_unapproved','unattributed')
             AND detected_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [tid, w],
        );
      case "drift.ca_policy_change":
        if (!tid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM drift_events
           WHERE tenant_id = $1 AND domain_key = 'ca-policy'
             AND detected_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [tid, w],
        );

      // ── progress ───────────────────────────────────────────────────────────
      case "progress.fix_verified":
        return await count(
          `SELECT COUNT(*)::text AS n FROM remediation_tracker_steps
           WHERE customer_id = $1 AND verification_state = 'verified'
             AND verified_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [cid, w],
        );
      case "progress.pillar_score_move":
        // threshold = delta magnitude; window = recency of the snapshot.
        return await count(
          `SELECT COUNT(*)::text AS n FROM tenant_pillar_snapshots
           WHERE customer_id = $1 AND ABS(delta) >= $2
             AND captured_at > NOW() - ($3 * INTERVAL '1 minute')`,
          [cid, t, w],
        );

      // ── reviews (scoped by tenant_id text; window = forward lead-time) ──────
      case "review.risk_acceptance_due":
        if (!tid) return 0;
        // review_date is display-copy text ("27 Aug 2026"); guard the parse.
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_risk_decisions
           WHERE tenant_id = $1 AND status = 'active'
             AND review_date ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$'
             AND to_date(review_date, 'DD Mon YYYY') <= (NOW() + ($2 * INTERVAL '1 minute'))::date`,
          [tid, w],
        );
      case "review.policy_review_due":
        if (!tid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_risk_decisions
           WHERE tenant_id = $1 AND decision_state IN ('due','expired')`,
          [tid],
        );

      // ── remediation ────────────────────────────────────────────────────────
      case "remediation.scan_complete":
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_diagnostic_runs
           WHERE customer_id = $1 AND status = 'completed'
             AND completed_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [cid, w],
        );
      case "remediation.phase_gate_verified":
        return await count(
          `SELECT COUNT(*)::text AS n FROM remediation_tracker_steps
           WHERE customer_id = $1 AND status = 'completed'
             AND completed_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [cid, w],
        );
      case "remediation.task_awaiting_customer":
        return await count(
          `SELECT COUNT(*)::text AS n FROM remediation_tracker_steps
           WHERE customer_id = $1 AND status = 'not_started'`,
          [cid],
        );

      // ── billing ────────────────────────────────────────────────────────────
      case "billing.sow_signed":
        if (!mid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_sows
           WHERE msp_id = $1 AND status = 'signed'
             AND signed_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [mid, w],
        );
      case "billing.invoice_issued":
        return await count(
          `SELECT COUNT(*)::text AS n FROM invoices i
           JOIN users u ON u.id = i.client_user_id
           WHERE u.tenant_id = $1
             AND i.created_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [cid, w],
        );
      case "billing.renewal_approaching":
        if (!mid) return 0;
        // window = forward lead-time to the renewal date.
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_subscriptions
           WHERE msp_id = $1 AND current_period_end IS NOT NULL
             AND current_period_end BETWEEN NOW() AND NOW() + ($2 * INTERVAL '1 minute')`,
          [mid, w],
        );
      case "billing.payment_failed":
        if (!mid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM msp_subscriptions
           WHERE msp_id = $1 AND payment_failed_at IS NOT NULL`,
          [mid],
        );

      // ── support ────────────────────────────────────────────────────────────
      case "support.ticket_updated":
        // An admin/Shane reply (sender != the client) on the tenant's threads.
        return await count(
          `SELECT COUNT(*)::text AS n FROM messages m
           JOIN users u ON u.id = m.client_user_id
           WHERE u.tenant_id = $1 AND m.sender_user_id <> m.client_user_id
             AND m.created_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [cid, w],
        );

      // ── billing (continued) ────────────────────────────────────────────────
      case "billing.license_change": return await evalLicenseChange(cid, w);

      // ── drift regression (#1290): a previously-resolved finding reappeared ──
      // A drift_events row flips to status='reopened' (reopened_at set) when a
      // setting that had returned to baseline drifts from it again. Count those
      // within the window, scoped by tenant.
      case "drift.regression":
        if (!tid) return 0;
        return await count(
          `SELECT COUNT(*)::text AS n FROM drift_events
           WHERE tenant_id = $1 AND status = 'reopened'
             AND reopened_at > NOW() - ($2 * INTERVAL '1 minute')`,
          [tid, w],
        );

      // ── pending_detector conditions — hook wired, source not built yet ──────
      default:
        return 0;
    }
  } catch (err) {
    log.warn({ err, conditionType: rule.condition_type, customerId: cid }, "customer-alert: condition eval failed");
    return 0;
  }
}

// ── Summary copy ──────────────────────────────────────────────────────────────

function buildSummary(conditionType: string, value: number, ctx: TenantContext): string {
  const who = ctx.customerName ? `${ctx.customerName}: ` : "";
  const n = value;
  const s = n === 1 ? "" : "s";
  switch (conditionType) {
    case "finding.new_critical": return `${who}${n} new critical finding${s} on the latest scan.`;
    case "finding.new_high":     return `${who}${n} new high finding${s} on the latest scan.`;
    case "finding.oversharing":  return `${who}${n} newly overshared item${s} beyond baseline.`;
    case "finding.ownerless_group":   return `${who}a group or team is left without an owner.`;
    case "finding.mfa_gap":      return `${who}a privileged or user account does not have MFA enforced.`;
    case "finding.standing_priv_role": return `${who}a privileged role is held standing (not JIT/PIM).`;
    case "finding.global_admin_added": return `${who}${n} new Global Administrator${s} detected — verify immediately.`;
    case "drift.unapproved":     return `${who}${n} unapproved configuration change${s} detected.`;
    case "drift.ca_policy_change": return `${who}${n} Conditional Access policy change${s} detected.`;
    case "drift.regression":       return `${who}${n} previously-resolved configuration finding${s} reappeared.`;
    case "progress.fix_verified": return `${who}${n} remediation fix${n === 1 ? "" : "es"} verified by re-scan.`;
    case "progress.pillar_score_move": return `${who}a health pillar score moved beyond the threshold.`;
    case "review.risk_acceptance_due": return `${who}${n} accepted risk${s} due for review.`;
    case "review.policy_review_due":   return `${who}${n} policy decision${s} due for review.`;
    case "remediation.scan_complete":  return `${who}${n} tenant scan${s} completed.`;
    case "remediation.phase_gate_verified": return `${who}${n} remediation step${s} marked complete.`;
    case "remediation.task_awaiting_customer": return `${who}${n} remediation task${s} awaiting your action.`;
    case "billing.sow_signed":     return `${who}${n} statement of work signed.`;
    case "billing.invoice_issued": return `${who}${n} invoice${s} issued.`;
    case "billing.renewal_approaching": return `${who}${n} subscription renewal${s} approaching.`;
    case "billing.payment_failed": return `${who}a subscription payment has failed.`;
    case "billing.license_change": return `${who}${n} licence assignment change${s} detected.`;
    case "support.ticket_updated": return `${who}${n} support reply${s} from Shane McCaw Consulting.`;
    default: return `${who}alert condition "${conditionType}" triggered (value ${n}).`;
  }
}

// ── Cooldown (per rule × tenant) ──────────────────────────────────────────────

async function isInCooldown(ruleId: number, customerId: number, cooldownMinutes: number): Promise<boolean> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM customer_tenant_alert_events
     WHERE rule_id = $1 AND customer_id = $2
       AND fired_at > NOW() - ($3 * INTERVAL '1 minute')
     ORDER BY fired_at DESC LIMIT 1`,
    [ruleId, customerId, cooldownMinutes],
  );
  return res.rows.length > 0;
}

// ── Admin delivery (reuses the platform engine's senders) ─────────────────────

function buildAdminEmailHtml(opts: {
  label: string; summary: string; severity: string; adminDeepLinkPath: string | null; adminBaseUrl: string;
}): string {
  const color = opts.severity === "critical" ? "#DC2626" : opts.severity === "warning" ? "#D97706" : "#0284C7";
  const link = opts.adminDeepLinkPath
    ? `<p style="margin-top:16px"><a href="${opts.adminBaseUrl}${opts.adminDeepLinkPath}" style="background:#0078D4;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:14px">View in Admin Panel →</a></p>`
    : "";
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;padding:24px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;letter-spacing:.05em">${opts.severity.toUpperCase()}</span>
      <h2 style="margin:0;font-size:16px;color:#0a2540">${opts.label}</h2>
    </div>
    <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px">${opts.summary}</p>
    ${link}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0" />
    <p style="color:#a0aec0;font-size:12px;margin:0">Customer-Tenant Alert Engine &mdash; ${new Date().toUTCString()}</p>
  </div></body></html>`;
}

async function deliverToAdmin(opts: {
  eventId: number; ruleKey: string; label: string; summary: string; severity: string;
  adminDeepLinkPath: string | null; deliveryEmail: boolean; deliveryPush: boolean;
}): Promise<{ email: boolean; push: boolean }> {
  let emailOk = false;
  let pushOk = false;

  if (opts.deliveryEmail && graphCredentialsPresent()) {
    const mailUserId = process.env.GRAPH_MAIL_USER_ID;
    if (mailUserId) {
      try {
        await sendMailViaGraph({
          fromUserId: mailUserId,
          to: mailUserId,
          subject: `[${opts.severity.toUpperCase()}] Customer Alert: ${opts.label}`,
          htmlBody: buildAdminEmailHtml({
            label: opts.label,
            summary: opts.summary,
            severity: opts.severity,
            adminDeepLinkPath: opts.adminDeepLinkPath,
            adminBaseUrl: getAdminPanelBaseUrl(),
          }),
        });
        emailOk = true;
      } catch (err) {
        log.warn({ err, ruleKey: opts.ruleKey }, "customer-alert: admin email delivery failed");
      }
    }
  }

  if (opts.deliveryPush) {
    try {
      await sendWebPushToAdmins({
        title: `[${opts.severity.toUpperCase()}] ${opts.label}`,
        body: opts.summary,
        linkPath: opts.adminDeepLinkPath ?? undefined,
      });
      pushOk = true;
    } catch (err) {
      log.warn({ err, ruleKey: opts.ruleKey }, "customer-alert: admin push delivery failed");
    }
  }

  return { email: emailOk, push: pushOk };
}

// ── Main evaluation loop ──────────────────────────────────────────────────────

interface RuleRow {
  id: number; rule_key: string; label: string; condition_type: string; alert_category: string;
  threshold: number; window_minutes: number; severity: string; cooldown_minutes: number;
  delivery_admin_email: boolean; delivery_admin_push: boolean; notify_customer: boolean;
  deep_link_path: string | null; admin_deep_link_path: string | null;
}

export async function evaluateCustomerTenantRules(): Promise<void> {
  await ensureCustomerTenantAlertTables();

  const rulesRes = await pool.query<RuleRow>(
    `SELECT id, rule_key, label, condition_type, alert_category, threshold, window_minutes,
            severity, cooldown_minutes, delivery_admin_email, delivery_admin_push, notify_customer,
            deep_link_path, admin_deep_link_path
     FROM customer_tenant_alert_rules
     WHERE enabled = true`,
  );
  if (rulesRes.rows.length === 0) return;

  const tenants = await listMonitoredTenants();
  if (tenants.length === 0) return;

  let fired = 0;
  for (const rule of rulesRes.rows) {
    for (const ctx of tenants) {
      try {
        const value = await getConditionValue(rule, ctx);
        if (value < 1) continue;

        if (await isInCooldown(rule.id, ctx.customerId, rule.cooldown_minutes)) continue;

        const summary = buildSummary(rule.condition_type, value, ctx);

        const evtRes = await pool.query<{ id: number }>(
          `INSERT INTO customer_tenant_alert_events
             (rule_id, rule_key, alert_category, severity, customer_id, msp_id, tenant_id,
              condition_value, summary, deep_link_path, admin_deep_link_path,
              delivered_admin_email, delivered_admin_push, customer_delivery_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,false,'pending_prefs')
           RETURNING id`,
          [
            rule.id, rule.rule_key, rule.alert_category, rule.severity, ctx.customerId,
            ctx.mspId, ctx.tenantId, value, summary, rule.deep_link_path, rule.admin_deep_link_path,
          ],
        );
        const eventId = evtRes.rows[0]?.id;
        if (!eventId) continue;
        fired++;

        // ── Admin delivery (dual-delivery, always on for enabled rules) ──────
        const admin = await deliverToAdmin({
          eventId,
          ruleKey: rule.rule_key,
          label: rule.label,
          summary,
          severity: rule.severity,
          adminDeepLinkPath: rule.admin_deep_link_path,
          deliveryEmail: rule.delivery_admin_email,
          deliveryPush: rule.delivery_admin_push,
        });

        // ── Customer delivery (the #1276 seam) ───────────────────────────────
        let customerStatus: CustomerDeliveryStatus = "skipped";
        let customerDeliveredAt: string | null = null;
        if (rule.notify_customer) {
          const outcome = await deliverCustomerTenantAlertToCustomer({
            eventId,
            ruleKey: rule.rule_key,
            alertCategory: rule.alert_category,
            severity: rule.severity as "info" | "warning" | "critical",
            customerId: ctx.customerId,
            mspId: ctx.mspId,
            tenantId: ctx.tenantId,
            summary,
            deepLinkPath: rule.deep_link_path,
          });
          customerStatus = outcome.status;
          if (outcome.status === "delivered") customerDeliveredAt = new Date().toISOString();
        }

        await pool.query(
          `UPDATE customer_tenant_alert_events
           SET delivered_admin_email = $1, delivered_admin_push = $2,
               customer_delivery_status = $3, customer_delivered_at = $4
           WHERE id = $5`,
          [admin.email, admin.push, customerStatus, customerDeliveredAt, eventId],
        );

        log.info(
          { ruleKey: rule.rule_key, customerId: ctx.customerId, eventId, value,
            adminEmail: admin.email, adminPush: admin.push, customerStatus },
          "customer-alert: fired",
        );
      } catch (err) {
        log.error({ err, ruleKey: rule.rule_key, customerId: ctx.customerId }, "customer-alert: rule/tenant eval error");
      }
    }
  }

  if (fired > 0) log.info({ fired, rules: rulesRes.rows.length, tenants: tenants.length }, "customer-alert: evaluation complete");
}

// ── Startup readiness (called by workflow node lazily via evaluate) ───────────

export async function ensureCustomerTenantAlertEngineReady(): Promise<void> {
  try {
    await ensureCustomerTenantAlertTables();
    log.info("customer-alert: tables ensured");
  } catch (err) {
    log.warn({ err }, "customer-alert: startup init failed (non-fatal)");
  }
}

// Exported for the portal deep-link resolver / tests.
export { getPortalBaseUrl };
