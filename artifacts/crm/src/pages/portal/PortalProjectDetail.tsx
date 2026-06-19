import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
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
}

interface WorkflowStep {
  id: number;
  title: string;
  description: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
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

interface ProjectDetailData {
  project: Project;
  steps: WorkflowStep[];
  tasks: KanbanTask[];
  documents: Document[];
  updates: Update[];
}

type TabKey = "overview" | "kanban" | "workflow" | "documents" | "comms";

const STEP_STATUS_CONFIG: Record<string, { label: string; classes: string; icon: React.ReactNode }> = {
  completed: {
    label: "Completed",
    classes: "text-green-700 bg-green-100",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
  },
  in_progress: {
    label: "In Progress",
    classes: "text-blue-700 bg-blue-100",
    icon: <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  },
  blocked: {
    label: "Blocked",
    classes: "text-red-700 bg-red-100",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>,
  },
  pending: {
    label: "Pending",
    classes: "text-gray-500 bg-gray-100",
    icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" /></svg>,
  },
};

const KANBAN_COLUMNS = [
  { key: "backlog" as const, label: "Backlog", color: "border-gray-200 bg-gray-50" },
  { key: "in_progress" as const, label: "In Progress", color: "border-blue-200 bg-blue-50" },
  { key: "waiting_on_customer" as const, label: "Waiting on You", color: "border-yellow-200 bg-yellow-50" },
  { key: "completed" as const, label: "Completed", color: "border-green-200 bg-green-50" },
];

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

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#F7F9FC] rounded-full h-2">
      <div className="h-2 rounded-full bg-[#0078D4] transition-all" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

export default function PortalProjectDetail() {
  const params = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);

  const loadProject = useCallback(() => {
    if (!params.id) return;
    setLoading(true);
    fetchWithAuth(`/api/portal/projects/${params.id}`)
      .then(r => r.json())
      .then(d => setData(d as ProjectDetailData))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth, params.id]);

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

    // Optimistic update
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

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "kanban", label: "Kanban Board" },
    { key: "workflow", label: "Workflow" },
    { key: "documents", label: "Documents" },
    { key: "comms", label: "Updates" },
  ];

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
  const completedSteps = steps.filter(s => s.status === "completed").length;

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/projects"><span className="hover:text-[#0078D4] cursor-pointer">Projects</span></Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium truncate">{project.title}</span>
        </nav>

        {/* Project header */}
        <div className="bg-white border border-border rounded-xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="text-xl font-extrabold text-[#0A2540]">{project.title}</h1>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                  project.status === "active" ? "bg-green-100 text-green-700" :
                  project.status === "on_hold" ? "bg-yellow-100 text-yellow-700" :
                  "bg-blue-100 text-blue-700"
                }`}>{project.status.replace("_", " ")}</span>
              </div>
              {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {project.phase && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Current Phase</p>
                <p className="text-sm font-semibold text-[#0A2540]">{project.phase}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Workflow</p>
              <p className="text-sm font-semibold text-[#0A2540]">{completedSteps}/{steps.length} steps</p>
            </div>
            {project.startDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Start Date</p>
                <p className="text-sm font-semibold text-[#0A2540]">{new Date(project.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              </div>
            )}
            {project.endDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Target Date</p>
                <p className="text-sm font-semibold text-[#0A2540]">{new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Overall Progress</span>
              <span className="font-bold text-[#0078D4] text-sm">{project.progress}%</span>
            </div>
            <ProgressBar value={project.progress} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === t.key
                  ? "border-[#0078D4] text-[#0078D4]"
                  : "border-transparent text-muted-foreground hover:text-[#0A2540]"
              }`}
            >
              {t.label}
              {t.key === "documents" && documents.length > 0 && (
                <span className="ml-1.5 text-xs bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded-full">{documents.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent updates */}
            <div className="bg-white border border-border rounded-xl p-5">
              <h3 className="text-sm font-bold text-[#0A2540] mb-4">Recent Updates</h3>
              {updates.slice(0, 4).length === 0 ? (
                <p className="text-sm text-muted-foreground">No updates yet.</p>
              ) : (
                <div className="space-y-3">
                  {updates.slice(0, 4).map(u => (
                    <div key={u.id} className="flex gap-3">
                      <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 ${(UPDATE_TYPE_CONFIG[u.type] ?? UPDATE_TYPE_CONFIG.update).color}`}>
                        {(UPDATE_TYPE_CONFIG[u.type] ?? UPDATE_TYPE_CONFIG.update).icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-[#0A2540] leading-snug">{u.content}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Workflow summary */}
            <div className="bg-white border border-border rounded-xl p-5">
              <h3 className="text-sm font-bold text-[#0A2540] mb-4">Workflow Progress</h3>
              {steps.length === 0 ? <p className="text-sm text-muted-foreground">No steps defined yet.</p> : (
                <div className="space-y-2">
                  {steps.map(s => {
                    const config = STEP_STATUS_CONFIG[s.status] ?? STEP_STATUS_CONFIG.pending;
                    return (
                      <div key={s.id} className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${config.classes}`}>
                          {config.icon}
                        </div>
                        <p className={`text-sm flex-1 ${s.status === "completed" ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{s.title}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "kanban" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">Drag cards between columns to update task status.</p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto">
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

        {activeTab === "workflow" && (
          <div className="bg-white border border-border rounded-xl divide-y divide-border">
            {steps.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No workflow steps yet.</div>
            ) : steps.map((s, idx) => {
              const config = STEP_STATUS_CONFIG[s.status] ?? STEP_STATUS_CONFIG.pending;
              return (
                <div key={s.id} className="flex items-start gap-4 px-5 py-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.classes}`}>
                      {config.icon}
                    </div>
                    {idx < steps.length - 1 && (
                      <div className={`w-0.5 flex-1 mt-1 min-h-[20px] ${s.status === "completed" ? "bg-green-300" : "bg-border"}`} />
                    )}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className={`text-sm font-semibold ${s.status === "completed" ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>{s.title}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.classes}`}>{config.label}</span>
                    </div>
                    {s.description && <p className="text-sm text-muted-foreground mt-1">{s.description}</p>}
                    {s.notes && <p className="text-xs text-[#0078D4] mt-1.5 italic">Note: {s.notes}</p>}
                    {s.completedAt && (
                      <p className="text-xs text-muted-foreground mt-1">Completed {new Date(s.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "documents" && (
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

        {activeTab === "comms" && (
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
