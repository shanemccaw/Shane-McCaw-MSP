/**
 * msp-standing-policies.test.ts
 *
 * Unit tests for GET /api/msp/standing-policies/:id/enactment (#1551) — the
 * enactment-shape preview. Locks: policy + customer must both belong to the
 * caller's own MSP (never leaked across MSP boundaries), and the resolved
 * route/reason match resolvePolicyEnactmentRoute's own settled table.
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-standing-policies
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-standing-policies-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(opts: { mspId?: number; mspRole?: "MSPOperator" | "MSPAdmin" | "CustomerUser" | "PlatformAdmin"; id?: number }): string {
  const { mspId, mspRole = "MSPOperator", id = 1 } = opts;
  return jwt.sign(
    { id, email: "staff@test.com", role: "client", mspRole, ...(mspId !== undefined ? { mspId } : {}) },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
  standingPoliciesTable: { id: "id", mspId: "mspId", ouId: "ouId", targetKind: "targetKind" },
  activeDirectoryOusTable: { id: "id" },
  changeCatalogItemsTable: { id: "id", mspId: "mspId" },
  tenantsTable: { id: "id", mspId: "mspId", consent: "consent", policyEngineOptIn: "policyEngineOptIn" },
  STANDING_POLICY_TARGET_KIND: ["mailbox_attribute", "group_membership", "service_policy"],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
    and: (...args: unknown[]) => ({ and: args }),
    desc: (c: unknown) => ({ desc: c }),
  };
});

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { db } from "@workspace/db";
import router from "./msp-standing-policies";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockSelect.mockReset();
});

const MSP_ID = 900;

const POLICY = { id: 7, mspId: MSP_ID, ouId: 1, targetKind: "group_membership", sopId: "SOP-VIP-GROUPS", catalogItemId: 55, isActive: true };

describe("GET /msp/standing-policies/:id/enactment", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/api/msp/standing-policies/7/enactment?customerId=1");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID, mspRole: "CustomerUser" })}`);
    expect(res.status).toBe(403);
  });

  it("400s without a customerId", async () => {
    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);
    expect(res.status).toBe(400);
  });

  it("404s a policy that does not belong to this MSP, without disclosing it exists", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // policy lookup scoped to caller's mspId -> no match

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(404);
  });

  it("404s a customerId belonging to a different MSP", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([POLICY])) // policy found
      .mockReturnValueOnce(buildChain([])); // customer lookup scoped to caller's mspId -> no match

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=42")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(404);
  });

  it("opted in + write consent granted -> engine_enacts", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([POLICY]))
      .mockReturnValueOnce(buildChain([{ id: 1, mspId: MSP_ID, policyEngineOptIn: true, consent: { writeBack: { status: "granted" } } }]));

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      policyId: 7,
      customerId: 1,
      targetKind: "group_membership",
      sopId: "SOP-VIP-GROUPS",
      catalogItemId: 55,
      route: "engine_enacts",
      reason: "write_consent_granted",
    });
  });

  it("opted in + write consent denied -> checklist_item (the NASA posture)", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([POLICY]))
      .mockReturnValueOnce(buildChain([{ id: 1, mspId: MSP_ID, policyEngineOptIn: true, consent: { writeBack: { status: "declined" } } }]));

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body.route).toBe("checklist_item");
    expect(res.body.reason).toBe("write_consent_denied");
  });

  it("tenant not opted in -> not_evaluated, tenant_not_opted_in", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([POLICY]))
      .mockReturnValueOnce(buildChain([{ id: 1, mspId: MSP_ID, policyEngineOptIn: false, consent: { writeBack: { status: "granted" } } }]));

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body.route).toBe("not_evaluated");
    expect(res.body.reason).toBe("tenant_not_opted_in");
  });

  it("policy not active -> not_evaluated, policy_inactive, even with full consent", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ ...POLICY, isActive: false }]))
      .mockReturnValueOnce(buildChain([{ id: 1, mspId: MSP_ID, policyEngineOptIn: true, consent: { writeBack: { status: "granted" } } }]));

    const res = await request(makeApp())
      .get("/api/msp/standing-policies/7/enactment?customerId=1")
      .set("Authorization", `Bearer ${mspToken({ mspId: MSP_ID })}`);

    expect(res.status).toBe(200);
    expect(res.body.route).toBe("not_evaluated");
    expect(res.body.reason).toBe("policy_inactive");
  });
});
