import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ScatterPoint } from "./ScatterChart";

/**
 * Recharts implementation behind ScatterChart — separate module so recharts
 * code-splits out of the main bundle (see TrendLineChartInner for the same
 * pattern and rationale).
 *
 * Styling: single series of amber dots (#f59e0b, the site's established
 * attention color — here the points depict waste/attention, same semantics as
 * the trend line and Findings bars) with the family's charcoal surface ring so
 * overlapping marks stay separable; recessive white-hairline x=y diagonal with
 * a muted-ink label (identity carried by text, not color alone); numeric ticks
 * in the same muted #6B6B72 as the trend chart's x labels; no grid chrome.
 */

const AMBER = "#f59e0b";
const MUTED = "#6B6B72";

function PointTooltip({
  active,
  payload,
  xLabel,
  yLabel,
}: {
  active?: boolean;
  payload?: { payload?: ScatterPoint }[];
  xLabel: string;
  yLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div
      style={{
        fontSize: 11,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(35,35,38,0.97)",
        color: "#F5F5F7",
        padding: "6px 10px",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{point.label}</div>
      <div>
        {xLabel}: {point.x}
      </div>
      <div>
        {yLabel}: {point.y}
      </div>
    </div>
  );
}

export default function ScatterChartInner({
  points,
  xLabel,
  yLabel,
  height,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height: number;
}) {
  // Shared square domain so the x=y diagonal is geometrically honest — the
  // "no waste" line must bisect the plot regardless of which axis maxes out.
  const max = Math.max(...points.map((p) => Math.max(p.x, p.y)), 1);
  const domainMax = Math.ceil((max * 1.1) / 10) * 10;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsScatterChart margin={{ top: 16, right: 24, bottom: 4, left: -18 }}>
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          domain={[0, domainMax]}
          tick={{ fontSize: 10, fill: MUTED }}
          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          tickLine={false}
          label={{ value: xLabel, position: "insideBottomRight", offset: 10, fontSize: 10, fill: MUTED }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          domain={[0, domainMax]}
          tick={{ fontSize: 10, fill: MUTED }}
          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          tickLine={false}
        />
        <ReferenceLine
          segment={[
            { x: 0, y: 0 },
            { x: domainMax, y: domainMax },
          ]}
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="4 4"
          label={{ value: "Full utilization", position: "insideTopLeft", fontSize: 10, fill: MUTED }}
        />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
          content={<PointTooltip xLabel={xLabel} yLabel={yLabel} />}
        />
        <Scatter
          data={points}
          fill={AMBER}
          stroke="#232326"
          strokeWidth={2}
          isAnimationActive={false}
          shape={(props: { cx?: number; cy?: number }) =>
            props.cx == null || props.cy == null ? (
              <g />
            ) : (
              <circle cx={props.cx} cy={props.cy} r={5.5} fill={AMBER} stroke="#232326" strokeWidth={2} />
            )
          }
        />
      </RechartsScatterChart>
    </ResponsiveContainer>
  );
}
