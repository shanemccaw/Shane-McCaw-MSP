/**
 * Unit tests for getStripeKey() in stripe.ts.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *
 * Uses the Node.js built-in test runner (node:test) and
 * --experimental-strip-types so no transpile step is needed.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getStripeKey } from "./stripe";

// Snapshot of the three env vars under test so they can be restored.
type EnvSnapshot = {
  REPLIT_DOMAINS: string | undefined;
  STRIPE_SECRET_KEY: string | undefined;
  STRIPE_SECRET_KEY_PROD: string | undefined;
};

let snapshot: EnvSnapshot;

beforeEach(() => {
  snapshot = {
    REPLIT_DOMAINS:       process.env.REPLIT_DOMAINS,
    STRIPE_SECRET_KEY:     process.env.STRIPE_SECRET_KEY,
    STRIPE_SECRET_KEY_PROD: process.env.STRIPE_SECRET_KEY_PROD,
  };
  // Start each test with a known-clean slate
  delete process.env.REPLIT_DOMAINS;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY_PROD;
});

afterEach(() => {
  // Restore exactly what was there before the test
  for (const [k, v] of Object.entries(snapshot) as [keyof EnvSnapshot, string | undefined][]) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

describe("getStripeKey() — dev (test key) cases", () => {
  it("returns STRIPE_SECRET_KEY when REPLIT_DOMAINS is absent", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_absent";
    assert.equal(getStripeKey(), "sk_test_absent");
  });

  it("returns STRIPE_SECRET_KEY when REPLIT_DOMAINS is a single .replit.dev domain", () => {
    process.env.REPLIT_DOMAINS = "foo.replit.dev";
    process.env.STRIPE_SECRET_KEY = "sk_test_single_dev";
    assert.equal(getStripeKey(), "sk_test_single_dev");
  });

  it("returns STRIPE_SECRET_KEY when REPLIT_DOMAINS has multiple .replit.dev domains", () => {
    process.env.REPLIT_DOMAINS = "foo.replit.dev,bar.replit.dev";
    process.env.STRIPE_SECRET_KEY = "sk_test_multi_dev";
    assert.equal(getStripeKey(), "sk_test_multi_dev");
  });

});

describe("getStripeKey() — prod (live key) cases", () => {
  it("returns STRIPE_SECRET_KEY_PROD when REPLIT_DOMAINS is a .replit.app domain", () => {
    process.env.REPLIT_DOMAINS = "myapp.replit.app";
    process.env.STRIPE_SECRET_KEY_PROD = "sk_live_replit_app";
    assert.equal(getStripeKey(), "sk_live_replit_app");
  });

  it("returns STRIPE_SECRET_KEY_PROD when REPLIT_DOMAINS is a custom domain", () => {
    process.env.REPLIT_DOMAINS = "shanemccaw.com";
    process.env.STRIPE_SECRET_KEY_PROD = "sk_live_custom";
    assert.equal(getStripeKey(), "sk_live_custom");
  });

  it("returns STRIPE_SECRET_KEY_PROD when REPLIT_DOMAINS has mixed .replit.dev and custom domains", () => {
    // isProd uses .some() — any non-.replit.dev domain means we're in a deployed context.
    process.env.REPLIT_DOMAINS = "foo.replit.dev,shanemccaw.com";
    process.env.STRIPE_SECRET_KEY_PROD = "sk_live_mixed";
    assert.equal(getStripeKey(), "sk_live_mixed");
  });

  it("returns STRIPE_SECRET_KEY_PROD when REPLIT_DOMAINS has multiple non-.replit.dev domains", () => {
    process.env.REPLIT_DOMAINS = "myapp.replit.app,shanemccaw.com";
    process.env.STRIPE_SECRET_KEY_PROD = "sk_live_multi_prod";
    assert.equal(getStripeKey(), "sk_live_multi_prod");
  });
});

describe("getStripeKey() — missing secret errors", () => {
  it("throws when in dev mode and STRIPE_SECRET_KEY is not set", () => {
    // REPLIT_DOMAINS absent → dev mode
    assert.throws(
      () => getStripeKey(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("STRIPE_SECRET_KEY"));
        assert.ok(err.message.includes("sk_test"));
        return true;
      },
    );
  });

  it("throws when in prod mode and STRIPE_SECRET_KEY_PROD is not set", () => {
    process.env.REPLIT_DOMAINS = "shanemccaw.com";
    assert.throws(
      () => getStripeKey(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("STRIPE_SECRET_KEY_PROD"));
        assert.ok(err.message.includes("sk_live"));
        return true;
      },
    );
  });
});
