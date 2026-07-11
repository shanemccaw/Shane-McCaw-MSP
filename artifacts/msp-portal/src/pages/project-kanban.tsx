/**
 * project-kanban.tsx
 *
 * Project Delivery Kanban Board — admin and customer views, SSE-synced.
 *
 * Role behaviour:
 *   - Admin / MSP operators : see all tasks including internalNotes, admin action
 *     zone (Run Workflow, Run Monitoring), and full CRUD controls.
 *   - Customer (CustomerUser): sees publicNotes only, no admin action zone, can
 *     only respond to "Waiting for You" tasks by moving them back to In Progress.
 *
 * Columns: Backlog → In Progress → Waiting for You → Review → Done
 * Undo banner appears for 8 seconds whenever a task is moved to Done.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KanbanSquare,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type DeliveryColumn = "backlog" | "in_progress" | "waiting_on_customer" | "review" | "completed";

interface KanbanTask {
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  column: DeliveryColumn;
  order: number;
  priority: string;
  publicNotes: string | null;
  internalNotes?: string | null;
  taskMetadata: Record<string, unknown> | null;
  dueDate: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UndoEntry {
  taskId: number;
  prevColumn: DeliveryColumn;
  taskTitle: string;
  timer: ReturnType<typeof setTimeout>;
}

// ── Column definitions ─────────────────────────────────────────────────────────

const COLUMNS: { key: DeliveryColumn; label: string; description: string }[] = [
  { key: "backlog", label: "Backlog", description: "Tasks queued for work" },
  { key: "in_progress", label: "In Progress", description: "Actively being worked on" },
  { key: "waiting_on_customer", label: "Waiting for You", description: "Your action needed" },
  { key: "review", label: "Review", description: "Ready for review" },
  { key: "completed", label: "Done", description: "Completed tasks" },
];

const COLUMN_COLORS: Record<DeliveryColumn, string> = {
  backlog: "bg-slate-100 dark:bg-slate-800",
  in_progress: "bg-blue-50 dark:bg-blue-950",
  waiting_on_customer: "bg-amber-50 dark:bg-amber-950",
  review: "bg-purple-50 dark:bg-purple-950",
  completed: "bg-green-50 dark:bg-green-950",
};

const COLUMN_HEADER_COLORS: Record<DeliveryColumn, string> = {
  backlog: "text-slate-600 dark:text-slate-300",
  in_progress: "text-blue-700 dark:text-blue-300",
  waiting_on_customer: "text-amber-700 dark:text-amber-300",
  review: "text-purple-700 dark:text-purple-300",
  completed: "text-green-700 dark:text-green-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

// ── Helper ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

// ── Create Task Dialog ────────────────────────────────────────────────────────

interface CreateTaskDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  defaultColumn: DeliveryColumn;
  onCreated: (task: KanbanTask) => void;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function CreateTaskDialog({ open, onClose, projectId, defaultColumn, onCreated, fetchWithAuth }: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [publicNotes, setPublicNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [column, setColumn] = useState<DeliveryColumn>(defaultColumn);
  const [priority, setPriority] = useState<string>("medium");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle(""); setDescription(""); setPublicNotes(""); setInternalNotes("");
    setColumn(defaultColumn); setPriority("medium");
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetchWithAuth("/api/portal/delivery-kanban-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: title.trim(), description: description.trim() || undefined, column, priority, publicNotes: publicNotes.trim() || undefined, internalNotes: internalNotes.trim() || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      const task = await r.json() as KanbanTask;
      onCreated(task);
      reset();
      onClose();
      toast.success("Task created");
    } catch {
      toast.error("Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Title *</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Brief description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Column</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={column} onChange={e => setColumn(e.target.value as DeliveryColumn)}>
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Priority</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-1"><Eye className="size-3.5" /> Public Notes <span className="text-muted-foreground font-normal">(customer-visible)</span></label>
            <Textarea value={publicNotes} onChange={e => setPublicNotes(e.target.value)} rows={2} placeholder="Notes the customer will see" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 flex items-center gap-1"><EyeOff className="size-3.5" /> Internal Notes <span className="text-muted-foreground font-normal">(admin-only)</span></label>
            <Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} placeholder="Notes only admins will see" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!title.trim() || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Task Dialog ──────────────────────────────────────────────────────────

interface EditTaskDialogProps {
  task: KanbanTask | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (task: KanbanTask) => void;
  onDeleted: (id: number) => void;
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function EditTaskDialog({ task, isAdmin, onClose, onSaved, onDeleted, fetchWithAuth }: EditTaskDialogProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [publicNotes, setPublicNotes] = useState(task?.publicNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(task?.internalNotes ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "medium");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [firingWorkflow, setFiringWorkflow] = useState(false);
  const [firingMonitor, setFiringMonitor] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setPublicNotes(task.publicNotes ?? "");
      setInternalNotes(task.internalNotes ?? "");
      setPriority(task.priority);
    }
  }, [task]);

  if (!task) return null;

  async function handleSave() {
    if (!task || !title.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: title.trim(), description: description.trim() || null, publicNotes: publicNotes.trim() || null, priority };
      if (isAdmin) body.internalNotes = internalNotes.trim() || null;
      const r = await fetchWithAuth(`/api/portal/delivery-kanban-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const { task: updated } = await r.json() as { task: KanbanTask };
      onSaved(updated);
      onClose();
      toast.success("Task saved");
    } catch {
      toast.error("Failed to save task");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    setDeleting(true);
    try {
      const r = await fetchWithAuth(`/api/portal/delivery-kanban-tasks/${task.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      onDeleted(task.id);
      onClose();
      toast.success("Task deleted");
    } catch {
      toast.error("Failed to delete task");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRunWorkflow() {
    if (!task) return;
    setFiringWorkflow(true);
    try {
      const r = await fetchWithAuth(`/api/portal/delivery-kanban-tasks/${task.id}/run-workflow`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { workflowName: string; runId: number };
      toast.success(`Workflow "${data.workflowName}" started (run #${data.runId})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fire workflow");
    } finally {
      setFiringWorkflow(false);
    }
  }

  async function handleRunMonitoring() {
    if (!task) return;
    setFiringMonitor(true);
    try {
      const r = await fetchWithAuth(`/api/portal/delivery-kanban-tasks/${task.id}/run-monitoring`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { packageKey: string; checksRan: number; runStatus: string };
      toast.success(`Monitoring complete — ${data.checksRan} checks ran (${data.runStatus})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run monitoring");
    } finally {
      setFiringMonitor(false);
    }
  }

  const hasLinkedWorkflow = !!(task.taskMetadata as Record<string, unknown> | null)?.linkedWorkflowId;
  const hasMonitoringPackage = !!(task.taskMetadata as Record<string, unknown> | null)?.monitoringPackageKey;

  return (
    <Dialog open={!!task} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAdmin ? "Edit Task" : "Task Details"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {isAdmin ? (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">Title *</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Priority</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 flex items-center gap-1"><Eye className="size-3.5" /> Public Notes <span className="text-muted-foreground font-normal">(customer-visible)</span></label>
                <Textarea value={publicNotes} onChange={e => setPublicNotes(e.target.value)} rows={2} placeholder="Visible to the customer" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 flex items-center gap-1"><EyeOff className="size-3.5" /> Internal Notes <span className="text-muted-foreground font-normal">(admin-only)</span></label>
                <Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={2} placeholder="Not visible to the customer" />
              </div>

              {/* Admin action zone */}
              {(hasLinkedWorkflow || hasMonitoringPackage) && (
                <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/40 p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Admin Actions</p>
                  <div className="flex flex-wrap gap-2">
                    {hasLinkedWorkflow && (
                      <Button size="sm" variant="outline" onClick={handleRunWorkflow} disabled={firingWorkflow}>
                        {firingWorkflow ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
                        Run Workflow
                      </Button>
                    )}
                    {hasMonitoringPackage && (
                      <Button size="sm" variant="outline" onClick={handleRunMonitoring} disabled={firingMonitor}>
                        {firingMonitor ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Zap className="size-3.5 mr-1.5" />}
                        Run Monitoring
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Customer-only read view */
            <>
              <div>
                <p className="font-semibold text-base">{task.title}</p>
                {task.description && <p className="text-sm text-muted-foreground mt-1">{task.description}</p>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className={PRIORITY_COLORS[task.priority] ?? ""}>{task.priority}</Badge>
                <Badge variant="outline">{COLUMNS.find(c => c.key === task.column)?.label ?? task.column}</Badge>
              </div>
              {task.publicNotes && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-medium mb-1 flex items-center gap-1"><Eye className="size-3.5" /> Notes from your team</p>
                  <p className="whitespace-pre-wrap">{task.publicNotes}</p>
                </div>
              )}
              {task.dueDate && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5" /> Due: {new Date(task.dueDate).toLocaleDateString()}
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting} className="mr-auto">
              {deleting ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Trash2 className="size-3.5 mr-1.5" />}Delete
            </Button>
          )}
          {isAdmin && (
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}Save
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>{isAdmin ? "Cancel" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: KanbanTask;
  isAdmin: boolean;
  onMoveColumn: (task: KanbanTask, col: DeliveryColumn) => void;
  onEdit: (task: KanbanTask) => void;
}

function TaskCard({ task, isAdmin, onMoveColumn, onEdit }: TaskCardProps) {
  const isWaiting = task.column === "waiting_on_customer";
  const isDone = task.column === "completed";

  return (
    <div
      className={`rounded-lg border bg-card p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow space-y-2 ${isWaiting ? "ring-1 ring-amber-400" : ""}`}
      onClick={() => onEdit(task)}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug line-clamp-2">{task.title}</p>
        <Badge className={`shrink-0 text-xs ${PRIORITY_COLORS[task.priority] ?? ""}`} variant="outline">
          {task.priority}
        </Badge>
      </div>

      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
      )}

      {task.publicNotes && (
        <div className="text-xs text-muted-foreground bg-muted rounded px-2 py-1 line-clamp-2 flex gap-1 items-start">
          <Eye className="size-3 shrink-0 mt-0.5" />
          <span>{task.publicNotes}</span>
        </div>
      )}

      {task.internalNotes && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 rounded px-2 py-1 line-clamp-2 flex gap-1 items-start">
          <EyeOff className="size-3 shrink-0 mt-0.5" />
          <span>{task.internalNotes}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{relativeDate(task.updatedAt)}</span>
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() && !isDone ? "text-red-500" : ""}`}>
            <Clock className="size-3" />
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Quick-move actions */}
      {!isDone && (
        <div className="flex flex-wrap gap-1 pt-1 border-t" onClick={e => e.stopPropagation()}>
          {COLUMNS.filter(c => c.key !== task.column).map(col => (
            <button
              key={col.key}
              className="text-xs px-2 py-0.5 rounded border hover:bg-accent transition-colors"
              onClick={() => onMoveColumn(task, col.key)}
              disabled={!isAdmin && col.key !== "in_progress" && col.key !== "waiting_on_customer"}
            >
              → {col.label}
            </button>
          ))}
        </div>
      )}

      {isWaiting && !isAdmin && (
        <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-xs font-medium pt-1">
          <AlertTriangle className="size-3.5" />
          <span>Your response needed</span>
        </div>
      )}

      {!!(task.taskMetadata as Record<string, unknown> | null)?.linkedWorkflowId && isAdmin && (
        <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 border-t pt-1">
          <Play className="size-3" /> Workflow linked
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProjectKanbanPage() {
  const params = useParams<{ id?: string }>();
  const projectId = parseInt(params.id ?? "", 10);
  const [, navigate] = useLocation();
  const { user, fetchWithAuth, accessToken } = useAuth();

  const adminView = user?.role === "admin" || (user?.mspRole !== undefined && user.mspRole !== "CustomerUser");

  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [editTask, setEditTask] = useState<KanbanTask | null>(null);
  const [createCol, setCreateCol] = useState<DeliveryColumn | null>(null);
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const undoRef = useRef<UndoEntry | null>(null);

  // ── Load tasks ────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    if (isNaN(projectId)) return;
    try {
      const r = await fetchWithAuth(`/api/portal/projects/${projectId}/delivery-kanban-tasks`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as KanbanTask[];
      setTasks(data);
    } catch {
      toast.error("Failed to load tasks");
    }
  }, [projectId, fetchWithAuth]);

  const loadProject = useCallback(async () => {
    if (isNaN(projectId)) return;
    try {
      const r = await fetchWithAuth(`/api/portal/projects/${projectId}`);
      if (r.ok) {
        const data = await r.json() as { title?: string };
        setProjectTitle(data.title ?? `Project #${projectId}`);
      }
    } catch { }
  }, [projectId, fetchWithAuth]);

  useEffect(() => {
    if (isNaN(projectId)) return;
    setLoading(true);
    Promise.all([loadTasks(), loadProject()]).finally(() => setLoading(false));
  }, [projectId, loadTasks, loadProject]);

  // ── SSE connection ────────────────────────────────────────────────────────

  useEffect(() => {
    if (isNaN(projectId) || !accessToken) return;

    const path = adminView
      ? `/api/admin/projects/${projectId}/kanban-events?token=${encodeURIComponent(accessToken)}`
      : `/api/portal/projects/${projectId}/kanban-events?token=${encodeURIComponent(accessToken)}`;

    const es = new EventSource(path);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { action: string; task: KanbanTask };
        if (payload.action === "created") {
          setTasks(prev => {
            if (prev.find(t => t.id === payload.task.id)) return prev;
            return [...prev, payload.task];
          });
        } else if (payload.action === "updated") {
          setTasks(prev => prev.map(t => t.id === payload.task.id ? payload.task : t));
          if (editTask?.id === payload.task.id) setEditTask(payload.task);
        } else if (payload.action === "deleted") {
          setTasks(prev => prev.filter(t => t.id !== (payload.task as unknown as { id: number }).id));
          if (editTask?.id === (payload.task as unknown as { id: number }).id) setEditTask(null);
        }
      } catch { }
    };
    return () => es.close();
  }, [projectId, accessToken, adminView, editTask]);

  // ── Column move ───────────────────────────────────────────────────────────

  async function handleMoveColumn(task: KanbanTask, col: DeliveryColumn) {
    if (task.column === col) return;
    const prevColumn = task.column as DeliveryColumn;

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, column: col } : t));

    try {
      const r = await fetchWithAuth(`/api/portal/delivery-kanban-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: col }),
      });
      if (!r.ok) throw new Error(await r.text());

      if (col === "completed") {
        if (undoRef.current) {
          clearTimeout(undoRef.current.timer);
        }
        const timer = setTimeout(() => {
          setUndoEntry(null);
          undoRef.current = null;
        }, 8000);
        const entry: UndoEntry = { taskId: task.id, prevColumn, taskTitle: task.title, timer };
        setUndoEntry(entry);
        undoRef.current = entry;
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, column: prevColumn } : t));
      toast.error("Failed to move task");
    }
  }

  async function handleUndo() {
    if (!undoEntry) return;
    clearTimeout(undoEntry.timer);
    const { taskId, prevColumn } = undoEntry;
    setUndoEntry(null);
    undoRef.current = null;

    const taskToMove = tasks.find(t => t.id === taskId);
    if (!taskToMove) return;
    await handleMoveColumn({ ...taskToMove, column: "completed" }, prevColumn);
    toast.info("Task moved back");
  }

  // ── Task mutations ─────────────────────────────────────────────────────────

  function handleTaskCreated(task: KanbanTask) {
    setTasks(prev => {
      if (prev.find(t => t.id === task.id)) return prev;
      return [...prev, task];
    });
  }

  function handleTaskSaved(updated: KanbanTask) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }

  function handleTaskDeleted(id: number) {
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isNaN(projectId)) {
    return (
      <AppShell>
        <div className="p-8 text-center text-muted-foreground">Invalid project ID</div>
      </AppShell>
    );
  }

  const tasksByColumn = (col: DeliveryColumn) =>
    tasks.filter(t => t.column === col).sort((a, b) => a.order - b.order);

  const waitingCount = tasks.filter(t => t.column === "waiting_on_customer").length;

  return (
    <AppShell>
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="border-b bg-background px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(adminView ? "/customers" : "/customer-home")}>
              <ArrowLeft className="size-4" />
            </Button>
            <KanbanSquare className="size-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">{projectTitle || `Project #${projectId}`}</h1>
              <p className="text-xs text-muted-foreground">Project Delivery Board</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {waitingCount > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-400">
                {waitingCount} waiting for {adminView ? "customer" : "you"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={loadTasks}>
              <RefreshCw className="size-3.5 mr-1.5" />Refresh
            </Button>
          </div>
        </div>

        {/* Undo banner */}
        {undoEntry && (
          <div className="bg-green-600 text-white px-6 py-2.5 flex items-center justify-between text-sm shrink-0">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              <strong>"{undoEntry.taskTitle}"</strong> marked as Done
            </span>
            <Button size="sm" variant="ghost" className="text-white hover:text-white hover:bg-green-700 h-7 px-3" onClick={handleUndo}>
              <Undo2 className="size-3.5 mr-1.5" />Undo
            </Button>
          </div>
        )}

        {/* Board */}
        {loading ? (
          <div className="flex-1 p-6 grid grid-cols-5 gap-4">
            {COLUMNS.map(c => (
              <div key={c.key} className="space-y-3">
                <Skeleton className="h-7 w-32" />
                {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto p-6 min-h-0">
            <div className="grid grid-cols-5 gap-4 min-w-[900px]">
              {COLUMNS.map(col => {
                const colTasks = tasksByColumn(col.key);
                return (
                  <div key={col.key} className="flex flex-col min-h-0">
                    {/* Column header */}
                    <div className={`flex items-center justify-between mb-3 px-1 ${COLUMN_HEADER_COLORS[col.key]}`}>
                      <span className="font-semibold text-sm">{col.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs bg-muted rounded-full px-2 py-0.5">{colTasks.length}</span>
                        {adminView && (
                          <button
                            className="p-0.5 rounded hover:bg-accent transition-colors"
                            onClick={() => setCreateCol(col.key)}
                            title={`Add task to ${col.label}`}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Column body */}
                    <div className={`flex-1 rounded-lg ${COLUMN_COLORS[col.key]} p-2 space-y-2 overflow-y-auto min-h-[200px]`}>
                      {colTasks.length === 0 && (
                        <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
                          {adminView ? (
                            <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => setCreateCol(col.key)}>
                              <Plus className="size-3.5" />Add task
                            </button>
                          ) : (
                            <span>No tasks</span>
                          )}
                        </div>
                      )}
                      {colTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isAdmin={adminView}
                          onMoveColumn={handleMoveColumn}
                          onEdit={setEditTask}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Customer waiting-zone hint */}
        {!adminView && waitingCount > 0 && (
          <div className="border-t bg-amber-50 dark:bg-amber-950 px-6 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2 shrink-0">
            <AlertTriangle className="size-4 shrink-0" />
            <span>You have <strong>{waitingCount}</strong> task{waitingCount !== 1 ? "s" : ""} waiting for your response. Click a card in "Waiting for You" to respond.</span>
          </div>
        )}

        {/* Lock notice for customer-restricted actions */}
        {!adminView && (
          <div className="border-t bg-muted/40 px-6 py-2 text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
            <Lock className="size-3" />
            Task creation and editing is managed by your project team.
          </div>
        )}
      </div>

      {/* Dialogs */}
      {createCol && (
        <CreateTaskDialog
          open
          onClose={() => setCreateCol(null)}
          projectId={projectId}
          defaultColumn={createCol}
          onCreated={handleTaskCreated}
          fetchWithAuth={fetchWithAuth}
        />
      )}

      <EditTaskDialog
        task={editTask}
        isAdmin={adminView}
        onClose={() => setEditTask(null)}
        onSaved={handleTaskSaved}
        onDeleted={handleTaskDeleted}
        fetchWithAuth={fetchWithAuth}
      />
    </AppShell>
  );
}
