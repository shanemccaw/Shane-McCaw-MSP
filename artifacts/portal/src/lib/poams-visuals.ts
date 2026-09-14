/**
 * Display-only derivations for POA&Ms (#4037) — colour/label lookups for the
 * server's own six status words (`docs/portal/poams-contract-pack.md` §3). An
 * unrecognised value renders as its own raw text in a neutral style rather
 * than being coerced into a bucket it does not belong in, same rule
 * `risk-register-visuals.ts` already applies to its own vocabularies.
 */
import type { PoamStatus } from "@/lib/poams-types";

export interface Swatch {
  readonly label: string;
  readonly text: string;
  readonly bg: string;
  readonly border: string;
}

const NEUTRAL: Swatch = {
  label: "",
  text: "text-muted-foreground",
  bg: "bg-transparent",
  border: "border-border",
};

const POAM_STATUS_SWATCH: Record<string, Swatch> = {
  draft: { label: "Draft", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  pending_signature: { label: "Awaiting signature", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  active: { label: "Active", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  completed: { label: "Completed", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  cancelled: { label: "Cancelled", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  converted_to_risk_acceptance: {
    label: "Converted to risk acceptance",
    text: "text-status-violet",
    bg: "bg-status-violet/10",
    border: "border-status-violet/30",
  },
};

export function poamStatusSwatch(status: PoamStatus): Swatch {
  return POAM_STATUS_SWATCH[status] ?? { ...NEUTRAL, label: status };
}

/** True for a status the MSP-side console can still change (unsigned, or
 * signed and running). A closed plan (`cancelled` / `completed` /
 * `converted_to_risk_acceptance`) keeps its final word rather than being
 * re-derived. */
export function isPoamClosed(status: PoamStatus): boolean {
  return status === "cancelled" || status === "completed" || status === "converted_to_risk_acceptance";
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
    " UTC"
  );
}

/** "27 Aug 2026" from a real `YYYY-MM-DD` date-only string — no timezone
 * parsing, since these columns are plain dates, not timestamps. */
export function formatDateOnly(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m) - 1;
  if (!y || !d || mi < 0 || mi > 11 || Number.isNaN(Number(d))) return dateStr;
  return `${Number(d)} ${MONTHS[mi]} ${y}`;
}
