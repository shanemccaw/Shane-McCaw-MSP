/**
 * portal-change-rejection.test.ts — Git #1514.
 *
 * Locks the one fix this build made to `createAssignedRiskFromRejection`: the
 * accepted risk it creates for a CUSTOMER's rejection of a non-routed change
 * must carry the CR's own `remediationCheckKey` forward as the risk's
 * `checkKey`. Without it, the #1279 alert-suppression join and this build's
 * own discharge lookup (both keyed on tenant_id + check_key) can never find a
 * CR-declined risk — the M365-routed sibling path already carries no
 * checkKey by construction (a routed CR never has one), so this is the one
 * path that actually needed the fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockSelectQueue: any[][] = [];
let mockInsertValues: any[] = [];
let mockInsertReturning: any[] = [{ id: 321 }];

const { mockRiskTable, mockCrTable, mockApprovalsTable } = vi.hoisted(() => ({
  mockRiskTable: { mspId: "msp_id", rbdId: "rbd_id" },
  mockCrTable: { id: "id" },
  mockApprovalsTable: { id: "id", changeRequestId: "change_request_id" },
}));

vi.mock("@workspace/db", () => {
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => Promise.resolve(mockSelectQueue.shift() ?? []),
    then: (onfulfilled: any, onrejected?: any) =>
      Promise.resolve(mockSelectQueue.shift() ?? []).then(onfulfilled, onrejected),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
      insert: vi.fn((table: any) => ({
        values: (v: any) => {
          if (table === mockRiskTable) mockInsertValues.push(v);
          return {
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve(mockInsertReturning) }),
            returning: () => Promise.resolve(mockInsertReturning),
            then: (onfulfilled: any) => Promise.resolve(undefined).then(onfulfilled),
          };
        },
      })),
    },
    crApprovalsTable: mockApprovalsTable,
    mspChangeRequestsTable: mockCrTable,
    mspRiskDecisionsTable: mockRiskTable,
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    asc: (col: any) => col,
    eq: (col: any, val: any) => ({ col, val }),
  };
});

vi.mock("./m365-change-router", () => ({
  declineRoutedChangeToRisk: vi.fn(),
}));

vi.mock("./portal-change-approvals", () => ({
  violatesSeparationOfDuties: () => false,
}));

vi.mock("./portal-change-approvals-store", () => ({
  NO_POLICY: { requiredSignatures: null, requireSeparateApprover: true },
  resolveDelegatedAuthority: vi.fn(async () => null),
}));

vi.mock("./portal-change-timeline-store", () => ({
  recordCrEvent: vi.fn(async () => null),
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger: any = { info: noop, warn: noop, error: noop, debug: noop };
  noopLogger.child = () => noopLogger;
  return { logger: noopLogger };
});

import { recordRejection } from "./portal-change-rejection";

const cr = {
  id: 55,
  mspId: 9,
  tenantId: "contoso.onmicrosoft.com",
  status: "pending_approval",
  requestedBy: "raiser@contoso.com",
  sourceKind: null as string | null,
};

const approver = {
  personId: "u1",
  name: "Jordan Diaz",
  email: "jordan@contoso.com",
  customerId: 42,
  role: "customer" as const,
};

beforeEach(() => {
  mockSelectQueue = [];
  mockInsertValues = [];
  mockInsertReturning = [{ id: 321 }];
});

describe("recordRejection — non-routed customer rejection (#1514)", () => {
  it("carries the CR's remediationCheckKey forward onto the accepted risk", async () => {
    mockSelectQueue = [
      // cr_approvals select — one pending stage-1 slot
      [{ id: 1, stage: 1, decision: "pending", freezeWindowId: null }],
      // the internal `full` CR row read inside createAssignedRiskFromRejection
      [
        {
          id: 55,
          mspId: 9,
          tenantId: "contoso.onmicrosoft.com",
          tenantName: "Contoso",
          primaryDomain: "contoso.com",
          title: "Disable legacy auth",
          targetResource: "Exchange Online",
          description: "Disable legacy authentication protocols.",
          riskLevel: "high",
          remediationCheckKey: "identity:legacy-auth-usage",
        },
      ],
    ];

    const result = await recordRejection(cr as any, approver, "We need this configuration for now.");

    expect(result).toEqual({ ok: true, riskDecisionId: 321 });
    expect(mockInsertValues).toHaveLength(1);
    expect(mockInsertValues[0].checkKey).toBe("identity:legacy-auth-usage");
    expect(mockInsertValues[0].spawnedByChangeRequestId).toBe(55);
  });

  it("carries a null checkKey when the CR was never linked to a remediation item", async () => {
    mockSelectQueue = [
      [{ id: 1, stage: 1, decision: "pending", freezeWindowId: null }],
      [
        {
          id: 55,
          mspId: 9,
          tenantId: "contoso.onmicrosoft.com",
          tenantName: "Contoso",
          primaryDomain: "contoso.com",
          title: "Disable legacy auth",
          targetResource: "Exchange Online",
          description: "Disable legacy authentication protocols.",
          riskLevel: "high",
          remediationCheckKey: null,
        },
      ],
    ];

    await recordRejection(cr as any, approver, "We need this configuration for now.");

    expect(mockInsertValues[0].checkKey).toBeNull();
  });
});
