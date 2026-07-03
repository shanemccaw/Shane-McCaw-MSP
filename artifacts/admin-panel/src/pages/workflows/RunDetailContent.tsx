import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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
  logs: Array<{ id: number; nodeId: string; level: string; message: string; timestamp: string }>;
  nodeOutputs: Array<{ id: number; nodeId: string; input: Record<string, unknown>; output: Record<string, unknown>; durationMs: number | null; status: string; errorMessage: string | null; timestamp: string }>;
}

export const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:   "bg-blue-500/20 text-blue-300 border-blue-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
};

const NODE_BORDER: Record<string, string> = {
  start:     "#22C55E",
  end:       "#6366F1",
  action:    "#0078D4",
  condition: "#F59E0B",
  delay:     "#A855F7",
  error:     "#EF4444",
};

// ── Replay node ───────────────────────────────────────────────────────────────

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

// ── JSON diff viewer ───────────────────────────────────────────────────────────

export function DiffViewer({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  if (allKeys.length === 0) {
    return <p className="text-[10px] text-[#484F58] font-mono italic">empty</p>;
  }
  return (
    <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 font-mono text-[10px] overflow-auto max-h-52 space-y-0.5">
      {allKeys.map(key => {
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
          <div key={key} className={`flex gap-1 px-1 py-0.5 rounded ${rowCls}`}>
            <span className="text-[#484F58] w-4 shrink-0">{prefix}</span>
            <span className={`${keyCls} shrink-0`}>{key}:</span>
            {changed ? (
              <span className={valCls}>
                <span className="line-through text-red-400 mr-1">{bVal}</span>
                {aVal}
              </span>
            ) : (
              <span className={valCls}>{removed ? bVal : aVal}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function JsonBlock({ data, label }: { data: Record<string, unknown>; label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider">{label}</p>
      <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-[10px] font-mono text-[#E6EDF3] overflow-auto max-h-40 whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
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

  const replayNodes = run.graph?.nodes.map(n => {
    const nodeIdx = branchPath.indexOf(n.id);
    const inPath = nodeIdx !== -1 && nodeIdx <= replayStep;
    const isCurrent = n.id === currentNodeId;
    const isSkipped = nodeIdx === -1 && branchPath.length > 0;
    const nodeOutput = run.nodeOutputs.find(o => o.nodeId === n.id);
    const hasError = nodeOutput?.status === "error";
    const isMutated = !hasError && nodeOutput != null
      && Object.keys(nodeOutput.output).length > 0
      && JSON.stringify(nodeOutput.input) !== JSON.stringify(nodeOutput.output);
    return {
      id: n.id,
      type: "replayNode",
      position: n.position,
      data: {
        ...n.data,
        nodeType: n.data.nodeType ?? n.type,
        inPath,
        isCurrent,
        isSkipped,
        hasError,
        isMutated,
      },
    };
  }) ?? [];

  const replayEdges = run.graph?.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    style: { stroke: "#30363D", strokeWidth: 1.5 },
  })) ?? [];

  const currentOutput = run.nodeOutputs.find(o => o.nodeId === currentNodeId);

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
                  <div className="flex-1 bg-[#0D1117]">
                    <ReactFlow
                      nodes={replayNodes}
                      edges={replayEdges}
                      nodeTypes={replayNodeTypes}
                      fitView
                      proOptions={{ hideAttribution: true }}
                      style={{ background: "#0D1117" }}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable={false}
                    >
                      <Background color="#1C2128" gap={24} size={1} />
                      <Controls style={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} />
                    </ReactFlow>
                  </div>

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
                  {run.logs.map(log => (
                    <div key={log.id} className="relative">
                      <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full border-2 border-[#0D1117]" style={{
                        background: log.level === "error" ? "#EF4444" : log.level === "warn" ? "#F59E0B" : "#0078D4",
                      }} />
                      <div className="text-[10px] text-[#484F58] font-mono mb-0.5">
                        {format(new Date(log.timestamp), "HH:mm:ss.SSS")} · {log.nodeId}
                      </div>
                      <p className={`text-xs ${log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-400" : "text-[#E6EDF3]"}`}>
                        {log.message}
                      </p>
                    </div>
                  ))}
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
