/**
 * ProposalAddonCard.tsx — one optional service under the SOW's dashed divider.
 *
 * These sit below the remediation phases and behind an explicit line of copy:
 * *nothing here fixes a finding*. They keep the score the remediation earns, or
 * hand back time — and the card must never be mistakable for a phase, which is
 * why the whole family is teal rather than remediation blue.
 *
 * THE TIER BADGE IS NOT DECORATION
 * --------------------------------
 * `tier.emphasis` decides it, and the two values are not interchangeable:
 *
 *   • `"seat-match"` → "· your seat count". Monitoring tiers are seat-banded, so
 *     the matching band genuinely IS this tenant's seat count.
 *   • `"recommended"` → "· recommended". Adoption tiers are described by delivery
 *     model, not seats; calling one "your seat count" would assert a band that
 *     does not exist.
 *
 * An absent `emphasis` renders neither, so a tier that is merely an option never
 * borrows the authority of a measurement.
 */

import { ScopeToggle } from "./ProposalPhaseCard";
import type { JourneyAddon, JourneyTier } from "./journeyPricing.ts";
import { money } from "./journeyPricing.ts";
import { BRAND, INK, RADIUS, TABULAR } from "./journeyTokens.ts";

/** "· your seat count" / "· recommended" / nothing at all. */
function emphasisSuffix(tier: JourneyTier): string {
  if (tier.emphasis === "seat-match") return " · your seat count";
  if (tier.emphasis === "recommended") return " · recommended";
  return "";
}

/**
 * A tier's price, split so the qualifier can be set smaller than the figure.
 * A one-off with a recurring tail shows both — this is the same discipline the
 * sticky header's "Today … then …" enforces, at line-item scale.
 */
function tierPrice(tier: JourneyTier): { readonly main: string; readonly suffix: string } {
  if (tier.upfrontUsd > 0) {
    return {
      main: money(tier.upfrontUsd),
      suffix: tier.monthlyUsd > 0 ? ` + ${money(tier.monthlyUsd)}/mo` : "",
    };
  }
  return { main: money(tier.monthlyUsd), suffix: "/mo" };
}

function TierCard({
  tier,
  selected,
  onPick,
}: {
  tier: JourneyTier;
  selected: boolean;
  onPick: () => void;
}) {
  const price = tierPrice(tier);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      style={{
        textAlign: "left",
        border: `1px solid ${selected ? BRAND.teal : "rgba(30,41,59,.95)"}`,
        borderRadius: RADIUS.card,
        background: selected ? `${BRAND.teal}1a` : "rgba(2,6,23,.5)",
        padding: "12px 13px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        transition: "border-color 180ms,background 180ms",
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: tier.emphasis ? BRAND.teal : INK.micro,
        }}
      >
        {tier.label}
        {emphasisSuffix(tier)}
      </span>
      <span
        style={{ fontSize: 16, fontWeight: 800, color: INK.headingDark, ...TABULAR }}
      >
        {price.main}
        {price.suffix ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: INK.micro }}>
            {price.suffix}
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: 11, fontWeight: 500, color: INK.micro }}>{tier.detail}</span>
    </button>
  );
}

export function ProposalAddonCard({
  addon,
  active,
  selectedTierId,
  onToggle,
  onPickTier,
}: {
  readonly addon: JourneyAddon;
  readonly active: boolean;
  readonly selectedTierId: string;
  readonly onToggle: () => void;
  /** Picking a tier also switches the service on — clicking a price is intent to buy. */
  readonly onPickTier: (tierId: string) => void;
}) {
  // A service with one tier has nothing to choose between, so it renders as a
  // single row. Drawing a one-cell "grid" would imply a choice the customer does
  // not have.
  const single = addon.tiers.length <= 1;

  return (
    <div
      style={{
        border: `1px solid ${active ? `${BRAND.teal}66` : "rgba(30,41,59,.95)"}`,
        borderRadius: RADIUS.cardLarge,
        background: active ? `${BRAND.teal}12` : "rgba(15,23,42,.4)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: single ? "row" : "column",
        alignItems: single ? "flex-start" : undefined,
        justifyContent: single ? "space-between" : undefined,
        flexWrap: single ? "wrap" : undefined,
        gap: single ? 18 : 15,
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
          flex: single ? "1 1 280px" : undefined,
          minWidth: single ? 0 : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            flex: "1 1 280px",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: INK.headingDark,
            }}
          >
            {addon.title}
          </span>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.6,
              color: INK.bodyDark,
              maxWidth: "50ch",
            }}
          >
            {addon.blurb}
          </p>
        </div>
        {single ? null : (
          <ScopeToggle on={active} tone="optional" label={addon.title} onToggle={onToggle} />
        )}
      </div>

      {single ? (
        <ScopeToggle on={active} tone="optional" label={addon.title} onToggle={onToggle} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(148px,1fr))",
            gap: 9,
            transition: "opacity 200ms",
            // Dimmed, never hidden: the tiers stay legible while the service is
            // off so the customer can see what switching it on would cost.
            opacity: active ? 1 : 0.4,
          }}
        >
          {addon.tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              selected={active && tier.id === selectedTierId}
              onPick={() => onPickTier(tier.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
