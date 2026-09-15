import { Badge } from "@/components/ui/badge";
import type { SecurityPlanAssembledItem } from "@/lib/security-plan-types";

export interface ControlDomainItem {
  readonly item: SecurityPlanAssembledItem;
  readonly moduleLabel: string;
}

/**
 * Part II — one control domain's rows, pooled across every register that
 * recorded a row against it (#4143). Unlike `ModuleSchedule`, rows here come
 * from more than one source module, so each row also carries which register
 * it was read from. A row whose source register has never recorded a control
 * domain does not appear in any domain's list here — it still appears
 * unaltered in Part III's per-register schedule.
 */
export function ControlDomainSchedule({ label, items }: { label: string; items: readonly ControlDomainItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">
          {items.length} {items.length === 1 ? "row" : "rows"}
        </span>
      </div>

      {items.length === 0 ? (
        <span className="text-xs leading-relaxed text-muted-foreground">
          No register has recorded a row against this control domain.
        </span>
      ) : (
        <div className="flex flex-col">
          <div className="flex gap-3 border-b border-border/50 pb-1.5 text-[9px] font-bold tracking-wider text-muted-foreground">
            <span className="min-w-0 flex-1">ITEM</span>
            <span className="w-[190px] flex-none">DETAIL</span>
            <span className="w-[130px] flex-none">REGISTER</span>
            <span className="w-[110px] flex-none text-right">STATUS</span>
          </div>
          {items.map(({ item, moduleLabel }) => (
            <div key={item.id} className="flex items-start gap-3 border-b border-border/40 py-2 last:border-b-0">
              <span className="min-w-0 flex-1 text-[12px] font-medium leading-relaxed text-foreground">
                {item.title}
              </span>
              <span className="w-[190px] flex-none text-[11px] leading-relaxed text-muted-foreground">
                {item.detail ?? "—"}
              </span>
              <span className="w-[130px] flex-none text-[11px] text-muted-foreground">{moduleLabel}</span>
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
