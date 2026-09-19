import type {
  PillarCoverageSegmentKind,
  PillarCoverageWire,
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
