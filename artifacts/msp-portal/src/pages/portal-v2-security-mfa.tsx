/**
 * portal-v2-security-mfa.tsx — the MFA drill-down.
 *
 * A direct port of the prototype's `isMfaPage` section
 * (`Customer Portal Shell.dc.html` 4816-4972). The page shows one of four tenant
 * states — unconfigured (a 6-step setup wizard), partial (enrollment status),
 * gaps (the accounts still missing MFA), healthy — plus the always-on "MFA
 * controls we check" panel, whose wrench opens the CR gate on `mfa-<key>`.
 *
 * The four states are switchable through the preview strip, exactly as the
 * prototype ships them (`mfaPreviewOptions` / `setMfaPreview`); the default is
 * `gaps`, the prototype's own fallback for this tenant.
 *
 * Every inline style value is the prototype's. Copy is verbatim.
 */

import { useState } from "react";
import { Link } from "wouter";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import { FixPanel, useFixPanel } from "@/components/portal-v2/FixPanel";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { useAcceptRisk } from "@/components/portal-v2/AcceptRiskPanel";
import {
  MFA_DEFAULT_STATE,
  MFA_GAP_USERS,
  MFA_MONO,
  MFA_PREVIEW_OPTIONS,
  MFA_WIZARD_STEPS,
  type MfaState,
} from "@/components/portal-v2/secMfaData";
import { isAdminGapUser, mfaControlRows, mfaGapUserRowsLive, mfaPartialUserRows, mfaPartialUserRowsLive, mfaStatePill, mfaUnregisteredCount, mfaWizardStepFlags } from "@/components/portal-v2/secMfaModel";
import { useLivePillarHero } from "@/components/portal-v2/useLivePillarHero";
import { useMfaRegistrationLive } from "@/components/portal-v2/useMfaRegistrationLive";
import { PillarLiveSource } from "@/components/portal-v2/PillarLiveSource";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";

function WrenchIcon({ color = "#60a5fa", size = 13 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function statePillStyle(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    width: "fit-content",
    padding: "4px 10px",
    border: `1px solid ${color}40`,
    borderRadius: 5,
    background: `${color}14`,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color,
  };
}

const PRIMARY_BLUE: React.CSSProperties = {
  border: "1px solid var(--brand-blue,#0078D4)",
  background: "var(--brand-blue,#0078D4)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};

const NUMBER_INPUT: React.CSSProperties = {
  width: 64,
  padding: "6px 8px",
  borderRadius: 5,
  border: "1px solid rgba(30,41,59,.9)",
  background: "#0b1a2e",
  color: "#e2e8f0",
  fontFamily: MFA_MONO,
  fontSize: "12px",
};

const SECTION_HEADER_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: "#64748b",
};

export default function PortalV2SecurityMfaPage() {
  const { fixKey, openFixPanel, closeFixPanel } = useFixPanel();
  const { openForm, formElement } = useFormDrawer();

  const [state, setState] = useState<MfaState>(MFA_DEFAULT_STATE);
  const [wizardStep, setWizardStep] = useState(0);
  const [graceDays, setGraceDays] = useState("7");
  const [deadlineDays, setDeadlineDays] = useState("14");
  const [legacyRemoved, setLegacyRemoved] = useState(false);
  const [enforced, setEnforced] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);

  const askShaneBot = (topic: string) =>
    openForm({
      kicker: "Ask ShaneBot",
      title: "Ask about this finding",
      intro: topic,
      submitLabel: "Send to ShaneBot",
      fields: [{ id: "question", label: "Your question", kind: "textarea", wide: true, placeholder: "What would you like to know about this?" }],
      doneTitle: "Sent",
      doneNote: "ShaneBot has the finding and your tenant context. The reply appears in your chat panel.",
    });

  const { openAcceptRisk, acceptRiskElement } = useAcceptRisk({ onConfirm: () => {}, onAskShaneBot: askShaneBot });

  const wizardNext = () => setWizardStep((s) => Math.min(MFA_WIZARD_STEPS.length - 1, s + 1));
  const flags = mfaWizardStepFlags(wizardStep);
  const controls = mfaControlRows();

  // Reads the security pillar's live war-room-pillars payload through the shared
  // `useLivePillarHero` seam; `pv2-mfa-source` proves the page is on real data.
  const live = useLivePillarHero("security");

  // The "gaps"/"partial" state's per-user rows: real `identity:mfa-registration`
  // item rows, read via `useMfaRegistrationLive` (#1234) — the same
  // tenant-check-items seam `useCaBaselineLive` (#1232) reads for the CA page.
  // Falls back to the design fixture only until the first response lands or
  // when the tenant genuinely has no collected rows. The "MFA controls we
  // check" panel below stays fixture: those are authentication-methods-policy,
  // registration-campaign and break-glass facts no current check collects at
  // item level — a documented backend gap, not a fabricated status.
  const mfaLive = useMfaRegistrationLive();
  const rowsAreLive = mfaLive.loaded && mfaLive.users !== null;
  const gapUsers = rowsAreLive ? mfaGapUserRowsLive(mfaLive.users!) : MFA_GAP_USERS;
  const partialUsers = rowsAreLive ? mfaPartialUserRowsLive(mfaLive.users!) : mfaPartialUserRows();

  // Hero/banner counts (Git #1431) — derived from the same gapUsers/partialUsers
  // the row lists already render, live or fixture, instead of the literal
  // "8"/"2"/"5" strings the prototype's copy hardcoded. A real tenant with a
  // different gap/partial count now gets a headline that matches its rows.
  const gapAdminCount = gapUsers.filter(isAdminGapUser).length;
  const partialUnregisteredCount = mfaUnregisteredCount(partialUsers);

  return (
    <PortalV2Shell eyebrow="Security" title="Multi-factor authentication">
      <div
        data-testid="pv2-mfa-page"
        style={{
          position: "relative",
          maxWidth: 1000,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Link
            href="/portal-v2/security"
            data-testid="pv2-mfa-back"
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontFamily: "inherit" }}
          >
            ← Security
          </Link>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="pv2-mfa-preview">
            {MFA_PREVIEW_OPTIONS.map((o) => {
              const on = state === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => setState(o.key)}
                  data-testid={`pv2-mfa-preview-${o.key}`}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 5,
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    border: `1px solid ${on ? "rgba(139,92,246,.4)" : "rgba(30,41,59,.9)"}`,
                    background: on ? "rgba(139,92,246,.1)" : "transparent",
                    color: on ? "#a78bfa" : "#94a3b8",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Unconfigured: the setup wizard ─────────────────────────────── */}
        {state === "unconfigured" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={statePillStyle(mfaStatePill("unconfigured").color)}>{mfaStatePill("unconfigured").label}</span>
              <span style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }} data-testid="pv2-mfa-heading">
                MFA isn't configured for this tenant yet.
              </span>
              <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
                No accounts have a multi-factor requirement. This is the single highest-leverage fix available — let's set
                it up correctly.
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 14,
                background: "linear-gradient(180deg, rgba(139,92,246,.05), rgba(15,23,42,.4))",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <span style={SECTION_HEADER_LABEL}>Setup wizard · step {wizardStep + 1} of 6</span>
                <button style={{ padding: "6px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700, border: "1px solid rgba(139,92,246,.4)", background: "rgba(139,92,246,.1)", color: "#a78bfa", cursor: "pointer", fontFamily: "inherit" }}>
                  We'll do it for you — talk to us
                </button>
              </div>
              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                {MFA_WIZARD_STEPS.map((ws, i) => (
                  <div key={ws.title} style={{ display: "flex", gap: 12 }}>
                    <span style={{ flex: "0 0 22px", height: 22, borderRadius: 5, background: "rgba(148,163,184,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#94a3b8", fontFamily: MFA_MONO }}>
                      {i + 1}
                    </span>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9" }}>{ws.title}</span>
                      <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>{ws.desc}</span>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 6, paddingTop: 14, borderTop: "1px solid rgba(30,41,59,.9)", display: "flex", flexDirection: "column", gap: 12 }}>
                  {flags.isGraph && (
                    <button onClick={wizardNext} style={{ ...PRIMARY_BLUE, alignSelf: "flex-start", padding: "8px 14px", borderRadius: 6, fontSize: "12px", fontWeight: 700 }}>
                      Configure via Graph API →
                    </button>
                  )}
                  {flags.isGrace && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", color: "#cbd5e1" }}>Grace period:</span>
                      <input type="number" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} style={NUMBER_INPUT} aria-label="Grace period in days" />
                      <span style={{ fontSize: "12px", color: "#cbd5e1" }}>days before prompts start</span>
                      <button onClick={wizardNext} style={{ ...PRIMARY_BLUE, padding: "7px 13px", borderRadius: 6, fontSize: "11.5px", fontWeight: 700 }}>Continue →</button>
                    </div>
                  )}
                  {flags.isDeadline && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", color: "#cbd5e1" }}>Enforcement deadline:</span>
                      <input type="number" value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} style={NUMBER_INPUT} aria-label="Enforcement deadline in days" />
                      <span style={{ fontSize: "12px", color: "#cbd5e1" }}>days from today</span>
                      <button onClick={wizardNext} style={{ ...PRIMARY_BLUE, padding: "7px 13px", borderRadius: 6, fontSize: "11.5px", fontWeight: 700 }}>Continue →</button>
                    </div>
                  )}
                  {flags.isLegacy && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div onClick={() => setLegacyRemoved((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
                        <span
                          style={{
                            flex: "0 0 18px",
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: `1px solid ${legacyRemoved ? "#22d3ee" : "rgba(148,163,184,.35)"}`,
                            background: legacyRemoved ? "rgba(34,211,238,.15)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#22d3ee",
                            fontSize: "11px",
                            lineHeight: 1,
                          }}
                        >
                          {legacyRemoved ? "✓" : ""}
                        </span>
                        <span style={{ fontSize: "12px", color: "#cbd5e1" }}>Confirm: remove password-only sign-in</span>
                      </div>
                      <button onClick={wizardNext} style={{ ...PRIMARY_BLUE, padding: "7px 13px", borderRadius: 6, fontSize: "11.5px", fontWeight: 700 }}>Continue →</button>
                    </div>
                  )}
                  {flags.isEnforce &&
                    (enforced ? (
                      <span style={statePillStyle("#34d399")}>MFA enforced tenant-wide</span>
                    ) : (
                      <button onClick={() => setEnforced(true)} style={{ alignSelf: "flex-start", padding: "9px 16px", borderRadius: 6, fontSize: "12.5px", fontWeight: 700, border: "1px solid #f87171", background: "#f87171", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                        Enforce MFA tenant-wide
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Partial: enrollment status ─────────────────────────────────── */}
        {state === "partial" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={statePillStyle(mfaStatePill("partial").color)}>{mfaStatePill("partial").label}</span>
              <span style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }} data-testid="pv2-mfa-heading">
                MFA is configured correctly — now let's get everyone enrolled.
              </span>
              <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
                We verified the policy itself is set up right. {partialUnregisteredCount} of {partialUsers.length} users still haven't registered a method.
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 14, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <span style={SECTION_HEADER_LABEL}>Enrollment status</span>
                {reminderSent ? (
                  <span style={{ fontSize: "11.5px", color: "#34d399", fontWeight: 600 }}>Reminder sent</span>
                ) : (
                  <button onClick={() => setReminderSent(true)} style={{ ...PRIMARY_BLUE, padding: "6px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700 }}>
                    Send enrollment reminder to {partialUnregisteredCount} users
                  </button>
                )}
              </div>
              {partialUsers.map((u) => (
                <div key={u.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderTop: "1px solid rgba(30,41,59,.8)" }}>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{u.name}</span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      color: u.badgeColor,
                      padding: "2px 7px",
                      border: `1px solid ${u.badgeColor}59`,
                      borderRadius: 4,
                    }}
                  >
                    {u.badgeLabel}
                  </span>
                </div>
              ))}
              <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(30,41,59,.9)" }}>
                <button style={{ padding: "8px 14px", borderRadius: 6, fontSize: "12px", fontWeight: 700, border: "1px solid #34d399", background: "rgba(52,211,153,.1)", color: "#34d399", cursor: "pointer", fontFamily: "inherit" }}>
                  Enforce once registration reaches 100%
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Gaps: accounts without MFA ─────────────────────────────────── */}
        {state === "gaps" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={statePillStyle(mfaStatePill("gaps").color)}>{mfaStatePill("gaps").label}</span>
              <span style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.3 }} data-testid="pv2-mfa-heading">
                MFA is enforced tenant-wide — {gapUsers.length} accounts still don't have it.
              </span>
              <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
                These accounts were likely created or reactivated after enforcement went live. {gapAdminCount} are admin accounts —
                treat those as the priority.
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 14, background: "rgba(15,23,42,.35)", overflow: "hidden" }} data-testid="pv2-mfa-gap-users">
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(30,41,59,.9)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <span style={SECTION_HEADER_LABEL}>{gapUsers.length} accounts without MFA</span>
                <button style={{ ...PRIMARY_BLUE, padding: "6px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700 }}>Enable MFA for all {gapUsers.length}</button>
              </div>
              {gapUsers.map((u) => (
                <div key={u} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderTop: "1px solid rgba(30,41,59,.8)" }}>
                  <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{u}</span>
                  <button style={{ padding: "5px 11px", borderRadius: 5, fontSize: "11px", fontWeight: 600, border: "1px solid rgba(30,41,59,.9)", background: "transparent", color: "#60a5fa", cursor: "pointer", fontFamily: "inherit" }}>
                    Enable
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Healthy ────────────────────────────────────────────────────── */}
        {state === "healthy" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 24, border: "1px solid rgba(52,211,153,.25)", borderRadius: 14, background: "rgba(52,211,153,.05)", alignItems: "flex-start" }}>
            <span style={statePillStyle(mfaStatePill("healthy").color)}>{mfaStatePill("healthy").label}</span>
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc" }} data-testid="pv2-mfa-heading">
              MFA is fully enforced across every account.
            </span>
            <span style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
              100% coverage, verified on your last scan. Nothing needs your attention here.
            </span>
          </div>
        )}

        {/* ── Always: MFA controls we check ──────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 14, background: "rgba(15,23,42,.35)", overflow: "hidden" }} data-testid="pv2-mfa-controls">
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(30,41,59,.9)", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={SECTION_HEADER_LABEL}>MFA controls we check</span>
            <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>
              Enforcement is only half of it. These are the surrounding controls, each one buildable through the Graph
              API.
            </span>
          </div>
          {controls.map((mc) => (
            <div key={mc.fixKey} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 18px", borderTop: "1px solid rgba(30,41,59,.8)" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>{mc.label}</span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: `1px solid ${mc.statusColor}55`,
                      background: `${mc.statusColor}14`,
                      fontSize: "9.5px",
                      fontWeight: 700,
                      letterSpacing: ".07em",
                      textTransform: "uppercase",
                      color: mc.statusColor,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mc.statusLabel}
                  </span>
                </div>
                <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.55 }}>{mc.detail}</span>
              </div>
              <button
                onClick={() => openFixPanel(mc.fixKey)}
                title="Build this via Microsoft Graph"
                data-testid={`pv2-mfa-fix-${mc.fixKey}`}
                style={{ flex: "0 0 30px", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 7, border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.12)", cursor: "pointer", fontFamily: "inherit" }}
              >
                <WrenchIcon />
              </button>
            </div>
          ))}
        </div>
      </div>

      {fixKey && (
        <FixPanel
          fixKey={fixKey}
          onClose={closeFixPanel}
          onAskShaneBot={(playbook) => askShaneBot(`Explain this finding to me before I approve the change: ${playbook.title}`)}
          onAcceptRisk={(playbook) => {
            closeFixPanel();
            openAcceptRisk({
              title: playbook.title,
              description: playbook.description,
              details:
                "Accepting instead of fixing suppresses this finding’s points in the pillar score and mutes its alerts, and puts it on the risk register with your name, a rationale and a review date. It stays visible as an accepted risk. No change request is raised because nothing changes in the tenant.",
              kicker: "Accept instead of fixing",
            });
          }}
        />
      )}
      {acceptRiskElement}
      {formElement}
      <PillarLiveSource testId="pv2-mfa-source" live={live} />
      <span data-testid="pv2-mfa-rows-source" style={PV2_SOURCE_CLIP}>
        {rowsAreLive ? "live" : "fixture"}
      </span>
    </PortalV2Shell>
  );
}
