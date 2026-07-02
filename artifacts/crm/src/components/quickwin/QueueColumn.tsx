interface QueueColumnProps {
  pendingSteps: string[];
}

export default function QueueColumn({ pendingSteps }: QueueColumnProps) {
  return (
    <div className="hidden lg:flex lg:col-span-3 flex-col gap-4 overflow-hidden">
      <h3 className="text-[11px] font-bold text-black/40 uppercase tracking-widest px-2 mb-2">Up Next…</h3>
      <div className="grid grid-cols-1 gap-2.5">
        {pendingSteps.map((title, i) => (
          <div
            key={i}
            className="p-3.5 rounded-xl border border-black/10 bg-white/50 backdrop-blur-md"
            style={{ backdropFilter: "blur(8px)" }}
          >
            <div className="flex items-center gap-2 text-black/50">
              <span className="w-2 h-2 rounded-full bg-black/20 flex-shrink-0" />
              <span className="text-[11px] font-bold">{title}</span>
            </div>
          </div>
        ))}
        {pendingSteps.length === 0 && (
          <p className="text-[11px] text-black/30 px-2">No more steps.</p>
        )}
      </div>
    </div>
  );
}
