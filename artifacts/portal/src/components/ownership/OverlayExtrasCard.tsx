import { Card, CardContent } from "@/components/ui/card";
import type { WireOwnDelegation, WireOwnPerson, WireOwnRow } from "@/lib/ownership-types";
import { personById } from "@/lib/ownership-visuals";

/**
 * Read-only listing of the two overlay shapes that don't fit inside the
 * typed matrix: standing handovers, and rows a customer added by hand. Both
 * are part of surface A's own payload (contract pack §1b: "seeded into the
 * client on every load of surface A") — this build reads and displays them;
 * *writing* new ones (`POST /portal/ownership/delegations`,
 * `POST /portal/ownership/rows`) is #3041's scope.
 */
export function OverlayExtrasCard({
  delegations,
  rows,
  people,
}: {
  delegations: readonly WireOwnDelegation[];
  rows: readonly WireOwnRow[];
  people: readonly WireOwnPerson[];
}) {
  if (delegations.length === 0 && rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        {delegations.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-semibold text-foreground">Standing handovers</span>
            {delegations.map((d, i) => {
              const from = personById(people, d.fromPersonId)?.name ?? d.fromPersonId;
              const to = personById(people, d.toPersonId)?.name ?? d.toPersonId;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-[11.5px]">
                  <span className="font-medium text-foreground">{from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium text-foreground">{to}</span>
                  <span className="text-muted-foreground">
                    until {d.until || "an unspecified date"} · {d.scope === "all" ? "all cells" : d.scope}
                  </span>
                  <span className={d.done ? "text-muted-foreground" : "text-status-green"}>
                    {d.done ? "ended" : "active"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-semibold text-foreground">Rows added by hand</span>
            {rows.map((r) => (
              <div key={r.rowId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-[11.5px]">
                <span className="font-medium text-foreground">{r.name || "(no descriptive text recorded)"}</span>
                {r.sub && <span className="text-muted-foreground">{r.sub}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {r.source === "coverage" ? "promoted from a coverage gap" : "custom row"}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
