/**
 * ProposalPhaseCard.tsx — one remediation phase on the SOW Proposal.
 *
 * Each card is a scope decision: what the phase does, what it costs, the findings
 * it closes, and what closing them is worth in points. The toggle is the only
 * control, and on the locked phase there is deliberately no control at all.
 *
 * THE LOCKED PHASE
 * ----------------
 * Phase 1 is the identity work that lands before Copilot is enabled for anyone,
 * so it cannot be dropped. That is enforced in three independent places rather
 * than one: `togglePhase()` refuses a locked phase, this component attaches no
 * click handler to a locked switch, and the switch renders as a non-interactive
 * `<span>` carrying `aria-disabled`. A "Required" badge sitting over a working
 * toggle would be worse than no badge — the customer would move it, watch the
 * total change, and reasonably believe the phase had been removed.
 */

import { Lock } from "lucide-react";

import { PillarSwatch } from "./JourneyPrimitives";
import type { JourneyPhase } from "./journeyPricing.ts";
import { money } from "./journeyPricing.ts";
import {
  BRAND,
  INK,
  PILLARS,
  RADIUS,
  TABULAR,
  severityColor,
  type PillarKey,
} from "./journeyTokens.ts";

/* ------------------------------------------------------------------ *
 * The switch
 * ------------------------------------------------------------------ */

/**
 * The 44×24 switch used by both the phase cards and the optional-service cards.
 *
 * It lives here rather than in its own module because it is the phase card's
 * primary control and the addon card's borrowed one — two copies would drift on
 * exactly the dimensions (track colour, knob colour, travel) that make the two
 * families of card read as the same control.
 *
 * `tone` is the only difference the design draws between them: remediation is
 * brand blue with a white knob, optional services are teal with a dark knob.
 */
export function ScopeToggle({
  on,
  tone,
  label,
  onToggle,
}: {
  on: boolean;
  tone: "remediation" | "optional";
  /** Accessible name — the phase or service this switch controls. */
  label: string;
  onToggle: () => void;
}) {
  const activeColor = tone === "remediation" ? BRAND.blue : BRAND.teal;
  const knob = on ? (tone === "remediation" ? BRAND.white : BRAND.canvas) : "#64748b";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      style={{
        width: 44,
        height: 24,
        padding: 0,
        borderRadius: RADIUS.pill,
        background: on ? activeColor : "rgba(51,65,85,.5)",
        border: `1px solid ${on ? activeColor : "rgba(71,85,105,.8)"}`,
        cursor: "pointer",
        position: "relative",
        flex: "none",
        transition: "background 200ms,border-color 200ms",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: knob,
          transition: "transform 200ms ease",
          transform: `translateX(${on ? 20 : 0}px)`,
        }}
      />
    </button>
  );
}

/**
 * The locked switch. A `<span>`, not a `<button>` — there is no handler to
 * attach, and rendering a disabled button would still put a focusable control
 * on screen for a decision that is not the customer's to make.
 */
function LockedToggle({ label }: { label: string }) {
  return (
    <span
      role="switch"
      aria-checked="true"
      aria-disabled="true"
      aria-label={label}
      title="This phase is required and cannot be removed"
      style={{
        width: 44,
        height: 24,
        borderRadius: RADIUS.pill,
        background: "rgba(51,65,85,.55)",
        border: "1px dashed rgba(100,116,139,.85)",
        position: "relative",
        cursor: "not-allowed",
        flex: "none",
        display: "block",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#475569",
          transform: "translateX(20px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Lock size={9} strokeWidth={2.6} color="#cbd5e1" aria-hidden="true" />
      </span>
    </span>
  );
}

function RequiredBadge() {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        border: `1px solid ${BRAND.teal}59`,
        borderRadius: RADIUS.pill,
        background: `${BRAND.teal}1a`,
      }}
    >
      <Lock size={11} strokeWidth={2.2} color={BRAND.teal} aria-hidden="true" />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: BRAND.teal,
        }}
      >
        Required
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

export function ProposalPhaseCard({
  phase,
  index,
  included,
  pillar,
  onToggle,
}: {
  readonly phase: JourneyPhase;
  /** 1-based position, for the "Phase 3 · Compliance" eyebrow. */
  readonly index: number;
  readonly included: boolean;
  /**
   * The pillar to show identity for, or `null` when the phase could not be
   * attributed to one. A live SOW workstream carries no pillar field, so a
   * swatch is drawn only where the attribution is real — a guessed identity
   * colour is a claim about which findings a phase closes.
   */
  readonly pillar: PillarKey | null;
  /** Omitted entirely for a locked phase — see the note at the top of the file. */
  readonly onToggle?: () => void;
}) {
  const identity = pillar ? PILLARS[pillar] : null;
  const dim = phase.locked || included ? 1 : 0.42;

  // The locked phase is tinted with its own pillar identity rather than a
  // generic "disabled" grey: it is the phase that matters most, not the one
  // that is switched off.
  const border = phase.locked && identity
    ? `1px solid ${identity.primary}73`
    : `1px solid ${included ? "rgba(30,41,59,.95)" : "rgba(30,41,59,.55)"}`;
  const background = phase.locked && identity
    ? `${identity.primary}12`
    : included
      ? "rgba(15,23,42,.55)"
      : "rgba(15,23,42,.22)";

  // A phase only shows a score movement where one was actually quoted. Live SOW
  // workstreams carry a price and a scope, not a projected pillar score, so the
  // two ends are equal there and the delta is left off rather than drawn as a
  // flat "44 → 44", which reads as remediation that achieves nothing.
  const hasDelta = phase.scoreTo !== phase.scoreFrom;
  const gain = phase.scoreTo - phase.scoreFrom;
  const hasFooter = hasDelta || phase.addresses.trim().length > 0;

  return (
    <div
      style={{
        border,
        borderRadius: RADIUS.cardLarge,
        background,
        padding: "19px 21px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "border-color 200ms,background 200ms",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: "1 1 300px",
            minWidth: 0,
            transition: "opacity 200ms",
            opacity: dim,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: identity ? identity.primary : INK.micro,
            }}
          >
            {pillar ? <PillarSwatch pillar={pillar} /> : null}
            {identity ? `Phase ${index} · ${identity.label}` : `Phase ${index}`}
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              color: INK.headingDark,
            }}
          >
            {phase.title}
          </span>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 500,
              lineHeight: 1.6,
              color: INK.bodyDark,
              maxWidth: "52ch",
            }}
          >
            {phase.scope}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: phase.locked ? 9 : 10,
            flex: "none",
          }}
        >
          <span
            style={{
              fontSize: 21,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: INK.headingDark,
              transition: "opacity 200ms",
              opacity: dim,
              ...TABULAR,
            }}
          >
            {money(phase.priceUsd)}
          </span>
          {phase.locked ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <RequiredBadge />
              <LockedToggle label={`${phase.title} — required, cannot be removed`} />
            </div>
          ) : (
            <ScopeToggle
              on={included}
              tone="remediation"
              label={phase.title}
              onToggle={onToggle ?? (() => undefined)}
            />
          )}
        </div>
      </div>

      {hasFooter ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            paddingTop: 13,
            borderTop: `1px solid ${INK.hairlineDark}`,
            flexWrap: "wrap",
            transition: "opacity 200ms",
            opacity: dim,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.micro }}>
            {phase.addresses}
          </span>
          {hasDelta ? (
            <span
              style={{ display: "flex", alignItems: "baseline", gap: 8, ...TABULAR }}
            >
              {/* Both ends are severity-coloured, so a pillar landing on 58 reads
                  amber here exactly as it does on the Reveal and in the report.
                  The gain itself is teal — an improvement is not a severity. */}
              <span
                style={{ fontSize: 15, fontWeight: 800, color: severityColor(phase.scoreFrom) }}
              >
                {phase.scoreFrom}
              </span>
              <svg
                width="16"
                height="8"
                viewBox="0 0 18 9"
                fill="none"
                stroke={INK.deemphasised}
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M0 4.5h16M12 1l4 3.5-4 3.5" />
              </svg>
              <span
                style={{ fontSize: 15, fontWeight: 800, color: severityColor(phase.scoreTo) }}
              >
                {phase.scoreTo}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: BRAND.teal }}>
                {gain >= 0 ? `+${gain}` : gain}
                {identity ? ` ${identity.label}` : ""}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
