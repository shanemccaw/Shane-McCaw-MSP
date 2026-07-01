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
const AUTO_HIDE_AFTER_TERMINAL_MS = 8_000;

interface Props {
  onRunChange?: (run: AutomationRun | null, isActive: boolean) => void;
}

export default function InlineAutomationBanner({ onRunChange }: Props) {
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

      if (!data || data.status === "idle") {
        onRunChange?.(null, false);
        return;
      }

      const incomingRun = data as AutomationRun;
      const isActive = incomingRun.status === "pending" || incomingRun.status === "running";

      if (incomingRun.id !== lastSeenIdRef.current) {
        lastSeenIdRef.current = incomingRun.id;
        if (hiddenRunIdRef.current !== incomingRun.id && isActive) {
          setVisible(true);
        }
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      }

      setRun(incomingRun);
      onRunChange?.(incomingRun, isActive);

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
      // network error — silently ignore
    }
  }, [fetchWithAuth, onRunChange]);

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

  const barWidth = Math.max(pct, isActive ? 3 : 0);

  const label = run.currentPackageName
    ? run.currentModuleName
      ? `${run.currentPackageName} — ${run.currentModuleName}`
      : run.currentPackageName
    : isCompleted
      ? "Setup complete"
      : isFailed
        ? "Setup encountered an issue"
        : "Preparing automation…";

  const stepLine = run.modulesTotal > 0
    ? `${isCompleted ? "Completed" : isFailed ? "Stopped at" : "Running"} ${run.modulesCompleted} of ${run.modulesTotal} steps`
    : isActive
      ? "Initialising…"
      : null;

  const barColor = isFailed
    ? "bg-red-400"
    : isCompleted
      ? "bg-emerald-400"
      : "bg-[#0078D4]";

  const borderColor = isFailed
    ? "border-red-200 bg-red-50"
    : isCompleted
      ? "border-emerald-200 bg-emerald-50"
      : "border-[#0078D4]/20 bg-[#0078D4]/5";

  const textColor = isFailed ? "text-red-700" : isCompleted ? "text-emerald-700" : "text-[#0A2540]";
  const subColor = isFailed ? "text-red-500" : isCompleted ? "text-emerald-600" : "text-muted-foreground";
  const trackColor = isFailed ? "bg-red-100" : isCompleted ? "bg-emerald-100" : "bg-[#0078D4]/15";

  return (
    <div className={`rounded-xl border px-5 py-4 ${borderColor}`}>
      <div className="flex items-center gap-3 mb-3">
        {isActive ? (
          <span className="relative flex h-3 w-3 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0078D4]" />
          </span>
        ) : isCompleted ? (
          <svg className="w-4 h-4 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${textColor}`}>{label}</p>
          {stepLine && <p className={`text-xs mt-0.5 ${subColor}`}>{stepLine}</p>}
        </div>
        <span className={`text-xs font-bold ${subColor}`}>{pct}%</span>
      </div>
      <div className={`w-full ${trackColor} rounded-full h-1.5 overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}
