import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCaptchaToken } from "./captcha.ts";

// #2882 — verifyCaptchaToken() previously failed OPEN when TURNSTILE_SECRET_KEY
// was missing/empty: it returned `success: true` for ANY token, silently
// disabling the CAPTCHA anti-abuse check on the checkout paths
// (portal-checkout.ts, portal-checkout-direct.ts) whenever the env var was
// unset. The network-error branch a few lines below already failed closed
// (`success: false`); this pins the same fail-closed behavior for the
// missing-key branch so a misconfigured deploy rejects rather than admits.

describe("verifyCaptchaToken", () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalSecret;
    }
  });

  it("fails closed (success: false) when TURNSTILE_SECRET_KEY is unset, never bypassing the check", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await verifyCaptchaToken("some-garbage-token");

    expect(result.success).toBe(false);
    expect(result.bypassed).toBe(false);
    // Must never reach Cloudflare (and never have reached the old
    // `{ success: true, bypassed: true }` bypass return either).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed (success: false) when TURNSTILE_SECRET_KEY is an empty string", async () => {
    process.env.TURNSTILE_SECRET_KEY = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await verifyCaptchaToken("some-garbage-token");

    expect(result.success).toBe(false);
    expect(result.bypassed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still verifies against Cloudflare when a secret key is configured", async () => {
    process.env.TURNSTILE_SECRET_KEY = "real-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({ success: true }),
    } as Response);

    const result = await verifyCaptchaToken("a-real-token");

    expect(result.success).toBe(true);
    expect(result.bypassed).toBe(false);
  });
});
