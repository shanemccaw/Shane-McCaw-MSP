import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
}

interface Props {
  task: KanbanCardModalTask | null;
  stepTitle?: string | null;
  open: boolean;
  onClose: () => void;
  mode?: "client" | "admin";
}

const COLUMN_CONFIG: Record<string, { label: string; cls: string }> = {
  backlog: { label: "Backlog", cls: "bg-gray-100 text-gray-600 border border-gray-200" },
  in_progress: { label: "In Progress", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
  waiting_on_customer: { label: "Waiting on Customer", cls: "bg-amber-100 text-amber-700 border border-amber-200" },
  completed: { label: "Completed", cls: "bg-green-100 text-green-700 border border-green-200" },
};

const PRIORITY_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700 border border-red-200", dot: "bg-red-500" },
  high:     { label: "High",     cls: "bg-orange-100 text-orange-700 border border-orange-200", dot: "bg-orange-500" },
  medium:   { label: "Medium",   cls: "bg-blue-100 text-blue-700 border border-blue-200", dot: "bg-blue-500" },
  low:      { label: "Low",      cls: "bg-gray-100 text-gray-500 border border-gray-200", dot: "bg-gray-400" },
};

export function KanbanCardModal({ task, stepTitle, open, onClose, mode = "client" }: Props) {
  if (!task) return null;
  const colCfg = COLUMN_CONFIG[task.column] ?? { label: task.column, cls: "bg-gray-100 text-gray-600 border border-gray-200" };
  const priorityCfg = task.priority ? PRIORITY_CONFIG[task.priority] : null;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-2">
            <div className="flex-1 min-w-0">
              {task.groupName && (
                <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 mb-2">
                  {task.groupName}
                </span>
              )}
              <DialogTitle className="text-base font-bold text-[#0A2540] leading-snug">
                {task.title}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-1">
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

          {mode === "admin" && (
            <p className="text-[10px] text-muted-foreground italic border-t border-border pt-2">
              Use the kanban board to move this card or update its status.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
