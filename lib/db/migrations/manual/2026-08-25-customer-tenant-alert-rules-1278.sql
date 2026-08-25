-- ============================================================================
-- Customer-Tenant Alert Rules — catalog + per-tenant event store (Git #1278)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres / shaneapp://executeSql
-- per current CLAUDE.md. Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS,
-- ON CONFLICT (rule_key) DO NOTHING on the seed — safe to re-run.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- Nothing in the platform has ever defined "what condition on a customer's
-- monitored M365 tenant should raise a customer-facing alert". The MSP-ops
-- engine (`msp_alert_rules`) fires only on platform conditions (DLQ, billing
-- failure, SLA breach). This is the customer-tenant equivalent, following that
-- proven ruleKey/conditionType/threshold/severity/delivery/cooldown shape but
-- pointed at tenant-risk conditions — and it is the catalog #1276's customer
-- Alert Preferences page fires FROM.
--
-- Sign-off decisions (issue #1278):
--   #1 one GLOBAL rule catalog; each customer customises delivery via #1276.
--   #2 DUAL delivery — a firing goes to admin AND (via #1276) to the customer.
--   #4 ship FULLY LOADED — all 23 conditions seeded, including the four whose
--      upstream source subsystem does not exist yet (detector_status =
--      'pending_detector', enabled=false, each tracked by its own sub-issue).
--
-- ── ON THE ENUM COLUMNS — SAID OUT LOUD ─────────────────────────────────────
-- `condition_type`, `alert_category`, `severity`, `detector_status` and
-- `customer_delivery_status` are plain TEXT with NO Postgres enum type and NO
-- CHECK constraint (same convention as msp_alert_rules.condition_type). The
-- Drizzle `text("...", { enum: [...] })` is TypeScript-level narrowing only and
-- emits no DDL — so widening any of these later needs no ALTER, only a seed row.
-- ============================================================================

BEGIN;

-- ── customer_tenant_alert_rules — the GLOBAL catalog (one row per condition) ──
CREATE TABLE IF NOT EXISTS customer_tenant_alert_rules (
  id                     SERIAL PRIMARY KEY,
  rule_key               TEXT NOT NULL UNIQUE,
  label                  TEXT NOT NULL,
  description            TEXT,
  condition_type         TEXT NOT NULL,
  alert_category         TEXT NOT NULL,
  threshold              INTEGER NOT NULL DEFAULT 1,
  window_minutes         INTEGER NOT NULL DEFAULT 1440,
  severity               TEXT NOT NULL DEFAULT 'warning',
  enabled                BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_admin_email   BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_admin_push    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_customer        BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_minutes       INTEGER NOT NULL DEFAULT 1440,
  deep_link_path         TEXT,
  admin_deep_link_path   TEXT,
  detector_status        TEXT NOT NULL DEFAULT 'live',
  source                 TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_rules_condition_type_idx ON customer_tenant_alert_rules (condition_type);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_rules_category_idx        ON customer_tenant_alert_rules (alert_category);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_rules_enabled_idx         ON customer_tenant_alert_rules (enabled);

-- ── customer_tenant_alert_events — one row per (rule × tenant) firing ─────────
CREATE TABLE IF NOT EXISTS customer_tenant_alert_events (
  id                        SERIAL PRIMARY KEY,
  alert_event_id            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  rule_id                   INTEGER NOT NULL REFERENCES customer_tenant_alert_rules(id) ON DELETE CASCADE,
  rule_key                  TEXT NOT NULL,
  alert_category            TEXT NOT NULL,
  severity                  TEXT NOT NULL,
  customer_id               INTEGER NOT NULL,
  msp_id                    INTEGER,
  tenant_id                 TEXT,
  condition_value           INTEGER NOT NULL,
  summary                   TEXT NOT NULL,
  deep_link_path            TEXT,
  admin_deep_link_path      TEXT,
  delivered_admin_email     BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_admin_push      BOOLEAN NOT NULL DEFAULT FALSE,
  customer_delivery_status  TEXT NOT NULL DEFAULT 'pending_prefs',
  customer_delivered_at     TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  resolved_by               INTEGER,
  fired_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_rule_id_idx        ON customer_tenant_alert_events (rule_id);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_customer_fired_idx ON customer_tenant_alert_events (customer_id, fired_at);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_tenant_idx         ON customer_tenant_alert_events (tenant_id);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_fired_at_idx       ON customer_tenant_alert_events (fired_at);
CREATE INDEX IF NOT EXISTS customer_tenant_alert_events_delivery_idx       ON customer_tenant_alert_events (customer_delivery_status);

-- ── SEED the catalog — all 23 conditions (decision #4: fully loaded) ──────────
-- columns: rule_key,label,description,condition_type,alert_category,threshold,
--   window_minutes,severity,enabled,delivery_admin_email,delivery_admin_push,
--   notify_customer,cooldown_minutes,deep_link_path,admin_deep_link_path,
--   detector_status,source
INSERT INTO customer_tenant_alert_rules
  (rule_key, label, description, condition_type, alert_category, threshold, window_minutes, severity, enabled, delivery_admin_email, delivery_admin_push, notify_customer, cooldown_minutes, deep_link_path, admin_deep_link_path, detector_status, source)
VALUES
  -- findings
  ('finding.new_critical', 'New critical finding', 'A new critical-severity finding appeared on the tenant''s latest scan.', 'finding.new_critical', 'findings', 1, 1440, 'critical', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'msp_diagnostic_findings (latest run vs prior, severity=critical)'),
  ('finding.new_high', 'New high finding', 'A new high/warning-severity finding appeared on the tenant''s latest scan.', 'finding.new_high', 'findings', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'msp_diagnostic_findings (latest run vs prior, severity=warning)'),
  ('finding.oversharing', 'Oversharing detected', 'New externally-overshared item(s) beyond baseline (anonymous/everyone/EEEU/org-link).', 'finding.oversharing', 'findings', 1, 1440, 'critical', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/governance/oversharing', '/system/customer-alert-rules', 'live', 'overshared_items (latest run vs prior, severity in critical/high)'),
  ('finding.mfa_gap', 'MFA gap detected', 'A privileged/user account without enforced MFA. PENDING DETECTOR: needs a dedicated MFA monitor check key (sub-issue under #1278).', 'finding.mfa_gap', 'findings', 1, 1440, 'critical', FALSE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'pending_detector', 'NEEDS: MFA monitor check key'),
  ('finding.global_admin_added', 'Global Administrator added', 'A new Global Administrator appeared. PENDING DETECTOR: no GA add-event / run-delta source exists yet (sub-issue under #1278).', 'finding.global_admin_added', 'findings', 1, 1440, 'critical', FALSE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'pending_detector', 'NEEDS: GA add-event or globalAdminCount run-delta'),
  ('finding.ownerless_group', 'Ownerless group/team', 'A group or team is left without an owner.', 'finding.ownerless_group', 'findings', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/governance', '/system/customer-alert-rules', 'live', 'msp_diagnostic_findings check_key governance:ownerless-groups'),
  ('finding.standing_priv_role', 'Standing privileged role', 'A privileged role held standing (not JIT/PIM). Source data pending a Graph scope the multi-tenant app does not yet have.', 'finding.standing_priv_role', 'findings', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/governance', '/system/customer-alert-rules', 'live', 'msp_diagnostic_findings check_key identity:pim-permanent-roles'),
  -- drift
  ('drift.unapproved', 'Unapproved drift', 'A configuration change with an unapproved/unattributed verdict.', 'drift.unapproved', 'drift', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'drift_events verdict in (attributed_unapproved, unattributed)'),
  ('drift.ca_policy_change', 'Conditional Access policy change', 'A Conditional Access policy was added/removed/replaced.', 'drift.ca_policy_change', 'drift', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'drift_events domain_key=ca-policy'),
  ('drift.regression', 'Drift regression', 'A previously-resolved finding reappears. PENDING DETECTOR: drift_events has no resolved→reopened lifecycle yet (#1270 follow-up sub-issue).', 'drift.regression', 'drift', 1, 1440, 'warning', FALSE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'pending_detector', 'NEEDS: drift resolution/reopen lifecycle'),
  -- progress
  ('progress.fix_verified', 'Fix verified', 'A remediation step was verified by a real re-scan (finding cleared).', 'progress.fix_verified', 'progress', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'remediation_tracker_steps verification_state=verified'),
  ('progress.pillar_score_move', 'Pillar score moved', 'A health pillar score moved by at least the threshold since the prior scan.', 'progress.pillar_score_move', 'progress', 5, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'tenant_pillar_snapshots.delta'),
  -- reviews
  ('review.risk_acceptance_due', 'Risk acceptance due for review', 'An accepted risk has reached its review date. Precise lead-time (14/7/on-day) is a #1276 customer preference.', 'review.risk_acceptance_due', 'reviews', 1, 43200, 'info', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/risk-register', '/system/customer-alert-rules', 'live', 'msp_risk_decisions status=active + decision_state=due'),
  ('review.policy_review_due', 'Policy decision due for review', 'A documented policy decision has reached its review date.', 'review.policy_review_due', 'reviews', 1, 43200, 'info', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/compliance-obligations', '/system/customer-alert-rules', 'live', 'msp_risk_decisions decision_state=due'),
  -- remediation
  ('remediation.scan_complete', 'Scan complete', 'A tenant scan run completed.', 'remediation.scan_complete', 'remediation', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/health', '/system/customer-alert-rules', 'live', 'msp_diagnostic_runs status=completed'),
  ('remediation.phase_gate_verified', 'Remediation step completed', 'A remediation step was marked complete.', 'remediation.phase_gate_verified', 'remediation', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/projects', '/system/customer-alert-rules', 'live', 'remediation_tracker_steps status=completed'),
  ('remediation.task_awaiting_customer', 'Task awaiting customer', 'One or more remediation tasks are waiting on the customer to action.', 'remediation.task_awaiting_customer', 'remediation', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/projects', '/system/customer-alert-rules', 'live', 'remediation_tracker_steps status=not_started'),
  -- billing
  ('billing.sow_signed', 'Statement of Work signed', 'A statement of work was signed.', 'billing.sow_signed', 'billing', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/billing', '/system/customer-alert-rules', 'live', 'msp_sows status=signed'),
  ('billing.invoice_issued', 'Invoice issued', 'An invoice was issued to the customer.', 'billing.invoice_issued', 'billing', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/billing', '/system/customer-alert-rules', 'live', 'invoices joined users on tenant_id'),
  ('billing.license_change', 'Licence assignment changed', 'A licence assignment changed. PENDING DETECTOR: no licence-assignment table/event exists yet (sub-issue under #1278).', 'billing.license_change', 'billing', 1, 1440, 'info', FALSE, TRUE, TRUE, TRUE, 1440, '/portal-v2/billing', '/system/customer-alert-rules', 'pending_detector', 'NEEDS: licence-assignment snapshot + diff'),
  ('billing.renewal_approaching', 'Renewal approaching', 'The tenant''s subscription renewal date is within the lead-time window.', 'billing.renewal_approaching', 'billing', 1, 43200, 'info', TRUE, TRUE, TRUE, TRUE, 10080, '/portal-v2/billing', '/system/customer-alert-rules', 'live', 'msp_subscriptions.current_period_end'),
  ('billing.payment_failed', 'Payment failed', 'The tenant''s own subscription payment failed.', 'billing.payment_failed', 'billing', 1, 1440, 'warning', TRUE, TRUE, TRUE, TRUE, 1440, '/portal-v2/billing', '/system/customer-alert-rules', 'live', 'msp_subscriptions.payment_failed_at'),
  -- support
  ('support.ticket_updated', 'Support ticket updated', 'Shane McCaw Consulting responded on a support thread.', 'support.ticket_updated', 'support', 1, 1440, 'info', TRUE, TRUE, TRUE, TRUE, 60, '/portal-v2/support', '/system/customer-alert-rules', 'live', 'messages (admin reply) joined users on tenant_id')
ON CONFLICT (rule_key) DO NOTHING;

-- ── VERIFY (expect 23 rows, 4 pending_detector) ──────────────────────────────
SELECT detector_status, count(*) FROM customer_tenant_alert_rules GROUP BY detector_status ORDER BY detector_status;

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-customer-tenant-alert-rules-1278.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
