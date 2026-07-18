/**
 * ScoreRing — ported from the legacy `ScoreRing`/`DeltaBadge` pair in
 * artifacts/crm/src/pages/portal/PortalHealthScore.tsx (read in full before
 * porting). Same visual design, same thresholds (>=70 green / >=40 amber /
 * else red), same SVG geometry (radius = (size-8)/2, stroke width 6, rotated
 * -90deg so the ring starts at 12 o'clock) and the same delta badge showing
 * change vs. a prior score. Added: a CSS transition on the stroke's
 * dasharray/color so the ring animates when its score changes (the source had
 * no animation to preserve — this is additive, not a deviation from it).
 *
 * Per the registry, ScoreRing only ever renders metrics with a
 * denominatorMetric set (a percentage-eligible scalar) — see
 * canRendererRenderMetric in @workspace/dashboard-registry.
 */
import type { ScalarWidgetData } from "../types";

export interface ScoreRingProps {
  data: ScalarWidgetData;
  size?: number;
  /** First/baseline score to diff the current score against, for the delta badge. */
  previousValue?: number | null;
}

function scoreColor(score: number): string {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function ScoreRingSvg({ score, size = 88 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 600ms ease-out, stroke 600ms ease-out" }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size >= 64 ? 14 : 11}
        fontWeight="700"
        fill={color}
      >
        {Math.round(score)}%
      </text>
    </svg>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs text-gray-400">no change</span>;
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${
        positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {positive ? "▲" : "▼"} {Math.abs(Math.round(delta))}pts
    </span>
  );
}

export function ScoreRing({ data, size = 88, previousValue }: ScoreRingProps) {
  const score = data.percentage ?? data.value;
  if (score == null) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  const delta = previousValue != null ? score - previousValue : null;

  return (
    <div className="flex-1 flex items-center justify-center gap-4 min-h-0 px-3">
      <ScoreRingSvg score={score} size={size} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 truncate">{data.label}</p>
        {delta != null && (
          <div className="mt-1">
            <DeltaBadge delta={delta} />
          </div>
        )}
      </div>
    </div>
  );
}
