import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import PortalRetainerDetail from "./PortalRetainerDetail";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  projectType: string;
}

interface WorkflowStep {
  id: number;
  title: string;
  description: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
  dueDate: string | null;
  order: number;
}

interface KanbanTask {
  id: number;
  title: string;
  description: string | null;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  order: number;
  assignedTo: string | null;
  dueDate: string | null;
  workflowStepId: number | null;
  groupName: string | null;
}

interface Document {
  id: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface Update {
  id: number;
  content: string;
  type: string;
  createdAt: string;
}

interface PreviewTask {
  stepId: number;
  title: string;
  groupName: string | null;
  description: string | null;
}

interface ProjectDetailData {
  project: Project;
  steps: WorkflowStep[];
  tasks: KanbanTask[];
  previewTasks: PreviewTask[];
  documents: Document[];
  updates: Update[];
}

type SecondaryTab = "kanban" | "documents" | "updates";

const KANBAN_COLUMNS = [
  { key: "backlog" as const, label: "Backlog", color: "border-gray-200 bg-gray-50" },
  { key: "in_progress" as const, label: "In Progress", color: "border-blue-200 bg-blue-50" },
  { key: "waiting_on_customer" as const, label: "Waiting on You", color: "border-yellow-200 bg-yellow-50" },
  { key: "completed" as const, label: "Completed", color: "border-green-200 bg-green-50" },
];

const UPDATE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  milestone: {
    color: "bg-[#0078D4] border-[#0078D4]",
    icon: <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>,
  },
  update: {
    color: "bg-white border-border",
    icon: <svg className="w-3.5 h-3.5 text-[#0078D4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  },
  file: {
    color: "bg-teal-500 border-teal-500",
    icon: <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  },
  message: {
    color: "bg-purple-500 border-purple-500",
    icon: <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>,
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRefNumber(id: number): string {
  const year = new Date().getFullYear();
  return `SMC-${year}-${String(id).padStart(3, "0")}`;
}

function stepPercent(status: string): number {
  if (status === "completed") return 100;
  if (status === "in_progress") return 50;
  return 0;
}

function SortableTaskCard({ task }: { task: KanbanTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-white rounded-lg border border-border p-3 shadow-sm cursor-grab active:cursor-grabbing hover:border-[#0078D4]/30 transition-colors select-none"
    >
      <p className="text-sm font-medium text-[#0A2540] leading-snug">{task.title}</p>
      {task.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.assignedTo && (
          <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] px-2 py-0.5 rounded-full font-medium">{task.assignedTo}</span>
        )}
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">Due {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        )}
      </div>
    </div>
  );
}

function TaskCardOverlay({ task }: { task: KanbanTask }) {
  return (
    <div className="bg-white rounded-lg border border-[#0078D4] p-3 shadow-xl opacity-90">
      <p className="text-sm font-medium text-[#0A2540]">{task.title}</p>
    </div>
  );
}

function DocumentUpload({ projectId, onUploaded, fetchWithAuth }: {
  projectId: number;
  onUploaded: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json() as { error: string };
        setError(data.error ?? "Upload failed");
      } else {
        setFile(null);
        setName("");
        onUploaded();
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleUpload} className="bg-white border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-semibold text-[#0A2540] mb-1">Upload Document</label>
        <input
          type="file"
          required
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none file:mr-3 file:text-xs file:font-semibold file:bg-[#0078D4] file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer"
        />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="block text-xs font-semibold text-[#0A2540] mb-1">Display Name <span className="font-normal text-muted-foreground">(optional)</span></label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Project Proposal"
          className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
        />
      </div>
      <div className="flex flex-col gap-1">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!file || uploading}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
}

function CheckCircleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    active: { label: "IN PROGRESS", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
    on_hold: { label: "ON HOLD", cls: "bg-yellow-100 text-yellow-700 border border-yellow-200" },
    completed: { label: "COMPLETED", cls: "bg-green-100 text-green-700 border border-green-200" },
    cancelled: { label: "CANCELLED", cls: "bg-red-100 text-red-600 border border-red-200" },
  };
  const c = cfg[status] ?? { label: status.replace("_", " ").toUpperCase(), cls: "bg-gray-100 text-gray-600 border border-gray-200" };
  return (
    <span className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-md ${c.cls}`}>{c.label}</span>
  );
}

function GradientProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-white/10 rounded-full h-2.5">
      <div
        className="h-2.5 rounded-full transition-all"
        style={{
          width: `${Math.min(100, value)}%`,
          background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)",
        }}
      />
    </div>
  );
}

function StepProgressBar({ value }: { value: number }) {
  return (
    <div className="w-16 bg-gray-200 rounded-full h-1.5 flex-shrink-0">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{
          width: `${value}%`,
          background: value === 100 ? "#16a34a" : value > 0 ? "#0078D4" : "#d1d5db",
        }}
      />
    </div>
  );
}

export default function PortalProjectDetail() {
  const params = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<number | null>(null);
  const [showAllPhases, setShowAllPhases] = useState(false);
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const [exportingAudit, setExportingAudit] = useState(false);

  const loadProject = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    fetchWithAuth(`/api/portal/projects/${params.id}`)
      .then(r => r.json())
      .then(d => {
        const detail = d as ProjectDetailData;
        setData(detail);
        const firstInProgress = detail.steps.find(s => s.status === "in_progress");
        if (firstInProgress) setExpandedStepId(firstInProgress.id);
        else if (detail.steps.length > 0) setExpandedStepId(detail.steps[0].id);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth, params.id]);

  const handleExportAudit = async () => {
    if (!params.id || exportingAudit) return;
    setExportingAudit(true);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${params.id}/audit-pdf`);
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "Failed to generate audit PDF. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const year = new Date().getFullYear();
      const refNum = `SMC-${year}-${String(params.id).padStart(3, "0")}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${refNum}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingAudit(false);
    }
  };

  useEffect(() => { loadProject(); }, [loadProject]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const task = data?.tasks.find(t => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || !data) return;
    const draggedTask = data.tasks.find(t => t.id === active.id);
    if (!draggedTask) return;
    const targetColumn = KANBAN_COLUMNS.find(c => c.key === over.id)?.key
      ?? data.tasks.find(t => t.id === over.id)?.column;
    if (!targetColumn || targetColumn === draggedTask.column) return;
    setData(prev => prev ? {
      ...prev,
      tasks: prev.tasks.map(t => t.id === draggedTask.id ? { ...t, column: targetColumn } : t),
    } : null);
    await fetchWithAuth(`/api/portal/kanban-tasks/${draggedTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: targetColumn }),
    });
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-96">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  if (!data) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-muted-foreground">Project not found.</div>
      </PortalLayout>
    );
  }

  const { project, steps, tasks, documents, updates } = data;

  // Retainer engagements get an executive dashboard view
  if (project.projectType === "retainer") {
    return (
      <PortalLayout>
        <PortalRetainerDetail data={data} projectId={params.id ?? ""} fetchWithAuth={fetchWithAuth} />
      </PortalLayout>
    );
  }

  const nextMilestone = steps.find(s => s.status !== "completed");
  const latestUpdate = updates[0] ?? null;
  const PHASE_LIMIT = 4;
  const visibleSteps = showAllPhases ? steps : steps.slice(0, PHASE_LIMIT);
  const hiddenCount = steps.length - PHASE_LIMIT;

  const secondaryTabs: { key: SecondaryTab; label: string; count?: number }[] = [
    { key: "kanban", label: "Kanban Board" },
    { key: "documents", label: "Documents", count: documents.length },
    { key: "updates", label: "Updates", count: updates.length },
  ];

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/projects"><span className="hover:text-[#0078D4] cursor-pointer">Projects</span></Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium truncate">{project.title}</span>
        </nav>

        {/* ── Project Header ── */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <StatusBadge status={project.status} />
                <span className="text-xs font-mono text-muted-foreground tracking-wider">
                  REF: {formatRefNumber(project.id)}
                </span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#0A2540] leading-tight mb-1">{project.title}</h1>
              {project.description && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{project.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2.5 flex-shrink-0 sm:pt-1">
              <button
                onClick={() => void handleExportAudit()}
                disabled={exportingAudit}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-[#0A2540] text-[#0A2540] hover:bg-[#0A2540]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {exportingAudit ? (
                  <div className="w-4 h-4 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {exportingAudit ? "Exporting…" : "Export Audit"}
              </button>
              <button className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0A2540] text-white hover:bg-[#0A2540]/90 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Access
              </button>
            </div>
          </div>
        </div>

        {/* ── Secondary Tab Bar ── */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button
            onClick={() => setSecondaryTab(null)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              secondaryTab === null
                ? "border-[#0A2540] text-[#0A2540]"
                : "border-transparent text-muted-foreground hover:text-[#0A2540]"
            }`}
          >
            Workflow Explorer
          </button>
          {secondaryTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setSecondaryTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                secondaryTab === t.key
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-muted-foreground hover:text-[#0A2540]"
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 text-xs bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded-full">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Workflow Explorer (default view) ── */}
        {secondaryTab === null && (
          <div className="grid grid-cols-12 gap-6 items-start">
            {/* Left: Workflow Explorer */}
            <div className="col-span-12 lg:col-span-8 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-bold text-[#0A2540] tracking-tight">Workflow Explorer</h2>
                <span className="text-xs text-muted-foreground">{steps.filter(s => s.status === "completed").length}/{steps.length} phases complete</span>
              </div>

              {steps.length === 0 ? (
                <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
                  No workflow steps defined yet.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    {visibleSteps.map((step, idx) => {
                      const isCompleted = step.status === "completed";
                      const isInProgress = step.status === "in_progress";
                      const isExpanded = expandedStepId === step.id;
                      const isFirstInProgress = isInProgress && !steps.slice(0, idx).some(s => s.status === "in_progress");

                      const prevAllComplete = steps.slice(0, idx).every(s => s.status === "completed");
                      const isLocked = step.status === "pending" && !prevAllComplete;

                      return (
                        <div
                          key={step.id}
                          className={`rounded-xl border overflow-hidden transition-all ${
                            isFirstInProgress
                              ? "border-2 border-[#0A2540] shadow-md"
                              : isCompleted
                              ? "border border-border opacity-60"
                              : "border border-border"
                          }`}
                        >
                          {/* Phase row header */}
                          <button
                            onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                              isFirstInProgress
                                ? "bg-[#0A2540] text-white"
                                : isCompleted
                                ? "bg-gray-50 text-muted-foreground"
                                : "bg-white text-[#0A2540] hover:bg-gray-50"
                            }`}
                          >
                            {/* Status icon */}
                            <span className={`flex-shrink-0 ${isCompleted ? "text-green-500" : isFirstInProgress ? "text-white/70" : "text-muted-foreground"}`}>
                              {isCompleted ? (
                                <CheckCircleIcon />
                              ) : isLocked ? (
                                <LockIcon />
                              ) : (
                                <CircleIcon />
                              )}
                            </span>

                            {/* Phase number + title */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[10px] font-bold uppercase tracking-widest ${isFirstInProgress ? "text-white/50" : "text-muted-foreground"}`}>
                                  Phase {idx + 1}
                                </span>
                                {isFirstInProgress && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide bg-white/20 text-white px-2 py-0.5 rounded">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className={`text-sm font-semibold leading-tight ${isCompleted ? "line-through" : ""}`}>
                                {step.title}
                              </p>
                            </div>

                            {/* Completion date or status */}
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {isCompleted && step.completedAt && (
                                <span className="text-xs hidden sm:block">
                                  {new Date(step.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </span>
                              )}
                              {!isCompleted && (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full hidden sm:block ${
                                  isInProgress ? (isFirstInProgress ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700") :
                                  isLocked ? "bg-gray-100 text-gray-500" :
                                  "bg-gray-100 text-gray-500"
                                }`}>
                                  {isInProgress ? "In Progress" : isLocked ? "Locked" : "Pending"}
                                </span>
                              )}
                              <span className={isFirstInProgress ? "text-white/60" : "text-muted-foreground"}>
                                <ChevronIcon open={isExpanded} />
                              </span>
                            </div>
                          </button>

                          {/* Expanded phase content */}
                          {isExpanded && (() => {
                            const stepTasks = data.tasks.filter(t => t.workflowStepId === step.id);
                            const stepPreviewTasks = data.previewTasks?.filter(t => t.stepId === step.id) ?? [];
                            const isPreviewOnly = stepTasks.length === 0 && stepPreviewTasks.length > 0;

                            // Group live kanban tasks by groupName
                            const groups: Record<string, KanbanTask[]> = {};
                            for (const t of stepTasks) {
                              const g = t.groupName ?? "Tasks";
                              if (!groups[g]) groups[g] = [];
                              groups[g].push(t);
                            }

                            // Group preview tasks by groupName
                            const previewGroups: Record<string, PreviewTask[]> = {};
                            for (const t of stepPreviewTasks) {
                              const g = t.groupName ?? "Tasks";
                              if (!previewGroups[g]) previewGroups[g] = [];
                              previewGroups[g].push(t);
                            }

                            return (
                              <div className="bg-white border-t border-border px-5 py-4 space-y-4">
                                {step.description && (
                                  <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                                )}

                                {/* Preview tasks (phase not yet active — show planned state) */}
                                {isPreviewOnly && (
                                  <>
                                    <p className="text-[10px] font-semibold text-[#0078D4] uppercase tracking-wide">
                                      Planned tasks — will activate when this phase begins
                                    </p>
                                    {Object.entries(previewGroups).map(([group, pts]) => (
                                      <div key={group}>
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group}</p>
                                        <div className="space-y-2">
                                          {pts.map((pt, tidx) => (
                                            <div key={tidx} className="flex items-start gap-3 py-2.5 border border-dashed border-border rounded-xl px-4 bg-gray-50/60">
                                              <div className="w-4 h-4 rounded border-2 border-gray-200 flex-shrink-0 mt-0.5" />
                                              <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-muted-foreground leading-snug">{pt.title}</p>
                                                {pt.description && (
                                                  <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">{pt.description}</p>
                                                )}
                                              </div>
                                              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 bg-gray-100 text-gray-400">
                                                Planned
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </>
                                )}

                                {/* Live kanban tasks (phase active or completed) */}
                                {!isPreviewOnly && (
                                  <>
                                    {stepTasks.length === 0 ? (
                                      <p className="text-xs text-muted-foreground italic">No tasks defined for this phase.</p>
                                    ) : (
                                      Object.entries(groups).map(([group, kts]) => (
                                        <div key={group}>
                                          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{group}</p>
                                          <div className="space-y-2">
                                            {kts.map(kt => {
                                              const taskDone = kt.column === "completed";
                                              return (
                                                <div key={kt.id} className="flex items-start gap-3 py-2.5 border border-border rounded-xl px-4 bg-[#F7F9FC]">
                                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${taskDone ? "bg-green-500 border-green-500" : "border-gray-300"}`}>
                                                    {taskDone && (
                                                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                                                      </svg>
                                                    )}
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                    <p className={`text-sm font-medium leading-snug ${taskDone ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{kt.title}</p>
                                                    {kt.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{kt.description}</p>}
                                                    {kt.assignedTo && <p className="text-[10px] text-muted-foreground mt-0.5">{kt.assignedTo}</p>}
                                                  </div>
                                                  {!taskDone && (
                                                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${kt.column === "in_progress" ? "bg-blue-100 text-blue-700" : kt.column === "waiting_on_customer" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                                                      {kt.column === "in_progress" ? "In Progress" : kt.column === "waiting_on_customer" ? "Waiting" : "Backlog"}
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </>
                                )}
                                {step.notes && (
                                  <p className="text-xs text-[#0078D4] italic">Note: {step.notes}</p>
                                )}
                                {step.dueDate && (
                                  <p className="text-xs text-muted-foreground">
                                    Due: {new Date(step.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>

                  {/* Show remaining phases button */}
                  {!showAllPhases && hiddenCount > 0 && (
                    <button
                      onClick={() => setShowAllPhases(true)}
                      className="w-full py-3 text-sm font-semibold text-muted-foreground border border-dashed border-border rounded-xl hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors bg-white"
                    >
                      Show Remaining {hiddenCount} Phase{hiddenCount !== 1 ? "s" : ""}
                    </button>
                  )}
                  {showAllPhases && steps.length > PHASE_LIMIT && (
                    <button
                      onClick={() => setShowAllPhases(false)}
                      className="w-full py-3 text-sm font-semibold text-muted-foreground border border-dashed border-border rounded-xl hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors bg-white"
                    >
                      Collapse Phases
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Right: Sidebar */}
            <div className="col-span-12 lg:col-span-4 space-y-4">
              {/* Phase Completion Card */}
              <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Phase Completion</h3>

                {/* Overall progress */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[#0A2540]">Overall Progress</span>
                    <span className="text-lg font-extrabold text-[#0078D4]">{project.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, project.progress)}%`,
                        background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)",
                      }}
                    />
                  </div>
                </div>

                {/* Per-step rows */}
                {steps.length > 0 && (
                  <div className="space-y-2.5 border-t border-border pt-3">
                    {steps.map(s => {
                      const pct = stepPercent(s.status);
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <p className="text-xs text-[#0A2540] flex-1 truncate font-medium">{s.title}</p>
                          <StepProgressBar value={pct} />
                          <span className={`text-xs font-bold w-8 text-right flex-shrink-0 ${
                            pct === 100 ? "text-green-600" : pct > 0 ? "text-[#0078D4]" : "text-gray-400"
                          }`}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Next Milestone Card */}
              <div className="bg-[#0A2540] rounded-2xl p-5 shadow-sm">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3">Next Milestone</h3>
                {nextMilestone ? (
                  <>
                    <p className="text-white font-bold text-base leading-snug mb-1">{nextMilestone.title}</p>
                    {nextMilestone.dueDate ? (
                      <p className="text-white/50 text-xs mb-4">
                        Target: {new Date(nextMilestone.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </p>
                    ) : project.endDate ? (
                      <p className="text-white/50 text-xs mb-4">
                        Target: {new Date(project.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </p>
                    ) : (
                      <p className="text-white/30 text-xs mb-4">No target date set</p>
                    )}
                    <button className="flex items-center gap-2 text-xs font-semibold text-white/70 border border-white/20 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Add to Calendar
                    </button>
                  </>
                ) : (
                  <p className="text-white/50 text-sm">All phases complete — great work!</p>
                )}
              </div>

              {/* Consultant Message Card */}
              <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Consultant Message</h3>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">SM</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#0A2540]">Shane McCaw</p>
                    <p className="text-xs text-muted-foreground">Lead Consultant</p>
                  </div>
                </div>
                {latestUpdate ? (
                  <blockquote className="text-sm text-[#0A2540] italic leading-relaxed border-l-2 border-[#0078D4] pl-3">
                    "{latestUpdate.content}"
                  </blockquote>
                ) : (
                  <blockquote className="text-sm text-muted-foreground italic leading-relaxed border-l-2 border-border pl-3">
                    "No updates posted yet. Your consultant will share progress notes here as the project moves forward."
                  </blockquote>
                )}
                {latestUpdate && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(latestUpdate.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Kanban Board ── */}
        {secondaryTab === "kanban" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">Drag cards between columns to update task status.</p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {KANBAN_COLUMNS.map(col => {
                  const colTasks = tasks.filter(t => t.column === col.key);
                  return (
                    <div key={col.key} id={col.key} className={`rounded-xl border p-3 min-h-[300px] ${col.color}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{col.label}</h3>
                        <span className="text-xs bg-white/60 text-muted-foreground font-semibold px-2 py-0.5 rounded-full">{colTasks.length}</span>
                      </div>
                      <SortableContext items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {colTasks.map(task => <SortableTaskCard key={task.id} task={task} />)}
                        </div>
                      </SortableContext>
                    </div>
                  );
                })}
              </div>
              <DragOverlay>
                {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
              </DragOverlay>
            </DndContext>
          </div>
        )}

        {/* ── Documents ── */}
        {secondaryTab === "documents" && (
          <div className="space-y-4">
            <DocumentUpload projectId={Number(params.id)} onUploaded={loadProject} fetchWithAuth={fetchWithAuth} />
            <div className="bg-white border border-border rounded-xl divide-y divide-border">
              {documents.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No documents uploaded yet.</div>
              ) : documents.map(doc => (
                <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0A2540] truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {doc.sizeBytes ? formatBytes(doc.sizeBytes) : ""}{doc.mimeType ? ` · ${doc.mimeType.split("/")[1]?.toUpperCase()}` : ""} · {new Date(doc.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const r = await fetchWithAuth(`/api/portal/documents/${doc.id}/download`);
                      const blob = await r.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = doc.name; a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Updates ── */}
        {secondaryTab === "updates" && (
          <div>
            {updates.length === 0 ? (
              <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">No updates yet.</div>
            ) : (
              <div className="relative">
                <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-border" />
                <div className="space-y-6 pl-10">
                  {updates.map(u => {
                    const config = UPDATE_TYPE_CONFIG[u.type] ?? UPDATE_TYPE_CONFIG.update;
                    return (
                      <div key={u.id} className="relative">
                        <div className={`absolute -left-[29px] w-6 h-6 rounded-full border flex items-center justify-center ${config.color}`}>
                          {config.icon}
                        </div>
                        <div className="bg-white border border-border rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-semibold text-[#0078D4] capitalize">{u.type}</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                          </div>
                          <p className="text-sm text-[#0A2540] leading-relaxed">{u.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
