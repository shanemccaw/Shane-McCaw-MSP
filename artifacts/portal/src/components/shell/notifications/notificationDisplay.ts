import {
  AlertTriangle,
  GitCompare,
  TrendingUp,
  ClipboardCheck,
  Wrench,
  CreditCard,
  LifeBuoy,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { isToday, isYesterday, format } from "date-fns";
import type { PortalNotificationSeverity } from "./types";

/**
 * The seven customer-alert categories `docs/alert_preferences.md` documents
 * (`customer-alert-delivery.ts` `CUSTOMER_ALERT_BALANCED_DEFAULTS` keys) plus
 * a fallback for anything else `notificationsTable.category` carries (it's a
 * free-text column — other callers, e.g. `sales-offer-engine.ts`, use their
 * own category strings). Icon choice is semantic, same allowance
 * `moduleNav.ts` already documents for this shell: no hand-tuned icon-path
 * parity requirement the way pillar identity colours have.
 */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  findings: AlertTriangle,
  drift: GitCompare,
  progress: TrendingUp,
  reviews: ClipboardCheck,
  remediation: Wrench,
  billing: CreditCard,
  support: LifeBuoy,
};

export function iconForCategory(category: string | null): LucideIcon {
  if (!category) return Bell;
  return CATEGORY_ICONS[category] ?? Bell;
}

/** `notificationsTable.severity` enum -> README "Design tokens" semantic colours. */
export const SEVERITY_COLOR: Record<PortalNotificationSeverity, string> = {
  info: "#60a5fa",
  warning: "#fbbf24",
  critical: "#f87171",
};

export type NotificationDayGroup = "TODAY" | "EARLIER";

export function dayGroupFor(createdAt: string): NotificationDayGroup {
  return isToday(new Date(createdAt)) ? "TODAY" : "EARLIER";
}

/** "09:41" today · "Yesterday 16:04" · "Aug 27 · 15:50" older — README row spec. */
export function formatNotificationTime(createdAt: string): string {
  const d = new Date(createdAt);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return `Yesterday ${format(d, "HH:mm")}`;
  return format(d, "MMM d '·' HH:mm");
}
