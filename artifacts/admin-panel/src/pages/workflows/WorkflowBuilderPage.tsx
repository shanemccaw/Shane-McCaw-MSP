import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { playSoundFromParams, type SoundParams } from "@/lib/playSound";
import {
  type Node,
  type Edge,
  Handle,
  Position,
  type NodeProps,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import FlowCanvas from "./FlowCanvas";
import type { StoredNode, StoredEdge } from "./flowTree";
import { graphRemoveStep } from "./flowTree";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useRoute } from "wouter";
import { AssetPickerModal } from "@/components/AssetPickerModal";
import RunDetailContent, { type WfRunDetail } from "./RunDetailContent";
import type { AncestorGroup } from "./ancestorOutputs";
import { getAncestorOutputs as _getAncestorOutputs } from "./ancestorOutputs";

// ── Node type colours ─────────────────────────────────────────────────────────

const NODE_STYLES: Record<string, { bg: string; border: string; icon: string; label: string }> = {
  // ── Core / structural ──
  start:     { bg: "#0F2A1A", border: "#22C55E",  icon: "▶",  label: "Start"               },
  end:       { bg: "#1A1A2E", border: "#6366F1",  icon: "⏹",  label: "End"                 },
  condition: { bg: "#1A1300", border: "#F59E0B",  icon: "◆",  label: "Condition"           },
  delay:     { bg: "#1A0D2E", border: "#A855F7",  icon: "⏱",  label: "Delay"               },
  error:     { bg: "#1A0D0D", border: "#EF4444",  icon: "⚠",  label: "Error"               },
  // ── Platform (generic — kept for backward compat with saved workflows) ──
  action:    { bg: "#0D1A2E", border: "#0078D4",  icon: "⚡", label: "Action"              },
  // ── Promoted Platform / Communication nodes ──
  http_request:           { bg: "#0A1220", border: "#3B82F6",  icon: "🌐", label: "HTTP Request"           },
  sql_query:              { bg: "#0A1A12", border: "#10B981",  icon: "🗄️", label: "SQL Query"              },
  send_email:             { bg: "#0D1A2A", border: "#60A5FA",  icon: "📧", label: "Send Email"             },
  send_sms:               { bg: "#120D22", border: "#A78BFA",  icon: "💬", label: "Send SMS"               },
  emit_event:             { bg: "#1A0D18", border: "#F472B6",  icon: "📡", label: "Emit Event"             },
  cancel_workflow:        { bg: "#1A0D0D", border: "#EF4444",  icon: "🛑", label: "Cancel Workflow"        },
  // ── Promoted CRM Action nodes ──
  create_lead:            { bg: "#041A14", border: "#34D399",  icon: "➕", label: "Create Lead"            },
  convert_to_opportunity: { bg: "#041A14", border: "#2DD4BF",  icon: "🚀", label: "Convert to Opportunity" },
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
  score_lead:            { bg: "#061A18", border: "#00B4D8", icon: "⭐", label: "Score Lead"          },
  assign_pipeline_stage: { bg: "#061A18", border: "#00B4D8", icon: "🏷", label: "Assign Stage"        },
  create_opportunity:    { bg: "#061A18", border: "#00B4D8", icon: "🚀", label: "Create Opportunity"  },
  // ── Diagnostics / Quiz ──
  parse_quiz_results:       { bg: "#1C1100", border: "#F59E0B", icon: "📋", label: "Parse Quiz"          },
  generate_readiness_score: { bg: "#1C1100", border: "#F59E0B", icon: "📊", label: "Readiness Score"     },
  attach_quiz_insights:     { bg: "#1C1100", border: "#F59E0B", icon: "💡", label: "Attach Insights"     },
  // ── M365 Health ──
  validate_m365_permissions: { bg: "#110D22", border: "#8B5CF6", icon: "🔐", label: "Validate Perms"      },
  update_intelligence_tables:{ bg: "#110D22", border: "#8B5CF6", icon: "🧠", label: "Update Intel"        },
  generate_diff_report:      { bg: "#110D22", border: "#8B5CF6", icon: "📄", label: "Diff Report"         },
  notify_major_changes:      { bg: "#110D22", border: "#8B5CF6", icon: "🔔", label: "Notify Changes"      },
  get_tenant_signals:        { bg: "#0D1020", border: "#7C3AED", icon: "📡", label: "Get Tenant Signals"  },
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
  retry:           { bg: "#1A1100", border: "#F59E0B", icon: "🔁",  label: "Retry"               },
  approval_gate:   { bg: "#1A1200", border: "#F59E0B", icon: "⏸",  label: "Approval Gate"       },
  report_progress: { bg: "#061A1A", border: "#00B4D8", icon: "📶", label: "Report Progress"     },
  // ── Calendar (Exchange / Microsoft Graph) ──
  check_exchange_calendar_availability: { bg: "#041620", border: "#0078D4", icon: "📅", label: "Check Calendar"           },
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
  get_phases:               { bg: "#0A1A10", border: "#34D399", icon: "🔍", label: "Get Phases"   },
  create_phase:             { bg: "#0A1A10", border: "#6EE7B7", icon: "📌", label: "Create Phase" },
  save_presentation_phases: { bg: "#0A1A10", border: "#10B981", icon: "💾", label: "Save Phases"  },
  // ── Variables ──
  set_variable:    { bg: "#0A1A10", border: "#34D399", icon: "📦", label: "Set Variable"    },
  update_variable: { bg: "#1A0E00", border: "#F97316", icon: "✏️", label: "Update Variable" },
  // ── Parallel / Join ──
  parallel: { bg: "#0D1020", border: "#06B6D4", icon: "⇉",  label: "Parallel"           },
  join:     { bg: "#0D1020", border: "#06B6D4", icon: "⇊",  label: "Join"               },
  // ── Scripts ──
  generate_script:      { bg: "#0D1A10", border: "#22C55E", icon: "📜", label: "Generate Script"       },
  check_script_output:  { bg: "#041A18", border: "#2DD4BF", icon: "🔬", label: "Check Script Output"   },
  // ── Utilities ──
  comment:  { bg: "#1A1600", border: "#CA8A04", icon: "📝", label: "Comment"            },
};

// ── Event registry ────────────────────────────────────────────────────────────

const KNOWN_EVENTS: Array<{
  name: string;
  description: string;
  category: string;
  payloadFields: Array<{ key: string; label: string; enumValues?: string[] }>;
}> = [
  // ── CRM ──────────────────────────────────────────────────────────────────────
  { category: "CRM", name: "lead.created",             description: "A new lead was submitted via any channel (contact form, quiz, etc.)",   payloadFields: [{ key: "leadId", label: "Lead ID" }, { key: "leadName", label: "Full name" }, { key: "leadEmail", label: "Email address" }, { key: "company", label: "Company name" }, { key: "serviceArea", label: "Service area of interest" }] },
  { category: "CRM", name: "lead.qualified",           description: "A lead passed qualification scoring and is ready to convert",            payloadFields: [{ key: "leadId", label: "Lead ID" }, { key: "qualificationId", label: "Qualification record ID" }, { key: "score", label: "Overall qualification score" }] },
  { category: "CRM", name: "opportunity.created",      description: "A lead was converted into an active opportunity",                        payloadFields: [{ key: "opportunityId", label: "Opportunity ID" }, { key: "leadId", label: "Source lead ID" }, { key: "workflowType", label: "Type (e.g. DiscoveryCall)" }] },
  { category: "CRM", name: "client.created",           description: "A new client account was provisioned in the CRM",                       payloadFields: [{ key: "clientId", label: "Client user ID" }, { key: "clientEmail", label: "Client email" }, { key: "name", label: "Client name" }] },
  { category: "CRM", name: "project.created",          description: "A new engagement project was created",                                   payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "projectTitle", label: "Project title" }, { key: "clientId", label: "Client ID" }] },
  { category: "CRM", name: "project.phase_changed",    description: "A project advanced to a new phase",                                      payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "phase", label: "New phase" }, { key: "previousPhase", label: "Previous phase" }] },
  { category: "CRM", name: "onboarding.complete",      description: "A client completed the onboarding questionnaire",                        payloadFields: [{ key: "clientId", label: "Client ID" }, { key: "projectId", label: "Linked project ID" }] },
  { category: "CRM", name: "sow.scope_reduced",        description: "A client deselected phases in the SOW selector and regenerated a scoped SOW with a lower total or fewer phases than their previous selection", payloadFields: [{ key: "presentationId", label: "Presentation ID" }, { key: "clientUserId", label: "Client user ID" }, { key: "removedPhaseCount", label: "Number of phases removed vs previous selection" }, { key: "previousTotal", label: "Previous scoped total in cents" }, { key: "newTotal", label: "New scoped total in cents" }] },
  { category: "CRM", name: "contract.signed",          description: "A client signed their engagement contract",                              payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "clientId", label: "Client ID" }, { key: "signedAt", label: "ISO timestamp" }] },
  // ── Payments ─────────────────────────────────────────────────────────────────
  { category: "Payments", name: "payment.received",         description: "A Stripe payment was successfully processed",                            payloadFields: [{ key: "amount", label: "Amount in pence/cents" }, { key: "currency", label: "Currency code (e.g. gbp)" }, { key: "productName", label: "Product purchased" }] },
  { category: "Payments", name: "agreement_signed",         description: "A client signed the engagement agreement and initiated Stripe checkout — fires for both full and phased payment plans", payloadFields: [{ key: "contractId", label: "Presentation ID (acts as contract)" }, { key: "projectId", label: "Linked project ID" }, { key: "clientId", label: "Client user ID" }, { key: "clientEmail", label: "Client email" }, { key: "clientName", label: "Client name" }, { key: "paymentPlan", label: "Payment plan chosen", enumValues: ["full", "phased"] }, { key: "totalAmount", label: "Total engagement amount in cents" }, { key: "stripeSessionId", label: "Stripe Checkout session ID (deposit payment)" }] },
  { category: "Payments", name: "phase_completed",          description: "An admin marked a project phase (workflow step) as completed — carries the linked Stripe invoice ID for the phased billing workflow", payloadFields: [{ key: "phaseId", label: "Workflow step ID" }, { key: "projectId", label: "Project ID" }, { key: "clientId", label: "Client user ID" }, { key: "paymentPlan", label: "Payment plan on file", enumValues: ["full", "phased"] }, { key: "stripeInvoiceId", label: "Stripe draft invoice ID linked to this phase (null if not set)" }] },
  // ── Scheduling ───────────────────────────────────────────────────────────────
  { category: "Scheduling", name: "phase.delivery_date_changed",     description: "A project phase (workflow step) due date was changed by an admin", payloadFields: [{ key: "phaseId", label: "Workflow step ID" }, { key: "projectId", label: "Project ID" }, { key: "clientUserId", label: "Client user ID" }, { key: "paymentPlan", label: "Payment plan on file", enumValues: ["full", "phased"] }, { key: "oldDueDate", label: "Previous due date (ISO string, or null)" }, { key: "newDueDate", label: "New due date (ISO string, or null)" }] },
  { category: "Scheduling", name: "milestone.delivery_date_changed", description: "A milestone/task due date was changed by an admin", payloadFields: [{ key: "taskId", label: "Kanban task ID" }, { key: "phaseId", label: "Parent workflow step ID (null if not linked)" }, { key: "projectId", label: "Project ID" }, { key: "clientUserId", label: "Client user ID" }, { key: "oldDueDate", label: "Previous due date (ISO string, or null)" }, { key: "newDueDate", label: "New due date (ISO string, or null)" }] },
  // ── M365 ─────────────────────────────────────────────────────────────────────
  { category: "M365", name: "m365.health_check_complete", description: "An M365 health check script finished running",                        payloadFields: [{ key: "clientId", label: "Client ID" }, { key: "score", label: "Overall health score" }, { key: "status", label: "Job completion status" }] },
  { category: "M365", name: "m365.diagnostic_failed",    description: "A Quick Win diagnostic run failed mid-way (Azure credentials absent or network error)", payloadFields: [{ key: "clientId", label: "Client user ID" }, { key: "failed", label: "Always true for this event" }, { key: "completedAt", label: "ISO timestamp of failure" }] },
  { category: "M365", name: "quiz.lead_submitted",      description: "A lead completed the M365 readiness quiz and their results were scored",  payloadFields: [{ key: "quizLeadId", label: "Quiz lead record ID" }, { key: "leadName", label: "Lead full name" }, { key: "leadEmail", label: "Lead email" }, { key: "company", label: "Company name" }, { key: "totalScore", label: "Overall quiz score 0–100" }, { key: "tier", label: "Score tier (Beginner/Intermediate/Advanced)", enumValues: ["Beginner", "Intermediate", "Advanced"] }, { key: "recommendedService", label: "Top recommended service" }] },
  { category: "M365", name: "customer.script_result",   description: "A customer ran a downloaded diagnostic script and the results were received by the server", payloadFields: [{ key: "scriptName", label: "Script title" }, { key: "scriptId", label: "Library script UUID" }, { key: "customerId", label: "Client user ID" }, { key: "kanbanTaskId", label: "Linked kanban task ID" }, { key: "projectId", label: "Linked project ID" }, { key: "resultId", label: "Script run result row ID" }, { key: "results", label: "Full results object returned by the script" }] },
  // ── Insights ──────────────────────────────────────────────────────────────────
  { category: "Insights", name: "document.generated",             description: "A document was successfully generated from the Insights area (report or consulting deliverable)", payloadFields: [{ key: "documentId", label: "Generated document ID" }, { key: "documentType", label: "Document type (e.g. sow, executive_summary)" }, { key: "clientId", label: "Client user ID" }, { key: "clientName", label: "Client name" }, { key: "generatedAt", label: "ISO timestamp of generation" }, { key: "priceCents", label: "Engagement total in cents (from Tier 02 pricing, 0 for non-SOW documents)" }] },
  { category: "Insights", name: "presentation.phases_requested", description: "Phase generation was triggered for a Quick Win presentation (fires every time 'Build Your Project Plan' is clicked, including forced regenerations)", payloadFields: [{ key: "presentationId", label: "Presentation ID" }, { key: "customerId", label: "Client user ID" }, { key: "projectId", label: "Linked project ID" }, { key: "totalPrice", label: "Total engagement price" }, { key: "sowDocId", label: "Consolidated / full SOW document ID (null if none)" }, { key: "scopedSowDocId", label: "Scoped SOW document ID (null if no scoped SOW exists)" }, { key: "projectTitle", label: "Project title" }, { key: "adjustmentsTotal", label: "Price adjustments total" }, { key: "force", label: "True if this is a forced regeneration" }] },
];

// ── Node output registry (what each action injects into the next payload) ─────

const NODE_OUTPUTS: Record<string, Array<{ key: string; label: string; enumValues?: string[] }>> = {
  // platform / generic action sub-types
  create_lead:            [{ key: "leadId", label: "Created lead ID" }, { key: "leadName", label: "Full name" }, { key: "leadEmail", label: "Email" }],
  convert_to_opportunity: [{ key: "opportunityId", label: "Created opportunity ID" }, { key: "leadId", label: "Source lead ID" }],
  create_client:          [{ key: "clientId", label: "Created client user ID" }, { key: "clientEmail", label: "Client email" }],
  create_project:         [{ key: "projectId", label: "Created project ID" }, { key: "projectTitle", label: "Project title" }],
  execute_runbook:        [{ key: "jobId", label: "Azure Automation job ID" }, { key: "jobStatus", label: "Final job status (Completed / Failed / Stopped)" }, { key: "runbookName", label: "Runbook name" }, { key: "jobOutput", label: "Script output text (newline-joined stdout lines)" }],
  update_m365_profile:    [{ key: "jobId", label: "Azure Automation job ID" }, { key: "jobStatus", label: "Initial job status" }],
  generate_document:      [{ key: "documentId", label: "Created document ID" }, { key: "docType", label: "Document type", enumValues: ["executive_summary","full_readiness_report","security_posture_report","governance_maturity_report","data_exposure_risk_report","license_optimization_report","consolidated_sow","sow","task_execution_guide","remediation_plan","deployment_plan","governance_framework","security_hardening_plan","copilot_enablement_plan","identity_modernization_plan","copilot_readiness"] }, { key: "name", label: "Document name" }, { key: "htmlContent", label: "Full HTML of the generated document (task_execution_guide only)" }],
  run_workflow:           [{ key: "childRunId", label: "Child run ID" }],
  calculate_pricing:      [{ key: "documentId", label: "Document ID (echoed)" }, { key: "totalPrice", label: "Computed total price (USD)" }, { key: "lineCount", label: "Number of pricing lines written" }],
  http_request:           [{ key: "status", label: "HTTP response status code" }, { key: "ok", label: "true if 2xx response" }],
  sql_query:              [{ key: "queryRows", label: "Array of result rows" }],
  emit_event:             [{ key: "eventName", label: "Name of the emitted event" }],
  send_email:             [{ key: "sent", label: "true if email was sent" }],
  send_sms:               [{ key: "sent", label: "true if SMS was sent" }],
  // Array / transform nodes
  group_by:              [{ key: "groups", label: "Array of { key, items } objects" }, { key: "groupCount", label: "Number of distinct groups" }],
  // CRM nodes
  score_lead:            [{ key: "leadId", label: "Lead ID" }, { key: "score", label: "Score 0–100" }, { key: "scoreLabel", label: "Low / Medium / High", enumValues: ["Low", "Medium", "High"] }, { key: "qualified", label: "true if score ≥ threshold" }],
  assign_pipeline_stage: [{ key: "targetType", label: "Target type" }, { key: "leadId", label: "Lead ID" }, { key: "opportunityId", label: "Opportunity ID" }, { key: "stage", label: "New stage", enumValues: ["Junk", "Cold", "Warm", "Hot", "DiscoveryCall", "Proposal", "QuickWin", "Retainer", "Onboarding", "Closed Won", "Closed Lost"] }],
  create_opportunity:    [{ key: "opportunityId", label: "Created opportunity ID" }, { key: "leadId", label: "Source lead ID" }],
  // Diagnostics nodes
  parse_quiz_results:       [{ key: "quizLeadId", label: "Quiz lead record ID" }, { key: "totalScore", label: "Overall quiz score" }, { key: "tier", label: "Score tier", enumValues: ["Beginner", "Intermediate", "Advanced"] }, { key: "recommendedService", label: "Top recommended service" }],
  generate_readiness_score: [{ key: "readinessScore", label: "Composite readiness score 0–100" }, { key: "readinessLabel", label: "Low / Medium / High", enumValues: ["Low", "Medium", "High"] }, { key: "recordId", label: "Health history record ID" }],
  attach_quiz_insights:     [{ key: "insightsAttached", label: "true when saved" }, { key: "documentId", label: "Created insight document ID" }],
  // M365 Health nodes
  validate_m365_permissions: [{ key: "permissionsValid", label: "true if all perms present" }, { key: "missingCount", label: "Number of missing permissions" }, { key: "jobId", label: "Azure job ID" }],
  update_intelligence_tables:[{ key: "updated", label: "true on success" }, { key: "recordId", label: "Health history record ID" }, { key: "jobId", label: "Azure job ID" }],
  generate_diff_report:      [{ key: "documentId", label: "Created diff report ID" }, { key: "changesFound", label: "true if diffs detected" }, { key: "changeCount", label: "Number of changed fields" }],
  notify_major_changes:      [{ key: "notified", label: "true if alert was sent" }, { key: "skipped", label: "true if no major changes" }],
  get_tenant_signals:        [{ key: "signals", label: "Array of all fired signal keys (including alwaysInclude) — pipe into Generate Document signalsOverride" }, { key: "signalCount", label: "Total number of fired signals" }, { key: "hasSignals", label: "true if at least one tenant-specific signal fired (beyond alwaysInclude)" }],
  // Marketing Actions
  send_campaign_email: [{ key: "sent", label: "true if email was sent" }, { key: "recipient", label: "Resolved recipient address" }, { key: "subject", label: "Rendered email subject" }, { key: "sourceRef", label: "asset:id or template:slug that was used" }, { key: "templateSlug", label: "Legacy: template slug (empty when using campaign asset)" }],
  // Project Actions
  create_kanban_task:       [{ key: "taskId", label: "Created task ID" }, { key: "boardId", label: "Board used (marketing / project ID)" }, { key: "columnId", label: "Column/status the task was placed in" }, { key: "title", label: "Rendered task title" }],
  get_project_tasks:        [{ key: "phases", label: "Array of phase groups, each with phaseId, phaseTitle, phaseStatus, order, and tasks[]" }, { key: "flatTasks", label: "All tasks across all phases in a single flat array — each task includes phaseId, phaseTitle, phaseStatus, and phaseOrder. Use with a single ForEach instead of nested loops." }, { key: "taskCount", label: "Total number of tasks across all phases" }, { key: "projectId", label: "Project ID that was queried" }],
  update_project_task:      [{ key: "updated", label: "true when the task was found and updated" }, { key: "taskId", label: "ID of the updated task" }, { key: "column", label: "Final column value after update" }, { key: "title", label: "Final title value after update" }],
  get_phases:               [{ key: "phases", label: "Array of selected phases (id, title, description, price, subtasks)" }, { key: "phaseCount", label: "Number of phases returned" }, { key: "presentationId", label: "Presentation DB ID the phases were read from" }],
  create_phase:             [{ key: "phaseId", label: "Created workflow_steps row ID" }, { key: "phaseTitle", label: "Phase title as saved" }],
  save_presentation_phases: [{ key: "saved", label: "true on success" }, { key: "phaseCount", label: "Number of phases saved" }, { key: "resolvedPhases", label: "Array of resolved phase objects with price allocation" }],
  // Content
  generate_article: [{ key: "articleTitle", label: "Generated article title" }, { key: "articleSlug", label: "URL slug" }, { key: "articleCategory", label: "Category" }, { key: "articleSummary", label: "Card summary" }, { key: "articleDate", label: "Publication date string" }, { key: "articleContent", label: "Full Markdown body" }],
  publish_article:  [{ key: "published", label: "true if article was saved" }, { key: "slug", label: "Final article slug (may differ if conflict resolved)" }, { key: "articleId", label: "Database row ID" }, { key: "title", label: "Article title as saved" }],
  topic_picker:     [{ key: "articleTopic", label: "AI-selected article topic" }, { key: "topicCategory", label: "Category assigned to the topic" }, { key: "topicRationale", label: "One-sentence rationale from AI" }],
  // Marketing Actions (extended)
  define_campaign_goal:      [{ key: "campaignGoal", label: "Campaign goal text" }],
  define_target_audience:    [{ key: "targetAudience", label: "Target audience description" }],
  create_campaign_offer:     [{ key: "offerId", label: "Created offer DB ID" }, { key: "offerName", label: "Offer name" }, { key: "offerGoal", label: "Goal used on the offer" }, { key: "offerAudience", label: "Audience used on the offer" }],
  create_marketing_campaign: [{ key: "campaignId", label: "Created campaign DB ID" }, { key: "campaignName", label: "Campaign name" }, { key: "campaignStatus", label: "Campaign status (draft / active)", enumValues: ["draft", "active"] }],
  publish_landing_page:      [{ key: "landingPageId", label: "Landing page DB ID" }, { key: "slug", label: "Landing page slug" }, { key: "published", label: "true after publish" }, { key: "wasAlreadyPublished", label: "true if page was already live" }],
  generate_landing_page:     [{ key: "landingPageId", label: "Newly created landing page DB ID" }, { key: "slug", label: "URL slug of the new page" }, { key: "headline", label: "AI-generated headline" }, { key: "subheadline", label: "AI-generated subheadline" }, { key: "published", label: "Always false — use Publish Landing Page node to go live" }],
  // Data
  find_object: [{ key: "found", label: "true if a matching record was found" }, { key: "objectId", label: "Primary key (or Stripe invoice ID) of the found record" }, { key: "objectType", label: "Type queried", enumValues: ["lead", "client", "project", "article", "stripe_invoice", "insights_document", "presentation"] }, { key: "presentationId", label: "Presentation DB ID (presentation only)" }, { key: "clientUserId", label: "Client user ID (presentation/project only)" }, { key: "sowPhases", label: "JSON array of SOW phases, each with id, title, description, price, selected (presentation only)" }, { key: "selectedPhaseIds", label: "Array of selected phase IDs (presentation only)" }, { key: "totalPrice", label: "Total price as decimal string (presentation only)" }, { key: "paymentPlan", label: "Payment plan: full or phased (presentation only)", enumValues: ["full", "phased"] }, { key: "signedAt", label: "ISO timestamp when presentation was signed, or null (presentation only)" }, { key: "createdAt", label: "ISO timestamp when record was created (presentation only)" }, { key: "email", label: "Email (lead/client only)" }, { key: "name", label: "Name (lead/client only)" }, { key: "status", label: "Status field (all types)", enumValues: ["draft", "approved", "delivered", "archived", "generating", "failed"] }, { key: "stripeInvoiceId", label: "Stripe invoice ID (stripe_invoice only)" }, { key: "dueDate", label: "Invoice due date ISO string (stripe_invoice only)" }, { key: "amountDue", label: "Amount due in cents (stripe_invoice only)" }, { key: "customerId", label: "Customer ID (stripe_invoice/insights_document)" }, { key: "documentId", label: "Insights document DB ID (insights_document only)" }, { key: "title", label: "Document title (insights_document only)" }, { key: "category", label: "Document category — report or consulting (insights_document only)", enumValues: ["report", "consulting"] }, { key: "docType", label: "Document type e.g. full_readiness_report (insights_document only)", enumValues: ["executive_summary","full_readiness_report","security_posture_report","governance_maturity_report","data_exposure_risk_report","license_optimization_report","consolidated_sow","sow","task_execution_guide","remediation_plan","deployment_plan","governance_framework","security_hardening_plan","copilot_enablement_plan","identity_modernization_plan","copilot_readiness"] }, { key: "htmlContent", label: "Full HTML body of the document (insights_document only)" }, { key: "pdfUrl", label: "PDF download URL if generated (insights_document only)" }, { key: "sowPricingLines", label: "SOW pricing lines array (insights_document only)" }, { key: "sowTotalPrice", label: "SOW total price as decimal string (insights_document only)" }, { key: "approvedAt", label: "ISO timestamp when document was approved (insights_document only)" }, { key: "deliveredAt", label: "ISO timestamp when document was delivered (insights_document only)" }, { key: "projectId", label: "Linked project ID (insights_document only)" }],
  compose: [{ key: "value", label: "Composed value — string, or parsed JSON object/array when 'Parse as JSON' is enabled" }],
  // Control Flow — Parallel
  parallel: [
    { key: "branch_1", label: "Branch 1 output (awaited)" },
    { key: "branch_2", label: "Branch 2 output (awaited)" },
    { key: "branch_3", label: "Branch 3 output (awaited)" },
    { key: "branch_4", label: "Branch 4 output (awaited)" },
  ],
  join: [{ key: "joined", label: "true — all awaited branches completed" }],
  // Content (image)
  generate_image: [{ key: "imageUrl", label: "Permanent URL of the saved image (e.g. /api/uploads/generated-images/<uuid>.png)" }, { key: "revisedPrompt", label: "Final prompt sent to the AI (may include style suffix)" }],
  // AI
  ask_ai: [{ key: "aiResponse", label: "AI-generated text response" }, { key: "model", label: "Model used (e.g. claude-haiku-4-5)" }],
  // News
  fetch_news_headlines: [
    { key: "newsHeadlines",       label: "Array of fetched stories (title, source, url, publishedAt, description)" },
    { key: "newsTopic",           label: "Short phrase for the hottest story" },
    { key: "newsContext",         label: "2–3 sentence explanation of why it matters to M365 clients" },
    { key: "newsArticleSuggestion", label: "One-paragraph blog lead-in" },
    { key: "hotScore",            label: "Relevance score 0–100" },
    { key: "isHot",               label: "true when hotScore exceeds the threshold" },
    { key: "targetSector",        label: "Market sector (Government, Healthcare, etc.)", enumValues: ["Government", "Healthcare", "Finance", "Education", "Technology", "Legal", "Non-Profit"] },
    { key: "campaignBrief",       label: "Marketing brief (audience, hook, 3 angles) — only when isHot is true" },
    { key: "campaignId",          label: "DB ID of auto-created campaign draft — only when Auto-build campaign is on and isHot" },
  ],
  // Scripts
  generate_script: [{ key: "scriptId", label: "Script ID — single script saved to the library" }, { key: "packageId", label: "Package ID — multi-module package saved to the library" }],
  check_script_output: [{ key: "passed", label: "true if AI judged the output as passing" }, { key: "outcome", label: "One-sentence AI explanation of the verdict" }],
  // Social Media
  post_linkedin: [{ key: "linkedinPostId", label: "LinkedIn UGC post ID" }, { key: "linkedinPostUrl", label: "Direct URL to the LinkedIn post" }],
  post_twitter:  [{ key: "twitterTweetId", label: "Twitter/X tweet ID" }, { key: "twitterTweetUrl", label: "Direct URL to the tweet" }],
  post_facebook: [{ key: "facebookPostId", label: "Facebook page_id_post_id composite" }, { key: "facebookPostUrl", label: "Direct URL to the Facebook post" }],
  // Play Sound
  play_sound: [
    { key: "soundPlayed",  label: "true if sound was dispatched (Browser SSE or Desktop push)" },
    { key: "soundTarget",  label: "Target that received the sound: browser or desktop", enumValues: ["browser", "desktop"] },
    { key: "soundSkipped", label: "true if the play condition was not met and the sound was skipped" },
  ],
  // Send Browser Notification
  send_browser_notification: [{ key: "notificationSent", label: "true if push notification was dispatched" }],
  // Send Mobile Push
  send_mobile_push: [{ key: "sent", label: "true if push was dispatched to at least one device" }, { key: "sentCount", label: "Number of device tokens reached" }],
  // Create In-App Notification
  create_notification: [{ key: "notificationCount", label: "Number of admin users who received the in-app notification" }],
  // Report Progress — passes payload through unchanged
  report_progress: [],
  // Approval Gate — outputs injected into payload after the gate is approved and execution resumes
  approval_gate: [
    { key: "approved",     label: "true — always set when execution continues past the gate" },
    { key: "decisionNote", label: "Optional note left by the approving admin" },
    { key: "approvalId",   label: "ID of the pending_approvals record" },
  ],
  // Calendar (Exchange via Microsoft Graph)
  check_exchange_calendar_availability: [
    { key: "isBusy",         label: "true if any busy slots found in window" },
    { key: "availableSlots", label: "Array of free time ranges (ISO strings)" },
    { key: "busySlots",      label: "Array of busy time ranges (ISO strings)" },
  ],
  create_exchange_calendar_event: [
    { key: "eventId",      label: "Graph event ID" },
    { key: "eventUrl",     label: "Deep-link URL to the Outlook event" },
    { key: "eventWebLink", label: "Outlook web link to the event" },
  ],
  // SharePoint (Microsoft Graph drive)
  save_to_sharepoint: [
    { key: "sharePointItemId",     label: "SharePoint item ID" },
    { key: "sharePointWebUrl",     label: "URL to the file in SharePoint" },
    { key: "sharePointDownloadUrl", label: "Temporary direct download URL" },
  ],
  get_from_sharepoint: [
    { key: "fileContentBase64", label: "File contents as base64-encoded string" },
    { key: "fileName",          label: "File name from SharePoint metadata" },
    { key: "mimeType",          label: "MIME type of the retrieved file" },
    { key: "sharePointWebUrl",  label: "URL to the file in SharePoint" },
  ],
  // PDF generation
  generate_pdf: [
    { key: "pdfBase64",  label: "PDF file content as base64 string" },
    { key: "pdfDataUri", label: "data: URI suitable for embedding / emailing" },
    { key: "fileName",   label: "Output file name" },
  ],
  // Client Proposal Presentation
  build_presentation: [
    { key: "presentationHtml", label: "Full HTML of the proposal page" },
    { key: "presentationUrl",  label: "Public URL to view the proposal" },
    { key: "presentationId",   label: "Database ID of the saved presentation" },
  ],
  // Stripe nodes
  generate_invoice_stripe_payment: [
    { key: "invoiceId",      label: "Stripe invoice ID" },
    { key: "invoiceUrl",     label: "Hosted invoice URL (share with client)" },
    { key: "invoicePdfUrl",  label: "Direct PDF download URL" },
    { key: "amountDue",      label: "Total amount due in smallest currency unit" },
    { key: "currency",       label: "Invoice currency code (e.g. usd)" },
  ],
  generate_stripe_payment_link: [
    { key: "paymentLinkId",  label: "Stripe payment link ID" },
    { key: "paymentLinkUrl", label: "Shareable payment link URL" },
  ],
  create_phased_invoices: [
    { key: "invoiceIds",      label: "Array of created Stripe draft invoice IDs" },
    { key: "phaseCount",      label: "Number of phase invoices created" },
    { key: "totalScheduled",  label: "Total amount scheduled across all phases (cents)" },
  ],
  generate_phased_invoice: [
    { key: "invoiceId",   label: "Stripe draft invoice ID for this phase" },
    { key: "customerId",  label: "Stripe customer ID" },
    { key: "amountCents", label: "Invoice amount in cents" },
    { key: "phaseTitle",  label: "Phase title used on the invoice line item" },
  ],
  charge_stripe_invoice: [
    { key: "chargeStatus",            label: "Charge outcome", enumValues: ["succeeded", "failed"] },
    { key: "amountCharged",           label: "Amount charged in smallest currency unit (e.g. cents)" },
    { key: "stripePaymentIntentId",   label: "Stripe PaymentIntent ID (null if charge failed)" },
  ],
  edit_stripe_invoice: [
    { key: "invoiceId",  label: "Stripe invoice ID" },
    { key: "status",     label: "Invoice status after update (should be draft)" },
    { key: "dueDate",    label: "Updated due date as ISO string (or null if not set)" },
  ],
  // Variables
  set_variable:    [{ key: "value", label: "Variable value (coerced to declared type)" }],
  update_variable: [{ key: "value", label: "Updated variable value" }],
  // Ask for Input — outputs are dynamic: each configured variableName becomes a payload key
  ask_for_input: [],
  // Switch/Case — no declared outputs; downstream nodes inherit the upstream payload unchanged
  // (switchValue and chosenBranch are still injected into nextPayload by the executor)
  switch_case: [],
  // ForEach — outputs available inside the loop body (via item handle)
  foreach: [
    { key: "item",             label: "Current array element (or configured alias)" },
    { key: "itemIndex",        label: "0-based index of the current element" },
    { key: "itemsTotal",       label: "Total number of elements in the array" },
    { key: "collectedResults", label: "Array of last payload from each iteration (available on done handle)" },
  ],
  // Retry — outputs available inside the exhausted subgraph
  retry: [
    { key: "_retry.<id>.count",     label: "Number of attempts made (equals maxAttempts when exhausted)" },
    { key: "_retry.<id>.lastError", label: "Error message from the last failed attempt" },
  ],
};

// ── Comment (sticky-note) node — extracted as its own component so hooks are
//    always called unconditionally (Rules of Hooks compliance).
function CommentNode({ data, selected, id }: NodeProps) {
  const text = ((data.params as Record<string, unknown> | undefined)?.text as string | undefined) || "";
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { updateNodeData: rfUpdateNodeData } = useReactFlow();

  function commitEdit(value: string) {
    setIsEditing(false);
    const trimmed = value.trimEnd();
    setDraft(trimmed);
    rfUpdateNodeData(id, {
      ...data,
      params: { ...((data.params as Record<string, unknown> | undefined) ?? {}), text: trimmed },
    });
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(text);
    setIsEditing(true);
    requestAnimationFrame(() => textareaRef.current?.select());
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      style={{
        background: "#FEF3C7",
        border: `2px solid ${isEditing ? "#0078D4" : selected ? "#0078D4" : "#CA8A04"}`,
        borderRadius: 10,
        padding: "10px 14px 12px",
        minWidth: 220,
        maxWidth: 300,
        cursor: isEditing ? "text" : "default",
        boxShadow: isEditing
          ? "0 0 0 3px #0078D440, 0 4px 14px rgba(0,120,212,0.25)"
          : selected
          ? "0 0 0 3px #0078D440, 0 4px 14px rgba(202,138,4,0.3)"
          : "0 4px 12px rgba(202,138,4,0.22), 2px 3px 0 #CA8A04",
      }}
    >
      <div className="flex items-center gap-1.5 mb-2.5">
        <span style={{ fontSize: 13, lineHeight: 1 }}>📝</span>
        <span
          className="text-[9px] uppercase tracking-widest font-bold"
          style={{ color: "#92400E" }}
        >
          Note
        </span>
        {!isEditing && (
          <span
            style={{ color: "#A16207", fontSize: 9, marginLeft: "auto", fontStyle: "italic" }}
            title="Double-click to edit"
          >
            double-click to edit
          </span>
        )}
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="nopan nodrag"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => commitEdit(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") {
              e.preventDefault();
              commitEdit(draft);
            }
          }}
          autoFocus
          rows={4}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.6)",
            border: "1px solid #CA8A04",
            borderRadius: 6,
            padding: "4px 6px",
            fontSize: 12,
            lineHeight: "1.55",
            color: "#1C1917",
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <p
          style={{
            color: text ? "#1C1917" : "#A16207",
            fontSize: 12,
            lineHeight: "1.55",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontStyle: text ? "normal" : "italic",
          }}
        >
          {text || "Add a note…"}
        </p>
      )}
    </div>
  );
}

// ── Custom node component ─────────────────────────────────────────────────────

function WfNode(props: NodeProps) {
  const { data, selected, id } = props;
  const nodeType = (data.nodeType as string) ?? "action";
  const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;
  const label = (data.label as string) || style.label;

  // ── Comment node — delegate to dedicated component ──────────────────────────
  if (nodeType === "comment") {
    return <CommentNode {...props} />;
  }

  return (
    <div
      style={{
        background: style.bg,
        border: `2px solid ${selected ? "#0078D4" : style.border}`,
        borderRadius: 10,
        padding: "10px 16px",
        minWidth: 140,
        maxWidth: 200,
        boxShadow: selected ? `0 0 0 2px #0078D440` : "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: style.border, border: "none" }} />

      <div className="flex items-center gap-2">
        <span style={{ fontSize: 16 }}>{style.icon}</span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: style.border }}>
            {nodeType}
          </div>
          <div className="text-xs font-medium text-[#E6EDF3] truncate leading-snug">{label}</div>
          {(data.description as string | undefined) && (
            <div className="text-[10px] text-[#7D8590] truncate mt-0.5">{data.description as string}</div>
          )}
        </div>
      </div>

      {nodeType === "condition" ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{ left: "20%", background: "#22C55E", border: "none" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: "50%", background: "#EF4444", border: "none" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="cancel"
            style={{ left: "80%", background: "#F97316", border: "none" }}
          />
          <div className="flex justify-between text-[9px] font-semibold mt-1 px-1">
            <span className="text-emerald-400">True</span>
            <span className="text-red-400">False</span>
            <span className="text-orange-400">Cancel</span>
          </div>
        </>
      ) : nodeType === "foreach" ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="item"
            style={{ left: "30%", background: "#A855F7", border: "none" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="done"
            style={{ left: "70%", background: "#22C55E", border: "none" }}
          />
          <div className="flex justify-between text-[9px] font-semibold mt-1 px-4">
            <span style={{ color: "#A855F7" }}>Loop</span>
            <span className="text-emerald-400">Done</span>
          </div>
        </>
      ) : nodeType === "retry" ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="exhausted"
            style={{ left: "30%", background: "#EF4444", border: "none" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="done"
            style={{ left: "70%", background: "#22C55E", border: "none" }}
          />
          <div className="flex justify-between text-[9px] font-semibold mt-1 px-4">
            <span className="text-red-400">Exhausted</span>
            <span className="text-emerald-400">Done</span>
          </div>
        </>
      ) : nodeType === "approval_gate" ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            style={{ background: "#22C55E", border: "none" }}
          />
          <div className="flex justify-center text-[9px] font-semibold mt-1">
            <span className="text-emerald-400">Continue on Approve</span>
          </div>
        </>
      ) : nodeType === "switch_case" ? (
        (() => {
          const cases = (data.cases as Array<{ id: string; matchValue: string; label: string }> | undefined) ?? [];
          const total = cases.length + 1; // +1 for default
          const pct = (i: number) => `${((i + 1) / (total + 1)) * 100}%`;
          return (
            <>
              {cases.map((c, i) => (
                <Handle
                  key={c.id}
                  type="source"
                  position={Position.Bottom}
                  id={c.id}
                  style={{ left: pct(i), background: "#FB923C", border: "none" }}
                />
              ))}
              <Handle
                type="source"
                position={Position.Bottom}
                id="default"
                style={{ left: pct(cases.length), background: "#6B7280", border: "none" }}
              />
              {total <= 6 && (
                <div className="flex mt-1 px-0.5" style={{ gap: 0 }}>
                  {cases.map(c => (
                    <span key={c.id} className="text-[8px] font-semibold text-orange-400 flex-1 text-center truncate">
                      {c.label || c.matchValue || "…"}
                    </span>
                  ))}
                  <span className="text-[8px] font-semibold text-gray-400 flex-1 text-center">Default</span>
                </div>
              )}
            </>
          );
        })()
      ) : nodeType === "fetch_news_headlines" ? (
        <>
          {data.autoBuildCampaign ? (
            <>
              <Handle
                type="source"
                position={Position.Bottom}
                id="hot"
                style={{ left: "30%", background: "#06B6D4", border: "none" }}
              />
              <Handle
                type="source"
                position={Position.Bottom}
                style={{ left: "70%", background: style.border, border: "none" }}
              />
              <div className="flex justify-between text-[9px] font-semibold mt-1 px-6">
                <span style={{ color: "#06B6D4" }}>🔥 Campaign</span>
                <span style={{ color: style.border }}>After</span>
              </div>
            </>
          ) : (
            <div className="text-[9px] text-center text-[#484F58] mt-1 italic">Terminal — no campaign</div>
          )}
        </>
      ) : (
        <>
          <Handle type="source" position={Position.Bottom} style={{ background: style.border, border: "none" }} />
          {nodeType === "error" && (
            <>
              <Handle type="target" position={Position.Left}  style={{ background: style.border, border: "none" }} />
              <Handle type="source" position={Position.Right} style={{ background: style.border, border: "none" }} />
            </>
          )}
          {!["start", "end", "error"].includes(nodeType) && (
            <>
              <Handle
                type="source"
                position={Position.Right}
                id="error"
                style={{ background: "#EF4444", border: "none" }}
              />
              <div
                style={{
                  position: "absolute",
                  right: -28,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 8,
                  color: "#EF4444",
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                err
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// nodeTypes only needed by RunDetailContent (ReactFlow replay tab); canvas now uses FlowCanvas

// ── Node library ──────────────────────────────────────────────────────────────

const LIBRARY_CATEGORIES: Array<{ name: string; nodes: Array<{ type: string; label: string; description: string; tags: string[] }> }> = [
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
    ],
  },
  {
    name: "CRM",
    nodes: [
      { type: "score_lead",            label: "Score Lead",           description: "Score a lead 0–100 and write qualification record",  tags: ["crm", "lead", "score", "qualify"] },
      { type: "assign_pipeline_stage", label: "Assign Stage",         description: "Move opportunity to a named pipeline stage",         tags: ["crm", "pipeline", "stage", "opportunity"] },
      { type: "create_opportunity",    label: "Create Opportunity",   description: "Convert a lead into a CRM opportunity",              tags: ["crm", "opportunity", "lead", "convert"] },
    ],
  },
  {
    name: "Diagnostics",
    nodes: [
      { type: "parse_quiz_results",       label: "Parse Quiz Results",    description: "Read latest quiz lead record and extract scores",   tags: ["quiz", "diagnostic", "parse", "score"] },
      { type: "generate_readiness_score", label: "Readiness Score",       description: "Compute composite M365 readiness score from history", tags: ["quiz", "diagnostic", "score", "readiness"] },
      { type: "attach_quiz_insights",     label: "Attach Insights",       description: "Save quiz insights as a client document",           tags: ["quiz", "diagnostic", "insights", "document"] },
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
      { type: "create_lead",            label: "Create Lead",            description: "Create a new lead record in the CRM",             tags: ["crm", "lead", "create", "contact"] },
      { type: "convert_to_opportunity", label: "Convert to Opportunity", description: "Convert a lead into a CRM opportunity",            tags: ["crm", "opportunity", "lead", "convert"] },
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
    ],
  },
  {
    name: "Azure",
    nodes: [
      { type: "execute_runbook",     label: "Execute Runbook",      description: "Trigger an Azure Automation runbook",                tags: ["azure", "runbook", "automation", "m365"] },
      { type: "update_m365_profile", label: "Update M365 Profile",  description: "Update a client's M365 profile via Azure Automation", tags: ["azure", "m365", "profile", "runbook"] },
      { type: "generate_document",   label: "Generate Document",    description: "Create a document record for a client",              tags: ["document", "client", "report", "generate"] },
      { type: "calculate_pricing",   label: "Calculate Pricing",    description: "Parse SOW HTML and write sowPricingLines to the DB",  tags: ["document", "sow", "pricing", "calculate"] },
    ],
  },
  {
    name: "Control Flow",
    nodes: [
      { type: "foreach",         label: "For Each",        description: "Iterate over an array and run nodes for each element",         tags: ["loop", "iterate", "foreach", "array", "control"] },
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
    name: "Utilities",
    nodes: [
      { type: "comment", label: "Comment", description: "Annotate the canvas with a plain-text note — skipped entirely at runtime", tags: ["comment", "note", "annotation", "documentation", "utility"] },
    ],
  },
];

const ALL_LIBRARY_NODES = LIBRARY_CATEGORIES.flatMap(c => c.nodes);

// ── Library node item ─────────────────────────────────────────────────────────

function LibraryNodeItem({
  n, s, isFav, onAdd, onToggleFav, isArchived,
}: {
  n: { type: string; label: string; description: string; tags: string[] };
  s: { bg: string; border: string; icon: string; label: string };
  isFav: boolean;
  onAdd: () => void;
  onToggleFav: (e: React.MouseEvent) => void;
  isArchived: boolean;
}) {
  return (
    <div
      draggable={!isArchived}
      onDragStart={e => {
        if (isArchived) { e.preventDefault(); return; }
        e.dataTransfer.setData("application/workflow-node-type", n.type);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => { if (!isArchived) onAdd(); }}
      className={`w-full flex items-start gap-2 p-2 rounded-lg border transition-colors group ${isArchived ? "opacity-40 cursor-not-allowed border-transparent" : "hover:bg-[#1C2128] border-transparent hover:border-[#30363D] cursor-grab active:cursor-grabbing"}`}
    >
      <span style={{ color: s.border, fontSize: 13, lineHeight: 1, marginTop: 2 }}>{s.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#E6EDF3] leading-tight">{n.label}</p>
        <p className="text-[9px] text-[#484F58] leading-tight mt-0.5 truncate">{n.description}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {n.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[8px] bg-[#1C2128] border border-[#30363D] text-[#484F58] px-1 rounded">{tag}</span>
          ))}
        </div>
      </div>
      {!isArchived && (
        <button
          onClick={onToggleFav}
          className={`flex-shrink-0 text-[10px] mt-0.5 transition-colors ${isFav ? "text-amber-400" : "text-[#30363D] group-hover:text-[#484F58]"}`}
          title={isFav ? "Remove from favourites" : "Add to favourites"}
        >
          {isFav ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}

// ── Start-node trigger manager ────────────────────────────────────────────────

interface WfTrigger {
  id: number;
  type: "manual" | "schedule" | "webhook" | "event";
  config: Record<string, unknown>;
  webhookToken: string | null;
  nextRunAt: string | null;
  enabled: boolean;
}

const TRIGGER_ICONS: Record<string, string> = {
  manual: "🖱", schedule: "📅", webhook: "🔗", event: "📡",
};

function StartNodeTriggers({ defId }: { defId: number }) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<"manual" | "schedule" | "webhook" | "event">("schedule");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [eventName, setEventName] = useState("");
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const { data: triggers = [], isLoading } = useQuery<WfTrigger[]>({
    queryKey: ["wf-triggers", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`);
      return res.json();
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      let config: Record<string, unknown> = {};
      if (newType === "schedule") config = { cron: cronExpr.trim() };
      else if (newType === "event") config = { eventName: eventName.trim() };
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: newType, config }),
      });
      if (!res.ok) throw new Error("Failed to create trigger");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-triggers", defId] });
      setShowAdd(false);
      setEventName("");
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update trigger");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-triggers", defId] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete trigger");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-triggers", defId] });
      setConfirmDel(null);
    },
  });

  const webhookBase = `${window.location.origin}/api/webhooks/workflow`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#7D8590]">Triggers</span>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="text-[10px] font-medium text-[#0078D4] hover:text-[#2E9EFF] transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3 space-y-2.5">
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as typeof newType)}
            className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
          >
            <option value="manual">🖱 Manual (API / Run Now)</option>
            <option value="schedule">📅 Schedule (cron)</option>
            <option value="webhook">🔗 Webhook (HTTP POST)</option>
            <option value="event">📡 Event (backend emit)</option>
          </select>

          {newType === "schedule" && (
            <input
              value={cronExpr}
              onChange={e => setCronExpr(e.target.value)}
              placeholder="Cron expression, e.g. 0 9 * * 1"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
            />
          )}
          {newType === "event" && (
            <div className="space-y-1.5">
              <select
                value={KNOWN_EVENTS.some(ev => ev.name === eventName) ? eventName : "__custom__"}
                onChange={e => { if (e.target.value === "__custom__") setEventName(""); else setEventName(e.target.value); }}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <option value="__custom__">✏️ Custom event name…</option>
                {Array.from(new Set(KNOWN_EVENTS.map(ev => ev.category))).map(cat => (
                  <optgroup key={cat} label={cat}>
                    {KNOWN_EVENTS.filter(ev => ev.category === cat).map(ev => (
                      <option key={ev.name} value={ev.name}>{ev.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {KNOWN_EVENTS.some(ev => ev.name === eventName) ? (
                <p className="text-[10px] text-[#7D8590] leading-relaxed px-0.5">{KNOWN_EVENTS.find(ev => ev.name === eventName)?.description}</p>
              ) : (
                <input
                  value={eventName}
                  onChange={e => setEventName(e.target.value)}
                  placeholder="e.g. my.custom.event"
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                />
              )}
            </div>
          )}
          {newType === "webhook" && (
            <p className="text-[10px] text-[#7D8590]">A unique webhook URL will be generated automatically.</p>
          )}

          {addMut.isError && (
            <p className="text-[10px] text-[#EF4444]">{(addMut.error as Error).message}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending || (newType === "event" && !eventName.trim())}
              className="flex-1 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-40 text-white text-[11px] font-medium py-1.5 rounded-lg transition-colors"
            >
              {addMut.isPending ? "Adding…" : "Add Trigger"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 text-[11px] text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Trigger list */}
      {isLoading ? (
        <p className="text-[10px] text-[#484F58] py-1">Loading…</p>
      ) : triggers.length === 0 ? (
        <p className="text-[10px] text-[#484F58] py-1">No triggers yet — add one above.</p>
      ) : (
        <div className="space-y-1.5">
          {triggers.map(t => (
            <div key={t.id} className="rounded-lg bg-[#0D1117] border border-[#30363D] px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm">{TRIGGER_ICONS[t.type] ?? "⚡"}</span>
                  <span className="text-[11px] font-medium text-[#E6EDF3] capitalize">{t.type}</span>
                  {typeof t.config.cron === "string" && (
                    <span className="text-[10px] font-mono text-[#7D8590] truncate">{t.config.cron}</span>
                  )}
                  {typeof t.config.eventName === "string" && (
                    <span className="text-[10px] font-mono text-[#7D8590] truncate">{t.config.eventName}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* enable toggle */}
                  <button
                    onClick={() => toggleMut.mutate({ id: t.id, enabled: !t.enabled })}
                    title={t.enabled ? "Disable" : "Enable"}
                    className={`w-7 h-4 rounded-full relative transition-colors ${t.enabled ? "bg-[#22C55E]/70" : "bg-[#30363D]"}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${t.enabled ? "left-3.5" : "left-0.5"}`} />
                  </button>
                  {/* delete */}
                  {confirmDel === t.id ? (
                    <button
                      onClick={() => deleteMut.mutate(t.id)}
                      className="text-[10px] text-[#EF4444] hover:text-red-300"
                    >
                      {deleteMut.isPending ? "…" : "Confirm"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDel(t.id)}
                      className="text-[#484F58] hover:text-[#EF4444] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              {t.type === "webhook" && t.webhookToken && (
                <p className="text-[10px] font-mono text-[#484F58] break-all">{webhookBase}/{t.webhookToken}</p>
              )}
              {t.nextRunAt && (
                <p className="text-[10px] text-[#484F58]">Next: {new Date(t.nextRunAt).toLocaleString()}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Start node: declared payload variables ────────────────────────────────────

interface StartPayloadField {
  id: string;
  key: string;
  label: string;
}

function StartNodePayloadFields({
  node,
  onChange,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
}) {
  const fields = ((node.data.payloadFields as StartPayloadField[] | undefined) ?? []);

  function update(next: StartPayloadField[]) {
    onChange(node.id, { ...node.data, payloadFields: next });
  }

  function addField() {
    update([...fields, { id: crypto.randomUUID(), key: "", label: "" }]);
  }

  function removeField(id: string) {
    update(fields.filter(f => f.id !== id));
  }

  const inputCls = "w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60";

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Payload Variables</label>
          <FieldHint text="Declare the variables this workflow receives at runtime (e.g. clientId, projectId). These appear in the {{token}} picker for every downstream node. For event triggers the fields are auto-detected; use this for manual, schedule, webhook, or chain-triggered runs where the fields aren't automatically known." />
        </div>
        <button
          onClick={addField}
          className="text-[10px] font-medium px-2 py-0.5 rounded bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/30 hover:bg-[#0078D4]/20 transition-colors"
        >
          + Add variable
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-[10px] text-[#484F58] text-center py-2 border border-dashed border-[#30363D] rounded-lg">
          {/* hint changes based on whether there's an event trigger */}
          Declare variables here to see them in the token picker below
        </p>
      ) : (
        <div className="space-y-1.5">
          {fields.map(f => (
            <div key={f.id} className="rounded-lg border border-[#30363D] bg-[#0D1117] p-2 space-y-1.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] font-bold text-[#0078D4] uppercase tracking-wider">Variable</span>
                <button
                  onClick={() => removeField(f.id)}
                  className="text-[#484F58] hover:text-red-400 transition-colors text-xs"
                  title="Remove"
                >✕</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-1">
                  <label className="text-[10px] text-[#7D8590]">Key <span className="text-[#484F58]">(no spaces)</span></label>
                  <input
                    type="text"
                    value={f.key}
                    onChange={e => update(fields.map(x => x.id === f.id ? { ...x, key: e.target.value.replace(/\s/g, "") } : x))}
                    placeholder="clientId"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#7D8590]">Description</label>
                  <input
                    type="text"
                    value={f.label}
                    onChange={e => update(fields.map(x => x.id === f.id ? { ...x, label: e.target.value } : x))}
                    placeholder="Client user ID"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ancestor output resolver + variable picker ───────────────────────────────
// Core logic lives in ./ancestorOutputs.ts (framework-free, unit-tested).
// This wrapper injects the app-level KNOWN_EVENTS and NODE_OUTPUTS registries.

function getAncestorOutputs(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
  eventTriggers: WfTrigger[] = [],
): AncestorGroup[] {
  return _getAncestorOutputs(nodeId, nodes, edges, eventTriggers, KNOWN_EVENTS, NODE_OUTPUTS);
}

// ── Field hint tooltip ────────────────────────────────────────────────────────

function FieldHint({ text }: { text: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      className="inline-flex items-center flex-shrink-0 cursor-help"
      onMouseEnter={() => { if (ref.current) setRect(ref.current.getBoundingClientRect()); }}
      onMouseLeave={() => setRect(null)}
    >
      <svg className="w-3 h-3 text-[#484F58] hover:text-[#7D8590] transition-colors" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
      {rect && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: rect.left + rect.width / 2, top: rect.top - 8, transform: "translate(-50%, -100%)" }}
        >
          <div className="relative w-52 bg-[#1C2128] border border-[#444C56] rounded-lg px-2.5 py-2 shadow-xl">
            <p className="text-[11px] text-[#CDD9E5] leading-snug">{text}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-[#444C56]" />
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

// ── Payload field (label + variable picker + input/textarea) ──────────────────

function PayloadField({
  label, value, onChange, placeholder, multiline, ancestorOutputs, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  ancestorOutputs: AncestorGroup[];
  hint?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerPos, setPickerPos] = useState<{ top: number; right: number } | null>(null);
  const [suggest, setSuggest] = useState<{ openAt: number; filter: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  // Flat list of all tokens across ancestor groups
  const allTokens = ancestorOutputs.flatMap(group =>
    group.outputs.map(o => ({
      tokenPath: group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`,
      label: o.label,
      groupName: group.nodeName,
    }))
  );

  const filteredTokens = suggest
    ? allTokens.filter(t => t.tokenPath.toLowerCase().includes(suggest.filter.toLowerCase()))
    : [];

  function insertToken(key: string) {
    const token = `{{${key}}}`;
    const el = inputRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + token + value.slice(end));
      setTimeout(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); }, 0);
    } else {
      onChange(value ? `${value} ${token}` : token);
    }
    setPickerOpen(false);
  }

  function pickSuggestion(tokenPath: string) {
    if (!suggest) return;
    const el = inputRef.current;
    const cursorPos = el ? (el.selectionStart ?? value.length) : value.length;
    const replacement = `{{${tokenPath}}}`;
    const newVal = value.slice(0, suggest.openAt) + replacement + value.slice(cursorPos);
    onChange(newVal);
    const pos = suggest.openAt + replacement.length;
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 0);
    setSuggest(null);
    setActiveIdx(0);
  }

  function handleChange(newVal: string, cursorPos: number) {
    onChange(newVal);
    const before = newVal.slice(0, cursorPos);
    // Match an open {{ that hasn't been closed yet
    const match = before.match(/\{\{([^{}]*)$/);
    if (match) {
      setSuggest({ openAt: cursorPos - match[0].length, filter: match[1] });
      setActiveIdx(0);
    } else {
      setSuggest(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!suggest || filteredTokens.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % filteredTokens.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => (i - 1 + filteredTokens.length) % filteredTokens.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickSuggestion(filteredTokens[activeIdx].tokenPath);
    } else if (e.key === "Escape") {
      setSuggest(null);
    }
  }

  const hasVars = ancestorOutputs.some(g => g.outputs.length > 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between min-h-[18px]">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">{label}</label>
          {hint && <FieldHint text={hint} />}
        </div>
        {hasVars && (
          <div className="relative">
            <button
              ref={pickerBtnRef}
              type="button"
              onClick={() => {
                if (pickerBtnRef.current) {
                  const r = pickerBtnRef.current.getBoundingClientRect();
                  setPickerPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                }
                setPickerOpen(v => !v);
                setPickerSearch("");
              }}
              className="text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              variables
            </button>
            {pickerOpen && pickerPos && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setPickerOpen(false); setPickerSearch(""); }} />
                <div
                  className="fixed z-50 w-64 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden"
                  style={{ top: pickerPos.top, right: pickerPos.right }}
                >
                  <div className="px-2 pt-2 pb-1">
                    <input
                      autoFocus
                      type="text"
                      value={pickerSearch}
                      onChange={e => setPickerSearch(e.target.value)}
                      placeholder="Search variables…"
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    {(() => {
                      const q = pickerSearch.trim().toLowerCase();
                      const filteredGroups = ancestorOutputs.map(group => ({
                        ...group,
                        outputs: q
                          ? group.outputs.filter(o =>
                              o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
                            )
                          : group.outputs,
                      })).filter(g => g.outputs.length > 0);
                      if (filteredGroups.length === 0) {
                        return <p className="px-3 py-2 text-[10px] text-[#484F58]">No variables match.</p>;
                      }
                      return filteredGroups.map(group => (
                        <div key={group.nodeId}>
                          <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{group.nodeName}</p>
                          {group.outputs.map(o => {
                            const tokenPath = group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`;
                            return (
                              <button key={o.key} type="button" onClick={() => insertToken(tokenPath)}
                                className="w-full text-left px-3 py-1.5 hover:bg-[#0D1117] flex items-start justify-between gap-3">
                                <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0">{`{{${tokenPath}}}`}</span>
                                <span className="text-[10px] text-[#484F58] text-right leading-tight">{o.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Input / textarea with inline autocomplete dropdown */}
      <div className="relative">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none font-mono"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            placeholder={placeholder}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
          />
        )}
        {suggest && filteredTokens.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredTokens.map((t, i) => (
                <button
                  key={t.tokenPath}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); pickSuggestion(t.tokenPath); }}
                  className={`w-full text-left px-3 py-1.5 flex items-start justify-between gap-3 ${i === activeIdx ? "bg-[#0078D4]/20" : "hover:bg-[#0D1117]"}`}
                >
                  <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0">{`{{${t.tokenPath}}}`}</span>
                  <span className="text-[10px] text-[#484F58] text-right leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="px-3 py-1 border-t border-[#30363D] flex items-center gap-2">
              <span className="text-[9px] text-[#484F58]">↑↓ navigate</span>
              <span className="text-[9px] text-[#484F58]">↵ / Tab insert</span>
              <span className="text-[9px] text-[#484F58]">Esc dismiss</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Expression utilities ──────────────────────────────────────────────────────
// Client-side port of the server's evalCondition() — no eval/new Function.
// Returns { status, resolvedValue, error } so we can show the badge.

type ExprValidation =
  | { status: "empty" }
  | { status: "valid"; resolvedValue: unknown }
  | { status: "invalid"; reason: string };

function buildMockPayload(ancestorOutputs: AncestorGroup[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const steps: Record<string, Record<string, unknown>> = {};

  for (const group of ancestorOutputs) {
    for (const output of group.outputs) {
      // Use enumValues[0] when available so comparisons like {{tier}} == 'Beginner' resolve
      const mockVal: unknown = output.enumValues?.length ? output.enumValues[0] : (() => {
        const k = output.key.toLowerCase();
        if (k === "ok" || k.startsWith("is") || k.startsWith("has") || k.endsWith("valid") || k === "sent" || k === "found") return true;
        if (k.endsWith("count") || k.endsWith("score") || k === "amount" || k === "totalprice" || k === "totalduration") return 42;
        if (k.endsWith("id") || k === "id") return 1;
        if (k.endsWith("at") || k.endsWith("date")) return "2025-01-01T00:00:00Z";
        if (k === "status" || k === "stage") return "active";
        return `mock_${output.key}`;
      })();

      if (group.isStartNode) {
        payload[output.key] = mockVal;
      } else {
        if (!steps[group.nodeId]) steps[group.nodeId] = {};
        steps[group.nodeId]![output.key] = mockVal;
      }
    }
  }

  if (Object.keys(steps).length > 0) payload.steps = steps;
  return payload;
}

function evalExpressionClient(
  expression: string,
  mockPayload: Record<string, unknown>,
  type: "boolean" | "value",
): ExprValidation {
  if (!expression.trim()) return { status: "empty" };

  function stripTpl(s: string): string {
    const t = s.trim();
    return t.startsWith("{{") && t.endsWith("}}") ? t.slice(2, -2).trim() : t;
  }

  function resolvePath(p: string): unknown {
    const parts = stripTpl(p).split(".");
    let cur: unknown = mockPayload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  function parseValue(s: string): unknown {
    const t = s.trim();
    if (t.startsWith("{{") && t.endsWith("}}")) {
      const key = t.slice(2, -2).trim();
      const resolved = resolvePath(t);
      if (resolved === undefined) throw new Error(`Unknown variable: ${key}`);
      return resolved;
    }
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (t === "undefined") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return resolvePath(t);
  }

  function evalClause(clause: string): boolean {
    const c = clause.trim();
    if (!c) throw new Error("Empty clause — dangling && or || operator");
    for (const op of [">=", "<=", "!=", "==", ">", "<", " contains "]) {
      const idx = c.indexOf(op);
      if (idx !== -1) {
        const lhsRaw = c.slice(0, idx).trim();
        const rhsRaw = c.slice(idx + op.length).trim();
        if (!lhsRaw) throw new Error(`Missing left-hand side before "${op.trim()}"`);
        if (!rhsRaw) throw new Error(`Missing right-hand side after "${op.trim()}"`);
        // Validate LHS references a known variable if it's a template path
        if (lhsRaw.startsWith("{{") && lhsRaw.endsWith("}}")) {
          const key = lhsRaw.slice(2, -2).trim();
          const resolved = resolvePath(lhsRaw);
          if (resolved === undefined) {
            throw new Error(`Unknown variable: ${key}`);
          }
        }
        const lhs = resolvePath(lhsRaw);
        const rhs = parseValue(rhsRaw);
        switch (op.trim()) {
          case "==": return lhs == rhs; // eslint-disable-line eqeqeq
          case "!=": return lhs != rhs; // eslint-disable-line eqeqeq
          case ">":  return Number(lhs) > Number(rhs);
          case "<":  return Number(lhs) < Number(rhs);
          case ">=": return Number(lhs) >= Number(rhs);
          case "<=": return Number(lhs) <= Number(rhs);
          case "contains": return String(lhs).includes(String(rhs));
        }
      }
    }
    // Bare path — check it resolves
    if (c.startsWith("{{") && c.endsWith("}}")) {
      const key = c.slice(2, -2).trim();
      const v = resolvePath(c);
      if (v === undefined) throw new Error(`Unknown variable: ${key}`);
      return Boolean(v);
    }
    return Boolean(resolvePath(c));
  }

  try {
    // Early structural checks that apply to all expression types
    if (/\{\{[^}]*$/.test(expression)) throw new Error("Unclosed {{ — missing closing }}");
    if (type === "value") {
      // For value expressions, check all template references are known, then resolve
      for (const match of expression.matchAll(/\{\{([\w.\-]+)\}\}/g)) {
        const key = match[1]!;
        if (resolvePath(`{{${key}}}`) === undefined) {
          throw new Error(`Unknown variable: ${key}`);
        }
      }
      const resolved = parseValue(expression.trim());
      return { status: "valid", resolvedValue: resolved };
    }
    // Boolean expression — validate no dangling operators
    const trimmed = expression.trim();
    if (/^\s*(&&|\|\|)/.test(trimmed)) throw new Error("Expression cannot start with && or ||");
    if (/(&&|\|\|)\s*$/.test(trimmed)) throw new Error("Expression cannot end with && or ||");
    const orParts = trimmed.split(" || ");
    let result = false;
    for (const orPart of orParts) {
      if (!orPart.trim()) throw new Error("Empty clause — dangling || operator");
      const andParts = orPart.split(" && ");
      for (const andPart of andParts) {
        if (!andPart.trim()) throw new Error("Empty clause — dangling && operator");
      }
      if (andParts.every(p => evalClause(p))) { result = true; break; }
    }
    return { status: "valid", resolvedValue: result };
  } catch (e) {
    return { status: "invalid", reason: (e as Error).message ?? "Invalid expression" };
  }
}

// ── ExpressionField ───────────────────────────────────────────────────────────
// Like PayloadField but adds a live validator badge and an AI helper popover.

function ExpressionField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  ancestorOutputs,
  hint,
  expressionType = "boolean",
  fetchWithAuth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  ancestorOutputs: AncestorGroup[];
  hint?: string;
  expressionType?: "boolean" | "value";
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  // ── Variable picker state (mirrors PayloadField) ──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerPos, setPickerPos] = useState<{ top: number; right: number } | null>(null);
  const [suggest, setSuggest] = useState<{ openAt: number; filter: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  // ── Validator state ──
  const [validation, setValidation] = useState<ExprValidation>({ status: "empty" });
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);

  // ── AI helper state ──
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const allTokens = ancestorOutputs.flatMap(group =>
    group.outputs.map(o => ({
      tokenPath: group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`,
      label: o.label,
      groupName: group.nodeName,
    }))
  );

  const filteredTokens = suggest
    ? allTokens.filter(t => t.tokenPath.toLowerCase().includes(suggest.filter.toLowerCase()))
    : [];

  // Debounced validator
  useEffect(() => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      const mockPayload = buildMockPayload(ancestorOutputs);
      setValidation(evalExpressionClient(value, mockPayload, expressionType));
    }, 300);
    return () => { if (validationTimerRef.current) clearTimeout(validationTimerRef.current); };
  }, [value, ancestorOutputs, expressionType]);

  function insertToken(key: string) {
    const token = `{{${key}}}`;
    const el = inputRef.current;
    if (el) {
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + token + value.slice(end));
      setTimeout(() => { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); }, 0);
    } else {
      onChange(value ? `${value} ${token}` : token);
    }
    setPickerOpen(false);
  }

  function pickSuggestion(tokenPath: string) {
    if (!suggest) return;
    const el = inputRef.current;
    const cursorPos = el ? (el.selectionStart ?? value.length) : value.length;
    const replacement = `{{${tokenPath}}}`;
    const newVal = value.slice(0, suggest.openAt) + replacement + value.slice(cursorPos);
    onChange(newVal);
    const pos = suggest.openAt + replacement.length;
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 0);
    setSuggest(null);
    setActiveIdx(0);
  }

  function handleChange(newVal: string, cursorPos: number) {
    onChange(newVal);
    setAiHint(null); // Only clear hint on manual edits, not on AI-generated insertions
    const before = newVal.slice(0, cursorPos);
    const match = before.match(/\{\{([^{}]*)$/);
    if (match) {
      setSuggest({ openAt: cursorPos - match[0].length, filter: match[1] ?? "" });
      setActiveIdx(0);
    } else {
      setSuggest(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!suggest || filteredTokens.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => (i + 1) % filteredTokens.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => (i - 1 + filteredTokens.length) % filteredTokens.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSuggestion(filteredTokens[activeIdx]!.tokenPath); }
    else if (e.key === "Escape") setSuggest(null);
  }

  async function handleAiSubmit() {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetchWithAuth("/api/admin/workflows/expression-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userPrompt: aiPrompt.trim(),
          availableVariables: allTokens.map(t => ({ tokenPath: t.tokenPath, label: t.label })),
          expressionType,
        }),
      });
      const json = await res.json() as { ok?: boolean; expression?: string; explanation?: string; error?: string };
      if (!res.ok || !json.expression) {
        setAiError(json.error ?? "AI helper failed");
      } else {
        onChange(json.expression);
        setAiHint(json.explanation ?? null);
        setAiOpen(false);
        setAiPrompt("");
      }
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  const hasVars = ancestorOutputs.some(g => g.outputs.length > 0);

  const badgeEl = validation.status !== "empty" && (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] leading-tight ${
      validation.status === "valid" ? "bg-[#0f2a1a] text-emerald-400" : "bg-[#2a0f0f] text-red-400"
    }`}>
      <span>{validation.status === "valid" ? "✓" : "✗"}</span>
      <span className="font-mono">
        {validation.status === "valid"
          ? (() => {
              const v = validation.resolvedValue;
              if (v === null) return "null";
              if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
              return String(v).slice(0, 60);
            })()
          : validation.reason}
      </span>
    </div>
  );

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-center justify-between min-h-[18px]">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">{label}</label>
          {hint && <FieldHint text={hint} />}
        </div>
        <div className="flex items-center gap-2">
          {/* AI helper button */}
          <button
            type="button"
            onClick={() => { setAiOpen(v => !v); setAiError(null); }}
            className="text-[10px] text-[#A78BFA] hover:text-[#C4B5FD] transition-colors flex items-center gap-1"
            title="Help me write this expression"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.346A3.999 3.999 0 0114 18H10a3.999 3.999 0 01-2.829-1.172l-.346-.346z" />
            </svg>
            Help me write this
          </button>
          {/* Variable picker button */}
          {hasVars && (
            <div className="relative">
              <button
                ref={pickerBtnRef}
                type="button"
                onClick={() => {
                  if (pickerBtnRef.current) {
                    const r = pickerBtnRef.current.getBoundingClientRect();
                    setPickerPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                  }
                  setPickerOpen(v => !v);
                  setPickerSearch("");
                }}
                className="text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                variables
              </button>
              {pickerOpen && pickerPos && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setPickerOpen(false); setPickerSearch(""); }} />
                  <div
                    className="fixed z-50 w-64 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden"
                    style={{ top: pickerPos.top, right: pickerPos.right }}
                  >
                    <div className="px-2 pt-2 pb-1">
                      <input
                        autoFocus
                        type="text"
                        value={pickerSearch}
                        onChange={e => setPickerSearch(e.target.value)}
                        placeholder="Search variables…"
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto py-1">
                      {(() => {
                        const q = pickerSearch.trim().toLowerCase();
                        const filteredGroups = ancestorOutputs.map(group => ({
                          ...group,
                          outputs: q
                            ? group.outputs.filter(o => o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
                            : group.outputs,
                        })).filter(g => g.outputs.length > 0);
                        if (filteredGroups.length === 0) return <p className="px-3 py-2 text-[10px] text-[#484F58]">No variables match.</p>;
                        return filteredGroups.map(group => (
                          <div key={group.nodeId}>
                            <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{group.nodeName}</p>
                            {group.outputs.map(o => {
                              const tokenPath = group.isStartNode ? o.key : `steps.${group.nodeId}.${o.key}`;
                              return (
                                <button key={o.key} type="button" onClick={() => insertToken(tokenPath)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[#0D1117] flex items-start justify-between gap-3">
                                  <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0">{`{{${tokenPath}}}`}</span>
                                  <span className="text-[10px] text-[#484F58] text-right leading-tight">{o.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI helper popover */}
      {aiOpen && (
        <div className="rounded-lg border border-[#A78BFA]/40 bg-[#110D22] p-2.5 space-y-2">
          <p className="text-[10px] text-[#7D8590] leading-relaxed">Describe what you want to check and AI will write the expression.</p>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void handleAiSubmit(); if (e.key === "Escape") setAiOpen(false); }}
              placeholder="e.g. status is active and score is above 80"
              disabled={aiLoading}
              className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#A78BFA]/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleAiSubmit()}
              disabled={!aiPrompt.trim() || aiLoading}
              className="px-3 py-1.5 rounded bg-[#A78BFA]/20 border border-[#A78BFA]/40 text-[10px] font-semibold text-[#A78BFA] hover:bg-[#A78BFA]/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {aiLoading ? "…" : "Submit"}
            </button>
          </div>
          {aiError && <p className="text-[10px] text-red-400">{aiError}</p>}
        </div>
      )}

      {/* Input / textarea with inline autocomplete */}
      <div className="relative">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none font-mono"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={value}
            onChange={e => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setSuggest(null), 150)}
            placeholder={placeholder}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
          />
        )}
        {suggest && filteredTokens.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl overflow-hidden">
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredTokens.map((t, i) => (
                <button
                  key={t.tokenPath}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); pickSuggestion(t.tokenPath); }}
                  className={`w-full text-left px-3 py-1.5 flex items-start justify-between gap-3 ${i === activeIdx ? "bg-[#0078D4]/20" : "hover:bg-[#0D1117]"}`}
                >
                  <span className="font-mono text-[11px] text-[#2E9EFF] shrink-0">{`{{${t.tokenPath}}}`}</span>
                  <span className="text-[10px] text-[#484F58] text-right leading-tight">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="px-3 py-1 border-t border-[#30363D] flex items-center gap-2">
              <span className="text-[9px] text-[#484F58]">↑↓ navigate</span>
              <span className="text-[9px] text-[#484F58]">↵ / Tab insert</span>
              <span className="text-[9px] text-[#484F58]">Esc dismiss</span>
            </div>
          </div>
        )}
      </div>

      {/* Validator badge */}
      {badgeEl}

      {/* AI-generated hint text */}
      {aiHint && (
        <p className="text-[10px] text-[#A78BFA] leading-relaxed italic">{aiHint}</p>
      )}
    </div>
  );
}

// ── ImageUrlField — PayloadField + asset picker button ────────────────────────

function ImageUrlField({
  label = "Image URL (optional)",
  value,
  onChange,
  placeholder = "https://… or {{imageUrl}}",
  ancestorOutputs,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ancestorOutputs: AncestorGroup[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between min-h-[18px]">
        <label className="text-xs font-medium text-[#7D8590]">{label}</label>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Pick asset
        </button>
      </div>
      <PayloadField
        label=""
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ancestorOutputs={ancestorOutputs}
      />
      {pickerOpen && (
        <AssetPickerModal
          onSelect={url => { onChange(url); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ── Play Sound config panel ────────────────────────────────────────────────────

const SOUND_PRESETS = [
  { value: "success", label: "✅ Success chime" },
  { value: "error",   label: "❌ Error buzz" },
  { value: "alert",   label: "⚠️ Alert beep" },
  { value: "ping",    label: "🔔 Notification ping" },
  { value: "fanfare", label: "🎉 Celebration fanfare" },
] as const;

function PlaySoundPanel({
  node,
  onChange,
  fetchWithAuth,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  ancestorOutputs: AncestorGroup[];
}) {
  const target     = (node.data.target    as string | undefined) ?? "browser";
  const soundMode  = (node.data.soundMode as string | undefined) ?? "preset";
  const sound      = (node.data.sound     as string | undefined) ?? "ping";
  const url        = (node.data.url       as string | undefined) ?? "";
  const synthDesc  = (node.data.synthDesc as string | undefined) ?? "";
  const synthParams = node.data.synthParams as Record<string, unknown> | undefined;

  const playConditionOp   = (node.data.playConditionOp   as string | undefined) ?? "always";
  const playConditionExpr = (node.data.playConditionExpr as string | undefined) ?? "";
  const playConditionVal  = (node.data.playConditionVal  as string | undefined) ?? "";

  const [synthLoading, setSynthLoading] = useState(false);
  const [synthError,   setSynthError]   = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const up = (patch: Record<string, unknown>) => onChange(node.id, { ...node.data, ...patch });

  const handleGenerate = async () => {
    if (!synthDesc.trim()) return;
    setSynthLoading(true);
    setSynthError(null);
    try {
      const res = await fetchWithAuth("/api/admin/workflows/synthesise-sound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: synthDesc }),
      });
      const json = await res.json() as { ok?: boolean; params?: Record<string, unknown>; error?: string };
      if (!res.ok || !json.params) {
        setSynthError(json.error ?? "Sound synthesis failed");
      } else {
        up({ synthParams: json.params });
      }
    } catch (e) {
      setSynthError(String(e));
    } finally {
      setSynthLoading(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      if (soundMode === "generate" && synthParams) {
        await playSoundFromParams({ type: "params", params: synthParams as unknown as SoundParams });
      } else if (soundMode === "url" && url.trim()) {
        await playSoundFromParams({ type: "url", url: url.trim() });
      } else {
        await playSoundFromParams({ type: "preset", preset: sound });
      }
    } catch { }
    finally { setPreviewLoading(false); }
  };

  return (
    <>
      {/* Target */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Target</label>
        <div className="flex gap-2">
          {(["browser", "desktop"] as const).map(t => (
            <button
              key={t}
              onClick={() => up({ target: t })}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                target === t
                  ? "bg-[#E879F9]/10 border-[#E879F9]/60 text-[#E879F9]"
                  : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"
              }`}
            >
              {t === "browser" ? "🌐 Browser" : "🖥 Desktop"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[#484F58] leading-relaxed">
          {target === "browser"
            ? "Plays audio directly in the open admin panel tab via the Web Audio API (instant)."
            : "Delivers a web push notification — plays audio in any tab when the SW broadcasts it."}
        </p>
      </div>

      {/* Sound mode */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Sound source</label>
        <div className="flex gap-1.5">
          {([["preset", "Preset"], ["url", "Custom URL"], ["generate", "AI Generate"]] as const).map(([m, l]) => (
            <button
              key={m}
              onClick={() => up({ soundMode: m })}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                soundMode === m
                  ? "bg-[#E879F9]/10 border-[#E879F9]/60 text-[#E879F9]"
                  : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Preset picker */}
      {soundMode === "preset" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Preset sound</label>
          <select
            value={sound}
            onChange={e => up({ sound: e.target.value })}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60"
          >
            {SOUND_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      )}

      {/* Custom URL */}
      {soundMode === "url" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Audio URL</label>
          <input
            value={url}
            onChange={e => up({ url: e.target.value })}
            placeholder="https://example.com/chime.mp3"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60 placeholder-[#484F58]"
          />
          <p className="text-[10px] text-[#484F58]">Must be a publicly accessible audio file (MP3, OGG, WAV). Browser target only — URLs are not delivered via push.</p>
        </div>
      )}

      {/* AI Generate */}
      {soundMode === "generate" && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-[#7D8590]">Describe the moment</label>
          <textarea
            value={synthDesc}
            onChange={e => up({ synthDesc: e.target.value })}
            placeholder="e.g. payment received, urgent warning, new lead"
            rows={2}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60 placeholder-[#484F58] resize-none"
          />
          <button
            onClick={() => void handleGenerate()}
            disabled={!synthDesc.trim() || synthLoading}
            className="w-full py-1.5 rounded-lg text-xs font-medium border bg-[#E879F9]/10 border-[#E879F9]/40 text-[#E879F9] hover:bg-[#E879F9]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {synthLoading ? "Generating…" : "✨ Generate sound parameters"}
          </button>
          {synthError && <p className="text-[10px] text-red-400">{synthError}</p>}
          {synthParams && !synthError && (
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2 text-[10px] text-[#484F58]">
              <span className="text-[#22C55E]">✓</span> Sound parameters generated — click Preview to hear them.
            </div>
          )}
        </div>
      )}

      {/* Preview button */}
      <button
        onClick={() => void handlePreview()}
        disabled={previewLoading || (soundMode === "generate" && !synthParams) || (soundMode === "url" && !url.trim())}
        className="w-full py-1.5 rounded-lg text-xs font-medium border bg-[#1A1020] border-[#E879F9]/30 text-[#C084FC] hover:bg-[#E879F9]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {previewLoading ? "Playing…" : "▶ Preview sound"}
      </button>

      {/* Play only when — condition gate */}
      <div className="space-y-2 pt-1 border-t border-[#21262D]">
        <label className="text-xs font-medium text-[#7D8590]">Play only when</label>
        <select
          value={playConditionOp}
          onChange={e => up({ playConditionOp: e.target.value, playConditionExpr: "", playConditionVal: "" })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60"
        >
          <option value="always">Always (unconditional)</option>
          <option value="truthy">Variable is truthy (non-empty, non-zero, non-false)</option>
          <option value="falsy">Variable is falsy (empty, zero, or false)</option>
          <option value="eq">Variable equals value…</option>
          <option value="neq">Variable does not equal value…</option>
        </select>

        {playConditionOp !== "always" && (
          <ExpressionField
            label="Condition variable"
            value={playConditionExpr}
            onChange={v => up({ playConditionExpr: v })}
            placeholder="{{steps.execute_runbook.success}}"
            ancestorOutputs={ancestorOutputs}
            hint="Reference an ancestor step output. The value is interpolated at runtime and then tested against the chosen operator."
            expressionType="value"
            fetchWithAuth={fetchWithAuth}
          />
        )}

        {(playConditionOp === "eq" || playConditionOp === "neq") && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7D8590]">
              {playConditionOp === "eq" ? "Equals" : "Does not equal"}
            </label>
            <input
              value={playConditionVal}
              onChange={e => up({ playConditionVal: e.target.value })}
              placeholder="e.g. true, success, 1"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60 placeholder-[#484F58]"
            />
          </div>
        )}

        {playConditionOp !== "always" && (
          <p className="text-[10px] text-[#484F58] leading-relaxed">
            When the condition is not met, the sound is skipped and <span className="font-mono text-[#7D8590]">{"{{soundPlayed}}"}</span> will be <span className="font-mono text-[#7D8590]">false</span>.
          </p>
        )}
      </div>

      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">
          Outputs: <span className="font-mono text-[#7D8590]">{"{{soundPlayed}}"}</span> (boolean), <span className="font-mono text-[#7D8590]">{"{{soundTarget}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{soundSkipped}}"}</span> (boolean — true when condition not met).
          Browser target plays in real-time via SSE. Desktop target delivers via web push (requires VAPID secrets).
        </p>
      </div>
    </>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onChange,
  onClose,
  onDelete,
  defId,
  nodes,
  edges,
  onGraphChange,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  defId: number;
  nodes: Node[];
  edges: Edge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const nodeType = (node.data.nodeType as string) ?? "action";
  const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;
  const p = (node.data.params as Record<string, unknown>) ?? {};

  // Fetch triggers so the variable picker can surface the event's exact payload fields.
  // Same cache key as StartNodeTriggers — React Query deduplicates the request.
  const { data: triggers = [] } = useQuery<WfTrigger[]>({
    queryKey: ["wf-triggers", defId],
    queryFn: async () => {
      const r = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`);
      if (!r.ok) return [];
      return r.json();
    },
  });
  const ancestorOutputs = getAncestorOutputs(node.id, nodes, edges, triggers);

  // ── generate_script: service/document searchable lists ──────────────────
  const gsSourceMode = ((node.data.sourceMode as string | undefined) ?? "service") as "service" | "document";
  const [gsServices, setGsServices] = useState<{ id: number; name: string; category: string | null }[]>([]);
  const [gsDocs, setGsDocs] = useState<{ id: number; title: string | null; docType: string }[]>([]);
  const [gsSearch, setGsSearch] = useState("");
  const [gsLoading, setGsLoading] = useState(false);

  // ── Runbook name dropdown (update_m365_profile + execute_runbook) ─────────
  const [runbookNames, setRunbookNames] = useState<string[]>([]);
  const [runbooksLoading, setRunbooksLoading] = useState(false);
  const [runbooksError, setRunbooksError] = useState(false);
  const [runbookManualMode, setRunbookManualMode] = useState(false);

  // Seed manual mode from the saved value whenever the selected node changes.
  // Nodes pre-saved with {{variable}} open in text mode; all others open in list mode.
  useEffect(() => {
    const saved = (node.data.runbookName as string) ?? "";
    setRunbookManualMode(saved.includes("{{"));
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (nodeType !== "update_m365_profile" && nodeType !== "execute_runbook") return;
    setRunbooksLoading(true);
    setRunbooksError(false);
    fetchWithAuth("/api/admin/runbooks")
      .then(r => r.ok ? r.json() as Promise<{ runbooks?: Array<{ name: string }> }> : Promise.reject())
      .then(data => setRunbookNames(Array.isArray(data.runbooks) ? data.runbooks.map(rb => rb.name) : []))
      .catch(() => { setRunbooksError(true); setRunbookNames([]); })
      .finally(() => setRunbooksLoading(false));
  }, [nodeType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (nodeType !== "generate_script") return;
    setGsLoading(true);
    if (gsSourceMode === "service") {
      fetchWithAuth("/api/admin/services")
        .then(r => r.ok ? r.json() : [])
        .then((data: { id: number; name: string; category: string | null }[]) => setGsServices(Array.isArray(data) ? data : []))
        .catch(() => setGsServices([]))
        .finally(() => setGsLoading(false));
    } else {
      fetchWithAuth("/api/admin/insights/documents")
        .then(r => r.ok ? r.json() : { documents: [] })
        .then((data: { documents?: { id: number; title: string | null; docType: string }[] } | { id: number; title: string | null; docType: string }[]) => {
          const list = Array.isArray(data) ? data : ((data as { documents?: { id: number; title: string | null; docType: string }[] }).documents ?? []);
          setGsDocs(list);
        })
        .catch(() => setGsDocs([]))
        .finally(() => setGsLoading(false));
    }
  }, [nodeType, gsSourceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute right-4 top-4 bottom-4 w-72 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-y-auto z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span style={{ color: style.border, fontSize: 16 }}>{style.icon}</span>
          <span className="text-sm font-semibold text-[#E6EDF3]">{nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} Node</span>
        </div>
        <div className="flex items-center gap-2">
          {nodeType !== "start" && (
            <button
              onClick={() => { onDelete(node.id); }}
              title="Delete node (Del)"
              className="text-[#484F58] hover:text-[#EF4444] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-[#7D8590]">Node Name</label>
            <FieldHint text="Display label for this node in the canvas. Has no effect on execution." />
          </div>
          <input
            type="text"
            value={(node.data.label as string) ?? ""}
            onChange={e => onChange(node.id, { ...node.data, label: e.target.value })}
            placeholder="Give this node a name…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm font-medium text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
          />
        </div>
        <ConfigField
          label="Description"
          hint="Optional notes about what this node does — for documentation only, not used during execution."
          value={(node.data.description as string) ?? ""}
          onChange={v => onChange(node.id, { ...node.data, description: v })}
          multiline
        />

        {nodeType === "start" && (
          <>
            <StartNodeTriggers defId={defId} />
            <StartNodePayloadFields node={node} onChange={onChange} />
          </>
        )}

        {nodeType === "action" && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Action Type</label>
                <FieldHint text="The operation this node performs. Changing the type reveals the relevant configuration fields below." />
              </div>
              <select
                value={(node.data.actionType as string) ?? "http_request"}
                onChange={e => onChange(node.id, { ...node.data, actionType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <optgroup label="Platform">
                  <option value="http_request">🌐 HTTP Request</option>
                  <option value="sql_query">🗄️ SQL Query</option>
                  <option value="send_email">📧 Send Email</option>
                  <option value="send_sms">💬 Send SMS</option>
                  <option value="emit_event">📡 Emit Event</option>
                  <option value="cancel_workflow">🛑 Cancel Workflow</option>
                </optgroup>
                <optgroup label="CRM">
                  <option value="create_lead">➕ Create Lead</option>
                  <option value="convert_to_opportunity">🚀 Convert to Opportunity</option>
                  <option value="create_client">👤 Create Client</option>
                  <option value="create_project">📁 Create Project</option>
                </optgroup>
                <optgroup label="Microsoft 365">
                  <option value="update_m365_profile">☁️ Update M365 Profile</option>
                  <option value="execute_runbook">⚙️ Execute Runbook</option>
                </optgroup>
                <optgroup label="Documents">
                  <option value="generate_document">📄 Generate Document</option>
                  <option value="calculate_pricing">💲 Calculate Pricing</option>
                </optgroup>
              </select>
            </div>

            {(node.data.actionType as string | undefined) === "http_request" || !(node.data.actionType as string) ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Method</label>
                  <select
                    value={(p.method as string) ?? "GET"}
                    onChange={e => onChange(node.id, { ...node.data, params: { ...p, method: e.target.value } })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    {["GET","POST","PUT","PATCH","DELETE"].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <PayloadField
                  label="URL"
                  value={(p.url as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, params: { ...p, url: v } })}
                  placeholder="https://…"
                  ancestorOutputs={ancestorOutputs}
                />
                <PayloadField
                  label="Body (JSON)"
                  value={(p.bodyRaw as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, params: { ...p, bodyRaw: v } })}
                  placeholder='{"key": "value"}'
                  multiline
                  ancestorOutputs={ancestorOutputs}
                />
              </>
            ) : null}

            {(node.data.actionType as string) === "sql_query" && (
              <>
                <PayloadField
                  label="SQL Query"
                  value={(node.data.query as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, query: v })}
                  placeholder="SELECT * FROM clients WHERE status = 'active'"
                  multiline
                  ancestorOutputs={ancestorOutputs}
                />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Results are injected into the payload as <span className="font-mono text-[#7D8590]">{"{{queryRows}}"}</span>. Must be a SELECT statement.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "send_email" && (
              <>
                <PayloadField
                  label="To (email)"
                  value={(node.data.to as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, to: v })}
                  placeholder="client@example.com"
                  ancestorOutputs={ancestorOutputs}
                />
                <PayloadField
                  label="Subject"
                  value={(node.data.subject as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, subject: v })}
                  placeholder="Your onboarding is ready"
                  ancestorOutputs={ancestorOutputs}
                />
                <PayloadField
                  label="Body"
                  value={(node.data.body as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, body: v })}
                  placeholder="Hi {{payload.name}}, …"
                  multiline
                  ancestorOutputs={ancestorOutputs}
                />
              </>
            )}

            {(node.data.actionType as string) === "send_sms" && (
              <>
                <PayloadField
                  label="To (E.164 phone)"
                  value={(node.data.to as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, to: v })}
                  placeholder="+12025550100"
                  ancestorOutputs={ancestorOutputs}
                />
                <PayloadField
                  label="Message"
                  value={(node.data.message as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, message: v })}
                  placeholder="Hi {{payload.name}}, your project is ready."
                  multiline
                  ancestorOutputs={ancestorOutputs}
                />
              </>
            )}

            {(node.data.actionType as string) === "emit_event" && (
              <>
                <PayloadField
                  label="Event Name"
                  value={(node.data.eventName as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, eventName: v })}
                  placeholder="onboarding.completed"
                  ancestorOutputs={ancestorOutputs}
                />
                <PayloadField
                  label="Payload (JSON)"
                  value={(node.data.extraPayload as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, extraPayload: v })}
                  placeholder='{"clientId": "{{payload.clientId}}"}'
                  multiline
                  ancestorOutputs={ancestorOutputs}
                />
              </>
            )}

            {(node.data.actionType as string) === "cancel_workflow" && (
              <div className="rounded-lg bg-[#1A0D0D] border border-[#EF4444]/30 p-3">
                <p className="text-xs text-[#EF4444]">Cancel Workflow</p>
                <p className="text-[11px] text-[#7D8590] mt-1 leading-relaxed">When the executor reaches this node the run is immediately marked <span className="font-mono text-[#EF4444]">cancelled</span>. No further nodes are executed.</p>
              </div>
            )}

            {(node.data.actionType as string) === "create_lead" && (
              <>
                <PayloadField label="Name" value={(node.data.name as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, name: v })} placeholder="{{payload.leadName}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Email" value={(node.data.email as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, email: v })} placeholder="{{payload.leadEmail}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Company" value={(node.data.company as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, company: v })} placeholder="{{payload.company}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Service Area" value={(node.data.serviceArea as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, serviceArea: v })} placeholder="Microsoft 365" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Message" value={(node.data.message as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, message: v })} placeholder="{{payload.message}}" multiline ancestorOutputs={ancestorOutputs} />
              </>
            )}

            {(node.data.actionType as string) === "convert_to_opportunity" && (
              <>
                <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Workflow Type</label>
                  <select
                    value={(node.data.workflowType as string) ?? "DiscoveryCall"}
                    onChange={e => onChange(node.id, { ...node.data, workflowType: e.target.value })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    {["DiscoveryCall","Proposal","QuickWin","Retainer","Onboarding"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Creates an opportunity linked to the lead and generates the matching workflow task set. Output: <span className="font-mono text-[#7D8590]">{"{{opportunityId}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "create_client" && (
              <>
                <PayloadField label="Name" value={(node.data.name as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, name: v })} placeholder="{{payload.name}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Email" value={(node.data.email as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, email: v })} placeholder="{{payload.clientEmail}}" ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Creates a CRM user account with role <span className="font-mono text-[#7D8590]">client</span>. Output: <span className="font-mono text-[#7D8590]">{"{{clientId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{clientEmail}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "create_project" && (
              <>
                <PayloadField label="Title" value={(node.data.title as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, title: v })} placeholder="{{payload.leadName}} Onboarding" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Description" value={(node.data.description as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, description: v })} placeholder="Auto-created by workflow" multiline ancestorOutputs={ancestorOutputs} />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Project Type</label>
                  <select
                    value={(node.data.projectType as string) ?? "project"}
                    onChange={e => onChange(node.id, { ...node.data, projectType: e.target.value })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    <option value="project">Project</option>
                    <option value="retainer">Retainer</option>
                  </select>
                </div>
                <PayloadField label="Client User ID (optional)" value={(node.data.clientUserId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientUserId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Output: <span className="font-mono text-[#7D8590]">{"{{projectId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{projectTitle}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "update_m365_profile" && (
              <>
                <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="M365-Health-Check" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"TenantId": "{{payload.tenantId}}"}' multiline ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Triggers an Azure Automation runbook against the client's M365 tenant. Output: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "execute_runbook" && (
              <>
                <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="My-Runbook-Name" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"Param1": "value"}' multiline ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Client ID (optional)" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Project ID (optional)" value={(node.data.projectId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, projectId: v })} placeholder="{{projectId}}" ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Requires Azure Automation secrets. Polls until completion (10 min max). Outputs: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobStatus}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobOutput}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "calculate_pricing" && (
              <>
                <PayloadField label="Document ID" value={(node.data.documentId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, documentId: v })} placeholder="{{documentId}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Doc Type Override (optional)" value={(node.data.docType as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docType: v })} placeholder="consolidated_sow" ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Parses SOW pricing from the document's HTML and writes <span className="font-mono text-[#7D8590]">sowPricingLines</span> + <span className="font-mono text-[#7D8590]">sowTotalPrice</span> back to the DB. Pipe <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span> from an upstream <em>Generate Document</em> node. Outputs: <span className="font-mono text-[#7D8590]">{"{{totalPrice}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{lineCount}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "generate_document" && (
              <>
                <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Document Category</label>
                  <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                    {(["report", "consulting"] as const).map(cat => (
                      <button
                        key={cat}
                        onClick={() => onChange(node.id, { ...node.data, docCategory: cat, docType: cat === "report" ? "executive_summary" : "sow" })}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${((node.data.docCategory as string) ?? "report") === cat ? "bg-[#0078D4] text-white" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
                      >
                        {cat === "report" ? "Insights Report" : "Consulting Doc"}
                      </button>
                    ))}
                  </div>
                </div>
                <PayloadField label="Document Type" value={(node.data.docType as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docType: v })} placeholder={((node.data.docCategory as string) ?? "report") === "consulting" ? "sow" : "executive_summary"} ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
                  <p className="text-[10px] text-[#484F58] font-medium">Valid values for <span className="text-[#7D8590]">{((node.data.docCategory as string) ?? "report") === "consulting" ? "Consulting Doc" : "Insights Report"}</span>:</p>
                  <p className="text-[10px] font-mono text-[#484F58] leading-relaxed">
                    {(((node.data.docCategory as string) ?? "report") === "consulting"
                      ? "consolidated_sow · sow · task_execution_guide · remediation_plan · deployment_plan · governance_framework · security_hardening_plan · copilot_enablement_plan · identity_modernization_plan · copilot_readiness"
                      : "executive_summary · full_readiness_report · security_posture_report · governance_maturity_report · data_exposure_risk_report · license_optimization_report"
                    )}
                  </p>
                  <p className="text-[10px] text-[#484F58]">Accepts a <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> — e.g. <span className="font-mono text-[#7D8590]">{"{{item.docType}}"}</span> from a ForEach loop.</p>
                </div>
                <PayloadField label="Project ID" value={(node.data.projectId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, projectId: v })} placeholder="{{projectId}}" ancestorOutputs={ancestorOutputs} />
                <PayloadField label="Document Name" value={(node.data.docTitle as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docTitle: v })} placeholder="{{item.name}} — Security Report" ancestorOutputs={ancestorOutputs} />
                {(node.data.docType as string) === "task_execution_guide" && (
                  <>
                    <PayloadField
                      label="SOW Document ID (required)"
                      value={(node.data.sowDocumentId as string) ?? ""}
                      onChange={v => onChange(node.id, { ...node.data, sowDocumentId: v })}
                      placeholder="{{documentId}}"
                      ancestorOutputs={ancestorOutputs}
                    />
                    <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 p-2.5">
                      <p className="text-[10px] text-amber-400/80">The ID of the SOW document to generate from (e.g. a <span className="font-mono">consolidated_sow</span>). Pipe it from an upstream <span className="font-mono">generate_document</span> or <span className="font-mono">find_object</span> node using <span className="font-mono">{"{{documentId}}"}</span>. The executor fetches the HTML automatically.</p>
                    </div>
                  </>
                )}
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Creates a document for the client. All fields support <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Outputs: <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span>{(node.data.docType as string) === "task_execution_guide" && <>, <span className="font-mono text-[#7D8590]">{"{{htmlContent}}"}</span></>}.</p>
                </div>
              </>
            )}
          </>
        )}

        {/* ── Promoted Platform nodes ───────────────────────── */}

        {nodeType === "http_request" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Method</label>
              <select
                value={(p.method as string) ?? "GET"}
                onChange={e => onChange(node.id, { ...node.data, params: { ...p, method: e.target.value } })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                {["GET","POST","PUT","PATCH","DELETE"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <PayloadField label="URL" value={(p.url as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, params: { ...p, url: v } })} placeholder="https://…" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Body (JSON)" value={(p.bodyRaw as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, params: { ...p, bodyRaw: v } })} placeholder='{"key": "value"}' multiline ancestorOutputs={ancestorOutputs} />
          </>
        )}

        {nodeType === "sql_query" && (
          <>
            <PayloadField label="SQL Query" value={(node.data.query as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, query: v })} placeholder="SELECT * FROM clients WHERE status = 'active'" multiline ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Results are injected into the payload as <span className="font-mono text-[#7D8590]">{"{{queryRows}}"}</span>. Must be a SELECT statement.</p>
            </div>
          </>
        )}

        {nodeType === "emit_event" && (
          <>
            <PayloadField label="Event Name" value={(node.data.eventName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, eventName: v })} placeholder="onboarding.completed" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Payload (JSON)" value={(node.data.extraPayload as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, extraPayload: v })} placeholder='{"clientId": "{{payload.clientId}}"}' multiline ancestorOutputs={ancestorOutputs} />
          </>
        )}

        {nodeType === "cancel_workflow" && (
          <div className="rounded-lg bg-[#1A0D0D] border border-[#EF4444]/30 p-3">
            <p className="text-xs text-[#EF4444]">Cancel Workflow</p>
            <p className="text-[11px] text-[#7D8590] mt-1 leading-relaxed">When the executor reaches this node the run is immediately marked <span className="font-mono text-[#EF4444]">cancelled</span>. No further nodes are executed.</p>
          </div>
        )}

        {/* ── Promoted Communication nodes ───────────────────── */}

        {nodeType === "send_email" && (
          <>
            <PayloadField label="To (email)" value={(node.data.to as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, to: v })} placeholder="client@example.com" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Subject" value={(node.data.subject as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, subject: v })} placeholder="Your onboarding is ready" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Body" value={(node.data.body as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, body: v })} placeholder="Hi {{payload.name}}, …" multiline ancestorOutputs={ancestorOutputs} />
          </>
        )}

        {nodeType === "send_sms" && (
          <>
            <PayloadField label="To (E.164 phone)" value={(node.data.to as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, to: v })} placeholder="+12025550100" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Message" value={(node.data.message as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, message: v })} placeholder="Hi {{payload.name}}, your project is ready." multiline ancestorOutputs={ancestorOutputs} />
          </>
        )}

        {nodeType === "play_sound" && (
          <PlaySoundPanel node={node} onChange={onChange} fetchWithAuth={fetchWithAuth} ancestorOutputs={ancestorOutputs} />
        )}

        {nodeType === "send_browser_notification" && (
          <>
            <PayloadField label="Title" value={(node.data.title as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, title: v })} placeholder="New lead: {{leadName}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Body" value={(node.data.body as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, body: v })} placeholder="{{company}} submitted a contact form." multiline ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Link path (optional)" value={(node.data.linkPath as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, linkPath: v })} placeholder="/admin-panel/crm/leads" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">All three fields support <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Sends to all subscribed admins. Requires <span className="font-mono text-[#7D8590]">VAPID_PUBLIC_KEY</span> and <span className="font-mono text-[#7D8590]">VAPID_PRIVATE_KEY</span> secrets — gracefully skipped if absent. Output: <span className="font-mono text-[#7D8590]">{"{{notificationSent}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "send_mobile_push" && (
          <>
            <PayloadField label="Title" value={(node.data.title as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, title: v })} placeholder="New lead: {{leadName}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Body" value={(node.data.body as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, body: v })} placeholder="{{company}} submitted a contact form." multiline ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Both fields support <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Broadcasts to all registered Expo device tokens. If no tokens are registered the node outputs <span className="font-mono text-[#7D8590]">sent: false</span> without failing. Outputs: <span className="font-mono text-[#7D8590]">{"{{sent}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{sentCount}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "create_notification" && (
          <>
            <PayloadField label="Title (required)" value={(node.data.title as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, title: v })} placeholder="New purchase: {{serviceName}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Body (optional)" value={(node.data.body as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, body: v })} placeholder="{{clientName}} purchased {{serviceName}} — ${{amount}}" multiline ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Link path (optional)" value={(node.data.linkPath as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, linkPath: v })} placeholder="/admin-panel/crm/leads" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Notification type</label>
              <select
                value={(node.data.type as string) ?? "message"}
                onChange={e => onChange(node.id, { ...node.data, type: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#22C55E]/60"
              >
                <option value="message">Message</option>
                <option value="document">Document</option>
                <option value="invoice">Invoice</option>
                <option value="lead_created">Lead Created</option>
                <option value="purchase_created">Purchase Created</option>
                <option value="general">General</option>
              </select>
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Title, body, and link path support <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Inserts a persistent row into the notification bell for every admin user. Appears within the next poll cycle (≤ 30 s). Output: <span className="font-mono text-[#7D8590]">{"{{notificationCount}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── Promoted CRM Action nodes ─────────────────────── */}

        {nodeType === "create_lead" && (
          <>
            <PayloadField label="Name" value={(node.data.name as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, name: v })} placeholder="{{payload.leadName}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Email" value={(node.data.email as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, email: v })} placeholder="{{payload.leadEmail}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Company" value={(node.data.company as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, company: v })} placeholder="{{payload.company}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Service Area" value={(node.data.serviceArea as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, serviceArea: v })} placeholder="Microsoft 365" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Message" value={(node.data.message as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, message: v })} placeholder="{{payload.message}}" multiline ancestorOutputs={ancestorOutputs} />
          </>
        )}

        {nodeType === "convert_to_opportunity" && (
          <>
            <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Workflow Type</label>
              <select
                value={(node.data.workflowType as string) ?? "DiscoveryCall"}
                onChange={e => onChange(node.id, { ...node.data, workflowType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                {["DiscoveryCall","Proposal","QuickWin","Retainer","Onboarding"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Creates an opportunity linked to the lead. Output: <span className="font-mono text-[#7D8590]">{"{{opportunityId}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "create_client" && (
          <>
            <PayloadField label="Name" value={(node.data.name as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, name: v })} placeholder="{{payload.name}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Email" value={(node.data.email as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, email: v })} placeholder="{{payload.clientEmail}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Creates a CRM user account with role <span className="font-mono text-[#7D8590]">client</span>. Output: <span className="font-mono text-[#7D8590]">{"{{clientId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{clientEmail}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "create_project" && (
          <>
            <PayloadField label="Title" value={(node.data.title as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, title: v })} placeholder="{{payload.leadName}} Onboarding" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Description" value={(node.data.description as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, description: v })} placeholder="Auto-created by workflow" multiline ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Project Type</label>
              <select
                value={(node.data.projectType as string) ?? "project"}
                onChange={e => onChange(node.id, { ...node.data, projectType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <option value="project">Project</option>
                <option value="retainer">Retainer</option>
              </select>
            </div>
            <PayloadField label="Client User ID (optional)" value={(node.data.clientUserId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientUserId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Output: <span className="font-mono text-[#7D8590]">{"{{projectId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{projectTitle}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── Promoted Azure nodes ──────────────────────────── */}

        {nodeType === "execute_runbook" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Runbook Name</label>
              {runbooksLoading ? (
                <select disabled className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#484F58] outline-none">
                  <option>Loading runbooks…</option>
                </select>
              ) : runbookNames.length > 0 && !runbookManualMode ? (
                <>
                  <select
                    value={(node.data.runbookName as string) ?? ""}
                    onChange={e => onChange(node.id, { ...node.data, runbookName: e.target.value })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    <option value="">— select a runbook —</option>
                    {runbookNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button type="button" onClick={() => setRunbookManualMode(true)} className="text-[10px] text-[#484F58] hover:text-[#7D8590] hover:underline underline-offset-2 transition-colors">
                    use a variable instead
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={(node.data.runbookName as string) ?? ""}
                    onChange={e => onChange(node.id, { ...node.data, runbookName: e.target.value })}
                    placeholder="My-Runbook-Name"
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                  />
                  {runbooksError && <p className="text-[10px] text-amber-400/80">Could not load runbooks — enter name manually.</p>}
                  {runbookNames.length > 0 && !runbooksLoading && (
                    <button type="button" onClick={() => setRunbookManualMode(false)} className="text-[10px] text-[#484F58] hover:text-[#7D8590] hover:underline underline-offset-2 transition-colors">
                      choose from list
                    </button>
                  )}
                </>
              )}
            </div>
            <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"Param1": "value"}' multiline ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Client ID (optional)" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Project ID (optional)" value={(node.data.projectId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, projectId: v })} placeholder="{{projectId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Requires Azure Automation secrets. Polls until completion (10 min max). Outputs: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobStatus}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobOutput}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "update_m365_profile" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Runbook Name</label>
              {runbooksLoading ? (
                <select disabled className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#484F58] outline-none">
                  <option>Loading runbooks…</option>
                </select>
              ) : runbookNames.length > 0 && !runbookManualMode ? (
                <>
                  <select
                    value={(node.data.runbookName as string) ?? ""}
                    onChange={e => onChange(node.id, { ...node.data, runbookName: e.target.value })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    <option value="">— select a runbook —</option>
                    {runbookNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <button type="button" onClick={() => setRunbookManualMode(true)} className="text-[10px] text-[#484F58] hover:text-[#7D8590] hover:underline underline-offset-2 transition-colors">
                    use a variable instead
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={(node.data.runbookName as string) ?? ""}
                    onChange={e => onChange(node.id, { ...node.data, runbookName: e.target.value })}
                    placeholder="M365-Health-Check"
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
                  />
                  {runbooksError && <p className="text-[10px] text-amber-400/80">Could not load runbooks — enter name manually.</p>}
                  {runbookNames.length > 0 && !runbooksLoading && (
                    <button type="button" onClick={() => setRunbookManualMode(false)} className="text-[10px] text-[#484F58] hover:text-[#7D8590] hover:underline underline-offset-2 transition-colors">
                      choose from list
                    </button>
                  )}
                </>
              )}
            </div>
            <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"TenantId": "{{payload.tenantId}}"}' multiline ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Triggers an Azure Automation runbook against the client's M365 tenant. Output: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "report_progress" && (
          <>
            <PayloadField
              label="Message"
              value={(node.data.message as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, message: v })}
              placeholder="Processing step {{step}} — {{clientName}}…"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="grid grid-cols-2 gap-3">
              <PayloadField
                label="Step (optional)"
                value={(node.data.step as string | undefined) ?? ""}
                onChange={v => onChange(node.id, { ...node.data, step: v === "" ? undefined : v })}
                placeholder="{{loopIndex}}"
                ancestorOutputs={ancestorOutputs}
              />
              <PayloadField
                label="Total (optional)"
                value={(node.data.total as string | undefined) ?? ""}
                onChange={v => onChange(node.id, { ...node.data, total: v === "" ? undefined : v })}
                placeholder="{{items.length}}"
                ancestorOutputs={ancestorOutputs}
              />
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Emits a real-time status message into the run log. Supports <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Payload passes through unchanged.</p>
            </div>
          </>
        )}

        {nodeType === "calculate_pricing" && (
          <>
            <PayloadField label="Document ID" value={(node.data.documentId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, documentId: v })} placeholder="{{documentId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Doc Type Override (optional)" value={(node.data.docType as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docType: v })} placeholder="consolidated_sow" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Parses SOW pricing from the document's HTML and writes <span className="font-mono text-[#7D8590]">sowPricingLines</span> + <span className="font-mono text-[#7D8590]">sowTotalPrice</span> back to the DB. Pipe <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span> from an upstream <em>Generate Document</em> node. Outputs: <span className="font-mono text-[#7D8590]">{"{{totalPrice}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{lineCount}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "generate_document" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Document Category</label>
              <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                {(["report", "consulting"] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => onChange(node.id, { ...node.data, docCategory: cat, docType: cat === "report" ? "executive_summary" : "sow" })}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${((node.data.docCategory as string) ?? "report") === cat ? "bg-[#0078D4] text-white" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
                  >
                    {cat === "report" ? "Insights Report" : "Consulting Doc"}
                  </button>
                ))}
              </div>
            </div>
            <PayloadField label="Document Type" value={(node.data.docType as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docType: v })} placeholder={((node.data.docCategory as string) ?? "report") === "consulting" ? "sow" : "executive_summary"} ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58] font-medium">Valid values for <span className="text-[#7D8590]">{((node.data.docCategory as string) ?? "report") === "consulting" ? "Consulting Doc" : "Insights Report"}</span>:</p>
              <p className="text-[10px] font-mono text-[#484F58] leading-relaxed">
                {(((node.data.docCategory as string) ?? "report") === "consulting"
                  ? "consolidated_sow · sow · task_execution_guide · remediation_plan · deployment_plan · governance_framework · security_hardening_plan · copilot_enablement_plan · identity_modernization_plan · copilot_readiness"
                  : "executive_summary · full_readiness_report · security_posture_report · governance_maturity_report · data_exposure_risk_report · license_optimization_report"
                )}
              </p>
              <p className="text-[10px] text-[#484F58]">Accepts a <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> — e.g. <span className="font-mono text-[#7D8590]">{"{{item.docType}}"}</span> from a ForEach loop.</p>
            </div>
            <PayloadField label="Project ID" value={(node.data.projectId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, projectId: v })} placeholder="{{projectId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Document Name" value={(node.data.docTitle as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docTitle: v })} placeholder="{{item.name}} — Security Report" ancestorOutputs={ancestorOutputs} />
            {(node.data.docType as string) === "task_execution_guide" && (
              <>
                <PayloadField
                  label="SOW Document ID (required)"
                  value={(node.data.sowDocumentId as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, sowDocumentId: v })}
                  placeholder="{{documentId}}"
                  ancestorOutputs={ancestorOutputs}
                />
                <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 p-2.5">
                  <p className="text-[10px] text-amber-400/80">The ID of the SOW document to generate from (e.g. a <span className="font-mono">consolidated_sow</span>). Pipe it from an upstream <span className="font-mono">generate_document</span> or <span className="font-mono">find_object</span> node using <span className="font-mono">{"{{documentId}}"}</span>. The executor fetches the HTML automatically.</p>
                </div>
              </>
            )}
            {(node.data.docType as string) === "consolidated_sow" && (
              <>
                <PayloadField
                  label="Pre-computed Signals (optional)"
                  value={(node.data.signalsOverride as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, signalsOverride: v })}
                  placeholder="{{signals}}"
                  ancestorOutputs={ancestorOutputs}
                />
                <div className="rounded-lg bg-[#0D1A1A] border border-[#00B4D8]/30 p-2.5">
                  <p className="text-[10px] text-[#00B4D8]/70">Pipe <span className="font-mono">{"{{signals}}"}</span> from an upstream <em>Get Tenant Signals</em> node to skip redundant signal computation during SOW generation. Leave empty to compute signals automatically.</p>
                </div>
              </>
            )}
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Creates a document for the client. All fields support <span className="font-mono text-[#7D8590]">{"{{variable}}"}</span> interpolation. Outputs: <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span>{(node.data.docType as string) === "task_execution_guide" && <>, <span className="font-mono text-[#7D8590]">{"{{htmlContent}}"}</span></>}.</p>
            </div>
          </>
        )}

        {nodeType === "generate_script" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Output Mode</label>
              <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                {([
                  { value: "auto",    label: "🤖 Auto" },
                  { value: "single",  label: "📄 Single Script" },
                  { value: "package", label: "📦 Script Package" },
                ] as const).map(({ value, label }) => {
                  const current = (node.data.outputMode as string | undefined) ?? "auto";
                  return (
                    <button
                      key={value}
                      onClick={() => onChange(node.id, { ...node.data, outputMode: value })}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${current === value ? "bg-[#0078D4]/20 text-[#58A6FF] border-r border-[#0078D4]/30" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-[#484F58]">
                <span className="font-medium text-[#7D8590]">Auto</span> — AI decides based on task count.{" "}
                <span className="font-medium text-[#7D8590]">Single</span> — one consolidated script.{" "}
                <span className="font-medium text-[#7D8590]">Package</span> — always creates a Script Package with multiple named modules.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Source Mode</label>
              <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                {(["service", "document"] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { onChange(node.id, { ...node.data, sourceMode: mode, targetId: "" }); setGsSearch(""); }}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${gsSourceMode === mode ? "bg-[#22C55E]/20 text-[#22C55E] border-r border-[#22C55E]/30" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
                  >
                    {mode === "service" ? "📋 From Service" : "📄 From Document"}
                  </button>
                ))}
              </div>
            </div>

            {/* Searchable selector for service or document */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">
                {gsSourceMode === "service" ? "Select Service" : "Select Document"}
              </label>
              <input
                type="text"
                value={gsSearch}
                onChange={e => setGsSearch(e.target.value)}
                placeholder={gsSourceMode === "service" ? "Search services…" : "Search documents…"}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#22C55E]/60 placeholder-[#484F58]"
              />
              <div className="rounded-lg border border-[#30363D] overflow-hidden max-h-40 overflow-y-auto bg-[#0D1117]">
                {gsLoading ? (
                  <p className="text-[10px] text-[#7D8590] px-3 py-2">Loading…</p>
                ) : gsSourceMode === "service" ? (
                  gsServices.filter(s => !gsSearch || s.name.toLowerCase().includes(gsSearch.toLowerCase())).length === 0 ? (
                    <p className="text-[10px] text-[#484F58] px-3 py-2">
                      {gsServices.length === 0 ? "No services found." : `No services match "${gsSearch}"`}
                    </p>
                  ) : (
                    gsServices
                      .filter(s => !gsSearch || s.name.toLowerCase().includes(gsSearch.toLowerCase()))
                      .map(s => (
                        <button
                          key={s.id}
                          onClick={() => { onChange(node.id, { ...node.data, targetId: String(s.id), targetName: s.name }); setGsSearch(""); }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-[#22C55E]/10 transition-colors border-b border-[#21262D] last:border-0 ${(node.data.targetId as string) === String(s.id) ? "bg-[#22C55E]/10 text-[#22C55E]" : "text-[#E6EDF3]"}`}
                        >
                          <span className="font-medium truncate block">{s.name}</span>
                          {s.category && <span className="text-[10px] text-[#484F58]">{s.category}</span>}
                        </button>
                      ))
                  )
                ) : (
                  gsDocs.filter(d => !gsSearch || (d.title ?? "").toLowerCase().includes(gsSearch.toLowerCase()) || d.docType.toLowerCase().includes(gsSearch.toLowerCase())).length === 0 ? (
                    <p className="text-[10px] text-[#484F58] px-3 py-2">
                      {gsDocs.length === 0 ? "No documents found." : `No documents match "${gsSearch}"`}
                    </p>
                  ) : (
                    gsDocs
                      .filter(d => !gsSearch || (d.title ?? "").toLowerCase().includes(gsSearch.toLowerCase()) || d.docType.toLowerCase().includes(gsSearch.toLowerCase()))
                      .map(d => (
                        <button
                          key={d.id}
                          onClick={() => { onChange(node.id, { ...node.data, targetId: String(d.id), targetName: d.title ?? `Document #${d.id}` }); setGsSearch(""); }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-[#22C55E]/10 transition-colors border-b border-[#21262D] last:border-0 ${(node.data.targetId as string) === String(d.id) ? "bg-[#22C55E]/10 text-[#22C55E]" : "text-[#E6EDF3]"}`}
                        >
                          <span className="font-medium truncate block">{d.title ?? "(untitled)"}</span>
                          <span className="text-[10px] text-[#484F58]">{d.docType}</span>
                        </button>
                      ))
                  )
                )}
              </div>
              {(node.data.targetId as string) && (
                <div className="flex items-center gap-1.5 text-[10px] text-[#22C55E]">
                  <span>✓</span>
                  <span className="truncate">
                    {gsSourceMode === "service"
                      ? (gsServices.find(s => String(s.id) === (node.data.targetId as string))?.name ?? `Service #${node.data.targetId}`)
                      : (gsDocs.find(d => String(d.id) === (node.data.targetId as string))?.title ?? `Document #${node.data.targetId}`)
                    }
                  </span>
                  <button
                    onClick={() => onChange(node.id, { ...node.data, targetId: "", targetName: "" })}
                    className="ml-auto text-[#484F58] hover:text-[#EF4444] transition-colors flex-shrink-0"
                    title="Clear selection"
                  >✕</button>
                </div>
              )}
            </div>

            <PayloadField
              label="Custom Instructions (optional)"
              value={(node.data.customInstructions as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, customInstructions: v })}
              placeholder="Focus on remediation scripts for security gaps…"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">
                Generates a PowerShell script using AI and saves it to the Script Library under the <span className="font-mono text-[#22C55E]">Workflow Generated</span> category.
              </p>
              <p className="text-[10px] text-[#484F58]">
                Outputs: <span className="font-mono text-[#7D8590]">{"{{scriptId}}"}</span> (single script) or <span className="font-mono text-[#7D8590]">{"{{packageId}}"}</span> (multi-module package).
              </p>
            </div>
          </>
        )}

        {nodeType === "run_workflow" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Target Workflow ID</label>
              <input
                type="number"
                value={(node.data.workflowId as number | undefined) ?? ""}
                onChange={e => onChange(node.id, { ...node.data, workflowId: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="e.g. 12"
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 placeholder-[#484F58]"
              />
              <p className="text-[10px] text-[#484F58]">The numeric ID of the published workflow to execute. Find it in the Workflows list URL.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[#7D8590]">Input Mapping</label>
                <button
                  type="button"
                  onClick={() => {
                    const cur = (node.data.inputMapping as Array<{ key: string; expr: string }> | undefined) ?? [];
                    onChange(node.id, { ...node.data, inputMapping: [...cur, { key: "", expr: "" }] });
                  }}
                  className="text-[10px] text-[#0078D4] hover:text-[#3B9EDB] transition-colors"
                >
                  + Add mapping
                </button>
              </div>
              {((node.data.inputMapping as Array<{ key: string; expr: string }> | undefined) ?? []).map((m, idx) => (
                <div key={idx} className="flex gap-1.5 items-center">
                  <input
                    value={m.key}
                    onChange={e => {
                      const cur = [...((node.data.inputMapping as Array<{ key: string; expr: string }> | undefined) ?? [])];
                      cur[idx] = { ...cur[idx]!, key: e.target.value };
                      onChange(node.id, { ...node.data, inputMapping: cur });
                    }}
                    placeholder="key"
                    className="w-1/3 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[10px] text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 placeholder-[#484F58] font-mono"
                  />
                  <input
                    value={m.expr}
                    onChange={e => {
                      const cur = [...((node.data.inputMapping as Array<{ key: string; expr: string }> | undefined) ?? [])];
                      cur[idx] = { ...cur[idx]!, expr: e.target.value };
                      onChange(node.id, { ...node.data, inputMapping: cur });
                    }}
                    placeholder={"{{value}}"}
                    className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[10px] text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 placeholder-[#484F58] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cur = [...((node.data.inputMapping as Array<{ key: string; expr: string }> | undefined) ?? [])];
                      cur.splice(idx, 1);
                      onChange(node.id, { ...node.data, inputMapping: cur });
                    }}
                    className="text-red-400 hover:text-red-300 text-xs px-1"
                  >✕</button>
                </div>
              ))}
              <p className="text-[10px] text-[#484F58]">Map values from the current context into the sub-workflow's input payload. The sub-workflow outputs are merged back and <span className="font-mono text-[#7D8590]">{"{{childRunId}}"}</span> is always available.</p>
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Runs the target workflow <strong className="text-[#7D8590]">synchronously</strong> — the parent run waits for it to complete. On failure, routes to the <span className="font-mono text-[#7D8590]">onError</span> edge (if wired). Outputs: <span className="font-mono text-[#7D8590]">{"{{childRunId}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── CRM nodes ─────────────────────────────────────── */}

        {nodeType === "score_lead" && (
          <>
            <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Qualification Threshold</label>
                <FieldHint text="Lead score (0–100). Leads scoring at or above this are flagged as qualified; those below are unqualified." />
              </div>
              <input
                type="number" min={0} max={100}
                value={(node.data.threshold as number) ?? 50}
                onChange={e => onChange(node.id, { ...node.data, threshold: Number(e.target.value) })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              />
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Scores the lead on fit, pain, intent, and urgency. Writes a qualification record. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{score}}"} · {"{{scoreLabel}}"} · {"{{qualified}}"}</p>
            </div>
          </>
        )}

        {nodeType === "assign_pipeline_stage" && (() => {
          const tgt = (node.data.targetType as string | undefined) ?? "opportunity";
          const oppStages = ["DiscoveryCall","Proposal","QuickWin","Retainer","Onboarding","Closed Won","Closed Lost"];
          const leadStages = ["Junk","Cold","Warm","Hot"];
          const stageList = tgt === "lead" ? leadStages : oppStages;
          const currentStage = (node.data.stage as string | undefined) ?? stageList[0];
          return (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-[#7D8590]">Target type</label>
                  <FieldHint text="Whether to move a Lead or an Opportunity to the new stage." />
                </div>
                <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                  {(["opportunity","lead"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => onChange(node.id, { ...node.data, targetType: t, stage: t === "lead" ? "Warm" : "DiscoveryCall" })}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${tgt === t ? "bg-[#0078D4] text-white" : "bg-[#0D1117] text-[#7D8590] hover:text-[#E6EDF3]"}`}
                    >
                      {t === "opportunity" ? "Opportunity" : "Lead"}
                    </button>
                  ))}
                </div>
              </div>
              {tgt === "lead"
                ? <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
                : <PayloadField label="Opportunity ID" value={(node.data.opportunityId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, opportunityId: v })} placeholder="{{opportunityId}}" ancestorOutputs={ancestorOutputs} />
              }
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-[#7D8590]">New stage</label>
                  <FieldHint text="The pipeline stage to move the record into. Available stages change based on the target type above." />
                </div>
                <select
                  value={stageList.includes(currentStage) ? currentStage : stageList[0]}
                  onChange={e => onChange(node.id, { ...node.data, stage: e.target.value })}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                >
                  {stageList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                <p className="text-[10px] text-[#484F58]">
                  Moves a {tgt} to the chosen stage. Outputs: <span className="font-mono text-[#7D8590]">{"{{stage}}"} · {"{{targetType}}"} · {"{{" + (tgt === "lead" ? "leadId" : "opportunityId") + "}}"}</span>.
                </p>
              </div>
            </>
          );
        })()}

        {nodeType === "create_opportunity" && (
          <>
            <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Workflow Type</label>
              <select
                value={(node.data.workflowType as string) ?? "DiscoveryCall"}
                onChange={e => onChange(node.id, { ...node.data, workflowType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                {["DiscoveryCall","Proposal","QuickWin","Retainer","Onboarding"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Creates a new opportunity from a lead. Output: <span className="font-mono text-[#7D8590]">{"{{opportunityId}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── Diagnostics / Quiz nodes ───────────────────────── */}

        {nodeType === "parse_quiz_results" && (
          <>
            <PayloadField label="Quiz Lead ID" value={(node.data.quizLeadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, quizLeadId: v })} placeholder="{{quizLeadId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Reads the quiz lead record and surfaces scores. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{totalScore}}"} · {"{{tier}}"} · {"{{recommendedService}}"} · {"{{categoryScores}}"}</p>
            </div>
          </>
        )}

        {nodeType === "generate_readiness_score" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Averages the client's health history records to compute a composite readiness score and writes a summary record. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{readinessScore}}"} · {"{{readinessLabel}}"} · {"{{recordId}}"}</p>
            </div>
          </>
        )}

        {nodeType === "attach_quiz_insights" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Insight Text / Document Name" value={(node.data.insightText as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, insightText: v })} placeholder="M365 Readiness — {{tier}} ({{totalScore}})" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Saves quiz insights as a client document. Output: <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── M365 Health nodes ──────────────────────────────── */}

        {nodeType === "validate_m365_permissions" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="Validate-M365-Permissions" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Runs a permission-check runbook against the client's Azure tenant. Requires Azure secrets. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{permissionsValid}}"} · {"{{missingCount}}"} · {"{{jobId}}"}</p>
            </div>
          </>
        )}

        {nodeType === "update_intelligence_tables" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="Update-M365-Intelligence" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Triggers a health-data collection runbook and appends a new health history record. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{updated}}"} · {"{{recordId}}"} · {"{{jobId}}"}</p>
            </div>
          </>
        )}

        {nodeType === "generate_diff_report" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Compares the two most recent health snapshots for the client and creates a diff report document. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{documentId}}"} · {"{{changesFound}}"} · {"{{changeCount}}"}</p>
            </div>
          </>
        )}

        {nodeType === "notify_major_changes" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Notify Email" value={(node.data.notifyEmail as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, notifyEmail: v })} placeholder="shane@example.com" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Alert Threshold (changes)</label>
              <input
                type="number" min={1} max={100}
                value={(node.data.changeThreshold as number) ?? 15}
                onChange={e => onChange(node.id, { ...node.data, changeThreshold: Number(e.target.value) })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              />
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Sends an email alert if <span className="font-mono text-[#7D8590]">{"{{changeCount}}"}</span> (from a prior Diff Report node) meets or exceeds the threshold. Uses <span className="font-mono text-[#7D8590]">CRM_ADMIN_EMAIL</span> as fallback if no email is specified.</p>
            </div>
          </>
        )}

        {nodeType === "get_tenant_signals" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
              <p className="text-[10px] text-[#484F58]">Evaluates all configured signal rules for the client and outputs the fired signal keys. Pipe <span className="font-mono text-[#7D8590]">{"{{signals}}"}</span> into the <em>Pre-computed Signals</em> field of a downstream <em>Generate Document</em> (consolidated_sow) node to skip redundant signal evaluation. Outputs:</p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{signals}}"} · {"{{signalCount}}"} · {"{{hasSignals}}"}</p>
            </div>
          </>
        )}

        {/* ── Marketing Actions ──────────────────────────────── */}

        {nodeType === "send_campaign_email" && (
          <SendCampaignEmailPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {/* ── Project Actions ────────────────────────────────── */}

        {nodeType === "create_kanban_task" && (
          <CreateKanbanTaskPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "get_phases" && (
          <GetPhasesPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "get_project_tasks" && (
          <GetProjectTasksPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "update_project_task" && (
          <UpdateProjectTaskPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "create_phase" && (
          <CreatePhasePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "save_presentation_phases" && (
          <SavePhasesPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {/* ── Content ────────────────────────────────────────── */}

        {nodeType === "topic_picker" && (
          <TopicPickerPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "generate_article" && (
          <GenerateArticlePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "publish_article" && (
          <PublishArticlePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "generate_image" && (
          <GenerateImagePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "fetch_news_headlines" && (
          <FetchNewsPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
            nodes={nodes as unknown as StoredNode[]}
            edges={edges as unknown as StoredEdge[]}
            onGraphChange={onGraphChange}
          />
        )}

        {/* ── Marketing Actions (extended) ────────────────────── */}

        {nodeType === "define_campaign_goal" && (
          <DefineCampaignGoalPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "define_target_audience" && (
          <DefineTargetAudiencePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "create_campaign_offer" && (
          <CreateCampaignOfferPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "create_marketing_campaign" && (
          <CreateMarketingCampaignPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "publish_landing_page" && (
          <PublishLandingPagePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "generate_landing_page" && (
          <GenerateLandingPagePanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {/* ── Data ───────────────────────────────────────────── */}

        {nodeType === "ask_ai" && (
          <AskAiPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "find_object" && (
          <FindObjectPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {nodeType === "compose" && (
          <>
            <ExpressionField
              label="Inputs"
              hint="Any value, expression, or JSON. Reference upstream data with {{steps.nodeId.key}}. The result is exposed downstream as {{steps.<thisNodeId>.value}}."
              value={(node.data.inputs as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, inputs: v })}
              placeholder="{{steps.nodeId.value}} or any static text / JSON"
              multiline
              ancestorOutputs={ancestorOutputs}
              expressionType="value"
              fetchWithAuth={fetchWithAuth}
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(node.data.parseAsJson)}
                onChange={e => onChange(node.id, { ...node.data, parseAsJson: e.target.checked })}
                className="w-3.5 h-3.5 accent-[#2DD4BF] cursor-pointer"
              />
              <span className="text-[11px] text-[#C9D1D9]">Parse output as JSON</span>
            </label>
            {Boolean(node.data.parseAsJson) && (
              <div className="space-y-1">
                <label className="text-[11px] text-[#C9D1D9] font-medium">Validate JSON Schema <span className="text-[#7D8590] font-normal">(optional)</span></label>
                <textarea
                  rows={6}
                  value={(node.data.jsonSchema as string) ?? ""}
                  onChange={e => onChange(node.id, { ...node.data, jsonSchema: e.target.value })}
                  placeholder={'{\n  "type": "object",\n  "required": ["name"],\n  "properties": {\n    "name": { "type": "string" }\n  }\n}'}
                  spellCheck={false}
                  className="w-full rounded-md border border-[#2DD4BF]/30 bg-[#051424] px-2.5 py-2 text-[11px] font-mono text-[#C9D1D9] placeholder-[#3D444D] focus:outline-none focus:border-[#2DD4BF]/70 resize-y"
                />
                <p className="text-[10px] text-[#7D8590] leading-relaxed">
                  Paste a JSON Schema draft-07 object. If the parsed output doesn't match, the node will fail with a descriptive error before any downstream node runs.{" "}
                  <span className="text-[#7D8590]/70">Schema validation is skipped during dry-runs.</span>
                </p>
              </div>
            )}
            <p className="text-[10px] text-[#7D8590] leading-relaxed">
              Enter any value or expression. Reference upstream data with{" "}
              <span className="font-mono text-[#2DD4BF]">{"{{steps.nodeId.key}}"}</span>.
              The evaluated result is available downstream as{" "}
              <span className="font-mono text-[#2DD4BF]">{"{{steps.<thisNodeId>.value}}"}</span>.
              {Boolean(node.data.parseAsJson) && (
                <>{" "}When <span className="font-mono text-[#2DD4BF]">Parse as JSON</span> is on, the result is stored as a structured object; if parsing fails, the raw string is used instead.</>
              )}
            </p>
          </>
        )}

        {nodeType === "group_by" && (
          <>
            <ExpressionField
              label="Array"
              hint="The array to group. Use a {{variable}} that resolves to an array, e.g. {{steps.getTasks.flatTasks}}."
              value={(node.data.arrayExpression as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, arrayExpression: v })}
              placeholder="{{steps.nodeId.flatTasks}}"
              ancestorOutputs={ancestorOutputs}
              expressionType="value"
              fetchWithAuth={fetchWithAuth}
            />
            <ExpressionField
              label="Group Key"
              hint="Expression evaluated for each item to determine its group. Use {{currentItem.*}} to access item fields."
              value={(node.data.keyExpression as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, keyExpression: v })}
              placeholder="{{currentItem.taskMetadata.linkedRunbook.azureRunbookName}}"
              ancestorOutputs={ancestorOutputs}
              expressionType="value"
              fetchWithAuth={fetchWithAuth}
            />
            <div className="space-y-1">
              <label className="text-xs text-[#E6EDF3] font-medium">Sort groups by key</label>
              <div className="flex gap-2">
                {(["none", "asc", "desc"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onChange(node.id, { ...node.data, sortGroups: opt })}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      ((node.data.sortGroups as string | undefined) ?? "none") === opt
                        ? "bg-[#818CF8] border-[#818CF8] text-white"
                        : "bg-transparent border-[#30363D] text-[#7D8590] hover:border-[#818CF8] hover:text-[#E6EDF3]"
                    }`}
                  >
                    {opt === "none" ? "None" : opt === "asc" ? "A → Z" : "Z → A"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#7D8590]">Controls the order groups appear in the output array.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[#E6EDF3] font-medium">Null key behaviour</label>
              <div className="flex gap-2">
                {(["collect", "skip", "error"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onChange(node.id, { ...node.data, nullKeyBehaviour: opt })}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      ((node.data.nullKeyBehaviour as string | undefined) ?? "collect") === opt
                        ? "bg-[#818CF8] border-[#818CF8] text-white"
                        : "bg-transparent border-[#30363D] text-[#7D8590] hover:border-[#818CF8] hover:text-[#E6EDF3]"
                    }`}
                  >
                    {opt === "collect" ? "Collect" : opt === "skip" ? "Skip" : "Error"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#7D8590]">
                What to do when an item's key resolves to blank or null.{" "}
                <span className="font-medium text-[#E6EDF3]">Collect</span> puts them in a "(no key)" group (default),{" "}
                <span className="font-medium text-[#E6EDF3]">Skip</span> silently omits them,{" "}
                <span className="font-medium text-[#E6EDF3]">Error</span> fails the node immediately.
              </p>
            </div>
            <p className="text-[10px] text-[#7D8590] leading-relaxed">
              Outputs <span className="font-mono text-[#818CF8]">{"{{steps.<id>.groups}}"}</span> — an array of{" "}
              <span className="font-mono text-[#818CF8]">{"{ key, items }"}</span> objects.{" "}
              Feed into a <span className="font-mono text-[#818CF8]">ForEach</span> and access{" "}
              <span className="font-mono text-[#818CF8]">{"{{currentItem.key}}"}</span> and{" "}
              <span className="font-mono text-[#818CF8]">{"{{currentItem.items}}"}</span> inside the loop.
            </p>
          </>
        )}

        {/* ── Social Media ────────────────────────────────────── */}

        {nodeType === "post_linkedin" && (
          <>
            <PayloadField
              label="Post Body"
              hint="Text of the LinkedIn post. Supports {{variables}} from upstream nodes. Max ~3,000 characters. Mention people with their full name or LinkedIn profile handle."
              value={(node.data.postBody as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, postBody: v })}
              placeholder="Excited to share our latest article on Microsoft 365 — {{articleTitle}}"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <ImageUrlField
              value={(node.data.imageUrl as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, imageUrl: v })}
              placeholder="https://… or {{ogImageUrl}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="LinkedIn Org ID (optional)"
              hint="Numeric company page ID. Leave blank to use the LINKEDIN_ORG_ID secret. Find it in the URL of your company admin page on LinkedIn."
              value={(node.data.orgId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, orgId: v })}
              placeholder="Leave blank to use the LINKEDIN_ORG_ID secret"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#051424] border border-[#0A66C2]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Requires <span className="font-mono text-[#0A66C2]">LINKEDIN_ACCESS_TOKEN</span> and <span className="font-mono text-[#0A66C2]">LINKEDIN_ORG_ID</span> in Replit Secrets. Obtain a long-lived page token from the LinkedIn Developer Portal. When an Image URL is provided the image is uploaded via the LinkedIn Assets API and attached to the post.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{linkedinPostId}}"} · {"{{linkedinPostUrl}}"}</p>
            </div>
          </>
        )}

        {nodeType === "post_twitter" && (
          <>
            <PayloadField
              label="Tweet Text (max 280 chars)"
              hint="Text of the tweet. Hard limit is 280 characters — URLs count as 23 chars. Supports {{variables}} from upstream nodes."
              value={(node.data.postBody as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, postBody: v })}
              placeholder="New article: {{articleTitle}} — read it here: https://shanemccawconsulting.com/resources/{{articleSlug}}"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <ImageUrlField
              value={(node.data.imageUrl as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, imageUrl: v })}
              placeholder="https://… or {{ogImageUrl}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#0D0D0D] border border-[#E7E7E7]/20 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Requires five secrets in Replit Secrets: <span className="font-mono text-[#E7E7E7]">TWITTER_API_KEY</span>, <span className="font-mono text-[#E7E7E7]">TWITTER_API_SECRET</span>, <span className="font-mono text-[#E7E7E7]">TWITTER_ACCESS_TOKEN</span>, <span className="font-mono text-[#E7E7E7]">TWITTER_ACCESS_TOKEN_SECRET</span>, and (optionally) <span className="font-mono text-[#E7E7E7]">TWITTER_BEARER_TOKEN</span>. Create an app with Read &amp; Write access in the Twitter Developer Portal. When an Image URL is provided it is uploaded via the v1.1 media upload API and attached to the tweet.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{twitterTweetId}}"} · {"{{twitterTweetUrl}}"}</p>
            </div>
          </>
        )}

        {nodeType === "post_facebook" && (
          <>
            <PayloadField
              label="Post Body"
              hint="Text of the Facebook page post. Supports {{variables}} from upstream nodes. Attach an image via the Image URL field below."
              value={(node.data.postBody as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, postBody: v })}
              placeholder="New article on Microsoft 365: {{articleTitle}}"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <ImageUrlField
              value={(node.data.imageUrl as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, imageUrl: v })}
              placeholder="https://… or {{ogImageUrl}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Facebook Page ID (optional)"
              hint="Numeric Facebook Page ID. Leave blank to use the FACEBOOK_PAGE_ID secret. Find it in Page Settings → Page Transparency → Page ID."
              value={(node.data.pageId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, pageId: v })}
              placeholder="Leave blank to use the FACEBOOK_PAGE_ID secret"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#071533] border border-[#1877F2]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Requires <span className="font-mono text-[#1877F2]">FACEBOOK_PAGE_ACCESS_TOKEN</span> and <span className="font-mono text-[#1877F2]">FACEBOOK_PAGE_ID</span> in Replit Secrets. Generate a permanent Page access token via Meta for Developers → Graph API Explorer. When an Image URL is provided the post is created via the <span className="font-mono text-[#1877F2]">/photos</span> endpoint with the image attached.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{facebookPostId}}"} · {"{{facebookPostUrl}}"}</p>
            </div>
          </>
        )}

        {/* ── Set Variable / Update Variable ──────────────────── */}

        {(nodeType === "set_variable" || nodeType === "update_variable") && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-[#C9D1D9] font-medium">Variable Name</label>
              <input
                type="text"
                value={(node.data.variableName as string) ?? ""}
                onChange={e => onChange(node.id, { ...node.data, variableName: e.target.value.replace(/\s+/g, "_") })}
                placeholder="my_variable"
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-2.5 py-1.5 text-[11px] font-mono text-[#C9D1D9] placeholder-[#3D444D] focus:outline-none focus:border-[#34D399]/60"
              />
              <p className="text-[10px] text-[#7D8590]">
                Used as a top-level payload key — accessible downstream as{" "}
                <span className="font-mono text-[#34D399]">{"{{variableName}}"}</span> or{" "}
                <span className="font-mono text-[#34D399]">{"{{steps.<thisNodeId>.value}}"}</span>.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-[#C9D1D9] font-medium">Type</label>
              <select
                value={(node.data.variableType as string) ?? "string"}
                onChange={e => onChange(node.id, { ...node.data, variableType: e.target.value })}
                className="w-full rounded-md border border-[#30363D] bg-[#0D1117] px-2.5 py-1.5 text-[11px] text-[#C9D1D9] focus:outline-none focus:border-[#34D399]/60"
              >
                <option value="string">String</option>
                <option value="int">Integer</option>
                <option value="float">Float</option>
                <option value="boolean">Boolean</option>
                <option value="array">Array (JSON)</option>
                <option value="object">Object (JSON)</option>
                <option value="json">JSON (auto-detect)</option>
                <option value="null">Null</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-[#C9D1D9] font-medium">
                Value
                {["array", "object", "json"].includes((node.data.variableType as string) ?? "string") && (
                  <span className="ml-1 text-[#7D8590] font-normal">— must be valid JSON</span>
                )}
              </label>
              {["array", "object", "json"].includes((node.data.variableType as string) ?? "string") ? (
                <>
                  <textarea
                    rows={4}
                    value={(node.data.variableValue as string) ?? ""}
                    onChange={e => onChange(node.id, { ...node.data, variableValue: e.target.value, _jsonError: undefined })}
                    onBlur={e => {
                      const val = e.target.value.trim();
                      if (!val) { onChange(node.id, { ...node.data, _jsonError: undefined }); return; }
                      try { JSON.parse(val); onChange(node.id, { ...node.data, _jsonError: undefined }); }
                      catch (err) { onChange(node.id, { ...node.data, _jsonError: (err as Error).message }); }
                    }}
                    placeholder={
                      (node.data.variableType as string) === "array"
                        ? '["item1", "item2"]'
                        : (node.data.variableType as string) === "object"
                          ? '{"key": "value"}'
                          : "[]  or  {}  or  42  or  \"text\""
                    }
                    spellCheck={false}
                    className={`w-full rounded-md border bg-[#0D1117] px-2.5 py-2 text-[11px] font-mono text-[#C9D1D9] placeholder-[#3D444D] focus:outline-none resize-y ${node.data._jsonError ? "border-[#EF4444]/70 focus:border-[#EF4444]" : "border-[#30363D] focus:border-[#34D399]/60"}`}
                  />
                  {node.data._jsonError && (
                    <p className="text-[10px] text-[#EF4444] font-mono break-all">{node.data._jsonError as string}</p>
                  )}
                </>
              ) : (
                <PayloadField
                  label=""
                  hint=""
                  value={(node.data.variableValue as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, variableValue: v })}
                  placeholder={
                    (node.data.variableType as string) === "boolean"
                      ? "true or false"
                      : (node.data.variableType as string) === "null"
                        ? "(always null — value ignored)"
                        : (node.data.variableType as string) === "int" || (node.data.variableType as string) === "float"
                          ? "42 or {{steps.nodeId.value}}"
                          : "any text or {{steps.nodeId.value}}"
                  }
                  ancestorOutputs={ancestorOutputs}
                />
              )}
            </div>

            <div className={`rounded-lg p-3 space-y-1 border ${nodeType === "update_variable" ? "bg-[#1A0E00] border-[#F97316]/30" : "bg-[#0A1A10] border-[#34D399]/30"}`}>
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                The resolved value is coerced to the selected type at run-time.
                For <span className="font-mono">array / object / json</span>, the executor JSON-parses the interpolated string — invalid JSON causes the node to fail with a descriptive error.
                For <span className="font-mono">int / float</span>, NaN results are also treated as errors.
                The{" "}
                <span className={`font-mono ${nodeType === "update_variable" ? "text-[#F97316]" : "text-[#34D399]"}`}>
                  Update Variable
                </span>{" "}
                node is identical in behaviour to Set Variable — the amber accent is purely visual so mutations stand out in long flows.
              </p>
            </div>
          </>
        )}

        {/* ── Ask for Input ───────────────────────────────────── */}

        {nodeType === "ask_for_input" && (
          <AskForInputPanel node={node} onChange={onChange} />
        )}

        {nodeType === "switch_case" && (
          <SwitchCasePanel node={node} onChange={onChange} ancestorOutputs={ancestorOutputs} nodes={nodes} fetchWithAuth={fetchWithAuth} />
        )}

        {nodeType === "approval_gate" && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Gate Label</label>
                <FieldHint text="Name shown on the approval card — helps approvers understand what they are reviewing." />
              </div>
              <input
                value={(node.data.label as string) ?? ""}
                onChange={e => onChange(node.id, { ...node.data, label: e.target.value })}
                placeholder="Approval Gate"
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#F59E0B]/60 placeholder-[#484F58]"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Approver Role <span className="text-[#484F58] font-normal">(locked)</span></label>
                <FieldHint text="Who can approve this gate. Currently locked to admin — only admins can approve or reject." />
              </div>
              <input
                value="admin"
                disabled
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#484F58] outline-none cursor-not-allowed"
              />
              <p className="text-[9px] text-[#484F58] leading-snug">Only admins can approve or reject approval gates.</p>
            </div>
            <ConfigField
              label="Timeout (seconds)"
              type="number"
              value={String(node.data.timeoutSeconds ?? 3600)}
              onChange={v => onChange(node.id, { ...node.data, timeoutSeconds: parseInt(v, 10) || 3600 })}
            />
            <p className="text-[9px] text-[#484F58] leading-snug">
              Auto-rejects the run after this many seconds with no decision. Default: 3600 (1 hour).
            </p>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3 space-y-1.5">
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Connect the output handle to nodes that run <span className="text-emerald-400 font-semibold">when approved</span>. Downstream nodes receive <span className="font-mono text-[#7D8590]">{"{{approved}}"}</span> (always true) and <span className="font-mono text-[#7D8590]">{"{{decisionNote}}"}</span>.
              </p>
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Rejection and timeout both <span className="text-red-400 font-semibold">fail the run</span> — no downstream nodes execute on rejection.
              </p>
            </div>
          </>
        )}

        {nodeType === "parallel" && (
          <ParallelPanel node={node} onChange={onChange} nodes={nodes} edges={edges} onGraphChange={onGraphChange} />
        )}

        {nodeType === "foreach" && (
          <>
            <PayloadField
              label="Array path"
              hint="The variable containing the array to iterate over — e.g. {{newsHeadlines}}. Each element is injected as {{item}} into the loop body nodes."
              value={(node.data.arrayPath as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, arrayPath: v })}
              placeholder="{{newsHeadlines}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Item alias <span className="text-[#484F58] font-normal">(optional)</span></label>
                <FieldHint text="Short name for each loop item — accessible as {{alias.fieldName}} inside the loop body alongside the default {{item}}." />
              </div>
              <input
                value={(node.data.itemAlias as string) ?? ""}
                onChange={e => onChange(node.id, { ...node.data, itemAlias: e.target.value })}
                placeholder="headline"
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 placeholder-[#484F58]"
              />
              <p className="text-[9px] text-[#484F58] leading-snug">
                If set, each element is also injected as <span className="font-mono text-[#7D8590]">{"{{<alias>}}"}</span> alongside <span className="font-mono text-[#7D8590]">{"{{item}}"}</span>.
              </p>
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3 space-y-1.5">
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Connect the <span className="font-semibold" style={{ color: "#A855F7" }}>Loop</span> handle to the first node of the loop body — downstream nodes receive <span className="font-mono text-[#7D8590]">{"{{item}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{itemIndex}}"}</span>, and <span className="font-mono text-[#7D8590]">{"{{itemsTotal}}"}</span> per iteration.
              </p>
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Connect the <span className="font-semibold text-emerald-400">Done</span> handle to nodes that run after all iterations complete — they receive <span className="font-mono text-[#7D8590]">{"{{collectedResults}}"}</span>.
              </p>
            </div>
          </>
        )}

        {nodeType === "retry" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Max Attempts</label>
              <input
                type="number" min={1}
                value={(node.data.maxAttempts as number) ?? 3}
                onChange={e => onChange(node.id, { ...node.data, maxAttempts: Math.max(1, Number(e.target.value)) })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Delay between retries (seconds)</label>
              </div>
              <input
                type="number" min={0}
                value={(node.data.delaySeconds as number) ?? 0}
                onChange={e => onChange(node.id, { ...node.data, delaySeconds: Math.max(0, Number(e.target.value)) })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              />
            </div>
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3 space-y-1.5">
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Connect the <span className="font-semibold text-red-400">Exhausted</span> handle to the first node of your error-handling subgraph — it receives <span className="font-mono text-[#7D8590]">{`{{_retry.${node.id}.count}}`}</span> and <span className="font-mono text-[#7D8590]">{`{{_retry.${node.id}.lastError}}`}</span>.
              </p>
              <p className="text-[10px] text-[#484F58] leading-relaxed">
                Connect the <span className="font-semibold text-emerald-400">Done</span> handle to nodes that run after the exhausted subgraph completes (or after a successful retry, the source node's normal path is used directly).
              </p>
            </div>
          </>
        )}

        {/* ── Utilities ───────────────────────────────────────── */}

        {nodeType === "comment" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Comment</label>
              <textarea
                rows={4}
                value={((node.data.params as Record<string, unknown> | undefined)?.text as string) ?? ""}
                onChange={e => onChange(node.id, { ...node.data, params: { ...((node.data.params as Record<string, unknown>) ?? {}), text: e.target.value } })}
                placeholder="Add a note about this workflow step…"
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#CA8A04]/60 resize-none leading-relaxed"
              />
            </div>
            <div className="rounded-lg bg-[#1A1600] border border-[#CA8A04]/20 p-2.5">
              <p className="text-[10px] text-[#7D8590]">This node is decorative — it is skipped entirely when the workflow runs and produces no output variables.</p>
            </div>
          </>
        )}

        {/* ── Calendar nodes ──────────────────────────────────── */}

        {nodeType === "check_exchange_calendar_availability" && (
          <>
            <PayloadField
              label="User UPN (mailbox to check)"
              value={(node.data.userUpn as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, userUpn: v })}
              placeholder="shane@contoso.com or {{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Start Date/Time (UTC ISO)"
              value={(node.data.startDateTime as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, startDateTime: v })}
              placeholder="2025-09-01T09:00:00 or {{meetingStart}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="End Date/Time (UTC ISO)"
              value={(node.data.endDateTime as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, endDateTime: v })}
              placeholder="2025-09-01T17:00:00 or {{meetingEnd}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041620] border border-[#0078D4]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Calls the Microsoft Graph <span className="font-mono text-[#0078D4]">getSchedule</span> endpoint. Requires <span className="font-mono text-[#0078D4]">GRAPH_CLIENT_ID</span>, <span className="font-mono text-[#0078D4]">GRAPH_CLIENT_SECRET</span>, and <span className="font-mono text-[#0078D4]">GRAPH_TENANT_ID</span> secrets with <span className="font-mono">Calendars.Read</span> application permission.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{isBusy}}"} · {"{{availableSlots}}"} · {"{{busySlots}}"}</p>
            </div>
          </>
        )}

        {nodeType === "create_exchange_calendar_event" && (
          <>
            <PayloadField
              label="User UPN (mailbox owner)"
              value={(node.data.userUpn as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, userUpn: v })}
              placeholder="shane@contoso.com or {{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Event Subject"
              value={(node.data.subject as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, subject: v })}
              placeholder="M365 Kickoff Call — {{clientName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Body / Description"
              value={(node.data.body as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, body: v })}
              placeholder="Welcome! Here's the agenda..."
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Start Date/Time (UTC ISO)"
              value={(node.data.startDateTime as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, startDateTime: v })}
              placeholder="2025-09-01T09:00:00 or {{meetingStart}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="End Date/Time (UTC ISO)"
              value={(node.data.endDateTime as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, endDateTime: v })}
              placeholder="2025-09-01T10:00:00 or {{meetingEnd}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Attendee Emails (comma-separated)"
              value={(node.data.attendees as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, attendees: v })}
              placeholder="client@example.com, {{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041620] border border-[#00B4D8]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Creates an event in the mailbox via the Graph <span className="font-mono text-[#00B4D8]">POST /users/&#123;upn&#125;/events</span> endpoint. Requires <span className="font-mono text-[#00B4D8]">Calendars.ReadWrite</span> application permission.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{eventId}}"} · {"{{eventUrl}}"} · {"{{eventWebLink}}"}</p>
            </div>
          </>
        )}

        {/* ── SharePoint nodes ─────────────────────────────────── */}

        {nodeType === "save_to_sharepoint" && (
          <>
            <PayloadField
              label="Site ID"
              value={(node.data.siteId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, siteId: v })}
              placeholder="contoso.sharepoint.com,site-id,web-id or {{siteId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Drive ID"
              value={(node.data.driveId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, driveId: v })}
              placeholder="b!drive-id or {{driveId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Folder Path (optional)"
              value={(node.data.folderPath as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, folderPath: v })}
              placeholder="Clients/ACME Corp/Reports"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="File Name"
              value={(node.data.fileName as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, fileName: v })}
              placeholder="report.pdf or {{fileName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="File Content (base64)"
              value={(node.data.fileContentBase64 as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, fileContentBase64: v })}
              placeholder="{{pdfBase64}} — use generate_pdf output"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="File Content (text, if not base64)"
              value={(node.data.fileContentText as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, fileContentText: v })}
              placeholder="Plain text or Markdown content"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Content-Type"
              value={(node.data.contentType as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, contentType: v })}
              placeholder="application/pdf or text/plain"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#0A1A10] border border-[#34D399]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Uploads via Graph <span className="font-mono text-[#34D399]">PUT /sites/&#123;id&#125;/drives/&#123;driveId&#125;/items/root:/&#123;path&#125;/content</span>. Requires <span className="font-mono text-[#34D399]">Files.ReadWrite.All</span> application permission.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{sharePointItemId}}"} · {"{{sharePointWebUrl}}"} · {"{{sharePointDownloadUrl}}"}</p>
            </div>
          </>
        )}

        {nodeType === "get_from_sharepoint" && (
          <>
            <PayloadField
              label="Site ID"
              value={(node.data.siteId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, siteId: v })}
              placeholder="contoso.sharepoint.com,site-id,web-id or {{siteId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Drive ID"
              value={(node.data.driveId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, driveId: v })}
              placeholder="b!drive-id or {{driveId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Item ID (optional)"
              value={(node.data.itemId as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, itemId: v })}
              placeholder="01ABC123… (use item ID or path below)"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Item Path (optional)"
              value={(node.data.itemPath as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, itemPath: v })}
              placeholder="Clients/ACME/report.pdf or {{fileName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#0A1A10] border border-[#6EE7B7]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Downloads the file and returns its contents as a <span className="font-mono text-[#6EE7B7]">base64</span> string. Provide either the Item ID (faster) or the full drive path. Requires <span className="font-mono text-[#6EE7B7]">Files.Read.All</span> application permission.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{fileContentBase64}}"} · {"{{fileName}}"} · {"{{mimeType}}"} · {"{{sharePointWebUrl}}"}</p>
            </div>
          </>
        )}

        {/* ── Document nodes ───────────────────────────────────── */}

        {nodeType === "generate_pdf" && (
          <>
            <PayloadField
              label="HTML Template"
              value={(node.data.htmlTemplate as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, htmlTemplate: v })}
              placeholder="<h1>{{clientName}}</h1><p>Project Report...</p>"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Output File Name"
              value={(node.data.fileName as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, fileName: v })}
              placeholder="{{clientName}}-report.pdf"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#1A0D00] border border-[#F97316]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Strips HTML tags and renders text content using <span className="font-mono text-[#F97316]">pdf-lib</span> with A4 page dimensions. Supports <span className="font-mono text-[#F97316]">h1</span>, <span className="font-mono text-[#F97316]">h2</span>, <span className="font-mono text-[#F97316]">strong</span>, paragraph wrapping, bullet lists, and horizontal rules. Outputs a base64 string and a <span className="font-mono text-[#F97316]">data:</span> URI — pipe into Save to SharePoint or Send Email.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{pdfBase64}}"} · {"{{pdfDataUri}}"} · {"{{fileName}}"}</p>
            </div>
          </>
        )}

        {nodeType === "build_presentation" && (
          <>
            <PayloadField
              label="Client Name"
              value={(node.data.clientName as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, clientName: v })}
              placeholder="Acme Corporation or {{clientName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Client Email"
              value={(node.data.clientEmail as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, clientEmail: v })}
              placeholder="{{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Project Title"
              value={(node.data.projectTitle as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, projectTitle: v })}
              placeholder="Microsoft 365 Modernisation Proposal or {{projectTitle}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Checkout URL (optional)"
              value={(node.data.checkoutUrl as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, checkoutUrl: v })}
              placeholder="{{paymentLinkUrl}} — from Generate Payment Link node"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Valid Until (ISO date, optional)"
              value={(node.data.validUntil as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, validUntil: v })}
              placeholder="2025-09-30 — defaults to 30 days"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Total Amount (optional)"
              value={(node.data.totalAmount as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, totalAmount: v })}
              placeholder="9500 or {{totalAmount}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Currency (optional)"
              value={(node.data.currency as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, currency: v })}
              placeholder="USD"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Scores JSON (optional)"
              value={(node.data.scores as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, scores: v })}
              placeholder='{"Identity": 78, "Collaboration": 55} or {{scoresJson}}'
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Line Items JSON (optional)"
              value={(node.data.lineItems as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, lineItems: v })}
              placeholder='[{"label":"M365 Audit","amount":2500},{"label":"Training","amount":1500}]'
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Documents JSON (optional)"
              value={(node.data.documents as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, documents: v })}
              placeholder='[{"name":"M365 Health Report"},{"name":"Governance Roadmap"}]'
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#0A1420] border border-[#818CF8]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Generates a branded proposal page, saves it to the database, and returns a public URL. Combine with <span className="font-mono text-[#818CF8]">generate_stripe_payment_link</span> to embed a checkout button, and <span className="font-mono text-[#818CF8]">send_email</span> to deliver the link to the client. Page expires after 30 days by default (or the date set in Valid Until).
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{presentationUrl}}"} · {"{{presentationId}}"} · {"{{presentationHtml}}"}</p>
            </div>
          </>
        )}

        {/* ── Payment nodes ─────────────────────────────────────── */}

        {nodeType === "generate_invoice_stripe_payment" && (
          <>
            <PayloadField
              label="Customer Email"
              hint="The client's email address. Used to look up or create the Stripe customer. Supports {{variables}} — e.g. {{clientEmail}}."
              value={(node.data.customerEmail as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, customerEmail: v })}
              placeholder="{{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Customer Name (optional)"
              hint="Optional display name on the Stripe invoice. Supports {{variables}} — e.g. {{clientName}}."
              value={(node.data.customerName as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, customerName: v })}
              placeholder="{{clientName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Days Until Due</label>
                <FieldHint text="How many calendar days from the run date the Stripe invoice is due. 0 means due immediately." />
              </div>
              <input
                type="number"
                min={0}
                value={String(node.data.daysUntilDue ?? 7)}
                onChange={e => onChange(node.id, { ...node.data, daysUntilDue: parseInt(e.target.value, 10) || 7 })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#34D399]/60"
              />
            </div>
            <PayloadField
              label="Line Items (JSON array)"
              hint='JSON array of line items. Each item needs: description, amount (in smallest currency unit — e.g. 250000 = $2,500.00), and currency. Supports {{variables}}.'
              value={(node.data.lineItems as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, lineItems: v })}
              placeholder='[{"description":"M365 Assessment","amount":250000,"currency":"usd"}]'
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#34D399]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Creates a Stripe customer (or looks up existing by email), creates a draft invoice, adds line items, finalises it, and sends it to the customer. Amount is in <span className="font-mono text-[#34D399]">smallest currency unit</span> (e.g. 250000 = $2,500.00 USD). Requires <span className="font-mono text-[#34D399]">STRIPE_SECRET_KEY</span> or <span className="font-mono text-[#34D399]">STRIPE_SECRET_KEY_PROD</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{invoiceId}}"} · {"{{invoiceUrl}}"} · {"{{invoicePdfUrl}}"} · {"{{amountDue}}"} · {"{{currency}}"}</p>
            </div>
          </>
        )}

        {nodeType === "generate_stripe_payment_link" && (
          <>
            <PayloadField
              label="Product Name"
              hint="Name of the product or service shown on the Stripe payment page. Supports {{variables}}."
              value={(node.data.productName as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, productName: v })}
              placeholder="M365 Governance Review or {{projectTitle}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Amount (smallest currency unit)"
              hint="Price in the smallest unit of the currency — e.g. 95000 = $950.00 USD. Supports {{variables}}."
              value={(node.data.amount as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, amount: v })}
              placeholder="95000 (= $950.00 USD) or {{totalAmount}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Currency"
              hint="Three-letter ISO currency code — e.g. usd, gbp, eur. Must match the Stripe account's supported currencies."
              value={(node.data.currency as string) ?? "usd"}
              onChange={v => onChange(node.id, { ...node.data, currency: v })}
              placeholder="usd"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Quantity</label>
                <FieldHint text="Number of units for this line item on the Stripe payment link." />
              </div>
              <input
                type="number"
                min={1}
                value={String(node.data.quantity ?? 1)}
                onChange={e => onChange(node.id, { ...node.data, quantity: parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#2DD4BF]/60"
              />
            </div>
            <PayloadField
              label="Metadata JSON (optional)"
              value={(node.data.metadata as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, metadata: v })}
              placeholder='{"clientId":"{{clientId}}","projectId":"{{projectId}}"}'
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#2DD4BF]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Creates a Stripe product, a price, and a Payment Link in one step. The link can be embedded in emails, proposals, or the <span className="font-mono text-[#2DD4BF]">build_presentation</span> node's checkout URL. Requires <span className="font-mono text-[#2DD4BF]">STRIPE_SECRET_KEY</span> or <span className="font-mono text-[#2DD4BF]">STRIPE_SECRET_KEY_PROD</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{paymentLinkId}}"} · {"{{paymentLinkUrl}}"}</p>
            </div>
          </>
        )}

        {nodeType === "create_phased_invoices" && (
          <>
            <PayloadField
              label="Project ID"
              hint="The project ID this SOW belongs to. Supports {{variables}} — e.g. {{projectId}}."
              value={(node.data.projectId as string) ?? "{{projectId}}"}
              onChange={v => onChange(node.id, { ...node.data, projectId: v })}
              placeholder="{{projectId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Client Email"
              hint="Used to look up or create the Stripe customer. Supports {{variables}} — e.g. {{clientEmail}}."
              value={(node.data.clientEmail as string) ?? "{{clientEmail}}"}
              onChange={v => onChange(node.id, { ...node.data, clientEmail: v })}
              placeholder="{{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Client Name (optional)"
              hint="Display name on the Stripe customer. Supports {{variables}} — e.g. {{clientName}}."
              value={(node.data.clientName as string) ?? "{{clientName}}"}
              onChange={v => onChange(node.id, { ...node.data, clientName: v })}
              placeholder="{{clientName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Deposit Session ID"
              hint="Stripe Checkout session ID from the 20% deposit payment. Used to retrieve and save the payment method for future auto-charges. Supports {{variables}} — e.g. {{stripeSessionId}}."
              value={(node.data.depositSessionId as string) ?? "{{stripeSessionId}}"}
              onChange={v => onChange(node.id, { ...node.data, depositSessionId: v })}
              placeholder="{{stripeSessionId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#F59E0B]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Creates one Stripe draft invoice per SOW phase (80% total, distributed by phase amount). Sets <span className="font-mono text-[#F59E0B]">collection_method: charge_automatically</span> and <span className="font-mono text-[#F59E0B]">auto_advance: false</span>. Saves the deposit payment method as the Stripe Customer&apos;s default. Writes the <span className="font-mono text-[#F59E0B]">stripeInvoiceId</span> back to each workflow step row. Requires <span className="font-mono text-[#F59E0B]">STRIPE_SECRET_KEY</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{invoiceIds}}"} · {"{{phaseCount}}"} · {"{{totalScheduled}}"}</p>
            </div>
          </>
        )}

        {nodeType === "generate_phased_invoice" && (
          <>
            <PayloadField
              label="Client Email"
              hint="Used to look up the Stripe customer linked to the deposit session. Supports {{variables}} — e.g. {{clientEmail}}."
              value={(node.data.clientEmail as string) ?? "{{clientEmail}}"}
              onChange={v => onChange(node.id, { ...node.data, clientEmail: v })}
              placeholder="{{clientEmail}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Client Name (optional)"
              hint="Display name on the Stripe customer. Supports {{variables}} — e.g. {{clientName}}."
              value={(node.data.clientName as string) ?? "{{clientName}}"}
              onChange={v => onChange(node.id, { ...node.data, clientName: v })}
              placeholder="{{clientName}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Phase Title"
              hint="Label shown on the Stripe invoice line item. Supports {{variables}} — e.g. {{item.phaseTitle}}."
              value={(node.data.phaseTitle as string) ?? "{{item.phaseTitle}}"}
              onChange={v => onChange(node.id, { ...node.data, phaseTitle: v })}
              placeholder="{{item.phaseTitle}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Amount (cents)"
              hint="Invoice amount in smallest currency unit (e.g. 50000 = $500). Supports {{variables}} — e.g. {{item.amountCents}}."
              value={(node.data.amountCents as string) ?? "{{item.amountCents}}"}
              onChange={v => onChange(node.id, { ...node.data, amountCents: v })}
              placeholder="{{item.amountCents}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Deposit Session ID"
              hint="Stripe Checkout session ID from the 20% deposit. Used to retrieve the saved payment method. Supports {{variables}} — e.g. {{stripeSessionId}}."
              value={(node.data.depositSessionId as string) ?? "{{stripeSessionId}}"}
              onChange={v => onChange(node.id, { ...node.data, depositSessionId: v })}
              placeholder="{{stripeSessionId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Project ID (optional)"
              hint="If set, writes the Stripe invoice ID back to the matching workflow step row. Supports {{variables}} — e.g. {{projectId}}."
              value={(node.data.projectId as string) ?? "{{projectId}}"}
              onChange={v => onChange(node.id, { ...node.data, projectId: v })}
              placeholder="{{projectId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Phase ID (optional)"
              hint="Phase identifier stored in the invoice metadata. Supports {{variables}} — e.g. {{item.phaseId}}."
              value={(node.data.phaseId as string) ?? "{{item.phaseId}}"}
              onChange={v => onChange(node.id, { ...node.data, phaseId: v })}
              placeholder="{{item.phaseId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#A78BFA]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Creates a single Stripe draft invoice for one SOW phase. Use inside a <span className="font-mono text-[#A78BFA]">foreach</span> node iterating over phases. Sets <span className="font-mono text-[#A78BFA]">collection_method: charge_automatically</span> and <span className="font-mono text-[#A78BFA]">auto_advance: false</span>. Saves the deposit payment method as customer default. Writes <span className="font-mono text-[#A78BFA]">stripeInvoiceId</span> back to the matching workflow step when <span className="font-mono text-[#A78BFA]">projectId</span> is supplied. Requires <span className="font-mono text-[#A78BFA]">STRIPE_SECRET_KEY</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{invoiceId}}"} · {"{{customerId}}"} · {"{{amountCents}}"} · {"{{phaseTitle}}"}</p>
            </div>
          </>
        )}

        {nodeType === "charge_stripe_invoice" && (
          <>
            <PayloadField
              label="Invoice ID"
              hint="Stripe draft invoice ID to finalize and charge. Supports {{variables}} — e.g. {{stripeInvoiceId}}."
              value={(node.data.invoiceId as string) ?? "{{stripeInvoiceId}}"}
              onChange={v => onChange(node.id, { ...node.data, invoiceId: v })}
              placeholder="{{stripeInvoiceId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#EF4444]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Finalizes the Stripe draft invoice then immediately charges the customer&apos;s default payment method. On card decline or any Stripe error, returns <span className="font-mono text-[#EF4444]">chargeStatus: &quot;failed&quot;</span> instead of throwing, so a downstream condition node can branch and notify Shane. Requires <span className="font-mono text-[#EF4444]">STRIPE_SECRET_KEY</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{chargeStatus}}"} · {"{{amountCharged}}"} · {"{{stripePaymentIntentId}}"}</p>
            </div>
          </>
        )}

        {nodeType === "edit_stripe_invoice" && (
          <>
            <PayloadField
              label="Invoice ID"
              hint="Stripe draft invoice ID to update. Use {{stripeInvoiceId}} to reference the output of a Find Object (Stripe Invoice) node."
              value={(node.data.stripeInvoiceIdExpr as string) ?? "{{stripeInvoiceId}}"}
              onChange={v => onChange(node.id, { ...node.data, stripeInvoiceIdExpr: v })}
              placeholder="{{stripeInvoiceId}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Due Date"
              hint="New due date for the invoice. Accepts an ISO date string (e.g. {{newDueDate}} from a delivery_date_changed event), a Unix epoch in seconds, or any date string parseable by JavaScript. Leave blank to keep the existing due date."
              value={(node.data.dueDateExpr as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, dueDateExpr: v })}
              placeholder="{{newDueDate}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Description (optional)"
              hint="Updated invoice description shown on the Stripe-hosted invoice page. Leave blank to keep the existing description."
              value={(node.data.descriptionExpr as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, descriptionExpr: v })}
              placeholder="Phase 2 — delivery extended to {{newDueDate}}"
              ancestorOutputs={ancestorOutputs}
            />
            <PayloadField
              label="Footer (optional)"
              hint="Updated invoice footer text. Leave blank to keep the existing footer."
              value={(node.data.footerExpr as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, footerExpr: v })}
              placeholder="Thank you for your business."
              ancestorOutputs={ancestorOutputs}
            />
            <div className="rounded-lg bg-[#041A1A] border border-[#818CF8]/30 p-3 space-y-1.5">
              <p className="text-[10px] text-[#7D8590] leading-relaxed">
                Updates a <span className="font-mono text-[#818CF8]">draft</span> Stripe invoice. Only updates fields whose expression resolves to a non-empty string. Fails with an error if the invoice is not in draft status — wire a <span className="font-mono text-amber-400">condition</span> node on <span className="font-mono text-[#818CF8]">{"{{found}} == true"}</span> before this node if using Find Object. Requires <span className="font-mono text-[#818CF8]">STRIPE_SECRET_KEY</span>.
              </p>
              <p className="text-[10px] font-mono text-[#7D8590]">{"{{invoiceId}}"} · {"{{status}}"} · {"{{dueDate}}"}</p>
            </div>
          </>
        )}

        {nodeType === "condition" && (
          <>
            <ExpressionField
              label="Expression"
              value={(node.data.expression as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, expression: v })}
              placeholder="{{status}} == 'active' && {{count}} > 0"
              multiline
              ancestorOutputs={ancestorOutputs}
              expressionType="boolean"
              fetchWithAuth={fetchWithAuth}
            />
            <div className="flex items-center gap-2 pt-0.5">
              <input
                id={`cancel-on-false-${node.id}`}
                type="checkbox"
                checked={Boolean(node.data.cancelOnFalse)}
                onChange={e => onChange(node.id, { ...node.data, cancelOnFalse: e.target.checked })}
                className="w-3.5 h-3.5 rounded accent-amber-500"
              />
              <label htmlFor={`cancel-on-false-${node.id}`} className="text-xs text-[#7D8590] cursor-pointer">
                Cancel workflow when condition is false
              </label>
            </div>
            <p className="text-[10px] text-[#484F58] leading-relaxed">
              true → follow <span className="text-emerald-400 font-mono">true</span> edge &nbsp;·&nbsp;
              false → follow <span className="text-amber-400 font-mono">false</span> edge
              {node.data.cancelOnFalse ? " (or cancel if no false edge)" : ""}
            </p>
          </>
        )}

        {nodeType === "check_script_output" && (
          <>
            <PayloadField
              label="Script Output"
              value={(node.data.scriptOutput as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, scriptOutput: v })}
              placeholder="{{scriptOutput}} or paste raw output"
              multiline
              ancestorOutputs={ancestorOutputs}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Sensitivity</label>
              <select
                value={(node.data.sensitivity as string) ?? "balanced"}
                onChange={e => onChange(node.id, { ...node.data, sensitivity: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#2DD4BF]/60"
              >
                <option value="strict">Strict — any warning or non-zero exit fails</option>
                <option value="balanced">Balanced — major errors fail, warnings pass</option>
                <option value="lenient">Lenient — pass if substantial data present despite some failures</option>
                <option value="very_lenient">Very Lenient — only fail on total/catastrophic failure</option>
              </select>
            </div>
            <p className="text-[10px] text-[#484F58] leading-relaxed">
              AI evaluates the output and routes to <span className="text-[#2DD4BF] font-mono">Passed</span> or <span className="text-red-400 font-mono">On Failure</span>.
            </p>
          </>
        )}

        {nodeType === "delay" && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[#7D8590]">Mode</label>
                <FieldHint text="Fixed pauses for a set number of seconds. Until Timestamp waits until a specific ISO date. Until Condition polls until an expression becomes true." />
              </div>
              <select
                value={(node.data.mode as string) ?? "fixed"}
                onChange={e => onChange(node.id, { ...node.data, mode: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <option value="fixed">Fixed Duration</option>
                <option value="until_timestamp">Until Timestamp</option>
                <option value="until_condition">Until Condition</option>
              </select>
            </div>
            {(node.data.mode as string | undefined) === "fixed" || !(node.data.mode as string) ? (
              <ConfigField
                label="Duration (seconds)"
                value={String(node.data.duration ?? 0)}
                onChange={v => onChange(node.id, { ...node.data, duration: parseInt(v, 10) || 0 })}
                type="number"
              />
            ) : null}
            {(node.data.mode as string) === "until_timestamp" && (
              <ConfigField
                label="Wait Until (ISO timestamp or ms epoch)"
                placeholder="2025-12-31T23:59:00Z"
                value={String(node.data.timestamp ?? "")}
                onChange={v => onChange(node.id, { ...node.data, timestamp: v })}
              />
            )}
            {(node.data.mode as string) === "until_condition" && (
              <>
                <ExpressionField
                  label="Condition Expression"
                  value={(node.data.expression as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, expression: v })}
                  multiline
                  ancestorOutputs={ancestorOutputs}
                  expressionType="boolean"
                  fetchWithAuth={fetchWithAuth}
                />
                <ConfigField
                  label="Poll Interval (seconds)"
                  value={String(node.data.interval ?? 30)}
                  onChange={v => onChange(node.id, { ...node.data, interval: parseInt(v, 10) || 30 })}
                  type="number"
                />
                <ConfigField
                  label="Timeout (seconds)"
                  value={String(node.data.timeout ?? 300)}
                  onChange={v => onChange(node.id, { ...node.data, timeout: parseInt(v, 10) || 300 })}
                  type="number"
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Send Campaign Email panel ─────────────────────────────────────────────────

interface CampaignAssetItem {
  id: number;
  title: string;
  campaignId: number | null;
  assetType: string;
  content: string;
}

interface CampaignNameItem {
  id: number;
  name: string;
}

function SendCampaignEmailPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const { fetchWithAuth } = useAuth();
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: assets = [], isLoading } = useQuery<CampaignAssetItem[]>({
    queryKey: ["campaign-assets-email-sequence"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/marketing/campaign-assets?assetType=email_sequence");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: campaigns = [] } = useQuery<CampaignNameItem[]>({
    queryKey: ["campaigns-name-list"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/marketing/campaigns");
      if (!res.ok) return [];
      const rows = await res.json() as Array<{ id: number; name: string }>;
      return rows.map(r => ({ id: r.id, name: r.name }));
    },
    staleTime: 120_000,
  });

  const campaignNameById = Object.fromEntries(campaigns.map(c => [c.id, c.name]));

  const assetId = (node.data.assetId as number | undefined) ?? null;
  const selectedAsset = assets.find(a => a.id === assetId) ?? null;

  const filtered = search.trim()
    ? assets.filter(a =>
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        (a.campaignId && campaignNameById[a.campaignId]?.toLowerCase().includes(search.toLowerCase()))
      )
    : assets;

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Campaign Email Copy</label>
          <FieldHint text="The email copy asset to send. Create assets in Marketing → Campaigns → Assets, then select one here." />
        </div>
        {isLoading ? (
          <div className="text-xs text-[#484F58] animate-pulse">Loading email assets…</div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(o => !o)}
              className="w-full flex items-center justify-between bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-left outline-none focus:border-[#10B981]/60 hover:border-[#484F58] transition-colors"
            >
              <span className={selectedAsset ? "text-[#E6EDF3]" : "text-[#484F58]"}>
                {selectedAsset ? selectedAsset.title : "— choose an email copy asset —"}
              </span>
              <span className="text-[#484F58] ml-2">{pickerOpen ? "▲" : "▼"}</span>
            </button>

            {pickerOpen && (
              <div className="rounded-lg border border-[#30363D] bg-[#0D1117] overflow-hidden">
                <div className="px-2 pt-2 pb-1">
                  <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by title…"
                    className="w-full bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#10B981]/60"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-[#21262D]">
                  {assets.length === 0 ? (
                    <p className="text-[10px] text-[#484F58] px-3 py-2">No email copy assets found. Generate some in Marketing → Campaigns.</p>
                  ) : filtered.length === 0 ? (
                    <p className="text-[10px] text-[#484F58] px-3 py-2">No assets match.</p>
                  ) : filtered.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        onChange(node.id, { ...node.data, assetId: a.id, templateSlug: undefined });
                        setPickerOpen(false);
                        setSearch("");
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-[#1C2128] transition-colors ${a.id === assetId ? "bg-[#10B981]/10" : ""}`}
                    >
                      <p className="text-xs font-medium text-[#E6EDF3]">{a.title}</p>
                      <p className="text-[9px] text-[#484F58] font-mono mt-0.5">
                        {a.campaignId
                          ? campaignNameById[a.campaignId] ?? `campaign #${a.campaignId}`
                          : "no campaign"} · asset #{a.id}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {selectedAsset && (
          <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-2">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[#484F58] font-bold mb-0.5">Subject (from title)</p>
              <p className="text-[10px] text-[#7D8590] font-mono break-all">{selectedAsset.title}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[#484F58] font-bold mb-0.5">Body preview</p>
              <p className="text-[10px] text-[#7D8590] leading-relaxed line-clamp-4 break-words">
                {selectedAsset.content.slice(0, 300)}{selectedAsset.content.length > 300 ? "…" : ""}
              </p>
            </div>
          </div>
        )}
      </div>
      <PayloadField
        label="Recipient (email address)"
        value={(node.data.recipientExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, recipientExpr: v })}
        placeholder="{{email}} or client@example.com"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Sends the selected campaign email copy to the recipient, substituting <span className="font-mono text-[#7D8590]">{"{{token}}"}</span> placeholders from the workflow payload. The asset title is used as the email subject. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{sent}}"} · {"{{recipient}}"} · {"{{subject}}"} · {"{{sourceRef}}"}</p>
      </div>
    </>
  );
}

// ── Generate Landing Page panel ───────────────────────────────────────────────

function GenerateLandingPagePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Topic"
        value={(node.data.topic as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, topic: v })}
        placeholder="Microsoft 365 Compliance Assessment or {{articleTopic}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Target Audience"
        value={(node.data.audience as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, audience: v })}
        placeholder="IT directors at mid-size enterprises or {{audience}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="CTA Button Text"
        value={(node.data.cta as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, cta: v })}
        placeholder="Book Your Paid Assessment or {{cta}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">AI generates a full landing page (headline, subheadline, 3 value-prop blocks, CTA) and saves it to the database as <span className="text-[#7D8590]">unpublished</span>. Wire a <span className="font-mono text-[#7D8590]">Publish Landing Page</span> node after this one to make it live. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{landingPageId}}"} · {"{{slug}}"} · {"{{headline}}"} · {"{{subheadline}}"} · {"{{published}}"}</p>
      </div>
    </>
  );
}

// ── Create Kanban Task panel ──────────────────────────────────────────────────

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"];

const MARKETING_COLUMNS = [
  { id: "ideas",        label: "Ideas"        },
  { id: "in_progress",  label: "In Progress"  },
  { id: "scheduled",    label: "Scheduled"    },
  { id: "published",    label: "Published"    },
  { id: "completed",    label: "Completed"    },
  { id: "money_task",   label: "Money Task"   },
];

const PROJECT_COLUMNS = [
  { id: "backlog",              label: "Backlog"              },
  { id: "in_progress",          label: "In Progress"          },
  { id: "waiting_on_customer",  label: "Waiting on Customer"  },
  { id: "completed",            label: "Completed"            },
];

function CreateKanbanTaskPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const isMarketing = (node.data.boardId as string | undefined) === "marketing";
  const columnId = (node.data.columnId as string) ?? "";
  const columns = isMarketing ? MARKETING_COLUMNS : PROJECT_COLUMNS;
  const effectiveColumnId = columns.some(c => c.id === columnId) ? columnId : columns[0]!.id;

  useEffect(() => {
    if (!columns.some(c => c.id === (node.data.columnId as string))) {
      onChange(node.id, { ...node.data, columnId: columns[0]!.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMarketing]);

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Board type</label>
          <FieldHint text="Choose Marketing to hardcode the marketing board, or Project board to pass a dynamic {{projectId}} at runtime." />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(node.id, { ...node.data, boardId: "marketing", columnId: MARKETING_COLUMNS[0]!.id })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isMarketing ? "bg-[#818CF8]/20 border-[#818CF8] text-[#C7D2FE]" : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"}`}
          >
            Marketing
          </button>
          <button
            type="button"
            onClick={() => onChange(node.id, { ...node.data, boardId: "{{projectId}}", columnId: PROJECT_COLUMNS[0]!.id })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!isMarketing ? "bg-[#818CF8]/20 border-[#818CF8] text-[#C7D2FE]" : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"}`}
          >
            Project board
          </button>
        </div>
      </div>
      {!isMarketing && (
        <PayloadField
          label="Board ID (project ID)"
          hint="Numeric project ID or {{token}}. Supports {{projectId}} from upstream create_project or get_phases nodes."
          value={(node.data.boardId as string) ?? "{{projectId}}"}
          onChange={v => onChange(node.id, { ...node.data, boardId: v })}
          placeholder="{{projectId}}"
          ancestorOutputs={ancestorOutputs}
        />
      )}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Column / Status</label>
          <FieldHint text={isMarketing ? "The status column on the marketing board." : "The column (status) the card starts in on the project kanban board."} />
        </div>
        <select
          value={effectiveColumnId}
          onChange={e => onChange(node.id, { ...node.data, columnId: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#6366F1]/60"
        >
          {columns.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <PayloadField
        label="Task Title"
        hint="The card's title on the kanban board. Supports {{variables}} from upstream nodes."
        value={(node.data.titleExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, titleExpr: v })}
        placeholder="Follow up with {{company}} re: {{serviceName}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Description (optional)"
        hint="Optional card body text. Supports {{variables}} — e.g. include a score or other dynamic detail."
        value={(node.data.descriptionExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, descriptionExpr: v })}
        placeholder="Client scored {{score}} — review readiness report"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Priority</label>
          <FieldHint text="Priority level assigned to the kanban card — urgent, high, medium, or low." />
        </div>
        <select
          value={(node.data.priority as string) ?? "medium"}
          onChange={e => onChange(node.id, { ...node.data, priority: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#6366F1]/60"
        >
          {PRIORITY_OPTIONS.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>
      {!isMarketing && (
        <PayloadField
          label="Phase ID (optional)"
          hint="Links this task to a project phase (workflow_steps row). Supports {{phaseId}} from an upstream create_phase node."
          value={(node.data.phaseId as string) ?? ""}
          onChange={v => onChange(node.id, { ...node.data, phaseId: v })}
          placeholder="{{phaseId}}"
          ancestorOutputs={ancestorOutputs}
        />
      )}
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Creates a Kanban card on the selected board and column. Title, description, board ID, and phase ID support <span className="font-mono text-[#7D8590]">{"{{tokens}}"}</span> from the workflow payload. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{taskId}}"} · {"{{boardId}}"} · {"{{columnId}}"} · {"{{title}}"}</p>
      </div>
    </>
  );
}

// ── Get Project Tasks panel ───────────────────────────────────────────────────

function GetProjectTasksPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Project ID"
        hint="Numeric project ID whose kanban tasks to fetch. Supports {{projectId}} from upstream nodes."
        value={(node.data.projectId as string) ?? "{{projectId}}"}
        onChange={v => onChange(node.id, { ...node.data, projectId: v })}
        placeholder="{{projectId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Fetches all kanban tasks for the project, grouped under their phases (workflow steps). Tasks with no phase go into an "Unassigned" bucket. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{phases}}"} · {"{{taskCount}}"} · {"{{projectId}}"}</p>
        <p className="text-[10px] text-[#484F58]">Each task in <span className="font-mono text-[#7D8590]">phases[].tasks</span> includes: <span className="font-mono text-[#7D8590]">taskId, title, column, priority, assignedTo, dueDate, groupName, taskType, isCustomerTask, linkedRunbookId, customerDownloadScriptId, triggersHealthScore, taskMetadata</span></p>
      </div>
    </>
  );
}

// ── Update Project Task panel ─────────────────────────────────────────────────

function UpdateProjectTaskPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Task ID"
        hint="Numeric ID of the kanban task to update. Supports {{taskId}} from an upstream get_project_tasks or create_kanban_task node."
        value={(node.data.taskId as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, taskId: v })}
        placeholder="{{taskId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Column (optional)</label>
          <FieldHint text="Move the task to a different column. Leave blank to keep the current column." />
        </div>
        <select
          value={(node.data.column as string) ?? ""}
          onChange={e => onChange(node.id, { ...node.data, column: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#A78BFA]/60"
        >
          <option value="">(no change)</option>
          {PROJECT_COLUMNS.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <PayloadField
        label="Title (optional)"
        hint="Rename the task. Leave blank to keep the current title."
        value={(node.data.title as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, title: v })}
        placeholder="{{newTitle}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Description (optional)"
        hint="Update the task description. Leave blank to keep the current description."
        value={(node.data.description as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, description: v })}
        placeholder="{{description}}"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Priority (optional)</label>
          <FieldHint text="Change the task priority. Leave blank to keep the current priority." />
        </div>
        <select
          value={(node.data.priority as string) ?? ""}
          onChange={e => onChange(node.id, { ...node.data, priority: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#A78BFA]/60"
        >
          <option value="">(no change)</option>
          {PRIORITY_OPTIONS.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>
      <PayloadField
        label="Assigned To (optional)"
        hint="Update the assignee. Supports {{token}} interpolation."
        value={(node.data.assignedTo as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, assignedTo: v })}
        placeholder="{{assignedTo}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Due Date (optional)"
        hint="ISO 8601 date string (e.g. 2025-12-31). Supports {{token}} interpolation. Leave blank to keep the current due date."
        value={(node.data.dueDate as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, dueDate: v })}
        placeholder="{{dueDate}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Updates the specified task. Only non-blank fields are written — omitted fields are left unchanged. Errors if no task is found with the given ID. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{updated}}"} · {"{{taskId}}"} · {"{{column}}"} · {"{{title}}"}</p>
      </div>
    </>
  );
}

// ── Get Phases panel ──────────────────────────────────────────────────────────

function GetPhasesPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Project ID (primary)"
        hint="Numeric project ID. Tried first — looks up the presentation linked to this project."
        value={(node.data.projectId as string) ?? "{{projectId}}"}
        onChange={v => onChange(node.id, { ...node.data, projectId: v })}
        placeholder="{{projectId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Presentation ID (fallback)"
        hint="Used as fallback when no presentation is found by projectId. Supports {{presentationId}}."
        value={(node.data.presentationId as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, presentationId: v })}
        placeholder="{{presentationId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Reads <span className="font-mono text-[#7D8590]">sowPhases</span> from <span className="font-mono text-[#7D8590]">quick_win_presentations</span>, filtered to <span className="font-mono text-[#7D8590]">selected: true</span> phases. Returns empty array (non-fatal) if no presentation is found. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{phases}}"} · {"{{phaseCount}}"} · {"{{presentationId}}"}</p>
      </div>
    </>
  );
}

// ── Create Phase panel ────────────────────────────────────────────────────────

function CreatePhasePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  // Seed defaults when the node is first added so the executor sees them even
  // if the user never touches the fields.  We only write fields that are currently
  // undefined so we never clobber values the user already set.
  useEffect(() => {
    const patches: Record<string, unknown> = {};
    if (node.data.title === undefined || node.data.title === null) patches.title = "{{item.title}}";
    if (node.data.description === undefined || node.data.description === null) patches.description = "{{item.description}}";
    if (Object.keys(patches).length > 0) {
      onChange(node.id, { ...node.data, ...patches });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  return (
    <>
      <PayloadField
        label="Project ID"
        hint="Numeric project ID of the engagement project to attach this phase to."
        value={(node.data.projectId as string) ?? "{{projectId}}"}
        onChange={v => onChange(node.id, { ...node.data, projectId: v })}
        placeholder="{{projectId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Title"
        hint="Phase title. Inside a ForEach, use {{item.title}}."
        value={(node.data.title as string) ?? "{{item.title}}"}
        onChange={v => onChange(node.id, { ...node.data, title: v })}
        placeholder="{{item.title}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Description (optional)"
        hint="Phase description. Inside a ForEach, use {{item.description}}."
        value={(node.data.description as string) ?? "{{item.description}}"}
        onChange={v => onChange(node.id, { ...node.data, description: v })}
        placeholder="{{item.description}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Order (optional)"
        hint="Sort position (integer). Leave blank to default to 0."
        value={(node.data.order as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, order: v })}
        placeholder="0"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Inserts a row into <span className="font-mono text-[#7D8590]">workflow_steps</span> with <span className="font-mono text-[#7D8590]">status: pending</span>. Errors if projectId or title are missing. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{phaseId}}"} · {"{{phaseTitle}}"}</p>
      </div>
    </>
  );
}

// ── Save Phases panel ─────────────────────────────────────────────────────────

function SavePhasesPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Presentation ID"
        hint="The quick_win_presentations row to update. Supports {{presentationId}}."
        value={(node.data.presentationId as string) ?? "{{presentationId}}"}
        onChange={v => onChange(node.id, { ...node.data, presentationId: v })}
        placeholder="{{presentationId}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Total Price"
        hint="Engagement total in dollars (used to allocate prices across phases by weight). Supports {{totalPrice}}."
        value={(node.data.totalPrice as string) ?? "{{totalPrice}}"}
        onChange={v => onChange(node.id, { ...node.data, totalPrice: v })}
        placeholder="{{totalPrice}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Phases (JSON array)"
        hint='Array of phase objects with title, description, priceWeight, subtasks[]. Supports {{aiResponse}} or a raw JSON string.'
        value={(node.data.value as string) ?? "{{aiResponse}}"}
        onChange={v => onChange(node.id, { ...node.data, value: v })}
        placeholder="{{aiResponse}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Persists AI-generated phases to <span className="font-mono text-[#7D8590]">quick_win_presentations.sowPhases</span>. Allocates prices by <span className="font-mono text-[#7D8590]">priceWeight</span>. Also inserts <span className="font-mono text-[#7D8590]">workflow_steps</span> rows if a project is linked. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{saved}}"} · {"{{phaseCount}}"} · {"{{resolvedPhases}}"}</p>
      </div>
    </>
  );
}

// ── Generate Article panel ────────────────────────────────────────────────────

const ARTICLE_CATEGORIES = [
  "M365 Best Practices",
  "Copilot & AI",
  "SharePoint",
  "Power Platform",
  "Governance & Compliance",
  "Security",
  "Cloud Migration",
  "Microsoft Teams",
  "General",
];

const ARTICLE_TONES = [
  "professional, authoritative, practical",
  "conversational, friendly, approachable",
  "technical, detailed, in-depth",
  "executive, strategic, high-level",
];

function GenerateArticlePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Topic"
        hint="The article subject. Wire {{articleTopic}} from a Topic Picker node upstream, or type a custom topic directly."
        value={(node.data.topic as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, topic: v })}
        placeholder="5 Ways to Improve M365 Security Posture"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Category</label>
          <FieldHint text="The blog category this article is filed under on the consulting site resource page." />
        </div>
        <select
          value={(node.data.category as string) ?? "M365 Best Practices"}
          onChange={e => onChange(node.id, { ...node.data, category: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#C084FC]/60"
        >
          {ARTICLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <PayloadField
        label="Keywords (comma-separated, optional)"
        hint="Optional focus keywords guiding the AI — useful for SEO. Separate with commas. Supports {{variables}}."
        value={(node.data.keywords as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, keywords: v })}
        placeholder="MFA, Conditional Access, Zero Trust"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Tone</label>
          <FieldHint text="Writing style for the AI. Professional suits most content; technical is better for in-depth guides; executive is best for leadership audiences." />
        </div>
        <select
          value={(node.data.tone as string) ?? ARTICLE_TONES[0]}
          onChange={e => onChange(node.id, { ...node.data, tone: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#C084FC]/60"
        >
          {ARTICLE_TONES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Calls Claude AI to write a professional consulting article in Shane's voice. Outputs a JSON payload — wire directly into a <span className="font-mono text-[#C084FC]">publish_article</span> node to publish automatically. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{articleTitle}}"} · {"{{articleSlug}}"} · {"{{articleContent}}"} · {"{{articleSummary}}"} · {"{{articleDate}}"}</p>
      </div>
    </>
  );
}

// ── Publish Article panel ─────────────────────────────────────────────────────

function PublishArticlePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <div className="rounded-lg bg-[#0D1117] border border-[#C084FC]/20 p-2.5 space-y-1">
        <p className="text-[10px] text-[#7D8590]">By default, reads <span className="font-mono">{"{{articleTitle}}"}</span>, <span className="font-mono">{"{{articleSlug}}"}</span>, <span className="font-mono">{"{{articleContent}}"}</span>, <span className="font-mono">{"{{articleSummary}}"}</span>, <span className="font-mono">{"{{articleCategory}}"}</span>, and <span className="font-mono">{"{{articleDate}}"}</span> from the previous node's payload. Use the override fields below to hard-code or re-map values.</p>
      </div>
      <PayloadField
        label="Title override (leave blank to use {{articleTitle}})"
        hint="Override the article title. Leave blank to use {{articleTitle}} from the upstream Generate Article node."
        value={(node.data.titleExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, titleExpr: v })}
        placeholder="{{articleTitle}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Slug override (leave blank to auto-derive)"
        hint="Override the URL slug. Leave blank to auto-derive from the title. Slug conflicts are resolved by appending a timestamp."
        value={(node.data.slugExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, slugExpr: v })}
        placeholder="{{articleSlug}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Category override (leave blank to use {{articleCategory}})"
        hint="Override the blog category. Leave blank to use {{articleCategory}} from the upstream Generate Article node."
        value={(node.data.categoryExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, categoryExpr: v })}
        placeholder="{{articleCategory}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Content override (leave blank to use {{articleContent}})"
        hint="Override the full article body (Markdown). Leave blank to use {{articleContent}} from the upstream Generate Article node."
        value={(node.data.contentExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, contentExpr: v })}
        placeholder="{{articleContent}}"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Date override (leave blank to use {{articleDate}})"
        hint="Override the publish date (ISO format). Leave blank to use {{articleDate}} from the upstream Generate Article node."
        value={(node.data.dateExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, dateExpr: v })}
        placeholder="{{articleDate}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Saves the article to the database and writes a <span className="font-mono text-[#7D8590]">.md</span> file to the public site. When wired after a <span className="font-mono text-[#C084FC]">generate_article</span> node all fields auto-populate — no override expressions needed. Slug conflicts are resolved automatically by appending a timestamp. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{published}}"} · {"{{slug}}"} · {"{{articleId}}"} · {"{{title}}"}</p>
      </div>
    </>
  );
}

// ── Topic Picker panel ────────────────────────────────────────────────────────

function TopicPickerPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Category</label>
          <FieldHint text="Limits the AI to topics within this Microsoft 365 category — helps keep content focused and on-brand." />
        </div>
        <select
          value={(node.data.category as string) ?? "M365 Best Practices"}
          onChange={e => onChange(node.id, { ...node.data, category: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#E879F9]/60"
        >
          {ARTICLE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <PayloadField
        label="Focus area (optional)"
        hint="Comma-separated keywords that narrow the topic further within the selected category — e.g. 'governance, security'. Supports {{variables}}."
        value={(node.data.focusArea as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, focusArea: v })}
        placeholder="governance, security, Copilot adoption"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Articles to check for duplicates</label>
          <FieldHint text="How many of the most recent published articles to scan. The AI avoids topics already covered in this window." />
        </div>
        <input
          type="number" min={5} max={100}
          value={(node.data.excludeRecent as number) ?? 20}
          onChange={e => onChange(node.id, { ...node.data, excludeRecent: Number(e.target.value) })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#E879F9]/60"
        />
      </div>
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Queries existing article titles then calls Claude AI to pick a novel topic that hasn't been covered. Wire directly into a <span className="font-mono text-[#C084FC]">generate_article</span> node — the output <span className="font-mono text-[#7D8590]">{"{{articleTopic}}"}</span> maps to the Topic field automatically. Also outputs <span className="font-mono text-[#7D8590]">{"{{topicCategory}}"}</span> and <span className="font-mono text-[#7D8590]">{"{{topicRationale}}"}</span>.</p>
      </div>
    </>
  );
}

// ── Generate Image panel ──────────────────────────────────────────────────────

const ASPECT_RATIO_OPTIONS = [
  { value: "landscape", label: "Landscape 16:9 (1536 × 1024) — social cards, OG images" },
  { value: "square",    label: "Square 1:1 (1024 × 1024) — profile photos, Instagram" },
  { value: "portrait",  label: "Portrait 4:5 (1024 × 1536) — Pinterest, mobile" },
  { value: "wide",      label: "Wide 3:1 (1536 × 1024) — email banners, hero images" },
];

const STYLE_OPTIONS = [
  { value: "",                     label: "None (let the prompt speak for itself)" },
  { value: "Professional Photo",   label: "Professional Photo — clean, corporate, high-quality" },
  { value: "Flat Illustration",    label: "Flat Illustration — modern flat design, icon-style" },
  { value: "Abstract/Corporate",   label: "Abstract / Corporate — geometric, brand-aligned" },
  { value: "Dark Minimal",         label: "Dark Minimal — dark background, clean typography" },
];

function GenerateImagePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Prompt"
        hint="Describe the image in detail. Wire {{articleTitle}} or other tokens to make it dynamic. The style hint (below) is appended automatically."
        value={(node.data.prompt as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, prompt: v })}
        placeholder="A professional Microsoft 365 hero image for {{articleTitle}}, clean and corporate"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Aspect Ratio / Format</label>
          <FieldHint text="Dimensions of the generated image. Landscape suits article headers and social cards; square suits Instagram; portrait suits Pinterest." />
        </div>
        <select
          value={(node.data.aspectRatio as string) ?? "landscape"}
          onChange={e => onChange(node.id, { ...node.data, aspectRatio: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#F59E0B]/60"
        >
          {ASPECT_RATIO_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Style hint (optional)</label>
          <FieldHint text="Visual style appended to the image prompt. 'None' lets the prompt alone drive the style. Choose a preset to get a consistent look across generated images." />
        </div>
        <select
          value={(node.data.style as string) ?? ""}
          onChange={e => onChange(node.id, { ...node.data, style: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#F59E0B]/60"
        >
          {STYLE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="rounded-lg bg-[#1A100A] border border-[#F59E0B]/30 p-3 space-y-1.5">
        <p className="text-[10px] text-[#7D8590] leading-relaxed">
          Calls <span className="font-mono text-[#F59E0B]">gpt-image-1</span> via Replit AI Integrations — no extra API key required. The generated image is downloaded and saved permanently at <span className="font-mono text-[#7D8590]">shanemccaw.com/api/uploads/generated-images/&lt;uuid&gt;.png</span>. Wire <span className="font-mono text-[#7D8590]">{"{{imageUrl}}"}</span> directly into the Image URL field of any <span className="font-mono text-[#F59E0B]">post_linkedin</span>, <span className="font-mono text-[#F59E0B]">post_twitter</span>, or <span className="font-mono text-[#F59E0B]">post_facebook</span> node. Dry-run returns a placeholder — no API call is made.
        </p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{imageUrl}}"} · {"{{revisedPrompt}}"}</p>
      </div>
    </>
  );
}

// ── Fetch News Headlines panel ────────────────────────────────────────────────

const DEFAULT_TOPICS = "Microsoft 365, Copilot AI, SharePoint, Power Platform, Azure, Microsoft Viva, Project Online";

function FetchNewsPanel({
  node,
  onChange,
  ancestorOutputs,
  nodes,
  edges,
  onGraphChange,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
}) {
  const accentColor = "#06B6D4";
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Search topics</label>
          <FieldHint text="Comma-separated keywords used to search for relevant news via NewsAPI (if key is configured) or Microsoft RSS feeds as a fallback." />
        </div>
        <textarea
          rows={2}
          value={(node.data.topics as string) ?? DEFAULT_TOPICS}
          onChange={e => onChange(node.id, { ...node.data, topics: e.target.value })}
          placeholder={DEFAULT_TOPICS}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#06B6D4]/60 resize-none"
        />
        <p className="text-[10px] text-[#484F58]">Comma-separated keywords. Used with NewsAPI (if key is set) or Microsoft RSS feeds as fallback.</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Custom AI prompt (optional)</label>
          <FieldHint text="Overrides the built-in analyst prompt. Must instruct the AI to return JSON with: topic, context, articleSuggestion, hotScore (0–100), targetSector." />
        </div>
        <textarea
          rows={4}
          value={(node.data.customPrompt as string) ?? ""}
          onChange={e => onChange(node.id, { ...node.data, customPrompt: e.target.value })}
          placeholder="Leave blank to use the built-in Shane McCaw analyst prompt. The prompt receives the headlines array and must return JSON with: topic, context, articleSuggestion, hotScore, targetSector."
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#06B6D4]/60 resize-none font-mono"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-[#7D8590]">Max results</label>
            <FieldHint text="Maximum number of headlines to fetch and score. Higher values give better coverage but are slower to process." />
          </div>
          <input
            type="number" min={1} max={50}
            value={(node.data.maxResults as number) ?? 10}
            onChange={e => onChange(node.id, { ...node.data, maxResults: Number(e.target.value) })}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#06B6D4]/60"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-[#7D8590]">Hot-score threshold</label>
            <FieldHint text="Articles scoring above this (0–100) are flagged as 'hot'. Lower values trigger campaigns more often; higher values are more selective." />
          </div>
          <input
            type="number" min={0} max={100}
            value={(node.data.hotScoreThreshold as number) ?? 60}
            onChange={e => onChange(node.id, { ...node.data, hotScoreThreshold: Number(e.target.value) })}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#06B6D4]/60"
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#30363D] p-3">
        <input
          type="checkbox"
          id={`fnh-auto-${node.id}`}
          checked={Boolean(node.data.autoBuildCampaign)}
          onChange={e => {
            const checked = e.target.checked;
            if (checked) {
              // Atomically: flip autoBuildCampaign on the news node AND seed the campaign node
              const existingHotEdge = edges.find(ed => ed.source === node.id && ed.sourceHandle === "hot");
              const updatedNodes = nodes.map(n =>
                n.id === node.id ? { ...n, data: { ...n.data, autoBuildCampaign: true } } : n
              );
              if (!existingHotEdge) {
                const ts = Date.now();
                const goalId    = `node-goal-${ts}`;
                const audId     = `node-audience-${ts}`;
                const offerId   = `node-offer-${ts}`;
                const campId    = `node-campaign-${ts}`;
                const goalNode: StoredNode = {
                  id: goalId, position: { x: 0, y: 0 },
                  data: { nodeType: "define_campaign_goal",   label: "Define Goal",            goalExpr: "{{campaignBrief}}", _autoSeeded: true },
                };
                const audNode: StoredNode = {
                  id: audId, position: { x: 0, y: 0 },
                  data: { nodeType: "define_target_audience", label: "Define Target Audience", audienceExpr: "", _autoSeeded: true },
                };
                const offerNode: StoredNode = {
                  id: offerId, position: { x: 0, y: 0 },
                  data: { nodeType: "create_campaign_offer",  label: "Create Offer",           nameExpr: "", goalExpr: "{{campaignGoal}}", audienceExpr: "{{targetAudience}}", _autoSeeded: true },
                };
                const campNode: StoredNode = {
                  id: campId, position: { x: 0, y: 0 },
                  data: { nodeType: "create_marketing_campaign", label: "Create Campaign",     nameExpr: "{{campaignBrief}}", goalExpr: "{{campaignGoal}}", audienceExpr: "{{targetAudience}}", offerExpr: "{{offerName}}", _autoSeeded: true },
                };
                const newEdges: StoredEdge[] = [
                  { id: `e-hot-${ts}`,    source: node.id, target: goalId,  sourceHandle: "hot", animated: true },
                  { id: `e-goal-${ts}`,   source: goalId,  target: audId,   animated: true },
                  { id: `e-aud-${ts}`,    source: audId,   target: offerId,  animated: true },
                  { id: `e-offer-${ts}`,  source: offerId, target: campId,   animated: true },
                ];
                onGraphChange([...updatedNodes, goalNode, audNode, offerNode, campNode], [...edges, ...newEdges]);
              } else {
                // Hot edge already exists — just flip the flag
                onGraphChange(updatedNodes, edges);
              }
            } else {
              const hotEdge = edges.find(ed => ed.source === node.id && ed.sourceHandle === "hot");
              if (hotEdge) {
                const toRemove = new Set<string>();
                const queue = [hotEdge.target];
                while (queue.length > 0) {
                  const id = queue.shift()!;
                  if (toRemove.has(id)) continue;
                  toRemove.add(id);
                  for (const ed of edges) {
                    if (ed.source === id) queue.push(ed.target);
                  }
                }
                const hotBranchNodes = nodes.filter(n => toRemove.has(n.id));
                const hasUserContent = hotBranchNodes.length > 1 || hotBranchNodes.some(n => !n.data._autoSeeded);
                if (hasUserContent && !window.confirm("This will remove the campaign steps inside. Continue?")) {
                  return;
                }
                // Atomically: flip flag OFF on the news node AND remove hot-branch nodes/edges
                const newNodes = nodes
                  .filter(n => !toRemove.has(n.id))
                  .map(n => n.id === node.id ? { ...n, data: { ...n.data, autoBuildCampaign: false } } : n);
                const newEdges = edges.filter(ed =>
                  !(ed.source === node.id && ed.sourceHandle === "hot") &&
                  !toRemove.has(ed.source) && !toRemove.has(ed.target)
                );
                onGraphChange(newNodes, newEdges);
              } else {
                // No hot branch — just flip the flag
                const updatedNodes = nodes.map(n =>
                  n.id === node.id ? { ...n, data: { ...n.data, autoBuildCampaign: false } } : n
                );
                onGraphChange(updatedNodes, edges);
              }
            }
          }}
          className="mt-0.5 accent-[#06B6D4]"
        />
        <div>
          <label htmlFor={`fnh-auto-${node.id}`} className="text-xs font-medium text-[#E6EDF3] cursor-pointer">Auto-build campaign</label>
          <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">When on and the score exceeds the threshold, a campaign draft is created automatically and its ID is available as <span className="font-mono text-[#06B6D4]">{"{{campaignId}}"}</span>.</p>
        </div>
      </div>

      <div className="rounded-lg bg-[#041A14] border border-[#06B6D4]/30 p-3 space-y-2">
        <p className="text-[10px] font-semibold text-[#06B6D4] uppercase tracking-wide">Output variables</p>
        <div className="grid grid-cols-1 gap-1">
          {[
            ["newsHeadlines",        "Array of fetched stories"],
            ["newsTopic",            "Short phrase for the hottest story"],
            ["newsContext",          "2–3 sentences on why it matters"],
            ["newsArticleSuggestion","Blog lead-in paragraph"],
            ["hotScore",             "Relevance integer 0–100"],
            ["isHot",                "true when score exceeds threshold"],
            ["targetSector",         "Market sector label"],
            ["campaignBrief",        "AI brief: audience, hook, angles (isHot only)"],
            ["campaignId",           "Created campaign DB ID (auto-build + isHot only)"],
          ].map(([key, desc]) => (
            <div key={key} className="flex gap-2">
              <span className="font-mono text-[10px] text-[#06B6D4] shrink-0">{`{{${key}}}`}</span>
              <span className="text-[10px] text-[#7D8590]">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#484F58] pt-1 border-t border-[#30363D]">
          Requires <span className="font-mono" style={{ color: accentColor }}>NEWS_API_KEY</span> in Replit Secrets for live headlines. Falls back to Microsoft public RSS feeds automatically when absent. Dry-run returns realistic stub values — no API calls are made.
        </p>
      </div>
    </>
  );
}

// ── Create Marketing Campaign panel ──────────────────────────────────────────

// ── Define Campaign Goal panel ─────────────────────────────────────────────────

function DefineCampaignGoalPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Goal"
        hint="Describe what the campaign aims to achieve — e.g. 'Generate 20 qualified leads'. Passed downstream as {{campaignGoal}}."
        value={(node.data.goalExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, goalExpr: v })}
        placeholder="Generate 20 qualified leads for Copilot readiness assessments"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Defines the campaign goal and passes it downstream as <span className="font-mono text-[#7D8590]">{"{{campaignGoal}}"}</span>. Wire it into the Target Audience and Create Campaign nodes.</p>
      </div>
    </>
  );
}

// ── Define Target Audience panel ───────────────────────────────────────────────

function DefineTargetAudiencePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Target audience"
        hint="Describe who the campaign targets — e.g. 'IT directors at mid-market companies'. Passed downstream as {{targetAudience}}."
        value={(node.data.audienceExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, audienceExpr: v })}
        placeholder="IT directors at mid-market companies (100–500 employees)"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Defines who the campaign targets and passes it downstream as <span className="font-mono text-[#7D8590]">{"{{targetAudience}}"}</span>. Wire it into the Create Offer and Create Campaign nodes.</p>
      </div>
    </>
  );
}

// ── Create Campaign Offer panel ────────────────────────────────────────────────

function CreateCampaignOfferPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Offer name"
        hint="Required. The offer's display name — creates a record in the Offers database. Supports {{variables}}."
        value={(node.data.nameExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, nameExpr: v })}
        placeholder="Free Copilot Readiness Assessment"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Goal (optional — uses {{campaignGoal}} if blank)"
        hint="What this offer aims to achieve. Leave blank to inherit {{campaignGoal}} from an upstream Define Goal node."
        value={(node.data.goalExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, goalExpr: v })}
        placeholder="{{campaignGoal}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Target audience (optional — uses {{targetAudience}} if blank)"
        hint="Who this offer targets. Leave blank to inherit {{targetAudience}} from an upstream Define Target Audience node."
        value={(node.data.audienceExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, audienceExpr: v })}
        placeholder="{{targetAudience}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Pricing"
        hint="How this offer is priced — e.g. 'Free', '$2,500 flat fee', 'from £500/month'. Shown in marketing materials."
        value={(node.data.pricingExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, pricingExpr: v })}
        placeholder="Free / $2,500 flat fee"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="CTA"
        hint="Call to action text shown on marketing materials — e.g. 'Book a free 30-min call'. Supports {{variables}}."
        value={(node.data.ctaExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, ctaExpr: v })}
        placeholder="Book a free 30-min call"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Creates an offer record in the database. Outputs <span className="font-mono text-[#7D8590]">{"{{offerId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{offerName}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{offerGoal}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{offerAudience}}"}</span>.</p>
      </div>
    </>
  );
}

// ── Create Marketing Campaign panel ───────────────────────────────────────────

function CreateMarketingCampaignPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Campaign name"
        hint="Display name for the campaign record in the Marketing database. Supports {{variables}} from upstream nodes."
        value={(node.data.nameExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, nameExpr: v })}
        placeholder="Q3 Copilot Rollout Push"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Goal"
        hint="What the campaign aims to achieve — wire {{campaignGoal}} from an upstream Define Goal node. Supports {{variables}}."
        value={(node.data.goalExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, goalExpr: v })}
        placeholder="Generate 20 qualified leads for Copilot readiness assessments"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Target audience"
        hint="Who the campaign targets — wire {{targetAudience}} from an upstream Define Audience node. Supports {{variables}}."
        value={(node.data.audienceExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, audienceExpr: v })}
        placeholder="IT directors at mid-market companies (100-500 employees)"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Offer"
        hint="The value proposition being promoted — wire {{offerName}} from an upstream Create Offer node. Supports {{variables}}."
        value={(node.data.offerExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, offerExpr: v })}
        placeholder="Free Copilot Readiness Assessment"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Initial status</label>
          <FieldHint text="Whether the campaign record is created as a draft (hidden from reporting) or immediately active." />
        </div>
        <select
          value={(node.data.status as string) ?? "draft"}
          onChange={e => onChange(node.id, { ...node.data, status: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#34D399]/60"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
        </select>
      </div>
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Creates a campaign record in the Marketing database. Outputs <span className="font-mono text-[#7D8590]">{"{{campaignId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{campaignName}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{campaignStatus}}"}</span>.</p>
      </div>
    </>
  );
}

// ── Publish Landing Page panel ────────────────────────────────────────────────

function PublishLandingPagePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <PayloadField
        label="Landing page slug"
        hint="The URL slug of the landing page to publish — must match exactly as shown in Marketing → Landing Pages. Supports {{variables}}."
        value={(node.data.slugExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, slugExpr: v })}
        placeholder="copilot-readiness-offer"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Finds the landing page by slug and sets it to published, making it live on the consulting site. Outputs <span className="font-mono text-[#7D8590]">{"{{landingPageId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{slug}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{published}}"}</span>, and <span className="font-mono text-[#7D8590]">{"{{wasAlreadyPublished}}"}</span>. The slug must match exactly as it appears in Marketing → Landing Pages.</p>
      </div>
    </>
  );
}

// ── Find Object panel ─────────────────────────────────────────────────────────

const FIND_OBJECT_TYPES = [
  { value: "lead",               label: "Lead",               fields: ["email", "name", "id"] },
  { value: "client",             label: "Client",             fields: ["email", "id"] },
  { value: "project",            label: "Project",            fields: ["id"] },
  { value: "article",            label: "Article",            fields: ["slug", "id"] },
  { value: "stripe_invoice",     label: "Stripe Invoice",     fields: ["clientUserId", "projectId", "stripeInvoiceId"] },
  { value: "insights_document",  label: "Insights Document",  fields: ["id", "customerId", "projectId", "docType", "title"] },
  { value: "presentation",       label: "Presentation",       fields: ["clientUserId", "projectId"] },
];

// ── Ask AI panel ──────────────────────────────────────────────────────────────

function AskAiPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Model</label>
          <FieldHint text="Haiku is fast and cheap — ideal for simple extraction or formatting. Sonnet produces higher-quality reasoning and is better for complex analysis." />
        </div>
        <select
          value={(node.data.model as string) ?? "claude-haiku-4-5"}
          onChange={e => onChange(node.id, { ...node.data, model: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#A78BFA]/60"
        >
          <option value="claude-haiku-4-5">Claude Haiku (fast, cheap)</option>
          <option value="claude-sonnet-4-5">Claude Sonnet (smarter, slower)</option>
        </select>
      </div>

      <PayloadField
        label="System prompt (optional)"
        hint="Sets the AI's persona before the user prompt — e.g. 'You are a Microsoft 365 marketing strategist'. Leave blank to use Claude's default behaviour."
        value={(node.data.systemExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, systemExpr: v })}
        placeholder="You are a marketing strategist specialising in Microsoft 365..."
        ancestorOutputs={ancestorOutputs}
      />

      <PayloadField
        label="Prompt"
        hint="The message sent to Claude. Use {{variable}} syntax to inject data from upstream nodes — e.g. {{newsTopic}} or {{aiResponse}}."
        value={(node.data.promptExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, promptExpr: v })}
        placeholder="Based on this news story: {{newsTopic}}, suggest a target audience..."
        ancestorOutputs={ancestorOutputs}
        multiline
      />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-[#7D8590]">Max tokens</label>
          <FieldHint text="Maximum response length (~¾ of a word per token). 1024 suits most tasks. Increase for long structured outputs; decrease to cut costs." />
        </div>
        <input
          type="number"
          min={64}
          max={4096}
          step={64}
          value={(node.data.maxTokens as number) ?? 1024}
          onChange={e => onChange(node.id, { ...node.data, maxTokens: Number(e.target.value) })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#A78BFA]/60"
        />
      </div>

      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">
          Sends the prompt to Claude and exposes the response as{" "}
          <span className="font-mono text-[#7D8590]">{"{{aiResponse}}"}</span>.
          Use <span className="font-mono text-[#7D8590]">{"{{aiResponse}}"}</span> in
          downstream nodes — e.g. wire it into a Define Target Audience node's audience
          field so AI fills it in automatically.
        </p>
      </div>
    </>
  );
}

// ── Find Object panel ─────────────────────────────────────────────────────────

function FindObjectPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const objectType = (node.data.objectType as string) ?? "lead";
  const typeConfig = FIND_OBJECT_TYPES.find(t => t.value === objectType) ?? FIND_OBJECT_TYPES[0];
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Object type</label>
        <select
          value={objectType}
          onChange={e => onChange(node.id, { ...node.data, objectType: e.target.value, fieldName: "" })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#818CF8]/60"
        >
          {FIND_OBJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Look up by field</label>
        <select
          value={(node.data.fieldName as string) ?? typeConfig.fields[0]}
          onChange={e => onChange(node.id, { ...node.data, fieldName: e.target.value })}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#818CF8]/60"
        >
          {typeConfig.fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <PayloadField
        label="Field value"
        value={(node.data.fieldValueExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, fieldValueExpr: v })}
        placeholder="{{leadEmail}}"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Looks up the first matching record and injects its fields into the payload. Always outputs <span className="font-mono text-[#7D8590]">{"{{found}}"}</span> (true/false) and <span className="font-mono text-[#7D8590]">{"{{objectId}}"}</span>. Wire a <span className="font-mono text-amber-400">condition</span> node on <span className="font-mono text-[#7D8590]">{"{{found}} == true"}</span> to branch on whether the record exists.</p>
      </div>
    </>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  type,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-[#7D8590]">{label}</label>
        {hint && <FieldHint text={hint} />}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none font-mono"
        />
      ) : (
        <input
          type={type ?? "text"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
        />
      )}
    </div>
  );
}

// ── Test Run modal ────────────────────────────────────────────────────────────

function generateMockValue(key: string): unknown {
  const k = key.toLowerCase();
  if (k === "failed") return false;
  if (k.endsWith("id") || k === "id") return Math.floor(Math.random() * 900) + 100;
  if (k.includes("email")) return "client@example.com";
  if (k.includes("name")) return "Contoso Ltd";
  if (k.endsWith("at") || k.endsWith("time") || k.endsWith("date")) return new Date().toISOString();
  if (k.includes("amount") || k.includes("price")) return 4999;
  if (k.includes("currency")) return "gbp";
  if (k.includes("score")) return 72;
  if (k.includes("status")) return "active";
  if (k.includes("type") || k.includes("phase")) return "discovery";
  if (k.includes("url")) return "https://example.com";
  return `test-${key}`;
}

// ── Ask for Input panel ───────────────────────────────────────────────────────

type AskForInputFieldType =
  | "text" | "number" | "select" | "textarea"
  | "customer" | "project" | "lead" | "opportunity" | "document_type";

const ENTITY_FIELD_TYPES: AskForInputFieldType[] = ["customer", "project", "lead", "opportunity", "document_type"];

const DOCUMENT_TYPE_GROUPS: { group: string; items: { id: string; label: string }[] }[] = [
  {
    group: "Reports",
    items: [
      { id: "executive_summary",           label: "Executive Summary" },
      { id: "full_readiness_report",       label: "Full Readiness Report" },
      { id: "security_posture_report",     label: "Security Posture Report" },
      { id: "governance_maturity_report",  label: "Governance Maturity Report" },
      { id: "data_exposure_risk_report",   label: "Data Exposure Risk Report" },
      { id: "license_optimization_report", label: "License Optimization Report" },
    ],
  },
  {
    group: "Consulting Documents",
    items: [
      { id: "consolidated_sow",            label: "Consolidated SOW" },
      { id: "sow",                         label: "Statement of Work" },
      { id: "task_execution_guide",        label: "SOW Task Execution Guide" },
      { id: "remediation_plan",            label: "Remediation Plan" },
      { id: "deployment_plan",             label: "Deployment Plan" },
      { id: "governance_framework",        label: "Governance Framework" },
      { id: "security_hardening_plan",     label: "Security Hardening Plan" },
      { id: "copilot_enablement_plan",     label: "Copilot Enablement Plan" },
      { id: "identity_modernization_plan", label: "Identity Modernization Plan" },
      { id: "copilot_readiness",           label: "Copilot Readiness Assessment" },
    ],
  },
];

/**
 * Static registry of output keys known to carry a finite, named set of values —
 * i.e. good candidates for switch-case branches.
 * Groups follow the same shape as DOCUMENT_TYPE_GROUPS so BuildCasesPopover can
 * render them with per-group Select-all toggles.
 */
const LIST_VALUE_REGISTRY: Record<
  string,
  { label: string; groups: { group: string; items: { id: string; label: string }[] }[] }
> = {
  reports_to_run: {
    label: "Document Types",
    groups: DOCUMENT_TYPE_GROUPS,
  },
  tier: {
    label: "Score Tier",
    groups: [{ group: "Tiers", items: [{ id: "Low", label: "Low" }, { id: "Medium", label: "Medium" }, { id: "High", label: "High" }] }],
  },
  scoreLabel: {
    label: "Lead Score Label",
    groups: [{ group: "Labels", items: [{ id: "Low", label: "Low" }, { id: "Medium", label: "Medium" }, { id: "High", label: "High" }] }],
  },
  readinessLabel: {
    label: "Readiness Level",
    groups: [{ group: "Levels", items: [{ id: "Low", label: "Low" }, { id: "Medium", label: "Medium" }, { id: "High", label: "High" }] }],
  },
  objectType: {
    label: "Object Type",
    groups: [{ group: "Types", items: [{ id: "lead", label: "Lead" }, { id: "client", label: "Client" }, { id: "project", label: "Project" }, { id: "article", label: "Article" }, { id: "stripe_invoice", label: "Stripe Invoice" }, { id: "insights_document", label: "Insights Document" }] }],
  },
  campaignStatus: {
    label: "Campaign Status",
    groups: [{ group: "Statuses", items: [{ id: "draft", label: "Draft" }, { id: "active", label: "Active" }] }],
  },
  targetSector: {
    label: "Target Sector",
    groups: [{ group: "Sectors", items: [
      { id: "Government", label: "Government" },
      { id: "Healthcare", label: "Healthcare" },
      { id: "Finance", label: "Finance" },
      { id: "Education", label: "Education" },
      { id: "Technology", label: "Technology" },
      { id: "Legal", label: "Legal" },
      { id: "Non-Profit", label: "Non-Profit" },
    ] }],
  },
  stage: {
    label: "Pipeline Stage",
    groups: [{ group: "Stages", items: [
      { id: "new", label: "New" },
      { id: "qualified", label: "Qualified" },
      { id: "proposal", label: "Proposal" },
      { id: "negotiation", label: "Negotiation" },
      { id: "won", label: "Won" },
      { id: "lost", label: "Lost" },
    ] }],
  },
};

/**
 * Parse all `{{...}}` references from an expression and return the bare key names.
 * Handles: `{{key}}`, `{{steps.nodeId.key}}`, `{{payload.key}}`.
 */
function extractReferencedKeys(expr: string): string[] {
  const tokens: string[] = [];
  for (const m of expr.matchAll(/\{\{(?:steps\.[^.}]+\.)?(?:payload\.)?(\w+)\}\}/g)) {
    if (m[1] && !tokens.includes(m[1])) tokens.push(m[1]);
  }
  return tokens;
}

/**
 * For an `ask_for_input` node whose `select` or `multi-select` field's `variableName`
 * matches `key`, parse its comma-separated options into case-ready items.
 */
function findAskForInputSelectOptions(
  key: string,
  nodes: Node[],
): { label: string; groups: { group: string; items: { id: string; label: string }[] }[] } | null {
  for (const n of nodes) {
    if ((n.data.nodeType as string) !== "ask_for_input") continue;
    const fields = (n.data.fields as Array<{
      variableName: string;
      label: string;
      type: string;
      options: string;
    }> | undefined) ?? [];
    for (const f of fields) {
      if (f.variableName !== key) continue;
      if (f.type !== "select" && f.type !== "multiselect") continue;
      const rawOptions = (f.options ?? "").split(",").map(o => o.trim()).filter(Boolean);
      if (rawOptions.length === 0) return null;
      return {
        label: f.label || f.variableName,
        groups: [{
          group: "Options",
          items: rawOptions.map(o => ({ id: o, label: o })),
        }],
      };
    }
  }
  return null;
}

interface AskForInputField {
  id: string;
  variableName: string;
  label: string;
  type: AskForInputFieldType;
  options: string;
  required: boolean;
  multi: boolean;
}

function AskForInputPanel({
  node,
  onChange,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
}) {
  const fields = ((node.data.fields as AskForInputField[] | undefined) ?? []);

  function updateFields(next: AskForInputField[]) {
    onChange(node.id, { ...node.data, fields: next });
  }

  function addField() {
    updateFields([
      ...fields,
      { id: crypto.randomUUID(), variableName: "", label: "", type: "text", options: "", required: false, multi: false },
    ]);
  }

  function removeField(id: string) {
    updateFields(fields.filter(f => f.id !== id));
  }

  function updateField(id: string, patch: Partial<AskForInputField>) {
    updateFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  const inputCls = "w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#F97316]/60";
  const selectCls = "w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#F97316]/60";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#7D8590]">Input Fields</label>
        <button
          onClick={addField}
          className="text-[10px] font-medium px-2 py-0.5 rounded bg-[#F97316]/10 text-[#F97316] border border-[#F97316]/30 hover:bg-[#F97316]/20 transition-colors"
        >
          + Add field
        </button>
      </div>

      {fields.length === 0 && (
        <p className="text-[10px] text-[#484F58] text-center py-3 border border-dashed border-[#30363D] rounded-lg">
          No fields yet — add one above
        </p>
      )}

      {fields.map((f, i) => (
        <div key={f.id} className="rounded-lg border border-[#30363D] bg-[#0D1117] p-2.5 space-y-2">
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-[#F97316] uppercase tracking-wider">Field {i + 1}</span>
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => { if (i === 0) return; const f2 = [...fields]; [f2[i - 1], f2[i]] = [f2[i], f2[i - 1]]; updateFields(f2); }}
                  disabled={i === 0}
                  className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-20 transition-colors leading-none text-[8px]"
                  title="Move up"
                >▲</button>
                <button
                  onClick={() => { if (i === fields.length - 1) return; const f2 = [...fields]; [f2[i], f2[i + 1]] = [f2[i + 1], f2[i]]; updateFields(f2); }}
                  disabled={i === fields.length - 1}
                  className="text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-20 transition-colors leading-none text-[8px]"
                  title="Move down"
                >▼</button>
              </div>
            </div>
            <button
              onClick={() => removeField(f.id)}
              className="text-[#484F58] hover:text-red-400 transition-colors text-xs"
              title="Remove field"
            >✕</button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#7D8590]">Variable name</label>
            <input
              type="text"
              value={f.variableName}
              onChange={e => updateField(f.id, { variableName: e.target.value.replace(/\W/g, "_").replace(/^_+/, "") })}
              placeholder="client_name"
              className={inputCls}
            />
            <p className="text-[9px] text-[#484F58]">Used as <span className="font-mono text-[#F97316]">{`{{${f.variableName || "variableName"}}}`}</span> in downstream nodes</p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#7D8590]">Label (shown to operator)</label>
            <input
              type="text"
              value={f.label}
              onChange={e => updateField(f.id, { label: e.target.value })}
              placeholder="Which client?"
              className={inputCls}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-[#7D8590]">Type</label>
            <select
              value={f.type}
              onChange={e => updateField(f.id, { type: e.target.value as AskForInputFieldType, multi: false })}
              className={selectCls}
            >
              <optgroup label="Basic">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="textarea">Textarea</option>
                <option value="select">Custom select</option>
              </optgroup>
              <optgroup label="Entity picker">
                <option value="customer">Customer</option>
                <option value="project">Project</option>
                <option value="lead">Lead</option>
                <option value="opportunity">Opportunity</option>
                <option value="document_type">Document Type</option>
              </optgroup>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={f.required}
                onChange={e => updateField(f.id, { required: e.target.checked })}
                className="w-3 h-3 rounded accent-orange-500"
              />
              <span className="text-[10px] text-[#7D8590]">Required</span>
            </label>
            {ENTITY_FIELD_TYPES.includes(f.type) && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.multi ?? false}
                  onChange={e => updateField(f.id, { multi: e.target.checked })}
                  className="w-3 h-3 rounded accent-orange-500"
                />
                <span className="text-[10px] text-[#7D8590]">Multi-select</span>
              </label>
            )}
          </div>

          {f.type === "select" && (
            <div className="space-y-1">
              <label className="text-[10px] text-[#7D8590]">Options (comma-separated)</label>
              <input
                type="text"
                value={f.options}
                onChange={e => updateField(f.id, { options: e.target.value })}
                placeholder="Option A, Option B, Option C"
                className={inputCls}
              />
            </div>
          )}
        </div>
      ))}

      <div className="rounded-lg bg-[#1A0E00] border border-[#F97316]/20 p-2.5">
        <p className="text-[10px] text-[#7D8590] leading-relaxed">
          When a manual run is triggered on a workflow containing this node, a dialog appears prompting the operator to fill in each field. The values are injected into the payload before any downstream nodes execute.
        </p>
      </div>
    </div>
  );
}

// ── Switch/Case config panel ──────────────────────────────────────────────────

interface SwitchCaseItem {
  id: string;
  matchValue: string;
  label: string;
}

const SWITCH_CASE_MAX = 20;

function BuildCasesPopover({
  groups,
  onAdd,
  onCancel,
  initialChecked,
  onCheckedChange,
}: {
  groups: { group: string; items: { id: string; label: string }[] }[];
  onAdd: (selected: { id: string; label: string }[]) => void;
  onCancel: () => void;
  initialChecked?: Record<string, boolean>;
  onCheckedChange?: (checked: Record<string, boolean>) => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      for (const item of g.items) {
        // Use persisted value if available, otherwise default to true
        init[item.id] = initialChecked ? (initialChecked[item.id] ?? true) : true;
      }
    }
    return init;
  });

  const showGroupHeaders = groups.length > 1;

  function toggleItem(id: string) {
    setChecked(prev => {
      const next = { ...prev, [id]: !prev[id] };
      onCheckedChange?.(next);
      return next;
    });
  }

  function toggleGroup(group: string, value: boolean) {
    const g = groups.find(g => g.group === group);
    if (!g) return;
    const patch: Record<string, boolean> = {};
    for (const item of g.items) patch[item.id] = value;
    setChecked(prev => {
      const next = { ...prev, ...patch };
      onCheckedChange?.(next);
      return next;
    });
  }

  function handleAdd() {
    const selected: { id: string; label: string }[] = [];
    for (const g of groups) {
      for (const item of g.items) {
        if (checked[item.id]) selected.push({ id: item.id, label: item.label });
      }
    }
    onAdd(selected);
  }

  return (
    <div className="rounded-lg border border-[#30363D] bg-[#161B22] p-3 space-y-3">
      {groups.map(g => {
        const allChecked = g.items.every(item => checked[item.id]);
        const noneChecked = g.items.every(item => !checked[item.id]);
        return (
          <div key={g.group} className="space-y-1.5">
            {showGroupHeaders && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#FB923C] uppercase tracking-wider">{g.group}</span>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.group, noneChecked ? true : false)}
                  className="text-[9px] text-[#7D8590] hover:text-[#E6EDF3] transition-colors underline"
                >
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              </div>
            )}
            {!showGroupHeaders && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.group, noneChecked ? true : false)}
                  className="text-[9px] text-[#7D8590] hover:text-[#E6EDF3] transition-colors underline"
                >
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              </div>
            )}
            <div className="space-y-1">
              {g.items.map(item => (
                <label key={item.id} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checked[item.id] ?? false}
                    onChange={() => toggleItem(item.id)}
                    className="w-3 h-3 rounded accent-orange-500 shrink-0"
                  />
                  <span className="text-[11px] text-[#E6EDF3] group-hover:text-white transition-colors">{item.label}</span>
                  <span className="text-[9px] text-[#484F58] font-mono ml-auto">{item.id}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1 border-t border-[#30363D]">
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1 rounded-lg bg-[#FB923C]/15 border border-[#FB923C]/40 text-[11px] font-semibold text-[#FB923C] hover:bg-[#FB923C]/25 transition-colors"
        >
          Add as Cases
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-[#7D8590] hover:text-[#E6EDF3] transition-colors underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ParallelPanel({
  node,
  onChange,
  nodes,
  edges,
  onGraphChange,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  nodes: Node[];
  edges: Edge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
}) {
  const branchCount  = (node.data.branchCount  as number   | undefined) ?? 2;
  const branchLabels = (node.data.branchLabels as string[] | undefined) ?? Array.from({ length: branchCount }, (_, i) => `Branch ${i + 1}`);
  const branchWait   = (node.data.branchWait   as boolean[] | undefined) ?? Array(branchCount).fill(true);
  const joinNodeId   = node.data.joinNodeId as string | undefined;

  function updateData(updates: Partial<{ branchCount: number; branchLabels: string[]; branchWait: boolean[] }>) {
    onChange(node.id, { ...node.data, ...updates });
  }

  function toStoredNodes(rfNodes: Node[]): StoredNode[] {
    return rfNodes.map(n => ({ id: n.id, type: (n.data?.nodeType as string) ?? n.type ?? "action", position: n.position, data: n.data as Record<string, unknown> }));
  }
  function toStoredEdges(rfEdges: Edge[]): StoredEdge[] {
    return rfEdges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined }));
  }

  function setBranchCount(n: number) {
    const next = Math.max(2, Math.min(4, n));
    if (next === branchCount) return;

    const nextLabels = Array.from({ length: next }, (_, i) => branchLabels[i] ?? `Branch ${i + 1}`);
    const nextWait   = Array.from({ length: next }, (_, i) => branchWait[i] ?? true);

    // Update graph edges: add or remove branch_N edges
    let newEdges = [...edges];
    if (next > branchCount) {
      // Add new branch edges (empty → join)
      for (let i = branchCount; i < next; i++) {
        const handle = `branch_${i + 1}`;
        const alreadyExists = newEdges.some(e => e.source === node.id && e.sourceHandle === handle);
        if (!alreadyExists && joinNodeId) {
          newEdges.push({ id: `e-par-b${i + 1}-${node.id}`, source: node.id, target: joinNodeId, sourceHandle: handle });
        }
      }
      onGraphChange(toStoredNodes(nodes), toStoredEdges(newEdges));
    } else {
      // Remove excess branch edges and all nodes inside those branches
      let currentNodes = [...nodes];
      for (let i = next; i < branchCount; i++) {
        const handle = `branch_${i + 1}`;
        const branchEdge = newEdges.find(e => e.source === node.id && e.sourceHandle === handle);
        if (!branchEdge) continue;
        // Collect nodes in that branch and remove them
        const joinStop = joinNodeId ? new Set([joinNodeId]) : new Set<string>();
        const branchNodeIds = new Set<string>();
        const dfsStack = [branchEdge.target];
        while (dfsStack.length > 0) {
          const nId = dfsStack.pop()!;
          if (branchNodeIds.has(nId) || joinStop.has(nId)) continue;
          branchNodeIds.add(nId);
          for (const e of newEdges.filter(e => e.source === nId)) {
            if (!branchNodeIds.has(e.target) && !joinStop.has(e.target)) dfsStack.push(e.target);
          }
        }
        newEdges = newEdges.filter(e => !branchNodeIds.has(e.source) && !branchNodeIds.has(e.target) && !(e.source === node.id && e.sourceHandle === handle));
        currentNodes = currentNodes.filter(n => !branchNodeIds.has(n.id));
      }
      onGraphChange(toStoredNodes(currentNodes), toStoredEdges(newEdges));
    }
    updateData({ branchCount: next, branchLabels: nextLabels, branchWait: nextWait });
  }

  function updateLabel(i: number, label: string) {
    const next = [...branchLabels];
    next[i] = label;
    updateData({ branchLabels: next });
  }

  function updateWait(i: number, wait: boolean) {
    const next = [...branchWait];
    next[i] = wait;
    updateData({ branchWait: next });
  }

  const branchColors = ["#06B6D4", "#A855F7", "#F59E0B", "#10B981", "#EF4444"];

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[#7D8590]">Branch Count</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setBranchCount(branchCount - 1)}
              disabled={branchCount <= 2}
              className="w-5 h-5 rounded bg-[#1C2128] border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30 text-sm leading-none flex items-center justify-center"
            >−</button>
            <span className="text-xs text-[#E6EDF3] w-4 text-center">{branchCount}</span>
            <button
              onClick={() => setBranchCount(branchCount + 1)}
              disabled={branchCount >= 4}
              className="w-5 h-5 rounded bg-[#1C2128] border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30 text-sm leading-none flex items-center justify-center"
            >+</button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {Array.from({ length: branchCount }, (_, i) => {
          const color = branchColors[i % branchColors.length];
          const wait  = branchWait[i] !== false;
          return (
            <div key={i} className="rounded-lg border border-[#30363D] overflow-hidden">
              <div className="px-2.5 py-1.5 flex items-center gap-2" style={{ background: `${color}0D`, borderBottom: `1px solid ${color}25` }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <input
                  value={branchLabels[i] ?? `Branch ${i + 1}`}
                  onChange={e => updateLabel(i, e.target.value)}
                  className="flex-1 bg-transparent text-[11px] font-semibold text-[#E6EDF3] outline-none placeholder-[#484F58]"
                  placeholder={`Branch ${i + 1}`}
                />
              </div>
              <div className="px-2.5 py-2 flex items-center justify-between bg-[#0D1117]">
                <label className="text-[10px] text-[#7D8590]">Wait for completion</label>
                <input
                  type="checkbox"
                  checked={wait}
                  onChange={e => updateWait(i, e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-[#06B6D4]"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg bg-[#041A1A] border border-[#06B6D4]/25 p-3 space-y-1.5">
        <p className="text-[10px] text-[#7D8590] leading-relaxed">
          Branches with <span className="text-[#06B6D4] font-semibold">Wait for completion</span> run concurrently via Promise.all — their outputs are merged at the Join node.
        </p>
        <p className="text-[10px] text-[#7D8590] leading-relaxed">
          Branches with it <span className="text-amber-400 font-semibold">off</span> fire and forget — failures are logged but do not fail the run.
        </p>
      </div>
    </>
  );
}

function SwitchCasePanel({
  node,
  onChange,
  ancestorOutputs,
  nodes,
  fetchWithAuth,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
  nodes: Node[];
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const cases = ((node.data.cases as SwitchCaseItem[] | undefined) ?? []);
  const switchExpr = (node.data.switchExpr as string) ?? "";

  // Detect if any referenced key has known enum values by scanning ancestorOutputs metadata first.
  // Falls back to the static registry (for domain-specific keys like reports_to_run not in NODE_OUTPUTS)
  // and then to ask_for_input select field options.
  const referencedKeys = extractReferencedKeys(switchExpr);
  const detectedList = (() => {
    for (const key of referencedKeys) {
      // Primary: scan ancestorOutputs for any output entry that declares enumValues for this key
      for (const group of ancestorOutputs) {
        const output = group.outputs.find(o => o.key === key && o.enumValues && o.enumValues.length > 0);
        if (output?.enumValues) {
          return {
            label: output.label.replace(/\s*\(.*\)$/, "").trim(), // strip parenthetical notes from label
            groups: [{ group: "Values", items: output.enumValues.map(v => ({ id: v, label: v })) }],
          };
        }
      }
      // Fallback: static registry for domain-specific keys not expressed in NODE_OUTPUTS
      const reg = LIST_VALUE_REGISTRY[key];
      if (reg) return reg;
      // Supplemental: ask_for_input select fields (dynamic, set by the admin at design time)
      const dynamic = findAskForInputSelectOptions(key, nodes);
      if (dynamic) return dynamic;
    }
    return null;
  })();
  const showBuildButton = detectedList !== null;

  const [buildOpen, setBuildOpen] = useState(false);
  const [pendingCases, setPendingCases] = useState<{ id: string; label: string }[] | null>(null);

  function updateCases(next: SwitchCaseItem[]) {
    onChange(node.id, { ...node.data, cases: next });
  }

  function addCase() {
    if (cases.length >= SWITCH_CASE_MAX) return;
    updateCases([
      ...cases,
      { id: crypto.randomUUID(), matchValue: "", label: "" },
    ]);
  }

  function removeCase(id: string) {
    updateCases(cases.filter(c => c.id !== id));
  }

  function updateCase(id: string, patch: Partial<SwitchCaseItem>) {
    updateCases(cases.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  function moveCase(id: string, dir: -1 | 1) {
    const idx = cases.findIndex(c => c.id === id);
    if (idx === -1) return;
    const next = [...cases];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    updateCases(next);
  }

  function handleBuildAdd(selected: { id: string; label: string }[]) {
    if (cases.length > 0) {
      setPendingCases(selected);
      setBuildOpen(false);
    } else {
      applyBuiltCases(selected);
    }
  }

  function applyBuiltCases(selected: { id: string; label: string }[]) {
    updateCases(selected.map(s => ({ id: crypto.randomUUID(), matchValue: s.id, label: s.label })));
    setBuildOpen(false);
    setPendingCases(null);
  }

  const inputCls = "w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:border-[#FB923C]";

  return (
    <div className="space-y-3">
      {/* Switch expression */}
      <ExpressionField
        label="Switch on (expression)"
        value={switchExpr}
        onChange={v => onChange(node.id, { ...node.data, switchExpr: v })}
        placeholder="{{status}} or {{tier}}"
        ancestorOutputs={ancestorOutputs}
        expressionType="value"
        fetchWithAuth={fetchWithAuth}
      />

      {/* Build Cases button — shown when the switch expression references a known list-valued key */}
      {showBuildButton && detectedList && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => { setBuildOpen(v => !v); setPendingCases(null); }}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-[#FB923C]/40 bg-[#FB923C]/8 text-[11px] font-semibold text-[#FB923C] hover:bg-[#FB923C]/15 hover:border-[#FB923C]/70 transition-colors"
          >
            <span>✦</span> Build Cases from {detectedList.label}
          </button>
          {buildOpen && (
            <BuildCasesPopover
              groups={detectedList.groups}
              onAdd={handleBuildAdd}
              onCancel={() => setBuildOpen(false)}
              initialChecked={(node.data.buildCasesSelection as Record<string, boolean> | undefined)}
              onCheckedChange={(checked) => onChange(node.id, { ...node.data, buildCasesSelection: checked })}
            />
          )}
          {pendingCases && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/8 px-3 py-2 space-y-2">
              <p className="text-[11px] text-amber-400">
                This will replace your {cases.length} existing case{cases.length !== 1 ? "s" : ""} — OK?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyBuiltCases(pendingCases)}
                  className="px-3 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/30 transition-colors"
                >
                  Replace cases
                </button>
                <button
                  type="button"
                  onClick={() => setPendingCases(null)}
                  className="text-[11px] text-[#7D8590] hover:text-[#E6EDF3] transition-colors underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Case list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">Cases</span>
          {cases.length >= SWITCH_CASE_MAX && (
            <span className="text-[10px] text-amber-400">Max 20 cases</span>
          )}
        </div>

        {cases.length === 0 && (
          <p className="text-[10px] text-[#484F58] italic">No cases yet — add one below</p>
        )}

        {cases.map((c, idx) => (
          <div key={c.id} className="rounded-lg border border-[#30363D] bg-[#0D1117]">
            <div className="flex items-center gap-1 px-2 py-1 bg-[#161B22] border-b border-[#30363D] rounded-t-lg">
              <span className="text-[10px] font-semibold text-[#FB923C]">Case {idx + 1}</span>
              <div className="flex-1" />
              <button type="button" onClick={() => moveCase(c.id, -1)} disabled={idx === 0}
                className="text-[10px] text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 px-0.5">▲</button>
              <button type="button" onClick={() => moveCase(c.id, 1)} disabled={idx === cases.length - 1}
                className="text-[10px] text-[#484F58] hover:text-[#E6EDF3] disabled:opacity-30 px-0.5">▼</button>
              <button type="button" onClick={() => removeCase(c.id)}
                className="text-[10px] text-red-400 hover:text-red-300 px-0.5 ml-1">✕</button>
            </div>
            <div className="p-2 space-y-1.5">
              <PayloadField
                label="Match value (exact)"
                value={c.matchValue}
                onChange={v => updateCase(c.id, { matchValue: v })}
                placeholder="active or {{steps.node-101.reports_to_run}}"
                ancestorOutputs={ancestorOutputs}
              />
              <div>
                <label className="text-[10px] text-[#7D8590] block mb-0.5">Handle label (shown on canvas)</label>
                <input
                  type="text"
                  value={c.label}
                  onChange={e => updateCase(c.id, { label: e.target.value })}
                  placeholder="Active"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        ))}

        {/* Default (locked) */}
        <div className="rounded-lg border border-[#30363D]/50 bg-[#0D1117] overflow-hidden opacity-60">
          <div className="flex items-center gap-1 px-2 py-1 bg-[#161B22] border-b border-[#30363D]/50">
            <span className="text-[10px] font-semibold text-[#6B7280]">Default</span>
            <span className="ml-auto text-[9px] text-[#484F58]">🔒 always present</span>
          </div>
          <p className="text-[10px] text-[#484F58] p-2">Fires when no case matches</p>
        </div>

        <button
          type="button"
          onClick={addCase}
          disabled={cases.length >= SWITCH_CASE_MAX}
          className="w-full py-1.5 rounded-lg border border-dashed border-[#FB923C]/40 text-[11px] text-[#FB923C] hover:border-[#FB923C]/70 hover:bg-[#FB923C]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          + Add Case
        </button>
      </div>

      <div className="rounded-lg bg-[#180D00] border border-[#FB923C]/20 p-2.5">
        <p className="text-[10px] text-[#7D8590] leading-relaxed">
          Evaluates the expression against each case in order — the first exact match wins. Connect edges from each case handle and the Default handle to downstream nodes. <span className="text-[#FB923C] font-mono">{"{{switchValue}}"}</span> and <span className="text-[#FB923C] font-mono">{"{{chosenBranch}}"}</span> are injected into the next payload.
        </p>
      </div>
    </div>
  );
}

// ── Entity picker (used inside PreRunInputModal) ──────────────────────────────

interface EntityOption { id: string; label: string; group?: string }

const PROJECT_TYPE_LABELS: Record<string, string> = {
  project: "Project",
  retainer: "Retainer",
  quick_win: "Quick Win",
};

function useEntityOptions(
  type: AskForInputFieldType,
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>,
  /** Values of sibling fields — used so the project picker can scope to the selected customer */
  siblingValues: Record<string, string | string[]> = {},
  /** All sibling field definitions — lets us find which sibling is a "customer" type */
  siblingFields: AskForInputField[] = [],
): { options: EntityOption[]; loading: boolean } {
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);

  // When type is "project", resolve the selected customer ID from any sibling customer field.
  // Customer fields are always single-select so the value will be a string in practice.
  const selectedCustomerId = type === "project"
    ? (() => {
        const customerField = siblingFields.find(f => f.type === "customer");
        if (!customerField) return "";
        const raw = siblingValues[customerField.variableName];
        return Array.isArray(raw) ? (raw[0] ?? "") : (raw || "");
      })()
    : "";

  useEffect(() => {
    if (!ENTITY_FIELD_TYPES.includes(type)) return;
    if (type === "document_type") {
      const flat: EntityOption[] = [];
      for (const g of DOCUMENT_TYPE_GROUPS) {
        for (const item of g.items) {
          flat.push({ id: item.id, label: item.label, group: g.group });
        }
      }
      setOptions(flat);
      return;
    }
    setLoading(true);

    let url: string;
    if (type === "project") {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedCustomerId) params.set("customerId", selectedCustomerId);
      url = `/api/admin/insights/projects?${params.toString()}`;
    } else {
      const urlMap: Record<string, string> = {
        customer: "/api/admin/clients/enriched",
        lead: "/api/leads?limit=100",
        opportunity: "/api/opportunities?limit=100",
      };
      url = urlMap[type] ?? "";
    }

    fetchWithAuth(url)
      .then(r => r.json())
      .then((data: unknown) => {
        // insights/projects wraps in { projects: [] }; others return arrays directly or { data: [] }
        let rows: unknown[];
        if (type === "project" && data && typeof data === "object" && "projects" in (data as object)) {
          rows = ((data as { projects: unknown[] }).projects) ?? [];
        } else {
          rows = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
        }
        const mapped = (rows as Record<string, unknown>[]).map(r => {
          const id = String(r.id ?? "");
          let label = "";
          if (type === "customer") {
            const name = String(r.name || r.email || id);
            const company = r.company ? ` (${String(r.company)})` : "";
            label = name + company;
          } else if (type === "project") {
            const typeTag = r.projectType ? ` · ${PROJECT_TYPE_LABELS[String(r.projectType)] ?? String(r.projectType)}` : "";
            const status = r.status && r.status !== "active" ? ` [${String(r.status)}]` : "";
            label = String(r.title || r.name || id) + typeTag + status;
          } else if (type === "lead") {
            label = String(r.name || r.email || id);
          } else if (type === "opportunity") {
            label = String(r.companyName || r.contactName || r.name || id);
          }
          return { id, label };
        }).filter(o => o.id);
        setOptions(mapped);
      })
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [type, selectedCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { options, loading };
}

function EntityPickerControl({
  field,
  value,
  onChange,
  fetchWithAuth,
  hasError,
  siblingValues,
  siblingFields,
}: {
  field: AskForInputField;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  hasError: boolean;
  siblingValues?: Record<string, string | string[]>;
  siblingFields?: AskForInputField[];
}) {
  const { options, loading } = useEntityOptions(field.type, fetchWithAuth, siblingValues, siblingFields);
  const [search, setSearch] = useState("");
  // Support both a real string[] (new) and a legacy comma-separated string (old)
  const selected = Array.isArray(value) ? value : (value ? value.split(",").filter(Boolean) : []);

  const filtered = options.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.id.includes(search),
  );

  const borderCls = hasError ? "border-red-500" : "border-[#30363D]";

  /** Renders a flat list with sticky group header rows inserted before each new group */
  function renderWithGroups(renderItem: (o: EntityOption) => React.ReactNode) {
    const nodes: React.ReactNode[] = [];
    let lastGroup: string | undefined = undefined;
    for (const o of filtered) {
      if (o.group && o.group !== lastGroup) {
        nodes.push(
          <div key={`grp-${o.group}`} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#484F58] bg-[#161B22] border-b border-[#30363D] sticky top-0">
            {o.group}
          </div>,
        );
        lastGroup = o.group;
      }
      nodes.push(renderItem(o));
    }
    return nodes;
  }

  if (field.multi) {
    const toggle = (id: string) => {
      const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
      onChange(next);  // emit a real string[] — no CSV join
    };
    return (
      <div className={`border ${borderCls} rounded-lg bg-[#0D1117] overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363D]">
          <span className="text-[#484F58] text-xs">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none"
          />
          {selected.length > 0 && (
            <span className="text-[10px] text-[#F97316] font-medium">{selected.length} selected</span>
          )}
        </div>
        <div className="max-h-44 overflow-y-auto">
          {loading && <p className="text-[10px] text-[#484F58] p-3 text-center">Loading…</p>}
          {!loading && filtered.length === 0 && <p className="text-[10px] text-[#484F58] p-3 text-center">No results</p>}
          {!loading && renderWithGroups(o => (
            <label key={o.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#1C2128] cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
                className="w-3.5 h-3.5 rounded accent-orange-500 flex-shrink-0"
              />
              <span className="text-sm text-[#E6EDF3] truncate">{o.label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`border ${borderCls} rounded-lg bg-[#0D1117] overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#30363D]">
        <span className="text-[#484F58] text-xs">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none"
        />
        {value && <span className="text-[10px] text-[#F97316] truncate max-w-[100px]">{options.find(o => o.id === value)?.label ?? value}</span>}
      </div>
      <div className="max-h-44 overflow-y-auto">
        {loading && <p className="text-[10px] text-[#484F58] p-3 text-center">Loading…</p>}
        {!loading && filtered.length === 0 && <p className="text-[10px] text-[#484F58] p-3 text-center">No results</p>}
        {!loading && renderWithGroups(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => { onChange(o.id); setSearch(""); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[#1C2128] ${value === o.id ? "text-[#F97316] bg-[#F97316]/10" : "text-[#E6EDF3]"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Pre-run Input Modal ───────────────────────────────────────────────────────

function PreRunInputModal({
  fields,
  onSubmit,
  onCancel,
  fetchWithAuth,
}: {
  fields: AskForInputField[];
  onSubmit: (values: Record<string, string | string[]>) => void;
  onCancel: () => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(fields.map(f => [f.variableName, f.multi ? [] : ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setValue(name: string, val: string | string[]) {
    setValues(v => ({ ...v, [name]: val }));
    setErrors(err => { const n = { ...err }; delete n[name]; return n; });
  }

  function handleSubmit() {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required) {
        const v = values[f.variableName];
        const empty = Array.isArray(v) ? v.length === 0 : !v?.toString().trim();
        if (empty) errs[f.variableName] = "Required";
      }
    }
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onSubmit(values);
  }

  const inputCls = (name: string) =>
    `w-full bg-[#0D1117] border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none transition-colors ${errors[name] ? "border-red-500 focus:border-red-400" : "border-[#30363D] focus:border-[#F97316]/60"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#30363D]">
          <span className="text-[#F97316]">⌨</span>
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Run inputs required</h3>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-[#7D8590]">This workflow prompts for values before starting. Fill in the fields below.</p>

          {fields.map(f => (
            <div key={f.variableName} className="space-y-1.5">
              <label className="text-xs font-medium text-[#E6EDF3]">
                {f.label || f.variableName}
                {f.required && <span className="text-red-400 ml-0.5">*</span>}
                {ENTITY_FIELD_TYPES.includes(f.type) && (
                  <span className="ml-1.5 text-[10px] text-[#484F58] font-normal capitalize">
                    ({f.type.replace("_", " ")}{f.multi ? " · multi" : ""})
                  </span>
                )}
              </label>

              {ENTITY_FIELD_TYPES.includes(f.type) ? (
                <EntityPickerControl
                  field={f}
                  value={values[f.variableName] ?? ""}
                  onChange={v => setValue(f.variableName, v)}
                  fetchWithAuth={fetchWithAuth}
                  hasError={!!errors[f.variableName]}
                  siblingValues={values}
                  siblingFields={fields}
                />
              ) : f.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={values[f.variableName] ?? ""}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  className={inputCls(f.variableName) + " resize-none"}
                  placeholder={f.label || f.variableName}
                />
              ) : f.type === "select" ? (
                <select
                  value={values[f.variableName] ?? ""}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  className={inputCls(f.variableName)}
                >
                  <option value="">— select —</option>
                  {f.options.split(",").map(o => o.trim()).filter(Boolean).map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  value={values[f.variableName] ?? ""}
                  onChange={e => setValue(f.variableName, e.target.value)}
                  placeholder={f.label || f.variableName}
                  className={inputCls(f.variableName)}
                />
              )}

              {errors[f.variableName] && (
                <p className="text-[10px] text-red-400">{errors[f.variableName]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-[#30363D]">
          <button
            onClick={onCancel}
            className="text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#F97316] hover:bg-[#EA6C0C] text-white text-xs font-medium rounded-lg transition-colors"
          >
            🧪 Run with these values
          </button>
        </div>
      </div>
    </div>
  );
}

function TestRunPanel({ defId, nodes, edges, onClose, trigger }: {
  defId: number;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  trigger: number;
}) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [wide, setWide] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const prevTriggerRef = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  function handleClose() {
    setClosing(true);
    setTimeout(onClose, 250);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") handleClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: triggers = [], isLoading: loadingTriggers } = useQuery<WfTrigger[]>({
    queryKey: ["wf-triggers-testrun", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`);
      return res.json();
    },
  });

  const eventTriggers = triggers.filter(t => t.type === "event");
  const [selectedTriggerId, setSelectedTriggerId] = useState<number | null>(null);

  useEffect(() => {
    if (eventTriggers.length > 0 && selectedTriggerId === null) {
      setSelectedTriggerId(eventTriggers[0].id);
    }
  }, [eventTriggers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTrigger = eventTriggers.find(t => t.id === selectedTriggerId) ?? eventTriggers[0] ?? null;
  const activeEventName = activeTrigger ? String((activeTrigger.config as Record<string, unknown>).eventName ?? "") : "";
  const knownEvent = KNOWN_EVENTS.find(e => e.name === activeEventName) ?? null;

  const defaultPayload = useMemo(() => {
    if (!knownEvent) return {};
    return Object.fromEntries(knownEvent.payloadFields.map(f => [f.key, generateMockValue(f.key)]));
  }, [knownEvent?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const [payloadText, setPayloadText] = useState(() => JSON.stringify({}, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [showInputModal, setShowInputModal] = useState(false);

  useEffect(() => {
    setPayloadText(JSON.stringify(defaultPayload, null, 2));
    setJsonErr(null);
  }, [JSON.stringify(defaultPayload)]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePayloadChange(val: string) {
    setPayloadText(val);
    try { JSON.parse(val); setJsonErr(null); } catch (e) { setJsonErr((e as Error).message); }
  }

  const askForInputNode = nodes.find(n => (n.data.nodeType as string) === "ask_for_input");
  const askForInputFields = (askForInputNode?.data?.fields as AskForInputField[] | undefined) ?? [];

  function handleRunClick(payloadOverride?: Record<string, unknown>) {
    if (askForInputFields.length > 0) {
      setShowInputModal(true);
    } else {
      runMut.mutate({ inputValues: {}, payloadOverride });
    }
  }

  useEffect(() => {
    if (trigger > 0 && trigger !== prevTriggerRef.current && !loadingTriggers) {
      prevTriggerRef.current = trigger;
      setRunId(null);
      runMut.reset();
      // Only auto-start if there are no ask_for_input fields — otherwise the
      // user needs to configure fake/live mode first, then click "Fill Inputs & Run".
      if (askForInputFields.length === 0) {
        handleRunClick(defaultPayload);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, loadingTriggers]);

  const runMut = useMutation({
    mutationFn: async ({ inputValues, payloadOverride }: { inputValues: Record<string, string | string[]>; payloadOverride?: Record<string, unknown> }) => {
      const triggerPayload = payloadOverride ?? JSON.parse(payloadText) as Record<string, unknown>;
      // Serialize the same way as the save path: replace RF's type:"wfNode" with
      // the real workflow node type stored in data.nodeType, and strip extra edge fields.
      const graphNodes = nodes.map(n => ({
        id: n.id,
        type: (n.data.nodeType as string) ?? "action",
        position: n.position,
        data: n.data,
      }));
      const graphEdges = edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      }));
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: graphNodes, edges: graphEdges, triggerPayload, inputValues, dryRun }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error ?? "Failed to start run"));
      }
      return res.json() as Promise<{ runId: number }>;
    },
    onSuccess: (data) => setRunId(data.runId),
  });

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
  const { data: progressRunData } = useQuery<WfRunDetail>({
    queryKey: ["wf-test-run-progress", runId],
    enabled: runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.has(status) ? false : 2000;
    },
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}`);
      return res.json() as Promise<WfRunDetail>;
    },
  });

  const progressLogs = (progressRunData?.logs ?? []).filter(l => l.level === "progress");
  const latestProgress = progressLogs[progressLogs.length - 1] ?? null;
  const runIsTerminal = progressRunData?.status ? TERMINAL_STATUSES.has(progressRunData.status) : false;
  const [progressDismissed, setProgressDismissed] = useState(false);
  useEffect(() => {
    if (runIsTerminal && progressLogs.length > 0) {
      const timer = setTimeout(() => setProgressDismissed(true), 3000);
      return () => clearTimeout(timer);
    }
    setProgressDismissed(false);
    return undefined;
  }, [runIsTerminal, progressLogs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const slideClass = !mounted || closing ? "translate-x-full" : "translate-x-0";

  return (
    <div
      className={`fixed right-0 top-14 bottom-0 z-50 bg-[#161B22] border-l border-[#30363D] shadow-2xl flex flex-col transform transition-all duration-250 ease-in-out ${slideClass} ${wide ? "w-[760px]" : "w-[480px]"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm flex-shrink-0">🧪</span>
          <h3 className="text-sm font-semibold text-[#E6EDF3] flex-shrink-0">Test Run</h3>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider flex-shrink-0">Draft</span>
          {runId !== null && (
            <span className="text-[10px] text-[#484F58] font-mono flex-shrink-0">#{runId}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {/* Dry-run / Live toggle — only relevant before run starts */}
          {runId === null && (
            <div className="flex items-center rounded-lg border border-[#30363D] overflow-hidden text-[10px] font-semibold">
              <button
                type="button"
                onClick={() => setDryRun(true)}
                className={`px-2.5 py-1 transition-colors ${dryRun ? "bg-[#0078D4] text-white" : "text-[#7D8590] hover:text-[#E6EDF3]"}`}
                title="Use fake/stub data — no real actions are performed"
              >
                Fake data
              </button>
              <button
                type="button"
                onClick={() => setDryRun(false)}
                className={`px-2.5 py-1 transition-colors ${!dryRun ? "bg-red-500/80 text-white" : "text-[#7D8590] hover:text-[#E6EDF3]"}`}
                title="Execute nodes for real — emails will send, records will be created"
              >
                Live
              </button>
            </div>
          )}
          <button
            onClick={() => setWide(w => !w)}
            title={wide ? "Narrow panel" : "Wide panel"}
            className="text-[#484F58] hover:text-[#E6EDF3] transition-colors p-1 rounded"
          >
            {wide ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4m0 0H4m5 0L3 10m12-1V4m0 0h5m-5 0l6 6M9 20v-5m0 5H4m5 0l-6-6m12 6v-5m0 5h5m-5 0l6-6" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>
          <button onClick={handleClose} className="text-[#484F58] hover:text-[#E6EDF3] text-xl leading-none px-1">×</button>
        </div>
      </div>

      {/* ── Run active: full Execution Replay / Timeline / Payload tabs ── */}
      {runId !== null ? (
        <>
          {!dryRun && (
            <div className="flex-shrink-0 rounded-none border-b border-red-500/40 bg-red-500/10 px-3 py-2 flex items-center gap-2">
              <span className="text-red-400 text-xs flex-shrink-0">⚠</span>
              <p className="text-[11px] font-semibold text-red-400">Live run — real actions fired</p>
            </div>
          )}
          {/* ── Live progress panel ── */}
          {progressLogs.length > 0 && !progressDismissed && (
            <div className={`flex-shrink-0 border-b border-cyan-500/20 bg-cyan-500/5 px-4 py-2.5 space-y-1.5 transition-all duration-500 ${runIsTerminal ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-cyan-400 text-[10px]">📶</span>
                <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">Progress</span>
                {runIsTerminal && (
                  <span className="text-[9px] text-cyan-400/50">— run ended</span>
                )}
              </div>
              {progressLogs.map(log => {
                const step  = (log.metadata?.step  as number | undefined);
                const total = (log.metadata?.total as number | undefined);
                return (
                  <div key={log.id} className="flex items-start gap-2">
                    {step != null && total != null ? (
                      <span className="text-[9px] font-mono font-bold text-cyan-500/70 flex-shrink-0 mt-0.5">{step}/{total}</span>
                    ) : (
                      <span className="text-[9px] text-cyan-500/40 flex-shrink-0 mt-0.5">·</span>
                    )}
                    <p className="text-[11px] text-cyan-300 leading-tight">{log.message}</p>
                  </div>
                );
              })}
              {latestProgress && latestProgress.metadata?.step != null && latestProgress.metadata?.total != null && (
                <div className="mt-1.5 h-1 bg-cyan-500/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500/60 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (Number(latestProgress.metadata.step) / Number(latestProgress.metadata.total)) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <RunDetailContent runId={runId} />
          </div>
          <div className="flex-shrink-0 flex gap-2 px-4 py-3 border-t border-[#30363D]">
            <button
              onClick={() => navigate(`/workflows/runs/${runId}`)}
              className="flex-1 px-4 py-2 bg-[#1C2128] border border-[#30363D] hover:border-[#484F58] text-[#7D8590] hover:text-[#E6EDF3] text-xs font-medium rounded-lg transition-colors"
            >
              Open full run page →
            </button>
            <button
              onClick={() => { setRunId(null); runMut.reset(); }}
              className="px-4 py-2 bg-[#0078D4] hover:bg-[#006CBD] text-white text-xs font-medium rounded-lg transition-colors"
            >
              Run again
            </button>
          </div>
        </>
      ) : (
        /* ── Setup phase: trigger selector + payload editor + run button ── */
        <>
          <div className="overflow-y-auto flex-1 p-4 space-y-4">

            {/* ── Live-mode warning ── */}
            {!dryRun && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 flex items-start gap-2">
                <span className="text-red-400 text-sm flex-shrink-0 mt-0.5">⚠</span>
                <div>
                  <p className="text-xs font-semibold text-red-400">Live execution — real actions will fire</p>
                  <p className="text-[11px] text-[#7D8590] mt-0.5">Emails will send, records will be created, and APIs will be called for real. Switch to <strong className="text-[#E6EDF3]">Fake data</strong> to test safely.</p>
                </div>
              </div>
            )}

            {/* ── Trigger context ── */}
            {loadingTriggers ? (
              <div className="text-xs text-[#484F58] py-1 animate-pulse">Loading triggers…</div>
            ) : eventTriggers.length > 1 ? (
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Simulate event trigger</label>
                <select
                  value={selectedTriggerId ?? ""}
                  onChange={e => setSelectedTriggerId(Number(e.target.value))}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                >
                  {eventTriggers.map(t => (
                    <option key={t.id} value={t.id}>
                      {String((t.config as Record<string, unknown>).eventName ?? `trigger #${t.id}`)}
                    </option>
                  ))}
                </select>
              </div>
            ) : activeTrigger ? (
              <div className="rounded-lg bg-[#0D1117] border border-[#0078D4]/30 p-3 space-y-0.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[#0078D4]">Simulating event trigger</p>
                <p className="text-xs font-mono text-[#E6EDF3]">{activeEventName || "—"}</p>
                {knownEvent && <p className="text-[10px] text-[#7D8590] mt-0.5">{knownEvent.description}</p>}
              </div>
            ) : (
              <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3">
                <p className="text-[10px] text-[#7D8590]">No event trigger — running with manual payload.</p>
              </div>
            )}

            {/* ── Payload editor ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Test payload (JSON)</label>
                {knownEvent && (
                  <button
                    onClick={() => { setPayloadText(JSON.stringify(defaultPayload, null, 2)); setJsonErr(null); }}
                    className="text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors"
                  >
                    ↺ Reset to mock
                  </button>
                )}
              </div>
              <textarea
                value={payloadText}
                onChange={e => handlePayloadChange(e.target.value)}
                rows={knownEvent ? 9 : 6}
                spellCheck={false}
                className="w-full font-mono text-xs bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 resize-none"
              />
              {jsonErr && (
                <p className="text-[10px] text-red-400 font-mono break-all">{jsonErr}</p>
              )}
            </div>

            {/* ── Field reference ── */}
            {knownEvent && knownEvent.payloadFields.length > 0 && (
              <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-3">
                <p className="text-[10px] uppercase tracking-widest font-bold text-[#484F58] mb-2">Payload fields</p>
                <div className="space-y-1">
                  {knownEvent.payloadFields.map(f => (
                    <div key={f.key} className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-[#2E9EFF] flex-shrink-0">{`{{${f.key}}}`}</span>
                      <span className="text-[10px] text-[#484F58]">{f.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {runMut.isError && (
              <p className="text-[10px] text-red-400">{(runMut.error as Error).message}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#30363D] flex-shrink-0">
            <button onClick={handleClose} className="text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
            <button
              onClick={() => handleRunClick()}
              disabled={!!jsonErr || runMut.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {runMut.isPending
                ? <><span className="animate-spin inline-block">⟳</span> Starting…</>
                : askForInputFields.length > 0
                  ? <>⌨ Fill inputs & Run</>
                  : <>🧪 Run Draft Canvas</>}
            </button>
          </div>
        </>
      )}

      {showInputModal && (
        <PreRunInputModal
          fields={askForInputFields}
          fetchWithAuth={fetchWithAuth}
          onSubmit={(inputValues) => {
            setShowInputModal(false);
            runMut.mutate({ inputValues });
          }}
          onCancel={() => setShowInputModal(false)}
        />
      )}
    </div>
  );
}

// ── AI Workflow Modal ─────────────────────────────────────────────────────────

interface AiWorkflowResult {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  unsupportedFeatures?: string[] | null;
  replitPrompt?: string | null;
}

const AI_TRIGGER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "",                    label: "— not specified —" },
  { value: "lead.created",        label: "Event: New lead submits form" },
  { value: "lead.qualified",      label: "Event: Lead passes qualification" },
  { value: "opportunity.created", label: "Event: Lead converts to opportunity" },
  { value: "client.created",      label: "Event: New client account created" },
  { value: "payment.received",    label: "Event: Stripe payment received" },
  { value: "contract.signed",     label: "Event: Contract signed" },
  { value: "quiz.lead_submitted", label: "Event: M365 readiness quiz completed" },
  { value: "m365.health_check_complete", label: "Event: M365 health check complete" },
  { value: "schedule",            label: "Scheduled (cron)" },
  { value: "webhook",             label: "Webhook call" },
  { value: "manual",              label: "Manual / admin trigger" },
];

function AiWorkflowModal({
  defId,
  onClose,
  onGenerate,
}: {
  defId: number;
  onClose: () => void;
  onGenerate: (result: AiWorkflowResult) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ features: string[]; prompt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const MIN_DESC_LEN = 20;
  const descTrimmed = description.trim();
  const descTooShort = descTrimmed.length > 0 && descTrimmed.length < MIN_DESC_LEN;

  async function handleGenerate() {
    if (descTrimmed.length < MIN_DESC_LEN) return;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const body: Record<string, string> = { description: description.trim() };
      if (triggerType) body.triggerContext = triggerType;
      const res = await fetchWithAuth(`/api/admin/workflows/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as AiWorkflowResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "AI generation failed");
        return;
      }
      // Hydrate the canvas immediately
      onGenerate(data);
      // If the engine couldn't cover everything, stay open and show the suggestion
      if (data.replitPrompt) {
        setSuggestion({
          features: data.unsupportedFeatures ?? [],
          prompt: data.replitPrompt,
        });
      } else {
        onClose();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!suggestion) return;
    void navigator.clipboard.writeText(suggestion.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Suggestion view (shown after canvas is built but gaps were found) ─────────
  if (suggestion) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-lg w-full mx-4 space-y-4 max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Success header */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-[#E6EDF3]">Workflow generated</h2>
              <p className="text-xs text-[#7D8590]">Canvas updated — some steps need new node types first.</p>
            </div>
            <button onClick={onClose} className="ml-auto text-[#7D8590] hover:text-[#E6EDF3] transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Unsupported features list */}
          {suggestion.features.length > 0 && (
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                Not yet supported by the workflow engine
              </p>
              <ul className="space-y-1">
                {suggestion.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-300/80">
                    <span className="text-amber-500/60 mt-0.5 flex-shrink-0">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Replit prompt box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#E6EDF3] flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                Replit prompt to build this
              </p>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${copied ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-[#21262D] hover:bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D]"}`}
              >
                {copied ? (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-[11px] text-[#7D8590] font-mono whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
              {suggestion.prompt}
            </pre>
            <p className="text-[10px] text-[#484F58]">
              Copy this prompt and paste it into Replit AI to add the missing node types end-to-end.
            </p>
          </div>

          <div className="flex justify-end pt-1 border-t border-[#30363D]">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-sm text-[#E6EDF3] font-medium rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Default generation form ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-lg w-full mx-4 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-[#E6EDF3]">Build with AI</h2>
            <p className="text-xs text-[#7D8590]">Describe the workflow and AI will generate the canvas nodes and connections.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-[#7D8590] hover:text-[#E6EDF3] transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Trigger (optional)</label>
          <select
            value={triggerType}
            onChange={e => setTriggerType(e.target.value)}
            disabled={loading}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 disabled:opacity-50"
          >
            {AI_TRIGGER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Describe your workflow</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. When a new lead submits the contact form, score them, create an opportunity if they qualify, then send a welcome email and assign a pipeline stage."
            rows={5}
            maxLength={2000}
            disabled={loading}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none disabled:opacity-50"
          />
          <div className="flex justify-between items-start gap-2">
            {descTooShort ? (
              <span className="text-[10px] text-amber-400">Add more detail — at least {MIN_DESC_LEN} characters, describing specific steps, conditions, and actions</span>
            ) : (
              <span className="text-[10px] text-[#484F58]">Be specific about conditions, actions, and data fields</span>
            )}
            <span className="text-[10px] text-[#484F58] flex-shrink-0">{description.length}/2000</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || descTrimmed.length < MIN_DESC_LEN}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-[#484F58] border-t border-[#30363D] pt-3">
          Existing canvas content will be replaced. Save first if you want to keep it. Uses Replit AI (Anthropic) — billed to your credits.
        </p>
      </div>
    </div>
  );
}

// ── AI Refine Modal ───────────────────────────────────────────────────────────

function AiRefineModal({
  nodes,
  edges,
  onClose,
  onGenerate,
}: {
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onGenerate: (result: AiWorkflowResult) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const MIN_INSTR_LEN = 20;
  const instrTrimmed = instruction.trim();
  const instrTooShort = instrTrimmed.length > 0 && instrTrimmed.length < MIN_INSTR_LEN;

  async function handleRefine() {
    if (instrTrimmed.length < MIN_INSTR_LEN) return;
    setLoading(true);
    setError(null);
    try {
      // Serialize React Flow nodes to the API-expected format (type = data.nodeType)
      const apiNodes = nodes.map(n => ({
        id: n.id,
        type: (n.data.nodeType as string | undefined) ?? (n.type ?? "action"),
        position: n.position,
        data: n.data,
      }));
      const apiEdges = edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: (e.sourceHandle as string | null | undefined) ?? undefined,
      }));
      const res = await fetchWithAuth(`/api/admin/workflows/ai-refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim(), graph: { nodes: apiNodes, edges: apiEdges } }),
      });
      const data = await res.json() as { nodes?: unknown; edges?: unknown; error?: string };
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "AI refinement failed");
        return;
      }
      onGenerate(data as AiWorkflowResult);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 max-w-md w-full mx-4 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-[#E6EDF3]">Refine with AI</h2>
            <p className="text-xs text-[#7D8590]">
              Current canvas: {nodes.length} node{nodes.length !== 1 ? "s" : ""}, {edges.length} edge{edges.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-[#7D8590] hover:text-[#E6EDF3] transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">What would you like to change?</label>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="e.g. Add an error handler after the scoring node. Split the condition into two branches — one for High and one for Medium leads."
            rows={4}
            maxLength={2000}
            disabled={loading}
            autoFocus
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none disabled:opacity-50"
          />
          <div className="flex justify-between items-start gap-2">
            {instrTooShort ? (
              <span className="text-[10px] text-amber-400">Add more detail — describe a specific change like "add an error handler" or "split the lead scoring into two branches"</span>
            ) : (
              <span className="text-[10px] text-[#484F58]">e.g. "add an error handler after scoring" or "split the condition into High and Medium paths"</span>
            )}
            <span className="text-[10px] text-[#484F58] flex-shrink-0">{instruction.length}/2000</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleRefine}
            disabled={loading || instrTrimmed.length < MIN_INSTR_LEN}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Refining…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Apply Refinement
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-[#484F58] border-t border-[#30363D] pt-3">
          AI will update the canvas and preserve unchanged nodes. Ctrl+Z undoes the change. Uses Replit AI (Anthropic).
        </p>
      </div>
    </div>
  );
}

// ── Main builder ──────────────────────────────────────────────────────────────

// ── Run selector dropdown for inspect mode ────────────────────────────────────
function RunSelectorDropdown({ defId, value, onChange }: { defId: number; value: number | null; onChange: (id: number | null) => void }) {
  const { fetchWithAuth } = useAuth();
  const { data: runs = [] } = useQuery<Array<{ id: number; status: string; startedAt: string; label?: string }>>({
    // Distinct key from the parent page's auto-load query (which uses limit=1)
    // so React Query does not merge these two different fetches into one cache entry
    queryKey: ["wf-runs-recent", defId, "dropdown"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs?definitionId=${defId}&limit=20`);
      if (!res.ok) return [];
      const body = await res.json();
      // Server returns { runs: [...], total } — extract the array
      return Array.isArray(body) ? body : (body?.runs ?? []);
    },
    refetchInterval: 30000,
  });
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value ? parseInt(e.target.value, 10) : null)}
      className="text-[10px] bg-[#1C2128] border border-violet-500/30 text-violet-200 rounded-lg px-2 py-1.5 outline-none focus:border-violet-500/60 max-w-[160px] truncate"
    >
      <option value="">Select run…</option>
      {runs.map(r => (
        <option key={r.id} value={r.id}>
          #{r.id} {r.status} · {new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </option>
      ))}
    </select>
  );
}

export default function WorkflowBuilderPage({ defId, versionId, onClose, onViewRuns }: { defId: number; versionId?: number; onClose?: () => void; onViewRuns?: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [nodes, setNodes] = useState<StoredNode[]>([]);
  const [edges, setEdges] = useState<StoredEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null);
  const [, setTickNow] = useState(0);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMaxDepth, setSettingsMaxDepth] = useState<number>(5);
  const [settingsDepthError, setSettingsDepthError] = useState<string | null>(null);
  const [showTestRun, setShowTestRun] = useState(false);
  const [testRunTrigger, setTestRunTrigger] = useState(0);
  const [publishLabel, setPublishLabel] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [currentVersionId, setCurrentVersionId] = useState<number | null>(versionId ?? null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [aiToast, setAiToast] = useState<string | null>(null);
  const [publishingToProd, setPublishingToProd] = useState(false);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [localDraft, setLocalDraft] = useState<{ nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>; savedAt: string } | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Node library state
  const [libSearch, setLibSearch] = useState("");
  const [libFavs, setLibFavs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("wf-fav-nodes") ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const [recentTypes, setRecentTypes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("wf-recent-nodes") ?? "[]") as string[]; }
    catch { return []; }
  });

  function toggleFav(type: string, e: React.MouseEvent) {
    e.stopPropagation();
    setLibFavs(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      localStorage.setItem("wf-fav-nodes", JSON.stringify([...next]));
      return next;
    });
  }

  function trackRecent(type: string) {
    setRecentTypes(prev => {
      const next = [type, ...prev.filter(t => t !== type)].slice(0, 5);
      localStorage.setItem("wf-recent-nodes", JSON.stringify(next));
      return next;
    });
  }
  const nodeIdCounter = useRef(100);
  const historyRef = useRef<Array<{ nodes: StoredNode[]; edges: StoredEdge[] }>>([]);
  const redoRef = useRef<Array<{ nodes: StoredNode[]; edges: StoredEdge[] }>>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Snapshot current canvas state (max 10 entries); clears redo stack on any new mutation
  function pushHistory() {
    historyRef.current = [...historyRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  const { data: prodDbStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["prod-db-status"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/prod-db/status");
      if (!res.ok) return { connected: false };
      return res.json();
    },
    staleTime: 60_000,
  });
  const prodDbConnected = prodDbStatus?.connected ?? false;

  const publishToProd = async () => {
    setPublishingToProd(true);
    try {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/publish-to-prod`, { method: "POST" });
      const body = await res.json() as { ok?: boolean; name?: string; publishedVersionId?: number | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to publish to production");
      if (body.publishedVersionId == null) {
        setAiToast(`⚠️ "${body.name ?? "Workflow"}" has no published version — publish a version first, then push to prod.`);
      } else {
        setAiToast(`"${body.name ?? "Workflow"}" published to the production database.`);
      }
      setTimeout(() => setAiToast(null), 5000);
    } catch (err) {
      setAiToast(`Publish failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setTimeout(() => setAiToast(null), 5000);
    } finally {
      setPublishingToProd(false);
    }
  };

  const { data: def } = useQuery({
    queryKey: ["wf-def", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}`);
      return res.json() as Promise<{ id: number; name: string; description?: string; concurrencyLimit: number; maxRunDepth: number }>;
    },
  });

  // Sync settings state when def loads
  useEffect(() => {
    if (def?.maxRunDepth != null) {
      setSettingsMaxDepth(def.maxRunDepth);
    }
  }, [def?.maxRunDepth]);

  const settingsMut = useMutation({
    mutationFn: async (updates: { maxRunDepth: number }) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-def", defId] });
    },
  });

  // Triggers — same cache key as StartNodeTriggers; React Query deduplicates the network request.
  const { data: pageTriggers = [] } = useQuery<WfTrigger[]>({
    queryKey: ["wf-triggers", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Derive the distinct categories shown on the Start node badges from all event triggers.
  const canvasTriggerCategories = (() => {
    const cats: string[] = [];
    for (const t of pageTriggers) {
      if (t.type !== "event") continue;
      const evName = (t.config as Record<string, unknown>).eventName as string | undefined;
      if (!evName) continue;
      const cat = KNOWN_EVENTS.find(e => e.name === evName)?.category;
      if (cat && !cats.includes(cat)) cats.push(cat);
    }
    return cats;
  })();

  const { data: versions = [], isFetched: versionsFetched } = useQuery({
    queryKey: ["wf-versions", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions`);
      return res.json() as Promise<Array<{ id: number; versionNumber: number; label: string; status: string; isDefault: boolean; graph: { nodes: unknown[]; edges: unknown[] } }>>;
    },
  });

  const hasPublishedVersion = versions.some(v => v.status === "published");

  const { data: currentVersion, isPending: currentVersionPending } = useQuery({
    queryKey: ["wf-version", currentVersionId],
    enabled: currentVersionId != null,
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions/${currentVersionId}`);
      return res.json() as Promise<{ id: number; versionNumber: number; label: string | null; status: string; graph: { nodes: unknown[]; edges: unknown[] }; updatedAt: string }>;
    },
  });

  useEffect(() => {
    if (!currentVersion?.graph) return;
    const g = currentVersion.graph;
    const loadedNodes = (g.nodes as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>).map(n => ({
      id: n.id,
      type: "wfNode",
      position: n.position,
      data: { ...n.data, nodeType: n.data.nodeType ?? n.type },
    }));

    // Sync the ID counter so newly added nodes never collide with existing ones.
    // Parse every "node-{N}" ID and set the counter to max(current, N).
    let maxId = nodeIdCounter.current;
    for (const n of loadedNodes) {
      const m = /^node-(\d+)$/.exec(n.id);
      if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
    }
    nodeIdCounter.current = maxId;

    setNodes(loadedNodes);
    setEdges((g.edges as Array<{ id: string; source: string; target: string; sourceHandle?: string }>).map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      style: { stroke: "#30363D", strokeWidth: 2 },
      animated: false,
    })));
    setIsDirty(false);

    // Check localStorage for an unsaved draft for this version.
    // Only offer restore if the draft was saved AFTER the server's last write (updatedAt),
    // which prevents stale drafts from overwriting newer work saved from another session.
    const key = `wf-draft-${defId}-${currentVersion.id}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>; savedAt: string };
        const serverUpdatedAt = currentVersion.updatedAt ? new Date(currentVersion.updatedAt).getTime() : 0;
        const draftSavedAt = parsed.savedAt ? new Date(parsed.savedAt).getTime() : 0;
        if (parsed.nodes && parsed.edges && parsed.savedAt && draftSavedAt > serverUpdatedAt) {
          setLocalDraft(parsed);
          setShowDraftBanner(true);
        } else {
          // Draft is older than the server — discard it silently
          localStorage.removeItem(key);
          setShowDraftBanner(false);
          setLocalDraft(null);
        }
      } catch {
        localStorage.removeItem(key); // ignore corrupt draft
      }
    } else {
      setShowDraftBanner(false);
      setLocalDraft(null);
    }
  }, [currentVersion, defId, setNodes, setEdges]);

  useEffect(() => {
    if (versions.length > 0 && currentVersionId == null) {
      const draft = versions.find(v => v.status === "draft") ?? versions[0];
      setCurrentVersionId(draft.id);
    }
  }, [versions, currentVersionId]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!currentVersionId) throw new Error("No version");
      const graph = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: (n.data.nodeType as string) ?? "action",
          position: n.position,
          data: n.data,
        })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
      };
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions/${currentVersionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph }),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json() as Promise<{ id: number; autoDraftedFrom?: number; status: string }>;
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: (data) => {
      setSaveStatus("saved");
      setIsDirty(false);
      setLastDraftSavedAt(null);
      // Clear the localStorage draft — it's now safely on the server
      if (currentVersionId) localStorage.removeItem(`wf-draft-${defId}-${currentVersionId}`);
      setShowDraftBanner(false);
      setLocalDraft(null);
      setTimeout(() => setSaveStatus("idle"), 2000);
      if (data.autoDraftedFrom) {
        setCurrentVersionId(data.id);
        qc.invalidateQueries({ queryKey: ["wf-versions", defId] });
      } else {
        qc.invalidateQueries({ queryKey: ["wf-version", currentVersionId] });
      }
    },
    onError: () => setSaveStatus("error"),
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions/${currentVersionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: publishLabel.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Publish failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-versions", defId] });
      qc.invalidateQueries({ queryKey: ["wf-version", currentVersionId] });
      qc.invalidateQueries({ queryKey: ["wf-definitions"] });
      setShowPublish(false);
      setPublishLabel("");
    },
  });


  // Add a node from the library sidebar — appends to the end of the flat sequence.
  // Users can also insert at a specific position via the "+" buttons in FlowCanvas.
  function addNode(nodeType: string) {
    pushHistory();
    const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;

    // Find a leaf node to connect after (node with no outgoing plain edge)
    const sourcesOfMainEdge = new Set(edges.filter(e => !e.sourceHandle).map(e => e.source));
    const leafNode = [...nodes].reverse().find(n => !sourcesOfMainEdge.has(n.id));

    // ── Parallel: insert parallel + join pair ─────────────────────────────
    if (nodeType === "parallel") {
      const parallelId = `node-${++nodeIdCounter.current}`;
      const joinId     = `node-${++nodeIdCounter.current}`;
      const parallelNode: StoredNode = {
        id: parallelId, type: "parallel", position: { x: 300, y: 100 },
        data: { nodeType: "parallel", label: style.label, branchCount: 2, joinNodeId: joinId, branchLabels: ["Branch 1", "Branch 2"], branchWait: [true, true] },
      };
      const joinNode: StoredNode = {
        id: joinId, type: "join", position: { x: 300, y: 200 },
        data: { nodeType: "join", label: "Join", parallelNodeId: parallelId },
      };
      const extraEdges = [
        { id: `e-par-b1-${parallelId}`, source: parallelId, target: joinId, sourceHandle: "branch_1" },
        { id: `e-par-b2-${parallelId}`, source: parallelId, target: joinId, sourceHandle: "branch_2" },
      ];
      if (leafNode) {
        setNodes(nds => [...nds, parallelNode, joinNode]);
        setEdges(eds => [...eds, { id: `e-lib-${parallelId}`, source: leafNode.id, target: parallelId }, ...extraEdges]);
      } else {
        setNodes(nds => [...nds, parallelNode, joinNode]);
        setEdges(eds => [...eds, ...extraEdges]);
      }
      trackRecent(nodeType);
      setIsDirty(true);
      return;
    }

    const id = `node-${++nodeIdCounter.current}`;
    const newNode: StoredNode = {
      id,
      type: nodeType,
      position: { x: 300, y: 100 },
      data: { nodeType, label: style.label },
    };

    if (leafNode) {
      setNodes(nds => [...nds, newNode]);
      setEdges(eds => [...eds, { id: `e-lib-${id}`, source: leafNode.id, target: id }]);
    } else {
      setNodes(nds => [...nds, newNode]);
    }
    trackRecent(nodeType);
    setIsDirty(true);
  }

  function duplicateNode(id: string) {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    pushHistory();
    const newId = `node-${++nodeIdCounter.current}`;
    setNodes(nds => [...nds, { ...node, id: newId, position: { x: node.position.x + 40, y: node.position.y + 40 } }]);
    setIsDirty(true);
  }

  const [copiedStep, setCopiedStep] = useState<import("./flowTree").FlowStep | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [publishAcknowledged, setPublishAcknowledged] = useState(false);

  // ── Semantic Auto-Layout ────────────────────────────────────────────────────
  const runAutoLayout = useCallback(() => {
    if (!nodes.length) return;
    const NODE_W = 240;
    const NODE_H = 64;
    const GAP_Y = 36;
    const BRANCH_GAP_X = 32;
    const FAN_EXTRA_H = 52;

    // Build edge-aware adjacency (edges keyed by sourceHandle for fan-out nodes)
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();
    const nodeMap = new Map<string, (typeof nodes)[number]>();
    for (const n of nodes) {
      children.set(n.id, []);
      parents.set(n.id, []);
      nodeMap.set(n.id, n);
    }
    for (const e of edges) {
      children.get(e.source)?.push(e.target);
      parents.get(e.target)?.push(e.source);
    }

    // Find root (no parents) — start node
    const root = nodes.find(n => (parents.get(n.id)?.length ?? 0) === 0) ?? nodes[0];

    const positioned = new Map<string, { x: number; y: number }>();
    const visited = new Set<string>();

    // Returns bounding height consumed by this subtree
    function layoutNode(id: string, x: number, y: number): number {
      if (visited.has(id)) return NODE_H; // back-edge (loop) — already placed
      visited.add(id);
      positioned.set(id, { x, y });

      const node = nodeMap.get(id);
      const nodeType = (node?.data?.nodeType as string | undefined) ?? "action";
      const kids = children.get(id) ?? [];

      // Fan-out node types: parallel, condition (Y-shape), switch (comb)
      // These spread their children horizontally like a tree fan
      const isFanOut = nodeType === "parallel" || nodeType === "condition" || nodeType === "switch";
      if (isFanOut && kids.length > 1) {
        // First pass: measure each subtree width
        const subtreeWidths = kids.map(() => NODE_W);
        const totalWidth = subtreeWidths.reduce((s, w) => s + w, 0) + (kids.length - 1) * BRANCH_GAP_X;
        let branchX = x - totalWidth / 2 + NODE_W / 2;
        let maxBranchH = 0;
        for (let i = 0; i < kids.length; i++) {
          const h = layoutNode(kids[i], branchX, y + NODE_H + FAN_EXTRA_H);
          if (h > maxBranchH) maxBranchH = h;
          branchX += subtreeWidths[i] + BRANCH_GAP_X;
        }
        return NODE_H + FAN_EXTRA_H + maxBranchH + GAP_Y;
      }

      // Join / merge: center horizontally over the average x of parent positions
      // (This runs naturally since parents lay out before children in BFS; position
      //  already set above. We refine x after all parents are visited.)
      // NOTE: join re-centering is done in a post-pass below.

      // Sequential — stack vertically
      let curY = y + NODE_H + GAP_Y;
      for (const kid of kids) {
        const h = layoutNode(kid, x, curY);
        curY += h + GAP_Y;
      }
      return kids.length > 0 ? curY - y - GAP_Y : NODE_H;
    }

    layoutNode(root.id, 0, 0);

    // Post-pass: re-center join nodes (multiple parents) at the avg x of their parents
    for (const n of nodes) {
      const pids = parents.get(n.id) ?? [];
      if (pids.length > 1) {
        const pxs = pids.map(pid => positioned.get(pid)?.x ?? 0);
        const avgX = pxs.reduce((s, v) => s + v, 0) / pxs.length;
        const cur = positioned.get(n.id);
        if (cur) positioned.set(n.id, { ...cur, x: avgX });
      }
    }

    // Shift all x coords so minimum is 0 (left-align)
    const allX = [...positioned.values()].map(p => p.x);
    const minX = Math.min(...allX);

    pushHistory();
    setNodes(prev => prev.map(n => {
      const pos = positioned.get(n.id);
      return pos ? { ...n, position: { x: pos.x - minX, y: pos.y } } : n;
    }));
    setIsDirty(true);
  }, [nodes, edges, pushHistory]);

  // Auto-layout when node count changes (added, removed, or structural reorder)
  const prevNodeCountRef = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length !== prevNodeCountRef.current && nodes.length > 1) {
      runAutoLayout();
    }
    prevNodeCountRef.current = nodes.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  // Handle graph changes emitted by FlowCanvas (add/remove/reorder steps)
  function handleGraphChange(newNodes: StoredNode[], newEdges: StoredEdge[]) {
    pushHistory();
    setNodes(newNodes);
    setEdges(newEdges);
    setIsDirty(true);
  }

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  function updateNodeData(id: string, data: Record<string, unknown>) {
    redoRef.current = [];
    setCanRedo(false);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data } : n));
    setIsDirty(true);
  }

  function deleteNode(id: string) {
    const node = nodes.find(n => n.id === id);
    if (node && ((node.data.nodeType as string) === "start" || node.type === "start")) return;
    pushHistory();
    const updated = graphRemoveStep(nodes, edges, id);
    setNodes(updated.nodes);
    setEdges(updated.edges);
    setSelectedNodeId(prev => (prev === id ? null : prev));
    setIsDirty(true);
  }

  // Shared canvas hydration for both AI generate and AI refine
  // Re-maps AI-provided IDs to stable node-N IDs to prevent React Flow key collisions.
  // For refine, existing node IDs that Claude preserved are also remapped so the result
  // is always collision-free with any pre-existing state left in the counter.
  function hydrateAiResult(result: AiWorkflowResult, toastMsg: string) {
    pushHistory();
    const idMap = new Map<string, string>();
    result.nodes.forEach(n => {
      idMap.set(n.id, `node-${++nodeIdCounter.current}`);
    });
    const rfNodes = result.nodes.map(n => ({
      id: idMap.get(n.id)!,
      type: "wfNode" as const,
      position: n.position,
      data: { ...n.data, nodeType: n.data.nodeType ?? n.type },
    }));
    const rfEdges = result.edges.map((e, i) => ({
      id: `ai-edge-${i + 1}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      style: { stroke: "#30363D", strokeWidth: 2 },
    }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    setIsDirty(true);
    setAiToast(toastMsg);
    setTimeout(() => setAiToast(null), 5000);
  }

  // Hydrate canvas from AI-generated graph — normalise all IDs to avoid collisions.
  // Note: the modal closes itself via onClose() — either immediately (no suggestion)
  // or after the user copies the Replit prompt and clicks Done.
  function handleAiGenerate(result: AiWorkflowResult) {
    hydrateAiResult(result, "Workflow generated — review and save when ready");
  }

  // Hydrate canvas from AI-refined graph
  function handleAiRefine(result: AiWorkflowResult) {
    setShowRefineModal(false);
    hydrateAiResult(result, `Workflow refined — ${result.nodes.length} node${result.nodes.length !== 1 ? "s" : ""}. Ctrl+Z to undo.`);
  }

  // Named undo / redo handlers — shared by keyboard shortcuts and toolbar buttons
  const handleUndo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current = [...redoRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setIsDirty(true);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
    setNodes(next.nodes);
    setEdges(next.edges);
    setIsDirty(true);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
  }, [nodes, edges, setNodes, setEdges]);

  // ── Inspect mode (overlay run results on canvas) ──────────────────────────
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectRunId, setInspectRunId] = useState<number | null>(null);

  // Auto-load the most recent run when entering inspect mode
  // NOTE: /runs returns { runs, total } — must extract .runs
  // Uses distinct key suffix "autoload" so it never collides with the dropdown's "dropdown" cache entry
  const { data: recentRunsForInspect = [] } = useQuery<Array<{ id: number; status: string; startedAt: string }>>({
    queryKey: ["wf-runs-recent", defId, "autoload"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs?definitionId=${defId}&limit=1`);
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body) ? body : (body?.runs ?? []);
    },
    enabled: inspectMode,
    refetchInterval: false,
  });
  useEffect(() => {
    if (inspectMode && inspectRunId == null && recentRunsForInspect.length > 0) {
      setInspectRunId(recentRunsForInspect[0].id);
    }
  }, [inspectMode, inspectRunId, recentRunsForInspect]);

  const { data: inspectRunData } = useQuery<{
    id: number;
    status: string;
    nodeOutputs?: Array<{ nodeId: string; status: string; durationMs: number | null; errorMessage: string | null }>;
    logs?: Array<{ nodeId: string; message: string; timestamp: string; metadata?: Record<string, unknown> | null }>;
    nodeResultMap?: Record<string, { status: "ok" | "error" | "skipped"; durationMs: number | null; errorMessage: string | null; logPreview: string | null }>;
  }>({
    queryKey: ["wf-run-inspect", inspectRunId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${inspectRunId}`);
      return res.json();
    },
    enabled: inspectMode && inspectRunId != null,
    refetchInterval: false,
  });

  const stepResultMap = React.useMemo<Record<string, { status: "ok" | "error" | "skipped"; durationMs?: number | null; errorMessage?: string | null; logPreview?: string | null }>>(() => {
    if (!inspectMode) return {};
    // Build logsByNode from the full logs array for all paths
    const logsByNode: Record<string, string[]> = {};
    for (const l of inspectRunData?.logs ?? []) {
      if (!logsByNode[l.nodeId]) logsByNode[l.nodeId] = [];
      logsByNode[l.nodeId].push(l.message);
    }
    // Prefer the server-computed nodeResultMap (has persisted log_preview), then
    // augment it with the full log lines so the inline drawer shows everything
    if (inspectRunData?.nodeResultMap) {
      const augmented: Record<string, { status: "ok" | "error" | "skipped"; durationMs?: number | null; errorMessage?: string | null; logPreview?: string | null; fullLogs?: string[] }> = {};
      for (const [nodeId, r] of Object.entries(inspectRunData.nodeResultMap)) {
        augmented[nodeId] = { ...r, fullLogs: logsByNode[nodeId] ?? [] };
      }
      return augmented;
    }
    // Fallback: derive from nodeOutputs + logs arrays
    if (!inspectRunData?.nodeOutputs) return {};
    const map: Record<string, { status: "ok" | "error" | "skipped"; durationMs?: number | null; errorMessage?: string | null; logPreview?: string | null; fullLogs?: string[] }> = {};
    for (const o of inspectRunData.nodeOutputs) {
      const s = (o.status === "success" || o.status === "ok") ? "ok" : o.status === "skipped" ? "skipped" : "error";
      const nodeLogs = logsByNode[o.nodeId] ?? [];
      const logPreview = nodeLogs.length > 0 ? nodeLogs[nodeLogs.length - 1].slice(0, 120) : null;
      map[o.nodeId] = { status: s as "ok" | "error" | "skipped", durationMs: o.durationMs, errorMessage: o.errorMessage, logPreview, fullLogs: nodeLogs };
    }
    return map;
  }, [inspectMode, inspectRunData]);

  // Ctrl+Z / Cmd+Z undo  |  Ctrl+Shift+Z / Cmd+Shift+Z redo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const inInput = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;

      // Ctrl+Z / Cmd+Z — undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (inInput) return;
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
        return;
      }

      // Ctrl+S / Cmd+S — save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        if (inInput) return;
        e.preventDefault();
        saveMut.mutate();
        return;
      }

      // Ctrl+D / Cmd+D — duplicate selected
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (inInput) return;
        e.preventDefault();
        if (selectedNodeId) duplicateNode(selectedNodeId);
        return;
      }

      // Ctrl+Enter — open publish dialog
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (inInput) return;
        e.preventDefault();
        setPublishAcknowledged(false);
        setShowPublish(true);
        return;
      }

      // ? — open keyboard shortcut cheatsheet
      if (e.key === "?" && !inInput) {
        e.preventDefault();
        setShowShortcuts(v => !v);
        return;
      }

      // Delete / Backspace — delete selected node (confirm if it has downstream connections)
      if ((e.key === "Delete" || e.key === "Backspace") && !inInput && selectedNodeId) {
        e.preventDefault();
        const node = nodes.find(n => n.id === selectedNodeId);
        if (node && (node.data.nodeType as string) !== "start") {
          const hasChildren = edges.some(edge => edge.source === selectedNodeId);
          if (hasChildren && !window.confirm(`"${(node.data.label as string) || node.id}" has downstream steps connected to it. Delete it and disconnect them?`)) return;
          const newNodes = nodes.filter(n => n.id !== selectedNodeId);
          const newEdges = edges.filter(edge => edge.source !== selectedNodeId && edge.target !== selectedNodeId);
          pushHistory();
          handleGraphChange(newNodes, newEdges);
          setSelectedNodeId(null);
        }
        return;
      }

      // Escape — deselect
      if (e.key === "Escape" && !inInput) {
        setSelectedNodeId(null);
        setShowTestRun(false);
        return;
      }

      // / — focus library search
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("input[placeholder='Search nodes…']");
        el?.focus();
        return;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo, selectedNodeId, nodes, edges, duplicateNode, handleGraphChange, pushHistory, saveMut, setShowPublish, setShowShortcuts]);

  // Warn on tab close / reload when there are unsaved changes
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Auto-save canvas to localStorage 2 s after the last mutation so work survives a crash/close
  useEffect(() => {
    if (!isDirty || !currentVersionId) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const key = `wf-draft-${defId}-${currentVersionId}`;
      const now = new Date();
      const draft = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: (n.data.nodeType as string) ?? "action",
          position: n.position,
          data: n.data,
        })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
        savedAt: now.toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(draft));
      setLastDraftSavedAt(now);
    }, 2000);
    return () => { if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current); };
  }, [nodes, edges, isDirty, currentVersionId, defId]);

  // Tick every 30 s so the "Auto-saved X min ago" label stays current
  useEffect(() => {
    if (!lastDraftSavedAt) return;
    const id = setInterval(() => setTickNow(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastDraftSavedAt]);

  const isPublished = currentVersion?.status === "published";
  const isArchived  = currentVersion?.status === "archived";
  const isDraft     = currentVersion?.status === "draft";

  function draftAgeLabel(since: Date): string {
    const diffMs = Date.now() - since.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr === 1) return "1 hr ago";
    return `${diffHr} hr ago`;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-[#161B22] border-b border-[#30363D] gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => isDirty ? setShowUnsavedDialog(true) : (onClose ? onClose() : navigate("/workflows/list"))}
            className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors flex-shrink-0"
            title={isDirty ? "You have unsaved changes" : "Back to workflows"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#E6EDF3] truncate">{def?.name ?? "Loading…"}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#484F58]">{currentVersion?.label ?? ""}</span>
              {isPublished && (
                <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">LIVE</span>
              )}
              {isDraft && (
                <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-semibold">DRAFT</span>
              )}
              {isArchived && (
                <span className="text-[9px] bg-[#30363D] border border-[#484F58] text-[#7D8590] px-1.5 py-0.5 rounded-full font-semibold">ARCHIVED</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="p-1.5 rounded-lg border border-[#30363D] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#484F58] disabled:hover:text-[#7D8590] disabled:hover:border-[#30363D]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6" />
              </svg>
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg border border-[#30363D] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#484F58] disabled:hover:text-[#7D8590] disabled:hover:border-[#30363D]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6M21 10l-6-6" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => onViewRuns ? onViewRuns() : navigate(`/workflows/runs?definitionId=${defId}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] hover:border-[#484F58] rounded-lg transition-colors"
            title="View run history for this workflow"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            View Runs
          </button>

          {/* Semantic auto-layout */}
          {!isArchived && (
            <button
              onClick={runAutoLayout}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] hover:border-[#484F58] rounded-lg transition-colors"
              title="Auto-arrange nodes in a structured top-to-bottom layout"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
              Auto Layout
            </button>
          )}

          {/* Inspect run overlay — show execution results on canvas */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setInspectMode(v => !v); if (inspectMode) setInspectRunId(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition-colors ${inspectMode ? "bg-violet-600/20 border-violet-500/40 text-violet-300 hover:bg-violet-600/30" : "text-[#7D8590] hover:text-[#E6EDF3] border-[#30363D] hover:border-[#484F58]"}`}
              title="Inspect a run — overlay execution results on each step card"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
              Inspect
            </button>
            {inspectMode && (
              <RunSelectorDropdown
                defId={defId}
                value={inspectRunId}
                onChange={setInspectRunId}
              />
            )}
          </div>

          <button
            onClick={() => { setShowVersionHistory(false); setShowSettings(v => !v); }}
            className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${showSettings ? "text-[#E6EDF3] border-[#484F58] bg-[#1C2128]" : "text-[#7D8590] hover:text-[#E6EDF3] border-[#30363D] hover:border-[#484F58]"}`}
            title="Workflow settings"
          >
            ⚙ Settings
          </button>

          <button
            onClick={() => { setShowSettings(false); setShowVersionHistory(v => !v); }}
            className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] hover:border-[#484F58] rounded-lg transition-colors"
          >
            History ({versions.length})
          </button>

          {lastDraftSavedAt && saveStatus !== "saved" && (
            <span className="text-[11px] text-[#484F58] whitespace-nowrap" title={lastDraftSavedAt.toLocaleTimeString()}>
              Auto-saved {draftAgeLabel(lastDraftSavedAt)}
            </span>
          )}

          {!isArchived && (
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="px-3 py-1.5 text-xs border border-[#30363D] hover:border-[#484F58] rounded-lg transition-colors disabled:opacity-50 text-[#E6EDF3]"
              title={isPublished ? "Saves as a new draft — live version is unaffected" : undefined}
            >
              {saveStatus === "saving" ? "Saving…"
               : saveStatus === "saved" ? "✓ Saved"
               : saveStatus === "error" ? "Error"
               : isPublished ? "Save as Draft"
               : "Save"}
            </button>
          )}

          {isDraft && (
            <button
              onClick={() => {
                const lastPublished = versions.filter(v => v.status === "published").sort((a, b) => b.id - a.id)[0];
                setPublishLabel(lastPublished?.label ?? "");
                setPublishAcknowledged(false);
                setShowPublish(true);
              }}
              className="px-3 py-1.5 bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Publish
            </button>
          )}

          <button
            onClick={() => setShowAiModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors"
            title="Describe a workflow and let AI build it on the canvas"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Build with AI
          </button>

          {nodes.length > 0 && (
            <button
              onClick={() => setShowRefineModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 hover:border-violet-500/50 text-violet-400 hover:text-violet-300 text-xs font-medium rounded-lg transition-colors"
              title="Refine the current workflow with an AI instruction"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Refine…
            </button>
          )}

          <button
            onClick={() => { setShowTestRun(true); setTestRunTrigger(t => t + 1); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] hover:bg-[#006CBD] text-white text-xs font-medium rounded-lg transition-colors"
          >
            🧪 Test Run
          </button>

          <button
            onClick={() => void publishToProd()}
            disabled={publishingToProd || !prodDbConnected || !hasPublishedVersion}
            title={
              !prodDbConnected
                ? "Production database not configured — set DATABASE_URL_PROD in Replit Secrets"
                : !hasPublishedVersion
                ? "Publish a version first — no published version exists for this workflow"
                : "Publish this workflow to the production database"
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {publishingToProd ? (
              <div className="w-3 h-3 border border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {publishingToProd ? "Publishing…" : "Publish to Prod"}
          </button>
        </div>
      </div>

      {/* Context banners */}
      {isPublished && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-emerald-500/5 border-b border-emerald-500/20 px-4 py-2">
          <span className="text-[10px] font-semibold text-emerald-400">● LIVE VERSION</span>
          <span className="text-[10px] text-[#484F58]">Active in production. "Save as Draft" creates an editable copy — live traffic is unaffected.</span>
        </div>
      )}
      {isArchived && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-[#30363D]/30 border-b border-[#484F58]/30 px-4 py-2">
          <span className="text-[10px] font-semibold text-[#7D8590]">🔒 ARCHIVED — Read-only</span>
          <span className="text-[10px] text-[#484F58]">This is a historical snapshot. Select a different version to edit, or publish a new one from the Builder.</span>
        </div>
      )}

      {/* No-published-version hint banner */}
      {versionsFetched && !hasPublishedVersion && (
        <div className="flex-shrink-0 flex items-center gap-2 bg-amber-500/5 border-b border-amber-500/20 px-4 py-2">
          <svg className="w-3 h-3 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[10px] text-amber-300/90">
            No published version yet —{" "}
            {isDraft ? (
              <>click <strong className="font-semibold">Publish</strong> above to make this version available for production.</>
            ) : (
              <>select or save a draft version, then click <strong className="font-semibold">Publish</strong> to make one available for production.</>
            )}
          </span>
        </div>
      )}

      {/* Unsaved-draft restore banner */}
      {showDraftBanner && localDraft && (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span className="text-xs text-amber-300">
              Unsaved draft recovered from{" "}
              {new Date(localDraft.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.
              Restore it or discard?
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                // Hydrate canvas from draft using the same logic as server-graph loading
                const restoredNodes = localDraft.nodes.map(n => ({
                  id: n.id,
                  type: "wfNode" as const,
                  position: n.position,
                  data: { ...n.data, nodeType: n.data.nodeType ?? n.type },
                }));
                let maxId = nodeIdCounter.current;
                for (const n of restoredNodes) {
                  const m = /^node-(\d+)$/.exec(n.id);
                  if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
                }
                nodeIdCounter.current = maxId;
                setNodes(restoredNodes);
                setEdges(localDraft.edges.map(e => ({
                  id: e.id,
                  source: e.source,
                  target: e.target,
                  sourceHandle: e.sourceHandle,
                  style: { stroke: "#30363D", strokeWidth: 2 },
                  animated: false,
                })));
                setIsDirty(true);
                setShowDraftBanner(false);
              }}
              className="px-2.5 py-1 text-xs font-medium text-amber-300 border border-amber-500/40 rounded-lg hover:bg-amber-500/20 transition-colors"
            >
              Restore draft
            </button>
            <button
              onClick={() => {
                if (currentVersionId) localStorage.removeItem(`wf-draft-${defId}-${currentVersionId}`);
                setShowDraftBanner(false);
                setLocalDraft(null);
              }}
              className="px-2.5 py-1 text-xs font-medium text-[#7D8590] border border-[#30363D] rounded-lg hover:text-[#E6EDF3] hover:border-[#484F58] transition-colors"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Node library sidebar */}
        <div className="w-52 flex-shrink-0 bg-[#0D1117] border-r border-[#30363D] overflow-y-auto flex flex-col">
          {/* Search */}
          <div className="flex-shrink-0 p-3 border-b border-[#1C2128]">
            <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] mb-2">Node Library</p>
            <input
              value={libSearch}
              onChange={e => setLibSearch(e.target.value)}
              placeholder="Search nodes…"
              className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {/* Recently Used */}
            {recentTypes.length > 0 && !libSearch && (
              <div>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] px-1 mb-1">Recent</p>
                <div className="space-y-1">
                  {recentTypes.map(type => {
                    const n = ALL_LIBRARY_NODES.find(x => x.type === type);
                    const s = NODE_STYLES[type] ?? NODE_STYLES.action;
                    if (!n) return null;
                    return (
                      <LibraryNodeItem
                        key={`recent-${type}`}
                        n={n} s={s}
                        isFav={libFavs.has(type)}
                        onAdd={() => addNode(type)}
                        onToggleFav={e => toggleFav(type, e)}
                        isArchived={isArchived}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Favourites */}
            {libFavs.size > 0 && !libSearch && (
              <div>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] px-1 mb-1">Favourites</p>
                <div className="space-y-1">
                  {[...libFavs].map(type => {
                    const n = ALL_LIBRARY_NODES.find(x => x.type === type);
                    const s = NODE_STYLES[type] ?? NODE_STYLES.action;
                    if (!n) return null;
                    return (
                      <LibraryNodeItem
                        key={`fav-${type}`}
                        n={n} s={s}
                        isFav
                        onAdd={() => addNode(type)}
                        onToggleFav={e => toggleFav(type, e)}
                        isArchived={isArchived}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Categories (or filtered) */}
            {libSearch ? (
              <div>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] px-1 mb-1">Results</p>
                <div className="space-y-1">
                  {ALL_LIBRARY_NODES.filter(n =>
                    n.label.toLowerCase().includes(libSearch.toLowerCase()) ||
                    n.description.toLowerCase().includes(libSearch.toLowerCase()) ||
                    n.tags.some(t => t.includes(libSearch.toLowerCase()))
                  ).map(n => {
                    const s = NODE_STYLES[n.type] ?? NODE_STYLES.action;
                    return (
                      <LibraryNodeItem
                        key={n.type}
                        n={n} s={s}
                        isFav={libFavs.has(n.type)}
                        onAdd={() => addNode(n.type)}
                        onToggleFav={e => toggleFav(n.type, e)}
                        isArchived={isArchived}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              LIBRARY_CATEGORIES.map(cat => (
                <div key={cat.name}>
                  <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] px-1 mb-1">{cat.name}</p>
                  <div className="space-y-1">
                    {cat.nodes.map(n => {
                      const s = NODE_STYLES[n.type] ?? NODE_STYLES.action;
                      return (
                        <LibraryNodeItem
                          key={n.type}
                          n={n} s={s}
                          isFav={libFavs.has(n.type)}
                          onAdd={() => addNode(n.type)}
                          onToggleFav={e => toggleFav(n.type, e)}
                          isArchived={isArchived}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Flow Canvas */}
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          isArchived={isArchived}
          isLoading={!versionsFetched || (currentVersionId != null && currentVersionPending)}
          nodeStyles={NODE_STYLES}
          libraryCategories={LIBRARY_CATEGORIES}
          allLibraryNodes={ALL_LIBRARY_NODES}
          nodeIdCounter={nodeIdCounter}
          onSelectNode={id => { setSelectedNodeId(id); }}
          onGraphChange={handleGraphChange}
          onDuplicateNode={duplicateNode}
          triggerCategories={canvasTriggerCategories}
          copiedStep={copiedStep}
          onCopyStep={setCopiedStep}
          stepResultMap={inspectMode ? stepResultMap : undefined}
        />

        {/* Node config panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={{ id: selectedNode.id, data: selectedNode.data as Record<string, unknown> }}
            onChange={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
            onDelete={deleteNode}
            defId={defId}
            nodes={nodes}
            edges={edges}
            onGraphChange={handleGraphChange}
          />
        )}

        {/* Workflow settings drawer */}
        {showSettings && (
          <div className="absolute top-0 right-0 bottom-0 w-72 bg-[#161B22] border-l border-[#30363D] z-20 overflow-y-auto p-4 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E6EDF3]">Workflow Settings</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#7D8590] hover:text-[#E6EDF3]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Max nesting depth</label>
              <p className="text-[11px] text-[#7D8590] leading-relaxed">
                How deep a chain of nested <span className="font-mono text-[#E6EDF3]">Run Workflow</span> calls can go before being stopped. Lower values fail fast; raise this only for legitimate multi-level orchestration patterns (max&nbsp;10).
              </p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settingsMaxDepth}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    setSettingsMaxDepth(isNaN(v) ? 1 : v);
                    if (isNaN(v) || v < 1 || v > 10) {
                      setSettingsDepthError("Must be between 1 and 10");
                    } else {
                      setSettingsDepthError(null);
                    }
                  }}
                  className="w-20 bg-[#0D1117] border border-[#30363D] focus:border-[#0078D4]/60 rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] outline-none"
                />
                <span className="text-[10px] text-[#484F58]">default: 5</span>
              </div>
              {settingsDepthError && (
                <p className="text-[11px] text-red-400">{settingsDepthError}</p>
              )}
            </div>

            <div className="pt-2 border-t border-[#30363D]">
              <button
                onClick={async () => {
                  const v = settingsMaxDepth;
                  if (v < 1 || v > 10) {
                    setSettingsDepthError("Must be between 1 and 10");
                    return;
                  }
                  setSettingsDepthError(null);
                  await settingsMut.mutateAsync({ maxRunDepth: v });
                  setShowSettings(false);
                }}
                disabled={settingsMut.isPending || !!settingsDepthError}
                className="w-full px-3 py-1.5 text-xs font-medium bg-[#0078D4] hover:bg-[#006CBD] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {settingsMut.isPending ? "Saving…" : "Save Settings"}
              </button>
              {settingsMut.isError && (
                <p className="text-[11px] text-red-400 mt-1.5">Failed to save — please retry.</p>
              )}
            </div>
          </div>
        )}

        {/* Version history drawer */}
        {showVersionHistory && (
          <div className="absolute top-0 left-44 bottom-0 w-64 bg-[#161B22] border-l border-[#30363D] z-20 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E6EDF3]">Version History</h3>
              <button onClick={() => setShowVersionHistory(false)} className="text-[#7D8590] hover:text-[#E6EDF3]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {versions.map(v => (
              <div key={v.id} className="space-y-1">
                <button
                  onClick={() => { setCurrentVersionId(v.id); setShowVersionHistory(false); }}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${v.id === currentVersionId ? "bg-[#0078D4]/10 border-[#0078D4]/30 text-[#0078D4]" : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"}`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-semibold">{v.label ?? `v${v.versionNumber}`}</p>
                    {v.isDefault && (
                      <span className="text-[9px] bg-violet-500/10 border border-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full font-medium">Default</span>
                    )}
                  </div>
                  <p className="text-[10px] mt-0.5 capitalize">{v.status}</p>
                </button>
                {v.isDefault && v.id !== currentVersionId && (
                  <button
                    onClick={async () => {
                      await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/revert-to-default`, { method: "POST" });
                      setCurrentVersionId(v.id);
                      setShowVersionHistory(false);
                    }}
                    className="w-full text-[10px] text-violet-400 hover:text-violet-300 border border-violet-500/20 hover:border-violet-500/40 rounded-lg py-1.5 transition-colors"
                  >
                    Revert to default
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test Run panel (right slide-out) */}
      {showTestRun && (
        <TestRunPanel defId={defId} nodes={nodes} edges={edges} onClose={() => setShowTestRun(false)} trigger={testRunTrigger} />
      )}

      {/* Publish dialog */}
      {showPublish && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPublish(false)}>
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-[#E6EDF3]">Publish Version</h2>
            <p className="text-sm text-[#7D8590]">Save first, then publish to make this the live version for all triggers.</p>
            <input
              value={publishLabel}
              onChange={e => setPublishLabel(e.target.value)}
              placeholder="Version label (e.g. v1.0 — Lead Qualification)"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
            />

            {/* Diff vs last published version */}
            {(() => {
              const publishedVersion = versions.find(v => v.status === "published" && v.id !== currentVersionId);
              if (!publishedVersion) return null;
              const pubNodes: StoredNode[] = [];
              try {
                const g = publishedVersion.graph as { nodes?: StoredNode[] };
                if (g?.nodes) pubNodes.push(...g.nodes);
              } catch { }
              const currentIds = new Set(nodes.map(n => n.id));
              const pubIds = new Set(pubNodes.map(n => n.id));
              const added = nodes.filter(n => !pubIds.has(n.id));
              const removed = pubNodes.filter(n => !currentIds.has(n.id));
              const changed = nodes.filter(n => {
                const prev = pubNodes.find(p => p.id === n.id);
                return prev && JSON.stringify(prev.data) !== JSON.stringify(n.data);
              });
              if (!added.length && !removed.length && !changed.length) {
                return (
                  <div className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 text-xs text-[#7D8590]">
                    No structural changes from the current published version.
                  </div>
                );
              }
              return (
                <div className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Changes vs current live</p>
                  {added.map(n => (
                    <div key={n.id} className="flex items-center gap-2 text-xs">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">+</span>
                      <span className="text-emerald-300">{(n.data?.label as string) || n.id}</span>
                      <span className="text-[#484F58] text-[10px]">{n.id}</span>
                    </div>
                  ))}
                  {removed.map(n => (
                    <div key={n.id} className="flex items-center gap-2 text-xs">
                      <span className="w-3.5 h-3.5 rounded-full bg-red-500/20 text-red-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">−</span>
                      <span className="text-red-300 line-through">{(n.data?.label as string) || n.id}</span>
                      <span className="text-[#484F58] text-[10px]">{n.id}</span>
                    </div>
                  ))}
                  {changed.map(n => {
                    const prev = pubNodes.find(p => p.id === n.id);
                    const changedKeys = Object.keys({ ...(prev?.data ?? {}), ...(n.data ?? {}) }).filter(k => {
                      return k !== "label" && JSON.stringify((prev?.data ?? {} as Record<string,unknown>)[k]) !== JSON.stringify((n.data ?? {} as Record<string,unknown>)[k]);
                    });
                    return (
                      <div key={n.id} className="space-y-0.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="w-3.5 h-3.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">~</span>
                          <span className="text-amber-300">{(n.data?.label as string) || n.id}</span>
                          <span className="text-[#484F58] text-[10px]">{changedKeys.length} key{changedKeys.length !== 1 ? "s" : ""} changed</span>
                        </div>
                        {changedKeys.slice(0, 5).map(k => {
                          const oldV = JSON.stringify((prev?.data ?? {} as Record<string,unknown>)[k]);
                          const newV = JSON.stringify((n.data ?? {} as Record<string,unknown>)[k]);
                          const trim = (s: string) => s.length > 32 ? s.slice(0, 30) + "…" : s;
                          return (
                            <div key={k} className="ml-5 flex items-center gap-1 text-[10px] font-mono">
                              <code className="text-[#7D8590] max-w-[60px] truncate">{k}</code>
                              <span className="text-[#484F58]">:</span>
                              <span className="text-red-400/70 line-through">{trim(oldV ?? "—")}</span>
                              <span className="text-[#484F58]">→</span>
                              <span className="text-emerald-400/70">{trim(newV ?? "—")}</span>
                            </div>
                          );
                        })}
                        {changedKeys.length > 5 && (
                          <div className="ml-5 text-[10px] text-[#484F58]">+ {changedKeys.length - 5} more…</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Acknowledgment gate */}
            <label className="flex items-center gap-2 text-xs text-[#7D8590] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={publishAcknowledged}
                onChange={e => setPublishAcknowledged(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              I have reviewed the changes and am ready to publish this version
            </label>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowPublish(false); setPublishAcknowledged(false); }} className="px-4 py-2 text-sm text-[#7D8590]">Cancel</button>
              <button
                onClick={async () => { await saveMut.mutateAsync(); publishMut.mutate(); }}
                disabled={publishMut.isPending || saveMut.isPending || !publishAcknowledged}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
                title={!publishAcknowledged ? "Check the acknowledgment box above to enable publishing" : undefined}
              >
                {publishMut.isPending ? "Publishing…" : "Save & Publish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts cheatsheet */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowShortcuts(false)}>
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#E6EDF3]">Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className="text-[#484F58] hover:text-[#E6EDF3] text-sm">✕</button>
            </div>
            <div className="space-y-1">
              {([
                ["Ctrl+S", "Save current version"],
                ["Ctrl+Z", "Undo"],
                ["Ctrl+Shift+Z", "Redo"],
                ["Ctrl+D", "Duplicate selected node"],
                ["Ctrl+Enter", "Open Publish dialog"],
                ["Delete / Backspace", "Delete selected node"],
                ["Escape", "Deselect / close panels"],
                ["/", "Focus node library search"],
                ["?", "Toggle this shortcuts panel"],
              ] as [string, string][]).map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-4 py-1.5 border-b border-[#1C2128] last:border-0">
                  <code className="text-xs text-[#0078D4] bg-[#0D1117] border border-[#30363D] rounded px-2 py-0.5 font-mono whitespace-nowrap">{key}</code>
                  <span className="text-xs text-[#7D8590]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AI workflow builder modal */}
      {showAiModal && (
        <AiWorkflowModal
          defId={defId}
          onClose={() => setShowAiModal(false)}
          onGenerate={handleAiGenerate}
        />
      )}

      {/* AI generation success toast */}
      {aiToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-violet-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-xl pointer-events-none">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {aiToast}
        </div>
      )}

      {/* AI refine modal */}
      {showRefineModal && (
        <AiRefineModal
          nodes={nodes}
          edges={edges}
          onClose={() => setShowRefineModal(false)}
          onGenerate={handleAiRefine}
        />
      )}

      {/* Unsaved changes confirmation dialog */}
      {showUnsavedDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-[#E6EDF3]">Unsaved changes</h2>
                <p className="text-sm text-[#7D8590] mt-1">
                  You have unsaved changes on this canvas. If you go back now they will be lost.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowUnsavedDialog(false)}
                className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
              >
                Stay and keep editing
              </button>
              <button
                onClick={() => onClose ? onClose() : navigate("/workflows/list")}
                className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Discard &amp; go back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
