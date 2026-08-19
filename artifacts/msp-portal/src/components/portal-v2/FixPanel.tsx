/**
 * FixPanel.tsx — the change-request gate.
 *
 * The handoff's first and most load-bearing system: "Nothing changes in the
 * tenant without a CR. Every fix, every accepted risk, every executed SOP, every
 * early-closed hold window routes through the fix panel → CR step → submit."
 * Every other system in the portal depends on this one existing, which is why it
 * is built before any more pillar content.
 *
 * State mirrors the prototype's own keys (`fixPanelOpen`, `fixPanelStep`,
 * `fixPanelKey`, `fixAgreeChecked`, `fixCrIntent`, `fixCrSubmitted`,
 * `fixCrConfirm`, `fixCrWindow`) rather than inventing a different machine.
 *
 * Every inline style value is copied verbatim from
 * `Customer Portal Shell.dc.html` lines 6078-6230. The README states those
 * values ARE the spec; house component defaults are deliberately NOT used where
 * the two disagree.
 *
 * ── Deliberately NOT wired to a backend ─────────────────────────────────────
 * `msp_change_requests` already models this (preChangeSnapshot, proposedPayload,
 * rollbackScriptSnippet, changeClass/riskLevel, a 6-value status) — but only
 * behind MSP-operator routes. A customer-scoped CR route does not exist yet, and
 * reusing the MSP one would leak cross-tenant data. So submit is a real UI flow
 * over a local state transition, and the CR reference it shows is the
 * prototype's own. Phase 4 of the build plan adds the customer-scoped route.
 */

import { useCallback, useState } from "react";

import {
  CR_DEFAULT_WINDOW,
  CR_WINDOWS,
  playbookFor,
  type FixPlaybook,
} from "./fixPanelLibrary";

export type FixStep = "choose" | "cr" | "graph" | "manual";
export type FixIntent = "graph" | "manual" | "shane";

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 150,
  background: "rgba(2,6,23,.6)",
};

function panelStyle(pillarColor: string): React.CSSProperties {
  return {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 151,
    width: "min(440px,92vw)",
    background: "#0b1524",
    borderLeft: `1px solid ${pillarColor}55`,
    boxShadow: `-30px 0 60px ${pillarColor}22, -20px 0 50px rgba(2,6,23,.5)`,
    display: "flex",
    flexDirection: "column",
  };
}

const EYEBROW: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "#64748b",
};

const ROUTE_TITLE = (color: string): React.CSSProperties => ({
  fontSize: "13px",
  fontWeight: 700,
  color,
});

const ROUTE_SUB: React.CSSProperties = { fontSize: "11.5px", color: "#94a3b8" };

const LINK_BTN = (color: string, underline: string): React.CSSProperties => ({
  background: "none",
  border: "none",
  padding: 0,
  textAlign: "left",
  fontSize: "11.5px",
  color,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "underline",
  textDecorationColor: underline,
  textUnderlineOffset: "3px",
});

const CR_FIELD_LABEL: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#64748b",
};

const CR_FIELD_VALUE: React.CSSProperties = {
  fontSize: "11.5px",
  color: "#e2e8f0",
  lineHeight: 1.45,
};

const PRIMARY_BTN: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  fontSize: "12.5px",
  fontWeight: 700,
  border: "1px solid #0078D4",
  background: "#0078D4",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
};

function checkBoxStyle(checked: boolean, color: string): React.CSSProperties {
  return {
    flex: "0 0 18px",
    width: 18,
    height: 18,
    borderRadius: 4,
    border: `1px solid ${checked ? color : "rgba(148,163,184,.35)"}`,
    background: checked ? `${color}26` : "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color,
    fontSize: "11px",
    lineHeight: 1,
  };
}

export interface FixPanelProps {
  fixKey: string;
  onClose: () => void;
  /** "Accept it as a risk instead" — routes to the accept-risk flow. */
  onAcceptRisk?: (playbook: FixPlaybook) => void;
  /** "Ask ShaneBot to explain this finding" — Phase 7a wires this for real. */
  onAskShaneBot?: (playbook: FixPlaybook) => void;
}

export function FixPanel({ fixKey, onClose, onAcceptRisk, onAskShaneBot }: FixPanelProps) {
  const data = playbookFor(fixKey);

  const [step, setStep] = useState<FixStep>("choose");
  const [intent, setIntent] = useState<FixIntent | null>(null);
  const [crConfirm, setCrConfirm] = useState(false);
  const [crSubmitted, setCrSubmitted] = useState(false);
  const [crWindow, setCrWindow] = useState(CR_DEFAULT_WINDOW);
  const [agreeChecked, setAgreeChecked] = useState(false);

  // `goFixCr(intent)` in the prototype — every route that changes the tenant
  // lands on the CR step first. Only "manual" and "graph" reach it; "shane"
  // opens a ticket and is also gated, per the panel's own footnote.
  const goCr = useCallback((next: FixIntent) => {
    setIntent(next);
    setStep("cr");
    setCrSubmitted(false);
    setCrConfirm(false);
  }, []);

  const submitCr = useCallback(() => {
    if (!crConfirm) return;
    setCrSubmitted(true);
  }, [crConfirm]);

  const proceedFromCr = useCallback(() => {
    setStep(intent === "manual" ? "manual" : "graph");
  }, [intent]);

  const intentLabel =
    intent === "graph"
      ? "Microsoft Graph, automated by the portal"
      : intent === "manual"
        ? "You, following the runbook by hand"
        : "Shane McCaw Consulting, under your retainer";

  const isEmergency = crWindow === "Emergency change";

  return (
    <>
      <div style={OVERLAY} onClick={onClose} data-testid="pv2-fix-overlay" />
      <div
        style={panelStyle(data.pillarColor)}
        role="dialog"
        aria-label={data.title}
        data-testid="pv2-fix-panel"
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "18px 20px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: `linear-gradient(160deg, ${data.pillarColor}18, rgba(15,23,42,.4))`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -40,
              top: -60,
              width: 240,
              height: 240,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${data.pillarColor}30, rgba(2,6,23,0) 70%)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span style={EYEBROW}>Fix this finding</span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                flex: "0 0 auto",
                background: "none",
                border: "none",
                padding: 2,
                cursor: "pointer",
                color: "#94a3b8",
                fontSize: "14px",
                lineHeight: 1,
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>
          <span
            style={{
              position: "relative",
              fontSize: "15px",
              fontWeight: 700,
              color: "#f1f5f9",
              lineHeight: 1.4,
            }}
            data-testid="pv2-fix-title"
          >
            {data.title}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {/* ── Step: choose ──────────────────────────────────────────── */}
          {step === "choose" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                {data.description}
              </span>
              <span
                style={{
                  fontSize: "12.5px",
                  color: "#cbd5e1",
                  lineHeight: 1.5,
                  fontWeight: 600,
                }}
              >
                How would you like to handle this?
              </span>

              {data.canAutomate && (
                <button
                  onClick={() => goCr("graph")}
                  data-testid="pv2-fix-route-graph"
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    textAlign: "left",
                    padding: "15px 16px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,120,212,.4)",
                    background: "linear-gradient(160deg, rgba(0,120,212,.1), rgba(15,23,42,.3))",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      flex: "0 0 34px",
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      border: "1px solid rgba(0,120,212,.4)",
                      background: "rgba(0,120,212,.12)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <WrenchGlyph color="#60a5fa" />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={ROUTE_TITLE("#60a5fa")}>Automate via Microsoft Graph</span>
                    <span style={ROUTE_SUB}>
                      We&rsquo;ll walk through the risk and reward before anything runs.
                    </span>
                  </span>
                </button>
              )}

              <button
                onClick={() => goCr("shane")}
                data-testid="pv2-fix-route-shane"
                style={{
                  position: "relative",
                  overflow: "hidden",
                  textAlign: "left",
                  padding: "15px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(139,92,246,.4)",
                  background: "linear-gradient(160deg, rgba(139,92,246,.1), rgba(15,23,42,.3))",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    flex: "0 0 34px",
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid rgba(139,92,246,.4)",
                    background: "rgba(139,92,246,.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <SendGlyph color="#c4b5fd" />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={ROUTE_TITLE("#c4b5fd")}>Ask Shane to fix it</span>
                  <span style={ROUTE_SUB}>Opens a ticket with Shane McCaw Consulting.</span>
                </span>
              </button>

              <button
                onClick={() => goCr("manual")}
                data-testid="pv2-fix-route-manual"
                style={{
                  textAlign: "left",
                  padding: "15px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(30,41,59,.9)",
                  background: "rgba(255,255,255,.02)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    flex: "0 0 34px",
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,.25)",
                    background: "rgba(148,163,184,.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CheckGlyph color="#e2e8f0" />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={ROUTE_TITLE("#e2e8f0")}>I&rsquo;ll do it manually</span>
                  <span style={ROUTE_SUB}>Exact steps, checked off as you go.</span>
                </span>
              </button>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  paddingTop: 9,
                  borderTop: "1px solid rgba(30,41,59,.85)",
                }}
              >
                <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
                  Any of the first two routes raises a change request first. Nothing runs
                  without one.
                </span>
                <button
                  onClick={() => onAskShaneBot?.(data)}
                  style={LINK_BTN("#22d3ee", "rgba(34,211,238,.4)")}
                >
                  Not sure yet — ask ShaneBot to explain this finding
                </button>
                <button
                  onClick={() => onAcceptRisk?.(data)}
                  data-testid="pv2-fix-accept-risk"
                  style={LINK_BTN("#a78bfa", "rgba(167,139,250,.4)")}
                >
                  Accept it as a risk instead
                </button>
              </div>
            </div>
          )}

          {/* ── Step: change request ──────────────────────────────────── */}
          {step === "cr" && !crSubmitted && (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  padding: "11px 13px",
                  border: "1px solid rgba(96,165,250,.3)",
                  borderLeft: "2px solid #60a5fa",
                  borderRadius: 9,
                  background: "rgba(96,165,250,.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#60a5fa",
                  }}
                >
                  Change request required
                </span>
                <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55 }}>
                  Nothing changes in your tenant without a change request behind it. This one
                  is raised for you from the finding — you are approving it, not writing it.
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  padding: "12px 13px",
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 9,
                  background: "rgba(15,23,42,.5)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "88px minmax(0,1fr)",
                    gap: "8px 10px",
                    alignItems: "baseline",
                  }}
                >
                  <span style={CR_FIELD_LABEL}>Change</span>
                  <span style={CR_FIELD_VALUE}>{data.title}</span>
                  <span style={CR_FIELD_LABEL}>Executed by</span>
                  <span style={CR_FIELD_VALUE}>{intentLabel}</span>
                  <span style={CR_FIELD_LABEL}>Class</span>
                  <span style={CR_FIELD_VALUE}>
                    Normal · two approvals, booked into a window
                  </span>
                  <span style={CR_FIELD_LABEL}>Runbook</span>
                  <span style={CR_FIELD_VALUE}>{data.sopRef}</span>
                  <span style={CR_FIELD_LABEL}>Snapshot</span>
                  <span style={CR_FIELD_VALUE}>
                    Pre-change state captured at execution and held 90 days for rollback
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "#64748b",
                  }}
                >
                  Window
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CR_WINDOWS.map((w) => {
                    const on = crWindow === w.label;
                    return (
                      <button
                        key={w.id}
                        onClick={() => setCrWindow(w.label)}
                        data-testid={`pv2-cr-window-${w.id}`}
                        style={{
                          padding: "7px 11px",
                          borderRadius: 7,
                          fontSize: "11.5px",
                          fontWeight: on ? 700 : 600,
                          border: `1px solid ${on ? "rgba(0,120,212,.55)" : "rgba(30,41,59,.9)"}`,
                          background: on ? "rgba(0,120,212,.14)" : "rgba(255,255,255,.02)",
                          color: on ? "#60a5fa" : "#94a3b8",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
                {isEmergency && (
                  <span style={{ fontSize: "11px", color: "#fb923c", lineHeight: 1.5 }}>
                    An emergency change runs outside a window and is approved retrospectively
                    within 24 hours. It is recorded as Emergency on the register, which is a
                    flag your auditor will read.
                  </span>
                )}
              </div>

              <div
                onClick={() => setCrConfirm((v) => !v)}
                data-testid="pv2-cr-confirm"
                style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
              >
                <span style={checkBoxStyle(crConfirm, "#22d3ee")}>{crConfirm ? "✓" : ""}</span>
                <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
                  Raise this as a change request in my name, with the runbook attached and a
                  snapshot taken before anything runs.
                </span>
              </div>

              <button
                onClick={submitCr}
                disabled={!crConfirm}
                data-testid="pv2-cr-submit"
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  fontSize: "12.5px",
                  fontWeight: 700,
                  border: `1px solid ${crConfirm ? "#0078D4" : "rgba(30,41,59,.9)"}`,
                  background: crConfirm ? "#0078D4" : "rgba(255,255,255,.02)",
                  color: crConfirm ? "#fff" : "#475569",
                  cursor: crConfirm ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                }}
              >
                Submit change request
              </button>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  paddingTop: 9,
                  borderTop: "1px solid rgba(30,41,59,.85)",
                }}
              >
                <button
                  onClick={() => onAskShaneBot?.(data)}
                  style={LINK_BTN("#22d3ee", "rgba(34,211,238,.4)")}
                >
                  Ask ShaneBot to explain this before I approve it
                </button>
                <button
                  onClick={() => onAcceptRisk?.(data)}
                  style={LINK_BTN("#a78bfa", "rgba(167,139,250,.4)")}
                >
                  Accept this as a risk instead — no change, on the register
                </button>
                <button
                  onClick={() => setStep("choose")}
                  data-testid="pv2-cr-back"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "11.5px",
                    color: "#64748b",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* ── Step: change request submitted ────────────────────────── */}
          {step === "cr" && crSubmitted && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 13 }}
              data-testid="pv2-cr-submitted"
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  padding: "12px 13px",
                  border: "1px solid rgba(52,211,153,.32)",
                  borderLeft: "2px solid #34d399",
                  borderRadius: 9,
                  background: "rgba(52,211,153,.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: 700,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "#34d399",
                  }}
                >
                  CR-2026-0186 · approved for this window
                </span>
                <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.55 }}>
                  Both approvals are in: yours as IT lead, and Shane McCaw Consulting as second
                  admin under your retainer. It is on the register, in the maintenance schedule,
                  and the snapshot is armed.
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "88px minmax(0,1fr)",
                  gap: "7px 10px",
                  alignItems: "baseline",
                  padding: "11px 13px",
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 9,
                  background: "rgba(15,23,42,.5)",
                }}
              >
                <span style={CR_FIELD_LABEL}>Window</span>
                <span style={CR_FIELD_VALUE}>{crWindow}</span>
                <span style={CR_FIELD_LABEL}>Rollback</span>
                <span style={CR_FIELD_VALUE}>
                  One click from the vault for 90 days after execution
                </span>
              </div>

              <button onClick={proceedFromCr} style={PRIMARY_BTN} data-testid="pv2-cr-continue">
                Continue to the change
              </button>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  fontSize: "11.5px",
                  color: "#64748b",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Leave it scheduled — run it in the window
              </button>
            </div>
          )}

          {/* ── Step: graph (risk / reward / confirm) ─────────────────── */}
          {step === "graph" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
              data-testid="pv2-fix-graph"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 11px",
                  border: "1px solid rgba(52,211,153,.28)",
                  borderRadius: 8,
                  background: "rgba(52,211,153,.05)",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#34d399",
                    flex: "0 0 5px",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.45 }}>
                  Running under CR-2026-0186 · snapshot armed
                </span>
              </div>

              <div
                style={{
                  padding: "13px 14px",
                  border: "1px solid rgba(248,113,113,.3)",
                  borderRadius: 10,
                  background: "rgba(248,113,113,.06)",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "#f87171",
                  }}
                >
                  Risk
                </span>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "#e2e8f0",
                    lineHeight: 1.5,
                    marginTop: 4,
                  }}
                >
                  {data.riskText}
                </div>
              </div>

              <div
                style={{
                  padding: "13px 14px",
                  border: "1px solid rgba(52,211,153,.3)",
                  borderRadius: 10,
                  background: "rgba(52,211,153,.06)",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "#34d399",
                  }}
                >
                  Reward
                </span>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "#e2e8f0",
                    lineHeight: 1.5,
                    marginTop: 4,
                  }}
                >
                  {data.rewardText}
                </div>
              </div>

              <div
                onClick={() => setAgreeChecked((v) => !v)}
                data-testid="pv2-fix-agree"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  cursor: "pointer",
                  paddingTop: 2,
                }}
              >
                <span style={checkBoxStyle(agreeChecked, "#22d3ee")}>
                  {agreeChecked ? "✓" : ""}
                </span>
                <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
                  I understand the risk and reward above and want to proceed.
                </span>
              </div>

              <button
                disabled={!agreeChecked}
                data-testid="pv2-fix-run"
                style={{
                  ...PRIMARY_BTN,
                  border: `1px solid ${agreeChecked ? "#0078D4" : "rgba(30,41,59,.9)"}`,
                  background: agreeChecked ? "#0078D4" : "rgba(255,255,255,.02)",
                  color: agreeChecked ? "#fff" : "#475569",
                  cursor: agreeChecked ? "pointer" : "not-allowed",
                }}
              >
                Confirm &amp; Run
              </button>

              <StepList
                heading="What will run"
                steps={data.graphSteps}
                color="#34d399"
              />

              <button
                onClick={() => setStep("choose")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "11.5px",
                  color: "#64748b",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ← Back
              </button>
            </div>
          )}

          {/* ── Step: manual runbook ──────────────────────────────────── */}
          {step === "manual" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
              data-testid="pv2-fix-manual"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 11px",
                  border: "1px solid rgba(52,211,153,.28)",
                  borderRadius: 8,
                  background: "rgba(52,211,153,.05)",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#34d399",
                    flex: "0 0 5px",
                  }}
                />
                <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.45 }}>
                  Running under CR-2026-0186 · snapshot armed
                </span>
              </div>

              <ManualSteps steps={data.manualSteps} />

              <button
                onClick={() => setStep("choose")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "11.5px",
                  color: "#64748b",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Sub-pieces ───────────────────────────────────────────────────────────── */

function StepList({
  heading,
  steps,
  color,
}: {
  heading: string;
  steps: readonly string[];
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "#64748b",
        }}
      >
        {heading}
      </span>
      {steps.map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={checkBoxStyle(false, color)} />
          <span style={{ fontSize: "12.5px", color: "#64748b", lineHeight: 1.5 }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function ManualSteps({ steps }: { steps: readonly { text: string; link?: string }[] }) {
  const [checked, setChecked] = useState<number[]>([]);
  const toggle = (i: number) =>
    setChecked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const on = checked.includes(i);
        return (
          <div
            key={s.text}
            onClick={() => toggle(i)}
            data-testid={`pv2-manual-step-${i}`}
            style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
          >
            {/* boxCss transcribed from the prototype's manualStepRows builder */}
            <span
              style={{
                flex: "0 0 20px",
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${on ? "#22d3ee" : "rgba(148,163,184,.35)"}`,
                background: on ? "rgba(34,211,238,.15)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#22d3ee",
                fontSize: "12px",
                lineHeight: 1,
              }}
            >
              {on ? "✓" : ""}
            </span>
            <span
              style={{
                fontSize: "13px",
                color: on ? "#64748b" : "#e2e8f0",
                lineHeight: 1.6,
                textDecoration: on ? "line-through" : "none",
              }}
            >
              {s.text}
              {s.link && (
                <>
                  {" "}
                  <a
                    href={s.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "#60a5fa" }}
                  >
                    Open
                  </a>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Single-path glyphs, sized for the 34px route tiles. */
function WrenchGlyph({ color }: { color: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function SendGlyph({ color }: { color: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* ── Host hook ────────────────────────────────────────────────────────────── */

export function useFixPanel() {
  const [fixKey, setFixKey] = useState<string | null>(null);
  const openFixPanel = useCallback((key: string) => setFixKey(key), []);
  const closeFixPanel = useCallback(() => setFixKey(null), []);
  return { fixKey, openFixPanel, closeFixPanel };
}
