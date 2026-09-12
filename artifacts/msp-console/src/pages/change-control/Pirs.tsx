/**
 * Change Control — PIRs (screen 13). `GET /api/msp/change-control/pirs`
 * (`msp-change-pir.ts`). Read-only, matching the design exactly — recording a
 * review happens from the Executions tab (see that file's header for why).
 */
import { useMemo } from "react";
import type { DirectoryCustomer } from "@/api/console-api";
import { Icon } from "@/console/icons";
import { Badge, Card, DataState } from "./shared";
import type { Tone } from "./shared";
import { filterByTenant, tenantKeyOf, usePirs } from "./api";

const CLOSE_TONE: Record<string, Tone> = { successful: "green", successful_with_issues: "amber", failed: "red", rolled_back: "slate" };

export function Pirs({ customer }: { customer: DirectoryCustomer | undefined }) {
  const tenantKey = tenantKeyOf(customer);
  const query = usePirs();
  const rows = useMemo(() => filterByTenant(query.data?.pirs ?? [], tenantKey), [query.data, tenantKey]);

  return (
    <DataState
      isLoading={query.isLoading}
      error={query.error}
      isEmpty={!query.isLoading && !query.error && rows.length === 0}
      route="GET /api/msp/change-control/pirs"
      emptyTitle="No reviews recorded for this tenant"
      emptyNote="Nothing executed against this tenant has had a Post-Implementation Review recorded yet."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((p) => (
          <Card key={p.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>{p.changeCode}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#f1f5f9", flex: 1, minWidth: 160 }}>{p.summary.slice(0, 80)}{p.summary.length > 80 ? "…" : ""}</span>
              <Badge label={p.closeCode.replace(/_/g, " ")} tone={CLOSE_TONE[p.closeCode]} />
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{p.reviewedBy} · {new Date(p.reviewedAt).toLocaleString()}</span>
            </div>
            <span style={{ fontSize: 12.5, color: "#cbd5e1" }}>{p.summary}</span>
            {p.issuesNoted && (
              <div style={{ display: "flex", gap: 10, padding: "11px 13px", borderRadius: 10, border: "1px solid rgba(251,191,36,.24)", background: "rgba(251,191,36,.07)" }}>
                <Icon name="triangle-alert" size={14} color="#fbbf24" style={{ flex: "0 0 14px", marginTop: 2 }} />
                <span style={{ fontSize: 11.5, color: "#cbd5e1" }}>{p.issuesNoted}</span>
              </div>
            )}
            <div style={{
              border: `1px solid ${p.driftRescan.applicable ? "rgba(96,165,250,.26)" : "rgba(148,163,184,.2)"}`,
              borderRadius: 10, background: p.driftRescan.applicable ? "rgba(96,165,250,.08)" : "rgba(148,163,184,.06)",
              padding: 13, display: "flex", flexDirection: "column", gap: 7,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <Icon name="radar" size={14} color={p.driftRescan.applicable ? "#60a5fa" : "#94a3b8"} />
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: p.driftRescan.applicable ? "#60a5fa" : "#94a3b8" }}>
                  {p.driftRescan.status === "not_applicable" ? "DRIFT RE-SCAN NOT APPLICABLE" : p.driftRescan.status === "ran" ? "DRIFT RE-SCAN RAN" : "DRIFT RE-SCAN ERRORED"}
                </span>
                <div style={{ flex: 1 }} />
                {p.driftRescan.attributedCount !== null && (
                  <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{p.driftRescan.attributedCount} attributed · {p.driftRescan.otherOpenDriftCount ?? 0} other open</span>
                )}
              </div>
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{p.driftRescan.note ?? ""}</span>
            </div>
          </Card>
        ))}
      </div>
    </DataState>
  );
}
