import { useState, useCallback, useEffect, useRef } from "react";
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
  Handle,
  Position,
  type NodeProps,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useRoute } from "wouter";

// ── Node type colours ─────────────────────────────────────────────────────────

const NODE_STYLES: Record<string, { bg: string; border: string; icon: string; label: string }> = {
  start:     { bg: "#0F2A1A", border: "#22C55E",  icon: "▶",  label: "Start"      },
  end:       { bg: "#1A1A2E", border: "#6366F1",  icon: "⏹",  label: "End"        },
  action:    { bg: "#0D1A2E", border: "#0078D4",  icon: "⚡", label: "Action"     },
  condition: { bg: "#1A1300", border: "#F59E0B",  icon: "◆",  label: "Condition"  },
  delay:     { bg: "#1A0D2E", border: "#A855F7",  icon: "⏱",  label: "Delay"      },
  error:     { bg: "#1A0D0D", border: "#EF4444",  icon: "⚠",  label: "Error"      },
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
      ) : (
        <>
          <Handle type="source" position={Position.Bottom} style={{ background: style.border, border: "none" }} />
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
      { type: "start",     label: "Start",     description: "Workflow entry point",    tags: ["core", "flow"] },
      { type: "end",       label: "End",       description: "Workflow exit point",     tags: ["core", "flow"] },
    ],
  },
  {
    name: "Logic",
    nodes: [
      { type: "condition", label: "Condition", description: "Branch on expression",   tags: ["logic", "branch", "if"] },
    ],
  },
  {
    name: "Control",
    nodes: [
      { type: "delay",     label: "Delay",     description: "Wait / poll condition",  tags: ["control", "wait", "pause"] },
      { type: "error",     label: "Error",     description: "Catch-all error handler",tags: ["control", "error", "catch"] },
    ],
  },
  {
    name: "Action",
    nodes: [
      { type: "action",    label: "Action",    description: "HTTP, SQL, email, SMS",  tags: ["action", "http", "sql", "email"] },
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

// ── Config panel ──────────────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onChange,
  onClose,
}: {
  node: { id: string; data: Record<string, unknown> };
  onChange: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const nodeType = (node.data.nodeType as string) ?? "action";
  const style = NODE_STYLES[nodeType] ?? NODE_STYLES.action;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-72 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-y-auto z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <span style={{ color: style.border, fontSize: 16 }}>{style.icon}</span>
          <span className="text-sm font-semibold text-[#E6EDF3]">{nodeType.charAt(0).toUpperCase() + nodeType.slice(1)} Node</span>
        </div>
        <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        <ConfigField
          label="Label"
          value={(node.data.label as string) ?? ""}
          onChange={v => onChange(node.id, { ...node.data, label: v })}
        />
        <ConfigField
          label="Description"
          value={(node.data.description as string) ?? ""}
          onChange={v => onChange(node.id, { ...node.data, description: v })}
          multiline
        />

        {nodeType === "action" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7D8590]">Action Type</label>
              <select
                value={(node.data.actionType as string) ?? "http_request"}
                onChange={e => onChange(node.id, { ...node.data, actionType: e.target.value })}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
              >
                <option value="http_request">HTTP Request</option>
                <option value="sql_query">SQL Query</option>
                <option value="send_email">Send Email</option>
                <option value="send_sms">Send SMS</option>
                <option value="emit_event">Emit Event</option>
                <option value="cancel_workflow">Cancel Workflow</option>
              </select>
            </div>
            {(node.data.actionType as string) === "http_request" && (
              <ConfigField
                label="URL"
                value={(node.data.params as Record<string, string>)?.url ?? ""}
                onChange={v => onChange(node.id, { ...node.data, params: { ...(node.data.params as Record<string, unknown> ?? {}), url: v } })}
                placeholder="https://…"
              />
            )}
          </>
        )}

        {nodeType === "condition" && (
          <>
            <ConfigField
              label="Expression"
              value={(node.data.expression as string) ?? ""}
              onChange={v => onChange(node.id, { ...node.data, expression: v })}
              placeholder="status == 'active' && count > 0"
              multiline
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

// ── Main builder ──────────────────────────────────────────────────────────────

export default function WorkflowBuilderPage({ defId, versionId }: { defId: number; versionId?: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [publishLabel, setPublishLabel] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [currentVersionId, setCurrentVersionId] = useState<number | null>(versionId ?? null);

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

  const { data: def } = useQuery({
    queryKey: ["wf-def", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}`);
      return res.json();
    },
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["wf-versions", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions`);
      return res.json() as Promise<Array<{ id: number; versionNumber: number; label: string; status: string; graph: { nodes: unknown[]; edges: unknown[] } }>>;
    },
  });

  const { data: currentVersion } = useQuery({
    queryKey: ["wf-version", currentVersionId],
    enabled: currentVersionId != null,
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/versions/${currentVersionId}`);
      return res.json() as Promise<{ id: number; versionNumber: number; label: string | null; status: string; graph: { nodes: unknown[]; edges: unknown[] } }>;
    },
  });

  useEffect(() => {
    if (!currentVersion?.graph) return;
    const g = currentVersion.graph;
    setNodes((g.nodes as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>).map(n => ({
      id: n.id,
      type: "wfNode",
      position: n.position,
      data: { ...n.data, nodeType: n.data.nodeType ?? n.type },
    })));
    setEdges((g.edges as Array<{ id: string; source: string; target: string; sourceHandle?: string }>).map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      style: { stroke: "#30363D", strokeWidth: 2 },
      animated: false,
    })));
  }, [currentVersion, setNodes, setEdges]);

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

  const runMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("No published version — publish first");
      return res.json() as Promise<{ runId: number }>;
    },
    onSuccess: (data) => {
      navigate(`/workflows/runs/${data.runId}`);
    },
  });

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, style: { stroke: "#30363D", strokeWidth: 2 } }, eds));
  }, [setEdges]);

  const canvasRef = useRef<HTMLDivElement>(null);

  function addNode(nodeType: string, position?: { x: number; y: number }) {
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
  }

  function handleCanvasDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData("application/workflow-node-type");
    if (!nodeType) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds) {
      // approximate canvas-space coordinates (correct at default zoom=1, pan=0)
      addNode(nodeType, { x: e.clientX - bounds.left - 72, y: e.clientY - bounds.top - 20 });
    } else {
      addNode(nodeType);
    }
  }

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  function updateNodeData(id: string, data: Record<string, unknown>) {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data } : n));
  }

  const isPublished = currentVersion?.status === "published";
  const isArchived  = currentVersion?.status === "archived";
  const isDraft     = currentVersion?.status === "draft";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-[#161B22] border-b border-[#30363D] gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/workflows/list")}
            className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors flex-shrink-0"
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
          <button
            onClick={() => setShowVersionHistory(v => !v)}
            className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] hover:border-[#484F58] rounded-lg transition-colors"
          >
            History ({versions.length})
          </button>

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
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {runMut.isPending ? "Starting…" : "Run Now"}
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

      {runMut.isError && (
        <div className="flex-shrink-0 bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-xs text-red-400">
          {(runMut.error as Error).message}
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
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
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
          />
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
              <button
                key={v.id}
                onClick={() => { setCurrentVersionId(v.id); setShowVersionHistory(false); }}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${v.id === currentVersionId ? "bg-[#0078D4]/10 border-[#0078D4]/30 text-[#0078D4]" : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"}`}
              >
                <p className="text-xs font-semibold">{v.label ?? `v${v.versionNumber}`}</p>
                <p className="text-[10px] mt-0.5 capitalize">{v.status}</p>
              </button>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
