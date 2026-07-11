/**
 * workflow-node-default-samples.ts
 *
 * Hand-authored static output samples for fixed-shape node types.
 * These are used to populate wf_node_output_samples for nodes whose output
 * shape is known at build time — so the variable picker has something to show
 * even before the workflow has ever been run.
 *
 * Dynamic node types (sql_query, find_object, for_each, http_request, etc.)
 * are intentionally absent — their output depends on runtime data and must be
 * populated by an actual Test Run.
 */

export const STATIC_NODE_SAMPLES: Record<string, Record<string, unknown>> = {
  // ── AI ────────────────────────────────────────────────────────────────────
  ask_ai: {
    aiResponse: "This is a sample AI-generated text response.",
    model: "claude-haiku-4-5",
  },

  // ── Intelligence Engines ──────────────────────────────────────────────────
  calculate_priority: {
    engine: "priority",
    score: 72,
    breakdown: [
      { signalKey: "SIGNAL_A", label: "Sample signal A", weight: 3, contribution: 36 },
      { signalKey: "SIGNAL_B", label: "Sample signal B", weight: 2, contribution: 24 },
    ],
    rawSignals: ["SIGNAL_A", "SIGNAL_B"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_pricing_engine: {
    engine: "pricing",
    score: { totalPricingImpact: 1.15, totalPricingValueContribution: 0.85 },
    breakdown: [
      { signalKey: "SIGNAL_A", pricingImpact: 0.1, pricingValueContribution: 0.05 },
    ],
    rawSignals: ["SIGNAL_A"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_health: {
    engine: "health",
    score: 68,
    breakdown: [
      { signalKey: "SIGNAL_HEALTH", label: "Health signal", weight: 2, contribution: 20 },
    ],
    rawSignals: ["SIGNAL_HEALTH"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_drift: {
    engine: "drift",
    score: 34,
    breakdown: [
      { signalKey: "SIGNAL_DRIFT", label: "Drift signal", weight: 1, contribution: 10 },
    ],
    rawSignals: ["SIGNAL_DRIFT"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_forecast: {
    engine: "forecasting",
    score: 55,
    breakdown: [
      { signalKey: "SIGNAL_TREND", label: "Trend signal", weight: 2, contribution: 18 },
    ],
    rawSignals: ["SIGNAL_TREND"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_crm: {
    engine: "crm",
    score: { fit: 70, pain: 65, maturity: 50, intent: 80, urgency: 60 },
    breakdown: [
      { signalKey: "crm:pain_point", label: "Pain point", weight: 3, contribution: 24 },
    ],
    rawSignals: ["crm:pain_point"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },
  calculate_msp: {
    engine: "msp",
    score: 61,
    breakdown: [
      { tenantId: 1, tenantName: "Sample Tenant", healthScore: 70, driftScore: 30, priorityScore: 72 },
    ],
    rawSignals: ["SIGNAL_MSP"],
    timestamp: "2025-01-01T12:00:00.000Z",
  },

  // ── Tenant Signals ────────────────────────────────────────────────────────
  get_tenant_signals: {
    signals: ["SIGNAL_A", "SIGNAL_B", "alwaysInclude:CORE"],
    signalCount: 3,
    hasSignals: true,
  },

  // ── Document Generation ───────────────────────────────────────────────────
  generate_document: {
    documentId: 1,
    docType: "sow",
    name: "Sample Statement of Work",
    htmlContent: "",
  },

  // ── CRM nodes ─────────────────────────────────────────────────────────────
  create_lead: {
    leadId: 1,
    leadName: "Jane Smith",
    leadEmail: "jane@example.com",
  },
  convert_to_opportunity: {
    opportunityId: 1,
    leadId: 1,
  },
  create_client: {
    clientId: 1,
    clientEmail: "client@example.com",
  },
  create_project: {
    projectId: 1,
    projectTitle: "M365 Migration Project",
  },
  score_lead: {
    leadId: 1,
    score: 78,
    scoreLabel: "High",
    qualified: true,
  },
  assign_pipeline_stage: {
    targetType: "lead",
    leadId: 1,
    opportunityId: null,
    stage: "Warm",
  },
  create_opportunity: {
    opportunityId: 1,
    leadId: 1,
  },

  // ── Communication ─────────────────────────────────────────────────────────
  send_email: { sent: true },
  send_sms: { sent: true },
  emit_event: { eventName: "sample.event.fired" },

  // ── Azure / M365 ──────────────────────────────────────────────────────────
  execute_runbook: {
    jobId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    jobStatus: "Completed",
    runbookName: "Sample-Runbook",
    jobOutput: "Runbook completed successfully.",
    allSucceeded: true,
    results: [{ runbookName: "Sample-Runbook", status: "Completed", output: "OK" }],
    succeeded: ["Sample-Runbook"],
    failed: [],
  },
  update_m365_profile: {
    jobId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    jobStatus: "Running",
  },
  validate_m365_permissions: {
    permissionsValid: true,
    missingCount: 0,
    jobId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  update_intelligence_tables: {
    updated: true,
    recordId: 1,
    jobId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  generate_diff_report: {
    documentId: 1,
    changesFound: true,
    changeCount: 5,
  },
  notify_major_changes: {
    notified: true,
    skipped: false,
  },

  // ── Diagnostics ───────────────────────────────────────────────────────────
  parse_quiz_results: {
    quizLeadId: 1,
    totalScore: 72,
    tier: "Intermediate",
    recommendedService: "Microsoft 365 Governance",
  },
  generate_readiness_score: {
    readinessScore: 68,
    readinessLabel: "Medium",
    recordId: 1,
  },
  attach_quiz_insights: {
    insightsAttached: true,
    documentId: 1,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  generate_article: {
    articleTitle: "Sample Article Title",
    articleSlug: "sample-article-title",
    articleCategory: "Microsoft 365",
    articleSummary: "A short summary of the article content.",
    articleDate: "2025-01-01",
    articleContent: "# Sample Article\n\nContent goes here.",
  },
  publish_article: {
    published: true,
    slug: "sample-article-title",
    articleId: 1,
    title: "Sample Article Title",
  },
  topic_picker: {
    articleTopic: "Microsoft Copilot for M365",
    topicCategory: "AI & Copilot",
    topicRationale: "High interest among enterprise IT decision-makers.",
  },
  generate_image: {
    imageUrl: "/api/uploads/generated-images/sample-uuid.png",
    revisedPrompt: "A professional illustration of Microsoft 365 services.",
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  define_campaign_goal: { campaignGoal: "Drive awareness of Copilot AI adoption services." },
  define_target_audience: { targetAudience: "IT Directors at mid-market enterprises using Microsoft 365." },
  create_campaign_offer: {
    offerId: 1,
    offerName: "Copilot Quick Start",
    offerGoal: "Drive awareness",
    offerAudience: "IT Directors",
  },
  create_marketing_campaign: {
    campaignId: 1,
    campaignName: "Q1 Copilot Push",
    campaignStatus: "draft",
  },
  publish_landing_page: {
    landingPageId: 1,
    slug: "copilot-quick-start",
    published: true,
    wasAlreadyPublished: false,
  },
  generate_landing_page: {
    landingPageId: 1,
    slug: "copilot-quick-start",
    headline: "Unlock Microsoft Copilot for Your Team",
    subheadline: "Get started in days with expert-led onboarding.",
    published: false,
  },
  send_campaign_email: {
    sent: true,
    recipient: "client@example.com",
    subject: "Your Copilot Quick Start is Ready",
    sourceRef: "template:copilot-intro",
    templateSlug: "copilot-intro",
  },
  fetch_news_headlines: {
    newsHeadlines: [
      { title: "Sample headline", source: "TechNews", url: "https://example.com", publishedAt: "2025-01-01T12:00:00Z", description: "Sample description." },
    ],
    newsTopic: "Microsoft Copilot expansion",
    newsContext: "Microsoft is expanding Copilot across all M365 plans.",
    newsArticleSuggestion: "Now is the time to evaluate your Copilot readiness.",
    hotScore: 82,
    isHot: true,
    targetSector: "Technology",
    campaignBrief: "Audience: IT Directors. Hook: Copilot is here. Angles: readiness, ROI, governance.",
    campaignId: 1,
  },

  // ── Project Actions ───────────────────────────────────────────────────────
  create_kanban_task: {
    taskId: 1,
    boardId: "marketing",
    columnId: "todo",
    title: "Sample Kanban Task",
  },
  get_project_tasks: {
    phases: [{ phaseId: 1, phaseTitle: "Phase 1", phaseStatus: "in_progress", order: 1, tasks: [] }],
    flatTasks: [],
    taskCount: 0,
    projectId: 1,
  },
  update_project_task: {
    updated: true,
    taskId: 1,
    column: "in_progress",
    title: "Updated Task Title",
  },
  update_milestone: {
    milestoneId: 1,
    previousStatus: "pending",
    newStatus: "in_progress",
    kanbanCardsSeeded: false,
  },
  get_phases: {
    phases: [{ id: 1, title: "Phase 1", description: "Initial phase", price: 2500, subtasks: [] }],
    phaseCount: 1,
    presentationId: 1,
  },
  create_phase: {
    phaseId: 1,
    phaseTitle: "Phase 1: Discovery",
  },
  save_presentation_phases: {
    saved: true,
    phaseCount: 3,
    resolvedPhases: [],
  },

  // ── Sub-workflow ──────────────────────────────────────────────────────────
  run_workflow: { childRunId: 1 },

  // ── Pricing ───────────────────────────────────────────────────────────────
  calculate_pricing: {
    documentId: 1,
    totalPrice: 9500,
    lineCount: 4,
  },

  // ── Stripe ────────────────────────────────────────────────────────────────
  generate_invoice_stripe_payment: {
    invoiceId: "in_sample123",
    invoiceUrl: "https://invoice.stripe.com/i/sample",
    invoicePdfUrl: "https://invoice.stripe.com/i/sample/pdf",
    amountDue: 250000,
    currency: "usd",
  },
  generate_stripe_payment_link: {
    paymentLinkId: "plink_sample123",
    paymentLinkUrl: "https://buy.stripe.com/sample",
  },
  create_phased_invoices: {
    invoiceIds: ["in_sample1", "in_sample2"],
    phaseCount: 2,
    totalScheduled: 500000,
  },
  generate_phased_invoice: {
    invoiceId: "in_sample1",
    customerId: "cus_sample123",
    amountCents: 250000,
    phaseTitle: "Phase 1: Discovery",
  },
  charge_stripe_invoice: {
    chargeStatus: "succeeded",
    amountCharged: 250000,
    stripePaymentIntentId: "pi_sample123",
  },
  edit_stripe_invoice: {
    invoiceId: "in_sample1",
    status: "draft",
    dueDate: "2025-02-01T00:00:00.000Z",
  },

  // ── Variables ─────────────────────────────────────────────────────────────
  set_variable: { value: "sample_value" },
  update_variable: { value: "updated_value" },

  // ── Social Media ──────────────────────────────────────────────────────────
  post_linkedin: {
    linkedinPostId: "urn:li:ugcPost:sample123",
    linkedinPostUrl: "https://www.linkedin.com/feed/update/urn:li:ugcPost:sample123",
  },
  post_twitter: {
    twitterTweetId: "1234567890123456789",
    twitterTweetUrl: "https://twitter.com/i/web/status/1234567890123456789",
  },
  post_facebook: {
    facebookPostId: "123456789_987654321",
    facebookPostUrl: "https://www.facebook.com/permalink.php?story_fbid=987654321&id=123456789",
  },

  // ── SLA Engine ───────────────────────────────────────────────────────────
  sla_start_timer: {
    timerId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    alreadyExisted: false,
  },
  sla_stop_timer: {
    stopped: true,
    timerId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  sla_warning: {
    warningFired: true,
    timerId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  sla_breach: {
    breachId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    alreadyExisted: false,
  },
  sla_escalate: {
    escalationId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    alreadyExisted: false,
    level: 1,
  },
  sla_resolve: {
    resolved: true,
    timerId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  send_browser_notification: { notificationSent: true },
  send_mobile_push: { sent: true, sentCount: 2 },
  create_notification: { notificationCount: 3 },
  play_sound: { soundPlayed: true, soundTarget: "browser", soundSkipped: false },

  // ── SharePoint / Exchange ─────────────────────────────────────────────────
  save_to_sharepoint: {
    sharePointItemId: "sample-item-id",
    sharePointWebUrl: "https://contoso.sharepoint.com/sites/sample/Shared Documents/sample.docx",
    sharePointDownloadUrl: "https://contoso.sharepoint.com/_layouts/download.aspx?sample",
  },
  get_from_sharepoint: {
    fileContentBase64: "BASE64_CONTENT_HERE",
    fileName: "sample.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sharePointWebUrl: "https://contoso.sharepoint.com/sites/sample/Shared Documents/sample.docx",
  },
  check_exchange_calendar_availability: {
    isBusy: false,
    availableSlots: ["2025-01-15T09:00:00Z", "2025-01-15T14:00:00Z"],
    busySlots: ["2025-01-15T11:00:00Z"],
  },
  create_exchange_calendar_event: {
    eventId: "AAMkAGVmMDEzMTM4LTZmYWUtNDdkNC1hMDZe",
    eventUrl: "https://outlook.office.com/calendar/item/sample",
    eventWebLink: "https://outlook.office.com/owa/?itemid=sample",
  },

  // ── PDF ───────────────────────────────────────────────────────────────────
  generate_pdf: {
    pdfBase64: "JVBERi0xLjQK...",
    pdfDataUri: "data:application/pdf;base64,JVBERi0xLjQK...",
    fileName: "sample-document.pdf",
  },

  // ── Presentation ──────────────────────────────────────────────────────────
  build_presentation: {
    presentationHtml: "<!DOCTYPE html><html>...</html>",
    presentationUrl: "https://shanemccawconsulting.com/portal/proposals/sample-uuid",
    presentationId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },

  // ── Scripts ───────────────────────────────────────────────────────────────
  generate_script: {
    scriptId: 1,
    packageId: null,
  },
  check_script_output: {
    passed: true,
    outcome: "The script output indicates a successful configuration.",
  },

  // ── Parallel / Join ───────────────────────────────────────────────────────
  parallel: {
    branch_1: {},
    branch_2: {},
    branch_3: {},
    branch_4: {},
  },
  join: { joined: true },

  // ── Compose / Group ───────────────────────────────────────────────────────
  compose: { value: "composed value" },
  group_by: {
    groups: [{ key: "group_a", items: [] }],
    groupCount: 1,
  },

  // ── HTTP Request (partial — status is always present) ─────────────────────
  // Not listed as a "fixed-shape" type because the body differs per endpoint,
  // but status/ok are always present so we provide those.
  http_request: {
    status: 200,
    ok: true,
  },
};

/**
 * Node types whose output shape is fully determined at build time.
 * The variable picker should use STATIC_NODE_SAMPLES for these and
 * never show "sample unavailable".
 */
export const FIXED_SHAPE_NODE_TYPES = new Set(Object.keys(STATIC_NODE_SAMPLES));

/**
 * Node types whose output is entirely dynamic (depends on runtime data).
 * The variable picker shows "run a Test Run to populate sample" for these
 * when no captured sample exists.
 */
export const DYNAMIC_SHAPE_NODE_TYPES = new Set([
  "sql_query",
  "find_object",
  "foreach",
  "for",
  "ask_for_input",
]);
