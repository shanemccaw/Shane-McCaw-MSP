/**
 * nodeLibrary.ts
 *
 * The node-type style/catalog data `FlowCanvas` needs (`nodeStyles`,
 * `libraryCategories`, `allLibraryNodes`) — split out of
 * `WorkflowBuilderPage.tsx` so a consumer that only needs this static data
 * (the adminv2 Workflow Builder screen) isn't forced to pull in that page's
 * entire component tree (`@xyflow/react`, `@tanstack/react-query`, `recharts`,
 * the AI/replay/config-panel machinery, …) just to read three constants.
 * `WorkflowBuilderPage.tsx` imports from here too — this is the single
 * source, not a copy.
 */

// ── Node type colours ─────────────────────────────────────────────────────────

export const NODE_STYLES: Record<string, { bg: string; border: string; icon: string; label: string }> = {
  // ── Core / structural ──
  start:     { bg: "#0F2A1A", border: "#22C55E",  icon: "▶",  label: "Start"               },
  end:       { bg: "#1A1A2E", border: "#6366F1",  icon: "⏹",  label: "End"                 },
  condition: { bg: "#1A1300", border: "#F59E0B",  icon: "◆",  label: "Condition"           },
  delay:     { bg: "#1A0D2E", border: "#A855F7",  icon: "⏱",  label: "Delay"               },
  error:     { bg: "#1A0D0D", border: "#EF4444",  icon: "⚠",  label: "Error"               },
  // ── Platform (generic — kept for backward compat with saved workflows) ──
  action:    { bg: "#0D1A2E", border: "#2F6FED",  icon: "⚡", label: "Action"              },
  // ── Promoted Platform / Communication nodes ──
  http_request:           { bg: "#0A1220", border: "#3B82F6",  icon: "🌐", label: "HTTP Request"           },
  sql_query:              { bg: "#0A1A12", border: "#10B981",  icon: "🗄️", label: "SQL Query"              },
  send_email:             { bg: "#0D1A2A", border: "#60A5FA",  icon: "📧", label: "Send Email"             },
  send_sms:               { bg: "#120D22", border: "#A78BFA",  icon: "💬", label: "Send SMS"               },
  emit_event:             { bg: "#1A0D18", border: "#F472B6",  icon: "📡", label: "Emit Event"             },
  cancel_workflow:        { bg: "#1A0D0D", border: "#EF4444",  icon: "🛑", label: "Cancel Workflow"        },
  // ── Promoted CRM Action nodes ──
  create_client:          { bg: "#041A14", border: "#6EE7B7",  icon: "👤", label: "Create Client"          },
  create_project:         { bg: "#041A14", border: "#4ADE80",  icon: "📁", label: "Create Project"         },
  // ── Promoted Azure nodes ──
  execute_runbook:        { bg: "#110D22", border: "#A78BFA",  icon: "⚙️", label: "Execute Runbook"        },
  update_m365_profile:    { bg: "#110D22", border: "#8B5CF6",  icon: "☁️", label: "Update M365 Profile"    },
  generate_document:      { bg: "#111620", border: "#64748B",  icon: "📄", label: "Generate Document"      },
  calculate_pricing:      { bg: "#111620", border: "#00B4D8",  icon: "💲", label: "Calculate Pricing"       },
  // ── Sub-workflow ──
  run_workflow:           { bg: "#0D1A2E", border: "#3B82F6",  icon: "⚡", label: "Run Workflow"            },
  // ── CRM ──
  // ── Diagnostics / Quiz ──
  // ── M365 Health ──
  validate_m365_permissions: { bg: "#110D22", border: "#8B5CF6", icon: "🔐", label: "Validate Perms"      },
  update_intelligence_tables:{ bg: "#110D22", border: "#8B5CF6", icon: "🧠", label: "Update Intel"        },
  generate_diff_report:      { bg: "#110D22", border: "#8B5CF6", icon: "📄", label: "Diff Report"         },
  notify_major_changes:      { bg: "#110D22", border: "#8B5CF6", icon: "🔔", label: "Notify Changes"      },
  get_tenant_signals:        { bg: "#0D1020", border: "#7C3AED", icon: "📡", label: "Get Tenant Signals"  },
  // ── Intelligence Engines ──
  calculate_priority:       { bg: "#150D20", border: "#A855F7", icon: "🎯", label: "Priority Engine"   },
  calculate_pricing_engine: { bg: "#150D20", border: "#A855F7", icon: "💰", label: "Pricing Engine"    },
  calculate_health:   { bg: "#150D20", border: "#A855F7", icon: "🩺", label: "Health Engine"     },
  calculate_drift:    { bg: "#150D20", border: "#A855F7", icon: "📉", label: "Drift Engine"      },
  calculate_forecast: { bg: "#150D20", border: "#A855F7", icon: "🔮", label: "Forecasting Engine"},
  calculate_crm:      { bg: "#150D20", border: "#A855F7", icon: "🧲", label: "CRM Engine"        },
  calculate_msp:      { bg: "#150D20", border: "#A855F7", icon: "🛰", label: "MSP Portfolio Engine" },
  // ── SLA Engine ──
  sla_start_timer:    { bg: "#001A14", border: "#00C896", icon: "⏱",  label: "SLA: Start Timer"   },
  sla_stop_timer:     { bg: "#001A14", border: "#00C896", icon: "⏹",  label: "SLA: Stop Timer"    },
  sla_warning:        { bg: "#1A1000", border: "#F59E0B", icon: "⚠️",  label: "SLA: Warning"       },
  sla_breach:         { bg: "#1A0000", border: "#EF4444", icon: "🚨",  label: "SLA: Breach"        },
  sla_escalate:       { bg: "#1A0800", border: "#F97316", icon: "🔺",  label: "SLA: Escalate"      },
  sla_resolve:        { bg: "#001A14", border: "#10B981", icon: "✅",  label: "SLA: Resolve"       },
  // ── Marketing Actions ──
  send_campaign_email: { bg: "#0D1A10", border: "#10B981", icon: "📨", label: "Send Campaign Email" },
  // ── Project Actions ──
  create_kanban_task:  { bg: "#0D1020", border: "#6366F1", icon: "🗂",  label: "Create Kanban Task"  },
  get_project_tasks:   { bg: "#0D1020", border: "#818CF8", icon: "📋", label: "Get Project Tasks"    },
  update_project_task: { bg: "#0D1020", border: "#A78BFA", icon: "✏️", label: "Update Project Task"  },
  // ── Content ──
  generate_article:          { bg: "#1A0D1A", border: "#C084FC", icon: "✍️", label: "Generate Article"        },
  publish_article:           { bg: "#0F1A12", border: "#4ADE80", icon: "📢", label: "Publish Article"          },
  topic_picker:              { bg: "#1A0D1A", border: "#E879F9", icon: "🎯", label: "Topic Picker"             },
  generate_image:            { bg: "#1A100A", border: "#F59E0B", icon: "🖼️", label: "Generate Image"           },
  // ── Marketing Actions (extended) ──
  define_campaign_goal:      { bg: "#0A1A12", border: "#34D399", icon: "🎯", label: "Define Goal"            },
  define_target_audience:    { bg: "#0A1A12", border: "#6EE7B7", icon: "👥", label: "Define Target Audience" },
  create_campaign_offer:     { bg: "#0A1A12", border: "#10B981", icon: "🎁", label: "Create Offer"           },
  create_marketing_campaign: { bg: "#0D1A10", border: "#34D399", icon: "📣", label: "Create Campaign"          },
  publish_landing_page:      { bg: "#0D1A10", border: "#6EE7B7", icon: "🚀", label: "Publish Landing Page"     },
  generate_landing_page:     { bg: "#0A1A18", border: "#34D399", icon: "🖥️", label: "Generate Landing Page"    },
  // ── Data ──
  find_object:               { bg: "#0D1020", border: "#818CF8", icon: "🔍", label: "Find Object"              },
  compose:                   { bg: "#0A1A18", border: "#2DD4BF", icon: "⧉",  label: "Compose"                  },
  group_by:                  { bg: "#0A1020", border: "#818CF8", icon: "⊞",  label: "Group By"                 },
  // ── AI ──
  ask_ai: { bg: "#110D1F", border: "#A78BFA", icon: "🤖", label: "Ask AI" },
  // ── News ──
  fetch_news_headlines: { bg: "#041A14", border: "#06B6D4", icon: "📰", label: "Fetch News Headlines" },
  // ── Social Media ──
  post_linkedin: { bg: "#051424", border: "#0A66C2", icon: "🔗", label: "Post to LinkedIn" },
  post_twitter:  { bg: "#0D0D0D", border: "#E7E7E7", icon: "𝕏",  label: "Post to X / Twitter" },
  post_facebook: { bg: "#071533", border: "#1877F2", icon: "📘", label: "Post to Facebook" },
  // ── Notifications ──
  send_browser_notification: { bg: "#1A1400", border: "#F59E0B", icon: "🔔", label: "Browser Notification" },
  send_mobile_push:          { bg: "#1A0D2E", border: "#A855F7", icon: "📱", label: "Mobile Push"          },
  create_notification:       { bg: "#0A1A10", border: "#22C55E", icon: "🔕", label: "In-App Notification"  },
  // ── Alerts & Notifications ──
  play_sound:                { bg: "#1A0A18", border: "#E879F9", icon: "🔊", label: "Play Sound"            },
  // ── Input ──
  ask_for_input: { bg: "#1A0E00", border: "#F97316", icon: "⌨",  label: "Ask for Input"       },
  // ── Logic ──
  switch_case:   { bg: "#180D00", border: "#FB923C", icon: "⇶",  label: "Switch"              },
  // ── Control Flow ──
  foreach:         { bg: "#160A2E", border: "#A855F7", icon: "↻",  label: "For Each"            },
  for:             { bg: "#160A2E", border: "#A855F7", icon: "⟳",  label: "For"                 },
  retry:           { bg: "#1A1100", border: "#F59E0B", icon: "🔁",  label: "Retry"               },
  approval_gate:   { bg: "#1A1200", border: "#F59E0B", icon: "⏸",  label: "Approval Gate"       },
  graph_write_operation:     { bg: "#0B1E1B", border: "#14B8A6", icon: "🖋️", label: "Graph Write Operation" },
  execute_baseline_template: { bg: "#0D1527", border: "#3B82F6", icon: "📑", label: "Execute Baseline Template" },
  report_progress: { bg: "#061A1A", border: "#00B4D8", icon: "📶", label: "Report Progress"     },
  // ── Calendar (Exchange / Microsoft Graph) ──
  check_exchange_calendar_availability: { bg: "#041620", border: "#2F6FED", icon: "📅", label: "Check Calendar"           },
  create_exchange_calendar_event:       { bg: "#041620", border: "#00B4D8", icon: "📆", label: "Create Calendar Event"    },
  // ── SharePoint ──
  save_to_sharepoint: { bg: "#0A1A10", border: "#34D399", icon: "💾", label: "Save to SharePoint"  },
  get_from_sharepoint:{ bg: "#0A1A10", border: "#6EE7B7", icon: "📥", label: "Get from SharePoint" },
  // ── Documents / PDF ──
  generate_pdf:       { bg: "#1A0D00", border: "#F97316", icon: "📄", label: "Generate PDF"         },
  build_presentation: { bg: "#0A1420", border: "#818CF8", icon: "📊", label: "Build Presentation"   },
  // ── Payments (Stripe) ──
  generate_invoice_stripe_payment: { bg: "#041A1A", border: "#34D399", icon: "🧾", label: "Generate Invoice"       },
  generate_stripe_payment_link:    { bg: "#041A1A", border: "#2DD4BF", icon: "🔗", label: "Generate Payment Link"  },
  create_phased_invoices:          { bg: "#041A1A", border: "#F59E0B", icon: "📋", label: "Create Phased Invoices"  },
  generate_phased_invoice:         { bg: "#041A1A", border: "#A78BFA", icon: "🧾", label: "Generate Phased Invoice" },
  charge_stripe_invoice:           { bg: "#041A1A", border: "#EF4444", icon: "⚡", label: "Charge Invoice"          },
  edit_stripe_invoice:             { bg: "#041A1A", border: "#818CF8", icon: "✏️", label: "Edit Invoice"            },
  // ── Project Phase Actions ──
  update_milestone:         { bg: "#0A1A10", border: "#22C55E", icon: "🏁", label: "Update Milestone" },
  get_phases:               { bg: "#0A1A10", border: "#34D399", icon: "🔍", label: "Get Phases"       },
  create_phase:             { bg: "#0A1A10", border: "#6EE7B7", icon: "📌", label: "Create Phase"     },
  save_presentation_phases: { bg: "#0A1A10", border: "#10B981", icon: "💾", label: "Save Phases"      },
  // ── Variables ──
  set_variable:    { bg: "#0A1A10", border: "#34D399", icon: "📦", label: "Set Variable"    },
  update_variable: { bg: "#1A0E00", border: "#F97316", icon: "✏️", label: "Update Variable" },
  // ── Parallel / Join ──
  parallel: { bg: "#0D1020", border: "#06B6D4", icon: "⇉",  label: "Parallel"           },
  join:     { bg: "#0D1020", border: "#06B6D4", icon: "⇊",  label: "Join"               },
  // ── Scripts ──
  generate_script:      { bg: "#0D1A10", border: "#22C55E", icon: "📜", label: "Generate Script"       },
  check_script_output:  { bg: "#041A18", border: "#2DD4BF", icon: "🔬", label: "Check Script Output"   },
  // ── Monitoring ──
  monitor_get_package:         { bg: "#0F2A2A", border: "#00B4D8", icon: "📦", label: "Get Monitor Package"        },
  monitor_execute_package:     { bg: "#0F2A2A", border: "#00B4D8", icon: "📡", label: "Execute Monitor Package"    },
  monitor_poll_activity:       { bg: "#0A2020", border: "#06B6D4", icon: "📶", label: "Poll Activity"              },
  monitor_subscription_ensure: { bg: "#0A2020", border: "#06B6D4", icon: "🔗", label: "Ensure Subscription"       },
  config_snapshot_collect:     { bg: "#0F2A2A", border: "#00B4D8", icon: "🗄", label: "Collect Config Snapshot"   },
  config_snapshot_diff:        { bg: "#0F2A2A", border: "#00B4D8", icon: "⇄", label: "Diff Config Snapshots"     },
  // ── Utilities ──
  comment:  { bg: "#1A1600", border: "#CA8A04", icon: "📝", label: "Comment"            },
};

// ── Node library ──────────────────────────────────────────────────────────────

export const LIBRARY_CATEGORIES: Array<{ name: string; nodes: Array<{ type: string; label: string; description: string; tags: string[] }> }> = [
  {
    name: "Core",
    nodes: [
      { type: "end",           label: "End",           description: "Workflow exit point",                                 tags: ["core", "flow"] },
      { type: "condition",     label: "Condition",     description: "Branch on expression",                               tags: ["logic", "branch", "if"] },
      { type: "delay",         label: "Delay",         description: "Wait / poll condition",                              tags: ["control", "wait", "pause"] },
      { type: "error",         label: "Error",         description: "Catch-all error handler",                            tags: ["control", "error", "catch"] },
      { type: "ask_for_input", label: "Ask for Input", description: "Prompt the operator for values before the run starts", tags: ["input", "manual", "form", "prompt", "interactive"] },
      { type: "switch_case",   label: "Switch",        description: "Route to one of many branches based on an expression value", tags: ["logic", "switch", "case", "branch", "route", "multi"] },
      { type: "foreach",       label: "For Each",      description: "Iterate over an array, running a subgraph for each element", tags: ["loop", "iterate", "array", "for-each", "foreach", "control flow"] },
      { type: "for",           label: "For",           description: "Sequential index-based loop over an array — injects {{item}} and {{index}} per iteration", tags: ["loop", "for", "iterate", "array", "index", "sequential", "control flow"] },
    ],
  },
  {
    name: "CRM",
    nodes: [
    ],
  },
  {
    name: "Diagnostics",
    nodes: [
    ],
  },
  {
    name: "M365 Health",
    nodes: [
      { type: "validate_m365_permissions",  label: "Validate Permissions",    description: "Check required M365 app permissions via Azure",      tags: ["m365", "health", "permissions", "azure"] },
      { type: "update_intelligence_tables", label: "Update Intel Tables",     description: "Refresh client health history from a runbook",       tags: ["m365", "health", "intelligence", "runbook"] },
      { type: "generate_diff_report",       label: "Diff Report",             description: "Compare last two health snapshots and create a doc",  tags: ["m365", "health", "diff", "report"] },
      { type: "notify_major_changes",       label: "Notify Major Changes",    description: "Alert Shane if health score changed significantly",   tags: ["m365", "health", "notify", "alert"] },
      { type: "get_tenant_signals",          label: "Get Tenant Signals",       description: "Evaluate all signal rules for a client and output the fired signal keys. Pipe {{signals}} into Generate Document (consolidated_sow) to skip redundant signal evaluation.", tags: ["m365", "signals", "tenant", "sow", "engagement", "intelligence"] },
    ],
  },
  {
    name: "Intelligence Engines",
    nodes: [
      { type: "calculate_priority", label: "Priority Engine",    description: "Rank a tenant by summing priorityScoreContribution across fired, enabled signals. Outputs {{score}} and {{breakdown}}.", tags: ["engine", "priority", "score", "intelligence"] },
      { type: "calculate_pricing_engine", label: "Pricing Engine", description: "Sum pricingImpact / pricingValueContribution across fired, enabled signals for a tenant. Outputs {{score}} and {{breakdown}}.", tags: ["engine", "pricing", "score", "intelligence"] },
      { type: "calculate_health",   label: "Health Engine",      description: "Compute the tenant's overall architecture health score across governance/security/compliance/adoption/copilot categories.", tags: ["engine", "health", "score", "intelligence"] },
      { type: "calculate_drift",    label: "Drift Engine",       description: "Compute a tenant's drift score and trend direction from drift-tagged rules/groups that fired.", tags: ["engine", "drift", "score", "intelligence"] },
      { type: "calculate_forecast", label: "Forecasting Engine", description: "Project trendValue * decayFactor across fired signals with a non-zero trend for a tenant.", tags: ["engine", "forecasting", "score", "intelligence"] },
      { type: "calculate_crm",      label: "CRM Engine",         description: "Sum the five CRM contribution fields (fit/pain/maturity/intent/urgency) across fired crm:* signals.", tags: ["engine", "crm", "score", "intelligence"] },
      { type: "calculate_msp",      label: "MSP Portfolio Engine", description: "Aggregate health + drift + priority scores into a portfolio-wide risk roll-up.", tags: ["engine", "msp", "portfolio", "score", "intelligence"] },
      { type: "sla_start_timer",    label: "SLA Start Timer",      description: "Start an SLA response or resolution timer for a customer ticket. Outputs {{timerId}} for downstream nodes.", tags: ["engine", "sla", "timer", "start", "intelligence"] },
      { type: "sla_stop_timer",     label: "SLA Stop Timer",       description: "Stop a running SLA timer (marks it stopped/resolved without breach).", tags: ["engine", "sla", "timer", "stop", "intelligence"] },
      { type: "sla_warning",        label: "SLA Warning",          description: "Fire the warning milestone on an SLA timer when the warning threshold is crossed.", tags: ["engine", "sla", "warning", "threshold", "intelligence"] },
      { type: "sla_breach",         label: "SLA Breach",           description: "Record an SLA breach when elapsed time exceeds the policy threshold. Updates the timer status to 'breached'. Outputs {{breachId}}.", tags: ["engine", "sla", "breach", "violation", "intelligence"] },
      { type: "sla_escalate",       label: "SLA Escalate",         description: "Create an escalation record for an open breach (supports multi-level operator_task/email/sms/webhook escalations). Outputs {{escalationId}}.", tags: ["engine", "sla", "escalate", "level", "intelligence"] },
      { type: "sla_resolve",        label: "SLA Resolve",          description: "Resolve an SLA timer, mark any associated breaches resolved, and close open escalations.", tags: ["engine", "sla", "resolve", "close", "intelligence"] },
    ],
  },
  {
    name: "Marketing Actions",
    nodes: [
      { type: "send_campaign_email",       label: "Send Campaign Email",    description: "Render an Email Template and send it to a recipient",        tags: ["email", "marketing", "campaign", "template"] },
      { type: "define_campaign_goal",      label: "Define Goal",            description: "Set the campaign goal — outputs {{campaignGoal}} for downstream nodes",                        tags: ["marketing", "campaign", "goal", "define"] },
      { type: "define_target_audience",    label: "Define Target Audience", description: "Define who the campaign targets — outputs {{targetAudience}}",                                tags: ["marketing", "campaign", "audience", "target"] },
      { type: "create_campaign_offer",     label: "Create Offer",           description: "Create an offer record in the database (name, pricing, deliverables) — outputs {{offerId}}", tags: ["marketing", "campaign", "offer", "create", "crm"] },
      { type: "create_marketing_campaign", label: "Create Campaign",         description: "Create a new marketing campaign record in the database",     tags: ["marketing", "campaign", "create", "crm"] },
      { type: "publish_landing_page",      label: "Publish Landing Page",   description: "Set a landing page live by its slug",                        tags: ["marketing", "landing page", "publish", "site"] },
      { type: "generate_landing_page",     label: "Generate Landing Page",  description: "AI generates a landing page from topic, audience and CTA and saves it to the DB (unpublished)", tags: ["marketing", "landing page", "ai", "generate", "content"] },
    ],
  },
  {
    name: "Content",
    nodes: [
      { type: "topic_picker",    label: "Topic Picker",    description: "AI picks a fresh article topic not already covered",           tags: ["content", "article", "ai", "topic", "generate"] },
      { type: "generate_article", label: "Generate Article", description: "AI-writes a consulting article (title, slug, Markdown body)",  tags: ["content", "article", "ai", "blog", "generate"] },
      { type: "publish_article",  label: "Publish Article",  description: "Save article to DB and write .md file to the public site",    tags: ["content", "article", "publish", "blog", "site"] },
      { type: "generate_image",        label: "Generate Image",        description: "AI-generates an image (social card, OG image, banner) via gpt-image-1 and saves it permanently", tags: ["image", "social", "ai", "og", "generate", "content"] },
      { type: "fetch_news_headlines",  label: "Fetch News Headlines",  description: "Pull today's M365 headlines, AI hot-scores them, and optionally triggers a campaign draft", tags: ["news", "headlines", "ai", "hot-score", "campaign", "content", "microsoft 365"] },
    ],
  },
  {
    name: "Social Media",
    nodes: [
      { type: "post_linkedin", label: "Post to LinkedIn", description: "Publish a text post to a LinkedIn company/org page", tags: ["social", "linkedin", "post", "marketing"] },
      { type: "post_twitter",  label: "Post to X / Twitter", description: "Post a tweet via the Twitter API v2 with OAuth 1.0a", tags: ["social", "twitter", "x", "tweet", "marketing"] },
      { type: "post_facebook", label: "Post to Facebook", description: "Publish a post to a Facebook Page via the Graph API", tags: ["social", "facebook", "post", "marketing"] },
    ],
  },
  {
    name: "AI",
    nodes: [
      { type: "ask_ai", label: "Ask AI", description: "Send a prompt to Claude and expose the response as {{aiResponse}} for downstream nodes", tags: ["ai", "claude", "llm", "generate", "prompt", "ask"] },
    ],
  },
  {
    name: "Data",
    nodes: [
      { type: "find_object", label: "Find Object", description: "Look up a lead, client, project, article, Stripe invoice, insights document, or presentation by field value", tags: ["data", "lookup", "find", "lead", "client", "project", "insights", "document", "presentation"] },
      { type: "compose",     label: "Compose",     description: "Evaluate any value or expression and expose it downstream as {{steps.<id>.value}}", tags: ["data", "compose", "expression", "variable", "glue", "transform"] },
      { type: "group_by",    label: "Group By",    description: "Bucket an array of items by a field value, producing {{groups}} — an array of { key, items } objects. Feed into a ForEach to iterate over each group.", tags: ["data", "group", "bucket", "aggregate", "array", "transform", "group-by"] },
    ],
  },
  {
    name: "Platform",
    nodes: [
      { type: "http_request",   label: "HTTP Request",   description: "Make an external HTTP/REST API call",                tags: ["http", "api", "request", "platform", "integration"] },
      { type: "sql_query",      label: "SQL Query",       description: "Run a SELECT query and expose results downstream",  tags: ["sql", "database", "query", "data"] },
      { type: "emit_event",     label: "Emit Event",      description: "Fire a named event that can trigger other workflows", tags: ["event", "trigger", "emit", "platform"] },
      { type: "cancel_workflow", label: "Cancel Workflow", description: "Immediately stop the current run",                  tags: ["cancel", "stop", "halt", "control"] },
    ],
  },
  {
    name: "Communication",
    nodes: [
      { type: "send_email",               label: "Send Email",               description: "Send a plain email to any address",                              tags: ["email", "send", "notify", "communication"] },
      { type: "send_sms",                 label: "Send SMS",                 description: "Send an SMS to an E.164 phone number via Twilio",               tags: ["sms", "text", "notify", "communication"] },
      { type: "send_browser_notification", label: "Browser Notification",    description: "Push an OS-level browser alert to all subscribed admins",       tags: ["notification", "push", "browser", "alert", "admin"] },
      { type: "send_mobile_push",          label: "Mobile Push",              description: "Send an Expo push notification to all registered mobile devices", tags: ["notification", "push", "mobile", "expo", "alert", "admin"] },
      { type: "create_notification",       label: "In-App Notification",      description: "Insert a persistent alert into the admin notification bell/drawer", tags: ["notification", "in-app", "bell", "drawer", "alert", "admin"] },
    ],
  },
  {
    name: "Alerts & Notifications",
    nodes: [
      { type: "play_sound", label: "Play Sound", description: "Play an audio alert in the browser or deliver it via desktop push notification — preset library, custom URL, or AI-synthesised tone", tags: ["sound", "audio", "alert", "notification", "play", "chime", "beep"] },
    ],
  },
  {
    name: "CRM Actions",
    nodes: [
      { type: "create_client",          label: "Create Client",          description: "Provision a new client user account",              tags: ["crm", "client", "create", "account"] },
      { type: "create_project",         label: "Create Project",         description: "Create a new engagement project",                  tags: ["crm", "project", "create", "engagement"] },
    ],
  },
  {
    name: "Project",
    nodes: [
      { type: "get_phases",               label: "Get Phases",          description: "Fetch the SOW phases saved on a presentation, filtered to selected phases only. Use before a ForEach to iterate and create project phases.",            tags: ["phases", "project", "sow", "lookup", "presentation"] },
      { type: "create_phase",             label: "Create Phase",        description: "Insert a new project phase (workflow_steps row) for a given project. Wire inside a ForEach to create all phases from the SOW.",                         tags: ["phase", "project", "workflow step", "create"] },
      { type: "save_presentation_phases", label: "Save Phases",         description: "Persist AI-generated phases to a presentation (quick_win_presentations.sowPhases). Allocates prices by weight and saves to DB.",                         tags: ["phases", "sow", "presentation", "save"] },
      { type: "create_kanban_task",       label: "Create Kanban Task",  description: "Create a kanban card on a marketing board or a project board. Supports {{token}} interpolation for boardId so you can pass {{projectId}} dynamically.", tags: ["kanban", "task", "project", "board", "card", "create"] },
      { type: "get_project_tasks",        label: "Get Project Tasks",   description: "Fetch all kanban tasks for a project. Returns phases[] (nested) and flatTasks[] (all tasks in one array, each with phase info embedded). Pipe flatTasks into a single ForEach to process every task individually.", tags: ["kanban", "task", "project", "read", "lookup", "phases", "flat", "iterate"] },
      { type: "update_project_task",      label: "Update Project Task", description: "Update a single kanban task by ID. Flip the column (progress state), rename it, change priority, assignee, or due date. All fields support {{token}} interpolation.", tags: ["kanban", "task", "project", "update", "edit", "column"] },
      { type: "update_milestone",         label: "Update Milestone",    description: "Change a project phase/milestone status and optional delivery date. When status is set to in_progress, Kanban cards are automatically seeded from the phase template (no script auto-fire).", tags: ["milestone", "phase", "project", "status", "delivery", "kanban", "seed", "update"] },
    ],
  },
  {
    name: "Azure",
    nodes: [
      { type: "execute_runbook",     label: "Execute Script",       description: "Trigger an Azure script execution",                  tags: ["azure", "script", "automation", "m365"] },
      { type: "update_m365_profile", label: "Update M365 Profile",  description: "Update a client's M365 profile via Azure",            tags: ["azure", "m365", "profile", "script"] },
      { type: "generate_document",   label: "Generate Document",    description: "Create a document record for a client",              tags: ["document", "client", "report", "generate"] },
      { type: "calculate_pricing",   label: "Calculate Pricing",    description: "Parse SOW HTML and write sowPricingLines to the DB",  tags: ["document", "sow", "pricing", "calculate"] },
    ],
  },
  {
    name: "Control Flow",
    nodes: [
      { type: "foreach",         label: "For Each",        description: "Iterate over an array and run nodes for each element",         tags: ["loop", "iterate", "foreach", "array", "control"] },
      { type: "for",             label: "For",             description: "Sequential index-based loop — injects {{item}} and {{index}} per iteration", tags: ["loop", "for", "iterate", "index", "sequential", "array", "control"] },
      { type: "parallel",        label: "Parallel",        description: "Split into multiple branches that run concurrently; awaited branches are merged at a Join node", tags: ["parallel", "concurrent", "branch", "split", "fan-out", "control"] },
      { type: "retry",           label: "Retry",           description: "Re-run a failed node automatically; wire graceful error handling in the Exhausted body.", tags: ["retry", "error", "loop", "control", "recover", "resilience"] },
      { type: "approval_gate",   label: "Approval Gate",   description: "Pause the run until an admin approves or rejects to continue", tags: ["approval", "gate", "pause", "human", "control", "review"] },
      { type: "report_progress", label: "Report Progress", description: "Emit a real-time status message visible in the test-run panel and run timeline", tags: ["progress", "status", "log", "notify", "control", "debug"] },
      { type: "run_workflow",    label: "Run Workflow",    description: "Execute another published workflow synchronously and merge its outputs into the current context", tags: ["workflow", "subworkflow", "call", "invoke", "control", "run"] },
    ],
  },
  {
    name: "Calendar",
    nodes: [
      { type: "check_exchange_calendar_availability", label: "Check Availability",    description: "Query Exchange Online (Graph) to find free/busy slots in a date range", tags: ["calendar", "exchange", "availability", "m365", "graph", "outlook"] },
      { type: "create_exchange_calendar_event",       label: "Create Calendar Event", description: "Create a calendar event in an Exchange Online mailbox via Microsoft Graph", tags: ["calendar", "exchange", "event", "m365", "graph", "meeting", "outlook"] },
    ],
  },
  {
    name: "SharePoint",
    nodes: [
      { type: "save_to_sharepoint",  label: "Save to SharePoint",  description: "Upload a file to a SharePoint drive via Microsoft Graph", tags: ["sharepoint", "m365", "graph", "file", "upload", "document"] },
      { type: "get_from_sharepoint", label: "Get from SharePoint", description: "Download a file from a SharePoint drive via Microsoft Graph", tags: ["sharepoint", "m365", "graph", "file", "download", "document"] },
    ],
  },
  {
    name: "Documents",
    nodes: [
      { type: "generate_pdf",       label: "Generate PDF",       description: "Render an HTML template to a PDF and output base64 + data URI", tags: ["pdf", "document", "report", "generate", "html"] },
      { type: "build_presentation", label: "Build Presentation", description: "Compose a branded client proposal page and save it with a public link", tags: ["presentation", "proposal", "client", "report", "html", "deck"] },
    ],
  },
  {
    name: "Payments",
    nodes: [
      { type: "generate_invoice_stripe_payment", label: "Generate Invoice",        description: "Create and send a finalised Stripe invoice to a client email",                    tags: ["stripe", "invoice", "payment", "billing", "finance"] },
      { type: "generate_stripe_payment_link",    label: "Generate Payment Link",   description: "Create a one-time Stripe Payment Link for a product at a fixed price",          tags: ["stripe", "payment", "link", "checkout", "finance"] },
      { type: "create_phased_invoices",          label: "Create Phased Invoices",  description: "Create draft Stripe invoices for each SOW phase (20%+per-phase billing plan) and save the deposit payment method as customer default for future auto-charges", tags: ["stripe", "invoice", "phased", "payment", "billing", "draft", "auto-charge"] },
      { type: "generate_phased_invoice",         label: "Generate Phased Invoice", description: "Create a single draft Stripe invoice for one SOW phase. Pulls the payment method from the deposit session and sets it as the customer default. Use inside a foreach over phases.", tags: ["stripe", "invoice", "phased", "payment", "billing", "draft", "single", "phase"] },
      { type: "charge_stripe_invoice",           label: "Charge Invoice",          description: "Finalize and immediately charge a Stripe draft invoice using the customer's default payment method", tags: ["stripe", "invoice", "charge", "payment", "auto-charge", "phased"] },
      { type: "edit_stripe_invoice",             label: "Edit Invoice",            description: "Update a Stripe draft invoice — set due date, description, or footer. Useful for shifting invoice dates when a phase delivery date changes.", tags: ["stripe", "invoice", "edit", "due-date", "update", "phased"] },
    ],
  },
  {
    name: "Variables",
    nodes: [
      { type: "set_variable",    label: "Set Variable",    description: "Create or overwrite a named variable in the run context — available downstream as {{nodeName.value}} or {{variableName}}",           tags: ["variable", "set", "store", "data", "context", "assign"] },
      { type: "update_variable", label: "Update Variable", description: "Overwrite an existing run variable — amber accent makes mutations visually distinct from Set Variable for easier flow readability", tags: ["variable", "update", "mutate", "overwrite", "data", "assign"] },
    ],
  },
  {
    name: "Scripts",
    nodes: [
      { type: "generate_script",     label: "Generate Script",      description: "AI-generates a PowerShell script from a service or insights document and saves it to the Script Library under Workflow Generated", tags: ["script", "powershell", "ai", "generate", "library", "m365", "azure"] },
      { type: "check_script_output", label: "Check Script Output",  description: "Use Claude AI to evaluate PowerShell / runbook output and branch to Passed or On Failure", tags: ["script", "check", "evaluate", "ai", "branch", "condition", "powershell", "output"] },
    ],
  },
  {
    name: "Monitoring",
    nodes: [
      { type: "monitor_get_package",         label: "Get Monitor Package",    description: "Resolve an active monitoring package by its key and output the list of checks it contains. Chain into Execute Monitor Package.", tags: ["monitoring", "package", "checks", "msp", "graph", "tenant"] },
      { type: "monitor_execute_package",     label: "Execute Monitor Package", description: "Run all checks in a monitoring package against a tenant via the Microsoft Graph API. Emits per-check progress and outputs runStatus, checksOk/Error, and checkResults.", tags: ["monitoring", "execute", "package", "checks", "msp", "graph", "tenant", "consent"] },
      { type: "monitor_poll_activity",       label: "Poll Activity",           description: "Poll the O365 Management Activity API for new audit events since the stored watermark. Records critical events and advances the watermark on success.", tags: ["monitoring", "activity", "audit", "poll", "o365", "tenant", "msp"] },
      { type: "monitor_subscription_ensure", label: "Ensure Subscription",     description: "Start or re-confirm an O365 Management Activity API subscription for a tenant and content type. Safe to call repeatedly — idempotent upsert.", tags: ["monitoring", "subscription", "o365", "activity", "tenant", "msp"] },
      { type: "config_snapshot_collect",     label: "Collect Config Snapshot",  description: "Capture a full, point-in-time tenant configuration snapshot. Iterates every collectable resource type in the registry, reads each one whole over Microsoft Graph or the ps-execution container, and stores the real objects. Read-only. Records a per-resource outcome for every type it targeted — including skips, with the real reason — so the snapshot states its own completeness. Optional tenantId, resourceKeys, transports, surfaces, maxResources, timeBudgetMs, maxPagesPerResource, concurrency.", tags: ["config", "snapshot", "configuration", "state", "graph", "powershell", "tenant", "msp", "drift", "baseline", "promotion"] },
      { type: "config_snapshot_diff",        label: "Diff Config Snapshots",    description: "Compute the property-level difference between two configuration snapshots. One engine serves all four capabilities — set mode to drift (tenant now vs its baseline), baseline_assessment (tenant now vs a known-good), tenant_compare (A vs B) or promotion (source environment vs target). Reports which property went from X to Y, not merely that an object changed. A resource that could not be read on either side is reported as not comparable with the real reason, never as a deletion. Makes no tenant call. Computes the difference only — it never applies it. Requires baseSnapshotRowId and headSnapshotRowId; optional mode, resourceKeys, triggerRef.", tags: ["config", "snapshot", "diff", "drift", "baseline", "compare", "promotion", "configuration", "state", "tenant", "msp"] },
    ],
  },
  {
    name: "MSP / Baseline Actions",
    nodes: [
      { type: "graph_write_operation",     label: "Graph Write Operation",     description: "Executes a Microsoft Graph API write call (POST, PATCH, or PUT) against a customer tenant. Resolves the tenant's Graph tenantId from the customerId. On success routes via the 'success' handle; on failure routes via 'insufficient_privilege', 'conflict', 'bad_request', or 'unexpected' handles. dry-run is explicitly blocked — the node returns a skip indicator instead of executing.", tags: ["graph", "write", "microsoft", "azure", "tenant", "msp", "baseline"] },
      { type: "execute_baseline_template", label: "Execute Baseline Template", description: "Looks up a platform-authored baseline action template by its templateId slug, resolves {{variable}} placeholders in the body using the current run context, validates all requiredVariables, and delegates execution to graphWriteForTenant. Records the outcome in baseline_action_template_audit_log. Routes via 'success' or error-type handles identical to graph_write_operation. dry-run is explicitly blocked.", tags: ["template", "baseline", "microsoft", "azure", "tenant", "msp", "execute"] },
    ],
  },
  {
    name: "Utilities",
    nodes: [
      { type: "comment", label: "Comment", description: "Annotate the canvas with a plain-text note — skipped entirely at runtime", tags: ["comment", "note", "annotation", "documentation", "utility"] },
    ],
  },
];

export const ALL_LIBRARY_NODES = LIBRARY_CATEGORIES.flatMap(c => c.nodes);
