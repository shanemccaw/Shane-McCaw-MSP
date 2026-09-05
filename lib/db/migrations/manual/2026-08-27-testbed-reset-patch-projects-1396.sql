-- 2026-08-27-testbed-reset-patch-projects-1396.sql
--
-- Originally: a real patch to #1329's comprehensive reset -- projects (and
-- its FK dependents) were genuinely missed. #1329's schema search looked for
-- tenant_id (text) / customer_id (integer) columns; projects.client_user_id
-- references users.id instead, a different FK shape that search didn't
-- catch. Confirmed via schema read (lib/db/src/schema/index.ts) after Shane
-- found real "Project & release schedule" data survive a real #1329 run.
--
-- EXTENDED 2026-08-28 (Git #1471): per Shane's direction, this file is now
-- the single, self-sufficient testbed reset -- running THIS file alone
-- cleans everything, rather than requiring #1329 and #1471's own patch file
-- to be run alongside it. It now folds in:
--   1. Every DELETE #1329 originally ran (customer_id + tenant_id-guid
--      scoped tables).
--   2. This file's own original project + FK-dependent cleanup (below).
--   3. Every genuinely tenant/customer-scoped table #1471's live
--      information_schema audit found with no coverage in either prior
--      file: Scope Creep Engine (6 tables), SLA Engine (4 tables),
--      drift_collection_status, msp_report_definitions,
--      tenant_compliance_scope, war_room_interaction_events.
-- #1329's own file and #1471's standalone patch file are both left in place
-- as the historical record of when/why each table was added, but neither
-- needs to be run separately any more -- this file supersedes running them.
--
-- EXTENDED 2026-08-30 (Git #1573): the projects cleanup above is keyed on
-- `client_user_id = ANY(v_user_ids)` -- the reset TARGET tenant's own users.
-- That leaves a real gap: a project whose `client_user_id` is NULL matches no
-- tenant's user array (`NULL = ANY(...)` is NULL, never TRUE), so an orphan
-- project belongs to nobody and is invisible to every reset run regardless of
-- which tenant is being reset. #1573's live-DB finding confirmed exactly this
-- -- 6 rows (ids 2-7), one per service, `client_user_id IS NULL`, created in a
-- 3-day window (21-23 Jul 2026) during purchase-flow testing, 48 orphaned
-- workflow_steps and 6 orphaned documents rows hanging off them. These are
-- confirmed test artifacts, not intentional service templates: the only live
-- path that creates a real customer project --
-- artifacts/api-server/src/lib/project-sow-fulfillment.ts's
-- fulfillAcceptedProjectOffer() -- explicitly REFUSES to insert a project row
-- when no owner user can be resolved (status "no_owner", returned BEFORE the
-- insert). So a customer-less project is never legitimate output of the real
-- product; it can currently only be produced by a caller of
-- POST /api/admin/projects that omits clientUserId (admin-projects.ts:130
-- defaults it to null with no validation -- filed as its own finding, not
-- fixed here). The new block below sweeps every orphan project (and its same
-- FK-dependent children as the tenant-scoped block) on every reset run, not
-- just this tenant's own -- an orphan project should never survive a reset,
-- because it belongs to no tenant for a reset to even target.
--
-- Every DELETE is now guarded with `to_regclass(...) IS NOT NULL` -- a live
-- audit for #1471 found the Replit staging DB's schema genuinely lags local
-- dev for 13 tables (customer_alert_*, drift_*, license_assignment_snapshots,
-- overshared_items, retainer_*, tenant_compliance_scope). A missing table
-- has zero rows for this tenant by definition, so the guard is a no-op
-- wherever the table already exists and a silent skip (logged via RAISE
-- NOTICE) wherever it doesn't -- this lets the SAME file run cleanly on any
-- environment regardless of how caught-up its schema is, rather than
-- hard-aborting the whole transaction on the first missing relation.
--
-- insights_generated_documents and insights_automations reference
-- projectId, but are customer_id-scoped (covered in the loop below) --
-- not touched twice, no incremental risk.
--
-- DELIBERATELY EXCLUDED, never wiped by this file:
--   client_services -- real PURCHASED/ACTIVE service state (Monitoring
--     tier assignment, etc.), not test scaffolding. Clearing it could
--     remove the test account's Premier tier assignment.
--   tenant_add_on_entitlements -- same reasoning, real purchased/active
--     add-on entitlement state (status active/canceled, purchased_at).
-- Both flagged for Shane's own explicit decision, not wiped by default.
--
-- KEPT untouched, confirmed still accurate by #1471's live audit: tenants,
-- azure_tenant_credentials, client_app_registrations, consent_invite_tokens
-- (identity/consent). msp_sharepoint_connectors / msp_mailbox_connectors are
-- Shane's own MSP infra (keyed by msp_id NOT NULL; their tenant_id column is
-- the CONNECTOR'S OWN target M365 tenant, not the testbed customer). users
-- is identity -- deleting rows there would break the test account's own
-- login.
--
-- EXTENDED 2026-09-05 (Git #2946): `scripts/testbed-reset-audit.mjs` (built for
-- #2493) generalized the coverage check further -- it reads REAL FK constraints
-- out of information_schema for every table referencing tenants(id), users(id)
-- or projects(id), rather than assuming this file's own table lists are
-- exhaustive. That found 50 more real FK edges this file didn't cover. Of
-- those:
--   - 44 are clearly customer/tenant test data and are added below: 19 via a
--     new users(id)-scoped loop (client_documents, client_automation_runs,
--     client_health_history, client_m365_profiles, client_scores, messages,
--     impersonation_tokens, quick_win_result_shares, notifications,
--     customer_notification_preferences, document_print_tokens, print_tokens,
--     email_domain_rules, emails, sales_offer_events, msp_invites,
--     user_entitlement_overrides, signup_exchange_tokens,
--     account_setup_tokens), 13 via an extended tenant_id(integer)-scoped loop
--     (active_directory_ous, config_change_attributions,
--     config_change_lifecycle, config_change_scopes, config_resource_samples,
--     config_snapshot_baselines, config_model_extractions,
--     policy_evaluation_runs, record_deletions, retention_policies,
--     tenant_config_snapshots, tenant_subscriptions, and folding in
--     tenant_compliance_scope which was already its own IF block), a
--     dedicated config_diffs block (base_tenant_id/head_tenant_id, two
--     columns into the same parent), active_directory_ou_assignments folded
--     into the existing customer_id loop (it has both a customer_id and a
--     tenant_id(text) column; customer_id matches this file's existing
--     pattern), and emails.linked_project_id handled as its own statement
--     alongside the projects cleanup below (a different column than the
--     `project_id` children that loop already sweeps).
--   - The remaining 6 FK edges the audit tool also lists (client_documents
--     .uploaded_by, impersonation_tokens.admin_user_id, messages
--     .sender_user_id, user_entitlement_overrides.granted_by_user_id -- each
--     counted twice for duplicate FK constraint names in the live schema) are
--     the STAFF/ADMIN side of a row already swept via its customer-side
--     column above (client_user_id / client_user_id / user_id respectively)
--     -- not additional customer data, the acting staff user's own identity.
--     Scoping a delete by these would only ever match if a tenant's own
--     customer user happened to be the actor, which isn't the real gap here;
--     added to testbed-reset-audit.mjs's DELIBERATE_EXCLUSIONS with this same
--     reasoning rather than wired into a delete.
--   - 7 are the auth/session/identity set the audit tool explicitly flags as
--     a genuine open product decision, same "flag, don't assume" discipline
--     as client_services above -- NOT touched here, left exactly as found:
--     mfa_challenges, mfa_enrollments, password_reset_tokens, user_sessions,
--     webauthn_challenges, webauthn_credentials, push_subscriptions. Wiping
--     these on a tenant reset could log the test account out or break its
--     MFA/passkey enrollment -- that's Shane's call, not this build's.
--
-- v_user_ids is now computed up-front (moved from just above the projects
-- block) because the new users(id)-scoped loop needs it earlier, and because
-- print_tokens.document_id -> insights_generated_documents(id) has NO ACTION
-- (not CASCADE) -- print_tokens must be deleted BEFORE the customer_id loop
-- below deletes insights_generated_documents, or that DELETE fails with a
-- live FK violation. Same reasoning puts config_snapshot_baselines ahead of
-- tenant_config_snapshots in the new tenant_id(integer) loop (also NO ACTION).

BEGIN;

DO $$
DECLARE
  v_tenant_id INT;
  v_tenant_guid TEXT := 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  v_user_ids INT[];
  t TEXT;
  tc TEXT;
  col TEXT;
  n INT;
  total INT := 0;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE tenant_id = v_tenant_guid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Testbed tenant (mccawsoft2.onmicrosoft.com) not found -- aborting, nothing changed.';
  END IF;

  SELECT array_agg(id) INTO v_user_ids FROM users WHERE tenant_id = v_tenant_id;

  -- ── users(id)-scoped tables, via this tenant's own users (#2946) ───────
  -- Real FK edges into users(id) that testbed-reset-audit.mjs found with no
  -- coverage. Must run BEFORE the customer_id loop below (see header note --
  -- print_tokens -> insights_generated_documents is NO ACTION).
  IF v_user_ids IS NULL THEN
    RAISE NOTICE 'No user rows found for this tenant -- user-scoped cleanup skipped.';
  ELSE
    FOREACH tc IN ARRAY ARRAY[
      'client_documents:client_user_id','client_automation_runs:client_user_id',
      'client_health_history:client_id','client_m365_profiles:client_id',
      'client_scores:client_id','messages:client_user_id',
      'impersonation_tokens:client_user_id','quick_win_result_shares:client_user_id',
      'notifications:user_id','customer_notification_preferences:user_id',
      'document_print_tokens:user_id','print_tokens:user_id',
      'email_domain_rules:linked_user_id','emails:linked_user_id',
      'sales_offer_events:actor_user_id','msp_invites:invited_by_user_id',
      'user_entitlement_overrides:user_id','signup_exchange_tokens:user_id',
      'account_setup_tokens:user_id'
    ] LOOP
      t := split_part(tc, ':', 1);
      col := split_part(tc, ':', 2);
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format('DELETE FROM %I WHERE %I = ANY($1)', t, col) USING v_user_ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
        IF n > 0 THEN RAISE NOTICE '  % : deleted % row(s)', t, n; END IF;
      ELSE
        RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
      END IF;
    END LOOP;
  END IF;

  -- ── customer_id (integer, tenants.id) scoped tables ────────────────────
  -- #1329's original 51 + #1471's live-audit additions (msp_report_definitions,
  -- the Scope Creep Engine, the SLA Engine, war_room_interaction_events) +
  -- #2946's addition (active_directory_ou_assignments -- has both customer_id
  -- and tenant_id(text); customer_id matches this loop's existing pattern).
  FOREACH t IN ARRAY ARRAY[
    'msp_staff_customer_scopes','msp_event_store','msp_dlq_store','msp_documents',
    'msp_audit_logs','fulfillment_queue','msp_job_queue','outbound_webhooks',
    'portal_wf_runs','portal_wf_operator_tasks','ai_usage_events','msp_report_runs',
    'msp_diagnostic_findings','msp_sows','msp_customer_clickwraps',
    'break_glass_pending_secrets','break_glass_override_audit',
    'dashboard_executive_summaries','remediation_tracker_steps','portal_runbooks',
    'portal_hold_windows','portal_security_plans','portal_ownership_assignments',
    'portal_ownership_delegations','portal_ownership_rows','customer_alert_preferences',
    'customer_alert_settings','customer_alert_recipients','customer_alert_digest_queue',
    'retainer_settings','retainer_work_log','live_document_shares','tenant_signal_history',
    'mfa_bypass_codes','inbox_message_links','script_run_results','script_download_tokens',
    'insights_generated_documents','assessment_sow_agreements','insights_automations',
    'sales_offers','tenant_engine_snapshots','tenant_pillar_snapshots',
    'engine_score_daily_rollup','policy_rule_firings','policy_rule_incidents',
    'policy_rule_suppressions','engine_baseline_history','platform_log_stream',
    'exception_occurrences','msp_sales_bundle_assignments',
    'msp_report_definitions','scope_creep_assignments','scope_creep_compliance',
    'scope_creep_detections','scope_creep_escalations','scope_creep_scores',
    'scope_creep_violations','sla_breaches','sla_compliance_records','sla_escalations',
    'sla_timers','war_room_interaction_events','active_directory_ou_assignments'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE customer_id = $1', t) USING v_tenant_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN RAISE NOTICE '  % : deleted % row(s)', t, n; END IF;
    ELSE
      RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
    END IF;
  END LOOP;

  -- ── tenant_id (text, the real M365 tenant GUID) scoped tables ──────────
  -- #1329's original 16 + #1471's live-audit addition (drift_collection_status).
  -- msp_sharepoint_connectors / msp_mailbox_connectors deliberately NOT
  -- included -- see header, these are Shane's own MSP infra, not customer
  -- data, and are scoped by msp_id not this tenant anyway.
  FOREACH t IN ARRAY ARRAY[
    'tenant_monitor_profiles','tenant_check_item_details','overshared_items',
    'license_assignment_snapshots','simulator_check_runs','msp_message_center_items',
    'm365_service_health_samples','msp_diagnostic_runs','activity_subscriptions',
    'msp_change_requests','msp_sop_runs','msp_risk_decisions','drift_baseline_snapshots',
    'drift_events','customer_tenant_alert_events','checkout_sessions',
    'drift_collection_status'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', t) USING v_tenant_guid;
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN RAISE NOTICE '  % : deleted % row(s)', t, n; END IF;
    ELSE
      RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
    END IF;
  END LOOP;

  -- ── tenant_id (integer, tenants.id -- same FK shape as customer_id above,
  -- just named tenant_id, or a differently-named column, on these tables) ──
  -- #1471's original single entry (tenant_compliance_scope) folded in here,
  -- plus #2946's live-audit additions. config_snapshot_baselines must run
  -- before tenant_config_snapshots (NO ACTION FK, not CASCADE -- see header).
  FOREACH tc IN ARRAY ARRAY[
    'tenant_compliance_scope:tenant_id','active_directory_ous:tenant_id',
    'config_change_attributions:tenant_id','config_change_lifecycle:tenant_id',
    'config_change_scopes:tenant_id','config_snapshot_baselines:tenant_id',
    'config_resource_samples:tenant_id',
    'config_model_extractions:reconciled_against_tenant_id',
    'policy_evaluation_runs:tenant_id','record_deletions:tenant_id',
    'retention_policies:tenant_id','tenant_config_snapshots:tenant_id',
    'tenant_subscriptions:tenant_id'
  ] LOOP
    t := split_part(tc, ':', 1);
    col := split_part(tc, ':', 2);
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I WHERE %I = $1', t, col) USING v_tenant_id;
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN RAISE NOTICE '  % : deleted % row(s)', t, n; END IF;
    ELSE
      RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
    END IF;
  END LOOP;

  -- config_diffs has TWO columns into tenants(id) (drift-mode diffs have
  -- base_tenant_id = head_tenant_id; tenant_compare/promotion diffs differ) --
  -- match either side. Run before tenant_config_snapshots in the loop above
  -- reads as fine either way (config_diffs -> tenant_config_snapshots is
  -- CASCADE), but keep it here, ahead of tenant_config_snapshots, for clarity.
  IF to_regclass('public.config_diffs') IS NOT NULL THEN
    DELETE FROM config_diffs WHERE base_tenant_id = v_tenant_id OR head_tenant_id = v_tenant_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN RAISE NOTICE '  config_diffs : deleted % row(s)', n; END IF;
  ELSE
    RAISE NOTICE '  config_diffs : table does not exist on this environment, skipped';
  END IF;

  -- ── projects + FK dependents, via client_user_id -> users.tenant_id ────
  -- This file's own original contribution (#1396): projects.client_user_id
  -- references users.id, a different FK shape #1329's customer_id/tenant_id
  -- schema search never caught. Children first, projects table last.
  -- (v_user_ids is now computed up top -- see #2946 header note.)
  IF v_user_ids IS NULL THEN
    RAISE NOTICE 'No user rows found for this tenant -- project cleanup skipped.';
  ELSE
    FOREACH t IN ARRAY ARRAY[
      'workflow_steps','kanban_tasks','documents','reports','invoices','project_updates',
      'contracts','status_reports','project_closures','audit_logs','opportunities',
      'client_callback_tokens','quick_win_presentations'
    ] LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format(
          'DELETE FROM %I WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY($1))',
          t
        ) USING v_user_ids;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
        IF n > 0 THEN RAISE NOTICE '  % : deleted % row(s)', t, n; END IF;
      ELSE
        RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
      END IF;
    END LOOP;

    -- emails.linked_project_id -> projects.id (#2946) -- a different column
    -- name than the `project_id` children above, so handled as its own
    -- statement rather than added to that loop. emails already gets its
    -- linked_user_id rows swept by the users(id)-scoped block above; this
    -- closes the other real FK edge into projects(id) the audit tool found
    -- for the same table, before the projects rows themselves are deleted
    -- below (emails.linked_project_id -> projects.id is ON DELETE SET NULL,
    -- so no FK-violation risk either way -- this is about actually sweeping
    -- the row, not just avoiding an error).
    IF to_regclass('public.emails') IS NOT NULL THEN
      DELETE FROM emails WHERE linked_project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN RAISE NOTICE '  emails (via linked_project_id) : deleted % row(s)', n; END IF;
    END IF;

    IF to_regclass('public.projects') IS NOT NULL THEN
      DELETE FROM projects WHERE client_user_id = ANY(v_user_ids);
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
      IF n > 0 THEN RAISE NOTICE '  projects : deleted % row(s)', n; END IF;
    END IF;
  END IF;

  -- ── orphan projects (client_user_id IS NULL) + FK dependents (#1573) ───
  -- Belongs to no tenant, so run unconditionally on every reset -- not
  -- gated behind v_tenant_id/v_user_ids like the block above. Same child
  -- table list and same children-first, projects-last ordering.
  IF to_regclass('public.projects') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY[
      'workflow_steps','kanban_tasks','documents','reports','invoices','project_updates',
      'contracts','status_reports','project_closures','audit_logs','opportunities',
      'client_callback_tokens','quick_win_presentations'
    ] LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format(
          'DELETE FROM %I WHERE project_id IN (SELECT id FROM projects WHERE client_user_id IS NULL)',
          t
        );
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n;
        IF n > 0 THEN RAISE NOTICE '  % (orphan) : deleted % row(s)', t, n; END IF;
      ELSE
        RAISE NOTICE '  % : table does not exist on this environment, skipped', t;
      END IF;
    END LOOP;

    DELETE FROM projects WHERE client_user_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN RAISE NOTICE '  projects (orphan, client_user_id IS NULL) : deleted % row(s)', n; END IF;
  END IF;

  RAISE NOTICE 'Comprehensive testbed reset complete for tenant id=%, guid=%. Total rows deleted: %', v_tenant_id, v_tenant_guid, total;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-27-testbed-reset-patch-projects-1396.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
