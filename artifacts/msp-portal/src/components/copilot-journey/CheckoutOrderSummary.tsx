/**
 * CheckoutOrderSummary.tsx — the signed scope, locked.
 *
 * READ ONLY, deliberately and completely. There is not a single handler in this
 * file. Adjustment happened on the SOW; by the time a customer is here they have
 * put a signature against a specific set of phases at a specific price, and a
 * control that could change either would mean the thing they signed and the
 * thing they are paying for are not the same document. So every row renders as
 * text — no toggle, no tier picker, no "edit" affordance. The only way back to a
 * decision is the "Back to the signed proposal" link on the page itself.
 *
 * Nothing here computes. The page hands down rows it derived from
 * `computeTotals(scope, selection)`, so the summary on this screen and the
 * summary rail on the proposal cannot disagree — they are the same arithmetic.
 */

import { Lock } from "lucide-react";

import { PillarSwatch } from "./JourneyPrimitives";
import { money, monthlyLabel } from "./journeyPricing.ts";
import { BRAND, INK, PILLARS, RADIUS, TABULAR, type PillarKey } from "./journeyTokens.ts";

/** Cards on this screen share the design's slightly firmer hairline. */
const CARD_BORDER = "1px solid rgba(30,41,59,.95)";
const ROW_DIVIDER = `1px solid ${INK.hairlineDark}`;

export interface OrderPhaseRow {
  readonly id: string;
  readonly title: string;
  /**
   * `null` when the platform's own scope document does not say which pillar's
   * findings this phase closes. The swatch is an identity claim — "this is a
   * Governance fix" — so an unknown pillar renders no swatch rather than a
   * guessed colour, which would mislabel the finding the customer is buying.
   */
  readonly pillar: PillarKey | null;
  readonly priceUsd: number;
}

export interface OrderRecurringRow {
  readonly id: string;
  readonly title: string;
  /** "Recurring · 1,000–2,500 seats · cancel with 30 days". */
  readonly detail: string;
  readonly monthlyUsd: number;
}

/**
 * A mandatory price line — "Tenant Size Adjustment Factor", "Price Adjustments".
 *
 * NOT a phase, and never rendered as one. The platform's `sow_pricing_lines`
 * carries these with `line_type: "adjustment"`; they are never in
 * `selectedWorkstreamTitles`, they carry no week estimate and no findings, and
 * `effectiveSowTotals()` adds them to the charge unconditionally. So they get
 * their own labelled band — the same treatment `AssessmentSowSelector.tsx` gives
 * them — rather than being counted in "N phases" or swept into the phase list,
 * which is what made the live checkout unpayable.
 */
export interface OrderAdjustmentRow {
  readonly id: string;
  readonly title: string;
  /** Prose from the pricing line, when it carries any. */
  readonly scope: string;
  readonly priceUsd: number;
}

export function CheckoutOrderSummary({
  phases,
  recurring,
  adjustments = [],
}: {
  readonly phases: readonly OrderPhaseRow[];
  readonly recurring: readonly OrderRecurringRow[];
  readonly adjustments?: readonly OrderAdjustmentRow[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".22em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        {`Order summary · ${phases.length} ${phases.length === 1 ? "phase" : "phases"}`}
      </span>

      <div
        style={{
          border: CARD_BORDER,
          borderRadius: RADIUS.cardLarge,
          background: "rgba(15,23,42,.5)",
          overflow: "hidden",
        }}
      >
        {phases.map((row, i) => (
          <div
            key={row.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "14px 18px",
              // The last phase row keeps its divider only when another band
              // follows it; otherwise the card's own border closes the list.
              borderBottom:
                i < phases.length - 1 || adjustments.length > 0 || recurring.length > 0
                  ? ROW_DIVIDER
                  : undefined,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              {row.pillar ? <PillarSwatch pillar={row.pillar} /> : null}
              <span style={{ fontSize: 13.5, fontWeight: 600, color: BRAND.offWhite }}>
                {row.title}
              </span>
              {row.pillar ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: INK.micro }}>
                  {PILLARS[row.pillar].label}
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: BRAND.offWhite,
                flex: "none",
                ...TABULAR,
              }}
            >
              {money(row.priceUsd)}
            </span>
          </div>
        ))}

        {/* Mandatory price lines. Labelled, locked, and stated as included so
            the rows above plus this band actually add up to the total in the
            rail — a customer reading down the page must be able to reach the
            figure they are about to pay. */}
        {adjustments.length > 0 ? (
          <div
            style={{
              padding: "13px 18px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: "rgba(2,6,23,.25)",
              borderBottom: recurring.length > 0 ? ROW_DIVIDER : undefined,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: INK.micro,
              }}
            >
              <Lock size={11} strokeWidth={2.2} color={INK.micro} aria-hidden="true" />
              Included adjustments
            </span>
            {adjustments.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: BRAND.offWhite }}>
                    {row.title}
                  </span>
                  {row.scope ? (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 500,
                        lineHeight: 1.55,
                        color: INK.micro,
                        maxWidth: "56ch",
                      }}
                    >
                      {row.scope}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: BRAND.offWhite,
                    flex: "none",
                    ...TABULAR,
                  }}
                >
                  {money(row.priceUsd)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Recurring services sit on a darker band — they are the one part of
            this order that does not settle today, and reading as a different
            kind of line is the point. */}
        {recurring.map((row, i) => (
          <div
            key={row.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "14px 18px",
              background: "rgba(2,6,23,.4)",
              borderBottom: i < recurring.length - 1 ? ROW_DIVIDER : undefined,
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: BRAND.offWhite }}>
                {row.title}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: INK.micro }}>
                {row.detail}
              </span>
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: BRAND.teal,
                flex: "none",
                ...TABULAR,
              }}
            >
              {monthlyLabel(row.monthlyUsd)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
