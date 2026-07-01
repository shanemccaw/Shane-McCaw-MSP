function ringColor(s: number) {
  return s >= 70 ? "#22c55e" : s >= 40 ? "#f59e0b" : "#ef4444";
}

interface QuickWinScoreRingProps {
  score: number;
  size?: number;
}

export default function QuickWinScoreRing({ score, size = 120 }: QuickWinScoreRingProps) {
  const strokeWidth = 8;
  const r = (size / 2) - strokeWidth;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const color = ringColor(score);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(10,37,64,0.06)" strokeWidth={strokeWidth} />
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          style={{ transition: "stroke-dasharray 480ms cubic-bezier(0.42,0,0.58,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black" style={{ color }}>{score}</span>
        <span className="text-[10px] font-bold text-[#0A2540]/40 uppercase tracking-widest">Score</span>
      </div>
    </div>
  );
}
