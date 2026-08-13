/**
 * Heatmap — Nivo heatmap, 2D grid. Accepts `heatmap` shape ({x, y, value}[] cells).
 * Pivots the flat cell list into Nivo's row-based { id, data: [{x, y}] } shape.
 */
import { ResponsiveHeatMap } from "@nivo/heatmap";
import type { HeatmapWidgetData } from "../types";

export interface HeatmapProps {
  data: HeatmapWidgetData;
}

export function Heatmap({ data }: HeatmapProps) {
  if (data.cells.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">No cells to plot</span>
      </div>
    );
  }

  const yValues = [...new Set(data.cells.map((c) => String(c.y)))];
  const xValues = [...new Set(data.cells.map((c) => String(c.x)))].sort((a, b) =>
    Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : a.localeCompare(b),
  );

  const rows = yValues.map((y) => ({
    id: y,
    data: xValues.map((x) => {
      const cell = data.cells.find((c) => String(c.x) === x && String(c.y) === y);
      return { x, y: cell?.value ?? 0 };
    }),
  }));

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <ResponsiveHeatMap
        data={rows}
        margin={{ top: 12, right: 12, bottom: 32, left: 48 }}
        valueFormat=">-.0f"
        axisTop={null}
        axisBottom={{ tickSize: 0, tickPadding: 6 }}
        axisLeft={{ tickSize: 0, tickPadding: 6 }}
        colors={{ type: "sequential", scheme: "blues" }}
        emptyColor="var(--muted, #f4f4f5)"
        borderRadius={2}
        borderWidth={1}
        borderColor="var(--background, #ffffff)"
        theme={{
          axis: { ticks: { text: { fontSize: 9, fill: "var(--muted-foreground, #71717a)" } } },
          tooltip: { container: { fontSize: 12, borderRadius: 8 } },
        }}
      />
    </div>
  );
}
