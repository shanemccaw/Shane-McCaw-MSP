import { Card, CardContent } from "@/components/ui/card";
import type { WireOwnDelegation, WireOwnPerson, WireOwnRow } from "@/lib/ownership-types";
import { personById } from "@/lib/ownership-visuals";

/**
 * Read-only listing of the two overlay shapes that don't fit inside the
 * typed matrix: standing handovers, and "coverage" rows (a promoted-but-
 * unnamed gap — contract pack §1b: their `objType`/`name`/`sub` are
 * genuinely blank in this table, since that descriptive text lives only in a
 * client-side fixture this app does not carry). A `source: "custom"` row is
 * NOT listed here (#3041) — it now renders as a real matrix row with its own
 * RACI cells (`ownership-matrix.ts`'s `buildCustomRows`), since a row a
 * customer adds "holds cells exactly like a live one" (the design's own
 * copy) rather than being a second, cell-less listing of the same thing.
 *
 * Handovers stay read-only here: `POST /portal/ownership/delegations` and
 * `/delegations/end` are real and live, but the Design export draws no
 * control for either anywhere on this screen, and #1491's own structured
 * index still lists #1518/#1524 ("decide the fate of
 * portal_ownership_delegations") as an open decision — so this pass does not
 * invent a handover control the design doesn't call for.
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
  const coverageRows = rows.filter((r) => r.source === "coverage");
  if (delegations.length === 0 && coverageRows.length === 0) return null;

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

        {coverageRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-semibold text-foreground">Promoted from a coverage gap</span>
            {coverageRows.map((r) => (
              <div key={r.rowId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-[11.5px]">
                <span className="font-medium text-foreground">{r.name || "(no descriptive text recorded)"}</span>
                {r.sub && <span className="text-muted-foreground">{r.sub}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground">no name/type recorded for this table (§1b)</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
