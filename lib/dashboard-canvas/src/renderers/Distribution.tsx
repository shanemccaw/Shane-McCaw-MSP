/**
 * Distribution — Nivo pie/donut. Accepts `distribution` shape.
 */
import { ResponsivePie } from "@nivo/pie";
import type { DistributionWidgetData } from "../types";

export interface DistributionProps {
  data: DistributionWidgetData;
}

const PALETTE = ["#0078D4", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#64748b"];

export function Distribution({ data }: DistributionProps) {
  const slices = data.slices.filter((s) => s.value > 0);
  if (slices.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">No breakdown available</span>
      </div>
    );
  }

  const pieData = slices.map((s) => ({ id: s.name, label: s.name, value: s.value }));

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <ResponsivePie
        data={pieData}
        margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
        innerRadius={0.55}
        padAngle={1}
        cornerRadius={2}
        colors={PALETTE}
        borderWidth={0}
        enableArcLinkLabels={pieData.length <= 6}
        arcLinkLabelsSkipAngle={10}
        arcLinkLabelsTextColor="var(--muted-foreground, #71717a)"
        arcLinkLabelsThickness={1.5}
        arcLinkLabelsColor={{ from: "color" }}
        enableArcLabels={false}
        theme={{ tooltip: { container: { fontSize: 12, borderRadius: 8 } } }}
      />
    </div>
  );
}
