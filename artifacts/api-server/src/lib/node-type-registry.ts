/**
 * node-type-registry.ts
 *
 * Central reference for portal workflow node type metadata.
 *
 * isAIDependent: true  — this node type invokes an LLM or AI service.
 *                        AI-blocked MSPs will have this node return
 *                        { aiBlocked: true, outcome: "ai_blocked" } instead
 *                        of executing.
 *
 * aiCostOwner: "msp"      — usage is billed against the MSP's credit allowance.
 *                           Document/report/SOW generation, chat messages.
 *             "platform"  — always runs; platform bears the cost. Never
 *                           decrements an MSP's balance. Upsell / recommendation
 *                           generation.
 *
 * Non-AI node types (isAIDependent: false):
 *   - check_script_output — pure data collection, deterministic
 *   - start, http_call, db_write, emit_event, wait, condition — no AI
 *   - All monitoring/data-collection paths are non-AI
 *
 * The monitoring engine's data-collection path MUST always run regardless of
 * an MSP's AI balance. Only nodes with isAIDependent: true are gated.
 *
 * ── The "action" meta-node ────────────────────────────────────────────────
 * `workflow-executor.ts` has a single `case "action"` handler that dispatches
 * internally on `node.data.actionType`, and a PROMOTED_ACTION_TYPES bridge that
 * rewrites first-class node types (e.g. `generate_document`) into
 * `type: "action"` + `data.actionType`. So the type that actually decides what
 * runs — and whether it calls a model — is `node.data.actionType ?? node.type`,
 * not `node.type` alone.
 *
 * This matters for billing: `actionType: "generate_document"` makes a real
 * streaming Anthropic call. Classifying the bare `action` node type would gate
 * every non-AI action (create_client, http_request, …) on an MSP's AI balance,
 * which is wrong in the other direction. Use `resolveNodeTypeMeta(nodeType,
 * actionType)` — it follows the same resolution rule the executor does.
 *
 * ── Completeness ──────────────────────────────────────────────────────────
 * Every member of the `WfNode` union in `lib/db/src/schema/index.ts` and every
 * member of `PROMOTED_ACTION_TYPES` in `workflow-executor.ts` must have an
 * entry here. This is enforced by `ai-usage-metering.test.ts`, which parses
 * both source files — an unregistered node type falls through
 * `getNodeTypeMeta`'s "unknown → non-AI" default and would be silently
 * un-gated and unbilled, so the gap has to be a test failure rather than
 * something only a reviewer would notice.
 */

/**
 * Discriminated union — when isAIDependent is false, aiCostOwner must be
 * absent (or never). When isAIDependent is true, aiCostOwner is REQUIRED.
 * This lets TypeScript enforce completeness at compile time.
 *
 * `dispatchesOn: "actionType"` marks a meta-node whose real classification
 * lives on its sub-type; see `resolveNodeTypeMeta`.
 */
export type NodeTypeMeta =
  | {
      nodeType: string;
      isAIDependent: false;
      aiCostOwner?: never;
      dispatchesOn?: "actionType";
      description?: string;
    }
  | {
      nodeType: string;
      isAIDependent: true;
      aiCostOwner: "msp" | "platform";
      dispatchesOn?: never;
      description?: string;
    };

import { ZOHO_CRM_NODES } from "./zoho-crm-nodes.ts";
import { ZOHO_PROJECTS_NODES } from "./zoho-projects-nodes.ts";
import { ZOHO_BOOKS_NODES } from "./zoho-books-nodes.ts";
import { ZOHO_DESK_NODES } from "./zoho-desk-nodes.ts";
import { ENGAGEBAY_NODES } from "./engagebay-nodes.ts";

const NODE_TYPE_REGISTRY: NodeTypeMeta[] = [
  // ── Meta-node ──────────────────────────────────────────────────────────────
  {
    nodeType: "action",
    isAIDependent: false,
    dispatchesOn: "actionType",
    description:
      "Generic action node — the executor dispatches on data.actionType, and PROMOTED_ACTION_TYPES rewrites first-class node types into this shape. Its real AI classification comes from the actionType entry; resolve with resolveNodeTypeMeta(). The bare node type is non-AI so an action node with no actionType is never gated.",
  },

  // ── Foundation / structural nodes ──────────────────────────────────────────
  {
    nodeType: "start",
    isAIDependent: false,
    description: "Workflow entry point — passes trigger payload downstream",
  },
  {
    nodeType: "end",
    isAIDependent: false,
    description: "Workflow terminal node",
  },
  {
    nodeType: "error",
    isAIDependent: false,
    description: "Error boundary node",
  },
  {
    nodeType: "http_call",
    isAIDependent: false,
    description: "Generic outbound HTTP request",
  },
  {
    nodeType: "db_write",
    isAIDependent: false,
    description: "Parameterized SQL write",
  },
  {
    nodeType: "emit_event",
    isAIDependent: false,
    description: "Dispatches a canonical event to the event bus",
  },
  {
    nodeType: "wait",
    isAIDependent: false,
    description: "No-op delay",
  },
  {
    nodeType: "delay",
    isAIDependent: false,
    description: "Time-based delay node",
  },
  {
    nodeType: "condition",
    isAIDependent: false,
    description: "Safe JS condition evaluator for branching",
  },
  {
    nodeType: "switch_case",
    isAIDependent: false,
    description: "Multi-branch switch on a payload value",
  },
  {
    nodeType: "foreach",
    isAIDependent: false,
    description: "Iterates over an array and fans out sub-runs",
  },
  {
    nodeType: "for",
    isAIDependent: false,
    description: "Counted loop node",
  },
  {
    nodeType: "parallel",
    isAIDependent: false,
    description: "Fans out to multiple branches in parallel",
  },
  {
    nodeType: "join",
    isAIDependent: false,
    description: "Joins parallel branches back into a single path",
  },
  {
    nodeType: "retry",
    isAIDependent: false,
    description: "Retries a child subgraph on failure",
  },
  {
    nodeType: "set_variable",
    isAIDependent: false,
    description: "Sets a named variable in the payload",
  },
  {
    nodeType: "update_variable",
    isAIDependent: false,
    description: "Updates an existing named variable in the payload",
  },
  {
    nodeType: "group_by",
    isAIDependent: false,
    description: "Groups an array by a key expression",
  },
  {
    nodeType: "compose",
    isAIDependent: false,
    description: "Composes multiple payload values into a new object",
  },
  {
    nodeType: "find_object",
    isAIDependent: false,
    description: "Looks up a record (lead, client, project, service, etc.) by id or field",
  },
  {
    nodeType: "assessment_doc_gate",
    isAIDependent: false,
    description: "Two-sided wait gate: resolves eligibility (assessment-tier + scan-completed + logged-in, idempotent) for Assessment document generation",
  },
  {
    nodeType: "run_workflow",
    isAIDependent: false,
    description: "Invokes another workflow as a child run",
  },
  {
    nodeType: "ask_for_input",
    isAIDependent: false,
    description: "Pauses the run and waits for human input",
  },
  {
    nodeType: "report_progress",
    isAIDependent: false,
    description: "Emits a progress event to the run's SSE stream",
  },
  {
    nodeType: "comment",
    isAIDependent: false,
    description: "Canvas annotation — produces no output and executes nothing",
  },

  // ── Promoted action types (PROMOTED_ACTION_TYPES) ───────────────────────────
  // These arrive as node.data.actionType on an "action" node. Listed here so
  // resolveNodeTypeMeta() can classify them; none of them calls a model.
  {
    nodeType: "cancel_workflow",
    isAIDependent: false,
    description: "Cancels the current run — no AI",
  },
  {
    nodeType: "http_request",
    isAIDependent: false,
    description: "Outbound HTTP request from an action node — no AI",
  },
  {
    nodeType: "sql_query",
    isAIDependent: false,
    description: "Parameterized SQL query from an action node — no AI",
  },
  {
    nodeType: "send_sms",
    isAIDependent: false,
    description: "Sends an SMS — no AI",
  },
  // Legacy CRM node types `create_lead` and `convert_to_opportunity` were
  // removed in #135 (Decommission Legacy CRM Phase A) — the local `leads` /
  // `opportunities` writers they wrapped are gone; Zoho CRM's `zoho_create_lead`
  // / `zoho_convert_lead` (#83) are the supported replacements.
  {
    nodeType: "create_client",
    isAIDependent: false,
    description: "Creates a client user record — no AI",
  },
  {
    nodeType: "create_project",
    isAIDependent: false,
    description: "Creates a project record — no AI",
  },
  {
    nodeType: "calculate_pricing",
    isAIDependent: false,
    description: "Runs the pricing calculation from an action node — deterministic",
  },

  // ── Graph write ────────────────────────────────────────────────────────────
  {
    nodeType: "graph_write_operation",
    isAIDependent: false,
    description: "Issues a write against Microsoft Graph (POST/PATCH/PUT) — no AI",
  },
  // ── Graph read (#1939) ────────────────────────────────────────────────────
  {
    nodeType: "graph_read_operation",
    isAIDependent: false,
    description: "Issues a read (GET) against Microsoft Graph — no AI",
  },

  // ── Signal policy / engagement offer engines ───────────────────────────────
  {
    nodeType: "evaluate_signal_policies",
    isAIDependent: false,
    description: "Runs policy-engine.ts evaluateAllPolicies() — deterministic rules, no AI",
  },
  {
    nodeType: "evaluate_engagement_offers",
    isAIDependent: false,
    description: "Runs engagement-offer-engine.ts evaluateAllEngagementOffers() — deterministic rules, no AI",
  },
  {
    nodeType: "dispatch_engagement_followups",
    isAIDependent: false,
    description: "Dispatches pending engagement follow-ups — no AI",
  },
  {
    nodeType: "cancel_conflicting_engagement_followup",
    isAIDependent: false,
    description: "Cancels a follow-up that conflicts with a purchased service — no AI",
  },

  // ── Monitoring / data collection ── NEVER AI-gated ────────────────────────
  {
    nodeType: "check_script_output",
    isAIDependent: false,
    description: "Evaluates script run output — deterministic, never AI",
  },
  {
    nodeType: "collect_diagnostics",
    isAIDependent: false,
    description: "Reads M365 diagnostics data — deterministic",
  },
  {
    nodeType: "poll_tenant_health",
    isAIDependent: false,
    description: "Polls tenant health scores — deterministic",
  },
  {
    nodeType: "get_tenant_signals",
    isAIDependent: false,
    description: "Reads current tenant signals — deterministic",
  },
  {
    nodeType: "monitor_subscription_ensure",
    isAIDependent: false,
    description: "Ensures a monitoring subscription is active — no AI",
  },
  {
    nodeType: "monitor_poll_activity",
    isAIDependent: false,
    description: "Polls tenant activity for monitoring — no AI",
  },
  {
    nodeType: "monitor_get_package",
    isAIDependent: false,
    description: "Reads a monitoring package definition by key — no AI",
  },
  {
    nodeType: "monitor_execute_package",
    isAIDependent: false,
    description: "Executes a monitoring package's checks — no AI",
  },
  {
    nodeType: "config_snapshot_collect",
    isAIDependent: false,
    description:
      "Captures a full tenant configuration snapshot from Graph and PowerShell (#1796) — deterministic reads, no AI",
  },
  {
    nodeType: "config_snapshot_diff",
    isAIDependent: false,
    description:
      "Computes the property-level difference between two configuration snapshots (#1797) — "
      + "pure comparison over stored data, no tenant call and no AI",
  },
  // NOTE: fetch_news_headlines is NOT in this section despite the name — it
  // makes two real Anthropic calls (headline selection + campaign brief) and is
  // classified as AI-dependent below. It was misclassified as non-AI here until
  // the AI-call-site audit; the fetch is only the first half of what it does.

  // ── CRM / pipeline ─────────────────────────────────────────────────────────
  // `write_crm_scores`, `assign_pipeline_stage`, `create_opportunity`,
  // `parse_quiz_results`, `generate_readiness_score` and `attach_quiz_insights`
  // were removed in #135 (Decommission Legacy CRM Phase A) along with the
  // `leads` / `quiz_leads` / `opportunities` writers they wrapped.
  {
    nodeType: "validate_m365_permissions",
    isAIDependent: false,
    description: "Validates M365 tenant permissions — deterministic",
  },
  {
    nodeType: "update_intelligence_tables",
    isAIDependent: false,
    description: "Updates intelligence-engine tables — no AI",
  },
  {
    nodeType: "generate_diff_report",
    isAIDependent: false,
    description: "Generates a diff report between two data snapshots — deterministic",
  },
  {
    nodeType: "notify_major_changes",
    isAIDependent: false,
    description: "Sends a notification for major detected changes — no AI",
  },

  // ── Intelligence engines ────────────────────────────────────────────────────
  {
    nodeType: "calculate_priority",
    isAIDependent: false,
    description: "Runs the priority scoring engine — deterministic rules",
  },
  {
    nodeType: "calculate_pricing_engine",
    isAIDependent: false,
    description: "Runs the pricing engine — deterministic rules",
  },
  {
    nodeType: "calculate_health",
    isAIDependent: false,
    description: "Runs the health scoring engine — deterministic rules",
  },
  {
    nodeType: "calculate_drift",
    isAIDependent: false,
    description: "Runs the drift detection engine — deterministic rules",
  },
  {
    nodeType: "calculate_forecast",
    isAIDependent: false,
    description: "Runs the forecasting engine — deterministic rules",
  },
  {
    nodeType: "calculate_crm",
    isAIDependent: false,
    description: "Runs the CRM scoring engine — deterministic rules",
  },
  {
    nodeType: "calculate_msp",
    isAIDependent: false,
    description: "Runs the MSP intelligence engine — deterministic rules",
  },

  // ── Customer / project management ───────────────────────────────────────────
  {
    nodeType: "update_customer_status",
    isAIDependent: false,
    description: "Updates customer record fields — no AI",
  },
  {
    nodeType: "provision_sharepoint_site",
    isAIDependent: false,
    description: "Provisions SharePoint site via Graph API — no AI",
  },
  {
    nodeType: "get_project_tasks",
    isAIDependent: false,
    description: "Reads project tasks from the database — no AI",
  },
  {
    nodeType: "update_project_task",
    isAIDependent: false,
    description: "Updates a project task record — no AI",
  },
  {
    nodeType: "update_milestone",
    isAIDependent: false,
    description: "Updates a project milestone — no AI",
  },
  {
    nodeType: "get_phases",
    isAIDependent: false,
    description: "Reads project phases — no AI",
  },
  {
    nodeType: "create_phase",
    isAIDependent: false,
    description: "Creates a project phase — no AI",
  },
  {
    nodeType: "save_presentation_phases",
    isAIDependent: false,
    description: "Saves generated phases to a presentation record — no AI",
  },
  {
    nodeType: "build_presentation",
    isAIDependent: false,
    description: "Builds a client presentation record — no AI",
  },
  {
    nodeType: "create_kanban_task",
    isAIDependent: false,
    description: "Creates a kanban task card — no AI",
  },

  // ── Scripting ──────────────────────────────────────────────────────────────
  {
    nodeType: "execute_script",
    isAIDependent: false,
    description: "Executes a PowerShell script via Azure Automation — no AI",
  },
  {
    nodeType: "execute_monitor_check",
    isAIDependent: false,
    description: "Executes a specified monitor check and extracts properties",
  },
  {
    nodeType: "remediation_pointed_verify",
    isAIDependent: false,
    description: "On-demand targeted re-scan of one remediation-tracker step's mapped check(s), writing verified/drift to remediation_tracker_steps.verificationState — deterministic, no AI (#1540)",
  },
  {
    nodeType: "execute_baseline_template",
    isAIDependent: false,
    description: "Executes a template action with verification-gate halting",
  },
  {
    nodeType: "execute_runbook",
    isAIDependent: false,
    description: "Executes a PowerShell script via Azure — no AI",
  },
  {
    nodeType: "update_m365_profile",
    isAIDependent: false,
    description: "Updates the M365 profile for a client — no AI",
  },

  // ── Notifications / messaging ───────────────────────────────────────────────
  {
    nodeType: "send_notification",
    isAIDependent: false,
    description: "Sends an in-app or email notification — no AI",
  },
  {
    nodeType: "send_email",
    isAIDependent: false,
    description: "Sends a transactional email — no AI",
  },
  {
    nodeType: "send_browser_notification",
    isAIDependent: false,
    description: "Sends a browser push notification — no AI",
  },
  {
    nodeType: "create_notification",
    isAIDependent: false,
    description: "Creates a notification record in the database — no AI",
  },
  {
    nodeType: "send_mobile_push",
    isAIDependent: false,
    description: "Sends a mobile push notification — no AI",
  },
  {
    nodeType: "send_campaign_email",
    isAIDependent: false,
    description: "Sends a marketing campaign email — no AI",
  },
  {
    nodeType: "play_sound",
    isAIDependent: false,
    description: "Plays an in-browser sound alert — no AI",
  },

  // ── Fulfilment ─────────────────────────────────────────────────────────────
  {
    nodeType: "create_fulfillment_entry",
    isAIDependent: false,
    description: "Creates a fulfillment queue entry — no AI",
  },
  {
    nodeType: "create_operator_task",
    isAIDependent: false,
    description: "Creates an operator task — no AI",
  },

  // ── Exchange / Calendar ─────────────────────────────────────────────────────
  {
    nodeType: "check_exchange_calendar_availability",
    isAIDependent: false,
    description: "Checks Exchange calendar availability via Graph API — no AI",
  },
  {
    nodeType: "create_exchange_calendar_event",
    isAIDependent: false,
    description: "Creates an Exchange calendar event via Graph API — no AI",
  },

  // ── SharePoint ──────────────────────────────────────────────────────────────
  {
    nodeType: "save_to_sharepoint",
    isAIDependent: false,
    description: "Uploads a file to SharePoint via Graph API — no AI",
  },
  {
    nodeType: "get_from_sharepoint",
    isAIDependent: false,
    description: "Downloads a file from SharePoint via Graph API — no AI",
  },

  // ── Stripe / billing ────────────────────────────────────────────────────────
  {
    nodeType: "generate_invoice_stripe_payment",
    isAIDependent: false,
    description: "Creates a Stripe invoice payment — no AI",
  },
  {
    nodeType: "generate_stripe_payment_link",
    isAIDependent: false,
    description: "Creates a Stripe payment link — no AI",
  },
  {
    nodeType: "create_phased_invoices",
    isAIDependent: false,
    description: "Creates phased Stripe invoices — no AI",
  },
  {
    nodeType: "generate_phased_invoice",
    isAIDependent: false,
    description: "Generates and finalises a single phased Stripe invoice — no AI",
  },
  {
    nodeType: "charge_stripe_invoice",
    isAIDependent: false,
    description: "Charges a Stripe invoice — no AI",
  },
  {
    nodeType: "edit_stripe_invoice",
    isAIDependent: false,
    description: "Edits a Stripe invoice line items — no AI",
  },

  // ── Social media posting ────────────────────────────────────────────────────
  {
    nodeType: "post_linkedin",
    isAIDependent: false,
    description: "Posts to a LinkedIn organisation page — no AI",
  },
  {
    nodeType: "post_twitter",
    isAIDependent: false,
    description: "Posts a tweet via Twitter/X OAuth 1.0a — no AI",
  },
  {
    nodeType: "post_facebook",
    isAIDependent: false,
    description: "Posts to a Facebook Page via Graph API — no AI",
  },

  // ── Approval / human-in-the-loop ────────────────────────────────────────────
  {
    nodeType: "approval_gate",
    isAIDependent: false,
    description: "Pauses the run and waits for a role-based human approval — no AI",
  },
  {
    nodeType: "break_glass_verification_gate",
    isAIDependent: false,
    description: "Pauses the run until a customer-tenant admin proves control via Microsoft OAuth and the break-glass secret is delivered — no AI",
  },
  {
    nodeType: "purge_orphaned_generated_secrets",
    isAIDependent: false,
    description: "Purges Key Vault credentials whose run is terminal, expired, or never bound to a run — no AI",
  },

  // ── Marketing ───────────────────────────────────────────────────────────────
  {
    nodeType: "define_campaign_goal",
    isAIDependent: false,
    description: "Records a campaign goal — no AI",
  },
  {
    nodeType: "define_target_audience",
    isAIDependent: false,
    description: "Records a campaign target audience — no AI",
  },
  {
    nodeType: "create_campaign_offer",
    isAIDependent: false,
    description: "Creates a campaign offer record — no AI",
  },
  {
    nodeType: "create_marketing_campaign",
    isAIDependent: false,
    description: "Creates a marketing campaign record — no AI",
  },
  {
    nodeType: "publish_landing_page",
    isAIDependent: false,
    description: "Publishes a landing page — no AI",
  },
  {
    nodeType: "publish_article",
    isAIDependent: false,
    description: "Publishes an article to the consulting site — no AI (content supplied by generate_article)",
  },

  // ── SLA management ─────────────────────────────────────────────────────────
  {
    nodeType: "sla_start_timer",
    isAIDependent: false,
    description: "Starts an SLA timer — no AI",
  },
  {
    nodeType: "sla_stop_timer",
    isAIDependent: false,
    description: "Stops an SLA timer — no AI",
  },
  {
    nodeType: "sla_warning",
    isAIDependent: false,
    description: "Emits an SLA warning event — no AI",
  },
  {
    nodeType: "sla_breach",
    isAIDependent: false,
    description: "Records an SLA breach — no AI",
  },
  {
    nodeType: "sla_escalate",
    isAIDependent: false,
    description: "Escalates an SLA breach — no AI",
  },
  {
    nodeType: "sla_resolve",
    isAIDependent: false,
    description: "Resolves an SLA breach — no AI",
  },

  // ── Scope creep ────────────────────────────────────────────────────────────
  {
    nodeType: "scope_creep_detect",
    isAIDependent: false,
    description: "Detects scope creep signals — deterministic",
  },
  {
    nodeType: "scope_creep_score",
    isAIDependent: false,
    description: "Scores scope creep severity — deterministic",
  },
  {
    nodeType: "scope_creep_violation",
    isAIDependent: false,
    description: "Records a scope creep violation — no AI",
  },
  {
    nodeType: "scope_creep_escalate",
    isAIDependent: false,
    description: "Escalates a scope creep violation — no AI",
  },
  {
    nodeType: "scope_creep_resolve",
    isAIDependent: false,
    description: "Resolves a scope creep violation — no AI",
  },
  {
    nodeType: "scope_creep_compliance_update",
    isAIDependent: false,
    description: "Updates scope creep compliance status — no AI",
  },

  // ── Sales offer ────────────────────────────────────────────────────────────
  {
    nodeType: "sales_offer_generate",
    isAIDependent: false,
    description: "Generates a sales offer record — no AI",
  },
  {
    nodeType: "sales_offer_score",
    isAIDependent: false,
    description: "Scores a sales offer — deterministic",
  },
  {
    nodeType: "sales_offer_violation",
    isAIDependent: false,
    description: "Records a sales offer policy violation — no AI",
  },
  {
    nodeType: "sales_offer_escalate",
    isAIDependent: false,
    description: "Escalates a sales offer violation — no AI",
  },
  {
    nodeType: "sales_offer_resolve",
    isAIDependent: false,
    description: "Resolves a sales offer violation — no AI",
  },

  // ── Internal / ops ─────────────────────────────────────────────────────────
  {
    nodeType: "alert_evaluate_rules",
    isAIDependent: false,
    description: "Evaluates platform alert rules and delivers via Exchange Online / push — no AI",
  },
  {
    nodeType: "policy_evaluate_due",
    isAIDependent: false,
    description: "Policy Engine continuous-evaluation reconciliation pass (#1549) — deterministic Graph reads, no AI",
  },
  {
    nodeType: "generate_pdf",
    isAIDependent: false,
    description: "Renders HTML to PDF — no AI",
  },
  {
    nodeType: "msp_dunning_advance",
    isAIDependent: false,
    description: "Advances MSP dunning states for past-due subscriptions — no AI",
  },
  {
    nodeType: "msp_overage_meter",
    isAIDependent: false,
    description: "Meters MSP tenant overage for billing — no AI",
  },
  {
    nodeType: "msp_score_snapshot",
    isAIDependent: false,
    description: "Daily snapshot of all MSP portfolio risk scores — no AI",
  },
  {
    nodeType: "m365_health_sample",
    isAIDependent: false,
    description: "Hourly M365 service health sample for SLA uptime tracking — no AI",
  },
  {
    nodeType: "m365_roadmap_sync",
    isAIDependent: false,
    description: "Ingests the public M365 Roadmap (v1 nightly snapshot / v2 targeted) into m365_roadmap_items — no AI",
  },
  {
    nodeType: "m365_route_changes",
    isAIDependent: false,
    description: "Routes resolved Microsoft changes into Change Control (auto-create/propose a CR, Microsoft implementer) — no AI",
  },
  {
    nodeType: "platform_log_stream_prune",
    isAIDependent: false,
    description: "Deletes platform_log_stream rows older than the retention window — no AI",
  },
  {
    nodeType: "config_snapshot_prune",
    isAIDependent: false,
    description: "Prunes tenant_config_snapshots beyond a per-tenant keep count, excluding any snapshot a config_diffs or config_snapshot_baselines row still references — no AI",
  },
  {
    nodeType: "zoho_batch_drain",
    isAIDependent: false,
    description: "Drains a bounded batch of pending zoho.* jobs from msp_job_queue — no AI",
  },

  // ── Zoho CRM (#83) — 26 nodes, none AI-dependent ──────────────────────────
  // Derived from the single catalog in zoho-crm-nodes.ts rather than restated
  // here, so a node can never be registered in one place and missing from the
  // other. The completeness assertions in ai-usage-metering.test.ts check
  // isRegisteredNodeType() at runtime, which this satisfies.
  ...ZOHO_CRM_NODES.map((n): NodeTypeMeta => ({
    nodeType: n.nodeType,
    isAIDependent: false,
    description: n.description,
  })),

  // ── Zoho Projects (#85) — 14 nodes, none AI-dependent ─────────────────────
  // Same derivation discipline as Zoho CRM above: catalog lives in
  // zoho-projects-nodes.ts, this registry just maps over it.
  ...ZOHO_PROJECTS_NODES.map((n): NodeTypeMeta => ({
    nodeType: n.nodeType,
    isAIDependent: false,
    description: n.description,
  })),

  // ── Zoho Books (#87) — 4 write-only nodes, none AI-dependent ──────────────
  // Same derivation discipline as CRM/Projects above: catalog lives in
  // zoho-books-nodes.ts, this registry just maps over it.
  ...ZOHO_BOOKS_NODES.map((n): NodeTypeMeta => ({
    nodeType: n.nodeType,
    isAIDependent: false,
    description: n.description,
  })),
  {
    nodeType: "zoho_books_daily_ai_rollup",
    isAIDependent: false,
    description: "Sums the prior day's AI/Anthropic cost and posts one Zoho Books expense — no AI",
  },

  // ── Zoho Desk (#89) — 4 nodes, none AI-dependent ──────────────────────────
  // Same derivation discipline as CRM/Projects/Books above: catalog lives in
  // zoho-desk-nodes.ts, this registry just maps over it.
  ...ZOHO_DESK_NODES.map((n): NodeTypeMeta => ({
    nodeType: n.nodeType,
    isAIDependent: false,
    description: n.description,
  })),

  {
    nodeType: "engagebay_batch_drain",
    isAIDependent: false,
    description: "Drains a bounded batch of pending engagebay_* jobs from msp_job_queue — no AI",
  },

  // ── EngageBay (#105) — 8 nodes, none AI-dependent ──────────────────────────
  // Derived from the single catalog in engagebay-nodes.ts rather than restated
  // here, so a node can never be registered in one place and missing from the
  // other. The completeness assertions in ai-usage-metering.test.ts check
  // isRegisteredNodeType() at runtime, which this satisfies.
  ...ENGAGEBAY_NODES.map((n): NodeTypeMeta => ({
    nodeType: n.nodeType,
    isAIDependent: false,
    description: n.description,
  })),


  // ── AI-dependent — billed to MSP ──────────────────────────────────────────
  {
    nodeType: "generate_document",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated consulting document / report / SOW",
  },
  {
    nodeType: "generate_report",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated MSP report from a report definition — PDF pipeline + optional email delivery",
  },
  {
    nodeType: "generate_sow",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated Statement of Work",
  },
  {
    nodeType: "generate_executive_summary",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated executive summary report",
  },
  {
    nodeType: "generate_remediation_plan",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated remediation plan",
  },
  {
    nodeType: "analyze_script_output",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI scoring of script run output (health engine)",
  },
  {
    nodeType: "chat_message",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI Support Assistant chat response — billed to MSP",
  },
  {
    nodeType: "generate_article",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated consulting blog article — billed to MSP",
  },
  {
    nodeType: "generate_script",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated PowerShell script from a service or document — billed to MSP",
  },
  {
    nodeType: "ask_ai",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "General-purpose AI call with a custom prompt — billed to MSP",
  },
  {
    nodeType: "topic_picker",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-selected content topic for article generation — billed to MSP",
  },
  {
    nodeType: "generate_image",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI image generation via OpenAI gpt-image-1 — billed to MSP",
  },
  {
    nodeType: "generate_landing_page",
    isAIDependent: true,
    aiCostOwner: "msp",
    description: "AI-generated landing page content — billed to MSP",
  },
  {
    nodeType: "fetch_news_headlines",
    isAIDependent: true,
    aiCostOwner: "msp",
    description:
      "Fetches external news headlines, then makes two AI calls — headline selection and an optional campaign brief (workflow-executor.ts). Content generation, same owner as generate_article — billed to MSP.",
  },

  // ── AI-dependent — billed to platform ─────────────────────────────────────
  {
    nodeType: "generate_upsell_recommendation",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI upsell / recommendation — always runs, platform cost",
  },
  // `score_lead` (the one AI-dependent legacy CRM node) was removed in #135 —
  // it scored a local `leads` row. Nothing replaces it on the Zoho path yet.
  {
    nodeType: "generate_insight",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI insight generation for dashboard tiles — platform cost",
  },
];

const registryMap = new Map<string, NodeTypeMeta>(
  NODE_TYPE_REGISTRY.map((m) => [m.nodeType, m]),
);

/**
 * Retrieve metadata for a node type.
 * Unknown node types default to non-AI-dependent (safe fallback).
 */
export function getNodeTypeMeta(nodeType: string): NodeTypeMeta {
  return (
    registryMap.get(nodeType) ?? {
      nodeType,
      isAIDependent: false,
      description: "Unknown node type — treated as non-AI (safe default)",
    }
  );
}

/** True when this node type has a real registry entry (not the unknown fallback). */
export function isRegisteredNodeType(nodeType: string): boolean {
  return registryMap.has(nodeType);
}

/**
 * The type that actually decides what a node does.
 *
 * `workflow-executor.ts` rewrites every PROMOTED_ACTION_TYPES node into
 * `type: "action"` + `data.actionType`, and the `action` handler dispatches on
 * `actionType` from there. So `actionType` wins whenever it is present — this
 * is the same rule the executor applies, kept in one place so the two cannot
 * drift.
 */
export function resolveEffectiveNodeType(
  nodeType: string,
  actionType?: string | null,
): string {
  const meta = registryMap.get(nodeType);
  if (meta?.dispatchesOn === "actionType" && actionType) return actionType;
  // A promoted first-class node type (e.g. "generate_document") may arrive
  // either as the node type itself or already rewritten onto actionType.
  if (actionType && registryMap.has(actionType) && !registryMap.has(nodeType)) {
    return actionType;
  }
  return nodeType;
}

/**
 * Metadata for a node, following meta-node dispatch.
 *
 * Prefer this over `getNodeTypeMeta` anywhere a real graph node is in hand:
 * `getNodeTypeMeta("action")` reports non-AI, which is correct for a bare
 * action node but wrong for `actionType: "generate_document"`, which calls a
 * model.
 */
export function resolveNodeTypeMeta(
  nodeType: string,
  actionType?: string | null,
): NodeTypeMeta {
  return getNodeTypeMeta(resolveEffectiveNodeType(nodeType, actionType));
}

/**
 * Returns true if this node type requires an AI inference call.
 * Non-AI nodes always run regardless of MSP balance.
 *
 * Pass `actionType` when the caller has a real graph node, so meta-node
 * dispatch is followed.
 */
export function isAIDependent(nodeType: string, actionType?: string | null): boolean {
  return resolveNodeTypeMeta(nodeType, actionType).isAIDependent;
}

/**
 * Returns the cost owner for an AI-dependent node type.
 * "msp"      → usage debits the MSP's credit allowance.
 * "platform" → usage is always billed to the platform; never blocks.
 */
export function getAiCostOwner(
  nodeType: string,
  actionType?: string | null,
): "msp" | "platform" {
  const meta = resolveNodeTypeMeta(nodeType, actionType);
  if (!meta.isAIDependent) {
    throw new Error(`getAiCostOwner: node type '${meta.nodeType}' is not AI-dependent`);
  }
  return meta.aiCostOwner;
}

export { NODE_TYPE_REGISTRY };
