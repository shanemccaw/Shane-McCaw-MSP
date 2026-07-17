import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
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

export interface BarComparisonChartProps {
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
  layout?: "horizontal" | "vertical";
  valueFormatter?: (value: number) => string;
}

export function BarComparisonChart({
  title,
  description,
  data,
  xAxisKey,
  series,
  height = 300,
  layout = "horizontal",
  valueFormatter,
}: BarComparisonChartProps) {
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
            <BarChart
              data={data}
              layout={layout}
              margin={{
                left: layout === "vertical" ? 20 : 0,
                right: 0,
                top: 10,
                bottom: 0,
              }}
            >
              <CartesianGrid
                vertical={layout === "vertical"}
                horizontal={layout === "horizontal"}
                strokeDasharray="3 3"
                stroke="#334155"
              />
              {layout === "horizontal" ? (
                <>
                  <XAxis
                    dataKey={xAxisKey}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
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
                </>
              ) : (
                <>
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={valueFormatter}
                    stroke="#94a3b8"
                    fontSize={12}
                  />
                  <YAxis
                    dataKey={xAxisKey}
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    stroke="#94a3b8"
                    fontSize={12}
                    width={80}
                  />
                </>
              )}
              <ChartTooltip
                cursor={{ fill: "#334155", opacity: 0.2 }}
                content={<ChartTooltipContent indicator="dashed" />}
              />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={`var(--color-${s.key})`}
                  radius={layout === "horizontal" ? [4, 4, 0, 0] : [0, 4, 4, 0]}
                  barSize={layout === "horizontal" ? 32 : 16}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
