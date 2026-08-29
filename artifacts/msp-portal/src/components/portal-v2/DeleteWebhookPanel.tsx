/**
 * DeleteWebhookPanel.tsx — the confirm drawer behind the Webhooks page's
 * "Delete" button (Git #1605).
 *
 * Styled after `AcceptRiskPanel.tsx` (same overlay/drawer primitive), but
 * waits for the real `DELETE` response before showing success/failure —
 * unlike `AcceptRiskPanel`'s fire-and-flip-to-done pattern — because a delete
 * that silently failed server-side but told the customer it was gone would
 * misrepresent a destructive, unrecoverable action.
 *
 * The confirmation copy states the real, unrecoverable consequence extracted
 * from the route: `outbound_webhooks` has no soft-delete/archive column, and
 * `outbound_webhook_deliveries.webhook_id` is `ON DELETE CASCADE`
 * (`lib/db/src/schema/msp.ts:1027`, cited in `docs/webhooks-contract-pack.md`
 * §2) — deleting the endpoint destroys its entire delivery history with it.
 * That is said plainly rather than a bare "Are you sure?", per the issue.
 */

import { useState } from "react";

const KICKER: React.CSSProperties = {
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: ".18em",
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

export interface DeleteWebhookSpec {
  webhookId: string;
  webhookName: string;
  /** Shown in the confirmation so the customer sees what history is at stake. */
  volumeLabel: string;
}

export function DeleteWebhookPanel({
  spec,
  onClose,
  onConfirm,
  onDeleted,
}: {
  spec: DeleteWebhookSpec;
  onClose: () => void;
  /** Performs the real DELETE and returns its real, typed result. */
  onConfirm: (webhookId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Fired once the delete has actually succeeded, so the caller can refresh the list. */
  onDeleted: () => void;
}) {
  const [phase, setPhase] = useState<"confirm" | "deleting" | "error">("confirm");
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPhase("deleting");
    const result = await onConfirm(spec.webhookId);
    if (result.ok) {
      onDeleted();
      onClose();
    } else {
      setError(result.error);
      setPhase("error");
    }
  }

  return (
    <>
      <div onClick={phase === "deleting" ? undefined : onClose} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(2,6,23,.6)" }} />
      <div
        role="dialog"
        aria-label={`Delete ${spec.webhookName}`}
        data-testid="pv2-wh-delete-panel"
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
            <span style={KICKER}>Delete endpoint</span>
            {phase !== "deleting" && (
              <button onClick={onClose} aria-label="Close" style={{ flex: "0 0 auto", background: "none", border: "none", padding: 2, cursor: "pointer" }}>
                <XIcon />
              </button>
            )}
          </div>
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>{spec.webhookName}</span>
        </div>

        {(phase === "confirm" || phase === "deleting") && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                border: "1px solid rgba(248,113,113,.4)",
                borderLeft: "2px solid #f87171",
                borderRadius: 9,
                background: "rgba(248,113,113,.07)",
              }}
            >
              <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#f87171" }}>
                Permanent — cannot be undone
              </span>
              <span style={{ fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.6 }}>
                This endpoint has no archive or soft-delete state. Deleting it also permanently
                deletes its entire delivery history ({spec.volumeLabel}) — there is no way to
                recover either afterward.
              </span>
            </div>
            <button
              onClick={() => void handleConfirm()}
              disabled={phase === "deleting"}
              data-testid="pv2-wh-delete-confirm"
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: 8,
                fontSize: "13px",
                fontWeight: 700,
                cursor: phase === "deleting" ? "wait" : "pointer",
                fontFamily: "inherit",
                border: "1px solid #f87171",
                background: "#f87171",
                color: "#fff",
                opacity: phase === "deleting" ? 0.7 : 1,
              }}
            >
              {phase === "deleting" ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              onClick={onClose}
              disabled={phase === "deleting"}
              style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12.5px", fontWeight: 600, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}
            >
              Cancel
            </button>
          </div>
        )}

        {phase === "error" && (
          <div style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 14 }} data-testid="pv2-wh-delete-error">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", borderRadius: 9, border: "1px solid rgba(248,113,113,.4)", background: "rgba(248,113,113,.08)" }}>
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f87171" }}>Delete failed</span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55 }}>{error}</span>
              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5 }}>The endpoint was not deleted.</span>
            </div>
            <button
              onClick={() => setPhase("confirm")}
              data-testid="pv2-wh-delete-retry"
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
