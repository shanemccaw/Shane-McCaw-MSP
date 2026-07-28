-- ═══════════════════════════════════════════════════════════════════════════
-- Tenant/User Refactor — Phase 0: Schema + wipe (Git #92 / #93)
--
-- Signed-off plan (pinned comment on #92): direct cutover, no data
-- preservation. Creates the real `tenants` table (consent folded into one
-- jsonb column keyed graph/writeBack/sharepoint), expands `users` in place
-- with every msp_users column, adds the corrected role-scope CHECK
-- constraint, wipes all data except the PlatformAdmin user(s) and msps.id=1,
-- then drops: msp_customers, msp_users, tenant_consent, tenant_write_consent,
-- tenant_sharepoint_consent.
--
-- Run manually in the SQL console. Single transaction — any failure rolls
-- the whole thing back. Defensive to_regclass guards throughout because the
-- live DB has known drift from the schema files (see
-- create-12-missing-tables.sql for precedent).
--
-- Deliberate decisions (delete vs null), per referencing table, are inline
-- below. Surviving tables keep their now-orphaned integer customer_id/
-- msp_customer_id columns — the FK constraints die with DROP ... CASCADE,
-- the column drops are Phase 7 cleanup.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Helper: run a statement only if the target table exists (live-drift guard).
CREATE FUNCTION pg_temp.exec_if_exists(p_table text, p_sql text) RETURNS void AS $fn$
BEGIN
  IF to_regclass('public.' || p_table) IS NOT NULL THEN
    EXECUTE p_sql;
  END IF;
END;
$fn$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New tenants table — the real Tenant (Customer) object. The M365 tenant
--    GUID is first-class, required, unique. The three per-resource consent
--    records fold into one jsonb column: { graph: {...}, writeBack: {...},
--    sharepoint: {...} } — extensible without new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id            serial PRIMARY KEY,
  msp_id        integer NOT NULL REFERENCES msps(id) ON DELETE RESTRICT,
  customer_name text NOT NULL,
  tenant_url    text,
  tenant_id     text NOT NULL UNIQUE,
  consent       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_msp_id_idx ON tenants (msp_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Expand users in place — absorb every msp_users column. msp_users.id,
--    .user_id (the 1:1 join) and .customer_id (points into the msp_customers
--    id-space being destroyed) are deliberately NOT carried over; the new
--    tenant scope is users.tenant_id → tenants.id.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS msp_role              text NOT NULL DEFAULT 'Free',
  ADD COLUMN IF NOT EXISTS msp_id                integer,
  ADD COLUMN IF NOT EXISTS tenant_id             integer,
  ADD COLUMN IF NOT EXISTS is_active             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_approve_purchases boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enforced          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_login_at  timestamptz,
  ADD COLUMN IF NOT EXISTS locked_until          timestamptz,
  ADD COLUMN IF NOT EXISTS theme_preference      text,
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS job_title             text,
  ADD COLUMN IF NOT EXISTS last_login_at         timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_msp_id_fkey' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_msp_id_fkey
      FOREIGN KEY (msp_id) REFERENCES msps(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_fkey' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_msp_id_idx    ON users (msp_id);
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users (tenant_id);

-- Backfill from msp_users (1:1 on user_id). users with no msp_users row keep
-- the 'Free' default — they are all wiped below anyway. tenant_id stays NULL:
-- tenants starts empty; there is nothing valid to map the old customer_id to.
SELECT pg_temp.exec_if_exists('msp_users', $q$
  UPDATE users u SET
    msp_role              = mu.msp_role,
    msp_id                = mu.msp_id,
    is_active             = mu.is_active,
    can_approve_purchases = mu.can_approve_purchases,
    mfa_enforced          = mu.mfa_enforced,
    failed_login_attempts = mu.failed_login_attempts,
    last_failed_login_at  = mu.last_failed_login_at,
    locked_until          = mu.locked_until,
    theme_preference      = mu.theme_preference,
    department            = mu.department,
    job_title             = mu.job_title,
    last_login_at         = mu.last_login_at,
    updated_at            = mu.updated_at
  FROM msp_users mu
  WHERE mu.user_id = u.id
$q$);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Corrected role-scope CHECK constraint (correction to the original
--    "tenantId cannot be null" spec, per resolved decision #4 on #92):
--    tenant-scoped roles need tenant_id, MSP-scoped roles need msp_id,
--    PlatformAdmin needs neither. Added NOT VALID here (pre-wipe rows all
--    violate it — every Free/CustomerUser has tenant_id NULL), then
--    VALIDATEd after the wipe in step 5.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_scope_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_scope_check CHECK (
      (msp_role IN ('CustomerUser', 'Free', 'Assessment') AND tenant_id IS NOT NULL)
      OR
      (msp_role IN ('MSPAdmin', 'MSPOperator', 'ServiceAccount') AND msp_id IS NOT NULL)
      OR
      (msp_role = 'PlatformAdmin')
    ) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The wipe. Survivors: users with msp_role = 'PlatformAdmin' (Shane) and
--    msps.id = 1 (shane-mccaw-consulting). Everything customer-, tenant- or
--    non-kept-user-scoped is deleted; platform/service/project/engine-config
--    data is preserved with dangling FKs nulled. Dependency-ordered explicit
--    deletes — live FK cascade behaviors are NOT relied on.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE wipe_kept_users ON COMMIT DROP AS
  SELECT id FROM users WHERE msp_role = 'PlatformAdmin';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM wipe_kept_users;
  IF n = 0 THEN
    RAISE EXCEPTION 'Wipe aborted: no PlatformAdmin user found after msp_users backfill — refusing to delete every login. Check msp_users.msp_role data before re-running.';
  END IF;
  RAISE NOTICE 'Keeping % PlatformAdmin user(s)', n;
END $$;

-- ── 4a. Rows of the five retired tables (clears their outgoing RESTRICT FKs
--        on users/msps/msp_customers before those parents are touched).
SELECT pg_temp.exec_if_exists('tenant_consent',            'DELETE FROM tenant_consent');
SELECT pg_temp.exec_if_exists('tenant_write_consent',      'DELETE FROM tenant_write_consent');
SELECT pg_temp.exec_if_exists('tenant_sharepoint_consent', 'DELETE FROM tenant_sharepoint_consent');
SELECT pg_temp.exec_if_exists('msp_users',                 'DELETE FROM msp_users');

-- ── 4b. Grandchildren first (children of rows that die below).

-- children of insights_generated_documents (ALL IGD rows die — the table is
-- per-customer generated output and its msp_customer_id is NOT NULL into the
-- dropped id-space):
SELECT pg_temp.exec_if_exists('assessment_sow_agreements', 'DELETE FROM assessment_sow_agreements');
SELECT pg_temp.exec_if_exists('presentation_doc_views',    'DELETE FROM presentation_doc_views');   -- per-customer view tracking: DELETE
SELECT pg_temp.exec_if_exists('quick_win_result_shares',   'DELETE FROM quick_win_result_shares');  -- per-customer share links: DELETE

-- children of sales_offers rows that die (offers are per-customer engine output):
SELECT pg_temp.exec_if_exists('sales_offer_events', $q$
  DELETE FROM sales_offer_events WHERE offer_id IN
    (SELECT id FROM sales_offers WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM wipe_kept_users))
$q$);

-- children of tenant_engine_snapshots (ALL die — per-tenant runtime data):
SELECT pg_temp.exec_if_exists('engine_score_signal_deltas', 'DELETE FROM engine_score_signal_deltas');

-- children of msp_diagnostic_runs (ALL die — per-tenant runtime output):
SELECT pg_temp.exec_if_exists('msp_diagnostic_findings', 'DELETE FROM msp_diagnostic_findings');

-- children of break_glass_pending_secrets (ALL die — customer-scoped):
SELECT pg_temp.exec_if_exists('break_glass_verification_attempts', 'DELETE FROM break_glass_verification_attempts');

-- children of msp_sows / msp-scoped billing rows that die (msp_id <> 1):
SELECT pg_temp.exec_if_exists('msp_charges', $q$
  DELETE FROM msp_charges WHERE msp_id <> 1
    OR sow_id IN (SELECT id FROM msp_sows WHERE msp_id <> 1)
$q$);
SELECT pg_temp.exec_if_exists('msp_sow_events', $q$
  DELETE FROM msp_sow_events WHERE sow_id IN (SELECT id FROM msp_sows WHERE msp_id <> 1)
$q$);

-- children of msp_documents rows that die (msp_id <> 1):
SELECT pg_temp.exec_if_exists('msp_document_versions', $q$
  DELETE FROM msp_document_versions WHERE document_id IN (SELECT id FROM msp_documents WHERE msp_id <> 1)
$q$);

-- children of msp_report_canvases / dashboard_templates that die (msp_id <> 1):
SELECT pg_temp.exec_if_exists('msp_report_schedules', $q$
  DELETE FROM msp_report_schedules WHERE msp_id <> 1
    OR canvas_id IN (SELECT id FROM msp_report_canvases WHERE msp_id <> 1)
$q$);
SELECT pg_temp.exec_if_exists('dashboard_overrides', $q$
  DELETE FROM dashboard_overrides WHERE template_id IN (SELECT id FROM dashboard_templates WHERE msp_id <> 1)
$q$);

-- children of outbound_webhooks rows that die:
SELECT pg_temp.exec_if_exists('outbound_webhook_deliveries', $q$
  DELETE FROM outbound_webhook_deliveries WHERE webhook_id IN (
    SELECT id FROM outbound_webhooks
    WHERE customer_id IS NOT NULL OR (msp_id IS NOT NULL AND msp_id <> 1))
$q$);

-- children of engagement_offer_rules rows that die (msp_id <> 1):
SELECT pg_temp.exec_if_exists('engagement_offer_firings', $q$
  DELETE FROM engagement_offer_firings WHERE rule_id IN
    (SELECT id FROM engagement_offer_rules WHERE msp_id IS NOT NULL AND msp_id <> 1)
$q$);

-- children of policy_rules rows that die (msp_id <> 1) + per-tenant runtime
-- firing data (DELETE ALL — it only describes wiped tenants):
SELECT pg_temp.exec_if_exists('policy_rule_firings',     'DELETE FROM policy_rule_firings');
SELECT pg_temp.exec_if_exists('policy_rule_incidents',   'DELETE FROM policy_rule_incidents');
SELECT pg_temp.exec_if_exists('policy_rule_suppressions', $q$
  DELETE FROM policy_rule_suppressions WHERE customer_id IS NOT NULL OR msp_id <> 1
    OR rule_id IN (SELECT id FROM policy_rules WHERE msp_id IS NOT NULL AND msp_id <> 1)
$q$);

-- children of client_services rows that die: keep the workflow step (project/
-- workflow data), NULL the link:
SELECT pg_temp.exec_if_exists('workflow_steps', $q$
  UPDATE workflow_steps SET client_service_id = NULL WHERE client_service_id IN
    (SELECT id FROM client_services WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users))
$q$);

-- children of azure_tenant_credentials (ALL die — per-tenant credentials):
-- keep runbook history rows (operational log), NULL the credential link:
SELECT pg_temp.exec_if_exists('runbook_job_history',
  'UPDATE runbook_job_history SET credential_id = NULL WHERE credential_id IS NOT NULL');

-- ── 4c. Customer-/tenant-scoped tables: DELETE (worthless post-wipe).

SELECT pg_temp.exec_if_exists('tenant_engine_overrides',       'DELETE FROM tenant_engine_overrides');
SELECT pg_temp.exec_if_exists('tenant_engine_snapshots',       'DELETE FROM tenant_engine_snapshots');
SELECT pg_temp.exec_if_exists('tenant_signal_history',         'DELETE FROM tenant_signal_history');
SELECT pg_temp.exec_if_exists('engine_baseline_history',       'DELETE FROM engine_baseline_history');
SELECT pg_temp.exec_if_exists('engine_score_daily_rollup',     'DELETE FROM engine_score_daily_rollup');
SELECT pg_temp.exec_if_exists('insights_generated_documents',  'DELETE FROM insights_generated_documents');
SELECT pg_temp.exec_if_exists('m365_service_health_samples',   'DELETE FROM m365_service_health_samples');
SELECT pg_temp.exec_if_exists('msp_message_center_items',      'DELETE FROM msp_message_center_items');
SELECT pg_temp.exec_if_exists('msp_customer_clickwraps',       'DELETE FROM msp_customer_clickwraps');
SELECT pg_temp.exec_if_exists('msp_diagnostic_runs',           'DELETE FROM msp_diagnostic_runs');
SELECT pg_temp.exec_if_exists('msp_report_runs',               'DELETE FROM msp_report_runs');
SELECT pg_temp.exec_if_exists('msp_job_queue',                 'DELETE FROM msp_job_queue');
SELECT pg_temp.exec_if_exists('msp_sales_bundle_assignments',  'DELETE FROM msp_sales_bundle_assignments');
SELECT pg_temp.exec_if_exists('msp_staff_customer_scopes',     'DELETE FROM msp_staff_customer_scopes');
SELECT pg_temp.exec_if_exists('break_glass_pending_secrets',   'DELETE FROM break_glass_pending_secrets');
SELECT pg_temp.exec_if_exists('break_glass_override_audit',    'DELETE FROM break_glass_override_audit');
SELECT pg_temp.exec_if_exists('dashboard_executive_summaries', 'DELETE FROM dashboard_executive_summaries');
SELECT pg_temp.exec_if_exists('consent_invite_tokens',         'DELETE FROM consent_invite_tokens');
SELECT pg_temp.exec_if_exists('azure_tenant_credentials',      'DELETE FROM azure_tenant_credentials');
SELECT pg_temp.exec_if_exists('outbound_webhooks', $q$
  DELETE FROM outbound_webhooks
  WHERE customer_id IS NOT NULL OR (msp_id IS NOT NULL AND msp_id <> 1)
$q$);

-- ── 4d. Non-kept-user-scoped tables: DELETE.

SELECT pg_temp.exec_if_exists('account_setup_tokens',
  'DELETE FROM account_setup_tokens WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_app_registrations',
  'DELETE FROM client_app_registrations WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_automation_runs',
  'DELETE FROM client_automation_runs WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_callback_tokens',
  'DELETE FROM client_callback_tokens WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_documents',
  'DELETE FROM client_documents WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_health_history',
  'DELETE FROM client_health_history WHERE client_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_m365_profiles',
  'DELETE FROM client_m365_profiles WHERE client_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_scores',
  'DELETE FROM client_scores WHERE client_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('client_services',
  'DELETE FROM client_services WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
-- contracts of wiped users: DELETE (test-era client contracts, no value post-wipe — flagged in #93 completion comment)
SELECT pg_temp.exec_if_exists('contracts',
  'DELETE FROM contracts WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('customer_notification_preferences',
  'DELETE FROM customer_notification_preferences WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('email_domain_rules',
  'DELETE FROM email_domain_rules WHERE linked_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('impersonation_tokens', $q$
  DELETE FROM impersonation_tokens
  WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)
     OR admin_user_id  NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('invoices',
  'DELETE FROM invoices WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('messages', $q$
  DELETE FROM messages
  WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)
     OR sender_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('mfa_bypass_codes',
  'DELETE FROM mfa_bypass_codes WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('mfa_challenges',
  'DELETE FROM mfa_challenges WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('mfa_enrollments',
  'DELETE FROM mfa_enrollments WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('notifications',
  'DELETE FROM notifications WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('password_reset_tokens',
  'DELETE FROM password_reset_tokens WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('push_subscriptions',
  'DELETE FROM push_subscriptions WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('quick_win_presentations',
  'DELETE FROM quick_win_presentations WHERE client_user_id IS NOT NULL AND client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('reports',
  'DELETE FROM reports WHERE client_user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('sales_offers',
  'DELETE FROM sales_offers WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('script_download_tokens', $q$
  DELETE FROM script_download_tokens
  WHERE (client_user_id IS NOT NULL AND client_user_id NOT IN (SELECT id FROM wipe_kept_users))
     OR (customer_id    IS NOT NULL AND customer_id    NOT IN (SELECT id FROM wipe_kept_users))
$q$);
SELECT pg_temp.exec_if_exists('insights_automations',
  'DELETE FROM insights_automations WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('user_entitlement_overrides',
  'DELETE FROM user_entitlement_overrides WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('user_sessions',
  'DELETE FROM user_sessions WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('webauthn_challenges',
  'DELETE FROM webauthn_challenges WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM wipe_kept_users)');
SELECT pg_temp.exec_if_exists('webauthn_credentials',
  'DELETE FROM webauthn_credentials WHERE user_id NOT IN (SELECT id FROM wipe_kept_users)');

-- ── 4e. Preserved tables (platform / project / CRM / audit data): NULL the
--        FKs that point at wiped users; keep the rows.

SELECT pg_temp.exec_if_exists('audit_logs', $q$
  UPDATE audit_logs SET actor_user_id = NULL
  WHERE actor_user_id IS NOT NULL AND actor_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('audit_logs', $q$
  UPDATE audit_logs SET client_id = NULL
  WHERE client_id IS NOT NULL AND client_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('documents', $q$
  UPDATE documents SET uploaded_by = NULL
  WHERE uploaded_by IS NOT NULL AND uploaded_by NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('client_documents', $q$
  UPDATE client_documents SET uploaded_by = NULL
  WHERE uploaded_by IS NOT NULL AND uploaded_by NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('emails', $q$
  UPDATE emails SET linked_user_id = NULL
  WHERE linked_user_id IS NOT NULL AND linked_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('inbox_message_links', $q$
  UPDATE inbox_message_links SET customer_id = NULL
  WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('projects', $q$
  UPDATE projects SET client_user_id = NULL
  WHERE client_user_id IS NOT NULL AND client_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('projects', $q$
  UPDATE projects SET signed_off_by = NULL
  WHERE signed_off_by IS NOT NULL AND signed_off_by NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('project_updates', $q$
  UPDATE project_updates SET author_user_id = NULL
  WHERE author_user_id IS NOT NULL AND author_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('project_closures', $q$
  UPDATE project_closures SET signer_user_id = NULL
  WHERE signer_user_id IS NOT NULL AND signer_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('status_reports', $q$
  UPDATE status_reports SET client_user_id = NULL
  WHERE client_user_id IS NOT NULL AND client_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('script_run_results', $q$
  UPDATE script_run_results SET customer_id = NULL
  WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('sales_offer_events', $q$
  UPDATE sales_offer_events SET actor_user_id = NULL
  WHERE actor_user_id IS NOT NULL AND actor_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('mfa_bypass_codes', $q$
  UPDATE mfa_bypass_codes SET created_by_user_id = NULL
  WHERE created_by_user_id IS NOT NULL AND created_by_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);
SELECT pg_temp.exec_if_exists('user_entitlement_overrides', $q$
  UPDATE user_entitlement_overrides SET granted_by_user_id = NULL
  WHERE granted_by_user_id IS NOT NULL AND granted_by_user_id NOT IN (SELECT id FROM wipe_kept_users)
$q$);

-- NULL the customer_id columns that survive on preserved msp-scoped tables
-- (the msp_customers id-space is destroyed below; Phase 7 drops the columns):
SELECT pg_temp.exec_if_exists('msp_audit_logs',
  'UPDATE msp_audit_logs SET customer_id = NULL WHERE customer_id IS NOT NULL');
SELECT pg_temp.exec_if_exists('msp_documents',
  'UPDATE msp_documents SET customer_id = NULL WHERE customer_id IS NOT NULL');
SELECT pg_temp.exec_if_exists('msp_report_definitions',
  'UPDATE msp_report_definitions SET customer_id = NULL WHERE customer_id IS NOT NULL');
SELECT pg_temp.exec_if_exists('msp_sows',
  'UPDATE msp_sows SET customer_id = NULL WHERE customer_id IS NOT NULL');

-- ── 4f. MSP-scoped rows of every msps-referencing table, for MSPs other than
--        id=1 (removes MSP 114 + its test estate). Engine-config tables with
--        nullable msp_id (signal_derivation_rules, signal_rule_groups,
--        simulation_profiles) are PRESERVED as global by nulling msp_id,
--        mirroring their declared ON DELETE SET NULL semantics.

SELECT pg_temp.exec_if_exists('msp_agreement_acceptances',
  'DELETE FROM msp_agreement_acceptances WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_ai_purchases',            'DELETE FROM msp_ai_purchases WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_change_requests',         'DELETE FROM msp_change_requests WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_connector_configs',       'DELETE FROM msp_connector_configs WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_custom_domains',          'DELETE FROM msp_custom_domains WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_email_templates',         'DELETE FROM msp_email_templates WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_invites',                 'DELETE FROM msp_invites WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_mailbox_consent_states',  'DELETE FROM msp_mailbox_consent_states WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_mailbox_connectors',      'DELETE FROM msp_mailbox_connectors WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_onboarding_links',        'DELETE FROM msp_onboarding_links WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_overrides',               'DELETE FROM msp_overrides WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_partner_qbrs',            'DELETE FROM msp_partner_qbrs WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_report_canvases',         'DELETE FROM msp_report_canvases WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_report_definitions',      'DELETE FROM msp_report_definitions WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_risk_decisions',          'DELETE FROM msp_risk_decisions WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_sales_bundles',           'DELETE FROM msp_sales_bundles WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_score_history',           'DELETE FROM msp_score_history WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_service_accounts',        'DELETE FROM msp_service_accounts WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_sharepoint_connectors',   'DELETE FROM msp_sharepoint_connectors WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_sop_runs',                'DELETE FROM msp_sop_runs WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_sops',                    'DELETE FROM msp_sops WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_subscriptions',           'DELETE FROM msp_subscriptions WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_sows',                    'DELETE FROM msp_sows WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_documents',               'DELETE FROM msp_documents WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('msp_audit_logs',              'DELETE FROM msp_audit_logs WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('dashboard_templates',         'DELETE FROM dashboard_templates WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('zoho_connection',             'DELETE FROM zoho_connection WHERE msp_id <> 1');
SELECT pg_temp.exec_if_exists('engagement_offer_rules',      'DELETE FROM engagement_offer_rules WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('lead_offer_inference_rules',  'DELETE FROM lead_offer_inference_rules WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('lead_offer_pricing_config',   'DELETE FROM lead_offer_pricing_config WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('lead_scoring_config',         'DELETE FROM lead_scoring_config WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('lead_scoring_rules',          'DELETE FROM lead_scoring_rules WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('lead_scoring_tracked_pages',  'DELETE FROM lead_scoring_tracked_pages WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('policy_rules',                'DELETE FROM policy_rules WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('signal_derivation_rules',
  'UPDATE signal_derivation_rules SET msp_id = NULL WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('signal_rule_groups',
  'UPDATE signal_rule_groups SET msp_id = NULL WHERE msp_id IS NOT NULL AND msp_id <> 1');
SELECT pg_temp.exec_if_exists('simulation_profiles',
  'UPDATE simulation_profiles SET msp_id = NULL WHERE msp_id IS NOT NULL AND msp_id <> 1');

-- ── 4g. The parents.

SELECT pg_temp.exec_if_exists('msp_customers', 'DELETE FROM msp_customers');

DELETE FROM users WHERE id NOT IN (SELECT id FROM wipe_kept_users);

-- A kept PlatformAdmin pointing at a dying MSP would block the msps delete;
-- PlatformAdmin requires no msp_id, so detach rather than abort:
UPDATE users SET msp_id = NULL WHERE msp_id IS NOT NULL AND msp_id <> 1;

DELETE FROM msps WHERE id <> 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Post-wipe verification + constraint validation.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE n_msps integer; n_users integer; n_bad integer;
BEGIN
  SELECT count(*) INTO n_msps FROM msps;
  IF n_msps <> 1 THEN
    RAISE EXCEPTION 'Wipe verification failed: expected exactly 1 msps row, found %', n_msps;
  END IF;
  SELECT count(*) INTO n_users FROM users;
  SELECT count(*) INTO n_bad FROM users WHERE msp_role <> 'PlatformAdmin';
  IF n_users < 1 OR n_bad > 0 THEN
    RAISE EXCEPTION 'Wipe verification failed: % users remain, % non-PlatformAdmin', n_users, n_bad;
  END IF;
  RAISE NOTICE 'Wipe verified: 1 msp, % PlatformAdmin user(s) kept', n_users;
END $$;

ALTER TABLE users VALIDATE CONSTRAINT users_role_scope_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Drop the five retired tables. CASCADE removes the FK constraints that
--    surviving tables still hold against msp_customers (their integer columns
--    remain, orphaned, until Phase 7 cleanup).
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS tenant_consent            CASCADE;
DROP TABLE IF EXISTS tenant_write_consent      CASCADE;
DROP TABLE IF EXISTS tenant_sharepoint_consent CASCADE;
DROP TABLE IF EXISTS msp_users                 CASCADE;
DROP TABLE IF EXISTS msp_customers             CASCADE;

COMMIT;
