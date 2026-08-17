/**
 * AssessmentDriftChart.tsx
 *
 * Score-over-time-per-pillar for the Assessment Results Dashboard (#1059, epic
 * #454) — the drift visualization once the weekly Copilot Assessment rescan
 * (#1058, now live) has produced more than one real data point.
 *
 * Pillar grouping happens HERE, client-side, via `warRoomPillarForCheckKey`
 * (built from msp-portal's own `WAR_ROOM_PILLAR_DOMAINS` in warRoomScan.ts) —
 * deliberately not duplicated server-side. GET /api/portal/assessment/history
 * returns raw per-checkKey rows for exactly this reason: one place owns the
 * domain→pillar mapping so it can't drift from what the War Room already
 * renders.
 *
 * Score, per pillar per real rescan day, is the % of that pillar's checks that
 * reported `status === "ok"` that day — a real, honest derivation off raw
 * rows, not a fabricated or pre-aggregated number. Rows are grouped by
 * calendar day (not a run id — the history endpoint doesn't return one) the
 * same way pillar-trend.ts's checkpoint replay does: several checks landing
 * the same day are one real checkpoint, not one point each.
 */
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  WAR_ROOM_PILLAR_KEYS,
  warRoomPillarForCheckKey,
  type WarRoomPillarKey,
} from "@/components/war-room/warRoomScan";
import { cn } from "@/lib/utils";

export interface AssessmentHistoryPoint {
  checkKey: string;
  status: string | null;
  severityMatched: string | null;
  collectedAt: string;
}

interface AssessmentDriftChartProps {
  points: AssessmentHistoryPoint[] | null;
  loading: boolean;
  error: string | null;
  className?: string;
  height?: number;
}

const PILLAR_COLORS: Record<WarRoomPillarKey, string> = {
  governance: "hsl(var(--status-blue))",
  licensing: "hsl(var(--status-violet))",
  adoption: "hsl(var(--status-teal))",
  compliance: "hsl(var(--status-amber))",
  health: "hsl(var(--status-green))",
  security: "hsl(var(--status-red))",
  copilot: "hsl(var(--primary))",
};

function pillarLabel(pillar: WarRoomPillarKey): string {
  return pillar.charAt(0).toUpperCase() + pillar.slice(1);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** One real rescan day's per-pillar ok-rate (0-100), from raw checkKey rows. */
function buildDailyPillarSeries(points: AssessmentHistoryPoint[]) {
  const byDay = new Map<string, Map<WarRoomPillarKey, { ok: number; total: number }>>();

  for (const p of points) {
    const pillar = warRoomPillarForCheckKey(p.checkKey);
    if (!pillar) continue; // no pillar claims this check's domain — not plotted, never forced in
    const day = dayKey(p.collectedAt);
    let dayMap = byDay.get(day);
    if (!dayMap) {
      dayMap = new Map();
      byDay.set(day, dayMap);
    }
    const bucket = dayMap.get(pillar) ?? { ok: 0, total: 0 };
    bucket.total += 1;
    if (p.status === "ok") bucket.ok += 1;
    dayMap.set(pillar, bucket);
  }

  const days = [...byDay.keys()].sort();
  const rows = days.map((day) => {
    const dayMap = byDay.get(day)!;
    const row: Record<string, string | number> = { date: day };
    for (const pillar of WAR_ROOM_PILLAR_KEYS) {
      const bucket = dayMap.get(pillar);
      if (bucket) row[pillar] = Math.round((bucket.ok / bucket.total) * 100);
    }
    return row;
  });

  const pillarsWithData = WAR_ROOM_PILLAR_KEYS.filter((pillar) =>
    rows.some((row) => typeof row[pillar] === "number"),
  );

  return { rows, days, pillarsWithData };
}

export function AssessmentDriftChart({
  points,
  loading,
  error,
  className,
  height = 280,
}: AssessmentDriftChartProps) {
  const { rows, days, pillarsWithData } = useMemo(
    () => buildDailyPillarSeries(points ?? []),
    [points],
  );

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    for (const pillar of pillarsWithData) {
      config[pillar] = { label: pillarLabel(pillar), color: PILLAR_COLORS[pillar] };
    }
    return config;
  }, [pillarsWithData]);

  if (loading) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground font-mono", className)}
        style={{ height }}
      >
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-status-red font-mono", className)}
        style={{ height }}
      >
        {error}
      </div>
    );
  }

  if (!points || points.length === 0) {
    return (
      <div
        data-testid="assessment-drift-empty"
        className={cn("flex flex-col items-center justify-center text-center gap-1 py-8", className)}
        style={{ height }}
      >
        <p className="text-sm font-medium text-muted-foreground">No scan history yet</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs">
          Your Copilot Assessment now rescans weekly. Your first data point lands after this
          Sunday's scan — check back next week to see the trend start.
        </p>
      </div>
    );
  }

  if (days.length < 2 || pillarsWithData.length === 0) {
    return (
      <div
        data-testid="assessment-drift-sparse"
        className={cn("flex flex-col items-center justify-center text-center gap-1 py-8", className)}
        style={{ height }}
      >
        <p className="text-sm font-medium text-muted-foreground">Not enough history yet to show a trend</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs">
          One real scan is in so far — the trend line appears once a couple more weekly rescans
          have run.
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid="assessment-drift-chart">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Score over time, by pillar
      </p>
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height }}>
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(d).toLocaleDateString()}
            minTickGap={40}
            className="font-mono"
          />
          <YAxis className="font-mono" domain={[0, 100]} />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={(d) => new Date(String(d)).toLocaleDateString()} />}
          />
          {pillarsWithData.map((pillar) => (
            <Line
              key={pillar}
              type="monotone"
              dataKey={pillar}
              name={pillarLabel(pillar)}
              stroke={PILLAR_COLORS[pillar]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}

export default AssessmentDriftChart;
