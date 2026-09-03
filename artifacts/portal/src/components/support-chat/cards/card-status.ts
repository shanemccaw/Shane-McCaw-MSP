import type { BadgeProps } from "@/components/ui/badge";

/**
 * Maps a real status string (invoice/subscription/scan/purchase — several
 * different enums across the four cards, see contract pack §4) to a Badge
 * variant. Deliberately keyword-based rather than a closed switch: the cards
 * pull from several different DB enums (invoice status, bundle-assignment
 * status, diagnostic-run status, SOW status) and this only needs to bias
 * color, never gate rendering — an unrecognized status still renders, just
 * with the neutral variant.
 */
export function statusBadgeVariant(status: string): NonNullable<BadgeProps["variant"]> {
  const s = status.toLowerCase();
  if (["paid", "active", "completed", "verified", "delivered", "signed"].includes(s)) return "default";
  if (["overdue", "failed", "cancelled", "canceled", "expired"].includes(s)) return "destructive";
  if (["draft", "pending", "not_started"].includes(s)) return "outline";
  return "secondary";
}

export function formatStatusLabel(status: string): string {
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
