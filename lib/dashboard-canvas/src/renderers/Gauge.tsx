/**
 * Gauge — scalar with a threshold ring. Deliberately a linear progress/threshold
 * bar rather than a circular ring — ScoreRing already owns the circular design.
 * Accepts `scalar` shape and `supportsSmartMode` (banding is layered on by the
 * Smart renderer, not here — Gauge just needs a target to compute fill %).
 */
import type { ScalarWidgetData } from "../types";

export interface GaugeProps {
  data: ScalarWidgetData;
  /** The value considered "full" (100%) — e.g. smartDefaultTarget from the metric. */
  target?: number;
}

function gaugeColor(pct: number): string {
  if (pct >= 70) return "#22c55e";
  if (pct >= 40) return "#f59e0b";
  return "#ef4444";
}

export function Gauge({ data, target = 100 }: GaugeProps) {
  const value = data.percentage ?? data.value;
  if (value == null) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">—</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, target > 0 ? (value / target) * 100 : 0));
  const color = gaugeColor(pct);

  return (
    <div className="flex-1 flex flex-col justify-center gap-2 min-h-0 px-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-muted-foreground truncate">{data.label}</p>
        <span className="text-lg font-bold tabular-nums" style={{ color }}>
          {Math.round(value)}
          {data.percentage != null ? "%" : ""}
        </span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/70">
        <span>0</span>
        <span>Target: {target}</span>
      </div>
    </div>
  );
}
