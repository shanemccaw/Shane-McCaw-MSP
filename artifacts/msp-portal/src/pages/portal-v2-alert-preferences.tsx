/**
 * portal-v2-alert-preferences.tsx — Alert preferences (Part 12).
 *
 * Ported from the prototype's `isAlertPrefs` block (Customer Portal Shell.dc.html
 * 2722-2872) and its render values (15238-15311, 19709-19767), transcribed into
 * alertPrefsData.ts / alertPrefsModel.ts.
 *
 * ── One taxonomy, two delivery surfaces ─────────────────────────────────────
 * These categories are the same set the Webhooks page keys its events off. Here
 * the two decisions are: whether you want a category, and where it goes.
 *
 * ── Real persistence (Git #1276) ─────────────────────────────────────────────
 * Presets, per-category on/off + dest/mode/threshold, quiet hours and recipient
 * removal are the design's own local state, wired to real GET/PUT
 * (alertPrefsLive.ts → routes/portal-alert-preferences.ts) instead of resetting
 * on refresh. "Add recipient" still opens a form drawer in the design (shell
 * machinery a page must not touch) and is inert here — only removal round-trips.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";

import { useAuth } from "@/lib/auth-context";
import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  ALERT_ALWAYS_EMAIL_NOTE,
  ALERT_CATS,
  ALERT_CATS_KICKER,
  ALERT_CATS_NOTE,
  ALERT_DEST_LABELS,
  ALERT_HOW_OFTEN_LABEL,
  ALERT_MODES,
  ALERT_OFF_LINE,
  ALERT_POSTURE_LABEL,
  ALERT_PRESET_PREFIX,
  ALERT_QUIET_BODY,
  ALERT_QUIET_BREAK,
  ALERT_QUIET_BREAK_NOTE,
  ALERT_QUIET_KICKER,
  ALERT_QUIET_SEED,
  ALERT_QUIET_TITLE,
  ALERT_RECIPIENTS_ADD,
  ALERT_RECIPIENTS_KICKER,
  ALERT_RECIPIENTS_NOTE,
  ALERT_RECIPIENTS_SEED,
  ALERT_RESET,
  ALERT_SAVE,
  ALERT_SAVED_AT_SEED,
  ALERT_SUBTITLE,
  ALERT_TITLE,
  ALERT_UNSAVED,
  ALERT_WHAT_COUNTS_LABEL,
  ALERT_WHERE_LABEL,
  type AlertPrefs,
  type AlertQuiet,
  type AlertRecipient,
} from "@/components/portal-v2/alertPrefsData";
import {
  ALERT_PREFS_SEED,
  ALERT_SELECT_OPTIONS,
  applyPreset,
  catDestValue,
  patchPref,
  presetDesc,
  presetLabel,
  type AlertSelectValue,
} from "@/components/portal-v2/alertPrefsModel";
import { fetchAlertPreferences, saveAlertPreferences } from "@/components/portal-v2/alertPrefsLive";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const SELECT_CSS: React.CSSProperties = {
  padding: "6px 9px",
  borderRadius: 6,
  border: "1px solid rgba(30,41,59,.9)",
  background: "#0b1a2e",
  color: "#e2e8f0",
  fontSize: "11.5px",
  fontFamily: "inherit",
  cursor: "pointer",
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
      {children}
    </span>
  );
}

/** The design's 38×21 toggle — proto 15269-15270. */
function Toggle({ on, onClick, testId, label }: { on: boolean; onClick: () => void; testId?: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      title="Turn this category on or off"
      style={{
        position: "relative",
        flex: "0 0 38px",
        width: 38,
        height: 21,
        borderRadius: 11,
        border: `1px solid ${on ? "rgba(0,120,212,.7)" : "rgba(148,163,184,.25)"}`,
        background: on ? "rgba(0,120,212,.35)" : "rgba(148,163,184,.1)",
        cursor: "pointer",
        padding: 0,
        fontFamily: "inherit",
        transition: "background 160ms",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 19 : 2,
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: on ? "#e2e8f0" : "#64748b",
          transition: "left 160ms",
        }}
      />
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>
      {children}
    </span>
  );
}

export default function PortalV2AlertPreferencesPage() {
  const { user, fetchWithAuth } = useAuth();
  const [prefs, setPrefs] = useState<AlertPrefs>(ALERT_PREFS_SEED);
  const [preset, setPreset] = useState<AlertSelectValue>("balanced");
  const [quiet, setQuiet] = useState<AlertQuiet>(ALERT_QUIET_SEED);
  const [recipients, setRecipients] = useState<readonly AlertRecipient[]>(ALERT_RECIPIENTS_SEED);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(ALERT_SAVED_AT_SEED);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAlertPreferences(fetchWithAuth)
      .then((loaded) => {
        if (cancelled) return;
        setPrefs(loaded.prefs);
        setPreset(loaded.preset);
        setQuiet(loaded.quiet);
        setRecipients(loaded.recipients);
        setSavedAt(loaded.savedAtLabel);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("pv2-alert-preferences: load failed", err);
        setError("Unable to load your alert preferences right now.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const editPref = (key: (typeof ALERT_CATS)[number]["key"], patch: Partial<AlertPrefs[typeof key]>) => {
    setPrefs((p) => patchPref(p, key, patch));
    setPreset("custom");
    setDirty(true);
  };

  const onPresetSelect = (value: AlertSelectValue) => {
    if (value === "custom") return;
    setPrefs(applyPreset(value));
    setPreset(value);
    setDirty(true);
  };

  const editQuiet = (patch: Partial<AlertQuiet>) => {
    setQuiet((q) => ({ ...q, ...patch }));
    setDirty(true);
  };

  const save = () => {
    setSaving(true);
    setError(null);
    saveAlertPreferences(fetchWithAuth, { prefs, preset, quiet, recipients: [...recipients] })
      .then(() => {
        setDirty(false);
        setSavedAt(user?.name ? `Saved just now by ${user.name}` : "Saved just now");
      })
      .catch((err) => {
        console.error("pv2-alert-preferences: save failed", err);
        setError("Unable to save your alert preferences right now. Please try again.");
      })
      .finally(() => setSaving(false));
  };
  const reset = () => {
    setPreset("balanced");
    setPrefs(applyPreset("balanced"));
    setQuiet(ALERT_QUIET_SEED);
    setDirty(true);
  };

  return (
    <PortalV2Shell eyebrow="Account" title={ALERT_TITLE}>
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          data-testid="pv2-alert-preferences"
          style={{
            position: "relative",
            maxWidth: 1120,
            margin: "0 auto",
            padding: "26px 26px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          <span data-testid="pv2-alert-source" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {loading ? "loading" : error ? "fixture" : "live"}
          </span>

          <Link
            href="/portal-v2"
            data-testid="pv2-alert-back"
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontFamily: "inherit", textDecoration: "none" }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Overview
          </Link>

          {/* Header — proto 2729-2738 */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid rgba(30,41,59,.9)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span data-testid="pv2-page-title" style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}>{ALERT_TITLE}</span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "76ch" }}>{ALERT_SUBTITLE}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flex: "0 0 auto" }}>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                {ALERT_PRESET_PREFIX} <span data-testid="pv2-alert-preset-label" style={{ color: "#e2e8f0", fontWeight: 700 }}>{presetLabel(preset)}</span>
              </span>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{savedAt}</span>
            </div>
          </div>

          {/* Posture picker — proto 2740-2750 */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap", padding: "13px 15px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 11, background: "rgba(15,23,42,.4)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 auto" }}>
              <FieldLabel>{ALERT_POSTURE_LABEL}</FieldLabel>
              <select
                value={preset}
                onChange={(e) => onPresetSelect(e.target.value as AlertSelectValue)}
                data-testid="pv2-alert-preset-select"
                style={{ ...SELECT_CSS, minWidth: 190, padding: "7px 10px", borderRadius: 7 }}
              >
                {ALERT_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty", paddingTop: 18 }}>{presetDesc(preset)}</span>
          </div>

          {/* Categories — proto 2752-2805 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.9)", flexWrap: "wrap" }}>
              <Kicker>{ALERT_CATS_KICKER}</Kicker>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{ALERT_CATS_NOTE}</span>
            </div>
            {ALERT_CATS.map((c) => {
              const p = prefs[c.key];
              return (
                <div
                  key={c.key}
                  data-testid={`pv2-alert-cat-${c.key}`}
                  style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderBottom: "1px solid rgba(30,41,59,.85)", opacity: p.on ? 1 : 0.55 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <Toggle on={p.on} onClick={() => editPref(c.key, { on: !p.on })} testId={`pv2-alert-cat-toggle-${c.key}`} label={`Turn ${c.name} on or off`} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{c.name}</span>
                      <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{c.trigger}</span>
                      <span style={{ fontSize: "10.5px", color: "#475569" }}>{c.volume}</span>
                    </div>
                  </div>
                  {p.on ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, paddingLeft: 50 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <FieldLabel>{ALERT_WHERE_LABEL}</FieldLabel>
                        <select value={catDestValue(p)} onChange={(e) => editPref(c.key, { email: e.target.value === "email" })} style={SELECT_CSS}>
                          <option value="inapp">{ALERT_DEST_LABELS.inapp}</option>
                          <option value="email">{ALERT_DEST_LABELS.email}</option>
                        </select>
                        {c.alwaysEmail && <span style={{ fontSize: "10px", color: "#475569" }}>{ALERT_ALWAYS_EMAIL_NOTE}</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <FieldLabel>{ALERT_HOW_OFTEN_LABEL}</FieldLabel>
                        <select value={p.mode} onChange={(e) => editPref(c.key, { mode: e.target.value as typeof p.mode })} style={SELECT_CSS}>
                          {ALERT_MODES.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <FieldLabel>{ALERT_WHAT_COUNTS_LABEL}</FieldLabel>
                        <select value={p.threshold} onChange={(e) => editPref(c.key, { threshold: e.target.value })} style={SELECT_CSS}>
                          {c.thresholds.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <span style={{ paddingLeft: 50, fontSize: "11px", color: "#64748b" }}>{ALERT_OFF_LINE}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quiet hours + recipients — proto 2807-2858 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 14, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
              <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                <Kicker>{ALERT_QUIET_KICKER}</Kicker>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Toggle on={quiet.on} onClick={() => editQuiet({ on: !quiet.on })} testId="pv2-alert-quiet-toggle" label="Hold email overnight" />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{ALERT_QUIET_TITLE}</span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{ALERT_QUIET_BODY}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingLeft: 50 }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>From</span>
                  <input type="time" value={quiet.from} onChange={(e) => editQuiet({ from: e.target.value })} style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid rgba(30,41,59,.9)", background: "#0b1a2e", color: "#e2e8f0", fontSize: "11.5px", fontFamily: MONO }} />
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>to</span>
                  <input type="time" value={quiet.to} onChange={(e) => editQuiet({ to: e.target.value })} style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid rgba(30,41,59,.9)", background: "#0b1a2e", color: "#e2e8f0", fontSize: "11.5px", fontFamily: MONO }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingLeft: 50 }}>
                  <button
                    type="button"
                    onClick={() => editQuiet({ breakForCritical: !quiet.breakForCritical })}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 5,
                      border: `1px solid ${quiet.breakForCritical ? "#f8717177" : "rgba(148,163,184,.18)"}`,
                      background: quiet.breakForCritical ? "#f8717118" : "transparent",
                      fontSize: "10.5px",
                      fontWeight: quiet.breakForCritical ? 700 : 600,
                      color: quiet.breakForCritical ? "#e2e8f0" : "#64748b",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ALERT_QUIET_BREAK}
                  </button>
                  <span style={{ fontSize: "10.5px", color: "#475569" }}>{ALERT_QUIET_BREAK_NOTE}</span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                <Kicker>{ALERT_RECIPIENTS_KICKER}</Kicker>
                <button
                  type="button"
                  style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.1)", fontSize: "10.5px", fontWeight: 700, color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {ALERT_RECIPIENTS_ADD}
                </button>
              </div>
              {recipients.map((r) => (
                <div key={r.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.8)" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", fontFamily: MONO, overflowWrap: "break-word" }}>{r.email}</span>
                    <span style={{ fontSize: "10.5px", color: "#64748b" }}>{r.role} · {r.scope}</span>
                  </div>
                  {r.primary ? (
                    <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b" }}>Primary</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRecipients((rs) => rs.filter((x) => x.email !== r.email));
                        setDirty(true);
                      }}
                      style={{ padding: "4px 9px", borderRadius: 5, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "10.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <div style={{ padding: "11px 16px" }}>
                <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5 }}>{ALERT_RECIPIENTS_NOTE}</span>
              </div>
            </div>
          </div>

          {/* Footer — proto 2860-2871 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid rgba(30,41,59,.9)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving || loading}
                data-testid="pv2-alert-save"
                style={{
                  padding: "9px 18px",
                  borderRadius: 7,
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: dirty && !saving ? "pointer" : "default",
                  fontFamily: "inherit",
                  border: `1px solid ${dirty ? "#0078D4" : "rgba(30,41,59,.9)"}`,
                  background: dirty ? "#0078D4" : "transparent",
                  color: dirty ? "#fff" : "#475569",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : ALERT_SAVE}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                data-testid="pv2-alert-reset"
                style={{ padding: "9px 16px", borderRadius: 7, fontSize: "12.5px", fontWeight: 600, border: "1px solid rgba(30,41,59,.9)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
              >
                {ALERT_RESET}
              </button>
            </div>
            {error ? (
              <span data-testid="pv2-alert-error" style={{ fontSize: "11.5px", color: "#f87171", fontWeight: 600 }}>{error}</span>
            ) : dirty ? (
              <span data-testid="pv2-alert-dirty" style={{ fontSize: "11.5px", color: "#c2a63d", fontWeight: 600 }}>{ALERT_UNSAVED}</span>
            ) : (
              <span data-testid="pv2-alert-saved-at" style={{ fontSize: "11.5px", color: "#64748b" }}>{savedAt}</span>
            )}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
