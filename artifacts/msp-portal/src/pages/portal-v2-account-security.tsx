/**
 * portal-v2-account-security.tsx — Account security (Part 12).
 *
 * Ported from the prototype's `isAccountSecurity` block (Customer Portal Shell
 * .dc.html 2199-2368) and its render values (19633-19643), transcribed into
 * accountSecurityData.ts / accountSecurityModel.ts.
 *
 * ── The customer's own login, not their tenant ──────────────────────────────
 * The header says so verbatim: "Your login to this portal — not your Microsoft
 * 365 tenant. Tenant findings live under the six pillars." The page is measured
 * with the pillar pages' evidence language on purpose.
 *
 * ── Live data (Git #1235) ─────────────────────────────────────────────────
 * Identity, MFA method state, and the active-sessions list (with working
 * "Sign out everywhere else" / per-row "Revoke") are wired to the portal's own
 * real auth endpoints via `useAccountSecurityLive` — see that hook's own doc
 * comment for exactly which endpoints, and for the honest list of what still
 * has no live source (password age has no `passwordChangedAt` column yet;
 * "Failed attempts" is a real DB column not yet exposed by any endpoint;
 * device compliance is Entra/Intune data out of this page's own scope).
 *
 * ── UI-only ─────────────────────────────────────────────────────────────────
 * The delete-account section IS interactive — expand/collapse and the
 * type-to-confirm gate are the design's own state — but change password, set
 * up passkey, and submit deletion remain inert design copy/CTAs; wiring those
 * to `POST /api/auth/change-password`, MFA enrollment, and
 * `POST /api/portal/deletion-request` (all of which already exist) is a later
 * pass, same as the "Your data" export/delete cards.
 */

import { useState } from "react";
import { Link } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  SEC_DATA,
  SEC_DATA_KICKER,
  SEC_DATA_SUB,
  SEC_DELETE_EXPORT_FIRST,
  SEC_DELETE_FACTS,
  SEC_DELETE_CONFIRM_KICKER,
  SEC_DELETE_PHRASE,
  SEC_DELETE_SUB,
  SEC_DELETE_SUBMIT,
  SEC_DELETE_TITLE,
  SEC_DELETE_WITHDRAW,
  SEC_IDENTITY_EMAIL,
  SEC_IDENTITY_ROLE,
  SEC_MFA,
  SEC_MFA_KICKER,
  SEC_MFA_SUB,
  SEC_PASSWORD_BODY,
  SEC_PASSWORD_CHANGE,
  SEC_PASSWORD_HISTORY,
  SEC_PASSWORD_KICKER,
  SEC_PASSWORD_SUB,
  SEC_POSTURE,
  SEC_POSTURE_KICKER,
  SEC_POSTURE_NOTE,
  SEC_POSTURE_VERIFIED,
  SEC_SESSIONS,
  SEC_SESSIONS_KICKER,
  SEC_SESSIONS_NOTE,
  SEC_SESSIONS_SIGNOUT,
  SEC_SUBTITLE,
  SEC_TITLE,
} from "@/components/portal-v2/accountSecurityData";
import {
  mfaAccent,
  mfaIsActive,
  mfaMethodWithLive,
  mfaPostureSummary,
  mfaPostureTone,
  secDeleteReady,
  secDotColor,
  sessionCompliantColor,
  sessionDotColor,
  sessionIsUnmanaged,
  sessionsPostureSummary,
} from "@/components/portal-v2/accountSecurityModel";
import { useAccountSecurityLive } from "@/components/portal-v2/useAccountSecurityLive";
import { timeAgo } from "@/components/portal-v2/overviewModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function BackToOverview() {
  return (
    <Link
      href="/portal-v2"
      data-testid="pv2-sec-back"
      style={{
        alignSelf: "flex-start",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: 0,
        cursor: "pointer",
        fontSize: "11.5px",
        fontWeight: 600,
        color: "#64748b",
        fontFamily: "inherit",
        textDecoration: "none",
      }}
    >
      <span style={{ display: "flex" }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </span>
      Overview
    </Link>
  );
}

function Kicker({ children, color = "#64748b" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color }}>
      {children}
    </span>
  );
}

/* ── Multifactor method card — proto 2245-2266 ─────────────────────────────── */

function MfaCard({ m }: { m: (typeof SEC_MFA)[number] }) {
  const accent = mfaAccent(m.tone);
  const active = mfaIsActive(m.state);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "15px 16px",
        borderRadius: 11,
        border: `1px solid ${m.recommended ? "rgba(52,211,153,.35)" : "rgba(30,41,59,.9)"}`,
        background: m.recommended ? "rgba(52,211,153,.05)" : "rgba(15,23,42,.4)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", fontWeight: 800, color: "#f1f5f9" }}>{m.name}</span>
        <span
          style={{
            flex: "0 0 auto",
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${accent}55`,
            background: `${accent}14`,
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: accent,
            whiteSpace: "nowrap",
          }}
        >
          {m.strength}
        </span>
      </div>
      <span style={{ fontSize: "10.5px", fontWeight: 600, color: active ? "#34d399" : "#64748b" }}>{m.state}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[
          { label: "How it works", body: m.how, color: "#e2e8f0" },
          { label: "What it protects against", body: m.why, color: "#cbd5e1" },
          { label: "The trade-off", body: m.tradeoff, color: "#94a3b8" },
        ].map((r) => (
          <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>{r.label}</span>
            <span style={{ fontSize: "11.5px", color: r.color, lineHeight: 1.55, textWrap: "pretty" }}>{r.body}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        style={{
          alignSelf: "flex-start",
          padding: "7px 13px",
          borderRadius: 7,
          fontSize: "11.5px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
          border: `1px solid ${m.recommended ? "rgba(52,211,153,.5)" : "rgba(148,163,184,.24)"}`,
          background: m.recommended ? "rgba(52,211,153,.12)" : "transparent",
          color: m.recommended ? "#34d399" : "#94a3b8",
        }}
      >
        {m.cta}
      </button>
    </div>
  );
}

export default function PortalV2AccountSecurityPage() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const ready = secDeleteReady(deleteText);

  const live = useAccountSecurityLive();

  const identityEmail = live.identityEmail ?? SEC_IDENTITY_EMAIL;
  const identityRole = live.identityRole ?? SEC_IDENTITY_ROLE;

  const posture = SEC_POSTURE.map((row) => {
    if (row.k === "Multifactor" && live.mfa) {
      return { ...row, v: mfaPostureSummary(live.mfa), tone: mfaPostureTone(live.mfa) };
    }
    if (row.k === "Passkey" && live.mfa) {
      return live.mfa.passkey
        ? { ...row, v: `Registered · ${live.mfa.passkeyCount} passkey${live.mfa.passkeyCount === 1 ? "" : "s"}`, tone: "green" as const }
        : row;
    }
    if (row.k === "Sessions" && live.sessions) {
      return { ...row, v: sessionsPostureSummary(live.sessions.length), tone: "green" as const };
    }
    if (row.k === "Last sign-in" && live.lastSignInAt) {
      return { ...row, v: `${timeAgo(live.lastSignInAt)} · from your most recent login row`, tone: "green" as const };
    }
    return row;
  });

  const mfaCards = SEC_MFA.map((m) => mfaMethodWithLive(m, live.mfa));
  // Fixture rows get a negative synthetic id (never a real session row) so the
  // list always has a stable id to key/act on without a type-narrowing union.
  const sessionRows = live.sessions ?? SEC_SESSIONS.map((s, i) => ({ ...s, id: -(i + 1) }));

  return (
    <PortalV2Shell eyebrow="Account" title={SEC_TITLE}>
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          data-testid="pv2-account-security"
          data-account-security-source={live.dataState}
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
          <span data-testid="pv2-sec-data-source" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {live.dataState}
          </span>

          <BackToOverview />

          {/* Header — proto 2206-2215 */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              paddingBottom: 14,
              borderBottom: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span data-testid="pv2-page-title" style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}>
                {SEC_TITLE}
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "82ch" }}>{SEC_SUBTITLE}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flex: "0 0 auto" }}>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>{identityEmail}</span>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{identityRole}</span>
            </div>
          </div>

          {/* Posture card — proto 2217-2236 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(52,211,153,.24)",
              borderRadius: 12,
              background: "rgba(52,211,153,.04)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                padding: "11px 16px",
                borderBottom: "1px solid rgba(52,211,153,.14)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#34d399" }}>
                {SEC_POSTURE_KICKER}
              </span>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>{SEC_POSTURE_VERIFIED}</span>
            </div>
            <div
              style={{
                padding: "14px 16px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
                gap: "10px 20px",
              }}
            >
              {posture.map((p) => (
                <div key={p.k} style={{ display: "flex", alignItems: "flex-start", gap: 9, minWidth: 0 }}>
                  <span style={{ flex: "0 0 6px", width: 6, height: 6, borderRadius: "50%", background: secDotColor(p.tone), marginTop: 6 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>{p.k}</span>
                    <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45 }}>{p.v}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "0 16px 14px" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{SEC_POSTURE_NOTE}</span>
            </div>
          </div>

          {/* Multifactor methods — proto 2238-2269 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Kicker>{SEC_MFA_KICKER}</Kicker>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{SEC_MFA_SUB}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 10 }}>
              {mfaCards.map((m) => (
                <MfaCard key={m.key} m={m} />
              ))}
            </div>
          </div>

          {/* Sessions + Password — proto 2271-2313 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, alignItems: "start" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.35)",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                <Kicker>{SEC_SESSIONS_KICKER}</Kicker>
                <button
                  type="button"
                  onClick={live.sessions ? () => void live.signOutOthers() : undefined}
                  style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "10.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {SEC_SESSIONS_SIGNOUT}
                </button>
              </div>
              {sessionRows.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.8)" }}>
                  <span style={{ flex: "0 0 6px", width: 6, height: 6, borderRadius: "50%", background: sessionDotColor(s.current), marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>{s.device}</span>
                      {s.current && (
                        <span style={{ padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(52,211,153,.35)", background: "rgba(52,211,153,.08)", fontSize: "9px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#34d399" }}>
                          This device
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>
                      {s.where} · {s.when}
                    </span>
                    <span style={{ fontSize: "10.5px", color: sessionCompliantColor(s.compliant) }}>
                      {s.compliant ? `${s.since} · ${s.compliant}` : s.since}
                    </span>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      onClick={live.sessions ? () => void live.revokeSession(s.id) : undefined}
                      style={{ flex: "0 0 auto", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(148,163,184,.22)", background: "transparent", fontSize: "10.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              <div style={{ padding: "11px 16px" }}>
                <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5 }}>{SEC_SESSIONS_NOTE}</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.35)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                <Kicker>{SEC_PASSWORD_KICKER}</Kicker>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}>
                <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55 }}>{SEC_PASSWORD_BODY}</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55 }}>{SEC_PASSWORD_SUB}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
                  <button
                    type="button"
                    style={{ padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(0,120,212,.45)", background: "rgba(0,120,212,.12)", fontSize: "11.5px", fontWeight: 700, color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {SEC_PASSWORD_CHANGE}
                  </button>
                  <button
                    type="button"
                    style={{ padding: "7px 13px", borderRadius: 7, border: "1px solid rgba(148,163,184,.24)", background: "transparent", fontSize: "11.5px", fontWeight: 600, color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {SEC_PASSWORD_HISTORY}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Your data — proto 2315-2330 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Kicker>{SEC_DATA_KICKER}</Kicker>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{SEC_DATA_SUB}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 10 }}>
              {SEC_DATA.map((d) => (
                <div
                  key={d.name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    padding: "14px 16px",
                    border: "1px solid rgba(30,41,59,.9)",
                    borderRadius: 11,
                    background: "rgba(15,23,42,.4)",
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{d.name}</span>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{d.detail}</span>
                  <span style={{ fontSize: "10.5px", color: "#64748b" }}>{d.wait}</span>
                  <button
                    type="button"
                    style={{
                      alignSelf: "flex-start",
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      border: `1px solid ${d.primary ? "rgba(0,120,212,.45)" : "rgba(148,163,184,.24)"}`,
                      background: d.primary ? "rgba(0,120,212,.12)" : "transparent",
                      color: d.primary ? "#60a5fa" : "#94a3b8",
                    }}
                  >
                    {d.cta}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Delete your account — proto 2332-2367 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 12,
              background: "rgba(15,23,42,.3)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDeleteOpen((o) => !o);
                setDeleteText("");
              }}
              data-testid="pv2-sec-delete-toggle"
              aria-expanded={deleteOpen}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0" }}>{SEC_DELETE_TITLE}</span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{SEC_DELETE_SUB}</span>
              </div>
              <span style={{ flex: "0 0 auto", fontSize: "11px", fontWeight: 600, color: "#64748b" }}>{deleteOpen ? "Close" : "Open"}</span>
            </button>
            {deleteOpen && (
              <div style={{ padding: "0 16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: "0 18px" }}>
                  {SEC_DELETE_FACTS.map((f) => (
                    <div key={f.k} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "9px 0", borderBottom: "1px solid rgba(30,41,59,.8)" }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}>{f.k}</span>
                      <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{f.v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 14, border: "1px solid rgba(248,113,113,.3)", borderRadius: 11, background: "rgba(248,113,113,.05)" }}>
                  <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".16em", textTransform: "uppercase", color: "#f87171" }}>{SEC_DELETE_CONFIRM_KICKER}</span>
                  <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
                    Type <span style={{ fontWeight: 700, fontFamily: MONO }}>{SEC_DELETE_PHRASE}</span> to enable the button. You will get a written confirmation listing what was deleted and what was retained, with the obligation named against each retained item.
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <input
                      value={deleteText}
                      onChange={(e) => setDeleteText(e.target.value)}
                      placeholder={SEC_DELETE_PHRASE}
                      data-testid="pv2-sec-delete-input"
                      aria-label="Type the confirmation phrase to enable deletion"
                      style={{ flex: "0 1 250px", padding: "8px 11px", borderRadius: 7, border: "1px solid rgba(30,41,59,.9)", background: "#0b1a2e", color: "#e2e8f0", fontSize: "12px", fontFamily: MONO }}
                    />
                    <button
                      type="button"
                      data-testid="pv2-sec-delete-submit"
                      disabled={!ready}
                      style={{
                        padding: "9px 16px",
                        borderRadius: 7,
                        fontSize: "12.5px",
                        fontWeight: 700,
                        cursor: ready ? "pointer" : "default",
                        fontFamily: "inherit",
                        border: `1px solid ${ready ? "#f87171" : "rgba(30,41,59,.9)"}`,
                        background: ready ? "rgba(248,113,113,.14)" : "transparent",
                        color: ready ? "#f87171" : "#475569",
                      }}
                    >
                      {SEC_DELETE_SUBMIT}
                    </button>
                    <button
                      type="button"
                      style={{ padding: "9px 16px", borderRadius: 7, fontSize: "12.5px", fontWeight: 600, border: "1px solid rgba(0,120,212,.45)", background: "rgba(0,120,212,.12)", color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {SEC_DELETE_EXPORT_FIRST}
                    </button>
                  </div>
                  <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>{SEC_DELETE_WITHDRAW}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
