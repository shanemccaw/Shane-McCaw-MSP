/**
 * `requireAccess()` — the composed RBAC + tier gate (#4192, leaf 2 of #1704).
 *
 * The RBAC half runs against the fixture rows `src/test-setup/rbac-ladder-rows.ts` and
 * `rbac-capability-rows.ts` install for every suite (derived from the transcription, not
 * typed out). The tier half's two DB readers are mocked here, so each case states
 * exactly what the customer's subscription and the catalog look like. The logger is
 * mocked so the audit lines — the real new behaviour this leaf adds — are asserted, not
 * assumed. ./requireAccess.live-db.test.ts asks the same questions of the real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { LEGACY_ROLE, ladderCapabilityKey } from "@workspace/db/rbac/legacy-ladder";
import type { TierCatalogEntry } from "@workspace/db/rbac/access";

const spies = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  resolveCustomerTierEntitlement: vi.fn(),
  readMonitoringTierCatalog: vi.fn(),
}));

vi.mock("../lib/logger.ts", () => {
  const child = { warn: spies.warn, error: spies.error, info: spies.info, debug: vi.fn(), child: () => child };
  return { logger: { ...child, child: () => child } };
});

// `@workspace/db` throws at import without a DATABASE_URL, and the real
// `portal-tier-features.ts` imports it for the two readers mocked just below. Standing
// in an inert table object for every export lets the REAL module load — so the 402 body
// asserted below is the real `tierUpgradeRequiredBody`, not a copy of it — while every
// query path stays mocked. Deliberately NOT `process.env.DATABASE_URL ??= ...`: a fake
// URL left in the worker's environment would stop the live-db suites skipping cleanly.
vi.mock("@workspace/db", () => new Proxy({ db: {} } as Record<string, unknown>, {
  get: (target, prop: string) => (prop in target ? target[prop] : {}),
}));

vi.mock("../lib/portal-tier-features.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/portal-tier-features.ts")>()),
  resolveCustomerTierEntitlement: spies.resolveCustomerTierEntitlement,
  readMonitoringTierCatalog: spies.readMonitoringTierCatalog,
}));

const { requireAccess, parseAccessCapability } = await import("./requireAccess.ts");

const CUSTOMER_LADDER = ladderCapabilityKey(LEGACY_ROLE.customer);

/** The live catalog's shape: one row per size bracket, ordered by sort_order. */
const CATALOG: TierCatalogEntry[] = [
  { tier: "foundation", sortOrder: 1, includedFeatures: ["policy_decisions", "risk_register"] },
  { tier: "growth", sortOrder: 5, includedFeatures: ["policy_decisions", "risk_register", "runbooks"] },
  { tier: "premier", sortOrder: 9, includedFeatures: ["policy_decisions", "risk_register", "runbooks", "security_plan"] },
];

function appFor(capability: string, moduleKey?: Parameters<typeof requireAccess>[1]) {
  const app = express();
  app.use((req, _res, next) => {
    const raw = req.header("x-test-user");
    if (raw) req.user = JSON.parse(raw);
    next();
  });
  app.get("/t", requireAccess(capability, moduleKey), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

const customer = { id: 41, email: "x", role: "client", mspRole: LEGACY_ROLE.customer, mspId: 1, customerId: 7 };
const free = { ...customer, id: 42, mspRole: LEGACY_ROLE.free };

function as(user: object) {
  return { "x-test-user": JSON.stringify(user) };
}

beforeEach(() => {
  vi.clearAllMocks();
  spies.readMonitoringTierCatalog.mockResolvedValue(CATALOG);
});

describe("parseAccessCapability", () => {
  it("reads <system>:<key>, a bare ladder key, and msp:ladder.* as the ladder", () => {
    expect(parseAccessCapability("customer:billing.view")).toEqual({ system: "customer", key: "billing.view", ladder: false });
    expect(parseAccessCapability("msp:purchases.approve")).toEqual({ system: "msp", key: "purchases.approve", ladder: false });
    expect(parseAccessCapability(CUSTOMER_LADDER)).toEqual({ system: "msp", key: CUSTOMER_LADDER, ladder: true });
    expect(parseAccessCapability(`msp:${CUSTOMER_LADDER}`)).toEqual({ system: "msp", key: CUSTOMER_LADDER, ladder: true });
  });

  it("refuses an unqualified non-ladder key, an unknown system, and an empty key", () => {
    expect(parseAccessCapability("team.manage")).toBeNull();
    expect(parseAccessCapability("tenant:team.manage")).toBeNull();
    expect(parseAccessCapability("customer:")).toBeNull();
    expect(parseAccessCapability(":team.manage")).toBeNull();
  });
});

describe("requireAccess — basis: rbac", () => {
  it("403s a ladder miss with requireCapability's exact wording, logs it, and never loads the tier", async () => {
    const res = await request(appFor(CUSTOMER_LADDER, "runbooks")).get("/t").set(as(free));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toBe(`Insufficient privileges — ${LEGACY_ROLE.customer} or above required`);
    expect(res.body.error.details).toEqual({ basis: "rbac", capability: CUSTOMER_LADDER });

    expect(spies.resolveCustomerTierEntitlement).not.toHaveBeenCalled();
    expect(spies.readMonitoringTierCatalog).not.toHaveBeenCalled();

    expect(spies.warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = spies.warn.mock.calls[0];
    expect(msg).toBe("requireAccess denied (rbac)");
    expect(fields).toMatchObject({ basis: "rbac", capability: CUSTOMER_LADDER, userId: 42, customerId: 7, effect: "unset", path: "/t" });
    expect(fields.reason).toContain(`msp:${CUSTOMER_LADDER}`);
    expect(fields).not.toHaveProperty("requiredTier");
  });

  it("403s a customer-system capability the caller does not hold, with the plain wording, and logs it", async () => {
    const res = await request(appFor("customer:team.manage")).get("/t").set(as(customer));

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Insufficient privileges");
    expect(res.body.error.details).toEqual({ basis: "rbac", capability: "customer:team.manage" });
    expect(spies.warn).toHaveBeenCalledWith(
      expect.objectContaining({ basis: "rbac", capability: "customer:team.manage", reason: expect.stringContaining("customer:team.manage") }),
      "requireAccess denied (rbac)",
    );
  });
});

describe("requireAccess — basis: entitlement", () => {
  it("402s a tier miss with the TIER_UPGRADE_REQUIRED body plus basis, requiredTier and upgradePath, and logs it", async () => {
    spies.resolveCustomerTierEntitlement.mockResolvedValue({ includedFeatures: CATALOG[0].includedFeatures, currentTier: "foundation" });

    const res = await request(appFor(CUSTOMER_LADDER, "runbooks")).get("/t").set(as(customer));

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      error: 'Your current plan does not include "runbooks"',
      code: "TIER_UPGRADE_REQUIRED",
      feature: "runbooks",
      basis: "entitlement",
      requiredTier: "growth",
      upgradePath: "/portal/billing",
    });
    expect(spies.resolveCustomerTierEntitlement).toHaveBeenCalledWith(7);

    expect(spies.warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = spies.warn.mock.calls[0];
    expect(msg).toBe("requireAccess denied (entitlement)");
    expect(fields).toMatchObject({
      basis: "entitlement",
      capability: CUSTOMER_LADDER,
      moduleKey: "runbooks",
      requiredTier: "growth",
      currentTier: "foundation",
      effect: "allow",
      userId: 41,
    });
    expect(fields.reason).toBe('Monitoring tier "foundation" does not bundle "runbooks"; it is included from the "growth" tier.');
  });

  it("402s with requiredTier null when no catalog tier bundles the module", async () => {
    spies.resolveCustomerTierEntitlement.mockResolvedValue({ includedFeatures: CATALOG[2].includedFeatures, currentTier: "premier" });

    const res = await request(appFor(CUSTOMER_LADDER, "poams")).get("/t").set(as(customer));

    expect(res.status).toBe(402);
    expect(res.body.requiredTier).toBeNull();
    expect(spies.warn).toHaveBeenCalledWith(expect.objectContaining({ basis: "entitlement", requiredTier: null }), "requireAccess denied (entitlement)");
  });

  it("403s — not an upsell — a caller with no customer identity on the token, and logs it", async () => {
    const { customerId: _omit, ...operator } = { ...customer, mspRole: LEGACY_ROLE.mspOperator };

    const res = await request(appFor(CUSTOMER_LADDER, "runbooks")).get("/t").set(as(operator));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "No customer identity on token" });
    expect(spies.resolveCustomerTierEntitlement).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledWith(expect.objectContaining({ basis: "entitlement", moduleKey: "runbooks" }), "requireAccess denied (entitlement)");
  });
});

describe("requireAccess — allow", () => {
  it("calls next() when RBAC allows and the tier bundles the module, logging no denial", async () => {
    spies.resolveCustomerTierEntitlement.mockResolvedValue({ includedFeatures: CATALOG[1].includedFeatures, currentTier: "growth" });

    const res = await request(appFor(CUSTOMER_LADDER, "runbooks")).get("/t").set(as(customer));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("calls next() on an RBAC allow with no tier axis, without loading the tier", async () => {
    const res = await request(appFor(CUSTOMER_LADDER)).get("/t").set(as(customer));

    expect(res.status).toBe(200);
    expect(spies.resolveCustomerTierEntitlement).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });
});

describe("requireAccess — unavailable is never a denial", () => {
  it("503s and logs an error, not a denial, when the tier model cannot be read", async () => {
    spies.resolveCustomerTierEntitlement.mockRejectedValue(new Error("connection refused"));

    const res = await request(appFor(CUSTOMER_LADDER, "runbooks")).get("/t").set(as(customer));

    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe("Authorization is temporarily unavailable");
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "tier_model_unreadable", moduleKey: "runbooks" }),
      "requireAccess could not read the customer's Monitoring tier — failing closed",
    );
  });

  it("503s an unparseable capability rather than allowing or denying", async () => {
    const res = await request(appFor("billing.view")).get("/t").set(as(customer));

    expect(res.status).toBe(503);
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalled();
  });

  it("503s an uncatalogued <system>:<key> capability", async () => {
    const res = await request(appFor("customer:billing.teleport")).get("/t").set(as(customer));

    expect(res.status).toBe(503);
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it("401s with no authenticated user — it is mounted after requireAuth, not instead of it", async () => {
    const res = await request(appFor(CUSTOMER_LADDER)).get("/t");
    expect(res.status).toBe(401);
  });
});
