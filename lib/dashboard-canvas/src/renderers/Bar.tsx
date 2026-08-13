/**
 * Bar — Nivo bar chart. Per the registry, Bar accepts BOTH `distribution` and
 * `trend` shapes (categories-as-bars, or a time series rendered as bars instead
 * of a line) — normalize either into the same { category, value } row shape.
 */
import { ResponsiveBar } from "@nivo/bar";
import type { DistributionWidgetData, TrendWidgetData } from "../types";

export interface BarProps {
  data: DistributionWidgetData | TrendWidgetData;
}

export function Bar({ data }: BarProps) {
  const rows =
    data.shape === "distribution"
      ? data.slices.map((s) => ({ category: s.name, value: s.value }))
      : data.points.map((p) => ({
          category: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          value: p.value,
        }));

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">No data to chart</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <ResponsiveBar
        data={rows}
        keys={["value"]}
        indexBy="category"
        margin={{ top: 12, right: 16, bottom: 40, left: 40 }}
        padding={0.3}
        colors={["#0078D4"]}
        borderRadius={3}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickRotation: rows.length > 6 ? -35 : 0,
        }}
        axisLeft={{ tickSize: 0, tickPadding: 8 }}
        enableGridX={false}
        gridYValues={4}
        enableLabel={false}
        theme={{
          axis: { ticks: { text: { fontSize: 10, fill: "var(--muted-foreground, #71717a)" } } },
          grid: { line: { stroke: "var(--border, #e5e7eb)", strokeWidth: 1 } },
          tooltip: { container: { fontSize: 12, borderRadius: 8 } },
        }}
      />
    </div>
  );
}
