import { Link } from "wouter";

/**
 * The Free Scan flow strip — Consent → Scan → Results → Review → Remediate.
 *
 * Lifted out of FreeScan.tsx (where it was `ConsentBreadcrumb`) in Git #1374 so
 * the Review step renders the SAME strip rather than a second copy that could
 * drift from it. The only thing that differs between the two screens is which
 * step is current, which is the `at` index.
 *
 * Markup, spacing and colours are unchanged from the original — this is a move,
 * not a redesign.
 */

export const FREE_SCAN_FLOW_STEPS = ["Consent", "Scan", "Results", "Review", "Remediate"] as const;

export function FreeScanFlowStrip({ at }: { at: number }) {
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(30,41,59,.9)",
        background: "rgba(2,6,23,.92)",
        padding: "12px 32px",
        display: "flex",
        alignItems: "center",
        gap: 26,
        flexWrap: "wrap",
      }}
      data-testid="freescan-flow-strip"
    >
      <Link
        href="/"
        style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, color: "inherit", textDecoration: "none" }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12.5,
            fontWeight: 800,
            color: "#fff",
          }}
        >
          SM
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", whiteSpace: "nowrap" }}>Shane McCaw</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        {FREE_SCAN_FLOW_STEPS.map((label, i) => {
          const state = i < at ? "done" : i === at ? "now" : "next";
          return (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                data-testid={`freescan-flow-step-${label.toLowerCase()}`}
                data-state={state}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  flexShrink: 0,
                  ...(state === "done"
                    ? { color: "#34d399", background: "rgba(52,211,153,.12)", border: "1px solid rgba(52,211,153,.3)" }
                    : state === "now"
                    ? { color: "#fff", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }
                    : { color: "#64748b", background: "rgba(255,255,255,.05)", border: "1px solid rgba(71,85,105,.35)" }),
                }}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  letterSpacing: ".02em",
                  color: state === "next" ? "#475569" : state === "now" ? "#f8fafc" : "#94a3b8",
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: 11, color: "#334155", margin: "0 2px", display: i === 4 ? "none" : "inline" }}>
                →
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
