/**
 * Stat — simple number/label card. Accepts `scalar` shape.
 * Optional trend-direction arrow when `properties.previousValue` is supplied
 * (a plain up/down/flat comparison — no banding logic here, that's Smart's job).
 */
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { ScalarWidgetData } from "../types";

export interface StatProps {
  data: ScalarWidgetData;
  previousValue?: number | null;
}

function TrendArrow({ value, previousValue }: { value: number; previousValue: number }) {
  if (value === previousValue) {
    return <ArrowRight className="size-3.5 text-muted-foreground" />;
  }
  const up = value > previousValue;
  return up ? (
    <ArrowUp className="size-3.5 text-green-500" />
  ) : (
    <ArrowDown className="size-3.5 text-red-500" />
  );
}

export function Stat({ data, previousValue }: StatProps) {
  const displayValue = data.percentage != null ? data.percentage : data.value;
  const suffix = data.percentage != null ? "%" : data.unit ?? "";

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1 min-h-0 px-3 text-center">
      <p className="text-xs font-medium text-muted-foreground truncate max-w-full">{data.label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold text-foreground tabular-nums">
          {displayValue != null ? displayValue.toLocaleString() : "—"}
        </span>
        {suffix && displayValue != null && (
          <span className="text-sm font-semibold text-muted-foreground">{suffix}</span>
        )}
        {previousValue != null && displayValue != null && (
          <TrendArrow value={displayValue} previousValue={previousValue} />
        )}
      </div>
    </div>
  );
}
