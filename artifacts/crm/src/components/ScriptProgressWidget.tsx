import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface AutomationRun {
  id: number;
  status: "pending" | "running" | "completed" | "failed";
  modulesCompleted: number;
  modulesTotal: number;
  lastLogSnippet: string | null;
  errorMessage: string | null;
  triggeredAt: string;
  finishedAt: string | null;
  currentPackageName: string | null;
  currentModuleName: string | null;
}

type ProgressResponse = { status: "idle" } | AutomationRun;

const POLL_INTERVAL_MS = 4_000;
const AUTO_HIDE_AFTER_TERMINAL_MS = 5_000;

export default function ScriptProgressWidget() {
  const { fetchWithAuth } = useAuth();
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [visible, setVisible] = useState(false);
  const lastSeenIdRef = useRef<number | null>(null);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenRunIdRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portal/automation-progress");
      if (!res.ok) return;
      const data = await res.json() as ProgressResponse | null;

      if (!data || data.status === "idle") return;

      const incomingRun = data as AutomationRun;

      const isActive = incomingRun.status === "pending" || incomingRun.status === "running";

      if (incomingRun.id !== lastSeenIdRef.current) {
        lastSeenIdRef.current = incomingRun.id;
        // Only surface a newly-seen run if it is actively in progress.
        // A completed/failed run discovered on first poll (e.g. page refresh) is
        // stale — don't flash the widget for it.
        if (hiddenRunIdRef.current !== incomingRun.id && isActive) {
          setVisible(true);
        }
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      }

      setRun(incomingRun);

      if (!isActive) {
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = setTimeout(() => {
          hiddenRunIdRef.current = incomingRun.id;
          setVisible(false);
        }, AUTO_HIDE_AFTER_TERMINAL_MS);
      } else {
        setVisible(true);
      }
    } catch {
      // network error — silently ignore, retry next tick
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, [poll]);

  if (!run || !visible) return null;

  const isActive = run.status === "pending" || run.status === "running";
  const isCompleted = run.status === "completed";
  const isFailed = run.status === "failed";

  const pct = run.modulesTotal > 0
    ? Math.round((run.modulesCompleted / run.modulesTotal) * 100)
    : isCompleted ? 100 : 0;

  const label = run.currentPackageName
    ? run.currentModuleName
      ? `${run.currentPackageName} — ${run.currentModuleName}`
      : run.currentPackageName
    : isActive && run.lastLogSnippet
      ? run.lastLogSnippet
      : isCompleted
        ? "Setup complete"
        : isFailed
          ? "Setup paused"
          : "Preparing scripts…";

  const stepLine = run.modulesTotal > 0
    ? `${isCompleted ? "Completed" : isFailed ? "Stopped at"  : "Configuring…"} ${run.modulesCompleted} of ${run.modulesTotal} steps`
    : isActive
      ? "Initialising…"
      : null;

  const barColor = isFailed
    ? "bg-red-400"
    : isCompleted
      ? "bg-green-400"
      : "bg-[#0078D4]";

  const barWidth = Math.max(pct, isActive ? 4 : 0);

  return (
    <div className="mx-2 mb-1 mt-1 bg-white/5 rounded-xl p-3 border border-white/10">
      <div className="flex items-start gap-2">
        {isActive ? (
          <span className="mt-0.5 w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
        ) : isCompleted ? (
          <svg className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-white/80 text-[11px] font-semibold leading-tight truncate mb-1.5">
            {label}
          </p>

          <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden mb-1.5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>

          {stepLine && (
            <p className="text-white/40 text-[10px] leading-tight">{stepLine}</p>
          )}
        </div>
      </div>
    </div>
  );
}
