/**
 * WidgetTile — the common chrome every renderer renders inside: a label header
 * plus loading / not_available / error states mapped straight from the
 * resolve endpoint's MetricResult.status. Renderers only need to handle the
 * "ok" case; <DashboardCanvas> renders WidgetTile itself for the other three.
 */
import { AlertTriangle, Loader2, Inbox } from "lucide-react";

export function WidgetTileLoading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0">
      <Loader2 className="size-5 text-muted-foreground animate-spin" />
    </div>
  );
}

export function WidgetTileNotAvailable({ message }: { message?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1.5 min-h-0 text-center px-3">
      <Inbox className="size-6 text-muted-foreground/40" />
      <p className="text-xs font-medium text-muted-foreground">No data yet</p>
      {message && <p className="text-[10px] text-muted-foreground/70 leading-tight">{message}</p>}
    </div>
  );
}

export function WidgetTileError({ message }: { message?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1.5 min-h-0 text-center px-3">
      <AlertTriangle className="size-6 text-destructive/70" />
      <p className="text-xs font-medium text-destructive">Couldn't load this widget</p>
      {message && <p className="text-[10px] text-muted-foreground/70 leading-tight">{message}</p>}
    </div>
  );
}
