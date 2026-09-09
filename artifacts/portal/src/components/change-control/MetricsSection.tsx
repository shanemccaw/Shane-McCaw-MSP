/**
 * Change metrics (#1506) — success/failure rate, emergency ratio, lead time,
 * CAB throughput. "Unavailable, never zero": a metric with no qualifying
 * events reads as unavailable, not 0%.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WireChangeMetrics } from "@/lib/change-control-types";

function Tile({ label, value, note, unavailable }: { label: string; value: string; note: string; unavailable: boolean }) {
  return (
    <Card className={cn(unavailable && "border-dashed")}>
      <CardContent className="flex flex-col gap-1.5 pt-5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={cn("text-2xl font-extrabold leading-tight tracking-tight tabular-nums", unavailable ? "text-muted-foreground/60" : "text-foreground")}>
          {value}
        </span>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">{note}</span>
      </CardContent>
    </Card>
  );
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function MetricsSection({ metrics }: { metrics: WireChangeMetrics }) {
  const { changeSuccessRate: succ, failedChangeRate: fail, emergencyChangeRatio: emer, leadTime, cabThroughput: cab } = metrics;
  return (
    <div className="flex flex-col gap-2.5" data-testid="change-control-metrics">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13.5px] font-semibold text-foreground">Change metrics</span>
        <span className="text-[11px] text-muted-foreground">a metric with nothing to count says so — it never reads as 0%</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="Change success"
          value={succ.available ? pct(succ.rate) : "—"}
          note={succ.available ? `${succ.numerator} of ${succ.denominator} · settled executions that succeeded` : "Not available: nothing to count yet."}
          unavailable={!succ.available}
        />
        <Tile
          label="Failed changes"
          value={fail.available ? pct(fail.rate) : "—"}
          note={fail.available ? `${fail.numerator} of ${fail.denominator} · settled executions that failed` : "Not available: nothing to count yet."}
          unavailable={!fail.available}
        />
        <Tile
          label="Emergency ratio"
          value={emer.available ? pct(emer.rate) : "—"}
          note={emer.available ? `${emer.numerator} of ${emer.denominator} · changes raised were emergencies` : "Not available: nothing to count yet."}
          unavailable={!emer.available}
        />
        <Tile
          label="Lead time"
          value={leadTime.available && leadTime.averageHours !== null ? `${leadTime.averageHours.toFixed(1)} h` : "—"}
          note={
            leadTime.available
              ? `Average from raised to executed · median ${leadTime.medianHours?.toFixed(1)} h · sample of ${leadTime.sampleSize}`
              : "Not available: no executed change to measure."
          }
          unavailable={!leadTime.available}
        />
        <Tile
          label="CAB throughput"
          value={cab.available ? String(cab.itemsDecided) : "—"}
          note={
            cab.available
              ? `${cab.meetingsHeld} meeting${cab.meetingsHeld === 1 ? "" : "s"} held · ${cab.itemsDeferred} deferred`
              : "Not available: no CAB meeting has touched your changes."
          }
          unavailable={!cab.available}
        />
      </div>
      <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
        Success and failure are read from settled executions, falling back to a change&apos;s own
        terminal event. Lead time is measured from real timestamps, never from the window label. One
        gap is on record: the post-implementation review&apos;s own close code is not consulted, so a
        change closed as &ldquo;successful with issues&rdquo; counts as a plain success here (#3045).
      </span>
    </div>
  );
}
