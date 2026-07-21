import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { RadarAxis } from "./SurfaceRadarChart";

/**
 * Two-line wrapping tick for the angle axis — recharts renders side labels
 * anchored at the vertex, so an unwrapped multi-word label ("Admin role
 * hygiene") overflows the chart margins at mobile widths. Splits long labels
 * at the most balanced space; short labels stay one line.
 */
function WrappedAngleTick(props: {
  x?: number;
  y?: number;
  textAnchor?: "start" | "middle" | "end" | "inherit";
  payload?: { value?: string };
}) {
  const { x, y, textAnchor, payload } = props;
  const label = payload?.value ?? "";
  let lines = [label];
  if (label.length > 12 && label.includes(" ")) {
    const words = label.split(" ");
    let best = 1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ").length;
      const b = words.slice(i).join(" ").length;
      const diff = Math.abs(a - b);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  }
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill="#B5B5BC" fontSize={11}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? 0 : "1.15em"}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * Recharts implementation behind SurfaceRadarChart — separate module so
 * recharts code-splits out of the main bundle (see TrendLineChartInner for the
 * same pattern and rationale).
 *
 * Styling: one series in accent-blue (identity, not severity — a radar area is
 * a shape comparison, so it wears the brand series hue, not a status color),
 * ~12% fill wash, solid hairline polar grid one step off the surface, axis
 * names in text-secondary. Radius axis hidden — the 0–100 scale is carried by
 * the tooltip and the caption, not tick chrome.
 */
export default function SurfaceRadarChartInner({
  data,
  seriesLabel,
  height,
}: {
  data: RadarAxis[];
  seriesLabel: string;
  height: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 10, right: 44, bottom: 10, left: 44 }}>
        <PolarGrid stroke="rgba(255,255,255,0.08)" />
        <PolarAngleAxis dataKey="label" tick={<WrappedAngleTick />} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          name={seriesLabel}
          dataKey="value"
          stroke="#5B8DEF"
          fill="#5B8DEF"
          fillOpacity={0.12}
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(35,35,38,0.97)",
            color: "#F5F5F7",
          }}
          formatter={(value: number) => [`${value}/100`, seriesLabel]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
