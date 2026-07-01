import { useQuickWinMode } from "@/context/QuickWinModeContext";
import type { KanbanTaskSummary } from "@/context/QuickWinModeContext";

const COLUMN_ORDER: Record<KanbanTaskSummary["column"], number> = {
  in_progress: 0,
  waiting_on_customer: 1,
  backlog: 2,
  completed: 3,
};

function InProgressIcon() {
  return (
    <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
  );
}

function WaitingIcon() {
  return (
    <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg className="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" strokeDasharray="4 2" />
    </svg>
  );
}

function CompletedIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

function TaskRow({ task }: { task: KanbanTaskSummary }) {
  const isCompleted = task.column === "completed";
  const isInProgress = task.column === "in_progress";
  const isWaiting = task.column === "waiting_on_customer";

  const borderColor = isInProgress
    ? "border-l-[#0078D4]"
    : isWaiting
    ? "border-l-amber-400"
    : isCompleted
    ? "border-l-green-400"
    : "border-l-slate-200";

  const badge = isInProgress
    ? { text: "In Progress", cls: "bg-[#0078D4]/10 text-[#0078D4]" }
    : isWaiting
    ? { text: "Awaiting Your Input", cls: "bg-amber-100 text-amber-700" }
    : isCompleted
    ? { text: "Complete", cls: "bg-green-100 text-green-700" }
    : { text: "Queued", cls: "bg-slate-100 text-slate-500" };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-2 bg-white ring-1 ring-black/5 ${borderColor} ${isCompleted ? "opacity-60" : ""}`}
      style={{ transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)" }}
    >
      {isInProgress ? (
        <InProgressIcon />
      ) : isWaiting ? (
        <WaitingIcon />
      ) : isCompleted ? (
        <CompletedIcon />
      ) : (
        <PendingIcon />
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isCompleted ? "line-through text-[#0A2540]/50" : "text-[#0A2540]"}`}>
          {task.title}
        </p>
        {task.groupName && (
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{task.groupName}</p>
        )}
      </div>

      <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>
        {badge.text}
      </span>
    </div>
  );
}

export default function ProjectTasksLayer() {
  const { state, dispatch } = useQuickWinMode();
  const { projectTasks } = state;

  const sorted = [...projectTasks].sort(
    (a, b) => (COLUMN_ORDER[a.column] ?? 2) - (COLUMN_ORDER[b.column] ?? 2),
  );

  const inProgressCount = projectTasks.filter(t => t.column === "in_progress").length;
  const waitingCount = projectTasks.filter(t => t.column === "waiting_on_customer").length;
  const completedCount = projectTasks.filter(t => t.column === "completed").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary line */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {inProgressCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#0078D4] inline-block" />
            {inProgressCount} in progress
          </span>
        )}
        {waitingCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            {waitingCount} awaiting you
          </span>
        )}
        {completedCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            {completedCount} complete
          </span>
        )}
      </div>

      {/* Task list */}
      {sorted.length === 0 ? (
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-muted-foreground">Seeding project tasks…</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {sorted.map(task => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* CTAs */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={() => dispatch({ type: "OPEN_PROJECT" })}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.98] shadow-lg shadow-[#0078D4]/20"
          style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open Project
        </button>
        <button
          onClick={() => dispatch({ type: "EXIT" })}
          className="flex-1 px-4 py-2.5 rounded-xl border border-border text-[#0A2540] font-bold text-sm hover:bg-[#F7F9FC] active:scale-[0.98]"
          style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
