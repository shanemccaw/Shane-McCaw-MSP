/**
 * Display-only derivations for Policy Decisions (#1724) — colour/label
 * lookups for the real enum vocabularies documented in
 * `docs/policy-decisions-contract-pack.md` §5. An unrecognised value renders
 * as its own raw text in a neutral style rather than being coerced into a
 * bucket it does not belong in, matching Risk Register's own rule for this.
 */
import type { Swatch } from "@/lib/risk-register-visuals";

const NEUTRAL: Swatch = {
  label: "",
  text: "text-muted-foreground",
  bg: "bg-transparent",
  border: "border-border",
};

/** `policy_decisions.review_state` — on_track/due/overdue. NULL for a
 * dependency-based row (no review clock). */
const REVIEW_STATE_SWATCH: Record<string, Swatch> = {
  on_track: { label: "On track", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  due: { label: "Review due", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  overdue: { label: "Review overdue", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
};

export function reviewStateSwatch(value: string | null): Swatch {
  if (!value) return { ...NEUTRAL, label: "No review clock" };
  return REVIEW_STATE_SWATCH[value] ?? { ...NEUTRAL, label: value };
}

/** `compliance_frameworks.authority_type` (AUTHORITY_TYPES). Null means the
 * citation is free text only — no catalog match (#1525). */
const AUTHORITY_TYPE_SWATCH: Record<string, Swatch> = {
  regulation: { label: "REGULATION", text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" },
  certification: { label: "CERTIFICATION", text: "text-status-violet", bg: "bg-status-violet/10", border: "border-status-violet/30" },
  contract: { label: "CONTRACT", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  insurance: { label: "INSURANCE", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  internal_schedule: { label: "INTERNAL SCHEDULE", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" },
};

export function authorityTypeSwatch(value: string | null): Swatch {
  if (!value) return { ...NEUTRAL, label: "CITED AS TEXT" };
  return AUTHORITY_TYPE_SWATCH[value] ?? { ...NEUTRAL, label: value.toUpperCase() };
}

/** `compliance_obligations` `tone` (§3, OBLIGATION_TONES). `dot` is a solid
 * (non-opacity) fill for the small status dot next to each row. */
const OBLIGATION_TONE_SWATCH: Record<string, Swatch & { dot: string }> = {
  red: { label: "red", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30", dot: "bg-status-red" },
  amber: { label: "amber", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30", dot: "bg-status-amber" },
  green: { label: "green", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30", dot: "bg-status-green" },
  slate: { label: "slate", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border", dot: "bg-muted-foreground" },
};

export function obligationToneSwatch(tone: string): Swatch & { dot: string } {
  return OBLIGATION_TONE_SWATCH[tone] ?? { ...NEUTRAL, dot: "bg-muted-foreground" };
}

export const REVIEW_CADENCE_HINT: Record<string, string> = {
  Monthly: "Reviewed monthly",
  Quarterly: "Reviewed quarterly",
  "Semi-Annual": "Reviewed twice a year",
  Annual: "Reviewed annually",
  Biennial: "Reviewed every two years",
};
