/**
 * Contracts — per-tenant Commercial-group module page (Git #3775, Feature
 * #2568), README screen 21
 * (`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`).
 * Mounts at `/tenants/:id/contracts`.
 *
 * **Authorized by Shane, 2026-09-15: the design skeleton for this screen is a
 * placeholder with no real render block — built directly against the real
 * backend contract instead of waiting on a design pass.** See the visible
 * banner below; this is deliberate, not an oversight.
 *
 * Real v1 scope, per Shane's own guidance — no new unified backend, no new
 * SLA-terms table. A real aggregation read view over three already-real
 * sources (see `@/api/contracts-api` for the full route map):
 *   - Statements of work    — the customer's real SOW lifecycle rows.
 *   - Active services       — the customer's real `client_services` rows
 *     (subscriptions, monitoring/retainer tiers, one-time engagements).
 *   - Scope & SLA ledger    — open scope-creep detections and violations
 *     recorded against this customer.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import { useSowsForCustomer } from "@/api/offers-and-sows-api";
import { useScopeCreepDetectionsForCustomer } from "@/api/scope-sla-api";
import { useServicesForCustomer, useScopeCreepViolationsForCustomer, type CustomerService } from "@/api/contracts-api";
import type { MspSowStatus } from "@/api/sales-api";

type Tone = { strong: string; text: string; tint: string; border: string };
const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;
const SLATE: Tone = { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border };

const SOW_TONE: Record<MspSowStatus, Tone> = { draft: SLATE, sent: BLUE, signed: AMBER, paid: GREEN, failed: RED, expired: SLATE };
const SERVICE_STATUS_TONE: Record<CustomerService["status"], Tone> = { active: GREEN, paused: AMBER, completed: SLATE };
const SEVERITY_TONE: Record<string, Tone> = { low: SLATE, medium: AMBER, high: RED, critical: RED };

function money(cents: number): string {
  if (cents === 0) return "free";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, ...extra };
}
function pill(t: Tone): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, height: 22, padding: "0 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
  };
}
function sectionHeader(icon: string, title: string, note: string) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: text.title }}>
        <Icon name={icon} size={14} /> {title}
      </span>
      <span style={{ fontSize: 11, color: text.muted }}>{note}</span>
    </div>
  );
}
function tableHead(cols: string[]) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols.length}, 1fr)`, gap: 12, padding: "0 4px 6px", borderBottom: `1px solid ${border.soft}` }}>
      {cols.map((h) => <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.muted }}>{h}</span>)}
    </div>
  );
}
function emptyRow(message: string) {
  return <span style={{ fontSize: 11.5, color: text.muted, padding: "10px 4px" }}>{message}</span>;
}
function errorRow(message: string, onRetry: () => void) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 4px" }}>
      <span style={{ fontSize: 11.5, color: signal.critical.text }}>{message}</span>
      <button onClick={onRetry} style={{ height: 26, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
    </div>
  );
}

function AgentBuiltBanner() {
  return (
    <div style={{
      border: `1px dashed ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint,
      padding: "9px 13px", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
    }}>
      <Icon name="triangle-alert" size={14} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: signal.warning.strong }}>
        Agent-built UI — pending design review
      </span>
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
        No Claude Design export exists for this screen yet; built directly against the real backend contract with Shane's authorization (2026-09-15).
      </span>
    </div>
  );
}

export function Contracts({ customerId, mspId }: { customerId: number; mspId: number | null }) {
  const sows = useSowsForCustomer(mspId, customerId, "all");
  const services = useServicesForCustomer(mspId, customerId);
  const detections = useScopeCreepDetectionsForCustomer(customerId);
  const violations = useScopeCreepViolationsForCustomer(customerId);

  const sowRows = sows.data?.items ?? [];
  const serviceRows = services.data?.services ?? [];
  const detectionRows = detections.data?.detections ?? [];
  const violationRows = violations.data?.violations ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <AgentBuiltBanner />

      {/* Statements of Work */}
      <div style={cardStyle()}>
        {sectionHeader("file-text", "Statements of work", sows.isLoading ? "Loading…" : `${sowRows.length} on file for this customer`)}
        {sows.isError ? errorRow("The SOW list did not load.", () => sows.refetch()) : sowRows.length === 0 && !sows.isLoading ? (
          emptyRow("No SOWs on file for this customer.")
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowX: "auto", minWidth: 0 }}>
            <div style={{ minWidth: 560 }}>
              {tableHead(["TITLE", "STATUS", "AMOUNT", "SIGNED", "EXPIRES"])}
              {sowRows.map((s) => (
                <div key={s.sowId} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, padding: "9px 4px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 12, color: text.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                  <span><span style={pill(SOW_TONE[s.status])}>{s.status}</span></span>
                  <span style={{ fontSize: 12, color: text.secondary }}>{money(s.amountCents)}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{fmtDate(s.signedAt)}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{fmtDate(s.expiresAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active services / subscription-tier data */}
      <div style={cardStyle()}>
        {sectionHeader("package-check", "Active services", services.isLoading ? "Loading…" : `${serviceRows.length} service${serviceRows.length === 1 ? "" : "s"} on this account`)}
        {services.isError ? errorRow("The services list did not load.", () => services.refetch()) : serviceRows.length === 0 && !services.isLoading ? (
          emptyRow("No purchased services on this account.")
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowX: "auto", minWidth: 0 }}>
            <div style={{ minWidth: 560 }}>
              {tableHead(["SERVICE", "CLASS", "STATUS", "BILLING", "SINCE"])}
              {serviceRows.map((s) => (
                <div key={s.clientServiceId} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, padding: "9px 4px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 12, color: text.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.serviceName}{s.tier ? ` (${s.tier})` : ""}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{s.serviceClass ?? "—"}</span>
                  <span><span style={pill(SERVICE_STATUS_TONE[s.status])}>{s.status}</span></span>
                  <span style={{ fontSize: 12, color: text.muted }}>{s.billingType === "recurring_monthly" ? `recurring · ${s.billingInterval}` : "one-time"}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{fmtDate(s.purchasedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Scope-creep ledger */}
      <div style={cardStyle()}>
        {sectionHeader("shield-alert", "Scope & SLA ledger", (detections.isLoading || violations.isLoading) ? "Loading…" : `${detectionRows.length} open detection${detectionRows.length === 1 ? "" : "s"} · ${violationRows.length} violation${violationRows.length === 1 ? "" : "s"} recorded`)}
        {detections.isError || violations.isError ? errorRow("The scope-creep ledger did not load.", () => { void detections.refetch(); void violations.refetch(); }) : (detectionRows.length === 0 && violationRows.length === 0 && !detections.isLoading && !violations.isLoading) ? (
          emptyRow("No scope-creep activity recorded for this customer.")
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowX: "auto", minWidth: 0 }}>
            <div style={{ minWidth: 560 }}>
              {tableHead(["TYPE", "SEVERITY / CHANGE", "DETECTED", "STATUS"])}
              {violationRows.map((v) => (
                <div key={`v-${v.violationId}`} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: "9px 4px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 12, color: text.body }}>Violation</span>
                  <span><span style={pill(SEVERITY_TONE[v.severity] ?? SLATE)}>{v.severity} · score {v.compositeScore}</span></span>
                  <span style={{ fontSize: 12, color: text.muted }}>{fmtDate(v.createdAt)}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{v.resolvedAt ? `resolved ${fmtDate(v.resolvedAt)}` : "open"}</span>
                </div>
              ))}
              {detectionRows.map((d) => (
                <div key={`d-${d.detectionId}`} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: "9px 4px", borderBottom: `1px solid ${border.faint}` }}>
                  <span style={{ fontSize: 12, color: text.body }}>{d.detectionType}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{d.changePct != null ? `${d.changePct}% change` : "—"}</span>
                  <span style={{ fontSize: 12, color: text.muted }}>{fmtDate(d.detectedAt)}</span>
                  <span><span style={pill(d.status === "resolved" ? GREEN : d.status === "acknowledged" ? AMBER : BLUE)}>{d.status}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
