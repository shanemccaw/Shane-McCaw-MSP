import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { RemediationFixRoute } from "@/lib/remediation-checklist-types";
import { fixRouteVisual } from "@/lib/remediation-checklist-visuals";
import { cn } from "@/lib/utils";

const ROUTE_ORDER: readonly RemediationFixRoute[] = ["we_can_run", "you_must_run", "admin_center_only"];

/**
 * "How each fix can be delivered" — the three fix-route shapes (#1539) and
 * this tenant's own write-consent ceiling (#1c, `GET /remediation/fix-routes`).
 * Item counts are the calling customer's OWN open findings, not the module's
 * full 153-item catalogue that route also returns.
 */
export function FixRouteLegend({
  routeCounts,
  tenantWriteCeiling,
}: {
  readonly routeCounts: Readonly<Record<RemediationFixRoute, number>>;
  readonly tenantWriteCeiling: RemediationFixRoute | null;
}) {
  const ceiling = tenantWriteCeiling === "we_can_run";
  return (
    <Card>
      <CardContent className="flex flex-col gap-2.5 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">How each fix can be delivered</span>
          <span className="text-[11px] text-muted-foreground">resolved per item against your tenant, not a global setting</span>
          {tenantWriteCeiling && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto text-[9.5px] font-bold tracking-wider",
                ceiling
                  ? "border-status-green/40 bg-status-green/10 text-status-green"
                  : "border-status-teal/40 bg-status-teal/10 text-status-teal",
              )}
            >
              {ceiling ? "WRITE CONSENT GRANTED" : "WRITE CONSENT NOT GRANTED"}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {ROUTE_ORDER.map((route) => {
            const v = fixRouteVisual(route);
            return (
              <div key={route} className={cn("flex flex-col gap-1.5 rounded-lg border p-3", v.border, v.bg)}>
                <div className="flex items-center gap-2">
                  <span className={cn("text-[10.5px] font-bold uppercase tracking-wider", v.text)}>{v.name}</span>
                  <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">{routeCounts[route] ?? 0} items</span>
                </div>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{v.description}</span>
              </div>
            );
          })}
        </div>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
          Consent sets the ceiling, not the outcome: an item only reads as ours to run when a
          reviewed pack exists for that specific check. Where the pack is missing, the same item
          drops to a script you run, even with consent granted.
        </span>
      </CardContent>
    </Card>
  );
}
