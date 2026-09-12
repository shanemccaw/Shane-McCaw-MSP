/**
 * Change Control — Freeze & Maintenance (screen 10). `GET/PATCH
 * /api/msp/change-freeze-windows`, `GET/PATCH /api/msp/change-maintenance-windows`
 * (`msp-change-freeze-windows.ts`, `msp-change-maintenance-windows.ts`).
 * Shows this tenant's own windows plus every global/workload-wide window —
 * `windowAppliesToTenant` in `api.ts`.
 */
import { toast } from "sonner";
import type { DirectoryCustomer } from "@/api/console-api";
import { ArmedButton, DataState } from "./shared";
import {
  tenantKeyOf, useFreezeWindows, useMaintenanceWindows, useRetireFreezeWindow,
  useRetireMaintenanceWindow, windowAppliesToTenant, type WireWindow,
} from "./api";

function Group({
  title, note, windows, isLoading, error, route, onRetire, retiring,
}: {
  title: string; note: string; windows: WireWindow[]; isLoading: boolean; error: Error | null; route: string;
  onRetire: (id: number) => void; retiring: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#64748b" }}>{title}</span>
        <span style={{ fontSize: 11.5, color: "#64748b" }}>{note}</span>
      </div>
      <DataState
        isLoading={isLoading}
        error={error}
        isEmpty={!isLoading && !error && windows.length === 0}
        route={route}
        emptyTitle={`No ${title.toLowerCase()} for this tenant`}
        emptyNote="Nothing global, workload-wide, or scoped to this tenant is on the calendar."
      >
        <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.6)", overflowX: "auto" }}>
          <div style={{ minWidth: 920 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1.4fr 1fr 110px", gap: 12, padding: "11px 16px", borderBottom: "1px solid rgba(148,163,184,.14)", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "#64748b" }}>
              <span>WINDOW</span><span>SCOPE</span><span>OPENS</span><span>CLOSES</span><span>REPEATS</span><span style={{ textAlign: "right" }}>STATE</span>
            </div>
            {windows.map((w) => (
              <div key={w.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1.4fr 1fr 110px", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: "1px solid rgba(148,163,184,.08)", opacity: w.active ? 1 : 0.5 }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{w.name}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{w.reason ?? ""}</span>
                </span>
                <span style={{ fontSize: 12, color: "#cbd5e1", whiteSpace: "nowrap" }}>{w.scope}</span>
                <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{new Date(w.startsAt).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{new Date(w.endsAt).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{w.recurrence}</span>
                <div style={{ justifySelf: "end" }}>
                  {w.active ? (
                    <ArmedButton
                      label="Retire" armedLabel="Confirm retire" tone="ghost"
                      onConfirm={() => onRetire(w.id)}
                    />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>retired</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DataState>
    </div>
  );
}

export function Windows({ customer }: { customer: DirectoryCustomer | undefined }) {
  const tenantKey = tenantKeyOf(customer);
  const freeze = useFreezeWindows();
  const maintenance = useMaintenanceWindows();
  const retireFreeze = useRetireFreezeWindow();
  const retireMaintenance = useRetireMaintenanceWindow();

  const freezeRows = (freeze.data?.windows ?? []).filter((w) => windowAppliesToTenant(w, tenantKey));
  const maintenanceRows = (maintenance.data?.windows ?? []).filter((w) => windowAppliesToTenant(w, tenantKey));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Group
        title="Freeze windows" note="Nothing but an emergency change gets through one of these."
        windows={freezeRows} isLoading={freeze.isLoading} error={freeze.error} route="GET /api/msp/change-freeze-windows"
        retiring={retireFreeze.isPending}
        onRetire={(id) => retireFreeze.mutate(id, { onError: (e) => toast.error(e.message) })}
      />
      <Group
        title="Maintenance windows" note="A booked change has to land inside one of these."
        windows={maintenanceRows} isLoading={maintenance.isLoading} error={maintenance.error} route="GET /api/msp/change-maintenance-windows"
        retiring={retireMaintenance.isPending}
        onRetire={(id) => retireMaintenance.mutate(id, { onError: (e) => toast.error(e.message) })}
      />
    </div>
  );
}
