interface QuickWinFooterProps {
  progressPct: number;
  completedCount: number;
  clientName: string;
  clientAvatarUrl?: string;
}

export default function QuickWinFooter({
  progressPct,
  completedCount,
  clientName,
  clientAvatarUrl,
}: QuickWinFooterProps) {
  const initials = clientName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <footer
      className="relative z-10 w-full border-t border-black/5 px-10 py-5 flex flex-col md:flex-row items-center justify-between gap-6"
      style={{ backgroundColor: "rgba(255,255,255,0.80)", backdropFilter: "blur(12px)" }}
    >
      <div className="flex items-center gap-6 flex-1 w-full max-w-2xl">
        <span className="text-[11px] font-bold text-black/50 shrink-0 uppercase tracking-widest">
          QUICK WIN PROGRESS
        </span>
        <div className="h-2 flex-1 bg-black/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0078D4] shadow-[0_1px_4px_rgba(0,120,212,0.2)] rounded-full"
            style={{
              width: `${progressPct}%`,
              transition: "width 800ms cubic-bezier(0.42,0,0.58,1)",
            }}
          />
        </div>
        <span className="text-[14px] font-semibold text-[#0078D4]">{Math.round(progressPct)}%</span>
      </div>

      <div className="flex items-center gap-8 text-black/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] font-bold">{completedCount} Complete</span>
        </div>

        <div className="pl-8 border-l border-black/10 hidden sm:flex items-center gap-3">
          <div className="text-right">
            <p className="text-[14px] font-semibold text-[#191c1e]">{clientName}</p>
          </div>
          {clientAvatarUrl ? (
            <img
              src={clientAvatarUrl}
              className="w-10 h-10 rounded-full border border-[#0078D4]/10 shadow-sm object-cover"
              alt={clientName}
            />
          ) : (
            <div className="w-10 h-10 rounded-full border border-[#0078D4]/20 bg-[#0078D4]/10 flex items-center justify-center text-[#0078D4] font-bold text-sm shadow-sm">
              {initials}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
