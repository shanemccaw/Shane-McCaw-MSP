/**
 * Freeze calendar (#1500) and maintenance windows (#1504) — read-only lists of
 * this tenant's standing rules. One row per standing rule (a one-off span or a
 * recurring cadence), not one row per occurrence.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WireFreezeOrMaintenanceWindow } from "@/lib/change-control-types";
import { fmtDateTime } from "@/lib/change-control-visuals";

function formatSpan(w: WireFreezeOrMaintenanceWindow): string {
  const start = fmtDateTime(w.startsAt);
  const end = fmtDateTime(w.endsAt);
  const cadence = w.recurrence !== "none" ? ` · ${w.recurrence}` : "";
  return `${start} → ${end}${cadence}`;
}

function CalendarList({
  windows,
  activeDotClass,
  emptyLine,
}: {
  windows: readonly WireFreezeOrMaintenanceWindow[];
  activeDotClass: string;
  emptyLine: string;
}) {
  if (windows.length === 0) {
    return <span className="text-[11.5px] text-muted-foreground">{emptyLine}</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      {windows.map((w) => (
        <div key={w.id} className="flex flex-wrap items-baseline gap-3 border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
          <span className={cn("mt-1 size-2 flex-none rounded-full", w.activeNow ? activeDotClass : "bg-muted-foreground/35")} />
          <span className="min-w-[190px] text-xs font-semibold text-foreground">{w.name}</span>
          <span className="min-w-[200px] flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {w.reason ?? (w.workload ? `Workload: ${w.workload}` : "Any workload")}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{formatSpan(w)}</span>
          <Badge variant="outline" className="text-[9.5px] tracking-wider">
            {w.scope.toUpperCase()}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export function FreezeCalendarCard({
  windows,
  noTenant,
}: {
  windows: readonly WireFreezeOrMaintenanceWindow[];
  noTenant: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="change-control-freeze-calendar">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13.5px] font-semibold text-foreground">Freeze calendar</span>
        <span className="text-[11px] text-muted-foreground">one row per standing rule</span>
      </div>
      <Card>
        <CardContent className="pt-5">
          <CalendarList
            windows={windows}
            activeDotClass="bg-status-teal"
            emptyLine={noTenant ? "No tenant resolved — the calendar answers with an empty list, not a failure." : "No freeze windows defined."}
          />
        </CardContent>
      </Card>
      <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
        A freeze blocks raising a change while it is in effect, and blocks a change booked to run
        inside it. The only way through is a written justification submitted with the change itself.
      </span>
    </div>
  );
}

export function MaintenanceWindowsCard({
  windows,
  noTenant,
  enforced,
}: {
  windows: readonly WireFreezeOrMaintenanceWindow[];
  noTenant: boolean;
  enforced: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="change-control-maintenance-windows">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13.5px] font-semibold text-foreground">Maintenance windows</span>
        <span className="text-[11px] text-muted-foreground">when a booked change is allowed to run — defined by your MSP, read here</span>
        <Badge variant="outline" className={cn("ml-auto text-[9.5px] tracking-wider", enforced ? "border-status-green/35 text-status-green" : "border-muted-foreground/35 text-muted-foreground")}>
          {enforced ? "ENFORCED ON BOOKING" : "NOT ENFORCED"}
        </Badge>
      </div>
      <Card>
        <CardContent className="pt-5">
          <CalendarList
            windows={windows}
            activeDotClass="bg-status-green"
            emptyLine={noTenant ? "No tenant resolved — the calendar answers with an empty list, not a failure." : "No maintenance windows defined."}
          />
        </CardContent>
      </Card>
      <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
        {enforced
          ? "A change with a booked start must sit entirely inside one of these windows — touching the edge is not enough, and unlike a freeze there is no justification route around it."
          : "Your policy is not enforcing these windows, so a booked change is not checked against them. They are still read here so you can see what your MSP has defined."}
      </span>
    </div>
  );
}
