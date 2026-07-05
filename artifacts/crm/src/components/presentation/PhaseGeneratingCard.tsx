import { useState, useEffect } from "react";
import AnimatedBackground from "@/components/quickwin/AnimatedBackground";
import CopilotAura from "@/components/wizard/CopilotAura";

export interface PhaseGenPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  subtasks: string[];
}

interface ProgressRow {
  message: string;
  done: boolean;
  current?: number;
  total?: number;
}

interface Props {
  presentationId: number;
  shareToken?: string | null;
  clientName?: string | null;
  projectTitle?: string | null;
  onComplete: (phases: PhaseGenPhase[]) => void;
  onError: () => void;
  phaseGenEvent?: { type: string; message?: string; current?: number; total?: number; phases?: PhaseGenPhase[] } | null;
}

function ProgressBar({ current, total }: { current: number | null; total: number | null }) {
  const pct = current != null && total != null && total > 0
    ? Math.min(100, Math.round((current / total) * 100))
    : 0;

  const isPulsing = current == null || total == null;

  return (
    <div className="mt-3 mb-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.45)" }}>
          Progress
        </span>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.7)" }}>
          {isPulsing ? "–" : `${pct}%`}
        </span>
      </div>
      <div
        className="relative w-full h-1.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.10)" }}
      >
        {isPulsing ? (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: "linear-gradient(90deg, #0078D4, #00B4D8)", opacity: 0.5 }}
          />
        ) : (
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, #0078D4, #00B4D8)",
              transition: "width 0.4s ease",
              boxShadow: "0 0 8px rgba(0,180,216,0.6)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function DarkOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-[#0A2540]">
      <AnimatedBackground fullScreen />
      <CopilotAura />
      <div className="relative z-[20] w-full max-w-sm mx-auto px-4">
        {children}
      </div>
    </div>
  );
}

export default function PhaseGeneratingCard({
  clientName,
  projectTitle,
  onComplete,
  onError,
  phaseGenEvent,
}: Props) {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [stepCounter, setStepCounter] = useState<{ current: number; total: number } | null>(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!phaseGenEvent) return;

    if (phaseGenEvent.type === "phase_gen_progress") {
      const msg = phaseGenEvent.message ?? "";
      const current = phaseGenEvent.current;
      const total = phaseGenEvent.total;
      if (current !== undefined && total !== undefined) {
        setStepCounter({ current, total });
      }
      setRows(prev => {
        const updated = prev.map((r, i) =>
          i === prev.length - 1 ? { ...r, done: true } : r,
        );
        return [...updated, { message: msg, done: false, current, total }];
      });
    } else if (phaseGenEvent.type === "phase_gen_complete") {
      setRows(prev => prev.map(r => ({ ...r, done: true })));
      const phases = phaseGenEvent.phases ?? [];
      setTimeout(() => onComplete(phases), 400);
    } else if (phaseGenEvent.type === "phase_gen_error") {
      setRows(prev => prev.map(r => ({ ...r, done: true })));
      setErrorMessage(phaseGenEvent.message ?? "An error occurred while generating your project plan.");
      setHasError(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseGenEvent]);

  if (hasError) {
    return (
      <DarkOverlay>
        <div
          className="rounded-2xl shadow-2xl p-6 text-center"
          style={{
            background: "rgba(10,37,64,0.72)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="w-12 h-12 rounded-full bg-red-900/40 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-extrabold text-white mb-2">Couldn't Build Your Plan</h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>{errorMessage}</p>
          <button
            onClick={onError}
            className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 transition-colors shadow-lg shadow-[#0078D4]/30"
          >
            Continue to Payment Options
          </button>
        </div>
      </DarkOverlay>
    );
  }

  return (
    <DarkOverlay>
      {/* Animated ambient ring */}
      <div className="relative flex justify-center mb-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ border: "4px solid rgba(0,120,212,0.25)" }}>
          <div className="absolute w-16 h-16 rounded-full border-4 border-transparent border-t-[#0078D4] animate-spin" />
          <svg className="w-7 h-7 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
      </div>

      <div
        className="rounded-2xl shadow-2xl w-full"
        style={{
          background: "rgba(10,37,64,0.72)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div className="px-6 pt-6 pb-4">
          {clientName && (
            <p className="text-[11px] font-bold text-[#00B4D8] uppercase tracking-widest mb-2">
              Hi, {clientName}
            </p>
          )}
          <h2 className="text-lg font-extrabold text-white leading-snug mb-1">
            Building Your Project Plan
          </h2>
          {projectTitle && (
            <p className="text-xs font-semibold text-[#00B4D8] mt-1">{projectTitle}</p>
          )}
          <ProgressBar
            current={stepCounter?.current ?? null}
            total={stepCounter?.total ?? null}
          />
        </div>

        {/* Live stage list */}
        <ul className="px-6 py-3 space-y-3 min-h-[80px]">
          {rows.length === 0 ? (
            <li className="flex items-center gap-2.5">
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </span>
              <span className="text-xs font-semibold" style={{ color: "#0078D4" }}>
                Starting up…<span className="animate-pulse"> …</span>
              </span>
            </li>
          ) : (
            rows.map((row, i) => {
              const isActive = !row.done && i === rows.length - 1;
              return (
                <li key={i} className="flex items-center gap-2.5" style={{ opacity: row.done && i < rows.length - 1 ? 0.5 : 1, transition: "opacity 0.3s ease" }}>
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                    {row.done ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      <svg className="w-3.5 h-3.5 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }} />
                    )}
                  </span>
                  <span
                    className="text-xs leading-snug"
                    style={{
                      color: row.done ? "#4ade80" : isActive ? "#0078D4" : "rgba(255,255,255,0.35)",
                      fontWeight: isActive ? 600 : row.done ? 500 : 400,
                    }}
                  >
                    {row.message}
                    {isActive && <span className="animate-pulse"> …</span>}
                  </span>
                </li>
              );
            })
          )}
        </ul>

        <div className="px-6 pb-5 pt-2 mt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
            Analysing your Statement of Work to create AI-generated project phases and pricing.
          </p>
        </div>
      </div>
    </DarkOverlay>
  );
}
