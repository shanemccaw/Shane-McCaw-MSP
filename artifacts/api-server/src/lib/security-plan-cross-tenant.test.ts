/**
 * security-plan-cross-tenant.test.ts — proves the #2145 guard fails CLOSED: a
 * caller with no resolvable MSP scope (customer role, no user at all, or
 * MSP-staff with a blank/missing mspId) gets an EMPTY book, never a fallback
 * to unscoped/all-tenants data. None of these paths reach the database, so
 * the test needs no fixtures — an unexpected DB call here would itself be a
 * bug (a blank scope must short-circuit before ever querying `tenants`).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { resolveSecurityPlanCrossTenantBook } from "./security-plan-cross-tenant.ts";
import type { AuthUser } from "../middlewares/requireAuth.ts";

function reqWithUser(user: AuthUser | undefined): Request {
  return { user, query: {} } as unknown as Request;
}

describe("resolveSecurityPlanCrossTenantBook() — fail-closed guard (#2145)", () => {
  it("returns an empty book when there is no user at all", async () => {
    const book = await resolveSecurityPlanCrossTenantBook(reqWithUser(undefined));
    expect(book).toEqual({ mspId: null, isPlatformAdmin: false, tenants: [] });
  });

  it("returns an empty book for a CustomerUser — never a customer-role cross-tenant read", async () => {
    const user: AuthUser = { id: 1, email: "customer@example.com", role: "client", mspRole: "CustomerUser", customerId: 9 };
    const book = await resolveSecurityPlanCrossTenantBook(reqWithUser(user));
    expect(book).toEqual({ mspId: null, isPlatformAdmin: false, tenants: [] });
  });

  it("returns an empty book for MSP-staff with no resolvable mspId (blank scope), never falling through to every tenant", async () => {
    const user: AuthUser = { id: 2, email: "staff@example.com", role: "client", mspRole: "MSPOperator" };
    const book = await resolveSecurityPlanCrossTenantBook(reqWithUser(user));
    expect(book).toEqual({ mspId: null, isPlatformAdmin: false, tenants: [] });
  });

  it("returns an empty book for a Free/Assessment-tier caller", async () => {
    const user: AuthUser = { id: 3, email: "free@example.com", role: "client", mspRole: "Free" };
    const book = await resolveSecurityPlanCrossTenantBook(reqWithUser(user));
    expect(book).toEqual({ mspId: null, isPlatformAdmin: false, tenants: [] });
  });
});
