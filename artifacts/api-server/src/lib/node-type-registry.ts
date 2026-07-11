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
 */

/**
 * Discriminated union — when isAIDependent is false, aiCostOwner must be
 * absent (or never). When isAIDependent is true, aiCostOwner is REQUIRED.
 * This lets TypeScript enforce completeness at compile time.
 */
export type NodeTypeMeta =
  | {
      nodeType: string;
      isAIDependent: false;
      aiCostOwner?: never;
      description?: string;
    }
  | {
      nodeType: string;
      isAIDependent: true;
      aiCostOwner: "msp" | "platform";
      description?: string;
    };

const NODE_TYPE_REGISTRY: NodeTypeMeta[] = [
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
    description: "Looks up a record (lead, client, project, etc.) by id or field",
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
    nodeType: "fetch_news_headlines",
    isAIDependent: false,
    description: "Fetches external news headlines — no AI",
  },

  // ── CRM / pipeline ─────────────────────────────────────────────────────────
  {
    nodeType: "write_crm_scores",
    isAIDependent: false,
    description: "Persists CRM scoring results — no AI",
  },
  {
    nodeType: "assign_pipeline_stage",
    isAIDependent: false,
    description: "Moves a lead/opportunity to a pipeline stage — no AI",
  },
  {
    nodeType: "create_opportunity",
    isAIDependent: false,
    description: "Creates a CRM opportunity record — no AI",
  },
  {
    nodeType: "parse_quiz_results",
    isAIDependent: false,
    description: "Parses quiz submission data — deterministic",
  },
  {
    nodeType: "generate_readiness_score",
    isAIDependent: false,
    description: "Computes a readiness score from collected data — deterministic",
  },
  {
    nodeType: "attach_quiz_insights",
    isAIDependent: false,
    description: "Attaches quiz insights to a lead record — no AI",
  },
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
    nodeType: "reconcile_orphaned_runs",
    isAIDependent: false,
    description: "Reconciles orphaned workflow runs — no AI",
  },
  {
    nodeType: "kanban_auto_fire",
    isAIDependent: false,
    description: "Auto-fires kanban card actions — no AI",
  },
  {
    nodeType: "system_action",
    isAIDependent: false,
    description: "Retired legacy action node — treated as no-op",
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

  // ── AI-dependent — billed to platform ─────────────────────────────────────
  {
    nodeType: "generate_upsell_recommendation",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI upsell / recommendation — always runs, platform cost",
  },
  {
    nodeType: "score_lead",
    isAIDependent: true,
    aiCostOwner: "platform",
    description: "AI lead scoring — platform cost",
  },
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

/**
 * Returns true if this node type requires an AI inference call.
 * Non-AI nodes always run regardless of MSP balance.
 */
export function isAIDependent(nodeType: string): boolean {
  return getNodeTypeMeta(nodeType).isAIDependent;
}

/**
 * Returns the cost owner for an AI-dependent node type.
 * "msp"      → usage debits the MSP's credit allowance.
 * "platform" → usage is always billed to the platform; never blocks.
 */
export function getAiCostOwner(nodeType: string): "msp" | "platform" {
  const meta = getNodeTypeMeta(nodeType);
  if (!meta.isAIDependent) {
    throw new Error(`getAiCostOwner: node type '${nodeType}' is not AI-dependent`);
  }
  return meta.aiCostOwner;
}

export { NODE_TYPE_REGISTRY };
