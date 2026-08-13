// Unit tests for the pure helpers of the Zoho Integration Foundation (#82):
// token-expiry logic (zoho-client), webhook token/event resolution
// (zoho-webhook), and the drain's bounded-concurrency runner
// (zoho-batch-drain). DB-touching paths are exercised in later phases.

import { describe, it, expect, vi } from "vitest";

// zoho-client transitively imports @workspace/db, whose index throws on import
// unless DATABASE_URL is set. No query ever runs in these pure-helper tests —
// the pool connects lazily — so a dummy URL is enough. vi.hoisted runs before
// the hoisted static imports below.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import { isZohoAccessTokenExpired, zohoRefreshTokenSecretName } from "./zoho-client.ts";
import { verifyZohoWebhookToken, resolveZohoEventType } from "./zoho-webhook.ts";
import { runWithConcurrency } from "./zoho-batch-drain.ts";

describe("isZohoAccessTokenExpired", () => {
  const now = Date.parse("2026-07-28T12:00:00Z");

  it("treats a null expiry as expired", () => {
    expect(isZohoAccessTokenExpired(null, now)).toBe(true);
  });

  it("treats a token expiring in the future (beyond skew) as valid", () => {
    expect(isZohoAccessTokenExpired(new Date(now + 10 * 60_000), now)).toBe(false);
  });

  it("treats a token inside the skew window as already expired", () => {
    expect(isZohoAccessTokenExpired(new Date(now + 30_000), now)).toBe(true);
  });

  it("treats a past expiry as expired", () => {
    expect(isZohoAccessTokenExpired(new Date(now - 1), now)).toBe(true);
  });

  it("honours a custom skew", () => {
    expect(isZohoAccessTokenExpired(new Date(now + 30_000), now, 0)).toBe(false);
  });
});

describe("zohoRefreshTokenSecretName", () => {
  it("follows the msp-{id}- Key Vault naming pattern", () => {
    expect(zohoRefreshTokenSecretName(1)).toBe("msp-1-zoho-refresh-token");
  });
});

describe("verifyZohoWebhookToken", () => {
  it("accepts a matching token", () => {
    expect(verifyZohoWebhookToken("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a mismatched token of equal length", () => {
    expect(verifyZohoWebhookToken("s3cret", "s3creX")).toBe(false);
  });

  it("rejects a token of different length", () => {
    expect(verifyZohoWebhookToken("short", "a-much-longer-secret")).toBe(false);
  });

  it("rejects when no token was provided", () => {
    expect(verifyZohoWebhookToken(undefined, "s3cret")).toBe(false);
  });

  it("rejects everything when the secret is unset — never an open endpoint", () => {
    expect(verifyZohoWebhookToken("anything", undefined)).toBe(false);
    expect(verifyZohoWebhookToken("", "")).toBe(false);
  });
});

describe("resolveZohoEventType", () => {
  it("derives module.operation from a Zoho notification body", () => {
    expect(resolveZohoEventType({ module: "Leads", operation: "create" }, {})).toBe("Leads.create");
  });

  it("prefers an explicit event_type in the body", () => {
    expect(resolveZohoEventType({ event_type: "Deals.update", module: "Leads", operation: "create" }, {})).toBe("Deals.update");
  });

  it("prefers an explicit event_type in the query over everything", () => {
    expect(resolveZohoEventType({ module: "Leads", operation: "create" }, { event_type: "Contacts.update" })).toBe("Contacts.update");
  });

  it("returns null when undeterminable", () => {
    expect(resolveZohoEventType({}, {})).toBeNull();
    expect(resolveZohoEventType({ module: "Leads" }, {})).toBeNull();
    expect(resolveZohoEventType(undefined, undefined)).toBeNull();
  });
});

describe("runWithConcurrency", () => {
  it("preserves item order in results", async () => {
    const results = await runWithConcurrency([3, 1, 2], 2, async (n) => n * 10);
    expect(results).toEqual([
      { ok: true, value: 30 },
      { ok: true, value: 10 },
      { ok: true, value: 20 },
    ]);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("captures a rejection per-item without failing the batch", async () => {
    const results = await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("handles an empty item list", async () => {
    expect(await runWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it("clamps a nonsensical cap to 1 and still completes", async () => {
    const results = await runWithConcurrency([1, 2], 0, async (n) => n);
    expect(results).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });
});
