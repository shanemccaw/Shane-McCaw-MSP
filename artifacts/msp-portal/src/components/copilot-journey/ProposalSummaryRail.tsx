/**
 * ProposalSummaryRail.tsx — the sticky total beside the phase list.
 *
 * Everything on this card is `computeTotals()` output, never a figure re-derived
 * at the render site. That matters more here than anywhere else in the journey:
 * this card and the sticky header are two views of the same arithmetic on a
 * screen the customer signs, and two independent sums are two chances to
 * disagree.
 *
 * The card shows three things the customer is agreeing to, kept visually
 * separate because they are separate commitments: what leaves the account once,
 * what leaves it every month, and what the tenant's readiness becomes.
 */

import type { JourneyTotals } from "./journeyPricing.ts";
import {
  money,
  monthlyLabel,
  phaseCountLabel,
  recurringLabel,
  weeksLabel,
} from "./journeyPricing.ts";
import { BRAND, INK, RADIUS, TABULAR, severityColor } from "./journeyTokens.ts";

const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".22em",
  textTransform: "uppercase",
  color: INK.micro,
};

const DIVIDED: React.CSSProperties = {
  paddingTop: 16,
  borderTop: `1px solid ${INK.hairlineDark}`,
};

export function ProposalSummaryRail({
  totals,
  weeks,
  adjustmentsUsd,
  currentScore,
  projectionQuoted,
}: {
  readonly totals: JourneyTotals;
  /**
   * Weeks across the included phases, or `null` when not one of them quoted a
   * duration — in which case the clause is omitted entirely.
   *
   * `totals.weeks` deliberately is NOT read here. `JourneyPhase.weeks` is a
   * required `number`, so a nullable wire value has to be flattened to `0` to
   * reach `computeTotals()`, and that sum cannot tell "no timeline was quoted"
   * from "zero weeks". "approx. 0 weeks" on a screen someone signs is a delivery
   * commitment nobody made; the platform's own SOW selector guards the same
   * field.
   */
  readonly weeks: number | null;
  /**
   * The platform's mandatory price adjustments, already inside `oneOffUsd` and
   * `upfrontUsd`. Shown as its own row so the headline figure adds up for anyone
   * totalling the phase cards, and `0` when the scope carries none.
   */
  readonly adjustmentsUsd: number;
  /**
   * The tenant's readiness today, from the live assessment. `null` when the
   * platform has no covered indicator — the readiness row then says so rather
   * than pairing a real projection with an invented starting point.
   */
  readonly currentScore: number | null;
  /**
   * Whether the scope actually quotes per-pillar movement. A live SOW workstream
   * carries a price and a scope, not a projected pillar score, so `computeTotals`
   * still returns a mean for it — of today's numbers. Rendering that as
   * "readiness after this scope" would dress up an unchanged figure as a
   * forecast, so the caller says explicitly whether a forecast exists.
   */
  readonly projectionQuoted: boolean;
}) {
  // Moves the moment a phase is switched off, which is the point: dropping a
  // phase has to visibly cost points.
  const projected = totals.projectedScore;
  const showReadiness = projectionQuoted && currentScore !== null && projected !== null;

  return (
    <div
      style={{
        border: `1px solid ${BRAND.blue}66`,
        borderRadius: RADIUS.panel,
        background: `linear-gradient(160deg,${BRAND.blue}1f,rgba(15,23,42,.7))`,
        padding: "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={EYEBROW}>Remediation, one-off</span>
        <span
          data-testid="proposal-summary-total"
          style={{
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1,
            color: INK.headingDark,
            ...TABULAR,
          }}
        >
          {money(totals.oneOffUsd)}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
          {phaseCountLabel(totals.includedPhaseCount, totals.totalPhaseCount)}
          {weeks === null ? "" : ` · ${weeksLabel(weeks)}`}
        </span>
      </div>

      {/* The platform's own mandatory adjustment lines. Inside the headline
          figure above — so leaving them implicit would make it look wrong to
          anyone adding up the phase cards — but not a phase, not toggleable and
          not counted in "N of M phases". */}
      {adjustmentsUsd !== 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            ...DIVIDED,
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.headingDark }}>
              Included adjustments
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: INK.micro }}>
              Applied to every scope · not optional
            </span>
          </span>
          <span style={{ fontSize: 15, fontWeight: 800, color: INK.headingDark, ...TABULAR }}>
            {money(adjustmentsUsd)}
          </span>
        </div>
      ) : null}

      {/* One row per selected optional service that carries a setup fee. These
          are inside the one-off total above, so leaving them implicit would make
          the headline figure look wrong to anyone adding up the phases. */}
      {totals.addonLines.map((line) => (
        <div
          key={line.addonId}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            ...DIVIDED,
          }}
        >
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.headingDark }}>
              {line.addonTitle}
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: INK.micro }}>
              {line.tier.label} · one-off setup
            </span>
          </span>
          <span
            style={{ fontSize: 15, fontWeight: 800, color: INK.headingDark, ...TABULAR }}
          >
            {money(line.tier.upfrontUsd)}
          </span>
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 3, ...DIVIDED }}>
        <span style={EYEBROW}>Then, monthly</span>
        <span
          style={{
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            color: INK.headingDark,
            ...TABULAR,
          }}
        >
          {monthlyLabel(totals.monthlyUsd)}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
          {recurringLabel(totals.recurringNames)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          ...DIVIDED,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
          Readiness after this scope
        </span>
        {showReadiness ? (
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, ...TABULAR }}>
            <span
              style={{ fontSize: 15, fontWeight: 800, color: severityColor(currentScore) }}
            >
              {currentScore}
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
              style={{ fontSize: 22, fontWeight: 800, color: severityColor(projected) }}
            >
              {projected}
            </span>
          </span>
        ) : (
          // An em dash, not a number. A projected readiness figure only exists
          // where the scope quotes per-pillar movement; inventing one here would
          // put a forecast on the page the SOW does not stand behind.
          <span
            style={{ fontSize: 15, fontWeight: 700, color: INK.deemphasised, ...TABULAR }}
            title="This scope does not quote a per-pillar score movement"
          >
            —
          </span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
        Removing a phase is a scope decision, not a discount — the findings it addresses stay in
        your reports, unremediated.
      </p>
    </div>
  );
}
