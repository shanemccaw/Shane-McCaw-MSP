/**
 * Timeline — event feed / activity list. Accepts `timeline` shape. Plain styled
 * list, no charting library needed.
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { TimelineWidgetData, TimelineEventStatus } from "../types";

export interface TimelineProps {
  data: TimelineWidgetData;
}

const STATUS_ICON: Record<TimelineEventStatus, React.ReactNode> = {
  ok: <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />,
  warning: <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />,
  critical: <XCircle className="size-3.5 text-red-500 shrink-0" />,
  info: <Info className="size-3.5 text-muted-foreground shrink-0" />,
};

export function Timeline({ data }: TimelineProps) {
  if (data.events.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <span className="text-xs text-muted-foreground">No recent events</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
      <ul className="space-y-2">
        {data.events.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-xs">
            {STATUS_ICON[e.status]}
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate">{e.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {e.time ? new Date(e.time).toLocaleString() : "—"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
