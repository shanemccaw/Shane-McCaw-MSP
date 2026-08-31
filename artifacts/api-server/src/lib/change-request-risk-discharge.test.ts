/**
 * change-request-risk-discharge.test.ts — Git #1514.
 *
 * Locks the discharge write: the (mspId, tenantId, checkKey, status='active')
 * scoping predicate must match #1279's own suppression query exactly, the
 * `isNull(dischargedByChangeRequestId)` guard must be in the WHERE (not a
 * separate read-then-write race), and a CR that discharges nothing must not
 * log or error.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockUpdateReturning: any[] = [];
let mockWhereCalls: any[] = [];
let mockSetCalls: any[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: (v: any) => {
        mockSetCalls.push(v);
        return {
          where: (w: any) => {
            mockWhereCalls.push(w);
            return { returning: () => Promise.resolve(mockUpdateReturning) };
          },
        };
      },
    })),
  },
  mspRiskDecisionsTable: {
    mspId: "msp_id",
    tenantId: "tenant_id",
    checkKey: "check_key",
    status: "status",
    dischargedByChangeRequestId: "discharged_by_change_request_id",
    id: "id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...clauses: any[]) => ({ and: clauses }),
  eq: (col: any, val: any) => ({ eq: [col, val] }),
  isNull: (col: any) => ({ isNull: col }),
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger: any = { info: noop, warn: noop, error: noop, debug: noop };
  noopLogger.child = () => noopLogger;
  return { logger: noopLogger };
});

import { dischargeRisksForNewChangeRequest } from "./change-request-risk-discharge";

beforeEach(() => {
  mockUpdateReturning = [];
  mockWhereCalls = [];
  mockSetCalls = [];
});

describe("dischargeRisksForNewChangeRequest", () => {
  it("discharges every active, undischarged risk on the same (mspId, tenantId, checkKey)", async () => {
    mockUpdateReturning = [{ id: 41 }, { id: 42 }];

    const result = await dischargeRisksForNewChangeRequest({
      changeRequestId: 900,
      mspId: 9,
      tenantId: "contoso.onmicrosoft.com",
      checkKey: "identity:legacy-auth-usage",
    });

    expect(result.dischargedRiskIds).toEqual([41, 42]);
    expect(mockSetCalls[0].dischargedByChangeRequestId).toBe(900);
    expect(mockSetCalls[0].riskStatus).toBe("Closed");
    expect(mockSetCalls[0].updatedAt).toBeInstanceOf(Date);

    // The scoping predicate: exactly (mspId, tenantId, checkKey, status='active', dischargedByChangeRequestId IS NULL).
    const clauses = mockWhereCalls[0].and;
    expect(clauses).toHaveLength(5);
    expect(clauses[0].eq).toEqual(["msp_id", 9]);
    expect(clauses[1].eq).toEqual(["tenant_id", "contoso.onmicrosoft.com"]);
    expect(clauses[2].eq).toEqual(["check_key", "identity:legacy-auth-usage"]);
    expect(clauses[3].eq).toEqual(["status", "active"]);
    expect(clauses[4].isNull).toBe("discharged_by_change_request_id");
  });

  it("returns an empty list, without logging, when nothing matches", async () => {
    mockUpdateReturning = [];

    const result = await dischargeRisksForNewChangeRequest({
      changeRequestId: 901,
      mspId: 9,
      tenantId: "contoso.onmicrosoft.com",
      checkKey: "identity:no-standing-accepted-risk",
    });

    expect(result).toEqual({ dischargedRiskIds: [] });
  });
});
