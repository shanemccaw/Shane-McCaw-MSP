/**
 * RotateSecretPanel.tsx — the confirm-then-reveal drawer behind the Webhooks
 * page's "Rotate" button (Git #1605).
 *
 * Styled after `AcceptRiskPanel.tsx` (same right-drawer/overlay primitive,
 * same z-160/161 layer, same confirm-then-done shape) rather than the generic
 * `FormDrawer`, because a rotation's success view has to show data that only
 * exists after the real API call returns — the new plaintext secret
 * (`POST .../rotate-secret` returns it exactly once,
 * `docs/webhooks-contract-pack.md` §6). `FormDrawer`'s `doneNote` is static
 * spec text decided before submit, so it cannot render a value the server
 * hasn't produced yet; this panel therefore waits for the real response
 * before switching views, instead of `FormDrawer`/`AcceptRiskPanel`'s
 * fire-and-flip-to-done pattern.
 *
 * The consequence is stated before the button, not after, per the issue's
 * own instruction and the contract pack's §2 finding: there is no grace
 * period — the old secret is destructively overwritten the moment this
 * succeeds, with no overlap window where both validate.
 */

import { useState } from "react";

const KICKER: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "#64748b",
};

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function XIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export interface RotateSecretSpec {
  webhookId: string;
  webhookName: string;
}

export function RotateSecretPanel({
  spec,
  onClose,
  onConfirm,
}: {
  spec: RotateSecretSpec;
  onClose: () => void;
  /** Performs the real POST and returns its real, typed result. */
  onConfirm: (webhookId: string) => Promise<{ ok: true; secret: string; secretPrefix: string } | { ok: false; error: string }>;
}) {
  const [phase, setPhase] = useState<"confirm" | "rotating" | "done" | "error">("confirm");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleConfirm() {
    setPhase("rotating");
    const result = await onConfirm(spec.webhookId);
    if (result.ok) {
      setSecret(result.secret);
      setPhase("done");
    } else {
      setError(result.error);
      setPhase("error");
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <>
      <div onClick={phase === "rotating" ? undefined : onClose} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(2,6,23,.6)" }} />
      <div
        role="dialog"
        aria-label={`Rotate signing secret for ${spec.webhookName}`}
        data-testid="pv2-wh-rotate-panel"
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
        <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(30,41,59,.9)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={KICKER}>Rotate signing secret</span>
            {phase !== "rotating" && (
              <button onClick={onClose} aria-label="Close" style={{ flex: "0 0 auto", background: "none", border: "none", padding: 2, cursor: "pointer" }}>
                <XIcon />
              </button>
            )}
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>{spec.webhookName}</span>
        </div>

        {(phase === "confirm" || phase === "rotating") && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                border: "1px solid rgba(194,166,61,.35)",
                borderLeft: "2px solid #c2a63d",
                borderRadius: 9,
                background: "rgba(194,166,61,.06)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#c2a63d" }}>
                No grace period
              </span>
              <span style={{ fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.6 }}>
                The moment this completes, the current secret stops validating — there is no
                overlap window where both the old and new secret work. Update the receiving
                system with the new secret before any further deliveries need to verify.
              </span>
            </div>
            <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6 }}>
              A new secret will be generated and shown once, here, immediately after you
              confirm. It cannot be retrieved again after this panel closes — only its prefix
              remains visible on the endpoint from then on.
            </span>
            <button
              onClick={() => void handleConfirm()}
              disabled={phase === "rotating"}
              data-testid="pv2-wh-rotate-confirm"
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: 8,
                fontSize: "13px",
                fontWeight: 700,
                cursor: phase === "rotating" ? "wait" : "pointer",
                fontFamily: "inherit",
                border: "1px solid #c2a63d",
                background: "#c2a63d",
                color: "#1a1406",
                opacity: phase === "rotating" ? 0.7 : 1,
              }}
            >
              {phase === "rotating" ? "Rotating…" : "Rotate secret now"}
            </button>
          </div>
        )}

        {phase === "done" && secret && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 14 }} data-testid="pv2-wh-rotate-done">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 9, border: "1px solid rgba(52,211,153,.4)", background: "rgba(52,211,153,.08)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#34d399" }}>Secret rotated</span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55 }}>
                Copy it now — this is the only time it will be shown.
              </span>
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: "1px solid rgba(30,41,59,.9)",
                background: "#0b1a2e",
                fontFamily: MONO,
                fontSize: "12px",
                color: "#e2e8f0",
                wordBreak: "break-all",
              }}
              data-testid="pv2-wh-rotate-secret"
            >
              {secret}
            </div>
            <button
              onClick={() => void copySecret()}
              style={{
                padding: "9px 15px",
                borderRadius: 7,
                fontSize: "12.5px",
                fontWeight: 700,
                border: "1px solid #0078D4",
                background: "#0078D4",
                color: "#fff",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {copied ? "Copied" : "Copy to clipboard"}
            </button>
            <button
              onClick={onClose}
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12.5px", fontWeight: 600, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
            >
              Done
            </button>
          </div>
        )}

        {phase === "error" && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 14 }} data-testid="pv2-wh-rotate-error">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 9, border: "1px solid rgba(248,113,113,.4)", background: "rgba(248,113,113,.08)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f87171" }}>Rotation failed</span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55 }}>{error}</span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>
                The current secret was not changed — nothing was lost.
              </span>
            </div>
            <button
              onClick={() => setPhase("confirm")}
              data-testid="pv2-wh-rotate-retry"
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12.5px", fontWeight: 700, border: "1px solid #0078D4", background: "#0078D4", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}
            >
              Try again
            </button>
            <button
              onClick={onClose}
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12.5px", fontWeight: 600, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </>
  );
}
