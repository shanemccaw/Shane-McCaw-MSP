import { useState, useEffect } from "react";

const STAGES = [
  { label: "Analysing your assessment results" },
  { label: "Mapping remediation priorities" },
  { label: "Calculating engagement pricing" },
  { label: "Drafting your Statement of Work" },
  { label: "Applying final formatting" },
];

const DELAYS = [0, 3500, 7500, 12000, 17000];

interface Props {
  clientName: string | null | undefined;
  projectTitle: string | null | undefined;
  onClose: () => void;
}

export default function SowGeneratingCard({ clientName, projectTitle, onClose }: Props) {
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    DELAYS.forEach((delay, i) => {
      if (i === 0) return;
      const t = setTimeout(() => {
        if (!cancelled) setActiveStage(i);
      }, delay);
      return () => clearTimeout(t);
    });
    return () => { cancelled = true; };
  }, []);

  const progressPct =
    activeStage === STAGES.length - 1
      ? 88
      : Math.round((activeStage / (STAGES.length - 1)) * 78);

  return (
    <div
      className="rounded-2xl border border-black/8 shadow-xl w-full"
      style={{ background: "rgba(255,255,255,0.88)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
    >
      {/* Card header */}
      <div className="px-6 pt-6 pb-4">
        {clientName && (
          <p className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest mb-2">
            Hi, {clientName}
          </p>
        )}
        <h2 className="text-lg font-extrabold text-[#0A2540] leading-snug mb-1">
          Your Statement of Work<br />is being prepared
        </h2>
        {projectTitle && (
          <p className="text-xs font-semibold text-[#0078D4] mt-1">{projectTitle}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-6 pb-1">
        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8]"
            style={{ width: `${progressPct}%`, transition: "width 2s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <p className="text-[10px] text-gray-400">Generating…</p>
          <p className="text-[10px] text-gray-400">{progressPct}%</p>
        </div>
      </div>

      {/* Stage list */}
      <ul className="px-6 py-3 space-y-2.5">
        {STAGES.map((stage, i) => {
          const isDone    = i < activeStage;
          const isActive  = i === activeStage;
          const isPending = i > activeStage;
          return (
            <li
              key={i}
              className="flex items-center gap-2.5"
              style={{ opacity: isPending ? 0.3 : 1, transition: "opacity 0.5s ease" }}
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                {isDone ? (
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
                  color: isDone ? "#16a34a" : isActive ? "#0078D4" : "#9ca3af",
                  fontWeight: isActive ? 600 : isDone ? 500 : 400,
                }}
              >
                {stage.label}
                {isActive && <span className="animate-pulse"> …</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="px-6 pb-5 pt-2 border-t border-gray-100 mt-1">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          This page will refresh automatically the moment it's ready to review and sign.
          Typically takes 60–90 seconds.
        </p>
        <button
          onClick={onClose}
          className="mt-3 text-[11px] font-semibold text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
        >
          Return to portal
        </button>
      </div>
    </div>
  );
}
