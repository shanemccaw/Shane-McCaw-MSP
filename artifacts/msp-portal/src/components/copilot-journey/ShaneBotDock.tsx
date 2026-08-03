/**
 * ShaneBotDock.tsx — the docked ShaneBot pill and the panel it expands into.
 *
 * UI ONLY, and deliberately so. There is no chat logic, no grounding and no
 * backend in this scope — the handoff lists ShaneBot's architecture as an open
 * proposal. So the input is genuinely `disabled` (not styled to look it) and
 * carries a `SOON` marker, and the suggestion chips are static text rather than
 * buttons that would do nothing when pressed. A control that looks live and
 * isn't is a worse promise than one that says "soon".
 *
 * The expand is the one motion this screen keeps: the panel grows upward FROM
 * the docked pill — `transform-origin: 100% 100%`, opacity over 220ms, transform
 * over 260ms on `cubic-bezier(.2,.8,.2,1)`. Not a centred modal, not a separate
 * page; the customer never leaves the report they are asking about.
 *
 * The panel is a dark surface sitting inside the viewer's light one, so it wears
 * `.cj-dark` — that is what supplies the dark `::placeholder` colour for the
 * disabled input, which inline styles cannot set.
 */

import { ChevronUp, MessageCircle, X } from "lucide-react";

import { BRAND, INK_ON_NAVY, MOTION, RADIUS } from "./journeyTokens.ts";
import { NAVY_SURFACE } from "./DocumentSidebar";

const SUGGESTIONS = [
  "Why is this the first thing to fix?",
  "What breaks if we skip it?",
  "Which users are affected?",
] as const;

export function ShaneBotDock({
  open,
  context,
  onToggle,
  onClose,
  reduceMotion,
}: {
  readonly open: boolean;
  /** The content the customer asked about, passed in by the hover affordance. */
  readonly context: string | null;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly reduceMotion: boolean;
}) {
  const transition = reduceMotion
    ? "opacity 1ms linear"
    : `opacity ${MOTION.botOpacityMs}ms ease,transform ${MOTION.botTransformMs}ms ${MOTION.botEase}`;

  return (
    <>
      <div
        className="cj-dark"
        role="dialog"
        aria-label="ShaneBot"
        aria-hidden={!open}
        style={{
          position: "fixed",
          right: 22,
          bottom: 84,
          zIndex: 31,
          width: "min(384px,calc(100vw - 44px))",
          background: BRAND.navy,
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: RADIUS.cardLarge,
          boxShadow: "0 18px 48px rgba(10,37,64,.34)",
          transformOrigin: "100% 100%",
          transition,
          opacity: open ? 1 : 0,
          transform: open ? "none" : "translateY(16px) scale(0.9)",
          pointerEvents: open ? "auto" : "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `1px solid ${NAVY_SURFACE.hairline}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "rgba(0,180,216,.14)",
                border: "1px solid rgba(0,180,216,.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <MessageCircle size={15} strokeWidth={1.8} color={BRAND.teal} aria-hidden="true" />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.white }}>ShaneBot</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: INK_ON_NAVY.muted,
                }}
              >
                Grounded on your own reports
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ShaneBot"
            tabIndex={open ? 0 : -1}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flex: "none",
              border: 0,
              background: "transparent",
            }}
          >
            <X size={13} strokeWidth={2} color={INK_ON_NAVY.body} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, minHeight: 196 }}>
          {context ? (
            <div
              style={{
                borderLeft: `2px solid ${BRAND.teal}`,
                padding: "2px 0 2px 11px",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: INK_ON_NAVY.muted,
                }}
              >
                Asking about
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.5, color: INK_ON_NAVY.strongest }}>
                {context}
              </span>
            </div>
          ) : null}

          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, lineHeight: 1.6, color: INK_ON_NAVY.body }}>
            {/* Future tense throughout. The panel marks itself SOON and its input is
                genuinely disabled, so describing grounded answers in the present
                tense would be the one thing on this screen that is not true yet. */}
            You will be able to ask about any finding, number or remediation step in your reports.
            Answers will come from your tenant's own data — not general guidance.
          </p>

          {/* Static, not buttons: nothing behind them yet, and a chip that does
              nothing when pressed reads as a broken product rather than a coming
              one. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {SUGGESTIONS.map((s) => (
              <span
                key={s}
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: INK_ON_NAVY.strong,
                  border: "1px solid rgba(255,255,255,.14)",
                  borderRadius: RADIUS.pill,
                  padding: "6px 11px",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "12px 14px 14px",
            borderTop: `1px solid ${NAVY_SURFACE.hairline}`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(2,6,23,.5)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 8,
              padding: "9px 11px",
            }}
          >
            <input
              type="text"
              disabled
              aria-label="Ask about this report — not available yet"
              placeholder="Ask about this report…"
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                fontSize: 12.5,
                fontWeight: 500,
                color: INK_ON_NAVY.body,
                background: "transparent",
                border: 0,
                outline: "none",
                cursor: "not-allowed",
              }}
            />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: BRAND.teal,
                flex: "none",
              }}
            >
              Soon
            </span>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 500, color: INK_ON_NAVY.muted }}>
            Answers will be generated from your reports and SOW, and Shane will review anything
            contested. Until then, use the link above to reach him directly.
          </span>
        </div>
      </div>

      <button
        type="button"
        className="cj-dark"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Close ShaneBot" : "Ask ShaneBot about this report"}
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 32,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 15px",
          background: BRAND.navy,
          border: 0,
          borderRadius: RADIUS.pill,
          boxShadow: "0 8px 24px rgba(10,37,64,.24)",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <MessageCircle size={16} strokeWidth={1.8} color={BRAND.teal} aria-hidden="true" />
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.white, whiteSpace: "nowrap" }}>
            Ask about this report
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: INK_ON_NAVY.muted,
            }}
          >
            ShaneBot · soon
          </span>
        </span>
        <ChevronUp
          size={11}
          strokeWidth={2.2}
          color={INK_ON_NAVY.muted}
          aria-hidden="true"
          style={{
            transition: reduceMotion ? "none" : "transform 240ms ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        />
      </button>
    </>
  );
}
