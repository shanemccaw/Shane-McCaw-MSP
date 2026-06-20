import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  clientUserId: number | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

interface WorkflowStep {
  id: number;
  title: string;
  status: string;
  order: number;
  description: string | null;
}

interface KanbanTask {
  id: number;
  title: string;
  column: string;
  assignedTo: string | null;
  order: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

const STEP_STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  in_progress: "bg-blue-100 text-blue-700",
  pending: "bg-gray-100 text-gray-600",
  blocked: "bg-red-100 text-red-700",
};

interface ProjectFormState {
  title: string;
  description: string;
  status: string;
  phase: string;
  progress: number;
  clientUserId: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: ProjectFormState = {
  title: "", description: "", status: "active", phase: "", progress: 0, clientUserId: "", startDate: "", endDate: "",
};

const COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_on_customer", label: "Waiting" },
  { key: "completed", label: "Done" },
] as const;

type ColumnKey = typeof COLUMNS[number]["key"];

function DraggableCard({ task, onDelete, projectId }: { task: KanbanTask; onDelete: (taskId: number, projectId: number) => void; projectId: number }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-[#F7F9FC] border border-border rounded p-2 text-xs select-none ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-1">
        <div
          {...listeners}
          {...attributes}
          className="mt-0.5 flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-[#0078D4] transition-colors"
          title="Drag to move"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[#0A2540]">{task.title}</p>
          {task.assignedTo && <p className="text-muted-foreground text-[10px] mt-0.5">{task.assignedTo}</p>}
          <button
            onClick={() => onDelete(task.id, projectId)}
            className="text-red-400 hover:text-red-600 text-[10px] font-semibold mt-1"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function CardOverlay({ task }: { task: KanbanTask }) {
  return (
    <div className="bg-[#F7F9FC] border border-[#0078D4] rounded p-2 text-xs shadow-lg rotate-1 opacity-90 w-48">
      <p className="font-medium text-[#0A2540]">{task.title}</p>
      {task.assignedTo && <p className="text-muted-foreground text-[10px] mt-0.5">{task.assignedTo}</p>}
    </div>
  );
}

function DroppableColumn({
  col,
  tasks,
  onDelete,
  projectId,
  isOver,
}: {
  col: { key: string; label: string };
  tasks: KanbanTask[];
  onDelete: (taskId: number, projectId: number) => void;
  projectId: number;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: col.key });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg p-3 transition-colors ${isOver ? "bg-blue-50 border-2 border-[#0078D4]/40" : "bg-white border border-border"}`}
    >
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
        {col.label}
        <span className="ml-1.5 text-[10px] font-normal">({tasks.length})</span>
      </p>
      <div className="space-y-1.5 min-h-[32px]">
        {tasks.map(task => (
          <DraggableCard key={task.id} task={task} onDelete={onDelete} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}

function KanbanBoard({
  projectId,
  tasks,
  onTasksChange,
  onDelete,
  fetchWithAuth,
  toast,
}: {
  projectId: number;
  tasks: KanbanTask[];
  onTasksChange: (projectId: number, updater: (tasks: KanbanTask[]) => KanbanTask[]) => void;
  onDelete: (taskId: number, projectId: number) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const [overColumnKey, setOverColumnKey] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const task = (event.active.data.current as { task: KanbanTask }).task;
    setActiveTask(task);
  };

  const handleDragOver = (event: { over: { id: string | number } | null }) => {
    setOverColumnKey(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    setOverColumnKey(null);
    const { active, over } = event;
    if (!over) return;

    const task = (active.data.current as { task: KanbanTask }).task;
    const newColumn = String(over.id) as ColumnKey;
    if (task.column === newColumn) return;

    const previousColumn = task.column;

    onTasksChange(projectId, tasks =>
      tasks.map(t => t.id === task.id ? { ...t, column: newColumn } : t)
    );

    try {
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: newColumn }),
      });
      if (!res.ok) throw new Error("API error");
    } catch {
      onTasksChange(projectId, tasks =>
        tasks.map(t => t.id === task.id ? { ...t, column: previousColumn } : t)
      );
      toast({ title: "Move failed", description: "Could not update task. Please try again.", variant: "destructive" });
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={e => void handleDragEnd(e)}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map(col => (
          <DroppableColumn
            key={col.key}
            col={col}
            tasks={tasks.filter(t => t.column === col.key)}
            onDelete={onDelete}
            projectId={projectId}
            isOver={overColumnKey === col.key}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <CardOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export default function ProjectsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [projectDetails, setProjectDetails] = useState<Record<number, { steps: WorkflowStep[]; tasks: KanbanTask[] }>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const [addStepProjectId, setAddStepProjectId] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState({ title: "", status: "pending" });

  const [addTaskProjectId, setAddTaskProjectId] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", column: "backlog", assignedTo: "" });
  const [subSaving, setSubSaving] = useState(false);

  const load = async () => {
    const [projRes, clientRes] = await Promise.all([
      fetchWithAuth("/api/admin/projects"),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (projRes.ok) setProjects(await projRes.json() as Project[]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const clientName = (id: number | null) => {
    const c = clients.find(c => c.id === id);
    return c ? (c.name ?? c.email) : "Unassigned";
  };

  const reloadDetails = useCallback(async (projectId: number) => {
    const [stepsRes, tasksRes] = await Promise.all([
      fetchWithAuth(`/api/admin/workflow-steps?projectId=${projectId}`),
      fetchWithAuth(`/api/admin/kanban-tasks?projectId=${projectId}`),
    ]);
    const steps = stepsRes.ok ? await stepsRes.json() as WorkflowStep[] : [];
    const tasks = tasksRes.ok ? await tasksRes.json() as KanbanTask[] : [];
    setProjectDetails(prev => ({ ...prev, [projectId]: { steps, tasks } }));
  }, [fetchWithAuth]);

  const handleExpand = async (projectId: number) => {
    if (expandedProjectId === projectId) { setExpandedProjectId(null); return; }
    setExpandedProjectId(projectId);
    if (projectDetails[projectId]) return;
    setDetailLoading(true);
    await reloadDetails(projectId);
    setDetailLoading(false);
  };

  const handleTasksChange = useCallback((projectId: number, updater: (tasks: KanbanTask[]) => KanbanTask[]) => {
    setProjectDetails(prev => {
      const detail = prev[projectId];
      if (!detail) return prev;
      return { ...prev, [projectId]: { ...detail, tasks: updater(detail.tasks) } };
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        progress: Number(form.progress),
        clientUserId: form.clientUserId ? Number(form.clientUserId) : null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        phase: form.phase || null,
        description: form.description || null,
      };
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/projects/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetchWithAuth("/api/admin/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error);
      } else {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Project deleted", description: `"${deleteTarget.title}" and all its data have been removed.` });
        setDeleteTarget(null);
        await load();
      } else {
        const err = await res.json() as { error: string };
        toast({ title: "Delete failed", description: err.error, variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      description: p.description ?? "",
      status: p.status,
      phase: p.phase ?? "",
      progress: p.progress,
      clientUserId: p.clientUserId ? String(p.clientUserId) : "",
      startDate: p.startDate ? new Date(p.startDate).toISOString().split("T")[0] : "",
      endDate: p.endDate ? new Date(p.endDate).toISOString().split("T")[0] : "",
    });
    setShowForm(true);
  };

  const handleAddStep = async (e: React.FormEvent, projectId: number) => {
    e.preventDefault();
    if (!stepForm.title.trim()) return;
    setSubSaving(true);
    await fetchWithAuth("/api/admin/workflow-steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: stepForm.title.trim(), status: stepForm.status }),
    });
    setAddStepProjectId(null);
    setStepForm({ title: "", status: "pending" });
    await reloadDetails(projectId);
    setSubSaving(false);
  };

  const handleDeleteStep = async (stepId: number, projectId: number) => {
    if (!confirm("Delete this workflow step?")) return;
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, { method: "DELETE" });
    await reloadDetails(projectId);
  };

  const handleUpdateStepStatus = async (stepId: number, projectId: number, status: string) => {
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await reloadDetails(projectId);
  };

  const handleAddTask = async (e: React.FormEvent, projectId: number) => {
    e.preventDefault();
    if (!taskForm.title.trim()) return;
    setSubSaving(true);
    await fetchWithAuth("/api/admin/kanban-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: taskForm.title.trim(),
        column: taskForm.column,
        assignedTo: taskForm.assignedTo.trim() || null,
      }),
    });
    setAddTaskProjectId(null);
    setTaskForm({ title: "", column: "backlog", assignedTo: "" });
    await reloadDetails(projectId);
    setSubSaving(false);
  };

  const handleDeleteTask = async (taskId: number, projectId: number) => {
    if (!confirm("Delete this Kanban task?")) return;
    await fetchWithAuth(`/api/admin/kanban-tasks/${taskId}`, { method: "DELETE" });
    await reloadDetails(projectId);
  };

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage client projects. Click a project to manage its workflow steps and Kanban tasks.</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Project
        </button>
      </div>

      {showForm && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">{editingId ? "Edit Project" : "New Project"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Title *</label>
              <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Client</label>
              <select value={form.clientUserId} onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Unassigned —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` (${c.company})` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Phase</label>
              <input value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                placeholder="e.g. Pilot Phase" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Progress ({form.progress}%)</label>
              <input type="range" min={0} max={100} value={form.progress} onChange={e => setForm(f => ({ ...f, progress: Number(e.target.value) }))}
                className="w-full accent-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Target End Date</label>
              <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Project"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : projects.length === 0 ? (
        <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">No projects yet.</div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => {
            const isExpanded = expandedProjectId === p.id;
            const detail = projectDetails[p.id];
            return (
              <div key={p.id} className="bg-white border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#F7F9FC] transition-colors cursor-pointer" onClick={() => void handleExpand(p.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-semibold text-[#0A2540]">{p.title}</p>
                      {p.phase && <span className="text-xs text-muted-foreground bg-[#F7F9FC] border border-border rounded px-2 py-0.5">{p.phase}</span>}
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {p.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5">
                      <span className="text-xs text-muted-foreground">{clientName(p.clientUserId)}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-20 bg-[#F7F9FC] rounded-full h-1.5 border border-border">
                          <div className="h-1.5 rounded-full bg-[#0078D4]" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{p.progress}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button onClick={e => { e.stopPropagation(); handleEdit(p); }} className="text-xs font-semibold text-[#0078D4] hover:underline">Edit</button>
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(p); }} className="text-xs font-semibold text-red-500 hover:text-red-700">Delete</button>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border bg-[#F7F9FC] px-5 py-5 space-y-6">
                    {detailLoading && !detail ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                        Loading steps and tasks…
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">Workflow Steps</h4>
                            <button onClick={() => { setAddStepProjectId(addStepProjectId === p.id ? null : p.id); setStepForm({ title: "", status: "pending" }); }}
                              className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              Add Step
                            </button>
                          </div>
                          {addStepProjectId === p.id && (
                            <form onSubmit={e => void handleAddStep(e, p.id)} className="flex items-end gap-2 mb-3 p-3 bg-white border border-border rounded-lg">
                              <div className="flex-1">
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Step Title *</label>
                                <input required autoFocus value={stepForm.title} onChange={e => setStepForm(f => ({ ...f, title: e.target.value }))}
                                  placeholder="e.g. Kick-off Meeting"
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Status</label>
                                <select value={stepForm.status} onChange={e => setStepForm(f => ({ ...f, status: e.target.value }))}
                                  className="border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                                  <option value="pending">Pending</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="completed">Completed</option>
                                  <option value="blocked">Blocked</option>
                                </select>
                              </div>
                              <button type="submit" disabled={subSaving} className="bg-[#0078D4] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#0078D4]/90 disabled:opacity-50 whitespace-nowrap">Add</button>
                              <button type="button" onClick={() => setAddStepProjectId(null)} className="border border-border text-xs font-medium px-3 py-1.5 rounded hover:bg-[#F7F9FC]">Cancel</button>
                            </form>
                          )}
                          {!detail?.steps.length ? (
                            <p className="text-xs text-muted-foreground">No workflow steps yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {detail.steps.map(s => (
                                <div key={s.id} className="flex items-center gap-3 p-2.5 bg-white border border-border rounded-lg">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-[#0A2540] truncate">{s.title}</span>
                                  </div>
                                  <select value={s.status} onChange={e => void handleUpdateStepStatus(s.id, p.id, e.target.value)}
                                    className={`text-xs font-semibold rounded px-2 py-1 border-0 focus:outline-none focus:ring-1 focus:ring-[#0078D4] cursor-pointer ${STEP_STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}>
                                    <option value="pending">Pending</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="completed">Completed</option>
                                    <option value="blocked">Blocked</option>
                                  </select>
                                  <button onClick={() => void handleDeleteStep(s.id, p.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold flex-shrink-0">Delete</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">Kanban Tasks</h4>
                            <button onClick={() => { setAddTaskProjectId(addTaskProjectId === p.id ? null : p.id); setTaskForm({ title: "", column: "backlog", assignedTo: "" }); }}
                              className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              Add Task
                            </button>
                          </div>
                          {addTaskProjectId === p.id && (
                            <form onSubmit={e => void handleAddTask(e, p.id)} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 p-3 bg-white border border-border rounded-lg">
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Task Title *</label>
                                <input required autoFocus value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Column</label>
                                <select value={taskForm.column} onChange={e => setTaskForm(f => ({ ...f, column: e.target.value }))}
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                                  <option value="backlog">Backlog</option>
                                  <option value="in_progress">In Progress</option>
                                  <option value="waiting_on_customer">Waiting</option>
                                  <option value="completed">Done</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Assigned To</label>
                                <input value={taskForm.assignedTo} onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))}
                                  placeholder="Optional name"
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                              </div>
                              <div className="sm:col-span-3 flex gap-2">
                                <button type="submit" disabled={subSaving} className="bg-[#0078D4] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#0078D4]/90 disabled:opacity-50">Add</button>
                                <button type="button" onClick={() => setAddTaskProjectId(null)} className="border border-border text-xs font-medium px-3 py-1.5 rounded hover:bg-[#F7F9FC]">Cancel</button>
                              </div>
                            </form>
                          )}
                          {!detail?.tasks.length ? (
                            <p className="text-xs text-muted-foreground">No Kanban tasks yet.</p>
                          ) : (
                            <KanbanBoard
                              projectId={p.id}
                              tasks={detail.tasks}
                              onTasksChange={handleTasksChange}
                              onDelete={handleDeleteTask}
                              fetchWithAuth={fetchWithAuth}
                              toast={toast}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.title}</strong> and all its workflow steps, kanban tasks, and associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? "Deleting…" : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
