interface HealthPanelProps {
  overallScore: number;
  categoryScores: Record<string, number>;
  scanning?: boolean;
}

// Maps display label → API scorecard key
const CATEGORIES: { label: string; key: string }[] = [
  { label: "Compliance", key: "compliance" },
  { label: "Copilot", key: "copilot" },
  { label: "Governance", key: "governance" },
  // The scorecard API uses "productivity" for Adoption/productivity metrics
  { label: "Adoption", key: "productivity" },
  { label: "Security", key: "security" },
];

function scoreColor(pct: number) {
  if (pct < 40) return { bar: "#ef4444", text: "text-red-600" };
  if (pct < 70) return { bar: "#f59e0b", text: "text-amber-600" };
  return { bar: "#10b981", text: "text-emerald-600" };
}

function ScoreRingSvg({ score, scanning }: { score: number; scanning?: boolean }) {
  const r = 45;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const offset = circumference - (pct / 100) * circumference;
  const { bar, text } = scoreColor(pct);

  if (scanning) {
    return (
      <div className="relative w-14 h-14 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90 animate-pulse" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-black/10" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * 0.65}
            style={{ transition: "stroke-dashoffset 600ms ease" }}
          />
        </svg>
        <span className="absolute text-[9px] font-semibold text-black/30 animate-pulse">…</span>
      </div>
    );
  }

  return (
    <div className="relative w-14 h-14 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-black/5" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={bar}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <span className={`absolute text-sm font-bold ${text}`}>{pct}%</span>
    </div>
  );
}

export default function HealthPanel({ overallScore, categoryScores, scanning = false }: HealthPanelProps) {
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div className="w-full max-w-7xl mx-auto mb-6">
      <div
        className="rounded-xl p-4 border border-black/5 shadow-sm flex flex-wrap lg:flex-nowrap items-center gap-6"
        style={{ backgroundColor: "rgba(255,255,255,0.70)", backdropFilter: "blur(12px)" }}
      >
        <div className="flex items-center gap-4 pr-6 border-r border-black/10 shrink-0">
          <ScoreRingSvg score={overallScore} scanning={scanning} />
          <div className="space-y-0.5">
            <h3 className="text-[11px] font-bold text-black/60 uppercase tracking-wider">M365 Health</h3>
            {scanning ? (
              <p className="text-[10px] text-black/40 animate-pulse">Scanning…</p>
            ) : (
              <p className="text-[10px] text-black/40">Updated {today}</p>
            )}
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 w-full">
          {CATEGORIES.map(({ label, key }) => {
            const pct = scanning ? 0 : (categoryScores[key] ?? 0);
            const { bar, text } = scoreColor(pct);
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-semibold text-black/50">{label}</span>
                  {scanning ? (
                    <span className="text-xs font-bold text-black/20 animate-pulse">—</span>
                  ) : (
                    <span className={`text-xs font-bold ${text}`}>{pct}%</span>
                  )}
                </div>
                <div className="h-1 w-full bg-black/5 rounded-full overflow-hidden">
                  {scanning ? (
                    <div
                      className="h-full rounded-full animate-pulse"
                      style={{
                        width: "35%",
                        backgroundColor: "#e2e8f0",
                      }}
                    />
                  ) : (
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: bar,
                        transition: "width 600ms ease",
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
