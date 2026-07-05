import { useState, useEffect } from "react";

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
      <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-[#F7F9FC]">
        <div className="w-full max-w-sm mx-auto px-4">
          <div
            className="rounded-2xl border border-red-200 shadow-xl p-6 text-center"
            style={{ background: "rgba(255,255,255,0.95)" }}
          >
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-extrabold text-[#0A2540] mb-2">Couldn't Build Your Plan</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{errorMessage}</p>
            <button
              onClick={onError}
              className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 transition-colors shadow-lg shadow-[#0078D4]/20"
            >
              Continue to Payment Options
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-[#F7F9FC]">
      <div className="w-full max-w-sm mx-auto px-4">

        {/* Animated ambient ring */}
        <div className="relative flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full border-4 border-[#0078D4]/20 flex items-center justify-center">
            <div className="absolute w-16 h-16 rounded-full border-4 border-transparent border-t-[#0078D4] animate-spin" />
            <svg className="w-7 h-7 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
        </div>

        <div
          className="rounded-2xl border border-black/8 shadow-xl w-full"
          style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
        >
          <div className="px-6 pt-6 pb-4">
            {clientName && (
              <p className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest mb-2">
                Hi, {clientName}
              </p>
            )}
            <h2 className="text-lg font-extrabold text-[#0A2540] leading-snug mb-1">
              Building Your Project Plan
            </h2>
            {projectTitle && (
              <p className="text-xs font-semibold text-[#0078D4] mt-1">{projectTitle}</p>
            )}
            {stepCounter && (
              <p className="text-[11px] font-semibold text-gray-400 mt-2 tabular-nums">
                Step {stepCounter.current} of {stepCounter.total}
              </p>
            )}
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
                <span className="text-xs text-[#0078D4] font-semibold">Starting up…<span className="animate-pulse"> …</span></span>
              </li>
            ) : (
              rows.map((row, i) => {
                const isActive = !row.done && i === rows.length - 1;
                return (
                  <li key={i} className="flex items-center gap-2.5" style={{ opacity: row.done && i < rows.length - 1 ? 0.7 : 1, transition: "opacity 0.3s ease" }}>
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      {row.done ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isActive ? (
                        <svg className="w-3.5 h-3.5 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                      )}
                    </span>
                    <span
                      className="text-xs leading-snug"
                      style={{
                        color: row.done ? "#16a34a" : isActive ? "#0078D4" : "#9ca3af",
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

          <div className="px-6 pb-5 pt-2 border-t border-gray-100 mt-1">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Analysing your Statement of Work to create AI-generated project phases and pricing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
