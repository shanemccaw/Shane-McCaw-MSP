/**
 * EngineTrendChart.tsx
 *
 * Generic engine score trend chart. Works unmodified for any engine key the
 * registry exposes through GET /api/portal/engines/:key/history (customer's
 * own session) or GET /api/msp/engines/:key/history?customerId=... (MSP
 * staff viewing one customer in their book) — no per-engine special-casing
 * lives here; a bespoke engine treatment is a follow-up, not scope for this
 * component.
 *
 * Signal-color rule (locked, platform-wide): while the trend is
 * flat-or-improving, the line/bars render with the blue → violet → teal
 * gradient. The moment the most recent point crosses into a worse state than
 * the baseline, color drops to flat amber/red — gradient is never used once
 * something needs attention. Engine scores in this platform are risk-index
 * style (higher = worse, see portal-mission-control.ts's toStatusEntry), so
 * "improving" means the latest point has not risen past the baseline.
 */

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceDot, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface EngineHistoryPoint {
  date: string;
  score: number;
  previousScore: number | null;
  delta: number | null;
  trendDirection: string | null;
  source: "snapshot" | "rollup";
  runId: string | null;
  ruleVersion: number | null;
}

interface BaselineEvent {
  id: number;
  baselineScore: number;
  resetTriggerType: string | null;
  createdAt: string;
}

interface HistoryResponse {
  engineKey: string;
  customerId: number;
  series: EngineHistoryPoint[];
  baselineEvents: BaselineEvent[];
  signalDeltas: Array<{ signalKey: string; label: string; direction: string; date: string; historyId: number }>;
}

export interface EngineTrendChartProps {
  engineKey: string;
  /** MSP-scoped customer to view. Omit to use the authenticated customer's own portal session. */
  customerId?: number;
  variant?: "line" | "bar";
  start?: string;
  end?: string;
  title?: string;
  height?: number;
  className?: string;
}

type TrendColorState = { mode: "gradient" } | { mode: "flat"; color: "amber" | "red" };

function computeTrendColorState(series: EngineHistoryPoint[], baselineEvents: BaselineEvent[]): TrendColorState {
  if (series.length === 0) return { mode: "gradient" };
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1]!;
  const baselineScore =
    baselineEvents.length > 0 ? baselineEvents[baselineEvents.length - 1]!.baselineScore : sorted[0]!.score;

  if (latest.score <= baselineScore) return { mode: "gradient" };
  const delta = latest.score - baselineScore;
  return { mode: "flat", color: delta >= 15 ? "red" : "amber" };
}

const chartConfig: ChartConfig = {
  score: { label: "Score" },
};

export function EngineTrendChart({
  engineKey,
  customerId,
  variant = "line",
  start,
  end,
  title,
  height = 240,
  className,
}: EngineTrendChartProps) {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (customerId != null) params.set("customerId", String(customerId));
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const qs = params.toString();
    const base =
      customerId != null ? `/api/msp/engines/${engineKey}/history` : `/api/portal/engines/${engineKey}/history`;

    fetchWithAuth(qs ? `${base}?${qs}` : base)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load engine history (${res.status})`);
        return (await res.json()) as HistoryResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load engine history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [engineKey, customerId, start, end, fetchWithAuth]);

  const trendState = useMemo(
    () => computeTrendColorState(data?.series ?? [], data?.baselineEvents ?? []),
    [data],
  );

  const gradientId = `engine-trend-gradient-${engineKey}-${customerId ?? "self"}`;
  const strokeColor =
    trendState.mode === "gradient"
      ? `url(#${gradientId})`
      : trendState.color === "red"
        ? "hsl(var(--status-red))"
        : "hsl(var(--status-amber))";

  if (loading) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground font-mono", className)}
        style={{ height }}
      >
        Loading trend…
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

  if (!data || data.series.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ height }}
      >
        No history yet for this engine.
      </div>
    );
  }

  const sortedSeries = [...data.series].sort((a, b) => a.date.localeCompare(b.date));

  const gradientDef = (
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="hsl(var(--status-blue))" />
        <stop offset="50%" stopColor="hsl(var(--status-violet))" />
        <stop offset="100%" stopColor="hsl(var(--status-teal))" />
      </linearGradient>
    </defs>
  );

  return (
    <div className={className}>
      {title && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>}
      <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height }}>
        {variant === "bar" ? (
          <BarChart data={sortedSeries}>
            {gradientDef}
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => new Date(d).toLocaleDateString()}
              minTickGap={40}
              className="font-mono"
            />
            <YAxis className="font-mono" />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={(d) => new Date(String(d)).toLocaleString()} />}
            />
            <Bar dataKey="score" fill={strokeColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={sortedSeries}>
            {gradientDef}
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => new Date(d).toLocaleDateString()}
              minTickGap={40}
              className="font-mono"
            />
            <YAxis className="font-mono" />
            <ChartTooltip
              content={<ChartTooltipContent labelFormatter={(d) => new Date(String(d)).toLocaleString()} />}
            />
            <Line type="monotone" dataKey="score" stroke={strokeColor} strokeWidth={2} dot={false} />
            {data.baselineEvents.map((b) => {
              const point = sortedSeries.find((s) => s.date >= b.createdAt);
              if (!point) return null;
              return (
                <ReferenceDot
                  key={b.id}
                  x={point.date}
                  y={b.baselineScore}
                  r={5}
                  fill="hsl(var(--status-violet))"
                  stroke="none"
                />
              );
            })}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}

export default EngineTrendChart;
