/**
 * Display-only derivations for the Risk Register (#2993) — colour/label
 * lookups for the real enum vocabularies documented in
 * `docs/portal/risk-register-contract-pack.md` §3. An unrecognised value renders as
 * its own raw text in a neutral style rather than being coerced into a
 * bucket it does not belong in (the contract pack's own rule for this
 * module, §"severity vocabularies").
 */
import type { RiskAcceptanceStatus, RiskReviewState, RiskStatus } from "@/lib/risk-register-types";

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

export const SEVERITY_SWATCH: Record<string, Swatch> = {
  Critical: { label: "Critical", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
  High: { label: "High", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  Medium: { label: "Medium", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  Low: { label: "Low", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
};

export function severitySwatch(value: string | null): Swatch {
  if (!value) return NEUTRAL;
  return SEVERITY_SWATCH[value] ?? { ...NEUTRAL, label: value };
}

const RISK_STATUS_SWATCH: Record<string, Swatch> = {
  Open: { label: "Open", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
  Mitigating: { label: "Mitigating", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  Accepted: { label: "Accepted", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  Closed: { label: "Closed", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  Expired: { label: "Expired", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
};

export function riskStatusSwatch(value: RiskStatus | null): Swatch {
  if (!value) return { ...NEUTRAL, label: "Not recorded" };
  return RISK_STATUS_SWATCH[value] ?? { ...NEUTRAL, label: value };
}

const ACCEPTANCE_SWATCH: Record<string, Swatch> = {
  none: { label: "Not signed", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  active: { label: "Signed", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  pending_signature: { label: "Awaiting yours", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  revoked: { label: "Revoked", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
};

/** `status` is the acceptance's own DB status when present, else "none". */
export function acceptanceSwatch(status: RiskAcceptanceStatus | "none"): Swatch {
  return ACCEPTANCE_SWATCH[status] ?? { ...NEUTRAL, label: status };
}

const REVIEW_SWATCH: Record<string, Swatch> = {
  on_track: { label: "On track", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
  due: { label: "Due", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  overdue: { label: "Overdue", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
};

export function reviewSwatch(value: RiskReviewState | null): Swatch {
  if (!value) return { ...NEUTRAL, label: "No clock" };
  return REVIEW_SWATCH[value] ?? { ...NEUTRAL, label: value };
}

/** `$96k` for >=1000, `$420` below it, `—` for exactly zero (no liability). */
export function formatLiability(n: number): string {
  if (n === 0) return "—";
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
}

/** "27 Aug 2026, 14:22" from a real ISO timestamp. Never invents a fallback —
 * callers only pass a value they've already confirmed is non-null. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
