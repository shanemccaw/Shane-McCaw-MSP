import React, { useEffect, useState } from "react";
import { Link } from "wouter";

// Shared marketing footer. Recreated from Design/design_handoff_marketing/Marketing Footer.dc.html
// — copy is final and reproduced verbatim. The footer owns the "Ask Shane" panel: any page can
// open it by dispatching a window "sm-ask-shane" event, so "Talk to Shane" links elsewhere on the
// site don't need their own contact surface. The panel/FAB are prototype UI (no real send yet).
const ASK_PROMPTS: { label: string; value: string }[] = [
  { label: "How does pricing work?", value: "How does pricing work?" },
  { label: "Which tier fits my tenant?", value: "Which monitoring tier fits my tenant?" },
  { label: "I want a demo", value: "I'd like a demo" },
];

export function Footer() {
  const [sbOpen, setSbOpen] = useState(false);
  const [sbInput, setSbInput] = useState("");

  useEffect(() => {
    const open = () => setSbOpen(true);
    window.addEventListener("sm-ask-shane", open);
    return () => window.removeEventListener("sm-ask-shane", open);
  }, []);

  return (
    <>
      <style>{`
        .sm-footer a{text-decoration:none;cursor:pointer}
        .sm-ask-prompt:hover{border-color:rgba(59,130,246,.4)}
        .sm-ask-fab:hover{filter:brightness(1.08)}
      `}</style>

      {/* Ask Shane panel — shown only while open */}
      {sbOpen && (
        <div
          className="sm-footer"
          style={{
            position: "fixed",
            right: "20px",
            bottom: "86px",
            zIndex: 101,
            width: "320px",
            maxHeight: "420px",
            display: "flex",
            flexDirection: "column",
            background: "#0b1524",
            border: "1px solid rgba(30,41,59,.9)",
            borderRadius: "16px",
            boxShadow: "0 20px 50px rgba(0,0,0,.5)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "13px 15px",
              borderBottom: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <span
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                fontWeight: 800,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              SM
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#f8fafc" }}>Ask Shane</div>
              <div style={{ fontSize: "10.5px", color: "#64748b" }}>Usually replies within a day</div>
            </div>
            <button
              onClick={() => setSbOpen(false)}
              style={{
                background: "none",
                border: 0,
                color: "#64748b",
                fontSize: "16px",
                cursor: "pointer",
                lineHeight: 1,
                padding: "2px",
              }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 15px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <p style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
              Questions about pricing, monitoring, remediation, or where to start? Ask here and Shane
              will follow up by email.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {ASK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  className="sm-ask-prompt"
                  onClick={() => setSbInput(p.value)}
                  style={{
                    textAlign: "left",
                    padding: "8px 11px",
                    borderRadius: "9px",
                    border: "1px solid rgba(30,41,59,.9)",
                    background: "#020617",
                    color: "#cbd5e1",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div
            style={{
              borderTop: "1px solid rgba(30,41,59,.9)",
              padding: "11px 12px",
              display: "flex",
              gap: "8px",
            }}
          >
            <input
              value={sbInput}
              onChange={(e) => setSbInput(e.target.value)}
              placeholder="Type your question…"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "9px 11px",
                borderRadius: "8px",
                border: "1px solid rgba(30,41,59,.9)",
                background: "#020617",
                color: "#e2e8f0",
                fontSize: "12px",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => setSbInput("")}
              style={{
                padding: "9px 14px",
                borderRadius: "8px",
                border: 0,
                background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Floating FAB that toggles the panel */}
      <button
        className="sm-ask-fab"
        onClick={() => setSbOpen((v) => !v)}
        title="Ask Shane"
        style={{
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: 100,
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(59,130,246,.4)",
          background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
          cursor: "pointer",
          boxShadow: "0 8px 22px rgba(59,130,246,.35)",
        }}
      >
        <span style={{ display: "flex" }}>
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </span>
      </button>

      <footer
        className="sm-footer"
        style={{
          background: "#020617",
          borderTop: "1px solid rgba(30,41,59,.9)",
          padding: "48px 32px 32px",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              gap: "32px",
              marginBottom: "36px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px" }}>
                <div
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  SM
                </div>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>Shane McCaw</span>
              </div>
              <p
                style={{
                  color: "#64748b",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  maxWidth: "280px",
                  margin: 0,
                }}
              >
                Free tenant scans, continuous monitoring, standalone configuration packs, and
                fractional M365 architecture — led by NASA’s current Lead Microsoft 365 Architect.
              </p>
            </div>

            <div>
              <h4 style={{ color: "#f8fafc", fontSize: "13px", margin: "0 0 14px" }}>Products</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                <Link href="/monitoring" style={{ fontSize: "13px", color: "#64748b" }}>
                  Monitoring
                </Link>
                <Link href="/quick-start" style={{ fontSize: "13px", color: "#64748b" }}>
                  Quick-Start Packs
                </Link>
                <Link href="/retainers" style={{ fontSize: "13px", color: "#64748b" }}>
                  Retainers
                </Link>
              </div>
            </div>

            <div>
              <h4 style={{ color: "#f8fafc", fontSize: "13px", margin: "0 0 14px" }}>Start here</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                <Link href="/scan" style={{ fontSize: "13px", color: "#64748b" }}>
                  Free tenant scan
                </Link>
                <Link href="/pricing" style={{ fontSize: "13px", color: "#64748b" }}>
                  How pricing works
                </Link>
              </div>
            </div>

            <div>
              <h4 style={{ color: "#f8fafc", fontSize: "13px", margin: "0 0 14px" }}>Company</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                <Link href="/" style={{ fontSize: "13px", color: "#64748b" }}>
                  About Shane
                </Link>
                <a onClick={() => setSbOpen(true)} style={{ fontSize: "13px", color: "#64748b" }}>
                  Contact
                </a>
                <Link href="/status" style={{ fontSize: "13px", color: "#64748b" }}>
                  Service status
                </Link>
              </div>
            </div>
          </div>

          <div
            style={{
              paddingTop: "24px",
              borderTop: "1px solid rgba(30,41,59,.9)",
              display: "flex",
              justifyContent: "space-between",
              fontSize: "11.5px",
              color: "#475569",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <span>© 2026 Shane McCaw Consulting. All rights reserved.</span>
            <span>Microsoft 365 Architecture · Governance · Monitoring</span>
          </div>
        </div>
      </footer>
    </>
  );
}

export default Footer;
