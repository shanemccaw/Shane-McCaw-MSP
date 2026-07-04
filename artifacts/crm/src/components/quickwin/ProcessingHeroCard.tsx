type SubState = "queued" | "starting" | "running" | "done";

interface ProcessingHeroCardProps {
  title: string;
  description?: string;
  category?: string;
  subState: SubState;
  isExiting?: boolean;
}

const STEP_LABELS = ["Queued", "Starting", "Running", "Done"];

function stepIndex(subState: SubState) {
  return { queued: 0, starting: 1, running: 2, done: 3 }[subState];
}

export default function ProcessingHeroCard({
  title,
  description,
  subState,
  isExiting,
}: ProcessingHeroCardProps) {
  const active = stepIndex(subState);

  return (
    <div
      className="rounded-xl p-3.5 flex flex-col gap-2.5 w-[210px] flex-shrink-0 relative border border-[#0078D4]/15 shadow-[0_4px_20px_rgba(0,120,212,0.10)] bg-white"
      style={{
        transform: isExiting ? "translateX(-120%) scale(0.92)" : "scale(1)",
        opacity: isExiting ? 0 : 1,
        transition: "transform 350ms cubic-bezier(0.42,0,0.58,1), opacity 350ms cubic-bezier(0.42,0,0.58,1)",
      }}
    >
      {/* Header row: status badge + category */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/30 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Running
        </span>
      </div>

      {/* Title — capped at 2 lines */}
      <p
        className="text-xs font-semibold text-[#0A2540] leading-snug"
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {title}
      </p>

      {/* Description — 1 line */}
      {description && (
        <p className="text-[10px] text-black/40 truncate leading-snug">{description}</p>
      )}

      {/* Step progress — horizontal dots */}
      <div className="flex items-center gap-0">
        {STEP_LABELS.map((label, i) => {
          const isDone = i < active;
          const isActive = i === active;
          const isPending = i > active;
          return (
            <div key={i} className="flex items-center flex-1 min-w-0">
              {/* Dot */}
              <div className="flex flex-col items-center flex-shrink-0">
                {isDone ? (
                  <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : isActive ? (
                  <div className="w-4 h-4 rounded-full bg-[#0078D4]/15 flex items-center justify-center ring-2 ring-[#0078D4]/30">
                    <div className="w-2 h-2 border-[1.5px] border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-black/15 bg-black/3 flex items-center justify-center opacity-40" />
                )}
                <span className={`mt-0.5 text-[8px] leading-none whitespace-nowrap ${isDone ? "text-emerald-600" : isActive ? "text-[#0078D4] font-semibold" : "text-black/25"}`}>
                  {label}
                </span>
              </div>
              {/* Connector line (not after last) */}
              {i < STEP_LABELS.length - 1 && (
                <div className={`h-px flex-1 mx-0.5 mb-3 ${i < active ? "bg-emerald-400" : "bg-black/10"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
