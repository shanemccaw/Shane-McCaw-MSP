/**
 * CheckoutPaymentChoice.tsx — pay in full, or phased.
 *
 * Two cards of EQUAL weight. Not a recommended option with a smaller, greyer
 * alternative underneath it: the phased plan is a real commercial choice Shane
 * offers, and burying it would be a nudge dressed as a layout. Same width, same
 * type scale, same border treatment; only the selected one gains the brand
 * border and tint, and that is a response to the customer's click rather than a
 * default the design pre-loads in Shane's favour.
 *
 * Picking "Phased" expands the entire breakdown immediately, with the terms
 * attached. A plan whose later invoices are not shown until after payment is the
 * thing that makes people distrust instalment plans.
 *
 * WHY THE PHASED TERMS ARE A DISCRIMINATED UNION
 * ---------------------------------------------
 * Because the design's phased plan and the platform's phased plan are not the
 * same product, and this component must not be able to confuse them.
 *
 * The design draws a 40% deposit taken today, then per-phase invoices due 14 days
 * from each sign-off. The platform does none of that: `GET
 * /portal/assessment/sow/payment-options` returns `phased: { selfServe: false }`
 * with an informational per-phase breakdown and NO deposit percentage anywhere,
 * and `POST .../sow/checkout` on a phased plan records an
 * `awaiting_provider_setup` agreement without calling Stripe at all. There is no
 * deposit, no charge, and no stated payment term.
 *
 * So `kind: "deposit"` carries the fixture percentage and is reachable only under
 * `?preview=design`; `kind: "provider"` is what a paying customer sees, and it
 * can only say what the endpoint genuinely describes. Neither variant can render
 * the other's copy, because neither carries the other's fields.
 */

import { money, type ScheduleRow } from "./journeyPricing.ts";
import { BRAND, INK, RADIUS, TABULAR } from "./journeyTokens.ts";

export type PaymentPlan = "full" | "phased";

/**
 * What the phased option actually is, on this render.
 *
 * `deposit` — the design's worked example. A percentage taken today and a dated
 * invoice schedule. FIXTURE ONLY: nothing in the platform produces a deposit
 * percentage, so this variant must never be constructed on a live render.
 *
 * `provider` — the real product. The programme is invoiced phase by phase and
 * arranged directly by the provider; this page charges nothing when it is
 * chosen. `schedule` is the server's own per-phase breakdown from
 * `payment-options`, shown as indicative because that is exactly what the
 * endpoint calls it.
 */
export type PhasedTerms =
  | {
      readonly kind: "deposit";
      readonly depositUsd: number;
      readonly depositPct: number;
      readonly schedule: readonly ScheduleRow[];
    }
  | {
      readonly kind: "provider";
      /** The whole programme — not a charge, and never labelled "today". */
      readonly totalUsd: number;
      readonly schedule: readonly ScheduleRow[];
    };

const CARD_BORDER_OFF = "rgba(30,41,59,.95)";
const CARD_BORDER_ON = "rgba(0,120,212,.55)";
const CARD_BG_OFF = "rgba(15,23,42,.45)";
const CARD_BG_ON = "rgba(0,120,212,.08)";
const RING_OFF = "rgba(71,85,105,.9)";

function ChoiceCard({
  title,
  subtitle,
  selected,
  onSelect,
  amount,
  amountSuffix,
  body,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly amount: string;
  readonly amountSuffix?: string;
  readonly body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        // The whole card is the control, so it is a real button — a clickable
        // div here would leave the phased plan unreachable from the keyboard,
        // which is exactly the "buried alternative" this layout refuses to be.
        appearance: "none",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        border: `1px solid ${selected ? CARD_BORDER_ON : CARD_BORDER_OFF}`,
        borderRadius: RADIUS.cardLarge,
        background: selected ? CARD_BG_ON : CARD_BG_OFF,
        padding: "18px 19px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color 200ms, background 200ms",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: BRAND.offWhite,
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>{subtitle}</span>
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: `1px solid ${selected ? BRAND.blue : RING_OFF}`,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "border-color 180ms",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: selected ? BRAND.blue : "transparent",
              transition: "background 180ms",
            }}
          />
        </span>
      </span>

      <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.025em",
            color: BRAND.offWhite,
            ...TABULAR,
          }}
        >
          {amount}
        </span>
        {amountSuffix ? (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.micro }}>{amountSuffix}</span>
        ) : null}
      </span>

      <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}>
        {body}
      </span>
    </button>
  );
}

export function CheckoutPaymentChoice({
  plan,
  onPlan,
  payInFullUsd,
  phased,
  hasRecurring,
}: {
  readonly plan: PaymentPlan;
  readonly onPlan: (plan: PaymentPlan) => void;
  /** What a pay-in-full checkout actually charges — the server's own total. */
  readonly payInFullUsd: number;
  readonly phased: PhasedTerms;
  /**
   * Drives one clause only. "Monitoring bills separately from month one" is a
   * true statement about a scope that carries a recurring service and a false
   * one about a scope that does not, so the sentence is not printed when nothing
   * recurs.
   */
  readonly hasRecurring: boolean;
}) {
  const isDeposit = phased.kind === "deposit";
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
        How you would like to pay
      </span>

      <div
        role="radiogroup"
        aria-label="How you would like to pay"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(258px,1fr))",
          gap: 12,
        }}
      >
        <ChoiceCard
          title="Pay in full"
          subtitle="One charge today"
          selected={plan === "full"}
          onSelect={() => onPlan("full")}
          amount={money(payInFullUsd)}
          body={
            hasRecurring
              ? "The whole remediation programme settled now. Monitoring bills separately from month one."
              : "The whole remediation programme settled now."
          }
        />
        <ChoiceCard
          title="Phased"
          subtitle={isDeposit ? "Deposit now, rest per phase" : "Invoiced phase by phase"}
          selected={plan === "phased"}
          onSelect={() => onPlan("phased")}
          amount={money(isDeposit ? phased.depositUsd : phased.totalUsd)}
          // "today" is a claim about a charge. The live phased plan makes no
          // charge here at all, so the suffix names the whole programme instead.
          amountSuffix={isDeposit ? "today" : "across phases"}
          body={
            isDeposit
              ? `${phased.depositPct}% deposit. Each remaining phase is invoiced on the day that phase is signed off as complete — nothing charges ahead of delivered work.`
              : "The same programme, invoiced phase by phase rather than in one payment. Nothing is charged on this page — your signed scope goes to your provider, who arranges the billing for each phase with you."
          }
        />
      </div>

      {plan === "phased" ? (
        <div
          style={{
            border: "1px solid rgba(0,180,216,.3)",
            borderRadius: 12,
            background: "rgba(0,180,216,.06)",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: BRAND.teal,
            }}
          >
            {isDeposit ? "Your invoice schedule" : "Indicative phase breakdown"}
          </span>
          {/* An empty breakdown renders no list rather than an empty heading —
              `payment-options` genuinely returns no phases for a scope whose
              workstreams the active document does not carry, and a blank
              schedule under a "breakdown" label reads as a loading state. */}
          <div
            style={{
              display: phased.schedule.length > 0 ? "flex" : "none",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {phased.schedule.map((row) => (
              <span
                key={row.when}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: INK.bodyDark }}>
                  {row.when}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: BRAND.offWhite,
                    ...TABULAR,
                  }}
                >
                  {money(row.amountUsd)}
                </span>
              </span>
            ))}
          </div>
          {/* The design's "due 14 days from the sign-off date" is not printed on
              a live render. No payment term for phased billing exists anywhere in
              this platform — not on `payment-options`, not on the agreement row,
              not in the products catalogue — so stating one on the screen a
              customer signs from would be inventing a commercial term. What the
              endpoint does say is that milestone billing is provider-arranged and
              the breakdown is informational, and that is what this says. */}
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
            {isDeposit
              ? "Each invoice is due 14 days from the sign-off date. You approve every phase as complete before it bills."
              : "This breakdown is indicative — it splits your signed scope by phase. Billing for each phase, including when each invoice is raised and its payment terms, is arranged directly with your provider rather than charged here."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
