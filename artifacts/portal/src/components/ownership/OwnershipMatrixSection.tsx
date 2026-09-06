import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MatrixRow } from "@/lib/ownership-matrix";
import type { OwnObjectType, WireOwnPerson } from "@/lib/ownership-types";
import { OWN_ROLE_KEYS, OWN_TYPE_LABEL } from "@/lib/ownership-types";
import { personById } from "@/lib/ownership-visuals";
import { GapChip, PersonChip } from "./PersonChip";

/** One object-type group's own real rows, R/A/C/I resolved per contract pack §2. */
export function OwnershipMatrixSection({
  type,
  rows,
  people,
}: {
  type: OwnObjectType;
  rows: readonly MatrixRow[];
  people: readonly WireOwnPerson[];
}) {
  return (
    <Card data-testid={`ownership-group-${type}`}>
      <div className="flex items-center gap-2.5 px-5 pb-2 pt-4">
        <span className="text-[13px] font-semibold text-foreground">{OWN_TYPE_LABEL[type]}</span>
        <span className="text-[11px] text-muted-foreground">{rows.length}</span>
        <div className="ml-auto flex gap-6">
          {OWN_ROLE_KEYS.map((rk) => (
            <span
              key={rk.key}
              title={rk.word}
              className="w-[130px] flex-none text-center text-[9px] font-bold tracking-wider text-muted-foreground"
            >
              {rk.letter}
            </span>
          ))}
        </div>
      </div>
      <CardContent className="flex flex-col px-5 pb-3 pt-0">
        {rows.map((row) => (
          <div
            key={row.object.id}
            className="flex flex-wrap items-center gap-3 border-t border-border/50 py-2.5 first:border-t-0"
            data-testid={`ownership-row-${row.object.id}`}
          >
            <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
              <span
                className="text-[12.5px] font-medium text-foreground"
                data-testid={`ownership-rowname-${row.object.id}`}
              >
                {row.object.name}
              </span>
              {row.object.sub && <span className="text-[10.5px] text-muted-foreground">{row.object.sub}</span>}
            </div>
            <Badge variant="outline" className="flex-none text-[10px] text-muted-foreground">
              {row.object.link}
            </Badge>
            <div className="flex gap-6">
              {OWN_ROLE_KEYS.map(({ key }) => {
                const holders = row.cells[key];
                const isGap = holders.length === 0 && (key === "r" || key === "a");
                return (
                  <div
                    key={key}
                    className="flex w-[130px] flex-none flex-wrap items-center gap-1"
                    data-testid={`ownership-cell-${row.object.id}-${key}`}
                  >
                    {holders.length === 0 ? (
                      <GapChip label={isGap ? "No owner" : "None"} isGap={isGap} />
                    ) : (
                      holders.map((holder, i) => (
                        <PersonChip key={`${holder.personId}-${i}`} holder={holder} person={personById(people, holder.personId)} />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
