import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { WireOwnSource } from "@/lib/ownership-types";
import { OWN_TYPE_LABEL } from "@/lib/ownership-types";
import { cn } from "@/lib/utils";

/**
 * The honest-empty contract, stated in place (contract pack §5/§6): which
 * object groups this route can answer for, and — when `tenantScoped` is
 * false — which groups are absent because the tenant's M365 identifier
 * could not be resolved, not because the tenant genuinely has none.
 */
export function SourcesCard({ sources, tenantScoped }: { sources: readonly WireOwnSource[]; tenantScoped: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <span className="text-[12.5px] font-semibold text-foreground">What this matrix can answer for</span>

        {!tenantScoped && (
          <div className="flex gap-2.5 rounded-lg border border-status-amber/35 bg-status-amber/5 p-3">
            <AlertTriangle className="mt-0.5 size-3.5 flex-none text-status-amber" />
            <span className="text-[11.5px] leading-relaxed text-foreground">
              Your tenant's Microsoft 365 identifier could not be resolved right now, so Microsoft changes,
              change requests and workloads are omitted below — that is a resolution failure, not a real
              zero. Services and hold windows are unaffected and still serve.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {sources.map((s) => (
            <div
              key={s.type}
              title={s.note}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2",
                s.live ? "border-border" : "border-dashed border-border/70 bg-muted/10",
              )}
            >
              <span className="text-[11.5px] font-medium text-foreground">{OWN_TYPE_LABEL[s.type]}</span>
              {s.live ? (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {s.count}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-dashed text-[9.5px] text-muted-foreground">
                  not built
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
