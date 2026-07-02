import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useQuickWinMode } from "@/context/QuickWinModeContext";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectTaskRow {
  id: number;
  title: string;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  groupName: string | null;
  description: string | null;
  taskType: string | null;
  taskMetadata: Record<string, unknown> | null;
}

// ── Column sort priority ────────────────────────────────────────────────────────
const COLUMN_ORDER: Record<ProjectTaskRow["column"], number> = {
  in_progress: 0,
  waiting_on_customer: 1,
  backlog: 2,
  completed: 3,
};

// ── Status icons ───────────────────────────────────────────────────────────────

function InProgressIcon() {
  return <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />;
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
    <svg className="w-5 h-5 text-slate-400 flex-shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="10" cy="10" r="8" strokeDasharray="4 2" />
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

function DownloadIcon() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

// ── TaskRow ────────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: ProjectTaskRow;
  isExiting: boolean;
  onMarkDone: (id: number) => void;
  onDownload: (id: number, scriptTitle: string) => void;
  downloading: boolean;
  markingDone: boolean;
}

function TaskRow({ task, isExiting, onMarkDone, onDownload, downloading, markingDone }: TaskRowProps) {
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
    ? { text: "Awaiting You", cls: "bg-amber-100 text-amber-700" }
    : isCompleted
    ? { text: "Complete", cls: "bg-green-100 text-green-700" }
    : { text: "Queued", cls: "bg-slate-100 text-slate-500" };

  const customerDownload = task.taskMetadata?.customerDownload as
    | { scriptId?: string; scriptTitle?: string }
    | null
    | undefined;

  return (
    <div
      className={`flex flex-col gap-2 px-3 py-2.5 rounded-lg border-l-2 bg-white ring-1 ring-black/5 ${borderColor}`}
      style={{
        transform: isExiting ? "translateY(4px) scale(0.97)" : "translateY(0) scale(1)",
        opacity: isExiting ? 0 : isCompleted ? 0.6 : 1,
        transition: "transform 300ms cubic-bezier(0.42,0,0.58,1), opacity 300ms cubic-bezier(0.42,0,0.58,1)",
      }}
    >
      <div className="flex items-center gap-3">
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
          <p
            className={`text-sm font-semibold truncate ${
              isCompleted ? "line-through text-[#0A2540]/50" : "text-[#0A2540]"
            }`}
          >
            {task.title}
          </p>
          {task.groupName && (
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{task.groupName}</p>
          )}
        </div>

        <span
          className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}
        >
          {badge.text}
        </span>
      </div>

      {/* Actionable controls for waiting_on_customer tasks */}
      {isWaiting && (
        <div className="flex gap-2 pl-8">
          {customerDownload?.scriptId ? (
            <button
              onClick={() => onDownload(task.id, customerDownload.scriptTitle ?? task.title)}
              disabled={downloading}
              className="flex items-center gap-1.5 text-[11px] font-bold text-[#0078D4] hover:text-[#0078D4]/80 disabled:opacity-50"
              style={{ transition: "opacity 200ms" }}
            >
              <DownloadIcon />
              {downloading ? "Preparing…" : (customerDownload.scriptTitle ?? "Download Script")}
            </button>
          ) : (
            <button
              onClick={() => onMarkDone(task.id)}
              disabled={markingDone}
              className="text-[11px] font-bold px-3 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.97] disabled:opacity-50"
              style={{ transition: "all 200ms cubic-bezier(0.42,0,0.58,1)" }}
            >
              {markingDone ? "Saving…" : "Mark as Done"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ProjectTasksLayer() {
  const { state, dispatch } = useQuickWinMode();
  const { projectId } = state;
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  // ── Live data: poll every 5 s so task statuses stay in sync with the board ──
  const { data: tasks = [], isLoading } = useQuery<ProjectTaskRow[]>({
    queryKey: ["quick-win-project-tasks", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project tasks");
      const body = await res.json() as { tasks?: ProjectTaskRow[] };
      return body.tasks ?? [];
    },
    enabled: !!projectId,
    refetchInterval: 5000,
    staleTime: 0,
  });

  // ── Completed-task exit animation ──────────────────────────────────────────
  // Track which tasks just transitioned to "completed" so we can play a
  // slide+fade exit animation before they settle in the completed position.
  const prevTasksRef = useRef<ProjectTaskRow[]>([]);
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const prev = prevTasksRef.current;

    const newlyCompleted = prev.length === 0 ? [] : tasks.filter(t => {
      if (t.column !== "completed") return false;
      const p = prev.find(p => p.id === t.id);
      return p !== undefined && p.column !== "completed";
    });

    // Always advance the ref so the same transition is never re-detected on
    // the next poll cycle (even when newlyCompleted is non-empty).
    prevTasksRef.current = tasks;

    if (newlyCompleted.length > 0) {
      const ids = new Set(newlyCompleted.map(t => t.id));
      setExitingIds(prev => new Set([...prev, ...ids]));

      // After 400 ms the animation is done — clear the exiting state so the
      // task can settle into its completed position at the bottom of the list.
      const timer = setTimeout(() => {
        setExitingIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.delete(id));
          return next;
        });
      }, 400);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [tasks]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const [markingDoneId, setMarkingDoneId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const markDoneMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const res = await fetchWithAuth(`/api/portal/kanban-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: "completed" }),
      });
      if (!res.ok) throw new Error("Failed to update task");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quick-win-project-tasks", projectId] });
      setMarkingDoneId(null);
    },
    onError: () => setMarkingDoneId(null),
  });

  const handleMarkDone = (taskId: number) => {
    setMarkingDoneId(taskId);
    markDoneMutation.mutate(taskId);
  };

  const handleDownload = async (taskId: number, scriptTitle: string) => {
    setDownloadingId(taskId);
    try {
      const res = await fetchWithAuth(`/api/portal/tasks/${taskId}/download-script`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scriptTitle.replace(/\s+/g, "-")}.ps1`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Sort: in_progress first, then waiting, then backlog, then completed ────
  const sorted = [...tasks].sort(
    (a, b) => (COLUMN_ORDER[a.column] ?? 2) - (COLUMN_ORDER[b.column] ?? 2),
  );

  const inProgressCount = tasks.filter(t => t.column === "in_progress").length;
  const waitingCount = tasks.filter(t => t.column === "waiting_on_customer").length;
  const completedCount = tasks.filter(t => t.column === "completed").length;
  const allDone = tasks.length > 0 && inProgressCount === 0 && waitingCount === 0 &&
    tasks.filter(t => t.column === "backlog").length === 0;

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1">
      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
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
        {isLoading && tasks.length === 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 border border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Loading tasks…
          </span>
        )}
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: `${Math.round((completedCount / tasks.length) * 100)}%`,
                background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)",
              }}
            />
          </div>
          <span className="text-[10px] font-semibold text-white/40 tabular-nums flex-shrink-0">
            {completedCount}/{tasks.length}
          </span>
        </div>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {!isLoading && sorted.length === 0 && (
          <div className="flex items-center gap-2.5 py-3">
            <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-muted-foreground">Seeding project tasks…</p>
          </div>
        )}
        {sorted.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            isExiting={exitingIds.has(task.id)}
            onMarkDone={handleMarkDone}
            onDownload={handleDownload}
            downloading={downloadingId === task.id}
            markingDone={markingDoneId === task.id}
          />
        ))}
      </div>

    </div>
  );
}
