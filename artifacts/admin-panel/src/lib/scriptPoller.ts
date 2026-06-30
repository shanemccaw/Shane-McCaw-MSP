export interface RunStatus {
  status: "running" | "completed" | "failed";
  outputLines: string[];
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
}

type StatusListener = (status: RunStatus) => void;
type CompleteListener = (status: "completed" | "failed", outputLines: string[]) => void;

interface ActivePoll {
  intervalId: ReturnType<typeof setInterval>;
  statusListener: StatusListener | null;
  completeListeners: CompleteListener[];
  lastStatus: RunStatus | null;
}

const polls = new Map<string, ActivePoll>();

export function startPoll(
  jobRef: string,
  fetchFn: (url: string) => Promise<Response>,
  statusListener: StatusListener | null,
  onComplete: CompleteListener
) {
  if (polls.has(jobRef)) {
    const existing = polls.get(jobRef)!;
    if (statusListener) existing.statusListener = statusListener;
    existing.completeListeners.push(onComplete);
    return;
  }

  const poll: ActivePoll = {
    statusListener,
    completeListeners: [onComplete],
    lastStatus: null,
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

export function stopPoll(jobRef: string) {
  const p = polls.get(jobRef);
  if (p) {
    clearInterval(p.intervalId);
    polls.delete(jobRef);
  }
}
