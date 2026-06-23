/**
 * Returns the Stripe secret key appropriate for the current environment.
 *
 * Environment detection uses REPLIT_DOMAINS, which Replit sets automatically
 * in deployed (production) apps and leaves unset in the local dev environment.
 *
 *   Dev  (REPLIT_DOMAINS absent)  → STRIPE_SECRET_KEY       (sk_test_…)
 *   Prod (REPLIT_DOMAINS present) → STRIPE_SECRET_KEY_PROD  (sk_live_…)
 *
 * Throws a descriptive Error when the required secret is missing so callers
 * are forced to handle the case — there is no silent fallback to the wrong key.
 */
export function getStripeKey(): string {
  const isProd = !!(process.env.REPLIT_DOMAINS);

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
