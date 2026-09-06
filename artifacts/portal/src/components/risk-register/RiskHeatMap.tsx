import { Card, CardContent } from "@/components/ui/card";
import type { WireRisk } from "@/lib/risk-register-types";
import { cn } from "@/lib/utils";

const Y_LABELS = ["L5", "L4", "L3", "L2", "L1"];
const X_LABELS = ["I1", "I2", "I3", "I4", "I5"];

function heatClasses(heat: number, count: number): string {
  if (count === 0) return "bg-muted/20 border-border/60";
  if (heat >= 15) return "bg-status-red/20 border-status-red/45 text-foreground";
  if (heat >= 9) return "bg-status-amber/20 border-status-amber/45 text-foreground";
  if (heat >= 5) return "bg-status-blue/20 border-status-blue/45 text-foreground";
  return "bg-muted-foreground/20 border-muted-foreground/40 text-foreground";
}

/**
 * The likelihood × impact heat map (contract pack §1.1 — `likelihood`/
 * `impact`, 1–5, "heat-map coordinate"). A risk missing either coordinate is
 * deliberately left off the grid rather than placed at a guessed position
 * (contract pack: "NULL IS SERVED AS NULL... a fabricated likelihood would
 * land a risk on the heat map at coordinates nobody chose").
 */
export function RiskHeatMap({ risks }: { risks: readonly WireRisk[] }) {
  const plotted = risks.filter((r) => r.likelihood != null && r.impact != null);
  const unplottedCount = risks.length - plotted.length;

  const cells: { y: number; x: number; count: number }[] = [];
  for (let y = 5; y >= 1; y--) {
    for (let x = 1; x <= 5; x++) {
      cells.push({
        y,
        x,
        count: plotted.filter((r) => r.likelihood === y && r.impact === x).length,
      });
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-6 pt-6">
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
            LIKELIHOOD × IMPACT
          </span>
          <div className="flex gap-2">
            <div className="flex flex-col justify-between py-px">
              {Y_LABELS.map((label) => (
                <span key={label} className="flex h-[34px] items-center text-[9.5px] text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-5 auto-rows-[34px] gap-[3px]">
              {cells.map(({ y, x, count }) => {
                const heat = y * x;
                return (
                  <div
                    key={`${y}-${x}`}
                    title={count ? `${count} risk at likelihood ${y}, impact ${x}` : `Likelihood ${y}, impact ${x}`}
                    className={cn(
                      "flex items-center justify-center rounded border text-[11px] font-bold",
                      heatClasses(heat, count),
                    )}
                  >
                    {count || ""}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-[3px] pl-[31px]">
            {X_LABELS.map((label) => (
              <span key={label} className="w-[34px] text-center text-[9.5px] text-muted-foreground">
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex min-w-[240px] flex-1 flex-col justify-center gap-2">
          <span className="text-[12.5px] font-semibold text-foreground">
            {plotted.length} of {risks.length} risks are plotted
          </span>
          <span className="max-w-[420px] text-[11.5px] leading-relaxed text-muted-foreground">
            {unplottedCount === 0
              ? "Every risk carries both coordinates."
              : `${unplottedCount} risk${unplottedCount === 1 ? "" : "s"} ${unplottedCount === 1 ? "has" : "have"} no likelihood or impact recorded, so it appears in the register below but nowhere on this map.`}
          </span>
          <span className="max-w-[420px] text-[10.5px] leading-relaxed text-muted-foreground/70">
            Coordinates are recorded per risk by your MSP. A risk without both is left off the map
            rather than placed at a guessed position.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
