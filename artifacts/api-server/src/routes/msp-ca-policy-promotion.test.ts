/**
 * msp-ca-policy-promotion.test.ts — Git #4522.
 *
 * Route-level behaviour of the CA promotion endpoints: the explicit confirm step,
 * the customer fence, refusal → HTTP status mapping (with the fresh impact the
 * operator must re-review), and the operator identity handed to the workflow. The
 * workflow itself (ca-policy-promotion.ts) is mocked here; its gate is covered by
 * ca-policy-impact.test.ts, ca-enforcement-precondition-4522.test.ts and the live
 * script src/scripts/verify-ca-promotion-4522.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const POLICY = "6f2a1b0e-2c1d-4d8e-9a55-0b7f1c3e9d21";
const FINGERPRINT = "a".repeat(64);

let customerRows: Array<Record<string, unknown>> = [];
let customerAccess = true;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => customerRows }) }) }),
  },
  tenantsTable: { id: "id", tenantId: "tenant_id", isTestbed: "is_testbed", customerName: "customer_name", mspId: "msp_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireCapability: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 42, email: "tech@msp.test", name: "Tech One", role: "admin", mspRole: "msp_technician" };
    next();
  },
  requireMspScope: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  assertCustomerAccess: async () => customerAccess,
}));

vi.mock("../lib/request-context.ts", () => ({ getRequestContext: () => ({ traceId: "11111111-1111-4111-8111-111111111111" }) }));

vi.mock("../lib/logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const promoteCaPolicy = vi.fn();
const evaluateCaPolicyImpact = vi.fn();
vi.mock("../lib/ca-policy-promotion.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../lib/ca-policy-promotion.ts");
  return {
    PROMOTION_REFUSAL_STATUS: actual["PROMOTION_REFUSAL_STATUS"],
    isPolicyIdShape: actual["isPolicyIdShape"],
    promoteCaPolicy: (...a: unknown[]) => promoteCaPolicy(...a),
    evaluateCaPolicyImpact: (...a: unknown[]) => evaluateCaPolicyImpact(...a),
    listCaPoliciesForTenant: vi.fn(),
    listCaPolicyPromotions: vi.fn(),
  };
});

vi.mock("../lib/graph.ts", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class extends Error {},
  LicenseGapError: class extends Error {},
}));

const { default: router } = await import("./msp-ca-policy-promotion.ts");
const app = express();
app.use(express.json());
app.use("/api", router);

const promoteUrl = `/api/msp/1/customers/2080/ca-policies/${POLICY}/promote`;

beforeEach(() => {
  customerRows = [{ id: 2080, tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3", isTestbed: true, name: "McCawSoft" }];
  customerAccess = true;
  promoteCaPolicy.mockReset();
  evaluateCaPolicyImpact.mockReset();
});

describe("POST .../ca-policies/:policyId/promote", () => {
  it("requires the explicit confirm step and a reviewed fingerprint — nothing reaches the workflow without them", async () => {
    for (const body of [
      { reviewedFingerprint: FINGERPRINT, acknowledgeImpact: true },
      { reviewedFingerprint: FINGERPRINT, acknowledgeImpact: true, confirm: false },
      { acknowledgeImpact: true, confirm: true },
      { reviewedFingerprint: "not-a-hash", acknowledgeImpact: true, confirm: true },
      { reviewedFingerprint: FINGERPRINT, confirm: true },
    ]) {
      const res = await request(app).post(promoteUrl).send(body);
      expect(res.status).toBe(400);
    }
    expect(promoteCaPolicy).not.toHaveBeenCalled();
  });

  it("refuses a customer outside the operator's scope", async () => {
    customerAccess = false;
    const res = await request(app).post(promoteUrl).send({ reviewedFingerprint: FINGERPRINT, acknowledgeImpact: false, confirm: true });
    expect(res.status).toBe(403);
    expect(promoteCaPolicy).not.toHaveBeenCalled();
  });

  it("refuses a policy id that is not a GUID before reading anything", async () => {
    const res = await request(app).post("/api/msp/1/customers/2080/ca-policies/..%2Fnamed/promote")
      .send({ reviewedFingerprint: FINGERPRINT, acknowledgeImpact: false, confirm: true });
    expect([400, 404]).toContain(res.status);
    expect(promoteCaPolicy).not.toHaveBeenCalled();
  });

  it("hands the workflow the operator identity, the reviewed fingerprint and the acknowledgement", async () => {
    promoteCaPolicy.mockResolvedValue({
      outcome: "succeeded", promotionId: 7, changeRequest: { id: 91, code: "CHG-0091" }, status: 204, errorType: null, message: null, impact: {},
    });
    const res = await request(app).post(promoteUrl)
      .send({ reviewedFingerprint: FINGERPRINT, acknowledgeImpact: true, confirm: true, note: "  reviewed with the customer  " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: "succeeded", promotionId: 7, changeRequest: { code: "CHG-0091" } });
    expect(promoteCaPolicy).toHaveBeenCalledWith(expect.objectContaining({
      mspId: 1, customerId: 2080, policyId: POLICY, reviewedFingerprint: FINGERPRINT, acknowledgeImpact: true,
      note: "reviewed with the customer",
      actor: expect.objectContaining({ userId: 42, name: "Tech One", role: "msp_technician", email: "tech@msp.test" }),
    }));
  });

  it.each([
    ["impact_changed", 409],
    ["acknowledgement_required", 422],
    ["impact_unverifiable", 424],
    ["not_report_only", 409],
    ["customer_not_testbed", 403],
  ])("maps a %s refusal to %i and returns the server's fresh impact", async (code, status) => {
    const impact = { status: "ok", fingerprint: "b".repeat(64) };
    promoteCaPolicy.mockResolvedValue({ outcome: "refused", code, message: `refused: ${code}`, promotionId: 3, impact });
    const res = await request(app).post(promoteUrl).send({ reviewedFingerprint: FINGERPRINT, acknowledgeImpact: false, confirm: true });
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ code, promotionId: 3, impact });
  });

  it("reports a Graph write that did not land as 502, not success", async () => {
    promoteCaPolicy.mockResolvedValue({
      outcome: "failed", promotionId: 8, changeRequest: { id: 92, code: "CHG-0092" }, status: 403, errorType: "license_gap", message: "x", impact: {},
    });
    const res = await request(app).post(promoteUrl).send({ reviewedFingerprint: FINGERPRINT, acknowledgeImpact: false, confirm: true });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ outcome: "failed", errorType: "license_gap" });
  });
});

describe("GET .../ca-policies/:policyId/impact", () => {
  it("returns the evaluated impact with whether writes are available for this customer", async () => {
    evaluateCaPolicyImpact.mockResolvedValue({ status: "entra_premium_required", detail: "needs P1", summary: null });
    customerRows = [{ ...customerRows[0], isTestbed: false }];
    const res = await request(app).get(`/api/msp/1/customers/2080/ca-policies/${POLICY}/impact`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "entra_premium_required", summary: null, promotionWritesAvailable: false });
    expect(evaluateCaPolicyImpact).toHaveBeenCalledWith("c4c814d4-3afe-441e-9145-62461d0a4fd3", POLICY);
  });

  it("404s a customer that is not this MSP's", async () => {
    customerRows = [];
    const res = await request(app).get(`/api/msp/1/customers/2080/ca-policies/${POLICY}/impact`);
    expect(res.status).toBe(404);
    expect(evaluateCaPolicyImpact).not.toHaveBeenCalled();
  });
});
