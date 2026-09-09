/**
 * Display-only derivations for Ownership / RACI (#3040) — initials, side
 * colouring and acceptance swatches for the real vocabularies documented in
 * `docs/portal/ownership-raci-contract-pack.md` §3. An unrecognised value renders
 * as its own raw text in a neutral style rather than being coerced into a
 * bucket it does not belong in, matching the Risk Register convention.
 */
import type { WireOwnPerson } from "@/lib/ownership-types";

export interface Swatch {
  readonly label: string;
  readonly text: string;
  readonly bg: string;
  readonly border: string;
}

const NEUTRAL: Swatch = { label: "", text: "text-muted-foreground", bg: "bg-transparent", border: "border-border" };

/** acceptance: "" | "pending" | "accepted" | "declined" (contract pack §3). */
const ACCEPTANCE_SWATCH: Record<string, Swatch> = {
  accepted: { label: "Accepted", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/30" },
  pending: { label: "Awaiting acceptance", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/30" },
  declined: { label: "Declined", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/30" },
};

export function acceptanceSwatch(value: string): Swatch {
  if (!value) return { ...NEUTRAL, label: "No answer needed" };
  return ACCEPTANCE_SWATCH[value] ?? { ...NEUTRAL, label: value };
}

/** `side` is "the customer's own name" | "MSP" | "External" (never guessed). */
export function sideSwatch(side: string): Swatch {
  if (side === "MSP") return { label: "MSP", text: "text-status-teal", bg: "bg-status-teal/15", border: "border-status-teal/40" };
  if (side === "External") return { label: "External", text: "text-muted-foreground", bg: "bg-muted/20", border: "border-border" };
  return { label: side, text: "text-status-blue", bg: "bg-status-blue/10", border: "border-status-blue/30" };
}

/** "Priya Raman" → "PR". Falls back to the first two characters for a single word. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function personById(people: readonly WireOwnPerson[], id: string): WireOwnPerson | undefined {
  return people.find((p) => p.id === id);
}
