import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
  Handle,
  Position,
  type NodeProps,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useRoute } from "wouter";
import { AssetPickerModal } from "@/components/AssetPickerModal";
import RunDetailContent from "./RunDetailContent";

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
  // ── Marketing Actions ──
  send_campaign_email: { bg: "#0D1A10", border: "#10B981", icon: "📨", label: "Send Campaign Email" },
  // ── Project Actions ──
  create_kanban_task:  { bg: "#0D1020", border: "#6366F1", icon: "🗂",  label: "Create Kanban Task"  },
  // ── Content ──
  generate_article:          { bg: "#1A0D1A", border: "#C084FC", icon: "✍️", label: "Generate Article"        },
  publish_article:           { bg: "#0F1A12", border: "#4ADE80", icon: "📢", label: "Publish Article"          },
  topic_picker:              { bg: "#1A0D1A", border: "#E879F9", icon: "🎯", label: "Topic Picker"             },
  generate_image:            { bg: "#1A100A", border: "#F59E0B", icon: "🖼️", label: "Generate Image"           },
  // ── Marketing Actions (extended) ──
  create_marketing_campaign: { bg: "#0D1A10", border: "#34D399", icon: "📣", label: "Create Campaign"          },
  publish_landing_page:      { bg: "#0D1A10", border: "#6EE7B7", icon: "🚀", label: "Publish Landing Page"     },
  generate_landing_page:     { bg: "#0A1A18", border: "#34D399", icon: "🖥️", label: "Generate Landing Page"    },
  // ── Data ──
  find_object:               { bg: "#0D1020", border: "#818CF8", icon: "🔍", label: "Find Object"              },
  // ── News ──
  fetch_news_headlines: { bg: "#041A14", border: "#06B6D4", icon: "📰", label: "Fetch News Headlines" },
  // ── Social Media ──
  post_linkedin: { bg: "#051424", border: "#0A66C2", icon: "🔗", label: "Post to LinkedIn" },
  post_twitter:  { bg: "#0D0D0D", border: "#E7E7E7", icon: "𝕏",  label: "Post to X / Twitter" },
  post_facebook: { bg: "#071533", border: "#1877F2", icon: "📘", label: "Post to Facebook" },
  // ── Input ──
  ask_for_input: { bg: "#1A0E00", border: "#F97316", icon: "⌨",  label: "Ask for Input"       },
  // ── Logic ──
  switch_case:   { bg: "#180D00", border: "#FB923C", icon: "⇶",  label: "Switch"              },
};

// ── Event registry ────────────────────────────────────────────────────────────

const KNOWN_EVENTS: Array<{
  name: string;
  description: string;
  payloadFields: Array<{ key: string; label: string }>;
}> = [
  { name: "lead.created",             description: "A new lead was submitted via any channel (contact form, quiz, etc.)",   payloadFields: [{ key: "leadId", label: "Lead ID" }, { key: "leadName", label: "Full name" }, { key: "leadEmail", label: "Email address" }, { key: "company", label: "Company name" }, { key: "serviceArea", label: "Service area of interest" }] },
  { name: "lead.qualified",           description: "A lead passed qualification scoring and is ready to convert",            payloadFields: [{ key: "leadId", label: "Lead ID" }, { key: "qualificationId", label: "Qualification record ID" }, { key: "score", label: "Overall qualification score" }] },
  { name: "opportunity.created",      description: "A lead was converted into an active opportunity",                        payloadFields: [{ key: "opportunityId", label: "Opportunity ID" }, { key: "leadId", label: "Source lead ID" }, { key: "workflowType", label: "Type (e.g. DiscoveryCall)" }] },
  { name: "client.created",           description: "A new client account was provisioned in the CRM",                       payloadFields: [{ key: "clientId", label: "Client user ID" }, { key: "clientEmail", label: "Client email" }, { key: "name", label: "Client name" }] },
  { name: "project.created",          description: "A new engagement project was created",                                   payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "projectTitle", label: "Project title" }, { key: "clientId", label: "Client ID" }] },
  { name: "project.phase_changed",    description: "A project advanced to a new phase",                                      payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "phase", label: "New phase" }, { key: "previousPhase", label: "Previous phase" }] },
  { name: "payment.received",         description: "A Stripe payment was successfully processed",                            payloadFields: [{ key: "amount", label: "Amount in pence/cents" }, { key: "currency", label: "Currency code (e.g. gbp)" }, { key: "productName", label: "Product purchased" }] },
  { name: "contract.signed",          description: "A client signed their engagement contract",                              payloadFields: [{ key: "projectId", label: "Project ID" }, { key: "clientId", label: "Client ID" }, { key: "signedAt", label: "ISO timestamp" }] },
  { name: "m365.health_check_complete", description: "An M365 health check script finished running",                        payloadFields: [{ key: "clientId", label: "Client ID" }, { key: "score", label: "Overall health score" }, { key: "status", label: "Job completion status" }] },
  { name: "m365.diagnostic_failed",    description: "A Quick Win diagnostic run failed mid-way (Azure credentials absent or network error)", payloadFields: [{ key: "clientId", label: "Client user ID" }, { key: "failed", label: "Always true for this event" }, { key: "completedAt", label: "ISO timestamp of failure" }] },
  { name: "onboarding.complete",      description: "A client completed the onboarding questionnaire",                        payloadFields: [{ key: "clientId", label: "Client ID" }, { key: "projectId", label: "Linked project ID" }] },
  { name: "quiz.lead_submitted",      description: "A lead completed the M365 readiness quiz and their results were scored",  payloadFields: [{ key: "quizLeadId", label: "Quiz lead record ID" }, { key: "leadName", label: "Lead full name" }, { key: "leadEmail", label: "Lead email" }, { key: "company", label: "Company name" }, { key: "totalScore", label: "Overall quiz score 0–100" }, { key: "tier", label: "Score tier (Beginner/Intermediate/Advanced)" }, { key: "recommendedService", label: "Top recommended service" }] },
  { name: "customer.script_result",   description: "A customer ran a downloaded diagnostic script and the results were received by the server", payloadFields: [{ key: "scriptName", label: "Script title" }, { key: "scriptId", label: "Library script UUID" }, { key: "customerId", label: "Client user ID" }, { key: "kanbanTaskId", label: "Linked kanban task ID" }, { key: "projectId", label: "Linked project ID" }, { key: "resultId", label: "Script run result row ID" }, { key: "results", label: "Full results object returned by the script" }] },
];

// ── Node output registry (what each action injects into the next payload) ─────

const NODE_OUTPUTS: Record<string, Array<{ key: string; label: string }>> = {
  // platform / generic action sub-types
  create_lead:            [{ key: "leadId", label: "Created lead ID" }, { key: "leadName", label: "Full name" }, { key: "leadEmail", label: "Email" }],
  convert_to_opportunity: [{ key: "opportunityId", label: "Created opportunity ID" }, { key: "leadId", label: "Source lead ID" }],
  create_client:          [{ key: "clientId", label: "Created client user ID" }, { key: "clientEmail", label: "Client email" }],
  create_project:         [{ key: "projectId", label: "Created project ID" }, { key: "projectTitle", label: "Project title" }],
  execute_runbook:        [{ key: "jobId", label: "Azure Automation job ID" }, { key: "jobStatus", label: "Initial job status" }, { key: "runbookName", label: "Runbook name" }],
  update_m365_profile:    [{ key: "jobId", label: "Azure Automation job ID" }, { key: "jobStatus", label: "Initial job status" }],
  generate_document:      [{ key: "documentId", label: "Created document ID" }, { key: "docType", label: "Document type" }, { key: "name", label: "Document name" }],
  http_request:           [{ key: "status", label: "HTTP response status code" }, { key: "ok", label: "true if 2xx response" }],
  sql_query:              [{ key: "queryRows", label: "Array of result rows" }],
  emit_event:             [{ key: "eventName", label: "Name of the emitted event" }],
  send_email:             [{ key: "sent", label: "true if email was sent" }],
  send_sms:               [{ key: "sent", label: "true if SMS was sent" }],
  // CRM nodes
  score_lead:            [{ key: "leadId", label: "Lead ID" }, { key: "score", label: "Score 0–100" }, { key: "scoreLabel", label: "Low / Medium / High" }, { key: "qualified", label: "true if score ≥ threshold" }],
  assign_pipeline_stage: [{ key: "targetType", label: "Target type" }, { key: "leadId", label: "Lead ID" }, { key: "opportunityId", label: "Opportunity ID" }, { key: "stage", label: "New stage" }],
  create_opportunity:    [{ key: "opportunityId", label: "Created opportunity ID" }, { key: "leadId", label: "Source lead ID" }],
  // Diagnostics nodes
  parse_quiz_results:       [{ key: "quizLeadId", label: "Quiz lead record ID" }, { key: "totalScore", label: "Overall quiz score" }, { key: "tier", label: "Score tier" }, { key: "recommendedService", label: "Top recommended service" }],
  generate_readiness_score: [{ key: "readinessScore", label: "Composite readiness score 0–100" }, { key: "readinessLabel", label: "Low / Medium / High" }, { key: "recordId", label: "Health history record ID" }],
  attach_quiz_insights:     [{ key: "insightsAttached", label: "true when saved" }, { key: "documentId", label: "Created insight document ID" }],
  // M365 Health nodes
  validate_m365_permissions: [{ key: "permissionsValid", label: "true if all perms present" }, { key: "missingCount", label: "Number of missing permissions" }, { key: "jobId", label: "Azure job ID" }],
  update_intelligence_tables:[{ key: "updated", label: "true on success" }, { key: "recordId", label: "Health history record ID" }, { key: "jobId", label: "Azure job ID" }],
  generate_diff_report:      [{ key: "documentId", label: "Created diff report ID" }, { key: "changesFound", label: "true if diffs detected" }, { key: "changeCount", label: "Number of changed fields" }],
  notify_major_changes:      [{ key: "notified", label: "true if alert was sent" }, { key: "skipped", label: "true if no major changes" }],
  // Marketing Actions
  send_campaign_email: [{ key: "sent", label: "true if email was sent" }, { key: "recipient", label: "Resolved recipient address" }, { key: "subject", label: "Rendered email subject" }, { key: "sourceRef", label: "asset:id or template:slug that was used" }, { key: "templateSlug", label: "Legacy: template slug (empty when using campaign asset)" }],
  // Project Actions
  create_kanban_task:  [{ key: "taskId", label: "Created task ID" }, { key: "boardId", label: "Board used (marketing / project ID)" }, { key: "columnId", label: "Column/status the task was placed in" }, { key: "title", label: "Rendered task title" }],
  // Content
  generate_article: [{ key: "articleTitle", label: "Generated article title" }, { key: "articleSlug", label: "URL slug" }, { key: "articleCategory", label: "Category" }, { key: "articleSummary", label: "Card summary" }, { key: "articleDate", label: "Publication date string" }, { key: "articleContent", label: "Full Markdown body" }],
  publish_article:  [{ key: "published", label: "true if article was saved" }, { key: "slug", label: "Final article slug (may differ if conflict resolved)" }, { key: "articleId", label: "Database row ID" }, { key: "title", label: "Article title as saved" }],
  topic_picker:     [{ key: "articleTopic", label: "AI-selected article topic" }, { key: "topicCategory", label: "Category assigned to the topic" }, { key: "topicRationale", label: "One-sentence rationale from AI" }],
  // Marketing Actions (extended)
  create_marketing_campaign: [{ key: "campaignId", label: "Created campaign DB ID" }, { key: "campaignName", label: "Campaign name" }, { key: "campaignStatus", label: "Campaign status (draft / active)" }],
  publish_landing_page:      [{ key: "landingPageId", label: "Landing page DB ID" }, { key: "slug", label: "Landing page slug" }, { key: "published", label: "true after publish" }, { key: "wasAlreadyPublished", label: "true if page was already live" }],
  generate_landing_page:     [{ key: "landingPageId", label: "Newly created landing page DB ID" }, { key: "slug", label: "URL slug of the new page" }, { key: "headline", label: "AI-generated headline" }, { key: "subheadline", label: "AI-generated subheadline" }, { key: "published", label: "Always false — use Publish Landing Page node to go live" }],
  // Data
  find_object: [{ key: "found", label: "true if a matching record was found" }, { key: "objectId", label: "Primary key of the found record" }, { key: "objectType", label: "Type queried (lead / client / project / article)" }, { key: "email", label: "Email (lead/client only)" }, { key: "name", label: "Name (lead/client only)" }, { key: "status", label: "Status field (lead/project only)" }],
  // Content (image)
  generate_image: [{ key: "imageUrl", label: "Permanent URL of the saved image (e.g. /api/uploads/generated-images/<uuid>.png)" }, { key: "revisedPrompt", label: "Final prompt sent to the AI (may include style suffix)" }],
  // News
  fetch_news_headlines: [
    { key: "newsHeadlines",       label: "Array of fetched stories (title, source, url, publishedAt, description)" },
    { key: "newsTopic",           label: "Short phrase for the hottest story" },
    { key: "newsContext",         label: "2–3 sentence explanation of why it matters to M365 clients" },
    { key: "newsArticleSuggestion", label: "One-paragraph blog lead-in" },
    { key: "hotScore",            label: "Relevance score 0–100" },
    { key: "isHot",               label: "true when hotScore exceeds the threshold" },
    { key: "targetSector",        label: "Market sector (Government, Healthcare, etc.)" },
    { key: "campaignBrief",       label: "Marketing brief (audience, hook, 3 angles) — only when isHot is true" },
    { key: "campaignId",          label: "DB ID of auto-created campaign draft — only when Auto-build campaign is on and isHot" },
  ],
  // Social Media
  post_linkedin: [{ key: "linkedinPostId", label: "LinkedIn UGC post ID" }, { key: "linkedinPostUrl", label: "Direct URL to the LinkedIn post" }],
  post_twitter:  [{ key: "twitterTweetId", label: "Twitter/X tweet ID" }, { key: "twitterTweetUrl", label: "Direct URL to the tweet" }],
  post_facebook: [{ key: "facebookPostId", label: "Facebook page_id_post_id composite" }, { key: "facebookPostUrl", label: "Direct URL to the Facebook post" }],
  // Ask for Input — outputs are dynamic: each configured variableName becomes a payload key
  ask_for_input: [],
  // Switch/Case — no declared outputs; downstream nodes inherit the upstream payload unchanged
  // (switchValue and chosenBranch are still injected into nextPayload by the executor)
  switch_case: [],
};

// ── Custom node component ─────────────────────────────────────────────────────

function WfNode({ data, selected, id }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? "action";
  const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;
  const label = (data.label as string) || style.label;

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

const nodeTypes: NodeTypes = { wfNode: WfNode };

// ── Node library ──────────────────────────────────────────────────────────────

const LIBRARY_CATEGORIES: Array<{ name: string; nodes: Array<{ type: string; label: string; description: string; tags: string[] }> }> = [
  {
    name: "Core",
    nodes: [
      { type: "start",         label: "Start",         description: "Workflow entry point",                                tags: ["core", "flow"] },
      { type: "end",           label: "End",           description: "Workflow exit point",                                 tags: ["core", "flow"] },
      { type: "condition",     label: "Condition",     description: "Branch on expression",                               tags: ["logic", "branch", "if"] },
      { type: "delay",         label: "Delay",         description: "Wait / poll condition",                              tags: ["control", "wait", "pause"] },
      { type: "error",         label: "Error",         description: "Catch-all error handler",                            tags: ["control", "error", "catch"] },
      { type: "ask_for_input", label: "Ask for Input", description: "Prompt the operator for values before the run starts", tags: ["input", "manual", "form", "prompt", "interactive"] },
      { type: "switch_case",   label: "Switch",        description: "Route to one of many branches based on an expression value", tags: ["logic", "switch", "case", "branch", "route", "multi"] },
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
    ],
  },
  {
    name: "Marketing Actions",
    nodes: [
      { type: "send_campaign_email",       label: "Send Campaign Email",    description: "Render an Email Template and send it to a recipient",        tags: ["email", "marketing", "campaign", "template"] },
      { type: "create_marketing_campaign", label: "Create Campaign",         description: "Create a new marketing campaign record in the database",     tags: ["marketing", "campaign", "create", "crm"] },
      { type: "publish_landing_page",      label: "Publish Landing Page",   description: "Set a landing page live by its slug",                        tags: ["marketing", "landing page", "publish", "site"] },
      { type: "generate_landing_page",     label: "Generate Landing Page",  description: "AI generates a landing page from topic, audience and CTA and saves it to the DB (unpublished)", tags: ["marketing", "landing page", "ai", "generate", "content"] },
    ],
  },
  {
    name: "Project Actions",
    nodes: [
      { type: "create_kanban_task", label: "Create Kanban Task", description: "Create a card on the Marketing Kanban or a project board", tags: ["kanban", "task", "project", "card", "board"] },
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
    name: "Data",
    nodes: [
      { type: "find_object", label: "Find Object", description: "Look up a lead, client, project, or article by field value", tags: ["data", "lookup", "find", "lead", "client", "project"] },
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
      { type: "send_email", label: "Send Email", description: "Send a plain email to any address",                  tags: ["email", "send", "notify", "communication"] },
      { type: "send_sms",   label: "Send SMS",   description: "Send an SMS to an E.164 phone number via Twilio",   tags: ["sms", "text", "notify", "communication"] },
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
    name: "Azure",
    nodes: [
      { type: "execute_runbook",     label: "Execute Runbook",      description: "Trigger an Azure Automation runbook",                tags: ["azure", "runbook", "automation", "m365"] },
      { type: "update_m365_profile", label: "Update M365 Profile",  description: "Update a client's M365 profile via Azure Automation", tags: ["azure", "m365", "profile", "runbook"] },
      { type: "generate_document",   label: "Generate Document",    description: "Create a document record for a client",              tags: ["document", "client", "report", "generate"] },
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
                {KNOWN_EVENTS.map(ev => (
                  <option key={ev.name} value={ev.name}>{ev.name}</option>
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

// ── Ancestor output resolver + variable picker ───────────────────────────────

interface AncestorGroup {
  nodeId: string;
  nodeName: string;
  /** true for the start/trigger node — its outputs live at the top-level payload, not under steps.<nodeId> */
  isStartNode: boolean;
  outputs: Array<{ key: string; label: string }>;
}

function getAncestorOutputs(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
  eventTriggers: WfTrigger[] = [],
): AncestorGroup[] {
  const visited = new Set<string>();
  const queue: string[] = edges.filter(e => e.target === nodeId).map(e => e.source);
  const result: AncestorGroup[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    const type = (node.data.nodeType as string) ?? "action";
    const actionType = node.data.actionType as string | undefined;
    let outputs: Array<{ key: string; label: string }> = [];
    if (type === "start") {
      // Look up the configured event trigger and surface its exact payload fields
      const evTrigger = eventTriggers.find(t => t.type === "event" && t.enabled);
      const eventName = evTrigger ? (evTrigger.config.eventName as string | undefined) : undefined;
      const knownEv = eventName ? KNOWN_EVENTS.find(e => e.name === eventName) : undefined;
      outputs = [
        ...(knownEv ? knownEv.payloadFields : [{ key: "payload", label: "Full trigger payload (object)" }]),
        { key: "triggeredAt", label: "ISO timestamp when this run started" },
      ];
    } else if (type === "action" && actionType) {
      outputs = NODE_OUTPUTS[actionType] ?? [];
    } else if (type === "ask_for_input") {
      // Dynamic outputs — derive from the configured field definitions
      const fields = (node.data.fields as Array<{ variableName: string; label: string }> | undefined) ?? [];
      outputs = fields
        .filter(f => f.variableName)
        .map(f => ({ key: f.variableName, label: f.label || f.variableName }));
    } else if (type !== "end" && type !== "condition" && type !== "delay" && type !== "error") {
      // First-class node types (score_lead, assign_pipeline_stage, etc.)
      outputs = NODE_OUTPUTS[type] ?? [];
    }
    if (outputs.length > 0) {
      const name = (node.data.label as string | undefined)
        || (actionType ? actionType.replace(/_/g, " ") : type.replace(/_/g, " "));
      result.unshift({ nodeId: id, nodeName: name, isStartNode: type === "start", outputs });
    }
    edges.filter(e => e.target === id).forEach(e => { if (!visited.has(e.source)) queue.push(e.source); });
  }
  return result;
}

function PayloadField({
  label, value, onChange, placeholder, multiline, ancestorOutputs,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  ancestorOutputs: AncestorGroup[];
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
        <label className="text-xs font-medium text-[#7D8590]">{label}</label>
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

// ── Config panel ──────────────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onChange,
  onClose,
  onDelete,
  defId,
  nodes,
  edges,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  defId: number;
  nodes: Node[];
  edges: Edge[];
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
      const r = await fetchWithAuth(`/api/admin/workflows/${defId}/triggers`);
      if (!r.ok) return [];
      return r.json();
    },
  });
  const ancestorOutputs = getAncestorOutputs(node.id, nodes, edges, triggers);

  return (
    <div className="absolute right-4 top-4 bottom-4 w-72 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-y-auto z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span style={{ color: style.border, fontSize: 16 }}>{style.icon}</span>
          <span className="text-sm font-semibold text-[#E6EDF3]">{nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} Node</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { onDelete(node.id); }}
            title="Delete node (Del)"
            className="text-[#484F58] hover:text-[#EF4444] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-[#7D8590]">Node Name</label>
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
          value={(node.data.description as string) ?? ""}
          onChange={v => onChange(node.id, { ...node.data, description: v })}
          multiline
        />

        {nodeType === "start" && (
          <StartNodeTriggers defId={defId} />
        )}

        {nodeType === "action" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Action Type</label>
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
                  value={(node.data.eventPayload as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, eventPayload: v })}
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
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Requires Azure Automation secrets to be configured. Output: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobStatus}}"}</span>.</p>
                </div>
              </>
            )}

            {(node.data.actionType as string) === "generate_document" && (
              <>
                <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Document Type</label>
                  <select
                    value={(node.data.docType as string) ?? "security"}
                    onChange={e => onChange(node.id, { ...node.data, docType: e.target.value })}
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                  >
                    {[
                      ["security","Security Assessment"],
                      ["license","License Review"],
                      ["governance","Governance Report"],
                      ["copilot","Copilot Readiness"],
                      ["remediation","Remediation Plan"],
                      ["exposure","Exposure Report"],
                      ["executive","Executive Summary"],
                      ["deployment","Deployment Plan"],
                    ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <PayloadField label="Title (optional)" value={(node.data.docTitle as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docTitle: v })} placeholder="Q1 Security Review — {{payload.company}}" ancestorOutputs={ancestorOutputs} />
                <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
                  <p className="text-[10px] text-[#484F58]">Creates a document record for the client. Output: <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span>.</p>
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
            <PayloadField label="Payload (JSON)" value={(node.data.eventPayload as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, eventPayload: v })} placeholder='{"clientId": "{{payload.clientId}}"}' multiline ancestorOutputs={ancestorOutputs} />
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
            <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="My-Runbook-Name" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"Param1": "value"}' multiline ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Requires Azure Automation secrets to be configured. Output: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>, <span className="font-mono text-[#7D8590]">{"{{jobStatus}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "update_m365_profile" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Runbook Name" value={(node.data.runbookName as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookName: v })} placeholder="M365-Health-Check" ancestorOutputs={ancestorOutputs} />
            <PayloadField label="Parameters (JSON)" value={(node.data.runbookParams as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, runbookParams: v })} placeholder='{"TenantId": "{{payload.tenantId}}"}' multiline ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Triggers an Azure Automation runbook against the client's M365 tenant. Output: <span className="font-mono text-[#7D8590]">{"{{jobId}}"}</span>.</p>
            </div>
          </>
        )}

        {nodeType === "generate_document" && (
          <>
            <PayloadField label="Client ID" value={(node.data.clientId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, clientId: v })} placeholder="{{clientId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Document Type</label>
              <select
                value={(node.data.docType as string) ?? "security"}
                onChange={e => onChange(node.id, { ...node.data, docType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                {[
                  ["security","Security Assessment"],
                  ["license","License Review"],
                  ["governance","Governance Report"],
                  ["copilot","Copilot Readiness"],
                  ["remediation","Remediation Plan"],
                  ["exposure","Exposure Report"],
                  ["executive","Executive Summary"],
                  ["deployment","Deployment Plan"],
                ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <PayloadField label="Title (optional)" value={(node.data.docTitle as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, docTitle: v })} placeholder="Q1 Security Review — {{payload.company}}" ancestorOutputs={ancestorOutputs} />
            <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5">
              <p className="text-[10px] text-[#484F58]">Creates a document record for the client. Output: <span className="font-mono text-[#7D8590]">{"{{documentId}}"}</span>.</p>
            </div>
          </>
        )}

        {/* ── CRM nodes ─────────────────────────────────────── */}

        {nodeType === "score_lead" && (
          <>
            <PayloadField label="Lead ID" value={(node.data.leadId as string) ?? ""} onChange={v => onChange(node.id, { ...node.data, leadId: v })} placeholder="{{leadId}}" ancestorOutputs={ancestorOutputs} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Qualification Threshold</label>
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
          const leadStages = ["Lead","AQL","SQL"];
          const stageList = tgt === "lead" ? leadStages : oppStages;
          const currentStage = (node.data.stage as string | undefined) ?? stageList[0];
          return (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#7D8590]">Target type</label>
                <div className="flex rounded-lg overflow-hidden border border-[#30363D]">
                  {(["opportunity","lead"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => onChange(node.id, { ...node.data, targetType: t, stage: t === "lead" ? "AQL" : "DiscoveryCall" })}
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
                <label className="text-xs font-medium text-[#7D8590]">New stage</label>
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
          />
        )}

        {/* ── Marketing Actions (extended) ────────────────────── */}

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

        {nodeType === "find_object" && (
          <FindObjectPanel
            node={node}
            onChange={onChange}
            ancestorOutputs={ancestorOutputs}
          />
        )}

        {/* ── Social Media ────────────────────────────────────── */}

        {nodeType === "post_linkedin" && (
          <>
            <PayloadField
              label="Post Body"
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

        {/* ── Ask for Input ───────────────────────────────────── */}

        {nodeType === "ask_for_input" && (
          <AskForInputPanel node={node} onChange={onChange} />
        )}

        {nodeType === "switch_case" && (
          <SwitchCasePanel node={node} onChange={onChange} ancestorOutputs={ancestorOutputs} />
        )}

        {nodeType === "condition" && (
          <>
            <PayloadField
              label="Expression"
              value={(node.data.expression as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, expression: v })}
              placeholder="{{status}} == 'active' && {{count}} > 0"
              multiline
              ancestorOutputs={ancestorOutputs}
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

        {nodeType === "delay" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Mode</label>
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
                <ConfigField
                  label="Condition Expression"
                  value={(node.data.expression as string) ?? ""}
                  onChange={v => onChange(node.id, { ...node.data, expression: v })}
                  multiline
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
        <label className="text-xs font-medium text-[#7D8590]">Campaign Email Copy</label>
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

interface KanbanBoard { id: string; name: string; }
interface KanbanColumn { id: string; label: string; }

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"];

function CreateKanbanTaskPanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const { fetchWithAuth } = useAuth();

  const { data: boards = [], isLoading: loadingBoards } = useQuery<KanbanBoard[]>({
    queryKey: ["kanban-boards"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/kanban/boards");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const boardId = (node.data.boardId as string) ?? "";
  const columnId = (node.data.columnId as string) ?? "";

  // Fetch columns from the API whenever the board changes
  const { data: columns = [], isLoading: loadingColumns } = useQuery<KanbanColumn[]>({
    queryKey: ["kanban-columns", boardId],
    queryFn: async () => {
      if (!boardId) return [];
      const res = await fetchWithAuth(`/api/admin/kanban/${encodeURIComponent(boardId)}/columns`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!boardId,
    staleTime: 60_000,
  });

  // Keep columnId in sync when board changes and the current value is no longer valid.
  // Persist a default so node.data.columnId is never silently empty.
  const validColumnIds = columns.map(c => c.id);
  const effectiveColumnId = validColumnIds.includes(columnId) ? columnId : (columns[0]?.id ?? "");
  useEffect(() => {
    if (!boardId || columns.length === 0) return;
    if (!validColumnIds.includes(columnId)) {
      onChange(node.id, { ...node.data, columnId: columns[0].id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, columns]);

  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Board</label>
        {loadingBoards ? (
          <div className="text-xs text-[#484F58] animate-pulse">Loading boards…</div>
        ) : (
          <select
            value={boardId}
            onChange={e => {
              // Reset columnId when board changes; the columns query will re-fire
              onChange(node.id, { ...node.data, boardId: e.target.value, columnId: "" });
            }}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#6366F1]/60"
          >
            <option value="">— choose a board —</option>
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>
      {boardId && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Column / Status</label>
          {loadingColumns ? (
            <div className="text-xs text-[#484F58] animate-pulse">Loading columns…</div>
          ) : (
            <select
              value={effectiveColumnId}
              onChange={e => onChange(node.id, { ...node.data, columnId: e.target.value })}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#6366F1]/60"
            >
              {columns.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          )}
        </div>
      )}
      <PayloadField
        label="Task Title"
        value={(node.data.titleExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, titleExpr: v })}
        placeholder="Follow up with {{company}} re: {{serviceName}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Description (optional)"
        value={(node.data.descriptionExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, descriptionExpr: v })}
        placeholder="Client scored {{score}} — review readiness report"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Priority</label>
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
      <div className="rounded-lg bg-[#0D1117] border border-[#30363D] p-2.5 space-y-1">
        <p className="text-[10px] text-[#484F58]">Creates a Kanban card on the selected board and column. Title and description support <span className="font-mono text-[#7D8590]">{"{{tokens}}"}</span> from the workflow payload. Outputs:</p>
        <p className="text-[10px] font-mono text-[#7D8590]">{"{{taskId}}"} · {"{{boardId}}"} · {"{{columnId}}"} · {"{{title}}"}</p>
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
        value={(node.data.topic as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, topic: v })}
        placeholder="5 Ways to Improve M365 Security Posture"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Category</label>
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
        value={(node.data.keywords as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, keywords: v })}
        placeholder="MFA, Conditional Access, Zero Trust"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Tone</label>
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
        value={(node.data.titleExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, titleExpr: v })}
        placeholder="{{articleTitle}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Slug override (leave blank to auto-derive)"
        value={(node.data.slugExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, slugExpr: v })}
        placeholder="{{articleSlug}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Category override (leave blank to use {{articleCategory}})"
        value={(node.data.categoryExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, categoryExpr: v })}
        placeholder="{{articleCategory}}"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Content override (leave blank to use {{articleContent}})"
        value={(node.data.contentExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, contentExpr: v })}
        placeholder="{{articleContent}}"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Date override (leave blank to use {{articleDate}})"
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
        <label className="text-xs font-medium text-[#7D8590]">Category</label>
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
        value={(node.data.focusArea as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, focusArea: v })}
        placeholder="governance, security, Copilot adoption"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Articles to check for duplicates</label>
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
        value={(node.data.prompt as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, prompt: v })}
        placeholder="A professional Microsoft 365 hero image for {{articleTitle}}, clean and corporate"
        multiline
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Aspect Ratio / Format</label>
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
        <label className="text-xs font-medium text-[#7D8590]">Style hint (optional)</label>
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
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const accentColor = "#06B6D4";
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Search topics</label>
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
        <label className="text-xs font-medium text-[#7D8590]">Custom AI prompt (optional)</label>
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
          <label className="text-xs font-medium text-[#7D8590]">Max results</label>
          <input
            type="number" min={1} max={50}
            value={(node.data.maxResults as number) ?? 10}
            onChange={e => onChange(node.id, { ...node.data, maxResults: Number(e.target.value) })}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#06B6D4]/60"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#7D8590]">Hot-score threshold</label>
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
          onChange={e => onChange(node.id, { ...node.data, autoBuildCampaign: e.target.checked })}
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
        value={(node.data.nameExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, nameExpr: v })}
        placeholder="Q3 Copilot Rollout Push"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Goal"
        value={(node.data.goalExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, goalExpr: v })}
        placeholder="Generate 20 qualified leads for Copilot readiness assessments"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Target audience"
        value={(node.data.audienceExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, audienceExpr: v })}
        placeholder="IT directors at mid-market companies (100-500 employees)"
        ancestorOutputs={ancestorOutputs}
      />
      <PayloadField
        label="Offer"
        value={(node.data.offerExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, offerExpr: v })}
        placeholder="Free Copilot Readiness Assessment"
        ancestorOutputs={ancestorOutputs}
      />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#7D8590]">Initial status</label>
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
  { value: "lead",    label: "Lead",    fields: ["email", "name", "id"] },
  { value: "client",  label: "Client",  fields: ["email", "id"] },
  { value: "project", label: "Project", fields: ["id"] },
  { value: "article", label: "Article", fields: ["slug", "id"] },
];

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[#7D8590]">{label}</label>
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

function SwitchCasePanel({
  node,
  onChange,
  ancestorOutputs,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  ancestorOutputs: AncestorGroup[];
}) {
  const cases = ((node.data.cases as SwitchCaseItem[] | undefined) ?? []);

  function updateCases(next: SwitchCaseItem[]) {
    onChange(node.id, { ...node.data, cases: next });
  }

  function addCase() {
    if (cases.length >= 10) return;
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

  const inputCls = "w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:border-[#FB923C]";

  return (
    <div className="space-y-3">
      {/* Switch expression */}
      <PayloadField
        label="Switch on (expression)"
        value={(node.data.switchExpr as string) ?? ""}
        onChange={v => onChange(node.id, { ...node.data, switchExpr: v })}
        placeholder="{{status}} or {{tier}}"
        ancestorOutputs={ancestorOutputs}
      />

      {/* Case list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">Cases</span>
          {cases.length >= 10 && (
            <span className="text-[10px] text-amber-400">Max 10 cases</span>
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
          disabled={cases.length >= 10}
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
  siblingValues: Record<string, string> = {},
  /** All sibling field definitions — lets us find which sibling is a "customer" type */
  siblingFields: AskForInputField[] = [],
): { options: EntityOption[]; loading: boolean } {
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);

  // When type is "project", resolve the selected customer ID from any sibling customer field
  const selectedCustomerId = type === "project"
    ? (() => {
        const customerField = siblingFields.find(f => f.type === "customer");
        return customerField ? siblingValues[customerField.variableName] || "" : "";
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
  value: string;
  onChange: (v: string) => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  hasError: boolean;
  siblingValues?: Record<string, string>;
  siblingFields?: AskForInputField[];
}) {
  const { options, loading } = useEntityOptions(field.type, fetchWithAuth, siblingValues, siblingFields);
  const [search, setSearch] = useState("");
  const selected = value ? value.split(",").filter(Boolean) : [];

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
      onChange(next.join(","));
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
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.variableName, ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setValue(name: string, val: string) {
    setValues(v => ({ ...v, [name]: val }));
    setErrors(err => { const n = { ...err }; delete n[name]; return n; });
  }

  function handleSubmit() {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !values[f.variableName]?.trim()) {
        errs[f.variableName] = "Required";
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
      handleRunClick(defaultPayload);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, loadingTriggers]);

  const runMut = useMutation({
    mutationFn: async ({ inputValues, payloadOverride }: { inputValues: Record<string, string>; payloadOverride?: Record<string, unknown> }) => {
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

  const slideClass = !mounted || closing ? "translate-x-full" : "translate-x-0";

  return (
    <div
      className={`fixed right-0 top-0 h-full z-40 bg-[#161B22] border-l border-[#30363D] shadow-2xl flex flex-col transform transition-all duration-250 ease-in-out ${slideClass} ${wide ? "w-[760px]" : "w-[480px]"}`}
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

export default function WorkflowBuilderPage({ defId, versionId }: { defId: number; versionId?: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null);
  const [, setTickNow] = useState(0);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
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
  const rfInstanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const redoRef = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);

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
      return res.json();
    },
  });

  const { data: versions = [], isFetched: versionsFetched } = useQuery({
    queryKey: ["wf-versions", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions`);
      return res.json() as Promise<Array<{ id: number; versionNumber: number; label: string; status: string; isDefault: boolean; graph: { nodes: unknown[]; edges: unknown[] } }>>;
    },
  });

  const hasPublishedVersion = versions.some(v => v.status === "published");

  const { data: currentVersion } = useQuery({
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


  const onConnect = useCallback((connection: Connection) => {
    historyRef.current = [...historyRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    setEdges(eds => addEdge({ ...connection, style: { stroke: "#30363D", strokeWidth: 2 } }, eds));
    setIsDirty(true);
  }, [setEdges, nodes, edges]);

  // Wrap onNodesChange: snapshot once when a drag ends (dragging === false) or a node is removed
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const needsSnapshot = changes.some(c =>
      (c.type === "position" && c.dragging === false) || c.type === "remove",
    );
    if (needsSnapshot) {
      historyRef.current = [...historyRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
      redoRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      setIsDirty(true);
    }
    onNodesChange(changes);
  }, [onNodesChange, nodes, edges]);

  // Wrap onEdgesChange: snapshot when an edge is removed
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const needsSnapshot = changes.some(c => c.type === "remove");
    if (needsSnapshot) {
      historyRef.current = [...historyRef.current.slice(-9), { nodes: [...nodes], edges: [...edges] }];
      redoRef.current = [];
      setCanUndo(true);
      setCanRedo(false);
      setIsDirty(true);
    }
    onEdgesChange(changes);
  }, [onEdgesChange, nodes, edges]);

  const canvasRef = useRef<HTMLDivElement>(null);

  function addNode(nodeType: string, position?: { x: number; y: number }) {
    pushHistory();
    const id = `node-${++nodeIdCounter.current}`;
    const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;
    const pos = position ?? { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 };
    setNodes(nds => [...nds, {
      id,
      type: "wfNode",
      position: pos,
      data: { nodeType, label: style.label },
    }]);
    trackRecent(nodeType);
    setIsDirty(true);
  }

  function duplicateNode(id: string) {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    pushHistory();
    const newId = `node-${++nodeIdCounter.current}`;
    setNodes(nds => [...nds, {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: false,
    }]);
    setIsDirty(true);
  }

  function handleCanvasDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData("application/workflow-node-type");
    if (!nodeType) return;
    if (rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(nodeType, pos);
    } else {
      addNode(nodeType);
    }
  }

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  function updateNodeData(id: string, data: Record<string, unknown>) {
    redoRef.current = [];
    setCanRedo(false);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data } : n));
    setIsDirty(true);
  }

  function deleteNode(id: string) {
    pushHistory();
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
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
    setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.15, duration: 400 }), 80);
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

  // Ctrl+Z / Cmd+Z undo  |  Ctrl+Shift+Z / Cmd+Shift+Z redo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

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

  // Dismiss context menu on outside click / Escape
  useEffect(() => {
    if (!ctxMenu) return;
    function dismiss(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setCtxMenu(null);
    }
    document.addEventListener("click", dismiss as EventListener);
    document.addEventListener("keydown", dismiss as EventListener);
    return () => {
      document.removeEventListener("click", dismiss as EventListener);
      document.removeEventListener("keydown", dismiss as EventListener);
    };
  }, [ctxMenu]);

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
            onClick={() => isDirty ? setShowUnsavedDialog(true) : navigate("/workflows/list")}
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
            onClick={() => setShowVersionHistory(v => !v)}
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
              onClick={() => setShowPublish(true)}
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

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 bg-[#0D1117] relative"
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={handleCanvasDrop}
          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onInit={inst => { rfInstanceRef.current = inst; }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => { setSelectedNodeId(null); setCtxMenu(null); }}
            onNodeContextMenu={(e, node) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id }); }}
            onNodesDelete={deleted => {
              pushHistory();
              if (deleted.some(n => n.id === selectedNodeId)) setSelectedNodeId(null);
            }}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            proOptions={{ hideAttribution: true }}
            style={{ background: "#0D1117" }}
          >
            <Background color="#1C2128" gap={24} size={1} />
            <Controls style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} />
            <MiniMap
              style={{ background: "#161B22", border: "1px solid #30363D" }}
              nodeColor={() => "#0078D4"}
            />
            <Panel position="top-right" style={{ margin: 0 }}>
              {nodes.length === 0 && (
                <div className="text-center text-[#484F58] text-xs p-8 pointer-events-none">
                  <p className="font-medium text-[#7D8590]">Canvas is empty</p>
                  <p className="mt-1">Add nodes from the library on the left.</p>
                </div>
              )}
            </Panel>
          </ReactFlow>
        </div>

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
          />
        )}

        {/* Canvas / node context menu */}
        {ctxMenu && (
          <div
            className="fixed z-50 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1 min-w-[168px] text-xs"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            {ctxMenu.nodeId ? (
              <>
                <button
                  onClick={() => { deleteNode(ctxMenu.nodeId!); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <span>✕</span> Delete Node
                </button>
                <button
                  onClick={() => { duplicateNode(ctxMenu.nodeId!); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  <span>⧉</span> Duplicate Node
                </button>
                <div className="border-t border-[#30363D] my-1" />
                <button
                  onClick={() => { void navigator.clipboard.writeText(ctxMenu.nodeId!); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3] transition-colors"
                >
                  <span>⎘</span> Copy Node ID
                </button>
              </>
            ) : (
              <>
                <button
                  disabled
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#484F58] cursor-default"
                  title="Nothing copied"
                >
                  <span>⎘</span> Paste
                </button>
                <button
                  onClick={() => {
                    setNodes(nds => nds.map(n => ({ ...n, selected: true })));
                    setEdges(eds => eds.map(e => ({ ...e, selected: true })));
                    setCtxMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  <span>⬚</span> Select All
                </button>
                <button
                  onClick={() => { rfInstanceRef.current?.fitView({ padding: 0.12 }); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  <span>⊡</span> Fit View
                </button>
                <div className="border-t border-[#30363D] my-1" />
                <button
                  onClick={() => { rfInstanceRef.current?.zoomIn(); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3] transition-colors"
                >
                  <span>+</span> Zoom In
                </button>
                <button
                  onClick={() => { rfInstanceRef.current?.zoomOut(); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3] transition-colors"
                >
                  <span>−</span> Zoom Out
                </button>
              </>
            )}
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
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-[#E6EDF3]">Publish Version</h2>
            <p className="text-sm text-[#7D8590]">Save first, then publish to make this the live version for all triggers.</p>
            <input
              value={publishLabel}
              onChange={e => setPublishLabel(e.target.value)}
              placeholder="Version label (e.g. v1.0 — Lead Qualification)"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPublish(false)} className="px-4 py-2 text-sm text-[#7D8590]">Cancel</button>
              <button
                onClick={async () => { await saveMut.mutateAsync(); publishMut.mutate(); }}
                disabled={publishMut.isPending || saveMut.isPending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {publishMut.isPending ? "Publishing…" : "Save & Publish"}
              </button>
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
                onClick={() => navigate("/workflows/list")}
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
