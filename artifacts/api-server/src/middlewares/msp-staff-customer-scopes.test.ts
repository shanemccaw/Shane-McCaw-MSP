/**
 * msp-staff-customer-scopes.test.ts
 *
 * Unit tests for the per-staff-member customer-access scoping helpers in
 * requireAuth.ts (msp_staff_customer_scopes):
 *   - assertCustomerAccess — now denies MSP staff who are scoped OUT of a
 *     customer, while leaving the historical default (no scope rows = full MSP
 *     access) and all non-staff roles unchanged.
 *   - resolveStaffScopedCustomerIds — null when unrestricted, ids when scoped.
 *   - isCustomerBlockedByStaffScope — the single-customer fence used by
 *     list/detail routes that resolve their own customerId.
 *
 * The db is mocked with an ordered mockReturnValueOnce queue: for MSP staff,
 * assertCustomerAccess issues (1) the customer-ownership select, then (2) the
 * scope select. Non-staff / PlatformAdmin paths never hit the db.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-staff-customer-scopes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  mspCustomersTable: { id: "id", mspId: "mspId" },
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId", mspId: "mspId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
}));

vi.mock("../lib/request-context.ts", () => ({ enrichRequestContext: vi.fn() }));

import { db } from "@workspace/db";
import {
  assertCustomerAccess,
  resolveStaffScopedCustomerIds,
  isCustomerBlockedByStaffScope,
  type AuthUser,
} from "./requireAuth";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const platformAdmin: AuthUser = { id: 10, email: "a@p.com", role: "admin" };
const operator: AuthUser = { id: 20, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 900 };
const customerUser: AuthUser = { id: 30, email: "c@x.com", role: "client", mspRole: "CustomerUser", customerId: 7 };

beforeEach(() => {
  mockSelect.mockReset();
});

describe("assertCustomerAccess — per-staff customer scoping", () => {
  it("PlatformAdmin is always allowed and never touches the db", async () => {
    expect(await assertCustomerAccess(platformAdmin, 12345)).toBe(true);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("MSP staff with NO scope rows keep full MSP access (unrestricted default)", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 5 }])); // customer belongs to MSP
    mockSelect.mockReturnValueOnce(buildChain([])); // no scope rows → unrestricted
    expect(await assertCustomerAccess(operator, 5)).toBe(true);
  });

  it("scoped MSP staff CAN reach a customer in their assigned set", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 5 }])); // in MSP
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 5 }, { customerId: 8 }])); // scoped to 5,8
    expect(await assertCustomerAccess(operator, 5)).toBe(true);
  });

  it("scoped MSP staff CANNOT reach a customer outside their assigned set", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ id: 7 }])); // customer 7 is in the MSP…
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 5 }])); // …but staff is scoped to 5 only
    expect(await assertCustomerAccess(operator, 7)).toBe(false);
  });

  it("MSP staff are denied a customer outside their MSP (no scope query reached)", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // not in caller's MSP
    expect(await assertCustomerAccess(operator, 999)).toBe(false);
    expect(mockSelect).toHaveBeenCalledTimes(1); // short-circuits before the scope lookup
  });

  it("CustomerUser is pinned to their own customerId claim (scoping N/A)", async () => {
    expect(await assertCustomerAccess(customerUser, 7)).toBe(true);
    expect(await assertCustomerAccess(customerUser, 8)).toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("resolveStaffScopedCustomerIds", () => {
  it("returns null (unrestricted) for PlatformAdmin without querying", async () => {
    expect(await resolveStaffScopedCustomerIds(platformAdmin)).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns null (unrestricted) for non-staff roles without querying", async () => {
    expect(await resolveStaffScopedCustomerIds(customerUser)).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns null when a staff member has no scope rows", async () => {
    mockSelect.mockReturnValueOnce(buildChain([]));
    expect(await resolveStaffScopedCustomerIds(operator)).toBeNull();
  });

  it("returns the assigned customer ids when a staff member is scoped", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 5 }, { customerId: 8 }]));
    expect(await resolveStaffScopedCustomerIds(operator)).toEqual([5, 8]);
  });
});

describe("isCustomerBlockedByStaffScope", () => {
  it("returns false (allowed) when unrestricted", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // no scope rows
    expect(await isCustomerBlockedByStaffScope(operator, 5)).toBe(false);
  });

  it("returns false when the customer is in the assigned set", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 5 }]));
    expect(await isCustomerBlockedByStaffScope(operator, 5)).toBe(false);
  });

  it("returns true when the customer is outside the assigned set", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ customerId: 5 }]));
    expect(await isCustomerBlockedByStaffScope(operator, 9)).toBe(true);
  });
});
