export interface RunStatus {
  status: "running" | "completed" | "failed";
  outputLines: string[];
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
}

type StatusListener = (status: RunStatus) => void;
type CompleteListener = (status: "completed" | "failed", outputLines: string[]) => void;
type ChangeListener = () => void;

interface ActivePoll {
  intervalId: ReturnType<typeof setInterval>;
  statusListener: StatusListener | null;
  completeListeners: CompleteListener[];
  lastStatus: RunStatus | null;
  kanbanTaskId?: number;
}

const polls = new Map<string, ActivePoll>();
const taskJobMap = new Map<number, string>();

const taskIdToJobRef = new Map<number, string>();

const changeListeners = new Set<ChangeListener>();

function notifyChange() {
  changeListeners.forEach(fn => fn());
}

export function subscribeToChanges(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function registerTaskJob(taskId: number, jobRef: string) {
  taskIdToJobRef.set(taskId, jobRef);
  notifyChange();
}

export function isTaskRunning(taskId: number): boolean {
  const jobRef = taskIdToJobRef.get(taskId);
  return jobRef !== undefined && polls.has(jobRef);
}

export function startPoll(
  jobRef: string,
  fetchFn: (url: string) => Promise<Response>,
  statusListener: StatusListener | null,
  onComplete: CompleteListener,
  kanbanTaskId?: number
) {
  // If this kanbanTaskId already has an active poll (possibly from a different
  // launch surface), attach to the existing one rather than starting a new job.
  if (kanbanTaskId !== undefined) {
    const existingJobRef = taskJobMap.get(kanbanTaskId);
    if (existingJobRef && polls.has(existingJobRef)) {
      const existing = polls.get(existingJobRef)!;
      if (statusListener) existing.statusListener = statusListener;
      existing.completeListeners.push(onComplete);
      return;
    }
  }

  if (polls.has(jobRef)) {
    const existing = polls.get(jobRef)!;
    if (statusListener) existing.statusListener = statusListener;
    existing.completeListeners.push(onComplete);
    return;
  }

  if (kanbanTaskId !== undefined) {
    taskJobMap.set(kanbanTaskId, jobRef);
  }

  const poll: ActivePoll = {
    statusListener,
    completeListeners: [onComplete],
    lastStatus: null,
    kanbanTaskId,
    intervalId: setInterval(() => {
      void (async () => {
        try {
          const r = await fetchFn(`/api/admin/run-script/${jobRef}/status`);
          if (!r.ok) { stopPoll(jobRef); return; }
          const data = (await r.json()) as RunStatus;
          const p = polls.get(jobRef);
          if (!p) return;
          p.lastStatus = data;
          p.statusListener?.(data);
          if (data.status !== "running") {
            const completedStatus = data.status;
            const listeners = [...p.completeListeners];
            stopPoll(jobRef);
            listeners.forEach(fn => fn(completedStatus, data.outputLines));
          }
        } catch {
          stopPoll(jobRef);
        }
      })();
    }, 4000),
  };
  polls.set(jobRef, poll);
  notifyChange();
}

export function attachStatusListener(jobRef: string, listener: StatusListener) {
  const p = polls.get(jobRef);
  if (p) p.statusListener = listener;
}

export function detachStatusListener(jobRef: string) {
  const p = polls.get(jobRef);
  if (p) p.statusListener = null;
}

export function getLastStatus(jobRef: string): RunStatus | null {
  return polls.get(jobRef)?.lastStatus ?? null;
}

export function isActive(jobRef: string): boolean {
  return polls.has(jobRef);
}

export function isActiveForTask(kanbanTaskId: number): boolean {
  const jobRef = taskJobMap.get(kanbanTaskId);
  return jobRef !== undefined && polls.has(jobRef);
}

export function getJobRefForTask(kanbanTaskId: number): string | undefined {
  return taskJobMap.get(kanbanTaskId);
}

export function stopPoll(jobRef: string) {
  const p = polls.get(jobRef);
  if (p) {
    clearInterval(p.intervalId);
    if (p.kanbanTaskId !== undefined) taskJobMap.delete(p.kanbanTaskId);
    polls.delete(jobRef);
    for (const [taskId, ref] of taskIdToJobRef.entries()) {
      if (ref === jobRef) {
        taskIdToJobRef.delete(taskId);
        break;
      }
    }
    notifyChange();
  }
}
