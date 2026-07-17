import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number; // Percentage change
    label: string; // e.g., "vs last month"
    direction?: "up" | "down" | "neutral"; // If not provided, inferred from value > 0
    goodDirection?: "up" | "down"; // Which direction is considered "good" for coloring. Default "up".
  };
  className?: string;
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: MetricCardProps) {
  let trendColor = "text-muted-foreground";
  let TrendIcon = Minus;

  if (trend) {
    const direction =
      trend.direction || (trend.value > 0 ? "up" : trend.value < 0 ? "down" : "neutral");
    const goodDirection = trend.goodDirection || "up";

    if (direction === "up") {
      TrendIcon = ArrowUp;
      trendColor = goodDirection === "up" ? "text-emerald-500" : "text-rose-500";
    } else if (direction === "down") {
      TrendIcon = ArrowDown;
      trendColor = goodDirection === "down" ? "text-emerald-500" : "text-rose-500";
    }
  }

  return (
    <Card className={cn("overflow-hidden border-slate-800 bg-slate-950/40", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-slate-400">{title}</CardTitle>
        {Icon && <Icon className="size-4 text-slate-500" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight text-slate-100">{value}</div>
        {(description || trend) && (
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
            {trend && (
              <span className={cn("flex items-center font-medium", trendColor)}>
                <TrendIcon className="size-3 mr-0.5 shrink-0" />
                {Math.abs(trend.value)}%
              </span>
            )}
            {trend?.label && <span className="text-slate-500">{trend.label}</span>}
            {description && !trend && <span>{description}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
