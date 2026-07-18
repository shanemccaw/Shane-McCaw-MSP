/**
 * Radar — Nivo radar / spider chart, multi-dimension. Accepts `distribution`
 * shape per the registry (e.g. engine.pillarSnapshot's per-pillar scores) —
 * each slice becomes one spoke of the radar.
 */
import { ResponsiveRadar } from "@nivo/radar";
import type { DistributionWidgetData } from "../types";

export interface RadarProps {
  data: DistributionWidgetData;
}

export function Radar({ data }: RadarProps) {
  if (data.slices.length < 3) {
    // A radar needs at least 3 dimensions to read as a shape.
    return (
      <div className="flex-1 flex items-center justify-center min-h-0 px-3 text-center">
        <span className="text-xs text-muted-foreground">Needs 3+ dimensions to render as a radar</span>
      </div>
    );
  }

  // Nivo radar wants one row per "index" (dimension) with a value per series key.
  const rows = data.slices.map((s) => ({ dimension: s.name, [data.label]: s.value }));

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <ResponsiveRadar
        data={rows}
        keys={[data.label]}
        indexBy="dimension"
        maxValue="auto"
        margin={{ top: 24, right: 40, bottom: 24, left: 40 }}
        gridLevels={4}
        gridShape="circular"
        colors={["#0078D4"]}
        fillOpacity={0.15}
        borderWidth={2}
        dotSize={6}
        dotColor={{ theme: "background" }}
        dotBorderWidth={2}
        dotBorderColor="#0078D4"
        enableDotLabel={false}
        theme={{
          axis: { ticks: { text: { fontSize: 9, fill: "var(--muted-foreground, #71717a)" } } },
          grid: { line: { stroke: "var(--border, #e5e7eb)" } },
          tooltip: { container: { fontSize: 12, borderRadius: 8 } },
        }}
      />
    </div>
  );
}
