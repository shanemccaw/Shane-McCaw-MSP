import { useEffect, useState, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatAuditEntry, type AuditLogEntry } from "@/lib/auditFormatter";
import { subscribeToChanges, isTaskRunning } from "@/lib/scriptPoller";
import { KanbanCardModal } from "@/components/KanbanCardModal";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";
import RunLibraryScriptDialog from "@/components/RunLibraryScriptDialog";
import RunScriptConfirmDialog from "@/components/RunScriptConfirmDialog";
import { TypedCardContent, TASK_TYPE_CONFIG } from "@/components/kanban/TypedCardContent";
import type { TaskType } from "@/components/kanban/TypedCardContent";
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

interface NbaAction {
  id: number;
  action: string;
  rationale: string | null;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  confidence: number;
  priority: number;
  linkPath: string | null;
  resolvedAt: string | null;
  createdAt: string;
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
  projectType: string;
  sharepointFolderUrl: string | null;
  generatedArtifacts: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }> | null;
  createdAt: string;
}

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  sharepointSiteId: string | null;
}

interface LinkedEmail {
  id: number;
  subject: string | null;
  senderAddress: string;
  rawFrom: string | null;
  receivedAt: string;
  bodyPreview: string | null;
  clientName: string | null;
  clientEmail: string | null;
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
  statusReportQuestion: string | null;
  statusReportAdminReply: string | null;
  statusReportReplyThread: Array<{ sender: "client" | "admin"; content: string; timestamp: string }>;
  taskType: string | null;
  taskMetadata: Record<string, unknown> | null;
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
  critical: { label: "Critical", cls: "bg-red-500/15 text-red-400 border border-red-500/20", dot: "bg-red-500" },
  high:     { label: "High",     cls: "bg-orange-500/15 text-orange-400 border border-orange-200", dot: "bg-orange-500" },
  medium:   { label: "Medium",   cls: "bg-[#0078D4]/100/15 text-blue-400 border border-[#0078D4]/20", dot: "bg-[#0078D4]/100" },
  low:      { label: "Low",      cls: "bg-[#30363D]/50 text-[#7D8590] border border-[#30363D]", dot: "bg-[#484F58]" },
};

const STEP_STATUS_OPTS = [
  { value: "pending",     label: "Pending",     cls: "text-[#7D8590] bg-[#1C2128]" },
  { value: "in_progress", label: "In Progress", cls: "text-blue-400 bg-blue-500/15" },
  { value: "completed",   label: "Completed",   cls: "text-green-400 bg-green-500/15" },
  { value: "blocked",     label: "Blocked",     cls: "text-red-400 bg-red-500/15" },
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
  task, onDelete, projectId, steps, onQuickMove, onCardClick, onReply, clientUserId, clientName,
}: {
  task: KanbanTask;
  onDelete: (taskId: number, projectId: number) => void;
  projectId: number;
  steps: WorkflowStep[];
  onQuickMove: (task: KanbanTask, targetColumn: ColumnKey) => void;
  onCardClick: (task: KanbanTask) => void;
  onReply: (reportId: number, reply: string) => Promise<void>;
  clientUserId?: number | null;
  clientName?: string | null;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [customerViewOpen, setCustomerViewOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);
  const [scriptRunning, setScriptRunning] = useState(() => isTaskRunning(task.id));
  const [, setLocation] = useLocation();

  useEffect(() => {
    const unsubscribe = subscribeToChanges(() => {
      setScriptRunning(isTaskRunning(task.id));
    });
    return unsubscribe;
  }, [task.id]);

  const handleRunScript = () => { if (!scriptRunning) setConfirmRunOpen(true); };
  const handleViewResults = () => onCardClick(task);
  const handleOpenScript = () => { setLocation("/command/scripts"); };

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

  const customerMeta = (task.taskMetadata ?? {}) as Record<string, unknown>;
  const clientDeliverables = (customerMeta.clientDeliverables ?? []) as string[];
  const linkedRunbook = customerMeta.linkedRunbook as { scriptId: string; azureRunbookName: string; scriptTitle: string } | null | undefined;
  const hasCustomerContent = Boolean(
    task.taskType ||
    clientDeliverables.length > 0 ||
    task.waitingReason ||
    task.completionStatus ||
    task.completionNotes ||
    task.statusReportQuestion ||
    task.statusReportAdminReply ||
    task.statusReportReplyThread?.length > 0
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-[#161B22] border border-[#30363D] rounded-lg transition-shadow select-none ${isDragging ? "opacity-40" : ""}`}
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
                <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#0078D4]/100/15 text-blue-400">
                  {task.groupName}
                </span>
              )}
              {stepTitle && (
                <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#0A2540]/8 text-[#E6EDF3]/60 border border-[#0A2540]/10">
                  {stepTitle}
                </span>
              )}
            </div>

            <p
              className="text-xs font-semibold text-[#E6EDF3] cursor-pointer hover:text-[#0078D4] transition-colors leading-snug"
              onClick={() => onCardClick(task)}
            >
              {task.title}
            </p>

            {(() => {
              const meta = (task.taskMetadata ?? {}) as Record<string, unknown>;
              const checklist = (meta.checklist ?? []) as Array<{ id: string }>;
              const checklistState = (meta.checklistState ?? {}) as Record<string, boolean>;
              if (checklist.length === 0) return null;
              const checkedCount = checklist.filter(item => checklistState[item.id]).length;
              const allDone = checkedCount === checklist.length;
              return (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold mt-0.5 px-1.5 py-0.5 rounded ${allDone ? "bg-green-500/15 text-green-400" : "bg-[#30363D]/50 text-[#7D8590]"}`}>
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  {checkedCount}/{checklist.length} done
                </span>
              );
            })()}

            {task.description && (
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {task.description}
              </p>
            )}

            <TypedCardContent
              taskType={task.taskType}
              metadata={task.taskMetadata}
              onRunScript={handleRunScript}
              onViewResults={handleViewResults}
              onOpenScript={handleOpenScript}
            />

            {task.statusReportId && (
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/100/10 px-2.5 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400 mb-1.5 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Customer Question
                </p>
                {replySent ? (
                  <p className="text-[9px] font-semibold text-green-400 flex items-center gap-1">
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
                      className="w-full text-[10px] border border-amber-500/20 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 bg-[#161B22]"
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
              <p className="mt-1.5 text-[10px] text-amber-400 bg-amber-500/100/10 border border-amber-500/20 rounded px-1.5 py-0.5 leading-snug line-clamp-2">
                ⏳ {task.waitingReason}
              </p>
            )}
            {task.column === "completed" && task.completionStatus && (
              <span className="inline-block mt-1.5 text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded px-1.5 py-0.5">
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
                    <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-100 rounded px-2 py-1 whitespace-pre-wrap leading-snug">{task.waitingReason}</p>
                  </div>
                )}
                {task.column === "completed" && task.completionStatus && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-green-400 mb-0.5">Completion Status</p>
                    <p className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">{task.completionStatus}</p>
                  </div>
                )}
                {task.column === "completed" && task.completionNotes && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Task Results</p>
                    <pre className="text-[9px] text-[#E6EDF3] bg-[#161B22] border border-border rounded px-2 py-1.5 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">{task.completionNotes}</pre>
                  </div>
                )}
              </div>
            )}

            {/* ── Customer View collapsible ──────────────────────────────── */}
            {hasCustomerContent && (
              <div className="mt-2 border-t border-[#0078D4]/20 pt-1.5">
                <button
                  onClick={() => setCustomerViewOpen(v => !v)}
                  className="w-full flex items-center justify-between text-[9px] font-bold text-[#0078D4] hover:text-[#005fa3] transition-colors py-0.5"
                >
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Customer View
                  </span>
                  <svg className={`w-3 h-3 transition-transform ${customerViewOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {customerViewOpen && (
                  <div className="mt-1.5 space-y-2 bg-[#1C2128] border border-[#0078D4]/15 rounded-lg px-2.5 py-2">
                    {task.taskType && (
                      <TypedCardContent
                        taskType={task.taskType}
                        metadata={task.taskMetadata}
                        onRunScript={handleRunScript}
                        onViewResults={handleViewResults}
                        onOpenScript={handleOpenScript}
                      />
                    )}
                    {clientDeliverables.length > 0 && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[#E6EDF3]/50 mb-1">Client Deliverables</p>
                        <ul className="space-y-0.5">
                          {clientDeliverables.map((d, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <span className="mt-0.5 text-[#0078D4] flex-shrink-0 leading-none">•</span>
                              <span className="text-[10px] text-[#E6EDF3] leading-snug">{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {task.waitingReason && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600 mb-0.5">Waiting For</p>
                        <p className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-100 rounded px-2 py-1 whitespace-pre-wrap leading-snug">{task.waitingReason}</p>
                      </div>
                    )}
                    {task.completionStatus && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-green-400 mb-0.5">Completion Status</p>
                        <p className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1">{task.completionStatus}</p>
                      </div>
                    )}
                    {task.completionNotes && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-[#E6EDF3]/50 mb-0.5">Task Results</p>
                        <pre className="text-[9px] text-[#E6EDF3] bg-[#161B22] border border-border rounded px-2 py-1.5 whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto">{task.completionNotes}</pre>
                      </div>
                    )}
                    {(task.statusReportQuestion || task.statusReportAdminReply || task.statusReportReplyThread?.length > 0) && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600 mb-1">Status Report Q&amp;A</p>
                        <div className="space-y-1">
                          {task.statusReportQuestion && (
                            <div className="bg-amber-500/10 border border-amber-100 rounded px-2 py-1.5">
                              <p className="text-[8px] font-bold text-amber-600 mb-0.5 uppercase tracking-wider">Client question</p>
                              <p className="text-[10px] text-amber-400 leading-snug whitespace-pre-wrap">{task.statusReportQuestion}</p>
                            </div>
                          )}
                          {task.statusReportAdminReply && (
                            <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded px-2 py-1.5">
                              <p className="text-[8px] font-bold text-[#0078D4] mb-0.5 uppercase tracking-wider">Shane (reply)</p>
                              <p className="text-[10px] text-[#E6EDF3] leading-snug whitespace-pre-wrap">{task.statusReportAdminReply}</p>
                            </div>
                          )}
                          {task.statusReportReplyThread?.map((msg, i) => (
                            <div
                              key={i}
                              className={`rounded px-2 py-1.5 ${msg.sender === "admin"
                                ? "bg-[#0078D4]/10 border border-[#0078D4]/20"
                                : "bg-amber-500/10 border border-amber-100"}`}
                            >
                              <p className={`text-[8px] font-bold mb-0.5 uppercase tracking-wider ${msg.sender === "admin" ? "text-[#0078D4]" : "text-amber-600"}`}>
                                {msg.sender === "admin" ? "Shane (thread reply)" : "Client"}
                              </p>
                              <p className={`text-[10px] leading-snug whitespace-pre-wrap ${msg.sender === "admin" ? "text-[#E6EDF3]" : "text-amber-400"}`}>{msg.content}</p>
                              <p className="text-[8px] text-[#E6EDF3]/40 mt-0.5">{new Date(msg.timestamp).toLocaleDateString()}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {scriptRunning && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                  Running…
                </span>
              )}
              {linkedRunbook?.azureRunbookName && !scriptRunning && task.taskType !== "script" && (
                <button
                  onClick={e => { e.stopPropagation(); if (!scriptRunning) setConfirmRunOpen(true); }}
                  disabled={scriptRunning}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={scriptRunning ? "Script running in background" : "Run linked script"}
                >
                  {scriptRunning ? (
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                  )}
                  {scriptRunning ? "Running…" : "Run Script"}
                </button>
              )}
              {linkedRunbook?.azureRunbookName && scriptRunning && (
                <button
                  onClick={e => { e.stopPropagation(); setRunDialogOpen(true); }}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-0.5"
                  title="View running script"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </button>
              )}
              {targetCols.map(col => (
                <button
                  key={col.key}
                  onClick={() => onQuickMove(task, col.key)}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-border bg-[#161B22] hover:bg-[#0078D4] hover:text-white hover:border-[#0078D4] transition-colors text-muted-foreground"
                  title={`Move to ${COLUMN_LABELS[col.key]}`}
                >
                  → {COLUMN_LABELS[col.key]}
                </button>
              ))}
              <button
                onClick={() => onDelete(task.id, projectId)}
                className="text-red-400 hover:text-red-400 text-[9px] font-semibold ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm run dialog */}
      {confirmRunOpen && linkedRunbook?.azureRunbookName && (
        <RunScriptConfirmDialog
          scriptTitle={linkedRunbook.scriptTitle}
          azureRunbookName={linkedRunbook.azureRunbookName}
          clientName={clientName ?? null}
          disabled={scriptRunning}
          onConfirm={() => {
            if (isTaskRunning(task.id)) return;
            setConfirmRunOpen(false);
            setScriptRunning(true);
            onQuickMove(task, "in_progress");
            setRunDialogOpen(true);
          }}
          onCancel={() => setConfirmRunOpen(false)}
        />
      )}

      {runDialogOpen && linkedRunbook?.azureRunbookName && (
        <RunLibraryScriptDialog
          scriptId={linkedRunbook.scriptId}
          scriptTitle={linkedRunbook.scriptTitle}
          azureRunbookName={linkedRunbook.azureRunbookName}
          initialClientId={clientUserId}
          kanbanTaskId={task.id}
          onClose={() => {
            setRunDialogOpen(false);
          }}
          onRunComplete={(status, title) => {
            setScriptRunning(false);
            toast({
              title: status === "completed" ? `Script completed: ${title}` : `Script failed: ${title}`,
              description: status === "completed"
                ? "The runbook finished successfully. The card has been moved to Done."
                : "The runbook encountered an error. The card remains In Progress.",
              variant: status === "failed" ? "destructive" : "default",
            });
          }}
        />
      )}
    </div>
  );
}

function CardOverlay({ task }: { task: KanbanTask }) {
  return (
    <div className="bg-[#161B22] border border-[#0078D4] rounded-lg p-2.5 text-xs shadow-xl rotate-1 opacity-90 w-52">
      <PriorityBadge priority={task.priority} />
      <p className="font-semibold text-[#E6EDF3] mt-1">{task.title}</p>
      {task.assignedTo && <p className="text-muted-foreground text-[10px] mt-0.5">{task.assignedTo}</p>}
    </div>
  );
}

function DroppableColumn({
  col, tasks, onDelete, projectId, isOver, steps, onQuickMove, onCardClick, onReply, clientUserId, clientName,
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
  clientUserId?: number | null;
  clientName?: string | null;
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
      className={`rounded-xl p-3 transition-colors border-l-4 ${COLUMN_HEADER_ACCENT[col.key] ?? "border-l-gray-200"} ${isOver ? "bg-[#0078D4]/10 border border-[#0078D4]/30" : "bg-[#1C2128] border border-border"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-[#E6EDF3] uppercase tracking-wider">
          {col.label}
        </p>
        <span className="text-[10px] font-semibold text-muted-foreground bg-[#161B22] border border-border rounded-full px-2 py-0.5">
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
            clientUserId={clientUserId}
            clientName={clientName}
          />
        ))}
      </div>
    </div>
  );
}

type PendingMove = { task: KanbanTask; targetColumn: ColumnKey };

function KanbanBoard({
  projectId, tasks, steps, onTasksChange, onDelete, fetchWithAuth, toast, onCardClick, onMutation, onDragStateChange, clientUserId, clientName,
}: {
  projectId: number;
  tasks: KanbanTask[];
  steps: WorkflowStep[];
  onTasksChange: (updater: (tasks: KanbanTask[]) => KanbanTask[]) => void;
  onDelete: (taskId: number, projectId: number) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  toast: ReturnType<typeof useToast>["toast"];
  onCardClick: (task: KanbanTask) => void;
  onMutation: () => void;
  onDragStateChange?: (draggingId: number | null) => void;
  clientUserId?: number | null;
  clientName?: string | null;
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
      onMutation();
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
    onDragStateChange?.(task.id);
  };

  const handleDragOver = (event: { over: { id: string | number } | null }) => {
    setOverColumnKey(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    setOverColumnKey(null);
    onDragStateChange?.(null);
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
      onMutation();
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
        <div className="overflow-x-auto">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 min-w-[480px]">
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
              clientUserId={clientUserId}
              clientName={clientName}
            />
          ))}
        </div>
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
            <p className="text-sm text-muted-foreground">Moving: <strong className="text-[#E6EDF3]">{pendingMove?.task.title}</strong></p>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">What are you waiting for from the customer? *</label>
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
            <button onClick={() => setPendingMove(null)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128]">
              Cancel
            </button>
            <button
              onClick={() => void confirmWaiting()}
              disabled={!waitingReason.trim() || modalSaving}
              className="bg-amber-500/100 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-amber-600 disabled:opacity-50"
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
            <p className="text-sm text-muted-foreground">Completing: <strong className="text-[#E6EDF3]">{pendingMove?.task.title}</strong></p>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Completion status *</label>
              <input
                autoFocus
                value={completionStatus}
                onChange={e => setCompletionStatus(e.target.value)}
                placeholder="e.g. Deployed successfully, All users migrated…"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Script output / results <span className="font-normal text-muted-foreground">(optional)</span></label>
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
            <button onClick={() => setPendingMove(null)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128]">
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
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">Project Closure &amp; Sign-Off</h2>
      </div>
      {!closure ? (
        <div className="bg-[#161B22] border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#E6EDF3]">No closure requested yet</p>
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
        <div className="bg-[#161B22] border border-green-500/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-green-400">Project signed off</p>
              <p className="text-xs text-muted-foreground">
                {new Date(closure.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                {closure.permissionGranted ? " · Testimonial permission granted" : " · No testimonial permission"}
              </p>
            </div>
          </div>
          {closure.feedback && (
            <blockquote className="border-l-4 border-[#0078D4] pl-4 text-sm text-[#E6EDF3]/80 italic leading-relaxed">
              "{closure.feedback}"
            </blockquote>
          )}
          {closure.signatureDataUrl && (
            <div className="mt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Client Signature</p>
              <img src={closure.signatureDataUrl} alt="Client signature" className="max-h-16 border border-border rounded bg-[#161B22]" />
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-500/100/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/100/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-400">Sign-off requested</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
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

  const { fetchWithAuth, accessToken } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [linkedEmails, setLinkedEmails] = useState<LinkedEmail[]>([]);
  const draggingIdRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);

  const completedTaskCount = tasks.filter(t => t.column === "completed").length;
  const computedProgress = tasks.length > 0
    ? Math.round(completedTaskCount / tasks.length * 100)
    : (project?.progress ?? 0);

  const [selectedTask, setSelectedTask] = useState<KanbanCardModalTask | null>(null);
  const [selectedStepTitle, setSelectedStepTitle] = useState<string | null>(null);

  const [addStepOpen, setAddStepOpen] = useState(false);
  const [stepForm, setStepForm] = useState({ title: "", description: "", status: "pending", dueDate: "" });
  const [stepSaving, setStepSaving] = useState(false);

  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({
    title: "", description: "", column: "backlog", assignedTo: "", priority: "",
    taskType: "",
    metaModules: "", metaEstimatedHours: "", metaPrerequisites: "", metaMaterialsUrl: "",
    metaHealthStatus: "", metaScriptName: "", metaLastRunDate: "", metaOutputSummary: "",
    metaPostureSummary: "", metaConfiguredItems: "",
    metaFlows: "",
    metaDocuments: "",
    metaRiskScore: "", metaFindingsSummary: "", metaRecommendations: "", metaAssessmentUrl: "",
  });
  const [taskSaving, setTaskSaving] = useState(false);

  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonImportText, setJsonImportText] = useState("");
  const [jsonImporting, setJsonImporting] = useState(false);

  const [editingStepDesc, setEditingStepDesc] = useState<Record<number, string>>({});
  const [savingStepDesc, setSavingStepDesc] = useState<Record<number, boolean>>({});

  const [deleteTaskTarget, setDeleteTaskTarget] = useState<{ taskId: number } | null>(null);
  const [statusReportOpen, setStatusReportOpen] = useState(false);

  const [spFolderCreating, setSpFolderCreating] = useState(false);
  const [generateArtifactsLoading, setGenerateArtifactsLoading] = useState(false);
  const [generateArtifactsError, setGenerateArtifactsError] = useState<string | null>(null);
  const [regeneratingArtifact, setRegeneratingArtifact] = useState<string | null>(null);
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false);
  const [confirmRegenerateTarget, setConfirmRegenerateTarget] = useState<string | null>(null);

  // AI Recommendations
  const [showAiRecs, setShowAiRecs] = useState(false);
  const [projectNba, setProjectNba] = useState<NbaAction[] | null>(null);
  const [projectNbaLoading, setProjectNbaLoading] = useState(false);
  const [projectNbaGenerating, setProjectNbaGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<{ count: number; total: number; currentName: string } | null>(null);
  const [artifactErrors, setArtifactErrors] = useState<Record<string, string>>({});
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftProgress, setDraftProgress] = useState<{ count: number; total: number; currentName: string } | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftStreamErrors, setDraftStreamErrors] = useState<Record<string, string>>({});
  const [selectedDraftName, setSelectedDraftName] = useState<string | null>(null);
  const [finalizeProgress, setFinalizeProgress] = useState<{ done: number; total: number } | null>(null);
  const [finalizeErrors, setFinalizeErrors] = useState<Record<string, string>>({});

  const allTasksClosed = tasks.length > 0 && tasks.every(t => t.column === "completed");

  const artifactNamesToGenerate = (): string[] => {
    const names = new Set<string>();
    for (const t of tasks) {
      const meta = (t.taskMetadata ?? {}) as Record<string, unknown>;
      for (const field of ["artifactsProduced", "clientDeliverables"] as const) {
        if (Array.isArray(meta[field])) {
          for (const n of meta[field] as string[]) {
            if (typeof n === "string" && n.trim()) names.add(n.trim());
          }
        }
      }
    }
    return Array.from(names);
  };

  const SONNET_INPUT_COST_PER_M  = 3;
  const SONNET_OUTPUT_COST_PER_M = 15;
  const EST_OUTPUT_TOKENS_PER_ARTIFACT = 600;
  const EST_PROMPT_OVERHEAD_CHARS = 250;

  const estimateArtifactCost = (names: string[]): {
    perArtifact: { tokens: number; costUsd: number };
    total: { tokens: number; costUsd: number };
  } | null => {
    if (names.length === 0 || !project) return null;
    const contextLines: string[] = [
      `Project: ${project.title}`,
      ...(project.description ? [`Description: ${project.description}`] : []),
      `Phase: ${project.phase ?? "N/A"}`,
      "",
      "Completed Tasks:",
    ];
    for (const t of tasks) {
      const meta = (t.taskMetadata ?? {}) as Record<string, unknown>;
      const parts = [`- [${t.taskType ?? "task"}] ${t.title}`];
      if (t.groupName) parts.push(`  Group: ${t.groupName}`);
      if (t.description) parts.push(`  Description: ${t.description}`);
      if (t.completionStatus) parts.push(`  Completion Status: ${t.completionStatus}`);
      if (t.completionNotes) parts.push(`  Completion Notes: ${t.completionNotes}`);
      const instructions = Array.isArray(meta.instructions) ? (meta.instructions as string[]) : [];
      if (instructions.length > 0) parts.push(`  Instructions: ${instructions.join("; ")}`);
      const checklist = Array.isArray(meta.checklist)
        ? (meta.checklist as Array<{ id: string; label: string }>)
        : [];
      if (checklist.length > 0) {
        for (const item of checklist) parts.push(`    [ ] ${item.label}`);
      }
      const artifactsProduced = Array.isArray(meta.artifactsProduced)
        ? (meta.artifactsProduced as string[])
        : [];
      if (artifactsProduced.length > 0) parts.push(`  Artifacts Produced: ${artifactsProduced.join(", ")}`);
      const clientDeliverables = Array.isArray(meta.clientDeliverables)
        ? (meta.clientDeliverables as string[])
        : [];
      if (clientDeliverables.length > 0) parts.push(`  Client Deliverables: ${clientDeliverables.join(", ")}`);
      contextLines.push(parts.join("\n"));
    }
    const contextChars = contextLines.join("\n").length;
    const inputTokensPerCall = Math.round((contextChars + EST_PROMPT_OVERHEAD_CHARS) / 4);
    const perArtifactTokens = inputTokensPerCall + EST_OUTPUT_TOKENS_PER_ARTIFACT;
    const perArtifactCost =
      (inputTokensPerCall * SONNET_INPUT_COST_PER_M +
        EST_OUTPUT_TOKENS_PER_ARTIFACT * SONNET_OUTPUT_COST_PER_M) /
      1_000_000;
    return {
      perArtifact: { tokens: perArtifactTokens, costUsd: perArtifactCost },
      total: { tokens: perArtifactTokens * names.length, costUsd: perArtifactCost * names.length },
    };
  };

  type SseEvent =
    | { type: "progress"; artifactName: string; count: number; total: number }
    | { type: "artifactDone"; artifactName: string; sharepointUrl: string }
    | { type: "artifactError"; artifactName: string; error: string }
    | { type: "done"; artifacts: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }>; errors?: string[] }
    | { type: "error"; error: string; details?: string[] };

  const handleGenerateArtifacts = async () => {
    if (!projectId) return;
    setGenerateArtifactsLoading(true);
    setGenerateArtifactsError(null);
    setGenerateProgress(null);
    setArtifactErrors({});
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${projectId}/generate-artifacts`, { method: "POST" });

      // Pre-flight JSON errors (4xx/5xx before SSE starts)
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        const data = await res.json() as { error?: string };
        setGenerateArtifactsError(data.error ?? "Unknown error");
        return;
      }

      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          const dataLine = message.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as SseEvent;

            if (event.type === "progress") {
              setGenerateProgress({ count: event.count, total: event.total, currentName: event.artifactName });
            } else if (event.type === "artifactError") {
              setArtifactErrors(prev => ({ ...prev, [event.artifactName]: event.error }));
            } else if (event.type === "done") {
              setGenerateProgress(null);
              setGenerateArtifactsError(null);
              setProject(prev => prev ? { ...prev, generatedArtifacts: event.artifacts } : prev);
              // Remove entries that succeeded from the error map
              setArtifactErrors(prev => {
                const next = { ...prev };
                for (const a of event.artifacts) delete next[a.artifactName];
                return next;
              });
              const errCount = event.errors?.length ?? 0;
              if (errCount > 0) {
                toast({ title: `${event.artifacts.length} artifact${event.artifacts.length !== 1 ? "s" : ""} generated`, description: `${errCount} failed — see Failed Artifacts below.` });
              } else {
                toast({ title: `${event.artifacts.length} artifact${event.artifacts.length !== 1 ? "s" : ""} generated`, description: "All PDFs uploaded to SharePoint." });
              }
            } else if (event.type === "error") {
              setGenerateProgress(null);
              setGenerateArtifactsError(event.error);
            }
          } catch {
            // malformed SSE line — ignore
          }
        }
      }
    } catch {
      setGenerateArtifactsError("Network error — could not reach the server.");
      setGenerateProgress(null);
    } finally {
      setGenerateArtifactsLoading(false);
      setGenerateProgress(null);
    }
  };

  const handleRegenerateArtifact = async (artifactName: string) => {
    if (!projectId) return;
    setRegeneratingArtifact(artifactName);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${projectId}/generate-artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactName }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        const data = await res.json() as { error?: string };
        toast({ title: "Regeneration failed", description: data.error ?? "Unknown error", variant: "destructive" });
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          const dataLine = message.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as SseEvent;
            if (event.type === "done") {
              setProject(prev => prev ? { ...prev, generatedArtifacts: event.artifacts } : prev);
              if (event.errors && event.errors.length > 0) {
                toast({ title: "Regeneration failed", description: event.errors[0], variant: "destructive" });
              } else {
                setArtifactErrors(prev => { const next = { ...prev }; delete next[artifactName]; return next; });
                toast({ title: "Artifact regenerated", description: `"${artifactName}" uploaded to SharePoint.` });
              }
            } else if (event.type === "error") {
              toast({ title: "Regeneration failed", description: event.error, variant: "destructive" });
            }
          } catch {
            // malformed SSE line — ignore
          }
        }
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setRegeneratingArtifact(null);
    }
  };

  type SseDraftEvent =
    | { type: "progress"; artifactName: string; count: number; total: number }
    | { type: "artifactDraft"; artifactName: string; markdown: string }
    | { type: "artifactError"; artifactName: string; error: string }
    | { type: "done"; drafts: Array<{ artifactName: string; markdown: string }>; errors?: string[] }
    | { type: "error"; error: string };

  const handleStartDrafting = async () => {
    if (!projectId) return;
    setDraftLoading(true);
    setDraftProgress(null);
    setDrafts({});
    setDraftStreamErrors({});
    setFinalizeErrors({});
    setGenerateArtifactsError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${projectId}/draft-artifacts`, { method: "POST" });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        const data = await res.json() as { error?: string };
        setGenerateArtifactsError(data.error ?? "Unknown error");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const accDrafts: Record<string, string> = {};
      const accErrors: Record<string, string> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";
        for (const message of messages) {
          const dataLine = message.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as SseDraftEvent;
            if (event.type === "progress") {
              setDraftProgress({ count: event.count, total: event.total, currentName: event.artifactName });
            } else if (event.type === "artifactDraft") {
              accDrafts[event.artifactName] = event.markdown;
              setDrafts({ ...accDrafts });
            } else if (event.type === "artifactError") {
              accErrors[event.artifactName] = event.error;
              setDraftStreamErrors({ ...accErrors });
            } else if (event.type === "done") {
              setDraftProgress(null);
              if (Object.keys(accDrafts).length > 0) {
                setDrafts({ ...accDrafts });
                setDraftStreamErrors({ ...accErrors });
                setSelectedDraftName(Object.keys(accDrafts)[0] ?? null);
                setDraftModalOpen(true);
              } else {
                setGenerateArtifactsError("All draft generations failed.");
              }
            } else if (event.type === "error") {
              setDraftProgress(null);
              setGenerateArtifactsError(event.error);
            }
          } catch { /* malformed SSE */ }
        }
      }
    } catch {
      setGenerateArtifactsError("Network error — could not reach the server.");
      setDraftProgress(null);
    } finally {
      setDraftLoading(false);
      setDraftProgress(null);
    }
  };

  const handleFinalizeAll = async () => {
    if (!projectId) return;
    const entries = Object.entries(drafts);
    if (entries.length === 0) return;
    setFinalizeProgress({ done: 0, total: entries.length });
    setFinalizeErrors({});
    let completed = 0;
    const newErrors: Record<string, string> = {};
    for (const [artifactName, markdown] of entries) {
      try {
        const res = await fetchWithAuth(`/api/admin/projects/${projectId}/finalize-artifact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactName, markdown }),
        });
        type FinalizeResult = { sharepointUrl?: string; artifacts?: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string }>; error?: string };
        const data = await res.json() as FinalizeResult;
        if (res.ok && data.artifacts) {
          setProject(prev => prev ? { ...prev, generatedArtifacts: data.artifacts! } : prev);
        } else {
          newErrors[artifactName] = data.error ?? "Failed to save";
        }
      } catch {
        newErrors[artifactName] = "Network error";
      }
      completed++;
      setFinalizeProgress({ done: completed, total: entries.length });
    }
    setFinalizeErrors(newErrors);
    setFinalizeProgress(null);
    if (Object.keys(newErrors).length === 0) {
      setDraftModalOpen(false);
      setDrafts({});
      toast({ title: `${entries.length} artifact${entries.length !== 1 ? "s" : ""} saved as PDF${entries.length !== 1 ? "s" : ""}`, description: "All PDFs uploaded to SharePoint." });
    } else if (Object.keys(newErrors).length < entries.length) {
      const ok = entries.length - Object.keys(newErrors).length;
      toast({ title: `${ok} of ${entries.length} artifacts saved`, description: `${Object.keys(newErrors).length} failed — see editor for details.` });
    } else {
      toast({ title: "All artifacts failed to save", description: "Check the editor for error details.", variant: "destructive" });
    }
  };

  const handleCreateSharePointFolder = async () => {
    if (!projectId) return;
    setSpFolderCreating(true);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${projectId}/sharepoint-folder`, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { sharepointFolderUrl: string };
        setProject(prev => prev ? { ...prev, sharepointFolderUrl: data.sharepointFolderUrl } : prev);
        toast({ title: "SharePoint folder created", description: "The project folder is ready in SharePoint." });
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: "Failed to create folder", description: err.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setSpFolderCreating(false);
    }
  };

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    if (!projectId) return;
    setAuditLoading(true);
    try {
      const res = await fetchWithAuth(`/api/audit-logs?projectId=${projectId}&limit=10`);
      if (res.ok) {
        const data = await res.json() as { entries: AuditLogEntry[] };
        setAuditLogs(data.entries);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [projectId, fetchWithAuth]);

  const loadProjectNba = useCallback(async () => {
    if (!projectId) return;
    setProjectNbaLoading(true);
    try {
      const res = await fetchWithAuth(`/api/ai/next-best-actions?entityType=project&entityId=${projectId}`);
      if (res.ok) setProjectNba(await res.json() as NbaAction[]);
    } catch { /* non-fatal */ }
    finally { setProjectNbaLoading(false); }
  }, [fetchWithAuth, projectId]);

  const generateProjectNba = useCallback(async () => {
    if (!projectId) return;
    setProjectNbaGenerating(true);
    try {
      const res = await fetchWithAuth("/api/ai/next-best-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "project", entityId: projectId }),
      });
      if (res.ok) await loadProjectNba();
    } catch { /* non-fatal */ }
    finally { setProjectNbaGenerating(false); }
  }, [fetchWithAuth, projectId, loadProjectNba]);

  const resolveProjectNba = useCallback(async (id: number) => {
    const res = await fetchWithAuth(`/api/ai/next-best-actions/${id}/resolve`, { method: "POST" });
    if (res.ok) setProjectNba(prev => prev?.filter(a => a.id !== id) ?? null);
  }, [fetchWithAuth]);

  useEffect(() => {
    if (showAiRecs && projectId) void loadProjectNba();
  }, [showAiRecs, projectId, loadProjectNba]);

  const handleToggleAudit = () => {
    if (!auditOpen && auditLogs.length === 0) {
      void loadAuditLogs();
    }
    setAuditOpen(o => !o);
  };

  const reloadAll = useCallback(async () => {
    if (!projectId) return;
    const [projRes, stepsRes, tasksRes, clientsRes, emailsRes] = await Promise.all([
      fetchWithAuth(`/api/admin/projects/${projectId}`),
      fetchWithAuth(`/api/admin/workflow-steps?projectId=${projectId}`),
      fetchWithAuth(`/api/admin/kanban-tasks?projectId=${projectId}`),
      fetchWithAuth("/api/admin/clients"),
      fetchWithAuth(`/api/admin/projects/${projectId}/emails`),
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
    if (emailsRes.ok) {
      const data = await emailsRes.json() as { emails: LinkedEmail[] };
      setLinkedEmails(data.emails);
    }
    setLoading(false);
  }, [projectId, fetchWithAuth]);

  useEffect(() => { void reloadAll(); }, [reloadAll]);

  // ─── Kanban real-time SSE subscription ─────────────────────────────────────
  const reloadAllRef = useRef(reloadAll);
  reloadAllRef.current = reloadAll;

  useEffect(() => {
    if (!projectId || !accessToken) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;
      es = new EventSource(`/api/admin/projects/${projectId}/kanban-events?token=${encodeURIComponent(accessToken)}`);

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as { action: string; task: KanbanTask & { id: number } };
          backoff = 1000;
          const { action, task } = payload;
          if (action === "updated") {
            if (draggingIdRef.current === task.id) return;
            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...task } : t));
          } else if (action === "created") {
            setTasks(prev => prev.some(t => t.id === task.id) ? prev : [...prev, task]);
          } else if (action === "deleted") {
            setTasks(prev => prev.filter(t => t.id !== task.id));
          }
        } catch { /* ignore malformed events */ }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!mounted) return;
        reconnectTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, 30_000);
          void reloadAllRef.current();
          connect();
        }, backoff);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [projectId, accessToken]); // reloadAll accessed via ref above

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
    void loadAuditLogs();
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

  const buildTaskMetadata = (form: typeof taskForm): Record<string, unknown> | null => {
    if (!form.taskType) return null;
    switch (form.taskType) {
      case "training": {
        const modules = form.metaModules.trim()
          ? form.metaModules.split("\n").map(l => l.trim()).filter(Boolean).map(name => ({ name, completed: false }))
          : [];
        return {
          ...(modules.length && { modules }),
          ...(form.metaEstimatedHours && { estimatedHours: parseFloat(form.metaEstimatedHours) }),
          ...(form.metaPrerequisites.trim() && { prerequisites: form.metaPrerequisites.trim() }),
          ...(form.metaMaterialsUrl.trim() && { materialsUrl: form.metaMaterialsUrl.trim() }),
        };
      }
      case "environmentHealthCheck":
        return {
          ...(form.metaHealthStatus && { healthStatus: form.metaHealthStatus }),
          ...(form.metaScriptName.trim() && { scriptName: form.metaScriptName.trim() }),
          ...(form.metaLastRunDate && { lastRunDate: form.metaLastRunDate }),
          ...(form.metaOutputSummary.trim() && { outputSummary: form.metaOutputSummary.trim() }),
        };
      case "governanceSetup": {
        const configuredItems = form.metaConfiguredItems.trim()
          ? form.metaConfiguredItems.split("\n").map(l => l.trim()).filter(Boolean)
          : [];
        return {
          ...(form.metaPostureSummary.trim() && { postureSummary: form.metaPostureSummary.trim() }),
          ...(configuredItems.length && { configuredItems }),
        };
      }
      case "automationBuild": {
        const flows = form.metaFlows.trim()
          ? form.metaFlows.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
              const [name, status] = line.split("|").map(s => s.trim());
              return { name: name ?? line, status: (status ?? "building") as "building" | "testing" | "live" | "error" };
            })
          : [];
        return { ...(flows.length && { flows }) };
      }
      case "documentDelivery": {
        const documents = form.metaDocuments.trim()
          ? form.metaDocuments.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
              const [name, version, status] = line.split("|").map(s => s.trim());
              return { name: name ?? line, ...(version && { version }), approvalStatus: (status ?? "pending") as "pending" | "approved" | "revision_requested" };
            })
          : [];
        return { ...(documents.length && { documents }) };
      }
      case "discovery": {
        const recommendations = form.metaRecommendations.trim()
          ? form.metaRecommendations.split("\n").map(l => l.trim()).filter(Boolean)
          : [];
        return {
          ...(form.metaRiskScore && { riskScore: form.metaRiskScore }),
          ...(form.metaFindingsSummary.trim() && { findingsSummary: form.metaFindingsSummary.trim() }),
          ...(recommendations.length && { recommendations }),
          ...(form.metaAssessmentUrl.trim() && { assessmentUrl: form.metaAssessmentUrl.trim() }),
        };
      }
      default: return null;
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title.trim() || !projectId) return;
    setTaskSaving(true);
    const taskMetadata = buildTaskMetadata(taskForm);
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
        taskType: taskForm.taskType || null,
        taskMetadata,
      }),
    });
    if (res.ok) {
      const newTask = await res.json() as KanbanTask;
      setTasks(prev => [...prev, newTask]);
      setAddTaskOpen(false);
      setTaskForm({
        title: "", description: "", column: "backlog", assignedTo: "", priority: "",
        taskType: "",
        metaModules: "", metaEstimatedHours: "", metaPrerequisites: "", metaMaterialsUrl: "",
        metaHealthStatus: "", metaScriptName: "", metaLastRunDate: "", metaOutputSummary: "",
        metaPostureSummary: "", metaConfiguredItems: "",
        metaFlows: "",
        metaDocuments: "",
        metaRiskScore: "", metaFindingsSummary: "", metaRecommendations: "", metaAssessmentUrl: "",
      });
      void loadAuditLogs();
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
    void loadAuditLogs();
    setStepSaving(false);
  };

  const handleUpdateStepStatus = async (stepId: number, status: string) => {
    await fetchWithAuth(`/api/admin/workflow-steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, status } : s));
    void loadAuditLogs();
    // When a phase goes in_progress the server seeds its template tasks into the backlog — reload them
    if (status === "in_progress" && projectId) {
      const tasksRes = await fetchWithAuth(`/api/admin/kanban-tasks?projectId=${projectId}`);
      if (tasksRes.ok) setTasks(await tasksRes.json() as KanbanTask[]);
    }
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
    void loadAuditLogs();
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
      void loadAuditLogs();
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
    <div className="p-4 sm:p-6 max-w-[1400px]">
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
              <h1 className="text-2xl font-bold text-[#E6EDF3]">{project.title}</h1>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                project.status === "active" ? "bg-green-500/15 text-green-400"
                : project.status === "on_hold" ? "bg-yellow-500/15 text-yellow-400"
                : "bg-[#0078D4]/100/15 text-blue-400"
              }`}>
                {project.status.replace("_", " ")}
              </span>
              {project.phase && (
                <span className="text-xs text-muted-foreground bg-[#1C2128] border border-border rounded px-2 py-0.5">{project.phase}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-muted-foreground">{clientLabel}</p>
              {client && (
                <button
                  onClick={() => navigate(`/crm/clients/${client.id}`)}
                  className="text-xs font-semibold text-[#0078D4] hover:underline"
                >
                  Open Client →
                </button>
              )}
            </div>
            {project.description && (
              <p className="text-sm text-[#E6EDF3]/70 mt-1 max-w-2xl">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <button
              onClick={handleExportJson}
              className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16v2a2 2 0 002 2h6a2 2 0 002-2v-2M9 12l3-3 3 3M12 21V9" />
              </svg>
              Export JSON
            </button>
            <button
              onClick={() => { setJsonImportOpen(true); setJsonImportText(""); }}
              className="flex items-center gap-1.5 border border-border text-sm font-medium px-3 py-2 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
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
          <div className="flex-1 bg-[#1C2128] rounded-full h-2 border border-border max-w-xs">
            <div className="h-2 rounded-full bg-[#0078D4] transition-all" style={{ width: `${computedProgress}%` }} />
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{computedProgress}% complete</span>
          {project.endDate && (
            <span className="text-xs text-muted-foreground ml-2">
              Target: {new Date(project.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      </div>

      {/* ── SharePoint Folder ──────────────────────────────────────────── */}
      {client?.sharepointSiteId && (
        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3] mb-3">SharePoint Folder</h2>
          <div className="bg-[#161B22] border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </div>
            {project.sharepointFolderUrl ? (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">Project folder in SharePoint</p>
                <a
                  href={project.sharepointFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[#0078D4] hover:underline truncate block"
                >
                  Open in SharePoint ↗
                </a>
              </div>
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-1">No SharePoint folder yet</p>
                <p className="text-xs text-[#E6EDF3]/60">Create a dedicated folder for this project's documents.</p>
              </div>
            )}
            {!project.sharepointFolderUrl && (
              <button
                onClick={() => void handleCreateSharePointFolder()}
                disabled={spFolderCreating}
                className="flex items-center gap-1.5 bg-[#0078D4] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
              >
                {spFolderCreating ? (
                  <>
                    <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Create SharePoint Folder
                  </>
                )}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Kanban Board ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">Kanban Board</h2>
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
          <div className="bg-[#161B22] border border-border rounded-xl p-4 mb-4">
            <h4 className="text-xs font-bold text-[#E6EDF3] mb-3">New Task</h4>
            <form onSubmit={e => void handleAddTask(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Title *</label>
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
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={taskForm.description}
                  onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="Optional description…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Column</label>
                <select
                  value={taskForm.column}
                  onChange={e => setTaskForm(f => ({ ...f, column: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
                >
                  <option value="backlog">Backlog</option>
                  <option value="in_progress">In Progress</option>
                  <option value="waiting_on_customer">Waiting</option>
                  <option value="completed">Done</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Priority</label>
                <select
                  value={taskForm.priority}
                  onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Assignee</label>
                <input
                  value={taskForm.assignedTo}
                  onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="Name or email…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Task Type <span className="font-normal text-muted-foreground">(optional)</span></label>
                <select
                  value={taskForm.taskType}
                  onChange={e => setTaskForm(f => ({ ...f, taskType: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
                >
                  <option value="">— Generic task —</option>
                  {(Object.entries(TASK_TYPE_CONFIG) as [TaskType, typeof TASK_TYPE_CONFIG[TaskType]][]).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.icon} {cfg.label}</option>
                  ))}
                </select>
              </div>
              {taskForm.taskType === "training" && (
                <div className="sm:col-span-2 border border-purple-200 bg-purple-50/50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-purple-700">🎓 Training Details</p>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Modules <span className="font-normal text-muted-foreground">(one per line)</span></label>
                    <textarea rows={3} value={taskForm.metaModules} onChange={e => setTaskForm(f => ({ ...f, metaModules: e.target.value }))} placeholder={"Intro to Microsoft 365\nTeams Setup & Best Practices\nSharePoint Fundamentals"} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-[#1C2128] text-[#E6EDF3] resize-none" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Estimated hours</label>
                      <input type="number" value={taskForm.metaEstimatedHours} onChange={e => setTaskForm(f => ({ ...f, metaEstimatedHours: e.target.value }))} placeholder="4" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-[#1C2128] text-[#E6EDF3]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Materials URL</label>
                      <input value={taskForm.metaMaterialsUrl} onChange={e => setTaskForm(f => ({ ...f, metaMaterialsUrl: e.target.value }))} placeholder="https://…" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-[#1C2128] text-[#E6EDF3]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Prerequisites</label>
                    <input value={taskForm.metaPrerequisites} onChange={e => setTaskForm(f => ({ ...f, metaPrerequisites: e.target.value }))} placeholder="Azure AD account, M365 license" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-[#1C2128] text-[#E6EDF3]" />
                  </div>
                </div>
              )}
              {taskForm.taskType === "environmentHealthCheck" && (
                <div className="sm:col-span-2 border border-green-500/20 bg-green-500/10 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-green-400">🔍 Health Check Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Health status</label>
                      <select value={taskForm.metaHealthStatus} onChange={e => setTaskForm(f => ({ ...f, metaHealthStatus: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-[#161B22]">
                        <option value="">Select…</option>
                        <option value="healthy">✓ Healthy</option>
                        <option value="warning">⚠ Warning</option>
                        <option value="critical">✖ Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Script name</label>
                      <input value={taskForm.metaScriptName} onChange={e => setTaskForm(f => ({ ...f, metaScriptName: e.target.value }))} placeholder="run-m365-health.ps1" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Last run date</label>
                    <input type="date" value={taskForm.metaLastRunDate} onChange={e => setTaskForm(f => ({ ...f, metaLastRunDate: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Output summary</label>
                    <textarea rows={2} value={taskForm.metaOutputSummary} onChange={e => setTaskForm(f => ({ ...f, metaOutputSummary: e.target.value }))} placeholder="All 47 checks passed. 2 warnings noted…" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 resize-none" />
                  </div>
                </div>
              )}
              {taskForm.taskType === "governanceSetup" && (
                <div className="sm:col-span-2 border border-[#0078D4]/20 bg-[#0078D4]/10/50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">🛡️ Governance Details</p>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Posture summary</label>
                    <textarea rows={2} value={taskForm.metaPostureSummary} onChange={e => setTaskForm(f => ({ ...f, metaPostureSummary: e.target.value }))} placeholder="DLP and sensitivity labels configured across all M365 workloads…" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Configured items <span className="font-normal text-muted-foreground">(one per line)</span></label>
                    <textarea rows={3} value={taskForm.metaConfiguredItems} onChange={e => setTaskForm(f => ({ ...f, metaConfiguredItems: e.target.value }))} placeholder={"Confidential sensitivity label\nExternal sharing DLP policy\nMFA conditional access"} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                  </div>
                </div>
              )}
              {taskForm.taskType === "automationBuild" && (
                <div className="sm:col-span-2 border border-orange-200 bg-orange-50/50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700">⚡ Automation Details</p>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Flows <span className="font-normal text-muted-foreground">(one per line: "Flow Name | live/testing/building/error")</span></label>
                    <textarea rows={3} value={taskForm.metaFlows} onChange={e => setTaskForm(f => ({ ...f, metaFlows: e.target.value }))} placeholder={"Approval Request Flow | live\nNew Hire Onboarding | testing\nExpense Approval | building"} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none font-mono text-xs" />
                  </div>
                </div>
              )}
              {taskForm.taskType === "documentDelivery" && (
                <div className="sm:col-span-2 border border-amber-500/20 bg-amber-500/100/100/10 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">📄 Document Details</p>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Documents <span className="font-normal text-muted-foreground">(one per line: "Name | version | pending/approved")</span></label>
                    <textarea rows={3} value={taskForm.metaDocuments} onChange={e => setTaskForm(f => ({ ...f, metaDocuments: e.target.value }))} placeholder={"M365 Governance Policy | v1.0 | pending\nSharePoint Architecture Diagram | v2.1 | approved\nTraining Guide | v1.0 | pending"} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none font-mono text-xs" />
                  </div>
                </div>
              )}
              {taskForm.taskType === "discovery" && (
                <div className="sm:col-span-2 border border-pink-200 bg-pink-50/50 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-pink-700">🔬 Discovery Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Risk score</label>
                      <select value={taskForm.metaRiskScore} onChange={e => setTaskForm(f => ({ ...f, metaRiskScore: e.target.value }))} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 bg-[#161B22]">
                        <option value="">Select…</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Assessment URL</label>
                      <input value={taskForm.metaAssessmentUrl} onChange={e => setTaskForm(f => ({ ...f, metaAssessmentUrl: e.target.value }))} placeholder="https://…" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Findings summary</label>
                    <textarea rows={2} value={taskForm.metaFindingsSummary} onChange={e => setTaskForm(f => ({ ...f, metaFindingsSummary: e.target.value }))} placeholder="Current tenant has 3 critical gaps in DLP coverage…" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Recommendations <span className="font-normal text-muted-foreground">(one per line)</span></label>
                    <textarea rows={3} value={taskForm.metaRecommendations} onChange={e => setTaskForm(f => ({ ...f, metaRecommendations: e.target.value }))} placeholder={"Enable MFA for all admin accounts\nDeploy Purview DLP across Exchange + SharePoint\nConduct phishing simulation"} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 resize-none" />
                  </div>
                </div>
              )}
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
                  className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128]"
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
          onMutation={loadAuditLogs}
          onDragStateChange={(id) => { draggingIdRef.current = id; }}
          clientUserId={project?.clientUserId}
          clientName={client?.name ?? null}
        />
      </section>

      {/* ── Generated Artifacts ────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">Generated Artifacts</h2>
          <div className="relative group">
            <button
              onClick={() => setConfirmGenerateOpen(true)}
              disabled={generateArtifactsLoading || !allTasksClosed}
              className="flex items-center gap-1.5 bg-[#0A2540] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0A2540]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generateArtifactsLoading ? (
                <>
                  <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Generate Artifacts
                </>
              )}
            </button>
            {!allTasksClosed && (
              <div className="absolute right-0 top-full mt-1.5 z-10 hidden group-hover:block w-56 bg-[#0A2540] text-white text-[11px] leading-snug rounded-lg px-3 py-2 shadow-lg pointer-events-none">
                Complete all kanban tasks first to enable artifact generation.
              </div>
            )}
          </div>
        </div>

        {/* ── Draft progress bar ── */}
        {draftProgress && (
          <div className="mb-4 bg-[#1C2128] border border-[#0078D4]/30 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#E6EDF3]">
                Drafting {draftProgress.count} of {draftProgress.total}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {Math.round((draftProgress.count / draftProgress.total) * 100)}%
              </p>
            </div>
            <div className="w-full h-2 bg-[#0A2540]/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(draftProgress.count / draftProgress.total) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground truncate">
              <span className="font-medium text-[#E6EDF3]">{draftProgress.currentName}</span>
            </p>
          </div>
        )}

        {/* ── Live progress bar ── */}
        {generateProgress && (
          <div className="mb-4 bg-[#1C2128] border border-[#0078D4]/30 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[#E6EDF3]">
                Generating {generateProgress.count} of {generateProgress.total}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {Math.round((generateProgress.count / generateProgress.total) * 100)}%
              </p>
            </div>
            <div className="w-full h-2 bg-[#0A2540]/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(generateProgress.count / generateProgress.total) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground truncate">
              <span className="font-medium text-[#E6EDF3]">{generateProgress.currentName}</span>
            </p>
          </div>
        )}

        {generateArtifactsError && (
          <div className="mb-4 flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-400">Generation failed</p>
              <p className="text-xs text-red-400 mt-0.5">{generateArtifactsError}</p>
              <p className="text-xs text-red-400 mt-1.5">
                If this is a credentials or SharePoint error, check{" "}
                <a href="/admin-panel/settings" className="underline font-semibold">Settings → Microsoft 365</a>
                {" "}and ensure <code className="font-mono bg-red-500/10 px-0.5 rounded text-red-300">GRAPH_CLIENT_ID</code>,{" "}
                <code className="font-mono bg-red-500/10 px-0.5 rounded text-red-300">GRAPH_CLIENT_SECRET</code>, and{" "}
                <code className="font-mono bg-red-500/10 px-0.5 rounded text-red-300">GRAPH_TENANT_ID</code> are set in Replit Secrets, and the client has a SharePoint site ID configured.
              </p>
            </div>
          </div>
        )}

        {(() => {
          const successList = project.generatedArtifacts ?? [];
          const errorEntries = Object.entries(artifactErrors);
          const hasContent = successList.length > 0 || errorEntries.length > 0;
          if (!hasContent) {
            return (
              <div className="bg-[#1C2128] border border-border rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">
                {allTasksClosed
                  ? "No artifacts generated yet. Click Generate Artifacts to create PDFs from the project's task metadata."
                  : "Artifacts are generated when all kanban tasks are completed."}
              </div>
            );
          }
          return (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden divide-y divide-border">
              {successList.map(artifact => {
                const isRegenerating = regeneratingArtifact === artifact.artifactName;
                return (
                  <div key={artifact.artifactName} className="flex items-center gap-3 px-4 py-3 hover:bg-[#1C2128]/70 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#E6EDF3] truncate">{artifact.artifactName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Generated {new Date(artifact.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setConfirmRegenerateTarget(artifact.artifactName)}
                        disabled={isRegenerating || !!regeneratingArtifact || generateArtifactsLoading}
                        title="Regenerate this artifact"
                        className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isRegenerating ? (
                          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                        )}
                        {isRegenerating ? "Regenerating…" : "Regenerate"}
                      </button>
                      <a
                        href={artifact.sharepointUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:underline"
                      >
                        Open in SharePoint ↗
                      </a>
                    </div>
                  </div>
                );
              })}
              {errorEntries.map(([artifactName, errorMsg]) => {
                const isRetrying = regeneratingArtifact === artifactName;
                return (
                  <div key={`err-${artifactName}`} className="flex items-start gap-3 px-4 py-3 bg-red-500/10/60 hover:bg-red-500/10 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-red-400 truncate">{artifactName}</p>
                        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide bg-red-500/15 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">Failed</span>
                      </div>
                      <p className="text-[11px] text-red-400 mt-0.5 line-clamp-2">{errorMsg}</p>
                    </div>
                    <button
                      onClick={() => void handleRegenerateArtifact(artifactName)}
                      disabled={isRetrying || !!regeneratingArtifact || generateArtifactsLoading}
                      className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:text-red-900 border border-red-300 hover:border-red-400 bg-[#161B22] rounded-lg px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-0.5"
                    >
                      {isRetrying ? (
                        <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                        </svg>
                      )}
                      {isRetrying ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── Confirm: Generate All Artifacts ─────────────────────────── */}
        <AlertDialog open={confirmGenerateOpen} onOpenChange={setConfirmGenerateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Generate All Artifacts?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    The AI will draft each artifact below as Markdown. A review editor will open so you can edit before any PDF is saved to SharePoint.
                    {project.generatedArtifacts && project.generatedArtifacts.length > 0 && (
                      <span className="block mt-1 text-amber-400 font-medium">Existing PDFs will only be overwritten if you save the reviewed drafts.</span>
                    )}
                  </p>
                  {(() => {
                    const names = artifactNamesToGenerate();
                    const estimate = estimateArtifactCost(names);
                    const fmtCost = (c: number) =>
                      c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`;
                    return names.length > 0 ? (
                      <>
                        <ul className="text-sm text-foreground space-y-0 border border-border rounded-lg overflow-hidden bg-[#1C2128] divide-y divide-border">
                          {names.map(n => (
                            <li key={n} className="flex items-center justify-between gap-2 px-3 py-2">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                                <span className="truncate">{n}</span>
                              </span>
                              {estimate && (
                                <span className="flex-shrink-0 text-[10px] text-muted-foreground font-medium tabular-nums whitespace-nowrap">
                                  ~{estimate.perArtifact.tokens.toLocaleString()} tok · {fmtCost(estimate.perArtifact.costUsd)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {estimate && names.length > 1 && (
                          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/100/10 px-3 py-2">
                            <svg className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-[11px] text-amber-400">
                              Total estimated AI spend:{" "}
                              <span className="font-semibold">~{estimate.total.tokens.toLocaleString()} tokens</span>
                              {" · "}
                              <span className="font-semibold">~{fmtCost(estimate.total.costUsd)}</span>
                              {" "}({names.length} artifacts × claude-sonnet-4-6)
                            </p>
                          </div>
                        )}
                        {estimate && names.length === 1 && (
                          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/100/10 px-3 py-2">
                            <svg className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-[11px] text-amber-400">
                              Estimated AI spend:{" "}
                              <span className="font-semibold">~{estimate.total.tokens.toLocaleString()} tokens</span>
                              {" · "}
                              <span className="font-semibold">~{fmtCost(estimate.total.costUsd)}</span>
                              {" "}(claude-sonnet-4-6)
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No artifact names found in task metadata yet.
                      </p>
                    );
                  })()}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#0A2540] hover:bg-[#0A2540]/90 text-white"
                onClick={() => void handleStartDrafting()}
              >
                Draft & Review
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Confirm: Regenerate Single Artifact ─────────────────────── */}
        <AlertDialog
          open={confirmRegenerateTarget !== null}
          onOpenChange={open => { if (!open) setConfirmRegenerateTarget(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate "{confirmRegenerateTarget}"?</AlertDialogTitle>
              <AlertDialogDescription>
                The AI will produce a new PDF for this artifact and upload it to SharePoint,
                overwriting the existing file. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#0A2540] hover:bg-[#0A2540]/90 text-white"
                onClick={() => {
                  if (confirmRegenerateTarget) {
                    void handleRegenerateArtifact(confirmRegenerateTarget);
                    setConfirmRegenerateTarget(null);
                  }
                }}
              >
                Regenerate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Draft Review Modal ─────────────────────────────────────────── */}
        <Dialog
          open={draftModalOpen}
          onOpenChange={open => {
            if (!open && !finalizeProgress) {
              setDraftModalOpen(false);
              setDrafts({});
              setDraftStreamErrors({});
              setFinalizeErrors({});
            }
          }}
        >
          <DialogContent className="max-w-5xl flex flex-col" style={{ height: "82vh", maxHeight: "82vh" }}>
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Review &amp; Edit Artifact Drafts</DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Edit the AI-drafted Markdown below. Click <strong>Save as PDFs</strong> when ready — each artifact will be rendered and uploaded to SharePoint.
              </p>
            </DialogHeader>

            <div className="flex gap-4 flex-1 min-h-0 overflow-hidden mt-4">
              {/* Sidebar — artifact list */}
              <div className="w-52 flex-shrink-0 border border-border rounded-xl overflow-y-auto bg-[#1C2128]">
                {Object.keys(drafts).map(name => {
                  const hasFinalizeError = !!finalizeErrors[name];
                  return (
                    <button
                      key={name}
                      onClick={() => setSelectedDraftName(name)}
                      className={`w-full text-left px-3 py-2.5 text-xs font-semibold border-b border-border last:border-b-0 transition-colors ${
                        selectedDraftName === name
                          ? "bg-[#0078D4] text-white"
                          : hasFinalizeError
                          ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          : "text-[#E6EDF3] hover:bg-[#0078D4]/10"
                      }`}
                    >
                      <span className="block truncate">{name}</span>
                      {hasFinalizeError && (
                        <span className={`block text-[10px] font-normal mt-0.5 ${selectedDraftName === name ? "text-red-200" : "text-red-500"}`}>
                          Failed to save
                        </span>
                      )}
                    </button>
                  );
                })}
                {Object.entries(draftStreamErrors).map(([name]) => (
                  <div key={`derr-${name}`} className="px-3 py-2.5 text-xs border-b border-border last:border-b-0 bg-red-500/10">
                    <span className="block truncate font-semibold text-red-400">{name}</span>
                    <span className="block text-[10px] text-red-500 font-normal">Draft failed</span>
                  </div>
                ))}
              </div>

              {/* Markdown editor */}
              <div className="flex-1 flex flex-col min-h-0">
                {selectedDraftName && drafts[selectedDraftName] !== undefined ? (
                  <>
                    <div className="flex items-center justify-between mb-2 flex-shrink-0">
                      <h3 className="text-sm font-bold text-[#E6EDF3] truncate">{selectedDraftName}</h3>
                      <span className="text-[11px] text-muted-foreground ml-3 flex-shrink-0">Markdown</span>
                    </div>
                    <textarea
                      className="flex-1 w-full font-mono text-xs border border-border rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
                      value={drafts[selectedDraftName]}
                      onChange={e => {
                        const name = selectedDraftName;
                        if (name) setDrafts(prev => ({ ...prev, [name]: e.target.value }));
                      }}
                      disabled={!!finalizeProgress}
                    />
                    {finalizeErrors[selectedDraftName] && (
                      <p className="mt-2 text-xs text-red-400 flex-shrink-0">
                        <span className="font-semibold">Save failed:</span> {finalizeErrors[selectedDraftName]}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    Select an artifact on the left to review and edit.
                  </div>
                )}
              </div>
            </div>

            {/* Finalize progress bar */}
            {finalizeProgress && (
              <div className="mt-4 flex-shrink-0 bg-[#1C2128] border border-[#0078D4]/30 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-[#E6EDF3]">
                    Saving {finalizeProgress.done} of {finalizeProgress.total}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {Math.round((finalizeProgress.done / finalizeProgress.total) * 100)}%
                  </p>
                </div>
                <div className="w-full h-1.5 bg-[#0A2540]/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8] rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${(finalizeProgress.done / finalizeProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <DialogFooter className="mt-4 flex-shrink-0">
              <button
                onClick={() => {
                  if (!finalizeProgress) {
                    setDraftModalOpen(false);
                    setDrafts({});
                    setDraftStreamErrors({});
                    setFinalizeErrors({});
                  }
                }}
                disabled={!!finalizeProgress}
                className="px-4 py-2 text-sm font-semibold text-[#E6EDF3] border border-border rounded-lg hover:bg-[#1C2128] transition-colors disabled:opacity-40"
              >
                Discard Drafts
              </button>
              <button
                onClick={() => void handleFinalizeAll()}
                disabled={!!finalizeProgress || Object.keys(drafts).length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#0A2540] text-white rounded-lg hover:bg-[#0A2540]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {finalizeProgress ? (
                  <>
                    <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
                    Saving PDFs…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Save {Object.keys(drafts).length} artifact{Object.keys(drafts).length !== 1 ? "s" : ""} as PDF{Object.keys(drafts).length !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      {/* ── Workflow Phases & Milestones ───────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">Workflow Phases &amp; Milestones</h2>
        </div>

        {addStepOpen && (
          <div className="bg-[#161B22] border border-border rounded-xl p-4 mb-4">
            <h4 className="text-xs font-bold text-[#E6EDF3] mb-3">New Step</h4>
            <form onSubmit={e => void handleAddStep(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Phase Name *</label>
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
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={stepForm.description}
                  onChange={e => setStepForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="What happens in this phase…"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Status</label>
                <select
                  value={stepForm.status}
                  onChange={e => setStepForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Expected Due Date</label>
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
                  className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {steps.length === 0 ? (
          <div className="bg-[#161B22] border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
            No workflow steps yet. Click <strong>Add Step</strong> to create the first phase.
          </div>
        ) : (
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1C2128] border-b border-border">
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
                    <tr key={step.id} className="hover:bg-[#1C2128]/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#E6EDF3] leading-snug">{step.title}</p>
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
                                className="text-[10px] font-medium text-muted-foreground px-2 py-1 rounded hover:bg-[#1C2128] border border-border"
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
                          className="text-red-400 hover:text-red-400 transition-colors"
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

      {/* ── Linked Emails ──────────────────────────────────────────────────── */}
      {linkedEmails.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3] mb-4">Linked Emails</h2>
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden divide-y divide-border">
            {linkedEmails.map(email => {
              const displayName = email.rawFrom
                ? email.rawFrom.replace(/^"?(.*?)"?\s*<.*>$/, "$1").trim() || email.senderAddress
                : email.senderAddress;
              return (
                <div key={email.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#1C2128]/60 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-[#E6EDF3] truncate">
                        {email.subject ?? "(no subject)"}
                      </p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {new Date(email.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {displayName !== email.senderAddress
                        ? <><span className="font-medium text-[#E6EDF3]/70">{displayName}</span> &lt;{email.senderAddress}&gt;</>
                        : email.senderAddress}
                    </p>
                    {email.bodyPreview && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 leading-snug">
                        {email.bodyPreview}
                      </p>
                    )}
                  </div>
                  <a
                    href="/admin-panel/email-activity"
                    className="flex-shrink-0 self-center text-[11px] font-semibold text-[#0078D4] hover:underline"
                    title="Open in inbox"
                  >
                    View →
                  </a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recent Activity ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <button
          onClick={handleToggleAudit}
          className="flex items-center gap-2 w-full text-left group"
        >
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#E6EDF3]">Recent Activity</h2>
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${auditOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {!auditOpen && auditLogs.length === 0 && (
            <span className="text-[10px] text-muted-foreground font-normal normal-case tracking-normal">Click to load</span>
          )}
        </button>
        {auditOpen && (
          <div className="mt-3">
            {auditLoading ? (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
                <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                Loading activity…
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="bg-[#1C2128] border border-border rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">
                No activity recorded for this project yet.
              </div>
            ) : (
              <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden divide-y divide-border">
                {auditLogs.map((entry, i) => (
                  <div key={entry.id ?? i} className="flex items-start gap-3 px-4 py-3 hover:bg-[#1C2128]/60 transition-colors">
                    <div className="w-7 h-7 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-xs text-[#E6EDF3] leading-relaxed flex-1 min-w-0">{formatAuditEntry(entry)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Closure Sign-Off ────────────────────────────────────────────────── */}
      <ClosureCard projectId={projectId} projectStatus={project?.status} fetchWithAuth={fetchWithAuth} toast={toast} />

      {/* Status Report slide-over */}
      <Dialog open={statusReportOpen} onOpenChange={open => { if (!open) setStatusReportOpen(false); }}>
        <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-0">
            <DialogTitle className="flex items-center gap-2 text-[#E6EDF3]">
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
                    description: (
                      <span>
                        &ldquo;{saved.title}&rdquo; was created.{" "}
                        <button
                          onClick={() => navigate(`/crm/status-reports?report=${saved.id}`)}
                          className="underline font-semibold hover:opacity-80 transition-opacity"
                        >
                          View Report
                        </button>
                      </span>
                    ),
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
            <p className="text-xs text-muted-foreground">Paste a JSON array of steps. Each item needs a <code className="bg-[#1C2128] px-1 rounded">title</code>. Optional: <code className="bg-[#1C2128] px-1 rounded">description</code>, <code className="bg-[#1C2128] px-1 rounded">status</code>, <code className="bg-[#1C2128] px-1 rounded">dueDate</code>.</p>
            <textarea
              autoFocus
              rows={8}
              value={jsonImportText}
              onChange={e => setJsonImportText(e.target.value)}
              placeholder={'[\n  { "title": "Discovery", "status": "pending" },\n  { "title": "Migration", "status": "pending" }\n]'}
              className="w-full border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-y"
            />
            {jsonError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">{jsonError}</p>}
            {jsonParsed && <p className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-3 py-1.5">✓ Valid — {jsonParsed.length} step{jsonParsed.length !== 1 ? "s" : ""} will be imported</p>}
          </div>
          <DialogFooter>
            <button onClick={() => setJsonImportOpen(false)} className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128]">
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
      {/* ── AI Recommendations ── */}
      <div className="border border-[#30363D] rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAiRecs(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 bg-[#161B22] hover:bg-[#1C2128] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-[#E6EDF3]">AI Recommendations</p>
              <p className="text-[10px] text-[#7D8590]">Claude-powered next best actions for this project</p>
            </div>
            {projectNba && projectNba.length > 0 && (
              <span className="text-xs font-bold bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20 px-2 py-0.5 rounded-full">{projectNba.length}</span>
            )}
          </div>
          <svg className={`w-4 h-4 text-[#7D8590] transition-transform ${showAiRecs ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAiRecs && (
          <div className="border-t border-[#30363D] bg-[#0D1117] p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-[#7D8590] uppercase tracking-widest">Next Best Actions</h4>
              <button onClick={() => void generateProjectNba()} disabled={projectNbaGenerating} className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 transition-colors">
                {projectNbaGenerating ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> : null}
                {projectNbaGenerating ? "Generating…" : projectNba ? "Refresh" : "Generate"}
              </button>
            </div>
            {projectNbaLoading ? (
              <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-14 bg-[#161B22] rounded-xl animate-pulse" />)}</div>
            ) : !projectNba || projectNba.length === 0 ? (
              <p className="text-xs text-[#7D8590] py-3">No actions yet — click Generate to have Claude analyse this project's tasks, timeline, and status to surface the most impactful next steps.</p>
            ) : (
              <div className="space-y-2">
                {projectNba.map(action => (
                  <div key={action.id} className="bg-[#161B22] border border-[#30363D] rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[9px] font-bold text-[#0078D4] bg-[#0078D4]/10 px-1.5 py-0.5 rounded">{action.confidence}% confidence</span>
                      </div>
                      <p className="text-xs text-[#E6EDF3] leading-relaxed">{action.action}</p>
                      {action.rationale && <p className="text-[10px] text-[#7D8590] mt-0.5">{action.rationale}</p>}
                    </div>
                    <button onClick={() => void resolveProjectNba(action.id)} className="text-[10px] font-semibold text-[#484F58] hover:text-emerald-400 border border-[#30363D] hover:border-emerald-500/30 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0">✓ Done</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <KanbanCardModal
        task={selectedTask}
        stepTitle={selectedStepTitle}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        mode="admin"
        fetchWithAuth={fetchWithAuth}
        clientId={project?.clientUserId}
        clientName={client?.name ?? null}
        boardTasks={tasks as import("@/components/KanbanCardModal").KanbanCardModalTask[]}
        onSiblingUpdate={updated => {
          setTasks(prev => prev.map(t =>
            t.id === updated.id ? { ...t, column: updated.column ?? t.column } : t
          ));
        }}
        onUpdate={updated => {
          setSelectedTask(prev => prev ? { ...prev, ...updated } : prev);
          setTasks(prev => prev.map(t =>
            t.id === updated.id
              ? {
                  ...t,
                  title: updated.title,
                  description: updated.description ?? null,
                  priority: updated.priority ?? null,
                  assignedTo: updated.assignedTo ?? null,
                  dueDate: updated.dueDate ?? null,
                  column: updated.column ?? t.column,
                  completionStatus: updated.completionStatus ?? t.completionStatus,
                  completionNotes: updated.completionNotes ?? t.completionNotes,
                  taskMetadata: updated.taskMetadata ?? t.taskMetadata,
                }
              : t
          ));
        }}
      />
    </div>
  );
}
