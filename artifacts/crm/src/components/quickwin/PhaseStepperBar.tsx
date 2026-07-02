interface PhaseStepperBarProps {
  steps: string[];
  activeIndex: number;
  completedCount: number;
}

export default function PhaseStepperBar({ steps, activeIndex, completedCount }: PhaseStepperBarProps) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto py-2 no-scrollbar">
      {steps.map((label, i) => {
        const isCompleted = i < completedCount;
        const isActive = i === activeIndex && !isCompleted;
        const isPending = !isCompleted && !isActive;

        return (
          <div key={i} className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              {isCompleted ? (
                <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : isActive ? (
                <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center text-white ring-4 ring-[#0078D4]/20 shadow-md">
                  <span className="text-[12px] font-bold">{String(i + 1).padStart(2, "0")}</span>
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-black/20 flex items-center justify-center opacity-40">
                  <span className="text-[12px] font-bold">{String(i + 1).padStart(2, "0")}</span>
                </div>
              )}
              <span
                className={`text-[14px] font-semibold ${
                  isCompleted
                    ? "text-emerald-600"
                    : isActive
                    ? "text-[#0078D4]"
                    : "text-black/40"
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <svg className="w-4 h-4 text-black/20 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
