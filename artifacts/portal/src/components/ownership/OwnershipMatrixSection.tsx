import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { MatrixRow } from "@/lib/ownership-matrix";
import type { OwnObjectType, OwnRoleKey, WireOwnPerson } from "@/lib/ownership-types";
import { OWN_ROLE_KEYS, OWN_TYPE_LABEL } from "@/lib/ownership-types";
import { personById } from "@/lib/ownership-visuals";
import { cn } from "@/lib/utils";
import { GapChip, PersonChip } from "./PersonChip";
import { OwnershipPersonPicker } from "./OwnershipPersonPicker";

/**
 * One object-type group's own real rows, R/A/C/I resolved per contract pack
 * §2, with each cell's "add a holder" picker wired to the real write
 * (§1b, `POST /portal/ownership/assign`, #3041).
 */
export function OwnershipMatrixSection({
  type,
  rows,
  people,
  frequency,
  onAssign,
  assignPending,
  label,
}: {
  type: OwnObjectType;
  rows: readonly MatrixRow[];
  people: readonly WireOwnPerson[];
  frequency: ReadonlyMap<string, number>;
  onAssign: (objectId: string, roleKey: OwnRoleKey, personId: string) => void;
  assignPending: boolean;
  /** Overrides `OWN_TYPE_LABEL[type]` — used for the customer-added "control" rows, which are real objects of type "control" but read better as their own group. */
  label?: string;
}) {
  const [picking, setPicking] = useState<{ objectId: string; roleKey: OwnRoleKey } | null>(null);

  return (
    <Card data-testid={`ownership-group-${type}`}>
      <div className="flex items-center gap-2.5 px-5 pb-2 pt-4">
        <span className="text-[13px] font-semibold text-foreground">{label ?? OWN_TYPE_LABEL[type]}</span>
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
        {rows.map((row) => {
          const activeCell = picking?.objectId === row.object.id ? picking.roleKey : null;
          return (
            <div key={row.object.id} className="flex flex-col border-t border-border/50 py-2.5 first:border-t-0">
              <div
                className="flex flex-wrap items-center gap-3"
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
                    const isPicking = activeCell === key;
                    return (
                      <div
                        key={key}
                        className="flex w-[130px] flex-none flex-wrap items-center gap-1"
                        data-testid={`ownership-cell-${row.object.id}-${key}`}
                      >
                        {holders.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => setPicking(isPicking ? null : { objectId: row.object.id, roleKey: key })}
                            data-testid={`ownership-cell-add-${row.object.id}-${key}`}
                          >
                            <GapChip label={isGap ? "No owner" : "None"} isGap={isGap} />
                          </button>
                        ) : (
                          <>
                            {holders.map((holder, i) => (
                              <PersonChip key={`${holder.personId}-${i}`} holder={holder} person={personById(people, holder.personId)} />
                            ))}
                            <button
                              type="button"
                              title="Add another holder"
                              onClick={() => setPicking(isPicking ? null : { objectId: row.object.id, roleKey: key })}
                              data-testid={`ownership-cell-add-${row.object.id}-${key}`}
                              className={cn(
                                "flex size-[19px] flex-none items-center justify-center rounded-full border border-dashed text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary",
                                isPicking ? "border-primary/60 text-primary" : "border-muted-foreground/30",
                              )}
                            >
                              <Plus className="size-2.5" />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {activeCell && (
                <div className="pt-2">
                  <OwnershipPersonPicker
                    people={people}
                    excludeIds={new Set(row.cells[activeCell].map((h) => h.personId))}
                    frequency={frequency}
                    pending={assignPending}
                    onClose={() => setPicking(null)}
                    onPick={(personId) => {
                      onAssign(row.object.id, activeCell, personId);
                      setPicking(null);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
