/**
 * Risk-Based Decisions body (Git #1294).
 *
 * The PlatformAdmin surface where Shane picks a customer, reviews the
 * Risk-Based Decisions on file for that tenant, and creates or edits them —
 * including the "Linked automated check" picker that activates #1279's
 * accepted-risk alert suppression (a decision suppresses a finding only when it
 * carries a `checkKey` and is `status = 'active'`).
 *
 * Every value shown is served by the API (routes/admin-rbd.ts); nothing is
 * computed or hardcoded here. This is the rebuild that replaces the msp-portal
 * RiskBasedDecisionConsole.tsx as that page leaves the live app (#1297).
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShieldAlert, Plus, X, Link2 } from "lucide-react";
import { SURFACE, LINE, TEXT, ACCENT, ACCENT_TEXT, FONT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import {
  subscribe,
  getSnapshot,
  selectCustomer,
  clearSelection,
  createDecision,
  updateDecision,
  decisionById,
  checkLabel,
  type RiskDecision,
  type RbdStatus,
  type RawRiskLevel,
  type ResidualRiskLevel,
} from "./riskDecisionsStore";

const RAW_LEVELS: RawRiskLevel[] = ["critical", "high", "medium"];
const RESIDUAL_LEVELS: ResidualRiskLevel[] = ["high", "medium", "low"];
const STATUSES: RbdStatus[] = ["active", "pending_signature", "expired", "revoked"];

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending_signature: "Pending signature",
  expired: "Expired",
  revoked: "Revoked",
};

export function statusTone(status: string): string {
  if (status === "active") return ACCENT_TEXT.green;
  if (status === "pending_signature") return ACCENT_TEXT.amber;
  if (status === "revoked") return ACCENT_TEXT.danger;
  return ACCENT_TEXT.neutral;
}

const card: React.CSSProperties = {
  background: SURFACE.card,
  border: `1px solid ${LINE.base}`,
  borderRadius: 8,
  padding: 16,
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: TEXT.caption,
};
const inputStyle: React.CSSProperties = {
  background: SURFACE.well,
  border: `1px solid ${LINE.control}`,
  borderRadius: 6,
  padding: "7px 9px",
  color: TEXT.primary,
  fontSize: 13,
  fontFamily: FONT.sans,
  width: "100%",
};
const btn: React.CSSProperties = {
  border: `1px solid ${LINE.control}`,
  background: SURFACE.well,
  color: TEXT.primary,
  borderRadius: 6,
  padding: "7px 12px",
  fontSize: 12.5,
  cursor: "pointer",
};

function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

export function RiskDecisionsBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const shell = useShell();
  const [showNew, setShowNew] = useState(false);
  const [relinkId, setRelinkId] = useState<number | null>(null);

  // The ribbon's "New decision" action fires this to open the form.
  useEffect(() => {
    const open = () => setShowNew(true);
    window.addEventListener("rbd:new-decision", open);
    return () => window.removeEventListener("rbd:new-decision", open);
  }, []);

  // A peek's "Change linked check…" action fires this with the decision id, so
  // the 157-entry catalog is edited through a real <select> rather than a
  // peek cycle button.
  useEffect(() => {
    const relink = (e: Event) => setRelinkId((e as CustomEvent<number>).detail);
    window.addEventListener("rbd:relink", relink as EventListener);
    return () => window.removeEventListener("rbd:relink", relink as EventListener);
  }, []);

  const detail = state.detail;

  // ── Customer picker ─────────────────────────────────────────────────────
  if (!state.selectedCustomerId) {
    return (
      <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <ShieldAlert size={18} color={ACCENT.amber} />
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: TEXT.bright }}>Risk-Based Decisions</h2>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 12.5, color: TEXT.dim, maxWidth: 660, lineHeight: 1.6 }}>
          Pick a customer to see the risk acceptances on file for their tenant, and create or edit them. Linking a
          decision to an automated check — and keeping it active — is what suppresses that check&rsquo;s alert from
          re-firing while the risk is knowingly accepted.
        </p>
        {state.customersLoading && <Stated>Loading customers…</Stated>}
        {state.customersError && <Stated>Could not load customers: {state.customersError}</Stated>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {state.customers.map((c) => (
            <button
              key={c.customerId}
              data-testid={`rbd-customer-${c.customerId}`}
              onClick={() => c.hasTenantIdentity && selectCustomer(c.customerId)}
              disabled={!c.hasTenantIdentity}
              style={{ ...card, textAlign: "left", cursor: c.hasTenantIdentity ? "pointer" : "not-allowed", opacity: c.hasTenantIdentity ? 1 : 0.55 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.primary }}>{c.name}</span>
                <span style={{ fontSize: 11, color: c.decisionCount > 0 ? ACCENT_TEXT.green : TEXT.faint }}>
                  {c.decisionCount} on file
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: TEXT.dim }}>
                {c.hasTenantIdentity
                  ? `${c.activeCount} active · ${c.linkedCount} linked to a check`
                  : "no M365 tenant identity — cannot hold decisions"}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Customer detail ─────────────────────────────────────────────────────
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
      <button
        data-testid="rbd-back"
        onClick={() => { clearSelection(); setShowNew(false); }}
        style={{ ...btn, marginBottom: 14, background: "transparent", borderColor: LINE.control }}
      >
        ← All customers
      </button>
      {state.detailLoading && !detail && <Stated>Loading risk decisions…</Stated>}
      {state.detailError && <Stated>Could not load risk decisions: {state.detailError}</Stated>}
      {detail && (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...label, color: TEXT.caption }}>Risk-Based Decisions</div>
            <h2 style={{ margin: "3px 0 0", fontSize: 18, fontWeight: 700, color: TEXT.bright }}>{detail.customer.name}</h2>
            {detail.customer.primaryDomain && (
              <div style={{ fontSize: 11.5, color: TEXT.faint, marginTop: 2 }}>{detail.customer.primaryDomain}</div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 10px" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TEXT.strong }}>Decisions on file</h3>
            <button
              data-testid="rbd-new-toggle"
              onClick={() => setShowNew((v) => !v)}
              style={{ ...btn, display: "flex", alignItems: "center", gap: 6, borderColor: ACCENT.amber, color: ACCENT_TEXT.amber }}
            >
              <Plus size={14} /> New decision
            </button>
          </div>

          {showNew && (
            <NewDecisionForm customerId={detail.customer.customerId} onClose={() => setShowNew(false)} />
          )}

          {relinkId !== null && decisionById(relinkId) && (
            <RelinkPanel
              customerId={detail.customer.customerId}
              decision={decisionById(relinkId)!}
              onClose={() => setRelinkId(null)}
            />
          )}

          <DecisionList
            decisions={detail.decisions}
            onOpen={(id) => shell.openPeek("riskDecision", String(id))}
          />
        </>
      )}
    </div>
  );
}

function NewDecisionForm({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [title, setTitle] = useState("");
  const [checkKey, setCheckKey] = useState("");
  const [framework, setFramework] = useState("");
  const [rawLevel, setRawLevel] = useState<RawRiskLevel>("high");
  const [residualLevel, setResidualLevel] = useState<ResidualRiskLevel>("low");
  const [liability, setLiability] = useState("");
  const [expiration, setExpiration] = useState("");
  const [status, setStatus] = useState<RbdStatus>("active");
  const [hazard, setHazard] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = title.trim().length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    const liabilityNum = parseInt(liability, 10);
    const created = await createDecision(customerId, {
      title: title.trim(),
      checkKey: checkKey || null,
      framework: framework.trim() || undefined,
      rawRiskLevel: rawLevel,
      residualRiskLevel: residualLevel,
      liabilityValueUsd: Number.isFinite(liabilityNum) && liabilityNum >= 0 ? liabilityNum : undefined,
      expirationDate: expiration.trim() || undefined,
      status,
      hazardDescription: hazard.trim() || undefined,
      rationale: rationale.trim() || null,
    });
    setBusy(false);
    if (created) onClose();
  }

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: ACCENT.amber }} data-testid="rbd-new-form">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...label, color: ACCENT_TEXT.amber }}>New Risk-Based Decision</div>
        <button onClick={onClose} style={{ ...btn, padding: 4, background: "transparent", border: "none" }}><X size={15} color={TEXT.dim} /></button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={label}>Title</div>
          <input data-testid="rbd-new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Legacy authentication left enabled for finance mailbox" style={{ ...inputStyle, marginTop: 5 }} />
        </div>
        <div>
          <div style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}><Link2 size={12} /> Linked automated check (optional)</div>
          <select data-testid="rbd-linked-check-picker" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
            <option value="">— none (free-standing liability record) —</option>
            {state.checks.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 4 }}>
            Linking a check and keeping this decision active suppresses that check&rsquo;s alert while the risk is accepted.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 150px" }}>
            <div style={label}>Framework</div>
            <input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="e.g. Essential Eight" style={{ ...inputStyle, marginTop: 5 }} />
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <div style={label}>Raw risk</div>
            <select value={rawLevel} onChange={(e) => setRawLevel(e.target.value as RawRiskLevel)} style={{ ...inputStyle, marginTop: 5 }}>
              {RAW_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div style={{ flex: "0 0 130px" }}>
            <div style={label}>Residual risk</div>
            <select value={residualLevel} onChange={(e) => setResidualLevel(e.target.value as ResidualRiskLevel)} style={{ ...inputStyle, marginTop: 5 }}>
              {RESIDUAL_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 160px" }}>
            <div style={label}>Liability value (USD)</div>
            <input value={liability} onChange={(e) => setLiability(e.target.value)} inputMode="numeric" placeholder="0" style={{ ...inputStyle, marginTop: 5 }} />
          </div>
          <div style={{ flex: "0 0 160px" }}>
            <div style={label}>Expiration date</div>
            <input data-testid="rbd-new-expiration" value={expiration} onChange={(e) => setExpiration(e.target.value)} placeholder="YYYY-MM-DD (default +1yr)" style={{ ...inputStyle, marginTop: 5 }} />
          </div>
          <div style={{ flex: "0 0 170px" }}>
            <div style={label}>Status</div>
            <select data-testid="rbd-new-status" value={status} onChange={(e) => setStatus(e.target.value as RbdStatus)} style={{ ...inputStyle, marginTop: 5 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div style={label}>Hazard description</div>
          <textarea value={hazard} onChange={(e) => setHazard(e.target.value)} rows={2} placeholder="What the exposure is, in plain terms." style={{ ...inputStyle, marginTop: 5, resize: "vertical" }} />
        </div>
        <div>
          <div style={label}>Rationale</div>
          <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} placeholder="Why the risk is being accepted." style={{ ...inputStyle, marginTop: 5, resize: "vertical" }} />
        </div>
        <div>
          <button data-testid="rbd-new-submit" onClick={() => void submit()} disabled={!valid || busy} style={{ ...btn, borderColor: ACCENT.green, color: ACCENT_TEXT.green, opacity: valid ? 1 : 0.5 }}>
            {busy ? "Creating…" : "Create decision"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RelinkPanel({ customerId, decision, onClose }: { customerId: number; decision: RiskDecision; onClose: () => void }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [checkKey, setCheckKey] = useState(decision.checkKey ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await updateDecision(customerId, decision.id, { checkKey: checkKey || null });
    setBusy(false);
    onClose();
  }

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: ACCENT.info }} data-testid="rbd-relink-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...label, display: "flex", alignItems: "center", gap: 6 }}><Link2 size={12} /> Linked automated check · {decision.rbdId}</div>
        <button onClick={onClose} style={{ ...btn, padding: 4, background: "transparent", border: "none" }}><X size={15} color={TEXT.dim} /></button>
      </div>
      <select data-testid="rbd-relink-picker" value={checkKey} onChange={(e) => setCheckKey(e.target.value)} style={inputStyle}>
        <option value="">— none (unlink) —</option>
        {state.checks.map((c) => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>
      <div style={{ marginTop: 10 }}>
        <button data-testid="rbd-relink-save" onClick={() => void save()} disabled={busy} style={{ ...btn, borderColor: ACCENT.green, color: ACCENT_TEXT.green }}>
          {busy ? "Saving…" : "Save linked check"}
        </button>
      </div>
    </div>
  );
}

function DecisionList({ decisions, onOpen }: { decisions: RiskDecision[]; onOpen: (id: number) => void }) {
  if (decisions.length === 0) {
    return <Stated>No risk decisions on file for this customer yet. Use &ldquo;New decision&rdquo; above to record one.</Stated>;
  }
  return (
    <div style={{ border: `1px solid ${LINE.base}`, borderRadius: 8, overflow: "hidden" }} data-testid="rbd-list">
      {decisions.map((d, i) => {
        const linked = checkLabel(d.checkKey);
        return (
          <button
            key={d.id}
            data-testid={`rbd-decision-${d.id}`}
            onClick={() => onOpen(d.id)}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
              padding: "11px 12px", background: SURFACE.card, cursor: "pointer",
              borderTop: i === 0 ? "none" : `1px solid ${LINE.subtle}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: FONT.mono }}>{d.rbdId}</span>
                <span>·</span>
                <span>{d.framework}</span>
                {linked && (
                  <>
                    <span>·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: ACCENT_TEXT.green }}>
                      <Link2 size={11} /> {linked}
                    </span>
                  </>
                )}
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusTone(d.status), flexShrink: 0, whiteSpace: "nowrap" }}>
              {STATUS_LABEL[d.status] ?? d.status}
            </span>
          </button>
        );
      })}
    </div>
  );
}
