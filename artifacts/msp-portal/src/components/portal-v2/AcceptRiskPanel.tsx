/**
 * AcceptRiskPanel.tsx — the "accept this instead of fixing it" right drawer.
 *
 * Ported value-for-value from the prototype's `acceptRiskOpen` panel
 * (`Customer Portal Shell.dc.html` lines 6035-6074) and its state machine
 * (`openAcceptRisk` / `toggleAcceptConfirm` / `confirmAcceptRisk`, 6714-6725),
 * with the default strings from `renderVals` (17894-17909).
 *
 * ── Why this is a separate primitive from the fix panel ─────────────────────
 * Accepting a risk is the one action in the portal that does NOT raise a change
 * request, because nothing changes in the tenant — the prototype says so in its
 * own copy on the fix panel's "accept instead" route. So it gets its own drawer
 * at z-160/161 (the fix panel is 150/151), its own red confirm button, and no CR
 * step. What it does share with every other flow is that it cannot be a dead
 * end: the "Ask ShaneBot what I am taking on here" link is part of the panel,
 * not an afterthought.
 *
 * The confirm button is deliberately inert until the checkbox is ticked —
 * `cursor:not-allowed` and a washed-out red, rather than being hidden. The
 * customer should see what they are being asked to sign before they can sign it.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";

/** The payload `openAcceptRisk({...})` takes in the prototype. */
export interface AcceptRiskSpec {
  /** 'site' | 'link' in the prototype — the caller decides what the id means. */
  kind?: string;
  id?: number;
  /**
   * The register id of the risk being accepted (e.g. "RBD-2026-575"), when the
   * acceptance has a real one to write against. Added for the Risk Register's
   * live write path — the prototype's numeric `id` is a row ordinal from the
   * oversharing panels and is not addressable server-side.
   */
  riskId?: string;
  title: string;
  description: string;
  details: string;
  kicker?: string;
  descLabel?: string;
  detailsLabel?: string;
  confirmText?: string;
  btnLabel?: string;
}

const KICKER: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "#64748b",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#64748b",
};

function XIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function AcceptRiskPanel({
  spec,
  onClose,
  onConfirm,
  onAskShaneBot,
}: {
  spec: AcceptRiskSpec;
  onClose: () => void;
  /** Fired once, on confirm — the caller records the acceptance. */
  onConfirm: (spec: AcceptRiskSpec) => void;
  onAskShaneBot?: (topic: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);

  const confirmText =
    spec.confirmText ??
    "I confirm I understand this risk and accept it on behalf of the organization.";

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(2,6,23,.6)" }}
      />
      <div
        role="dialog"
        aria-label={spec.title}
        data-testid="pv2-accept-risk"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 161,
          width: "min(440px,92vw)",
          background: "#0b1524",
          borderLeft: "1px solid rgba(148,163,184,.25)",
          boxShadow: "-30px 0 60px rgba(2,6,23,.5)",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={KICKER}>{spec.kicker ?? "Accept Risk"}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ flex: "0 0 auto", background: "none", border: "none", padding: 2, cursor: "pointer" }}
            >
              <XIcon />
            </button>
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>
            {spec.title}
          </span>
        </div>

        {!saved && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={SECTION_LABEL}>{spec.descLabel ?? "Risk Description"}</span>
              <span style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: 1.6 }}>
                {spec.description}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "12px 14px",
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 8,
                background: "#0f1c30",
              }}
            >
              <span style={SECTION_LABEL}>Details</span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                {spec.details}
              </span>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={() => setConfirmed((c) => !c)}
                data-testid="pv2-accept-risk-confirm"
                style={{ marginTop: 2, flex: "0 0 auto" }}
              />
              <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.5 }}>
                {confirmText}
              </span>
            </label>
            <button
              onClick={() => {
                if (!confirmed) return;
                onConfirm(spec);
                setSaved(true);
              }}
              data-testid="pv2-accept-risk-submit"
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: 8,
                fontSize: "13px",
                fontWeight: 700,
                cursor: confirmed ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                border: confirmed ? "1px solid #f87171" : "1px solid rgba(248,113,113,.25)",
                background: confirmed ? "#f87171" : "rgba(248,113,113,.08)",
                color: confirmed ? "#fff" : "#7a4a4a",
              }}
            >
              {spec.btnLabel ?? "Accept Risk"}
            </button>
            <button
              onClick={() =>
                onAskShaneBot?.(
                  `Before I accept this: ${spec.title} — what am I actually taking on, and what would you do?`,
                )
              }
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                padding: 0,
                fontSize: "11.5px",
                color: "#22d3ee",
                cursor: "pointer",
                fontFamily: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(34,211,238,.4)",
                textUnderlineOffset: 3,
              }}
            >
              Ask ShaneBot what I am taking on here
            </button>
          </div>
        )}

        {saved && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: 30,
              textAlign: "center",
            }}
            data-testid="pv2-accept-risk-done"
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(52,211,153,.12)",
                border: "1px solid rgba(52,211,153,.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9" }}>Risk accepted</span>
            <span
              style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5, maxWidth: 280 }}
            >
              This item is now marked as an accepted risk and will show up filtered under "Accepted".
            </span>
            <button
              onClick={onClose}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                fontSize: "12.5px",
                fontWeight: 700,
                border: "1px solid rgba(30,41,59,.9)",
                background: "transparent",
                color: "#e2e8f0",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Host hook, mirroring `useFixPanel` / `useFormDrawer`. */
export function useAcceptRisk({
  onConfirm,
  onAskShaneBot,
}: {
  onConfirm: (spec: AcceptRiskSpec) => void;
  onAskShaneBot?: (topic: string) => void;
}) {
  const [spec, setSpec] = useState<AcceptRiskSpec | null>(null);

  const openAcceptRisk = useCallback((next: AcceptRiskSpec) => setSpec(next), []);
  const closeAcceptRisk = useCallback(() => setSpec(null), []);

  const element: ReactNode = useMemo(
    () =>
      spec ? (
        <AcceptRiskPanel
          spec={spec}
          onClose={closeAcceptRisk}
          onConfirm={onConfirm}
          onAskShaneBot={onAskShaneBot}
        />
      ) : null,
    [spec, closeAcceptRisk, onConfirm, onAskShaneBot],
  );

  return { openAcceptRisk, closeAcceptRisk, acceptRiskElement: element };
}
