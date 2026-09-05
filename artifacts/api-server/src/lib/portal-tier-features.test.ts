/**
 * portal-tier-features.test.ts — #1168's "creation unconditional, tier only
 * gates visibility" rule, exercised at the actual mechanism: does a
 * customer's active Monitoring tier purchase's `includedFeatures` array
 * bundle a given module key.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

let mockUserIds: number[] = [1];
let mockClientServiceRows: Array<{ typeAttributes: Record<string, unknown> | null }> = [];

vi.mock("@workspace/db", () => {
  const col = (name: string) => name;
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(mockClientServiceRows),
    };
    return chain;
  };
  return {
    db: { select: vi.fn(() => makeSelectChain()) },
    clientServicesTable: { id: col("id"), clientUserId: col("client_user_id"), serviceId: col("service_id"), status: col("status") },
    servicesTable: { id: col("id"), typeAttributes: col("type_attributes"), serviceType: col("service_type") },
  };
});

vi.mock("./tenant-signals", () => ({
  resolveCustomerUserIds: (_customerId: number) => Promise.resolve(mockUserIds),
}));

vi.mock("./portal-customer-scope", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
}));

vi.mock("./logger", () => {
  const noop = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
  return { logger: { ...noop, child: () => noop } };
});

import {
  resolveCustomerIncludedFeatures,
  hasTierFeature,
  requireTierFeature,
  PORTAL_TIER_MODULE_KEYS,
} from "./portal-tier-features";

beforeEach(() => {
  mockUserIds = [1];
  mockClientServiceRows = [];
});

describe("resolveCustomerIncludedFeatures", () => {
  it("returns [] when the customer has no linked users", async () => {
    mockUserIds = [];
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["risk_register"] } }];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual([]);
  });

  it("returns [] when there is no active monitoring_tier client_services row", async () => {
    mockClientServiceRows = [];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual([]);
  });

  it("returns the real includedFeatures array off the active row", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["policy_decisions", "risk_register"] } }];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual(["policy_decisions", "risk_register"]);
  });

  it("filters out non-string entries rather than throwing on malformed data", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["risk_register", 42, null, "runbooks"] } }];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual(["risk_register", "runbooks"]);
  });

  it("returns [] when typeAttributes is null", async () => {
    mockClientServiceRows = [{ typeAttributes: null }];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual([]);
  });

  it("returns [] when includedFeatures is missing entirely", async () => {
    mockClientServiceRows = [{ typeAttributes: {} }];
    expect(await resolveCustomerIncludedFeatures(1)).toEqual([]);
  });
});

describe("hasTierFeature", () => {
  it("true when the module key is included", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["ownership"] } }];
    expect(await hasTierFeature(1, PORTAL_TIER_MODULE_KEYS.ownership)).toBe(true);
  });

  it("false — fails closed — when the module key is not included", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["policy_decisions"] } }];
    expect(await hasTierFeature(1, PORTAL_TIER_MODULE_KEYS.ownership)).toBe(false);
  });

  it("false — fails closed — for a Foundation customer (no active tier row) reaching a Premier module", async () => {
    mockClientServiceRows = [];
    expect(await hasTierFeature(1, PORTAL_TIER_MODULE_KEYS.securityPlan)).toBe(false);
  });
});

describe("requireTierFeature middleware", () => {
  function mockReqRes(customerId: number | null) {
    const req: any = { user: customerId === null ? undefined : { customerId } };
    const res: any = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return { req, res };
  }

  it("403s with no customer identity on the token", async () => {
    const { req, res } = mockReqRes(null);
    const next = vi.fn();
    await requireTierFeature(PORTAL_TIER_MODULE_KEYS.riskRegister)(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("402s with TIER_UPGRADE_REQUIRED when the tier does not bundle the module", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["policy_decisions"] } }];
    const { req, res } = mockReqRes(1);
    const next = vi.fn();
    await requireTierFeature(PORTAL_TIER_MODULE_KEYS.securityPlan)(req, res, next);
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ code: "TIER_UPGRADE_REQUIRED", feature: "security_plan" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the tier bundles the module", async () => {
    mockClientServiceRows = [{ typeAttributes: { includedFeatures: ["security_plan"] } }];
    const { req, res } = mockReqRes(1);
    const next = vi.fn();
    await requireTierFeature(PORTAL_TIER_MODULE_KEYS.securityPlan)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});
