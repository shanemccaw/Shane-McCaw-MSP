import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export interface TrendChartProps {
  title: string;
  description?: string;
  data: any[];
  xAxisKey: string;
  series: {
    key: string;
    name: string;
    color: string;
  }[];
  height?: number;
  valueFormatter?: (value: number) => string;
}

export function TrendChart({
  title,
  description,
  data,
  xAxisKey,
  series,
  height = 300,
  valueFormatter,
}: TrendChartProps) {
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    series.forEach((s) => {
      config[s.key] = {
        label: s.name,
        color: s.color,
      };
    });
    return config;
  }, [series]);

  return (
    <Card className="flex flex-col border-slate-800 bg-slate-950/40">
      <CardHeader className="items-center pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 pb-4">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-auto w-full"
          style={{ height }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{
                left: 0,
                right: 0,
                top: 10,
                bottom: 0,
              }}
            >
              <defs>
                {series.map((s) => (
                  <linearGradient
                    key={s.key}
                    id={`fill${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={`var(--color-${s.key})`} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={`var(--color-${s.key})`} stopOpacity={0.1} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey={xAxisKey}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                stroke="#94a3b8"
                fontSize={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={valueFormatter}
                stroke="#94a3b8"
                fontSize={12}
                width={40}
              />
              <ChartTooltip
                cursor={{ stroke: "#475569", strokeWidth: 1, strokeDasharray: "4 4" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      });
                    }}
                    indicator="dot"
                  />
                }
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  fill={`url(#fill${s.key})`}
                  fillOpacity={0.4}
                  stroke={`var(--color-${s.key})`}
                  strokeWidth={2}
                  stackId="1" // Optional: remove if you don't want stacked areas
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
