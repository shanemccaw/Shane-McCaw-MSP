/**
 * Retainer Hours body (Git #1293).
 *
 * The screen where Shane picks a customer, sees their monthly hour bucket
 * (retained / rolled / used, with real month-to-month rollover computed
 * server-side), reviews the work-log ledger, and logs ad-hoc "unscoped" hours.
 * Tracker-derived entries appear here automatically as items are closed.
 *
 * Every number shown is served by the API — nothing is computed or hardcoded
 * in this component. That is the whole point of the module: it is the source
 * the customer page (#1285) will read.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Clock, Plus, X } from "lucide-react";
import { SURFACE, LINE, TEXT, ACCENT, ACCENT_TEXT, FONT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import {
  subscribe,
  getSnapshot,
  selectCustomer,
  clearSelection,
  logUnscopedHours,
  saveSettings,
  type RetainerEntry,
} from "./retainerStore";

const PILLARS = ["Health", "Compliance", "Governance", "Security", "Adoption"] as const;
const STATES: Record<string, string> = {
  in_progress: "In progress",
  closed: "Closed",
  in_review: "In review",
  scheduled: "Scheduled",
};

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

export function RetainerBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const shell = useShell();
  const [showLog, setShowLog] = useState(false);

  // The ribbon's "Log unscoped hours" fires this to open the form.
  useEffect(() => {
    const open = () => setShowLog(true);
    window.addEventListener("retainer:new-unscoped", open);
    return () => window.removeEventListener("retainer:new-unscoped", open);
  }, []);

  const detail = state.detail;

  // ── Customer picker (no customer selected) ──────────────────────────────
  if (!state.selectedCustomerId) {
    return (
      <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Clock size={18} color={ACCENT.green} />
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: TEXT.bright }}>Retainer Hours</h2>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 12.5, color: TEXT.dim, maxWidth: 640, lineHeight: 1.6 }}>
          Pick a customer to see their retainer bucket and the work logged against it. Hours log here automatically
          when you close a tracked change or remediation item, and the button below logs anything ad-hoc.
        </p>
        {state.customersLoading && <Stated>Loading customers…</Stated>}
        {state.customersError && <Stated>Could not load customers: {state.customersError}</Stated>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {state.customers.map((c) => (
            <button
              key={c.customerId}
              data-testid={`retainer-customer-${c.customerId}`}
              onClick={() => selectCustomer(c.customerId)}
              style={{ ...card, textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: TEXT.primary }}>{c.name}</span>
                <span style={{ fontSize: 11, color: c.onRetainer ? ACCENT_TEXT.green : TEXT.faint }}>
                  {c.onRetainer ? "on retainer" : "not set"}
                </span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: TEXT.dim }}>
                {c.onRetainer
                  ? `${c.bucket.usedHours} of ${c.bucket.retainedHours + c.bucket.rolledHours}h used · ${c.bucket.remainingHours}h left`
                  : `${c.entryCount} entr${c.entryCount === 1 ? "y" : "ies"} logged`}
              </div>
              {c.architectName && <div style={{ marginTop: 4, fontSize: 11, color: TEXT.faint }}>{c.architectName}</div>}
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
        data-testid="retainer-back"
        onClick={() => clearSelection()}
        style={{ ...btn, marginBottom: 14, background: "transparent", borderColor: LINE.control }}
      >
        ← All customers
      </button>
      {state.detailLoading && !detail && <Stated>Loading retainer…</Stated>}
      {state.detailError && <Stated>Could not load retainer: {state.detailError}</Stated>}
      {detail && (
        <>
          <Header name={detail.customer.name} />
          <SettingsCard customerId={detail.customer.customerId} settings={detail.settings} />
          <BucketCard bucket={detail.bucket} settings={detail.settings} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 0 10px" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TEXT.strong }}>Where the hours went</h3>
            <button
              data-testid="retainer-log-unscoped-toggle"
              onClick={() => setShowLog((v) => !v)}
              style={{ ...btn, display: "flex", alignItems: "center", gap: 6, borderColor: ACCENT.amber, color: ACCENT_TEXT.amber }}
            >
              <Plus size={14} /> Log unscoped hours
            </button>
          </div>

          {showLog && (
            <UnscopedForm
              customerId={detail.customer.customerId}
              onClose={() => setShowLog(false)}
            />
          )}

          <Ledger entries={detail.entries} onOpen={(id) => shell.openPeek("retainer", String(id))} />
        </>
      )}
    </div>
  );
}

function Header({ name }: { name: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...label, color: TEXT.caption }}>My Architect · Retainer</div>
      <h2 style={{ margin: "3px 0 0", fontSize: 18, fontWeight: 700, color: TEXT.bright }}>{name}</h2>
    </div>
  );
}

function SettingsCard({ customerId, settings }: { customerId: number; settings: import("./retainerStore").RetainerSettings }) {
  const [hours, setHours] = useState(String(settings.retainedHours));
  const [architect, setArchitect] = useState(settings.architectName ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setHours(String(settings.retainedHours));
    setArchitect(settings.architectName ?? "");
  }, [settings.retainedHours, settings.architectName, customerId]);

  async function save() {
    const h = parseFloat(hours);
    if (!Number.isFinite(h) || h < 0) return;
    setSaving(true);
    const ok = await saveSettings(customerId, {
      retainedHours: h,
      architectName: architect.trim() || null,
      active: true,
    });
    setSaving(false);
    if (ok) setSavedAt("Saved just now");
  }

  return (
    <div style={{ ...card, marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ flex: "0 0 150px" }}>
        <div style={label}>Retained hours / month</div>
        <input
          data-testid="retainer-retained-hours"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          inputMode="decimal"
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </div>
      <div style={{ flex: "1 1 220px" }}>
        <div style={label}>Named architect</div>
        <input
          data-testid="retainer-architect"
          value={architect}
          onChange={(e) => setArchitect(e.target.value)}
          placeholder="e.g. Priya Raman · M365 Architect"
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </div>
      <button
        data-testid="retainer-save-settings"
        onClick={() => void save()}
        disabled={saving}
        style={{ ...btn, borderColor: ACCENT.green, color: ACCENT_TEXT.green }}
      >
        {saving ? "Saving…" : settings.configured ? "Update" : "Set up retainer"}
      </button>
      {savedAt && <span data-testid="retainer-settings-saved" style={{ fontSize: 11.5, color: ACCENT_TEXT.green }}>{savedAt}</span>}
    </div>
  );
}

function BucketCard({ bucket, settings }: { bucket: import("./retainerStore").RetainerBucket; settings: import("./retainerStore").RetainerSettings }) {
  const total = bucket.retainedHours + bucket.rolledHours;
  const pct = total > 0 ? Math.min(100, Math.round((bucket.usedHours / total) * 100)) : 0;
  const over = bucket.remainingHours <= 0 && total > 0;
  return (
    <div style={{ ...card }} data-testid="retainer-bucket">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={label}>Time this period · {bucket.period}</div>
        {!settings.configured && <span style={{ fontSize: 11, color: TEXT.faint }}>using default 8h until set up</span>}
      </div>
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 12 }}>
        <Stat label="Retained" value={`${bucket.retainedHours}h`} />
        <Stat label="Rolled over" value={`${bucket.rolledHours}h`} tone={bucket.rolledHours > 0 ? ACCENT_TEXT.amber : undefined} />
        <Stat label="Used" value={`${bucket.usedHours}h`} />
        <Stat
          label="Remaining"
          value={`${bucket.remainingHours}h`}
          tone={over ? ACCENT_TEXT.danger : ACCENT_TEXT.green}
          testid="retainer-remaining"
        />
      </div>
      <div style={{ height: 8, borderRadius: 4, background: SURFACE.well, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: over ? ACCENT.danger : ACCENT.green }} />
      </div>
    </div>
  );
}

function Stat({ label: l, value, tone, testid }: { label: string; value: string; tone?: string; testid?: string }) {
  return (
    <div data-testid={testid}>
      <div style={{ fontSize: 21, fontWeight: 800, color: tone ?? TEXT.bright, fontFamily: FONT.mono }}>{value}</div>
      <div style={{ ...label, marginTop: 2 }}>{l}</div>
    </div>
  );
}

function UnscopedForm({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const [item, setItem] = useState("");
  const [hours, setHours] = useState("");
  const [pillar, setPillar] = useState<string>("");
  const [finding, setFinding] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = item.trim().length > 0 && Number.isFinite(parseFloat(hours)) && parseFloat(hours) >= 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    const entry = await logUnscopedHours(customerId, {
      item: item.trim(),
      hours: parseFloat(hours),
      pillar: pillar || null,
      finding: finding.trim() || null,
      outcome: outcome.trim() || null,
    });
    setBusy(false);
    if (entry) onClose();
  }

  return (
    <div style={{ ...card, marginBottom: 14, borderColor: ACCENT.amber }} data-testid="retainer-unscoped-form">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...label, color: ACCENT_TEXT.amber }}>Log ad-hoc hours</div>
        <button onClick={onClose} style={{ ...btn, padding: 4, background: "transparent", border: "none" }}><X size={15} color={TEXT.dim} /></button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <div style={label}>What was done</div>
          <input data-testid="retainer-unscoped-item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. Helped build the onboarding workflow" style={{ ...inputStyle, marginTop: 5 }} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 110px" }}>
            <div style={label}>Hours</div>
            <input data-testid="retainer-unscoped-hours" value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="1.5" style={{ ...inputStyle, marginTop: 5 }} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <div style={label}>Pillar</div>
            <select value={pillar} onChange={(e) => setPillar(e.target.value)} style={{ ...inputStyle, marginTop: 5 }}>
              <option value="">— none —</option>
              {PILLARS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <div style={label}>Finding</div>
            <input value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="e.g. HLT-02" style={{ ...inputStyle, marginTop: 5 }} />
          </div>
        </div>
        <div>
          <div style={label}>Outcome</div>
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} style={{ ...inputStyle, marginTop: 5, resize: "vertical" }} />
        </div>
        <div>
          <button data-testid="retainer-unscoped-submit" onClick={() => void submit()} disabled={!valid || busy} style={{ ...btn, borderColor: ACCENT.green, color: ACCENT_TEXT.green, opacity: valid ? 1 : 0.5 }}>
            {busy ? "Logging…" : "Log hours"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Ledger({ entries, onOpen }: { entries: RetainerEntry[]; onOpen: (id: number) => void }) {
  // Group by week label (fallback to month), most recent first.
  const groups = useMemo(() => {
    const map = new Map<string, RetainerEntry[]>();
    for (const e of entries) {
      const key = e.week ?? e.periodMonth;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [entries]);

  if (entries.length === 0) {
    return <Stated>No hours logged yet. Close a tracked item, or use “Log unscoped hours” above.</Stated>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="retainer-ledger">
      {groups.map(([week, rows]) => (
        <div key={week}>
          <div style={{ ...label, marginBottom: 6 }}>{week}</div>
          <div style={{ border: `1px solid ${LINE.base}`, borderRadius: 8, overflow: "hidden" }}>
            {rows.map((e, i) => (
              <button
                key={e.id}
                data-testid={`retainer-entry-${e.id}`}
                onClick={() => onOpen(e.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                  padding: "10px 12px", background: SURFACE.card, cursor: "pointer",
                  borderTop: i === 0 ? "none" : `1px solid ${LINE.subtle}`,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: e.pillarColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.item}</div>
                  <div style={{ fontSize: 11, color: TEXT.faint, marginTop: 2 }}>
                    {[e.pillar, e.finding, STATES[e.stateStored] ?? e.state, e.source === "unscoped" ? "ad-hoc" : "from tracker"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: TEXT.strong, flexShrink: 0 }}>{e.hours}h</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
