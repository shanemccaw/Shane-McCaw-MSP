/**
 * ShaneBot.tsx — the three ShaneBot surfaces, drawn to the prototype markup
 * (Customer Portal Shell.dc.html): the selection chip (6632-6638), the chat
 * panel (6640-6753) and the launcher button (6755-6757). Message bubbles, cards
 * and steps follow the `sbMessages` derivation (17595-17619).
 *
 * README §"ShaneBot — selection-based, not always-on": the chip appears AT the
 * selection and never follows the pointer (that placement is in `useSelectionAsk`),
 * ⌘K with a selection asks about it, Escape dismisses. Replies carry an Active
 * Card; escalation opens a Zoho Desk ticket with the conversation attached. The
 * replies are the prototype's scripted fixtures — grounding them on real
 * telemetry is a later architecture task per the handoff.
 */

import { useEffect, useRef } from "react";
import { MessageSquare, X } from "lucide-react";

import type { ShaneBotApi } from "./useShaneBot";
import type { SelectionChip as SelectionChipData } from "./useSelectionAsk";
import { SB_CHIPS, SB_CONTEXT, SB_ROW_TONE, sbCardFor, type SbMessage } from "./shaneBotData";
import { SB_TENANT_META } from "./shellData";

const BLUE = "var(--brand-blue,#0078D4)";

/* ── Selection chip — placed once at the selection, nothing follows the pointer ── */

export function SelectionChip({
  chip,
  onAsk,
}: {
  chip: SelectionChipData;
  onAsk: (topic: string) => void;
}) {
  const short = chip.label.length > 42 ? `${chip.label.slice(0, 42)}…` : chip.label;
  const label = chip.words > 1 ? "Ask ShaneBot about this selection" : `Ask ShaneBot about “${short}”`;
  return (
    <button
      data-ask-chip="1"
      data-testid="pv2-selection-chip"
      onClick={() => onAsk(`About this, from my tenant: "${chip.label}"`)}
      style={{
        position: "fixed",
        zIndex: 130,
        left: chip.x,
        top: chip.y,
        transform: "translate(-50%,-100%)",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 11px",
        borderRadius: 14,
        border: "1px solid rgba(0,180,216,.55)",
        background: "rgba(8,26,42,.97)",
        boxShadow: "0 8px 22px rgba(2,6,23,.55)",
        fontSize: "10.5px",
        fontWeight: 700,
        color: "#22d3ee",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22d3ee", flex: "0 0 5px" }} />
      {label}
      <span style={{ fontSize: "9px", fontWeight: 700, color: "#475569", letterSpacing: ".06em" }}>⌘K</span>
    </button>
  );
}

/* ── The launcher button (bottom-right) ──────────────────────────────────── */

export function ShaneBotLauncher({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Chat with ShaneBot"
      data-testid="pv2-shanebot-launcher"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 100,
        width: 50,
        height: 50,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid rgba(0,180,216,.4)",
        background: "linear-gradient(135deg,#0078D4,#00B4D8)",
        cursor: "pointer",
        boxShadow: "0 8px 22px rgba(0,120,212,.35)",
      }}
    >
      <MessageSquare size={18} color="#fff" />
    </button>
  );
}

/* ── The chat panel ──────────────────────────────────────────────────────── */

function CardActions({ card }: { card: NonNullable<ReturnType<typeof sbCardFor>> }) {
  // The prototype gives each card kind its own button treatment (6702-6719).
  // Only the escalate primary is wired (it sends a message); the rest mirror
  // the design's static demo buttons.
  const base: React.CSSProperties = {
    padding: "8px 13px",
    borderRadius: 7,
    fontSize: "11.5px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const primary =
    card.kind === "fix"
      ? { ...base, border: `1px solid ${BLUE}`, background: BLUE, color: "#fff" }
      : card.kind === "finding" || card.kind === "report"
        ? { ...base, border: "1px solid rgba(0,120,212,.45)", background: "rgba(0,120,212,.12)", color: "#60a5fa" }
        : card.kind === "ticket"
          ? { ...base, border: "1px solid rgba(34,211,238,.45)", background: "rgba(34,211,238,.12)", color: "#22d3ee" }
          : { ...base, border: "1px solid rgba(0,180,216,.5)", background: "rgba(0,180,216,.14)", color: "#22d3ee" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
      <button type="button" style={primary}>
        {card.price}
      </button>
      {card.secondary && (
        <button
          type="button"
          style={{
            ...base,
            fontWeight: 600,
            border: "1px solid rgba(148,163,184,.24)",
            background: "transparent",
            color: "#94a3b8",
          }}
        >
          {card.secondary}
        </button>
      )}
    </div>
  );
}

function MessageBubble({ m }: { m: SbMessage }) {
  const isBot = m.who === "bot";
  const card = m.card ? sbCardFor(m.card.kind, m.card.label) : null;
  const bubbleCss: React.CSSProperties = isBot
    ? {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: "88%",
        padding: "11px 13px",
        borderRadius: "12px 12px 12px 4px",
        border: "1px solid rgba(0,180,216,.24)",
        background: "linear-gradient(160deg, rgba(0,180,216,.08), rgba(15,23,42,.55))",
        fontSize: "12.5px",
        color: "#e2e8f0",
        lineHeight: 1.6,
      }
    : {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: "88%",
        marginLeft: "auto",
        padding: "11px 13px",
        borderRadius: "12px 12px 4px 12px",
        border: "1px solid rgba(148,163,184,.2)",
        background: "rgba(148,163,184,.07)",
        fontSize: "12.5px",
        color: "#e2e8f0",
        lineHeight: 1.6,
      };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={bubbleCss}>{m.text}</div>
      {card && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "12px 13px",
            border: "1px solid rgba(0,120,212,.3)",
            borderRadius: 11,
            background: "linear-gradient(160deg, rgba(0,120,212,.07), rgba(15,23,42,.6))",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#60a5fa" }}>
              Active card
            </span>
            <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f8fafc", lineHeight: 1.4 }}>{card.title}</span>
            <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.4 }}>{card.meta}</span>
          </div>
          {card.rows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {card.rows.map((r, i) => (
                <div
                  key={i}
                  style={{ display: "grid", gridTemplateColumns: "minmax(78px,.55fr) minmax(0,1fr)", gap: 10, alignItems: "baseline" }}
                >
                  <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b" }}>
                    {r.k}
                  </span>
                  <span
                    style={{
                      fontSize: "11.5px",
                      color: r.tone ? SB_ROW_TONE[r.tone] : "#e2e8f0",
                      lineHeight: 1.45,
                      fontWeight: r.tone ? 700 : 500,
                    }}
                  >
                    {r.v}
                  </span>
                </div>
              ))}
            </div>
          )}
          {card.steps && card.steps.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {card.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                  <span
                    style={{
                      flex: "0 0 9px",
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      marginTop: 4,
                      background: s.state === "done" ? "#34d399" : s.state === "active" ? "#22d3ee" : "transparent",
                      border: `1px solid ${s.state === "done" ? "#34d399" : s.state === "active" ? "#22d3ee" : "rgba(148,163,184,.35)"}`,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: s.state === "todo" ? "#64748b" : "#e2e8f0" }}>
                      {s.label}
                    </span>
                    <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.45 }}>{s.note}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <CardActions card={card} />
        </div>
      )}
    </div>
  );
}

export function ShaneBotPanel({ api }: { api: ShaneBotApi }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [api.messages, api.typing]);

  return (
    <div
      data-sb-panel="1"
      data-testid="pv2-shanebot-panel"
      style={{
        position: "fixed",
        right: 20,
        bottom: 82,
        zIndex: 140,
        width: "min(420px,calc(100vw - 40px))",
        maxHeight: "min(720px,calc(100vh - 170px))",
        display: "flex",
        flexDirection: "column",
        border: "1px solid rgba(0,180,216,.35)",
        borderRadius: 14,
        background: "#0b1524",
        boxShadow: "0 24px 60px rgba(2,6,23,.6), 0 0 0 1px rgba(0,120,212,.12)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "relative",
          flex: "0 0 auto",
          padding: "13px 15px",
          borderBottom: "1px solid rgba(30,41,59,.9)",
          background: "linear-gradient(160deg, rgba(0,180,216,.12), rgba(15,23,42,.5))",
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -30,
            top: -50,
            width: 180,
            height: 180,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,180,216,.2), rgba(2,6,23,0) 70%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              flex: "0 0 30px",
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "linear-gradient(135deg,#0078D4,#00B4D8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: 800,
              color: "#fff",
              fontFamily: "'SF Mono',Menlo,Consolas,monospace",
            }}
          >
            SB
          </span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "13px", fontWeight: 800, color: "#f8fafc" }}>ShaneBot</span>
            {api.escalated ? (
              <span style={{ fontSize: "10px", color: "#22d3ee" }}>With a person now · ZD-40118 · Priya Raman</span>
            ) : (
              <span style={{ fontSize: "10px", color: "#64748b" }}>{SB_TENANT_META}</span>
            )}
          </div>
          <span
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 8px",
              borderRadius: 5,
              border: "1px solid rgba(52,211,153,.35)",
              background: "rgba(52,211,153,.08)",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#34d399",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399" }} />
            Online
          </span>
          <button
            onClick={api.close}
            style={{ flex: "0 0 auto", background: "none", border: "none", padding: 2, cursor: "pointer" }}
            title="Close"
          >
            <X size={16} color="#94a3b8" />
          </button>
        </div>
        {api.contextOpen && (
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              padding: "9px 11px",
              border: "1px solid rgba(139,92,246,.3)",
              borderLeft: "2px solid #8B5CF6",
              borderRadius: 8,
              background: "rgba(139,92,246,.06)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#a78bfa" }}>
                {SB_CONTEXT.eyebrow}
              </span>
              <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45 }}>{SB_CONTEXT.line}</span>
            </div>
            <button
              onClick={api.dismissContext}
              style={{ flex: "0 0 auto", padding: 0, background: "none", border: "none", fontSize: "10px", fontWeight: 600, color: "#64748b", cursor: "pointer", fontFamily: "inherit" }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "14px 15px", display: "flex", flexDirection: "column", gap: 11 }}
      >
        {api.messages.map((m, i) => (
          <MessageBubble key={i} m={m} />
        ))}
        {api.typing && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 12px",
              width: "fit-content",
              borderRadius: "12px 12px 12px 4px",
              border: "1px solid rgba(0,180,216,.2)",
              background: "rgba(0,180,216,.06)",
            }}
          >
            <span className="pv2-slow-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee" }} />
            <span className="pv2-slow-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee", animationDelay: ".18s" }} />
            <span className="pv2-slow-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22d3ee", animationDelay: ".36s" }} />
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>Checking your tenant…</span>
          </div>
        )}
      </div>

      {/* Footer: chips + input */}
      <div
        style={{
          flex: "0 0 auto",
          borderTop: "1px solid rgba(30,41,59,.9)",
          padding: "11px 15px 13px",
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SB_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => api.send(c)}
              style={{
                padding: "5px 10px",
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,.22)",
                background: "rgba(148,163,184,.05)",
                fontSize: "10.5px",
                fontWeight: 600,
                color: "#94a3b8",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <input
            value={api.input}
            onChange={(e) => api.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                api.send();
              }
            }}
            data-testid="pv2-shanebot-input"
            placeholder="Ask about a finding, a score, or what something costs…"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(30,41,59,.9)",
              background: "#0b1a2e",
              color: "#e2e8f0",
              fontSize: "12px",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={() => api.send()}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: 7,
              fontSize: "11.5px",
              fontWeight: 700,
              cursor: api.input.trim() ? "pointer" : "default",
              fontFamily: "inherit",
              border: `1px solid ${api.input.trim() ? BLUE : "rgba(30,41,59,.9)"}`,
              background: api.input.trim() ? BLUE : "transparent",
              color: api.input.trim() ? "#fff" : "#475569",
            }}
          >
            Send
          </button>
        </div>
        {api.escalated ? (
          <span style={{ fontSize: "10px", color: "#22d3ee", lineHeight: 1.5 }}>
            This conversation is attached to ZD-40118. Anything you type now reaches Priya as well as me.
          </span>
        ) : (
          <span style={{ fontSize: "10px", color: "#475569", lineHeight: 1.5 }}>
            Highlight anything on any page — a number, a row, a whole paragraph — and I will explain that exact thing. ⌘K works too.
          </span>
        )}
      </div>
    </div>
  );
}
