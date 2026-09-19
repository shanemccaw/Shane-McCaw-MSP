import type { PillarSignalCardWire, PillarSignalsWire } from "./types";
import {
  SIGNAL_ICON_PATHS,
  SIGNAL_TIER_DISPLAY,
  relativeTime,
  signalBars,
  signalDeltaText,
  signalSubText,
  signalValueFontSize,
  signalValueText,
} from "./pillarDisplay";

const RULE = "rgba(255,255,255,.06)";

function SignalCard({ card }: { card: PillarSignalCardWire }) {
  const tier = SIGNAL_TIER_DISPLAY[card.tier];
  const value = signalValueText(card);
  const sub = signalSubText(card);
  const delta = signalDeltaText(card);
  return (
    <div
      className="flex min-w-0 flex-col gap-[2px] overflow-hidden rounded-[12px] px-[15px] pb-[12px] pt-[13px]"
      style={{ gridColumn: `span ${card.span}`, background: tier.bg, border: tier.border }}
      // The real fired-rule sentence behind a non-good tier, when one fired.
      title={card.ruleLabel}
      data-testid={`pillar-signal-card-${card.checkKey}`}
      data-signal-tier={card.tier}
      data-signal-reason={card.unavailableReason}
    >
      <div className="flex items-center gap-[9px]">
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke={tier.ink}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-none"
        >
          <path d={SIGNAL_ICON_PATHS[card.icon] ?? SIGNAL_ICON_PATHS.grid} />
        </svg>
        <span
          className="whitespace-nowrap font-extrabold leading-none text-[#f8fafc]"
          style={{ fontSize: signalValueFontSize(value), fontVariantNumeric: "tabular-nums" }}
          data-testid={`pillar-signal-value-${card.checkKey}`}
        >
          {value}
        </span>
        {delta ? (
          <span className="text-[10.5px] font-bold" style={{ color: delta.flat ? "#475569" : "#00B4D8" }}>
            {delta.text}
          </span>
        ) : null}
        <div className="ml-auto flex h-[12px] flex-none items-end gap-[2.5px]">
          {signalBars(card).map((bar, i) => (
            <span
              key={i}
              className="w-[4px] rounded-[1px]"
              style={{ height: bar.height, background: bar.filled ? tier.ink : "rgba(148,163,184,.30)" }}
            />
          ))}
        </div>
      </div>
      <span className="pt-[5px] text-[13px] font-semibold leading-[1.35] text-[#f8fafc]">{card.label}</span>
      {sub ? (
        <span className="text-[11px] leading-[1.4] text-[#64748b]" data-testid={`pillar-signal-sub-${card.checkKey}`}>
          {sub}
        </span>
      ) : null}
      <div className="mt-auto flex min-w-0 items-center gap-[6px] pt-[9px]">
        <span className="size-[6px] flex-none rounded-full" style={{ background: tier.ink }} />
        <span className="text-[10.5px] font-bold" style={{ color: tier.ink }}>
          {tier.status}
        </span>
      </div>
    </div>
  );
}

/**
 * "SIGNALS — WHAT WAS MEASURED" (`Pillar Pages.dc.html`, Git #4578): the
 * design's grouped card grid, every card the tenant's real latest observation of
 * one catalog check.
 *
 * A card that could not be measured shows "—" and its real reason (the licence
 * feature the scan reported, the Microsoft service that did not answer, or
 * simply that the check never ran) — never a zero. Every figure, delta and tier
 * arrives from the server already resolved; nothing here computes a number.
 *
 * The design's "View all checks" link is deliberately not rendered: it opens the
 * per-check drill-down, which is out of scope for this build (#1621 leaves it as
 * an open architecture question) and has no destination to link to yet.
 */
export function PillarSignalsGrid({ signals, pillarLabel }: { signals: PillarSignalsWire; pillarLabel: string }) {
  const meta = signals.latestObservedAt
    ? `${signals.cardCount} checks · latest observation ${relativeTime(signals.latestObservedAt)}`
    : `${signals.cardCount} checks · none observed yet`;
  const label = pillarLabel.toLowerCase();
  const more =
    signals.uncardedCheckCount === 0
      ? `Complete — every catalog check that feeds ${label} is on this page.`
      : `+ ${signals.uncardedCheckCount} more checks feed ${label} — every card is a real catalog check`;

  return (
    <div className="flex flex-col gap-2" data-testid="pillar-signals">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-[.13em] text-[#64748b]">SIGNALS — WHAT WAS MEASURED</span>
        <div className="h-px flex-1" style={{ background: RULE }} />
        <span className="text-[10.5px] text-[#475569]" data-testid="pillar-signals-meta">
          {meta}
        </span>
      </div>

      {signals.groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-2 pt-[2px]" data-testid={`pillar-signal-group-${group.title}`}>
          <span className="text-[10px] font-semibold tracking-[.14em] text-[#475569]">{group.title}</span>
          <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
            {group.cards.map((card) => (
              <SignalCard key={card.checkKey} card={card} />
            ))}
          </div>
        </div>
      ))}

      <div className="px-[2px] pt-[2px]">
        <span className="text-[11px] text-[#475569]" data-testid="pillar-signals-more">
          {more}
        </span>
      </div>
    </div>
  );
}
