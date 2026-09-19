import type {
  PillarCoverageSegmentKind,
  PillarCoverageWire,
  PillarDriftDomainWire,
  PillarDriftState,
  PillarSignalCardWire,
  PillarSignalTier,
  PillarStatUnit,
  PillarStatWire,
} from "./types";

/**
 * Customer-safe copy for a stat's `unavailableReason` (pillar-summary-
 * stats.ts / dashboard-resolvers.ts's real machine-stable reason codes).
 * Not exhaustive by construction — a reason not listed here still renders
 * (see `unavailableCopy`'s fallback) rather than throwing, because the
 * reason catalogue is DB/registry-resident and can grow without this file
 * changing.
 */
const REASON_COPY: Record<string, string> = {
  no_data: "ran, found nothing to report",
  not_in_scan_package: "not in your current scan package",
  license_gap: "needs a licence this tenant doesn't have",
  unknown_check_key: "not wired to a check yet",
  unknown_metric_key: "not wired to a check yet",
  resolver_error: "couldn't be read this scan",
  no_seat_data: "no licence seat data on file",
  no_sku_prices: "no price on file for this tenant's SKUs",
  non_numeric_value: "couldn't be read as a number",
  insufficient_data: "not enough data yet to score",
  no_evaluable_rules: "nothing evaluates this yet",
  service_not_configured: "this Microsoft service isn't licensed on this tenant",
  not_collected: "not collected yet",
  no_snapshot: "no snapshot on file yet",
  // Git #4578 — the SIGNALS grid's own reasons. The first three are the design's
  // own words for a card that cannot be measured; the rest name the real cause.
  inactive_in_catalog: "inactive in catalog — can never run",
  never_run: "never run for this tenant",
  check_error: "the check errored — no data, never zero",
  gate_skipped: "this check doesn't apply to this tenant's setup",
  security_defaults_active: "This tenant uses Security Defaults instead of Conditional Access",
  no_scalar_defined: "this check returns a list, not one figure",
};

/** Honest fallback for a reason code with no authored copy: "not_in_scan_package" → "not in scan package". */
function fallbackReasonCopy(reason: string): string {
  return reason.replace(/_/g, " ");
}

export function unavailableCopy(reason: string | undefined): string {
  if (!reason) return "not available";
  return REASON_COPY[reason] ?? fallbackReasonCopy(reason);
}

/** "1,204" / "38%" / "$847,608" — the real number, formatted for its declared unit. Never called for a null value. */
export function formatStatValue(value: number, unit: PillarStatUnit): string {
  if (unit === "currency") {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  if (unit === "percent") {
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  }
  return value.toLocaleString("en-US");
}

/** The stat tile's big number, or the honest unavailable reason when `value` is null. */
export function statDisplay(stat: PillarStatWire): { big: string; unavailable: boolean; sub: string | null } {
  if (stat.value == null) {
    const reasonCopy = unavailableCopy(stat.unavailableReason);
    return {
      big: "—",
      unavailable: true,
      sub: stat.licenseFeature ? `Needs ${stat.licenseFeature}` : reasonCopy,
    };
  }
  // Git #4560 — the server's own real sub-caption (design copy, tenant's
  // number). Null when the check produced no denominator to put in it.
  return { big: formatStatValue(stat.value, stat.unit), unavailable: false, sub: stat.sub ?? null };
}

/**
 * The design's coverage-bar palette and legend wording
 * (`Pillar Pages.dc.html` → `SEGC` + `covLegend`), one entry per real segment
 * kind. Copy is the design's, verbatim; every COUNT beside it is the tenant's.
 */
export const COVERAGE_SEGMENT_DISPLAY: Record<
  PillarCoverageSegmentKind,
  { color: string; label: string }
> = {
  ok: { color: "#34d399", label: "observed with data" },
  gap: { color: "#64748b", label: "licence-gated — your SKUs can't feed them" },
  blocked: { color: "#fbbf24", label: "errored or can't run" },
  queued: { color: "#334155", label: "wired, waiting on the first scan" },
};

/**
 * The design's blocked-note sentence, built from the tenant's REAL blocked
 * checks and the REAL Microsoft services that refused — never the design's
 * hardcoded example prose. Null when nothing is blocked.
 *
 * The closing clause is the design's own, verbatim and load-bearing: an
 * errored check has no data, which is not the same as a measured zero.
 */
export function blockedNote(coverage: PillarCoverageWire): string | null {
  const blocked = coverage.segments.find((s) => s.kind === "blocked");
  if (!blocked || blocked.count === 0) return null;
  const checkWord = blocked.count === 1 ? "check" : "checks";
  const services = coverage.blockedServices.length
    ? ` ${coverage.blockedServices.join(" and ")} did not answer for this tenant.`
    : "";
  return `${blocked.count} ${checkWord} could not run this scan.${services} Errored means no data — never zero.`;
}

/**
 * "+4 since last scan" / "−7 since last scan" / "no change" / null (not
 * enough history) — derived from the real trend series
 * (`PillarSummaryCard.trend`), never a separate fabricated delta field. The
 * series is oldest→newest (pillar-trend.ts), so the last two points are the
 * most recent two real scores.
 */
export function trendDeltaLabel(trend: { series: number[] } | null): string | null {
  if (!trend || trend.series.length < 2) return null;
  const series = trend.series;
  const delta = series[series.length - 1]! - series[series.length - 2]!;
  if (delta === 0) return "no change since last scan";
  return `${delta > 0 ? "+" : ""}${delta} since last scan`;
}

// ── Licensing SKU ledger (Git #4578) ─────────────────────────────────────────

/**
 * The design's own chip wording for a SKU left out of the waste maths
 * (`Pillar Pages.dc.html` → `ledgerEx`: "zero price" / "no price on file"),
 * keyed by the server's real `UnpaidSkuReason`. An unlisted reason still
 * renders, spelled out, rather than being hidden.
 */
const LEDGER_EXCLUDED_COPY: Record<string, string> = {
  zero_price: "zero price",
  no_price_on_file: "no price on file",
};

export function ledgerExcludedReason(reason: string): string {
  return LEDGER_EXCLUDED_COPY[reason] ?? reason.replace(/_/g, " ");
}

/** Whole cents → "$23.00" (`fractional`) or "$847" — the ledger's price column vs its waste column. */
export function formatCents(cents: number, fractional: boolean): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: fractional ? 2 : 0,
  });
}

/** "×10,000" — the design's purchased-count marker beside an excluded SKU. */
export function formatPurchasedMultiple(purchased: number): string {
  return `×${purchased.toLocaleString("en-US")}`;
}

/**
 * The ledger footnote's real sentence: how many of the tenant's SKUs carry a
 * price at all. The words are the design's, the two numbers are the tenant's.
 */
export function ledgerFootnote(pricedCount: number, totalCount: number): string {
  return `Waste is computed only where a real unit price is on file — ${pricedCount} of ${totalCount} SKUs today. Excluded is a rendered state, not a hidden one.`;
}

// ── CONFIG DRIFT BASELINE (Git #4578) ────────────────────────────────────────

/** The design's pill wording per real collector state (`Pillar Pages.dc.html` → `driftState`). */
export const DRIFT_STATE_LABEL: Record<PillarDriftState, string> = {
  tracked: "tracked",
  not_comparable: "not comparable",
  error: "error",
};

/**
 * The design's explanatory note under a drift domain, with the tenant's real
 * numbers/reason substituted. The two design sentences are kept verbatim; the
 * collector's own recorded reason is appended for the two states that have one,
 * because "not comparable" with no cause is the shrug the design's own copy
 * ("reported as such rather than papered over") says not to give.
 *
 * `error` is not in the design (it has only tracked / not comparable) — it is
 * the collector's third real outcome, and it must not read as "clean".
 */
export function driftNote(domain: PillarDriftDomainWire): string {
  if (domain.state === "tracked") {
    const captured = domain.baselineCapturedAt
      ? `Baseline captured ${new Date(domain.baselineCapturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : "Baseline captured";
    const n = domain.deviationCount;
    return `${captured} · ${n} deviation${n === 1 ? "" : "s"} since. A drift event appears the moment a tracked setting changes.`;
  }
  const reason = domain.reason ? ` Collector's reason: ${domain.reason.replace(/_/g, " ")}.` : "";
  if (domain.state === "not_comparable") {
    return `The drift collector can't diff this shape yet — an honest limitation, reported as such rather than papered over.${reason}`;
  }
  return `The last drift collection errored, so nothing was compared — that is not the same as no drift.${reason}`;
}

// ── SIGNALS grid (Git #4578) ─────────────────────────────────────────────────

/**
 * The design's card icon set (`Pillar Pages.dc.html` → `SICON`), resolved from
 * the icon key the server sends. An unknown key falls back to `grid` rather than
 * rendering an empty box.
 */
export const SIGNAL_ICON_PATHS: Record<string, string> = {
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  shield: "M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1z",
  mail: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4",
  device: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  grid: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  chart: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
};

/**
 * The design's tier palette (`CTIER`), plus `ungraded`: a check that was measured
 * but that no severity rule judges. It gets the neutral ink of `na` (nothing is
 * being asserted about it) but a solid border, so it reads as "we have a number"
 * rather than "we could not take one".
 */
export const SIGNAL_TIER_DISPLAY: Record<
  PillarSignalTier,
  { bg: string; border: string; ink: string; status: string; barShort: string; barTall: string }
> = {
  bad: { bg: "linear-gradient(135deg, rgba(248,113,113,.13), rgba(2,6,23,0) 75%)", border: "1px solid rgba(248,113,113,.34)", ink: "#f87171", status: "Not yet addressed", barShort: "7px", barTall: "12px" },
  meh: { bg: "linear-gradient(135deg, rgba(251,191,36,.10), rgba(2,6,23,0) 75%)", border: "1px solid rgba(251,191,36,.26)", ink: "#fbbf24", status: "Partially addressed", barShort: "5px", barTall: "9px" },
  good: { bg: "linear-gradient(135deg, rgba(52,211,153,.09), rgba(2,6,23,0) 75%)", border: "1px solid rgba(52,211,153,.24)", ink: "#34d399", status: "Fully covered", barShort: "6px", barTall: "8px" },
  na: { bg: "rgba(148,163,184,.03)", border: "1px dashed rgba(148,163,184,.28)", ink: "#64748b", status: "Can't be measured", barShort: "2px", barTall: "2px" },
  ungraded: { bg: "rgba(148,163,184,.03)", border: "1px solid rgba(148,163,184,.20)", ink: "#94a3b8", status: "Measured — nothing grades this", barShort: "5px", barTall: "9px" },
};

/** The card's big figure: the real number/text, or "—" when the check could not be measured. */
export function signalValueText(card: PillarSignalCardWire): string {
  if (card.text != null) return card.text;
  if (card.value != null) return formatStatValue(card.value, card.format === "percent" ? "percent" : "count");
  return "—";
}

/** The design's three figure sizes, by how long the figure is. */
export function signalValueFontSize(text: string): string {
  return text.length > 6 ? "15px" : text.length > 4 ? "18px" : "22px";
}

/**
 * The card's sub-caption: the real caption for a measured card; for one that
 * could not be measured, the real reason — naming the licence feature or the
 * Microsoft service the tenant's own scan reported, never a bare "unavailable".
 */
export function signalSubText(card: PillarSignalCardWire): string | null {
  if (card.tier !== "na") return card.sub ?? null;
  if (card.unavailableReason === "license_gap" && card.licenseFeature) return `Needs ${card.licenseFeature}`;
  if (card.unavailableReason === "service_not_configured" && card.serviceName) {
    return `${card.serviceName} did not answer for this tenant`;
  }
  return unavailableCopy(card.unavailableReason);
}

/** "+2" / "±0" / "-1", or null when there is no real previous value to compare with. */
export function signalDeltaText(card: PillarSignalCardWire): { text: string; flat: boolean } | null {
  if (card.delta == null) return null;
  if (card.delta === 0) return { text: "±0", flat: true };
  return { text: `${card.delta > 0 ? "+" : ""}${card.delta.toLocaleString("en-US")}`, flat: false };
}

/**
 * The design's five history bars: one filled bar per stored observation (up to
 * five), the rest dashes. A card that could not be measured is all dashes.
 */
export function signalBars(card: PillarSignalCardWire): { height: string; filled: boolean }[] {
  const t = SIGNAL_TIER_DISPLAY[card.tier];
  return Array.from({ length: 5 }, (_, i) =>
    card.tier !== "na" && i < card.history
      ? { height: i % 2 === 0 ? t.barShort : t.barTall, filled: true }
      : { height: "2px", filled: false },
  );
}

/** "2 hours ago" for the grid's "latest observation" note. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return unit(Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), "hour");
  return unit(Math.floor(seconds / 86400), "day");
}
