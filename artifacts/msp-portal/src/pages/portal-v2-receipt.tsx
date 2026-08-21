/**
 * portal-v2-receipt.tsx — a single one-time-charge receipt (Part 12).
 *
 * Ported from the prototype's `isReceipt` block (Customer Portal Shell.dc.html
 * 6013-6091) and its render values (20543-20568), transcribed into
 * receiptData.ts / receiptModel.ts.
 *
 * ── One receipt, chosen by the URL ──────────────────────────────────────────
 * The prototype reaches this from a Billing receipt row (`receiptId`) and its
 * back button returns to Billing. Here the id is a route segment
 * (/portal-v2/receipt/<id>), defaulting to the Preservation-Lock receipt the
 * prototype falls back to when none is set. The back link goes to Billing, as
 * the design's `rcBackGo` does.
 *
 * ── UI-only ─────────────────────────────────────────────────────────────────
 * The fixture is design content. The action buttons (PDF / email / query / ask
 * ShaneBot) render verbatim but are inert — each opens shell machinery a page
 * must not touch, and wiring Stripe is a later pass.
 */

import { Link, useRoute } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import { RECEIPT_INTRO, RECEIPT_ISSUER, RECEIPT_ISSUER_INITIALS } from "@/components/portal-v2/receiptData";
import { receiptView } from "@/components/portal-v2/receiptModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function BackArrow() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

const ACTIONS: readonly { label: string; border: string; bg: string; color: string }[] = [
  { label: "Download PDF receipt", border: "rgba(96,165,250,.4)", bg: "rgba(96,165,250,.1)", color: "#bfdbfe" },
  { label: "Email this receipt", border: "rgba(148,163,184,.22)", bg: "transparent", color: "#94a3b8" },
  { label: "Query this charge", border: "rgba(148,163,184,.22)", bg: "transparent", color: "#94a3b8" },
  { label: "Ask ShaneBot about this charge", border: "rgba(0,180,216,.4)", bg: "rgba(0,180,216,.08)", color: "#22d3ee" },
];

export default function PortalV2ReceiptPage() {
  const [, params] = useRoute("/portal-v2/receipt/:id");
  const v = receiptView(params?.id);

  return (
    <PortalV2Shell eyebrow="Billing" title="Receipt">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          data-testid="pv2-receipt"
          style={{
            position: "relative",
            maxWidth: 820,
            margin: "0 auto",
            padding: "28px 28px 64px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          <Link
            href="/portal-v2/billing"
            data-testid="pv2-receipt-back"
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
              <BackArrow />
            </span>
            Billing
          </Link>

          {/* ── The receipt card ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 14,
              background: "rgba(15,23,42,.45)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
                padding: "22px 24px",
                borderBottom: "1px solid rgba(30,41,59,.9)",
                background: "rgba(8,17,32,.5)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: "linear-gradient(135deg,#0078D4,#00B4D8)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: 800,
                      color: "#fff",
                      flex: "0 0 26px",
                    }}
                  >
                    {RECEIPT_ISSUER_INITIALS}
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9" }}>{RECEIPT_ISSUER}</span>
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6 }}>{RECEIPT_INTRO}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flex: "0 0 auto" }}>
                <span
                  data-testid="pv2-receipt-status"
                  style={{
                    padding: "4px 11px",
                    borderRadius: 6,
                    border: `1px solid ${v.isPaid ? "rgba(52,211,153,.45)" : "rgba(194,166,61,.45)"}`,
                    background: v.isPaid ? "rgba(52,211,153,.1)" : "rgba(194,166,61,.1)",
                    color: v.isPaid ? "#34d399" : "#c2a63d",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                  }}
                >
                  {v.status}
                </span>
                <span data-testid="pv2-receipt-number" style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>
                  {v.id}
                </span>
              </div>
            </div>

            {/* Meta grid — proto 6035-6042 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
                gap: 14,
                padding: "18px 24px",
                borderBottom: "1px solid rgba(30,41,59,.85)",
              }}
            >
              {v.meta.map((m) => (
                <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#64748b" }}>
                    {m.label}
                  </span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.5, textWrap: "pretty" }}>
                    {m.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Line items — proto 6044-6068 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "18px 24px 0" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 90px 110px",
                  gap: 12,
                  paddingBottom: 9,
                  borderBottom: "1px solid rgba(30,41,59,.9)",
                }}
              >
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#64748b" }}>Description</span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#64748b", textAlign: "right" }}>Qty</span>
                <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#64748b", textAlign: "right" }}>Amount</span>
              </div>
              {v.lines.map((l) => (
                <div
                  key={l.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 90px 110px",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: "1px solid rgba(30,41,59,.7)",
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.45, textWrap: "pretty" }}>{l.name}</span>
                    <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{l.detail}</span>
                  </div>
                  <span style={{ fontSize: "11.5px", color: "#94a3b8", textAlign: "right", fontFamily: MONO }}>{l.qty}</span>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#f1f5f9", textAlign: "right", fontFamily: MONO }}>{l.amount}</span>
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-end", padding: "14px 0 18px" }}>
                {v.totals.map((t) => (
                  <div key={t.label} style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                    <span
                      style={
                        t.small
                          ? { fontSize: "10.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b" }
                          : { fontSize: "11px", fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "#94a3b8" }
                      }
                    >
                      {t.label}
                    </span>
                    <span
                      style={
                        t.small
                          ? { fontSize: "12px", color: "#94a3b8", fontFamily: MONO, minWidth: 90, textAlign: "right" }
                          : { fontSize: "19px", fontWeight: 800, color: "#f8fafc", fontFamily: MONO, minWidth: 90, textAlign: "right" }
                      }
                    >
                      {t.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* What this paid for — proto 6071-6082 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "17px 20px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 13,
              background: "rgba(15,23,42,.4)",
            }}
          >
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
              What this paid for
            </span>
            <span
              data-testid="pv2-receipt-narrative"
              style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7, maxWidth: "80ch", textWrap: "pretty" }}
            >
              {v.narrative}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 4 }}>
              {v.trace.map((t) => (
                <div key={t.label} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                  <span style={{ flex: "0 0 116px", fontSize: "9.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b", paddingTop: 2 }}>
                    {t.label}
                  </span>
                  <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: "12px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>
                    {t.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions — proto 6084-6089 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                style={{
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: `1px solid ${a.border}`,
                  background: a.bg,
                  color: a.color,
                  fontSize: "11.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
