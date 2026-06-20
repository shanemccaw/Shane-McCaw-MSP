import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { KanbanCardModal } from "@/components/KanbanCardModal";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";

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
  description: string | null;
  column: string;
  assignedTo: string | null;
  order: number;
  dueDate: string | null;
  groupName: string | null;
  workflowStepId: number | null;
  waitingReason: string | null;
  completionStatus: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
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

const KANBAN_COLUMNS: { key: string; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_on_customer", label: "Waiting on Client" },
  { key: "completed", label: "Completed" },
];

function CrmTaskCard({ task, projectId, onQuickMove, onDelete, columns, onCardClick }: {
  task: KanbanTask;
  projectId: number;
  onQuickMove: (task: KanbanTask, projectId: number, targetColumn: string) => void;
  onDelete: (taskId: number, projectId: number) => void;
  columns: { key: string; label: string }[];
  onCardClick: (task: KanbanTask) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = (task.column === "waiting_on_customer" && task.waitingReason) ||
    (task.column === "completed" && (task.completionStatus || task.completionNotes));

  return (
    <div className="bg-[#F7F9FC] border border-border rounded p-2">
      <p
        className="text-xs font-medium text-[#0A2540] leading-tight cursor-pointer hover:text-[#0078D4] transition-colors"
        onClick={() => onCardClick(task)}
      >{task.title}</p>
      {task.assignedTo && <p className="text-xs text-muted-foreground mt-0.5">→ {task.assignedTo}</p>}

      {task.column === "waiting_on_customer" && task.waitingReason && (
        <p className="mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-snug line-clamp-2">
          ⏳ {task.waitingReason}
        </p>
      )}
      {task.column === "completed" && task.completionStatus && (
        <span className="inline-block mt-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
          ✓ {task.completionStatus}
        </span>
      )}

      {hasDetail && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1 text-[9px] font-semibold text-[#0078D4] hover:underline flex items-center gap-0.5"
        >
          {expanded ? "▲ Hide details" : "▼ Show details"}
        </button>
      )}

      {expanded && hasDetail && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {task.column === "waiting_on_customer" && task.waitingReason && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600 mb-0.5">Waiting for</p>
              <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 whitespace-pre-wrap leading-snug">{task.waitingReason}</p>
            </div>
          )}
          {task.column === "completed" && task.completionStatus && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-green-700 mb-0.5">Completion Status</p>
              <p className="text-[10px] text-green-800 bg-green-50 border border-green-100 rounded px-2 py-1">{task.completionStatus}</p>
            </div>
          )}
          {task.column === "completed" && task.completionNotes && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Task Results</p>
              <pre className="text-[9px] text-[#0A2540] bg-white border border-border rounded px-2 py-1.5 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">{task.completionNotes}</pre>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {columns.filter(c => c.key !== task.column).map(c => (
          <button
            key={c.key}
            onClick={() => onQuickMove(task, projectId, c.key)}
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-border bg-white hover:bg-[#0078D4] hover:text-white hover:border-[#0078D4] transition-colors text-muted-foreground"
            title={`Move to ${c.label}`}
          >
            → {c.label}
          </button>
        ))}
        <button
          onClick={() => void onDelete(task.id, projectId)}
          className="text-[9px] text-red-400 hover:text-red-600 font-semibold ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

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

export default function AdminProjects() {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Expandable project detail state
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [projectDetails, setProjectDetails] = useState<Record<number, { steps: WorkflowStep[]; tasks: KanbanTask[] }>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  // Add step form
  const [addStepProjectId, setAddStepProjectId] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState({ title: "", status: "pending" });

  // Add task form
  const [addTaskProjectId, setAddTaskProjectId] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", column: "backlog", assignedTo: "" });
  const [subSaving, setSubSaving] = useState(false);

  // Quick-move modal state
  const [pendingMove, setPendingMove] = useState<{ task: KanbanTask; projectId: number; targetColumn: string } | null>(null);
  const [waitingReason, setWaitingReason] = useState("");
  const [completionStatus, setCompletionStatus] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [modalSaving, setModalSaving] = useState(false);

  // Card detail modal state
  const [selectedTask, setSelectedTask] = useState<KanbanCardModalTask | null>(null);
  const [selectedStepTitle, setSelectedStepTitle] = useState<string | null>(null);

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
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      return;
    }
    setExpandedProjectId(projectId);
    if (projectDetails[projectId]) return;
    setDetailLoading(true);
    await reloadDetails(projectId);
    setDetailLoading(false);
  };

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

  const executeQuickMove = async (task: KanbanTask, pId: number, targetColumn: string, extra?: {
    waitingReason?: string; completionStatus?: string; completionNotes?: string;
  }) => {
    await fetchWithAuth(`/api/admin/kanban-tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: targetColumn, ...extra }),
    });
    await reloadDetails(pId);
  };

  const handleQuickMove = (task: KanbanTask, pId: number, targetColumn: string) => {
    if (targetColumn === "waiting_on_customer" || targetColumn === "completed") {
      setPendingMove({ task, projectId: pId, targetColumn });
      setWaitingReason("");
      setCompletionStatus("");
      setCompletionNotes("");
    } else {
      void executeQuickMove(task, pId, targetColumn);
    }
  };

  const confirmWaiting = async () => {
    if (!pendingMove || !waitingReason.trim()) return;
    setModalSaving(true);
    await executeQuickMove(pendingMove.task, pendingMove.projectId, "waiting_on_customer", { waitingReason: waitingReason.trim() });
    setModalSaving(false);
    setPendingMove(null);
  };

  const confirmCompleted = async () => {
    if (!pendingMove || !completionStatus.trim()) return;
    setModalSaving(true);
    await executeQuickMove(pendingMove.task, pendingMove.projectId, "completed", {
      completionStatus: completionStatus.trim(),
      completionNotes: completionNotes.trim() || undefined,
    });
    setModalSaving(false);
    setPendingMove(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#0A2540]">Projects</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Create and manage client projects. Click a project to manage its workflow steps and Kanban tasks.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
        >
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
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">
                Cancel
              </button>
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
                {/* Project row */}
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
                    <button
                      onClick={e => { e.stopPropagation(); handleEdit(p); }}
                      className="text-xs font-semibold text-[#0078D4] hover:underline"
                    >
                      Edit
                    </button>
                    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-border bg-[#F7F9FC] px-5 py-5 space-y-6">
                    {detailLoading && !detail ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                        Loading steps and tasks…
                      </div>
                    ) : (
                      <>
                        {/* ── Workflow Steps ── */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">Workflow Steps</h4>
                            <button
                              onClick={() => { setAddStepProjectId(addStepProjectId === p.id ? null : p.id); setStepForm({ title: "", status: "pending" }); }}
                              className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              Add Step
                            </button>
                          </div>

                          {addStepProjectId === p.id && (
                            <form onSubmit={e => void handleAddStep(e, p.id)} className="flex items-end gap-2 mb-3 p-3 bg-white border border-border rounded-lg">
                              <div className="flex-1">
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Step Title *</label>
                                <input
                                  required
                                  autoFocus
                                  value={stepForm.title}
                                  onChange={e => setStepForm(f => ({ ...f, title: e.target.value }))}
                                  placeholder="e.g. Kick-off Meeting"
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                                />
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
                              <button type="submit" disabled={subSaving} className="bg-[#0078D4] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#0078D4]/90 disabled:opacity-50 whitespace-nowrap">
                                Add
                              </button>
                              <button type="button" onClick={() => setAddStepProjectId(null)} className="border border-border text-xs font-medium px-3 py-1.5 rounded hover:bg-[#F7F9FC]">
                                Cancel
                              </button>
                            </form>
                          )}

                          {!detail?.steps.length ? (
                            <p className="text-xs text-muted-foreground">No workflow steps yet. Add the first step above.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {detail.steps.map(s => (
                                <div key={s.id} className="flex items-center gap-3 p-2.5 bg-white border border-border rounded-lg">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-[#0A2540] truncate">{s.title}</span>
                                  </div>
                                  <select
                                    value={s.status}
                                    onChange={e => void handleUpdateStepStatus(s.id, p.id, e.target.value)}
                                    className={`text-xs font-semibold rounded px-2 py-1 border-0 focus:outline-none focus:ring-1 focus:ring-[#0078D4] cursor-pointer ${STEP_STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="completed">Completed</option>
                                    <option value="blocked">Blocked</option>
                                  </select>
                                  <button onClick={() => void handleDeleteStep(s.id, p.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold flex-shrink-0">
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ── Kanban Tasks ── */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">Kanban Tasks</h4>
                            <button
                              onClick={() => { setAddTaskProjectId(addTaskProjectId === p.id ? null : p.id); setTaskForm({ title: "", column: "backlog", assignedTo: "" }); }}
                              className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              Add Task
                            </button>
                          </div>

                          {addTaskProjectId === p.id && (
                            <form onSubmit={e => void handleAddTask(e, p.id)} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 p-3 bg-white border border-border rounded-lg">
                              <div className="sm:col-span-1">
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Task Title *</label>
                                <input
                                  required
                                  autoFocus
                                  value={taskForm.title}
                                  onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                                  placeholder="e.g. Draft deployment plan"
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Column</label>
                                <select value={taskForm.column} onChange={e => setTaskForm(f => ({ ...f, column: e.target.value }))}
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                                  {KANBAN_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Assigned To</label>
                                <input
                                  value={taskForm.assignedTo}
                                  onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))}
                                  placeholder="e.g. Shane"
                                  className="w-full border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                                />
                              </div>
                              <div className="sm:col-span-3 flex gap-2">
                                <button type="submit" disabled={subSaving} className="bg-[#0078D4] text-white text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#0078D4]/90 disabled:opacity-50">
                                  Add Task
                                </button>
                                <button type="button" onClick={() => setAddTaskProjectId(null)} className="border border-border text-xs font-medium px-3 py-1.5 rounded hover:bg-[#F7F9FC]">
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}

                          {!detail?.tasks.length ? (
                            <p className="text-xs text-muted-foreground">No Kanban tasks yet. Add the first task above.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                              {KANBAN_COLUMNS.map(col => {
                                const colTasks = (detail?.tasks ?? []).filter(t => t.column === col.key);
                                return (
                                  <div key={col.key} className="bg-white border border-border rounded-lg p-2.5">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{col.label} ({colTasks.length})</p>
                                    <div className="space-y-1.5">
                                      {colTasks.length === 0 ? (
                                        <p className="text-xs text-muted-foreground/60 italic">Empty</p>
                                      ) : colTasks.map(t => (
                                        <CrmTaskCard
                                          key={t.id}
                                          task={t}
                                          projectId={p.id}
                                          onQuickMove={handleQuickMove}
                                          onDelete={handleDeleteTask}
                                          columns={KANBAN_COLUMNS}
                                          onCardClick={(task) => {
                                            const detail = projectDetails[p.id];
                                            const stepTitle = task.workflowStepId && detail
                                              ? detail.steps.find((s: WorkflowStep) => s.id === task.workflowStepId)?.title ?? null
                                              : null;
                                            setSelectedTask(task);
                                            setSelectedStepTitle(stepTitle);
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
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

      {/* Waiting on Customer modal */}
      <Dialog open={pendingMove?.targetColumn === "waiting_on_customer"} onOpenChange={open => { if (!open) setPendingMove(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move to Waiting on Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">Moving: <strong className="text-[#0A2540]">{pendingMove?.task.title}</strong></p>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">What are you waiting for from the customer? *</label>
              <textarea
                autoFocus
                rows={3}
                value={waitingReason}
                onChange={e => setWaitingReason(e.target.value)}
                placeholder="e.g. Approval of the migration plan, admin credentials for the tenant…"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setPendingMove(null)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#F7F9FC]">
              Cancel
            </button>
            <button
              onClick={() => void confirmWaiting()}
              disabled={!waitingReason.trim() || modalSaving}
              className="bg-amber-500 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {modalSaving ? "Moving…" : "Move to Waiting"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Completed modal */}
      <Dialog open={pendingMove?.targetColumn === "completed"} onOpenChange={open => { if (!open) setPendingMove(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Completed</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">Completing: <strong className="text-[#0A2540]">{pendingMove?.task.title}</strong></p>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Completion status *</label>
              <input
                autoFocus
                value={completionStatus}
                onChange={e => setCompletionStatus(e.target.value)}
                placeholder="e.g. Deployed successfully, All users migrated…"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Script output / results <span className="font-normal text-muted-foreground">(optional)</span></label>
              <textarea
                rows={5}
                value={completionNotes}
                onChange={e => setCompletionNotes(e.target.value)}
                placeholder="Paste command output, script results, or any notes…"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-y font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setPendingMove(null)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#F7F9FC]">
              Cancel
            </button>
            <button
              onClick={() => void confirmCompleted()}
              disabled={!completionStatus.trim() || modalSaving}
              className="bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {modalSaving ? "Saving…" : "Mark Completed"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KanbanCardModal
        task={selectedTask}
        stepTitle={selectedStepTitle}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        mode="admin"
      />
    </div>
  );
}
