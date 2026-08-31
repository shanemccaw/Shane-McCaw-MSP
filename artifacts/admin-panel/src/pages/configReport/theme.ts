/**
 * Shared visual vocabulary for the configuration report pages (#1798), lifted verbatim
 * from `docs/design-system.md` rather than re-derived. Do not restyle or duplicate the
 * existing findings/pillar reporting with these — this is a different document (what a
 * tenant's configuration IS) from the health/pillar surfaces (what is wrong with it).
 */

/** Dark canvas — the one background every panel in this report sits on. */
export const CANVAS = "#020617";
export const HAIRLINE_BORDER = "rgba(255,255,255,0.10)";
export const GLASS_FILL = "linear-gradient(135deg, rgba(0,120,212,.12), rgba(139,92,246,.10))";

export const INK = {
  heading: "#f8fafc",
  body: "#94a3b8",
  bodyStrong: "#cbd5e1",
  micro: "#64748b",
  deEmphasised: "#475569",
};

/** Deltas and improvements — never a severity colour. */
export const TEAL = "#00B4D8";

export type Severity = "healthy" | "attention" | "critical";

export const SEVERITY_COLOR: Record<Severity, string> = {
  healthy: "#34d399",
  attention: "#fbbf24",
  critical: "#f87171",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  healthy: "Healthy",
  attention: "Attention required",
  critical: "Critical",
};

/**
 * Universal severity overlay: >= 60 healthy, >= 50 attention, < 50 critical. `null`
 * (no evaluable denominator) is NOT a severity — it renders as unavailable, never a
 * red zero. Used here as the honest measure of "how much of this document could
 * actually be read/compared" — never as a judgement on the tenant's configuration.
 */
export function severityForPct(pct: number | null): Severity | null {
  if (pct === null) return null;
  if (pct >= 60) return "healthy";
  if (pct >= 50) return "attention";
  return "critical";
}

export function pctOrNull(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
