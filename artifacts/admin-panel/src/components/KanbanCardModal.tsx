import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TypedCardContent } from "@/components/kanban/TypedCardContent";

export interface KanbanCardModalTask {
  id: number;
  title: string;
  description?: string | null;
  column: string;
  groupName?: string | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  workflowStepId?: number | null;
  waitingReason?: string | null;
  completionStatus?: string | null;
  completionNotes?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  taskType?: string | null;
  taskMetadata?: Record<string, unknown> | null;
}

interface Props {
  task: KanbanCardModalTask | null;
  stepTitle?: string | null;
  open: boolean;
  onClose: () => void;
  mode?: "client" | "admin";
  fetchWithAuth?: (url: string, options?: RequestInit) => Promise<Response>;
  onUpdate?: (updated: KanbanCardModalTask) => void;
}

const COLUMN_CONFIG: Record<string, { label: string; cls: string }> = {
  backlog:              { label: "Backlog",              cls: "bg-gray-100 text-gray-600 border border-gray-200" },
  in_progress:         { label: "In Progress",          cls: "bg-blue-100 text-blue-700 border border-blue-200" },
  waiting_on_customer: { label: "Waiting on Customer",  cls: "bg-amber-100 text-amber-700 border border-amber-200" },
  completed:           { label: "Completed",            cls: "bg-green-100 text-green-700 border border-green-200" },
};

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border border-red-200",      dot: "bg-red-500" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-700 border border-orange-200", dot: "bg-orange-500" },
  medium:   { label: "Medium",   cls: "bg-blue-100 text-blue-700 border border-blue-200",   dot: "bg-blue-500" },
  low:      { label: "Low",      cls: "bg-gray-100 text-gray-500 border border-gray-200",   dot: "bg-gray-400" },
};

interface EditForm {
  title: string;
  description: string;
  priority: string;
  assignedTo: string;
  dueDate: string;
}

export function KanbanCardModal({ task, stepTitle, open, onClose, mode = "client", fetchWithAuth, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({ title: "", description: "", priority: "", assignedTo: "", dueDate: "" });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title ?? "",
        description: task.description ?? "",
        priority: task.priority ?? "",
        assignedTo: task.assignedTo ?? "",
        dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      });
    }
    setEditing(false);
    setSaveError(null);
  }, [task]);

  if (!task) return null;

  const colCfg = COLUMN_CONFIG[task.column] ?? { label: task.column, cls: "bg-gray-100 text-gray-600 border border-gray-200" };
  const priorityCfg = task.priority ? PRIORITY_CONFIG[task.priority] : null;

  const handleSave = async () => {
    if (!fetchWithAuth || !onUpdate) return;
    if (!form.title.trim()) { setSaveError("Title is required"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority || null,
        assignedTo: form.assignedTo.trim() || null,
        dueDate: form.dueDate || null,
      };
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setSaveError(d.error ?? "Failed to save");
        return;
      }
      const updated = await res.json() as KanbanCardModalTask;
      onUpdate({ ...task, ...updated });
      setEditing(false);
    } catch {
      setSaveError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#0A2540] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-white";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1";

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { setEditing(false); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-2">
            <div className="flex-1 min-w-0">
              {task.groupName && (
                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 mb-2">
                  {task.groupName}
                </span>
              )}
              {editing ? (
                <input
                  className={inputCls + " text-base font-bold"}
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Task title"
                  autoFocus
                />
              ) : (
                <DialogTitle className="text-base font-bold text-[#0A2540] leading-snug">
                  {task.title}
                </DialogTitle>
              )}
            </div>

            {/* Edit / Cancel toggle (admin only) */}
            {mode === "admin" && fetchWithAuth && onUpdate && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 border border-[#0078D4]/30 hover:border-[#0078D4] rounded-lg px-2.5 py-1.5 transition-colors mt-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-1">

          {/* ── EDIT MODE ─────────────────────────────────────────────────── */}
          {editing ? (
            <>
              <div>
                <label className={labelCls}>Description</label>
                <textarea
                  className={inputCls + " resize-none"}
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Priority</label>
                  <select
                    className={inputCls}
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="">No priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Due Date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Assigned To</label>
                <input
                  className={inputCls}
                  value={form.assignedTo}
                  onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                  placeholder="Name or email"
                />
              </div>

              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
                >
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={() => { setEditing(false); setSaveError(null); }}
                  disabled={saving}
                  className="text-sm font-semibold text-muted-foreground hover:text-[#0A2540] px-3 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            /* ── VIEW MODE ─────────────────────────────────────────────────── */
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${colCfg.cls}`}>
                  {colCfg.label}
                </span>
                {priorityCfg && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${priorityCfg.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${priorityCfg.dot}`} />
                    {priorityCfg.label}
                  </span>
                )}
              </div>

              {task.description && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
                  <p className="text-sm text-[#0A2540] leading-relaxed">{task.description}</p>
                </div>
              )}

              <TypedCardContent
                taskType={task.taskType}
                metadata={task.taskMetadata}
              />

              {(task.assignedTo || task.dueDate || stepTitle) && (
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {task.assignedTo && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>{task.assignedTo}</span>
                    </div>
                  )}
                  {task.dueDate && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Due {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    </div>
                  )}
                  {stepTitle && (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      <span>Phase: {stepTitle}</span>
                    </div>
                  )}
                </div>
              )}

              {task.column === "waiting_on_customer" && task.waitingReason && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1.5">Waiting for</p>
                  <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{task.waitingReason}</p>
                </div>
              )}

              {task.column === "completed" && (task.completionStatus || task.completionNotes) && (
                <div className="space-y-3">
                  {task.completionStatus && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Result:</span>
                      <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                        ✓ {task.completionStatus}
                      </span>
                    </div>
                  )}
                  {task.completionNotes && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Output / Notes</p>
                      <pre className="text-xs text-[#0A2540] bg-[#F7F9FC] border border-border rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed max-h-52 overflow-y-auto">
                        {task.completionNotes}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {(task.createdAt || task.updatedAt) && (
                <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground pt-2 border-t border-border">
                  {task.createdAt && (
                    <span>Created {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                  {task.updatedAt && task.updatedAt !== task.createdAt && (
                    <span>Updated {new Date(task.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
