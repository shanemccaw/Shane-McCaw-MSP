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
    domains.split(",").some(d => !d.trim().endsWith(".replit.dev"));

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

/**
 * Validates that the configured Stripe key prefix matches the current
 * environment. Call once at server startup, before any Stripe SDK usage.
 *
 * Rules:
 *   Dev  → key must start with "sk_test_"  (live key would risk real charges)
 *   Prod → key must start with "sk_live_"  (test key means payments silently fail)
 *
 * Throws when a mismatch is detected so the misconfiguration is caught
 * immediately rather than at the moment of the first payment attempt.
 * If no Stripe key is set, this function is a no-op — the missing-key
 * error is raised later by getStripeKey() only when Stripe is actually used.
 */
export function validateStripeKeyOnStartup(): void {
  const isProd = !!(process.env.REPLIT_DOMAINS);

  if (isProd) {
    const key = process.env.STRIPE_SECRET_KEY_PROD;
    if (!key) return; // Missing key handled lazily by getStripeKey()
    if (!key.startsWith("sk_live_")) {
      throw new Error(
        `[Stripe] Production environment detected but STRIPE_SECRET_KEY_PROD does not start with "sk_live_". ` +
        `Payments will not work in production. Replace the key with a live key from the Stripe dashboard.`,
      );
    }
  } else {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return; // Missing key handled lazily by getStripeKey()
    if (!key.startsWith("sk_test_")) {
      throw new Error(
        `[Stripe] Development environment detected but STRIPE_SECRET_KEY does not start with "sk_test_". ` +
        `A live key in the dev slot risks real charges against real customers. ` +
        `Move it to STRIPE_SECRET_KEY_PROD and set a test key in STRIPE_SECRET_KEY.`,
      );
    }
  }
}
