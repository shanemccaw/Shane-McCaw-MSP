import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  type NodeTypes,
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";

// ── Node styles (mirrored from WorkflowBuilderPage) ────────────────────────────

interface NodeStyle {
  bg: string;
  border: string;
  icon: string;
  label: string;
}

const NODE_STYLES: Record<string, NodeStyle> = {
  start:     { bg: "#0F2A1A", border: "#22C55E",  icon: "▶",  label: "Start"               },
  end:       { bg: "#1A1A2E", border: "#6366F1",  icon: "⏹",  label: "End"                 },
  condition: { bg: "#1A1300", border: "#F59E0B",  icon: "◆",  label: "Condition"           },
  delay:     { bg: "#1A0D2E", border: "#A855F7",  icon: "⏱",  label: "Delay"               },
  error:     { bg: "#1A0D0D", border: "#EF4444",  icon: "⚠",  label: "Error"               },
  action:    { bg: "#0D1A2E", border: "#0078D4",  icon: "⚡", label: "Action"              },
  http_request:           { bg: "#0A1220", border: "#3B82F6",  icon: "🌐", label: "HTTP Request"           },
  sql_query:              { bg: "#0A1A12", border: "#10B981",  icon: "🗄️", label: "SQL Query"              },
  send_email:             { bg: "#0D1A2A", border: "#60A5FA",  icon: "📧", label: "Send Email"             },
  send_sms:               { bg: "#120D22", border: "#A78BFA",  icon: "💬", label: "Send SMS"               },
  emit_event:             { bg: "#1A0D18", border: "#F472B6",  icon: "📡", label: "Emit Event"             },
  cancel_workflow:        { bg: "#1A0D0D", border: "#EF4444",  icon: "🛑", label: "Cancel Workflow"        },
  create_lead:            { bg: "#041A14", border: "#34D399",  icon: "➕", label: "Create Lead"            },
  convert_to_opportunity: { bg: "#041A14", border: "#2DD4BF",  icon: "🚀", label: "Convert to Opportunity" },
  create_client:          { bg: "#041A14", border: "#6EE7B7",  icon: "👤", label: "Create Client"          },
  create_project:         { bg: "#041A14", border: "#4ADE80",  icon: "📁", label: "Create Project"         },
  execute_runbook:        { bg: "#110D22", border: "#A78BFA",  icon: "⚙️", label: "Execute Runbook"        },
  update_m365_profile:    { bg: "#110D22", border: "#8B5CF6",  icon: "☁️", label: "Update M365 Profile"    },
  generate_document:      { bg: "#111620", border: "#64748B",  icon: "📄", label: "Generate Document"      },
  score_lead:            { bg: "#061A18", border: "#00B4D8", icon: "⭐", label: "Score Lead"          },
  assign_pipeline_stage: { bg: "#061A18", border: "#00B4D8", icon: "🏷", label: "Assign Stage"        },
  create_opportunity:    { bg: "#061A18", border: "#00B4D8", icon: "🚀", label: "Create Opportunity"  },
  parse_quiz_results:       { bg: "#1C1100", border: "#F59E0B", icon: "📋", label: "Parse Quiz"          },
  generate_readiness_score: { bg: "#1C1100", border: "#F59E0B", icon: "📊", label: "Readiness Score"     },
  attach_quiz_insights:     { bg: "#1C1100", border: "#F59E0B", icon: "💡", label: "Attach Insights"     },
  validate_m365_permissions: { bg: "#110D22", border: "#8B5CF6", icon: "🔐", label: "Validate Perms"      },
  update_intelligence_tables:{ bg: "#110D22", border: "#8B5CF6", icon: "🧠", label: "Update Intel"        },
  generate_diff_report:      { bg: "#110D22", border: "#8B5CF6", icon: "📄", label: "Diff Report"         },
  notify_major_changes:      { bg: "#110D22", border: "#8B5CF6", icon: "🔔", label: "Notify Changes"      },
  send_campaign_email: { bg: "#0D1A10", border: "#10B981", icon: "📨", label: "Send Campaign Email" },
  create_kanban_task:  { bg: "#0D1020", border: "#6366F1", icon: "🗂",  label: "Create Kanban Task"  },
  get_project_tasks:   { bg: "#0D1020", border: "#818CF8", icon: "📋", label: "Get Project Tasks"    },
  update_project_task: { bg: "#0D1020", border: "#A78BFA", icon: "✏️", label: "Update Project Task"  },
  generate_article:          { bg: "#1A0D1A", border: "#C084FC", icon: "✍️", label: "Generate Article"        },
  publish_article:           { bg: "#0F1A12", border: "#4ADE80", icon: "📢", label: "Publish Article"          },
  topic_picker:              { bg: "#1A0D1A", border: "#E879F9", icon: "🎯", label: "Topic Picker"             },
  generate_image:            { bg: "#1A100A", border: "#F59E0B", icon: "🖼️", label: "Generate Image"           },
  define_campaign_goal:      { bg: "#0A1A12", border: "#34D399", icon: "🎯", label: "Define Goal"            },
  define_target_audience:    { bg: "#0A1A12", border: "#6EE7B7", icon: "👥", label: "Define Target Audience" },
  create_campaign_offer:     { bg: "#0A1A12", border: "#10B981", icon: "🎁", label: "Create Offer"           },
  create_marketing_campaign: { bg: "#0D1A10", border: "#34D399", icon: "📣", label: "Create Campaign"          },
  publish_landing_page:      { bg: "#0D1A10", border: "#6EE7B7", icon: "🚀", label: "Publish Landing Page"     },
  generate_landing_page:     { bg: "#0A1A18", border: "#34D399", icon: "🖥️", label: "Generate Landing Page"    },
  find_object:               { bg: "#0D1020", border: "#818CF8", icon: "🔍", label: "Find Object"              },
  compose:                   { bg: "#0A1A18", border: "#2DD4BF", icon: "⧉",  label: "Compose"                  },
  ask_ai: { bg: "#110D1F", border: "#A78BFA", icon: "🤖", label: "Ask AI" },
  fetch_news_headlines: { bg: "#041A14", border: "#06B6D4", icon: "📰", label: "Fetch News Headlines" },
  post_linkedin: { bg: "#051424", border: "#0A66C2", icon: "🔗", label: "Post to LinkedIn" },
  post_twitter:  { bg: "#0D0D0D", border: "#E7E7E7", icon: "𝕏",  label: "Post to X / Twitter" },
  post_facebook: { bg: "#071533", border: "#1877F2", icon: "📘", label: "Post to Facebook" },
  send_browser_notification: { bg: "#1A1400", border: "#F59E0B", icon: "🔔", label: "Browser Notification" },
  send_mobile_push:          { bg: "#1A0D2E", border: "#A855F7", icon: "📱", label: "Mobile Push"          },
  ask_for_input: { bg: "#1A0E00", border: "#F97316", icon: "⌨",  label: "Ask for Input"       },
  switch_case:   { bg: "#180D00", border: "#FB923C", icon: "⇶",  label: "Switch"              },
  foreach:         { bg: "#160A2E", border: "#A855F7", icon: "↻",  label: "For Each"            },
  for:             { bg: "#160A2E", border: "#A855F7", icon: "⟳",  label: "For"                 },
  parallel:        { bg: "#041620", border: "#06B6D4", icon: "⇉",  label: "Parallel"            },
  join:            { bg: "#041620", border: "#06B6D4", icon: "⤤",  label: "Join"                },
  approval_gate:   { bg: "#1A1200", border: "#F59E0B", icon: "⏸",  label: "Approval Gate"       },
  report_progress: { bg: "#061A1A", border: "#00B4D8", icon: "📶", label: "Report Progress"     },
  check_exchange_calendar_availability: { bg: "#041620", border: "#0078D4", icon: "📅", label: "Check Calendar"           },
  create_exchange_calendar_event:       { bg: "#041620", border: "#00B4D8", icon: "📆", label: "Create Calendar Event"    },
  save_to_sharepoint: { bg: "#0A1A10", border: "#34D399", icon: "💾", label: "Save to SharePoint"  },
  get_from_sharepoint:{ bg: "#0A1A10", border: "#6EE7B7", icon: "📥", label: "Get from SharePoint" },
  generate_pdf:       { bg: "#1A0D00", border: "#F97316", icon: "📄", label: "Generate PDF"         },
  build_presentation: { bg: "#0A1420", border: "#818CF8", icon: "📊", label: "Build Presentation"   },
  generate_invoice_stripe_payment: { bg: "#041A1A", border: "#34D399", icon: "🧾", label: "Generate Invoice"       },
  generate_stripe_payment_link:    { bg: "#041A1A", border: "#2DD4BF", icon: "🔗", label: "Generate Payment Link"  },
};

// ── Signal label metadata (mirrors api-server/src/lib/tenant-signals.ts) ───────

const SIGNAL_LABELS: Record<string, string> = {
  alwaysInclude:               "Always Include",
  hasExchangeOnPrem:           "Exchange On-Premises",
  hasPowerPlatformUsage:       "Power Platform Usage",
  hasGovernanceGaps:           "Governance Gaps",
  hasSecurityGaps:             "Security Gaps",
  hasCopilotLicenses:          "Copilot Licenses",
  hasSharePointIssues:         "SharePoint Issues",
  hasLicensingWaste:           "Licensing Waste",
  hasDLPGaps:                  "DLP Gaps",
  "adj:governance-complexity": "Governance Complexity",
  "adj:tenant-size":           "Tenant Size",
  "adj:security-compliance":   "Security / Compliance",
  "adj:copilot-readiness":     "Copilot Readiness",
};

// ── HtmlContentPreview ─────────────────────────────────────────────────────────

/**
 * Renders an `htmlContent` string value as a collapsible "Preview HTML" toggle.
 * Collapsed by default — expanded view shows the HTML in a sandboxed iframe.
 */
export function HtmlContentPreview({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setOpen(x => !x); }, []);

  return (
    <div className="mt-1 space-y-1">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 transition-colors font-mono text-[10px]"
        title={open ? "Collapse HTML preview" : "Preview rendered HTML"}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Preview HTML</span>
        <span className="text-purple-400/60">({html.length.toLocaleString()} chars)</span>
      </button>
      {open && (
        <iframe
          srcDoc={html}
          sandbox="allow-same-origin"
          className="w-full rounded-lg border border-[#30363D] bg-white"
          style={{ height: 320 }}
          title="HTML preview"
        />
      )}
    </div>
  );
}

// ── ExpandableJson ─────────────────────────────────────────────────────────────

/** Try to parse `s` as JSON. Returns the parsed value or null if it's not JSON. */
function tryParseJson(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed[0] !== "{" && trimmed[0] !== "[") return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

/**
 * Renders a string value that may contain JSON.
 * - If it IS valid JSON (object or array), shows a short type-hint and a toggle button.
 * - Expanded view shows a pretty-printed <pre> block.
 * - Plain strings render as-is.
 */
export function ExpandableJson({ value, className = "" }: { value: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = tryParseJson(value);
  const isJson = parsed !== null && typeof parsed === "object";

  const toggle = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setExpanded(x => !x); }, []);

  if (!isJson) {
    return <span className={className}>{value}</span>;
  }

  const preview = Array.isArray(parsed)
    ? `Array(${(parsed as unknown[]).length})`
    : `{${Object.keys(parsed as object).slice(0, 3).join(", ")}${Object.keys(parsed as object).length > 3 ? ", …" : ""}}`;

  return (
    <span className={className}>
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#2E9EFF] hover:bg-[#0078D4]/25 transition-colors font-mono text-[10px]"
        title={expanded ? "Collapse" : "Expand object"}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>{preview}</span>
      </button>
      {expanded && (
        <pre className="mt-1 block bg-[#0D1117] border border-[#30363D] rounded-lg p-2.5 text-[10px] font-mono text-[#E6EDF3] overflow-auto max-h-64 whitespace-pre-wrap">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </span>
  );
}

// ── Shared types ───────────────────────────────────────────────────────────────

export interface WfRunDetail {
  id: number;
  definitionId: number;
  definitionName: string | null;
  versionLabel: string | null;
  versionNumber: number | null;
  triggerType: string;
  triggerRef: string | null;
  status: string;
  payload: Record<string, unknown>;
  branchPath: string[];
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  retriggeredFromRunId?: number | null;
  graph: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }> } | null;
  logs: Array<{ id: number; nodeId: string; level: string; message: string; metadata?: Record<string, unknown> | null; timestamp: string }>;
  nodeOutputs: Array<{ id: number; nodeId: string; input: Record<string, unknown>; output: Record<string, unknown>; durationMs: number | null; status: string; errorMessage: string | null; timestamp: string }>;
  /** The node currently executing (started but not yet completed). Null when idle. */
  activeNodeId?: string | null;
}

export const STATUS_STYLES: Record<string, string> = {
  completed:          "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:            "bg-blue-500/20 text-blue-300 border-blue-500/30",
  failed:             "bg-red-500/20 text-red-400 border-red-500/30",
  pending:            "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled:          "bg-[#30363D] text-[#7D8590] border-[#30363D]",
  awaiting_approval:  "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
};

// ── ReplayNode (kept for any external consumers) ───────────────────────────────

const NODE_BORDER: Record<string, string> = {
  start:     "#22C55E",
  end:       "#6366F1",
  action:    "#0078D4",
  condition: "#F59E0B",
  delay:     "#A855F7",
  error:     "#EF4444",
};

export function ReplayNode({ data }: NodeProps) {
  const nodeType  = (data.nodeType as string) ?? "action";
  const inPath    = data.inPath as boolean;
  const isCurrent = data.isCurrent as boolean;
  const isSkipped = data.isSkipped as boolean;
  const hasError  = data.hasError as boolean;
  const isMutated = data.isMutated as boolean;
  const border    = hasError ? "#EF4444" : NODE_BORDER[nodeType] ?? "#0078D4";

  const bgColor = isSkipped    ? "#0D1117"
                : hasError     ? "#1A0808"
                : isCurrent    ? `${border}22`
                : inPath       ? "#161B22"
                                : "#0D1117";

  const borderColor = isCurrent ? border
                    : hasError  ? "#EF4444"
                    : inPath    ? border + "80"
                                : "#30363D";

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        padding: "8px 14px",
        minWidth: 130,
        opacity: isSkipped ? 0.35 : 1,
        boxShadow: isCurrent ? `0 0 12px ${border}60` : hasError ? "0 0 8px #EF444440" : "none",
        transition: "all 0.2s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: border, border: "none" }} />
      <div className="flex items-center gap-1">
        <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: border }}>{nodeType}</div>
        {hasError  && <span className="text-[9px] text-red-400 font-semibold">⚠ error</span>}
        {isMutated && !hasError && <span className="text-[9px] text-amber-400">✎</span>}
        {isSkipped && <span className="text-[9px] text-[#484F58]">skipped</span>}
      </div>
      <div className="text-xs font-medium text-[#E6EDF3] truncate leading-snug">
        {(data.label as string) || nodeType}
      </div>
      {isCurrent && !hasError && <div className="text-[9px] text-blue-300 mt-0.5">▶ Current step</div>}
      {isCurrent && hasError   && <div className="text-[9px] text-red-400 mt-0.5">⚠ Failed here</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: border, border: "none" }} />
    </div>
  );
}

export const replayNodeTypes: NodeTypes = { replayNode: ReplayNode };

// ── Sensitivity label map for check_script_output ─────────────────────────────

const SENSITIVITY_LABELS: Record<string, string> = {
  strict:       "Strict",
  balanced:     "Balanced",
  lenient:      "Lenient",
  very_lenient: "Very Lenient",
};

// ── Vertical replay step card ──────────────────────────────────────────────────

function ReplayStepCard({
  nodeId,
  nodeType,
  label,
  isCurrent,
  inPath,
  isSkipped,
  skipReason,
  hasError,
  isMutated,
  pricingTotal,
  pricingLines,
  signalCount,
  hasSignals,
  scriptCheckPassed,
  scriptCheckSensitivity,
  onClick,
}: {
  nodeId: string;
  nodeType: string;
  label: string;
  isCurrent: boolean;
  inPath: boolean;
  isSkipped: boolean;
  skipReason?: string;
  hasError: boolean;
  isMutated: boolean;
  pricingTotal?: number;
  pricingLines?: number;
  signalCount?: number;
  hasSignals?: boolean;
  scriptCheckPassed?: boolean;
  scriptCheckSensitivity?: string;
  onClick: () => void;
}) {
  const style = NODE_STYLES[nodeType] ?? NODE_STYLES["action"] ?? {
    bg: "#1C2128", border: "#30363D", icon: "⚡", label: nodeType,
  };

  const borderColor = isCurrent
    ? (hasError ? "#EF4444" : style.border)
    : hasError
    ? "#EF444466"
    : inPath
    ? style.border + "80"
    : "#30363D";

  const bgColor = hasError && isCurrent
    ? "#1A0808"
    : isCurrent
    ? style.bg
    : inPath
    ? style.bg
    : "#0D1117";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className="relative rounded-xl border-2 transition-all cursor-pointer select-none focus:outline-none"
      style={{
        borderColor,
        opacity: isSkipped ? 0.35 : 1,
        boxShadow: isCurrent
          ? `0 0 0 1px ${hasError ? "#EF444440" : style.border + "40"}, 0 0 14px ${hasError ? "#EF444440" : style.border + "50"}`
          : "none",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px]"
        style={{ background: bgColor }}
      >
        {/* Icon */}
        <span className="text-base flex-shrink-0 w-6 text-center">{style.icon}</span>

        {/* Label + type badge */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#E6EDF3] truncate leading-snug">{label || style.label}</p>
          <p className="text-[10px] font-medium truncate mt-0.5" style={{ color: style.border }}>
            {nodeType.replace(/_/g, " ")}
          </p>
          <p className="text-[9px] text-[#484F58] font-mono truncate mt-0.5">{nodeId}</p>
          {pricingTotal != null && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#00B4D8]/15 border border-[#00B4D8]/35 text-[#00B4D8]">
                💲 {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(pricingTotal)}
              </span>
              {pricingLines != null && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-[#1C2128] border border-[#30363D] text-[#7D8590]">
                  {pricingLines} line{pricingLines !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
          {signalCount != null && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                hasSignals
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/30"
              }`}>
                📡 {signalCount} signal{signalCount !== 1 ? "s" : ""}
              </span>
              {!hasSignals && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-[#1C2128] border border-[#30363D] text-[#7D8590]">
                  alwaysInclude only
                </span>
              )}
            </div>
          )}
          {scriptCheckPassed != null && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                scriptCheckPassed
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-red-500/15 text-red-400 border-red-500/30"
              }`}>
                🔬 {scriptCheckPassed ? "passed" : "failed"}
              </span>
              {scriptCheckSensitivity && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-[#1C2128] border border-[#30363D] text-[#7D8590]">
                  {SENSITIVITY_LABELS[scriptCheckSensitivity] ?? scriptCheckSensitivity}
                </span>
              )}
            </div>
          )}
        </div>

        {/* State badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasError && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded-full">
              ⚠ error
            </span>
          )}
          {isMutated && !hasError && (
            <span className="text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full">✎ mutated</span>
          )}
          {isSkipped && (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[9px] text-[#484F58] bg-[#1C2128] border border-[#30363D] px-1.5 py-0.5 rounded-full">skipped</span>
              {skipReason && (
                <span className="text-[8px] text-[#484F58] font-mono max-w-[120px] text-right leading-snug truncate" title={skipReason}>
                  {skipReason}
                </span>
              )}
            </div>
          )}
          {isCurrent && !hasError && (
            <span className="text-[9px] text-blue-300 bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.5 rounded-full">▶ Current</span>
          )}
          {isCurrent && hasError && (
            <span className="text-[9px] text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded-full">⚠ Failed here</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── JSON diff viewer ───────────────────────────────────────────────────────────

/** Format a diff value: plain scalars inline, objects/arrays as ExpandableJson. */
function DiffValue({ raw }: { raw: string | undefined }) {
  if (raw === undefined) return null;
  const parsed = tryParseJson(raw);
  if (parsed !== null && typeof parsed === "object") {
    return <ExpandableJson value={raw} />;
  }
  return <span>{raw}</span>;
}

export function DiffViewer({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  if (allKeys.length === 0) {
    return <p className="text-[10px] text-[#484F58] font-mono italic">empty</p>;
  }

  // Split htmlContent out of the diff so it renders as a preview, not raw text
  const regularKeys = allKeys.filter(k => k !== "htmlContent");
  const htmlAfter  = typeof after.htmlContent  === "string" ? after.htmlContent  : null;
  const htmlBefore = typeof before.htmlContent === "string" ? before.htmlContent : null;
  const htmlContentKey = allKeys.includes("htmlContent");

  return (
    <div className="space-y-2">
      <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 font-mono text-[10px] overflow-auto max-h-72 space-y-0.5">
        {regularKeys.map(key => {
          const bVal = JSON.stringify(before[key] ?? undefined);
          const aVal = JSON.stringify(after[key] ?? undefined);
          const added   = !(key in before);
          const removed = !(key in after);
          const changed = !added && !removed && bVal !== aVal;
          const rowCls  = added ? "bg-emerald-500/10" : removed ? "bg-red-500/10" : changed ? "bg-amber-500/8" : "";
          const keyCls  = added ? "text-emerald-400" : removed ? "text-red-400" : changed ? "text-amber-300" : "text-[#7D8590]";
          const valCls  = added ? "text-emerald-300" : removed ? "text-red-300" : changed ? "text-[#E6EDF3]" : "text-[#E6EDF3]";
          const prefix  = added ? "+ " : removed ? "- " : changed ? "~ " : "  ";
          return (
            <div key={key} className={`flex flex-wrap gap-1 px-1 py-0.5 rounded ${rowCls}`}>
              <span className="text-[#484F58] w-4 shrink-0">{prefix}</span>
              <span className={`${keyCls} shrink-0`}>{key}:</span>
              {changed ? (
                <span className={`${valCls} flex flex-wrap items-start gap-1`}>
                  <span className="line-through text-red-400"><DiffValue raw={bVal} /></span>
                  <DiffValue raw={aVal} />
                </span>
              ) : (
                <span className={valCls}><DiffValue raw={removed ? bVal : aVal} /></span>
              )}
            </div>
          );
        })}
        {regularKeys.length === 0 && !htmlContentKey && (
          <p className="text-[#484F58] italic">empty</p>
        )}
        {htmlContentKey && (
          <div className="flex flex-wrap gap-1 px-1 py-0.5 rounded">
            <span className="text-[#484F58] w-4 shrink-0">{htmlAfter && !htmlBefore ? "+ " : !htmlAfter && htmlBefore ? "- " : htmlAfter !== htmlBefore ? "~ " : "  "}</span>
            <span className="text-purple-300 shrink-0">htmlContent:</span>
            <span className="text-[#484F58] italic text-[9px] self-center">see preview below</span>
          </div>
        )}
      </div>
      {htmlContentKey && (htmlAfter ?? htmlBefore) && (
        <HtmlContentPreview html={(htmlAfter ?? htmlBefore)!} />
      )}
    </div>
  );
}

export function JsonBlock({ data, label }: { data: Record<string, unknown>; label: string }) {
  const htmlContent = typeof data.htmlContent === "string" ? data.htmlContent : null;
  const displayData = htmlContent !== null
    ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== "htmlContent"))
    : data;

  const [copied, handleCopy] = useCopyToClipboard();

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{label}</p>
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy(JSON.stringify(data, null, 2)); }}
          title={copied ? "Copied!" : "Copy JSON"}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#30363D] transition-colors text-[#484F58] hover:text-[#E6EDF3]"
        >
          {copied
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-[10px] font-mono text-[#E6EDF3] overflow-auto max-h-40 whitespace-pre-wrap">
        {JSON.stringify(displayData, null, 2)}
      </pre>
      {htmlContent !== null && <HtmlContentPreview html={htmlContent} />}
    </div>
  );
}

// ── TenantSignalsPanel ─────────────────────────────────────────────────────────

/**
 * Replaces the raw "Output" JsonBlock for `get_tenant_signals` node outputs.
 * Shows the hasSignals badge prominently, then lists each fired signal with its
 * human-readable label. Each signal is clickable and navigates to the signal
 * derivation rules admin page.
 */
function TenantSignalsPanel({ output }: { output: Record<string, unknown> }) {
  const [, navigate] = useLocation();
  const [copied, handleCopy] = useCopyToClipboard();
  const signals     = Array.isArray(output.signals) ? (output.signals as string[]) : [];
  const hasSignals  = Boolean(output.hasSignals);
  const signalCount = typeof output.signalCount === "number" ? (output.signalCount as number) : signals.length;

  return (
    <div className="space-y-2">
      {/* Header + hasSignals badge */}
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider flex-1">Signals Output</p>
        <button
          onClick={() => handleCopy(JSON.stringify(output, null, 2))}
          title={copied ? "Copied!" : "Copy JSON"}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#30363D] transition-colors text-[#484F58] hover:text-[#E6EDF3]"
        >
          {copied
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <Copy className="w-3 h-3" />}
        </button>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border ${
          hasSignals
            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
            : "bg-amber-500/15 text-amber-400 border-amber-500/30"
        }`}>
          {hasSignals ? "✓ signals found" : "— alwaysInclude only"}
        </span>
      </div>

      <p className="text-[10px] text-[#484F58] font-mono">
        {signalCount} signal{signalCount !== 1 ? "s" : ""} fired
      </p>

      {/* Signal pill list */}
      {signals.length === 0 ? (
        <p className="text-[10px] text-[#484F58] italic">No signals in output</p>
      ) : (
        <div className="space-y-1">
          {signals.map(key => {
            const label   = SIGNAL_LABELS[key] ?? key;
            const isAlways = key === "alwaysInclude";
            const isAdj   = key.startsWith("adj:");
            return (
              <button
                key={key}
                onClick={() => navigate("/system/signal-mappings")}
                title="View signal derivation rules"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[#1C2128] group"
              >
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold border flex-shrink-0 ${
                  isAlways
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                    : isAdj
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                    : "bg-violet-500/10 text-violet-400 border-violet-500/25"
                }`}>
                  {isAlways ? "∞" : isAdj ? "±" : "⚡"}
                </span>
                <span className="flex-1 text-[10px] text-[#C9D1D9] font-medium leading-snug truncate">{label}</span>
                <span className="text-[8px] text-[#484F58] font-mono truncate max-w-[70px] group-hover:text-[#7D8590]">{key}</span>
                <svg className="w-2.5 h-2.5 text-[#484F58] flex-shrink-0 group-hover:text-[#7D8590] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            );
          })}
        </div>
      )}

      {/* Collapsible raw JSON fallback */}
      <JsonBlock data={output} label="Raw output" />
    </div>
  );
}

// ── ScriptCheckOutputPanel ─────────────────────────────────────────────────────

/**
 * Replaces the raw "Output" JsonBlock for `check_script_output` node outputs.
 * Shows the pass/fail result and sensitivity level prominently, then shows the
 * AI outcome sentence and collapsible raw output.
 */
function ScriptCheckOutputPanel({ output }: { output: Record<string, unknown> }) {
  const [copied, handleCopy] = useCopyToClipboard();
  const passed      = typeof output.passed === "boolean" ? (output.passed as boolean) : null;
  const outcome     = typeof output.outcome === "string" ? (output.outcome as string) : null;
  const sensitivity = typeof output.sensitivity === "string" ? (output.sensitivity as string) : null;
  const sensitivityLabel = sensitivity ? (SENSITIVITY_LABELS[sensitivity] ?? sensitivity) : null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">
          Script Output Check{sensitivityLabel ? ` (${sensitivityLabel})` : ""}
        </p>
        <button
          onClick={() => handleCopy(JSON.stringify(output, null, 2))}
          title={copied ? "Copied!" : "Copy JSON"}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#30363D] transition-colors text-[#484F58] hover:text-[#E6EDF3]"
        >
          {copied
            ? <Check className="w-3 h-3 text-emerald-400" />
            : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Pass / fail badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        {passed !== null && (
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            passed
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-red-500/15 text-red-400 border-red-500/30"
          }`}>
            🔬 {passed ? "Passed" : "Failed"}
          </span>
        )}
        {sensitivityLabel && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1C2128] border border-[#30363D] text-[#7D8590]">
            {sensitivityLabel} sensitivity
          </span>
        )}
      </div>

      {/* AI outcome sentence */}
      {outcome && (
        <div className="px-3 py-2 rounded-lg bg-[#1C2128] border border-[#30363D]">
          <p className="text-[10px] text-[#C9D1D9] leading-relaxed">{outcome}</p>
        </div>
      )}

      {/* Collapsible raw JSON */}
      <JsonBlock data={output} label="Raw output" />
    </div>
  );
}

export function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ── Parallel branch output components ──────────────────────────────────────────

interface BranchInfo {
  handle: string;
  label: string;
  wait: boolean;
  output: Record<string, unknown> | undefined;
}

function ParallelBranchCard({ branch }: { branch: BranchInfo }) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = branch.wait ? "#06B6D4" : "#F59E0B";
  const bgColor     = branch.wait ? "#04161E" : "#160E00";
  const canExpand   = branch.wait && branch.output !== undefined;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${borderColor}40`, background: bgColor }}
    >
      <button
        onClick={() => canExpand && setExpanded(x => !x)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
        style={{ cursor: canExpand ? "pointer" : "default" }}
      >
        <span className="text-[11px] font-bold flex-shrink-0" style={{ color: borderColor }}>⇉</span>
        <span className="flex-1 text-[10px] font-semibold text-[#E6EDF3] truncate">{branch.label}</span>
        <span
          className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border"
          style={{ color: borderColor, borderColor: `${borderColor}50`, background: `${borderColor}15` }}
        >
          {!branch.wait ? "fire-and-forget" : branch.output ? "merged ✓" : "no output"}
        </span>
        {canExpand && (
          <svg
            className={`w-3 h-3 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            style={{ color: borderColor }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {!branch.wait && (
        <div className="px-2.5 pb-2 text-[9px] text-amber-400/70 italic font-mono">
          launched in background — result not awaited
        </div>
      )}

      {branch.wait && !branch.output && (
        <div className="px-2.5 pb-2 text-[9px] text-red-400/60 italic font-mono">
          branch did not produce output
        </div>
      )}

      {canExpand && expanded && (
        <div
          className="px-2.5 pb-2.5 pt-1"
          style={{ borderTop: `1px solid ${borderColor}25` }}
        >
          <JsonBlock data={branch.output!} label="Branch output" />
        </div>
      )}
    </div>
  );
}

function ParallelBranchPanel({
  nodeId,
  graphNode,
  payload,
}: {
  nodeId: string;
  graphNode: { data: Record<string, unknown> } | undefined;
  payload: Record<string, unknown>;
}) {
  const branchLabels = (graphNode?.data?.branchLabels as string[] | undefined) ?? [];
  const branchWait   = (graphNode?.data?.branchWait   as boolean[] | undefined) ?? [];
  const branchCount  = Math.max(
    (graphNode?.data?.branchCount as number | undefined) ?? 0,
    branchLabels.length,
  );

  const steps        = (payload.steps as Record<string, unknown> | undefined) ?? {};
  const branchOutputs = (steps[nodeId] as Record<string, unknown> | undefined) ?? {};

  const branches: BranchInfo[] = Array.from({ length: branchCount }, (_, i) => {
    const handle = `branch_${i + 1}`;
    const label  = branchLabels[i] ?? `Branch ${i + 1}`;
    const wait   = branchWait[i] !== false;
    const output = branchOutputs[handle] as Record<string, unknown> | undefined;
    return { handle, label, wait, output };
  });

  const awaitedCount  = branches.filter(b => b.wait).length;
  const detachedCount = branches.filter(b => !b.wait).length;

  if (branches.length === 0) {
    return (
      <p className="text-[10px] text-[#484F58] font-mono italic">No branch configuration found.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">Parallel Branches</p>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
          {awaitedCount} awaited
        </span>
        {detachedCount > 0 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            {detachedCount} fire-and-forget
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {branches.map(branch => (
          <ParallelBranchCard key={branch.handle} branch={branch} />
        ))}
      </div>
    </div>
  );
}

function JoinNodeSummary({
  nodeId,
  graph,
}: {
  nodeId: string;
  graph: WfRunDetail["graph"];
}) {
  if (!graph) return null;

  const parallelNode = graph.nodes.find(n => n.data?.joinNodeId === nodeId);
  const branchLabels = (parallelNode?.data?.branchLabels as string[] | undefined) ?? [];
  const branchWait   = (parallelNode?.data?.branchWait   as boolean[] | undefined) ?? [];
  const branchCount  = Math.max(
    (parallelNode?.data?.branchCount as number | undefined) ?? 0,
    branchLabels.length,
    branchWait.length,
  );

  const awaitedCount  = branchCount > 0
    ? Array.from({ length: branchCount }, (_, i) => branchWait[i] !== false).filter(Boolean).length
    : graph.edges.filter(e => e.target === nodeId).length;
  const detachedCount = branchCount > 0
    ? branchWait.filter(w => w === false).length
    : 0;

  return (
    <div className="px-2.5 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">⤤</span>
        <p className="text-[10px] font-semibold text-cyan-400">
          Merged {awaitedCount} awaited branch{awaitedCount !== 1 ? "es" : ""}
        </p>
      </div>
      {detachedCount > 0 && (
        <p className="text-[9px] text-amber-400/80 font-mono">
          + {detachedCount} fire-and-forget branch{detachedCount !== 1 ? "es" : ""} launched
        </p>
      )}
      {branchLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {Array.from({ length: branchCount }, (_, i) => {
            const label = branchLabels[i] ?? `Branch ${i + 1}`;
            const wait  = branchWait[i] !== false;
            return (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium border"
                style={
                  wait
                    ? { color: "#06B6D4", borderColor: "#06B6D430", background: "#06B6D415" }
                    : { color: "#F59E0B", borderColor: "#F59E0B30", background: "#F59E0B15" }
                }
              >
                {label}{!wait ? " ↗" : ""}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ChildRunInline ─────────────────────────────────────────────────────────────

/** Maximum visual nesting depth to prevent infinite DOM growth. */
const MAX_RENDER_DEPTH = 5;

/**
 * Per-depth colour palette: border, accent text, and panel background.
 * Index 0 = depth 0 (immediate child), index 1 = grandchild, etc.
 * Beyond the last entry the palette wraps (modulo).
 */
const DEPTH_PALETTE = [
  { border: "#3B82F6", accent: "#3B82F6", bg: "#0D1A2E" }, // blue
  { border: "#00B4D8", accent: "#00B4D8", bg: "#04161E" }, // teal
  { border: "#A855F7", accent: "#A855F7", bg: "#110820" }, // purple
  { border: "#F59E0B", accent: "#F59E0B", bg: "#160E00" }, // amber
  { border: "#F472B6", accent: "#F472B6", bg: "#1A0612" }, // pink
] as const;

/**
 * Expandable inline panel showing the status, duration, and node steps of a
 * child workflow run. Recursively renders grandchild runs up to MAX_RENDER_DEPTH.
 * Rendered inside the parent run's output sidebar and payload tab whenever a
 * `run_workflow` node output contains `childRunId`.
 */
export function ChildRunInline({
  childRunId,
  depth = 0,
  depthValue,
  maxDepthValue,
}: {
  childRunId: number;
  depth?: number;
  /** The executor-reported depth of this child run (from the parent node output). */
  depthValue?: number;
  /** The configured max depth ceiling (from the parent node output). */
  maxDepthValue?: number;
}) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);

  const palette = DEPTH_PALETTE[depth % DEPTH_PALETTE.length]!;

  const { data: child, isLoading } = useQuery<WfRunDetail>({
    queryKey: ["wf-run", childRunId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${childRunId}`);
      if (!res.ok) throw new Error("Failed to load child run");
      return res.json();
    },
    enabled: expanded,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 3000 : false;
    },
  });

  const statusStyle = child
    ? (STATUS_STYLES[child.status] ?? "bg-[#30363D] text-[#7D8590] border-[#30363D]")
    : "";

  return (
    <div
      className="mt-2 rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${palette.border}40`,
        background: palette.bg,
        marginLeft: depth > 0 ? "8px" : undefined,
      }}
    >
      {/* Header row — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(x => !x)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(x => !x); }}
        className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors select-none"
        style={{ ["--hover-bg" as string]: `${palette.border}1A` }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = `${palette.border}18`; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
      >
        {/* Depth indicator connector line */}
        {depth > 0 && (
          <span
            className="flex-shrink-0 text-[10px] font-bold"
            style={{ color: palette.accent }}
          >
            {"└"}
          </span>
        )}
        <span className="text-sm flex-shrink-0" style={{ color: palette.accent }}>⚡</span>
        <span className="text-xs font-semibold text-[#E6EDF3] flex-1">
          {depth === 0 ? "Child" : "Grandchild"} Run #{childRunId}
          {depth > 1 && <span className="text-[#7D8590]"> (depth {depth})</span>}
        </span>

        {/* Depth badge — reflects this run's own depth value, passed from the parent node output */}
        {depthValue != null && maxDepthValue != null && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border flex-shrink-0"
            style={{
              background: `${palette.border}20`,
              color: palette.accent,
              borderColor: `${palette.border}50`,
            }}
          >
            Depth: {depthValue} / {maxDepthValue}
          </span>
        )}

        {child && (
          <>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${statusStyle}`}>
              {child.status}
            </span>
            {child.durationMs != null && (
              <span className="text-[10px] text-[#484F58] font-mono flex-shrink-0">{fmtDuration(child.durationMs)}</span>
            )}
          </>
        )}
        {isLoading && expanded && (
          <span
            className="inline-block w-3 h-3 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0"
            style={{ borderColor: `${palette.border} transparent transparent transparent` }}
          />
        )}
        <svg
          className={`w-3.5 h-3.5 text-[#484F58] flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div
          className="px-3 py-2.5 space-y-2.5"
          style={{ borderTop: `1px solid ${palette.border}25` }}
        >
          {isLoading && !child && (
            <p className="text-[10px] text-[#7D8590]">Loading…</p>
          )}

          {child && (
            <>
              {/* Summary row */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                {child.definitionName && (
                  <span className="text-[#7D8590] font-medium">{child.definitionName}</span>
                )}
                {child.startedAt && (
                  <span className="text-[#484F58]">
                    Started {format(new Date(child.startedAt), "HH:mm:ss")}
                  </span>
                )}
                {child.finishedAt && (
                  <span className="text-[#484F58]">
                    · Finished {format(new Date(child.finishedAt), "HH:mm:ss")}
                  </span>
                )}
              </div>

              {/* Error message */}
              {child.errorMessage && (
                <div className="px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] text-red-400 font-mono">
                  {child.errorMessage}
                </div>
              )}

              {/* Node step list */}
              {child.branchPath.length > 0 && (
                <div className="space-y-0.5">
                  <p className="text-[9px] font-semibold text-[#484F58] uppercase tracking-wider mb-1">Node steps</p>
                  {child.branchPath.map((nodeId, idx) => {
                    const graphNode = (child.graph?.nodes ?? []).find(n => n.id === nodeId);
                    const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                    const label = (graphNode?.data?.label as string) ?? nodeType;
                    const nodeOutput = child.nodeOutputs.find(o => o.nodeId === nodeId);
                    const hasError = nodeOutput?.status === "error";
                    const style = NODE_STYLES[nodeType] ?? NODE_STYLES["action"] ?? { bg: "#1C2128", border: "#30363D", icon: "⚡", label: nodeType };

                    return (
                      <div key={`${nodeId}-${idx}`}>
                        <div
                          className="flex items-center gap-2 px-2 py-1 rounded-lg"
                          style={{ background: hasError ? "#1A0808" : style.bg + "80" }}
                        >
                          <span className="text-[11px] flex-shrink-0">{style.icon}</span>
                          <span className="flex-1 text-[10px] font-medium text-[#E6EDF3] truncate">{label || style.label}</span>
                          {nodeOutput && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold flex-shrink-0 ${
                              hasError
                                ? "bg-red-500/10 text-red-400 border-red-500/30"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            }`}>
                              {hasError ? "error" : "ok"}
                            </span>
                          )}
                          {nodeOutput?.durationMs != null && (
                            <span className="text-[9px] text-[#484F58] font-mono flex-shrink-0">{fmtDuration(nodeOutput.durationMs)}</span>
                          )}
                        </div>

                        {/* Inline grandchild run (recursive) — badge shown in nested header */}
                        {nodeOutput && typeof nodeOutput.output.childRunId === "number" && depth < MAX_RENDER_DEPTH && (
                          <div className="pl-3">
                            <ChildRunInline
                              childRunId={nodeOutput.output.childRunId as number}
                              depth={depth + 1}
                              depthValue={typeof nodeOutput.output.depth === "number" ? (nodeOutput.output.depth as number) : undefined}
                              maxDepthValue={typeof nodeOutput.output.maxDepth === "number" ? (nodeOutput.output.maxDepth as number) : undefined}
                            />
                          </div>
                        )}

                        {/* Depth cap reached */}
                        {nodeOutput && typeof nodeOutput.output.childRunId === "number" && depth >= MAX_RENDER_DEPTH && (
                          <div className="mt-1 pl-3 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#30363D]/40 border border-[#30363D]">
                            <span className="text-[10px] text-[#7D8590]">
                              ⛔ Chain continues — max display depth ({MAX_RENDER_DEPTH}) reached.{" "}
                              <button
                                className="underline text-[#2E9EFF] hover:text-[#60C0FF] transition-colors"
                                onClick={e => { e.stopPropagation(); navigate(`/workflows/runs/${nodeOutput.output.childRunId as number}`); }}
                              >
                                View run #{nodeOutput.output.childRunId as number}
                              </button>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {child.branchPath.length === 0 && (
                <p className="text-[10px] text-[#484F58] italic">No steps executed yet.</p>
              )}

              {/* Navigate to full run */}
              <button
                onClick={e => { e.stopPropagation(); navigate(`/workflows/runs/${childRunId}`); }}
                className="flex items-center gap-1.5 text-[10px] font-semibold transition-colors"
                style={{ color: palette.accent }}
              >
                View full {depth === 0 ? "child" : "nested"} run
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Skip reason resolver ───────────────────────────────────────────────────────
// Traces back through the graph to explain why a node was not executed.
// Returns a short human-readable string, or null when no useful reason is found.

function getSkipReason(
  nodeId: string,
  graph: { nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>; edges: Array<{ source: string; target: string; sourceHandle?: string }> } | undefined | null,
  nodeOutputMap: Map<string, { output: Record<string, unknown> }>,
  graphNodeMap: Map<string, { type?: string; data: Record<string, unknown> }>,
  _visited = new Set<string>(),
): string | null {
  if (!graph) return null;
  if (_visited.has(nodeId)) return null;
  _visited.add(nodeId);

  const incomingEdges = graph.edges.filter(e => e.target === nodeId);
  for (const edge of incomingEdges) {
    const srcNode = graphNodeMap.get(edge.source);
    const srcType = (srcNode?.data?.nodeType as string | undefined) ?? srcNode?.type ?? "";
    const srcOut  = nodeOutputMap.get(edge.source);

    if (srcType === "condition" && srcOut) {
      const result     = srcOut.output.result as boolean | undefined;
      const expression = srcOut.output.expression as string | undefined;
      const handle     = edge.sourceHandle ?? "";
      const isYesBranch = handle === "yes" || handle === "true";
      const isNoBranch  = handle === "no"  || handle === "false";
      const exprLabel   = expression ? ` · ${expression}` : "";

      if (result === true  && isNoBranch)  return `condition true → no-branch skipped${exprLabel}`;
      if (result === false && isYesBranch) return `condition false → yes-branch skipped${exprLabel}`;
      if (result === true  && isYesBranch) return `condition true → yes-branch taken (this node is downstream of a skipped path)`;
      if (result === false && isNoBranch)  return `condition false → no-branch taken (this node is downstream of a skipped path)`;
    }

    if (srcType === "switch_case" && srcOut) {
      const chosen = srcOut.output.chosenBranch as string | undefined;
      if (chosen) return `switch chose "${chosen}" — this branch not taken`;
    }

    // Propagated skip — the source itself was skipped; recurse one level
    if (srcOut?.output?.skipped === true) {
      const parentReason = getSkipReason(edge.source, graph, nodeOutputMap, graphNodeMap, _visited);
      if (parentReason) return parentReason;
      return "predecessor was not executed";
    }
  }

  return null;
}

// ── Retry exhausted map ────────────────────────────────────────────────────────

/**
 * Builds a map from each retry node ID to the set of node IDs that belong to
 * its "exhausted" branch.  Used by the replay view to visually group those
 * nodes into a distinct container rather than rendering them inline with the
 * main execution flow.
 */
function buildRetryExhaustedMap(
  graph: WfRunDetail["graph"],
): Map<string, Set<string>> {
  if (!graph) return new Map();
  const { nodes, edges } = graph;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const outEdges = new Map<string, typeof edges>();
  for (const e of edges) {
    if (!outEdges.has(e.source)) outEdges.set(e.source, []);
    outEdges.get(e.source)!.push(e);
  }

  const result = new Map<string, Set<string>>();

  for (const node of nodes) {
    const nType = (node.data.nodeType as string) || node.type || "";
    if (nType !== "retry") continue;

    const nodeOut = outEdges.get(node.id) ?? [];
    const exhaustedEdge = nodeOut.find(e => e.sourceHandle === "exhausted");
    if (!exhaustedEdge) continue;

    const doneEdge = nodeOut.find(e => e.sourceHandle === "done");
    const doneTarget = doneEdge?.target;

    const exhaustedSet = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [exhaustedEdge.target];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id) || id === doneTarget) continue;
      visited.add(id);
      if (!nodeMap.has(id)) continue;
      exhaustedSet.add(id);
      for (const e of outEdges.get(id) ?? []) queue.push(e.target);
    }

    result.set(node.id, exhaustedSet);
  }

  return result;
}

// ── Replay entry types ─────────────────────────────────────────────────────────

type ReplayEntry =
  | { kind: "step"; nodeId: string; idx: number }
  | { kind: "exhausted_group"; retryNodeId: string; items: Array<{ nodeId: string; idx: number }> };

// ── RunDetailContent — three-tab body, owns its own fetching ──────────────────

export default function RunDetailContent({ runId }: { runId: number }) {
  const { fetchWithAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<"replay" | "timeline" | "payload">("replay");
  const [replayStep, setReplayStep] = useState(0);

  useEffect(() => {
    setActiveTab("replay");
    setReplayStep(0);
  }, [runId]);

  const { data: run, isLoading } = useQuery<WfRunDetail>({
    queryKey: ["wf-run", runId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 3000 : false;
    },
  });

  // ── Retry exhausted grouping (hooks must be called before any early return) ──
  // Build retry → exhaustedSet map from the run graph, then group branchPath
  // entries so exhausted-branch nodes are rendered in a distinct container.
  // Optional-chained so these are safe while `run` is still undefined.
  const retryExhaustedMap = useMemo(
    () => buildRetryExhaustedMap(run?.graph ?? null),
    [run?.graph],
  );

  // Inverse map: exhaustedNodeId → retryNodeId
  const nodeToRetry = useMemo(() => {
    const m = new Map<string, string>();
    for (const [retryId, exhaSet] of retryExhaustedMap) {
      for (const nid of exhaSet) m.set(nid, retryId);
    }
    return m;
  }, [retryExhaustedMap]);

  const allExhaustedIds = useMemo(() => new Set(nodeToRetry.keys()), [nodeToRetry]);

  const _branchPathForMemo = run?.branchPath ?? [];
  // Group the flat branchPath into ReplayEntry items so exhausted steps are
  // collected under their parent retry node in a single visual block.
  const replayEntries = useMemo((): ReplayEntry[] => {
    const entries: ReplayEntry[] = [];
    const groupByRetry = new Map<string, ReplayEntry & { kind: "exhausted_group" }>();

    for (let idx = 0; idx < _branchPathForMemo.length; idx++) {
      const nodeId = _branchPathForMemo[idx]!;
      if (allExhaustedIds.has(nodeId)) {
        const retryId = nodeToRetry.get(nodeId)!;
        let group = groupByRetry.get(retryId);
        if (!group) {
          group = { kind: "exhausted_group", retryNodeId: retryId, items: [] };
          groupByRetry.set(retryId, group);
          entries.push(group);
        }
        group.items.push({ nodeId, idx });
      } else {
        entries.push({ kind: "step", nodeId, idx });
      }
    }
    return entries;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_branchPathForMemo, allExhaustedIds, nodeToRetry]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#7D8590] text-sm">Run not found</p>
      </div>
    );
  }

  const branchPath = run.branchPath ?? [];
  const maxStep = branchPath.length - 1;
  const currentNodeId = branchPath[replayStep] ?? null;

  // ForEach iteration nodes appear in branchPath as "node-103[0]", "node-103[1]", etc.
  // Strip the "[N]" suffix to get the base graph nodeId for lookups that don't yet
  // have indexed rows (e.g. old completed runs or non-start subgraph nodes).
  const currentBaseNodeId = currentNodeId != null
    ? currentNodeId.replace(/\[\d+\]$/, "")
    : null;

  // Build O(1) lookups — avoids O(n²) .find() inside render loops
  const nodeOutputMap = new Map(run.nodeOutputs.map(o => [o.nodeId, o]));
  // Prefer the exact indexed key (written by new server code); fall back to bare
  // nodeId for old runs where only the base key was stored.
  const currentOutput = currentNodeId != null
    ? (nodeOutputMap.get(currentNodeId) ?? nodeOutputMap.get(currentBaseNodeId ?? ""))
    : undefined;

  // Build a lookup: nodeId → graph node data
  const graphNodeMap = new Map(
    (run.graph?.nodes ?? []).map(n => [n.id, n])
  );

  // Nodes not in branchPath (skipped/not executed) — use Set for O(1) membership test
  const branchSet = new Set(branchPath);
  const skippedNodeIds = (run.graph?.nodes ?? [])
    .map(n => n.id)
    .filter(id => !branchSet.has(id));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-[#30363D] px-4">
        {(["replay", "timeline", "payload"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-[#0078D4] text-[#E6EDF3]"
                : "border-transparent text-[#7D8590] hover:text-[#E6EDF3]"
            }`}
          >
            {tab}
          </button>
        ))}
        {run.status === "running" || run.status === "pending" ? (
          <div className="ml-auto flex items-center pr-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-ping" />
          </div>
        ) : null}
      </div>

      {run.errorMessage && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-400 font-mono">
          Error: {run.errorMessage}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">

        {/* ── Replay tab ── */}
        {activeTab === "replay" && (
          <div className="h-full flex flex-col">
            {branchPath.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[#7D8590] text-sm">No execution steps recorded yet.</p>
              </div>
            ) : (
              <>
                <div className="flex-1 flex overflow-hidden">
                  {/* Vertical card list */}
                  <div className="flex-1 overflow-y-auto bg-[#0D1117] p-4">
                    <div className="max-w-lg mx-auto space-y-1">
                      {replayEntries.map((entry, entryIdx) => {
                        const isLastEntry = entryIdx === replayEntries.length - 1;

                        if (entry.kind === "exhausted_group") {
                          // ── Exhausted branch container ─────────────────────
                          const anyInPath = entry.items.some(({ idx }) => idx <= replayStep);
                          return (
                            <div key={`exhausted-${entry.retryNodeId}`}>
                              {/* Connector from the preceding step */}
                              <div className="flex justify-center">
                                <div className="w-px h-3 bg-amber-500/40" />
                              </div>
                              <div className="rounded-xl border border-amber-500/40 overflow-hidden"
                                style={{ background: anyInPath ? "#1A1200" : "#0D1117" }}>
                                {/* Header */}
                                <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/25">
                                  <span className="text-amber-400 text-sm">🔁</span>
                                  <span className="text-[9px] uppercase tracking-widest font-bold text-amber-400">
                                    Exhausted — ran after all retries were used up
                                  </span>
                                  <span className="ml-auto text-[9px] font-mono text-amber-500/60">
                                    {entry.items.length} step{entry.items.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                {/* Steps inside the group */}
                                <div className="p-3 space-y-1">
                                  {entry.items.map(({ nodeId, idx }, i) => {
                                    const baseNodeId = nodeId.replace(/\[\d+\]$/, "");
                                    const graphNode = graphNodeMap.get(nodeId) ?? graphNodeMap.get(baseNodeId);
                                    const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                                    const label = (graphNode?.data?.label as string) ?? nodeType;
                                    const inPath = idx <= replayStep;
                                    const isCurrent = nodeId === currentNodeId;
                                    const nodeOutput = nodeOutputMap.get(nodeId) ?? nodeOutputMap.get(baseNodeId);
                                    const hasError = nodeOutput?.status === "error";
                                    const isMutated = !hasError && nodeOutput != null
                                      && Object.keys(nodeOutput.output).length > 0
                                      && JSON.stringify(nodeOutput.input) !== JSON.stringify(nodeOutput.output);
                                    const pricingTotal = nodeType === "calculate_pricing"
                                      ? (nodeOutput?.output?.totalPrice as number | undefined)
                                      : undefined;
                                    const pricingLines = nodeType === "calculate_pricing"
                                      ? (nodeOutput?.output?.lineCount as number | undefined)
                                      : undefined;
                                    const signalCount = nodeType === "get_tenant_signals"
                                      ? (nodeOutput?.output?.signalCount as number | undefined)
                                      : undefined;
                                    const hasSignals = nodeType === "get_tenant_signals"
                                      ? (nodeOutput?.output?.hasSignals as boolean | undefined)
                                      : undefined;
                                    const scriptCheckPassed = nodeType === "check_script_output"
                                      ? (nodeOutput?.output?.passed as boolean | undefined)
                                      : undefined;
                                    const scriptCheckSensitivity = nodeType === "check_script_output"
                                      ? (nodeOutput?.output?.sensitivity as string | undefined)
                                      : undefined;

                                    return (
                                      <div key={`${nodeId}-${idx}`}>
                                        <ReplayStepCard
                                          nodeId={nodeId}
                                          nodeType={nodeType}
                                          label={label}
                                          isCurrent={isCurrent}
                                          inPath={inPath}
                                          isSkipped={false}
                                          hasError={hasError}
                                          isMutated={isMutated}
                                          pricingTotal={pricingTotal}
                                          pricingLines={pricingLines}
                                          signalCount={signalCount}
                                          hasSignals={hasSignals}
                                          scriptCheckPassed={scriptCheckPassed}
                                          scriptCheckSensitivity={scriptCheckSensitivity}
                                          onClick={() => setReplayStep(idx)}
                                        />
                                        {i < entry.items.length - 1 && (
                                          <div className="flex justify-center">
                                            <div className="w-px h-3 bg-amber-500/30" />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* Connector to next entry */}
                              {!isLastEntry && (
                                <div className="flex justify-center">
                                  <div className="w-px h-3 bg-[#30363D]" />
                                </div>
                              )}
                            </div>
                          );
                        }

                        // ── Regular step ──────────────────────────────────────
                        const { nodeId, idx } = entry;
                        const baseNodeId = nodeId.replace(/\[\d+\]$/, "");
                        const graphNode = graphNodeMap.get(nodeId) ?? graphNodeMap.get(baseNodeId);
                        const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                        const label = (graphNode?.data?.label as string) ?? nodeType;
                        const inPath = idx <= replayStep;
                        const isCurrent = nodeId === currentNodeId;
                        const nodeOutput = nodeOutputMap.get(nodeId) ?? nodeOutputMap.get(baseNodeId);
                        const hasError = nodeOutput?.status === "error";
                        const isMutated = !hasError && nodeOutput != null
                          && Object.keys(nodeOutput.output).length > 0
                          && JSON.stringify(nodeOutput.input) !== JSON.stringify(nodeOutput.output);
                        const pricingTotal = nodeType === "calculate_pricing"
                          ? (nodeOutput?.output?.totalPrice as number | undefined)
                          : undefined;
                        const pricingLines = nodeType === "calculate_pricing"
                          ? (nodeOutput?.output?.lineCount as number | undefined)
                          : undefined;
                        const signalCount = nodeType === "get_tenant_signals"
                          ? (nodeOutput?.output?.signalCount as number | undefined)
                          : undefined;
                        const hasSignals = nodeType === "get_tenant_signals"
                          ? (nodeOutput?.output?.hasSignals as boolean | undefined)
                          : undefined;
                        const scriptCheckPassed = nodeType === "check_script_output"
                          ? (nodeOutput?.output?.passed as boolean | undefined)
                          : undefined;
                        const scriptCheckSensitivity = nodeType === "check_script_output"
                          ? (nodeOutput?.output?.sensitivity as string | undefined)
                          : undefined;

                        return (
                          <div key={`${nodeId}-${idx}`}>
                            <ReplayStepCard
                              nodeId={nodeId}
                              nodeType={nodeType}
                              label={label}
                              isCurrent={isCurrent}
                              inPath={inPath}
                              isSkipped={false}
                              hasError={hasError}
                              isMutated={isMutated}
                              pricingTotal={pricingTotal}
                              pricingLines={pricingLines}
                              signalCount={signalCount}
                              hasSignals={hasSignals}
                              scriptCheckPassed={scriptCheckPassed}
                              scriptCheckSensitivity={scriptCheckSensitivity}
                              onClick={() => setReplayStep(idx)}
                            />
                            {/* Connector line — skip if next entry is an exhausted group
                                (it renders its own incoming connector) */}
                            {!isLastEntry && replayEntries[entryIdx + 1]?.kind !== "exhausted_group" && (
                              <div className="flex justify-center">
                                <div className="w-px h-3 bg-[#30363D]" />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Currently-executing node — shown while a long-running node
                          (AI doc gen, runbook, etc.) is active but has not yet
                          written its output to wf_run_node_outputs. */}
                      {run.activeNodeId && (() => {
                        const execId = run.activeNodeId;
                        const graphNode = graphNodeMap.get(execId);
                        const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                        const label = (graphNode?.data?.label as string) ?? nodeType;
                        const style = NODE_STYLES[nodeType] ?? NODE_STYLES["action"] ?? { bg: "#1C2128", border: "#30363D", icon: "⚡", label: nodeType };
                        return (
                          <>
                            {/* connector from last completed node */}
                            <div className="flex justify-center">
                              <div className="w-px h-3 bg-[#30363D]" />
                            </div>
                            <div
                              className="relative rounded-xl border-2"
                              style={{
                                borderColor: style.border,
                                boxShadow: `0 0 0 1px ${style.border}40, 0 0 14px ${style.border}50`,
                              }}
                            >
                              <div
                                className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px]"
                                style={{ background: style.bg }}
                              >
                                <span className="text-base flex-shrink-0 w-6 text-center animate-pulse">{style.icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-[#E6EDF3] truncate leading-snug">{label}</p>
                                  <p className="text-[10px] font-medium truncate mt-0.5" style={{ color: style.border }}>
                                    {nodeType.replace(/_/g, " ")}
                                  </p>
                                  <p className="text-[9px] text-[#484F58] font-mono truncate mt-0.5">{execId}</p>
                                </div>
                                <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full border"
                                  style={{ color: style.border, borderColor: style.border + "50", background: style.bg }}>
                                  <span className="inline-block w-1.5 h-1.5 rounded-full animate-ping" style={{ background: style.border }} />
                                  running
                                </span>
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      {/* Skipped nodes (in graph but not in branchPath) */}
                      {skippedNodeIds.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 py-3">
                            <div className="flex-1 h-px bg-[#30363D]" />
                            <span className="text-[9px] uppercase tracking-widest font-bold text-[#484F58]">Not executed</span>
                            <div className="flex-1 h-px bg-[#30363D]" />
                          </div>
                          <div className="space-y-1">
                            {skippedNodeIds.map(nodeId => {
                              const graphNode = graphNodeMap.get(nodeId);
                              const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                              const label = (graphNode?.data?.label as string) ?? nodeType;
                              const skipReason = getSkipReason(nodeId, run.graph, nodeOutputMap, graphNodeMap) ?? undefined;
                              return (
                                <ReplayStepCard
                                  key={nodeId}
                                  nodeId={nodeId}
                                  nodeType={nodeType}
                                  label={label}
                                  isCurrent={false}
                                  inPath={false}
                                  isSkipped={true}
                                  skipReason={skipReason}
                                  hasError={false}
                                  isMutated={false}
                                  onClick={() => {}}
                                />
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sidebar: Input / Output / status for the selected step */}
                  {(() => {
                    if (!currentNodeId) return null;
                    // ForEach iteration nodes (e.g. "node-103[0]") are not in the graph;
                    // fall back to the base nodeId so we still resolve type/label.
                    const currentGraphNode = graphNodeMap.get(currentNodeId) ?? graphNodeMap.get(currentBaseNodeId ?? "");
                    const currentNodeType  = (currentGraphNode?.data?.nodeType as string) ?? currentGraphNode?.type ?? "";
                    const isParallelNode   = currentNodeType === "parallel";
                    const isJoinNode       = currentNodeType === "join";
                    if (!currentOutput && !isParallelNode && !isJoinNode) return null;
                    return (
                    <div className="w-64 flex-shrink-0 bg-[#161B22] border-l border-[#30363D] overflow-y-auto p-3 space-y-3">
                      <p className="text-xs font-semibold text-[#E6EDF3]">
                        Step {replayStep + 1} / {branchPath.length}
                      </p>
                      <p className="text-[10px] text-[#484F58] font-mono break-all">{currentNodeId}</p>

                      {/* ── Parallel node: show branch output panel ── */}
                      {isParallelNode && (
                        <ParallelBranchPanel
                          nodeId={currentNodeId}
                          graphNode={currentGraphNode}
                          payload={run.payload}
                        />
                      )}

                      {/* ── Join node: show merge summary ── */}
                      {isJoinNode && (
                        <JoinNodeSummary nodeId={currentNodeId} graph={run.graph} />
                      )}

                      {currentOutput && !isParallelNode && !isJoinNode && (
                        <>
                      <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        currentOutput.status === "ok" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : currentOutput.status === "error" ? "bg-red-500/10 text-red-400 border-red-500/20"
                        : "bg-[#30363D] text-[#7D8590] border-[#30363D]"
                      }`}>
                        {currentOutput.status}
                      </div>
                      {currentOutput.durationMs !== null && (
                        <p className="text-xs text-[#484F58]">{fmtDuration(currentOutput.durationMs)}</p>
                      )}
                      {typeof currentOutput.output.imageUploadWarning === "string" && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <span className="text-[10px] text-amber-400 font-medium">{currentOutput.output.imageUploadWarning}</span>
                        </div>
                      )}
                      {currentOutput.output.parseError === true && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30">
                          <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <span className="text-[10px] text-amber-400 font-medium">JSON parse failed — output is a raw string, not a structured object. Downstream nodes expecting an object may behave unexpectedly.</span>
                        </div>
                      )}
                      <JsonBlock data={currentOutput.input} label="Input" />
                      {currentNodeType === "get_tenant_signals" ? (
                        <TenantSignalsPanel output={currentOutput.output} />
                      ) : currentNodeType === "check_script_output" ? (
                        <ScriptCheckOutputPanel output={currentOutput.output} />
                      ) : (
                        <JsonBlock data={currentOutput.output} label="Output" />
                      )}
                      {/* Depth-limit abort: depth+maxDepth present but no child was created */}
                      {currentOutput.status === "error"
                        && typeof currentOutput.output.depth === "number"
                        && typeof currentOutput.output.maxDepth === "number"
                        && typeof currentOutput.output.childRunId !== "number" && (
                        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
                          <svg className="w-3 h-3 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-red-400 font-semibold">Depth limit reached</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                                {currentOutput.output.depth as number} / {currentOutput.output.maxDepth as number}
                              </span>
                            </div>
                            <p className="text-[10px] text-red-400/80 leading-snug">
                              Increase the sub-workflow's Max Run Depth setting or break the chain into separate triggers to avoid this limit.
                            </p>
                          </div>
                        </div>
                      )}
                      {typeof currentOutput.output.childRunId === "number" && (
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-[10px] font-semibold text-[#3B82F6] uppercase tracking-wider">Sub-workflow</p>
                            {typeof currentOutput.output.depth === "number" && typeof currentOutput.output.maxDepth === "number" && (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
                                (currentOutput.output.depth as number) >= (currentOutput.output.maxDepth as number)
                                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                                  : (currentOutput.output.depth as number) >= (currentOutput.output.maxDepth as number) - 1
                                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                  : "bg-[#1C2128] text-[#7D8590] border-[#30363D]"
                              }`}>
                                Depth: {currentOutput.output.depth as number} / {currentOutput.output.maxDepth as number}
                              </span>
                            )}
                          </div>
                          {currentOutput.status === "error" && typeof currentOutput.output.depth === "number" && typeof currentOutput.output.maxDepth === "number" && (
                            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 mb-2">
                              <svg className="w-3 h-3 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              <span className="text-[10px] text-red-400 font-medium leading-snug">
                                Depth limit reached ({currentOutput.output.depth as number} / {currentOutput.output.maxDepth as number}). Increase the sub-workflow's Max Run Depth setting or break the chain into separate triggers.
                              </span>
                            </div>
                          )}
                          <ChildRunInline
                            childRunId={currentOutput.output.childRunId as number}
                            depthValue={typeof currentOutput.output.depth === "number" ? (currentOutput.output.depth as number) : undefined}
                            maxDepthValue={typeof currentOutput.output.maxDepth === "number" ? (currentOutput.output.maxDepth as number) : undefined}
                          />
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  );
                  })()}
                </div>

                {/* Step controls */}
                <div className="flex-shrink-0 flex items-center justify-center gap-3 py-2.5 border-t border-[#30363D] bg-[#161B22]">
                  <button
                    onClick={() => setReplayStep(0)}
                    disabled={replayStep === 0}
                    className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setReplayStep(s => Math.max(0, s - 1))}
                    disabled={replayStep === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] border border-[#30363D] rounded-lg text-xs text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-40 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Prev
                  </button>
                  <span className="text-xs text-[#7D8590] tabular-nums">{replayStep + 1} / {branchPath.length}</span>
                  <button
                    onClick={() => setReplayStep(s => Math.min(maxStep, s + 1))}
                    disabled={replayStep >= maxStep}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2128] border border-[#30363D] rounded-lg text-xs text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-40 transition-colors"
                  >
                    Next
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setReplayStep(maxStep)}
                    disabled={replayStep >= maxStep}
                    className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] disabled:opacity-30 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Timeline tab ── */}
        {activeTab === "timeline" && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-2xl mx-auto">
              {run.logs.length === 0 ? (
                <p className="text-[#7D8590] text-sm">No log entries.</p>
              ) : (
                <div className="relative border-l-2 border-[#30363D] pl-6 space-y-4">
                  {run.logs.map(log => {
                    const isProgress = log.level === "progress";
                    const step  = isProgress ? (log.metadata?.step  as number | undefined) : undefined;
                    const total = isProgress ? (log.metadata?.total as number | undefined) : undefined;
                    const pricingTotal = log.metadata?.totalPrice as number | undefined;
                    const pricingLines = log.metadata?.lineCount  as number | undefined;
                    const hasPricing   = pricingTotal != null;
                    const dotColor = log.level === "error" ? "#EF4444"
                                   : log.level === "warn"  ? "#F59E0B"
                                   : isProgress            ? "#00B4D8"
                                   : hasPricing            ? "#00B4D8"
                                   :                         "#0078D4";
                    return (
                      <div key={log.id} className="relative">
                        <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 border-[#0D1117]" style={{ background: dotColor }} />
                        <div className="text-[10px] text-[#484F58] font-mono mb-0.5 flex items-center gap-2">
                          <span>{format(new Date(log.timestamp), "HH:mm:ss.SSS")} · {log.nodeId}</span>
                          {isProgress && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                              PROGRESS{step != null && total != null ? ` ${step}/${total}` : ""}
                            </span>
                          )}
                        </div>
                        <p className={`text-xs ${
                          log.level === "error" ? "text-red-400"
                          : log.level === "warn" ? "text-amber-400"
                          : isProgress ? "text-cyan-300"
                          : "text-[#E6EDF3]"
                        }`}>
                          <ExpandableJson value={log.message} />
                          {isProgress && step != null && total != null && (
                            <span className="ml-2 text-[10px] text-cyan-400/60 font-mono">({step}/{total})</span>
                          )}
                        </p>
                        {hasPricing && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#00B4D8]/15 border border-[#00B4D8]/35 text-[#00B4D8]">
                              💲 {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(pricingTotal!)}
                            </span>
                            {pricingLines != null && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-[#1C2128] border border-[#30363D] text-[#7D8590]">
                                {pricingLines} line{pricingLines !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Payload tab ── */}
        {activeTab === "payload" && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {run.nodeOutputs.length === 0 ? (
                <p className="text-[#7D8590] text-sm">No node outputs recorded.</p>
              ) : (
                run.nodeOutputs.map(output => {
                  const payloadGraphNode = graphNodeMap.get(output.nodeId);
                  const payloadNodeType  = (payloadGraphNode?.data?.nodeType as string) ?? payloadGraphNode?.type ?? "";
                  const isJoinPayload    = payloadNodeType === "join" || output.output.joined === true;
                  return (
                  <div key={output.id} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#E6EDF3] font-mono">{output.nodeId}</span>
                        {isJoinPayload && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                            join
                          </span>
                        )}
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${
                          output.status === "ok" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : output.status === "error" ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : "bg-[#30363D] text-[#7D8590] border-[#30363D]"
                        }`}>
                          {output.status}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#484F58] font-mono">{fmtDuration(output.durationMs)}</span>
                    </div>

                    {/* Join node: show merge summary instead of diff */}
                    {isJoinPayload ? (
                      <JoinNodeSummary nodeId={output.nodeId} graph={run.graph} />
                    ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">Payload diff (input → output)</p>
                      <DiffViewer before={output.input} after={output.output} />
                      {typeof output.output.imageUploadWarning === "string" && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 mt-1">
                          <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <span className="text-[10px] text-amber-400 font-medium">{output.output.imageUploadWarning}</span>
                        </div>
                      )}
                      {output.output.parseError === true && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 mt-1">
                          <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <span className="text-[10px] text-amber-400 font-medium">JSON parse failed — output is a raw string, not a structured object. Downstream nodes expecting an object may behave unexpectedly.</span>
                        </div>
                      )}
                      {output.errorMessage && (
                        <p className="text-[10px] text-red-400 font-mono mt-1">Error: {output.errorMessage}</p>
                      )}
                      {/* Depth-limit abort: depth+maxDepth present but no child was created */}
                      {output.status === "error"
                        && typeof output.output.depth === "number"
                        && typeof output.output.maxDepth === "number"
                        && typeof output.output.childRunId !== "number" && (
                        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 mt-1">
                          <svg className="w-3 h-3 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-red-400 font-semibold">Depth limit reached</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                                {output.output.depth as number} / {output.output.maxDepth as number}
                              </span>
                            </div>
                            <p className="text-[10px] text-red-400/80 leading-snug">
                              Increase the sub-workflow's Max Run Depth setting or break the chain into separate triggers to avoid this limit.
                            </p>
                          </div>
                        </div>
                      )}
                      {typeof output.output.childRunId === "number" && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-[10px] font-semibold text-[#3B82F6] uppercase tracking-wider">Sub-workflow</p>
                            {typeof output.output.depth === "number" && typeof output.output.maxDepth === "number" && (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
                                (output.output.depth as number) >= (output.output.maxDepth as number)
                                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                                  : (output.output.depth as number) >= (output.output.maxDepth as number) - 1
                                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                  : "bg-[#1C2128] text-[#7D8590] border-[#30363D]"
                              }`}>
                                Depth: {output.output.depth as number} / {output.output.maxDepth as number}
                              </span>
                            )}
                          </div>
                          {output.status === "error" && typeof output.output.depth === "number" && typeof output.output.maxDepth === "number" && (
                            <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 mb-2">
                              <svg className="w-3 h-3 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              <span className="text-[10px] text-red-400 font-medium leading-snug">
                                Depth limit reached ({output.output.depth as number} / {output.output.maxDepth as number}). Increase the sub-workflow's Max Run Depth setting or break the chain into separate triggers.
                              </span>
                            </div>
                          )}
                          <ChildRunInline
                            childRunId={output.output.childRunId as number}
                            depthValue={typeof output.output.depth === "number" ? (output.output.depth as number) : undefined}
                            maxDepthValue={typeof output.output.maxDepth === "number" ? (output.output.maxDepth as number) : undefined}
                          />
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
