-- 2026-08-26-comprehensive-testbed-reset-1329.sql
--
-- Comprehensive reset for the real testbed tenant (mccawsoft2.onmicrosoft.com,
-- tenant_id c4c814d4-3afe-441e-9145-62461d0a4fd3). Supersedes #1299's narrower
-- 6-table version -- a full schema search found 60+ tables scoped by
-- tenant_id/customer_id, accumulated across tonight's many build sessions'
-- live test runs. Per Shane: this is a pure local dev database, nothing
-- "real" is associated with the customer except the consent itself.
--
-- KEPT, never touched: tenants (identity), azure_tenant_credentials,
-- client_app_registrations, consent_invite_tokens (all consent-related).
--
-- EXCLUDED ENTIRELY, not customer data: msp_sharepoint_connectors and
-- msp_mailbox_connectors are scoped by msp_id -- Shane's OWN MSP
-- infrastructure (his outbound-email mailbox, his SharePoint doc
-- connector), confirmed via schema read. Wiping these would break real
-- platform infrastructure, not test data, so they are not touched by this
-- script at all.
--
-- Everything else tenant/customer-scoped is wiped. Two different FK shapes
-- in play -- verified against the real schema before writing this, do not
-- assume:
--   customer_id (integer, tenants.id)  -- most tables
--   tenant_id (text, the real M365 tenant GUID) -- monitoring/drift/
--     oversharing/change-control/risk-decision tables
--
-- Note: msp_customer_clickwraps holds Terms-of-Service acceptance records
-- -- a different kind of "consent" than the M365 Azure consent Shane meant
-- to keep. Included in the wipe per his broad instruction ("nothing real
-- except consent stuff"), but flagged here in case that one should have
-- been preserved -- easy to exclude on a re-run if so.

BEGIN;

DO $$
DECLARE
  v_tenant_id INT;
  v_msp_id INT;
  v_tenant_guid TEXT := 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
BEGIN
  SELECT id, msp_id INTO v_tenant_id, v_msp_id
  FROM tenants
  WHERE tenant_id = v_tenant_guid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Testbed tenant (mccawsoft2.onmicrosoft.com) not found -- aborting, nothing changed.';
  END IF;

  -- ── customer_id (integer) scoped tables ────────────────────────────────
  DELETE FROM msp_staff_customer_scopes WHERE customer_id = v_tenant_id;
  DELETE FROM msp_event_store WHERE customer_id = v_tenant_id;
  DELETE FROM msp_dlq_store WHERE customer_id = v_tenant_id;
  DELETE FROM msp_documents WHERE customer_id = v_tenant_id;
  DELETE FROM msp_audit_logs WHERE customer_id = v_tenant_id;
  DELETE FROM fulfillment_queue WHERE customer_id = v_tenant_id;
  DELETE FROM msp_job_queue WHERE customer_id = v_tenant_id;
  DELETE FROM outbound_webhooks WHERE customer_id = v_tenant_id;
  DELETE FROM portal_wf_runs WHERE customer_id = v_tenant_id;
  DELETE FROM portal_wf_operator_tasks WHERE customer_id = v_tenant_id;
  DELETE FROM ai_usage_events WHERE customer_id = v_tenant_id;
  DELETE FROM msp_report_runs WHERE customer_id = v_tenant_id;
  DELETE FROM msp_diagnostic_findings WHERE customer_id = v_tenant_id;
  DELETE FROM msp_sows WHERE customer_id = v_tenant_id;
  DELETE FROM msp_customer_clickwraps WHERE customer_id = v_tenant_id;
  DELETE FROM break_glass_pending_secrets WHERE customer_id = v_tenant_id;
  DELETE FROM break_glass_override_audit WHERE customer_id = v_tenant_id;
  DELETE FROM dashboard_executive_summaries WHERE customer_id = v_tenant_id;
  DELETE FROM remediation_tracker_steps WHERE customer_id = v_tenant_id;
  DELETE FROM portal_runbooks WHERE customer_id = v_tenant_id;
  DELETE FROM portal_hold_windows WHERE customer_id = v_tenant_id;
  DELETE FROM portal_security_plans WHERE customer_id = v_tenant_id;
  DELETE FROM portal_ownership_assignments WHERE customer_id = v_tenant_id;
  DELETE FROM portal_ownership_delegations WHERE customer_id = v_tenant_id;
  DELETE FROM portal_ownership_rows WHERE customer_id = v_tenant_id;
  DELETE FROM customer_alert_preferences WHERE customer_id = v_tenant_id;
  DELETE FROM customer_alert_settings WHERE customer_id = v_tenant_id;
  DELETE FROM customer_alert_recipients WHERE customer_id = v_tenant_id;
  DELETE FROM customer_alert_digest_queue WHERE customer_id = v_tenant_id;
  DELETE FROM retainer_settings WHERE customer_id = v_tenant_id;
  DELETE FROM retainer_work_log WHERE customer_id = v_tenant_id;
  DELETE FROM live_document_shares WHERE customer_id = v_tenant_id;
  DELETE FROM tenant_signal_history WHERE customer_id = v_tenant_id;
  DELETE FROM mfa_bypass_codes WHERE customer_id = v_tenant_id;
  DELETE FROM inbox_message_links WHERE customer_id = v_tenant_id;
  DELETE FROM script_run_results WHERE customer_id = v_tenant_id;
  DELETE FROM script_download_tokens WHERE customer_id = v_tenant_id;
  DELETE FROM insights_generated_documents WHERE customer_id = v_tenant_id;
  DELETE FROM assessment_sow_agreements WHERE customer_id = v_tenant_id;
  DELETE FROM insights_automations WHERE customer_id = v_tenant_id;
  DELETE FROM sales_offers WHERE customer_id = v_tenant_id;
  DELETE FROM tenant_engine_snapshots WHERE customer_id = v_tenant_id;
  DELETE FROM tenant_pillar_snapshots WHERE customer_id = v_tenant_id;
  DELETE FROM engine_score_daily_rollup WHERE customer_id = v_tenant_id;
  DELETE FROM policy_rule_firings WHERE customer_id = v_tenant_id;
  DELETE FROM policy_rule_incidents WHERE customer_id = v_tenant_id;
  DELETE FROM policy_rule_suppressions WHERE customer_id = v_tenant_id;
  DELETE FROM engine_baseline_history WHERE customer_id = v_tenant_id;
  DELETE FROM platform_log_stream WHERE customer_id = v_tenant_id;
  DELETE FROM exception_occurrences WHERE customer_id = v_tenant_id;
  DELETE FROM msp_sales_bundle_assignments WHERE customer_id = v_tenant_id;

  -- ── tenant_id (text, real GUID) scoped tables ──────────────────────────
  -- msp_sharepoint_connectors / msp_mailbox_connectors deliberately NOT
  -- included -- see header, these are Shane's own MSP infra, not customer
  -- data, and are scoped by msp_id not this tenant anyway.
  DELETE FROM tenant_monitor_profiles WHERE tenant_id = v_tenant_guid;
  DELETE FROM tenant_check_item_details WHERE tenant_id = v_tenant_guid;
  DELETE FROM overshared_items WHERE tenant_id = v_tenant_guid;
  DELETE FROM license_assignment_snapshots WHERE tenant_id = v_tenant_guid;
  DELETE FROM simulator_check_runs WHERE tenant_id = v_tenant_guid;
  DELETE FROM msp_message_center_items WHERE tenant_id = v_tenant_guid;
  DELETE FROM m365_service_health_samples WHERE tenant_id = v_tenant_guid;
  DELETE FROM msp_diagnostic_runs WHERE tenant_id = v_tenant_guid;
  DELETE FROM activity_subscriptions WHERE tenant_id = v_tenant_guid;
  DELETE FROM msp_change_requests WHERE tenant_id = v_tenant_guid;
  DELETE FROM msp_sop_runs WHERE tenant_id = v_tenant_guid;
  DELETE FROM msp_risk_decisions WHERE tenant_id = v_tenant_guid;
  DELETE FROM drift_baseline_snapshots WHERE tenant_id = v_tenant_guid;
  DELETE FROM drift_events WHERE tenant_id = v_tenant_guid;
  DELETE FROM customer_tenant_alert_events WHERE tenant_id = v_tenant_guid;
  DELETE FROM checkout_sessions WHERE tenant_id = v_tenant_guid;

  RAISE NOTICE 'Comprehensive reset complete for tenant id=%, msp_id=%, guid=%', v_tenant_id, v_msp_id, v_tenant_guid;
END $$;

COMMIT;
