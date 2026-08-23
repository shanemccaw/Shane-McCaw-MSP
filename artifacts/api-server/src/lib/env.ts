import { isReplitDevEnvironment } from "./stripe";

/**
 * Real production-vs-dev detection, shared by any subsystem that must behave
 * differently in deployed production than in the dev workspace —
 * e.g. MFA enforcement (Git #439).
 *
 * Reuses {@link isReplitDevEnvironment} in stripe.ts directly so that
 * dev/prod detection remains unified across Stripe, testbed reset, and auth gates.
 */
export function isProductionEnvironment(): boolean {
  return !isReplitDevEnvironment();
}
