import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { TrendPoint } from "./TrendLineChart";

/**
 * Recharts implementation behind TrendLineChart — kept in its own module so
 * recharts (the app's only chart dependency, otherwise unused) code-splits out
 * of the main bundle via the React.lazy boundary in TrendLineChart.tsx.
 *
 * Styling: single 2px line in flat amber (#f59e0b, the site's established
 * attention color — same hex as FlagshipPortalPreview's metric bars), no grid
 * chrome (sparkline treatment inside an already-labeled panel), endpoint dot
 * with a charcoal surface ring plus a direct mono end-label so the latest value
 * reads without hovering, first/last x labels only in text-tertiary.
 */

const AMBER = "#f59e0b";
const AMBER_TEXT = "#fbbf24"; /* amber-400 — brighter for small text on charcoal */

function EndpointDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  value?: number;
  dataLength: number;
}) {
  const { cx, cy, index, value, dataLength } = props;
  if (index !== dataLength - 1 || cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4.5} fill={AMBER} stroke="#232326" strokeWidth={2} />
      <text
        x={cx - 8}
        y={cy - 9}
        textAnchor="end"
        fontSize={11}
        fontWeight={600}
        fill={AMBER_TEXT}
        style={{ fontFamily: "var(--app-font-numeric)" }}
      >
        {value}
      </text>
    </g>
  );
}

export default function TrendLineChartInner({
  data,
  seriesLabel,
  height,
}: {
  data: TrendPoint[];
  seriesLabel: string;
  height: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* right margin clears the centered "Latest" tick label at narrow widths */}
      <LineChart data={data} margin={{ top: 18, right: 28, bottom: 0, left: 12 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#6B6B72" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis hide domain={[0, "dataMax + 2"]} />
        <Tooltip
          cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
          contentStyle={{
            fontSize: 11,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(35,35,38,0.97)",
            color: "#F5F5F7",
          }}
          formatter={(value: number) => [value, seriesLabel]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={AMBER}
          strokeWidth={2}
          strokeLinecap="round"
          isAnimationActive={false}
          dot={<EndpointDot dataLength={data.length} />}
          activeDot={{ r: 5, fill: AMBER, stroke: "#232326", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
