import type { ReactElement } from "react";

type SubState = "queued" | "starting" | "running" | "done";

interface ProcessingHeroCardProps {
  title: string;
  description?: string;
  category?: string;
  subState: SubState;
  isExiting?: boolean;
}

// SVG path data keyed by category — rendered inline, no external deps
const CATEGORY_ICONS: Record<string, ReactElement> = {
  Security: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  ),
  "Copilot AI": (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  ),
  Governance: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.97zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.97z" />
    </svg>
  ),
  Compliance: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  ),
};

const DEFAULT_ICON = (
  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

export default function ProcessingHeroCard({
  title,
  description,
  category,
  subState,
  isExiting,
}: ProcessingHeroCardProps) {
  const icon = (category && CATEGORY_ICONS[category]) ?? DEFAULT_ICON;

  const steps = [
    { label: "Queued", done: subState !== "queued" },
    { label: "Starting", done: subState === "running" || subState === "done" },
    { label: "Running", active: subState === "running", done: subState === "done" },
    { label: "Completed / Error", pending: subState !== "done" },
  ];

  return (
    <div
      className="rounded-xl p-6 flex flex-col w-[340px] flex-shrink-0 relative border shadow-[0_12px_40px_rgba(0,120,212,0.15)] ring-1 ring-[#0078D4]/5 bg-white"
      style={{
        backdropFilter: "blur(12px)",
        transform: isExiting ? "translateX(-100%) scale(0.96)" : "scale(1)",
        opacity: isExiting ? 0 : 1,
        transition: "transform 400ms cubic-bezier(0.42,0,0.58,1), opacity 400ms cubic-bezier(0.42,0,0.58,1)",
      }}
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 px-4 py-1.5 rounded-full bg-emerald-500 text-white font-bold text-[11px] uppercase tracking-widest shadow-[0_0_15px_rgba(16,185,129,0.6)] animate-pulse border-2 border-white">
        Running…
      </div>

      <div className="flex justify-between items-start mb-6 mt-2">
        <div className="w-14 h-14 rounded-xl bg-[#0078D4]/10 text-[#0078D4] flex items-center justify-center">
          {icon}
        </div>
      </div>

      <div className="flex-1">
        <h2 className="text-xl font-semibold text-[#191c1e] mb-2">{title}</h2>
        <div className="mb-4 p-3 bg-[#0078D4]/5 rounded-lg border border-[#0078D4]/10">
          <p className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest mb-1">Diagnostic Focus</p>
          <p className="text-[13px] text-black/60 italic leading-snug">
            {description ?? "Running automated diagnostic checks against your Microsoft 365 tenant."}
          </p>
        </div>

        <div className="mt-4 space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              {step.done ? (
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : step.active ? (
                <div className="w-6 h-6 rounded-full bg-[#0078D4]/20 flex items-center justify-center text-[#0078D4] shrink-0 ring-4 ring-[#0078D4]/5">
                  <div className="w-3 h-3 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full border border-black/20 flex items-center justify-center shrink-0 opacity-40" />
              )}
              <span
                className={`text-[13px] ${
                  step.done
                    ? "text-black/50"
                    : step.active
                    ? "font-semibold text-[#0078D4]"
                    : "text-black/30"
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
