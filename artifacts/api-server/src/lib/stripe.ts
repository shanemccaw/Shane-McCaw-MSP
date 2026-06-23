/**
 * Returns the Stripe secret key appropriate for the current environment.
 *
 * Environment detection uses REPLIT_DOMAINS:
 *   - Absent                              → dev  → STRIPE_SECRET_KEY       (sk_test_…)
 *   - Present, all domains end .replit.dev → dev  → STRIPE_SECRET_KEY       (sk_test_…)
 *   - Present, any domain NOT .replit.dev  → prod → STRIPE_SECRET_KEY_PROD  (sk_live_…)
 *
 * Replit sets REPLIT_DOMAINS in BOTH the editor workspace (*.replit.dev) and
 * in deployed apps (*.replit.app / custom domains).  Checking only for the
 * presence of the variable therefore cannot distinguish dev from production —
 * we must inspect the actual domain values.  A .replit.dev suffix means the
 * Replit dev workspace preview; .replit.app or any custom domain means a
 * real deployment that should charge real money.
 *
 * Throws a descriptive Error when the required secret is missing so callers
 * are forced to handle the case — there is no silent fallback to the wrong key.
 */
export function getStripeKey(): string {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const isProd = domains.length > 0 &&
    domains.split(",").every(d => !d.trim().endsWith(".replit.dev"));

  if (isProd) {
    const key = process.env.STRIPE_SECRET_KEY_PROD;
    if (!key) {
      throw new Error(
        "Stripe is not configured for production. Set STRIPE_SECRET_KEY_PROD in Replit Secrets (sk_live_…).",
      );
    }
    return key;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Stripe is not configured for development. Set STRIPE_SECRET_KEY in Replit Secrets (sk_test_…).",
    );
  }
  return key;
}
