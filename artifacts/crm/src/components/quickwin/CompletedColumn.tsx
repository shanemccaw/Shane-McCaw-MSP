interface CompletedColumnProps {
  completedSteps: string[];
}

export default function CompletedColumn({ completedSteps }: CompletedColumnProps) {
  return (
    <div className="hidden lg:flex col-span-2 flex-col gap-4 opacity-70 overflow-hidden">
      <h3 className="text-[11px] font-bold text-black/40 uppercase tracking-widest px-2 mb-2">COMPLETED</h3>
      <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px] pr-2 no-scrollbar">
        {completedSteps.map((title, i) => (
          <div
            key={i}
            className="p-3 rounded-xl border border-emerald-500/10 bg-emerald-50/50 shrink-0"
            style={{
              backdropFilter: "blur(8px)",
              animation: i === 0 ? "qw-slide-in-top 300ms cubic-bezier(0.42,0,0.58,1) forwards" : undefined,
            }}
          >
            <div className="flex items-center gap-2 text-emerald-600 mb-1">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[11px] font-bold">{title}</span>
            </div>
            <div className="h-1 w-full bg-emerald-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
