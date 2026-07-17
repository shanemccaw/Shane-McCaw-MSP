import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface HeatmapDataPoint {
  x: string; // e.g., "Mon", "Tue"
  y: string; // e.g., "00:00", "01:00"
  value: number;
}

export interface HeatmapChartProps {
  title: string;
  description?: string;
  data: HeatmapDataPoint[];
  xLabels: string[];
  yLabels: string[];
  colorScale?: (value: number) => string; // Returns a tailwind color class or hex
}

// Simple fallback color scale based on intensity
const defaultColorScale = (value: number) => {
  if (value === 0) return "bg-slate-800/50";
  if (value < 20) return "bg-primary/20";
  if (value < 50) return "bg-primary/40";
  if (value < 80) return "bg-primary/60";
  return "bg-primary";
};

export function HeatmapChart({
  title,
  description,
  data,
  xLabels,
  yLabels,
  colorScale = defaultColorScale,
}: HeatmapChartProps) {
  // Helper to find data point
  const getValue = (x: string, y: string) => {
    return data.find((d) => d.x === x && d.y === y)?.value || 0;
  };

  return (
    <Card className="flex flex-col border-slate-800 bg-slate-950/40 overflow-hidden">
      <CardHeader className="items-start pb-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1 overflow-x-auto">
        <div className="min-w-max">
          {/* X Axis Labels */}
          <div className="flex ml-12 mb-2">
            {xLabels.map((x) => (
              <div
                key={x}
                className="flex-1 text-center text-[10px] font-medium text-slate-500 w-8"
              >
                {x}
              </div>
            ))}
          </div>
          
          {/* Grid */}
          <div className="flex flex-col gap-1">
            {yLabels.map((y) => (
              <div key={y} className="flex items-center">
                {/* Y Axis Label */}
                <div className="w-12 text-right pr-3 text-[10px] font-medium text-slate-500 truncate">
                  {y}
                </div>
                {/* Row cells */}
                <div className="flex flex-1 gap-1">
                  {xLabels.map((x) => {
                    const val = getValue(x, y);
                    return (
                      <div
                        key={`${x}-${y}`}
                        title={`${x} ${y}: ${val}`}
                        className={cn(
                          "h-6 w-8 rounded-sm transition-colors duration-200 hover:ring-1 hover:ring-white/50 cursor-pointer",
                          val.toString().startsWith("bg-") || val.toString().startsWith("text-")
                            ? val // if colorScale returned a class directly (handled externally if needed)
                            : colorScale(val)
                        )}
                        style={
                          colorScale(val).startsWith("#") || colorScale(val).startsWith("rgb")
                            ? { backgroundColor: colorScale(val) }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
