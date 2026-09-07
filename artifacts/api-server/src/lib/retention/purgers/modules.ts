/**
 * THE PER-MODULE TENANT-DATA PURGE DECLARATIONS (Git #2859, EPIC #1944 part 7).
 *
 * One exported declaration per product module. Each names only the tables that module
 * holds for a customer, and the id space each of those tables keys the tenant by. They
 * are registered together by `./index.ts`; nothing here registers itself on import, so
 * importing a declaration to inspect it can never arm a purge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THESE TABLE ASSIGNMENTS COME FROM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not from reading the ORM schema, which is why they are complete. Three real sources,
 * cross-checked against each other:
 *
 *   1. A live `information_schema` sweep of the running database for every column that
 *      keys a tenant. That is what catches the tables with NO Drizzle definition at all —
 *      `scope_creep_*` (6), `sla_*` (4) and `war_room_interaction_events` exist only as
 *      manual migrations, so a purge written against the ORM would silently skip all
 *      eleven of them, and "a purge that silently misses a table is a purge that did not
 *      happen" (`../registry.ts`).
 *   2. `lib/db/migrations/manual/2026-08-27-testbed-reset-patch-projects-1396.sql`, whose
 *      own headers are an audited statement of which id space each table is keyed by, and
 *      which is the closest thing this codebase already had to a settled answer.
 *   3. The `tenants`/`users` foreign-key graph, read live, which is what actually decides
 *      the id space where a column name is ambiguous.
 *
 * `tenant-scope-coverage.live-db.test.ts` re-runs source 1 on every test run and fails if
 * anything it finds is neither declared below nor explicitly exempted with a reason. That
 * test — not a promise to keep this file updated — is what stops it rotting the way the
 * dev-only hard-delete roster in `routes/admin-active-directory.ts` did.
 */

import type { TenantDataPurgerDeclaration } from "./declare";

// ─────────────────────────────────────────────────────────────────────────────
// Change control — change requests and everything hanging off one, the CAB, and the
// freeze/maintenance/hold windows that gate when a change may run.
// ─────────────────────────────────────────────────────────────────────────────

export const changeControlPurger: TenantDataPurgerDeclaration = {
  key: "change-control",
  displayName: "Change control",
  targets: [
    { table: "cr_approvals", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cr_attachments", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cr_comments", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cr_events", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cr_executions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cr_pirs", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "msp_change_requests", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cab_agenda_items", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "cab_members", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "change_freeze_windows", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "change_maintenance_windows", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "portal_change_control_notifications", column: "customer_id", keySpace: "customerId" },
    { table: "portal_change_control_policy", column: "customer_id", keySpace: "customerId" },
    { table: "portal_hold_windows", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Risk register — the module the registry's own doc comment uses as its worked example.
// ─────────────────────────────────────────────────────────────────────────────

export const riskRegisterPurger: TenantDataPurgerDeclaration = {
  key: "risk-register",
  displayName: "Risk register",
  targets: [{ table: "msp_risk_decisions", column: "tenant_id", keySpace: "tenantGuid" }],
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration drift & snapshots — what the tenant's Microsoft configuration looked
// like, sampled over time, and every diff computed from it.
//
// `config_diffs` keys the tenant TWICE: a drift-mode diff has base = head, a
// tenant-compare or promotion diff does not, and a row matching either side is this
// tenant's.
// ─────────────────────────────────────────────────────────────────────────────

export const configDriftPurger: TenantDataPurgerDeclaration = {
  key: "config-drift",
  displayName: "Configuration drift & snapshots",
  targets: [
    { table: "drift_events", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "drift_baseline_snapshots", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "drift_collection_status", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "config_change_attributions", column: "tenant_id", keySpace: "customerId" },
    { table: "config_change_lifecycle", column: "tenant_id", keySpace: "customerId" },
    { table: "config_change_scopes", column: "tenant_id", keySpace: "customerId" },
    { table: "config_resource_samples", column: "tenant_id", keySpace: "customerId" },
    { table: "config_model_extractions", column: "reconciled_against_tenant_id", keySpace: "customerId" },
    { table: "config_diffs", column: "base_tenant_id", orColumn: "head_tenant_id", keySpace: "customerId" },
    // `config_snapshot_baselines` before `tenant_config_snapshots`: that FK is NO ACTION,
    // not CASCADE, so the snapshot rows cannot go first.
    { table: "config_snapshot_baselines", column: "tenant_id", keySpace: "customerId" },
    { table: "tenant_config_snapshot_objects", column: "tenant_id", keySpace: "customerId" },
    { table: "tenant_config_snapshots", column: "tenant_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring & diagnostics — the tenant's monitor profile, every check run against it,
// and the findings those runs produced.
// ─────────────────────────────────────────────────────────────────────────────

export const monitoringPurger: TenantDataPurgerDeclaration = {
  key: "monitoring",
  displayName: "Monitoring & diagnostics",
  targets: [
    { table: "tenant_monitor_profiles", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_check_item_details", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_check_item_details", column: "customer_id", keySpace: "customerId" },
    { table: "simulator_check_runs", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "simulator_check_runs", column: "customer_id", keySpace: "customerId" },
    { table: "msp_diagnostic_findings", column: "customer_id", keySpace: "customerId" },
    { table: "msp_diagnostic_runs", column: "customer_id", keySpace: "customerId" },
    { table: "msp_diagnostic_runs", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "ps_capability_survey_runs", column: "customer_id", keySpace: "customerId" },
    { table: "tenant_service_availability", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "m365_service_health_samples", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "m365_service_health_samples", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Alerting — the customer's alert configuration, recipients, queued digests, and the
// per-tenant alert events themselves.
// ─────────────────────────────────────────────────────────────────────────────

export const alertingPurger: TenantDataPurgerDeclaration = {
  key: "alerting",
  displayName: "Alerting",
  targets: [
    { table: "customer_alert_digest_queue", column: "customer_id", keySpace: "customerId" },
    { table: "customer_alert_preferences", column: "customer_id", keySpace: "customerId" },
    { table: "customer_alert_recipients", column: "customer_id", keySpace: "customerId" },
    { table: "customer_alert_settings", column: "customer_id", keySpace: "customerId" },
    { table: "customer_tenant_alert_events", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "customer_tenant_alert_events", column: "customer_id", keySpace: "customerId" },
    { table: "activity_subscriptions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "activity_subscriptions", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Scoring engines — every derived score, snapshot, rollup and signal firing. Nothing
// here is authored by a human; all of it is computed FROM the customer's data, and all of
// it goes with it.
// ─────────────────────────────────────────────────────────────────────────────

export const engineScoringPurger: TenantDataPurgerDeclaration = {
  key: "engine-scoring",
  displayName: "Scoring engines & snapshots",
  targets: [
    { table: "tenant_engine_snapshots", column: "customer_id", keySpace: "customerId" },
    { table: "tenant_pillar_snapshots", column: "customer_id", keySpace: "customerId" },
    { table: "engine_score_daily_rollup", column: "customer_id", keySpace: "customerId" },
    { table: "engine_baseline_history", column: "customer_id", keySpace: "customerId" },
    { table: "dashboard_executive_summaries", column: "customer_id", keySpace: "customerId" },
    // #2983 settled this column as a real tenants.id — see its schema comment.
    { table: "tenant_signal_history", column: "customer_id", keySpace: "customerId" },
    // …and the retained pre-#2983 provenance column, which still carries the
    // users.id the engine wrote under on rows created before the migration (and
    // on any environment where it has not been run yet).
    { table: "tenant_signal_history", column: "client_user_id", keySpace: "userId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Policy engine — rule evaluations, firings, incidents and the customer's own
// suppressions.
// ─────────────────────────────────────────────────────────────────────────────

export const policyEnginePurger: TenantDataPurgerDeclaration = {
  key: "policy-engine",
  displayName: "Policy engine",
  targets: [
    { table: "policy_decisions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "policy_evaluation_runs", column: "tenant_id", keySpace: "customerId" },
    { table: "policy_rule_firings", column: "customer_id", keySpace: "customerId" },
    { table: "policy_rule_incidents", column: "customer_id", keySpace: "customerId" },
    { table: "policy_rule_suppressions", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SLA engine — timers, breaches, escalations and compliance records. No Drizzle
// definition exists for any of these four; they are manual-migration tables, which is
// exactly why they are declared by real SQL name.
// ─────────────────────────────────────────────────────────────────────────────

export const slaPurger: TenantDataPurgerDeclaration = {
  key: "sla",
  displayName: "SLA engine",
  targets: [
    { table: "sla_timers", column: "customer_id", keySpace: "customerId" },
    { table: "sla_breaches", column: "customer_id", keySpace: "customerId" },
    { table: "sla_escalations", column: "customer_id", keySpace: "customerId" },
    { table: "sla_compliance_records", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Scope-creep engine — six manual-migration tables, no Drizzle definition, same reason.
// ─────────────────────────────────────────────────────────────────────────────

export const scopeCreepPurger: TenantDataPurgerDeclaration = {
  key: "scope-creep",
  displayName: "Scope-creep engine",
  targets: [
    { table: "scope_creep_detections", column: "customer_id", keySpace: "customerId" },
    { table: "scope_creep_violations", column: "customer_id", keySpace: "customerId" },
    { table: "scope_creep_escalations", column: "customer_id", keySpace: "customerId" },
    { table: "scope_creep_assignments", column: "customer_id", keySpace: "customerId" },
    { table: "scope_creep_scores", column: "customer_id", keySpace: "customerId" },
    { table: "scope_creep_compliance", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Ownership & data governance — who owns which workload, the delegations and events
// behind that, department mappings, VIP classification and oversharing findings.
// ─────────────────────────────────────────────────────────────────────────────

export const ownershipPurger: TenantDataPurgerDeclaration = {
  key: "ownership",
  displayName: "Ownership & data governance",
  targets: [
    { table: "portal_ownership_assignments", column: "customer_id", keySpace: "customerId" },
    { table: "portal_ownership_delegations", column: "customer_id", keySpace: "customerId" },
    { table: "portal_ownership_events", column: "customer_id", keySpace: "customerId" },
    { table: "portal_ownership_policy", column: "customer_id", keySpace: "customerId" },
    { table: "portal_ownership_rows", column: "customer_id", keySpace: "customerId" },
    { table: "portal_ownership_workload_membership", column: "customer_id", keySpace: "customerId" },
    { table: "portal_department_mappings", column: "customer_id", keySpace: "customerId" },
    { table: "vip_classifications", column: "customer_id", keySpace: "customerId" },
    { table: "overshared_items", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "overshared_items", column: "customer_id", keySpace: "customerId" },
    { table: "license_assignment_snapshots", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "license_assignment_snapshots", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Workflows, SOPs & runbooks — the customer's own runbooks and every run of one.
// ─────────────────────────────────────────────────────────────────────────────

export const workflowPurger: TenantDataPurgerDeclaration = {
  key: "workflows",
  displayName: "Workflows, SOPs & runbooks",
  targets: [
    { table: "portal_wf_runs", column: "customer_id", keySpace: "customerId" },
    { table: "portal_wf_operator_tasks", column: "customer_id", keySpace: "customerId" },
    { table: "portal_runbooks", column: "customer_id", keySpace: "customerId" },
    { table: "portal_runbook_runs", column: "customer_id", keySpace: "customerId" },
    { table: "portal_sop_custom_steps", column: "customer_id", keySpace: "customerId" },
    { table: "msp_sop_runs", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "remediation_tracker_steps", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Compliance & security plans — the assembled/versioned security plan, its drafts, the
// frameworks the customer is measured against and the scope of that measurement.
// ─────────────────────────────────────────────────────────────────────────────

export const compliancePurger: TenantDataPurgerDeclaration = {
  key: "compliance",
  displayName: "Compliance & security plans",
  targets: [
    { table: "msp_security_plan_drafts", column: "customer_id", keySpace: "customerId" },
    { table: "msp_security_plan_drafts", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "msp_security_plan_versions", column: "customer_id", keySpace: "customerId" },
    { table: "msp_security_plan_versions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "compliance_frameworks", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_compliance_scope", column: "tenant_id", keySpace: "customerId" },
    { table: "msp_rbd_versions", column: "tenant_id", keySpace: "tenantGuid" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Documents & reports — generated documents, report definitions and their runs, and the
// share links pointing at them.
//
// `insights_generated_documents` keys the tenant on `msp_customer_id`; its `customer_id`
// is a USER id and is claimed by the identity module, not here, so the two never
// double-count the same rows.
// ─────────────────────────────────────────────────────────────────────────────

export const documentsPurger: TenantDataPurgerDeclaration = {
  key: "documents",
  displayName: "Documents & reports",
  targets: [
    { table: "msp_documents", column: "customer_id", keySpace: "customerId" },
    { table: "msp_report_definitions", column: "customer_id", keySpace: "customerId" },
    { table: "msp_report_runs", column: "customer_id", keySpace: "customerId" },
    { table: "insights_generated_documents", column: "msp_customer_id", keySpace: "customerId" },
    // #2983: `customer_id` on these three is a users.id, not a tenants.id —
    // confirmed against every real writer and reader. Purge by this tenant's logins.
    { table: "insights_generated_documents", column: "customer_id", keySpace: "userId" },
    { table: "live_document_shares", column: "customer_id", keySpace: "userId" },
    { table: "insights_automations", column: "customer_id", keySpace: "userId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Commercial — everything about what the customer bought: agreements, SOWs, retainer,
// entitlements, subscription rows, checkout attempts and metered AI usage.
//
// This is the module whose data a 7-year window most obviously exists FOR, and it still
// goes at the end of it: #1944 part 7 is explicit that there is no cold-storage
// exception and no archived export retained. The permanent `audit` record of the purge
// is what survives, not the commercial rows.
// ─────────────────────────────────────────────────────────────────────────────

export const commercialPurger: TenantDataPurgerDeclaration = {
  key: "commercial",
  displayName: "Commercial & billing records",
  targets: [
    { table: "checkout_sessions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_subscriptions", column: "tenant_id", keySpace: "customerId" },
    { table: "tenant_add_on_entitlements", column: "tenant_id", keySpace: "customerId" },
    { table: "tenant_service_plans", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "retainer_settings", column: "customer_id", keySpace: "customerId" },
    { table: "retainer_work_log", column: "customer_id", keySpace: "customerId" },
    { table: "sales_offers", column: "customer_id", keySpace: "customerId" },
    { table: "msp_sales_bundle_assignments", column: "customer_id", keySpace: "customerId" },
    { table: "msp_sales_bundle_assignments", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "msp_sows", column: "customer_id", keySpace: "customerId" },
    { table: "assessment_sow_agreements", column: "customer_id", keySpace: "customerId" },
    { table: "msp_customer_clickwraps", column: "customer_id", keySpace: "customerId" },
    { table: "ai_usage_events", column: "customer_id", keySpace: "customerId" },
    { table: "fulfillment_queue", column: "customer_id", keySpace: "customerId" },
    // #2980 — the customer's own request to be let back in during a subscription lapse.
    // Lands here rather than a new module because it is a record of the same billing
    // relationship this purger already owns, keyed the same way as tenant_subscriptions.
    { table: "retention_reinstatement_requests", column: "tenant_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tenant integrations — the credentials, connectors and reach records that let the
// platform touch the customer's Microsoft and Azure estate. These matter most of all: a
// purge that leaves a stored credential behind has left a live key to a tenant nobody is
// watching any more.
//
// `msp_sharepoint_connectors` and `msp_mailbox_connectors` are deliberately NOT here —
// they are the MSP's own infrastructure, scoped by `msp_id`, not this customer's data.
// That is the same call the testbed-reset migration makes, in its own words, and the
// coverage test carries it as an explicit exemption rather than a silent omission.
// ─────────────────────────────────────────────────────────────────────────────

export const integrationsPurger: TenantDataPurgerDeclaration = {
  key: "tenant-integrations",
  displayName: "Tenant integrations & credentials",
  targets: [
    { table: "azure_tenant_credentials", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "client_app_registrations", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_azure_lighthouse_offers", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "tenant_azure_reach", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "outbound_webhooks", column: "customer_id", keySpace: "customerId" },
    { table: "break_glass_pending_secrets", column: "customer_id", keySpace: "customerId" },
    { table: "break_glass_override_audit", column: "customer_id", keySpace: "customerId" },
    { table: "consent_invite_tokens", column: "customer_id", keySpace: "customerId" },
    { table: "consent_invite_tokens", column: "tenant_id", keySpace: "tenantGuid" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Message centre & Microsoft change routing — the Microsoft-sourced change feed for this
// tenant and the routing/resolution decisions taken on it.
// ─────────────────────────────────────────────────────────────────────────────

export const messageCentrePurger: TenantDataPurgerDeclaration = {
  key: "message-centre",
  displayName: "Message centre & Microsoft changes",
  targets: [
    { table: "msp_message_center_items", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "msp_message_center_items", column: "customer_id", keySpace: "customerId" },
    { table: "m365_change_resolutions", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "m365_change_resolutions", column: "customer_id", keySpace: "customerId" },
    { table: "m365_change_routings", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "m365_change_routings", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Platform operations — queues, event/DLQ stores, log stream and exception occurrences
// carrying this customer's id. Operational rather than customer-authored, and purged for
// the same reason the scoring snapshots are: it is all derived from, and identifies, a
// customer who is gone.
// ─────────────────────────────────────────────────────────────────────────────

export const platformOpsPurger: TenantDataPurgerDeclaration = {
  key: "platform-ops",
  displayName: "Platform operations records",
  targets: [
    { table: "msp_event_store", column: "customer_id", keySpace: "customerId" },
    { table: "msp_dlq_store", column: "customer_id", keySpace: "customerId" },
    { table: "msp_job_queue", column: "customer_id", keySpace: "customerId" },
    { table: "platform_log_stream", column: "customer_id", keySpace: "customerId" },
    { table: "exception_occurrences", column: "customer_id", keySpace: "customerId" },
    { table: "war_room_interaction_events", column: "customer_id", keySpace: "customerId" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Directory & access — the customer's OU structure, the MSP staff scopes pointing at
// them, and the user-keyed credential/token rows that belong to this tenant's own users.
//
// The `users` rows THEMSELVES are not destroyed here — see the coverage test's exemption
// for `users`, and #2984, which owns that decision rather than leaving it to be made
// silently inside a purge.
// ─────────────────────────────────────────────────────────────────────────────

export const directoryPurger: TenantDataPurgerDeclaration = {
  key: "directory",
  displayName: "Directory & access scopes",
  targets: [
    { table: "active_directory_ou_assignments", column: "customer_id", keySpace: "customerId" },
    { table: "active_directory_ou_assignments", column: "tenant_id", keySpace: "tenantGuid" },
    { table: "active_directory_ous", column: "tenant_id", keySpace: "customerId" },
    { table: "msp_staff_customer_scopes", column: "customer_id", keySpace: "customerId" },
    { table: "mfa_bypass_codes", column: "customer_id", keySpace: "customerId" },
    // #2983: `customer_id` on these three is a users.id, not a tenants.id —
    // confirmed against every real writer and reader. Purge by this tenant's logins.
    { table: "inbox_message_links", column: "customer_id", keySpace: "userId" },
    { table: "script_run_results", column: "customer_id", keySpace: "userId" },
    { table: "script_download_tokens", column: "customer_id", keySpace: "userId", orColumn: "client_user_id" },
  ],
};

/** Every module declaration, in the order they are registered. */
export const ALL_TENANT_DATA_PURGER_DECLARATIONS: TenantDataPurgerDeclaration[] = [
  changeControlPurger,
  riskRegisterPurger,
  configDriftPurger,
  monitoringPurger,
  alertingPurger,
  engineScoringPurger,
  policyEnginePurger,
  slaPurger,
  scopeCreepPurger,
  ownershipPurger,
  workflowPurger,
  compliancePurger,
  documentsPurger,
  commercialPurger,
  integrationsPurger,
  messageCentrePurger,
  platformOpsPurger,
  directoryPurger,
];
