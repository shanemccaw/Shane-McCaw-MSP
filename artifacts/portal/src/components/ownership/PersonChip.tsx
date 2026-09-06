import { Badge } from "@/components/ui/badge";
import type { MatrixCellHolder } from "@/lib/ownership-matrix";
import type { WireOwnPerson } from "@/lib/ownership-types";
import { acceptanceSwatch, initialsFor, sideSwatch } from "@/lib/ownership-visuals";
import { cn } from "@/lib/utils";

/** One resolved cell holder — an avatar-style chip, matching the design's holder pill. */
export function PersonChip({ holder, person }: { holder: MatrixCellHolder; person: WireOwnPerson | undefined }) {
  const name = person?.name ?? "Unresolved holder";
  const side = person ? sideSwatch(person.side) : sideSwatch("");
  const acc = acceptanceSwatch(holder.acceptance);
  const tip = person
    ? `${person.name} · ${person.role} · ${person.side}${holder.acceptance ? ` · ${acc.label}` : ""}`
    : `A saved holder (${holder.personId}) no longer resolves to anyone on the current roster`;

  return (
    <span
      title={tip}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5",
        holder.acceptance === "declined" ? "border-status-red/35 bg-status-red/5" : `${side.border} ${side.bg}`,
      )}
    >
      <span
        className={cn(
          "flex size-[18px] flex-none items-center justify-center rounded-full text-[8.5px] font-extrabold",
          side.text,
          side.bg,
        )}
      >
        {initialsFor(name)}
      </span>
      <span className="truncate text-[11px] font-medium text-foreground">{name}</span>
      {holder.acceptance && (
        <span className={cn("size-1.5 flex-none rounded-full", acc.text.replace("text-", "bg-"))} />
      )}
    </span>
  );
}

export function GapChip({ label, isGap }: { label: string; isGap: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-dashed text-[10.5px]",
        isGap ? "border-status-amber/40 text-status-amber" : "border-border text-muted-foreground",
      )}
    >
      {label}
    </Badge>
  );
}
