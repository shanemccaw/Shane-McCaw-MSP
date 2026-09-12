/**
 * Risk Register module page (Git #2582), mounted by `ConsoleShell` at
 * `/tenants/:id/risk`. Design: `Design/MSP_Console/design_handoff_msp_console/
 * Risk Register.dc.html` + README screen 14.
 *
 * `GET /api/msp/rbd` returns every RBD for the whole MSP (no per-tenant query
 * param exists), so this page fetches once and filters to the current tenant
 * client-side by matching the real M365 `tenantId` GUID — the same
 * `scoped = scopeName ? rbds.filter(...) : rbds` shape the design's own logic
 * class uses, just keyed on the real GUID instead of a display name.
 */
import { useMemo, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  useAvailableChecks, useAvailableObligations, useRbdList,
  type RbdRow, type RiskAcceptanceStatus,
} from "@/api/rbd-api";
import { formatDate, levelTone, money, statusLabel, statusTone, tone } from "./format";
import { CreateRiskDrawer } from "./CreateRiskDrawer";
import { RiskDetailDrawer } from "./RiskDetailDrawer";

type Tab = "register" | "checks" | "authorities";

const FILTERS: { id: "all" | RiskAcceptanceStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_signature", label: "Awaiting signature" },
  { id: "active", label: "Accepted" },
  { id: "revoked", label: "Revoked" },
  { id: "converted_to_poam", label: "Converted to POA&M" },
];

function reviewColor(row: RbdRow): string {
  if (row.reviewState === "overdue") return signal.critical.text;
  if (row.reviewState === "due") return "#fcd34d";
  return text.label;
}

function reviewText(row: RbdRow): string {
  if (row.reviewDate) return row.reviewDate;
  return "not scheduled";
}

export function RiskRegister({ customer }: { customer: DirectoryCustomer }) {
  const [tab, setTab] = useState<Tab>("register");
  const [filter, setFilter] = useState<"all" | RiskAcceptanceStatus>("all");
  const [selectedRbdId, setSelectedRbdId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const rbdQuery = useRbdList();
  const checksQuery = useAvailableChecks();
  const obligationsQuery = useAvailableObligations();

  const scoped = useMemo(() => {
    const rows = rbdQuery.data ?? [];
    if (!customer.tenantId) return [];
    return rows.filter((r) => r.tenantId === customer.tenantId);
  }, [rbdQuery.data, customer.tenantId]);

  const visible = useMemo(
    () => (filter === "all" ? scoped : scoped.filter((r) => r.status === filter)),
    [scoped, filter],
  );

  const liabilityTotal = useMemo(
    () => money(scoped.filter((r) => r.status === "active").reduce((sum, r) => sum + r.liabilityValueUsd, 0)),
    [scoped],
  );

  const selected = selectedRbdId ? scoped.find((r) => r.rbdId === selectedRbdId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Tabs + liability total + create */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {([
          { id: "register" as const, label: "Register", count: scoped.length },
          { id: "checks" as const, label: "Checks", count: checksQuery.data?.length ?? 0 },
          { id: "authorities" as const, label: "Authorities", count: obligationsQuery.data?.length ?? 0 },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{liabilityTotal} accepted exposure</span>
        {!!customer.tenantId && (
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
              border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <Icon name="plus" size={13} />
            Accept a risk
          </button>
        )}
      </div>

      {!customer.tenantId && (
        <EmptyPanel
          icon="triangle-alert"
          title="No Microsoft 365 tenant ID on file"
          body="This tenant has never been linked to a real M365 tenant GUID, so nothing in the Risk Register — which keys on that GUID — can be matched to it."
        />
      )}

      {customer.tenantId && tab === "register" && (
        <RegisterTab
          rbdQuery={rbdQuery}
          scoped={scoped}
          visible={visible}
          filter={filter}
          onFilter={setFilter}
          onOpen={setSelectedRbdId}
        />
      )}

      {customer.tenantId && tab === "checks" && <ChecksTab scoped={scoped} query={checksQuery} />}

      {customer.tenantId && tab === "authorities" && <AuthoritiesTab scoped={scoped} query={obligationsQuery} />}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          The register, its line items and the document versioning all run on live endpoints
          (<code>GET /api/msp/rbd</code>, <code>msp-rbd-instances.ts</code>, <code>msp-rbd-versions.ts</code>).
          Risk scores are entered by hand — nothing derives or range-checks them.
        </span>
      </div>

      {createOpen && customer.tenantId && (
        <CreateRiskDrawer
          customer={customer}
          scopedCount={scoped.length}
          checks={checksQuery.data ?? []}
          obligations={obligationsQuery.data ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={(rbdId) => { setCreateOpen(false); setSelectedRbdId(rbdId); }}
        />
      )}

      {selected && (
        <RiskDetailDrawer row={selected} onClose={() => setSelectedRbdId(null)} />
      )}
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      border: `1px solid ${border.card}`, borderRadius: 11, background: surface.card, padding: "34px 20px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center",
    }}>
      <span style={{
        width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)",
        color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={icon} size={20} />
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function AdvisoryPanel({ status }: { status?: number }) {
  const is403 = status === 403;
  const is404 = status === 404;
  return (
    <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 11, background: signal.warning.tint, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: signal.warning.strong }}>
        {is403 ? "Not scoped to this MSP session" : is404 ? "Not found" : "Couldn't load the register"}
      </span>
      <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
        {is403
          ? "GET /api/msp/rbd resolves scope from this session's MSP claim, not a route parameter — a PlatformAdmin session without an active MSP context legitimately 403s here."
          : `GET /api/msp/rbd returned ${status ?? "an error"}.`}
      </span>
    </div>
  );
}

function RegisterTab({
  rbdQuery, scoped, visible, filter, onFilter, onOpen,
}: {
  rbdQuery: ReturnType<typeof useRbdList>;
  scoped: RbdRow[];
  visible: RbdRow[];
  filter: "all" | RiskAcceptanceStatus;
  onFilter: (f: "all" | RiskAcceptanceStatus) => void;
  onOpen: (rbdId: string) => void;
}) {
  if (rbdQuery.isLoading) {
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: 44, borderRadius: 8, background: "rgba(148,163,184,.06)" }} />
        ))}
      </div>
    );
  }
  if (rbdQuery.isError) {
    return <AdvisoryPanel status={(rbdQuery.error as { status?: number } | null)?.status} />;
  }
  if (scoped.length === 0) {
    return (
      <EmptyPanel
        icon="shield-alert"
        title="No risk-based decisions for this tenant yet"
        body="Nothing has been accepted here. Use “Accept a risk” to author the first one — it records a hazard, the raw and residual score, the liability, and who signs for the customer."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              style={{
                height: 28, padding: "0 10px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{visible.length} of {scoped.length} decisions</span>
      </div>

      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
        <div style={{ minWidth: 1160 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 2.3fr 1.1fr 1.1fr 1.1fr 1fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
            <span>REF</span><span>RISK ACCEPTED</span><span>RAW</span><span>AFTER CONTROLS</span><span>EXPOSURE</span><span>STATUS</span><span>REVIEW</span>
          </div>
          {visible.map((r) => {
            const rawT = levelTone(r.rawRiskLevel);
            const resT = levelTone(r.residualRiskLevel);
            const stT = statusTone(r.status);
            return (
              <div
                key={r.rbdId}
                onClick={() => onOpen(r.rbdId)}
                style={{ display: "grid", gridTemplateColumns: "1.1fr 2.3fr 1.1fr 1.1fr 1.1fr 1fr 1fr", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontFamily: "Menlo,monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd", whiteSpace: "nowrap" }}>{r.registerRef ?? r.rbdId}</span>
                  <span style={{ fontFamily: "Menlo,monospace", fontSize: 10.5, color: text.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.rbdId}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{r.title}</span>
                  <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.controlViolated} · {r.framework}</span>
                </span>
                <span style={{ display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999, background: rawT[1], border: `1px solid ${rawT[2]}`, fontSize: 11, fontWeight: 600, color: rawT[0], whiteSpace: "nowrap" }}>
                  {r.rawRiskLevel} · {r.rawRiskScore}
                </span>
                <span style={{ display: "inline-flex", justifySelf: "start", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: resT[1], border: `1px solid ${resT[2]}`, fontSize: 11, fontWeight: 600, color: resT[0], whiteSpace: "nowrap" }}>
                  <Icon name="arrow-down" size={10} />
                  {r.residualRiskLevel} · {r.residualRiskScore}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: text.body, whiteSpace: "nowrap" }}>{money(r.liabilityValueUsd)}</span>
                <span style={{ display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999, background: stT[1], border: `1px solid ${stT[2]}`, fontSize: 11, fontWeight: 600, color: stT[0], whiteSpace: "nowrap" }}>
                  {statusLabel(r.status)}
                </span>
                <span style={{ fontSize: 12, color: reviewColor(r), whiteSpace: "nowrap" }}>{reviewText(r)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChecksTab({ scoped, query }: { scoped: RbdRow[]; query: ReturnType<typeof useAvailableChecks> }) {
  if (query.isLoading) return <EmptyPanel icon="stethoscope" title="Loading the check catalog…" body="GET /api/msp/rbd/available-checks" />;
  if (query.isError) return <AdvisoryPanel status={(query.error as { status?: number } | null)?.status} />;
  const checks = query.data ?? [];
  if (checks.length === 0) {
    return <EmptyPanel icon="stethoscope" title="No monitor checks in the catalog" body="GET /api/msp/rbd/available-checks returned an empty catalog." />;
  }
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
      <div style={{ minWidth: 860 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.6fr 2.6fr 1.1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>CHECK</span><span>NAME</span><span>WHAT IT WATCHES</span><span>USED BY</span>
        </div>
        {checks.map((c) => {
          const used = scoped.filter((r) => r.checkKey === c.key).length;
          const t = tone(used > 0 ? "violet" : "slate");
          return (
            <div key={c.key} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.6fr 2.6fr 1.1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ fontFamily: "Menlo,monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.key}</span>
              <span style={{ fontSize: 12.5, color: text.body, textWrap: "pretty" }}>{c.label}</span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{c.description}</span>
              <span style={{ display: "inline-flex", justifySelf: "start", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 11, fontWeight: 600, color: t[0], whiteSpace: "nowrap" }}>
                <Icon name={used > 0 ? "bell-off" : "bell"} size={11} />
                {used > 0 ? `muted by ${used}` : "alerting"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuthoritiesTab({ scoped, query }: { scoped: RbdRow[]; query: ReturnType<typeof useAvailableObligations> }) {
  if (query.isLoading) return <EmptyPanel icon="scale" title="Loading cited authorities…" body="GET /api/msp/rbd/available-obligations" />;
  if (query.isError) return <AdvisoryPanel status={(query.error as { status?: number } | null)?.status} />;
  const obligations = query.data ?? [];
  if (obligations.length === 0) {
    return <EmptyPanel icon="scale" title="No cited authorities available" body="GET /api/msp/rbd/available-obligations returned nothing — no seeded catalog and no tenant-authored authority for this MSP yet." />;
  }
  const groups = new Map<string, typeof obligations>();
  for (const o of obligations) {
    const key = o.frameworkName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from(groups.entries()).map(([framework, rows]) => {
        const kind = rows[0]?.authorityType === "tenant" ? "customer authority" : "seeded catalogue";
        const t = tone(kind === "customer authority" ? "violet" : "blue");
        return (
          <div key={framework} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{framework}</span>
              <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: t[1], border: `1px solid ${t[2]}`, fontSize: 10.5, fontWeight: 600, color: t[0] }}>{kind}</span>
            </div>
            <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
              <div style={{ minWidth: 720 }}>
                {rows.map((o) => {
                  const used = scoped.filter((r) => r.obligationId === o.obligationId || (r.obligationId == null && r.obligation === o.citation)).length;
                  return (
                    <div key={o.obligationId} style={{ display: "grid", gridTemplateColumns: "1.1fr 3fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                      <span style={{ fontFamily: "Menlo,monospace", fontSize: 11.5, color: "#93c5fd", whiteSpace: "nowrap" }}>{o.citation}</span>
                      <span style={{ fontSize: 12.5, color: text.secondary, textWrap: "pretty" }}>{o.requires}</span>
                      <span style={{ fontSize: 11.5, color: used > 0 ? "#c4b5fd" : text.faint, whiteSpace: "nowrap", textAlign: "right" }}>{used > 0 ? `cited by ${used}` : "not cited"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { formatDate };
