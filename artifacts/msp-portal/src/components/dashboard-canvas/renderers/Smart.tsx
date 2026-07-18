/**
 * Smart — accepts an explicit `state: "remediation" | "complete"` plus the
 * underlying scalar data, and renders whichever state it's told. The banding
 * decision logic (which state a metric is actually in, given its
 * smartBands/smartDefaultTarget) is a separate later step — this component is
 * intentionally dumb about that and just renders.
 *
 *   remediation — small Nivo sparkline + "X/Y -> improving" text + delta
 *   complete    — a clean badge/checkmark with the metric label
 */
import { ResponsiveLine } from "@nivo/line";
import { CheckCircle2 } from "lucide-react";
import type { SmartWidgetProps } from "../types";

export function Smart({ state, data, previousValue, history }: SmartWidgetProps) {
  if (state === "complete") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 px-3 text-center">
        <CheckCircle2 className="size-8 text-green-500" />
        <p className="text-sm font-semibold text-foreground">{data.label}</p>
        <p className="text-[11px] text-green-600 font-medium">Target reached</p>
      </div>
    );
  }

  // remediation
  const value = data.percentage ?? data.value;
  const delta = previousValue != null && value != null ? value - previousValue : null;
  const points = (history ?? []).map((p) => ({ x: p.date, y: p.value }));

  return (
    <div className="flex-1 flex flex-col gap-1.5 min-h-0 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground truncate">{data.label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-foreground">
          {value != null ? value.toLocaleString() : "—"}
          {data.percentage != null ? "%" : ""}
        </span>
        {delta != null && (
          <span className={`text-[11px] font-semibold ${delta < 0 ? "text-green-600" : delta > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
            {delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${Math.round(delta)} → improving`}
          </span>
        )}
      </div>
      {points.length >= 2 && (
        <div className="flex-1 min-h-[36px]">
          <ResponsiveLine
            data={[{ id: "history", data: points }]}
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
            xScale={{ type: "point" }}
            yScale={{ type: "linear", min: "auto", max: "auto" }}
            curve="monotoneX"
            axisBottom={null}
            axisLeft={null}
            enableGridX={false}
            enableGridY={false}
            colors={["#f59e0b"]}
            lineWidth={2}
            enablePoints={false}
            enableArea
            areaOpacity={0.1}
            isInteractive={false}
          />
        </div>
      )}
    </div>
  );
}
