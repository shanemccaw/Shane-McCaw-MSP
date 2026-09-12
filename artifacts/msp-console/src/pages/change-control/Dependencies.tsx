/**
 * Change Control — Dependencies (screen 11). `GET /api/msp/change-control/dependencies`
 * (new, #2579 — see `api.ts`'s header), `DELETE
 * /api/msp/change-requests/:id/dependencies/:depId` (`msp-change-dependencies.ts`).
 */
import { toast } from "sonner";
import type { DirectoryCustomer } from "@/api/console-api";
import { Icon } from "@/console/icons";
import { Badge, Card, DataState, HonestNote } from "./shared";
import type { Tone } from "./shared";
import { ArmedButton } from "./shared";
import { tenantKeyOf, useDependencies, useRemoveDependency } from "./api";

export function Dependencies({ customer }: { customer: DirectoryCustomer | undefined }) {
  const tenantKey = tenantKeyOf(customer);
  const query = useDependencies(tenantKey);
  const remove = useRemoveDependency();
  const rows = query.data?.dependencies ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <DataState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={!query.isLoading && !query.error && rows.length === 0}
        route="GET /api/msp/change-control/dependencies"
        emptyTitle="No dependencies recorded for this tenant"
        emptyNote="No change against this tenant is blocked by another one right now."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((d) => {
            const cleared = d.blockerStatus === "completed";
            const tone: Tone = cleared ? "green" : "amber";
            const colors = cleared
              ? { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)" }
              : { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)" };
            return (
              <Card key={d.id}>
                <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                  <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: colors.tint, border: `1px solid ${colors.line}`, color: colors.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={cleared ? "circle-check-big" : "circle-dashed"} size={14} />
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>{d.blockedChangeCode}</span>
                      <span style={{ fontSize: 12.5, color: "#e2e8f0" }}>{d.blockedTitle}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11.5, color: "#64748b" }}>waits on</span>
                      <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>{d.blockerChangeCode}</span>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>{d.blockerTitle}</span>
                      <Badge label={cleared ? "cleared" : "still blocking"} tone={tone} />
                    </div>
                    {d.note && <span style={{ fontSize: 11.5, color: "#64748b" }}>{d.note}</span>}
                  </div>
                  <ArmedButton
                    label="Remove link" armedLabel="Confirm remove"
                    title={cleared ? "The blocker landed — the link can be removed" : "Removing this lets the blocked change proceed without it"}
                    onConfirm={() => remove.mutate({ blockedChangeCode: d.blockedChangeCode, dependencyId: d.id }, { onError: (e) => toast.error(e.message) })}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </DataState>
      <HonestNote>
        A rejected or rolled-back blocker does not release the link on its own — the change never landed, so clearing it is a deliberate call.
      </HonestNote>
    </div>
  );
}
