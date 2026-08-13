/**
 * Real production-vs-dev detection, shared by any subsystem that must behave
 * differently in deployed production than in the Replit dev workspace —
 * e.g. MFA enforcement (Git #439).
 *
 * Identical formula to {@link getStripeKey} in stripe.ts (reused deliberately,
 * not reinvented):
 *   - REPLIT_DOMAINS absent                → dev
 *   - REPLIT_DOMAINS present, all domains end .replit.dev → dev
 *   - REPLIT_DOMAINS present, any domain NOT .replit.dev  → prod
 *
 * Replit sets REPLIT_DOMAINS in BOTH the editor workspace (*.replit.dev) and
 * deployed apps (*.replit.app / custom domains), so presence alone can't
 * distinguish dev from production — the actual domain values must be
 * inspected.
 */
export function isProductionEnvironment(): boolean {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  return domains.length > 0 && domains.split(",").some((d) => !d.trim().endsWith(".replit.dev"));
}
