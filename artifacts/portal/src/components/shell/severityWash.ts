import type { Severity } from "@workspace/copilot-scan-scene/journeyTokens";

/**
 * The frame-level severity wash (README "Layout" §1, design-system.md §5).
 * Four layered ambient radial gradients, bottom-left to top-right, each
 * always mounted with its opacity cross-faded over 1800ms rather than
 * swapped — "the wash changes when a scan lands... a snap from green to red
 * is alarming in a way the data usually is not."
 */
export const SEVERITY_WASH: Readonly<Record<Severity | "none", string>> = {
  none: "radial-gradient(120% 90% at 0% 100%, rgba(0,120,212,.08), rgba(2,6,23,0) 62%)",
  healthy: "radial-gradient(120% 90% at 0% 100%, rgba(52,211,153,.14), rgba(2,6,23,0) 62%)",
  attention: "radial-gradient(120% 90% at 0% 100%, rgba(251,191,36,.15), rgba(2,6,23,0) 62%)",
  critical: "radial-gradient(120% 90% at 0% 100%, rgba(248,113,113,.18), rgba(2,6,23,0) 62%)",
};

export const SEVERITY_WASH_ORDER: readonly (Severity | "none")[] = [
  "none",
  "healthy",
  "attention",
  "critical",
];
