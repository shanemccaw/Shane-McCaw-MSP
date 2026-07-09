interface PhaseStepperBarProps {
  steps: string[];
  activeIndex: number;
  completedCount: number;
}

export default function PhaseStepperBar({ steps, activeIndex, completedCount }: PhaseStepperBarProps) {
  return (
    <div className="w-full select-none">
      {/* Track row — items-start so connector alignment isn't affected by label height */}
      <div className="flex items-start w-full">
        {steps.map((label, i) => {
          const isCompleted = i < completedCount;
          const isActive    = i === activeIndex && !isCompleted;
          const isLast      = i === steps.length - 1;

          return (
            <div key={i} className="flex items-start flex-1 min-w-0 last:flex-none">
              {/* Node: circle + label stacked */}
              <div className="flex-shrink-0 flex flex-col items-center w-20 sm:w-28">
                {/* Circle */}
                {isCompleted ? (
                  <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : isActive ? (
                  <div className="w-7 h-7 rounded-full bg-[#0078D4] flex items-center justify-center shadow-md ring-4 ring-[#0078D4]/25">
                    <span className="text-[11px] font-bold text-white leading-none">{i + 1}</span>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-black/15 flex items-center justify-center bg-white/60">
                    <span className="text-[11px] font-semibold text-black/30 leading-none">{i + 1}</span>
                  </div>
                )}

                {/* Label shown below every node */}
                <div
                  className={`mt-1.5 w-full text-center text-[11px] leading-snug break-words px-0.5 ${
                    isCompleted
                      ? "font-medium text-emerald-600"
                      : isActive
                        ? "font-semibold text-[#0078D4]"
                        : "font-medium text-black/40"
                  }`}
                >
                  {label}
                </div>
              </div>

              {/* Connector line — anchored to circle center, unaffected by label height below */}
              {!isLast && (
                <div className="flex-1 h-[2px] mx-1.5 mt-[13px] rounded-full overflow-hidden bg-black/10">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: isCompleted ? "100%" : "0%",
                      background: "linear-gradient(to right, #10b981, #059669)",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
