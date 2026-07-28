// artifacts/admin-panel/src/components/ai-billing/format.ts
//
// Display formatting for the AI Billing surface (initiative:
// ai-cost-governance-billing-rollup). Shared by AiBillingPage.tsx and the
// Phase 4 trends section so the ledger and the charts read identically.
//
// Every amount that crosses the wire is integer cents. Cents become currency
// HERE and nowhere else — no component does its own division, and nothing
// upstream of this file holds a fractional dollar.

/** Integer cents to a display string. The ledger carries no finer precision. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Compact form for chart axes, where a column of "$1,234.00" costs more room
 * than it earns. Whole dollars above $10; cents below, since sub-dollar spend is
 * exactly where the difference between $0.04 and $0.40 matters.
 */
export function formatCentsCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  if (Math.abs(dollars) >= 10) return `$${Math.round(dollars)}`;
  return `$${dollars.toFixed(2)}`;
}

/**
 * A ratio in basis points as a multiple ("4.2x"). Null means the baseline was
 * zero and the ratio is undefined — the caller shows the new-spend wording
 * instead of a fabricated number.
 */
export function formatRatio(ratioBps: number | null): string | null {
  if (ratioBps == null) return null;
  return `${(ratioBps / 10_000).toFixed(1)}x`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Label a bucket key for an axis or a list.
 *
 * The key is formatted from its own parts rather than through `new Date()`:
 * "2026-07-28" parses as UTC midnight, which in any negative-offset timezone
 * renders as the 27th. The server already resolved these keys in the viewer's
 * calendar, so re-interpreting them here would move every label back a day.
 */
export function formatBucketLabel(bucketKey: string, bucket: "day" | "week" | "month"): string {
  const parts = bucketKey.split("-");
  const year = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const month = MONTHS[monthIdx] ?? parts[1] ?? "";

  if (bucket === "month") return `${month} ${year}`;
  if (bucket === "week") return `w/c ${month} ${day}`;
  return `${month} ${day}`;
}
