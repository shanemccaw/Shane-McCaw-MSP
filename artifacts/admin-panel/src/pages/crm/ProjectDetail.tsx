import { useEffect, useState, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { KanbanCardModal } from "@/components/KanbanCardModal";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";
import StatusReportForm from "@/components/StatusReportForm";
import type { StatusReport } from "@/components/StatusReportForm";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
  projectType: string;
  createdAt: string;
}

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface WorkflowStep {
  id: number;
  title: string;
  status: string;
  order: number;
  description: string | null;
  dueDate: string | null;
  notes: string | null;
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
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  statusReportId: number | null;
}

const COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_on_customer", label: "Waiting" },
  { key: "completed", label: "Done" },
] as const;

type ColumnKey = typeof COLUMNS[number]["key"];

const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  waiting_on_customer: "Waiting",
  completed: "Done",
};

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border border-red-200", dot: "bg-red-500" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-700 border border-orange-200", dot: "bg-orange-500" },
  medium:   { label: "Medium",   cls: "bg-blue-100 text-blue-700 border border-blue-200", dot: "bg-blue-500" },
  low:      { label: "Low",      cls: "bg-gray-100 text-gray-500 border border-gray-200", dot: "bg-gray-400" },
};

const STEP_STATUS_OPTS = [
  { value: "pending",     label: "Pending",     cls: "text-gray-600 bg-gray-100" },
  { value: "in_progress", label: "In Progress", cls: "text-blue-700 bg-blue-100" },
  { value: "completed",   label: "Completed",   cls: "text-green-700 bg-green-100" },
  { value: "blocked",     label: "Blocked",     cls: "text-red-700 bg-red-100" },
];

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || !PRIORITY_CONFIG[priority]) return null;
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function AssigneeAvatar({ name }: { name: string }) {
  const initials = getInitials(name);
  return (
    <span
      title={name}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#0078D4] text-white text-[8px] font-bold flex-shrink-0"
    >
      {initials}
    </span>
  );
}

function DraggableCard({
  task, onDelete, projectId, steps, onQuickMove, onCardClick, onReply,
}: {
  task: KanbanTask;
  onDelete: (taskId: number, projectId: number) => void;
  projectId: number;
  steps: WorkflowStep[];
  onQuickMove: (task: KanbanTask, targetColumn: ColumnKey) => void;
  onCardClick: (task: KanbanTask) => void;
  onReply: (reportId: number, reply: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replySent, setReplySent] = useState(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const stepTitle = task.workflowStepId
    ? steps.find(s => s.id === task.workflowStepId)?.title ?? null
    : null;

  const targetCols = COLUMNS.filter(c => c.key !== task.column);
  const hasDetail = (task.column === "waiting_on_customer" && task.waitingReason) ||
    (task.column === "completed" && (task.completionStatus || task.completionNotes));

  const isInProgress = task.column === "in_progress";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-border rounded-lg shadow-sm hover:shadow-md transition-shadow select-none ${isDragging ? "opacity-40" : ""}`}
    >
      {isInProgress && (
        <div className="h-0.5 rounded-t-lg bg-gradient-to-r from-[#0078D4] to-[#00B4D8]" />
      )}
      <div className="p-2.5">
        <div className="flex items-start gap-1.5">
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
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <PriorityBadge priority={task.priority} />
              {task.groupName && (
                <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  {task.groupName}
                </span>
              )}
              {stepTitle && (
                <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#0A2540]/8 text-[#0A2540]/60 border border-[#0A2540]/10">
                  {stepTitle}
                </span>
              )}
            </div>

            <p
              className="text-xs font-semibold text-[#0A2540] cursor-pointer hover:text-[#0078D4] transition-colors leading-snug"
              onClick={() => onCardClick(task)}
            >
              {task.title}
            </p>

            {task.description && (
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {task.description}
              </p>
            )}

            {task.statusReportId && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700 mb-1.5 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Customer Question
                </p>
                {replySent ? (
                  <p className="text-[9px] font-semibold text-green-700 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    Reply sent
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <textarea
                      value={replyDraft}
                      onChange={e => setReplyDraft(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder="Type your reply…"
                      rows={2}
                      className="w-full text-[10px] border border-amber-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
                    />
                    <button
                      disabled={!replyDraft.trim() || replySending}
                      onClick={async e => {
                        e.stopPropagation();
                        if (!replyDraft.trim() || replySending) return;
                        setReplySending(true);
                        await onReply(task.statusReportId!, replyDraft.trim());
                        setReplySent(true);
                        setReplySending(false);
                      }}
                      className="flex items-center gap-1 text-[9px] font-bold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-50 px-2 py-1 rounded transition-colors"
                    >
                      {replySending ? (
                        <div className="w-2.5 h-2.5 border border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                      )}
                      Send Reply
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {task.assignedTo && <AssigneeAvatar name={task.assignedTo} />}
              {task.dueDate && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>

            {task.column === "waiting_on_customer" && task.waitingReason && (
              <p className="mt-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-snug line-clamp-2">
                ⏳ {task.waitingReason}
              </p>
            )}
            {task.column === "completed" && task.completionStatus && (
              <span className="inline-block mt-1.5 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
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

            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {targetCols.map(col => (
                <button
                  key={col.key}
                  onClick={() => onQuickMove(task, col.key)}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-border bg-white hover:bg-[#0078D4] hover:text-white hover:border-[#0078D4] transition-colors text-muted-foreground"
                  title={`Move to ${COLUMN_LABELS[col.key]}`}
                >
                  → {COLUMN_LABELS[col.key]}
                </button>
              ))}
              <button
                onClick={() => onDelete(task.id, projectId)}
                className="text-red-400 hover:text-red-600 text-[9px] font-semibold ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardOverlay({ task }: { task: KanbanTask }) {
  return (
    <div className="bg-white border border-[#0078D4] rounded-lg p-2.5 text-xs shadow-xl rotate-1 opacity-90 w-52">
      <PriorityBadge priority={task.priority} />
      <p className="font-semibold text-[#0A2540] mt-1">{task.title}</p>
      {task.assignedTo && <p className="text-muted-foreground text-[10px] mt-0.5">{task.assignedTo}</p>}
    </div>
  );
}

function DroppableColumn({
  col, tasks, onDelete, projectId, isOver, steps, onQuickMove, onCardClick, onReply,
}: {
  col: { key: string; label: string };
  tasks: KanbanTask[];
  onDelete: (taskId: number, projectId: number) => void;
  projectId: number;
  isOver: boolean;
  steps: WorkflowStep[];
  onQuickMove: (task: KanbanTask, targetColumn: ColumnKey) => void;
  onCardClick: (task: KanbanTask) => void;
  onReply: (reportId: number, reply: string) => Promise<void>;
}) {
  const { setNodeRef } = useDroppable({ id: col.key });

  const COLUMN_HEADER_ACCENT: Record<string, string> = {
    backlog: "border-l-gray-300",
    in_progress: "border-l-[#0078D4]",
    waiting_on_customer: "border-l-amber-400",
    completed: "border-l-green-500",
  };

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl p-3 transition-colors border-l-4 ${COLUMN_HEADER_ACCENT[col.key] ?? "border-l-gray-200"} ${isOver ? "bg-blue-50 border border-[#0078D4]/30" : "bg-[#F7F9FC] border border-border"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider">
          {col.label}
        </p>
        <span className="text-[10px] font-semibold text-muted-foreground bg-white border border-border rounded-full px-2 py-0.5">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-2 min-h-[48px]">
        {tasks.map(task => (
          <DraggableCard
            key={task.id}
            task={task}
            onDelete={onDelete}
            projectId={projectId}
            steps={steps}
            onQuickMove={onQuickMove}
            onCardClick={onCardClick}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}

type PendingMove = { task: KanbanTask; targetColumn: ColumnKey };

function KanbanBoard({
  projectId, tasks, steps, onTasksChange, onDelete, fetchWithAuth, toast, onCardClick,
}: {
  projectId: number;
  tasks: KanbanTask[];
  steps: WorkflowStep[];
  onTasksChange: (updater: (tasks: KanbanTask[]) => KanbanTask[]) => void;
  onDelete: (taskId: number, projectId: number) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  toast: ReturnType<typeof useToast>["toast"];
  onCardClick: (task: KanbanTask) => void;
})  {
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const [overColumnKey, setOverColumnKey] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [waitingReason, setWaitingReason] = useState("");
  const [completionStatus, setCompletionStatus] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [modalSaving, setModalSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const executeMove = async (task: KanbanTask, newColumn: ColumnKey, extra?: {
    waitingReason?: string; completionStatus?: string; completionNotes?: string;
  }) => {
    const previousColumn = task.column;
    onTasksChange(ts =>
      ts.map(t => t.id === task.id ? {
        ...t, column: newColumn,
        waitingReason: extra?.waitingReason ?? t.waitingReason,
        completionStatus: extra?.completionStatus ?? t.completionStatus,
        completionNotes: extra?.completionNotes ?? t.completionNotes,
      } : t)
    );
    try {
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: newColumn, ...extra }),
      });
      if (!res.ok) throw new Error("API error");
    } catch {
      onTasksChange(ts =>
        ts.map(t => t.id === task.id ? { ...t, column: previousColumn } : t)
      );
      toast({ title: "Move failed", description: "Could not update task. Please try again.", variant: "destructive" });
    }
  };

  const interceptMove = (task: KanbanTask, newColumn: ColumnKey) => {
    if (task.column === newColumn) return;
    if (newColumn === "waiting_on_customer" || newColumn === "completed") {
      setPendingMove({ task, targetColumn: newColumn });
      setWaitingReason("");
      setCompletionStatus("");
      setCompletionNotes("");
    } else {
      void executeMove(task, newColumn);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = (event.active.data.current as { task: KanbanTask }).task;
    setActiveTask(task);
  };

  const handleDragOver = (event: { over: { id: string | number } | null }) => {
    setOverColumnKey(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    setOverColumnKey(null);
    const { active, over } = event;
    if (!over) return;
    const task = (active.data.current as { task: KanbanTask }).task;
    const newColumn = String(over.id) as ColumnKey;
    interceptMove(task, newColumn);
  };

  const confirmWaiting = async () => {
    if (!pendingMove || !waitingReason.trim()) return;
    setModalSaving(true);
    await executeMove(pendingMove.task, "waiting_on_customer", { waitingReason: waitingReason.trim() });
    setModalSaving(false);
    setPendingMove(null);
  };

  const confirmCompleted = async () => {
    if (!pendingMove || !completionStatus.trim()) return;
    setModalSaving(true);
    await executeMove(pendingMove.task, "completed", {
      completionStatus: completionStatus.trim(),
      completionNotes: completionNotes.trim() || undefined,
    });
    setModalSaving(false);
    setPendingMove(null);
  };

  const handleReply = async (reportId: number, reply: string): Promise<void> => {
    try {
      const res = await fetchWithAuth(`/api/admin/status-reports/${reportId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        toast({ title: "Reply failed", description: data.error ?? "Could not send reply.", variant: "destructive" });
        throw new Error(data.error ?? "Reply failed");
      }
    } catch (err) {
      if (!(err instanceof Error && err.message === "Reply failed")) {
        toast({ title: "Reply failed", description: "Could not send reply. Please try again.", variant: "destructive" });
      }
      throw err;
    }
  };

  const isWaitingModal = pendingMove?.targetColumn === "waiting_on_customer";
  const isCompletedModal = pendingMove?.targetColumn === "completed";

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <DroppableColumn
              key={col.key}
              col={col}
              tasks={tasks.filter(t => t.column === col.key)}
              onDelete={onDelete}
              projectId={projectId}
              isOver={overColumnKey === col.key}
              steps={steps}
              onQuickMove={interceptMove}
              onCardClick={onCardClick}
              onReply={handleReply}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <CardOverlay task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={isWaitingModal} onOpenChange={open => { if (!open) setPendingMove(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move to Waiting on Customer</DialogTitle>
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

      <Dialog open={isCompletedModal} onOpenChange={open => { if (!open) setPendingMove(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Done</DialogTitle>
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
              {modalSaving ? "Saving…" : "Mark Done"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ClosureRecord {
  id: number;
  projectId: number;
  requestedAt: string;
  feedback: string | null;
  permissionGranted: boolean;
  signatureDataUrl: string | null;
  signedAt: string | null;
}

function ClosureCard({ projectId, projectStatus, fetchWithAuth, toast }: {
  projectId: number | null;
  projectStatus: string | undefined;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  toast: (opts: { title: string; description?: string }) => void;
}) {
  const [closure, setClosure] = useState<ClosureRecord | null | undefined>(undefined);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchWithAuth(`/api/admin/projects/${projectId}/closure`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setClosure(d as ClosureRecord | null))
      .catch(() => setClosure(null));
  }, [projectId, fetchWithAuth]);

  if (!projectId || closure === undefined) return null;

  async function handleRequest() {
    if (!projectId) return;
    setRequesting(true);
    try {
      const r = await fetchWithAuth(`/api/admin/projects/${projectId}/closure-request`, { method: "POST" });
      type ClosureResponse = ClosureRecord & { error?: string; closure?: ClosureRecord };
      const d = await r.json() as ClosureResponse;
      if (!r.ok) {
        toast({ title: d.error ?? "Failed to request sign-off" });
        if (r.status === 409 && d.closure) setClosure(d.closure);
        return;
      }
      setClosure(d);
      toast({ title: "Closure sign-off requested", description: "An email has been sent to the client." });
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#0A2540]">Project Closure &amp; Sign-Off</h2>
      </div>
      {!closure ? (
        <div className="bg-white border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0A2540]">No closure requested yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {projectStatus === "completed"
                  ? "Request a sign-off to collect client feedback and a testimonial."
                  : "Mark the project as Completed before requesting a client sign-off."}
              </p>
            </div>
          </div>
          {projectStatus === "completed" && (
            <button
              onClick={() => void handleRequest()}
              disabled={requesting}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/90 disabled:opacity-50 flex-shrink-0"
            >
              {requesting ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              {requesting ? "Requesting…" : "Request Sign-Off"}
            </button>
          )}
        </div>
      ) : closure.signedAt ? (
        <div className="bg-white border border-green-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-green-800">Project signed off</p>
              <p className="text-xs text-muted-foreground">
                {new Date(closure.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                {closure.permissionGranted ? " · Testimonial permission granted" : " · No testimonial permission"}
              </p>
            </div>
          </div>
          {closure.feedback && (
            <blockquote className="border-l-4 border-[#0078D4] pl-4 text-sm text-[#0A2540]/80 italic leading-relaxed">
              "{closure.feedback}"
            </blockquote>
          )}
          {closure.signatureDataUrl && (
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Client Signature</p>
              <img src={closure.signatureDataUrl} alt="Client signature" className="max-h-16 border border-border rounded bg-white" />
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900">Sign-off requested</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Requested {new Date(closure.requestedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · Awaiting client signature
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function ProjectDetailPage() {
  const [, params] = useRoute("/crm/projects/:id");
  const [, navigate] = useLocation();
  const projectId = params?.id ? parseInt(params.id, 10) : null;

  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTask, setSelectedTask] = useState<KanbanCardModalTask | null>(null);
  const [selectedStepTitle, setSelectedStepTitle] = useState<string | null>(null);

  const [addStepOpen, setAddStepOpen] = useState(false);
  const [stepForm, setStepForm] = useState({ title: "", description: "", status: "pending", dueDate: "" });
  const [stepSaving, setStepSaving] = useState(false);

  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", column: "backlog", assignedTo: "", priority: "" });
  const [taskSaving, setTaskSaving] = useState(false);

  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImporting, setJsonImporting] = useState(false);

  const [editingStepDesc, setEditingStepDesc] = useState<Record<number, string>>({});
  const [savingStepDesc, setSavingStepDesc] = useState<Record<number, boolean>>({});

  const [deleteTaskTarget, setDeleteTaskTarget] = useState<{ taskId: number } | null>(null);
  const [statusReportOpen, setStatusReportOpen] = useState(false);

  const reloadAll = useCallback(async () => {
    if (!projectId) return;
    const [projRes, stepsRes, tasksRes, clientsRes] = await Promise.all([
      fetchWithAuth(`/api/admin/projects/${projectId}`),
      fetchWithAuth(`/api/admin/workflow-steps?projectId=${projectId}`),
      fetchWithAuth(`/api/admin/kanban-tasks?projectId=${projectId}`),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (projRes.ok) {
      const proj = await projRes.json() as Project;
      setProject(proj);
      if (proj.clientUserId && clientsRes.ok) {
        const clients = await clientsRes.json() as Client[];
        setClient(clients.find(c => c.id === proj.clientUserId) ?? null);
      }
    } else if (clientsRes.ok) {
      await clientsRes.json();
    }
    if (stepsRes.ok) setSteps(await stepsRes.json() as WorkflowStep[]);
    if (tasksRes.ok) setTasks(await tasksRes.json() as KanbanTask[]);
    setLoading(false);
  }, [projectId, fetchWithAuth]);

  useEffect(() => { void reloadAll(); }, [reloadAll]);

  const handleTasksChange = useCallback((updater: (tasks: KanbanTask[]) => KanbanTask[]) => {
    setTasks(prev => updater(prev));
  }, []);

  const handleDeleteTask = async (taskId: number, _projectId: number) => {
    setDeleteTaskTarget({ taskId });
  };

  const confirmDeleteTask = async () => {
    if (!deleteTaskTarget) return;
    await fetchWithAuth(`/api/admin/kanban-tasks/${deleteTaskTarget.taskId}`, { method: "DELETE" });
    setTasks(prev => prev.filter(t => t.id !== deleteTaskTarget.taskId));
    setDeleteTaskTarget(null);
  };

  const handleCardClick = (task: KanbanTask) => {
    const stepTitle = task.workflowStepId
      ? steps.find(s => s.id === task.workflowStepId)?.title ?? null
      : null;
    setSelectedStepTitle(stepTitle);
    setSelectedTask({
      ...task,
      priority: task.priority,
    } as KanbanCardModalTask & { priority: string | null });
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title.trim() || !projectId) return;
    setTaskSaving(true);
    const res = await fetchWithAuth("/api/admin/kanban-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        column: taskForm.column,
        assignedTo: taskForm.assignedTo.trim() || null,
        priority: taskForm.priority || null,
      }),
    });
    if (res.ok) {
      const newTask = await res.json() as KanbanTask;
      setTasks(prev => [...prev, newTask]);
      setAddTaskOpen(false);
      setTaskForm({ title: "", description: "", column: "backlog", assignedTo: "", priority: "" });
    }
    setTaskSaving(false);
  };

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepForm.title.trim() || !projectId) return;
    setStepSaving(true);
    await fetchWithAuth("/api/admin/workflow-steps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: stepForm.title.trim(),
        description: stepForm.description.trim() || null,
        status: stepForm.status,
        dueDate: stepForm.dueDate || null,
      }),
    });
    setAddStepOpen(false);
    setStepForm({ title: "", description: "", status: "pending", dueDate: "" });
    await reloadAll();
    setStepSaving(false);
  };

  const handleUpdateStepStatus = async (stepId: number, status: string) => {
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status } : s));
  };

  const handleUpdateStepDueDate = async (stepId: number, dueDate: string) => {
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: dueDate || null }),
    });
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, dueDate: dueDate || null } : s));
  };

  const handleSaveStepDesc = async (stepId: number) => {
    const desc = editingStepDesc[stepId];
    if (desc === undefined) return;
    setSavingStepDesc(prev => ({ ...prev, [stepId]: true }));
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: desc.trim() || null }),
    });
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, description: desc.trim() || null } : s));
    setEditingStepDesc(prev => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setSavingStepDesc(prev => ({ ...prev, [stepId]: false }));
  };

  const handleDeleteStep = async (stepId: number) => {
    if (!confirm("Delete this workflow step?")) return;
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, { method: "DELETE" });
    setSteps(prev => prev.filter(s => s.id !== stepId));
  };

  const handleExportJson = () => {
    const exportData = steps.map(s => ({
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      status: s.status,
      ...(s.dueDate ? { dueDate: s.dueDate } : {}),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `steps-${(project?.title ?? "project").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseJsonSteps = (text: string) => {
    if (!text.trim()) return { parsed: null, error: null };
    try {
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return { parsed: null, error: "JSON must be an array [ … ]" };
      if (raw.length === 0) return { parsed: null, error: "Array is empty" };
      const steps = raw as Array<Record<string, unknown>>;
      const missingTitle = steps.findIndex(s => !s.title || typeof s.title !== "string" || !(s.title as string).trim());
      if (missingTitle !== -1) return { parsed: null, error: `Item at index ${missingTitle} is missing a "title"` };
      return { parsed: steps as Array<{ title: string; description?: string; status?: string; dueDate?: string }>, error: null };
    } catch (e) {
      return { parsed: null, error: (e as SyntaxError).message };
    }
  };

  const handleJsonImport = async () => {
    if (!projectId) return;
    const { parsed, error } = parseJsonSteps(jsonImportText);
    if (error || !parsed) return;
    setJsonImporting(true);
    try {
      const res = await fetchWithAuth("/api/admin/workflow-steps/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, steps: parsed }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Import failed", description: err.error, variant: "destructive" });
        return;
      }
      const created = await res.json() as { id: number }[];
      setJsonImportOpen(false);
      setJsonImportText("");
      await reloadAll();
      toast({ title: "Steps imported", description: `${created.length} step${created.length !== 1 ? "s" : ""} created successfully.` });
    } finally {
      setJsonImporting(false);
    }
  };

  const { parsed: jsonParsed, error: jsonError } = parseJsonSteps(jsonImportText);

  if (!projectId || isNaN(projectId)) {
    return <div className="p-8 text-muted-foreground">Invalid project ID.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return <div className="p-8 text-muted-foreground">Project not found.</div>;
  }

  const clientLabel = client
    ? (client.company ? `${client.company} · ${client.name ?? client.email}` : (client.name ?? client.email))
    : "Unassigned";

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Page header */}
      <div className="mb-6">
        <button
          onClick={() => navigate("/crm/projects")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] transition-colors mb-3"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Projects
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-[#0A2540]">{project.title}</h1>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                project.status === "active" ? "bg-green-100 text-green-700"
                : project.status === "on_hold" ? "bg-yellow-100 text-yellow-700"
                : "bg-blue-100 text-blue-700"
              }`}>
                {project.status.replace("_", " ")}
              </span>
              {project.phase && (
                <span className="text-xs text-muted-foreground bg-[#F7F9FC] border border-border rounded px-2 py-0.5">{project.phase}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{clientLabel}</p>
            {project.description && (
              <p className="text-sm text-[#0A2540]/70 mt-1 max-w-2xl">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors text-[#0A2540]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16v2a2 2 0 002 2h6a2 2 0 002-2v-2M9 12l3-3 3 3M12 21V9" />
              </svg>
              Export JSON
            </button>
            <button
              onClick={() => { setJsonImportOpen(true); setJsonImportText(""); }}
              className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors text-[#0A2540]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 8v2a2 2 0 002 2h6a2 2 0 002-2V8M9 12l3 3 3-3M12 3v12" />
              </svg>
              Import JSON
            </button>
            <button
              onClick={() => setStatusReportOpen(true)}
              className="flex items-center gap-1.5 border border-[#0078D4] text-[#0078D4] text-sm font-semibold px-3 py-2 rounded-lg hover:bg-[#0078D4]/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generate Status Report
            </button>
            <button
              onClick={() => setAddStepOpen(s => !s)}
              className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-[#0A2540]/90 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Step
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3 mt-4">
          <div className="flex-1 bg-[#F7F9FC] rounded-full h-2 border border-border max-w-xs">
            <div className="h-2 rounded-full bg-[#0078D4] transition-all" style={{ width: `${project.progress}%` }} />
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{project.progress}% complete</span>
          {project.endDate && (
            <span className="text-xs text-muted-foreground ml-2">
              Target: {new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      </div>

      {/* ── Kanban Board ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#0A2540]">Kanban Board</h2>
          <button
            onClick={() => setAddTaskOpen(s => !s)}
            className="flex items-center gap-1.5 bg-[#0078D4] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        </div>

        {addTaskOpen && (
          <div className="bg-white border border-border rounded-xl p-4 mb-4">
            <h4 className="text-xs font-bold text-[#0A2540] mb-3">New Task</h4>
            <form onSubmit={e => void handleAddTask(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Title *</label>
                <input
                  required
                  autoFocus
                  value={taskForm.title}
                  onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="Task title…"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={taskForm.description}
                  onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="Optional description…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Column</label>
                <select
                  value={taskForm.column}
                  onChange={e => setTaskForm(f => ({ ...f, column: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                >
                  <option value="backlog">Backlog</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_on_customer">Waiting</option>
                  <option value="completed">Done</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Priority</label>
                <select
                  value={taskForm.priority}
                  onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Assignee</label>
                <input
                  value={taskForm.assignedTo}
                  onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="Name or email…"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={taskSaving}
                  className="bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50"
                >
                  {taskSaving ? "Adding…" : "Add Task"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddTaskOpen(false)}
                  className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#F7F9FC]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <KanbanBoard
          projectId={projectId}
          tasks={tasks}
          steps={steps}
          onTasksChange={handleTasksChange}
          onDelete={handleDeleteTask}
          fetchWithAuth={fetchWithAuth}
          toast={toast}
          onCardClick={handleCardClick}
        />
      </section>

      {/* ── Workflow Phases & Milestones ───────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#0A2540]">Workflow Phases &amp; Milestones</h2>
        </div>

        {addStepOpen && (
          <div className="bg-white border border-border rounded-xl p-4 mb-4">
            <h4 className="text-xs font-bold text-[#0A2540] mb-3">New Step</h4>
            <form onSubmit={e => void handleAddStep(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Phase Name *</label>
                <input
                  required
                  autoFocus
                  value={stepForm.title}
                  onChange={e => setStepForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="Phase name…"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={stepForm.description}
                  onChange={e => setStepForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="What happens in this phase…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Status</label>
                <select
                  value={stepForm.status}
                  onChange={e => setStepForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Expected Due Date</label>
                <input
                  type="date"
                  value={stepForm.dueDate}
                  onChange={e => setStepForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={stepSaving}
                  className="bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50"
                >
                  {stepSaving ? "Adding…" : "Add Step"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddStepOpen(false)}
                  className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#F7F9FC]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {steps.length === 0 ? (
          <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
            No workflow steps yet. Click <strong>Add Step</strong> to create the first phase.
          </div>
        ) : (
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F7F9FC] border-b border-border">
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground px-4 py-3 w-[200px]">Phase Name</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground px-4 py-3">Description</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground px-4 py-3 w-[140px]">Status</th>
                  <th className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground px-4 py-3 w-[160px]">Expected Due</th>
                  <th className="px-4 py-3 w-[60px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {steps.map(step => {
                  const isEditingDesc = step.id in editingStepDesc;
                  const stepStatusCfg = STEP_STATUS_OPTS.find(o => o.value === step.status) ?? STEP_STATUS_OPTS[0];
                  return (
                    <tr key={step.id} className="hover:bg-[#F7F9FC]/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#0A2540] leading-snug">{step.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        {isEditingDesc ? (
                          <div className="flex items-end gap-2">
                            <textarea
                              autoFocus
                              rows={2}
                              value={editingStepDesc[step.id]}
                              onChange={e => setEditingStepDesc(prev => ({ ...prev, [step.id]: e.target.value }))}
                              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => void handleSaveStepDesc(step.id)}
                                disabled={savingStepDesc[step.id]}
                                className="text-[10px] font-semibold text-white bg-[#0078D4] px-2 py-1 rounded hover:bg-[#0078D4]/90 disabled:opacity-50"
                              >
                                {savingStepDesc[step.id] ? "…" : "Save"}
                              </button>
                              <button
                                onClick={() => setEditingStepDesc(prev => { const n = { ...prev }; delete n[step.id]; return n; })}
                                className="text-[10px] font-medium text-muted-foreground px-2 py-1 rounded hover:bg-[#F7F9FC] border border-border"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 group">
                            <span className="text-xs text-muted-foreground leading-relaxed flex-1">
                              {step.description ?? <span className="italic">No description</span>}
                            </span>
                            <button
                              onClick={() => setEditingStepDesc(prev => ({ ...prev, [step.id]: step.description ?? "" }))}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[#0078D4] flex-shrink-0 mt-0.5"
                              title="Edit description"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={step.status}
                          onChange={e => void handleUpdateStepStatus(step.id, e.target.value)}
                          className={`text-xs font-semibold px-2 py-1 rounded border-0 focus:outline-none focus:ring-2 focus:ring-[#0078D4] cursor-pointer ${stepStatusCfg.cls}`}
                        >
                          {STEP_STATUS_OPTS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="date"
                          value={step.dueDate ? new Date(step.dueDate).toISOString().split("T")[0] : ""}
                          onChange={e => void handleUpdateStepDueDate(step.id, e.target.value)}
                          className="text-xs border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#0078D4] w-full"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => void handleDeleteStep(step.id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          title="Delete step"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Closure Sign-Off ────────────────────────────────────────────────── */}
      <ClosureCard projectId={projectId} projectStatus={project?.status} fetchWithAuth={fetchWithAuth} toast={toast} />

      {/* Status Report slide-over */}
      <Dialog open={statusReportOpen} onOpenChange={open => { if (!open) setStatusReportOpen(false); }}>
        <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-0">
            <DialogTitle className="flex items-center gap-2 text-[#0A2540]">
              <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generate Status Report — {project.title}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 pt-4">
            {statusReportOpen && (
              <StatusReportForm
                key={`sr-${projectId}`}
                lockedProjectId={projectId ?? undefined}
                embedded
                autoFill
                onSaved={(saved: StatusReport) => {
                  setStatusReportOpen(false);
                  toast({
                    title: "Status report saved",
                    description: `"${saved.title}" was created successfully.`,
                  });
                }}
                onCancel={() => setStatusReportOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* JSON Import dialog */}
      <Dialog open={jsonImportOpen} onOpenChange={open => { if (!open) setJsonImportOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Workflow Steps from JSON</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">Paste a JSON array of steps. Each item needs a <code className="bg-[#F7F9FC] px-1 rounded">title</code>. Optional: <code className="bg-[#F7F9FC] px-1 rounded">description</code>, <code className="bg-[#F7F9FC] px-1 rounded">status</code>, <code className="bg-[#F7F9FC] px-1 rounded">dueDate</code>.</p>
            <textarea
              autoFocus
              rows={8}
              value={jsonImportText}
              onChange={e => setJsonImportText(e.target.value)}
              placeholder={'[\n  { "title": "Discovery", "status": "pending" },\n  { "title": "Migration", "status": "pending" }\n]'}
              className="w-full border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-y"
            />
            {jsonError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">{jsonError}</p>}
            {jsonParsed && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5">✓ Valid — {jsonParsed.length} step{jsonParsed.length !== 1 ? "s" : ""} will be imported</p>}
          </div>
          <DialogFooter>
            <button onClick={() => setJsonImportOpen(false)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#F7F9FC]">
              Cancel
            </button>
            <button
              onClick={() => void handleJsonImport()}
              disabled={!jsonParsed || !!jsonError || jsonImporting}
              className="bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50"
            >
              {jsonImporting ? "Importing…" : "Import Steps"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete task confirm */}
      <AlertDialog open={!!deleteTaskTarget} onOpenChange={open => { if (!open) setDeleteTaskTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>This kanban task will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteTask()} className="bg-red-600 hover:bg-red-700 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Card detail modal */}
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
