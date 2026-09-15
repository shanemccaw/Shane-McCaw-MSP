/**
 * The interpretation detail drawer — Overview (fields + confirm/reject/edit/
 * delete), Resolutions (per-tenant measured counts, #1533) and Routings
 * (per-tenant routing decisions, #1534). This is the operator's review surface
 * for #1688's real scope: review the resolution's affected-object counts,
 * review the routing decision, and handle the propose branch where the gate
 * did not auto-create a Change Request.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import { useAvailableChecks } from "@/api/rbd-api";
import {
  useConfirmInterpretation, useDeleteInterpretation, useInterpretationsList,
  usePatchInterpretation, useRejectInterpretation, useResolutions, useResolveInterpretation,
  useRouteInterpretation, useRoutings,
  type M365Interpretation, type M365RoutingRow, type M365StoredResolutionRow,
} from "@/api/m365-changes-api";
import { emptyFields, fieldsToProbe, fieldsToTouches, InterpretationFields, type FieldsState } from "./InterpretationFields";
import {
  actorLabel, changeClassLabel, controllableLabel, controllableTone, formatDateTime,
  resolutionLabel, resolutionTone, routingLabel, routingReasonText, routingTone, statusLabel, statusTone,
} from "./format";

type Panel = "overview" | "resolutions" | "routings";

function toFields(row: M365Interpretation): FieldsState {
  return emptyFields({
    title: row.title,
    summary: row.summary ?? "",
    changeClass: row.changeClass,
    whoActs: row.whoActs,
    controllable: row.controllable,
    controlMethod: row.controlMethod ?? "",
    services: row.touches.services.join(", "),
    protocols: row.touches.protocols.join(", "),
    skus: row.touches.skus.join(", "),
    settings: row.touches.settings.join(", "),
    probeDescription: row.probe.description ?? "",
    monitorCheckKey: row.probe.monitorCheckKey ?? "",
    powershell: row.probe.powershell ?? "",
    graphEndpoint: row.probe.graphEndpoint ?? "",
    notes: row.notes ?? "",
  });
}

export function InterpretationDetailDrawer({
  id, onClose, onOpenTenantPage,
}: {
  id: number;
  onClose: () => void;
  onOpenTenantPage: (tenant: number, page: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>("overview");
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<FieldsState | null>(null);
  const [liveResolve, setLiveResolve] = useState(false);

  const listQuery = useInterpretationsList();
  const resolutionsQuery = useResolutions(id);
  const routingsQuery = useRoutings(id);
  const checksQuery = useAvailableChecks();

  const patch = usePatchInterpretation();
  const confirmMutation = useConfirmInterpretation();
  const rejectMutation = useRejectInterpretation();
  const deleteMutation = useDeleteInterpretation();
  const resolveMutation = useResolveInterpretation();
  const routeMutation = useRouteInterpretation();

  const row = listQuery.data?.interpretations.find((r) => r.id === id) ?? null;

  useEffect(() => { setPanel("overview"); setEditing(false); }, [id]);

  if (!row) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,96%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20 }}>
          <span style={{ fontSize: 13, color: text.muted }}>{listQuery.isLoading ? "Loading…" : "This interpretation is no longer in the library."}</span>
        </div>
      </div>
    );
  }

  const startEdit = () => { setFields(toFields(row)); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setFields(null); };
  const saveEdit = () => {
    if (!fields) return;
    patch.mutate(
      {
        id: row.id,
        input: {
          title: fields.title.trim(),
          summary: fields.summary.trim() || null,
          changeClass: fields.changeClass,
          touches: fieldsToTouches(fields),
          whoActs: fields.whoActs,
          controllable: fields.controllable,
          controlMethod: fields.controllable === "yes" ? fields.controlMethod.trim() || null : null,
          probe: fieldsToProbe(fields),
          notes: fields.notes.trim() || null,
        },
      },
      {
        onSuccess: () => { toast.success("Interpretation updated."); setEditing(false); setFields(null); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save the edit."),
      },
    );
  };

  const doConfirm = () => confirmMutation.mutate(row.id, {
    onSuccess: () => toast.success("Confirmed — this now applies to every tenant's resolution."),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not confirm."),
  });
  const doReject = () => rejectMutation.mutate(row.id, {
    onSuccess: () => toast.success("Rejected — kept in the library so this source is not re-proposed blindly."),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not reject."),
  });
  const doDelete = () => {
    if (!confirm(`Remove "${row.title}" from the library? This cannot be undone.`)) return;
    deleteMutation.mutate(row.id, {
      onSuccess: () => { toast.success("Removed."); onClose(); },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove it."),
    });
  };
  const doResolve = () => resolveMutation.mutate(
    { id: row.id, live: liveResolve },
    {
      onSuccess: (res) => { toast.success(`Resolved against ${res.results.length} tenant${res.results.length === 1 ? "" : "s"}.`); setPanel("resolutions"); },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not resolve this interpretation."),
    },
  );
  const doRoute = () => routeMutation.mutate(row.id, {
    onSuccess: () => { toast.success("Routing run queued — refresh the Routings tab shortly to see the outcome."); setPanel("routings"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not start a routing run."),
  });

  const stTone = statusTone(row.status);
  const ctlTone = controllableTone(row.controllable);
  const resolutions = resolutionsQuery.data?.resolutions ?? [];
  const routings = routingsQuery.data?.routings ?? [];

  const tabs: { id: Panel; label: string; count: number }[] = [
    { id: "overview", label: "Overview", count: -1 },
    { id: "resolutions", label: "Resolutions", count: resolutions.length },
    { id: "routings", label: "Routings", count: routings.length },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px,97%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10.5, color: text.label }}>
              {row.sourceKind === "roadmap" ? "Microsoft 365 Roadmap" : row.sourceKind === "message_center" ? "Message Center" : "Authored by hand"}
              {row.featureId ? ` · ${row.featureId}` : ""}{row.graphMessageId ? ` · ${row.graphMessageId}` : ""}
            </span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em", textWrap: "pretty" }}>{row.title}</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: stTone[1], border: `1px solid ${stTone[2]}`, fontSize: 10.5, fontWeight: 600, color: stTone[0] }}>{statusLabel(row.status)}</span>
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 10.5, fontWeight: 600, color: text.muted }}>{changeClassLabel(row.changeClass)}</span>
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 10.5, fontWeight: 600, color: text.muted }}>{actorLabel(row.whoActs)} acts</span>
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: ctlTone[1], border: `1px solid ${ctlTone[2]}`, fontSize: 10.5, fontWeight: 600, color: ctlTone[0] }}>{controllableLabel(row.controllable)}</span>
        </div>

        {row.status === "proposed" && (
          <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>
              Not confirmed yet. It cannot be resolved against tenants or routed until it is.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doConfirm} disabled={confirmMutation.isPending} style={primaryBtn}>{confirmMutation.isPending ? "Confirming…" : "Confirm"}</button>
              <button onClick={doReject} disabled={rejectMutation.isPending} style={ghostBtn}>Reject</button>
            </div>
          </div>
        )}

        {row.status === "confirmed" && (
          <div style={{ border: `1px solid ${signal.ok.border}`, borderRadius: 10, background: signal.ok.tint, padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>
              Confirmed — applies to every tenant. Resolve to measure the real affected-object count per tenant, then route to turn that into a Change Request where the gate allows it.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={doResolve} disabled={resolveMutation.isPending} style={primaryBtn}>{resolveMutation.isPending ? "Resolving…" : "Resolve against tenants"}</button>
              <button onClick={doRoute} disabled={routeMutation.isPending} style={ghostBtn}>{routeMutation.isPending ? "Starting…" : "Run routing"}</button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: text.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={liveResolve} onChange={(e) => setLiveResolve(e.target.checked)} />
                Read live tenant data (slower; off reuses the latest stored profile)
              </label>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const active = panel === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setPanel(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7,
                  border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                  background: active ? "rgba(37,99,235,.18)" : "transparent",
                  color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {t.label}
                {t.count >= 0 && <span style={{ fontSize: 10, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>}
              </button>
            );
          })}
        </div>

        {panel === "overview" && !editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <ReadField label="Summary" value={row.summary || "—"} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              <TagList label="Services" values={row.touches.services} />
              <TagList label="Protocols" values={row.touches.protocols} />
              <TagList label="License SKUs" values={row.touches.skus} />
              <TagList label="Settings" values={row.touches.settings} />
            </div>
            {row.controllable === "yes" && <ReadField label="How to control it" value={row.controlMethod || "—"} />}
            <ReadField label="Probe — what to count" value={row.probe.description || "—"} />
            {row.probe.monitorCheckKey && <ReadField label="Linked monitor check" value={row.probe.monitorCheckKey} />}
            {row.probe.graphEndpoint && <ReadField label="Graph endpoint" value={row.probe.graphEndpoint} />}
            {row.notes && <ReadField label="Notes" value={row.notes} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <ReadField label="Created" value={`${formatDateTime(row.createdAt)}${row.createdBy ? ` · ${row.createdBy}` : ""}`} />
              <ReadField label="Confirmed" value={row.confirmedAt ? `${formatDateTime(row.confirmedAt)}${row.confirmedBy ? ` · ${row.confirmedBy}` : ""}` : "Not yet"} />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
              <button onClick={startEdit} style={ghostBtn}>Edit</button>
              <button onClick={doDelete} disabled={deleteMutation.isPending} style={dangerBtn}>Remove</button>
            </div>
          </div>
        )}

        {panel === "overview" && editing && fields && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <InterpretationFields state={fields} checks={checksQuery.data ?? []} onChange={(key, value) => setFields((f) => (f ? { ...f, [key]: value } : f))} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
              <button onClick={saveEdit} disabled={patch.isPending} style={primaryBtn}>{patch.isPending ? "Saving…" : "Save changes"}</button>
              <button onClick={cancelEdit} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        )}

        {panel === "resolutions" && (
          <ResolutionsPanel loading={resolutionsQuery.isLoading} error={resolutionsQuery.isError} rows={resolutions} />
        )}

        {panel === "routings" && (
          <RoutingsPanel loading={routingsQuery.isLoading} error={routingsQuery.isError} rows={routings} onOpenTenantPage={onOpenTenantPage} />
        )}
      </div>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>{label.toUpperCase()}</span>
      <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty", whiteSpace: "pre-wrap" }}>{value}</span>
    </div>
  );
}

function TagList({ label, values }: { label: string; values: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>{label.toUpperCase()}</span>
      {values.length === 0 ? (
        <span style={{ fontSize: 11.5, color: text.faint }}>—</span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {values.map((v) => (
            <span key={v} style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.18)", color: text.muted }}>{v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResolutionsPanel({ loading, error, rows }: { loading: boolean; error: boolean; rows: M365StoredResolutionRow[] }) {
  if (loading) return <Empty text="Loading resolutions…" />;
  if (error) return <Empty text="Resolutions could not be loaded." tone="critical" />;
  if (rows.length === 0) {
    return <Empty text="Not resolved against any tenant yet. Resolve above to measure the real affected-object count per tenant." />;
  }
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
      <div style={{ minWidth: 520 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 0.8fr 1.3fr", gap: 10, padding: "9px 14px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.label }}>
          <span>TENANT</span><span>STATUS</span><span>COUNT</span><span>MEASURED</span>
        </div>
        {rows.map((r) => {
          const t = resolutionTone(r.status);
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 0.8fr 1.3fr", gap: 10, alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{r.tenantName}</span>
              <span style={{ display: "inline-flex", justifySelf: "start", padding: "2px 8px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 10.5, fontWeight: 600, color: t[0] }}>{resolutionLabel(r.status)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: r.affectedCount ? text.title : text.faint }}>{r.affectedCount ?? "—"}</span>
              <span style={{ fontSize: 11.5, color: text.muted }}>{r.measuredAt ? formatDateTime(r.measuredAt) : r.errorMessage ?? "Not measured"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoutingsPanel({
  loading, error, rows, onOpenTenantPage,
}: {
  loading: boolean; error: boolean;
  rows: M365RoutingRow[];
  onOpenTenantPage: (tenant: number, page: string) => void;
}) {
  if (loading) return <Empty text="Loading routing decisions…" />;
  if (error) return <Empty text="Routing decisions could not be loaded." tone="critical" />;
  if (rows.length === 0) {
    return <Empty text="Nothing routed yet. Run routing above once this has been resolved against at least one tenant." />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => {
        const t = routingTone(r.decision);
        return (
          <div key={r.id} style={{ border: `1px solid ${border.card}`, borderRadius: 10, background: surface.card, padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, minWidth: 100 }}>{r.tenantName}</span>
              <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 10.5, fontWeight: 600, color: t[0] }}>{routingLabel(r.decision)}</span>
            </div>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{routingReasonText(r.reason)}</span>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: text.label }}>
              {r.affectedCount !== null && <span>{r.affectedCount} affected</span>}
              {r.changeRequestCode && <span style={{ color: "#93c5fd" }}>{r.changeRequestCode}</span>}
              {r.routedAt && <span>{formatDateTime(r.routedAt)}</span>}
            </div>
            {r.decision === "proposed" && (
              <div style={{ borderTop: `1px solid ${border.faint}`, paddingTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: text.muted, flex: 1, textWrap: "pretty" }}>The gate did not auto-create a Change Request for this tenant. Create one by hand if it's warranted.</span>
                <button onClick={() => onOpenTenantPage(r.customerId, "cc.register")} style={{ ...ghostBtn, height: 28, padding: "0 10px", fontSize: 11 }}>Open Change Control</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Empty({ text: t, tone: toneKind = "info" }: { text: string; tone?: "info" | "critical" }) {
  const c = toneKind === "critical" ? signal.critical : signal.info;
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, background: c.tint, padding: 16, textAlign: "center" }}>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{t}</span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 32, padding: "0 13px", borderRadius: 7, border: "1px solid #2563eb", background: "#2563eb",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 32, padding: "0 13px", borderRadius: 7, border: `1px solid ${border.card}`,
  background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const dangerBtn: React.CSSProperties = {
  ...ghostBtn, border: `1px solid ${signal.critical.border}`, color: signal.critical.text,
};
