import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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
  ChartTooltipContent,
} from "@/components/ui/chart";

export interface DistributionChartProps {
  title: string;
  description?: string;
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  height?: number;
  valueFormatter?: (value: number) => string;
}

export function DistributionChart({
  title,
  description,
  data,
  height = 250,
  valueFormatter,
}: DistributionChartProps) {
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    data.forEach((item, index) => {
      config[`item${index}`] = {
        label: item.name,
        color: item.color,
      };
    });
    return config;
  }, [data]);

  return (
    <Card className="flex flex-col border-slate-800 bg-slate-950/40">
      <CardHeader className="items-center pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 pb-4">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square w-full"
          style={{ height, maxHeight: height }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, name, item) => {
                      const formattedValue = valueFormatter
                        ? valueFormatter(value as number)
                        : value;
                      return (
                        <div className="flex items-center gap-2">
                          <div
                            className="size-2 rounded-full"
                            style={{ backgroundColor: item.payload.color }}
                          />
                          <span className="text-sm font-medium">{item.payload.name}:</span>
                          <span className="text-sm">{formattedValue}</span>
                        </div>
                      );
                    }}
                  />
                }
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartContainer>
        
        {/* Custom Legend */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {data.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="size-3 rounded-sm shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="truncate text-slate-400" title={item.name}>
                {item.name}
              </span>
              <span className="ml-auto font-medium">
                {valueFormatter ? valueFormatter(item.value) : item.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
