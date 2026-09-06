import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { usePolicyDecisionsFromRiskRegister } from "@/lib/risk-register-api";
import { cn } from "@/lib/utils";

const STATE_SWATCH: Record<string, { label: string; className: string }> = {
  live: { label: "Live", className: "text-status-green border-status-green/30 bg-status-green/10" },
  due: { label: "Due", className: "text-status-amber border-status-amber/30 bg-status-amber/10" },
  proposed: { label: "Proposed", className: "text-muted-foreground border-border" },
};

/**
 * "Decisions recorded against these risks" (contract pack §1.3/§0.1) — the
 * risk-derived policy-decision VIEW of `msp_risk_decisions`, wired to the
 * real `GET /api/portal/policy-decisions`. Deliberately NOT the same data as
 * the standalone `policy_decisions` table (a different, standing-policy
 * register reached from its own Policy Decisions page) — see §0.1's own
 * warning against merging the two.
 */
export function PolicyDecisionsCard({ onSelect }: { onSelect: (rbdId: string) => void }) {
  const { data: decisions, isLoading, isError } = usePolicyDecisionsFromRiskRegister();

  return (
    <Card>
      <CardHeader className="gap-1.5 space-y-0">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">Decisions recorded against these risks</span>
          {decisions && (
            <span className="text-[11px] text-muted-foreground">{decisions.length} derived from the risks above</span>
          )}
        </div>
        <p className="max-w-[680px] text-xs leading-relaxed text-muted-foreground">
          These are decisions that only exist because a risk was raised here — the record of what
          was chosen about a finding. Standing policies you author on their own live on the Policy
          decisions page and come from a different register; the two are never merged.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading decisions…
          </div>
        )}
        {isError && <p className="py-3 text-xs text-status-red">Decisions could not be read.</p>}
        {!isLoading && !isError && decisions?.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">No decisions recorded yet.</p>
        )}
        {!isLoading &&
          !isError &&
          decisions?.map((d) => {
            const swatch = STATE_SWATCH[d.state ?? ""] ?? { label: d.state ?? "Unknown", className: "text-muted-foreground border-border" };
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className="flex items-center gap-3 border-t border-border/50 py-2.5 text-left transition-opacity first:border-t-0 hover:opacity-85"
                data-testid={`policy-decision-row-${d.id}`}
              >
                <Badge variant="outline" className={cn("w-[74px] flex-none justify-center", swatch.className)}>
                  {swatch.label}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{d.title}</span>
                <span className="max-w-[170px] flex-none truncate text-[11px] text-muted-foreground">
                  {d.obligation ?? "No citation"}
                </span>
                <span
                  className={cn(
                    "w-24 flex-none truncate text-right text-[11px]",
                    d.reviewState === "overdue" ? "text-status-red" : "text-muted-foreground",
                  )}
                >
                  {d.review ?? "No clock"}
                </span>
              </button>
            );
          })}
        <p className="pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70">
          A review falling due is a flag on a decision that stays live. Nothing here lapses on a
          date, and no decision is ever removed for going unreviewed.
        </p>
      </CardContent>
    </Card>
  );
}
