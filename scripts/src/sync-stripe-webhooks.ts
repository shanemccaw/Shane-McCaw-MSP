/**
 * sync-stripe-webhooks.ts
 *
 * Verifies that a Stripe webhook endpoint is registered for every domain
 * that should receive webhooks — including the Replit dev-workspace preview
 * domain (*.replit.dev) against the TEST Stripe account, and any deployed
 * production domain against the LIVE Stripe account.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run sync-webhooks          # check only
 *   pnpm --filter @workspace/scripts run sync-webhooks -- --fix # check + auto-create missing endpoints
 *
 * Required env vars (set in Replit Secrets):
 *   STRIPE_SECRET_KEY      — dev Stripe secret key (sk_test_…), used in the
 *                            Replit editor workspace (all REPLIT_DOMAINS end in .replit.dev)
 *   STRIPE_SECRET_KEY_PROD — production Stripe secret key (sk_live_…), used in
 *                            real deployments (any REPLIT_DOMAIN does NOT end in .replit.dev)
 *   REPLIT_DOMAINS         — comma-separated list of domains for the deployed app
 *                            (Replit sets this automatically; it contains both the
 *                             *.replit.dev preview URL and any custom/replit.app domain)
 *
 * Optional env vars:
 *   STRIPE_WEBHOOK_SECRET      — signing secret for the dev (*.replit.dev) endpoint
 *   STRIPE_WEBHOOK_SECRET_PROD — signing secret for the prod endpoint
 *
 * Exit codes:
 *   0 — all endpoints present (or successfully created with --fix)
 *   1 — missing endpoint(s) found and --fix not passed (actionable warning)
 *   2 — env vars missing, script cannot run
 *
 * How environment detection works
 * ─────────────────────────────────────────────────────────────────────────────
 * Replit sets REPLIT_DOMAINS in BOTH the editor workspace (*.replit.dev) AND
 * in deployed apps. So presence alone does not distinguish dev from prod.
 *
 * We inspect the domain values:
 *   - All end in .replit.dev → DEV workspace  → use STRIPE_SECRET_KEY (test)
 *   - Any does NOT end in .replit.dev → PROD  → use STRIPE_SECRET_KEY_PROD (live)
 *
 * In dev mode we include *.replit.dev URLs in the expected set (so the dev
 * Stripe test account gets a webhook endpoint for testing).
 * In prod mode we include only non-.replit.dev URLs (the live Stripe account
 * gets an endpoint for the production domain only).
 */

import Stripe from "stripe";

const WEBHOOK_PATH = "/api/portal/stripe/webhook";

// Events the webhook must listen to (keep in sync with processStripeEvent in portal.ts)
const REQUIRED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
];

interface EnvConfig {
  stripeKey: string;
  isProd: boolean;
  expectedUrls: string[];
}

function resolveConfig(): EnvConfig {
  const raw = process.env.REPLIT_DOMAINS ?? "";
  const allDomains = raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  if (allDomains.length === 0) {
    throw new Error(
      "REPLIT_DOMAINS is not set or empty. " +
        "This variable is populated automatically by Replit. " +
        "In the Replit editor workspace it contains your *.replit.dev preview URL; " +
        "in a deployed app it also includes your production domain.",
    );
  }

  // Prod if any domain is not a Replit dev-preview URL
  const isProd = allDomains.some((d) => !d.endsWith(".replit.dev"));

  if (isProd) {
    const key = process.env.STRIPE_SECRET_KEY_PROD;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY_PROD is not set. Add it in Replit Secrets (sk_live_…). " +
          "This key is required to manage webhook endpoints in the live Stripe account.",
      );
    }
    // Prod: only register non-.replit.dev domains in the live account
    const expectedUrls = allDomains
      .filter((d) => !d.endsWith(".replit.dev"))
      .map((d) => `https://${d}${WEBHOOK_PATH}`);
    return { stripeKey: key, isProd: true, expectedUrls };
  }

  // Dev: all domains are *.replit.dev — register them in the test account
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it in Replit Secrets (sk_test_…). " +
        "This key is required to manage webhook endpoints in the Stripe test account.",
    );
  }
  const expectedUrls = allDomains.map((d) => `https://${d}${WEBHOOK_PATH}`);
  return { stripeKey: key, isProd: false, expectedUrls };
}

async function main() {
  let config: EnvConfig;
  try {
    config = resolveConfig();
  } catch (err) {
    console.error("ERROR:", (err as Error).message);
    process.exit(2);
  }

  const { stripeKey, isProd, expectedUrls } = config;
  const autoFix = process.argv.includes("--fix");

  console.log(`Environment: ${isProd ? "PRODUCTION (live)" : "DEV (test)"}`);
  console.log(`Stripe account: ${isProd ? "sk_live_…" : "sk_test_…"}`);

  const stripe = new Stripe(stripeKey);

  console.log("\nFetching registered Stripe webhook endpoints…");
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
    const secretEnvVar = isProd ? "STRIPE_WEBHOOK_SECRET_PROD" : "STRIPE_WEBHOOK_SECRET";
    console.warn(
      "\nACTION REQUIRED: Register the above URL(s) in the Stripe Dashboard:",
      "\n  https://dashboard.stripe.com/webhooks",
      "\n  Events to enable: " + REQUIRED_EVENTS.join(", "),
      `\n  Copy the signing secret shown after creation into Replit Secret: ${secretEnvVar}`,
      "\n\nOr re-run with --fix to create missing endpoints automatically:",
      "\n  pnpm --filter @workspace/scripts run sync-webhooks -- --fix",
    );
    process.exit(1);
  }

  // --fix: create missing endpoints via Stripe API
  const secretEnvVar = isProd ? "STRIPE_WEBHOOK_SECRET_PROD" : "STRIPE_WEBHOOK_SECRET";
  console.log("\nCreating missing endpoints…");
  let anyFailed = false;
  for (const url of missing) {
    try {
      const endpoint = await stripe.webhookEndpoints.create({
        url,
        enabled_events: REQUIRED_EVENTS,
        description: `Auto-created by sync-stripe-webhooks (${isProd ? "prod" : "dev"})`,
      });
      console.log(`  ✓ Created: ${url}`);
      if (endpoint.secret) {
        console.log(`    Signing secret: ${endpoint.secret}`);
        console.log(`    → Save this secret in Replit Secret: ${secretEnvVar}`);
      } else {
        console.log(`    → Retrieve the signing secret from the Stripe Dashboard and`);
        console.log(`       save it in Replit Secret: ${secretEnvVar}`);
      }
    } catch (err) {
      console.error(`  ✗ Failed to create ${url}:`, err);
      anyFailed = true;
    }
  }

  console.log("\nDone. Verify the new endpoints are active in Stripe Dashboard:");
  console.log("  https://dashboard.stripe.com/webhooks");

  if (anyFailed) {
    process.exit(1);
  }
}

void main();
