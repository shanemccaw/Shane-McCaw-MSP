import { format } from "date-fns";
import type { TimelineStatus } from "./types";

/** Shared design tokens (README "Shared design tokens" — semantic colours). */
export const RED = "#f87171";
export const AMB = "#fbbf24";
export const GRN = "#34d399";
export const BLU = "#60a5fa";
export const TEAL = "#00B4D8";
export const NEUTRAL = "#e2e8f0";
export const VIO = "#a78bfa";

export const TIMELINE_STATUS_COLOR: Readonly<Record<TimelineStatus, string>> = {
  success: GRN,
  warning: AMB,
  error: RED,
  info: BLU,
  default: "#64748b",
};

/** "4 Sep" — the design's own day format for timeline/schedule rows. */
export function formatDay(iso: string): string {
  return format(new Date(iso), "d MMM");
}

/** "09:12" */
export function formatTime(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

/** "Aug 2026" — Reports panel's period column. */
export function formatReportPeriod(iso: string): string {
  return format(new Date(iso), "MMM yyyy");
}
