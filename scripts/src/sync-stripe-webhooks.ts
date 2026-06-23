/**
 * sync-stripe-webhooks.ts
 *
 * Verifies that a Stripe webhook endpoint is registered for every production
 * domain listed in REPLIT_DOMAINS, pointing at /api/portal/stripe/webhook.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run sync-webhooks          # check only
 *   pnpm --filter @workspace/scripts run sync-webhooks -- --fix # check + auto-create missing endpoints
 *
 * Required env vars (set in Replit Secrets):
 *   STRIPE_SECRET_KEY      — dev Stripe secret key (sk_test_…), used in the
 *                            Replit editor workspace (REPLIT_DOMAINS absent, or
 *                            all domains end in .replit.dev)
 *   STRIPE_SECRET_KEY_PROD — production Stripe secret key (sk_live_…), used in
 *                            real deployments (REPLIT_DOMAINS present with no
 *                            .replit.dev domain)
 *   REPLIT_DOMAINS         — comma-separated list of domains for the deployed app
 *                            (Replit sets this automatically; it contains the
 *                             production custom domain when one is configured)
 *
 * Optional env vars:
 *   STRIPE_WEBHOOK_SECRET      — signing secret for the dev (*.replit.dev) endpoint
 *   STRIPE_WEBHOOK_SECRET_PROD — signing secret for the prod (shanemccaw.com) endpoint
 *
 * Exit codes:
 *   0 — all endpoints present (or successfully created with --fix)
 *   1 — missing endpoint(s) found and --fix not passed (actionable warning)
 *   2 — env vars missing, script cannot run
 */

import Stripe from "stripe";

const WEBHOOK_PATH = "/api/portal/stripe/webhook";

// Events the webhook must listen to (keep in sync with processStripeEvent in portal.ts)
const REQUIRED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
];

function getExpectedUrls(): string[] {
  const raw = process.env.REPLIT_DOMAINS ?? "";
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !d.endsWith(".replit.dev")) // skip dev-workspace preview URLs
    .map((domain) => `https://${domain}${WEBHOOK_PATH}`);
}

/**
 * Returns the Stripe secret key appropriate for the current environment.
 * Mirrors the getStripeKey() helper in artifacts/api-server/src/lib/stripe.ts.
 *
 *   - REPLIT_DOMAINS absent                          → dev  → STRIPE_SECRET_KEY       (sk_test_…)
 *   - REPLIT_DOMAINS present, all domains .replit.dev  → dev  → STRIPE_SECRET_KEY       (sk_test_…)
 *   - REPLIT_DOMAINS present, any domain not .replit.dev → prod → STRIPE_SECRET_KEY_PROD  (sk_live_…)
 *
 * Replit sets REPLIT_DOMAINS in both the editor workspace (*.replit.dev) and
 * deployed apps (*.replit.app / custom domains), so presence alone is not a
 * reliable production signal — the domain values must be inspected.
 */
function getStripeKey(): string {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const isProd = domains.length > 0 &&
    domains.split(",").some((d) => !d.trim().endsWith(".replit.dev"));

  if (isProd) {
    const key = process.env.STRIPE_SECRET_KEY_PROD;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY_PROD is not set. Add it in Replit Secrets (sk_live_…).",
      );
    }
    return key;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it in Replit Secrets (sk_test_…).",
    );
  }
  return key;
}

async function main() {
  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    console.error("ERROR:", (err as Error).message);
    process.exit(2);
  }

  const expectedUrls = getExpectedUrls();
  if (expectedUrls.length === 0) {
    console.warn(
      "WARNING: REPLIT_DOMAINS is not set or empty. " +
        "Cannot determine which URLs to check. " +
        "This variable is populated automatically in deployed Replit apps.",
    );
    process.exit(2);
  }

  const autoFix = process.argv.includes("--fix");

  const stripe = new Stripe(stripeKey);

  console.log("Fetching registered Stripe webhook endpoints…");
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const registeredUrls = new Set(endpoints.data.map((e) => e.url));

  console.log(`Registered endpoints (${endpoints.data.length}):`);
  for (const e of endpoints.data) {
    console.log(`  [${e.status}] ${e.url}`);
  }

  console.log(`\nExpected endpoints derived from REPLIT_DOMAINS:`);
  for (const url of expectedUrls) {
    console.log(`  ${url}`);
  }

  const missing = expectedUrls.filter((url) => !registeredUrls.has(url));

  if (missing.length === 0) {
    console.log("\n✓ All expected webhook endpoints are registered in Stripe.");
    process.exit(0);
  }

  console.warn(`\n⚠ Missing Stripe webhook endpoint(s):`);
  for (const url of missing) {
    console.warn(`  ${url}`);
  }

  if (!autoFix) {
    console.warn(
      "\nACTION REQUIRED: Register the above URL(s) in the Stripe Dashboard:",
      "\n  https://dashboard.stripe.com/webhooks",
      "\n  Events to enable: " + REQUIRED_EVENTS.join(", "),
      "\n  Copy the signing secret shown after creation into the appropriate",
      "\n  Replit Secret:",
      "\n    dev endpoint  (*.replit.dev)   → STRIPE_WEBHOOK_SECRET",
      "\n    prod endpoint (shanemccaw.com) → STRIPE_WEBHOOK_SECRET_PROD",
      "\n\nOr re-run with --fix to create missing endpoints automatically:",
      "\n  pnpm --filter @workspace/scripts run sync-webhooks -- --fix",
    );
    process.exit(1);
  }

  // --fix: create missing endpoints via Stripe API
  console.log("\nCreating missing endpoints…");
  for (const url of missing) {
    try {
      const endpoint = await stripe.webhookEndpoints.create({
        url,
        enabled_events: REQUIRED_EVENTS,
        description: "Auto-created by sync-stripe-webhooks script",
      });
      console.log(`  ✓ Created: ${url}`);
      console.log(
        `    Signing secret: ${endpoint.secret ?? "(retrieve from Stripe Dashboard)"}`,
      );
      console.log(
        `    → Save this secret in the matching Replit Secret:`,
        url.includes(".replit.dev")
          ? "STRIPE_WEBHOOK_SECRET"
          : "STRIPE_WEBHOOK_SECRET_PROD",
      );
    } catch (err) {
      console.error(`  ✗ Failed to create ${url}:`, err);
    }
  }

  console.log("\nDone. Verify the new endpoints are active in Stripe Dashboard:");
  console.log("  https://dashboard.stripe.com/webhooks");
}

void main();
