function ringColor(s: number) {
  return s >= 70 ? "#22c55e" : s >= 40 ? "#f59e0b" : "#ef4444";
}

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  dark?: boolean;
}

export default function ScoreRing({ score, size = 120, strokeWidth = 8, dark = false }: ScoreRingProps) {
  const r = (size / 2) - strokeWidth;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const color = ringColor(score);
  const trackColor = dark ? "rgba(255,255,255,0.1)" : "rgba(10,37,64,0.06)";
  const textColor = dark ? "text-white" : "";

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          style={{ transition: "stroke-dasharray 480ms cubic-bezier(0.42,0,0.58,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-black ${textColor}`} style={{ fontSize: size * 0.225, color: dark ? undefined : color }}>{score}</span>
        <span className={`font-bold uppercase tracking-widest ${dark ? "text-white/50" : "text-[#0A2540]/40"}`} style={{ fontSize: size * 0.083 }}>Score</span>
      </div>
    </div>
  );
}
