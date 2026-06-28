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

const POLL_INTERVAL_MS = 3_000;
const AUTO_HIDE_AFTER_TERMINAL_MS = 5_000;

function ProgressBar({ value, max, status }: { value: number; max: number; status: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : (status === "completed" ? 100 : 0);
  const colorClass =
    status === "failed" ? "bg-red-400" :
    status === "completed" ? "bg-green-400" :
    "bg-white/80";

  return (
    <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${colorClass}`}
        style={{ width: `${Math.max(pct, status === "running" || status === "pending" ? 4 : 0)}%` }}
      />
    </div>
  );
}

export default function AutomationProgressBanner() {
  const { fetchWithAuth } = useAuth();
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [lastSeenId, setLastSeenId] = useState<number | null>(null);
  const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portal/automation-progress");
      if (!res.ok) return;
      const data = await res.json() as ProgressResponse | null;
      if (!data || data.status === "idle") return;

      if (data.id !== lastSeenId) {
        setLastSeenId(data.id);
        setDismissed(false);
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      }
      setRun(data as AutomationRun);

      if (data.status === "completed" || data.status === "failed") {
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = setTimeout(() => setDismissed(true), AUTO_HIDE_AFTER_TERMINAL_MS);
      }
    } catch {
    }
  }, [fetchWithAuth, lastSeenId]);

  useEffect(() => {
    void poll();
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    if (run.status === "completed" || run.status === "failed") return;
    const timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [run?.status, poll]);

  if (!run || dismissed) return null;

  const pct = run.modulesTotal > 0
    ? Math.round((run.modulesCompleted / run.modulesTotal) * 100)
    : run.status === "completed" ? 100 : 0;

  const bgClass =
    run.status === "failed" ? "bg-red-600" :
    run.status === "completed" ? "bg-green-600" :
    "bg-[#0078D4]";

  const snippetText = run.status === "failed"
    ? (run.errorMessage ?? "An error occurred.")
    : (run.lastLogSnippet ?? "Initialising…");

  const titleText =
    run.status === "completed" ? "Automation scripts completed" :
    run.status === "failed" ? "Automation scripts failed" :
    run.currentPackageName
      ? `Running: ${run.currentPackageName}`
      : "Running automation scripts";

  return (
    <div className={`${bgClass} text-white px-4 py-2.5 shadow-md`}>
      <div className="max-w-4xl mx-auto flex items-center gap-3">
        {run.status === "running" || run.status === "pending" ? (
          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin flex-shrink-0" />
        ) : run.status === "completed" ? (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold truncate">{titleText}</span>
            {run.modulesTotal > 0 && (
              <span className="text-xs font-mono text-white/70 ml-auto flex-shrink-0">
                {run.modulesCompleted}/{run.modulesTotal} · {pct}%
              </span>
            )}
          </div>
          <ProgressBar value={run.modulesCompleted} max={run.modulesTotal} status={run.status} />
          {snippetText && (
            <p className="text-[11px] text-white/60 mt-1 truncate">{snippetText}</p>
          )}
        </div>

        <button
          onClick={() => {
            if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            setDismissed(true);
          }}
          className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors ml-1"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
