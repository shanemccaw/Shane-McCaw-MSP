/**
 * Change Control — Standard Catalog (screen 8). `GET /api/msp/change-catalog`,
 * `.../:id/approve`, `.../:id/revoke` (`msp-change-catalog.ts`). MSP-wide, not
 * tenant-filtered — see `api.ts`'s header for why.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { Badge, Button, Card, DataState, Drawer } from "./shared";
import { RISK_COLOR, type Tone } from "./shared";
import { useApproveCatalogItem, useChangeCatalog, useRevokeCatalogItem, type WireChangeCatalogItem } from "./api";

const STATUS_TONE: Record<string, Tone> = { approved: "green", draft: "amber", revoked: "red" };

export function Catalog() {
  const query = useChangeCatalog();
  const items = query.data?.items ?? [];
  const [drawer, setDrawer] = useState<{ kind: "approve" | "revoke"; item: WireChangeCatalogItem } | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DataState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={!query.isLoading && !query.error && items.length === 0}
        route="GET /api/msp/change-catalog"
        emptyTitle="No standard changes catalogued yet"
        emptyNote="Author a catalog item against an active config pack, then approve it once to let future changes raised from it skip the board."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 12 }}>
          {items.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{
                  width: 28, height: 28, flex: "0 0 28px", borderRadius: 8,
                  background: STATUS_TONE[c.status] === "green" ? "rgba(52,211,153,.1)" : STATUS_TONE[c.status] === "red" ? "rgba(248,113,113,.1)" : "rgba(251,191,36,.1)",
                  border: `1px solid ${STATUS_TONE[c.status] === "green" ? "rgba(52,211,153,.26)" : STATUS_TONE[c.status] === "red" ? "rgba(248,113,113,.26)" : "rgba(251,191,36,.26)"}`,
                  color: STATUS_TONE[c.status] === "green" ? "#34d399" : STATUS_TONE[c.status] === "red" ? "#f87171" : "#fbbf24",
                  padding: 7,
                }}>
                  <Icon name="package-check" size={14} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#f1f5f9" }}>{c.title}</span>
                  <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.packKey}</span>
                </span>
                <Badge label={c.status} tone={STATUS_TONE[c.status]} />
              </div>
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{c.description || "No description recorded."}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{c.category}</span>
                <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 11, fontWeight: 600, color: RISK_COLOR[c.riskLevel] }}>risk {c.riskLevel}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 10, borderTop: "1px solid rgba(148,163,184,.12)" }}>
                {c.status === "approved" && (
                  <Button label="Revoke" icon="ban" tone="danger" onClick={() => setDrawer({ kind: "revoke", item: c })} title="Needs a reason, and an admin" />
                )}
                {c.status === "draft" && (
                  <Button label="Approve once" icon="stamp" tone="primary" onClick={() => setDrawer({ kind: "approve", item: c })} title="Signed and dated by an MSP admin" />
                )}
                {c.status === "revoked" && (
                  <Button label="Re-approve" icon="rotate-ccw" onClick={() => setDrawer({ kind: "approve", item: c })} title="Clears the revocation and re-signs the item" />
                )}
                <span style={{ fontSize: 11, color: "#64748b", flex: 1, minWidth: 100 }}>
                  {c.status === "approved" && c.approvedByName ? `Approved by ${c.approvedByName}, ${new Date(c.approvedAt!).toLocaleDateString()}` :
                   c.status === "revoked" && c.revokedByName ? `Revoked by ${c.revokedByName}, ${new Date(c.revokedAt!).toLocaleDateString()} — ${c.revokedReason}` :
                   c.createdByName ? `Drafted by ${c.createdByName}, ${new Date(c.createdAt).toLocaleDateString()}` : ""}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </DataState>

      {drawer && (
        <CatalogActionDrawer drawer={drawer} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}

function CatalogActionDrawer({ drawer, onClose }: { drawer: { kind: "approve" | "revoke"; item: WireChangeCatalogItem }; onClose: () => void }) {
  const approve = useApproveCatalogItem();
  const revoke = useRevokeCatalogItem();
  const [reason, setReason] = useState("");
  const isApprove = drawer.kind === "approve";
  const canSubmit = isApprove || reason.trim().length > 0;

  const submit = () => {
    if (isApprove) {
      approve.mutate(drawer.item.id, {
        onSuccess: onClose,
        onError: (err) => toast.error(err.message),
      });
    } else {
      revoke.mutate({ id: drawer.item.id, reason: reason.trim() }, {
        onSuccess: onClose,
        onError: (err) => toast.error(err.message),
      });
    }
  };

  return (
    <Drawer
      open
      eyebrow={isApprove ? "APPROVE — SIGNED AND DATED" : "REVOKE — IMMEDIATE"}
      title={drawer.item.title}
      onClose={onClose}
    >
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: "#64748b" }}>{drawer.item.packKey}</span>
      <span style={{ fontSize: 12.5, color: "#cbd5e1" }}>
        {isApprove
          ? "This becomes the authorization every future change raised from this catalog item inherits — it skips the board entirely. Signed with your identity, dated now."
          : "Revoking is immediate: any change raised from this item after this point needs full approval again. This does not affect changes already raised."}
      </span>
      {!isApprove && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this is being revoked"
            style={{ height: 36, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none" }}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
        <Button label={isApprove ? "Approve once" : "Revoke"} tone={isApprove ? "primary" : "danger"} disabled={!canSubmit || approve.isPending || revoke.isPending} onClick={submit} />
        <Button label="Cancel" onClick={onClose} />
      </div>
    </Drawer>
  );
}
