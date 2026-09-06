import { Badge } from "@/components/ui/badge";
import type { SecurityPlanAssembledModule } from "@/lib/security-plan-types";

/**
 * One assembled module's rows, exactly as its own source table held them at
 * assembly/seal time. `state`/`detail`/`pillar`/`framework` are each source
 * module's own vocabulary — never mapped onto a shared scale or scored
 * (contract pack §4, "honestly heterogeneous").
 */
export function ModuleSchedule({ module: mod }: { module: SecurityPlanAssembledModule }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-foreground">{mod.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {mod.sourceIssue} · {mod.total} {mod.total === 1 ? "row" : "rows"}
          {mod.excludedCount > 0 ? ` · ${mod.excludedCount} excluded by scope` : ""}
        </span>
      </div>

      {mod.items.length === 0 ? (
        <span className="text-xs leading-relaxed text-muted-foreground">
          This register held nothing for your tenant when the plan was sealed.
        </span>
      ) : (
        <div className="flex flex-col">
          <div className="flex gap-3 border-b border-border/50 pb-1.5 text-[9px] font-bold tracking-wider text-muted-foreground">
            <span className="min-w-0 flex-1">ITEM</span>
            <span className="w-[190px] flex-none">DETAIL</span>
            <span className="w-[130px] flex-none">DIMENSIONS</span>
            <span className="w-[110px] flex-none text-right">STATUS</span>
          </div>
          {mod.items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 border-b border-border/40 py-2 last:border-b-0">
              <span className="min-w-0 flex-1 text-[12px] font-medium leading-relaxed text-foreground">
                {item.title}
              </span>
              <span className="w-[190px] flex-none text-[11px] leading-relaxed text-muted-foreground">
                {item.detail ?? "—"}
              </span>
              <span className="w-[130px] flex-none text-[11px] text-muted-foreground">
                {[item.pillar, item.framework].filter(Boolean).join(" · ") || "—"}
              </span>
              <span className="w-[110px] flex-none text-right">
                <Badge variant="outline" className="text-[10.5px] text-muted-foreground">
                  {item.state ?? "Not recorded"}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
