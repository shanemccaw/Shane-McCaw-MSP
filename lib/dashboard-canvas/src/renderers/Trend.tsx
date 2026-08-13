/**
 * Trend — Nivo line/area chart. Accepts `trend` shape (a { date, value }[] series).
 */
import { ResponsiveLine } from "@nivo/line";
import type { TrendWidgetData } from "../types";

export interface TrendProps {
  data: TrendWidgetData;
}

export function Trend({ data }: TrendProps) {
  if (data.points.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">No points in range</span>
      </div>
    );
  }

  const series = [
    {
      id: data.label,
      data: data.points.map((p) => ({ x: p.date, y: p.value })),
    },
  ];

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <ResponsiveLine
        data={series}
        margin={{ top: 12, right: 16, bottom: 32, left: 40 }}
        xScale={{ type: "point" }}
        yScale={{ type: "linear", min: "auto", max: "auto", stacked: false }}
        curve="monotoneX"
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickRotation: 0,
          format: (v) => new Date(String(v)).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          tickValues: Math.min(5, data.points.length),
        }}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        enableGridX={false}
        gridYValues={4}
        colors={["#0078D4"]}
        lineWidth={2.5}
        enablePoints={data.points.length <= 30}
        pointSize={5}
        pointColor="#0078D4"
        pointBorderWidth={0}
        enableArea
        areaOpacity={0.08}
        useMesh
        theme={{
          axis: { ticks: { text: { fontSize: 10, fill: "var(--muted-foreground, #71717a)" } } },
          grid: { line: { stroke: "var(--border, #e5e7eb)", strokeWidth: 1 } },
          tooltip: { container: { fontSize: 12, borderRadius: 8 } },
        }}
      />
    </div>
  );
}
