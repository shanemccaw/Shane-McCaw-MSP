/**
 * Maps a real status string (invoice/subscription/scan/purchase — several
 * different enums across the four cards, see contract pack §4/§12) to a
 * literal color tone for the card's status pill. Deliberately keyword-based
 * rather than a closed switch: the cards pull from several different DB
 * enums (invoice status, bundle-assignment status, diagnostic-run status,
 * SOW status), none of them a `pgEnum`, and this only needs to bias color,
 * never gate rendering — an unrecognized status still renders, just with the
 * neutral tone.
 */
export interface StatusTone {
  ink: string;
  bg: string;
  bd: string;
}

const GREEN: StatusTone = { ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" };
const AMBER: StatusTone = { ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" };
const RED: StatusTone = { ink: "#f87171", bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.28)" };
const NEUTRAL: StatusTone = { ink: "#94a3b8", bg: "rgba(148,163,184,.10)", bd: "rgba(148,163,184,.26)" };

export function statusTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (["paid", "active", "completed", "verified", "delivered", "signed", "registered"].includes(s)) return GREEN;
  if (["overdue", "failed", "cancelled", "canceled", "expired"].includes(s)) return RED;
  if (["draft", "pending", "due", "not_started", "trial"].includes(s)) return AMBER;
  return NEUTRAL;
}

export function formatStatusLabel(status: string): string {
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
