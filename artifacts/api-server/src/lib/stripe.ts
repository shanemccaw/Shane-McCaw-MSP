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
/**
 * Checks whether a Stripe webhook endpoint is registered for the current
 * domain and logs the result. Designed to be called once at server startup
 * so that missing-endpoint regressions are immediately visible in logs.
 *
 * When `autoFix: true`, missing endpoints are automatically created via the
 * Stripe API. The newly-issued signing secret is logged at WARN level with
 * clear instructions — the operator must copy it into the appropriate Replit
 * Secret (`STRIPE_WEBHOOK_SECRET` in dev, `STRIPE_WEBHOOK_SECRET_PROD` in prod)
 * for webhook signature verification to work after the endpoint is created.
 *
 * Non-fatal: any error (Stripe API down, key missing, etc.) is caught and
 * logged as a warning so it never prevents the server from starting.
 */
export async function checkWebhookHealthOnStartup(
  logger: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  },
  opts: { autoFix?: boolean } = {},
): Promise<void> {
  const WEBHOOK_PATH = "/api/portal/stripe/webhook";
  const REQUIRED_EVENTS = ["checkout.session.completed", "invoice.paid", "customer.subscription.deleted", "invoice.payment_failed"] as const;

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch {
    logger.warn({}, "Stripe webhook health: cannot check — Stripe key not configured");
    return;
  }

  const domains = (process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) {
    logger.warn({}, "Stripe webhook health: REPLIT_DOMAINS not set — skipping check");
    return;
  }

  const isProd = domains.some((d) => !d.endsWith(".replit.dev"));
  const relevantDomains = isProd
    ? domains.filter((d) => !d.endsWith(".replit.dev"))
    : domains;

  const expectedUrls = relevantDomains.map((d) => `https://${d}${WEBHOOK_PATH}`);
  const secretEnvVar = isProd ? "STRIPE_WEBHOOK_SECRET_PROD" : "STRIPE_WEBHOOK_SECRET";

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey);
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const registeredUrls = new Set(endpoints.data.map((e) => e.url));

    const missing = expectedUrls.filter((url) => !registeredUrls.has(url));
    const present = expectedUrls.filter((url) => registeredUrls.has(url));

    if (missing.length === 0) {
      logger.info(
        { urls: present, account: isProd ? "live" : "test" },
        "Stripe webhook health: ✓ endpoint registered",
      );
      return;
    }

    if (!opts.autoFix) {
      logger.warn(
        {
          missing,
          present,
          account: isProd ? "live" : "test",
          fix: "pnpm --filter @workspace/scripts run sync-webhooks -- --fix",
        },
        "Stripe webhook health: ⚠ missing webhook endpoint(s) — payments will NOT trigger provisioning. Run sync-webhooks --fix to register.",
      );
      return;
    }

    // autoFix: create each missing endpoint and log the signing secret prominently
    for (const url of missing) {
      try {
        const endpoint = await stripe.webhookEndpoints.create({
          url,
          enabled_events: REQUIRED_EVENTS as unknown as import("stripe").Stripe.WebhookEndpointCreateParams.EnabledEvent[],
          description: `Auto-registered by server startup (${isProd ? "prod" : "dev"})`,
        });
        logger.warn(
          {
            url,
            endpointId: endpoint.id,
            account: isProd ? "live" : "test",
            signingSecret: endpoint.secret ?? "(retrieve from Stripe Dashboard)",
            ACTION_REQUIRED: `Copy the signingSecret value above into Replit Secret: ${secretEnvVar}`,
          },
          `Stripe webhook health: ✓ auto-created endpoint. ACTION REQUIRED — save the signingSecret to Replit Secret ${secretEnvVar} or webhook verification will fail.`,
        );
      } catch (createErr) {
        logger.warn(
          {
            err: createErr,
            url,
            fix: "pnpm --filter @workspace/scripts run sync-webhooks -- --fix",
          },
          "Stripe webhook health: ⚠ failed to auto-create endpoint — run sync-webhooks --fix manually.",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "Stripe webhook health: check failed (non-fatal)");
  }
}

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

/** Get the MSP's default payment method from Stripe */
export async function getMspDefaultPaymentMethod(
  stripe: import("stripe").Stripe,
  stripeCustomerId: string,
): Promise<string | undefined> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId) as import("stripe").Stripe.Customer;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (typeof defaultPm === "string") return defaultPm;
    if (defaultPm && typeof defaultPm === "object") return defaultPm.id;

    // Fall back to listing payment methods
    const pms = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 1 });
    return pms.data[0]?.id;
  } catch {
    return undefined;
  }
}
