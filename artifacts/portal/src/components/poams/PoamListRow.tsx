import { Badge } from "@/components/ui/badge";
import type { WirePoam } from "@/lib/poams-types";
import { formatDateOnly, poamStatusSwatch } from "@/lib/poams-visuals";
import { cn } from "@/lib/utils";

export function PoamListRow({ poam, active, onClick }: { poam: WirePoam; active: boolean; onClick: () => void }) {
  const swatch = poamStatusSwatch(poam.status);
  const doneCount = poam.milestones.filter((m) => m.status === "completed").length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors",
        active ? "border-primary/55 bg-primary/[.07]" : "border-border/60 bg-muted/5 hover:bg-muted/10",
      )}
      data-testid={`poam-row-${poam.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] text-muted-foreground">{poam.id}</span>
        <Badge variant="outline" className={cn("text-[10px]", swatch.text, swatch.bg, swatch.border)}>
          {swatch.label}
        </Badge>
        {poam.isOverdue && (
          <Badge variant="outline" className="border-status-red/45 text-[10px] text-status-red">
            Overdue
          </Badge>
        )}
      </div>
      <span className="text-[13px] font-semibold leading-snug text-foreground">{poam.title}</span>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span>{poam.isOverdue ? "Target was " : "Target "}{formatDateOnly(poam.scheduledCompletionDate)}</span>
        <span>{poam.milestones.length ? `${doneCount} of ${poam.milestones.length} milestones done` : "No milestones yet"}</span>
      </div>
    </button>
  );
}
