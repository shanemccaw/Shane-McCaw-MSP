import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
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

// ── Vertical replay step card ──────────────────────────────────────────────────

function ReplayStepCard({
  nodeId,
  nodeType,
  label,
  isCurrent,
  inPath,
  isSkipped,
  hasError,
  isMutated,
  pricingTotal,
  pricingLines,
  onClick,
}: {
  nodeId: string;
  nodeType: string;
  label: string;
  isCurrent: boolean;
  inPath: boolean;
  isSkipped: boolean;
  hasError: boolean;
  isMutated: boolean;
  pricingTotal?: number;
  pricingLines?: number;
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
            <span className="text-[9px] text-[#484F58] bg-[#1C2128] border border-[#30363D] px-1.5 py-0.5 rounded-full">skipped</span>
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

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{label}</p>
      <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-[10px] font-mono text-[#E6EDF3] overflow-auto max-h-40 whitespace-pre-wrap">
        {JSON.stringify(displayData, null, 2)}
      </pre>
      {htmlContent !== null && <HtmlContentPreview html={htmlContent} />}
    </div>
  );
}

export function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

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

  // Build O(1) lookups — avoids O(n²) .find() inside render loops
  const nodeOutputMap = new Map(run.nodeOutputs.map(o => [o.nodeId, o]));
  const currentOutput = currentNodeId != null ? nodeOutputMap.get(currentNodeId) : undefined;

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
                      {branchPath.map((nodeId, idx) => {
                        const graphNode = graphNodeMap.get(nodeId);
                        const nodeType = (graphNode?.data?.nodeType as string) ?? graphNode?.type ?? "action";
                        const label = (graphNode?.data?.label as string) ?? nodeType;
                        const nodeIdx = idx;
                        const inPath = nodeIdx <= replayStep;
                        const isCurrent = nodeId === currentNodeId;
                        const nodeOutput = run.nodeOutputs.find(o => o.nodeId === nodeId);
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
                              onClick={() => setReplayStep(idx)}
                            />
                            {/* Connector line between cards */}
                            {idx < branchPath.length - 1 && (
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
                              return (
                                <ReplayStepCard
                                  key={nodeId}
                                  nodeId={nodeId}
                                  nodeType={nodeType}
                                  label={label}
                                  isCurrent={false}
                                  inPath={false}
                                  isSkipped={true}
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
                  {currentOutput && (
                    <div className="w-64 flex-shrink-0 bg-[#161B22] border-l border-[#30363D] overflow-y-auto p-3 space-y-3">
                      <p className="text-xs font-semibold text-[#E6EDF3]">
                        Step {replayStep + 1} / {branchPath.length}
                      </p>
                      <p className="text-[10px] text-[#484F58] font-mono break-all">{currentNodeId}</p>
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
                      <JsonBlock data={currentOutput.output} label="Output" />
                    </div>
                  )}
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
                run.nodeOutputs.map(output => (
                  <div key={output.id} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#E6EDF3] font-mono">{output.nodeId}</span>
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
