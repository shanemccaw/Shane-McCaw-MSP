/**
 * RevealNoScanGate.tsx — #536. The Reveal's defensive backstop for a tenant
 * who has genuinely never been scanned and has nothing scan-related in
 * flight: no run active, no auto-trigger POST in flight, no scan on record.
 *
 * Scene 0's overlay/auto-trigger logic (#367, revealAutoScan.ts) already
 * covers the expected path — a real customer's scan fired at consent time,
 * so this page normally opens mid-run and the fixed, scroll-locked overlay
 * covers Scenes 1-9 until it lands. That logic assumes a scan is always
 * either running or about to start; this gate exists for when that
 * assumption is wrong (a stalled consent-time trigger, a data/timing edge
 * case, a bug elsewhere), so Scenes 1-9 — which read real pillar scores and
 * findings — never mount and render null/empty in their place. It is not a
 * second auto-trigger pathway: the retry action below re-runs the same
 * gating decision the page already makes, it never calls the trigger
 * endpoint itself.
 */

import { BRAND, INK, RADIUS } from "./journeyTokens.ts";

export function RevealNoScanGate({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: BRAND.canvas,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "5vh 5vw",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, textAlign: "center", alignItems: "center" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: "#fbbf24",
          }}
        >
          No scan yet
        </span>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", color: INK.headingDark }}>
          Your readiness scan hasn't started
        </span>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, lineHeight: 1.6, color: INK.bodyDark }}>
          {message ??
            "We don't have a scan on record for your tenant yet, so there's nothing genuine to show here. This usually clears up on its own shortly after access is granted."}
        </p>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 10,
            padding: "10px 22px",
            borderRadius: RADIUS.control,
            border: `1px solid ${BRAND.blue}`,
            background: BRAND.blue,
            color: BRAND.white,
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
